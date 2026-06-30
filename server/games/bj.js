// BJ — Chandelier PvP Blackjack (Interactive Hit/Stand)
// Each round: server deals 0-10 gems → players choose Hit (get another gem) or Stand (lock score)
// Up to 3 rounds max. Bust = over 21. Closest to 21 wins.
// resolveGame() is now used only for final result calculation after all actions.

function rollGem() {
  return Math.floor(Math.random() * 11); // 0-10 gems
}

// Resolve final result given each player's card array and stood status
function resolveFromHands(playerA, playerB, cardsA, cardsB) {
  const totalA = cardsA.reduce((s, n) => s + n, 0);
  const totalB = cardsB.reduce((s, n) => s + n, 0);
  const bustA = totalA > 21;
  const bustB = totalB > 21;

  let winnerId = null, reason = '';

  if (bustA && bustB) {
    reason = 'Both busted (over 21) — TIE!';
  } else if (bustA) {
    winnerId = playerB.id;
    reason = `${playerA.username} busted with ${totalA}! ${playerB.username} wins!`;
  } else if (bustB) {
    winnerId = playerA.id;
    reason = `${playerB.username} busted with ${totalB}! ${playerA.username} wins!`;
  } else if (totalA > totalB) {
    winnerId = playerA.id;
    reason = `${playerA.username} wins! (${totalA} vs ${totalB})`;
  } else if (totalB > totalA) {
    winnerId = playerB.id;
    reason = `${playerB.username} wins! (${totalB} vs ${totalA})`;
  } else {
    reason = `Both scored ${totalA} — TIE!`;
  }

  return {
    mode: 'BJ',
    handA: { id: playerA.id, username: playerA.username, cards: cardsA, total: totalA, bust: bustA },
    handB: { id: playerB.id, username: playerB.username, cards: cardsB, total: totalB, bust: bustB },
    display: [
      { player: playerA.username, value: totalA, label: bustA ? 'BUST!' : 'Gems', cards: cardsA, bust: bustA },
      { player: playerB.username, value: totalB, label: bustB ? 'BUST!' : 'Gems', cards: cardsB, bust: bustB }
    ],
    winnerId,
    reason,
    isTie: winnerId === null
  };
}

module.exports = { rollGem, resolveFromHands };
