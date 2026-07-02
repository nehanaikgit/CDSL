import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  useDeferredValue,
  memo,
} from "react";
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
import {
  getProcessStep,
  getProcessSteps,
  getStatusUpdateJob,
  getStepLocks,
  updateStepStatus,
} from "../services/apiClient";
import "./ProcessDashboard.css";


const USER_EMAIL_STORAGE_KEY = "cdsl_user_email";
const EMPTY_STEPS = Object.freeze([]);
const EMPTY_LOCKS = Object.freeze({});

function normalizeUserEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getAllowedEmailDomain() {
  return String(import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

function validateUserEmail(value) {
  const email = normalizeUserEmail(value);
  if (!email) return "Enter your work email to enable status updates.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  const allowedDomain = getAllowedEmailDomain();
  if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
    return `Use your @${allowedDomain} email address.`;
  }
  return "";
}

function getUserEmail() {
  try {
    return normalizeUserEmail(window.localStorage.getItem(USER_EMAIL_STORAGE_KEY));
  } catch {
    return "";
  }
}

function storeUserEmail(value) {
  const email = normalizeUserEmail(value);
  window.localStorage.setItem(USER_EMAIL_STORAGE_KEY, email);
  return email;
}

// ── User Identity Control ─────────────────────────────────────────────────────
// Fix: removed setState calls from useEffect body — use key prop pattern instead
const UserIdentityControl = memo(function UserIdentityControl({ currentUser, onUserChange }) {
  const [editing, setEditing]       = useState(!currentUser);
  const [draftEmail, setDraftEmail] = useState(currentUser || "");
  const [identityError, setIdentityError] = useState("");


  const handleSubmit = (event) => {
    event.preventDefault();
    const validationError = validateUserEmail(draftEmail);
    if (validationError) { setIdentityError(validationError); return; }
    const saveError = onUserChange(draftEmail);
    if (saveError) { setIdentityError(saveError); return; }
    setIdentityError("");
    setEditing(false);
  };

  if (currentUser && !editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{
          maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", color: "var(--green)", fontSize: 11, fontWeight: 700,
        }} title={currentUser}>
          User: {currentUser}
        </span>
        <button
          type="button"
          onClick={() => { setDraftEmail(currentUser); setIdentityError(""); setEditing(true); }}
          style={{
            border: "1px solid var(--border)", borderRadius: 5, padding: "4px 7px",
            background: "var(--bg)", color: "var(--text)", fontSize: 10, fontWeight: 700, cursor: "pointer",
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
      <span style={{ color: "var(--amber)", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
        Read-only
      </span>
      <input
        type="email"
        value={draftEmail}
        onChange={(e) => { setDraftEmail(e.target.value); setIdentityError(""); }}
        placeholder="Enter work email"
        autoComplete="email"
        aria-label="Current user email"
        style={{
          width: 210, height: 28,
          border: identityError ? "1px solid var(--red)" : "1px solid var(--border)",
          borderRadius: 5, padding: "0 8px", background: "var(--bg)",
          color: "var(--text)", fontSize: 11, outline: "none",
        }}
      />
      <button
        type="submit"
        style={{
          height: 28, border: 0, borderRadius: 5, padding: "0 9px",
          background: "var(--navy)", color: "#fff", fontSize: 10, fontWeight: 700,
          cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        Use Email
      </button>
      {currentUser && (
        <button
          type="button"
          onClick={() => { setDraftEmail(currentUser); setIdentityError(""); setEditing(false); }}
          style={{
            height: 28, border: "1px solid var(--border)", borderRadius: 5,
            padding: "0 8px", background: "var(--bg)", color: "var(--text)",
            fontSize: 10, fontWeight: 700, cursor: "pointer",
          }}
        >
          Cancel
        </button>
      )}
      {identityError && (
        <span style={{
          position: "absolute", top: 31, right: 0, zIndex: 5,
          minWidth: 220, maxWidth: 320, padding: "5px 7px",
          border: "1px solid #fecdd3", borderRadius: 5,
          background: "var(--red-bg)", color: "var(--red)",
          fontSize: 10, fontWeight: 700, boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        }}>
          {identityError}
        </span>
      )}
    </form>
  );
});


// ── Non-blocking notice ───────────────────────────────────────────────────────
const AppNotice = memo(function AppNotice({ notice, onClose }) {
  if (!notice) return null;

  return (
    <div
      className={`app-notice app-notice-${notice.type || "info"}`}
      role="status"
      aria-live="polite"
    >
      <span>{notice.message}</span>
      <button
        type="button"
        className="app-notice-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
});

function getInitialSelectedStatus(stepStatus, uiStatus, pendingStatus) {
  if (pendingStatus) return pendingStatus;
  return stepStatus === "PENDING" ? "" : (uiStatus || "");
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function overlayPendingSteps(processData, pendingJobs) {
  if (!processData || !Array.isArray(processData.steps)) return processData;

  return {
    ...processData,
    steps: processData.steps.map((step) => {
      const pendingJob = pendingJobs?.[step.step_id];
      if (!pendingJob) return step;

      return {
        ...step,
        ui_status: pendingJob.requested_status,
        pending_status: pendingJob.requested_status,
        pending_remark: pendingJob.remark || "",
        is_overdue: false,
      };
    }),
  };
}

// ── Step Row ──────────────────────────────────────────────────────────────────
const StepRow = memo(function StepRow({
  step,
  onStatusChange,
  onNotify,
  updating,
  pendingJob,
  canUpdate,
  isLocked,
}) {
  const stepStatuses      = getStepAllowedStatuses(step);
  const exceptionStatuses = Array.isArray(step.exception_statuses) ? step.exception_statuses : [];

  // PENDING steps show the placeholder until a user selects a status.
  const [selected, setSelected] = useState(() =>
    getInitialSelectedStatus(
      step.step_status,
      step.ui_status,
      step.pending_status,
    ),
  );
  const [remark, setRemark]     = useState("");

  // Fix: no setState in effect — use layout effect with ref comparison
  const prevStepRef = useRef({
    ui_status: step.ui_status,
    step_id: step.step_id,
    step_status: step.step_status,
    pending_status: step.pending_status,
  });
  useEffect(() => {
    const prev = prevStepRef.current;
    if (
      prev.step_id !== step.step_id ||
      prev.ui_status !== step.ui_status ||
      prev.step_status !== step.step_status ||
      prev.pending_status !== step.pending_status
    ) {
      prevStepRef.current = {
        ui_status: step.ui_status,
        step_id: step.step_id,
        step_status: step.step_status,
        pending_status: step.pending_status,
      };
      setSelected(getInitialSelectedStatus(
        step.step_status,
        step.ui_status,
        step.pending_status,
      ));
      setRemark("");
    }
  }, [
    step.pending_status,
    step.step_id,
    step.step_status,
    step.ui_status,
  ]);

  const { label, cls } = pendingJob
    ? {
        label: pendingJob.status === "RETRYING" ? "Retrying…" : "Saving…",
        cls: "saving",
      }
    : getStatusLabel(
        selected || step.ui_status,
        step.is_overdue,
        step.completed,
      );
  const isBusy = updating === step.step_id || Boolean(pendingJob);
  const isDisabled = isBusy || !canUpdate || isLocked;
  const rowClass = [
    pendingJob ? `${getRowClass(step)} row-saving` : getRowClass(step),
    isLocked ? "row-locked" : "",
  ].filter(Boolean).join(" ");

  // Show remark box when exception status is selected
  const showRemarkBox = exceptionStatuses.length > 0 && exceptionStatuses.includes(selected);

  // Show Save button when selection changed or remark added
  const initialSelected = getInitialSelectedStatus(
    step.step_status,
    step.ui_status,
    step.pending_status,
  );
  const showSave = (selected !== "" && selected !== initialSelected) ||
                   (showRemarkBox && remark.trim().length > 0);

  const handleSave = async () => {
    if (isLocked) {
      onNotify("warning", `${step.step_id} is waiting on a dependency and cannot be updated yet.`);
      return;
    }

    if (!selected) {
      onNotify("warning", "Please select a status first.");
      return;
    }

    if (exceptionStatuses.includes(selected) && !remark.trim()) {
      onNotify("warning", "Please add a reason for this exception status.");
      return;
    }

    const updated = await onStatusChange(
      step.step_id,
      selected,
      remark.trim(),
    );

    if (updated) {
      setRemark("");
    }
  };

  return (
    <tr className={rowClass}>
      <td><span className="cell-date">{step.process_date || "—"}</span></td>
      <td><span className="cell-step">{step.step_id || "—"}</span></td>
      <td><span className="cell-name">{step.step_name || "—"}</span></td>

      <td className="path-cell">
        {step.path_navigation_url ? (
          <a href={step.path_navigation_url} target="_blank" rel="noopener noreferrer"
            className="path-box" title={step.path_navigation_url}>
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
          <span className="cell-role">{step.assigned_email || step.owner_role || "—"}</span>
          {step.assignment_type && step.assignment_type !== "COMPLETED_BY" && (
            <div style={{
              fontSize: "10px", fontWeight: 700, marginTop: 3,
              color: step.assignment_type === "SELF"      ? "var(--green)"  :
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
            disabled={isDisabled}
            title={isLocked ? "Waiting on a dependency — locked until it clears" : undefined}
            className="status-select"
          >
            {/* Placeholder shown for PENDING steps */}
            {step.step_status === "PENDING" && (
              <option value="" disabled>— Select Status —</option>
            )}
            {stepStatuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Remark box — shown when exception status selected */}
          {showRemarkBox && (
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Reason required for exception status"
              disabled={isDisabled}
              rows={2}
              style={{
                width: "100%", marginTop: 6, padding: "4px 6px",
                fontSize: 11, border: "1px solid var(--red)",
                borderRadius: 4, resize: "vertical",
                fontFamily: "inherit", backgroundColor: "var(--bg)", color: "var(--text)",
              }}
            />
          )}

          {/* Stored exception reason */}
          {step.completed === "EXCEPTION" &&
           step.exception_reason &&
           step.exception_reason !== step.ui_status && (
            <div style={{
              fontSize: 10, color: "var(--red)", marginTop: 3,
              fontStyle: "italic", lineHeight: 1.4,
            }}>
              Reason: {step.exception_reason}
            </div>
          )}

          <div className="status-footer">
            <span className={`status-label ${cls}`}>{label}</span>
            {pendingJob && (
              <span className="status-job-text">
                {pendingJob.status || "QUEUED"}
              </span>
            )}
            {isLocked && !pendingJob && (
              <span
                className="status-label locked"
                title="Waiting on a dependency"
                style={{ color: "var(--amber)", fontWeight: 700 }}
              >
                Locked
              </span>
            )}
            {showSave && (
              <button
                type="button"
                onClick={handleSave}
                disabled={isDisabled}
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
  const { processCode } = useParams();
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState(null);
  const [updating, setUpdating]   = useState(null);
  const [search, setSearch]       = useState("");
  const [filter, setFilter]       = useState("All Status");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [currentUser, setCurrentUser] = useState(() => getUserEmail());
  const [notice, setNotice]       = useState(null);
  const [pendingJobs, setPendingJobs] = useState({});
  const [locks, setLocks]         = useState(EMPTY_LOCKS);

  const dataRef             = useRef(null);
  const requestSequenceRef  = useRef(0);
  const retryTimerRef       = useRef(null);
  const lastRefreshRef      = useRef(null);
  const fetchDataRef        = useRef(null);
  const noticeTimerRef      = useRef(null);
  const updatingRef         = useRef(null);
  const statusCheckTimersRef = useRef(new Set());
  const pendingJobsRef      = useRef({});
  const jobPollTokensRef    = useRef(new Map());


  const dismissNotice = useCallback(() => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice(null);
  }, []);

  const showNotice = useCallback((type, message, durationMs = 5000) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }

    setNotice({
      id: Date.now(),
      type,
      message,
    });

    if (durationMs > 0) {
      noticeTimerRef.current = window.setTimeout(() => {
        noticeTimerRef.current = null;
        setNotice(null);
      }, durationMs);
    }
  }, []);

  const handleUserChange = useCallback((value) => {
    const validationError = validateUserEmail(value);
    if (validationError) return validationError;
    try {
      const savedEmail = storeUserEmail(value);
      setCurrentUser(savedEmail);
      return "";
    } catch {
      return "Unable to save the email in this browser.";
    }
  }, []);

  // Sync user from storage when window gains focus or storage changes
  useEffect(() => {
    const syncUser = () => setCurrentUser(getUserEmail());
    window.addEventListener("storage", syncUser);
    window.addEventListener("focus", syncUser);
    return () => {
      window.removeEventListener("storage", syncUser);
      window.removeEventListener("focus", syncUser);
    };
  }, []);

  useEffect(() => {
    const statusCheckTimers = statusCheckTimersRef.current;
    const jobPollTokens = jobPollTokensRef.current;

    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }

      statusCheckTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      statusCheckTimers.clear();

      jobPollTokens.forEach((token) => {
        token.cancelled = true;
      });
      jobPollTokens.clear();
    };
  }, []);

  const pollIntervalMs = (() => {
    const v = Number.parseInt(import.meta.env.VITE_POLL_INTERVAL_MS || "300000", 10);
    return Number.isFinite(v) && v >= 30000 ? v : 300000;
  })();

  const lockPollIntervalMs = (() => {
    const v = Number.parseInt(import.meta.env.VITE_LOCK_POLL_INTERVAL_MS || "60000", 10);
    return Number.isFinite(v) && v >= 15000 ? v : 60000;
  })();

  const fetchData = useCallback(async ({ background = false, force = false } = {}) => {
    const seq = ++requestSequenceRef.current;
    const hasData = Boolean(dataRef.current);

    if (!background && !hasData) setLoading(true);
    else setRefreshing(true);

    try {
      const response = await getProcessSteps(processCode, { dedupe: !force });
      if (seq !== requestSequenceRef.current) return response;

      const nextData = overlayPendingSteps(
        response.data,
        pendingJobsRef.current,
      );
      dataRef.current = nextData;
      setData(nextData);

      const now = new Date();
      lastRefreshRef.current = now;
      setLastRefresh(now);
      setError(null);

      // If stale cache returned — schedule a fresh fetch in 7s
      if (response.data?.source === "REDIS_STALE" && retryTimerRef.current === null) {
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void fetchDataRef.current?.({ background: true, force: true }).catch(() => {});
        }, 7000);
      }

      return response;
    } catch (err) {
      if (seq === requestSequenceRef.current) {
        setError(err.message || "Failed to load dashboard data");
      }
      throw err;
    } finally {
      if (seq === requestSequenceRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [processCode]);

  // eslint-disable-next-line react-hooks/refs
  fetchDataRef.current = fetchData;

  const fetchLocks = useCallback(async () => {
    try {
      const response = await getStepLocks(processCode, { dedupe: false });
      setLocks(response?.data || EMPTY_LOCKS);
    } catch (err) {
      // Lock state is advisory for the UI — a failed fetch must not block the dashboard.
      console.warn("[locks] refresh failed:", err.message);
    }
  }, [processCode]);

  // Initial load + polling
  useEffect(() => {
    dataRef.current = null;
    lastRefreshRef.current = null;
    requestSequenceRef.current += 1;
    // Reset route-specific state before loading another process.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setLoading(true);
    setRefreshing(false);
    setError(null);
    setLastRefresh(null);
    setLocks(EMPTY_LOCKS);
    pendingJobsRef.current = {};
    setPendingJobs({});
    jobPollTokensRef.current.forEach((token) => {
      token.cancelled = true;
    });
    jobPollTokensRef.current.clear();

    void fetchData({ force: false }).catch(() => {});
    void fetchLocks();

    const interval = window.setInterval(() => {
      if (!document.hidden) {
        void fetchData({ background: true }).catch(() => {});
      }
    }, pollIntervalMs);

    const lockInterval = window.setInterval(() => {
      if (!document.hidden) {
        void fetchLocks();
      }
    }, lockPollIntervalMs);

    const handleVisibilityChange = () => {
      if (document.hidden) return;
      const lastTime = lastRefreshRef.current?.getTime() || 0;
      if (Date.now() - lastTime >= pollIntervalMs) {
        void fetchData({ background: true }).catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.clearInterval(lockInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [fetchData, fetchLocks, pollIntervalMs, lockPollIntervalMs]);


  const applyFreshStep = useCallback((stepId, freshStep) => {
    if (!freshStep) return;

    setData((current) => {
      if (!current || !Array.isArray(current.steps)) return current;

      const next = {
        ...current,
        steps: current.steps.map((step) => {
          if (step.step_id !== stepId) return step;

          const uiStatus =
            freshStep.last_status_value ||
            (freshStep.step_status === "COMPLETED"
              ? "Completed"
              : freshStep.step_status === "EXCEPTION"
                ? "Exception"
                : step.ui_status);

          return {
            ...step,
            ...freshStep,
            ui_status: uiStatus,
            pending_status: null,
            pending_remark: null,
            is_overdue:
              String(freshStep.step_status || "").toUpperCase() === "PENDING"
                ? step.is_overdue
                : false,
          };
        }),
      };

      dataRef.current = next;
      return next;
    });
  }, []);

  const refreshSingleStep = useCallback(async (stepId) => {
    const response = await getProcessStep(processCode, stepId, {
      timeoutMs: 20000,
      dedupe: false,
    });

    if (response?.data) {
      applyFreshStep(stepId, response.data);
    }

    return response?.data || null;
  }, [applyFreshStep, processCode]);

  const scheduleStatusChecks = useCallback((stepId) => {
    [2500, 7000, 15000].forEach((delayMs) => {
      const timerId = window.setTimeout(() => {
        statusCheckTimersRef.current.delete(timerId);
        void refreshSingleStep(stepId).catch(() => {});
      }, delayMs);

      statusCheckTimersRef.current.add(timerId);
    });
  }, [refreshSingleStep]);

  const setPendingJobInfo = useCallback((stepId, jobInfo) => {
    const next = {
      ...pendingJobsRef.current,
      [stepId]: jobInfo,
    };

    pendingJobsRef.current = next;
    setPendingJobs(next);

    setData((current) => {
      if (!current || !Array.isArray(current.steps)) return current;

      const updated = {
        ...current,
        steps: current.steps.map((step) =>
          step.step_id === stepId
            ? {
                ...step,
                ui_status: jobInfo.requested_status,
                pending_status: jobInfo.requested_status,
                pending_remark: jobInfo.remark || "",
                is_overdue: false,
              }
            : step,
        ),
      };

      dataRef.current = updated;
      return updated;
    });
  }, []);

  const clearPendingJobInfo = useCallback((stepId) => {
    const next = { ...pendingJobsRef.current };
    delete next[stepId];
    pendingJobsRef.current = next;
    setPendingJobs(next);
  }, []);

  const restoreStep = useCallback((stepId, previousStep) => {
    if (!previousStep) return;

    setData((current) => {
      if (!current || !Array.isArray(current.steps)) return current;

      const restored = {
        ...current,
        steps: current.steps.map((step) =>
          step.step_id === stepId ? previousStep : step,
        ),
      };

      dataRef.current = restored;
      return restored;
    });
  }, []);

  const applyCommittedStatus = useCallback((
    stepId,
    requestedStatus,
    remark,
  ) => {
    setData((current) => {
      if (!current || !Array.isArray(current.steps)) return current;

      const committed = {
        ...current,
        steps: current.steps.map((step) => {
          if (step.step_id !== stepId) return step;

          const isException = Array.isArray(step.exception_statuses) &&
            step.exception_statuses.includes(requestedStatus);

          return {
            ...step,
            ui_status: requestedStatus,
            last_status_value: requestedStatus,
            step_status: isException ? "EXCEPTION" : "COMPLETED",
            completed: isException ? "EXCEPTION" : "YES",
            exception_reason: isException ? remark : null,
            pending_status: null,
            pending_remark: null,
            is_overdue: false,
          };
        }),
      };

      dataRef.current = committed;
      return committed;
    });
  }, []);

  const monitorStatusJob = useCallback(async ({
    stepId,
    jobId,
    previousStep,
    requestedStatus,
    remark,
  }) => {
    const previousToken = jobPollTokensRef.current.get(stepId);
    if (previousToken) previousToken.cancelled = true;

    const token = { cancelled: false };
    jobPollTokensRef.current.set(stepId, token);

   for (let attempt = 0; attempt < 30; attempt += 1) {
  await wait(attempt === 0 ? 1000 : 2000);
      if (token.cancelled) return;

      try {
        const response = await getStatusUpdateJob(jobId, {
          timeoutMs: 10000,
          dedupe: false,
        });
        const job = response?.data;

        if (!job) continue;

        setPendingJobInfo(stepId, {
          job_id: jobId,
          status: job.status,
          requested_status: job.requested_status || requestedStatus,
          remark,
        });

        if (job.status === "COMPLETED") {
          applyCommittedStatus(
            stepId,
            job.requested_status || requestedStatus,
            remark,
          );
          clearPendingJobInfo(stepId);
          jobPollTokensRef.current.delete(stepId);
          showNotice("success", `${stepId} updated successfully.`, 2500);

          void refreshSingleStep(stepId).catch(() => {
            scheduleStatusChecks(stepId);
          });
          void fetchLocks();
          return;
        }

        if (job.status === "FAILED") {
          clearPendingJobInfo(stepId);
          jobPollTokensRef.current.delete(stepId);
          restoreStep(stepId, previousStep);
          showNotice(
            "error",
            job.error?.message || `Unable to update ${stepId}.`,
            7000,
          );
          return;
        }
      } catch (error) {
        if (error?.statusCode !== 404 && attempt >= 4) {
          console.warn("Status job polling failed:", error.message);
        }
      }
    }

    clearPendingJobInfo(stepId);
    jobPollTokensRef.current.delete(stepId);
    showNotice(
      "warning",
      `${stepId} is taking longer than expected. Refresh before retrying.`,
      7000,
    );
    scheduleStatusChecks(stepId);
  }, [
    applyCommittedStatus,
    clearPendingJobInfo,
    fetchLocks,
    refreshSingleStep,
    restoreStep,
    scheduleStatusChecks,
    setPendingJobInfo,
    showNotice,
  ]);

  const handleStatusChange = useCallback(async (
    stepId,
    newStatus,
    remark = "",
  ) => {
    if (!currentUser) {
      showNotice(
        "warning",
        "User email is missing. Enter your work email in the toolbar.",
      );
      return false;
    }

    if (locks[stepId] === false) {
      showNotice(
        "warning",
        `${stepId} is waiting on a dependency and cannot be updated yet.`,
      );
      return false;
    }

    if (updatingRef.current || pendingJobsRef.current[stepId]) {
      showNotice(
        "info",
        `${stepId} is already being updated.`,
        3000,
      );
      return false;
    }

    const previousStep = dataRef.current?.steps?.find(
      (step) => step.step_id === stepId,
    );

    updatingRef.current = stepId;
    setUpdating(stepId);

    // Show the selected value immediately, but do not mark it completed until
    // the Redis worker confirms that BigQuery committed successfully.
    setData((current) => {
      if (!current || !Array.isArray(current.steps)) return current;

      const optimistic = {
        ...current,
        steps: current.steps.map((step) =>
          step.step_id === stepId
            ? {
                ...step,
                ui_status: newStatus,
                pending_status: newStatus,
                pending_remark: remark,
                is_overdue: false,
              }
            : step,
        ),
      };

      dataRef.current = optimistic;
      return optimistic;
    });

    try {
      const response = await updateStepStatus(
        processCode,
        stepId,
        newStatus,
        currentUser,
        remark,
      );
      const result = response?.data || {};

      if (result.mode === "ASYNC" && result.job_id) {
        const requestedStatus = result.requested_status || newStatus;
        const pendingJob = {
          job_id: result.job_id,
          status: result.status || "QUEUED",
          requested_status: requestedStatus,
          remark,
        };

        setPendingJobInfo(stepId, pendingJob);
        showNotice(
          "info",
          result.duplicate
            ? `${stepId} is already processing.`
            : `${stepId} queued. Saving in the background.`,
          3000,
        );

        void monitorStatusJob({
          stepId,
          jobId: result.job_id,
          previousStep,
          requestedStatus,
          remark,
        });
        return true;
      }

      showNotice("success", `${stepId} updated successfully.`, 2500);

      try {
        await refreshSingleStep(stepId);
      } catch {
        scheduleStatusChecks(stepId);
      }

      void fetchLocks();
      return true;
    } catch (error) {
      restoreStep(stepId, previousStep);
      showNotice(
        "error",
        error?.message || "Unable to update the step.",
        7000,
      );
      return false;
    } finally {
      updatingRef.current = null;
      setUpdating(null);
    }
  }, [
    currentUser,
    fetchLocks,
    locks,
    monitorStatusJob,
    processCode,
    refreshSingleStep,
    restoreStep,
    scheduleStatusChecks,
    setPendingJobInfo,
    showNotice,
  ]);

  const steps = Array.isArray(data?.steps)
    ? data.steps
    : EMPTY_STEPS;
  const deferredSearch = useDeferredValue(search);

  const {
    total,
    completed,
    pending,
    overdue,
    exception,
    progress,
  } = useMemo(() => computeStats(steps), [steps]);

  const filteredSteps = useMemo(
    () => filterSteps(steps, deferredSearch, filter),
    [deferredSearch, filter, steps],
  );

  const allStatuses = useMemo(
    () => [...new Set(steps.flatMap((step) => step.allowed_statuses || []))],
    [steps],
  );

  // ── Render states ──────────────────────────────────────────────────────────
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
          <button type="button" onClick={() => void fetchData({ force: true }).catch(() => {})} className="retry-btn">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const statCards = [
    { label: "Total Steps", value: total,     sub: "Today",              cls: "info"   },
    { label: "Completed",   value: completed, sub: `${progress}% completion`, cls: "good" },
    { label: "Pending",     value: pending,   sub: "Ready rows",         cls: "warn"   },
    { label: "Exception",   value: exception, sub: "Needs attention",    cls: "danger" },
    { label: "Overdue",     value: overdue,   sub: "Past planned time",  cls: "danger" },
  ];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <AppNotice notice={notice} onClose={dismissNotice} />
      <header className="app-header">
        <div className="header-left"><Logo height={36} /></div>
        <h1 className="header-title">{formatProcessName(data.process_name)} Dashboard</h1>
        <div className="header-right">
          <span className="live-dot" />
          <span>{formatDisplayDate()}</span>
        </div>
      </header>

      <div className="dashboard-wrap">
        <div className="stat-bar">
          {statCards.map((stat) => (
            <div key={stat.label} className="stat-card">
              <div className="stat-label">{stat.label}</div>
              <div className={`stat-value ${stat.cls}`}>{stat.value}</div>
              <div className="stat-sub">{stat.sub}</div>
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
              <select value={filter} onChange={(e) => setFilter(e.target.value)} className="filter-select">
                <option>All Status</option>
                {allStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="toolbar-right">
              {error && data && (
                <span style={{
                  color: "var(--red)", fontSize: "11px", fontWeight: 700,
                  background: "var(--red-bg)", border: "1px solid #fecdd3",
                  borderRadius: "999px", padding: "5px 9px",
                }}>
                  Refresh failed
                </span>
              )}
              <UserIdentityControl
                key={currentUser || "anonymous"}
                currentUser={currentUser}
                onUserChange={handleUserChange}
              />
              <span className="updated-text">
                {refreshing ? "Refreshing..." : formatRefreshTime(lastRefresh)}
              </span>
              <span className="range-label">Range</span>
              <select className="filter-select"><option>Today</option></select>
              <button
                type="button"
                onClick={() => void fetchData({ background: true, force: true }).catch(() => {})}
                disabled={refreshing}
                className="refresh-btn"
              >
                <RefreshCw size={12} />
                {refreshing ? "Refreshing" : "Refresh Now"}
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
                      onNotify={showNotice}
                      updating={updating}
                      pendingJob={pendingJobs[step.step_id] || null}
                      canUpdate={Boolean(currentUser)}
                      isLocked={locks[step.step_id] === false}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            Source: {data.source || "UNKNOWN"} · {data.process_code} · {total} steps
            {typeof data.response_time_ms === "number" && (
              <span style={{ marginLeft: 12, color: "var(--text-muted)" }}>
                · API {data.response_time_ms} ms
              </span>
            )}
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