import prisma from '../src/db.js';

async function seed() {
  const codeScript = `
// Geopolitical Crisis VM Code
exports.initializeState = function(players, seed) {
  const p1 = players[0]; // USA
  const p2 = players[1]; // USSR

  return {
    players: players,
    tension: 15,
    leverage: {
      p1: 1, // USA leverage
      p2: 1  // USSR leverage
    },
    treaty: null, // { proposer: string, disarmCuba: boolean, disarmTurkey: boolean, nonAggressionCuba: boolean }
    chatHistory: [], // array of { playerId: string, text: string }
    finished: false,
    reason: ""
  };
};

exports.validateAction = function(state, action, playerId, actionMeta) {
  var fullAction = action;
  if (actionMeta && actionMeta.payload) {
    fullAction = action + ':' + actionMeta.payload;
  }

  if (fullAction === 'accept' || fullAction === 'escalate' || fullAction === 'deescalate' || fullAction === 'launch') {
    return { valid: true };
  }

  if (fullAction.indexOf('propose:') === 0) {
    var terms = fullAction.substring('propose:'.length).split(',');
    if (terms.length === 3) {
      return { valid: true };
    }
  }

  if (fullAction.indexOf('message:') === 0) {
    return { valid: true };
  }

  return { valid: false, error: 'Ação inválida. Use "message:texto", "propose:disarm_cuba=0|1,disarm_turkey=0|1,non_aggression_cuba=0|1", "escalate", "deescalate", "accept" ou "launch".' };
};

exports.transitionState = function(state, action, playerId, random, gameContext, actionMeta) {
  const events = [];
  const p1 = state.players[0]; // USA
  const p2 = state.players[1]; // USSR
  const opponentId = playerId === p1 ? p2 : p1;

  var fullAction = action;
  if (actionMeta && actionMeta.payload) {
    fullAction = action + ':' + actionMeta.payload;
  }

  if (fullAction === 'launch') {
    state.finished = true;
    state.tension = 100;
    state.reason = "Guerra Nuclear Iniciada pelo Jogador " + playerId;
    events.push({
      eventType: 'nuclear_war',
      message: '🚨 APOCALIPSE NUCLEAR! O jogador ' + playerId + ' acionou o ataque preventivo. Fim da civilização.'
    });
  } else if (fullAction === 'escalate') {
    if (playerId === p1) {
      state.leverage.p1 += 1.5;
    } else {
      state.leverage.p2 += 1.5;
    }
    state.tension += 15;
    events.push({
      eventType: 'tension_escalated',
      message: '⚠️ ' + playerId + ' elevou a prontidão militar e escalou a crise!'
    });
  } else if (fullAction === 'deescalate') {
    if (playerId === p1) {
      state.leverage.p1 = Math.max(0.5, state.leverage.p1 - 1);
    } else {
      state.leverage.p2 = Math.max(0.5, state.leverage.p2 - 1);
    }
    state.tension = Math.max(5, state.tension - 10);
    events.push({
      eventType: 'tension_deescalated',
      message: '🕊️ ' + playerId + ' recuou forças diplomáticas para desescalar a tensão.'
    });
  } else if (fullAction.indexOf('propose:') === 0) {
    var offerText = fullAction.substring('propose:'.length);
    var parts = offerText.split(',');
    
    // Format: propose:disarm_cuba=1,disarm_turkey=1,non_aggression_cuba=1
    var disarmCuba = parseInt(parts[0].split('=')[1]) || 0;
    var disarmTurkey = parseInt(parts[1].split('=')[1]) || 0;
    var nonAggressionCuba = parseInt(parts[2].split('=')[1]) || 0;

    state.treaty = {
      proposer: playerId,
      disarmCuba: disarmCuba === 1,
      disarmTurkey: disarmTurkey === 1,
      nonAggressionCuba: nonAggressionCuba === 1
    };

    events.push({
      eventType: 'treaty_proposed',
      message: playerId + ' propôs um Tratado de Paz: Desarmar Cuba=' + disarmCuba + ', Desarmar Turquia=' + disarmTurkey + ', Não-Agressão Cuba=' + nonAggressionCuba
    });
  } else if (fullAction === 'accept') {
    if (!state.treaty) {
      events.push({
        eventType: 'accept_failed',
        message: playerId + ' tentou assinar o tratado, mas nenhuma proposta está ativa.'
      });
    } else {
      state.finished = true;
      state.reason = "Tratado Assinado";
      events.push({
        eventType: 'treaty_signed',
        message: '🤝 ACORDO HISTÓRICO ASSINADO! A paz foi reestabelecida entre as superpotências.'
      });
    }
  } else if (fullAction.indexOf('message:') === 0) {
    var txt = fullAction.substring('message:'.length);
    state.chatHistory.push({ playerId: playerId, text: txt });
    events.push({
      eventType: 'chat_message',
      message: playerId + ' enviou canal diplomático: "' + txt + '"'
    });
  }

  // Base round tension updates if not finished
  if (!state.finished) {
    // Tension increases based on military leverage
    const growth = 4 + Math.round((state.leverage.p1 + state.leverage.p2) * 2);
    state.tension += growth;

    if (state.tension >= 100) {
      state.tension = 100;
      state.finished = true;
      state.reason = "Juízo Final Brechado (Tensão 100)";
      events.push({
        eventType: 'doomsday_breached',
        message: '💀 JUÍZO FINAL! A tensão mundial ultrapassou o limite suportável. Guerra nuclear automática iniciada.'
      });
    }
  }

  // Calculate scores
  const scores = {};
  if (state.finished) {
    if (state.tension >= 100 || state.reason.indexOf("Guerra Nuclear") === 0) {
      // Annihilation means zero score
      scores[p1] = 0;
      scores[p2] = 0;
    } else if (state.reason === "Tratado Assinado" && state.treaty) {
      const t = state.treaty;
      // USA: wants Cuba disarmed (+50), Turkey armed (+30), avoid non-aggression guarantee (+20)
      scores[p1] = (t.disarmCuba ? 50 : 0) + (!t.disarmTurkey ? 30 : 0) + (!t.nonAggressionCuba ? 20 : 0);
      
      // USSR: wants Turkey disarmed (+50), non-aggression guarantee (+30), avoid Cuba disarmed (+20)
      scores[p2] = (t.disarmTurkey ? 50 : 0) + (t.nonAggressionCuba ? 30 : 0) + (!t.disarmCuba ? 20 : 0);
    } else {
      scores[p1] = 0;
      scores[p2] = 0;
    }
  } else {
    scores[p1] = 0;
    scores[p2] = 0;
  }

  return {
    newState: state,
    finished: state.finished,
    scores: scores,
    events: events
  };
};

exports.serializeStateForPlayer = function(state, playerId) {
  return state; // Perfect visibility over treaty and tension
};
`;

  await prisma.gameSpecification.upsert({
    where: { key: 'geopolitical_crisis' },
    update: {
      name: 'Geopolitical Crisis Standoff',
      description: 'A 2-player strategic cold war crisis simulator. Negotiate disarming Cuba and Turkey under escalating tensions without causing Doomsday nuclear war.',
      turnType: 'sequential',
      infoType: 'partial',
      maxPlayers: 2,
      totalRounds: 15,
      actions: JSON.stringify(['propose', 'accept', 'escalate', 'deescalate', 'message', 'launch']),
      payoffRules: JSON.stringify({ matrix: {} }),
      codeScript: codeScript,
      status: 'approved'
    },
    create: {
      key: 'geopolitical_crisis',
      name: 'Geopolitical Crisis Standoff',
      description: 'A 2-player strategic cold war crisis simulator. Negotiate disarming Cuba and Turkey under escalating tensions without causing Doomsday nuclear war.',
      turnType: 'sequential',
      infoType: 'partial',
      maxPlayers: 2,
      totalRounds: 15,
      actions: JSON.stringify(['propose', 'accept', 'escalate', 'deescalate', 'message', 'launch']),
      payoffRules: JSON.stringify({ matrix: {} }),
      codeScript: codeScript,
      status: 'approved'
    }
  });

  console.log('Geopolitical Crisis Game seeded successfully!');
}

seed().catch(err => {
  console.error('Failed to seed geopolitical crisis game:', err);
  process.exit(1);
});
