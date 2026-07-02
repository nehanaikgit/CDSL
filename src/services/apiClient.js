const BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001",
).replace(/\/$/, "");

const READ_TIMEOUT_MS = Number.parseInt(
  import.meta.env.VITE_API_TIMEOUT_MS || "15000",
  10,
);

const WRITE_TIMEOUT_MS = Number.parseInt(
  import.meta.env.VITE_API_WRITE_TIMEOUT_MS || "90000",
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
  } catch {
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
      const error = new Error(
        data?.message ||
        data?.error?.message ||
        `API error ${response.status}`,
      );
      error.statusCode = response.status;
      error.responseData = data;
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      const isWriteRequest = method !== "GET";
      const timeoutError = new Error(
        isWriteRequest
          ? "The update is still processing. The dashboard will check the result automatically."
          : `Request timed out after ${Math.round(timeoutMs / 1000)} seconds`,
      );
      timeoutError.statusCode = 408;
      timeoutError.isTimeout = true;
      throw timeoutError;
    }

    if (error instanceof TypeError) {
      const networkError = new Error(
        `Cannot reach backend at ${BASE_URL}. Confirm the backend is running on port 5001.`,
      );
      networkError.statusCode = 503;
      throw networkError;
    }

    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function request(method, path, body = null, options = {}) {
  const timeoutMs =
    options.timeoutMs ??
    (method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);

  const dedupe = options.dedupe ?? true;
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
export function getStepLocks(processCode, options = {}) {
  return request(
    "GET",
    `/api/process/${segment(processCode)}/locks`,
    null,
    options,
  );
}
export function getStatusUpdateJob(jobId, options = {}) {
  return request(
    "GET",
    `/api/process/status-updates/${segment(jobId)}`,
    null,
    {
      ...options,
      dedupe: false,
    },
  );
}

export function initProcessDay(processCode, processDate = null, options = {}) {
  return request(
    "POST",
    `/api/process/${segment(processCode)}/init`,
    {
      process_date: processDate,
    },
    options,
  );
}

export function updateStepStatus(
  processCode,
  stepId,
  status,
  changedBy,
  remark = "",
  options = {},
) {
  return request(
    "PATCH",
    `/api/process/${segment(processCode)}/steps/${segment(stepId)}/status`,
    {
      status,
      changed_by: changedBy,
      remark: remark || "",
    },
    {
      timeoutMs: options.timeoutMs ?? 30000,
      ...options,
      dedupe: false,
    },
  );
}

export function archiveProcessDay(
  processCode,
  processDate = null,
  options = {},
) {
  return request(
    "POST",
    `/api/process/${segment(processCode)}/archive`,
    {
      process_date: processDate,
    },
    options,
  );
}

export function getAuditLog(
  processCode,
  stepId = null,
  options = {},
) {
  const path = stepId
    ? `/api/process/${segment(processCode)}/steps/${segment(stepId)}/audit`
    : `/api/process/${segment(processCode)}/audit`;

  return request("GET", path, null, options);
}
