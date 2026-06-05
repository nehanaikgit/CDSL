const processService = require("../services/processService");

async function getProcesses(req, res, next) {
  try {
    const data = await processService.getProcesses();

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function getProcessSteps(req, res, next) {
  try {
    const { processCode } = req.params;

    const data = await processService.getProcessSteps(processCode);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function getProcessStep(req, res, next) {
  try {
    const { processCode, stepId } = req.params;

    const data = await processService.getProcessStep(processCode, stepId);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function initProcessDay(req, res, next) {
  try {
    const { processCode } = req.params;
    const { process_date } = req.body;

    const data = await processService.initProcessDay(processCode, process_date);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function updateStepStatus(req, res, next) {
  try {
    const { processCode, stepId } = req.params;
    const { status, changed_by, remark } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "status is required",
      });
    }

    const data = await processService.updateStepStatus(
      processCode,
      stepId,
      status,
      changed_by,
      remark
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function archiveProcessDay(req, res, next) {
  try {
    const { processCode } = req.params;
    const { process_date } = req.body;

    const data = await processService.archiveProcessDay(processCode, process_date);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function getAuditLog(req, res, next) {
  try {
    const { processCode, stepId } = req.params;

    const data = await processService.getAuditLog(
      processCode,
      stepId || null
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProcesses,
  getProcessSteps,
  getProcessStep,
  initProcessDay,
  updateStepStatus,
  archiveProcessDay,
  getAuditLog,
};