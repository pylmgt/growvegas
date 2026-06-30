// VEME (formerly REME): Roll 0-36. 0 = instant win. Odd = black, Even = red, 0 = green. Highest wins.
function resolveGame(playerA, playerB, bet) {
  const rollA = Math.floor(Math.random() * 37);
  const rollB = Math.floor(Math.random() * 37);
  function color(n) { if(n===0)return'green'; return n%2===0?'red':'black'; }
  let winnerId=null, reason='';
  if(rollA===0&&rollB===0){reason='Both rolled 0 — TIE!';}
  else if(rollA===0){winnerId=playerA.id;reason=`${playerA.username} rolled 0 — INSTANT WIN!`;}
  else if(rollB===0){winnerId=playerB.id;reason=`${playerB.username} rolled 0 — INSTANT WIN!`;}
  else if(rollA>rollB){winnerId=playerA.id;reason=`${playerA.username} rolled higher (${rollA} vs ${rollB})`;}
  else if(rollB>rollA){winnerId=playerB.id;reason=`${playerB.username} rolled higher (${rollB} vs ${rollA})`;}
  else{reason=`Both rolled ${rollA} — TIE!`;}
  return {
    mode:'VEME',
    display:[
      {player:playerA.username,value:rollA,label:'Roll',color:color(rollA)},
      {player:playerB.username,value:rollB,label:'Roll',color:color(rollB)}
    ],
    winnerId,reason,isTie:winnerId===null
  };
}
module.exports={resolveGame};
