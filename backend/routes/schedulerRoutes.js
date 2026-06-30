'use strict';

const express = require('express');
const ctrl    = require('../controllers/schedulerController');
const router  = express.Router();

// POST /scheduler/sync-buddy   — 7:00 AM IST daily
router.post('/sync-buddy',   ctrl.syncBuddy);

// POST /scheduler/init-all     — 8:00 AM IST daily
router.post('/init-all',     ctrl.initAll);

// POST /scheduler/archive-all  — 6:00 PM IST daily
router.post('/archive-all',  ctrl.archiveAll);

module.exports = router;