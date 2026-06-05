const { BigQuery } = require("@google-cloud/bigquery");

const projectId = process.env.GCP_PROJECT_ID;
const location  = process.env.BQ_LOCATION || "asia-south1";

if (!projectId) {
  throw new Error("Missing GCP_PROJECT_ID in .env");
}

const bigquery = new BigQuery({ projectId });

// ── fastQuery — for heavy queries (view joins, large scans) ───────────────────
// Creates a BQ job and polls every 300ms — much faster than default 1-2s polling
async function fastQuery({ query, params, location: loc }) {
  const [job] = await bigquery.createQueryJob({
    query,
    location : loc || location,
    params   : params || {},
  });

  while (true) {
    const [metadata] = await job.getMetadata();
    const status = metadata.status;

    if (status.errorResult) {
      throw new Error(status.errorResult.message);
    }

    if (status.state === "DONE") {
      const [rows] = await job.getQueryResults({ autoPaginate: true });
      return [rows];
    }

    await new Promise((r) => setTimeout(r, 300));
  }
}

// ── directQuery — for small/fast queries (lookups, validates, counts) ─────────
// Uses bigquery.query() directly — no job creation overhead, faster for tiny queries
async function directQuery({ query, params, location: loc }) {
  const [rows] = await bigquery.query({
    query,
    location : loc || location,
    params   : params || {},
  });
  return [rows];
}

module.exports = { bigquery, fastQuery, directQuery, projectId, location };