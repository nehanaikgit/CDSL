const { bigquery, projectId, location } = require("../config/bigQueryClient");

const DATASET_REPORTING = process.env.BQ_DATASET_REPORTING || "CDSL_REPORTING";
const DATASET_RUNTIME   = process.env.BQ_DATASET_RUNTIME   || "CDSL_RUNTIME";

// ── Status mapping ────────────────────────────────────────────────────────────
const UI_TO_PROC_STATUS = {
  "File Downloaded"         : "File Downloaded",
  "File Not Received Today" : "File Not Received Today",
  "Error from Exchange End" : "Error from Exchange End",
  "Pending"                 : "PENDING",
};

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

  const [rows] = await bigquery.query({
    query,
    location,
    params: { processCode },
  });

  if (!rows.length) {
    const err = new Error(`No data found for process: ${processCode}`);
    err.statusCode = 404;
    throw err;
  }

  // Get unique owner emails
  const ownerEmails = [
    ...new Set(
      rows
        .filter(r => r.owner_email)
        .map(r => r.owner_email.toLowerCase())
    ),
  ];

  // Fetch LIVE buddy data from HRMantra (US region)
  const buddyMap = await getLiveBuddyData(ownerEmails);

  // Enrich each step with live assignment
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

  const [rows] = await bigquery.query({
    query,
    location,
    params: { processCode, stepId },
  });

  if (!rows.length) {
    const err = new Error(`Step not found: ${stepId} in process: ${processCode}`);
    err.statusCode = 404;
    throw err;
  }

  return rows[0];
}

// ── Init today's rows ─────────────────────────────────────────────────────────


// ── Mark step status ──────────────────────────────────────────────────────────
async function updateStepStatus(processCode, stepId, newStatus, changedBy) {
  if (!Object.prototype.hasOwnProperty.call(UI_TO_PROC_STATUS, newStatus)) {
    const err = new Error(
      `Invalid status: "${newStatus}". Allowed: ${Object.keys(UI_TO_PROC_STATUS).join(", ")}`
    );
    err.statusCode = 400;
    throw err;
  }

  const processDate = await getLatestProcessDate(processCode);
  const procStatus  = UI_TO_PROC_STATUS[newStatus];

  const query = `
  CALL \`${projectId}.${DATASET_RUNTIME}.sp_mark_step_status\`(
    @processDate,
    @processCode,
    @stepId,
    @newStatus,
    @changedBy
  )
`;

  await bigquery.query({
    query,
    location,
    params: {
      processCode,
      processDate : bigquery.date(processDate),
      stepId,
      newStatus   : procStatus,
      changedBy   : changedBy || "SYSTEM",
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

  const query = `
    CALL \`${projectId}.${DATASET_RUNTIME}.sp_archive_process_day\`(
      @processCode,
      @processDate
    )
  `;

  await bigquery.query({
    query,
    location,
    params: {
      processCode,
      processDate: bigquery.date(dateToArchive),
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
  let query;
  let params;

  if (stepId) {
    query = `
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
      LEFT JOIN \`${projectId}.CDSL_CONFIG.step_master\` sm
        ON  al.process_code = sm.process_code
        AND al.step_id      = sm.step_id
      WHERE al.process_code = @processCode
        AND al.step_id      = @stepId
      ORDER BY al.changed_at DESC
      LIMIT 100
    `;
    params = { processCode, stepId };
  } else {
    query = `
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
      LEFT JOIN \`${projectId}.CDSL_CONFIG.step_master\` sm
        ON  al.process_code = sm.process_code
        AND al.step_id      = sm.step_id
      WHERE al.process_code = @processCode
      ORDER BY al.changed_at DESC
      LIMIT 100
    `;
    params = { processCode };
  }

  const [rows] = await bigquery.query({ query, location, params });
  return rows;
}

// ── Live buddy lookup from HRMantra (US region) ───────────────────────────────
async function getLiveBuddyData(ownerEmails) {
  if (!ownerEmails || ownerEmails.length === 0) return {};

  const emailList = ownerEmails
    .map(e => `'${e.toLowerCase()}'`)
    .join(",");

  const query = `
    SELECT
      LOWER(OffEmailLower)              AS owner_email,
      Department                        AS department,
      EmpAttendance                     AS emp_attendance,
      EmpLeaveFlag                      AS emp_leave_flag,
      ShiftInActual                     AS emp_shift_in_actual,
      ShiftInBarrier                    AS emp_shift_in_barrier,
      LOWER(BuddyOffEmailLower)         AS buddy_email,
      BuddyAttendance                   AS buddy_attendance,
      LOWER(ReportingOffEmailLower)     AS reporting_email,
      ReportingAttendance               AS reporting_attendance,
      LOWER(FinalEmail)                 AS final_email
    FROM \`universal-table-store\`.BuddySystem.BuddyMasterAutoPopulate
    WHERE LOWER(OffEmailLower) IN (${emailList})
  `;

  const [rows] = await bigquery.query({
    query,
    location: "US",
  });

  const map = {};
  rows.forEach(r => { map[r.owner_email] = r; });
  return map;
}



// ── Check if person is present based on attendance + time ─────────────────────
function isPersonPresent(attendance, leaveFlag, shiftInActual, shiftInBarrier) {
  if (!attendance || attendance !== 1) return false;

  const flag = (leaveFlag || "").toUpperCase().trim();

  if (flag === "NOT IN" || flag === "") return false;

  if (flag === "IN" || flag === "LEFT EARLY") return true;

  if (
    flag === "LATE IN" ||
    flag === "LATE MORE THAN 30 MINUTES"
  ) {
    if (!shiftInActual) return false;
    if (!shiftInBarrier) return true;

    // Handle BigQuery timestamp objects { value: "2026-06-02T09:04:12" }
    // and plain strings both
    const toDate = (v) => {
      if (!v) return null;
      if (typeof v === "object" && v.value) return new Date(v.value);
      return new Date(v);
    };

    const actual  = toDate(shiftInActual);
    const barrier = toDate(shiftInBarrier);

    if (!actual || isNaN(actual.getTime()))  return false;
    if (!barrier || isNaN(barrier.getTime())) return true;

    // 30 min cooloff after barrier
    const cooloff = new Date(barrier.getTime() + 30 * 60 * 1000);

    return actual <= cooloff;
  }

  // Any other flag with attendance=1 → present
  return true;
}

async function initProcessDay(processCode, processDate) {
  const dateToInit = processDate || getTodayIST();

  // Check if today is a working day
  const [y, m, d]   = dateToInit.split("-");
  const slashFormat = `${d}/${m}/${y}`;

  const calQuery = `
    SELECT COUNT(*) AS matched
    FROM \`${projectId}.CDSL_CONFIG.trading_calendar\`
    WHERE dd_mm_yyyy_slash = @dateSlash
  `;

  const [calRows] = await bigquery.query({
    query    : calQuery,
    location,
    params   : { dateSlash: slashFormat },
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

  // Working day — proceed with init
  const query = `
    CALL \`${projectId}.${DATASET_RUNTIME}.sp_init_process_day\`(
      @processCode,
      @processDate
    )
  `;

  await bigquery.query({
    query,
    location,
    params: {
      processCode,
      processDate: bigquery.date(dateToInit),
    },
  });

  return {
    process_code : processCode,
    process_date : dateToInit,
    is_working   : true,
    message      : `Initialized process day for ${processCode} on ${dateToInit}`,
  };
}
// ── Resolve assignment from buddy data ────────────────────────────────────────
function resolveAssignment(stepStatus, updatedBy, buddyData) {
  const status = (stepStatus || "").toUpperCase().trim();

  if (status === "COMPLETED" || status === "EXCEPTION") {
    return {
      assigned_email  : updatedBy || null,
      assignment_type : "COMPLETED_BY",
    };
  }

  if (status === "PENDING") {
    if (!buddyData) {
      return {
        assigned_email  : "systems@geplcapital.com",
        assignment_type : "ADMIN",
      };
    }

    // Check owner presence with time logic
    const ownerPresent = isPersonPresent(
      buddyData.emp_attendance,
      buddyData.emp_leave_flag,
      buddyData.emp_shift_in_actual,
      buddyData.emp_shift_in_barrier
    );

    if (ownerPresent) {
      return {
        assigned_email  : buddyData.owner_email,
        assignment_type : "SELF",
      };
    }

    // Check buddy
    if (buddyData.buddy_attendance === 1 && buddyData.buddy_email) {
      return {
        assigned_email  : buddyData.buddy_email,
        assignment_type : "BUDDY",
      };
    }

    // Check reporting manager
    if (buddyData.reporting_attendance === 1 && buddyData.reporting_email) {
      return {
        assigned_email  : buddyData.reporting_email,
        assignment_type : "REPORTING",
      };
    }

    // Fallback
    return {
      assigned_email  : "systems@geplcapital.com",
      assignment_type : "ADMIN",
    };
  }

  return { assigned_email: null, assignment_type: null };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getLatestProcessDate(processCode) {
  const query = `
    SELECT FORMAT_DATE('%Y-%m-%d', MAX(process_date)) AS process_date
    FROM \`${projectId}.${DATASET_RUNTIME}.process_tracker\`
    WHERE process_code = @processCode
  `;

  const [rows] = await bigquery.query({
    query,
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
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
}

function buildProcessResponse(processCode, steps) {
  return {
    source          : "BIGQUERY",
    process_code    : processCode,
    process_name    : steps[0]?.process_name  || processCode,
    process_slug    : steps[0]?.process_slug  || "",
    module          : steps[0]?.module        || "",
    process_date    : steps[0]?.process_date  || null,
    total_steps     : steps.length,
    completed_steps : steps.filter(s => s.completed === "YES").length,
    steps,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  getProcessSteps,
  getProcessStep,
  initProcessDay,
  updateStepStatus,
  archiveProcessDay,
  getAuditLog,
};