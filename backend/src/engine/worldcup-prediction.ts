import prisma from '../db.js';
import { calculateElo } from './prisoners-dilemma.js';
import { getWorldCupSchedule, getTodaysFixtures, getPastFixtures } from '../data/worldcup-2026-schedule.js';
import { fetchScoresForFixtures } from './worldcup-scores.js';

export interface WorldCupFixture {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: Date;
  status: 'NS' | 'FT' | 'CANC';
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
  score?: {
    home: number;
    away: number;
  };
}

// US1: Subscribe Agent to prediction game
export async function subscribeAgentToGame(agentId: string) {
  const sub = await prisma.agentGameSubscription.upsert({
    where: {
      agentId_gameKey: {
        agentId,
        gameKey: 'world_cup_prediction',
      },
    },
    update: {},
    create: {
      agentId,
      gameKey: 'world_cup_prediction',
    },
  });

  // Auto-enroll in all future prediction matches
  const matches = await prisma.match.findMany({
    where: { gameType: 'world_cup_prediction', status: 'in_progress' },
    include: {
      rounds: {
        where: { roundNumber: 1 },
        select: { payload: true }
      }
    }
  });

  for (const m of matches) {
    const roundOne = m.rounds[0];
    let eligible = true;
    if (roundOne && roundOne.payload) {
      try {
        const payloadObj = JSON.parse(roundOne.payload);
        const lockTimeStr = payloadObj.kickoffTime || payloadObj.lockTime;
        if (lockTimeStr) {
          const lockTime = new Date(lockTimeStr);
          if (new Date() >= lockTime) {
            eligible = false;
          }
        }
      } catch (e) {}
    }

    if (eligible) {
      await prisma.matchParticipant.createMany({
        data: [{
          matchId: m.id,
          agentId,
          role: 'competitor',
          status: 'joined',
        }],
        skipDuplicates: true,
      });

      await prisma.matchLog.create({
        data: {
          matchId: m.id,
          eventType: 'agent_joined',
          message: `Agent joined via game subscription auto-enrollment`,
          payload: JSON.stringify({ agentId }),
        }
      });
    }
  }

  return sub;
}

// US2: Fetch today's fixtures + past fixtures for settlement from static schedule
// Uses free public API for real scores, falls back to deterministic
export async function fetchDailyFixturesAndOdds(): Promise<WorldCupFixture[]> {
  const schedule = getWorldCupSchedule();
  const todayIds = new Set(getTodaysFixtures(schedule).map(f => f.id));
  const pastFixtures = getPastFixtures(schedule);
  const pastIds = new Set(pastFixtures.map(f => f.id));
  const allIds = new Set([...todayIds, ...pastIds]);

  const scores = await fetchScoresForFixtures(pastFixtures);

  return schedule
    .filter(f => allIds.has(f.id))
    .map(f => {
      const isPast = pastIds.has(f.id);
      const score = isPast ? scores.get(f.id) : undefined;
      return {
        fixtureId: f.id,
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam,
        kickoffTime: new Date(f.kickoff),
        status: isPast ? ('FT' as const) : ('NS' as const),
        homeOdds: 2.0,
        drawOdds: 3.0,
        awayOdds: 2.0,
        score: score ? { home: score.home, away: score.away } : undefined,
      };
    });
}

// US2: Create Match and Round sessions for daily fixtures
export async function createDailyMatches(fixtures: WorldCupFixture[]) {
  const subscriptions = await prisma.agentGameSubscription.findMany({
    where: { gameKey: 'world_cup_prediction' },
    include: { agent: true },
  });
  const subscribedAgents = subscriptions.map((s) => s.agent);

  // Pre-fetch existing in_progress matches for dedup by team name
  const existingMatches = await prisma.match.findMany({
    where: { gameType: 'world_cup_prediction' },
    include: { rounds: { where: { roundNumber: 1 }, select: { payload: true } } },
  });

  const createdMatches = [];

  for (const f of fixtures) {
    if (f.status === 'FT' || f.score || new Date() >= f.kickoffTime) continue;

    const matchSeed = `worldcup-fixture-${f.fixtureId}`;

    // Dedup by matchSeed or by team names (existing match from different fixture ID)
    const exists = existingMatches.some(m =>
      m.matchSeed === matchSeed ||
      (() => {
        try {
          const p = JSON.parse(m.rounds[0]?.payload || '{}');
          return p.homeTeam === f.homeTeam && p.awayTeam === f.awayTeam;
        } catch { return false; }
      })()
    );
    if (exists) continue;

    const homeOdds = f.homeOdds || 2.0;
    const drawOdds = f.drawOdds || 3.0;
    const awayOdds = f.awayOdds || 2.0;

    const match = await prisma.match.create({
      data: {
        gameType: 'world_cup_prediction',
        matchSeed: matchSeed,
        status: 'in_progress',
        maxPlayers: 1000,
        totalRounds: 1,
        currentRound: 1,
        createdBy: 'WorldCupHouseBot',
      },
    });

    const roundPayload = {
      fixtureId: f.fixtureId,
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
      kickoffTime: f.kickoffTime.toISOString(),
      odds: {
        home: homeOdds,
        draw: drawOdds,
        away: awayOdds,
      },
    };

    await prisma.round.create({
      data: {
        matchId: match.id,
        roundNumber: 1,
        status: 'waiting_for_actions',
        payload: JSON.stringify(roundPayload),
      },
    });

    for (const agent of subscribedAgents) {
      await prisma.matchParticipant.create({
        data: {
          matchId: match.id,
          agentId: agent.id,
          score: 0,
          status: 'joined',
        },
      });
    }

    await prisma.matchLog.create({
      data: {
        matchId: match.id,
        eventType: 'match_started',
        message: `Prediction Match created for ${f.homeTeam} vs ${f.awayTeam}. Odds: H:${homeOdds} D:${drawOdds} A:${awayOdds}`,
        payload: JSON.stringify(roundPayload),
      },
    });

    createdMatches.push(match);
  }

  return createdMatches;
}

// US2: Submit prediction action
export async function submitPrediction(
  matchId: string,
  agentId: string,
  prediction: 'home_win' | 'draw' | 'away_win'
) {
  return await prisma.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: { participants: true },
    });

    if (!match || match.gameType !== 'world_cup_prediction') {
      throw new Error('Valid prediction match not found.');
    }

    const participant = match.participants.find((p) => p.agentId === agentId);
    if (!participant) {
      throw new Error('Agent is not a participant in this match.');
    }

    const round = await tx.round.findFirst({
      where: { matchId, roundNumber: 1 },
    });

    if (!round) {
      throw new Error('Round 1 not found for this match.');
    }

    const metadata = JSON.parse(round.payload || '{}');
    const kickoffTime = new Date(metadata.kickoffTime);

    if (new Date() >= kickoffTime) {
      throw new Error('Kickoff time has passed. Predictions are locked.');
    }

    // Get locked odds from the round metadata
    const odds = metadata.odds;
    const oddsLocked = prediction === 'home_win' ? odds.home : (prediction === 'draw' ? odds.draw : odds.away);

    // Upsert Action (overwrite previous prediction turn)
    const action = await tx.action.upsert({
      where: {
        roundId_agentId: {
          roundId: round.id,
          agentId,
        },
      },
      update: {
        actionType: prediction,
        payload: JSON.stringify({ outcome: prediction, odds: oddsLocked }),
      },
      create: {
        matchId,
        roundId: round.id,
        agentId,
        actionType: prediction,
        payload: JSON.stringify({ outcome: prediction, odds: oddsLocked }),
      },
    });

    // Mark participant active
    await tx.matchParticipant.update({
      where: { id: participant.id },
      data: { status: 'active' },
    });

    await tx.matchLog.create({
      data: {
        matchId,
        eventType: 'action_submitted',
        message: `Agent submitted prediction: ${prediction} (Odds: ${oddsLocked})`,
      },
    });

    return { success: true, prediction: action.actionType, oddsLocked };
  });
}

// US3: Settle prediction matches and update scores + ELO
export async function settlePredictionMatches(fixtures: WorldCupFixture[]) {
  const settledCount = { matches: 0, predictions: 0 };

  // Pre-fetch all in_progress worldcup matches for fallback matching
  const allInProgressMatches = await prisma.match.findMany({
    where: { gameType: 'world_cup_prediction', status: 'in_progress' },
    include: {
      participants: { include: { agent: true } },
      rounds: { where: { roundNumber: 1 }, include: { actions: true } },
    },
  });

  for (const f of fixtures) {
    if (f.status !== 'FT' && !f.score) continue;
    if (new Date() < f.kickoffTime) continue;

    const matchSeed = `worldcup-fixture-${f.fixtureId}`;

    // Try direct match by fixture ID first, then fallback to team name matching
    let match = allInProgressMatches.find(m => m.matchSeed === matchSeed);

    if (!match) {
      match = allInProgressMatches.find(m => {
        const payload = m.rounds[0]?.payload;
        if (!payload) return false;
        try {
          const data = JSON.parse(payload);
          return data.homeTeam === f.homeTeam && data.awayTeam === f.awayTeam;
        } catch { return false; }
      });
    }

    if (!match) continue;

    const round = match.rounds[0];
    if (!round) continue;

    // Determine actual outcome
    const homeGoals = f.score!.home;
    const awayGoals = f.score!.away;
    const actualOutcome: 'home_win' | 'draw' | 'away_win' =
      homeGoals > awayGoals ? 'home_win' : (homeGoals < awayGoals ? 'away_win' : 'draw');

    await prisma.$transaction(async (tx) => {
      // 1. Mark round finished
      await tx.round.update({
        where: { id: round.id },
        data: { status: 'finished', finishedAt: new Date() },
      });

      // 2. Score participants
      const participantsWithPredictions = [];
      for (const p of match.participants) {
        const predictionAction = round.actions.find((a) => a.agentId === p.agentId);
        let participantScore = 0;

        if (predictionAction && predictionAction.actionType === actualOutcome) {
          let odds = 2.0;
          if (predictionAction.payload) {
            try {
              const actionPayload = JSON.parse(predictionAction.payload);
              odds = actionPayload.odds || 2.0;
            } catch (e) {}
          }
          participantScore = Math.round(odds * 100);
        }

        await tx.matchParticipant.update({
          where: { id: p.id },
          data: { score: participantScore },
        });

        participantsWithPredictions.push({
          ...p,
          score: participantScore,
        });

        settledCount.predictions++;
      }

      // 3. ELO Calculation (FFA ranking)
      const sortedParticipants = [...participantsWithPredictions].sort((a, b) => b.score - a.score);

      for (let i = 0; i < sortedParticipants.length; i++) {
        const p1 = sortedParticipants[i];
        let eloChange = 0;
        const sb1 = await tx.scoreboard.upsert({
          where: { agentId: p1.agentId },
          update: {},
          create: { agentId: p1.agentId },
        });

        let wins = 0, losses = 0, draws = 0;

        for (let j = 0; j < sortedParticipants.length; j++) {
          if (i === j) continue;
          const p2 = sortedParticipants[j];
          const sb2 = await tx.scoreboard.upsert({
            where: { agentId: p2.agentId },
            update: {},
            create: { agentId: p2.agentId },
          });

          let outcome: 1 | 0.5 | 0 = 0.5;
          if (p1.score > p2.score) {
            outcome = 1;
            wins++;
          } else if (p1.score < p2.score) {
            outcome = 0;
            losses++;
          } else {
            draws++;
          }

          const eloCalc = calculateElo(sb1.elo, sb2.elo, outcome);
          eloChange += (eloCalc.newRatingA - sb1.elo);
        }

        const finalEloChange = sortedParticipants.length > 1
          ? Math.round(eloChange / (sortedParticipants.length - 1))
          : 0;

        await tx.scoreboard.update({
          where: { agentId: p1.agentId },
          data: {
            gamesPlayed: { increment: 1 },
            wins: { increment: wins > 0 && wins >= losses ? 1 : 0 },
            losses: { increment: losses > wins ? 1 : 0 },
            draws: { increment: draws > 0 && wins === 0 && losses === 0 ? 1 : 0 },
            totalScore: { increment: p1.score },
            elo: { increment: finalEloChange },
          },
        });

        await tx.agent.update({
          where: { id: p1.agentId },
          data: { status: 'idle' },
        });
      }

      // 4. Mark match finished
      await tx.match.update({
        where: { id: match.id },
        data: { status: 'finished', finishedAt: new Date() },
      });

      await tx.matchLog.create({
        data: {
          matchId: match.id,
          eventType: 'match_finished',
          message: `Match settled. Result: ${f.homeTeam} ${homeGoals} - ${awayGoals} ${f.awayTeam} (${actualOutcome.toUpperCase()}).`,
        },
      });

      settledCount.matches++;
    });
  }

  return settledCount;
}

// Auto-settle any in_progress matches whose kickoff has already passed
// but were not settled by settlePredictionMatches (e.g., orphaned matches
// whose fixture ID doesn't match any fixture from current API/mock data)
async function autoSettleOrphanMatches(): Promise<number> {
  const stuckMatches = await prisma.match.findMany({
    where: { gameType: 'world_cup_prediction', status: 'in_progress' },
    include: {
      participants: { include: { agent: true } },
      rounds: { where: { roundNumber: 1 }, include: { actions: true } },
    },
  });

  let settled = 0;
  for (const match of stuckMatches) {
    const round = match.rounds[0];
    if (!round) continue;

    let payload: any;
    try { payload = JSON.parse(round.payload || '{}'); } catch { continue; }

    const kickoffTime = new Date(payload.kickoffTime);
    if (new Date() < kickoffTime) continue;

    await prisma.$transaction(async (tx) => {
      await tx.round.update({
        where: { id: round.id },
        data: { status: 'finished', finishedAt: new Date() },
      });

      for (const p of match.participants) {
        await tx.matchParticipant.update({
          where: { id: p.id },
          data: { score: 0 },
        });
        await tx.agent.update({
          where: { id: p.agentId },
          data: { status: 'idle' },
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
          message: `Match auto-settled. Result unavailable. Fixture: ${payload.homeTeam || '?'} vs ${payload.awayTeam || '?'}`,
        },
      });
    });
    settled++;
  }

  return settled;
}

// Background sync and settlement loop
export function runWorldCupPredictionLoop() {
  console.log('[WorldCup] Starting prediction sync loop...');
  
  // Run once immediately on start
  void (async () => {
    try {
      const fixtures = await fetchDailyFixturesAndOdds();
      await createDailyMatches(fixtures);
      const result = await settlePredictionMatches(fixtures);
      if (result.matches > 0) {
        console.log(`[WorldCup] Initial sync: settled ${result.matches} matches and ${result.predictions} predictions.`);
      }
      const orphaned = await autoSettleOrphanMatches();
      if (orphaned > 0) {
        console.log(`[WorldCup] Auto-settled ${orphaned} orphan matches with past kickoff.`);
      }
    } catch (err: any) {
      console.error('[WorldCup] Error in initial prediction sync:', err.message);
    }
  })();

  // Set interval to run every 20 minutes
  setInterval(async () => {
    try {
      const fixtures = await fetchDailyFixturesAndOdds();
      await createDailyMatches(fixtures);
      const result = await settlePredictionMatches(fixtures);
      if (result.matches > 0) {
        console.log(`[WorldCup] Loop: settled ${result.matches} matches and ${result.predictions} predictions.`);
      }
      const orphaned = await autoSettleOrphanMatches();
      if (orphaned > 0) {
        console.log(`[WorldCup] Loop: auto-settled ${orphaned} orphan matches.`);
      }
    } catch (err: any) {
      console.error('[WorldCup] Error in prediction loop:', err.message);
    }
  }, 20 * 60 * 1000);
}

