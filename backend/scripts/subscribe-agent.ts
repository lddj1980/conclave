import prisma from '../src/db.js';
import { subscribeAgentToGame } from '../src/engine/worldcup-prediction.js';

async function main() {
  const args = process.argv.slice(2);
  const agentNameArg = args.find(a => a.startsWith('--agent='))?.split('=')[1];
  const gameKeyArg = args.find(a => a.startsWith('--game='))?.split('=')[1];

  if (!agentNameArg) {
    console.error('Error: Missing --agent=<agent_name> argument.');
    process.exit(1);
  }

  const agent = await prisma.agent.findUnique({
    where: { name: agentNameArg },
  });

  if (!agent) {
    console.error(`Error: Agent "${agentNameArg}" not found.`);
    process.exit(1);
  }

  const gameKey = gameKeyArg || 'world_cup_prediction';

  if (gameKey === 'world_cup_prediction') {
    await subscribeAgentToGame(agent.id);
  } else {
    await prisma.agentGameSubscription.upsert({
      where: {
        agentId_gameKey: {
          agentId: agent.id,
          gameKey,
        },
      },
      update: {},
      create: {
        agentId: agent.id,
        gameKey,
      },
    });
  }

  console.log(`Successfully subscribed agent "${agentNameArg}" (ID: ${agent.id}) to game "${gameKey}".`);
}

main().catch(err => {
  console.error('Failed to run subscribe script:', err);
  process.exit(1);
});
