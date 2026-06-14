import prisma from '../src/db.js';

async function forceSettle() {
  const matches = await prisma.match.findMany({
    where: { gameType: 'world_cup_prediction', status: 'in_progress' },
    include: {
      participants: { include: { agent: true } },
      rounds: { where: { roundNumber: 1 }, include: { actions: true } },
    },
  });

  console.log(`Found ${matches.length} stuck matches.`);

  for (const match of matches) {
    const round = match.rounds[0];
    if (!round) {
      console.log(`Match ${match.id}: no round found, skipping.`);
      continue;
    }

    let fixture;
    try {
      fixture = JSON.parse(round.payload || '{}');
    } catch (e) {
      console.log(`Match ${match.id}: invalid payload, skipping.`);
      continue;
    }

    const kickoffTime = new Date(fixture.kickoffTime);
    if (new Date() < kickoffTime) {
      console.log(`Match ${match.id}: kickoff ${kickoffTime.toISOString()} not passed, skipping.`);
      continue;
    }

    const homeGoals = fixture.result?.home ?? 0;
    const awayGoals = fixture.result?.away ?? 0;
    const actualOutcome: 'home_win' | 'draw' | 'away_win' =
      homeGoals > awayGoals ? 'home_win' : (homeGoals < awayGoals ? 'away_win' : 'draw');

    await prisma.$transaction(async (tx) => {
      await tx.round.update({
        where: { id: round.id },
        data: { status: 'finished', finishedAt: new Date() },
      });

      for (const p of match.participants) {
        const predictionAction = round.actions.find(a => a.agentId === p.agentId);
        let score = 0;
        if (predictionAction && predictionAction.actionType === actualOutcome) {
          const actionPayload = JSON.parse(predictionAction.payload || '{}');
          const odds = actionPayload.odds || 2.0;
          score = Math.round(odds * 100);
        }
        await tx.matchParticipant.update({
          where: { id: p.id },
          data: { score },
        });
      }

      await tx.match.update({
        where: { id: match.id },
        data: { status: 'finished', finishedAt: new Date() },
      });

      await tx.matchLog.create({
        data: {
          matchId: match.id,
          eventType: 'match_finished',
          message: `Match force-settled via script. Result: ${fixture.homeTeam} ${homeGoals} - ${awayGoals} ${fixture.awayTeam} (${actualOutcome.toUpperCase()}).`,
          payload: JSON.stringify({ homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, homeGoals, awayGoals, actualOutcome }),
        },
      });
    });

    console.log(`Match ${match.id} (${fixture.homeTeam} vs ${fixture.awayTeam}) settled.`);
  }

  await prisma.$disconnect();
}

forceSettle().catch(err => { console.error('FATAL:', err); process.exit(1); });
