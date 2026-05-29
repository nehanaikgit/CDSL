const cdslService = require("../services/cdslService");

async function getFileDownloadBodFms(req, res, next) {
  try {
    const data = await cdslService.getFileDownloadBodFms();

    res.status(200).json({
      success: true,
      message: "File Download BOD FMS data fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function updateFileDownloadBodFmsStatus(req, res, next) {
  try {
    const { stepId } = req.params;
    const payload = req.body;

    const result = await cdslService.updateFileDownloadBodFmsStatus(
      stepId,
      payload
    );

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data,
      source: result.source,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getFileDownloadBodFms,
  updateFileDownloadBodFmsStatus,
};