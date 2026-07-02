'use strict';

const {
  redis,
  isRedisReady,
  getRedisStatus,
} = require('../config/redis');

const ENV = process.env.NODE_ENV || 'development';
const CACHE_VERSION = process.env.CACHE_VERSION || 'v1';

/**
 * Returns a valid positive integer or the supplied fallback value.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
}

const TTL = Object.freeze({
  STEPS_FRESH: positiveInteger(
    process.env.CACHE_TTL_STEPS,
    300,
  ),

  STEPS_STALE: positiveInteger(
    process.env.CACHE_TTL_STEPS_STALE,
    43200,
  ),

  CONFIG: positiveInteger(
    process.env.CACHE_TTL_CONFIG,
    3600,
  ),

  BUDDY: positiveInteger(
    process.env.CACHE_TTL_BUDDY,
    60,
  ),

  LOCKS: positiveInteger(
    process.env.CACHE_TTL_LOCKS,
    300,
  ),

  LOCKS_EMPTY: positiveInteger(
    process.env.CACHE_TTL_LOCKS_EMPTY,
    3600,
  ),
});

// ── Key builders ──────────────────────────────────────────────────────────────

/**
 * Creates an environment-safe and version-safe Redis key.
 *
 * Example:
 * cdsl:v1:development:CDSL01:steps:2026-07-02:fresh
 *
 * @param {...unknown} parts
 * @returns {string}
 */
function key(...parts) {
  return [
    'cdsl',
    CACHE_VERSION,
    ENV,
    ...parts,
  ].join(':');
}

/**
 * @param {string} processCode
 * @param {string} date
 * @returns {string}
 */
function stepsFreshKey(processCode, date) {
  return key(
    processCode,
    'steps',
    date,
    'fresh',
  );
}

/**
 * @param {string} processCode
 * @param {string} date
 * @returns {string}
 */
function stepsStaleKey(processCode, date) {
  return key(
    processCode,
    'steps',
    date,
    'stale',
  );
}

/**
 * @param {string} processCode
 * @param {string} date
 * @returns {string}
 */
function locksKey(processCode, date) {
  return key(
    processCode,
    'locks',
    date,
  );
}

/**
 * Converts an email into a Redis-key-safe value.
 *
 * @param {unknown} email
 * @returns {string}
 */
function safeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

/**
 * Safely parses a JSON value returned by Redis.
 *
 * @param {string|null|undefined} value
 * @param {string} cacheKey
 * @returns {*|null}
 */
function parseJson(value, cacheKey) {
  if (value === null || value === undefined) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn(
      `[cache] invalid JSON for ${cacheKey}:`,
      error.message,
    );

    return null;
  }
}

// ── Base Redis operations ─────────────────────────────────────────────────────

/**
 * Reads and parses a JSON value from Redis.
 *
 * @param {string} cacheKey
 * @returns {Promise<*|null>}
 */
async function get(cacheKey) {
  if (!isRedisReady()) {
    return null;
  }

  try {
    const value = await redis.get(cacheKey);

    return parseJson(value, cacheKey);
  } catch (error) {
    console.warn(
      `[cache] GET failed for ${cacheKey}:`,
      error.message,
    );

    return null;
  }
}

/**
 * Saves a JSON value in Redis with expiration.
 *
 * @param {string} cacheKey
 * @param {*} data
 * @param {number} ttlSeconds
 * @returns {Promise<boolean>}
 */
async function set(cacheKey, data, ttlSeconds) {
  if (!isRedisReady()) {
    return false;
  }

  try {
    const payload = JSON.stringify(data);

    if (payload === undefined) {
      console.warn(
        `[cache] SET skipped for ${cacheKey}: data cannot be serialized`,
      );

      return false;
    }

    await redis.set(
      cacheKey,
      payload,
      'EX',
      ttlSeconds,
    );

    return true;
  } catch (error) {
    console.warn(
      `[cache] SET failed for ${cacheKey}:`,
      error.message,
    );

    return false;
  }
}

/**
 * Deletes one or more Redis keys.
 *
 * @param {...string} cacheKeys
 * @returns {Promise<boolean>}
 */
async function del(...cacheKeys) {
  if (!isRedisReady() || cacheKeys.length === 0) {
    return false;
  }

  try {
    await redis.del(...cacheKeys);

    return true;
  } catch (error) {
    console.warn(
      '[cache] DEL failed:',
      error.message,
    );

    return false;
  }
}

/**
 * Deletes Redis keys using SCAN instead of the blocking KEYS command.
 *
 * UNLINK is used where available so Redis can free memory asynchronously.
 * DEL is used as a fallback.
 *
 * @param {string} pattern
 * @returns {Promise<number>}
 */
async function deleteByPattern(pattern) {
  if (!isRedisReady()) {
    return 0;
  }

  let cursor = '0';
  let deleted = 0;

  try {
    do {
      const result = await redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        500,
      );

      const nextCursor = String(result[0]);
      const keys = Array.isArray(result[1])
        ? result[1]
        : [];

      cursor = nextCursor;

      if (keys.length > 0) {
        if (typeof redis.unlink === 'function') {
          await redis.unlink(...keys);
        } else {
          await redis.del(...keys);
        }

        deleted += keys.length;
      }
    } while (cursor !== '0');

    return deleted;
  } catch (error) {
    console.warn(
      `[cache] pattern delete failed for ${pattern}:`,
      error.message,
    );

    return 0;
  }
}

// ── Steps cache: fresh + stale ────────────────────────────────────────────────

/**
 * Reads process steps using a fresh-cache/stale-cache strategy.
 *
 * Possible results:
 * { state: 'fresh', data: ... }
 * { state: 'stale', data: ... }
 * { state: 'miss',  data: null }
 *
 * @param {string} processCode
 * @param {string} date
 * @returns {Promise<{state: string, data: *}>}
 */
async function getSteps(processCode, date) {
  if (!isRedisReady()) {
    return {
      state: 'miss',
      data: null,
    };
  }

  const freshKey = stepsFreshKey(processCode, date);
  const staleKey = stepsStaleKey(processCode, date);

  try {
    const [
      freshValue,
      staleValue,
    ] = await redis.mget(
      freshKey,
      staleKey,
    );

    const fresh = parseJson(
      freshValue,
      freshKey,
    );

    if (fresh !== null) {
      return {
        state: 'fresh',
        data: fresh,
      };
    }

    const stale = parseJson(
      staleValue,
      staleKey,
    );

    if (stale !== null) {
      return {
        state: 'stale',
        data: stale,
      };
    }

    return {
      state: 'miss',
      data: null,
    };
  } catch (error) {
    console.warn(
      '[cache] steps MGET failed:',
      error.message,
    );

    return {
      state: 'miss',
      data: null,
    };
  }
}

/**
 * Saves process steps in both fresh and stale caches.
 *
 * @param {string} processCode
 * @param {string} date
 * @param {*} data
 * @returns {Promise<boolean>}
 */
async function setSteps(processCode, date, data) {
  if (!isRedisReady()) {
    return false;
  }

  try {
    const payload = JSON.stringify(data);

    if (payload === undefined) {
      console.warn(
        '[cache] steps SET skipped: data cannot be serialized',
      );

      return false;
    }

    const pipeline = redis.pipeline();

    pipeline.set(
      stepsFreshKey(processCode, date),
      payload,
      'EX',
      TTL.STEPS_FRESH,
    );

    pipeline.set(
      stepsStaleKey(processCode, date),
      payload,
      'EX',
      TTL.STEPS_STALE,
    );

    const results = await pipeline.exec();

    if (!Array.isArray(results)) {
      console.warn(
        '[cache] steps pipeline returned an invalid response',
      );

      return false;
    }

    const failedCommand = results.find(
      (entry) => Array.isArray(entry) && entry[0],
    );

    if (failedCommand) {
      const pipelineError = failedCommand[0];

      console.warn(
        '[cache] steps pipeline failed:',
        pipelineError?.message || String(pipelineError),
      );

      return false;
    }

    return true;
  } catch (error) {
    console.warn(
      '[cache] steps SET failed:',
      error.message,
    );

    return false;
  }
}

/**
 * Removes both fresh and stale step caches.
 *
 * @param {string} processCode
 * @param {string} date
 * @returns {Promise<boolean>}
 */
async function bustSteps(processCode, date) {
  return del(
    stepsFreshKey(processCode, date),
    stepsStaleKey(processCode, date),
  );
}

/**
 * Removes only the short-lived fresh cache and deliberately preserves the
 * stale snapshot. Use this after a normal user status update so the next
 * request can return immediately while BigQuery refreshes in the background.
 *
 * @param {string} processCode
 * @param {string} date
 * @returns {Promise<boolean>}
 */
async function bustStepsFresh(processCode, date) {
  return del(
    stepsFreshKey(processCode, date),
  );
}

// ── Lock cache ────────────────────────────────────────────────────────────────

/**
 * @param {string} processCode
 * @param {string} date
 * @returns {Promise<*|null>}
 */
async function getLocks(processCode, date) {
  return get(
    locksKey(processCode, date),
  );
}

/**
 * @param {string} processCode
 * @param {string} date
 * @param {*} data
 * @returns {Promise<boolean>}
 */
async function setLocks(processCode, date, data, ttlSeconds) {
  const isEmptyObject = Boolean(
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Object.keys(data).length === 0,
  );

  const resolvedTtl = positiveInteger(
    ttlSeconds,
    isEmptyObject ? TTL.LOCKS_EMPTY : TTL.LOCKS,
  );

  return set(
    locksKey(processCode, date),
    data,
    resolvedTtl,
  );
}

/**
 * @param {string} processCode
 * @param {string} date
 * @returns {Promise<boolean>}
 */
async function bustLocks(processCode, date) {
  return del(
    locksKey(processCode, date),
  );
}

// ── Process list cache ────────────────────────────────────────────────────────

/**
 * @returns {Promise<*|null>}
 */
async function getProcessList() {
  return get(
    key('processes', 'all'),
  );
}

/**
 * @param {*} data
 * @returns {Promise<boolean>}
 */
async function setProcessList(data) {
  return set(
    key('processes', 'all'),
    data,
    TTL.CONFIG,
  );
}

// ── Buddy cache ───────────────────────────────────────────────────────────────

/**
 * @param {string} ownerEmail
 * @param {string} date
 * @returns {Promise<*|null>}
 */
async function getBuddy(ownerEmail, date) {
  return get(
    key(
      'buddy',
      safeEmail(ownerEmail),
      date,
    ),
  );
}

/**
 * @param {string} ownerEmail
 * @param {string} date
 * @param {*} data
 * @returns {Promise<boolean>}
 */
async function setBuddy(ownerEmail, date, data) {
  return set(
    key(
      'buddy',
      safeEmail(ownerEmail),
      date,
    ),
    data,
    TTL.BUDDY,
  );
}

/**
 * Deletes all buddy cache entries for the current environment and version.
 *
 * @returns {Promise<number>}
 */
async function bustBuddyCache() {
  return deleteByPattern(
    key('buddy', '*'),
  );
}

// ── Convenience helpers ───────────────────────────────────────────────────────

/**
 * Invalidates a process's fresh and stale step cache.
 *
 * Lock cache is deliberately not deleted here. Use bustLocks separately
 * when the process lock cache must also be invalidated.
 *
 * @param {string} processCode
 * @param {string} date
 * @returns {Promise<boolean>}
 */
async function bustProcess(processCode, date) {
  return bustSteps(
    processCode,
    date,
  );
}

/**
 * Deletes all step caches for the current version and environment.
 *
 * Pattern:
 * cdsl:<version>:<environment>:*:steps:*
 *
 * @returns {Promise<number>}
 */
async function bustAllStepCaches() {
  return deleteByPattern(
    key('*', 'steps', '*'),
  );
}

/**
 * Returns cache configuration and current Redis status.
 *
 * @returns {{
 *   redis_status: *,
 *   cache_version: string,
 *   environment: string,
 *   ttl: object
 * }}
 */
function getCacheInfo() {
  return {
    redis_status: getRedisStatus(),
    cache_version: CACHE_VERSION,
    environment: ENV,
    ttl: TTL,
  };
}

module.exports = {
  TTL,

  // Steps cache
  getSteps,
  setSteps,
  bustSteps,
  bustStepsFresh,

  // Lock cache
  getLocks,
  setLocks,
  bustLocks,

  // Process-list cache
  getProcessList,
  setProcessList,

  // Buddy cache
  getBuddy,
  setBuddy,
  bustBuddyCache,

  // Convenience helpers
  bustProcess,
  bustAllStepCaches,
  getCacheInfo,
};