// ── Fallback status list (used only if step.allowed_statuses is empty) ────────
export const ALLOWED_STATUSES = [
  "File Downloaded",
  "File Not Received Today",
  "Error from Exchange End",
  "Pending",
];

// ── Get allowed statuses for a specific step ──────────────────────────────────
// Uses step.allowed_statuses (ARRAY from BigQuery) if available
// Falls back to ALLOWED_STATUSES for compatibility
export function getStepAllowedStatuses(step) {
  if (
    step.allowed_statuses &&
    Array.isArray(step.allowed_statuses) &&
    step.allowed_statuses.length > 0
  ) {
    return step.allowed_statuses;
  }
  return ALLOWED_STATUSES;
}

// ── Row class based on completed/exception/overdue state ─────────────────────
export function getRowClass(step) {
  if (step.completed === "YES")        return "row-done";
  if (step.completed === "EXCEPTION")  return "row-exception";
  if (step.is_overdue)                 return "row-overdue";
  return "row-active";
}

// ── Derive UI label + CSS class ───────────────────────────────────────────────
export function getStatusLabel(uiStatus, isOverdue) {
  if (!uiStatus || uiStatus === "Pending") {
    if (isOverdue) return { label: "Overdue - ready", cls: "overdue" };
    return { label: "Ready to update", cls: "ready" };
  }
  const completedStatuses = [
    "File Downloaded", "File Available", "File Imported Successfully",
    "Report Generated", "Remarks Updated", "No Shortage",
    "Payin File Generated", "File Uploaded", "Upload Successfully",
    "Process Checked", "Completed", "Verified", "Reconciled",
    "SMS/Email Sent", "File Generated", "Error Resolved", "YES",
  ];
  if (completedStatuses.includes(uiStatus)) {
    return { label: "Completed", cls: "done" };
  }
  return { label: uiStatus, cls: "overdue" };
}

// ── Compute summary stats from steps array ────────────────────────────────────
export function computeStats(steps = []) {
  const total     = steps.length;
  const completed = steps.filter(s => s.completed === "YES").length;
  const exception = steps.filter(s => s.completed === "EXCEPTION").length;
  const pending   = steps.filter(s =>
    s.completed !== "YES" && s.completed !== "EXCEPTION"
  ).length;
  const overdue   = steps.filter(s => s.is_overdue === true).length;
  const progress  = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, pending, overdue, exception, progress };
}

// ── Filter steps by search text and status dropdown ───────────────────────────
export function filterSteps(steps = [], search = "", statusFilter = "All Status") {
  const q = search.toLowerCase();
  return steps.filter((s) => {
    const matchSearch =
      !search ||
      s.step_name?.toLowerCase().includes(q) ||
      s.step_id?.toLowerCase().includes(q) ||
      s.how_to_execute?.toLowerCase().includes(q) ||
      s.owner_role?.toLowerCase().includes(q) ||
      s.assigned_email?.toLowerCase().includes(q);
    const matchFilter =
      statusFilter === "All Status" || s.ui_status === statusFilter;
    return matchSearch && matchFilter;
  });
}

// ── Format process name: File_Download_BOD_FMS → File Download BOD FMS ────────
export function formatProcessName(name = "") {
  return name.replace(/_/g, " ");
}

// ── Format date for display ───────────────────────────────────────────────────
export function formatDisplayDate() {
  return new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ── Format last refresh time ──────────────────────────────────────────────────
export function formatRefreshTime(date) {
  if (!date) return "";
  return `Updated: ${date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}