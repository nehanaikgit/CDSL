'use strict';

const crypto = require('node:crypto');
const {
  bigquery,
  directQuery,
  fastQuery,
  projectId,
  location,
} = require('../config/bigQueryClient');
const { syncBuddyMaster } = require('../services/buddySyncService');
const cacheService = require('../services/cacheService');

const DATASET_CONFIG = process.env.BQ_DATASET_CONFIG || 'CDSL_CONFIG';
const DATASET_RUNTIME = process.env.BQ_DATASET_RUNTIME || 'CDSL_RUNTIME';

function getTodayIST() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
}

function getYesterdayIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  const date = new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
  ));

  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function safeSecretMatch(expected, provided) {
  const expectedBuffer = Buffer.from(String(expected || ''));
  const providedBuffer = Buffer.from(String(provided || ''));

  if (
    expectedBuffer.length === 0 ||
    expectedBuffer.length !== providedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function validateSecret(req, res) {
  const expectedSecret = process.env.SCHEDULER_SECRET;
  const providedSecret = req.headers['x-scheduler-secret'];

  if (!expectedSecret) {
    console.error('[scheduler] SCHEDULER_SECRET is not configured');
    res.status(503).json({
      success: false,
      message: 'Scheduler endpoint is not configured',
    });
    return false;
  }

  if (!safeSecretMatch(expectedSecret, providedSecret)) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized — invalid scheduler secret',
    });
    return false;
  }

  return true;
}

// POST /scheduler/sync-buddy — 7:00 AM IST
async function syncBuddy(req, res, next) {
  if (!validateSecret(req, res)) return;

  try {
    console.log('[scheduler] sync-buddy triggered');
    const result = await syncBuddyMaster();

    res.status(200).json({
      success: true,
      job: 'sync-buddy',
      result,
    });
  } catch (error) {
    next(error);
  }
}

// POST /scheduler/init-all — 8:00 AM IST
async function initAll(req, res, next) {
  if (!validateSecret(req, res)) return;

  try {
    const processDate = getTodayIST();

    console.log(`[scheduler] init-all triggered for ${processDate}`);

    await fastQuery({
      query: `
        CALL \`${projectId}.${DATASET_RUNTIME}.sp_init_all_processes\`(
          @processDate
        )
      `,
      params: {
        processDate: bigquery.date(processDate),
      },
      location,
    });

    const [processes] = await directQuery({
      query: `
        SELECT process_code
        FROM \`${projectId}.${DATASET_CONFIG}.process_master\`
        WHERE is_active = TRUE
        ORDER BY process_code
      `,
      location,
    });

    await Promise.all(
      processes.map((process) =>
        cacheService.bustProcess(process.process_code, processDate),
      ),
    );

    console.log(
      `[scheduler] init-all complete — ${processes.length} processes initialized`,
    );

    res.status(200).json({
      success: true,
      job: 'init-all',
      process_date: processDate,
      processes_inited: processes.length,
      processes: processes.map((process) => process.process_code),
    });
  } catch (error) {
    next(error);
  }
}

// POST /scheduler/archive-all — 6:00 PM IST
async function archiveAll(req, res, next) {
  if (!validateSecret(req, res)) return;

  try {
    const processDate = getYesterdayIST();

    console.log(`[scheduler] archive-all triggered for ${processDate}`);

    await fastQuery({
      query: `
        CALL \`${projectId}.${DATASET_RUNTIME}.sp_archive_all_processes\`(
          @processDate
        )
      `,
      params: {
        processDate: bigquery.date(processDate),
      },
      location,
    });

    await cacheService.bustAllStepCaches();

    console.log(`[scheduler] archive-all complete for ${processDate}`);

    res.status(200).json({
      success: true,
      job: 'archive-all',
      process_date: processDate,
      message: `All processes archived for ${processDate}`,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  syncBuddy,
  initAll,
  archiveAll,
};
