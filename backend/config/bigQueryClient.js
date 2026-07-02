'use strict';

const { performance } = require('node:perf_hooks');
const { BigQuery } = require('@google-cloud/bigquery');

const projectId = process.env.GCP_PROJECT_ID;
const location = process.env.BQ_LOCATION || 'asia-south1';
const logTimings = String(process.env.BQ_LOG_TIMINGS || 'true').toLowerCase() === 'true';

if (!projectId) {
  throw new Error('Missing GCP_PROJECT_ID in backend/.env');
}

const bigquery = new BigQuery({ projectId });

async function runQuery({ query, params = {}, location: queryLocation, labels }) {
  const startedAt = performance.now();

  try {
    const [rows] = await bigquery.query({
      query,
      params,
      location: queryLocation || location,
      useLegacySql: false,
      useQueryCache: true,
      labels,
    });

    if (logTimings) {
      console.log(
        `[bigquery] completed in ${Math.round(performance.now() - startedAt)}ms`,
      );
    }

    return [rows];
  } catch (error) {
    console.error(
      `[bigquery] failed after ${Math.round(performance.now() - startedAt)}ms:`,
      error.message,
    );
    throw error;
  }
}

// Kept as two names so the existing service API does not need to change.
async function fastQuery(options) {
  return runQuery(options);
}

async function directQuery(options) {
  return runQuery(options);
}

module.exports = {
  bigquery,
  fastQuery,
  directQuery,
  projectId,
  location,
};
