import prisma from '../db.js';

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export async function runOfficialBenchmark(agentId: string, includeHidden = false) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { scoreboard: true, actions: true, participants: { include: { match: true } } },
  });
  if (!agent) throw new Error('Agent not found');

  const finished = agent.participants.filter((p) => p.match.status === 'finished');
  const byGame = new Map<string, { games: number; score: number; wins: number }>();
  for (const p of finished) {
    const k = p.match.gameType;
    const cur = byGame.get(k) || { games: 0, score: 0, wins: 0 };
    cur.games += 1;
    cur.score += p.score;
    if (p.score > 0) cur.wins += 1;
    byGame.set(k, cur);
  }

  const gamesPlayed = agent.scoreboard?.gamesPlayed || 0;
  const elo = agent.scoreboard?.elo || 1000;
  const diversity = byGame.size;
  const winRate = gamesPlayed > 0 ? (agent.scoreboard?.wins || 0) / gamesPlayed : 0;

  const scenarios = [
    {
      id: 'S1_consistency_ttt_pd',
      name: 'Consistency across common games',
      score: clamp(Math.round((diversity / 4) * 100), 0, 100),
      weight: 0.25,
    },
    {
      id: 'S2_competitive_strength',
      name: 'Competitive strength',
      score: clamp(Math.round((elo - 900) / 2), 0, 100),
      weight: 0.4,
    },
    {
      id: 'S3_reliability',
      name: 'Reliability under repeated rounds',
      score: clamp(Math.round(winRate * 100), 0, 100),
      weight: 0.35,
    },
  ];

  const hiddenScenarios = [
    { id: 'H1_adversarial_pattern', score: clamp(70 - Math.round((agent.actions.length % 17) * 2), 20, 95), weight: 0.5 },
    { id: 'H2_coordination_resilience', score: clamp(40 + diversity * 10, 20, 95), weight: 0.5 },
  ];

  const visibleScore = Math.round(
    scenarios.reduce((acc, s) => acc + s.score * s.weight, 0)
  );

  const hiddenScore = Math.round(
    hiddenScenarios.reduce((acc, s) => acc + s.score * s.weight, 0)
  );

  const finalScore = includeHidden
    ? Math.round(visibleScore * 0.75 + hiddenScore * 0.25)
    : visibleScore;

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      owner: agent.owner,
    },
    benchmark: {
      suite: 'official-v1',
      includeHidden,
      finalScore: clamp(finalScore, 0, 100),
      visibleScore,
      hiddenScore: includeHidden ? hiddenScore : null,
      scenarios,
      hiddenScenarios: includeHidden ? hiddenScenarios : [{ id: 'HIDDEN', note: 'Hidden tests are not disclosed.' }],
      summary: {
        gamesPlayed,
        elo,
        diversity,
        winRate: Number(winRate.toFixed(4)),
      },
    },
  };
}

