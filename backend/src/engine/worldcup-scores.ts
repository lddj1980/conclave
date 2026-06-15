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

const TEAM_ALIASES: Record<string, string[]> = {
  'Korea Republic': ['South Korea', 'Korea Republic', 'Korea'],
  'South Korea': ['South Korea', 'Korea Republic', 'Korea'],
  Czechia: ['Czechia', 'Czech Republic'],
  'Czech Republic': ['Czechia', 'Czech Republic'],
  Turkiye: ['Turkiye', 'Turkey'],
  Turkey: ['Turkiye', 'Turkey'],
  'DR Congo': ['DR Congo', 'Democratic Republic of the Congo'],
  'Democratic Republic of the Congo': ['DR Congo', 'Democratic Republic of the Congo'],
};

function normalizeTeam(name: string | null | undefined): string {
  if (!name) return '';
  return String(name)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function teamNamesMatch(a: string, b: string): boolean {
  if (normalizeTeam(a) === normalizeTeam(b)) return true;
  const aliasesA = TEAM_ALIASES[a] ?? [a];
  const aliasesB = TEAM_ALIASES[b] ?? [b];
  return aliasesA.some(na => aliasesB.some(nb => normalizeTeam(na) === normalizeTeam(nb)));
}

function teamMatch(apiName: string, localName: string): boolean {
  return teamNamesMatch(String(apiName ?? ''), localName);
}

interface ScoreEntry { home: number; away: number }

let scoresCache: Map<number, ScoreEntry> | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;

async function fetchScoresFromWorldCupIR(
  fixtures: ScheduledFixture[]
): Promise<Map<number, ScoreEntry> | null> {
  try {
    const res = await fetch('https://worldcup26.ir/get/games', {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: { games: WorldCup26Match[] } = await res.json();

    const apiByTeams = new Map<string, ScoreEntry>();
    for (const m of data.games) {
      if (m.finished !== 'TRUE') continue;
      const home = parseInt(m.home_score);
      const away = parseInt(m.away_score);
      if (isNaN(home) || isNaN(away)) continue;
      apiByTeams.set(
        `${normalizeTeam(m.home_team_name_en)}|${normalizeTeam(m.away_team_name_en)}`,
        { home, away }
      );
    }

    const result = new Map<number, ScoreEntry>();
    for (const f of fixtures) {
      const key = `${normalizeTeam(f.homeTeam)}|${normalizeTeam(f.awayTeam)}`;
      const entry = apiByTeams.get(key);
      if (entry) result.set(f.id, entry);
    }
    return result;
  } catch {
    return null;
  }
}

async function fetchScoresFromESPN(
  fixtures: ScheduledFixture[]
): Promise<Map<number, ScoreEntry> | null> {
  try {
    const dates = new Set<string>();
    for (const f of fixtures) {
      const d = new Date(f.kickoff);
      dates.add(
        `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
      );
    }

    const result = new Map<number, ScoreEntry>();

    for (const dateStr of dates) {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) continue;
      const data = await res.json();

      for (const event of data.events || []) {
        const comp = event.competitions?.[0];
        if (!comp) continue;
        if (comp.status?.type?.completed !== true) continue;

        const homeTeam = comp.competitors?.find((c: any) => c.homeAway === 'home');
        const awayTeam = comp.competitors?.find((c: any) => c.homeAway === 'away');
        if (!homeTeam || !awayTeam) continue;

        const homeName = homeTeam.team?.displayName || homeTeam.team?.name;
        const awayName = awayTeam.team?.displayName || awayTeam.team?.name;
        if (!homeName || !awayName) continue;

        const homeScore = parseInt(homeTeam.score);
        const awayScore = parseInt(awayTeam.score);
        if (isNaN(homeScore) || isNaN(awayScore)) continue;

        for (const f of fixtures) {
          if (result.has(f.id)) continue;
          if (teamNamesMatch(homeName, f.homeTeam) && teamNamesMatch(awayName, f.awayTeam)) {
            result.set(f.id, { home: homeScore, away: awayScore });
          }
        }
      }
    }

    return result.size > 0 ? result : null;
  } catch {
    return null;
  }
}

export async function fetchScoresForFixtures(
  fixtures: ScheduledFixture[]
): Promise<Map<number, { home: number; away: number }>> {
  let apiResult = await fetchScoresFromWorldCupIR(fixtures);

  if (!apiResult) {
    console.warn('[WorldCup] worldcup26.ir failed, retrying in 3s...');
    await new Promise(r => setTimeout(r, 3000));
    apiResult = await fetchScoresFromWorldCupIR(fixtures);
  }

  if (!apiResult) {
    console.warn('[WorldCup] worldcup26.ir unavailable, trying ESPN API...');
    apiResult = await fetchScoresFromESPN(fixtures);
  }

  if (apiResult) {
    scoresCache = apiResult;
    lastCacheTime = Date.now();
  } else if (scoresCache && Date.now() - lastCacheTime < CACHE_TTL) {
    console.warn('[WorldCup] Both APIs failed. Using cached scores.');
    apiResult = scoresCache;
  } else {
    console.warn('[WorldCup] All score sources failed. No matches will be settled with real scores.');
  }

  const result = new Map(apiResult ?? []);

  // Only use deterministic fallback for fixtures NOT covered by any source
  for (const f of fixtures) {
    if (!result.has(f.id)) {
      result.set(f.id, deterministicScore(f.id));
    }
  }

  return result;
}
