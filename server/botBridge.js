const db = require('./db');
const crypto = require('crypto');

function generateTradeId() {
  return 'GV-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function getWorlds() {
  const depositWorld = db.prepare("SELECT value FROM admin_settings WHERE key='depositWorld'").get();
  const withdrawWorld = db.prepare("SELECT value FROM admin_settings WHERE key='withdrawWorld'").get();
  return {
    depositWorld: depositWorld?.value || 'GV-DEPOSIT',
    withdrawWorld: withdrawWorld?.value || 'GV-WITHDRAW'
  };
}

function simulateDeposit(userId, amount) {
  return new Promise((resolve) => {
    const tradeId = generateTradeId();
    const { depositWorld } = getWorlds();

    db.prepare(
      "INSERT INTO transactions (user_id, type, amount, status, trade_id, world, notes) VALUES (?, 'deposit', ?, 'pending', ?, ?, ?)"
    ).run(userId, amount, tradeId, depositWorld, `Deposit request via ${depositWorld}`);

    console.log(`[BotBridge] Deposit initiated | TradeID: ${tradeId} | User: ${userId} | Amount: ${amount}`);

    const delay = 2000 + Math.random() * 2000;
    setTimeout(() => {
      try {
        db.prepare("UPDATE transactions SET status=? WHERE trade_id=?").run('completed', tradeId);
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
        console.log(`[BotBridge] Deposit CONFIRMED | TradeID: ${tradeId}`);
        const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
        resolve({ success: true, tradeId, amount, world: depositWorld, newBalance: user?.balance });
      } catch (err) {
        db.prepare("UPDATE transactions SET status=? WHERE trade_id=?").run('failed', tradeId);
        resolve({ success: false, tradeId, error: err.message });
      }
    }, delay);
  });
}

function simulateWithdraw(userId, amount) {
  return new Promise((resolve) => {
    const tradeId = generateTradeId();
    const { withdrawWorld } = getWorlds();

    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (!user || user.balance < amount) {
      return resolve({ success: false, tradeId: null, error: 'Insufficient balance' });
    }

    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, userId);
    db.prepare(
      "INSERT INTO transactions (user_id, type, amount, status, trade_id, world, notes) VALUES (?, 'withdraw', ?, 'pending', ?, ?, ?)"
    ).run(userId, amount, tradeId, withdrawWorld, `Withdraw request to ${withdrawWorld}`);

    console.log(`[BotBridge] Withdraw initiated | TradeID: ${tradeId} | User: ${userId} | Amount: ${amount}`);

    const delay = 3000 + Math.random() * 3000;
    setTimeout(() => {
      const success = Math.random() > 0.05;
      if (success) {
        db.prepare("UPDATE transactions SET status=? WHERE trade_id=?").run('completed', tradeId);
        console.log(`[BotBridge] Withdraw DELIVERED | TradeID: ${tradeId}`);
        const updated = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
        resolve({ success: true, tradeId, amount, world: withdrawWorld, newBalance: updated?.balance });
      } else {
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
        db.prepare("UPDATE transactions SET status=? WHERE trade_id=?").run('failed', tradeId);
        console.log(`[BotBridge] Withdraw FAILED | TradeID: ${tradeId} | Refunded`);
        const updated = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
        resolve({ success: false, tradeId, error: 'Bot delivery failed. Balance refunded.', world: withdrawWorld, newBalance: updated?.balance });
      }
    }, delay);
  });
}

function getTransactionLog(userId, limit = 10) {
  return db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
}

module.exports = { simulateDeposit, simulateWithdraw, generateTradeId, getWorlds, getTransactionLog };
