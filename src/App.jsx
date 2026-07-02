import { Routes, Route, Navigate } from "react-router-dom";
import ProcessDashboard from "./pages/ProcessDashboard";

export default function App() {
  return (
    <Routes>
      {/* Default → BOD FMS */}
      <Route
        path="/"
        element={<Navigate to="/dashboard/ST_BOD_FMS" replace />}
      />

      {/* Generic route — works for all 23 FMS */}
      <Route
        path="/dashboard/:processCode"
        element={<ProcessDashboard />}
      />

      {/* 404 */}
      <Route
        path="*"
        element={
          <div className="flex items-center justify-center h-screen text-gray-500">
            Page not found
          </div>
        }
      />
    </Routes>
  );
}