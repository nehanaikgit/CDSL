const fileDownloadBodFmsMock = require("../mock/fileDownloadBodFms.mock");

const USE_MOCK_DATA = process.env.USE_MOCK_DATA === "true";

function getCurrentIstTimestamp() {
  const now = new Date();

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(now);
}

async function getFileDownloadBodFms() {
  if (USE_MOCK_DATA) {
    return {
      source: "MOCK",
      process_name: "File Download BOD FMS",
      module: "SETTLEMENT",
      process_code: "ST_BOD_FMS",
      total_steps: fileDownloadBodFmsMock.length,
      steps: fileDownloadBodFmsMock,
    };
  }

  throw new Error(
    "BigQuery mode is currently disabled. Set USE_MOCK_DATA=true for mock testing or configure Google ADC for BigQuery."
  );
}

async function updateFileDownloadBodFmsStatus(stepId, payload) {
  if (!USE_MOCK_DATA) {
    throw new Error(
      "BigQuery mode is currently disabled. Set USE_MOCK_DATA=true for mock testing or configure Google ADC for BigQuery."
    );
  }

  const { status, user_email } = payload;

  if (!status) {
    const error = new Error("status is required");
    error.statusCode = 400;
    throw error;
  }

  const stepIndex = fileDownloadBodFmsMock.findIndex(
    (step) => step.step_id === stepId
  );

  if (stepIndex === -1) {
    const error = new Error(`Step not found: ${stepId}`);
    error.statusCode = 404;
    throw error;
  }

  const updatedStep = {
    ...fileDownloadBodFmsMock[stepIndex],
    status,
    actual_time: getCurrentIstTimestamp(),
    updated_by: user_email || null,
    updated_at: getCurrentIstTimestamp(),
    remarks: `Status updated to ${status}`,
  };

  fileDownloadBodFmsMock[stepIndex] = updatedStep;

  return {
    source: "MOCK",
    message: "Step status updated successfully",
    data: updatedStep,
  };
}

module.exports = {
  getFileDownloadBodFms,
  updateFileDownloadBodFmsStatus,
};