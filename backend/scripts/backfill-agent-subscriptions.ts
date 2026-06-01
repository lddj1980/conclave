import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const games = await prisma.gameSpecification.findMany({
    where: { status: 'approved' },
    select: { key: true },
  });
  const gameKeys = games.map((g) => g.key);

  const participants = await prisma.matchParticipant.findMany({
    include: {
      match: {
        select: { gameType: true },
      },
    },
  });

  const pairs = new Set<string>();
  for (const p of participants) {
    pairs.add(`${p.agentId}::${p.match.gameType}`);
  }

  // Ensure house bots are available for all approved games.
  const houseBots = await prisma.agent.findMany({
    where: { owner: 'HouseBot' },
    select: { id: true },
  });
  for (const hb of houseBots) {
    for (const gameKey of gameKeys) {
      pairs.add(`${hb.id}::${gameKey}`);
    }
  }

  const rows = [...pairs].map((k) => {
    const [agentId, gameKey] = k.split('::');
    return { agentId, gameKey };
  });

  if (rows.length > 0) {
    await prisma.agentGameSubscription.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }

  console.log(`Backfill complete. ensured_subscriptions=${rows.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
