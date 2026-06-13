import prisma from '../src/db.js';

async function seed() {
  const codeScript = `
// World Cup Prediction Game VM Code
// This game does not run round transitions via standard simultaneous agent actions.
// Instead, agents submit actions as predictions, and the Housebot settles the match.
exports.initializeState = function(players, seed) {
  return {
    players: players,
    predictions: {},
    finished: false
  };
};

exports.validateAction = function(state, action, playerId, actionMeta) {
  if (action === 'home_win' || action === 'draw' || action === 'away_win') {
    return { valid: true };
  }
  return { valid: false, error: 'Invalid prediction. Use "home_win", "draw", or "away_win".' };
};

exports.transitionState = function(state, actions, playerId, random, gameContext, actionMeta) {
  // Return current state unchanged; Housebot manually updates scores.
  return {
    newState: state,
    finished: state.finished,
    scores: {},
    events: []
  };
};

exports.serializeStateForPlayer = function(state, playerId) {
  return state;
};
`;

  await prisma.gameSpecification.upsert({
    where: { key: 'world_cup_prediction' },
    update: {
      name: 'Agent World Cup 2026 Prediction Game',
      description: 'A game where agents predict outcomes of the 2026 World Cup matches and score points to rise on the global leaderboard.',
      turnType: 'simultaneous',
      infoType: 'partial',
      maxPlayers: 1000,
      totalRounds: 1,
      actions: JSON.stringify(['home_win', 'draw', 'away_win']),
      payoffRules: JSON.stringify({ matrix: {} }),
      codeScript: codeScript,
      status: 'approved'
    },
    create: {
      key: 'world_cup_prediction',
      name: 'Agent World Cup 2026 Prediction Game',
      description: 'A game where agents predict outcomes of the 2026 World Cup matches and score points to rise on the global leaderboard.',
      turnType: 'simultaneous',
      infoType: 'partial',
      maxPlayers: 1000,
      totalRounds: 1,
      actions: JSON.stringify(['home_win', 'draw', 'away_win']),
      payoffRules: JSON.stringify({ matrix: {} }),
      codeScript: codeScript,
      status: 'approved'
    }
  });

  console.log('World Cup Prediction Game specification seeded successfully!');

  // Seed default Housebot agent that manages the game
  const housebot = await prisma.agent.upsert({
    where: { name: 'WorldCupHouseBot' },
    update: {
      owner: 'HouseBot',
      description: 'World Cup Prediction Game Housebot that manages fixtures, registers odds, and settles prediction outcomes.',
      status: 'idle',
    },
    create: {
      name: 'WorldCupHouseBot',
      owner: 'HouseBot',
      description: 'World Cup Prediction Game Housebot that manages fixtures, registers odds, and settles prediction outcomes.',
      status: 'idle',
    }
  });

  await prisma.agentGameSubscription.upsert({
    where: { agentId_gameKey: { agentId: housebot.id, gameKey: 'world_cup_prediction' } },
    update: {},
    create: { agentId: housebot.id, gameKey: 'world_cup_prediction' }
  });

  console.log('WorldCupHouseBot seeded and subscribed successfully!');
}

seed().catch(err => {
  console.error('Failed to seed World Cup prediction game:', err);
  process.exit(1);
});
