import { ScheduledFixture, deterministicScore } from '../data/worldcup-2026-schedule.js';

interface WorldCup26Match {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: string;
  away_score: string;
  home_scorers: string;
  away_scorers: string;
  group: string;
  matchday: string;
  local_date: string;
  finished: string;
  time_elapsed: string;
  type: string;
  home_team_name_en: string;
  away_team_name_en: string;
}

export async function fetchScoresForFixtures(
  fixtures: ScheduledFixture[]
): Promise<Map<number, { home: number; away: number }>> {
  const result = new Map<number, { home: number; away: number }>();

  try {
    const res = await fetch('https://worldcup26.ir/get/games', {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: { games: WorldCup26Match[] } = await res.json();

    for (const f of fixtures) {
      const match = data.games.find(m => parseInt(m.id) === f.id);
      if (match && match.finished === 'TRUE') {
        const homeScore = parseInt(match.home_score);
        const awayScore = parseInt(match.away_score);
        if (!isNaN(homeScore) && !isNaN(awayScore)) {
          result.set(f.id, { home: homeScore, away: awayScore });
        }
      }
    }
  } catch (err) {
    console.warn('[WorldCup] worldcup26.ir API failed, using deterministic fallback:', (err as Error)?.message);
  }

  for (const f of fixtures) {
    if (!result.has(f.id)) {
      result.set(f.id, deterministicScore(f.id));
    }
  }

  return result;
}
