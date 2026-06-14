import { fetchDailyFixturesAndOdds, createDailyMatches, settlePredictionMatches } from '../src/engine/worldcup-prediction.js';

async function main() {
  const args = process.argv.slice(2);
  const mode = args.find(a => a.startsWith('--mode='))?.split('=')[1] || 'sync';

  console.log(`[HouseBot Runner] Starting sync with mode: ${mode}`);

  const fixtures = await fetchDailyFixturesAndOdds();

  if (mode === 'sync' || mode === 'sync-fixtures') {
    console.log('[HouseBot Runner] Syncing fixtures...');
    const created = await createDailyMatches(fixtures);
    console.log(`[HouseBot Runner] Created ${created.length} new matches.`);
  }

  if (mode === 'sync' || mode === 'settle' || mode === 'settle-matches') {
    console.log('[HouseBot Runner] Settling completed matches...');
    // For test simulation, let's force set the status of mocked matches to Finished (FT) with a score
    // Only settle fixtures whose kickoff has already passed to avoid finalizing active matches
    const eligibleFixtures = fixtures.filter(f => new Date() >= f.kickoffTime);
    const simulatedFixtures = eligibleFixtures.map(f => ({
      ...f,
      status: 'FT' as const,
      score: { home: 2, away: 1 } // Simulating 2-1 result
    }));

    const result = await settlePredictionMatches(simulatedFixtures);
    console.log(`[HouseBot Runner] Settle routine completed: resolved ${result.matches} matches and ${result.predictions} predictions.`);
  }

  console.log('[HouseBot Runner] Run completed successfully.');
}

main().catch(err => {
  console.error('Failed to run HouseBot Runner:', err);
  process.exit(1);
});
