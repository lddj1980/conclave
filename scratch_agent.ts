
const API_BASE = 'http://localhost:3012/api';
const AGENT_NAME = 'AntigravityAgent';

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAgent() {
  console.log(`=== Starting ${AGENT_NAME} Client ===`);

  // 1. Register agent
  let agentId = '';
  try {
    const regRes = await fetch(`${API_BASE}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: AGENT_NAME,
        owner: 'Antigravity AI',
        description: 'Tit-for-Tat Strategy (cooperates on round 1, then mirrors opponent)',
      }),
    });
    if (regRes.ok) {
      const agent = await regRes.json();
      agentId = agent.id;
      console.log(`Agent registered successfully. ID: ${agentId}`);
    } else {
      // If already registered, fetch the list and find the ID
      const agentsRes = await fetch(`${API_BASE}/agents`);
      const agentsList = await agentsRes.json();
      const existing = agentsList.find((a: any) => a.name === AGENT_NAME);
      if (existing) {
        agentId = existing.id;
        console.log(`Using existing agent registration. ID: ${agentId}`);
      } else {
        throw new Error('Failed to register agent.');
      }
    }
  } catch (error: any) {
    console.error('Registration failed:', error.message);
    return;
  }

  console.log('Listening for active matches...');

  // 2. Poll matches and play if we are in a match
  while (true) {
    try {
      const matchesRes = await fetch(`${API_BASE}/matches`);
      const matches = await matchesRes.json();

      // Find a match that is in_progress and we are part of, or a match waiting for players that we can join
      const myActiveMatch = matches.find((m: any) => 
        m.status === 'in_progress' && m.participants.some((p: any) => p.agentId === agentId)
      );

      if (myActiveMatch) {
        const mId = myActiveMatch.id;
        // Fetch detailed match info to see rounds and submit action
        const detailRes = await fetch(`${API_BASE}/matches/${mId}`);
        const matchDetail = await detailRes.json();

        const currentRoundNumber = matchDetail.currentRound;
        const currentRound = matchDetail.rounds.find((r: any) => r.roundNumber === currentRoundNumber);

        if (currentRound && currentRound.status === 'waiting_for_actions') {
          // Check if we already played this round
          const alreadyPlayed = currentRound.actions.some((a: any) => a.agentId === agentId);

          if (!alreadyPlayed) {
            console.log(`\nActive Round: ${currentRoundNumber}`);
            
            // Determine action (Tit-for-Tat)
            let move: 'cooperate' | 'defect' = 'cooperate';

            if (currentRoundNumber > 1) {
              const prevRoundNumber = currentRoundNumber - 1;
              const prevRound = matchDetail.rounds.find((r: any) => r.roundNumber === prevRoundNumber);
              
              if (prevRound) {
                // Find opponent's action in the previous round
                const opponentAction = prevRound.actions.find((a: any) => a.agentId !== agentId);
                if (opponentAction) {
                  move = opponentAction.actionType;
                  console.log(`Opponent played ${move.toUpperCase()} last round. Mirroring move...`);
                }
              }
            } else {
              console.log('Round 1: Playing default move (COOPERATE)...');
            }

            // Submit action
            const actionRes = await fetch(`${API_BASE}/matches/${mId}/actions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agentId,
                action: move,
              }),
            });

            if (actionRes.ok) {
              console.log(`Successfully submitted action: ${move.toUpperCase()}`);
            } else {
              const err = await actionRes.json();
              console.error('Failed to submit action:', err.error);
            }
          }
        }
      } else {
        // Look for a match waiting for players that we haven't joined yet
        const joinableMatch = matches.find((m: any) => 
          m.status === 'waiting_for_players' && !m.participants.some((p: any) => p.agentId === agentId)
        );

        if (joinableMatch) {
          console.log(`Found joinable match: ${joinableMatch.id}. Joining...`);
          const joinRes = await fetch(`${API_BASE}/matches/${joinableMatch.id}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId }),
          });
          if (joinRes.ok) {
            console.log('Joined match. Waiting for it to start...');
          } else {
            console.error('Failed to join match.');
          }
        }
      }
    } catch (e: any) {
      console.error('Error in agent loop:', e.message);
    }

    await delay(2000);
  }
}

runAgent();
