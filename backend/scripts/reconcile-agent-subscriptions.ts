import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function inferHouseBotGames(agentName: string): string[] {
  const n = agentName.toLowerCase();

  if (n.includes('ttt')) return ['tic_tac_toe'];
  if (n.includes('rockbot') || n.includes('rps')) return ['rock_paper_scissors'];
  if (n.includes('hawk') || n.includes('dove')) return ['chicken'];
  if (n.includes('startup') || n.includes('venture')) return ['startup_valuation'];
  if (n.includes('standoff')) return ['mexican_standoff'];
  if (n.includes('liarspoker') || n.includes('liars')) return ['liars_poker'];
  if (n.includes('mafiabot') || n.includes('villager')) return ['mafia'];
  if (n.includes('cooperator') || n.includes('defector') || n.includes('titfortat')) {
    return ['prisoners_dilemma', 'chicken'];
  }

  return ['prisoners_dilemma'];
}

async function main() {
  const approvedGames = await prisma.gameSpecification.findMany({
    where: { status: 'approved' },
    select: { key: true },
  });
  const approvedKeys = new Set(approvedGames.map((g) => g.key));

  const agents = await prisma.agent.findMany({
    include: {
      participants: {
        include: {
          match: {
            select: { gameType: true },
          },
        },
      },
      actions: {
        include: {
          match: {
            select: { gameType: true },
          },
        },
      },
      subscriptions: true,
    },
  });

  const rows: { agentId: string; gameKey: string }[] = [];

  for (const agent of agents) {
    const inferred = new Set<string>();

    // 1) HouseBot capability map
    if (agent.owner === 'HouseBot') {
      for (const g of inferHouseBotGames(agent.name)) inferred.add(g);
    } else {
      // Non-house agents: infer from observed behavior + keep explicit manual choices.
      for (const p of agent.participants) {
        inferred.add(p.match.gameType);
      }
      for (const a of agent.actions) {
        inferred.add(a.match.gameType);
      }
      for (const s of agent.subscriptions) inferred.add(s.gameKey);
    }

    // Normalize to approved games only
    const finalGames = [...inferred].filter((k) => approvedKeys.has(k));
    for (const gameKey of finalGames) {
      rows.push({ agentId: agent.id, gameKey });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.agentGameSubscription.deleteMany({});
    if (rows.length > 0) {
      await tx.agentGameSubscription.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
  });

  const byGame = await prisma.agentGameSubscription.groupBy({
    by: ['gameKey'],
    _count: { gameKey: true },
    orderBy: { gameKey: 'asc' },
  });

  console.log(`Reconciliation complete. total_subscriptions=${rows.length}`);
  for (const row of byGame) {
    console.log(`${row.gameKey}: ${row._count.gameKey}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
