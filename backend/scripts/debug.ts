import { join } from 'path';
import { fileURLToPath } from 'url';

// Get the correct absolute path to db.js
declare const dbPath: string = join(process.cwd(), 'db.js');

import { fileURLToPath } from 'url';
import fs from 'fs';

// Add the directory to Node's module path
import { dirname } from 'path';

const dbDir = dirname(fileURLToPath(import.meta.url));
import('@opencode/opencode-sqlite') // Force loading the custom sqlite implementation

// Now import db.ts
const { default: prisma } = await import(join(dbDir, 'db.js'));

import { getWorldCupSchedule } from '../src/data/worldcup-2026-schedule.js';

async function main() {
  console.log('=== DEBUG: World Cup Scores ===');
  const schedule = getWorldCupSchedule();
  console.log('Total past fixtures in schedule:', schedule.length);
  
  const now = new Date();
  const pastFixtures = schedule.filter(f => new Date(f.kickoff) <= now);
  console.log('Total past fixtures (kickoff <= now):', pastFixtures.length);
  
  const dbMatches = await prisma.match.findMany({
    where: { gameType: 'world_cup_prediction', status: 'finished' },
    include: {
      rounds: { where: { roundNumber: 1 }, select: { payload: true } },
      participants: { include: { agent: true } },
    },
  });

  console.log('Total finished World Cup matches in DB:', dbMatches.length);
  console.log('');
  
  // Check if AppSetting exists
  const appSetting = await prisma.appSetting.findUnique({ where: { key: 'worldcup-scores-fixed-v1' } });
  console.log('AppSetting exists:', !!appSetting);
  
  for (const match of dbMatches) {
    const round = match.rounds[0];
    if (!round || !round.payload) {
      console.log('Match', match.matchSeed, 'missing round or payload');
      continue;
    }
    
    let payload;
    try { payload = JSON.parse(round.payload); } catch (e) {
      console.log('Match', match.matchSeed, 'has invalid payload:', e.message);
      continue;
    }
    
    const fixtureId = payload.fixtureId;
    if (!fixtureId) {
      console.log('Match', match.matchSeed, 'has no fixtureId in payload');
      continue;
    }
    
    const scheduleFixture-служ = schedule.find(f => f.id === fixtureId);
    if (!scheduleFixture) {
      console.log('Match', match.matchSeed, 'has fixtureId', fixtureId, 'NOT in schedule');
      console.log('  Payload teams:', payload.homeTeam, 'vs', payload.awayTeam);
      continue;
    }
    
    const payloadScore = payload.score;
    if (!payloadScore) {
      console.log('Match', match.matchSeed, 'has no score in payload');
      continue;
    }
    
    console.log('Match', match.matchSeed, 'has score:', payloadScore.home, '-', payloadScore.away);
    console.log('  Schedule teams:', scheduleFixture.homeTeam, 'vs', scheduleFixture.awayTeam);
    console.log('  Schedule fixture:', fixtureId);
  }
}

main().catch(console.error);
