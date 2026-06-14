import { getWorldCupSchedule, getTodaysFixtures } from '../src/data/worldcup-2026-schedule.js';

const all = getWorldCupSchedule();
console.log('Total fixtures:', all.length);
console.log('');

const agora = new Date('2026-06-14T16:22:00.000Z');
console.log('Checking time: 2026-06-14T16:22:00 UTC (13:22 BRT)');
console.log('');

for (const f of all) {
  const k = new Date(f.kickoff);
  const isToday = k.getUTCFullYear() === 2026 && k.getUTCMonth() === 5 && k.getUTCDate() === 14;
  if (!isToday) continue;
  const futuro = k > agora;
  const brtHour = (k.getUTCHours() - 3 + 24) % 24;
  console.log(
    (futuro ? '> DISPONIVEL' : '  PASSADO'),
    f.homeTeam.padEnd(22), 'vs', f.awayTeam.padEnd(22),
    'UTC', k.toISOString().replace('T',' ').slice(0,16),
    'BRT', brtHour.toString().padStart(2,'0') + ':' + k.getUTCMinutes().toString().padStart(2,'0'),
    'grupo', f.group
  );
}
console.log('');

// Verify group C
console.log('Group C matches:');
for (const f of all.filter(f => f.group === 'C')) {
  const k = new Date(f.kickoff);
  console.log(' ', f.homeTeam.padEnd(22), 'vs', f.awayTeam.padEnd(22), '-', k.toISOString().replace('T',' ').slice(0,16), 'UTC');
}

// Verify Brazil's matches
console.log('\nBrazil matches:');
for (const f of all.filter(f => f.homeTeam === 'Brazil' || f.awayTeam === 'Brazil')) {
  const k = new Date(f.kickoff);
  console.log(' ', f.homeTeam.padEnd(22), 'vs', f.awayTeam.padEnd(22), '-', k.toISOString().replace('T',' ').slice(0,16), 'UTC', '-', f.stage);
}
