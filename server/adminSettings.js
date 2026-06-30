const express = require('express');
const router = express.Router();
const db = require('./db');

function isAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.username !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.get('/', isAdmin, (req, res) => {
  const settings = db._data().admin_settings;
  res.json(settings);
});

router.post('/update', isAdmin, (req, res) => {
  const { key, value } = req.body;
  const allowed = ['depositWorld', 'withdrawWorld', 'houseEdge'];
  if (!allowed.includes(key)) return res.status(400).json({ error: 'Invalid setting key' });
  db.prepare('INSERT OR REPLACE INTO admin_settings (key, value) VALUES (?, ?)').run(key, String(value));
  res.json({ success: true, key, value });
});

router.get('/users', isAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, balance, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

router.get('/transactions', isAdmin, (req, res) => {
  const txns = db.prepare('SELECT * FROM transactions JOIN users ON transactions.user_id = users.id ORDER BY created_at DESC LIMIT 100').all(100);
  res.json(txns);
});

router.post('/adjust', isAdmin, (req, res) => {
  const { userId, amount } = req.body;
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(parseInt(amount), userId);
  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
  res.json({ success: true, newBalance: user.balance });
});

module.exports = router;
