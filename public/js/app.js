'use strict';

// ── DISCORD LINK — always loaded from admin panel via /worlds ──
// Set in Admin Panel → Discord Link field. Updated by loadWorlds().
const DISCORD_INVITE = ''; // empty — real value comes from server

// ── CURRENCY SYSTEM ───────────────────────────────────────────
let displayCurrency = 'DL'; // DL | WL | BGL

const DL_TO_WL  = 10;   // 1 DL = 10 WL
const DL_TO_BGL = 0.1;  // 1 DL = 0.1 BGL (10 DL = 1 BGL)

function formatCurrency(dlAmount) {
  const n = Number(dlAmount) || 0;
  if (displayCurrency === 'WL') {
    return { val: (n * DL_TO_WL).toLocaleString(), unit: 'WL' };
  } else if (displayCurrency === 'BGL') {
    return { val: (n * DL_TO_BGL).toLocaleString(undefined,{maximumFractionDigits:2}), unit: 'BGL' };
  }
  return { val: n.toLocaleString(), unit: 'DL' };
}

function updateAllBalanceDisplays(dlVal) {
  const { val, unit } = formatCurrency(dlVal);
  const ids = ['balance-display','sb-balance','hw-balance','wd-dropdown-bal'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'wd-dropdown-bal') el.textContent = val + ' ' + unit;
    else el.textContent = val;
  });
  // Update unit labels
  ['bal-unit-display','hw-bal-unit'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = unit;
  });
  const wd = document.getElementById('wd-avail');
  if (wd) wd.textContent = val + ' ' + unit;
}

function setCurrency(cur) {
  displayCurrency = cur;
  document.querySelectorAll('.wd-cur-btn').forEach(b => b.classList.toggle('active', b.dataset.cur === cur));
  // Update wallet button icon to match selected currency
  const iconMap = { DL: '/img/diamond_lock.png', WL: '/img/world_lock.png', BGL: '/img/big_diamond_lock.png' };
  const walletIcon = document.getElementById('wallet-cur-icon');
  if (walletIcon && iconMap[cur]) walletIcon.src = iconMap[cur];
  if (typeof myBal !== 'undefined') updateAllBalanceDisplays(myBal);
}


// ── State ─────────────────────────────────────────────────────
let me=null, myBal=0, selectedMode='VEME', myHistory=[];
let currentMatchId=null, rmTimer=null, myVote=null;
let bjCurrentMatchId=null, bjTimerInterval=null;

const socket = io();

const MODES = {
  VEME:{ name:'VEME', rule:'Roll 0–36 · 0 = Instant Win · Highest wins' },
  QQ:  { name:'QQ',   rule:'Draw 0–9  · 0 = Instant Win · Highest wins' },
  CSN: { name:'CSN',  rule:'Score 0–36 · 0 = Instant Win · Highest wins' },
  BJ:  { name:'BJ',   rule:'3 rounds of gems · Closest to 21 wins · Over 21 = BUST' }
};

const TITLES_MAP = {
  newcomer:'Newcomer', gambler:'Gambler', high_roller:'High Roller 🎰',
  veteran:'Veteran ⭐', legend:'Legend 👑', winner:'Winner 🏆'
};

const PAGE_TITLES = {
  play:'Play', deposit:'Deposit', withdraw:'Withdraw',
  affiliate:'Affiliate', profile:'Profile', admin:'Admin', home:'Home'
};

const LANGS = {
  en:{ winner:'🏆 You Win!', loser:'💀 You Lose', tie:'🤝 Tie Game', find_match:'▶ Find Match',
       nav_home:'Home', nav_affiliate:'Affiliate', nav_profile:'Profile', nav_admin:'Admin',
       join_discord:'Join our Discord', section_games:'GAMES', section_community:'COMMUNITY',
       section_language:'LANGUAGE', hw_sub:'Pick a game and find your match.', find_match_btn:'Find Match' },
  fi:{ winner:'🏆 Sinä voitit!', loser:'💀 Hävisit', tie:'🤝 Tasapeli', find_match:'▶ Etsi ottelu',
       nav_home:'Koti', nav_affiliate:'Kumppanuus', nav_profile:'Profiili', nav_admin:'Ylläpito',
       join_discord:'Liity Discordiin', section_games:'PELIT', section_community:'YHTEISÖ',
       section_language:'KIELI', hw_sub:'Valitse peli ja etsi vastustaja.', find_match_btn:'Etsi ottelu' },
  tr:{ winner:'🏆 Kazandın!', loser:'💀 Kaybettin', tie:'🤝 Beraberlik', find_match:'▶ Maç Bul',
       nav_home:'Ana Sayfa', nav_affiliate:'Ortaklık', nav_profile:'Profil', nav_admin:'Yönetici',
       join_discord:'Discord\'a Katıl', section_games:'OYUNLAR', section_community:'TOPLULUK',
       section_language:'DİL', hw_sub:'Bir oyun seç ve rakip bul.', find_match_btn:'Maç Bul' },
  id:{ winner:'🏆 Kamu Menang!', loser:'💀 Kamu Kalah', tie:'🤝 Seri', find_match:'▶ Cari Pertandingan',
       nav_home:'Beranda', nav_affiliate:'Afiliasi', nav_profile:'Profil', nav_admin:'Admin',
       join_discord:'Gabung Discord', section_games:'PERMAINAN', section_community:'KOMUNITAS',
       section_language:'BAHASA', hw_sub:'Pilih permainan dan cari lawan.', find_match_btn:'Cari Pertandingan' },
  lt:{ winner:'🏆 Tu Laimėjai!', loser:'💀 Tu Pralaimėjai', tie:'🤝 Lygiosios', find_match:'▶ Rasti Varžybas',
       nav_home:'Pradžia', nav_affiliate:'Partnerystė', nav_profile:'Profilis', nav_admin:'Administratorius',
       join_discord:'Prisijunkite prie Discord', section_games:'ŽAIDIMAI', section_community:'BENDRUOMENĖ',
       section_language:'KALBA', hw_sub:'Pasirinkite žaidimą ir raskite varžovą.', find_match_btn:'Rasti Varžybas' },
  sv:{ winner:'🏆 Du Vann!', loser:'💀 Du Förlorade', tie:'🤝 Oavgjort', find_match:'▶ Hitta Match',
       nav_home:'Hem', nav_affiliate:'Affiliate', nav_profile:'Profil', nav_admin:'Admin',
       join_discord:'Gå med i Discord', section_games:'SPEL', section_community:'GEMENSKAP',
       section_language:'SPRÅK', hw_sub:'Välj ett spel och hitta din match.', find_match_btn:'Hitta Match' }
};
let currentLang = 'en';

// Apply translations to all elements tagged with data-i18n
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = LANGS[currentLang]?.[key] || LANGS.en[key];
    if (val) el.textContent = val;
  });
}

// ── Helpers ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => { const e=$(id); e && e.classList.remove('hidden'); };
const hide = id => { const e=$(id); e && e.classList.add('hidden'); };
const setText = (id, v) => { const e=$(id); if(e) e.textContent = v; };
const t = key => LANGS[currentLang]?.[key] || LANGS.en[key] || key;

function toast(msg, type='ok') {
  const el = document.createElement('div');
  el.className = `toast ${type==='error'?'err':type==='info'?'info':type==='warn'?'warn':''}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function api(method, url, body) {
  const opts = { method, headers:{'Content-Type':'application/json'} };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

// ── Balance ───────────────────────────────────────────────────
function setBalance(v, flash) {
  const prev = myBal; myBal = v;
  const el = $('balance-display');
  if (el) {
    el.classList.remove('bal-flash-up','bal-flash-dn');
    void el.offsetWidth;
    if (flash==='up' || (flash==null && v>prev)) el.classList.add('bal-flash-up');
    else if (flash==='dn' || (flash==null && v<prev)) el.classList.add('bal-flash-dn');
  }
  updateAllBalanceDisplays(v);
}

// ── Language ──────────────────────────────────────────────────
function setLang(lang) {
  currentLang = lang;
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang===lang));
  applyTranslations();
  if (me) api('POST','/profile/language',{language:lang}).catch(()=>{});
}
document.querySelectorAll('.lang-btn').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));

// ── Active game session tracker ───────────────────────────────
let gameSessionActive = false;

function setGameSessionActive(active) {
  gameSessionActive = active;
  const btn = document.getElementById('resume-game-btn');
  if (!btn) return;
  if (active) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

// ── Pages ─────────────────────────────────────────────────────
function showPage(id, mode) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.snav-btn').forEach(b => b.classList.remove('active'));
  const pg = $('page-'+id); if (pg) pg.classList.add('active');
  const sel = mode ? `.snav-btn[data-page="${id}"][data-mode="${mode}"]` : `.snav-btn[data-page="${id}"]`;
  document.querySelector(sel)?.classList.add('active');
  setText('page-title', PAGE_TITLES[id] || id);
  if (id==='deposit')   { loadWorlds(); loadMyDeposits(); loadWageringStatus(); }
  if (id==='withdraw')  { loadWorlds(); loadWageringStatus(); }
  if (id==='affiliate') { loadAffiliate(); }
  if (id==='profile')   { loadProfile(); }
  if (id==='admin')     { loadAdminSettings(); loadAdminDeposits(); loadAdminUsers(); }
  if (id==='play' && mode && MODES[mode]) { selectedMode = mode; updateModeUI(); }
  // Show resume button whenever user navigates away from play page while game is active
  const resumeBtn = document.getElementById('resume-game-btn');
  if (resumeBtn) {
    resumeBtn.classList.toggle('hidden', id === 'play' || !gameSessionActive);
  }
}

function resumeGame() {
  showPage('play');
  window.scrollTo({top:0, behavior:'smooth'});
}

document.querySelectorAll('.snav-btn').forEach(b =>
  b.addEventListener('click', () => {
    showPage(b.dataset.page, b.dataset.mode);
  })
);
document.getElementById('home-btn')?.addEventListener('click', () => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.snav-btn').forEach(b => b.classList.remove('active'));
  const pg = $('page-home'); if (pg) pg.classList.add('active');
  $('home-btn')?.classList.add('active');
  setText('page-title','Home');
  const resumeBtn = document.getElementById('resume-game-btn');
  if (resumeBtn) resumeBtn.classList.toggle('hidden', !gameSessionActive);
});

// ── Auth ──────────────────────────────────────────────────────
function initNewUI() {
  // Mobile menu toggle
  document.getElementById('tb-menu-btn')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isOpen = sidebar?.classList.toggle('mobile-open');
    overlay?.classList.toggle('active', !!isOpen);
  });

  // Mobile sidebar hide button — closes sidebar only
  document.getElementById('sidebar-hide-btn')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('sidebar-overlay')?.classList.remove('active');
  });

  // Mobile chat/lobby toggle — slides in the right sidebar as a drawer
  const chatToggleBtn = document.getElementById('mobile-chat-toggle');
  const chatOverlayEl = document.getElementById('chat-overlay');
  const rightSidebarEl = document.getElementById('right-sidebar');
  function closeMobileChat() {
    rightSidebarEl?.classList.remove('mobile-chat-open');
    chatOverlayEl?.classList.remove('active');
    chatToggleBtn?.classList.remove('active');
  }
  chatToggleBtn?.addEventListener('click', () => {
    const isOpen = rightSidebarEl?.classList.toggle('mobile-chat-open');
    chatOverlayEl?.classList.toggle('active', !!isOpen);
    chatToggleBtn?.classList.toggle('active', !!isOpen);
  });
  chatOverlayEl?.addEventListener('click', closeMobileChat);
  chatOverlayEl?.addEventListener('touchend', closeMobileChat, {passive:false});
  rightSidebarEl?.addEventListener('click', e => e.stopPropagation());

  // Tap overlay to close sidebar — overlay only, not sidebar itself
  const overlayEl = document.getElementById('sidebar-overlay');
  function closeSidebar(e) {
    e.stopPropagation();
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    overlayEl?.classList.remove('active');
  }
  overlayEl?.addEventListener('click', closeSidebar);
  overlayEl?.addEventListener('touchend', closeSidebar, {passive:false});

  // Prevent clicks/touches inside sidebar from bubbling to overlay
  document.getElementById('sidebar')?.addEventListener('click', e => e.stopPropagation());
  document.getElementById('sidebar')?.addEventListener('touchend', e => e.stopPropagation());

  // Logo click → navigate home only (no sidebar side effects)
  function goHome() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.snav-btn').forEach(b => b.classList.remove('active'));
    const pg = document.getElementById('page-home'); if (pg) pg.classList.add('active');
    document.getElementById('home-btn')?.classList.add('active');
    setText('page-title', 'Home');
    const resumeBtn = document.getElementById('resume-game-btn');
    if (resumeBtn) resumeBtn.classList.toggle('hidden', !gameSessionActive);
  }
  document.querySelector('.tb-brand')?.addEventListener('click', goHome);
  document.querySelector('.sidebar-logo')?.addEventListener('click', goHome);
  document.querySelector('.tb-brand') && (document.querySelector('.tb-brand').style.cursor = 'pointer');
  document.querySelector('.sidebar-logo') && (document.querySelector('.sidebar-logo').style.cursor = 'pointer');

  // Wallet dropdown
  const walletBtn = document.getElementById('wallet-btn');
  const walletDD = document.getElementById('wallet-dropdown');
  walletBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    walletDD?.classList.toggle('hidden');
    profileDD?.classList.add('hidden');
    walletBtn.classList.toggle('open', !walletDD?.classList.contains('hidden'));
  });
  document.getElementById('wd-dep-btn')?.addEventListener('click', () => {
    walletDD?.classList.add('hidden');
    showPage('deposit');
  });
  document.getElementById('wd-with-btn')?.addEventListener('click', () => {
    walletDD?.classList.add('hidden');
    showPage('withdraw');
  });
  document.querySelectorAll('.wd-cur-btn').forEach(b => {
    b.addEventListener('click', () => setCurrency(b.dataset.cur));
  });

  // Profile dropdown
  const profileBtn = document.getElementById('tb-profile-btn');
  const profileDD = document.getElementById('profile-dropdown');
  profileBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    profileDD?.classList.toggle('hidden');
    walletDD?.classList.add('hidden');
    walletBtn?.classList.remove('open');
  });
  document.getElementById('pd-logout')?.addEventListener('click', async () => {
    await fetch('/auth/logout',{method:'POST'}); location.reload();
  });
  document.querySelectorAll('.pd-link[data-page]').forEach(b => {
    b.addEventListener('click', () => { profileDD?.classList.add('hidden'); showPage(b.dataset.page); });
  });

  // Close dropdowns on outside click
  document.addEventListener('click', () => {
    walletDD?.classList.add('hidden');
    profileDD?.classList.add('hidden');
    walletBtn?.classList.remove('open');
  });

  // Discord links — populated by loadWorlds() from admin panel value
  // No hardcoded URL here
}

function enterPlatform(user) {
  me = user; setBalance(user.balance);
  setText('sb-username', user.username);
  setText('sb-level', 'Lv.'+(user.level||1));
  setText('sb-title', TITLES_MAP[user.title]||'');
  setText('vs-you', user.username);
  setText('idle-av-you', user.username);
  setText('queue-av-you', user.username);
  setText('tb-username', user.username);
  setText('hw-greeting', 'Welcome back, '+user.username+'!');
  // Profile dropdown stats
  setText('pd-username', user.username);
  setText('pd-level', 'Level '+(user.level||1));
  if (user.total_matches) setText('pd-matches', user.total_matches);
  if (user.total_wins) setText('pd-wins', user.total_wins);
  const losses = (user.total_matches||0) - (user.total_wins||0);
  setText('pd-losses', losses > 0 ? losses : 0);
  if (user.total_wagered) setText('pd-wagered', Number(user.total_wagered).toLocaleString());
  hide('auth-overlay'); show('platform');
  if (user.language) setLang(user.language);
  if (user.username.toLowerCase()==='admin') {
    const ab = $('admin-nav-btn'); if (ab) ab.classList.remove('hidden');
  }
  showPage('home');
  setArenaState('idle');
  updateModeUI();
  loadWorlds();
}

$('login-btn')?.addEventListener('click', async () => {
  const u=$('login-user').value.trim(), p=$('login-pass').value;
  if (!u||!p) return showAuthErr('Fill in all fields');
  try { const d=await api('POST','/auth/login',{username:u,password:p}); hideAuthErr(); enterPlatform(d.user); }
  catch(e) { showAuthErr(e.message); }
});

$('register-btn')?.addEventListener('click', async () => {
  const u=$('reg-user').value.trim(), p=$('reg-pass').value, ref=$('reg-ref').value.trim();
  if (!u||!p) return showAuthErr('Fill in all fields');
  try {
    const d = await api('POST','/auth/register',{username:u,password:p,referral_code:ref||null});
    hideAuthErr();
    enterPlatform(d.user);
    if (ref) toast('🎁 Referral bonus applied!','info');
    else toast('Account created! Deposit to start playing.');
  } catch(e) { showAuthErr(e.message); }
});

$('logout-btn')?.addEventListener('click', async () => {
  await fetch('/auth/logout',{method:'POST'});
  me = null; show('auth-overlay'); hide('platform');
});

function showAuthErr(m) { const e=$('auth-error'); if(e){e.textContent=m; e.classList.remove('hidden');} }
function hideAuthErr() { const e=$('auth-error'); if(e) e.classList.add('hidden'); }

document.querySelectorAll('.atab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.atab').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  b.dataset.tab==='login' ? (show('auth-login'),hide('auth-register')) : (hide('auth-login'),show('auth-register'));
  hideAuthErr();
}));
['login-user','login-pass'].forEach(id=>{const e=$(id);e&&e.addEventListener('keydown',ev=>{if(ev.key==='Enter')$('login-btn').click();});});
['reg-user','reg-pass','reg-ref'].forEach(id=>{const e=$(id);e&&e.addEventListener('keydown',ev=>{if(ev.key==='Enter')$('register-btn').click();});});

// ── Mode UI ───────────────────────────────────────────────────
function updateModeUI() {
  const m = MODES[selectedMode]; if (!m) return;
  setText('gi-mode', m.name);
  setText('gi-rule', m.rule);
  // Switch spin room background for VEME/QQ/CSN vs BJ
  const spinBg = $('spin-room-bg');
  if (spinBg) {
    spinBg.style.backgroundImage = selectedMode === 'BJ'
      ? "url('/img/room_bj.png')"
      : "url('/img/room_roulette.png')";
  }
  // Swap roulette/chandelier for BJ
  const rouletteCenter = document.querySelector('#state-idle .roulette-center');
  let chanDisplay = $('chan-idle-display');
  if (selectedMode === 'BJ') {
    if (rouletteCenter) rouletteCenter.style.display = 'none';
    if (!chanDisplay) {
      chanDisplay = document.createElement('div');
      chanDisplay.id = 'chan-idle-display';
      chanDisplay.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;';
      chanDisplay.innerHTML = '<img src="/img/chandelier.png" style="width:180px;height:auto;image-rendering:pixelated;filter:drop-shadow(0 0 24px rgba(255,215,64,.5));animation:chan-idle-float 2s ease-in-out infinite;" alt="BJ Chandelier"/>';
      if (!document.getElementById('chan-idle-style')) {
        const st = document.createElement('style');
        st.id='chan-idle-style';
        st.textContent='@keyframes chan-idle-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}';
        document.head.appendChild(st);
      }
      if (rouletteCenter) rouletteCenter.parentElement.insertBefore(chanDisplay, rouletteCenter.nextSibling);
    }
    chanDisplay.style.display = 'flex';
  } else {
    if (rouletteCenter) rouletteCenter.style.display = '';
    if (chanDisplay) chanDisplay.style.display = 'none';
  }
}

// ── Bet Controls ──────────────────────────────────────────────
$('bet-half')?.addEventListener('click',()=>{const v=parseInt($('bet-amount').value)||0;$('bet-amount').value=Math.max(1,Math.floor(v/2));});
$('bet-double')?.addEventListener('click',()=>{const v=parseInt($('bet-amount').value)||0;$('bet-amount').value=Math.min(myBal,v*2);});
$('bet-max')?.addEventListener('click',()=>{$('bet-amount').value=myBal;});

// ── Queue ─────────────────────────────────────────────────────
$('join-queue-btn')?.addEventListener('click', () => {
  if (!me) return toast('Please log in first','error');
  const bet = parseInt($('bet-amount').value);
  if (!bet||bet<1) return toast('Enter a valid bet amount','error');
  if (bet>myBal) return toast('Not enough balance — deposit first!','error');
  socket.emit('join_queue',{bet, gameMode:selectedMode});
  setText('queue-info',`${bet.toLocaleString()} DL · ${MODES[selectedMode]?.name||selectedMode}`);
  setArenaState('queue');
});
$('leave-queue-btn')?.addEventListener('click', () => {
  socket.emit('leave_queue');
  setArenaState('idle');
});

// ── Arena State ───────────────────────────────────────────────
function setArenaState(s) {
  if (s !== 'bj') {
    hide('bj-action-panel');
    clearBJTimer();
  }
  ['idle','queue','match-found','countdown','bj','spinning','result','rematch','vote','vote-spin'].forEach(n => hide('state-'+n));
  show('state-'+s);
  // On mobile, scroll to top so the game state is visible
  if (window.innerWidth <= 768) {
    window.scrollTo({top:0, behavior:'smooth'});
  }
}

// ── Socket: connection ────────────────────────────────────────
socket.on('authenticated', ({balance, profile}) => {
  setBalance(balance);
  if (profile && me) {
    setText('sb-level','Lv.'+(profile.level||1));
    setText('sb-title', TITLES_MAP[profile.title]||'');
  }
});

socket.on('error_msg', msg => {
  toast(typeof msg==='string'?msg:(msg?.text||'Error'),'error');
  setArenaState('idle');
});

socket.on('status_update', ({state, balance, message, error}) => {
  if (balance!=null) setBalance(balance);
  if (error) toast(error,'error');
  if (message) toast(message,'info');
  if (state==='idle') {
    clearRmTimer();
    setArenaState('idle');
    renderHistory();
    setGameSessionActive(false);
  }
});

socket.on('match_found', ({opponent, bet, gameMode}) => {
  setText('vs-opp', opponent);
  setText('vs-mode-tag', MODES[gameMode]?.name||gameMode);
  setText('vs-pot', `Pot: ${(bet*2).toLocaleString()} DL`);
  setGameSessionActive(true);
  showPage('play', gameMode);
  setArenaState('match-found');
  toast(`Match found vs ${opponent}!`,'info');
});

socket.on('countdown', ({count}) => {
  setArenaState('countdown');
  const el = $('countdown-num'); if (!el) return;
  el.textContent = count;
  el.style.fontSize = '';
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
});

// ── BJ ────────────────────────────────────────────────────────
socket.on('bj_start', ({myName, oppName, matchId: bjMatchId}) => {
  if (bjMatchId) { currentMatchId = bjMatchId; bjCurrentMatchId = bjMatchId; }
  setArenaState('bj');
  setText('bj-name-me', myName+' (You)');
  setText('bj-name-opp', oppName);
  ['bj-score-me','bj-score-opp'].forEach(id=>{const e=$(id);if(e){e.innerHTML='0 <span class="bj-sub">gems</span>';e.className='bj-score';}});
  ['bj-cards-me','bj-cards-opp'].forEach(id=>{const e=$(id);if(e)e.innerHTML='';});
  ['chan-me','chan-opp'].forEach(id=>{const e=$(id);if(e)e.classList.remove('dim','shake');});
  setText('bj-rnd-me','0'); setText('bj-rnd-opp','0');
  hide('bj-action-panel');
});

socket.on('bj_round', ({round, myGem, myTotal, myBust, oppGem, oppTotal, oppBust}) => {
  setText('bj-rnd-me', round); setText('bj-rnd-opp', round);
  bjSide('me', myGem, myTotal, myBust);
  bjSide('opp', oppGem, oppTotal, oppBust);
  hide('bj-action-panel');
  clearBJTimer();
});

function bjSide(side, gem, total, bust) {
  if (gem===null||gem===undefined) return;
  const sc = $(side==='me'?'bj-score-me':'bj-score-opp');
  if (sc) { sc.innerHTML=`${total} <span class="bj-sub">gems</span>`; sc.className='bj-score'+(bust?' busting':total>=17?' winning':''); }
  const cards = $(side==='me'?'bj-cards-me':'bj-cards-opp');
  if (cards) { const p=document.createElement('span'); p.className='bj-gem-pill'; p.textContent=gem; cards.appendChild(p); }
  const burst = $(side==='me'?'burst-me':'burst-opp');
  if (burst) { burst.textContent=`+${gem} 💎`; burst.classList.remove('pop'); void burst.offsetWidth; burst.classList.add('pop'); }
  const chan = $(side==='me'?'chan-me':'chan-opp');
  if (chan) { chan.classList.remove('shake'); void chan.offsetWidth; chan.classList.add('shake'); if(bust)chan.classList.add('dim'); }
}

socket.on('bj_action_prompt', ({round, total, timerSecs, matchId: promptMatchId}) => {
  bjCurrentMatchId = promptMatchId || currentMatchId;
  show('bj-action-panel');
  setText('bj-action-prompt', `Round ${round} — You have ${total} gems. Hit or Stand?`);
  const hitBtn=$('bj-hit-btn'), standBtn=$('bj-stand-btn');
  if (hitBtn) hitBtn.disabled = false;
  if (standBtn) standBtn.disabled = false;
  clearBJTimer();
  let elapsed = 0;
  const total_ms = (timerSecs||10) * 1000;
  const bar = $('bj-timer-bar'), txt = $('bj-timer-txt');
  bjTimerInterval = setInterval(() => {
    elapsed += 100;
    const pct = Math.max(0, 100 - (elapsed/total_ms*100));
    if (bar) { bar.style.width = pct+'%'; bar.classList.toggle('urgent', pct<30); }
    if (txt) txt.textContent = Math.ceil((total_ms-elapsed)/1000)+'s';
    if (elapsed >= total_ms) { clearBJTimer(); hide('bj-action-panel'); toast('Time up! Auto-stand.','warn'); }
  }, 100);
});

socket.on('bj_action_confirmed', ({action}) => {
  clearBJTimer(); hide('bj-action-panel');
  toast(action==='stand'?'✋ Standing — score locked!':'💥 Hit! Waiting for gem...','info');
});
socket.on('bj_opp_action', ({action}) => { if(action==='stand') toast('Opponent stood.','info'); });
socket.on('bj_opp_stood', () => { toast('Opponent stood — waiting for your decision...','info'); });

function clearBJTimer() {
  if (bjTimerInterval) { clearInterval(bjTimerInterval); bjTimerInterval=null; }
  const bar=$('bj-timer-bar'); if(bar){bar.style.width='100%';bar.classList.remove('urgent');}
}

$('bj-hit-btn')?.addEventListener('click', () => {
  if (!bjCurrentMatchId) return;
  socket.emit('bj_action',{matchId:bjCurrentMatchId,action:'hit'});
  const h=$('bj-hit-btn'),s=$('bj-stand-btn'); if(h)h.disabled=true; if(s)s.disabled=true;
});
$('bj-stand-btn')?.addEventListener('click', () => {
  if (!bjCurrentMatchId) return;
  socket.emit('bj_action',{matchId:bjCurrentMatchId,action:'stand'});
  const h=$('bj-hit-btn'),s=$('bj-stand-btn'); if(h)h.disabled=true; if(s)s.disabled=true;
});

// ── Spectator BJ ──────────────────────────────────────────────
socket.on('spec_bj_start', ({playerA, playerB}) => {
  setArenaState('bj');
  setText('bj-name-me', playerA); setText('bj-name-opp', playerB);
  ['bj-score-me','bj-score-opp'].forEach(id=>{const e=$(id);if(e){e.innerHTML='0 <span class="bj-sub">gems</span>';e.className='bj-score';}});
});
socket.on('spec_bj_round', ({round, gemA, totalA, bustA, gemB, totalB, bustB}) => {
  setText('bj-rnd-me',round); setText('bj-rnd-opp',round);
  bjSide('me',gemA,totalA,bustA); bjSide('opp',gemB,totalB,bustB);
});
socket.on('spec_match_found', ({playerA, playerB, bet, gameMode}) => {
  setText('vs-opp',playerB); setText('vs-mode-tag',MODES[gameMode]?.name||gameMode);
  setText('vs-pot',`Pot: ${(bet*2).toLocaleString()} DL`); setArenaState('match-found');
});
socket.on('spec_countdown', ({count}) => {
  setArenaState('countdown');
  const e=$('countdown-num'); if(e){e.textContent=count;e.style.animation='none';void e.offsetWidth;e.style.animation='';}
});
socket.on('spec_result', ({result, aWon, bWon, isTie}) => {
  renderResult(result,false,isTie,{},0,true); setArenaState('result');
});
socket.on('spec_joined', ({playerA, playerB, gameMode, bet}) => {
  toast(`Spectating: ${playerA} vs ${playerB}`,'info');
});

// ── GAME RESULT ───────────────────────────────────────────────
socket.on('game_result', ({result, isWinner, isTie, payout, newBalance, matchId}) => {
  currentMatchId = matchId;
  setBalance(newBalance, isWinner?'up':isTie?null:'dn');
  myHistory.unshift({mode:result.mode, win:isWinner, tie:isTie, reason:result.reason});
  renderHistory();
  if (me) me.balance = newBalance;

  if (result.mode === 'BJ') {
    // BJ: chandelier rounds already animated — show result screen directly
    renderResult(result, isWinner, isTie, payout, newBalance, false);
    setArenaState('result');
  } else {
    // VEME/QQ/CSN: spin the dedicated roulette, then show result
    spinThenResult(result, isWinner, isTie, payout, newBalance);
  }
});

// ── Spin then Result (VEME/QQ/CSN only) ──────────────────────
function spinThenResult(result, isWinner, isTie, payout, newBalance) {
  setArenaState('spinning');
  const lbl = $('spin-label');
  const orb = $('spin-orb');
  const scMe  = $('spin-score-me');
  const scOpp = $('spin-score-opp');
  if (lbl) { lbl.textContent = 'Rolling...'; lbl.style.color = 'var(--tx)'; lbl.style.fontSize = '16px'; }
  [scMe, scOpp].forEach(el => { if(el) { el.className='spin-av-score hidden'; el.textContent=''; } });
  setTimeout(() => { if (lbl) lbl.textContent = '...'; }, 1200);
  setTimeout(() => {
    if (orb) orb.style.animationDuration = '2s';
    if (lbl) {
      lbl.textContent = isTie ? '🤝 Tie!' : isWinner ? '🏆 You Win!' : '💀 You Lose';
      lbl.style.color = isTie ? 'var(--gold)' : isWinner ? 'var(--green)' : 'var(--red)';
      lbl.style.fontSize = '20px';
    }
    const displays = result.display || [];
    if (displays.length >= 2 && me) {
      const myD  = displays.find(d => d.player === me.username) || displays[0];
      const oppD = displays.find(d => d.player !== me.username) || displays[1];
      const myWon = !isTie && isWinner;
      if (scMe)  { scMe.textContent  = myD.value;  scMe.className  = 'spin-av-score '+(isTie?'s-tie':myWon?'s-win':'s-lose');  scMe.classList.remove('hidden'); }
      if (scOpp) { scOpp.textContent = oppD.value; scOpp.className = 'spin-av-score '+(isTie?'s-tie':!isWinner?'s-win':'s-lose'); scOpp.classList.remove('hidden'); }
    }
  }, 2400);
  setTimeout(() => {
    if (orb) orb.style.animationDuration = '1s';
    renderResult(result, isWinner, isTie, payout, newBalance, false);
    setArenaState('result');
  }, 3800);
}

// ── Lobby ─────────────────────────────────────────────────────
socket.on('lobby_update', entries => {
  const html = (!entries?.length)
    ? '<div class="empty-msg">No one queuing</div>'
    : entries.map(e=>`
        <div class="lobby-row" onclick="joinLobby(${e.bet},'${e.gameMode}')">
          <div class="lr-av"><img src="/img/gt_char.png" alt=""/></div>
          <div class="lr-l"><span class="lr-name">${e.username}</span><span class="lr-mode">${MODES[e.gameMode]?.name||e.gameMode}</span></div>
          <span class="lr-bet">${Number(e.bet).toLocaleString()} DL</span>
        </div>`).join('') + '<div class="lobby-hint">Click to join</div>';

  const el = $('lobby-list'); if (el) el.innerHTML = html;
  const el2 = $('lobby-list-mobile'); if (el2) el2.innerHTML = html;
});

socket.on('active_matches_update', () => {}); // handled server-side, ignored client-side

window.joinLobby = (bet, gameMode) => {
  if (!me) return toast('Log in first','error');
  if (bet>myBal) return toast('Not enough balance','error');
  $('bet-amount').value = bet; selectedMode = gameMode;
  document.querySelectorAll('.snav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.snav-btn[data-mode="${gameMode}"]`)?.classList.add('active');
  updateModeUI();
  showPage('play', gameMode); // navigate to play page first
  socket.emit('join_queue',{bet,gameMode});
  setText('queue-info',`${Number(bet).toLocaleString()} DL · ${MODES[gameMode]?.name||gameMode}`);
  setArenaState('queue');
};

window.selectAndPlay = (mode) => {
  selectedMode = mode;
  document.querySelectorAll('.snav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.snav-btn[data-mode="${mode}"]`)?.classList.add('active');
  updateModeUI(); showPage('play',mode); setArenaState('idle');
};

// ── Chat ──────────────────────────────────────────────────────
socket.on('chat_history', msgs => {
  const el=$('chat-msgs'); if(!el) return;
  el.innerHTML=''; msgs.forEach(m=>appendChatMsg(m)); el.scrollTop=el.scrollHeight;
});
socket.on('chat_message', msg => {
  appendChatMsg(msg); const el=$('chat-msgs'); if(el)el.scrollTop=el.scrollHeight;
});
socket.on('chat_error', msg => toast(msg,'warn'));

function appendChatMsg(msg) {
  const el=$('chat-msgs'); if(!el) return;
  const div=document.createElement('div'); div.className='chat-msg';
  const ts=msg.created_at?new Date(msg.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
  const tb=msg.title&&TITLES_MAP[msg.title]?`<span class="chat-title-badge">${TITLES_MAP[msg.title]}</span>`:'';
  div.innerHTML=`<div class="chat-msg-header"><span class="chat-lv">Lv.${msg.level||1}</span><span class="chat-name">${escHtml(msg.username)}</span>${tb}<span class="chat-time">${ts}</span></div><div class="chat-text">${escHtml(msg.message)}</div>`;
  el.appendChild(div);
  if(el.children.length>100) el.removeChild(el.firstChild);
}
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

$('chat-send')?.addEventListener('click', sendChat);
$('chat-inp')?.addEventListener('keydown', ev => { if(ev.key==='Enter') sendChat(); });
function sendChat() {
  const inp=$('chat-inp'); if(!inp||!inp.value.trim()) return;
  if(!me) return toast('Log in to chat','error');
  socket.emit('chat_send',{message:inp.value.trim(),room:'global'});
  inp.value='';
}

// ── Tip ───────────────────────────────────────────────────────
socket.on('tip_received', ({from,amount}) => toast(`💸 ${from} tipped you ${amount} DL!`,'info'));

$('open-tip-modal')?.addEventListener('click', () => {
  if (!me) return toast('Log in first','error');
  show('tip-modal'); $('tip-user').value=''; $('tip-amount').value=''; hide('tip-status');
});
$('confirm-tip')?.addEventListener('click', async () => {
  const toUsername=$('tip-user')?.value.trim(), amount=parseInt($('tip-amount')?.value);
  if (!toUsername||!amount||amount<1) return toast('Fill in all fields','error');
  const st=$('tip-status');
  if(st){st.className='form-status load';st.textContent='Sending...';st.classList.remove('hidden');}
  try {
    const d=await api('POST','/tip',{toUsername,amount});
    setBalance(d.newBalance,'dn');
    if(st){st.className='form-status ok';st.textContent=`✅ Sent ${amount} DL to ${toUsername}!`;}
    toast(`Tipped ${amount} DL to ${toUsername}`);
  } catch(e) { if(st){st.className='form-status err';st.textContent='❌ '+e.message;} }
});
document.querySelector('[data-close="tip-modal"]')?.addEventListener('click',()=>hide('tip-modal'));
$('tip-modal')?.addEventListener('click',e=>{if(e.target===$('tip-modal'))hide('tip-modal');});

// ── Rematch ───────────────────────────────────────────────────
socket.on('rematch_offer', ({matchId, opponentName, timeoutSecs}) => {
  currentMatchId = matchId;
  setText('rm-echo', $('result-header')?.textContent||'Match Over');
  setText('opp-rm-text', `Waiting for ${opponentName}...`);
  const dot=$('opp-dot'); if(dot) dot.className='opp-dot';
  setText('rm-status','');
  const rmBtn=$('btn-rematch'); if(rmBtn) rmBtn.disabled=false;
  setArenaState('rematch');
  startRmCountdown(timeoutSecs||30);
});
socket.on('rematch_opp_ready', ({ready}) => {
  if(ready){const d=$('opp-dot');if(d)d.className='opp-dot ready';setText('opp-rm-text','Opponent ready! ✓');}
});
socket.on('rematch_opp_voted', () => setText('vote-wait','Opponent voted — waiting...'));
socket.on('rematch_declined', () => { clearRmTimer(); toast('Opponent declined','info'); setArenaState('idle'); });
socket.on('rematch_expired', () => { clearRmTimer(); toast('Rematch expired','info'); setArenaState('idle'); });
socket.on('rematch_vote_start', ({matchId}) => {
  currentMatchId=matchId; myVote=null;
  document.querySelectorAll('.vote-btn').forEach(b=>b.classList.remove('selected'));
  setText('vote-wait','Pick your mode'); clearRmTimer(); setArenaState('vote');
});
socket.on('rematch_spin', ({modeA, modeB, chosen}) => {
  setText('vspin-sub',`${MODES[modeA]?.name||modeA} vs ${MODES[modeB]?.name||modeB}`);
  hide('vspin-result'); setArenaState('vote-spin');
  const img=$('vote-rw-img');
  if(img){img.style.transition='transform 4s cubic-bezier(.17,.67,.12,1.01)';img.style.transform=`rotate(${720+Math.floor(Math.random()*360)}deg)`;}
  setTimeout(()=>{const r=$('vspin-result');if(r){r.textContent=`${MODES[chosen]?.name||chosen} selected!`;r.classList.remove('hidden');}},4200);
});
socket.on('rematch_mode_selected', ({gameMode, spun}) => { if(!spun) toast(`Both voted ${MODES[gameMode]?.name||gameMode} — starting!`,'info'); });

$('btn-rematch')?.addEventListener('click', () => {
  if(!currentMatchId) return;
  socket.emit('rematch_accept',{matchId:currentMatchId});
  setText('rm-status','You accepted — waiting...');
  $('btn-rematch').disabled=true;
});
$('btn-lobby')?.addEventListener('click', () => {
  if(currentMatchId) socket.emit('rematch_decline',{matchId:currentMatchId});
  clearRmTimer(); setArenaState('idle');
});
document.querySelectorAll('.vote-btn').forEach(b => b.addEventListener('click', () => {
  if(myVote) return; myVote=b.dataset.vote;
  document.querySelectorAll('.vote-btn').forEach(x=>x.classList.remove('selected'));
  b.classList.add('selected');
  setText('vote-wait',`You voted ${MODES[myVote]?.name||myVote} — waiting...`);
  socket.emit('rematch_vote',{matchId:currentMatchId,gameMode:myVote});
}));
function startRmCountdown(s) {
  clearRmTimer(); let sec=s; setText('rm-cd',sec);
  rmTimer=setInterval(()=>{sec--;setText('rm-cd',sec);if(sec<=0){clearRmTimer();setArenaState('idle');}},1000);
}
function clearRmTimer() { if(rmTimer){clearInterval(rmTimer);rmTimer=null;} }

// ── Result Render ─────────────────────────────────────────────
function numColor(c) { if(c==='green')return'#22c55e'; if(c==='red')return'#ef5350'; return'#e8eaf0'; }

function renderResult(result, isWinner, isTie, payout, newBalance, spectating) {
  const hdr=$('result-header'); if(!hdr) return;
  if (spectating) { hdr.className='result-banner tie'; hdr.textContent='🔴 Match Ended (Spectating)'; }
  else { hdr.className='result-banner '+(isTie?'tie':isWinner?'win':'loss'); hdr.textContent=isTie?t('tie'):isWinner?t('winner'):t('loser'); }

  // ── Avatar score reveal (3s per player) ──────────────────────
  const displays = result.display || [];
  const avMe  = $('result-av-me');
  const avOpp = $('result-av-opp');
  const scMe  = $('result-av-score-me');
  const scOpp = $('result-av-score-opp');
  const nmMe  = $('result-av-name-me');
  const nmOpp = $('result-av-name-opp');

  // Reset avatars
  [avMe, avOpp].forEach(el => { if(el) el.className='result-av-slot'; });
  [scMe, scOpp].forEach(el => { if(el) { el.className='result-av-score hidden'; el.textContent=''; } });

  if (displays.length >= 2 && !spectating && me) {
    const myDisp  = displays.find(d => d.player === me.username) || displays[0];
    const oppDisp = displays.find(d => d.player !== me.username) || displays[1];
    if(nmMe)  nmMe.textContent  = myDisp.player;
    if(nmOpp) nmOpp.textContent = oppDisp.player;

    const myWon  = !isTie && result.winnerId && myDisp.player === me.username ? isWinner : false;
    const oppWon = !isTie && !myWon && !isTie;

    // Phase 1 — Player 1 score after 1s
    setTimeout(() => {
      if (scMe) {
        scMe.textContent = myDisp.value;
        scMe.className = 'result-av-score ' + (isTie ? 'score-tie' : myWon ? 'score-win' : 'score-lose');
        scMe.classList.remove('hidden');
      }
      if (avMe) avMe.className = 'result-av-slot ' + (isTie ? 'av-tie' : myWon ? 'av-win' : 'av-lose');
    }, 1000);

    // Phase 2 — Player 2 score after 4s (3s after player 1)
    setTimeout(() => {
      if (scOpp) {
        scOpp.textContent = oppDisp.value;
        scOpp.className = 'result-av-score ' + (isTie ? 'score-tie' : oppWon && !isWinner ? 'score-win' : 'score-lose');
        scOpp.classList.remove('hidden');
      }
      if (avOpp) avOpp.className = 'result-av-slot ' + (isTie ? 'av-tie' : !isWinner ? 'av-win' : 'av-lose');
    }, 4000);
  }

  // ── Score cards below ─────────────────────────────────────────
  const sc=$('result-scores'); if(!sc) return;
  sc.innerHTML='';
  displays.forEach(d => {
    const isMe=!spectating&&me&&d.player===me.username;
    const won=!spectating&&!isTie&&result.winnerId!==null&&((isMe&&isWinner)||(!isMe&&!isWinner));
    const cls=isTie||spectating?'':won?'sc-win':'sc-loss';
    const col=d.color?numColor(d.color):'#e8eaf0';
    let cards='';
    if(d.cards?.length) cards=`<div class="sc-cards">${d.cards.map(c=>`<span class="gem-pill">${c}</span>`).join('')}</div>`;
    sc.innerHTML+=`<div class="score-card ${cls}"><div class="sc-player">${d.player}${isMe?' · You':''}</div><div class="sc-val" style="color:${col}">${d.value}</div><div class="sc-label">${d.bust?'💥 BUST!':d.label}</div>${cards}</div>`;
  });
  setText('result-reason', result.reason||'');
  if(spectating) setText('result-payout','');
  else if(isTie) setText('result-payout','Both players refunded');
  else if(isWinner&&payout?.winnerPayout) setText('result-payout',`+${Number(payout.winnerPayout).toLocaleString()} DL`);
  else setText('result-payout','');
  setText('result-balance', Number(newBalance).toLocaleString());
}

function renderHistory() {
  const el=$('match-feed'); if(!el) return;
  if(!myHistory.length){el.innerHTML='<div class="empty-msg">—</div>';return;}
  el.innerHTML=myHistory.slice(0,10).map(h=>`
    <div class="hi-row ${h.tie?'tie':h.win?'win':'loss'}">
      <div class="hi-top"><span class="hi-mode">${h.mode}</span><span class="hi-res ${h.tie?'tie':h.win?'win':'loss'}">${h.tie?'TIE':h.win?'WIN':'LOSS'}</span></div>
      <div class="hi-reason">${h.reason}</div>
    </div>`).join('');
}

// ── Worlds ────────────────────────────────────────────────────
async function loadWorlds() {
  try {
    const d=await api('GET','/worlds');
    setText('dep-world',d.depositWorld); setText('wd-world',d.withdrawWorld);
    // Update ALL discord links from the admin-stored value
    const link = d.discordLink || '';
    ['discord-dep','discord-wd','discord-sidebar-btn'].forEach(id => {
      const el=$(id); if(el && link) el.href = link;
    });
  } catch{}
}

// ── Wagering ──────────────────────────────────────────────────
async function loadWageringStatus() {
  try {
    const d=await api('GET','/wagering-status');
    const pct=d.wagering_required>0?Math.min(100,Math.floor(d.wagering_completed/d.wagering_required*100)):100;
    const wb=$('wag-bar'); if(wb)wb.style.width=pct+'%';
    const wt=$('wag-text'); if(wt)wt.textContent=`Wagered: ${Number(d.wagering_completed).toLocaleString()} / ${Number(d.wagering_required).toLocaleString()} DL (${pct}%)`;
    const wl=$('wag-locked'); if(wl)wl.textContent=d.unlocked?'✅ Withdrawal unlocked!':`🔒 ${Number(d.remaining).toLocaleString()} DL more to wager`;
    const sw=$('submit-wd'); if(sw)sw.disabled=!d.unlocked;
    const pb=$('prof-wag-bar'); if(pb)pb.style.width=pct+'%';
    const pt=$('prof-wag-text'); if(pt)pt.textContent=d.wagering_required>0?`${Number(d.wagering_completed).toLocaleString()} / ${Number(d.wagering_required).toLocaleString()} DL (${pct}%)`:'No wagering requirement';
    const di=$('dep-wagering-info');
    if(di){if(d.wagering_required>0)di.innerHTML=`<strong>Wagering progress:</strong> ${Number(d.wagering_completed).toLocaleString()} / ${Number(d.wagering_required).toLocaleString()} DL`;else di.textContent='No wagering requirement.';}
  } catch{}
}

// ── Deposit ───────────────────────────────────────────────────
$('submit-dep')?.addEventListener('click', async () => {
  const grow_id=$('dep-grow-id')?.value.trim(), discord_username=$('dep-discord-un')?.value.trim(), claimed_amount=parseInt($('dep-amount')?.value);
  if(!grow_id||!discord_username||!claimed_amount) return toast('Fill in all fields','error');
  const st=$('dep-status');
  if(st){st.className='form-status load';st.textContent='Submitting...';st.classList.remove('hidden');}
  try {
    const d=await api('POST','/deposit/request',{grow_id,discord_username,claimed_amount});
    if(st){st.className='form-status ok';st.innerHTML=`✅ Logged! ID #${d.depositId} — Submit proof on Discord.`;}
    [$('dep-grow-id'),$('dep-discord-un'),$('dep-amount')].forEach(e=>{if(e)e.value='';});
    loadMyDeposits();
  } catch(e){if(st){st.className='form-status err';st.textContent='❌ '+e.message;}}
});

async function loadMyDeposits() {
  try {
    const {deposits}=await api('GET','/deposit/my');
    const el=$('dep-history'); if(!el) return;
    if(!deposits?.length){el.innerHTML='<div class="empty-msg">No deposits yet</div>';return;}
    el.innerHTML=deposits.map(d=>`<div class="dh-row ${d.status}"><div><div class="dh-amt">${Number(d.claimed_amount).toLocaleString()} DL</div><div class="dh-meta">Grow ID: ${d.grow_id} · ${d.created_at||''}</div></div><span class="dh-st">${d.status}</span></div>`).join('');
  } catch{}
}

// ── Withdraw ──────────────────────────────────────────────────
$('submit-wd')?.addEventListener('click', async () => {
  const amt=parseInt($('wd-amount')?.value);
  if(!amt||amt<1) return toast('Enter a valid amount','error');
  if(amt>myBal) return toast('Not enough balance','error');
  const st=$('wd-status');
  if(st){st.className='form-status load';st.textContent='Processing...';st.classList.remove('hidden');}
  $('submit-wd').disabled=true;
  try {
    const d=await api('POST','/withdraw',{amount:amt});
    if(st){st.className='form-status ok';st.innerHTML=`✅ Done! ID: <strong>${d.tradeId}</strong> · Go to <strong>${d.world}</strong>`;}
    setBalance(d.newBalance,'dn'); if($('wd-amount'))$('wd-amount').value='';
  } catch(e){if(st){st.className='form-status err';st.textContent='❌ '+e.message;}}
  finally{loadWageringStatus(); const s=$('submit-wd');if(s)s.disabled=false;}
});

// ── Affiliate ─────────────────────────────────────────────────
async function loadAffiliate() {
  try {
    const d=await api('GET','/affiliate');
    setText('ref-code',d.referral_code||'—');
    setText('aff-referred',d.total_referred||0);
    setText('aff-earnings',(d.total_earnings||0).toLocaleString()+' DL');
    const ul=$('aff-users-list');
    if(ul)ul.innerHTML=d.referred?.length?d.referred.map(u=>`<div class="aff-user-row"><span>${u.username}</span><span>${u.created_at||''}</span></div>`).join(''):'<div class="empty-msg">No referrals yet</div>';
    const el=$('aff-earnings-list');
    if(el)el.innerHTML=d.earnings?.length?d.earnings.map(e=>`<div class="aff-earn-row"><span>${e.notes||'Affiliate'}</span><span style="color:var(--green)">+${e.amount} DL</span></div>`).join(''):'<div class="empty-msg">No earnings yet</div>';
  } catch{}
}
$('copy-ref')?.addEventListener('click',()=>{
  const code=$('ref-code')?.textContent;
  if(code&&code!=='—'){navigator.clipboard.writeText(code).then(()=>toast('Copied!','info')).catch(()=>toast(code,'info'));}
});

// ── Profile ───────────────────────────────────────────────────
async function loadProfile() {
  try {
    if(!me) return;
    const d=await api('GET','/auth/me'); const u=d.user; me=u;
    setText('prof-username',u.username); setText('prof-level','Level '+(u.level||1));
    setText('prof-title',TITLES_MAP[u.title]||'');
    const xpPct=Math.min(100,Math.floor((u.xp||0)/Math.max(1,u.xpNeeded||100)*100));
    const xb=$('xp-bar'); if(xb)xb.style.width=xpPct+'%';
    setText('xp-text',`${u.xp||0} / ${u.xpNeeded||100} XP`);
    setText('ps-matches',u.total_matches||0);
    setText('ps-wins',u.total_wins||0);
    setText('ps-wagered',(u.total_wagered||0).toLocaleString());
    const tl=$('titles-list');
    if(tl){
      const all=['newcomer','gambler','high_roller','veteran','legend','winner'];
      const unlocked=u.unlocked_titles||[];
      tl.innerHTML=all.map(tid=>{
        const name=TITLES_MAP[tid]||tid;
        const isUnlocked=unlocked.includes(tid);
        const isEquipped=u.title===tid;
        return `<div class="title-item ${isEquipped?'equipped':isUnlocked?'unlocked':'locked'}" ${isUnlocked&&!isEquipped?`onclick="setTitle('${tid}')"`:''} >${isUnlocked?'':''} ${name}${isEquipped?' ✓':''}</div>`;
      }).join('');
    }
    const profAv = document.querySelector('.profile-av');
    if (profAv && !profAv.querySelector('img')) {
      const avImg = document.createElement('img');
      avImg.src = '/img/gt_char.png'; avImg.className = 'profile-av-img'; avImg.alt = '';
      profAv.appendChild(avImg);
    }
    const txRes=await api('GET','/transactions');
    const txEl=$('tx-list');
    if(txEl&&txRes.transactions?.length){
      txEl.innerHTML=txRes.transactions.slice(0,30).map(tx=>{
        const pos=['credit','deposit','affiliate'].includes(tx.type);
        return `<div class="tx-row ${tx.type}"><div class="tx-top"><span class="tx-type">${tx.type}</span><span class="tx-amt ${pos?'pos':'neg'}">${pos?'+':'-'}${Number(tx.amount).toLocaleString()} DL</span></div><div class="tx-note">${tx.notes||''}</div></div>`;
      }).join('');
    }
    loadWageringStatus();
  } catch(e){console.error('loadProfile',e);}
}
window.setTitle = async(title)=>{try{await api('POST','/profile/title',{title});toast('Title equipped!');loadProfile();}catch(e){toast(e.message,'error');}};

// ── Admin ─────────────────────────────────────────────────────
async function loadAdminSettings(){
  try{
    const s=await api('GET','/admin/settings');
    if($('adm-dep'))$('adm-dep').value=s.depositWorld||'';
    if($('adm-wd'))$('adm-wd').value=s.withdrawWorld||'';
    if($('adm-disc'))$('adm-disc').value=s.discordLink||'';
    if($('adm-edge'))$('adm-edge').value=s.houseEdge||'10';
    if($('adm-aff'))$('adm-aff').value=s.affiliatePercent||'1';
    if($('adm-signup'))$('adm-signup').value=s.signupBonus||'5';
    if($('adm-dbmul'))$('adm-dbmul').value=s.depositBonusMultiplier||'2';
    if($('adm-dbmax'))$('adm-dbmax').value=s.depositBonusMax||'20';
  }catch{}
}
$('adm-save')?.addEventListener('click', async()=>{
  try{
    const keys=[['depositWorld','adm-dep'],['withdrawWorld','adm-wd'],['discordLink','adm-disc'],['houseEdge','adm-edge'],['affiliatePercent','adm-aff'],['signupBonus','adm-signup'],['depositBonusMultiplier','adm-dbmul'],['depositBonusMax','adm-dbmax']];
    for(const[key,id]of keys){const e=$(id);if(e)await api('POST','/admin/update',{key,value:e.value});}
    const st=$('adm-st');if(st){st.className='form-status ok';st.textContent='✅ Saved!';st.classList.remove('hidden');}
    setTimeout(()=>{const s=$('adm-st');if(s)s.classList.add('hidden');},3000);
    loadWorlds();
  }catch(e){const st=$('adm-st');if(st){st.className='form-status err';st.textContent='❌ '+e.message;st.classList.remove('hidden');}}
});
async function loadAdminDeposits(){
  try{
    const deps=await api('GET','/admin/deposits');
    const el=$('adm-deps');if(!el)return;
    const pending=deps.filter(d=>d.status==='pending');
    if(!pending.length){el.innerHTML='<div class="empty-msg">No pending deposits</div>';return;}
    el.innerHTML=pending.map(d=>`<div class="adep-row"><div class="adep-user">${d.username} — ${Number(d.claimed_amount).toLocaleString()} DL</div><div class="adep-meta">Grow ID: ${d.grow_id} · Discord: ${d.discord_username||'?'}<br>${d.created_at||''}</div><div class="adep-actions"><button class="btn-approve" onclick="adminApprove(${d.id})">✓ Approve</button><button class="btn-reject" onclick="adminReject(${d.id})">✗ Reject</button></div></div>`).join('');
  }catch(e){setText('adm-deps','Error: '+e.message);}
}
async function loadAdminUsers(){
  try{
    const users=await api('GET','/admin/users');
    const el=$('adm-users');if(!el)return;
    el.innerHTML=users.map(u=>`<div class="adm-user-row"><span class="adm-uname">${u.username}</span><span class="adm-ulv">Lv.${u.level||1}</span><span class="adm-ubal">${Number(u.balance).toLocaleString()} DL</span><div class="adm-adj"><input type="number" id="adj-${u.id}" value="1000"/><button class="btn-give" onclick="adminGive(${u.id})">Give</button></div></div>`).join('');
  }catch{}
}
window.adminApprove=async(id)=>{try{const d=await api('POST','/admin/approve-deposit',{depositId:id});toast(`✅ ${d.username}: ${Number(d.newBalance).toLocaleString()} DL`);loadAdminDeposits();loadAdminUsers();}catch(e){toast(e.message,'error');}};
window.adminReject=async(id)=>{try{await api('POST','/admin/reject-deposit',{depositId:id});toast('Rejected.');loadAdminDeposits();}catch(e){toast(e.message,'error');}};
window.adminGive=async(id)=>{const el=document.getElementById('adj-'+id);const amt=parseInt(el?.value)||0;if(!amt)return;try{await api('POST','/admin/adjust',{userId:id,amount:amt});toast(`Gave ${amt} DL`);loadAdminUsers();}catch(e){toast(e.message,'error');}};
$('adm-refresh-deps')?.addEventListener('click',loadAdminDeposits);
$('adm-refresh-users')?.addEventListener('click',loadAdminUsers);

// ── Bonus banner ──────────────────────────────────────────────
async function checkBonusBanner(){
  try{
    const d=await api('GET','/wagering-status');
    const banner=$('bonus-banner');if(!banner)return;
    if((d.wagering_required||0)>0&&(d.wagering_completed||0)<(d.wagering_required||0))banner.classList.remove('hidden');
    else banner.classList.add('hidden');
  }catch{}
}

// ── Init ──────────────────────────────────────────────────────
(async () => {
  initNewUI();
  applyTranslations();
  try { const {user}=await api('GET','/auth/me'); enterPlatform(user); } catch {}
  updateModeUI();
})();
