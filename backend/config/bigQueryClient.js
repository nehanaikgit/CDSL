const { BigQuery } = require("@google-cloud/bigquery");

const projectId = process.env.GCP_PROJECT_ID;
const location  = process.env.BQ_LOCATION || "US";

if (!projectId) {
  throw new Error("Missing GCP_PROJECT_ID in .env");
}

const bigquery = new BigQuery({ projectId });

module.exports = { bigquery, projectId, location };