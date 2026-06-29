const BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001",
).replace(/\/$/, "");

const DEFAULT_TIMEOUT_MS = Number.parseInt(
  import.meta.env.VITE_API_TIMEOUT_MS || "12000",
  10,
);

const pendingGetRequests = new Map();

async function parseResponse(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return { message: text };
  }
}

async function executeRequest(method, path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  const options = {
    method,
    headers: {
      Accept: "application/json",
    },
    signal: controller.signal,
    cache: "no-store",
  };

  if (body !== null && body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${BASE_URL}${path}`, options);
    const data = await parseResponse(response);

    if (!response.ok) {
      const error = new Error(data?.message || `API error ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(
        `Request timed out after ${Math.round(timeoutMs / 1000)} seconds`,
      );
      timeoutError.statusCode = 408;
      throw timeoutError;
    }

    if (error instanceof TypeError) {
      throw new Error(
        `Cannot reach backend at ${BASE_URL}. Confirm the backend is running on port 5001.`,
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function request(
  method,
  path,
  body = null,
  { timeoutMs = DEFAULT_TIMEOUT_MS, dedupe = true } = {},
) {
  const requestKey = `${method}:${path}`;

  if (method === "GET" && dedupe && pendingGetRequests.has(requestKey)) {
    return pendingGetRequests.get(requestKey);
  }

  const promise = executeRequest(method, path, body, timeoutMs);

  if (method === "GET" && dedupe) {
    pendingGetRequests.set(requestKey, promise);
    void promise.then(
      () => pendingGetRequests.delete(requestKey),
      () => pendingGetRequests.delete(requestKey),
    );
  }

  return promise;
}

function segment(value) {
  return encodeURIComponent(String(value || "").trim());
}

export function getProcesses(options = {}) {
  return request("GET", "/api/process", null, options);
}

export function getProcessSteps(processCode, options = {}) {
  return request(
    "GET",
    `/api/process/${segment(processCode)}`,
    null,
    options,
  );
}

export function getProcessStep(processCode, stepId, options = {}) {
  return request(
    "GET",
    `/api/process/${segment(processCode)}/steps/${segment(stepId)}`,
    null,
    options,
  );
}

export function initProcessDay(processCode, processDate = null) {
  return request("POST", `/api/process/${segment(processCode)}/init`, {
    process_date: processDate,
  });
}

export function updateStepStatus(
  processCode,
  stepId,
  status,
  changedBy,
  remark = "",
) {
  return request(
    "PATCH",
    `/api/process/${segment(processCode)}/steps/${segment(stepId)}/status`,
    {
      status,
      changed_by: changedBy,
      remark: remark || "",
    },
  );
}

export function archiveProcessDay(processCode, processDate = null) {
  return request("POST", `/api/process/${segment(processCode)}/archive`, {
    process_date: processDate,
  });
}

export function getAuditLog(processCode, stepId = null, options = {}) {
  const path = stepId
    ? `/api/process/${segment(processCode)}/steps/${segment(stepId)}/audit`
    : `/api/process/${segment(processCode)}/audit`;

  return request("GET", path, null, options);
}
