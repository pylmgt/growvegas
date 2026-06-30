const express = require('express');
const router = express.Router();
const botBridge = require('./botBridge');
const db = require('./db');

// Get current withdraw world info
router.get('/info', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });
  const worlds = botBridge.getWorlds();
  res.json({ withdrawWorld: worlds.withdrawWorld });
});

// Initiate a withdrawal
router.post('/', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });

  const { amount } = req.body;
  const parsed = parseInt(amount);

  if (!parsed || parsed < 1) {
    return res.status(400).json({ error: 'Invalid withdrawal amount' });
  }

  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.balance < parsed) {
    return res.status(400).json({ error: 'Insufficient dirtblock balance' });
  }

  try {
    const result = await botBridge.simulateWithdraw(req.session.userId, parsed);
    const updatedUser = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.session.userId);
    res.json({ ...result, newBalance: updatedUser.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
