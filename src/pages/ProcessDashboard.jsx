import { useEffect, useState, useCallback, memo } from "react";
import { useParams } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import Logo from "../components/Logo";
import {
  getStepAllowedStatuses,
  getRowClass,
  getStatusLabel,
  formatProcessName,
  computeStats,
  filterSteps,
  formatDisplayDate,
  formatRefreshTime,
} from "../utils/processUtils";
import { getProcessSteps, updateStepStatus } from "../services/apiClient";
import "./ProcessDashboard.css";

function getUserEmail() {
  return localStorage.getItem("cdsl_user_email") || "nehanaik@geplcapital.com";
}

// ── Step Row — memoized to prevent unnecessary re-renders ─────────────────────
const StepRow = memo(function StepRow({ step, onStatusChange, updating }) {
  const stepStatuses      = getStepAllowedStatuses(step);
  const exceptionStatuses = Array.isArray(step.exception_statuses)
    ? step.exception_statuses
    : [];

  const [selected, setSelected] = useState(step.ui_status);
  const [remark, setRemark]     = useState("");

  // Sync when data refreshes after save
  useEffect(() => {
    setSelected(step.ui_status);
    setRemark("");
  }, [step.ui_status, step.step_id]);

  const { label, cls } = getStatusLabel(selected, step.is_overdue, step.completed);
  const isBusy         = updating === step.step_id;
  const rowClass       = getRowClass(step);

  // Show remark box ONLY when changing TO an exception status
  const showRemarkBox =
    exceptionStatuses.length > 0 &&
    exceptionStatuses.includes(selected) &&
    selected !== step.ui_status;

  const handleSave = async () => {
    if (selected === step.ui_status && !remark.trim()) return;
    await onStatusChange(step.step_id, selected, remark.trim());
    setRemark("");
  };

  return (
    <tr className={rowClass}>

      <td><span className="cell-date">{step.process_date || "—"}</span></td>
      <td><span className="cell-step">{step.step_id || "—"}</span></td>
      <td><span className="cell-name">{step.step_name || "—"}</span></td>

      <td className="path-cell">
        {step.path_navigation_url ? (
          <a
            href={step.path_navigation_url}
            target="_blank"
            rel="noopener noreferrer"
            className="path-box"
            title={step.path_navigation_url}
          >
            {step.path_navigation_url}
          </a>
        ) : (
          <span className="exec-text">{step.system_name || "—"}</span>
        )}
      </td>

      <td className="exec-cell">
        <span className="exec-text">{step.how_to_execute || "—"}</span>
      </td>

      <td>
        <div>
          <span className="cell-role">
            {step.assigned_email || step.owner_role || "—"}
          </span>
          {step.assignment_type && step.assignment_type !== "COMPLETED_BY" && (
            <div style={{
              fontSize  : "10px",
              fontWeight: 700,
              marginTop : 3,
              color     :
                step.assignment_type === "SELF"      ? "var(--green)"  :
                step.assignment_type === "BUDDY"     ? "var(--navy)"   :
                step.assignment_type === "REPORTING" ? "var(--amber)"  :
                                                       "var(--red)",
            }}>
              {step.assignment_type}
            </div>
          )}
        </div>
      </td>

      <td>
        {step.planned_time ? (
          <div className="time-wrap">
            <div className="time-date">{step.process_date}</div>
            <div className="time-hour">{step.planned_time}</div>
          </div>
        ) : <span className="delay-none">—</span>}
      </td>

      <td>
        {step.actual_time ? (
          <div className="time-wrap">
            <div className="time-date">{step.process_date}</div>
            <div className="time-hour">{step.actual_time}</div>
          </div>
        ) : <span className="delay-none">—</span>}
      </td>

      <td>
        {Number(step.delay_minutes) > 0
          ? <span className="delay-late">+{step.delay_minutes}m</span>
          : <span className="delay-none">—</span>}
      </td>

      <td>
        <div className="status-cell">

          <select
            value={selected}
            onChange={(e) => { setSelected(e.target.value); setRemark(""); }}
            disabled={isBusy}
            className="status-select"
          >
            {stepStatuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Remark box — only when actively changing to exception status */}
          {showRemarkBox && (
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Add reason (optional)"
              disabled={isBusy}
              rows={2}
              style={{
                width          : "100%",
                marginTop      : 6,
                padding        : "4px 6px",
                fontSize       : 11,
                border         : "1px solid var(--red)",
                borderRadius   : 4,
                resize         : "vertical",
                fontFamily     : "inherit",
                backgroundColor: "var(--bg)",
                color          : "var(--text)",
              }}
            />
          )}

          {/* Show stored reason — only if it's different from status name */}
          {step.completed === "EXCEPTION" &&
           step.exception_reason &&
           step.exception_reason !== step.ui_status && (
            <div style={{
              fontSize  : 10,
              color     : "var(--red)",
              marginTop : 3,
              fontStyle : "italic",
              lineHeight: 1.4,
            }}>
              Reason: {step.exception_reason}
            </div>
          )}

          <div className="status-footer">
            <span className={`status-label ${cls}`}>{label}</span>
            {(selected !== step.ui_status ||
              (showRemarkBox && remark.trim())) && (
              <button
                type="button"
                onClick={handleSave}
                disabled={isBusy}
                className="save-btn"
              >
                {isBusy ? "..." : "Save"}
              </button>
            )}
          </div>

        </div>
      </td>

    </tr>
  );
});

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function ProcessDashboard() {
  const { processCode }               = useParams();
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [updating, setUpdating]       = useState(null);
  const [search, setSearch]           = useState("");
  const [filter, setFilter]           = useState("All Status");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [currentUser]                 = useState(() => getUserEmail());

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getProcessSteps(processCode);
      setData(res.data);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [processCode]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleStatusChange = useCallback(async (stepId, newStatus, remark = "") => {
    setData((prev) => {
      if (!prev || !Array.isArray(prev.steps)) return prev;
      return {
        ...prev,
        steps: prev.steps.map((s) =>
          s.step_id === stepId ? { ...s, ui_status: newStatus } : s
        ),
      };
    });
    try {
      setUpdating(stepId);
      await updateStepStatus(processCode, stepId, newStatus, currentUser, remark);
      await fetchData();
    } catch (err) {
      alert(`Failed to update: ${err.message}`);
      await fetchData();
    } finally {
      setUpdating(null);
    }
  }, [processCode, currentUser, fetchData]);

  if (loading && !data) {
    return (
      <div className="loading-wrap">
        <div className="spinner" />
        <div className="loading-text">Loading {processCode}...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="error-wrap">
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{error}</div>
          <button type="button" onClick={fetchData} className="retry-btn">Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const steps         = data.steps || [];
  const { total, completed, pending, overdue, exception, progress } = computeStats(steps);
  const filteredSteps = filterSteps(steps, search, filter);
  const allStatuses   = [...new Set(steps.flatMap((s) => s.allowed_statuses || []))];

  const statCards = [
    { label: "Total Steps", value: total,     sub: "Today",                   cls: "info"   },
    { label: "Completed",   value: completed, sub: `${progress}% completion`, cls: "good"   },
    { label: "Pending",     value: pending,   sub: "Ready rows",              cls: "warn"   },
    { label: "Exception",   value: exception, sub: "Needs attention",         cls: "danger" },
    { label: "Overdue",     value: overdue,   sub: "Past planned time",       cls: "danger" },
  ];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>

      <header className="app-header">
        <div className="header-left"><Logo height={36} /></div>
        <h1 className="header-title">
          {formatProcessName(data.process_name)} Dashboard
        </h1>
        <div className="header-right">
          <span className="live-dot" />
          <span>{formatDisplayDate()}</span>
        </div>
      </header>

      <div className="dashboard-wrap">

        <div className="stat-bar">
          {statCards.map((s) => (
            <div key={s.label} className="stat-card">
              <div className="stat-label">{s.label}</div>
              <div className={`stat-value ${s.cls}`}>{s.value}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        <div className="table-card">

          <div className="toolbar">
            <div className="toolbar-left">
              <span className="step-summary">
                {total} steps | {completed} done / {pending} pending
              </span>
              <div className="search-wrap">
                <Search size={13} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search step, path, how-to, doer..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="search-input"
                />
              </div>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="filter-select"
              >
                <option>All Status</option>
                {allStatuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="toolbar-right">
              {error && data && (
                <span style={{
                  color       : "var(--red)",
                  fontSize    : "11px",
                  fontWeight  : 700,
                  background  : "var(--red-bg)",
                  border      : "1px solid #fecdd3",
                  borderRadius: "999px",
                  padding     : "5px 9px",
                }}>
                  Refresh failed
                </span>
              )}
              <span className="updated-text">{formatRefreshTime(lastRefresh)}</span>
              <span className="range-label">Range</span>
              <select className="filter-select"><option>Today</option></select>
              <button
                type="button"
                onClick={fetchData}
                disabled={loading}
                className="refresh-btn"
              >
                <RefreshCw size={12} />
                Refresh Now
              </button>
            </div>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Process Date</th>
                  <th>Step ID</th>
                  <th>Step Name</th>
                  <th>Path (Navigation / URL)</th>
                  <th>How to Execute (Detailed)</th>
                  <th>Assigned To</th>
                  <th>Planned Time</th>
                  <th>Actual Time</th>
                  <th>Delay</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredSteps.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="no-rows">No steps found</td>
                  </tr>
                ) : (
                  filteredSteps.map((step) => (
                    <StepRow
                      key={`${step.step_id}-${step.process_date}`}
                      step={step}
                      onStatusChange={handleStatusChange}
                      updating={updating}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            Source: BigQuery · {data.process_code} · {total} steps
            {currentUser && (
              <span style={{ marginLeft: 12, color: "var(--text-muted)" }}>
                · {currentUser}
              </span>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}