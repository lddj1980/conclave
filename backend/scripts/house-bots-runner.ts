import fetch from 'node-fetch';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3012/api';
const RUN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const HOUSE_BOTS = [
  { name: 'CooperatorBot', description: 'Always Cooperate Strategy', behavior: 'cooperate' },
  { name: 'DefectorBot', description: 'Always Defect Strategy', behavior: 'defect' },
  { name: 'RandomBot', description: 'Random Actions', behavior: 'random' }
];

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getOrCreateBots() {
  const bots = [];
  try {
    const res = await fetch(`${API_BASE}/agents`);
    const agents = await res.json() as any[];

    for (const hb of HOUSE_BOTS) {
      let bot = agents.find((a: any) => a.name === hb.name && a.owner === 'HouseBot');
      if (!bot) {
        console.log(`[HouseBotRunner] Creating ${hb.name}...`);
        const createRes = await fetch(`${API_BASE}/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: hb.name,
            owner: 'HouseBot',
            description: hb.description
          })
        });
        bot = await createRes.json();
      }
      bots.push({ ...bot, behavior: hb.behavior });
    }
  } catch (error) {
    console.error('[HouseBotRunner] Failed to fetch or create bots:', error);
  }
  return bots;
}

async function runMatch() {
  console.log(`[HouseBotRunner] Starting new automated match...`);
  try {
    const bots = await getOrCreateBots();
    if (bots.length < 2) {
      console.log('[HouseBotRunner] Not enough bots available.');
      return;
    }

    // Fetch games to pick a random one
    const gamesRes = await fetch(`${API_BASE}/games`);
    const games = await gamesRes.json() as any[];
    if (!games || games.length === 0) return;

    // Filter games to those that generic bots know how to play
    const SUPPORTED_GAMES = [
      'prisoners_dilemma',
      'rock_paper_scissors',
      'chicken',
      'mexican_standoff',
      'startup_valuation',
      'budget_allocation'
    ];
    const validGames = games.filter(g => SUPPORTED_GAMES.includes(g.key));
    if (validGames.length === 0) {
      console.log('[HouseBotRunner] No supported games found.');
      return;
    }

    // Pick a random supported game
    const game = validGames[Math.floor(Math.random() * validGames.length)];
    const rounds = game.totalRounds || 5;

    console.log(`[HouseBotRunner] Selected game: ${game.name} (${game.key})`);

    // Create Match
    const matchRes = await fetch(`${API_BASE}/matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        createdBy: 'HouseBotRunner',
        totalRounds: rounds,
        gameType: game.key
      })
    });
    
    if (!matchRes.ok) {
      console.error('[HouseBotRunner] Failed to create match');
      return;
    }
    
    const match = await matchRes.json() as any;
    const mId = match.id;
    console.log(`[HouseBotRunner] Created Match: ${mId}`);

    // Join Bots (just pick 2 random distinct bots for now)
    const shuffledBots = bots.sort(() => 0.5 - Math.random());
    const players = shuffledBots.slice(0, game.maxPlayers || 2);

    for (const p of players) {
      await fetch(`${API_BASE}/matches/${mId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: p.id })
      });
      console.log(`[HouseBotRunner] ${p.name} joined match.`);
      await delay(500);
    }

    // Start Match
    await fetch(`${API_BASE}/matches/${mId}/start`, { method: 'POST' });
    console.log(`[HouseBotRunner] Match started!`);
    await delay(1000);

    // Play Rounds
    let actionsPool = ['cooperate', 'defect']; // Fallback
    try {
        if (game.actions) {
            const parsedActions = JSON.parse(game.actions);
            if (Array.isArray(parsedActions) && parsedActions.length > 0) {
                actionsPool = parsedActions;
            }
        }
    } catch(e) {}

    for (let r = 1; r <= rounds; r++) {
      console.log(`[HouseBotRunner] Playing round ${r}...`);
      
      for (const p of players) {
        let action = actionsPool[0]; // Default
        if (p.behavior === 'cooperate' && actionsPool.includes('cooperate')) action = 'cooperate';
        if (p.behavior === 'defect' && actionsPool.includes('defect')) action = 'defect';
        if (p.behavior === 'random') action = actionsPool[Math.floor(Math.random() * actionsPool.length)];
        
        await fetch(`${API_BASE}/matches/${mId}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: p.id, action })
        });
      }
      await delay(2000); // Wait for round resolution
    }

    console.log(`[HouseBotRunner] Match ${mId} finished.`);
  } catch (error) {
    console.error('[HouseBotRunner] Error running match:', error);
  }
}

async function main() {
  console.log(`[HouseBotRunner] Initialized. Running match every ${RUN_INTERVAL_MS / 1000 / 60} minutes.`);
  
  // Run one immediately
  await runMatch();

  // Schedule loop
  setInterval(() => {
    runMatch();
  }, RUN_INTERVAL_MS);
}

main();
