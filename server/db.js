const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, '../growvegas-data.json');

const DEFAULT = {
  users: [],
  transactions: [],
  matches: [],
  deposits: [],
  chat_messages: [],
  affiliates: [],
  tips: [],
  admin_settings: {
    depositWorld: 'GV-DEPOSIT',
    withdrawWorld: 'GV-WITHDRAW',
    houseEdge: '10',
    discordLink: 'https://discord.gg/growvegas',
    affiliatePercent: '1',
    signupBonus: '5',
    depositBonusMultiplier: '2',
    depositBonusMax: '20'
  },
  _id: { users: 1, transactions: 1, matches: 1, deposits: 1, chat: 1, tips: 1 }
};

let _d = (() => {
  try { if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch {}
  return JSON.parse(JSON.stringify(DEFAULT));
})();

// Migrate old data: ensure all arrays/fields exist
['deposits','chat_messages','affiliates','tips'].forEach(k => { if (!_d[k]) _d[k] = []; });
['chat','tips'].forEach(k => { if (!_d._id[k]) _d._id[k] = 1; });
if (!_d.admin_settings.affiliatePercent) _d.admin_settings.affiliatePercent = '1';
if (!_d.admin_settings.signupBonus) _d.admin_settings.signupBonus = '5';
if (!_d.admin_settings.depositBonusMultiplier) _d.admin_settings.depositBonusMultiplier = '2';
if (!_d.admin_settings.depositBonusMax) _d.admin_settings.depositBonusMax = '20';
// Migrate users: add missing fields
_d.users.forEach(u => {
  if (u.xp === undefined) u.xp = 0;
  if (u.level === undefined) u.level = 1;
  if (u.total_wagered === undefined) u.total_wagered = 0;
  if (u.total_wins === undefined) u.total_wins = 0;
  if (u.total_matches === undefined) u.total_matches = 0;
  if (u.referral_code === undefined) u.referral_code = genCode(u.username);
  if (u.referred_by === undefined) u.referred_by = null;
  if (u.title === undefined) u.title = null;
  if (u.language === undefined) u.language = 'en';
  if (u.signup_bonus_given === undefined) u.signup_bonus_given = false;
  if (u.first_deposit_bonus_given === undefined) u.first_deposit_bonus_given = false;
  if (u.wagering_required === undefined) u.wagering_required = 0;
  if (u.wagering_completed === undefined) u.wagering_completed = 0;
  if (u.affiliate_earnings === undefined) u.affiliate_earnings = 0;
});

function genCode(username) {
  return (username.substring(0, 4).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase());
}

const save = () => fs.writeFileSync(DB_PATH, JSON.stringify(_d, null, 2));
save();

// ── XP / Level system ─────────────────────────────────────────
function xpForLevel(lvl) { return lvl * 100; }
function addXP(userId, amount) {
  const u = _d.users.find(u => u.id === userId); if (!u) return;
  u.xp = (u.xp || 0) + amount;
  while (u.xp >= xpForLevel(u.level)) {
    u.xp -= xpForLevel(u.level);
    u.level++;
  }
  checkTitleUnlock(u);
  save();
}

const TITLES = [
  { id: 'newcomer', name: 'Newcomer', req: lvl => lvl >= 1 },
  { id: 'gambler', name: 'Gambler', req: (lvl, u) => u.total_wagered >= 500 },
  { id: 'high_roller', name: 'High Roller', req: (lvl, u) => u.total_wagered >= 5000 },
  { id: 'veteran', name: 'Veteran', req: lvl => lvl >= 10 },
  { id: 'legend', name: 'Legend', req: lvl => lvl >= 25 },
  { id: 'winner', name: 'Winner', req: (lvl, u) => u.total_wins >= 50 },
];

function checkTitleUnlock(u) {
  if (!u.unlocked_titles) u.unlocked_titles = [];
  TITLES.forEach(t => {
    if (!u.unlocked_titles.includes(t.id) && t.req(u.level, u)) {
      u.unlocked_titles.push(t.id);
      if (!u.title) u.title = t.id;
    }
  });
}

function getUserPublic(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, balance: u.balance,
    level: u.level || 1, xp: u.xp || 0, xpNeeded: xpForLevel(u.level || 1),
    title: u.title, unlocked_titles: u.unlocked_titles || [],
    referral_code: u.referral_code,
    total_wagered: u.total_wagered || 0,
    total_wins: u.total_wins || 0,
    total_matches: u.total_matches || 0,
    language: u.language || 'en',
    wagering_required: u.wagering_required || 0,
    wagering_completed: u.wagering_completed || 0,
    affiliate_earnings: u.affiliate_earnings || 0
  };
}

// ── Wagering tracking ─────────────────────────────────────────
function recordWager(userId, amount) {
  const u = _d.users.find(u => u.id === userId); if (!u) return;
  u.total_wagered = (u.total_wagered || 0) + amount;
  // Progress wagering requirement
  if ((u.wagering_required || 0) > (u.wagering_completed || 0)) {
    u.wagering_completed = Math.min(u.wagering_required, (u.wagering_completed || 0) + amount);
  }
  addXP(userId, Math.floor(amount / 10) + 1);
  // Affiliate payout
  if (u.referred_by) {
    const pct = parseFloat(_d.admin_settings.affiliatePercent || 1) / 100;
    const earning = Math.floor(amount * pct);
    if (earning > 0) {
      const referrer = _d.users.find(u2 => u2.id === u.referred_by);
      if (referrer) {
        referrer.balance += earning;
        referrer.affiliate_earnings = (referrer.affiliate_earnings || 0) + earning;
        _d.transactions.push({
          id: _d._id.transactions++, user_id: referrer.id,
          type: 'affiliate', amount: earning, status: 'completed',
          notes: `Affiliate reward from ${u.username}`, created_at: now()
        });
      }
    }
  }
  save();
}

const now = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

// ── Statement class ───────────────────────────────────────────
class Stmt {
  constructor(sql) { this.sql = sql.trim(); }
  _p(a) { return a.length === 1 && Array.isArray(a[0]) ? a[0] : a; }

  run(...args) {
    const p = this._p(args);
    const S = this.sql.toUpperCase().replace(/\s+/g, ' ');

    if (S.startsWith('INSERT INTO USERS')) {
      const [username, password, referral_code, referred_by] = p;
      if (_d.users.find(u => u.username.toLowerCase() === username.toLowerCase()))
        throw new Error('UNIQUE constraint failed: users.username');
      const id = _d._id.users++;
      const code = genCode(username);
      const user = {
        id, username, password, balance: 0, created_at: now(),
        xp: 0, level: 1, total_wagered: 0, total_wins: 0, total_matches: 0,
        referral_code: code, referred_by: referred_by || null,
        title: 'newcomer', unlocked_titles: ['newcomer'],
        language: 'en', signup_bonus_given: false,
        first_deposit_bonus_given: false,
        wagering_required: 0, wagering_completed: 0,
        affiliate_earnings: 0
      };
      _d.users.push(user);
      save(); return { lastInsertRowid: id, changes: 1 };
    }
    if (S.includes('UPDATE USERS SET BALANCE = BALANCE +')) {
      const [amt, id] = p; const u = _d.users.find(u => u.id === id);
      if (u) { u.balance += amt; save(); } return { changes: u ? 1 : 0 };
    }
    if (S.includes('UPDATE USERS SET BALANCE = BALANCE -')) {
      const [amt, id] = p; const u = _d.users.find(u => u.id === id);
      if (u) { u.balance -= amt; save(); } return { changes: u ? 1 : 0 };
    }
    if (S.includes('UPDATE USERS SET LANGUAGE')) {
      const [lang, id] = p; const u = _d.users.find(u => u.id === id);
      if (u) { u.language = lang; save(); } return { changes: 1 };
    }
    if (S.includes('UPDATE USERS SET TITLE')) {
      const [title, id] = p; const u = _d.users.find(u => u.id === id);
      if (u && u.unlocked_titles && u.unlocked_titles.includes(title)) { u.title = title; save(); }
      return { changes: 1 };
    }
    if (S.startsWith('INSERT INTO TRANSACTIONS')) {
      const id = _d._id.transactions++;
      let tx = { id, created_at: now() };
      if (p.length === 5) [tx.user_id, tx.type, tx.amount, tx.status, tx.notes] = p;
      else if (p.length === 7) [tx.user_id, tx.type, tx.amount, tx.status, tx.trade_id, tx.world, tx.notes] = p;
      else { tx = { id, user_id: p[0], type: p[1], amount: p[2], status: p[3], trade_id: p[4], world: p[5], notes: p[6], created_at: now() }; }
      _d.transactions.push(tx); save(); return { lastInsertRowid: id, changes: 1 };
    }
    if (S.startsWith('INSERT INTO DEPOSITS')) {
      const id = _d._id.deposits++;
      const [user_id, grow_id, claimed_amount, discord_username, status, notes] = p;
      _d.deposits.push({ id, user_id, grow_id, claimed_amount, discord_username, status: status || 'pending', notes: notes || '', created_at: now() });
      save(); return { lastInsertRowid: id, changes: 1 };
    }
    if (S.startsWith('UPDATE DEPOSITS SET STATUS')) {
      const [status, id] = p; const dep = _d.deposits.find(d => d.id === id);
      if (dep) { dep.status = status; dep.reviewed_at = now(); save(); } return { changes: dep ? 1 : 0 };
    }
    if (S.includes('UPDATE TRANSACTIONS SET STATUS')) {
      const [status, trade_id] = p; const tx = _d.transactions.find(t => t.trade_id === trade_id);
      if (tx) { tx.status = status; save(); } return { changes: tx ? 1 : 0 };
    }
    if (S.startsWith('INSERT OR REPLACE INTO ADMIN_SETTINGS') || S.startsWith('INSERT INTO ADMIN_SETTINGS')) {
      const [key, value] = p; _d.admin_settings[key] = value; save(); return { changes: 1 };
    }
    if (S.startsWith('INSERT INTO MATCHES')) {
      const id = _d._id.matches++;
      const [player_a, player_b, game_mode, bet, winner_id, result_data, status] = p;
      _d.matches.push({ id, player_a, player_b, game_mode, bet, winner_id, result_data, status, created_at: now() });
      save(); return { lastInsertRowid: id, changes: 1 };
    }
    if (S.startsWith('INSERT INTO CHAT')) {
      const id = _d._id.chat++;
      const [user_id, username, message, room] = p;
      const msg = { id, user_id, username, message, room: room || 'global', created_at: now() };
      _d.chat_messages.push(msg);
      if (_d.chat_messages.length > 500) _d.chat_messages = _d.chat_messages.slice(-500);
      save(); return { lastInsertRowid: id, msg };
    }
    if (S.startsWith('INSERT INTO TIPS')) {
      const id = _d._id.tips++;
      const [from_id, to_id, amount, note] = p;
      _d.tips.push({ id, from_id, to_id, amount, note: note || '', created_at: now() });
      save(); return { lastInsertRowid: id, changes: 1 };
    }
    return { changes: 0, lastInsertRowid: 0 };
  }

  get(...args) {
    const p = this._p(args);
    const S = this.sql.toUpperCase().replace(/\s+/g, ' ');
    if (S.includes('FROM USERS WHERE ID')) return _d.users.find(u => u.id === p[0]) || null;
    if (S.includes('FROM USERS WHERE USERNAME')) return _d.users.find(u => u.username.toLowerCase() === String(p[0]).toLowerCase()) || null;
    if (S.includes('FROM USERS WHERE REFERRAL_CODE')) return _d.users.find(u => u.referral_code === p[0]) || null;
    if (S.includes('FROM ADMIN_SETTINGS WHERE KEY')) { const v = _d.admin_settings[p[0]]; return v !== undefined ? { key: p[0], value: v } : null; }
    if (S.includes('SELECT BALANCE FROM USERS')) { const u = _d.users.find(u => u.id === p[0]); return u ? { balance: u.balance } : null; }
    if (S.includes('SELECT USERNAME FROM USERS')) { const u = _d.users.find(u => u.id === p[0]); return u ? { username: u.username } : null; }
    if (S.includes('FROM DEPOSITS WHERE ID')) return _d.deposits.find(d => d.id === p[0]) || null;
    return null;
  }

  all(...args) {
    const p = this._p(args);
    const S = this.sql.toUpperCase().replace(/\s+/g, ' ');
    if (S.includes('FROM ADMIN_SETTINGS')) return Object.entries(_d.admin_settings).map(([key, value]) => ({ key, value }));
    if (S.includes('FROM TRANSACTIONS WHERE USER_ID')) {
      const [uid, lim = 30] = p;
      return _d.transactions.filter(t => t.user_id === uid).sort((a, b) => b.id - a.id).slice(0, lim);
    }
    if (S.includes('FROM TRANSACTIONS') && S.includes('JOIN USERS')) {
      const lim = p[0] || 100;
      return _d.transactions.sort((a, b) => b.id - a.id).slice(0, lim).map(t => {
        const u = _d.users.find(u => u.id === t.user_id); return { ...t, username: u?.username || '?' };
      });
    }
    if (S.includes('FROM TRANSACTIONS')) {
      return _d.transactions.sort((a, b) => b.id - a.id).slice(0, p[0] || 100);
    }
    if (S.includes('FROM DEPOSITS WHERE USER_ID')) {
      const uid = p[0], lim = p[1] || 20;
      return _d.deposits.filter(d => d.user_id === uid).sort((a, b) => b.id - a.id).slice(0, lim);
    }
    if (S.includes('FROM DEPOSITS')) {
      return _d.deposits.sort((a, b) => b.id - a.id);
    }
    if (S.includes('FROM CHAT WHERE ROOM')) {
      const [room, lim = 50] = p;
      return _d.chat_messages.filter(m => m.room === room).slice(-lim);
    }
    if (S.includes('FROM USERS ORDER BY LEVEL')) {
      return [..._d.users].sort((a, b) => (b.level || 1) - (a.level || 1) || (b.xp || 0) - (a.xp || 0))
        .slice(0, p[0] || 20).map(u => getUserPublic(u));
    }
    if (S.includes('FROM USERS ORDER BY BALANCE') || S.includes('FROM USERS ORDER BY TOTAL_WAGERED')) {
      return [..._d.users].sort((a, b) => b.balance - a.balance)
        .slice(0, p[0] || 20).map(u => getUserPublic(u));
    }
    if (S.includes('FROM USERS')) {
      return [..._d.users].sort((a, b) => b.balance - a.balance)
        .map(u => ({ id: u.id, username: u.username, balance: u.balance, level: u.level || 1, title: u.title, created_at: u.created_at }));
    }
    return [];
  }
}

const db = {
  prepare(sql) { return new Stmt(sql); },
  exec() {},
  _data() { return _d; },
  _save() { save(); },
  _addXP: addXP,
  _recordWager: recordWager,
  _getUserPublic: getUserPublic,
  _getTitles: () => TITLES,
  _genCode: genCode
};
module.exports = db;
