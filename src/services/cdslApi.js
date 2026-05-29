const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const result = await response.json();

  if (!response.ok || result.success === false) {
    throw new Error(result.message || "API request failed");
  }

  return result;
}

export async function getFileDownloadBodFms() {
  return apiRequest("/api/cdsl/file-download-bod-fms", {
    method: "GET",
  });
}

export async function updateFileDownloadBodFmsStatus({
  stepId,
  status,
  userEmail,
}) {
  return apiRequest(`/api/cdsl/file-download-bod-fms/${stepId}/status`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      user_email: userEmail,
    }),
  });
}