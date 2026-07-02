'use strict';

const os = require('node:os');
const { randomUUID } = require('node:crypto');
const {
  redis,
  isRedisReady,
  getRedisStatus,
} = require('../config/redis');
const processService = require('./processService');

const ENV = process.env.NODE_ENV || 'development';
const CACHE_VERSION = process.env.CACHE_VERSION || 'v1';
const ENABLED = String(process.env.STATUS_QUEUE_ENABLED || 'true')
  .trim()
  .toLowerCase() !== 'false';

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const JOB_TTL_SECONDS = positiveInteger(
  process.env.STATUS_QUEUE_JOB_TTL_SECONDS,
  86400,
);
const LOCK_TTL_SECONDS = positiveInteger(
  process.env.STATUS_QUEUE_LOCK_TTL_SECONDS,
  600,
);
const MAX_ATTEMPTS = positiveInteger(
  process.env.STATUS_QUEUE_MAX_ATTEMPTS,
  3,
);
const CLAIM_IDLE_MS = positiveInteger(
  process.env.STATUS_QUEUE_CLAIM_IDLE_MS,
  120000,
);
const BLOCK_MS = positiveInteger(
  process.env.STATUS_QUEUE_BLOCK_MS,
  2000,
);

const PREFIX = `cdsl:${CACHE_VERSION}:${ENV}:status-updates`;
const STREAM_KEY = `${PREFIX}:stream`;
const GROUP_NAME = `${PREFIX}:workers`;
const CONSUMER_NAME = [
  os.hostname().replace(/[^a-zA-Z0-9_-]/g, '-'),
  process.pid,
  randomUUID().slice(0, 8),
].join('-');

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED']);

let workerRedis = null;
let workerStarted = false;
let stopping = false;
let workerLoopPromise = null;
let lastClaimAt = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getTodayIST() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
}

function normalizeProcessCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeStepId(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeStatus(value) {
  return String(value || '').trim();
}

function jobKey(jobId) {
  return `${PREFIX}:job:${jobId}`;
}

function stepLockKey(processCode, processDate, stepId) {
  return `${PREFIX}:lock:${processDate}:${processCode}:${stepId}`;
}

function parseJson(value, context) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn(`[status-queue] invalid JSON for ${context}:`, error.message);
    return null;
  }
}

function fieldsToObject(fields) {
  const result = {};

  for (let index = 0; index < fields.length; index += 2) {
    result[fields[index]] = fields[index + 1];
  }

  return result;
}

function buildPublicJob(job) {
  if (!job) return null;

  return {
    job_id: job.job_id,
    status: job.status,
    process_code: job.process_code,
    process_date: job.process_date,
    step_id: job.step_id,
    requested_status: job.requested_status,
    changed_by: job.changed_by,
    attempts: job.attempts || 0,
    created_at: job.created_at,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
    updated_at: job.updated_at,
    result: job.result || null,
    error: job.error || null,
  };
}

async function persistJob(client, job) {
  job.updated_at = new Date().toISOString();
  await client.set(
    jobKey(job.job_id),
    JSON.stringify(job),
    'EX',
    JOB_TTL_SECONDS,
  );
}

async function releaseStepLock(client, job) {
  const script = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
  `;

  await client.eval(
    script,
    1,
    stepLockKey(job.process_code, job.process_date, job.step_id),
    job.job_id,
  );
}

async function refreshStepLock(client, job) {
  const script = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('EXPIRE', KEYS[1], ARGV[2])
    end
    return 0
  `;

  await client.eval(
    script,
    1,
    stepLockKey(job.process_code, job.process_date, job.step_id),
    job.job_id,
    String(LOCK_TTL_SECONDS),
  );
}

async function ensureConsumerGroup(client) {
  try {
    await client.xgroup(
      'CREATE',
      STREAM_KEY,
      GROUP_NAME,
      '0',
      'MKSTREAM',
    );
  } catch (error) {
    if (!String(error.message || '').includes('BUSYGROUP')) {
      throw error;
    }
  }
}

async function enqueueStatusUpdate({
  processCode,
  processDate = getTodayIST(),
  stepId,
  status,
  changedBy,
  remark = '',
}) {
  if (!ENABLED || !isRedisReady()) {
    const error = new Error('Status update queue is unavailable');
    error.statusCode = 503;
    error.queueUnavailable = true;
    throw error;
  }

  const normalizedProcessCode = normalizeProcessCode(processCode);
  const normalizedStepId = normalizeStepId(stepId);
  const normalizedStatus = normalizeStatus(status);
  const normalizedChangedBy = normalizeEmail(changedBy);
  const normalizedRemark = String(remark || '').trim();

  if (!normalizedProcessCode) {
    const error = new Error('processCode is required');
    error.statusCode = 400;
    throw error;
  }

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

  const now = new Date().toISOString();
  const jobId = randomUUID();
  const job = {
    job_id: jobId,
    status: 'QUEUED',
    process_code: normalizedProcessCode,
    process_date: processDate,
    step_id: normalizedStepId,
    requested_status: normalizedStatus,
    changed_by: normalizedChangedBy,
    remark: normalizedRemark,
    attempts: 0,
    created_at: now,
    updated_at: now,
  };

  const lockKey = stepLockKey(
    normalizedProcessCode,
    processDate,
    normalizedStepId,
  );

  const script = `
    local existing_job_id = redis.call('GET', KEYS[1])
    if existing_job_id then
      return {0, existing_job_id}
    end

    redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
    redis.call('XADD', KEYS[3], '*', 'job_id', ARGV[1])

    return {1, ARGV[1]}
  `;

  const result = await redis.eval(
    script,
    3,
    lockKey,
    jobKey(jobId),
    STREAM_KEY,
    jobId,
    JSON.stringify(job),
    String(JOB_TTL_SECONDS),
    String(LOCK_TTL_SECONDS),
  );

  const created = Number(result?.[0] || 0) === 1;
  const acceptedJobId = String(result?.[1] || jobId);

  if (created) {
    return {
      duplicate: false,
      job: buildPublicJob(job),
    };
  }

  const existing = await getStatusUpdateJob(acceptedJobId);
  if (existing) {
    return {
      duplicate: true,
      job: existing,
    };
  }

  // A stale lock without a job should not block the user indefinitely.
  await redis.del(lockKey);
  return enqueueStatusUpdate({
    processCode: normalizedProcessCode,
    processDate,
    stepId: normalizedStepId,
    status: normalizedStatus,
    changedBy: normalizedChangedBy,
    remark: normalizedRemark,
  });
}

async function getStatusUpdateJob(jobId) {
  if (!isRedisReady()) return null;

  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedJobId) return null;

  const job = parseJson(
    await redis.get(jobKey(normalizedJobId)),
    normalizedJobId,
  );

  return buildPublicJob(job);
}

async function acknowledgeMessage(client, messageId) {
  const pipeline = client.pipeline();
  pipeline.xack(STREAM_KEY, GROUP_NAME, messageId);
  pipeline.xdel(STREAM_KEY, messageId);
  await pipeline.exec();
}

async function processMessage(client, messageId, fields) {
  const values = fieldsToObject(fields);
  const jobId = String(values.job_id || '').trim();

  if (!jobId) {
    await acknowledgeMessage(client, messageId);
    return;
  }

  const job = parseJson(
    await client.get(jobKey(jobId)),
    jobId,
  );

  if (!job) {
    await acknowledgeMessage(client, messageId);
    return;
  }

  if (TERMINAL_STATUSES.has(job.status)) {
    await acknowledgeMessage(client, messageId);
    await releaseStepLock(client, job);
    return;
  }

  job.status = 'RUNNING';
  job.attempts = Number(job.attempts || 0) + 1;
  job.started_at = job.started_at || new Date().toISOString();
  job.worker = CONSUMER_NAME;
  job.stream_message_id = messageId;
  delete job.error;

  await persistJob(client, job);
  await refreshStepLock(client, job);

  const startedAt = Date.now();

  try {
    const result = await processService.updateStepStatus(
      job.process_code,
      job.step_id,
      job.requested_status,
      job.changed_by,
      job.remark,
      job.process_date,
    );

    job.status = 'COMPLETED';
    job.result = result;
    job.finished_at = new Date().toISOString();
    job.processing_time_ms = Date.now() - startedAt;

    await persistJob(client, job);
    await acknowledgeMessage(client, messageId);
    await releaseStepLock(client, job);

    console.log(
      `[status-queue] completed job=${job.job_id} ` +
      `${job.process_code}/${job.step_id} ` +
      `attempt=${job.attempts} duration=${job.processing_time_ms}ms`,
    );
  } catch (error) {
    const errorPayload = {
      message: error.message || 'Status update failed',
      status_code: error.statusCode || 500,
      at: new Date().toISOString(),
    };

    if (job.attempts < MAX_ATTEMPTS && !stopping) {
      const retryDelayMs = Math.min(
        1000 * (2 ** (job.attempts - 1)),
        5000,
      );

      job.status = 'RETRYING';
      job.error = errorPayload;
      job.next_retry_at = new Date(
        Date.now() + retryDelayMs,
      ).toISOString();

      await persistJob(client, job);
      await refreshStepLock(client, job);
      await sleep(retryDelayMs);

      if (stopping) {
        return;
      }

      job.status = 'QUEUED';
      await persistJob(client, job);
      await client.xadd(STREAM_KEY, '*', 'job_id', job.job_id);
      await acknowledgeMessage(client, messageId);

      console.warn(
        `[status-queue] retrying job=${job.job_id} ` +
        `attempt=${job.attempts}/${MAX_ATTEMPTS}: ${errorPayload.message}`,
      );
      return;
    }

    job.status = 'FAILED';
    job.error = errorPayload;
    job.finished_at = new Date().toISOString();
    job.processing_time_ms = Date.now() - startedAt;

    await persistJob(client, job);
    await acknowledgeMessage(client, messageId);
    await releaseStepLock(client, job);

    console.error(
      `[status-queue] failed job=${job.job_id} ` +
      `${job.process_code}/${job.step_id}: ${errorPayload.message}`,
    );
  }
}

async function claimAbandonedMessages(client) {
  const now = Date.now();
  if (now - lastClaimAt < 30000) return [];
  lastClaimAt = now;

  try {
    const response = await client.xautoclaim(
      STREAM_KEY,
      GROUP_NAME,
      CONSUMER_NAME,
      CLAIM_IDLE_MS,
      '0-0',
      'COUNT',
      10,
    );

    return Array.isArray(response?.[1]) ? response[1] : [];
  } catch (error) {
    if (!String(error.message || '').includes('unknown command')) {
      console.warn('[status-queue] XAUTOCLAIM failed:', error.message);
    }
    return [];
  }
}

async function readNewMessages(client) {
  const response = await client.xreadgroup(
    'GROUP',
    GROUP_NAME,
    CONSUMER_NAME,
    'COUNT',
    1,
    'BLOCK',
    BLOCK_MS,
    'STREAMS',
    STREAM_KEY,
    '>',
  );

  if (!Array.isArray(response) || response.length === 0) {
    return [];
  }

  return response.flatMap((stream) => stream?.[1] || []);
}

async function workerLoop() {
  while (!stopping) {
    try {
      if (!workerRedis || workerRedis.status !== 'ready') {
        await sleep(1000);
        continue;
      }

      await ensureConsumerGroup(workerRedis);

      const claimed = await claimAbandonedMessages(workerRedis);
      if (claimed.length > 0) {
        for (const [messageId, fields] of claimed) {
          if (stopping) break;
          await processMessage(workerRedis, messageId, fields);
        }
        continue;
      }

      const messages = await readNewMessages(workerRedis);
      for (const [messageId, fields] of messages) {
        if (stopping) break;
        await processMessage(workerRedis, messageId, fields);
      }
    } catch (error) {
      if (!stopping) {
        console.warn('[status-queue] worker loop error:', error.message);
        await sleep(1000);
      }
    }
  }
}

function startStatusQueueWorker() {
  if (!ENABLED || workerStarted) return;

  stopping = false;
  workerStarted = true;
  workerRedis = redis.duplicate({
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
  });

  workerRedis.on('ready', () => {
    console.log(`[status-queue] worker ready consumer=${CONSUMER_NAME}`);
  });

  workerRedis.on('error', (error) => {
    if (!stopping) {
      console.warn('[status-queue] worker Redis error:', error.message);
    }
  });

  workerLoopPromise = workerLoop();
}

async function stopStatusQueueWorker() {
  if (!workerStarted) return;

  stopping = true;

  if (workerLoopPromise) {
    await Promise.race([
      workerLoopPromise,
      sleep(BLOCK_MS + 1000),
    ]);
  }

  if (workerRedis) {
    try {
      await workerRedis.quit();
    } catch {
      workerRedis.disconnect(false);
    }
  }

  workerRedis = null;
  workerLoopPromise = null;
  workerStarted = false;
}

async function submitStatusUpdate(payload) {
  if (ENABLED && isRedisReady()) {
    try {
      const queued = await enqueueStatusUpdate(payload);

      return {
        mode: 'ASYNC',
        accepted: true,
        duplicate: queued.duplicate,
        ...queued.job,
        message: queued.duplicate
          ? `Update for ${queued.job.step_id} is already processing`
          : `Update for ${queued.job.step_id} was queued`,
      };
    } catch (error) {
      if (!error.queueUnavailable && error.statusCode && error.statusCode < 500) {
        throw error;
      }

      console.warn(
        '[status-queue] enqueue failed; using synchronous fallback:',
        error.message,
      );
    }
  }

  const result = await processService.updateStepStatus(
    payload.processCode,
    payload.stepId,
    payload.status,
    payload.changedBy,
    payload.remark,
    payload.processDate || getTodayIST(),
  );

  return {
    mode: 'SYNC_FALLBACK',
    accepted: true,
    status: 'COMPLETED',
    result,
    message: result.message,
  };
}

function getStatusQueueInfo() {
  return {
    enabled: ENABLED,
    redis_status: getRedisStatus(),
    worker_started: workerStarted,
    consumer: workerStarted ? CONSUMER_NAME : null,
    max_attempts: MAX_ATTEMPTS,
  };
}

module.exports = {
  enqueueStatusUpdate,
  getStatusUpdateJob,
  submitStatusUpdate,
  startStatusQueueWorker,
  stopStatusQueueWorker,
  getStatusQueueInfo,
};
