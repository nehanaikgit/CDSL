'use strict';

const { BigQuery } = require('@google-cloud/bigquery');
const cacheService = require('./cacheService');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'gepl-operations';
const DATASET_CONFIG = process.env.BQ_DATASET_CONFIG || 'CDSL_CONFIG';
const DEST_LOCATION = process.env.BQ_LOCATION || 'asia-south1';
const DEST_TABLE = process.env.BUDDY_DESTINATION_TABLE || 'buddy_master';

const SRC_PROJECT = process.env.BUDDY_SOURCE_PROJECT_ID || 'universal-table-store';
const SRC_DATASET = process.env.BUDDY_SOURCE_DATASET || 'BuddySystem';
const SRC_TABLE = process.env.BUDDY_SOURCE_TABLE || 'BuddyMasterAutoPopulate';
const SRC_LOCATION = process.env.BUDDY_SOURCE_LOCATION || 'US';

const TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Kolkata';

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveRatio(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1
    ? parsed
    : fallback;
}

const MIN_ROWS = positiveInteger(process.env.BUDDY_SYNC_MIN_ROWS, 150);
const MIN_CURRENT_BARRIER_ROWS = positiveInteger(
  process.env.BUDDY_SYNC_MIN_CURRENT_BARRIER_ROWS,
  150,
);
const MIN_FINAL_EMAIL_COVERAGE = positiveRatio(
  process.env.BUDDY_SYNC_MIN_FINAL_EMAIL_COVERAGE,
  0.95,
);

// Separate clients make the two-region boundary explicit. Both jobs are billed
// to the GEPL project, while source data stays in US and destination data stays
// in asia-south1. No cross-region join is performed.
const sourceBigQuery = new BigQuery({ projectId: PROJECT_ID });
const destinationBigQuery = new BigQuery({ projectId: PROJECT_ID });

function asIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const raw = typeof value === 'object' && value.value
    ? value.value
    : value;

  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeText(value, { upper = false, lower = false } = {}) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return null;
  }

  if (upper) return normalized.toUpperCase();
  if (lower) return normalized.toLowerCase();
  return normalized;
}

function serializeSourceRow(row) {
  return {
    owner_email: normalizeText(row.owner_email, { lower: true }),
    emp_attendance: asInteger(row.emp_attendance),
    emp_leave_flag: normalizeText(row.emp_leave_flag, { upper: true }),
    buddy_email: normalizeText(row.buddy_email, { lower: true }),
    buddy_attendance: asInteger(row.buddy_attendance),
    reporting_email: normalizeText(row.reporting_email, { lower: true }),
    reporting_attendance: asInteger(row.reporting_attendance),
    final_email: normalizeText(row.final_email, { lower: true }),
    department: normalizeText(row.department),
    emp_shift_in_actual: asIsoTimestamp(row.emp_shift_in_actual),
    emp_shift_in_barrier: asIsoTimestamp(row.emp_shift_in_barrier),
    buddy_leave_flag: normalizeText(row.buddy_leave_flag, { upper: true }),
    reporting_leave_flag: normalizeText(
      row.reporting_leave_flag,
      { upper: true },
    ),
    source_updated_at: asIsoTimestamp(row.source_updated_at),
  };
}

function classifyFinalEmail(row) {
  if (!row.final_email) return 'MISSING';
  if (row.final_email === row.owner_email) return 'SELF';
  if (row.final_email === row.buddy_email) return 'BUDDY';
  if (row.final_email === row.reporting_email) return 'REPORTING';
  return 'OTHER';
}

function validateRows(rows) {
  const distinctOwners = new Set(
    rows.map((row) => row.owner_email).filter(Boolean),
  );

  const currentBarrierRows = rows.filter(
    (row) => row.emp_shift_in_barrier,
  ).length;

  const finalEmailRows = rows.filter((row) => row.final_email).length;
  const finalEmailCoverage = rows.length > 0
    ? finalEmailRows / rows.length
    : 0;

  const finalTypeCounts = rows.reduce((counts, row) => {
    const type = classifyFinalEmail(row);
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});

  if (rows.length < MIN_ROWS) {
    throw new Error(
      `Buddy sync blocked: source returned ${rows.length} rows; ` +
      `minimum required is ${MIN_ROWS}.`,
    );
  }

  if (distinctOwners.size !== rows.length) {
    throw new Error(
      `Buddy sync blocked: expected unique owners but found ` +
      `${rows.length - distinctOwners.size} duplicate row(s).`,
    );
  }

  if (currentBarrierRows < MIN_CURRENT_BARRIER_ROWS) {
    throw new Error(
      `Buddy sync blocked: only ${currentBarrierRows} rows have a current ` +
      `shift barrier; minimum required is ${MIN_CURRENT_BARRIER_ROWS}.`,
    );
  }

  if (finalEmailCoverage < MIN_FINAL_EMAIL_COVERAGE) {
    throw new Error(
      `Buddy sync blocked: FinalEmail coverage is ` +
      `${(finalEmailCoverage * 100).toFixed(2)}%; minimum required is ` +
      `${(MIN_FINAL_EMAIL_COVERAGE * 100).toFixed(2)}%.`,
    );
  }

  return {
    total_rows: rows.length,
    distinct_owners: distinctOwners.size,
    current_barrier_rows: currentBarrierRows,
    final_email_rows: finalEmailRows,
    final_email_coverage: Number(finalEmailCoverage.toFixed(4)),
    final_type_counts: finalTypeCounts,
  };
}

async function readSourceRows() {
  const [rows] = await sourceBigQuery.query({
    query: `
      SELECT
        LOWER(TRIM(OffEmailLower))                              AS owner_email,
        SAFE_CAST(EmpAttendance AS INT64)                       AS emp_attendance,
        UPPER(TRIM(IFNULL(EmpLeaveFlag, 'N')))                  AS emp_leave_flag,
        NULLIF(LOWER(TRIM(BuddyOffEmailLower)), '')             AS buddy_email,
        SAFE_CAST(BuddyAttendance AS INT64)                     AS buddy_attendance,
        NULLIF(LOWER(TRIM(ReportingOffEmailLower)), '')         AS reporting_email,
        SAFE_CAST(ReportingAttendance AS INT64)                 AS reporting_attendance,
        NULLIF(LOWER(TRIM(FinalEmail)), '')                     AS final_email,
        NULLIF(TRIM(Department), '')                            AS department,
        TIMESTAMP(ShiftInActual, @timeZone)                     AS emp_shift_in_actual,
        TIMESTAMP(ShiftInBarrier, @timeZone)                    AS emp_shift_in_barrier,
        CAST(NULL AS STRING)                                    AS buddy_leave_flag,
        CAST(NULL AS STRING)                                    AS reporting_leave_flag,
        CURRENT_TIMESTAMP()                                     AS source_updated_at
      FROM \`${SRC_PROJECT}.${SRC_DATASET}.${SRC_TABLE}\`
      WHERE EmpActiveFlag = TRUE
        AND NULLIF(TRIM(OffEmailLower), '') IS NOT NULL
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LOWER(TRIM(OffEmailLower))
        ORDER BY ShiftInBarrier DESC NULLS LAST
      ) = 1
      ORDER BY owner_email
    `,
    params: { timeZone: TIME_ZONE },
    location: SRC_LOCATION,
    useLegacySql: false,
  });

  return rows.map(serializeSourceRow);
}

async function replaceDestinationRows(rows) {
  const payload = JSON.stringify(rows);

  await destinationBigQuery.query({
    query: `
      DECLARE v_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP();

      CREATE TEMP TABLE incoming_buddy_rows AS
      SELECT
        JSON_VALUE(item, '$.owner_email') AS owner_email,
        SAFE_CAST(JSON_VALUE(item, '$.emp_attendance') AS INT64)
          AS emp_attendance,
        JSON_VALUE(item, '$.emp_leave_flag') AS emp_leave_flag,
        JSON_VALUE(item, '$.buddy_email') AS buddy_email,
        SAFE_CAST(JSON_VALUE(item, '$.buddy_attendance') AS INT64)
          AS buddy_attendance,
        JSON_VALUE(item, '$.reporting_email') AS reporting_email,
        SAFE_CAST(JSON_VALUE(item, '$.reporting_attendance') AS INT64)
          AS reporting_attendance,
        JSON_VALUE(item, '$.final_email') AS final_email,
        JSON_VALUE(item, '$.department') AS department,
        SAFE_CAST(JSON_VALUE(item, '$.emp_shift_in_actual') AS TIMESTAMP)
          AS emp_shift_in_actual,
        SAFE_CAST(JSON_VALUE(item, '$.emp_shift_in_barrier') AS TIMESTAMP)
          AS emp_shift_in_barrier,
        JSON_VALUE(item, '$.buddy_leave_flag') AS buddy_leave_flag,
        JSON_VALUE(item, '$.reporting_leave_flag')
          AS reporting_leave_flag,
        SAFE_CAST(JSON_VALUE(item, '$.source_updated_at') AS TIMESTAMP)
          AS source_updated_at
      FROM UNNEST(JSON_QUERY_ARRAY(@payload)) AS item;

      ASSERT (
        SELECT COUNT(*)
        FROM incoming_buddy_rows
      ) >= @minimumRows
      AS 'Buddy sync payload did not meet the minimum row count';

      ASSERT (
        SELECT COUNT(*) = COUNT(DISTINCT owner_email)
        FROM incoming_buddy_rows
      )
      AS 'Buddy sync payload contains duplicate owner_email values';

      BEGIN TRANSACTION;

      DELETE FROM \`${PROJECT_ID}.${DATASET_CONFIG}.${DEST_TABLE}\`
      WHERE TRUE;

      INSERT INTO \`${PROJECT_ID}.${DATASET_CONFIG}.${DEST_TABLE}\`
      (
        owner_email,
        emp_attendance,
        emp_leave_flag,
        buddy_email,
        buddy_attendance,
        reporting_email,
        reporting_attendance,
        final_email,
        department,
        emp_shift_in_actual,
        emp_shift_in_barrier,
        buddy_leave_flag,
        reporting_leave_flag,
        source_updated_at,
        synced_at
      )
      SELECT
        owner_email,
        emp_attendance,
        emp_leave_flag,
        buddy_email,
        buddy_attendance,
        reporting_email,
        reporting_attendance,
        final_email,
        department,
        emp_shift_in_actual,
        emp_shift_in_barrier,
        buddy_leave_flag,
        reporting_leave_flag,
        source_updated_at,
        v_synced_at
      FROM incoming_buddy_rows;

      COMMIT TRANSACTION;
    `,
    params: {
      payload,
      minimumRows: MIN_ROWS,
    },
    location: DEST_LOCATION,
    useLegacySql: false,
  });
}

async function verifyDestinationRows() {
  const [rows] = await destinationBigQuery.query({
    query: `
      SELECT
        COUNT(*) AS total_rows,
        COUNT(DISTINCT owner_email) AS distinct_owners,
        COUNTIF(final_email IS NOT NULL) AS final_email_rows,
        COUNTIF(emp_shift_in_barrier IS NOT NULL) AS current_barrier_rows,
        MAX(synced_at) AS latest_synced_at
      FROM \`${PROJECT_ID}.${DATASET_CONFIG}.${DEST_TABLE}\`
    `,
    location: DEST_LOCATION,
    useLegacySql: false,
  });

  const row = rows[0] || {};
  return {
    total_rows: Number(row.total_rows || 0),
    distinct_owners: Number(row.distinct_owners || 0),
    final_email_rows: Number(row.final_email_rows || 0),
    current_barrier_rows: Number(row.current_barrier_rows || 0),
    latest_synced_at: asIsoTimestamp(row.latest_synced_at),
  };
}

async function syncBuddyMaster() {
  const startedAt = Date.now();

  console.log(
    `[buddy-sync] reading ${SRC_PROJECT}.${SRC_DATASET}.${SRC_TABLE} ` +
    `in ${SRC_LOCATION}`,
  );

  const sourceRows = await readSourceRows();
  const sourceValidation = validateRows(sourceRows);

  console.log(
    `[buddy-sync] source validation passed: ` +
    `${sourceValidation.total_rows} rows, ` +
    `${(sourceValidation.final_email_coverage * 100).toFixed(2)}% ` +
    `FinalEmail coverage`,
  );

  await replaceDestinationRows(sourceRows);

  const destination = await verifyDestinationRows();

  if (
    destination.total_rows !== sourceValidation.total_rows ||
    destination.distinct_owners !== sourceValidation.distinct_owners
  ) {
    throw new Error(
      `Buddy sync verification failed: source=${sourceValidation.total_rows}, ` +
      `destination=${destination.total_rows}.`,
    );
  }

  const [buddyKeysCleared, stepKeysCleared] = await Promise.all([
    cacheService.bustBuddyCache(),
    cacheService.bustAllStepCaches(),
  ]);

  const durationMs = Date.now() - startedAt;

  console.log(
    `[buddy-sync] committed ${destination.total_rows} rows in ${durationMs}ms`,
  );

  return {
    success: true,
    rows_synced: destination.total_rows,
    distinct_owners: destination.distinct_owners,
    duration_ms: durationMs,
    source_validation: sourceValidation,
    destination,
    cache: {
      buddy_keys_cleared: buddyKeysCleared,
      step_keys_cleared: stepKeysCleared,
    },
  };
}

module.exports = {
  syncBuddyMaster,
};
