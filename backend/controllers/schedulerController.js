'use strict';

const { bigquery, projectId, location } = require('../config/bigQueryClient');
const { syncBuddyMaster }               = require('../services/buddySyncService');
const cacheService                      = require('../services/cacheService');

// ── Secret validation ─────────────────────────────────────────────────────────
function validateSecret(req, res) {
  const secret = process.env.SCHEDULER_SECRET;

  if (!secret) {
    console.warn('[scheduler] SCHEDULER_SECRET not set — endpoint unprotected');
    return true;
  }

  const provided = req.headers['x-scheduler-secret'];

  if (!provided || provided !== secret) {
    res.status(401).json({
      success : false,
      message : 'Unauthorized — invalid scheduler secret',
    });
    return false;
  }

  return true;
}

// ── POST /scheduler/sync-buddy ────────────────────────────────────────────────
// Reads from universal-table-store (US) and writes to buddy_master (asia-south1)
// Called by Cloud Scheduler at 7:00 AM IST every trading day
async function syncBuddy(req, res, next) {
  if (!validateSecret(req, res)) return;

  try {
    console.log('[scheduler] sync-buddy triggered');
    const result = await syncBuddyMaster();

    res.status(200).json({
      success  : true,
      job      : 'sync-buddy',
      result,
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /scheduler/init-all ──────────────────────────────────────────────────
// Initializes all active processes for today
// Called by Cloud Scheduler at 8:00 AM IST every trading day
async function initAll(req, res, next) {
  if (!validateSecret(req, res)) return;

  try {
    const todayIST = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kolkata',
    });

    console.log(`[scheduler] init-all triggered for ${todayIST}`);

    const [rows] = await bigquery.query({
      query: `
        CALL \`${projectId}.CDSL_RUNTIME.sp_init_all_processes\`(
          @processDate
        )
      `,
      params   : { processDate: bigquery.date(todayIST) },
      location,
      useLegacySql: false,
    });

    // Bust all process step caches so warmup fetches fresh data
    const [processes] = await bigquery.query({
      query: `
        SELECT process_code
        FROM \`${projectId}.CDSL_CONFIG.process_master\`
        WHERE is_active = TRUE
      `,
      location,
      useLegacySql: false,
    });

    for (const p of processes) {
      await cacheService.bustProcess(p.process_code, todayIST);
    }

    console.log(`[scheduler] init-all complete — ${processes.length} processes initialized`);

    res.status(200).json({
      success          : true,
      job              : 'init-all',
      process_date     : todayIST,
      processes_inited : processes.length,
      processes        : processes.map(p => p.process_code),
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /scheduler/archive-all ───────────────────────────────────────────────
// Archives all processes for yesterday
// Called by Cloud Scheduler at 6:00 PM IST every trading day
async function archiveAll(req, res, next) {
  if (!validateSecret(req, res)) return;

  try {
    const now       = new Date();
    const yesterday = new Date(
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    );
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayIST = yesterday.toISOString().slice(0, 10);

    console.log(`[scheduler] archive-all triggered for ${yesterdayIST}`);

    await bigquery.query({
      query: `
        CALL \`${projectId}.CDSL_RUNTIME.sp_archive_all_processes\`(
          @processDate
        )
      `,
      params   : { processDate: bigquery.date(yesterdayIST) },
      location,
      useLegacySql: false,
    });

    console.log(`[scheduler] archive-all complete for ${yesterdayIST}`);

    res.status(200).json({
      success      : true,
      job          : 'archive-all',
      process_date : yesterdayIST,
      message      : `All processes archived for ${yesterdayIST}`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { syncBuddy, initAll, archiveAll };