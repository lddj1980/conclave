export interface ScheduledFixture {
  id: number;
  homeTeam: string;
  awayTeam: string;
  kickoff: string; // ISO string
  stage: string;
  group?: string;
}

export interface GroupInfo {
  key: string;
  teams: [string, string, string, string];
}

export const WORLD_CUP_GROUPS: GroupInfo[] = [
  { key: 'A', teams: ['Mexico', 'Canada', 'New Zealand', 'Angola'] },
  { key: 'B', teams: ['USA', 'England', 'Wales', 'Iran'] },
  { key: 'C', teams: ['Argentina', 'Chile', 'Paraguay', 'Cameroon'] },
  { key: 'D', teams: ['Brazil', 'Colombia', 'Ecuador', 'Australia'] },
  { key: 'E', teams: ['Uruguay', 'Peru', 'Venezuela', 'Senegal'] },
  { key: 'F', teams: ['France', 'Netherlands', 'Poland', 'Japan'] },
  { key: 'G', teams: ['Spain', 'Germany', 'Denmark', 'Saudi Arabia'] },
  { key: 'H', teams: ['Portugal', 'Croatia', 'Serbia', 'South Korea'] },
  { key: 'I', teams: ['Italy', 'Switzerland', 'Norway', 'Morocco'] },
  { key: 'J', teams: ['Belgium', 'Austria', 'Czech Republic', 'Tunisia'] },
  { key: 'K', teams: ['Turkey', 'Ukraine', 'Egypt', 'Iceland'] },
  { key: 'L', teams: ['Sweden', 'Nigeria', 'Ivory Coast', 'Costa Rica'] },
];

function groupMatches(groups: GroupInfo[], startDate: Date, days: number): ScheduledFixture[] {
  const fixtures: ScheduledFixture[] = [];
  let id = 1;
  for (const g of groups) {
    const [t1, t2, t3, t4] = g.teams;
    const pairs: [string, string][] = [
      [t1, t2], [t3, t4],
      [t1, t3], [t2, t4],
      [t1, t4], [t2, t3],
    ];
    for (let i = 0; i < pairs.length; i++) {
      const matchDate = new Date(startDate.getTime() + (id - 1) * (24 * 60 * 60 * 1000) / pairs.length);
      fixtures.push({
        id: id++,
        homeTeam: pairs[i][0],
        awayTeam: pairs[i][1],
        kickoff: matchDate.toISOString(),
        stage: 'group',
        group: g.key,
      });
    }
  }
  return fixtures;
}

function knockoutMatches(
  label: string, matchCount: number, startDate: Date, offsetDays: number,
  homePrefix: string, awayPrefix: string
): ScheduledFixture[] {
  const fixtures: ScheduledFixture[] = [];
  let id = 1000;
  for (let i = 0; i < matchCount; i++) {
    const matchDate = new Date(startDate.getTime() + (offsetDays + i) * 24 * 60 * 60 * 1000);
    fixtures.push({
      id: id++,
      homeTeam: `${homePrefix} ${i + 1}`,
      awayTeam: `${awayPrefix} ${i + 1}`,
      kickoff: matchDate.toISOString(),
      stage: label,
    });
  }
  return fixtures;
}

// Build full tournament schedule
export function getWorldCupSchedule(): ScheduledFixture[] {
  const startDate = new Date('2026-06-11T16:00:00.000Z');
  const groups = groupMatches(WORLD_CUP_GROUPS, startDate, 16);

  const ro32 = new Date('2026-06-29T16:00:00.000Z');
  const ro16 = new Date('2026-07-04T16:00:00.000Z');
  const qf = new Date('2026-07-09T16:00:00.000Z');
  const sf = new Date('2026-07-14T16:00:00.000Z');
  const third = new Date('2026-07-18T16:00:00.000Z');
  const final = new Date('2026-07-19T18:00:00.000Z');

  return [
    ...groups,
    ...knockoutMatches('round_of_32', 16, ro32, 0, 'R32W', 'R32L'),
    ...knockoutMatches('round_of_16', 8, ro16, 0, 'R16W', 'R16L'),
    ...knockoutMatches('quarter_final', 4, qf, 0, 'QF1', 'QF2'),
    ...knockoutMatches('semi_final', 2, sf, 0, 'SF1', 'SF2'),
    { id: 1999, homeTeam: 'SF_Loser_1', awayTeam: 'SF_Loser_2', kickoff: third.toISOString(), stage: 'third_place' },
    { id: 2000, homeTeam: 'SF_Winner_1', awayTeam: 'SF_Winner_2', kickoff: final.toISOString(), stage: 'final' },
  ];
}

// Get only fixtures for today (used for match creation)
export function getTodaysFixtures(schedule: ScheduledFixture[]): ScheduledFixture[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return schedule.filter(f => {
    const k = new Date(f.kickoff);
    return k >= today && k < tomorrow;
  });
}

// Get fixtures that should be settled (kickoff already passed)
export function getPastFixtures(schedule: ScheduledFixture[]): ScheduledFixture[] {
  const now = new Date();
  return schedule.filter(f => new Date(f.kickoff) <= now);
}

// Deterministic fallback score based on fixture id
export function deterministicScore(fixtureId: number): { home: number; away: number } {
  return {
    home: (fixtureId * 7 + 3) % 5,
    away: (fixtureId * 13 + 7) % 4,
  };
}
