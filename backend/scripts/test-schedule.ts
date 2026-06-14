import { getWorldCupSchedule, getTodaysFixtures } from '../src/data/worldcup-2026-schedule.js';

const all = getWorldCupSchedule();
console.log('Total:', all.length);

const today = getTodaysFixtures(all);
console.log('Today matches:', today.length);
for (const f of today) {
  console.log('  ', f.homeTeam, 'vs', f.awayTeam, '-', f.kickoff, '- group', f.group);
}

const byDay = new Map<string, number>();
for (const f of all.filter(f => f.stage === 'group')) {
  const d = f.kickoff.split('T')[0];
  byDay.set(d, (byDay.get(d) || 0) + 1);
}
console.log('\nGroup matches per day:');
for (const [d, c] of [...byDay].sort()) {
  console.log('  ', d, ':', c);
}
