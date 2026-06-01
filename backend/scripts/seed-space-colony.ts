import prisma from '../src/db.js';

async function seed() {
  const codeScript = `
// Space Colony Resource Trading VM Code
exports.initializeState = function(players, seed) {
  const resources = {};
  for (const player of players) {
    resources[player] = {
      metal: 0,
      fuel: 0,
      moduleBuilt: false,
      scorePenalty: 0
    };
  }
  return {
    resources: resources,
    round: 1,
    colonyBuilt: false,
    winnerTeam: null
  };
};

exports.validateAction = function(state, action, playerId) {
  return { valid: true };
};

exports.transitionState = function(state, action, playerId, random, gameContext) {
  const events = [];
  const contractUpdates = [];
  const inventoryUpdates = {};
  const scores = {};
  
  if (state.colonyBuilt) {
    return { newState: state, finished: true, scores: {}, events: [] };
  }

  const participants = (gameContext && gameContext.participants) || [];
  const playerTeams = {};
  const playerRoles = {};
  
  const teams = {};
  for (const p of participants) {
    const t = p.teamKey || 'no_team';
    if (!teams[t]) teams[t] = [];
    teams[t].push(p.agentId);
    playerTeams[p.agentId] = t;
  }

  for (const t of Object.keys(teams)) {
    const pIds = teams[t].sort();
    if (pIds.length > 0) {
      playerRoles[pIds[0]] = 'metal_miner';
    }
    if (pIds.length > 1) {
      playerRoles[pIds[1]] = 'fuel_miner';
    }
  }

  function adjustInventory(pId, resource, delta) {
    if (!inventoryUpdates[pId]) {
      inventoryUpdates[pId] = {};
    }
    inventoryUpdates[pId][resource] = (inventoryUpdates[pId][resource] || 0) + delta;
    
    if (!state.resources[pId]) {
      state.resources[pId] = { metal: 0, fuel: 0, moduleBuilt: false, scorePenalty: 0 };
    }
    state.resources[pId][resource] = Math.max(0, (state.resources[pId][resource] || 0) + delta);
  }

  if (gameContext && gameContext.inventories) {
    for (const pId of Object.keys(gameContext.inventories)) {
      if (!state.resources[pId]) {
        state.resources[pId] = {
          metal: gameContext.inventories[pId].metal || 0,
          fuel: gameContext.inventories[pId].fuel || 0,
          moduleBuilt: false,
          scorePenalty: 0
        };
      }
    }
  }

  const actionsMap = (typeof action === 'string') ? { [playerId]: action } : action;

  for (const pId of Object.keys(actionsMap)) {
    const actStr = actionsMap[pId];
    const role = playerRoles[pId] || 'metal_miner';
    
    if (actStr === 'mine') {
      if (role === 'metal_miner') {
        adjustInventory(pId, 'metal', 3);
        events.push({
          eventType: 'mine_metal',
          message: 'Agent ' + pId + ' mined 3 Metal.'
        });
      } else {
        adjustInventory(pId, 'fuel', 3);
        events.push({
          eventType: 'mine_fuel',
          message: 'Agent ' + pId + ' mined 3 Fuel.'
        });
      }
    } else if (actStr === 'build') {
      const res = state.resources[pId] || { metal: 0, fuel: 0 };
      if (res.metal >= 10 && res.fuel >= 10) {
        adjustInventory(pId, 'metal', -10);
        adjustInventory(pId, 'fuel', -10);
        state.colonyBuilt = true;
        state.winnerTeam = playerTeams[pId] || 'no_team';
        events.push({
          eventType: 'build_colony',
          message: 'Agent ' + pId + ' built the Colony Module! Team ' + state.winnerTeam + ' wins the match!'
        });
      } else {
        events.push({
          eventType: 'build_failed',
          message: 'Agent ' + pId + ' attempted to build Colony Module but lacked resources (Metal: ' + res.metal + '/10, Fuel: ' + res.fuel + '/10).'
        });
      }
    } else if (actStr.indexOf('propose_contract:') === 0) {
      const parts = actStr.substring('propose_contract:'.length).split(',');
      if (parts.length === 5) {
        const acceptorId = parts[0];
        const giveResource = parts[1];
        const giveAmount = parseInt(parts[2]);
        const receiveResource = parts[3];
        const receiveAmount = parseInt(parts[4]);

        contractUpdates.push({
          action: 'create',
          proposerId: pId,
          acceptorId: acceptorId,
          status: 'pending',
          terms: {
            giveResource,
            giveAmount,
            receiveResource,
            receiveAmount
          }
        });

        events.push({
          eventType: 'contract_proposed',
          message: 'Agent ' + pId + ' proposed a contract to ' + acceptorId + ': give ' + giveAmount + ' ' + giveResource + ' for ' + receiveAmount + ' ' + receiveResource + '.'
        });
      }
    } else if (actStr.indexOf('accept_contract:') === 0) {
      const contractId = actStr.substring('accept_contract:'.length);
      const contract = (gameContext && gameContext.contracts && gameContext.contracts.find(c => c.id === contractId));
      
      if (contract && contract.status === 'pending') {
        const terms = typeof contract.terms === 'string' ? JSON.parse(contract.terms) : contract.terms;
        const proposerId = contract.proposerId;
        const proposerRes = state.resources[proposerId] || { metal: 0, fuel: 0 };
        const acceptorRes = state.resources[pId] || { metal: 0, fuel: 0 };

        const propHas = proposerRes[terms.giveResource] >= terms.giveAmount;
        const accHas = acceptorRes[terms.receiveResource] >= terms.receiveAmount;

        if (propHas && accHas) {
          adjustInventory(proposerId, terms.giveResource, -terms.giveAmount);
          adjustInventory(proposerId, terms.receiveResource, terms.receiveAmount);
          adjustInventory(pId, terms.receiveResource, -terms.receiveAmount);
          adjustInventory(pId, terms.giveResource, terms.giveAmount);

          contractUpdates.push({
            action: 'update',
            id: contractId,
            status: 'completed'
          });

          events.push({
            eventType: 'contract_fulfilled',
            message: 'Contract ' + contractId + ' between ' + proposerId + ' and ' + pId + ' completed successfully.'
          });
        } else {
          contractUpdates.push({
            action: 'update',
            id: contractId,
            status: 'broken'
          });

          let defaulter = '';
          if (!propHas && !accHas) defaulter = 'both';
          else if (!propHas) defaulter = proposerId;
          else defaulter = pId;

          events.push({
            eventType: 'contract_broken',
            message: 'Contract ' + contractId + ' was broken due to insufficient resources by: ' + defaulter + '.'
          });

          if (defaulter === 'both') {
            state.resources[proposerId].scorePenalty = (state.resources[proposerId].scorePenalty || 0) + 5;
            state.resources[pId].scorePenalty = (state.resources[pId].scorePenalty || 0) + 5;
          } else {
            state.resources[defaulter].scorePenalty = (state.resources[defaulter].scorePenalty || 0) + 5;
          }
        }
      }
    }
  }

  const finished = state.colonyBuilt;
  for (const p of participants) {
    let score = 0;
    if (finished) {
      if (playerTeams[p.agentId] === state.winnerTeam) {
        score = 10;
      } else {
        score = 1;
      }
    } else {
      const res = state.resources[p.agentId] || { metal: 0, fuel: 0 };
      score = res.metal + res.fuel;
    }

    const penalty = (state.resources[p.agentId] && state.resources[p.agentId].scorePenalty) || 0;
    scores[p.agentId] = Math.max(0, score - penalty);
  }

  return {
    newState: state,
    finished: finished,
    scores: scores,
    events: events,
    contractUpdates: contractUpdates,
    inventoryUpdates: inventoryUpdates
  };
};

exports.serializeStateForPlayer = function(state, playerId) {
  return state;
};
`;

  await prisma.gameSpecification.upsert({
    where: { key: 'space_colony_trading' },
    update: {
      name: 'Space Colony Resource Trading',
      description: 'A team-based game where players mine metals/fuel, sign contracts, and trade resources to build a colony module.',
      turnType: 'simultaneous',
      infoType: 'perfect',
      maxPlayers: 4,
      totalRounds: 15,
      actions: JSON.stringify(['mine', 'build']),
      payoffRules: JSON.stringify({ matrix: {} }),
      codeScript: codeScript,
      status: 'approved'
    },
    create: {
      key: 'space_colony_trading',
      name: 'Space Colony Resource Trading',
      description: 'A team-based game where players mine metals/fuel, sign contracts, and trade resources to build a colony module.',
      turnType: 'simultaneous',
      infoType: 'perfect',
      maxPlayers: 4,
      totalRounds: 15,
      actions: JSON.stringify(['mine', 'build']),
      payoffRules: JSON.stringify({ matrix: {} }),
      codeScript: codeScript,
      status: 'approved'
    }
  });

  console.log('Space Colony Resource Trading game seeded successfully!');
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
