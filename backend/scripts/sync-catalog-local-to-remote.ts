import { PrismaClient } from '@prisma/client';

type SyncStats = {
  gamesUpserted: number;
  houseBotsUpserted: number;
  profilesUpserted: number;
  scoreboardsUpserted: number;
  subscriptionsUpserted: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const sourceUrl = requiredEnv('SOURCE_DATABASE_URL');
  const targetUrl = requiredEnv('TARGET_DATABASE_URL');

  const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });

  const stats: SyncStats = {
    gamesUpserted: 0,
    houseBotsUpserted: 0,
    profilesUpserted: 0,
    scoreboardsUpserted: 0,
    subscriptionsUpserted: 0,
  };

  try {
    const approvedGames = await source.gameSpecification.findMany({
      where: { status: 'approved' },
      orderBy: { key: 'asc' },
    });

    for (const g of approvedGames) {
      await target.gameSpecification.upsert({
        where: { key: g.key },
        update: {
          name: g.name,
          description: g.description,
          status: 'approved',
          turnType: g.turnType,
          infoType: g.infoType,
          maxPlayers: g.maxPlayers,
          totalRounds: g.totalRounds,
          actions: g.actions,
          payoffRules: g.payoffRules,
          codeScript: g.codeScript,
          actionSchema: g.actionSchema,
          submittedBy: g.submittedBy,
        },
        create: {
          key: g.key,
          name: g.name,
          description: g.description,
          status: 'approved',
          turnType: g.turnType,
          infoType: g.infoType,
          maxPlayers: g.maxPlayers,
          totalRounds: g.totalRounds,
          actions: g.actions,
          payoffRules: g.payoffRules,
          codeScript: g.codeScript,
          actionSchema: g.actionSchema,
          submittedBy: g.submittedBy,
        },
      });
      stats.gamesUpserted += 1;
    }

    const approvedKeys = new Set(approvedGames.map((g) => g.key));

    const sourceHouseBots = await source.agent.findMany({
      where: { owner: 'HouseBot' },
      include: {
        profile: true,
        scoreboard: true,
        subscriptions: true,
      },
      orderBy: { name: 'asc' },
    });

    for (const bot of sourceHouseBots) {
      const targetBot = await target.agent.upsert({
        where: { name: bot.name },
        update: {
          owner: bot.owner,
          isHuman: false,
          description: bot.description,
          status: bot.status || 'idle',
        },
        create: {
          name: bot.name,
          owner: bot.owner,
          isHuman: false,
          description: bot.description,
          status: bot.status || 'idle',
        },
      });
      stats.houseBotsUpserted += 1;

      if (bot.profile) {
        await target.agentProfile.upsert({
          where: { agentId: targetBot.id },
          update: {
            mood: bot.profile.mood,
            achievements: bot.profile.achievements,
            pride: bot.profile.pride,
            customBio: bot.profile.customBio,
          },
          create: {
            agentId: targetBot.id,
            mood: bot.profile.mood,
            achievements: bot.profile.achievements,
            pride: bot.profile.pride,
            customBio: bot.profile.customBio,
          },
        });
        stats.profilesUpserted += 1;
      }

      if (bot.scoreboard) {
        await target.scoreboard.upsert({
          where: { agentId: targetBot.id },
          update: {
            gamesPlayed: bot.scoreboard.gamesPlayed,
            wins: bot.scoreboard.wins,
            losses: bot.scoreboard.losses,
            draws: bot.scoreboard.draws,
            totalScore: bot.scoreboard.totalScore,
            elo: bot.scoreboard.elo,
          },
          create: {
            agentId: targetBot.id,
            gamesPlayed: bot.scoreboard.gamesPlayed,
            wins: bot.scoreboard.wins,
            losses: bot.scoreboard.losses,
            draws: bot.scoreboard.draws,
            totalScore: bot.scoreboard.totalScore,
            elo: bot.scoreboard.elo,
          },
        });
        stats.scoreboardsUpserted += 1;
      }

      await target.agentGameSubscription.deleteMany({ where: { agentId: targetBot.id } });
      const gamesForBot = bot.subscriptions
        .map((s) => s.gameKey)
        .filter((k) => approvedKeys.has(k));

      if (gamesForBot.length > 0) {
        await target.agentGameSubscription.createMany({
          data: gamesForBot.map((gameKey) => ({ agentId: targetBot.id, gameKey })),
          skipDuplicates: true,
        });
        stats.subscriptionsUpserted += gamesForBot.length;
      }
    }

    const chess = await target.gameSpecification.findUnique({ where: { key: 'chess' } });
    console.log(
      JSON.stringify(
        {
          ok: true,
          stats,
          chessApprovedInTarget: Boolean(chess && chess.status === 'approved'),
          chessStatus: chess?.status ?? null,
        },
        null,
        2
      )
    );
  } finally {
    await source.$disconnect();
    await target.$disconnect();
  }
}

main().catch((err) => {
  console.error('Catalog sync failed:', err);
  process.exit(1);
});

