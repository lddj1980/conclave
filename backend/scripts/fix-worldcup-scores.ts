import prisma from '../db.js';
import { fetchScoresForFixtures } from '../engine/worldcup-scores.js';
import { getWorldCupSchedule } from '../data/worldcup-2026-schedule.js';
import { calculateElo } from '../engine/prisoners-dilemma.js';

async function fixPastWorldCupScores() {
  console.log('[FixScores] Starting fix for past World Cup matches...');

  const schedule = getWorldCupSchedule();
  const now = new Date();
  const pastFixtures = schedule.filter(f => new Date(f.kickoff) <= now);

  console.log(`[FixScores] Found ${pastFixtures.length} past fixtures in schedule`);

  const scores = await fetchScoresForFixtures(pastFixtures);

  const dbMatches = await prisma.match.findMany({
    where: {
      gameType: 'world_cup_prediction',
      status: 'finished',
    },
    include: {
      rounds: {
        where: { roundNumber: 1 },
        include: { actions: true, payload: true },
      },
      participants: { include: { agent: true } },
    },
  });

  console.log(`[FixScores] Found ${dbMatches.length} finished matches in DB`);

  let updated = 0;
  let rescored = 0;

  for (const match of dbMatches) {
    const round = match.rounds[0];
    if (!round || !round.payload) continue;

    let payload: any;
    try { payload = JSON.parse(round.payload); } catch { continue; }

    const fixtureId = payload.fixtureId;
    if (!fixtureId) continue;

    const correctScore = scores.get(fixtureId);
    if (!correctScore) continue;

    const currentHome = round.actions.find(a => a.actionType === 'predict_home')?.payload as number | undefined;
    const currentAway = round.actions.find(a => a.actionType === 'predict_away')?.payload as number | undefined;
    if (currentHome === undefined || currentAway === undefined) continue;

    const wasCorrect = currentHome === correctScore.home && currentAway === correctScore.away;

    if (wasCorrect) continue;

    const newPayload = {
      ...payload,
      score: { home: correctScore.home, away: correctScore.away },
      result: correctScore.home > correctScore.away ? 'home' : correctScore.home < correctScore.away ? 'away' : 'draw',
    };

    await prisma.$transaction(async (tx) => {
      await tx.round.update({
        where: { id: round.id },
        data: { payload: JSON.stringify(newPayload) },
      });

      for (const p of match.participants) {
        const predHome = p.rounds?.[0]?.actions?.find(a => a.actionType === 'predict_home')?.payload as number | undefined;
        const predAway = p.rounds?.[0]?.actions?.find(a => a.actionType === 'predict_away')?.payload as number | undefined;
        if (predHome === undefined || predAway === undefined) continue;

        const isCorrect = predHome === correctScore.home && predAway === correctScore.away;
        const newScore = isCorrect ? 3 : 0;
        const oldScore = p.score || 0;

        if (newScore !== oldScore) {
          await tx.matchParticipant.update({
            where: { id: p.id },
            data: { score: newScore },
          });

          await tx.agent.update({
            where: { id: p.agentId },
            data: { score: { increment: newScore - oldScore } },
          });
          rescored++;
        }
      }
    });

    updated++;
    console.log(`[FixScores] Match ${match.matchSeed}: ${payload.homeTeam} ${correctScore.home}-${correctScore.away} ${payload.awayTeam} | Updated ${match.participants.length} predictions`);
  }

  console.log(`[FixScores] Done. Updated ${updated} matches, rescored ${rescored} predictions.`);
}

fixPastWorldCupScores()
  .catch(err => { console.error('[FixScores] Error:', err); process.exit(1); })
  .finally(() => { prisma.$disconnect(); process.exit(0); });
