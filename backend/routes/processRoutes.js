const express = require("express");
const ctrl    = require("../controllers/processController");
const router  = express.Router();

// ── All processes list ────────────────────────────────────────────────────────
router.get("/", ctrl.getProcesses);

// ── Audit routes ──────────────────────────────────────────────────────────────
// Keep audit routes before generic /:processCode route
router.get("/:processCode/audit", ctrl.getAuditLog);
router.get("/:processCode/steps/:stepId/audit", ctrl.getAuditLog);

// ── Process data ──────────────────────────────────────────────────────────────
router.get("/:processCode", ctrl.getProcessSteps);
router.get("/:processCode/steps/:stepId", ctrl.getProcessStep);

// ── Init / Archive ────────────────────────────────────────────────────────────
router.post("/:processCode/init", ctrl.initProcessDay);
router.post("/:processCode/archive", ctrl.archiveProcessDay);

// ── Status update ─────────────────────────────────────────────────────────────
router.patch("/:processCode/steps/:stepId/status", ctrl.updateStepStatus);

module.exports = router;

