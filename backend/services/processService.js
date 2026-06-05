const { bigquery, fastQuery, directQuery, projectId, location } = require("../config/bigQueryClient");

const DATASET_REPORTING = process.env.BQ_DATASET_REPORTING || "CDSL_REPORTING";
const DATASET_RUNTIME   = process.env.BQ_DATASET_RUNTIME   || "CDSL_RUNTIME";
const DATASET_CONFIG    = process.env.BQ_DATASET_CONFIG    || "CDSL_CONFIG";

// ── In-memory cache for buddy data ────────────────────────────────────────────
const cache = {
  buddy: { data: {}, ts: 0, TTL: 30 * 60 * 1000 }, // 30 min
};

// ── Get all active processes ──────────────────────────────────────────────────
async function getProcesses() {
  const query = `
    SELECT
      process_code,
      process_name,
      process_slug,
      module,
      planned_time,
      description
    FROM \`${projectId}.${DATASET_CONFIG}.process_master\`
    WHERE is_active = TRUE
    ORDER BY module, planned_time, process_name
  `;
  // Small table — directQuery is faster (no job creation overhead)
  const [rows] = await directQuery({ query, location });
  return rows;
}

// ── Get all steps for a process (latest day) ──────────────────────────────────
async function getProcessSteps(processCode) {
  const query = `
    WITH latest AS (
      SELECT MAX(process_date) AS process_date
      FROM \`${projectId}.${DATASET_RUNTIME}.process_tracker\`
      WHERE process_code = @processCode
    )
    SELECT v.*
    FROM \`${projectId}.${DATASET_REPORTING}.v_process_live_with_people\` v
    JOIN latest
      ON v.process_date = FORMAT_DATE('%Y-%m-%d', latest.process_date)
    WHERE v.process_code = @processCode
    ORDER BY v.step_no ASC
  `;
  // Heavy view join — fastQuery with 300ms polling
  const [rows] = await fastQuery({ query, location, params: { processCode } });

  if (!rows.length) {
    const err = new Error(`No data found for process: ${processCode}`);
    err.statusCode = 404;
    throw err;
  }

  const ownerEmails = [
    ...new Set(
      rows
        .filter(r => r.owner_email)
        .map(r => r.owner_email.toLowerCase())
    ),
  ];

  const buddyMap = await getLiveBuddyData(ownerEmails);

  const enrichedRows = rows.map(row => {
    const buddyData = buddyMap[(row.owner_email || "").toLowerCase()] || null;
    const { assigned_email, assignment_type } = resolveAssignment(
      row.step_status,
      row.updated_by,
      buddyData
    );
    return { ...row, assigned_email, assignment_type };
  });

  return buildProcessResponse(processCode, enrichedRows);
}

// ── Get single step ───────────────────────────────────────────────────────────
async function getProcessStep(processCode, stepId) {
  const query = `
    WITH latest AS (
      SELECT MAX(process_date) AS process_date
      FROM \`${projectId}.${DATASET_RUNTIME}.process_tracker\`
      WHERE process_code = @processCode
    )
    SELECT v.*
    FROM \`${projectId}.${DATASET_REPORTING}.v_process_live_with_people\` v
    JOIN latest
      ON v.process_date = FORMAT_DATE('%Y-%m-%d', latest.process_date)
    WHERE v.process_code = @processCode
      AND v.step_id      = @stepId
    LIMIT 1
  `;
  const [rows] = await fastQuery({ query, location, params: { processCode, stepId } });

  if (!rows.length) {
    const err = new Error(`Step not found: ${stepId} in process: ${processCode}`);
    err.statusCode = 404;
    throw err;
  }
  return rows[0];
}

// ── Mark step status ──────────────────────────────────────────────────────────
async function updateStepStatus(processCode, stepId, newStatus, changedBy, remark = '') {
  // Small count query — directQuery (no polling overhead)
  const [validateRows] = await directQuery({
    query : `
      SELECT COUNT(*) AS cnt
      FROM \`${projectId}.${DATASET_CONFIG}.allowed_statuses\`
      WHERE process_code = @processCode
        AND status_value = @newStatus
        AND is_active    = TRUE
    `,
    location,
    params: { processCode, newStatus },
  });

  if ((validateRows[0]?.cnt || 0) === 0) {
    const err = new Error(
      `Invalid status: "${newStatus}" for process "${processCode}"`
    );
    err.statusCode = 400;
    throw err;
  }

  // Small date lookup — directQuery
  const processDate = await getLatestProcessDate(processCode);

  // CALL procedure — fastQuery (stored procedure may take time)
  await fastQuery({
    query : `
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
      stepId,
      newStatus,
      changedBy   : changedBy || "SYSTEM",
      remark      : remark || "",
    },
  });

  return {
    process_code : processCode,
    process_date : processDate,
    step_id      : stepId,
    new_status   : newStatus,
    changed_by   : changedBy,
    message      : `Step ${stepId} updated to "${newStatus}"`,
  };
}

// ── Init process day ──────────────────────────────────────────────────────────
async function initProcessDay(processCode, processDate) {
  const dateToInit = processDate || getTodayIST();
  const [y, m, d]  = dateToInit.split("-");
  const slashFormat = `${d}/${m}/${y}`;

  // Small calendar lookup — directQuery
  const [calRows] = await directQuery({
    query : `
      SELECT COUNT(*) AS matched
      FROM \`${projectId}.${DATASET_CONFIG}.trading_calendar\`
      WHERE dd_mm_yyyy_slash = @dateSlash
    `,
    location,
    params: { dateSlash: slashFormat },
  });

  const isWorking = (calRows[0]?.matched || 0) > 0;
  if (!isWorking) {
    return {
      process_code : processCode,
      process_date : dateToInit,
      is_working   : false,
      message      : `Skipped — ${dateToInit} is not a working day`,
    };
  }

  // CALL procedure — fastQuery
  await fastQuery({
    query : `
      CALL \`${projectId}.${DATASET_RUNTIME}.sp_init_process_day\`(
        @processDate,
        @processCode
      )
    `,
    location,
    params: {
      processDate : bigquery.date(dateToInit),
      processCode,
    },
  });

  return {
    process_code : processCode,
    process_date : dateToInit,
    is_working   : true,
    message      : `Initialized process day for ${processCode} on ${dateToInit}`,
  };
}

// ── Archive a day ─────────────────────────────────────────────────────────────
async function archiveProcessDay(processCode, processDate) {
  let dateToArchive = processDate;
  if (!dateToArchive || dateToArchive === "yesterday") {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateToArchive = yesterday.toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
  }

  // CALL procedure — fastQuery
  await fastQuery({
    query : `
      CALL \`${projectId}.${DATASET_RUNTIME}.sp_archive_process_day\`(
        @processDate,
        @processCode
      )
    `,
    location,
    params: {
      processDate : bigquery.date(dateToArchive),
      processCode,
    },
  });

  return {
    process_code : processCode,
    process_date : dateToArchive,
    message      : `Archived ${processCode} for ${dateToArchive}`,
  };
}

// ── Audit log ─────────────────────────────────────────────────────────────────
async function getAuditLog(processCode, stepId = null) {
  const query = stepId ? `
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
    FROM \`${projectId}.CDSL_LOGS_NEW.step_audit_log\` al
    LEFT JOIN \`${projectId}.${DATASET_CONFIG}.step_master\` sm
      ON  al.process_code = sm.process_code
      AND al.step_id      = sm.step_id
    WHERE al.process_code = @processCode
      AND al.step_id      = @stepId
    ORDER BY al.changed_at DESC
    LIMIT 100
  ` : `
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
    FROM \`${projectId}.CDSL_LOGS_NEW.step_audit_log\` al
    LEFT JOIN \`${projectId}.${DATASET_CONFIG}.step_master\` sm
      ON  al.process_code = sm.process_code
      AND al.step_id      = sm.step_id
    WHERE al.process_code = @processCode
    ORDER BY al.changed_at DESC
    LIMIT 100
  `;
  const params = stepId ? { processCode, stepId } : { processCode };
  // Audit log join — fastQuery
  const [rows] = await fastQuery({ query, location, params });
  return rows;
}

// ── Buddy lookup — local asia-south1 with in-memory cache ─────────────────────
async function getLiveBuddyData(ownerEmails) {
  if (!ownerEmails || ownerEmails.length === 0) return {};

  const now        = Date.now();
  const cacheValid = (now - cache.buddy.ts) < cache.buddy.TTL;
  const allCached  = cacheValid && ownerEmails.every(
    e => cache.buddy.data[e.toLowerCase()] !== undefined
  );

  if (!allCached) {
    const toFetch = cacheValid
      ? ownerEmails.filter(e => cache.buddy.data[e.toLowerCase()] === undefined)
      : ownerEmails;

    if (toFetch.length > 0) {
      const emailList = toFetch.map(e => `'${e.toLowerCase()}'`).join(",");

      // Small lookup — directQuery (no job overhead, much faster)
      const [rows] = await directQuery({
        query : `
          SELECT
            LOWER(owner_email)   AS owner_email,
            emp_attendance,
            emp_leave_flag,
            buddy_email,
            buddy_attendance,
            reporting_email,
            reporting_attendance,
            final_email,
            department
          FROM \`${projectId}.${DATASET_CONFIG}.buddy_master\`
          WHERE LOWER(owner_email) IN (${emailList})
        `,
        location,
      });

      rows.forEach(r => { cache.buddy.data[r.owner_email] = r; });
      toFetch.forEach(e => {
        if (cache.buddy.data[e.toLowerCase()] === undefined) {
          cache.buddy.data[e.toLowerCase()] = null;
        }
      });
      cache.buddy.ts = now;
    }
  }

  const map = {};
  ownerEmails.forEach(e => {
    const key = e.toLowerCase();
    if (cache.buddy.data[key]) map[key] = cache.buddy.data[key];
  });
  return map;
}

// ── Check if person is present ────────────────────────────────────────────────
function isPersonPresent(attendance, leaveFlag, shiftInActual, shiftInBarrier) {
  if (!attendance || attendance !== 1) return false;
  const flag = (leaveFlag || "").toUpperCase().trim();
  if (flag === "NOT IN" || flag === "") return false;
  if (flag === "IN" || flag === "LEFT EARLY") return true;
  if (flag === "LATE IN" || flag === "LATE MORE THAN 30 MINUTES") {
    if (!shiftInActual)  return false;
    if (!shiftInBarrier) return true;
    const toDate = (v) => {
      if (!v) return null;
      if (typeof v === "object" && v.value) return new Date(v.value);
      return new Date(v);
    };
    const actual  = toDate(shiftInActual);
    const barrier = toDate(shiftInBarrier);
    if (!actual  || isNaN(actual.getTime()))  return false;
    if (!barrier || isNaN(barrier.getTime())) return true;
    const cooloff = new Date(barrier.getTime() + 30 * 60 * 1000);
    return actual <= cooloff;
  }
  return true;
}

// ── Resolve assignment ────────────────────────────────────────────────────────
function resolveAssignment(stepStatus, updatedBy, buddyData) {
  const status = (stepStatus || "").toUpperCase().trim();

  if (status === "COMPLETED" || status === "EXCEPTION") {
    return { assigned_email: updatedBy || null, assignment_type: "COMPLETED_BY" };
  }

  if (status === "PENDING") {
    if (!buddyData) {
      return { assigned_email: "systems@geplcapital.com", assignment_type: "ADMIN" };
    }
    const ownerPresent = isPersonPresent(
      buddyData.emp_attendance,
      buddyData.emp_leave_flag,
      buddyData.emp_shift_in_actual,
      buddyData.emp_shift_in_barrier
    );
    if (ownerPresent) {
      return { assigned_email: buddyData.owner_email, assignment_type: "SELF" };
    }
    if (buddyData.buddy_attendance === 1 && buddyData.buddy_email) {
      return { assigned_email: buddyData.buddy_email, assignment_type: "BUDDY" };
    }
    if (buddyData.reporting_attendance === 1 && buddyData.reporting_email) {
      return { assigned_email: buddyData.reporting_email, assignment_type: "REPORTING" };
    }
    return { assigned_email: "systems@geplcapital.com", assignment_type: "ADMIN" };
  }

  return { assigned_email: null, assignment_type: null };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getLatestProcessDate(processCode) {
  // Small lookup — directQuery
  const [rows] = await directQuery({
    query : `
      SELECT FORMAT_DATE('%Y-%m-%d', MAX(process_date)) AS process_date
      FROM \`${projectId}.${DATASET_RUNTIME}.process_tracker\`
      WHERE process_code = @processCode
    `,
    location,
    params: { processCode },
  });

  if (!rows[0]?.process_date) {
    const err = new Error(`No process date found for: ${processCode}`);
    err.statusCode = 404;
    throw err;
  }
  return rows[0].process_date;
}

function getTodayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function buildProcessResponse(processCode, steps) {
  return {
    source          : "BIGQUERY",
    process_code    : processCode,
    process_name    : steps[0]?.process_name || processCode,
    process_slug    : steps[0]?.process_slug || "",
    module          : steps[0]?.module       || "",
    process_date    : steps[0]?.process_date || null,
    total_steps     : steps.length,
    completed_steps : steps.filter(s => s.completed === "YES").length,
    steps,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  getProcesses,
  getProcessSteps,
  getProcessStep,
  initProcessDay,
  updateStepStatus,
  archiveProcessDay,
  getAuditLog,
};