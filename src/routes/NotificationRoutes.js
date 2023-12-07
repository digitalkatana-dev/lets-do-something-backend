const { Router } = require('express');
const { model } = require('mongoose');
const requireAuth = require('../middleware/requireAuth');

const Notification = model('Notification');
const router = Router();

// Create
router.post('/notifications', requireAuth, async (req, res) => {});

module.exports = router;
