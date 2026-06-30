const express = require('express');
const router = express.Router();
const botBridge = require('./botBridge');
const db = require('./db');

// Get current deposit world info
router.get('/info', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });
  const worlds = botBridge.getWorlds();
  res.json({ depositWorld: worlds.depositWorld });
});

// Initiate a deposit
router.post('/', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });

  const { amount } = req.body;
  const parsed = parseInt(amount);

  if (!parsed || parsed < 1 || parsed > 100000) {
    return res.status(400).json({ error: 'Amount must be between 1 and 100,000 dirtblocks' });
  }

  try {
    const result = await botBridge.simulateDeposit(req.session.userId, parsed);
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.session.userId);
    res.json({ ...result, newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
