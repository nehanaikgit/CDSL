const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

async function request(method, path, body = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json();

  if (!res.ok) {
    const err = new Error(data.message || "API error");
    err.statusCode = res.status;
    throw err;
  }

  return data;
}

export function getProcesses() {
  return request("GET", "/api/process");
}

export function getProcessSteps(processCode) {
  return request("GET", `/api/process/${processCode}`);
}

export function getProcessStep(processCode, stepId) {
  return request("GET", `/api/process/${processCode}/steps/${stepId}`);
}

export function initProcessDay(processCode, processDate = null) {
  return request("POST", `/api/process/${processCode}/init`, {
    process_date: processDate,
  });
}

export function updateStepStatus(processCode, stepId, status, changedBy, remark = "") {
  return request("PATCH", `/api/process/${processCode}/steps/${stepId}/status`, {
    status,
    changed_by: changedBy,
    remark: remark || "",
  });
}

export function archiveProcessDay(processCode, processDate = null) {
  return request("POST", `/api/process/${processCode}/archive`, {
    process_date: processDate,
  });
}

export function getAuditLog(processCode, stepId = null) {
  const path = stepId
    ? `/api/process/${processCode}/steps/${stepId}/audit`
    : `/api/process/${processCode}/audit`;

  return request("GET", path);
}