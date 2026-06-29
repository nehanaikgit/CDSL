'use strict';

const {
  redis,
  isRedisReady,
  getRedisStatus,
} = require('../config/redis');

const ENV = process.env.NODE_ENV || 'development';
const CACHE_VERSION = process.env.CACHE_VERSION || 'v1';

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const TTL = Object.freeze({
  STEPS_FRESH: positiveInteger(process.env.CACHE_TTL_STEPS, 240),
  STEPS_STALE: positiveInteger(process.env.CACHE_TTL_STEPS_STALE, 3600),
  CONFIG: positiveInteger(process.env.CACHE_TTL_CONFIG, 3600),
  BUDDY: positiveInteger(process.env.CACHE_TTL_BUDDY, 600),
});

function key(...parts) {
  return ['cdsl', CACHE_VERSION, ENV, ...parts].join(':');
}

function safeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
}

function parseJson(value, cacheKey) {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn(`[cache] invalid JSON for ${cacheKey}:`, error.message);
    return null;
  }
}

async function get(cacheKey) {
  if (!isRedisReady()) {
    return null;
  }

  try {
    return parseJson(await redis.get(cacheKey), cacheKey);
  } catch (error) {
    console.warn('[cache] GET failed:', error.message);
    return null;
  }
}

async function set(cacheKey, data, ttlSeconds) {
  if (!isRedisReady()) {
    return false;
  }

  try {
    await redis.set(cacheKey, JSON.stringify(data), 'EX', ttlSeconds);
    return true;
  } catch (error) {
    console.warn('[cache] SET failed:', error.message);
    return false;
  }
}

async function del(...cacheKeys) {
  if (!isRedisReady() || cacheKeys.length === 0) {
    return false;
  }

  try {
    await redis.del(...cacheKeys);
    return true;
  } catch (error) {
    console.warn('[cache] DEL failed:', error.message);
    return false;
  }
}

function stepsFreshKey(processCode, date) {
  return key(processCode, 'steps', date, 'fresh');
}

function stepsStaleKey(processCode, date) {
  return key(processCode, 'steps', date, 'stale');
}

async function getSteps(processCode, date) {
  if (!isRedisReady()) {
    return { state: 'miss', data: null };
  }

  const freshKey = stepsFreshKey(processCode, date);
  const staleKey = stepsStaleKey(processCode, date);

  try {
    const [freshValue, staleValue] = await redis.mget(freshKey, staleKey);
    const fresh = parseJson(freshValue, freshKey);

    if (fresh !== null) {
      return { state: 'fresh', data: fresh };
    }

    const stale = parseJson(staleValue, staleKey);
    if (stale !== null) {
      return { state: 'stale', data: stale };
    }

    return { state: 'miss', data: null };
  } catch (error) {
    console.warn('[cache] MGET failed:', error.message);
    return { state: 'miss', data: null };
  }
}

async function setSteps(processCode, date, data) {
  if (!isRedisReady()) {
    return false;
  }

  try {
    const payload = JSON.stringify(data);
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

    await pipeline.exec();
    return true;
  } catch (error) {
    console.warn('[cache] steps SET failed:', error.message);
    return false;
  }
}

async function bustSteps(processCode, date) {
  return del(
    stepsFreshKey(processCode, date),
    stepsStaleKey(processCode, date),
  );
}

async function getProcessList() {
  return get(key('processes', 'all'));
}

async function setProcessList(data) {
  return set(key('processes', 'all'), data, TTL.CONFIG);
}

async function getBuddy(ownerEmail, date) {
  return get(key('buddy', safeEmail(ownerEmail), date));
}

async function setBuddy(ownerEmail, date, data) {
  return set(
    key('buddy', safeEmail(ownerEmail), date),
    data,
    TTL.BUDDY,
  );
}

async function bustProcess(processCode, date) {
  return bustSteps(processCode, date);
}

function getCacheInfo() {
  return {
    redis_status: getRedisStatus(),
    cache_version: CACHE_VERSION,
    ttl: TTL,
  };
}

module.exports = {
  TTL,
  getSteps,
  setSteps,
  bustSteps,
  getProcessList,
  setProcessList,
  getBuddy,
  setBuddy,
  bustProcess,
  getCacheInfo,
};
