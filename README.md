# GrowVegas 🌱🎰

Real-time multiplayer 1v1 betting platform — BetDice × Growtopia hybrid UI.

## Quick Start

```bash
# 1. Install dependencies
cd growvegas
npm install

# 2. Start the server
npm start

# 3. Open your browser
# http://localhost:3000
```

For development with auto-reload:
```bash
npm run dev
```

---

## Platform Overview

### Economy
- All accounts start with **1,000 dirtblocks**
- Winner receives **90%** of the pot
- House takes **10%**
- Ties: full refund to both players

### Game Modes
| Mode | Description |
|------|-------------|
| **REME** | Both roll 0–100. Highest wins. Roll 0 = instant win. |
| **QQ** | Draw digit 0–9. Highest wins. Draw 0 = instant win. |
| **CSN** | Score 0–100 direct comparison. Highest wins. 0 = instant win. |
| **BJ (Chandelier)** | 3 rounds of gem collection with optional hits. Highest total wins. |

### Bot World Economy
- **Deposit**: Simulated trade with GrowVegas bot (2–4 second processing)
- **Withdraw**: Bot delivers dirtblocks (3–6 second processing, 95% success rate)
- Trade IDs generated for every transaction
- All transactions logged in SQLite

---

## Admin Panel

Create an account with username `admin` for admin privileges.

### Admin Endpoints
```
GET  /admin              - View all settings
POST /admin/update       - Update a setting
GET  /admin/users        - View all users
GET  /admin/transactions - View transaction log
POST /admin/adjust       - Manually adjust user balance
```

### Update World Names
```bash
curl -X POST http://localhost:3000/admin/update \
  -H "Content-Type: application/json" \
  -d '{"key":"depositWorld","value":"MY-WORLD"}'
```

### Available Settings
- `depositWorld` — Bot deposit world name
- `withdrawWorld` — Bot withdraw world name  
- `houseEdge` — House edge percentage (default: 10)

---

## Project Structure

```
growvegas/
├── server/
│   ├── server.js          # Express + Socket.IO main server
│   ├── matchEngine.js     # 1v1 game state machine
│   ├── db.js              # SQLite database setup
│   ├── economy.js         # Balance, bet, payout logic
│   ├── botBridge.js       # Simulated Growtopia bot system
│   ├── deposit.js         # Deposit routes
│   ├── withdraw.js        # Withdraw routes
│   ├── adminSettings.js   # Admin routes
│   └── games/
│       ├── reme.js        # REME game module
│       ├── qq.js          # QQ game module
│       ├── csn.js         # CSN game module
│       └── bj.js          # BJ Chandelier game module
├── public/
│   ├── index.html         # Single-page frontend
│   ├── css/style.css      # Full hybrid UI styles
│   └── js/app.js          # All client-side logic
└── package.json
```

---

## Game Flow (State Machine)

```
idle → queue → match_found → game_selected → countdown → game_result → idle
```

All state transitions broadcast via Socket.IO events.

---

## Socket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `join_queue` | Client → Server | Join matchmaking |
| `leave_queue` | Client → Server | Leave queue (bet refunded) |
| `match_found` | Server → Client | Opponent found |
| `game_selected` | Server → Client | Game mode confirmed |
| `countdown` | Server → Client | 3-2-1 countdown |
| `game_result` | Server → Client | Match outcome + payout |
| `status_update` | Server → Client | State + balance updates |
