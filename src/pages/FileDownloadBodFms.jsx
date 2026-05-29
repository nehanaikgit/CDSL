import { useEffect, useState } from "react";
import {
  getFileDownloadBodFms,
  updateFileDownloadBodFmsStatus,
} from "../services/cdslApi";

function FileDownloadBodFms() {
  const [processData, setProcessData] = useState(null);
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updatingStepId, setUpdatingStepId] = useState(null);
  const [error, setError] = useState("");

  const userEmail = "neha@geplcapital.com";

  async function loadProcessData() {
    try {
      setLoading(true);
      setError("");

      const result = await getFileDownloadBodFms();

      setProcessData(result.data);
      setSteps(result.data?.steps || []);
    } catch (err) {
      setError(err.message || "Failed to load process data");
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkFileDownloaded(stepId) {
    try {
      setUpdatingStepId(stepId);
      setError("");

      await updateFileDownloadBodFmsStatus({
        stepId,
        status: "File Downloaded",
        userEmail,
      });

      await loadProcessData();
    } catch (err) {
      setError(err.message || "Failed to update status");
    } finally {
      setUpdatingStepId(null);
    }
  }

  useEffect(() => {
    loadProcessData();
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>CDSL Settlement Process</h1>
          <p style={styles.subtitle}>File Download BOD FMS</p>
        </div>

        <button style={styles.refreshButton} onClick={loadProcessData}>
          Refresh
        </button>
      </div>

      {loading && <div style={styles.infoBox}>Loading process data...</div>}

      {error && <div style={styles.errorBox}>{error}</div>}

      {processData && (
        <div style={styles.summaryCard}>
          <div>
            <strong>Process:</strong> {processData.process_name}
          </div>
          <div>
            <strong>Module:</strong> {processData.module}
          </div>
          <div>
            <strong>Process Code:</strong> {processData.process_code}
          </div>
          <div>
            <strong>Source:</strong> {processData.source}
          </div>
        </div>
      )}

      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Step ID</th>
              <th style={styles.th}>Step Name</th>
              <th style={styles.th}>Planned Time</th>
              <th style={styles.th}>Actual Time</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Doer</th>
              <th style={styles.th}>Path</th>
              <th style={styles.th}>How To Execute</th>
              <th style={styles.th}>Action</th>
            </tr>
          </thead>

          <tbody>
            {steps.length === 0 && !loading ? (
              <tr>
                <td style={styles.td} colSpan="9">
                  No process data found.
                </td>
              </tr>
            ) : (
              steps.map((step) => (
                <tr key={step.step_id}>
                  <td style={styles.td}>{step.step_id}</td>
                  <td style={styles.td}>{step.step_name}</td>
                  <td style={styles.td}>{step.planned_time || "-"}</td>
                  <td style={styles.td}>{step.actual_time || "-"}</td>
                  <td style={styles.td}>
                    <span
                      style={{
                        ...styles.statusBadge,
                        ...(step.status === "File Downloaded"
                          ? styles.statusDone
                          : styles.statusPending),
                      }}
                    >
                      {step.status}
                    </span>
                  </td>
                  <td style={styles.td}>{step.assigned_email || "-"}</td>
                  <td style={styles.td}>{step.path_navigation_url || "-"}</td>
                  <td style={styles.td}>{step.how_to_execute || "-"}</td>
                  <td style={styles.td}>
                    <button
                      style={styles.actionButton}
                      disabled={
                        updatingStepId === step.step_id ||
                        step.status === "File Downloaded"
                      }
                      onClick={() => handleMarkFileDownloaded(step.step_id)}
                    >
                      {updatingStepId === step.step_id
                        ? "Updating..."
                        : step.status === "File Downloaded"
                        ? "Done"
                        : "Mark Downloaded"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles = {
  page: {
    padding: "24px",
    fontFamily: "Arial, sans-serif",
    background: "#f6f7fb",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  title: {
    margin: 0,
    fontSize: "26px",
    color: "#111827",
  },
  subtitle: {
    margin: "6px 0 0",
    color: "#6b7280",
  },
  refreshButton: {
    padding: "10px 16px",
    border: "none",
    borderRadius: "8px",
    background: "#111827",
    color: "white",
    cursor: "pointer",
  },
  infoBox: {
    padding: "12px",
    borderRadius: "8px",
    background: "#e0f2fe",
    color: "#075985",
    marginBottom: "12px",
  },
  errorBox: {
    padding: "12px",
    borderRadius: "8px",
    background: "#fee2e2",
    color: "#991b1b",
    marginBottom: "12px",
  },
  summaryCard: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "12px",
    padding: "16px",
    borderRadius: "12px",
    background: "white",
    marginBottom: "20px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  },
  tableWrapper: {
    overflowX: "auto",
    background: "white",
    borderRadius: "12px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "1100px",
  },
  th: {
    padding: "12px",
    background: "#f3f4f6",
    color: "#374151",
    textAlign: "left",
    fontSize: "13px",
    borderBottom: "1px solid #e5e7eb",
  },
  td: {
    padding: "12px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: "13px",
    color: "#111827",
    verticalAlign: "top",
  },
  statusBadge: {
    display: "inline-block",
    padding: "5px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: "600",
  },
  statusDone: {
    background: "#dcfce7",
    color: "#166534",
  },
  statusPending: {
    background: "#fef3c7",
    color: "#92400e",
  },
  actionButton: {
    padding: "8px 12px",
    border: "none",
    borderRadius: "8px",
    background: "#2563eb",
    color: "white",
    cursor: "pointer",
  },
};

export default FileDownloadBodFms;