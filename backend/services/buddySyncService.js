'use strict';

const { BigQuery } = require('@google-cloud/bigquery');
const cacheService = require('./cacheService');

// ── Config from env ───────────────────────────────────────────────────────────
const PROJECT_ID     = process.env.GCP_PROJECT_ID          || 'gepl-operations';
const DATASET_CONFIG = process.env.BQ_DATASET_CONFIG       || 'CDSL_CONFIG';
const DEST_LOCATION  = process.env.BQ_LOCATION             || 'asia-south1';
const SRC_PROJECT    = process.env.BUDDY_SOURCE_PROJECT_ID || 'universal-table-store';
const SRC_DATASET    = process.env.BUDDY_SOURCE_DATASET    || 'BuddySystem';
const SRC_TABLE      = process.env.BUDDY_SOURCE_TABLE      || 'BuddyMasterAutoPopulate';
const SRC_LOCATION   = process.env.BUDDY_SOURCE_LOCATION   || 'US';
const DEST_TABLE     = process.env.BUDDY_DESTINATION_TABLE || 'buddy_master';
const TIME_ZONE      = process.env.APP_TIME_ZONE           || 'Asia/Kolkata';

// Single BQ client — reads from universal-table-store using US location
// Writes to gepl-operations using asia-south1 location
// Same client works for both because jobs are billed to gepl-operations
const bq = new BigQuery({ projectId: PROJECT_ID });

// ── Main sync function ────────────────────────────────────────────────────────
async function syncBuddyMaster() {
  const startedAt = Date.now();
  console.log(`[buddy-sync] Starting sync from ${SRC_PROJECT}.${SRC_DATASET}.${SRC_TABLE}`);

  // Step 1 — Read from universal-table-store (US region)
  console.log('[buddy-sync] Reading source rows...');
  const [rows] = await bq.query({
    query: `
      SELECT
        LOWER(TRIM(OffEmailLower))                        AS owner_email,
        EmpAttendance                                     AS emp_attendance,
        UPPER(TRIM(IFNULL(EmpLeaveFlag, 'N')))            AS emp_leave_flag,
        LOWER(TRIM(BuddyOffEmailLower))                   AS buddy_email,
        BuddyAttendance                                   AS buddy_attendance,
        LOWER(TRIM(ReportingOffEmailLower))               AS reporting_email,
        ReportingAttendance                               AS reporting_attendance,
        LOWER(TRIM(FinalEmail))                           AS final_email,
        TRIM(Department)                                  AS department,
        TIMESTAMP(ShiftInActual,  @timeZone)              AS emp_shift_in_actual,
        TIMESTAMP(ShiftInBarrier, @timeZone)              AS emp_shift_in_barrier,
        CAST(NULL AS STRING)                              AS buddy_leave_flag,
        CAST(NULL AS STRING)                              AS reporting_leave_flag
      FROM \`${SRC_PROJECT}.${SRC_DATASET}.${SRC_TABLE}\`
      WHERE EmpActiveFlag = TRUE
        AND NULLIF(TRIM(OffEmailLower), '') IS NOT NULL
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LOWER(TRIM(OffEmailLower))
        ORDER BY ShiftInBarrier DESC NULLS LAST
      ) = 1
      ORDER BY owner_email
    `,
    params   : { timeZone: TIME_ZONE },
    location : SRC_LOCATION,
    useLegacySql: false,
  });

  console.log(`[buddy-sync] ${rows.length} rows fetched`);

  if (rows.length === 0) {
    return { success: false, message: 'No rows returned from source', rows_synced: 0 };
  }

  // Step 2 — Clear existing buddy_master in asia-south1
  console.log('[buddy-sync] Clearing buddy_master...');
  await bq.query({
    query       : `DELETE FROM \`${PROJECT_ID}.${DATASET_CONFIG}.${DEST_TABLE}\` WHERE TRUE`,
    location    : DEST_LOCATION,
    useLegacySql: false,
  });

  // Step 3 — Insert via streaming in batches of 500
  console.log('[buddy-sync] Inserting rows...');
  const table    = bq.dataset(DATASET_CONFIG).table(DEST_TABLE);
  const toInsert = rows.map(r => ({
    owner_email          : r.owner_email          || null,
    emp_attendance       : r.emp_attendance !== null ? Number(r.emp_attendance) : null,
    emp_leave_flag       : r.emp_leave_flag        || null,
    buddy_email          : r.buddy_email           || null,
    buddy_attendance     : r.buddy_attendance !== null ? Number(r.buddy_attendance) : null,
    reporting_email      : r.reporting_email       || null,
    reporting_attendance : r.reporting_attendance !== null ? Number(r.reporting_attendance) : null,
    final_email          : r.final_email           || null,
    department           : r.department            || null,
    emp_shift_in_actual  : r.emp_shift_in_actual   || null,
    emp_shift_in_barrier : r.emp_shift_in_barrier  || null,
    buddy_leave_flag     : null,
    reporting_leave_flag : null,
    synced_at            : new Date().toISOString(),
  }));

  const batchSize = 500;
  let batchCount  = 0;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    await table.insert(toInsert.slice(i, i + batchSize));
    batchCount++;
    console.log(`[buddy-sync] Batch ${batchCount} — ${Math.min(batchSize, toInsert.length - i)} rows inserted`);
  }

  // Step 4 — Bust buddy cache in Redis
  console.log('[buddy-sync] Busting buddy cache...');
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
  if (typeof cacheService.setBuddy === 'function') {
    for (const row of toInsert) {
      if (row.owner_email) {
        await cacheService.setBuddy(row.owner_email, todayIST, null);
      }
    }
  }

  // Step 5 — Verify
  const [verifyRows] = await bq.query({
    query: `
      SELECT
        department,
        COUNT(*)                          AS total,
        COUNTIF(emp_attendance = 1)       AS present,
        COUNTIF(emp_attendance = 0)       AS absent
      FROM \`${PROJECT_ID}.${DATASET_CONFIG}.${DEST_TABLE}\`
      GROUP BY department
      ORDER BY department
    `,
    location    : DEST_LOCATION,
    useLegacySql: false,
  });

  const duration = Date.now() - startedAt;
  console.log(`[buddy-sync] Done — ${toInsert.length} rows synced in ${duration}ms`);
  console.table(verifyRows);

  return {
    success      : true,
    rows_synced  : toInsert.length,
    distinct_owners: toInsert.length,
    batches      : batchCount,
    duration_ms  : duration,
    breakdown    : verifyRows,
    synced_at    : new Date().toISOString(),
  };
}

module.exports = { syncBuddyMaster };