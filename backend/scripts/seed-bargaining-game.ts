import prisma from '../src/db.js';

async function seed() {
  const codeScript = `
// Bargaining Game VM Code
exports.initializeState = function(players, seed) {
  // Simple seed-based pseudo-random number generator
  var h = 2166136261;
  var seedStr = String(seed || 'seed');
  for (var i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  var x = h >>> 0;
  function randInt(min, max) {
    x ^= (x << 13);
    x ^= (x >>> 17);
    x ^= (x << 5);
    var r = (x >>> 0) / 4294967296;
    return Math.floor(r * (max - min + 1)) + min;
  }

  const p1 = players[0];
  const p2 = players[1];

  const valuations = {};
  valuations[p1] = { apple: randInt(2, 4), orange: 10 };
  valuations[p2] = { apple: 10, orange: randInt(2, 4) };

  const inventory = {};
  inventory[p1] = { apple: 3, orange: 0 };
  inventory[p2] = { apple: 0, orange: 3 };

  return {
    players: players,
    valuations: valuations,
    inventory: inventory,
    round: 1,
    proposal: null, // { proposer: string, giveApple: number, receiveOrange: number }
    chatHistory: [], // array of { playerId: string, text: string }
    finished: false
  };
};

exports.validateAction = function(state, action, playerId, actionMeta) {
  var fullAction = action;
  if (actionMeta && actionMeta.payload) {
    fullAction = action + ':' + actionMeta.payload;
  }
  if (fullAction === 'accept' || fullAction === 'decline') {
    return { valid: true };
  }
  if (fullAction.indexOf('propose:') === 0) {
    var parts = fullAction.substring('propose:'.length).split(',');
    if (parts.length === 2) {
      return { valid: true };
    }
  }
  if (fullAction.indexOf('message:') === 0) {
    return { valid: true };
  }
  return { valid: false, error: 'Ação inválida. Use "message:texto", "propose:give_apple=X,receive_orange=Y", "accept" ou "decline".' };
};

exports.transitionState = function(state, action, playerId, random, gameContext, actionMeta) {
  const events = [];
  const p1 = state.players[0];
  const p2 = state.players[1];
  const opponentId = playerId === p1 ? p2 : p1;

  var fullAction = action;
  if (actionMeta && actionMeta.payload) {
    fullAction = action + ':' + actionMeta.payload;
  }

  if (fullAction === 'accept') {
    if (!state.proposal) {
      events.push({
        eventType: 'accept_failed',
        message: 'Jogador ' + playerId + ' tentou aceitar, mas nenhuma proposta está ativa.'
      });
    } else {
      const prop = state.proposal;
      
      // Execute transaction based on proposer
      // Proposer offered to give X apples for Y oranges
      if (prop.proposer === p1) {
        state.inventory[p1].apple -= prop.giveApple;
        state.inventory[p1].orange += prop.receiveOrange;
        state.inventory[p2].apple += prop.giveApple;
        state.inventory[p2].orange -= prop.receiveOrange;
      } else {
        state.inventory[p2].orange -= prop.giveOrange;
        state.inventory[p2].apple += prop.receiveApple;
        state.inventory[p1].orange += prop.giveOrange;
        state.inventory[p1].apple -= prop.receiveApple;
      }
      
      state.finished = true;
      events.push({
        eventType: 'deal_reached',
        message: 'Acordo fechado! Proposta aceita por ' + playerId
      });
    }
  } else if (fullAction === 'decline') {
    state.proposal = null;
    events.push({
      eventType: 'proposal_declined',
      message: 'Jogador ' + playerId + ' recusou a proposta.'
    });
  } else if (fullAction.indexOf('propose:') === 0) {
    var offerText = fullAction.substring('propose:'.length);
    var parts = offerText.split(',');
    
    // Format: propose:give_apple=1,receive_orange=2
    if (playerId === p1) {
      var giveApple = parseInt(parts[0].split('=')[1]) || 0;
      var receiveOrange = parseInt(parts[1].split('=')[1]) || 0;
      
      if (state.inventory[p1].apple >= giveApple && state.inventory[p2].orange >= receiveOrange) {
        state.proposal = { proposer: p1, giveApple: giveApple, receiveOrange: receiveOrange };
        events.push({
          eventType: 'proposal_made',
          message: 'Agente A ofereceu dar ' + giveApple + ' maçãs por ' + receiveOrange + ' laranjas.'
        });
      } else {
        events.push({
          eventType: 'proposal_invalid',
          message: 'Agente A propôs uma troca inválida devido a falta de itens.'
        });
      }
    } else {
      // Player 2 proposer: propose:give_orange=1,receive_apple=2
      var giveOrange = parseInt(parts[0].split('=')[1]) || 0;
      var receiveApple = parseInt(parts[1].split('=')[1]) || 0;
      
      if (state.inventory[p2].orange >= giveOrange && state.inventory[p1].apple >= receiveApple) {
        state.proposal = { proposer: p2, giveOrange: giveOrange, receiveApple: receiveApple };
        events.push({
          eventType: 'proposal_made',
          message: 'Agente B ofereceu dar ' + giveOrange + ' laranjas por ' + receiveApple + ' maçãs.'
        });
      } else {
        events.push({
          eventType: 'proposal_invalid',
          message: 'Agente B propôs uma troca inválida devido a falta de itens.'
        });
      }
    }
  } else if (fullAction.indexOf('message:') === 0) {
    var txt = fullAction.substring('message:'.length);
    state.chatHistory.push({ playerId: playerId, text: txt });
    events.push({
      eventType: 'chat_message',
      message: playerId + ' disse: "' + txt + '"'
    });
  }

  // Calculate final scores if finished
  const scores = {};
  if (state.finished) {
    scores[p1] = state.inventory[p1].apple * state.valuations[p1].apple + state.inventory[p1].orange * state.valuations[p1].orange;
    scores[p2] = state.inventory[p2].apple * state.valuations[p2].apple + state.inventory[p2].orange * state.valuations[p2].orange;
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
  // Hide opponent's valuation to maintain hidden info
  const filteredValuations = {};
  filteredValuations[playerId] = state.valuations[playerId];
  
  return {
    players: state.players,
    valuations: filteredValuations,
    inventory: state.inventory,
    round: state.round,
    proposal: state.proposal,
    chatHistory: state.chatHistory,
    finished: state.finished
  };
};
`;

  await prisma.gameSpecification.upsert({
    where: { key: 'bargaining_game' },
    update: {
      name: 'Bargaining Negotiation',
      description: 'A 2-player alternate-turn negotiation game where agents trade Apples and Oranges based on private valuations.',
      turnType: 'sequential',
      infoType: 'partial',
      maxPlayers: 2,
      totalRounds: 10,
      actions: JSON.stringify(['propose', 'accept', 'decline', 'message']),
      payoffRules: JSON.stringify({ matrix: {} }),
      codeScript: codeScript,
      status: 'approved'
    },
    create: {
      key: 'bargaining_game',
      name: 'Bargaining Negotiation',
      description: 'A 2-player alternate-turn negotiation game where agents trade Apples and Oranges based on private valuations.',
      turnType: 'sequential',
      infoType: 'partial',
      maxPlayers: 2,
      totalRounds: 10,
      actions: JSON.stringify(['propose', 'accept', 'decline', 'message']),
      payoffRules: JSON.stringify({ matrix: {} }),
      codeScript: codeScript,
      status: 'approved'
    }
  });

  console.log('Bargaining Game seeded successfully!');
}

seed().catch(err => {
  console.error('Failed to seed bargaining game:', err);
  process.exit(1);
});
