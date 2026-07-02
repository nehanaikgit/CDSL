'use strict';

const path = require('node:path');
const dotenv = require('dotenv');
const Redis = require('ioredis');

dotenv.config({
  path: path.resolve(__dirname, '..', '.env'),
  override: false,
});

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: positiveInteger(process.env.REDIS_PORT, 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  connectTimeout: positiveInteger(process.env.REDIS_CONNECT_TIMEOUT_MS, 1500),
  enableOfflineQueue: false,
  enableReadyCheck: true,
  maxRetriesPerRequest: 1,
  lazyConnect: false,
  retryStrategy(attempt) {
    return Math.min(attempt * 250, 2000);
  },
});

let lastErrorLogAt = 0;

redis.on('connect', () => console.log('[redis] connected'));
redis.on('ready', () => console.log('[redis] ready'));
redis.on('reconnecting', () => console.warn('[redis] reconnecting'));
redis.on('error', (error) => {
  const now = Date.now();
  if (now - lastErrorLogAt >= 5000) {
    console.warn('[redis] unavailable; continuing without cache:', error.message);
    lastErrorLogAt = now;
  }
});

function isRedisReady() {
  return redis.status === 'ready';
}

function getRedisStatus() {
  return redis.status;
}

async function closeRedis() {
  if (redis.status === 'end') {
    return;
  }

  try {
    await redis.quit();
  // eslint-disable-next-line no-unused-vars
  } catch (_error) {
    redis.disconnect(false);
  }
}

module.exports = {
  redis,
  isRedisReady,
  getRedisStatus,
  closeRedis,
};
