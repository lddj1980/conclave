export type RPSMove = 'rock' | 'paper' | 'scissors';

export interface RPSRoundResult {
  agent1Id: string;
  agent2Id: string;
  agent1Move: RPSMove;
  agent2Move: RPSMove;
  agent1Score: number;
  agent2Score: number;
}

export function calculateRPSRoundScores(
  agent1Id: string,
  agent1Move: RPSMove,
  agent2Id: string,
  agent2Move: RPSMove
): RPSRoundResult {
  let score1 = 0;
  let score2 = 0;

  if (agent1Move === agent2Move) {
    score1 = 1;
    score2 = 1;
  } else if (
    (agent1Move === 'rock' && agent2Move === 'scissors') ||
    (agent1Move === 'paper' && agent2Move === 'rock') ||
    (agent1Move === 'scissors' && agent2Move === 'paper')
  ) {
    score1 = 3;
    score2 = 0;
  } else {
    score1 = 0;
    score2 = 3;
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
