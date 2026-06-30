const db = require('./db');
const economy = require('./economy');
const veme = require('./games/veme');
const qq = require('./games/qq');
const csn = require('./games/csn');
const bj = require('./games/bj');

const GAME_MODES = { VEME: veme, QQ: qq, CSN: csn, BJ: bj };
const queue = new Map();           // socketId -> entry
const activeMatches = new Map();   // matchId -> match state
const spectators = new Map();      // matchId -> Set of socketIds
const rematchPending = new Map();  // matchId -> { playerA, playerB, bet, votes, timer, accepted }

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function getLobby() {
  return Array.from(queue.values()).map(e => ({
    username: e.user.username, bet: e.bet, gameMode: e.gameMode
  }));
}

function getActiveMatches() {
  return Array.from(activeMatches.values()).map(m => ({
    matchId: m.matchId,
    playerA: m.playerA.user.username,
    playerB: m.playerB.user.username,
    gameMode: m.gameMode,
    bet: m.bet,
    state: m.state || 'in-progress'
  }));
}

function broadcastToSpectators(matchId, event, data, io) {
  const specs = spectators.get(matchId);
  if (!specs) return;
  specs.forEach(sid => io.to(sid).emit(event, { ...data, spectating: true }));
}

async function runMatch(matchId, playerA, playerB, bet, gameMode, io, broadcastLobby) {
  // Store match state for spectators
  const matchState = { matchId, playerA, playerB, bet, gameMode, state: 'starting' };
  activeMatches.set(matchId, matchState);
  if (broadcastLobby) broadcastLobby();

  try {
    const mfData = { bet, gameMode };
    io.to(playerA.socketId).emit('match_found', { ...mfData, opponent: playerB.user.username });
    io.to(playerB.socketId).emit('match_found', { ...mfData, opponent: playerA.user.username });
    broadcastToSpectators(matchId, 'spec_match_found', { playerA: playerA.user.username, playerB: playerB.user.username, bet, gameMode }, io);
    await delay(1800);

    matchState.state = 'countdown';
    for (let i = 3; i >= 1; i--) {
      io.to(playerA.socketId).emit('countdown', { count: i });
      io.to(playerB.socketId).emit('countdown', { count: i });
      broadcastToSpectators(matchId, 'spec_countdown', { count: i }, io);
      await delay(1000);
    }

    matchState.state = 'playing';

    if (gameMode === 'BJ') {
      await runBJMatch(matchId, playerA, playerB, bet, io, broadcastLobby, matchState);
      return;
    }

    const result = GAME_MODES[gameMode].resolveGame(
      { id: playerA.user.id, username: playerA.user.username },
      { id: playerB.user.id, username: playerB.user.username }, bet
    );
    finishMatch(matchId, playerA, playerB, bet, gameMode, result, io, broadcastLobby);

  } catch (err) {
    console.error('[Match error]', err.stack || err);
    try { economy.credit(playerA.user.id, bet, 'error refund'); } catch {}
    try { economy.credit(playerB.user.id, bet, 'error refund'); } catch {}
    io.to(playerA.socketId).emit('status_update', { state: 'idle', error: 'Match error — bet refunded' });
    io.to(playerB.socketId).emit('status_update', { state: 'idle', error: 'Match error — bet refunded' });
    activeMatches.delete(matchId);
    spectators.delete(matchId);
    if (broadcastLobby) broadcastLobby();
  }
}

// ── BJ pending actions: socketId -> 'hit' | 'stand' ──────────
const bjActions = new Map(); // matchId -> { resolveA, resolveB }

function handleBJAction(socketId, matchId, action) {
  const pending = bjActions.get(matchId);
  if (!pending) {
    console.log(`[BJ] No pending action for match ${matchId}`);
    return;
  }
  console.log(`[BJ] Action received: ${action} from socket ${socketId} | matchId=${matchId}`);
  if (pending.socketIdA === socketId && pending.resolveA) {
    const fn = pending.resolveA;
    pending.resolveA = null;
    fn(action);
  } else if (pending.socketIdB === socketId && pending.resolveB) {
    const fn = pending.resolveB;
    pending.resolveB = null;
    fn(action);
  } else {
    console.log(`[BJ] No resolver found for socket ${socketId} — already resolved or wrong match`);
  }
}

// Waits for a player action (hit/stand) or times out after `ms`
function waitForAction(matchId, side, timeoutMs) {
  return new Promise(resolve => {
    // MUST get existing object and mutate it — don't replace it
    let pending = bjActions.get(matchId);
    if (!pending) return resolve('stand'); // safety

    let resolved = false;
    function doResolve(action) {
      if (resolved) return;
      resolved = true;
      resolve(action);
    }

    if (side === 'A') pending.resolveA = doResolve;
    else pending.resolveB = doResolve;
    // No need to re-set — we mutated the existing object

    setTimeout(() => {
      if (!resolved) {
        if (side === 'A') { pending.resolveA = null; }
        else { pending.resolveB = null; }
        doResolve('stand');
      }
    }, timeoutMs);
  });
}

async function runBJMatch(matchId, playerA, playerB, bet, io, broadcastLobby, matchState) {
  const { rollGem, resolveFromHands } = require('./games/bj');
  const TIMER = 10000; // 10 seconds per decision
  const MAX_ROUNDS = 3;

  bjActions.set(matchId, {
    socketIdA: playerA.socketId,
    socketIdB: playerB.socketId,
    resolveA: null, resolveB: null
  });

  io.to(playerA.socketId).emit('bj_start', { myName: playerA.user.username, oppName: playerB.user.username, matchId });
  io.to(playerB.socketId).emit('bj_start', { myName: playerB.user.username, oppName: playerA.user.username, matchId });
  broadcastToSpectators(matchId, 'spec_bj_start', { playerA: playerA.user.username, playerB: playerB.user.username }, io);
  await delay(800);

  const cardsA = [], cardsB = [];
  let totalA = 0, totalB = 0;
  let stoodA = false, stoodB = false;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const skipA = stoodA || totalA > 21;
    const skipB = stoodB || totalB > 21;

    // Both already done — end early
    if (skipA && skipB) break;

    // Deal gem to each active player
    const gemA = skipA ? null : rollGem();
    const gemB = skipB ? null : rollGem();
    if (gemA !== null) { cardsA.push(gemA); totalA += gemA; }
    if (gemB !== null) { cardsB.push(gemB); totalB += gemB; }

    // Emit gem reveal to both players
    io.to(playerA.socketId).emit('bj_round', {
      round, myGem: gemA, myTotal: totalA, myBust: totalA > 21,
      oppGem: gemB, oppTotal: totalB, oppBust: totalB > 21,
      myStood: stoodA, oppStood: stoodB
    });
    io.to(playerB.socketId).emit('bj_round', {
      round, myGem: gemB, myTotal: totalB, myBust: totalB > 21,
      oppGem: gemA, oppTotal: totalA, oppBust: totalA > 21,
      myStood: stoodB, oppStood: stoodA
    });
    broadcastToSpectators(matchId, 'spec_bj_round', {
      round, gemA, totalA, bustA: totalA > 21, gemB, totalB, bustB: totalB > 21
    }, io);

    // Auto-stand anyone who just busted
    if (totalA > 21) stoodA = true;
    if (totalB > 21) stoodB = true;

    // Last round — no need to ask hit/stand
    if (round === MAX_ROUNDS) break;

    // Ask players who haven't stood/busted yet
    const needsA = !stoodA && totalA <= 21;
    const needsB = !stoodB && totalB <= 21;

    if (!needsA && !needsB) break;

    // Send decision prompt to relevant players
    if (needsA) io.to(playerA.socketId).emit('bj_action_prompt', { round, total: totalA, timerSecs: 10, matchId });
    if (needsB) io.to(playerB.socketId).emit('bj_action_prompt', { round, total: totalB, timerSecs: 10, matchId });

    // Also notify about opponent standing if applicable
    if (!needsA) io.to(playerB.socketId).emit('bj_opp_stood', {});
    if (!needsB) io.to(playerA.socketId).emit('bj_opp_stood', {});

    // Wait for decisions (parallel)
    const promises = [];
    if (needsA) promises.push(waitForAction(matchId, 'A', TIMER).then(a => { if (a === 'stand') stoodA = true; io.to(playerA.socketId).emit('bj_action_confirmed', { action: a }); io.to(playerB.socketId).emit('bj_opp_action', { action: a }); }));
    if (needsB) promises.push(waitForAction(matchId, 'B', TIMER).then(a => { if (a === 'stand') stoodB = true; io.to(playerB.socketId).emit('bj_action_confirmed', { action: a }); io.to(playerA.socketId).emit('bj_opp_action', { action: a }); }));
    await Promise.all(promises);
    await delay(600); // brief pause before next round
  }

  bjActions.delete(matchId);

  const pA = { id: playerA.user.id, username: playerA.user.username };
  const pB = { id: playerB.user.id, username: playerB.user.username };
  const result = resolveFromHands(pA, pB, cardsA, cardsB);
  await delay(500);
  finishMatch(matchId, playerA, playerB, bet, 'BJ', result, io, broadcastLobby);
}

function finishMatch(matchId, playerA, playerB, bet, gameMode, result, io, broadcastLobby) {
  const winStr = result.winnerId !== null ? String(result.winnerId) : null;
  const aWon = winStr !== null && winStr === String(playerA.user.id);
  const bWon = winStr !== null && winStr === String(playerB.user.id);

  console.log(`[RESULT] ${gameMode} | ${playerA.user.username}(${aWon?'WIN':'LOSS'}) vs ${playerB.user.username}(${bWon?'WIN':'LOSS'}) | winner=${winStr}`);

  db.prepare('INSERT INTO matches (player_a, player_b, game_mode, bet, winner_id, result_data, status) VALUES (?,?,?,?,?,?,?)')
    .run(playerA.user.id, playerB.user.id, gameMode, bet, result.winnerId||null, JSON.stringify(result), 'completed');

  let payoutInfo = {};
  if (result.isTie) { economy.refundBet(playerA.user.id, playerB.user.id, bet); payoutInfo={tie:true}; }
  else if (aWon) { payoutInfo = economy.resolveBet(playerA.user.id, playerB.user.id, bet, gameMode); }
  else if (bWon) { payoutInfo = economy.resolveBet(playerB.user.id, playerA.user.id, bet, gameMode); }

  const balA = economy.getBalance(playerA.user.id);
  const balB = economy.getBalance(playerB.user.id);

  const resultA = { result, isWinner:aWon, isTie:result.isTie, payout:payoutInfo, newBalance:balA, matchId };
  const resultB = { result, isWinner:bWon, isTie:result.isTie, payout:payoutInfo, newBalance:balB, matchId };

  io.to(playerA.socketId).emit('game_result', resultA);
  io.to(playerB.socketId).emit('game_result', resultB);
  broadcastToSpectators(matchId, 'spec_result', { result, playerA: playerA.user.username, playerB: playerB.user.username, aWon, bWon, isTie: result.isTie }, io);

  // Update match state
  const ms = activeMatches.get(matchId);
  if (ms) ms.state = 'rematch';

  // For non-BJ games: delay rematch offer so client spin animation (3.8s) finishes first
  // For BJ: offer immediately since result already shown after rounds
  const rematchDelay = gameMode === 'BJ' ? 500 : 5000;
  setTimeout(() => {
    startRematchPhase(matchId, playerA, playerB, bet, io, broadcastLobby);
  }, rematchDelay);
}

function startRematchPhase(matchId, playerA, playerB, bet, io, broadcastLobby) {
  rematchPending.set(matchId, {
    playerA, playerB, bet,
    acceptedA: false, acceptedB: false,
    voteA: null, voteB: null,
    phase: 'accept' // 'accept' -> 'vote' -> 'done'
  });

  const rm = rematchPending.get(matchId);

  io.to(playerA.socketId).emit('rematch_offer', { matchId, opponentName: playerB.user.username, timeoutSecs: 30 });
  io.to(playerB.socketId).emit('rematch_offer', { matchId, opponentName: playerA.user.username, timeoutSecs: 30 });

  // 30 second timeout
  rm.timer = setTimeout(() => {
    const entry = rematchPending.get(matchId);
    if (entry && entry.phase === 'accept') {
      io.to(playerA.socketId).emit('rematch_expired', {});
      io.to(playerB.socketId).emit('rematch_expired', {});
      io.to(playerA.socketId).emit('status_update', { state: 'idle', balance: economy.getBalance(playerA.user.id) });
      io.to(playerB.socketId).emit('status_update', { state: 'idle', balance: economy.getBalance(playerB.user.id) });
      rematchPending.delete(matchId);
      activeMatches.delete(matchId);
      spectators.delete(matchId);
      if (broadcastLobby) broadcastLobby();
    }
  }, 30000);
}

function handleRematchAccept(socketId, matchId, io, broadcastLobby) {
  const rm = rematchPending.get(matchId);
  if (!rm || rm.phase !== 'accept') return;

  const isA = rm.playerA.socketId === socketId;
  const isB = rm.playerB.socketId === socketId;
  if (!isA && !isB) return;

  if (isA) rm.acceptedA = true;
  if (isB) rm.acceptedB = true;

  // Notify opponent
  if (isA) io.to(rm.playerB.socketId).emit('rematch_opp_ready', { ready: true });
  if (isB) io.to(rm.playerA.socketId).emit('rematch_opp_ready', { ready: true });

  if (rm.acceptedA && rm.acceptedB) {
    clearTimeout(rm.timer);
    rm.phase = 'vote';
    io.to(rm.playerA.socketId).emit('rematch_vote_start', { matchId });
    io.to(rm.playerB.socketId).emit('rematch_vote_start', { matchId });
  }
}

function handleRematchDecline(socketId, matchId, io, broadcastLobby) {
  const rm = rematchPending.get(matchId);
  if (!rm) return;
  clearTimeout(rm.timer);
  io.to(rm.playerA.socketId).emit('rematch_declined', {});
  io.to(rm.playerB.socketId).emit('rematch_declined', {});
  io.to(rm.playerA.socketId).emit('status_update', { state: 'idle', balance: economy.getBalance(rm.playerA.user.id) });
  io.to(rm.playerB.socketId).emit('status_update', { state: 'idle', balance: economy.getBalance(rm.playerB.user.id) });
  rematchPending.delete(matchId);
  activeMatches.delete(matchId);
  spectators.delete(matchId);
  if (broadcastLobby) broadcastLobby();
}

function handleVote(socketId, matchId, gameMode, io, broadcastLobby) {
  const rm = rematchPending.get(matchId);
  if (!rm || rm.phase !== 'vote') return;
  if (!GAME_MODES[gameMode]) return;

  const isA = rm.playerA.socketId === socketId;
  const isB = rm.playerB.socketId === socketId;
  if (!isA && !isB) return;

  if (isA) { rm.voteA = gameMode; io.to(rm.playerB.socketId).emit('rematch_opp_voted', {}); }
  if (isB) { rm.voteB = gameMode; io.to(rm.playerA.socketId).emit('rematch_opp_voted', {}); }

  if (rm.voteA && rm.voteB) {
    rm.phase = 'done';
    const { voteA, voteB, playerA, playerB, bet } = rm;

    if (voteA === voteB) {
      // Same vote — start immediately
      io.to(playerA.socketId).emit('rematch_mode_selected', { gameMode: voteA, spun: false });
      io.to(playerB.socketId).emit('rematch_mode_selected', { gameMode: voteA, spun: false });
      setTimeout(() => startRematch(matchId, playerA, playerB, bet, voteA, io, broadcastLobby), 1500);
    } else {
      // Different votes — spin wheel with only the two voted modes
      const chosen = Math.random() < 0.5 ? voteA : voteB;
      io.to(playerA.socketId).emit('rematch_spin', { modeA: voteA, modeB: voteB, chosen });
      io.to(playerB.socketId).emit('rematch_spin', { modeA: voteA, modeB: voteB, chosen });
      broadcastToSpectators(matchId, 'spec_vote_spin', { modeA: voteA, modeB: voteB, chosen }, io);
      setTimeout(() => {
        io.to(playerA.socketId).emit('rematch_mode_selected', { gameMode: chosen, spun: true });
        io.to(playerB.socketId).emit('rematch_mode_selected', { gameMode: chosen, spun: true });
        setTimeout(() => startRematch(matchId, playerA, playerB, bet, chosen, io, broadcastLobby), 2000);
      }, 4000);
    }
    rematchPending.delete(matchId);
  }
}

async function startRematch(matchId, playerA, playerB, bet, gameMode, io, broadcastLobby) {
  // Lock bets again
  try { economy.lockBet(playerA.user.id, bet); } catch { 
    io.to(playerA.socketId).emit('error_msg', 'Insufficient balance for rematch');
    io.to(playerA.socketId).emit('status_update', { state: 'idle' });
    io.to(playerB.socketId).emit('status_update', { state: 'idle' });
    return;
  }
  try { economy.lockBet(playerB.user.id, bet); } catch {
    economy.credit(playerA.user.id, bet, 'rematch refund');
    io.to(playerB.socketId).emit('error_msg', 'Insufficient balance for rematch');
    io.to(playerA.socketId).emit('status_update', { state: 'idle' });
    io.to(playerB.socketId).emit('status_update', { state: 'idle' });
    return;
  }
  const newMatchId = `rm_${matchId}_${Date.now()}`;
  // Transfer spectators
  const oldSpecs = spectators.get(matchId) || new Set();
  spectators.set(newMatchId, oldSpecs);
  spectators.delete(matchId);
  activeMatches.delete(matchId);
  runMatch(newMatchId, playerA, playerB, bet, gameMode, io, broadcastLobby);
}

function handleSpectatorJoin(socketId, matchId, io) {
  if (!activeMatches.has(matchId)) {
    io.to(socketId).emit('spec_error', 'Match not found or already ended');
    return;
  }
  if (!spectators.has(matchId)) spectators.set(matchId, new Set());
  spectators.get(matchId).add(socketId);
  const m = activeMatches.get(matchId);
  io.to(socketId).emit('spec_joined', {
    matchId, playerA: m.playerA.user.username,
    playerB: m.playerB.user.username, gameMode: m.gameMode,
    bet: m.bet, state: m.state
  });
}

function handleSpectatorLeave(socketId) {
  spectators.forEach(set => set.delete(socketId));
}

function handleJoinQueue(socket, io, user, bet, gameMode, broadcastLobby) {
  const parsedBet = parseInt(bet);
  if (!parsedBet || parsedBet < 1) return socket.emit('error_msg', 'Invalid bet amount');
  if (economy.getBalance(user.id) < parsedBet) return socket.emit('error_msg', 'Not enough balance — deposit first!');
  try { economy.lockBet(user.id, parsedBet); } catch (e) { return socket.emit('error_msg', e.message); }

  let matched = null;
  for (const [sid, entry] of queue.entries()) {
    if (entry.bet === parsedBet && sid !== socket.id) {
      matched = { socketId: sid, ...entry }; queue.delete(sid); break;
    }
  }

  if (matched) {
    const mode = (GAME_MODES[gameMode] ? gameMode : null)
      || (GAME_MODES[matched.gameMode] ? matched.gameMode : null) || 'VEME';
    const matchId = `m_${user.id}_${matched.user.id}_${Date.now()}`;
    if (broadcastLobby) broadcastLobby();
    runMatch(matchId, { socketId: socket.id, user }, matched, parsedBet, mode, io, broadcastLobby);
  } else {
    queue.set(socket.id, { user, bet: parsedBet, gameMode, socket });
    socket.emit('status_update', { state: 'queue' });
    if (broadcastLobby) broadcastLobby();
  }
}

function handleLeaveQueue(socketId) {
  const entry = queue.get(socketId);
  if (entry) {
    try { economy.credit(entry.user.id, entry.bet, 'queue leave refund'); } catch {}
    queue.delete(socketId); return true;
  }
  return false;
}

function handleDisconnect(socketId) {
  handleLeaveQueue(socketId);
  handleSpectatorLeave(socketId);
  // Cancel rematch if player disconnects
  rematchPending.forEach((rm, matchId) => {
    if (rm.playerA.socketId === socketId || rm.playerB.socketId === socketId) {
      clearTimeout(rm.timer);
      rematchPending.delete(matchId);
    }
  });
}

module.exports = {
  handleJoinQueue, handleLeaveQueue, handleDisconnect,
  handleRematchAccept, handleRematchDecline, handleVote,
  handleSpectatorJoin, handleSpectatorLeave,
  handleBJAction,
  getLobby, getActiveMatches
};
