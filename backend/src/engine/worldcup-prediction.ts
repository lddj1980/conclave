import prisma from '../db.js';
import { calculateElo } from './prisoners-dilemma.js';

export interface WorldCupFixture {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: Date;
  status: 'NS' | 'FT' | 'CANC'; // Not Started, Finished, Cancelled
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

// US2: Fetch fixtures (mocked or via api-football.com)
// US2: Fetch fixtures (mocked or via api-football.com)
// US2: Fetch fixtures (mocked or via api-football.com)
export async function fetchDailyFixturesAndOdds(): Promise<WorldCupFixture[]> {
  const legacyFixtures: WorldCupFixture[] = [
    {
      fixtureId: 1001,
      homeTeam: 'Qatar',
      awayTeam: 'Switzerland',
      kickoffTime: new Date('2026-06-13T18:00:00.000Z'),
      status: 'FT' as const,
      homeOdds: 3.50,
      drawOdds: 3.20,
      awayOdds: 2.10,
      score: { home: 1, away: 2 }
    },
    {
      fixtureId: 1002,
      homeTeam: 'Brazil',
      awayTeam: 'Morocco',
      kickoffTime: new Date('2026-06-13T21:00:00.000Z'),
      status: 'FT' as const,
      homeOdds: 1.40,
      drawOdds: 4.50,
      awayOdds: 7.50,
      score: { home: 2, away: 0 }
    },
    {
      fixtureId: 1003,
      homeTeam: 'Haiti',
      awayTeam: 'Scotland',
      kickoffTime: new Date('2026-06-14T00:00:00.000Z'),
      status: 'FT' as const,
      homeOdds: 5.50,
      drawOdds: 3.80,
      awayOdds: 1.60,
      score: { home: 1, away: 1 }
    },
    {
      fixtureId: 1004,
      homeTeam: 'Australia',
      awayTeam: 'Türkiye',
      kickoffTime: new Date('2026-06-14T03:00:00.000Z'),
      status: 'FT' as const,
      homeOdds: 2.80,
      drawOdds: 3.10,
      awayOdds: 2.50,
      score: { home: 0, away: 2 }
    }
  ];

  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    const fixtures: WorldCupFixture[] = [];
    const now = new Date();

    // Helper to generate mock fixtures for a given date
    const getMockFixturesForDate = (date: Date) => {
      const dateStr = date.toISOString().split('T')[0].replace(/-/g, ''); // e.g., "20260614"
      const dateVal = parseInt(dateStr, 10);
      
      const baseTime = new Date(date);
      baseTime.setUTCHours(18, 0, 0, 0);

      const fixturesInfo = [
        { index: 1, home: 'Qatar', away: 'Switzerland', offsetHours: 0, homeOdds: 3.50, drawOdds: 3.20, awayOdds: 2.10 },
        { index: 2, home: 'Brazil', away: 'Morocco', offsetHours: 3, homeOdds: 1.40, drawOdds: 4.50, awayOdds: 7.50 },
        { index: 3, home: 'Haiti', away: 'Scotland', offsetHours: 6, homeOdds: 5.50, drawOdds: 3.80, awayOdds: 1.60 },
        { index: 4, home: 'Australia', away: 'Türkiye', offsetHours: 9, homeOdds: 2.80, drawOdds: 3.10, awayOdds: 2.50 }
      ];

      return fixturesInfo.map(f => {
        const fixtureId = dateVal * 10 + f.index;
        const kickoffTime = new Date(baseTime.getTime() + f.offsetHours * 60 * 60 * 1000);
        
        // Settle if now is past kickoff + 2 hours
        const isFinished = now.getTime() >= kickoffTime.getTime() + 2 * 60 * 60 * 1000;
        
        return {
          fixtureId,
          homeTeam: f.home,
          awayTeam: f.away,
          kickoffTime,
          status: isFinished ? ('FT' as const) : ('NS' as const),
          homeOdds: f.homeOdds,
          drawOdds: f.drawOdds,
          awayOdds: f.awayOdds,
          score: isFinished ? {
            home: (fixtureId % 3),
            away: (fixtureId % 2)
          } : undefined
        };
      });
    };

    // Generate mock fixtures for yesterday and today
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = new Date();

    fixtures.push(...getMockFixturesForDate(yesterday));
    fixtures.push(...getMockFixturesForDate(today));

    // Append legacy fixtures to ensure old matches can be settled
    fixtures.push(...legacyFixtures);

    return fixtures;
  }

  // Real integration with api-football.com for yesterday and today
  try {
    const dates = [
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], // yesterday
      new Date().toISOString().split('T')[0] // today
    ];

    const fixturesMap = new Map<number, WorldCupFixture>();

    for (const dateStr of dates) {
      const response = await fetch(
        `https://v3.football.api-sports.io/fixtures?league=1&season=2026&date=${dateStr}`,
        {
          headers: {
            'x-apisports-key': apiKey,
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': 'v3.football.api-sports.io',
          },
        }
      );
      const data = await response.json();
      const fixturesData = data.response || [];

      for (const f of fixturesData) {
        fixturesMap.set(f.fixture.id, {
          fixtureId: f.fixture.id,
          homeTeam: f.teams.home.name,
          awayTeam: f.teams.away.name,
          kickoffTime: new Date(f.fixture.date),
          status: f.fixture.status.short,
          homeOdds: 2.0,
          drawOdds: 3.0,
          awayOdds: 2.0,
          score: f.fixture.status.short === 'FT' ? {
            home: f.goals.home,
            away: f.goals.away,
          } : undefined,
        });
      }
    }

    const fixtures = Array.from(fixturesMap.values());
    // Append legacy fixtures so they get settled even if running in real mode in production
    fixtures.push(...legacyFixtures);

    return fixtures;
  } catch (error) {
    console.error('Failed to fetch from API-Football, falling back to mocks:', error);
    return fetchDailyFixturesAndOdds(); // fallback
  }
}

// US2: Create Match and Round sessions for daily fixtures
export async function createDailyMatches(fixtures: WorldCupFixture[]) {
  // Get all subscribed agents
  const subscriptions = await prisma.agentGameSubscription.findMany({
    where: { gameKey: 'world_cup_prediction' },
    include: { agent: true },
  });
  const subscribedAgents = subscriptions.map((s) => s.agent);

  const createdMatches = [];

  for (const f of fixtures) {
    // Check if match already exists for this fixture ID
    const matchSeed = `worldcup-fixture-${f.fixtureId}`;
    let match = await prisma.match.findFirst({
      where: {
        gameType: 'world_cup_prediction',
        matchSeed: matchSeed,
      },
    });

    if (!match) {
      // Skip creating matches for fixtures that have already started or finished
      if (f.status === 'FT' || f.score || new Date() >= f.kickoffTime) {
        continue;
      }

      let homeOdds = f.homeOdds;
      let drawOdds = f.drawOdds;
      let awayOdds = f.awayOdds;

      // Fetch actual odds only when creating the match
      const apiKey = process.env.API_FOOTBALL_KEY;
      if (apiKey && f.fixtureId >= 1000) {
        try {
          const oddsRes = await fetch(
            `https://v3.football.api-sports.io/odds?fixture=${f.fixtureId}`,
            {
              headers: {
                'x-apisports-key': apiKey,
                'x-rapidapi-key': apiKey,
                'x-rapidapi-host': 'v3.football.api-sports.io',
              },
            }
          );
          const oddsData = await oddsRes.json();
          const bookmakers = oddsData.response?.[0]?.bookmakers || [];
          const standardBookmaker = bookmakers[0]?.bets?.[0]?.values || [];

          const homeVal = parseFloat(standardBookmaker.find((v: any) => v.value === 'Home')?.odValue || '2.0');
          const drawVal = parseFloat(standardBookmaker.find((v: any) => v.value === 'Draw')?.odValue || '3.0');
          const awayVal = parseFloat(standardBookmaker.find((v: any) => v.value === 'Away')?.odValue || '2.0');

          if (!isNaN(homeVal)) homeOdds = homeVal;
          if (!isNaN(drawVal)) drawOdds = drawVal;
          if (!isNaN(awayVal)) awayOdds = awayVal;
        } catch (e) {
          console.error(`Failed to fetch odds for fixture ${f.fixtureId}:`, e);
        }
      }

      match = await prisma.match.create({
        data: {
          gameType: 'world_cup_prediction',
          matchSeed: matchSeed,
          status: 'in_progress', // immediately in progress for predictions
          maxPlayers: 1000,
          totalRounds: 1,
          currentRound: 1,
          createdBy: 'WorldCupHouseBot',
        },
      });

      // Create Round 1
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

      // Add all subscribed agents as participants
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

  for (const f of fixtures) {
    if (f.status !== 'FT' && !f.score) continue;

    const matchSeed = `worldcup-fixture-${f.fixtureId}`;
    const match = await prisma.match.findFirst({
      where: {
        gameType: 'world_cup_prediction',
        matchSeed: matchSeed,
        status: 'in_progress',
      },
      include: {
        participants: {
          include: { agent: true },
        },
      },
    });

    if (!match) continue;

    const round = await prisma.round.findFirst({
      where: { matchId: match.id, roundNumber: 1 },
      include: { actions: true },
    });

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
          const actionPayload = JSON.parse(predictionAction.payload || '{}');
          const odds = actionPayload.odds || 2.0;
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
    } catch (err: any) {
      console.error('[WorldCup] Error in prediction loop:', err.message);
    }
  }, 20 * 60 * 1000);
}

