const db = require('./db');

function getBalance(userId) {
  const u = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
  return u ? u.balance : 0;
}

function credit(userId, amount, notes = '') {
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
  db.prepare("INSERT INTO transactions (user_id, type, amount, status, notes) VALUES (?, 'credit', ?, 'completed', ?)").run(userId, amount, notes);
}

function debit(userId, amount, notes = '') {
  const u = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
  if (!u || u.balance < amount) throw new Error('Insufficient balance');
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, userId);
  db.prepare("INSERT INTO transactions (user_id, type, amount, status, notes) VALUES (?, 'debit', ?, 'completed', ?)").run(userId, amount, notes);
}

function lockBet(userId, amount) {
  debit(userId, amount, 'bet locked');
  // Record wager for XP, wagering progress, and affiliate
  db._recordWager(userId, amount);
  // Count this as a match played (fires once per player per match)
  const u = db._data().users.find(u => u.id === userId);
  if (u) { u.total_matches = (u.total_matches || 0) + 1; db._save(); }
}

function resolveBet(winnerId, loserId, betAmount, gameMode) {
  const edgeRaw = db.prepare("SELECT value FROM admin_settings WHERE key = 'houseEdge'").get()?.value;
  const edge = (edgeRaw !== undefined && edgeRaw !== null && edgeRaw !== '') ? parseFloat(edgeRaw) : 10;
  const payout = Math.floor(betAmount * 2 * (1 - edge / 100));
  const houseCut = betAmount * 2 - payout;
  credit(winnerId, payout, `won ${gameMode}`);
  // XP for winning
  db._addXP(winnerId, 20);
  const u = db._data().users.find(u => u.id === winnerId);
  if (u) { u.total_wins = (u.total_wins || 0) + 1; db._save(); }
  return { winnerPayout: payout, houseCut };
}

function refundBet(aId, bId, amt) {
  credit(aId, amt, 'tie refund');
  credit(bId, amt, 'tie refund');
}

function getTransactions(userId, limit = 30) {
  return db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
}

function tip(fromId, toId, amount) {
  const from = db.prepare('SELECT balance FROM users WHERE id = ?').get(fromId);
  if (!from || from.balance < amount) throw new Error('Insufficient balance');
  if (amount < 1) throw new Error('Minimum tip is 1 DB');
  debit(fromId, amount, `tip to user #${toId}`);
  credit(toId, amount, `tip from user #${fromId}`);
  db.prepare('INSERT INTO tips (from_id, to_id, amount, note) VALUES (?, ?, ?, ?)').run(fromId, toId, amount, '');
}

module.exports = { getBalance, credit, debit, lockBet, resolveBet, refundBet, getTransactions, tip };
