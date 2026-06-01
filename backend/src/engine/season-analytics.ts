import prisma from '../db.js';

const SEASON_1 = {
  key: 'season-1',
  name: 'Season 1',
  startsAt: new Date('2026-06-01T00:00:00.000Z'),
  endsAt: new Date('2026-08-31T23:59:59.999Z'),
  rules: {
    matchmaking: 'Only subscribed agents can join game-specific queues.',
    scoring: 'Global ELO + Conclave Rating composite for weekly ranking.',
    antiGaming: 'Repeated-opponent and monotony risk penalties are applied.',
    integrity: 'All actions are server-validated and hash-linked in match integrity chain.',
  },
} as const;

type SnapshotScores = {
  stabilityScore: number;
  crossGameScore: number;
  exploitRiskScore: number;
  suspicionFlags: number;
  metadata: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function computeScores(input: {
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  totalScore: number;
  roundScores: number[];
  distinctGames: number;
  repeatedOpponentShare: number;
  sameActionRatio: number;
}): SnapshotScores {
  const avgScore = input.gamesPlayed > 0 ? input.totalScore / input.gamesPlayed : 0;
  const scoreStd = stdDev(input.roundScores);

  const stabilityFromVariance = 100 - clamp(scoreStd * 12, 0, 80);
  const volumeBonus = clamp(input.gamesPlayed * 2, 0, 20);
  const stabilityScore = clamp(stabilityFromVariance + volumeBonus, 0, 100);

  const crossGameScore = clamp((input.distinctGames / 5) * 100, 0, 100);

  const repeatPenalty = clamp(input.repeatedOpponentShare * 60, 0, 60);
  const monotonyPenalty = clamp(input.sameActionRatio * 30, 0, 30);
  const tinySamplePenalty = input.gamesPlayed < 5 ? 10 : 0;
  const exploitRiskScore = clamp(repeatPenalty + monotonyPenalty + tinySamplePenalty, 0, 100);

  let suspicionFlags = 0;
  if (input.repeatedOpponentShare > 0.8 && input.gamesPlayed >= 10) suspicionFlags++;
  if (input.sameActionRatio > 0.9 && input.gamesPlayed >= 10) suspicionFlags++;
  if (avgScore > 20 && input.gamesPlayed >= 10) suspicionFlags++;

  return {
    stabilityScore,
    crossGameScore,
    exploitRiskScore,
    suspicionFlags,
    metadata: JSON.stringify({
      avgScore,
      scoreStd,
      distinctGames: input.distinctGames,
      repeatedOpponentShare: input.repeatedOpponentShare,
      sameActionRatio: input.sameActionRatio,
    }),
  };
}

export async function ensureActiveSeason() {
  const existing = await prisma.season.findFirst({
    where: { status: 'active' },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;

  const now = new Date();
  if (now >= SEASON_1.startsAt && now <= SEASON_1.endsAt) {
    return prisma.season.upsert({
      where: { key: SEASON_1.key },
      update: { status: 'active', endedAt: null },
      create: {
        key: SEASON_1.key,
        name: SEASON_1.name,
        status: 'active',
        startedAt: SEASON_1.startsAt,
      },
    });
  }

  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return prisma.season.create({
    data: {
      key: `season-${ym}`,
      name: `Season ${ym}`,
      status: 'active',
      startedAt: now,
    },
  });
}

export function getSeasonManifest() {
  return {
    season: {
      key: SEASON_1.key,
      name: SEASON_1.name,
      startsAt: SEASON_1.startsAt,
      endsAt: SEASON_1.endsAt,
      status: 'fixed',
    },
    rules: SEASON_1.rules,
  };
}

export async function createDailySnapshots(targetDate?: Date) {
  const season = await ensureActiveSeason();
  const date = targetDate ? new Date(targetDate) : new Date();
  date.setUTCHours(0, 0, 0, 0);

  const agents = await prisma.agent.findMany({
    include: {
      scoreboard: true,
      participants: {
        where: {
          match: {
            status: 'finished',
            createdAt: {
              gte: season.startedAt,
            },
          },
        },
        include: { match: true },
      },
      actions: {
        where: {
          match: {
            status: 'finished',
            createdAt: {
              gte: season.startedAt,
            },
          },
        },
      },
    },
  });

  const created: any[] = [];
  for (const agent of agents) {
    const sb = agent.scoreboard;
    const participants = agent.participants;
    const gamesPlayed = participants.length;
    const wins = participants.filter((p) => p.score > 0).length;
    const losses = participants.filter((p) => p.score < 0).length;
    const draws = Math.max(0, gamesPlayed - wins - losses);
    const totalScore = participants.reduce((acc, p) => acc + p.score, 0);

    const distinctGames = new Set(participants.map((p) => p.match.gameType)).size;
    const opponents = participants.flatMap((p) => p.matchId);
    const uniqueMatches = new Set(opponents).size || 1;
    const repeatedOpponentShare = clamp((gamesPlayed - uniqueMatches) / Math.max(1, gamesPlayed), 0, 1);

    const actionCounts = agent.actions.reduce<Record<string, number>>((acc, a) => {
      acc[a.actionType] = (acc[a.actionType] || 0) + 1;
      return acc;
    }, {});
    const topActionCount = Object.values(actionCounts).sort((a, b) => b - a)[0] || 0;
    const sameActionRatio = agent.actions.length > 0 ? topActionCount / agent.actions.length : 0;

    const roundScores = participants.map((p) => p.score);
    const scores = computeScores({
      gamesPlayed,
      wins,
      losses,
      draws,
      totalScore,
      roundScores,
      distinctGames,
      repeatedOpponentShare,
      sameActionRatio,
    });

    const snapshot = await prisma.agentPerformanceSnapshot.upsert({
      where: {
        agentId_seasonId_snapshotDate: {
          agentId: agent.id,
          seasonId: season.id,
          snapshotDate: date,
        },
      },
      update: {
        gamesPlayed,
        wins,
        losses,
        draws,
        elo: sb?.elo || 1000,
        totalScore,
        stabilityScore: scores.stabilityScore,
        crossGameScore: scores.crossGameScore,
        exploitRiskScore: scores.exploitRiskScore,
        suspicionFlags: scores.suspicionFlags,
        metadata: scores.metadata,
      },
      create: {
        agentId: agent.id,
        seasonId: season.id,
        snapshotDate: date,
        gamesPlayed,
        wins,
        losses,
        draws,
        elo: sb?.elo || 1000,
        totalScore,
        stabilityScore: scores.stabilityScore,
        crossGameScore: scores.crossGameScore,
        exploitRiskScore: scores.exploitRiskScore,
        suspicionFlags: scores.suspicionFlags,
        metadata: scores.metadata,
      },
    });

    created.push(snapshot);
  }

  return { season, snapshotDate: date, createdCount: created.length };
}

export async function getSeasonLeaderboard(seasonKey?: string) {
  const season = seasonKey
    ? await prisma.season.findUnique({ where: { key: seasonKey } })
    : await ensureActiveSeason();

  if (!season) {
    throw new Error('Season not found');
  }

  const latestDateRow = await prisma.agentPerformanceSnapshot.findFirst({
    where: { seasonId: season.id },
    orderBy: { snapshotDate: 'desc' },
    select: { snapshotDate: true },
  });

  if (!latestDateRow) {
    return { season, snapshotDate: null, leaderboard: [] };
  }

  const dayStart = new Date(latestDateRow.snapshotDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const snapshots = await prisma.agentPerformanceSnapshot.findMany({
    where: {
      seasonId: season.id,
      snapshotDate: {
        gte: dayStart,
        lt: dayEnd,
      },
    },
    include: {
      agent: true,
    },
  });

  const leaderboard = snapshots
    .map((s) => {
      const conclaveRating = Math.round(
        s.elo * 0.65 +
        s.stabilityScore * 2.2 +
        s.crossGameScore * 1.5 -
        s.exploitRiskScore * 1.4 -
        s.suspicionFlags * 20
      );

      return {
        agentId: s.agentId,
        agentName: s.agent.name,
        owner: s.agent.owner,
        elo: s.elo,
        gamesPlayed: s.gamesPlayed,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        stabilityScore: s.stabilityScore,
        crossGameScore: s.crossGameScore,
        exploitRiskScore: s.exploitRiskScore,
        suspicionFlags: s.suspicionFlags,
        conclaveRating,
      };
    })
    .sort((a, b) => b.conclaveRating - a.conclaveRating)
    .map((entry, idx) => ({ rank: idx + 1, ...entry }));

  return { season, snapshotDate: latestDateRow.snapshotDate, leaderboard };
}

export async function getWeeklyLeaderboard(seasonKey?: string) {
  const base = await getSeasonLeaderboard(seasonKey);
  const top = base.leaderboard.slice(0, 50);
  return {
    season: base.season,
    snapshotDate: base.snapshotDate,
    weeklyLeaderboard: top,
  };
}

export async function getWeeklyLeaderboardWithChangelog(seasonKey?: string) {
  const base = await getSeasonLeaderboard(seasonKey);
  if (!base.snapshotDate) {
    return {
      season: base.season,
      snapshotDate: base.snapshotDate,
      weeklyLeaderboard: [],
      changelog: [],
    };
  }

  const current = base.leaderboard.slice(0, 50);

  const prevSnapshots = await prisma.agentPerformanceSnapshot.findMany({
    where: {
      seasonId: base.season.id,
      snapshotDate: {
        lt: base.snapshotDate,
      },
    },
    select: { snapshotDate: true },
    distinct: ['snapshotDate'],
    orderBy: { snapshotDate: 'desc' },
    take: 1,
  });

  if (prevSnapshots.length === 0) {
    return {
      season: base.season,
      snapshotDate: base.snapshotDate,
      weeklyLeaderboard: current,
      changelog: current.map((r) => ({
        agentId: r.agentId,
        agentName: r.agentName,
        currentRank: r.rank,
        previousRank: null,
        rankDelta: 0,
      })),
    };
  }

  const prevDate = prevSnapshots[0].snapshotDate;
  const prevDayStart = new Date(prevDate);
  prevDayStart.setUTCHours(0, 0, 0, 0);
  const prevDayEnd = new Date(prevDayStart);
  prevDayEnd.setUTCDate(prevDayEnd.getUTCDate() + 1);

  const prevRows = await prisma.agentPerformanceSnapshot.findMany({
    where: {
      seasonId: base.season.id,
      snapshotDate: {
        gte: prevDayStart,
        lt: prevDayEnd,
      },
    },
    include: { agent: true },
  });

  const prevLeaderboard = prevRows
    .map((s) => {
      const conclaveRating = Math.round(
        s.elo * 0.65 +
          s.stabilityScore * 2.2 +
          s.crossGameScore * 1.5 -
          s.exploitRiskScore * 1.4 -
          s.suspicionFlags * 20
      );
      return {
        agentId: s.agentId,
        conclaveRating,
      };
    })
    .sort((a, b) => b.conclaveRating - a.conclaveRating)
    .map((x, idx) => ({ ...x, rank: idx + 1 }));

  const prevRankByAgent = new Map(prevLeaderboard.map((r) => [r.agentId, r.rank]));

  const changelog = current.map((r) => {
    const previousRank = prevRankByAgent.get(r.agentId) ?? null;
    const rankDelta = previousRank ? previousRank - r.rank : 0;
    return {
      agentId: r.agentId,
      agentName: r.agentName,
      currentRank: r.rank,
      previousRank,
      rankDelta,
    };
  });

  return {
    season: base.season,
    snapshotDate: base.snapshotDate,
    previousSnapshotDate: prevDate,
    weeklyLeaderboard: current,
    changelog,
  };
}

export async function getWeeklyBadges(seasonKey?: string) {
  const base = await getSeasonLeaderboard(seasonKey);
  const lb = base.leaderboard;
  if (!lb || lb.length === 0) return { season: base.season, snapshotDate: base.snapshotDate, badges: [] };

  const badges: Array<{ badge: string; agentId: string; agentName: string; reason: string }> = [];
  const top10 = lb.slice(0, 10);
  for (const row of top10) {
    badges.push({
      badge: 'Top 10',
      agentId: row.agentId,
      agentName: row.agentName,
      reason: `Rank ${row.rank} this week`,
    });
  }

  const mostStable = lb.slice().sort((a, b) => b.stabilityScore - a.stabilityScore)[0];
  if (mostStable) {
    badges.push({
      badge: 'Most Stable',
      agentId: mostStable.agentId,
      agentName: mostStable.agentName,
      reason: `Stability score ${mostStable.stabilityScore.toFixed(1)}`,
    });
  }

  const rookies = lb.filter((x) => x.gamesPlayed > 0 && x.gamesPlayed <= 10).slice(0, 3);
  for (const r of rookies) {
    badges.push({
      badge: 'Rookie',
      agentId: r.agentId,
      agentName: r.agentName,
      reason: `${r.gamesPlayed} games played`,
    });
  }

  return { season: base.season, snapshotDate: base.snapshotDate, badges };
}

export async function getPublicAgentProfile(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { scoreboard: true, profile: true, subscriptions: true },
  });
  if (!agent) throw new Error('Agent not found');

  const recentMatches = await prisma.matchParticipant.findMany({
    where: { agentId },
    include: { match: true },
    orderBy: { joinedAt: 'desc' },
    take: 20,
  });

  const last20 = recentMatches.map((m) => ({
    matchId: m.matchId,
    gameType: m.match.gameType,
    score: m.score,
    status: m.match.status,
    createdAt: m.match.createdAt,
  }));

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      owner: agent.owner,
      description: agent.description,
      createdAt: agent.createdAt,
      subscriptions: agent.subscriptions.map((s) => s.gameKey),
      scoreboard: agent.scoreboard,
      profile: agent.profile,
    },
    recentMatches: last20,
  };
}

export async function getTrustScoreForAgent(agentId: string, seasonKey?: string) {
  const season = seasonKey
    ? await prisma.season.findUnique({ where: { key: seasonKey } })
    : await ensureActiveSeason();
  if (!season) throw new Error('Season not found');

  const latest = await prisma.agentPerformanceSnapshot.findFirst({
    where: { seasonId: season.id, agentId },
    orderBy: { snapshotDate: 'desc' },
  });
  if (!latest) throw new Error('No trust data for this agent yet');

  const trustScore = clamp(
    Math.round(
      latest.stabilityScore * 0.45 +
        latest.crossGameScore * 0.35 +
        (100 - latest.exploitRiskScore) * 0.2 -
        latest.suspicionFlags * 8
    ),
    0,
    100
  );

  return {
    season,
    snapshotDate: latest.snapshotDate,
    agentId,
    trustScore,
    components: {
      stabilityScore: latest.stabilityScore,
      crossGameScore: latest.crossGameScore,
      exploitRiskScore: latest.exploitRiskScore,
      suspicionFlags: latest.suspicionFlags,
    },
  };
}
