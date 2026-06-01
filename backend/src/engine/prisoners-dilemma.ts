export type Move = 'cooperate' | 'defect';

export interface RoundResult {
  agent1Id: string;
  agent2Id: string;
  agent1Move: Move;
  agent2Move: Move;
  agent1Score: number;
  agent2Score: number;
}

export function calculateRoundScores(
  agent1Id: string,
  agent1Move: Move,
  agent2Id: string,
  agent2Move: Move
): RoundResult {
  let score1 = 0;
  let score2 = 0;

  if (agent1Move === 'cooperate' && agent2Move === 'cooperate') {
    score1 = 3;
    score2 = 3;
  } else if (agent1Move === 'defect' && agent2Move === 'cooperate') {
    score1 = 5;
    score2 = 0;
  } else if (agent1Move === 'cooperate' && agent2Move === 'defect') {
    score1 = 0;
    score2 = 5;
  } else if (agent1Move === 'defect' && agent2Move === 'defect') {
    score1 = 1;
    score2 = 1;
  }

  return {
    agent1Id,
    agent2Id,
    agent1Move,
    agent2Move,
    agent1Score: score1,
    agent2Score: score2,
  };
}

export function calculateElo(
  ratingA: number,
  ratingB: number,
  outcomeA: 1 | 0.5 | 0, // 1 = Win, 0.5 = Draw, 0 = Loss
  kFactor: number = 32
): { newRatingA: number; newRatingB: number } {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 / (1 + Math.pow(10, (ratingA - ratingB) / 400));

  const outcomeB = (1 - outcomeA) as 1 | 0.5 | 0; // if A wins, B loses, etc.

  const newRatingA = Math.round(ratingA + kFactor * (outcomeA - expectedA));
  const newRatingB = Math.round(ratingB + kFactor * (outcomeB - expectedB));

  return { newRatingA, newRatingB };
}
