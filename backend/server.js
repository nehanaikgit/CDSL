'use strict';

const path = require('node:path');
const { performance } = require('node:perf_hooks');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(__dirname, '.env'),
  override: false,
});

const express = require('express');
const cors = require('cors');

const processRoutes = require('./routes/processRoutes');
const schedulerRoutes = require('./routes/schedulerRoutes');  // ← add

const processService = require('./services/processService');
const cacheService = require('./services/cacheService');
const { closeRedis } = require('./config/redis');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '5001', 10);

function getTimestampIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}+05:30`;
}

const configuredOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(cors({
  origin: configuredOrigins.length > 0 ? configuredOrigins : true,
}));
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const startedAt = performance.now();

  res.on('finish', () => {
    const durationMs = Math.round(performance.now() - startedAt);
    console.log(
      `[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`,
    );
  });

  next();
});

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'CDSL backend is running',
    timestamp_ist: getTimestampIST(),
  });
});

function statusHandler(_req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    service: 'CDSL Backend',
    timestamp_ist: getTimestampIST(),
    cache: cacheService.getCacheInfo(),
  });
}

// /status is retained as a compatibility endpoint for any stale frontend build.
app.get('/status', statusHandler);
app.get('/health', statusHandler);

app.use('/api/process', processRoutes);
app.use('/scheduler', schedulerRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`CDSL backend running on http://localhost:${PORT}`);

  const processCodes = String(process.env.CACHE_WARM_PROCESS_CODES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (processCodes.length > 0) {
    setImmediate(async () => {
      const concurrency = Math.max(
        1,
        Math.min(
          Number.parseInt(process.env.CACHE_WARM_CONCURRENCY || '2', 10) || 2,
          5,
        ),
      );

      let nextIndex = 0;

      async function warmWorker() {
        while (nextIndex < processCodes.length) {
          const index = nextIndex;
          nextIndex += 1;
          const processCode = processCodes[index];

          try {
            const [result] = await Promise.all([
              processService.getProcessSteps(processCode),
              processService.getStepLocks(processCode),
            ]);

            console.log(
              `[warmup] ${processCode} ready from ${result.source || 'unknown'}`,
            );
          } catch (error) {
            console.warn(`[warmup] ${processCode} failed:`, error.message);
          }
        }
      }

      await Promise.all(
        Array.from({ length: concurrency }, () => warmWorker()),
      );
    });
  }
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[shutdown] received ${signal}`);

  server.close(async () => {
    await closeRedis();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

module.exports = { app, server };
