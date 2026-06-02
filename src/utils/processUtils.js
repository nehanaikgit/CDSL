// ── Status options shown in dropdown ─────────────────────────────────────────
export const ALLOWED_STATUSES = [
  "File Downloaded",
  "File Not Received Today",
  "Error from Exchange End",
  "Pending",
];

// ── Derive UI label + CSS class — is_overdue flag comes from BigQuery ─────────
export function getStatusLabel(uiStatus, isOverdue) {
  if (uiStatus === "File Downloaded")
    return { label: "Completed", cls: "done" };
  if (uiStatus === "File Not Received Today")
    return { label: "File Not Received", cls: "overdue" };
  if (uiStatus === "Error from Exchange End")
    return { label: "Error from Exchange", cls: "overdue" };
  if (isOverdue)
    return { label: "Overdue - ready", cls: "overdue" };
  return { label: "Ready to update", cls: "ready" };
}

// ── Is this step overdue? ─────────────────────────────────────────────────────
export function isOverdueRow(step) {
  if (step.ui_status !== "Pending") return false;
  if (!step.planned_time) return false;
  const [h, m] = step.planned_time.split(":").map(Number);
  const planned = new Date();
  planned.setHours(h, m, 0, 0);
  return new Date() > planned;
}

// ── Format process name: File_Download_BOD_FMS → File Download BOD FMS ───────
export function formatProcessName(name = "") {
  return name.replace(/_/g, " ");
}


// ── Compute summary stats from steps array ────────────────────────────────────
export function computeStats(steps = []) {
  const total     = steps.length;
  const completed = steps.filter(s => s.ui_status === "File Downloaded").length;
  const pending   = steps.filter(s => s.ui_status === "Pending").length;
  const overdue   = steps.filter(s => s.is_overdue === true).length;
  const progress  = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, pending, overdue, progress };
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
      s.owner_role?.toLowerCase().includes(q);
    const matchFilter =
      statusFilter === "All Status" || s.ui_status === statusFilter;
    return matchSearch && matchFilter;
  });
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