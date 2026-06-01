import prisma from '../db.js';
import { submitAgentAction } from '../engine/match-resolver.js';

async function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('--- Starting Conclave Regression Tests ---');
  
  // Find test agents
  const bot1 = await prisma.agent.findUnique({ where: { name: 'CooperatorBot' } });
  const bot2 = await prisma.agent.findUnique({ where: { name: 'DefectorBot' } });
  
  assert(!!bot1 && !!bot2, 'House bots must be seeded in the DB');

  // Test 1: Prisoners Dilemma Match
  console.log('Running Test 1: Prisoners Dilemma...');
  const match = await prisma.match.create({
    data: {
      createdBy: 'RegressionTest',
      totalRounds: 2,
      gameType: 'prisoners_dilemma',
      matchSeed: 'test-seed-pd',
      status: 'waiting_for_players',
    }
  });

  // Join match
  await prisma.matchParticipant.create({ data: { matchId: match.id, agentId: bot1!.id, role: 'player_1' } });
  await prisma.matchParticipant.create({ data: { matchId: match.id, agentId: bot2!.id, role: 'player_2' } });
  
  // Start match
  await prisma.match.update({
    where: { id: match.id },
    data: { status: 'in_progress', currentRound: 1, startedAt: new Date() },
  });
  await prisma.round.create({
    data: { matchId: match.id, roundNumber: 1, status: 'waiting_for_actions' },
  });

  // Submit round 1
  await submitAgentAction(match.id, bot1!.id, 'cooperate');
  await submitAgentAction(match.id, bot2!.id, 'defect');

  // Retrieve round 1 state
  const round1Resolved = await prisma.round.findUnique({
    where: { matchId_roundNumber: { matchId: match.id, roundNumber: 1 } },
  });
  assert(round1Resolved!.status === 'finished', 'Round 1 must be finished/resolved');

  // Submit round 2 (last round)
  await submitAgentAction(match.id, bot1!.id, 'cooperate');
  await submitAgentAction(match.id, bot2!.id, 'defect');

  // Retrieve finished match state
  const finishedMatch = await prisma.match.findUnique({
    where: { id: match.id },
    include: { participants: true },
  });

  assert(finishedMatch!.status === 'finished', 'Match must be finished');
  const p1 = finishedMatch!.participants.find(p => p.agentId === bot1!.id);
  const p2 = finishedMatch!.participants.find(p => p.agentId === bot2!.id);
  // cooperate vs defect pays [0, 5]. Over 2 rounds: p1 gets 0, p2 gets 10.
  assert(p1!.score === 0, `Player 1 score must be 0, got ${p1!.score}`);
  assert(p2!.score === 10, `Player 2 score must be 10, got ${p2!.score}`);

  console.log('Test 1 Passed!');

  // Test 2: Tic Tac Toe Match
  console.log('Running Test 2: Tic Tac Toe...');
  const tttMatch = await prisma.match.create({
    data: {
      createdBy: 'RegressionTest',
      totalRounds: 9,
      gameType: 'tic_tac_toe',
      matchSeed: 'test-seed-ttt',
      status: 'waiting_for_players',
    }
  });

  // Join match
  await prisma.matchParticipant.create({ data: { matchId: tttMatch.id, agentId: bot1!.id, role: 'player_1' } });
  await prisma.matchParticipant.create({ data: { matchId: tttMatch.id, agentId: bot2!.id, role: 'player_2' } });

  // Start match
  await prisma.match.update({
    where: { id: tttMatch.id },
    data: { status: 'in_progress', currentRound: 1, startedAt: new Date() },
  });
  await prisma.round.create({
    data: { matchId: tttMatch.id, roundNumber: 1, status: 'waiting_for_actions', payload: JSON.stringify(Array(9).fill('')) },
  });

  // Player 1 plays '4'
  await submitAgentAction(tttMatch.id, bot1!.id, '4');
  
  // Try to play out of turn
  try {
    await submitAgentAction(tttMatch.id, bot1!.id, '0');
    assert(false, 'Should throw error when playing out of turn');
  } catch (e: any) {
    assert(e.message.includes('not your turn'), 'Should validate sequential turns');
  }

  // Player 2 plays '0'
  await submitAgentAction(tttMatch.id, bot2!.id, '0');

  // Verify round 2 is created and active
  const tttState = await prisma.match.findUnique({ where: { id: tttMatch.id } });
  assert(tttState!.currentRound === 3, `Expected currentRound to be 3, got ${tttState!.currentRound}`);

  console.log('Test 2 Passed!');
  console.log('--- All Regression Tests Passed Successfully! ---');
}

runTests().catch(err => {
  console.error('REGRESSION TEST FAILED:', err.message);
  process.exit(1);
});
