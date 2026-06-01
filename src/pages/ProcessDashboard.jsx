import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import Logo from "../components/Logo";
import {
  ALLOWED_STATUSES,
  getStatusLabel,
  formatProcessName,
  computeStats,
  filterSteps,
  formatDisplayDate,
  formatRefreshTime,
} from "../utils/processUtils";
import { getProcessSteps, updateStepStatus } from "../services/apiClient";
import "./ProcessDashboard.css";

// ── Get user email ────────────────────────────────────────────────────────────
function getUserEmail() {
  return localStorage.getItem("cdsl_user_email") || "nehanaik@geplcapital.com";
}

// ── Step Row ──────────────────────────────────────────────────────────────────
function StepRow({ step, onStatusChange, updating }) {
  const [selected, setSelected] = useState(step.ui_status);
  const { label, cls }          = getStatusLabel(step.ui_status, step.is_overdue);
  const isBusy                  = updating === step.step_id;

  const handleSave = async () => {
    if (selected === step.ui_status) return;
    await onStatusChange(step.step_id, selected);
  };

  const rowClass =
    step.ui_status === "File Downloaded" ? "row-done"    :
    step.is_overdue                      ? "row-overdue" :
                                           "row-active";

  return (
    <tr className={rowClass}>

      {/* Process Date */}
      <td>
        <span className="cell-date">{step.process_date}</span>
      </td>

      {/* Step ID */}
      <td>
        <span className="cell-step">{step.step_id}</span>
      </td>

      {/* Step Name */}
      <td>
        <span className="cell-name">{step.step_name}</span>
      </td>

      {/* Path */}
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

      {/* How to Execute */}
      <td className="exec-cell">
        <span className="exec-text">{step.how_to_execute || "—"}</span>
      </td>

      {/* Assigned To — shows buddy-assigned email + assignment type */}
      <td>
        <div>
          <span className="cell-role">
            {step.assigned_email || step.owner_role || "—"}
          </span>
          {step.assignment_type && step.assignment_type !== "COMPLETED_BY" && (
            <div style={{
              fontSize: "10px",
              fontWeight: 700,
              marginTop: 3,
              color:
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

      {/* Planned Time */}
      <td>
        {step.planned_time ? (
          <div className="time-wrap">
            <div className="time-date">{step.process_date}</div>
            <div className="time-hour">{step.planned_time}</div>
          </div>
        ) : <span className="delay-none">—</span>}
      </td>

      {/* Actual Time */}
      <td>
        {step.actual_time ? (
          <div className="time-wrap">
            <div className="time-date">{step.process_date}</div>
            <div className="time-hour">{step.actual_time}</div>
          </div>
        ) : <span className="delay-none">—</span>}
      </td>

      {/* Delay */}
      <td>
        {step.delay_minutes > 0
          ? <span className="delay-late">+{step.delay_minutes}m</span>
          : <span className="delay-none">—</span>}
      </td>

      {/* Status */}
      <td>
        <div className="status-cell">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={isBusy}
            className="status-select"
          >
            {ALLOWED_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="status-footer">
            <span className={`status-label ${cls}`}>{label}</span>
            {selected !== step.ui_status && (
              <button
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
}

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

  // ── fetchData ─────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getProcessSteps(processCode);
      setData(res.data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [processCode]);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  // ── Auto refresh every 5 minutes ─────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Status update ─────────────────────────────────────────────────────────
  const handleStatusChange = async (stepId, newStatus) => {
    setData(prev => ({
      ...prev,
      steps: prev.steps.map(s =>
        s.step_id === stepId
          ? { ...s, ui_status: newStatus }
          : s
      ),
    }));
    try {
      setUpdating(stepId);
      await updateStepStatus(processCode, stepId, newStatus, currentUser);
      await fetchData();
    } catch (err) {
      alert(`Failed to update: ${err.message}`);
      await fetchData();
    } finally {
      setUpdating(null);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="loading-wrap">
        <div className="spinner" />
        <div className="loading-text">Loading {processCode}...</div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="error-wrap">
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>
            {error}
          </div>
          <button onClick={fetchData} className="retry-btn">Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // ── Derived data ──────────────────────────────────────────────────────────
  const steps = data.steps || [];
  const { total, completed, pending, overdue, progress } = computeStats(steps);
  const filteredSteps = filterSteps(steps, search, filter);

  const statCards = [
    { label: "Total Steps", value: total,          sub: "Today",                     cls: "info"   },
    { label: "Completed",   value: completed,      sub: `${progress}% completion`,   cls: "good"   },
    { label: "Pending",     value: pending,         sub: "Ready rows are actionable", cls: "warn"   },
    { label: "Overdue",     value: overdue,         sub: "Needs attention",           cls: "danger" },
    { label: "Progress",    value: `${progress}%`,  sub: "\u00a0",                   cls: "info"   },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <Logo height={36} />
        </div>
        <h1 className="header-title">
          {formatProcessName(data.process_name)} Dashboard
        </h1>
        <div className="header-right">
          <span className="live-dot" />
          <span>{formatDisplayDate()}</span>
        </div>
      </header>

      {/* Body */}
      <div className="dashboard-wrap">

        {/* Stat Cards */}
        <div className="stat-bar">
          {statCards.map((s) => (
            <div key={s.label} className="stat-card">
              <div className="stat-label">{s.label}</div>
              <div className={`stat-value ${s.cls}`}>{s.value}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Table Card */}
        <div className="table-card">

          {/* Toolbar */}
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
                {ALLOWED_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="toolbar-right">
              <span className="updated-text">{formatRefreshTime(lastRefresh)}</span>
              <span className="range-label">Range</span>
              <select className="filter-select">
                <option>Today</option>
              </select>
              <button
                onClick={fetchData}
                disabled={loading}
                className="refresh-btn"
              >
                <RefreshCw size={12} />
                Refresh Now
              </button>
            </div>
          </div>

          {/* Table */}
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
                      key={`${step.step_id}-${step.ui_status}-${step.is_overdue}`}
                      step={step}
                      onStatusChange={handleStatusChange}
                      updating={updating}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
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