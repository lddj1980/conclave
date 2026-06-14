export interface ScheduledFixture {
  id: number;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  stage: string;
  group?: string;
}

export interface GroupInfo {
  key: string;
  teams: [string, string, string, string];
}

export const WORLD_CUP_GROUPS: GroupInfo[] = [
  { key: 'A', teams: ['Mexico', 'South Africa', 'Korea Republic', 'Czechia'] },
  { key: 'B', teams: ['Canada', 'Bosnia and Herzegovina', 'Qatar', 'Switzerland'] },
  { key: 'C', teams: ['Brazil', 'Morocco', 'Haiti', 'Scotland'] },
  { key: 'D', teams: ['USA', 'Paraguay', 'Australia', 'Turkiye'] },
  { key: 'E', teams: ['Germany', 'Curacao', 'Ivory Coast', 'Ecuador'] },
  { key: 'F', teams: ['Netherlands', 'Japan', 'Sweden', 'Tunisia'] },
  { key: 'G', teams: ['Belgium', 'Egypt', 'Iran', 'New Zealand'] },
  { key: 'H', teams: ['Spain', 'Cape Verde', 'Saudi Arabia', 'Uruguay'] },
  { key: 'I', teams: ['France', 'Senegal', 'Iraq', 'Norway'] },
  { key: 'J', teams: ['Argentina', 'Algeria', 'Austria', 'Jordan'] },
  { key: 'K', teams: ['Portugal', 'DR Congo', 'Uzbekistan', 'Colombia'] },
  { key: 'L', teams: ['England', 'Croatia', 'Ghana', 'Panama'] },
];

export function getWorldCupSchedule(): ScheduledFixture[] {
  return [
    // ===== GROUP STAGE =====
    // --- June 11 ---
    { id: 1, homeTeam: 'Mexico', awayTeam: 'South Africa', kickoff: '2026-06-11T19:00:00.000Z', stage: 'group', group: 'A' },
    // June 12 02:00 GMT
    { id: 2, homeTeam: 'Korea Republic', awayTeam: 'Czechia', kickoff: '2026-06-12T02:00:00.000Z', stage: 'group', group: 'A' },

    // --- June 12 ---
    { id: 3, homeTeam: 'Canada', awayTeam: 'Bosnia and Herzegovina', kickoff: '2026-06-12T19:00:00.000Z', stage: 'group', group: 'B' },
    // June 13 01:00 GMT
    { id: 4, homeTeam: 'USA', awayTeam: 'Paraguay', kickoff: '2026-06-13T01:00:00.000Z', stage: 'group', group: 'D' },

    // --- June 13 ---
    { id: 5, homeTeam: 'Qatar', awayTeam: 'Switzerland', kickoff: '2026-06-13T19:00:00.000Z', stage: 'group', group: 'B' },
    { id: 6, homeTeam: 'Brazil', awayTeam: 'Morocco', kickoff: '2026-06-13T22:00:00.000Z', stage: 'group', group: 'C' },
    // June 14 01:00 GMT
    { id: 7, homeTeam: 'Haiti', awayTeam: 'Scotland', kickoff: '2026-06-14T01:00:00.000Z', stage: 'group', group: 'C' },
    // June 14 04:00 GMT
    { id: 8, homeTeam: 'Australia', awayTeam: 'Turkiye', kickoff: '2026-06-14T04:00:00.000Z', stage: 'group', group: 'D' },

    // --- June 14 ---
    { id: 9,  homeTeam: 'Germany', awayTeam: 'Curacao', kickoff: '2026-06-14T17:00:00.000Z', stage: 'group', group: 'E' },
    { id: 10, homeTeam: 'Netherlands', awayTeam: 'Japan', kickoff: '2026-06-14T20:00:00.000Z', stage: 'group', group: 'F' },
    { id: 11, homeTeam: 'Ivory Coast', awayTeam: 'Ecuador', kickoff: '2026-06-14T23:00:00.000Z', stage: 'group', group: 'E' },
    // June 15 02:00 GMT
    { id: 12, homeTeam: 'Sweden', awayTeam: 'Tunisia', kickoff: '2026-06-15T02:00:00.000Z', stage: 'group', group: 'F' },

    // --- June 15 ---
    { id: 13, homeTeam: 'Spain', awayTeam: 'Cape Verde', kickoff: '2026-06-15T16:00:00.000Z', stage: 'group', group: 'H' },
    { id: 14, homeTeam: 'Belgium', awayTeam: 'Egypt', kickoff: '2026-06-15T19:00:00.000Z', stage: 'group', group: 'G' },
    { id: 15, homeTeam: 'Saudi Arabia', awayTeam: 'Uruguay', kickoff: '2026-06-15T22:00:00.000Z', stage: 'group', group: 'H' },
    // June 16 01:00 GMT
    { id: 16, homeTeam: 'Iran', awayTeam: 'New Zealand', kickoff: '2026-06-16T01:00:00.000Z', stage: 'group', group: 'G' },

    // --- June 16 ---
    { id: 17, homeTeam: 'France', awayTeam: 'Senegal', kickoff: '2026-06-16T19:00:00.000Z', stage: 'group', group: 'I' },
    { id: 18, homeTeam: 'Iraq', awayTeam: 'Norway', kickoff: '2026-06-16T22:00:00.000Z', stage: 'group', group: 'I' },
    // June 17 01:00 GMT
    { id: 19, homeTeam: 'Argentina', awayTeam: 'Algeria', kickoff: '2026-06-17T01:00:00.000Z', stage: 'group', group: 'J' },
    // June 17 04:00 GMT
    { id: 20, homeTeam: 'Austria', awayTeam: 'Jordan', kickoff: '2026-06-17T04:00:00.000Z', stage: 'group', group: 'J' },

    // --- June 17 ---
    { id: 21, homeTeam: 'Portugal', awayTeam: 'DR Congo', kickoff: '2026-06-17T17:00:00.000Z', stage: 'group', group: 'K' },
    { id: 22, homeTeam: 'England', awayTeam: 'Croatia', kickoff: '2026-06-17T20:00:00.000Z', stage: 'group', group: 'L' },
    { id: 23, homeTeam: 'Ghana', awayTeam: 'Panama', kickoff: '2026-06-17T23:00:00.000Z', stage: 'group', group: 'L' },
    // June 18 02:00 GMT
    { id: 24, homeTeam: 'Uzbekistan', awayTeam: 'Colombia', kickoff: '2026-06-18T02:00:00.000Z', stage: 'group', group: 'K' },

    // --- June 18 ---
    { id: 25, homeTeam: 'Czechia', awayTeam: 'South Africa', kickoff: '2026-06-18T16:00:00.000Z', stage: 'group', group: 'A' },
    { id: 26, homeTeam: 'Switzerland', awayTeam: 'Bosnia and Herzegovina', kickoff: '2026-06-18T19:00:00.000Z', stage: 'group', group: 'B' },
    { id: 27, homeTeam: 'Canada', awayTeam: 'Qatar', kickoff: '2026-06-18T22:00:00.000Z', stage: 'group', group: 'B' },
    // June 19 01:00 GMT
    { id: 28, homeTeam: 'Mexico', awayTeam: 'Korea Republic', kickoff: '2026-06-19T01:00:00.000Z', stage: 'group', group: 'A' },

    // --- June 19 ---
    { id: 29, homeTeam: 'USA', awayTeam: 'Australia', kickoff: '2026-06-19T19:00:00.000Z', stage: 'group', group: 'D' },
    { id: 30, homeTeam: 'Scotland', awayTeam: 'Morocco', kickoff: '2026-06-19T22:00:00.000Z', stage: 'group', group: 'C' },
    // June 20 00:30 GMT
    { id: 31, homeTeam: 'Brazil', awayTeam: 'Haiti', kickoff: '2026-06-20T00:30:00.000Z', stage: 'group', group: 'C' },
    // June 20 03:00 GMT
    { id: 32, homeTeam: 'Turkiye', awayTeam: 'Paraguay', kickoff: '2026-06-20T03:00:00.000Z', stage: 'group', group: 'D' },

    // --- June 20 ---
    { id: 33, homeTeam: 'Netherlands', awayTeam: 'Sweden', kickoff: '2026-06-20T17:00:00.000Z', stage: 'group', group: 'F' },
    { id: 34, homeTeam: 'Germany', awayTeam: 'Ivory Coast', kickoff: '2026-06-20T20:00:00.000Z', stage: 'group', group: 'E' },
    // June 21 03:00 GMT
    { id: 35, homeTeam: 'Ecuador', awayTeam: 'Curacao', kickoff: '2026-06-21T03:00:00.000Z', stage: 'group', group: 'E' },
    // June 21 04:00 GMT
    { id: 36, homeTeam: 'Tunisia', awayTeam: 'Japan', kickoff: '2026-06-21T04:00:00.000Z', stage: 'group', group: 'F' },

    // --- June 21 ---
    { id: 37, homeTeam: 'Spain', awayTeam: 'Saudi Arabia', kickoff: '2026-06-21T16:00:00.000Z', stage: 'group', group: 'H' },
    { id: 38, homeTeam: 'Belgium', awayTeam: 'Iran', kickoff: '2026-06-21T19:00:00.000Z', stage: 'group', group: 'G' },
    { id: 39, homeTeam: 'Uruguay', awayTeam: 'Cape Verde', kickoff: '2026-06-21T22:00:00.000Z', stage: 'group', group: 'H' },
    // June 22 01:00 GMT
    { id: 40, homeTeam: 'New Zealand', awayTeam: 'Egypt', kickoff: '2026-06-22T01:00:00.000Z', stage: 'group', group: 'G' },

    // --- June 22 ---
    { id: 41, homeTeam: 'Argentina', awayTeam: 'Austria', kickoff: '2026-06-22T17:00:00.000Z', stage: 'group', group: 'J' },
    { id: 42, homeTeam: 'France', awayTeam: 'Iraq', kickoff: '2026-06-22T21:00:00.000Z', stage: 'group', group: 'I' },
    // June 23 00:00 GMT
    { id: 43, homeTeam: 'Norway', awayTeam: 'Senegal', kickoff: '2026-06-23T00:00:00.000Z', stage: 'group', group: 'I' },
    // June 23 03:00 GMT
    { id: 44, homeTeam: 'Jordan', awayTeam: 'Algeria', kickoff: '2026-06-23T03:00:00.000Z', stage: 'group', group: 'J' },

    // --- June 23 ---
    { id: 45, homeTeam: 'Portugal', awayTeam: 'Uzbekistan', kickoff: '2026-06-23T17:00:00.000Z', stage: 'group', group: 'K' },
    { id: 46, homeTeam: 'England', awayTeam: 'Ghana', kickoff: '2026-06-23T20:00:00.000Z', stage: 'group', group: 'L' },
    { id: 47, homeTeam: 'Panama', awayTeam: 'Croatia', kickoff: '2026-06-23T23:00:00.000Z', stage: 'group', group: 'L' },
    // June 24 02:00 GMT
    { id: 48, homeTeam: 'Colombia', awayTeam: 'DR Congo', kickoff: '2026-06-24T02:00:00.000Z', stage: 'group', group: 'K' },

    // --- June 24 ---
    { id: 49, homeTeam: 'Switzerland', awayTeam: 'Canada', kickoff: '2026-06-24T19:00:00.000Z', stage: 'group', group: 'B' },
    { id: 50, homeTeam: 'Bosnia and Herzegovina', awayTeam: 'Qatar', kickoff: '2026-06-24T19:00:00.000Z', stage: 'group', group: 'B' },
    { id: 51, homeTeam: 'Scotland', awayTeam: 'Brazil', kickoff: '2026-06-24T22:00:00.000Z', stage: 'group', group: 'C' },
    { id: 52, homeTeam: 'Morocco', awayTeam: 'Haiti', kickoff: '2026-06-24T22:00:00.000Z', stage: 'group', group: 'C' },
    // June 25 01:00 GMT
    { id: 53, homeTeam: 'Czechia', awayTeam: 'Mexico', kickoff: '2026-06-25T01:00:00.000Z', stage: 'group', group: 'A' },
    { id: 54, homeTeam: 'South Africa', awayTeam: 'Korea Republic', kickoff: '2026-06-25T01:00:00.000Z', stage: 'group', group: 'A' },

    // --- June 25 ---
    { id: 55, homeTeam: 'Ecuador', awayTeam: 'Germany', kickoff: '2026-06-25T20:00:00.000Z', stage: 'group', group: 'E' },
    { id: 56, homeTeam: 'Curacao', awayTeam: 'Ivory Coast', kickoff: '2026-06-25T20:00:00.000Z', stage: 'group', group: 'E' },
    { id: 57, homeTeam: 'Japan', awayTeam: 'Sweden', kickoff: '2026-06-25T23:00:00.000Z', stage: 'group', group: 'F' },
    { id: 58, homeTeam: 'Tunisia', awayTeam: 'Netherlands', kickoff: '2026-06-25T23:00:00.000Z', stage: 'group', group: 'F' },
    // June 26 02:00 GMT
    { id: 59, homeTeam: 'Turkiye', awayTeam: 'USA', kickoff: '2026-06-26T02:00:00.000Z', stage: 'group', group: 'D' },
    { id: 60, homeTeam: 'Paraguay', awayTeam: 'Australia', kickoff: '2026-06-26T02:00:00.000Z', stage: 'group', group: 'D' },

    // --- June 26 ---
    { id: 61, homeTeam: 'Norway', awayTeam: 'France', kickoff: '2026-06-26T19:00:00.000Z', stage: 'group', group: 'I' },
    { id: 62, homeTeam: 'Senegal', awayTeam: 'Iraq', kickoff: '2026-06-26T19:00:00.000Z', stage: 'group', group: 'I' },
    // June 27 00:00 GMT
    { id: 63, homeTeam: 'Cape Verde', awayTeam: 'Saudi Arabia', kickoff: '2026-06-27T00:00:00.000Z', stage: 'group', group: 'H' },
    { id: 64, homeTeam: 'Uruguay', awayTeam: 'Spain', kickoff: '2026-06-27T00:00:00.000Z', stage: 'group', group: 'H' },
    // June 27 03:00 GMT
    { id: 65, homeTeam: 'Egypt', awayTeam: 'Iran', kickoff: '2026-06-27T03:00:00.000Z', stage: 'group', group: 'G' },
    { id: 66, homeTeam: 'New Zealand', awayTeam: 'Belgium', kickoff: '2026-06-27T03:00:00.000Z', stage: 'group', group: 'G' },

    // --- June 27 ---
    { id: 67, homeTeam: 'Panama', awayTeam: 'England', kickoff: '2026-06-27T21:00:00.000Z', stage: 'group', group: 'L' },
    { id: 68, homeTeam: 'Croatia', awayTeam: 'Ghana', kickoff: '2026-06-27T21:00:00.000Z', stage: 'group', group: 'L' },
    { id: 69, homeTeam: 'Colombia', awayTeam: 'Portugal', kickoff: '2026-06-27T23:30:00.000Z', stage: 'group', group: 'K' },
    { id: 70, homeTeam: 'DR Congo', awayTeam: 'Uzbekistan', kickoff: '2026-06-27T23:30:00.000Z', stage: 'group', group: 'K' },
    // June 28 02:00 GMT
    { id: 71, homeTeam: 'Algeria', awayTeam: 'Austria', kickoff: '2026-06-28T02:00:00.000Z', stage: 'group', group: 'J' },
    { id: 72, homeTeam: 'Jordan', awayTeam: 'Argentina', kickoff: '2026-06-28T02:00:00.000Z', stage: 'group', group: 'J' },

    // ===== KNOCKOUT STAGE =====
    // Round of 32: June 28 - July 3
    { id: 73,  homeTeam: 'R32W-1', awayTeam: 'R32L-1', kickoff: '2026-06-28T19:00:00.000Z', stage: 'round_of_32' },
    { id: 74,  homeTeam: 'R32W-2', awayTeam: 'R32L-2', kickoff: '2026-06-29T19:00:00.000Z', stage: 'round_of_32' },
    { id: 75,  homeTeam: 'R32W-3', awayTeam: 'R32L-3', kickoff: '2026-06-29T20:30:00.000Z', stage: 'round_of_32' },
    { id: 76,  homeTeam: 'R32W-4', awayTeam: 'R32L-4', kickoff: '2026-06-30T01:00:00.000Z', stage: 'round_of_32' },
    { id: 77,  homeTeam: 'R32W-5', awayTeam: 'R32L-5', kickoff: '2026-06-30T17:00:00.000Z', stage: 'round_of_32' },
    { id: 78,  homeTeam: 'R32W-6', awayTeam: 'R32L-6', kickoff: '2026-06-30T21:00:00.000Z', stage: 'round_of_32' },
    { id: 79,  homeTeam: 'R32W-7', awayTeam: 'R32L-7', kickoff: '2026-07-01T01:00:00.000Z', stage: 'round_of_32' },
    { id: 80,  homeTeam: 'R32W-8', awayTeam: 'R32L-8', kickoff: '2026-07-01T16:00:00.000Z', stage: 'round_of_32' },
    { id: 81,  homeTeam: 'R32W-9', awayTeam: 'R32L-9', kickoff: '2026-07-01T20:00:00.000Z', stage: 'round_of_32' },
    { id: 82,  homeTeam: 'R32W-10', awayTeam: 'R32L-10', kickoff: '2026-07-01T20:00:00.000Z', stage: 'round_of_32' },
    { id: 83,  homeTeam: 'R32W-11', awayTeam: 'R32L-11', kickoff: '2026-07-02T19:00:00.000Z', stage: 'round_of_32' },
    { id: 84,  homeTeam: 'R32W-12', awayTeam: 'R32L-12', kickoff: '2026-07-02T23:00:00.000Z', stage: 'round_of_32' },
    { id: 85,  homeTeam: 'R32W-13', awayTeam: 'R32L-13', kickoff: '2026-07-03T03:00:00.000Z', stage: 'round_of_32' },
    { id: 86,  homeTeam: 'R32W-14', awayTeam: 'R32L-14', kickoff: '2026-07-03T18:00:00.000Z', stage: 'round_of_32' },
    { id: 87,  homeTeam: 'R32W-15', awayTeam: 'R32L-15', kickoff: '2026-07-03T22:00:00.000Z', stage: 'round_of_32' },
    { id: 88,  homeTeam: 'R32W-16', awayTeam: 'R32L-16', kickoff: '2026-07-04T01:30:00.000Z', stage: 'round_of_32' },

    // Round of 16: July 4 - 7
    { id: 89, homeTeam: 'R16W-1', awayTeam: 'R16L-1', kickoff: '2026-07-04T17:00:00.000Z', stage: 'round_of_16' },
    { id: 90, homeTeam: 'R16W-2', awayTeam: 'R16L-2', kickoff: '2026-07-04T21:00:00.000Z', stage: 'round_of_16' },
    { id: 91, homeTeam: 'R16W-3', awayTeam: 'R16L-3', kickoff: '2026-07-05T20:00:00.000Z', stage: 'round_of_16' },
    { id: 92, homeTeam: 'R16W-4', awayTeam: 'R16L-4', kickoff: '2026-07-06T00:00:00.000Z', stage: 'round_of_16' },
    { id: 93, homeTeam: 'R16W-5', awayTeam: 'R16L-5', kickoff: '2026-07-06T19:00:00.000Z', stage: 'round_of_16' },
    { id: 94, homeTeam: 'R16W-6', awayTeam: 'R16L-6', kickoff: '2026-07-07T00:00:00.000Z', stage: 'round_of_16' },
    { id: 95, homeTeam: 'R16W-7', awayTeam: 'R16L-7', kickoff: '2026-07-07T16:00:00.000Z', stage: 'round_of_16' },
    { id: 96, homeTeam: 'R16W-8', awayTeam: 'R16L-8', kickoff: '2026-07-07T20:00:00.000Z', stage: 'round_of_16' },

    // Quarter-finals: July 9 - 11
    { id: 97, homeTeam: 'QF-W1', awayTeam: 'QF-L1', kickoff: '2026-07-09T20:00:00.000Z', stage: 'quarter_final' },
    { id: 98, homeTeam: 'QF-W2', awayTeam: 'QF-L2', kickoff: '2026-07-10T19:00:00.000Z', stage: 'quarter_final' },
    { id: 99, homeTeam: 'QF-W3', awayTeam: 'QF-L3', kickoff: '2026-07-11T20:00:00.000Z', stage: 'quarter_final' },
    { id: 100, homeTeam: 'QF-W4', awayTeam: 'QF-L4', kickoff: '2026-07-12T01:00:00.000Z', stage: 'quarter_final' },

    // Semi-finals: July 14 - 15
    { id: 101, homeTeam: 'SF-W1', awayTeam: 'SF-L1', kickoff: '2026-07-14T19:00:00.000Z', stage: 'semi_final' },
    { id: 102, homeTeam: 'SF-W2', awayTeam: 'SF-L2', kickoff: '2026-07-15T19:00:00.000Z', stage: 'semi_final' },

    // Bronze medal: July 18
    { id: 103, homeTeam: '3P-W1', awayTeam: '3P-L1', kickoff: '2026-07-18T21:00:00.000Z', stage: 'third_place' },

    // Final: July 19
    { id: 104, homeTeam: 'F-W1', awayTeam: 'F-L1', kickoff: '2026-07-19T19:00:00.000Z', stage: 'final' },
  ];
}

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

export function getPastFixtures(schedule: ScheduledFixture[]): ScheduledFixture[] {
  const now = new Date();
  return schedule.filter(f => new Date(f.kickoff) <= now);
}

export function deterministicScore(fixtureId: number): { home: number; away: number } {
  return {
    home: (fixtureId * 7 + 3) % 5,
    away: (fixtureId * 13 + 7) % 4,
  };
}
