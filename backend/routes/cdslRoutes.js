const express = require("express");
const cdslController = require("../controllers/cdslController");

const router = express.Router();

router.get(
  "/file-download-bod-fms",
  cdslController.getFileDownloadBodFms
);

router.patch(
  "/file-download-bod-fms/:stepId/status",
  cdslController.updateFileDownloadBodFmsStatus
);

module.exports = router;