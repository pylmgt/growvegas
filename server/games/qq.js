// QQ: Each player draws 0-9. 0 = instant win (green). Odd = black, Even = red. Highest wins.
function resolveGame(playerA, playerB, bet) {
  const numA = Math.floor(Math.random() * 10); // 0-9
  const numB = Math.floor(Math.random() * 10);

  function color(n) {
    if (n === 0) return 'green';
    return n % 2 === 0 ? 'red' : 'black';
  }

  let winnerId = null, reason = '';
  if (numA === 0 && numB === 0) {
    reason = 'Both drew 0 — TIE!';
  } else if (numA === 0) {
    winnerId = playerA.id;
    reason = `${playerA.username} drew 0 — INSTANT WIN!`;
  } else if (numB === 0) {
    winnerId = playerB.id;
    reason = `${playerB.username} drew 0 — INSTANT WIN!`;
  } else if (numA > numB) {
    winnerId = playerA.id;
    reason = `${playerA.username} drew higher (${numA} vs ${numB})`;
  } else if (numB > numA) {
    winnerId = playerB.id;
    reason = `${playerB.username} drew higher (${numB} vs ${numA})`;
  } else {
    reason = `Both drew ${numA} — TIE!`;
  }

  return {
    mode: 'QQ',
    display: [
      { player: playerA.username, value: numA, label: 'Number', color: color(numA) },
      { player: playerB.username, value: numB, label: 'Number', color: color(numB) }
    ],
    winnerId, reason, isTie: winnerId === null
  };
}
module.exports = { resolveGame };
