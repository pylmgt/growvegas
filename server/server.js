const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');

const db = require('./db');
const economy = require('./economy');
const matchEngine = require('./matchEngine');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const sessionMiddleware = session({
  secret: 'growvegas-2024-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const io = new Server(server);
io.use((socket, next) => { sessionMiddleware(socket.request, {}, next); });

const socketUsers = new Map();
// Chat rate limiting: userId -> last message timestamp
const chatCooldowns = new Map();
// Tip rate limiting
const tipCooldowns = new Map();

function broadcastLobby() {
  io.emit('lobby_update', matchEngine.getLobby());
  io.emit('active_matches_update', matchEngine.getActiveMatches());
}

io.on('connection', (socket) => {
  const sess = socket.request.session;
  const userId = sess?.userId;
  if (userId) {
    socketUsers.set(socket.id, userId);
    const u = db._data().users.find(u => u.id === userId);
    socket.emit('authenticated', {
      balance: economy.getBalance(userId),
      username: sess.username,
      profile: db._getUserPublic(u)
    });
  }
  socket.emit('lobby_update', matchEngine.getLobby());
  socket.emit('active_matches_update', matchEngine.getActiveMatches());
  // Send recent global chat
  const recentChat = db.prepare('SELECT * FROM chat WHERE room = ?').all('global', 40);
  socket.emit('chat_history', recentChat);

  socket.on('join_queue', (data) => {
    const uid = socketUsers.get(socket.id) || sess?.userId;
    if (!uid) return socket.emit('error_msg', 'Please log in first');
    const user = db.prepare('SELECT id, username, balance FROM users WHERE id = ?').get(uid);
    if (!user) return socket.emit('error_msg', 'User not found');
    matchEngine.handleJoinQueue(socket, io, user, data.bet, data.gameMode, broadcastLobby);
  });

  socket.on('leave_queue', () => {
    const uid = socketUsers.get(socket.id) || sess?.userId;
    const left = matchEngine.handleLeaveQueue(socket.id);
    if (left && uid) {
      socket.emit('status_update', { state: 'idle', balance: economy.getBalance(uid), message: 'Left queue — bet refunded' });
      broadcastLobby();
    }
  });

  socket.on('rematch_accept', ({ matchId }) => matchEngine.handleRematchAccept(socket.id, matchId, io, broadcastLobby));
  socket.on('rematch_decline', ({ matchId }) => matchEngine.handleRematchDecline(socket.id, matchId, io, broadcastLobby));
  socket.on('rematch_vote', ({ matchId, gameMode }) => matchEngine.handleVote(socket.id, matchId, gameMode, io, broadcastLobby));
  socket.on('spectate_join', ({ matchId }) => matchEngine.handleSpectatorJoin(socket.id, matchId, io));
  socket.on('spectate_leave', () => matchEngine.handleSpectatorLeave(socket.id));

  // BJ Hit/Stand action
  socket.on('bj_action', ({ matchId, action }) => {
    if (!['hit','stand'].includes(action)) return;
    matchEngine.handleBJAction(socket.id, matchId, action);
  });

  // Chat
  socket.on('chat_send', ({ message, room }) => {
    const uid = socketUsers.get(socket.id) || sess?.userId;
    if (!uid) return;
    const now = Date.now();
    const last = chatCooldowns.get(uid) || 0;
    if (now - last < 1500) return socket.emit('chat_error', 'Too fast! Wait a moment.');
    if (!message || typeof message !== 'string') return;
    const clean = message.trim().substring(0, 200);
    if (!clean) return;
    chatCooldowns.set(uid, now);
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(uid);
    const userFull = db._data().users.find(u2 => u2.id === uid);
    const r = db.prepare('INSERT INTO chat (user_id, username, message, room) VALUES (?, ?, ?, ?)').run(uid, u?.username || '?', clean, room || 'global');
    const msg = { id: r.lastInsertRowid, user_id: uid, username: u?.username, message: clean, room: room || 'global', level: userFull?.level || 1, title: userFull?.title, created_at: new Date().toISOString() };
    io.emit('chat_message', msg);
  });

  socket.on('disconnect', () => {
    matchEngine.handleDisconnect(socket.id);
    socketUsers.delete(socket.id);
    broadcastLobby();
  });
});

// ── Helpers ───────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(req.session.userId);
  if (!u || u.username.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── Auth ──────────────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  try {
    const { username, password, referral_code } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Fill in all fields' });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3–20 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Letters, numbers and _ only' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' });

    // Check referral code
    let referrerId = null;
    if (referral_code) {
      const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referral_code.trim().toUpperCase());
      if (referrer) referrerId = referrer.id;
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (username, password, referral_code, referred_by) VALUES (?, ?, ?, ?)').run(username, hashed, null, referrerId);
    const uid = result.lastInsertRowid;

    // Signup bonus if used referral code
    const bonusAmt = parseInt(db._data().admin_settings.signupBonus || '5');
    if (referrerId && bonusAmt > 0) {
      economy.credit(uid, bonusAmt, 'signup bonus (referral)');
      const u = db._data().users.find(u => u.id === uid);
      if (u) u.signup_bonus_given = true;
      db._save();
    }

    req.session.userId = uid;
    req.session.username = username;
    const user = db._data().users.find(u => u.id === uid);
    res.json({ success: true, user: db._getUserPublic(user) });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already taken' });
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Fill in all fields' });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Wrong username or password' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Wrong username or password' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ success: true, user: db._getUserPublic(user) });
  } catch (e) { res.status(500).json({ error: 'Login failed: ' + e.message }); }
});

app.post('/auth/logout', (req, res) => { req.session.destroy(() => {}); res.json({ success: true }); });

app.get('/auth/me', requireAuth, (req, res) => {
  const user = db._data().users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user: db._getUserPublic(user) });
});

// ── Profile / Settings ────────────────────────────────────────
app.get('/profile/:username', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: db._getUserPublic(user) });
});

app.post('/profile/language', requireAuth, (req, res) => {
  const { language } = req.body || {};
  const allowed = ['en', 'fi', 'tr', 'id', 'lt', 'sv'];
  if (!allowed.includes(language)) return res.status(400).json({ error: 'Invalid language' });
  db.prepare('UPDATE users SET language = ? WHERE id = ?').run(language, req.session.userId);
  res.json({ success: true, language });
});

app.post('/profile/title', requireAuth, (req, res) => {
  const { title } = req.body || {};
  const user = db._data().users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (!user.unlocked_titles || !user.unlocked_titles.includes(title)) return res.status(400).json({ error: 'Title not unlocked' });
  db.prepare('UPDATE users SET title = ? WHERE id = ?').run(title, req.session.userId);
  res.json({ success: true });
});

// ── Tip System ────────────────────────────────────────────────
app.post('/tip', requireAuth, (req, res) => {
  const { toUsername, amount } = req.body || {};
  const amt = parseInt(amount);
  if (!toUsername || !amt || amt < 1) return res.status(400).json({ error: 'Invalid tip' });
  if (amt > 10000) return res.status(400).json({ error: 'Max tip is 10,000 DB' });

  // Rate limit: 1 tip per 10 seconds
  const now = Date.now();
  const last = tipCooldowns.get(req.session.userId) || 0;
  if (now - last < 10000) return res.status(429).json({ error: 'Please wait before tipping again' });
  tipCooldowns.set(req.session.userId, now);

  const toUser = db.prepare('SELECT * FROM users WHERE username = ?').get(toUsername);
  if (!toUser) return res.status(404).json({ error: 'User not found' });
  if (toUser.id === req.session.userId) return res.status(400).json({ error: "Can't tip yourself" });

  try {
    economy.tip(req.session.userId, toUser.id, amt);
    const fromUser = db._data().users.find(u => u.id === req.session.userId);
    res.json({ success: true, newBalance: fromUser?.balance, to: toUsername, amount: amt });
    // Notify recipient if online
    for (const [sid, uid] of socketUsers.entries()) {
      if (uid === toUser.id) {
        io.to(sid).emit('tip_received', { from: fromUser?.username, amount: amt });
      }
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Data endpoints ────────────────────────────────────────────
app.get('/transactions', requireAuth, (req, res) => {
  res.json({ transactions: economy.getTransactions(req.session.userId, 50) });
});

app.get('/worlds', (req, res) => {
  const s = db._data().admin_settings;
  res.json({ depositWorld: s.depositWorld || 'GV-DEPOSIT', withdrawWorld: s.withdrawWorld || 'GV-WITHDRAW', discordLink: s.discordLink || 'https://discord.gg/growvegas' });
});

app.get('/leaderboard', (req, res) => {
  const byBalance = db.prepare('SELECT * FROM users ORDER BY BALANCE').all(10).map(u => ({...u}));
  const byLevel = db.prepare('SELECT * FROM users ORDER BY LEVEL').all(10);
  res.json({ byBalance, byLevel });
});

// ── Affiliate ─────────────────────────────────────────────────
app.get('/affiliate', requireAuth, (req, res) => {
  const user = db._data().users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const referred = db._data().users.filter(u => u.referred_by === user.id).map(u => ({ username: u.username, created_at: u.created_at }));
  const earnings = db._data().transactions.filter(t => t.user_id === user.id && t.type === 'affiliate').sort((a, b) => b.id - a.id).slice(0, 50);
  res.json({ referral_code: user.referral_code, total_referred: referred.length, referred, earnings, total_earnings: user.affiliate_earnings || 0 });
});

// ── Deposit ───────────────────────────────────────────────────
app.post('/deposit/request', requireAuth, (req, res) => {
  const { grow_id, claimed_amount, discord_username } = req.body || {};
  if (!grow_id || !claimed_amount || !discord_username) return res.status(400).json({ error: 'All fields required' });
  const amt = parseInt(claimed_amount);
  if (!amt || amt < 1) return res.status(400).json({ error: 'Invalid amount' });
  const r = db.prepare('INSERT INTO deposits (user_id, grow_id, claimed_amount, discord_username, status, notes) VALUES (?, ?, ?, ?, ?, ?)').run(req.session.userId, grow_id, amt, discord_username, 'pending', '');
  res.json({ success: true, depositId: r.lastInsertRowid });
});

app.get('/deposit/my', requireAuth, (req, res) => {
  const deps = db.prepare('SELECT * FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(req.session.userId, 10);
  res.json({ deposits: deps });
});

// ── Withdraw ──────────────────────────────────────────────────
app.get('/wagering-status', requireAuth, (req, res) => {
  const user = db._data().users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const remaining = Math.max(0, (user.wagering_required || 0) - (user.wagering_completed || 0));
  res.json({
    wagering_required: user.wagering_required || 0,
    wagering_completed: user.wagering_completed || 0,
    remaining,
    unlocked: remaining === 0
  });
});

app.post('/withdraw', requireAuth, (req, res) => {
  const amt = parseInt(req.body?.amount);
  if (!amt || amt < 1) return res.status(400).json({ error: 'Invalid amount' });

  // Check wagering requirement
  const user = db._data().users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const remaining = Math.max(0, (user.wagering_required || 0) - (user.wagering_completed || 0));
  if (remaining > 0) return res.status(400).json({ error: `Wagering requirement not met. ${remaining} DB left to wager before you can withdraw.` });

  try {
    economy.debit(req.session.userId, amt, 'withdrawal request');
    const tradeId = 'WD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const s = db._data().admin_settings;
    db.prepare('INSERT INTO transactions (user_id, type, amount, status, trade_id, world, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.session.userId, 'withdraw', amt, 'pending', tradeId, s.withdrawWorld || 'GV-WITHDRAW', 'pending delivery');
    res.json({ success: true, tradeId, world: s.withdrawWorld, newBalance: economy.getBalance(req.session.userId) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Admin ─────────────────────────────────────────────────────
app.get('/admin/settings', requireAdmin, (req, res) => res.json(db._data().admin_settings));

app.post('/admin/update', requireAdmin, (req, res) => {
  const { key, value } = req.body || {};
  const allowed = ['depositWorld', 'withdrawWorld', 'houseEdge', 'discordLink', 'affiliatePercent', 'signupBonus', 'depositBonusMultiplier', 'depositBonusMax'];
  if (!allowed.includes(key)) return res.status(400).json({ error: 'Invalid key' });
  db.prepare('INSERT OR REPLACE INTO admin_settings (key, value) VALUES (?, ?)').run(key, String(value));
  res.json({ success: true });
});

app.get('/admin/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY BALANCE').all().map(u => db._getUserPublic(u)));
});

app.get('/admin/deposits', requireAdmin, (req, res) => {
  const deps = db._data().deposits.map(d => {
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(d.user_id);
    return { ...d, username: u?.username || '?' };
  }).sort((a, b) => b.id - a.id);
  res.json(deps);
});

app.post('/admin/approve-deposit', requireAdmin, (req, res) => {
  const dep = db.prepare('SELECT * FROM deposits WHERE id = ?').get(parseInt(req.body?.depositId));
  if (!dep) return res.status(404).json({ error: 'Not found' });
  if (dep.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  db.prepare('UPDATE deposits SET status = ? WHERE id = ?').run('approved', dep.id);

  const s = db._data().admin_settings;
  const multiplier = parseFloat(s.depositBonusMultiplier || 2);
  const maxBonus = parseInt(s.depositBonusMax || 20);
  const user = db._data().users.find(u => u.id === dep.user_id);
  const amt = dep.claimed_amount;

  economy.credit(dep.user_id, amt, `deposit approved #${dep.id}`);

  // First deposit bonus
  if (user && !user.first_deposit_bonus_given) {
    const bonus = Math.min(amt * (multiplier - 1), maxBonus);
    if (bonus > 0) {
      economy.credit(dep.user_id, bonus, `first deposit bonus (${multiplier}x, max ${maxBonus})`);
      // Set wagering requirement: 5x deposited amount
      user.wagering_required = (user.wagering_required || 0) + amt * 5;
      user.first_deposit_bonus_given = true;
      db._save();
    }
  }

  const updatedUser = db._data().users.find(u => u.id === dep.user_id);
  res.json({ success: true, newBalance: updatedUser?.balance, username: updatedUser?.username });
});

app.post('/admin/reject-deposit', requireAdmin, (req, res) => {
  const dep = db.prepare('SELECT * FROM deposits WHERE id = ?').get(parseInt(req.body?.depositId));
  if (!dep) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE deposits SET status = ? WHERE id = ?').run('rejected', dep.id);
  res.json({ success: true });
});

app.post('/admin/adjust', requireAdmin, (req, res) => {
  const amt = parseInt(req.body?.amount), uid = parseInt(req.body?.userId);
  if (amt > 0) economy.credit(uid, amt, 'admin credit');
  else if (amt < 0) try { economy.debit(uid, -amt, 'admin debit'); } catch {}
  const u = db._data().users.find(u => u.id === uid);
  res.json({ success: true, newBalance: u?.balance });
});

app.get('/admin/transactions', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM transactions JOIN users').all(100));
});

server.listen(PORT, () => {
  console.log('\n  ==========================================');
  console.log(`  GrowVegas running at http://localhost:${PORT}`);
  console.log('  ==========================================\n');
});
