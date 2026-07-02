'use strict';

const { performance } = require('node:perf_hooks');
const {
  bigquery,
  fastQuery,
  directQuery,
  projectId,
  location,
} = require('../config/bigQueryClient');
const cacheService = require('./cacheService');

const DATASET_RUNTIME  = process.env.BQ_DATASET_RUNTIME  || 'CDSL_RUNTIME';
const DATASET_CONFIG   = process.env.BQ_DATASET_CONFIG   || 'CDSL_CONFIG';
const DATASET_LOGS     = process.env.BQ_DATASET_LOGS     || 'CDSL_LOGS_NEW';
const ADMIN_EMAIL      = String(process.env.CDSL_ADMIN_EMAIL || '').trim().toLowerCase();

const inFlightStepLoads = new Map();
const inFlightLockLoads = new Map();

// ── Date helpers ──────────────────────────────────────────────────────────────
function getTodayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function getYesterdayIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value])
  );

  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function normalizeProcessCode(processCode) {
  const normalized = String(processCode || '').trim().toUpperCase();
  if (!normalized) {
    const error = new Error('processCode is required');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function withSource(data, source, startedAt, extra = {}) {
  return {
    ...data,
    source,
    response_time_ms: Math.round(performance.now() - startedAt),
    ...extra,
  };
}

// ── Get all active processes ──────────────────────────────────────────────────
async function getProcesses() {
  const cached = await cacheService.getProcessList();
  if (cached !== null) return cached;

  const [rows] = await directQuery({
    query: `
      SELECT
        process_code, process_name, process_slug,
module,
FORMAT_TIME('%H:%M:%S', planned_time_value) AS planned_time,
working_days,
is_active      FROM \`${projectId}.${DATASET_CONFIG}.process_master\`
      WHERE is_active = TRUE
ORDER BY module, planned_time_value, process_name    `,
    location,
  });

  await cacheService.setProcessList(rows);
  return rows;
}

// ── Load steps from BQ — full join with buddy data ───────────────────────────
async function loadProcessStepsFromBigQuery(processCode, processDate) {
  const query = `
    SELECT
      pt.tracker_id,
      FORMAT_DATE('%Y-%m-%d', pt.process_date)              AS process_date,
      pt.process_code,
      COALESCE(pt.process_slug, pm.process_slug)            AS process_slug,
      pm.process_name,
      pm.module,
      pt.step_id,
      pt.step_no,
      sm.step_name,
      pt.step_status,

      CASE
        WHEN UPPER(TRIM(pt.step_status)) = 'COMPLETED'
          THEN COALESCE(pt.last_status_value, 'Completed')
        WHEN UPPER(TRIM(pt.completed)) = 'YES'
          THEN COALESCE(pt.last_status_value, 'Completed')
        WHEN UPPER(TRIM(pt.step_status)) = 'EXCEPTION'
          THEN COALESCE(pt.last_status_value, 'Exception')
        ELSE 'Pending'
      END AS ui_status,

      CASE
        WHEN UPPER(TRIM(pt.step_status)) = 'PENDING'
          AND pt.planned_time IS NOT NULL
          AND REGEXP_CONTAINS(TRIM(pt.planned_time), r'^\\d{2}:\\d{2}:\\d{2}$')
          AND CURRENT_TIME('Asia/Kolkata') > PARSE_TIME('%H:%M:%S', TRIM(pt.planned_time))
        THEN TRUE
        ELSE FALSE
      END AS is_overdue,

      pt.completed,
      pt.exception_reason,
      pt.last_status_value,
COALESCE(
  pt.planned_time,
  FORMAT_TIME('%H:%M:%S', pm.planned_time_value)
) AS planned_time,
      CASE
        WHEN pt.actual_time IS NULL THEN NULL
        ELSE FORMAT_TIMESTAMP('%d %b %Y %I:%M %p', pt.actual_time, 'Asia/Kolkata')
      END AS actual_time,

      IFNULL(pt.delay_minutes, 0)                           AS delay_minutes,
      pt.updated_by,

      CASE
        WHEN pt.updated_at IS NULL THEN NULL
        ELSE FORMAT_TIMESTAMP('%d %b %Y %I:%M %p', pt.updated_at, 'Asia/Kolkata')
      END AS updated_at,

      sm.owner_role,
      sm.owner_email,
      sm.sla,
      sm.file_names,
      sm.system_name,
      sm.path_navigation_url,
      sm.how_to_execute,
      sm.validation_checks,
      sm.exception_action,
      sm.dependency_ids,
      sm.allowed_statuses,
      sm.remarks,

      COALESCE(exception_config.exception_statuses, ARRAY<STRING>[]) AS exception_statuses,

      -- Buddy fields — all attendance columns + leave flags
      buddy.owner_email           AS buddy_owner_email,
      buddy.emp_attendance        AS buddy_emp_attendance,
      buddy.emp_leave_flag        AS buddy_emp_leave_flag,
      buddy.buddy_email           AS buddy_email,
      buddy.buddy_attendance      AS buddy_attendance,
      buddy.buddy_leave_flag      AS buddy_leave_flag,
      buddy.reporting_email       AS buddy_reporting_email,
      buddy.reporting_attendance  AS buddy_reporting_attendance,
      buddy.reporting_leave_flag  AS buddy_reporting_leave_flag,
      buddy.final_email           AS buddy_final_email

    FROM \`${projectId}.${DATASET_RUNTIME}.process_tracker\` pt

    LEFT JOIN \`${projectId}.${DATASET_CONFIG}.step_master\` sm
      ON  sm.process_code = pt.process_code
      AND sm.step_id      = pt.step_id
      AND sm.is_active    = TRUE

    LEFT JOIN \`${projectId}.${DATASET_CONFIG}.process_master\` pm
      ON  pm.process_code = pt.process_code
      AND pm.is_active    = TRUE

    LEFT JOIN (
      SELECT
        process_code,
        ARRAY_AGG(status_value ORDER BY sort_order) AS exception_statuses
      FROM \`${projectId}.${DATASET_CONFIG}.allowed_statuses\`
      WHERE requires_remark = TRUE
        AND is_active       = TRUE
        AND process_code    = @processCode
      GROUP BY process_code
    ) AS exception_config
      ON exception_config.process_code = pt.process_code

    LEFT JOIN (
      SELECT
        LOWER(owner_email)                        AS owner_key,
        ANY_VALUE(owner_email)                    AS owner_email,
        ANY_VALUE(emp_attendance)                 AS emp_attendance,
        ANY_VALUE(emp_leave_flag)                 AS emp_leave_flag,
        ANY_VALUE(buddy_email)                    AS buddy_email,
        ANY_VALUE(buddy_attendance)               AS buddy_attendance,
        ANY_VALUE(buddy_leave_flag)               AS buddy_leave_flag,
        ANY_VALUE(reporting_email)                AS reporting_email,
        ANY_VALUE(reporting_attendance)           AS reporting_attendance,
        ANY_VALUE(reporting_leave_flag)           AS reporting_leave_flag,
        ANY_VALUE(final_email)                    AS final_email
      FROM \`${projectId}.${DATASET_CONFIG}.buddy_master\`
      WHERE owner_email IS NOT NULL
      GROUP BY owner_key
    ) AS buddy
      ON buddy.owner_key = LOWER(sm.owner_email)

    WHERE pt.process_code = @processCode
      AND pt.process_date = @processDate

    ORDER BY pt.step_no ASC
  `;

  const [rows] = await directQuery({
    query,
    location,
    params: {
      processCode,
      processDate: bigquery.date(processDate),
    },
  });

  if (!rows.length) {
    const error = new Error(`No data for ${processCode} on ${processDate}. Run init first.`);
    error.statusCode = 404;
    throw error;
  }

  const enrichedRows = rows.map((row) => {
    const {
      buddy_owner_email       : buddyOwnerEmail,
      buddy_emp_attendance    : empAttendance,
      buddy_emp_leave_flag    : empLeaveFlag,
      buddy_email             : buddyEmail,
      buddy_attendance        : buddyAttendance,
      buddy_leave_flag        : buddyLeaveFlag,
      buddy_reporting_email   : reportingEmail,
      buddy_reporting_attendance : reportingAttendance,
      buddy_reporting_leave_flag : reportingLeaveFlag,
      buddy_final_email       : finalEmail,
      ...publicRow
    } = row;

    const buddyData = buddyOwnerEmail ? {
      owner_email          : buddyOwnerEmail,
      emp_attendance       : empAttendance,
      emp_leave_flag       : empLeaveFlag,
      buddy_email          : buddyEmail,
      buddy_attendance     : buddyAttendance,
      buddy_leave_flag     : buddyLeaveFlag,
      reporting_email      : reportingEmail,
      reporting_attendance : reportingAttendance,
      reporting_leave_flag : reportingLeaveFlag,
      final_email          : finalEmail,
    } : null;

    const assignment = resolveAssignment(
      row.step_status,
      row.updated_by,
      row.owner_email,
      buddyData,
    );

    return { ...publicRow, ...assignment };
  });

  const result = buildProcessResponse(processCode, enrichedRows);
  await cacheService.setSteps(processCode, processDate, result);
  return result;
}

// ── In-flight deduplication ───────────────────────────────────────────────────
function getOrCreateStepLoad(processCode, processDate) {
  const loadKey = `${processCode}:${processDate}`;
  const existing = inFlightStepLoads.get(loadKey);
  if (existing) return existing;

  const loadPromise = loadProcessStepsFromBigQuery(processCode, processDate)
    .finally(() => { inFlightStepLoads.delete(loadKey); });

  inFlightStepLoads.set(loadKey, loadPromise);
  return loadPromise;
}

function refreshStaleStepsInBackground(processCode, processDate) {
  void getOrCreateStepLoad(processCode, processDate)
    .then(() => { console.log(`[cache] background refresh completed for ${processCode}`); })
    .catch((err) => { console.warn(`[cache] background refresh failed for ${processCode}:`, err.message); });
}

// ── Get all steps (cached) ────────────────────────────────────────────────────
async function getProcessSteps(rawProcessCode) {
  const startedAt   = performance.now();
  const processCode = normalizeProcessCode(rawProcessCode);
  const processDate = getTodayIST();
  const cached      = await cacheService.getSteps(processCode, processDate);

  if (cached.state === 'fresh') {
    const result = withSource(cached.data, 'REDIS', startedAt, { cache_state: 'fresh' });
    console.log(`[process] ${processCode} source=REDIS duration=${result.response_time_ms}ms`);
    return result;
  }

  if (cached.state === 'stale') {
    refreshStaleStepsInBackground(processCode, processDate);
    const result = withSource(cached.data, 'REDIS_STALE', startedAt, { cache_state: 'stale', refresh_in_progress: true });
    console.log(`[process] ${processCode} source=REDIS_STALE duration=${result.response_time_ms}ms`);
    return result;
  }

  const hadExistingLoad = inFlightStepLoads.has(`${processCode}:${processDate}`);
  const data   = await getOrCreateStepLoad(processCode, processDate);
  const source = hadExistingLoad ? 'IN_FLIGHT' : 'BIGQUERY';
  const result = withSource(data, source, startedAt, { cache_state: 'miss' });
  console.log(`[process] ${processCode} source=${source} duration=${result.response_time_ms}ms`);
  return result;
}

// ── Dependency locks (empty results are cached too) ───────────────────────────
async function loadStepLocksFromBigQuery(processCode, processDate) {
  const [rows] = await directQuery({
    query: `
      WITH tracker_today AS (
        SELECT
          step_id,
          completed,
          step_status,
          last_status_value
        FROM \`${projectId}.${DATASET_RUNTIME}.process_tracker\`
        WHERE process_code = @processCode
          AND process_date = @processDate
      ),
      condition_groups AS (
        SELECT
          sc.step_id,
          sc.condition_group,
          LOGICAL_OR(
            COALESCE(
              IF(
                sc.required_status IS NULL,
                UPPER(TRIM(COALESCE(pt.completed, ''))) IN ('YES', 'EXCEPTION'),
                UPPER(TRIM(COALESCE(pt.last_status_value, pt.step_status, '')))
                  = UPPER(TRIM(sc.required_status))
              ),
              FALSE
            )
          ) AS group_satisfied
        FROM \`${projectId}.${DATASET_CONFIG}.step_conditions\` sc
        LEFT JOIN tracker_today pt
          ON pt.step_id = sc.required_step_id
        WHERE sc.process_code = @processCode
          AND sc.is_active    = TRUE
        GROUP BY sc.step_id, sc.condition_group
      )
      SELECT
        step_id,
        COALESCE(LOGICAL_AND(group_satisfied), FALSE) AS is_unlocked
      FROM condition_groups
      GROUP BY step_id
      ORDER BY step_id
    `,
    location,
    params: {
      processCode,
      processDate: bigquery.date(processDate),
    },
  });

  const locks = Object.fromEntries(
    rows.map((row) => [
      String(row.step_id),
      row.is_unlocked === true,
    ]),
  );

  // Always cache the result. An empty object means the process has no active
  // dependency conditions; it is valid data, not a cache miss.
  await cacheService.setLocks(processCode, processDate, locks);
  return locks;
}

function getOrCreateLockLoad(processCode, processDate) {
  const loadKey = `${processCode}:${processDate}`;
  const existing = inFlightLockLoads.get(loadKey);
  if (existing) return existing;

  const loadPromise = loadStepLocksFromBigQuery(processCode, processDate)
    .finally(() => { inFlightLockLoads.delete(loadKey); });

  inFlightLockLoads.set(loadKey, loadPromise);
  return loadPromise;
}

async function getStepLocks(rawProcessCode) {
  const processCode = normalizeProcessCode(rawProcessCode);
  const processDate = getTodayIST();
  const cached = await cacheService.getLocks(processCode, processDate);

  // Important: {} is a valid cached value. Only null means cache miss.
  if (cached !== null) {
    return cached;
  }

  return getOrCreateLockLoad(processCode, processDate);
}

// ── Get single step (always fresh) ───────────────────────────────────────────
async function getProcessStep(rawProcessCode, stepId) {
  const processCode = normalizeProcessCode(rawProcessCode);
  const processDate = getTodayIST();

  const [rows] = await directQuery({
    query: `
      SELECT
        pt.tracker_id,
        FORMAT_DATE('%Y-%m-%d', pt.process_date) AS process_date,
        pt.process_code,
        pt.step_id,
        pt.step_no,
        sm.step_name,
        pt.step_status,
        pt.completed,
        pt.exception_reason,
        pt.last_status_value,
       COALESCE(
  pt.planned_time,
  FORMAT_TIME('%H:%M:%S', pm.planned_time_value)
) AS planned_time,
        CASE
          WHEN pt.actual_time IS NULL THEN NULL
          ELSE FORMAT_TIMESTAMP('%d %b %Y %I:%M %p', pt.actual_time, 'Asia/Kolkata')
        END AS actual_time,
        IFNULL(pt.delay_minutes, 0) AS delay_minutes,
        pt.updated_by,
        sm.owner_email,
        sm.owner_role,
        sm.allowed_statuses,
        sm.dependency_ids
      FROM \`${projectId}.${DATASET_RUNTIME}.process_tracker\` pt
      LEFT JOIN \`${projectId}.${DATASET_CONFIG}.step_master\` sm
        ON  sm.process_code = pt.process_code
        AND sm.step_id      = pt.step_id
        AND sm.is_active    = TRUE
      LEFT JOIN \`${projectId}.${DATASET_CONFIG}.process_master\` pm
        ON  pm.process_code = pt.process_code
        AND pm.is_active    = TRUE
      WHERE pt.process_code = @processCode
        AND pt.process_date = @processDate
        AND pt.step_id      = @stepId
      LIMIT 1
    `,
    location,
    params: {
      processCode,
      processDate: bigquery.date(processDate),
      stepId,
    },
  });

  if (!rows.length) {
    const error = new Error(`Step ${stepId} not found in ${processCode}`);
    error.statusCode = 404;
    throw error;
  }

  return rows[0];
}

// ── Mark step status ──────────────────────────────────────────────────────────
async function updateStepStatus(rawProcessCode, stepId, newStatus, changedBy, remark = '') {
  const processCode      = normalizeProcessCode(rawProcessCode);
  const processDate      = getTodayIST();
  const normalizedStepId = String(stepId || '').trim();
  const normalizedStatus = String(newStatus || '').trim();
  const normalizedChangedBy = String(changedBy || '').trim().toLowerCase();
  const normalizedRemark = String(remark || '').trim();

  if (!normalizedStepId) {
    const error = new Error('stepId is required');
    error.statusCode = 400;
    throw error;
  }

  if (!normalizedStatus) {
    const error = new Error('status is required');
    error.statusCode = 400;
    throw error;
  }

  if (!normalizedChangedBy) {
    const error = new Error('changed_by is required');
    error.statusCode = 400;
    throw error;
  }

  // Validate status against step_master.allowed_statuses
  const [validationRows] = await directQuery({
    query: `
      SELECT COUNT(*) AS cnt
      FROM \`${projectId}.${DATASET_CONFIG}.step_master\` sm,
      UNNEST(sm.allowed_statuses) AS allowed_status
      WHERE sm.process_code = @processCode
        AND sm.step_id      = @stepId
        AND sm.is_active    = TRUE
        AND allowed_status  = @newStatus
    `,
    location,
    params: { processCode, stepId: normalizedStepId, newStatus: normalizedStatus },
  });

  const isPending = normalizedStatus.toUpperCase() === 'PENDING';
  if (!isPending && Number(validationRows[0]?.cnt || 0) === 0) {
    const error = new Error(`Invalid status "${normalizedStatus}" for step "${normalizedStepId}" in process "${processCode}"`);
    error.statusCode = 400;
    throw error;
  }

  // Call stored procedure
  await fastQuery({
    query: `
      CALL \`${projectId}.${DATASET_RUNTIME}.sp_mark_step_status\`(
        @processDate,
        @processCode,
        @stepId,
        @newStatus,
        @changedBy,
        @remark
      )
    `,
    location,
    params: {
      processDate : bigquery.date(processDate),
      processCode,
      stepId      : normalizedStepId,
      newStatus   : normalizedStatus,
      changedBy   : normalizedChangedBy,
      remark      : normalizedRemark,
    },
  });

  // Remove only fresh data after a normal user action. Preserve the stale
  // snapshot so the next dashboard request is immediate, then rebuild fresh
  // and stale caches asynchronously from BigQuery.
  await Promise.all([
    cacheService.bustStepsFresh(processCode, processDate),
    cacheService.bustLocks(processCode, processDate),
  ]);

  refreshStaleStepsInBackground(processCode, processDate);

  return {
    process_code: processCode,
    process_date: processDate,
    step_id     : normalizedStepId,
    new_status  : normalizedStatus,
    changed_by  : normalizedChangedBy,
    message     : `Status request for ${normalizedStepId} processed successfully`,
  };
}

// ── Init process day ──────────────────────────────────────────────────────────
async function initProcessDay(rawProcessCode, processDate) {
  const processCode = normalizeProcessCode(rawProcessCode);
  const dateToInit = processDate || getTodayIST();

  // Use the same authoritative working-day function as the stored procedures.
  const [calendarRows] = await directQuery({
    query: `
      SELECT
        \`${projectId}.${DATASET_CONFIG}.fx_is_working_day\`(
          @processDate
        ) AS is_working
    `,
    location,
    params: {
      processDate: bigquery.date(dateToInit),
    },
  });

  const isWorking = calendarRows[0]?.is_working === true;
  if (!isWorking) {
    return {
      process_code: processCode,
      process_date: dateToInit,
      is_working  : false,
      message     : `Skipped — ${dateToInit} is not a working day`,
    };
  }

  await fastQuery({
    query: `
      CALL \`${projectId}.${DATASET_RUNTIME}.sp_init_process_day\`(
        @processDate, @processCode
      )
    `,
    location,
    params: { processDate: bigquery.date(dateToInit), processCode },
  });

  await Promise.all([
    cacheService.bustProcess(processCode, dateToInit),
    cacheService.bustLocks(processCode, dateToInit),
  ]);

  return {
    process_code: processCode,
    process_date: dateToInit,
    is_working  : true,
    message     : `Initialized ${processCode} for ${dateToInit}`,
  };
}

// ── Archive process day ───────────────────────────────────────────────────────
async function archiveProcessDay(rawProcessCode, processDate) {
  const processCode  = normalizeProcessCode(rawProcessCode);
  const dateToArchive = (!processDate || processDate === 'yesterday')
    ? getYesterdayIST()
    : processDate;

  await fastQuery({
    query: `
      CALL \`${projectId}.${DATASET_RUNTIME}.sp_archive_process_day\`(
        @processDate, @processCode
      )
    `,
    location,
    params: { processDate: bigquery.date(dateToArchive), processCode },
  });

  await Promise.all([
    cacheService.bustProcess(processCode, dateToArchive),
    cacheService.bustLocks(processCode, dateToArchive),
  ]);

  return {
    process_code: processCode,
    process_date: dateToArchive,
    message     : `Archived ${processCode} for ${dateToArchive}`,
  };
}

// ── Audit log ─────────────────────────────────────────────────────────────────
async function getAuditLog(rawProcessCode, stepId = null) {
  const processCode = normalizeProcessCode(rawProcessCode);

  const [rows] = await fastQuery({
    query: `
      SELECT
        FORMAT_TIMESTAMP('%d %b %Y %I:%M %p', al.changed_at, 'Asia/Kolkata') AS changed_at,
        al.step_id,
        sm.step_name,
        al.old_status,
        al.new_status,
        al.changed_by,
        al.delay_minutes,
        al.exception_reason,
        al.remarks
      FROM \`${projectId}.${DATASET_LOGS}.step_audit_log\` al
      LEFT JOIN \`${projectId}.${DATASET_CONFIG}.step_master\` sm
        ON  sm.process_code = al.process_code
        AND sm.step_id      = al.step_id
      WHERE al.process_code = @processCode
        ${stepId ? 'AND al.step_id = @stepId' : ''}
      ORDER BY al.changed_at DESC
      LIMIT 100
    `,
    location,
    params: stepId ? { processCode, stepId } : { processCode },
  });

  return rows;
}

// ── Buddy resolution ──────────────────────────────────────────────────────────
// emp_attendance is INT64 in buddy_master (1=Present, 0=Absent)
// Also handles STRING 'Present'/'Absent' for backward compat
function isPresent(attendance) {
  if (attendance === true || attendance === 1) return true;
  const value = String(attendance || '').trim().toLowerCase();
  return ['1', 'present', 'yes', 'y', 'in'].includes(value);
}

function isOnLeave(leaveFlag) {
  const value = String(leaveFlag || '').trim().toUpperCase();
  return ['Y', 'YES', 'LEAVE', 'ON LEAVE', 'NOT IN'].includes(value);
}

function fallbackAssignment(ownerEmail) {
  if (ADMIN_EMAIL) {
    return { assigned_email: ADMIN_EMAIL, assignment_type: 'ADMIN' };
  }
  return {
    assigned_email: ownerEmail || null,
    assignment_type: ownerEmail ? 'OWNER_FALLBACK' : 'UNASSIGNED',
  };
}

function resolveAssignment(stepStatus, updatedBy, ownerEmail, buddyData) {
  const status = String(stepStatus || '').toUpperCase().trim();

  // Completed or exception — show who did it
  if (status === 'COMPLETED' || status === 'EXCEPTION') {
    return { assigned_email: updatedBy || null, assignment_type: 'COMPLETED_BY' };
  }

  if (status !== 'PENDING') {
    return { assigned_email: null, assignment_type: null };
  }

  if (!buddyData) return fallbackAssignment(ownerEmail);

  // SELF — owner is present and not on leave
  if (isPresent(buddyData.emp_attendance) && !isOnLeave(buddyData.emp_leave_flag)) {
    return {
      assigned_email: buddyData.owner_email || ownerEmail || null,
      assignment_type: 'SELF',
    };
  }

  // BUDDY — buddy is present and not on leave
  if (
    isPresent(buddyData.buddy_attendance) &&
    !isOnLeave(buddyData.buddy_leave_flag) &&
    buddyData.buddy_email
  ) {
    return { assigned_email: buddyData.buddy_email, assignment_type: 'BUDDY' };
  }

  // REPORTING — reporting manager is present and not on leave
  if (
    isPresent(buddyData.reporting_attendance) &&
    !isOnLeave(buddyData.reporting_leave_flag) &&
    buddyData.reporting_email
  ) {
    return { assigned_email: buddyData.reporting_email, assignment_type: 'REPORTING' };
  }

  // ADMIN fallback
  return fallbackAssignment(ownerEmail);
}

// ── Build response shape ──────────────────────────────────────────────────────
function buildProcessResponse(processCode, steps) {
  return {
    process_code   : processCode,
    process_name   : steps[0]?.process_name || processCode,
    process_slug   : steps[0]?.process_slug || '',
    module         : steps[0]?.module || '',
    process_date   : steps[0]?.process_date || null,
    total_steps    : steps.length,
    completed_steps: steps.filter(step =>
      String(step.completed || '').toUpperCase() === 'YES' ||
      String(step.step_status || '').toUpperCase() === 'COMPLETED'
    ).length,
    steps,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  getProcesses,
  getProcessSteps,
  getStepLocks,
  getProcessStep,
  initProcessDay,
  updateStepStatus,
  archiveProcessDay,
  getAuditLog,
};