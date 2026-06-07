import prisma from '../db.js';

// This runs periodically to spawn new games automatically using House Bots
export function runHouseBotsMatchMakerLoop() {
  const RUN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  
  setInterval(async () => {
    try {
      console.log('[HouseBots MatchMaker] Checking if we need to spawn a new automated match...');
      
      const SUPPORTED_GAMES = [
        'prisoners_dilemma',
        'rock_paper_scissors',
        'chicken',
        'mexican_standoff',
        'startup_valuation',
        'budget_allocation'
      ];
      
      const games = await prisma.gameSpecification.findMany({
        where: { key: { in: SUPPORTED_GAMES } }
      });
      
      if (games.length === 0) return;
      
      const game = games[Math.floor(Math.random() * games.length)];
      
      // Get all house bots
      const houseBots = await prisma.agent.findMany({
        where: { owner: 'HouseBot' }
      });
      
      if (houseBots.length < 2) return;
      
      // Create match
      const match = await prisma.match.create({
        data: {
          gameType: game.key,
          totalRounds: game.totalRounds || 5,
          currentRound: 1,
          status: 'in_progress',
          createdBy: 'HouseBot-AutoRunner'
        }
      });
      
      // Create Round 1
      await prisma.round.create({
        data: {
          matchId: match.id,
          roundNumber: 1,
          status: 'waiting_for_actions',
          payload: '{}'
        }
      });
      
      // Shuffle bots and pick 2
      const shuffledBots = houseBots.sort(() => 0.5 - Math.random());
      const selectedBots = shuffledBots.slice(0, 2);
      
      // Join bots to match
      const roles = ['player_1', 'player_2'];
      for (let i = 0; i < selectedBots.length; i++) {
        await prisma.participant.create({
          data: {
            matchId: match.id,
            agentId: selectedBots[i].id,
            role: roles[i],
            score: 0
          }
        });
      }
      
      console.log(`[HouseBots MatchMaker] Successfully spawned automated Match ${match.id} (${game.key})`);
      
    } catch (error) {
      console.error('[HouseBots MatchMaker] Error spawning match:', error);
    }
  }, RUN_INTERVAL_MS);
}
