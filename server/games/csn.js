// CSN: Score 0-36. 0 = instant win. Odd = black, Even = red, 0 = green. Highest wins.
function resolveGame(playerA, playerB, bet) {
  const scoreA = Math.floor(Math.random() * 37);
  const scoreB = Math.floor(Math.random() * 37);

  function color(n) {
    if (n === 0) return 'green';
    return n % 2 === 0 ? 'red' : 'black';
  }

  let winnerId = null, reason = '';
  if (scoreA === 0 && scoreB === 0) {
    reason = 'Both scored 0 — TIE!';
  } else if (scoreA === 0) {
    winnerId = playerA.id;
    reason = `${playerA.username} scored 0 — INSTANT WIN!`;
  } else if (scoreB === 0) {
    winnerId = playerB.id;
    reason = `${playerB.username} scored 0 — INSTANT WIN!`;
  } else if (scoreA > scoreB) {
    winnerId = playerA.id;
    reason = `${playerA.username} scored higher (${scoreA} vs ${scoreB})`;
  } else if (scoreB > scoreA) {
    winnerId = playerB.id;
    reason = `${playerB.username} scored higher (${scoreB} vs ${scoreA})`;
  } else {
    reason = `Both scored ${scoreA} — TIE!`;
  }

  return {
    mode: 'CSN',
    display: [
      { player: playerA.username, value: scoreA, label: 'Score', color: color(scoreA) },
      { player: playerB.username, value: scoreB, label: 'Score', color: color(scoreB) }
    ],
    winnerId, reason, isTie: winnerId === null
  };
}
module.exports = { resolveGame };
