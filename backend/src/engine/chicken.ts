export type ChickenMove = 'cooperate' | 'defect';

export interface ChickenRoundResult {
  agent1Id: string;
  agent2Id: string;
  agent1Move: ChickenMove;
  agent2Move: ChickenMove;
  agent1Score: number;
  agent2Score: number;
}

export function calculateChickenRoundScores(
  agent1Id: string,
  agent1Move: ChickenMove,
  agent2Id: string,
  agent2Move: ChickenMove
): ChickenRoundResult {
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
    score1 = -10;
    score2 = -10; // Crash! Both lose heavily
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
