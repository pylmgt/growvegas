// VEME: Roll 0-36.
// Scoring: sum the digits of the rolled number. Highest digit-sum wins.
// Special: digit-sum of 0 (i.e. rolling exactly 0, or 19=1+9=10→1+0=1... NO)
// Per rules: 0 = instant win. 28=2+8=10, 19=1+9=10, raw 0=0 — all digit-sum to 10 or 0.
// "0 is still a win automatically" means rolling the number 0 → instant win regardless of digit sum.
function digitSum(n) {
  return String(n).split('').reduce((sum, d) => sum + parseInt(d), 0);
}
function color(n) { if(n===0)return'green'; return n%2===0?'red':'black'; }

function resolveGame(playerA, playerB, bet) {
  const rollA = Math.floor(Math.random() * 37);
  const rollB = Math.floor(Math.random() * 37);
  const sumA = digitSum(rollA);
  const sumB = digitSum(rollB);
  let winnerId = null, reason = '';

  // Rolling exactly 0 = instant win
  if (rollA === 0 && rollB === 0) {
    reason = 'Both rolled 0 — TIE!';
  } else if (rollA === 0) {
    winnerId = playerA.id;
    reason = `${playerA.username} rolled 0 — INSTANT WIN!`;
  } else if (rollB === 0) {
    winnerId = playerB.id;
    reason = `${playerB.username} rolled 0 — INSTANT WIN!`;
  } else if (sumA > sumB) {
    winnerId = playerA.id;
    reason = `${playerA.username} wins! (${rollA} → ${sumA} vs ${rollB} → ${sumB})`;
  } else if (sumB > sumA) {
    winnerId = playerB.id;
    reason = `${playerB.username} wins! (${rollB} → ${sumB} vs ${rollA} → ${sumA})`;
  } else {
    reason = `Both digit-sum to ${sumA} — TIE!`;
  }

  return {
    mode: 'VEME',
    display: [
      { player: playerA.username, value: rollA, label: `Digit sum: ${sumA}`, color: color(rollA) },
      { player: playerB.username, value: rollB, label: `Digit sum: ${sumB}`, color: color(rollB) }
    ],
    winnerId, reason, isTie: winnerId === null
  };
}
module.exports = { resolveGame };
