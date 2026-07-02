'use strict';

const processService    = require('../services/processService');
const statusQueueService = require('../services/statusQueueService');

// ── Process list ──────────────────────────────────────────────────────────────
async function getProcesses(req, res, next) {
  try {
    const data = await processService.getProcesses();
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ── All steps for a process ───────────────────────────────────────────────────
async function getProcessSteps(req, res, next) {
  try {
    const { processCode } = req.params;
    const data = await processService.getProcessSteps(processCode);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ── Single step detail ────────────────────────────────────────────────────────
async function getProcessStep(req, res, next) {
  try {
    const { processCode, stepId } = req.params;
    const data = await processService.getProcessStep(processCode, stepId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ── Init process day ──────────────────────────────────────────────────────────
async function initProcessDay(req, res, next) {
  try {
    const { processCode } = req.params;
    const { process_date } = req.body;
    const data = await processService.initProcessDay(processCode, process_date);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ── Archive process day ───────────────────────────────────────────────────────
async function archiveProcessDay(req, res, next) {
  try {
    const { processCode } = req.params;
    const { process_date } = req.body;
    const data = await processService.archiveProcessDay(processCode, process_date);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ── Step status update (async via Redis queue, sync fallback) ─────────────────
async function updateStepStatus(req, res, next) {
  try {
    const { processCode, stepId } = req.params;
    const { status, changed_by, remark } = req.body;

    // Both fields are mandatory — no silent defaults allowed.
    const normalizedStatus    = String(status    || '').trim();
    const normalizedChangedBy = String(changed_by || '').trim().toLowerCase();

    if (!normalizedStatus) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }

    if (!normalizedChangedBy) {
      return res.status(400).json({ success: false, message: 'changed_by is required' });
    }

    const result = await statusQueueService.submitStatusUpdate({
      processCode,
      stepId,
      status    : normalizedStatus,
      changedBy : normalizedChangedBy,
      remark    : String(remark || '').trim(),
    });

    // 202 for async queue, 200 for sync fallback
    const httpStatus = result.mode === 'ASYNC' ? 202 : 200;
    res.status(httpStatus).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// ── Status job polling ────────────────────────────────────────────────────────
async function getStatusUpdateJob(req, res, next) {
  try {
    const { jobId } = req.params;
    const job = await statusQueueService.getStatusUpdateJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: `Job ${jobId} not found`,
      });
    }

    res.status(200).json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
}

// ── Dependency lock state ────────────────────────────────────────────────────
// Returns { [step_id]: true/false } — true = unlocked, false = locked.
// Steps without conditions are absent (frontend treats as unlocked).
async function getStepLocks(req, res, next) {
  try {
    const { processCode } = req.params;
    const data = await processService.getStepLocks(processCode);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ── Audit log ─────────────────────────────────────────────────────────────────
async function getAuditLog(req, res, next) {
  try {
    const { processCode, stepId } = req.params;
    const data = await processService.getAuditLog(processCode, stepId || null);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProcesses,
  getProcessSteps,
  getProcessStep,
  initProcessDay,
  archiveProcessDay,
  updateStepStatus,
  getStatusUpdateJob,
  getStepLocks,
  getAuditLog,
};
