// ── Fallback status list (used only if step.allowed_statuses is empty) ────────
export const ALLOWED_STATUSES = [
  "File Downloaded",
  "File Not Received Today",
  "Error from Exchange End",
  "Pending",
];

// ── Safely convert any value to lowercase searchable text ────────────────────
function toSearchText(value) {
  return String(value ?? "").toLowerCase();
}

// ── Get allowed statuses for a specific step ──────────────────────────────────
// Uses step.allowed_statuses (ARRAY from BigQuery) if available
// Falls back to ALLOWED_STATUSES for compatibility
// Does NOT prepend ui_status — current status is already in the allowed list
export function getStepAllowedStatuses(step = {}) {
  if (
    Array.isArray(step.allowed_statuses) &&
    step.allowed_statuses.length > 0
  ) {
    return step.allowed_statuses;
  }
  return ALLOWED_STATUSES;
}

// ── Row class based on completed/exception/overdue state ─────────────────────
export function getRowClass(step = {}) {
  if (step.completed === "YES")       return "row-done";
  if (step.completed === "EXCEPTION") return "row-exception";
  if (step.is_overdue)                return "row-overdue";
  return "row-active";
}

// ── Derive UI label + CSS class ───────────────────────────────────────────────
// Driven by completed field from BigQuery — no hardcoded status lists
export function getStatusLabel(uiStatus, isOverdue, completed) {
  if (!uiStatus || uiStatus === "Pending") {
    if (isOverdue) return { label: "Overdue - ready", cls: "overdue" };
    return { label: "Ready to update", cls: "ready" };
  }

  // Use completed field from BigQuery as source of truth
  if (completed === "YES")        return { label: "Completed",  cls: "done"    };
  if (completed === "EXCEPTION")  return { label: uiStatus,     cls: "overdue" };

  // Fallback for PENDING steps with a non-default ui_status
  if (isOverdue) return { label: "Overdue - ready", cls: "overdue" };
  return { label: "Ready to update", cls: "ready" };
}

// ── Compute summary stats from steps array ────────────────────────────────────
export function computeStats(steps = []) {
  const total     = steps.length;
  const completed = steps.filter((s) => s.completed === "YES").length;
  const exception = steps.filter((s) => s.completed === "EXCEPTION").length;
  const pending   = steps.filter((s) =>
    s.completed !== "YES" && s.completed !== "EXCEPTION"
  ).length;
  const overdue   = steps.filter((s) =>
    s.is_overdue === true &&
    s.completed !== "YES" &&
    s.completed !== "EXCEPTION"
  ).length;
  const progress  = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { total, completed, pending, overdue, exception, progress };
}

// ── Filter steps by search text and status dropdown ───────────────────────────
export function filterSteps(steps = [], search = "", statusFilter = "All Status") {
  const q = toSearchText(search).trim();

  return steps.filter((s) => {
    const searchableText = [
      s.process_date,
      s.step_id,
      s.step_name,
      s.system_name,
      s.path_navigation_url,
      s.how_to_execute,
      s.owner_role,
      s.assigned_email,
      s.assignment_type,
      s.ui_status,
      s.completed,
      s.exception_reason,
    ]
      .map(toSearchText)
      .join(" ");

    const matchSearch  = !q || searchableText.includes(q);
    const matchFilter  =
      statusFilter === "All Status" || s.ui_status === statusFilter;

    return matchSearch && matchFilter;
  });
}

// ── Format process name: File_Download_BOD_FMS → File Download BOD FMS ────────
export function formatProcessName(name = "") {
  return String(name || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Format date for display ───────────────────────────────────────────────────
export function formatDisplayDate() {
  return new Date().toLocaleDateString("en-IN", {
    weekday  : "short",
    day      : "2-digit",
    month    : "short",
    year     : "numeric",
    timeZone : "Asia/Kolkata",
  });
}

// ── Format last refresh time ──────────────────────────────────────────────────
export function formatRefreshTime(date) {
  if (!date) return "";
  return `Updated: ${date.toLocaleTimeString("en-IN", {
    hour     : "2-digit",
    minute   : "2-digit",
    timeZone : "Asia/Kolkata",
  })}`;
}