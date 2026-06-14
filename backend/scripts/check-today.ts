import { getWorldCupSchedule } from '../src/data/worldcup-2026-schedule.js';

const all = getWorldCupSchedule();
const agora = new Date('2026-06-14T16:22:00.000Z');
console.log('Time (UTC):', agora.toISOString());
console.log('Time (BRT): 13:22');
console.log('');

for (const f of all) {
  const k = new Date(f.kickoff);
  const hoje = k.getUTCFullYear() === 2026 && k.getUTCMonth() === 5 && k.getUTCDate() === 14;
  if (!hoje) continue;
  const futuro = k > agora;
  const brtHour = (k.getUTCHours() - 3 + 24) % 24;
  console.log(
    (futuro ? '> DISPONIVEL' : '  PASSADO'),
    f.homeTeam.padEnd(20), 'vs', f.awayTeam.padEnd(20),
    'UTC', k.toISOString().replace('T',' ').slice(0,16),
    'BRT', brtHour.toString().padStart(2,'0') + ':' + k.getUTCMinutes().toString().padStart(2,'0'),
    'grupo', f.group
  );
}
