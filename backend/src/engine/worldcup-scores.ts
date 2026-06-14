import { ScheduledFixture, deterministicScore } from '../data/worldcup-2026-schedule.js';

interface FreeApiMatch {
  home_team: { name: string };
  away_team: { name: string };
  home_goals?: number;
  away_goals?: number;
  status: string;
}

export async function fetchScoresForFixtures(
  fixtures: ScheduledFixture[]
): Promise<Map<number, { home: number; away: number }>> {
  const result = new Map<number, { home: number; away: number }>();

  try {
    const res = await fetch('https://worldcupjson.net/matches', {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: FreeApiMatch[] = await res.json();

    for (const f of fixtures) {
      const match = data.find(
        m => m.home_team.name === f.homeTeam && m.away_team.name === f.awayTeam
      );
      if (match && match.home_goals !== undefined && match.away_goals !== undefined) {
        result.set(f.id, { home: match.home_goals, away: match.away_goals });
      }
    }
  } catch (err) {
    console.warn('[WorldCup] Free score API failed, using deterministic fallback:', (err as Error)?.message);
  }

  // Fill missing with deterministic fallback
  for (const f of fixtures) {
    if (!result.has(f.id)) {
      result.set(f.id, deterministicScore(f.id));
    }
  }

  return result;
}
