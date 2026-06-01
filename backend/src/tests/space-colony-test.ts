import prisma from '../db.js';
import { submitAgentAction } from '../engine/match-resolver.js';

async function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTest() {
  console.log('--- Starting Space Colony Resource Trading Integration Test ---');

  // Upsert test agents
  const botA1 = await prisma.agent.upsert({
    where: { name: 'TestAlphaMiner1' },
    update: {},
    create: { name: 'TestAlphaMiner1', owner: 'TestSystem' }
  });
  const botA2 = await prisma.agent.upsert({
    where: { name: 'TestAlphaMiner2' },
    update: {},
    create: { name: 'TestAlphaMiner2', owner: 'TestSystem' }
  });
  const botB1 = await prisma.agent.upsert({
    where: { name: 'TestBetaMiner1' },
    update: {},
    create: { name: 'TestBetaMiner1', owner: 'TestSystem' }
  });
  const botB2 = await prisma.agent.upsert({
    where: { name: 'TestBetaMiner2' },
    update: {},
    create: { name: 'TestBetaMiner2', owner: 'TestSystem' }
  });

  // Ensure they have scoreboards
  for (const bot of [botA1, botA2, botB1, botB2]) {
    await prisma.scoreboard.upsert({
      where: { agentId: bot.id },
      update: {},
      create: { agentId: bot.id, elo: 1000 }
    });
  }

  // Clear any existing inventory for these bots
  await prisma.agentInventory.deleteMany({
    where: { agentId: { in: [botA1.id, botA2.id, botB1.id, botB2.id] } }
  });

  // Create match
  const match = await prisma.match.create({
    data: {
      createdBy: 'SpaceColonyTest',
      totalRounds: 10,
      gameType: 'space_colony_trading',
      matchSeed: 'test-seed-colony',
      status: 'waiting_for_players',
      maxPlayers: 4
    }
  });

  // Join match with teamKey
  await prisma.matchParticipant.create({ data: { matchId: match.id, agentId: botA1.id, role: 'player_1', teamKey: 'team_alpha' } });
  await prisma.matchParticipant.create({ data: { matchId: match.id, agentId: botA2.id, role: 'player_2', teamKey: 'team_alpha' } });
  await prisma.matchParticipant.create({ data: { matchId: match.id, agentId: botB1.id, role: 'player_3', teamKey: 'team_beta' } });
  await prisma.matchParticipant.create({ data: { matchId: match.id, agentId: botB2.id, role: 'player_4', teamKey: 'team_beta' } });

  // Start match
  await prisma.match.update({
    where: { id: match.id },
    data: { status: 'in_progress', currentRound: 1, startedAt: new Date() },
  });
  await prisma.round.create({
    data: { matchId: match.id, roundNumber: 1, status: 'waiting_for_actions' },
  });

  // ROUND 1: Everyone mines resources
  console.log('Running Round 1: Mining resources...');
  await submitAgentAction(match.id, botA1.id, 'mine');
  await submitAgentAction(match.id, botA2.id, 'mine');
  await submitAgentAction(match.id, botB1.id, 'mine');
  await submitAgentAction(match.id, botB2.id, 'mine');

  // Verify resources in DB directly (applied round-by-round!)
  const invA1_r1 = await prisma.agentInventory.findUnique({ where: { agentId_resourceKey: { agentId: botA1.id, resourceKey: 'metal' } } });
  const invA2_r1 = await prisma.agentInventory.findUnique({ where: { agentId_resourceKey: { agentId: botA2.id, resourceKey: 'fuel' } } });
  
  assert(invA1_r1!.quantity === 3, `Expected Bot A1 to mine 3 metal in DB, got ${invA1_r1?.quantity}`);
  assert(invA2_r1!.quantity === 3, `Expected Bot A2 to mine 3 fuel in DB, got ${invA2_r1?.quantity}`);
  console.log('Round 1 Passed! Mining works as expected.');

  // ROUND 2: Bot A1 proposes contract to Bot A2: give 3 metal for 3 fuel
  console.log('Running Round 2: Proposing a trade contract...');
  await submitAgentAction(match.id, botA1.id, `propose_contract:${botA2.id},metal,3,fuel,3`);
  await submitAgentAction(match.id, botA2.id, 'mine'); // A2 mines more fuel (+3 fuel -> total 6 fuel)
  await submitAgentAction(match.id, botB1.id, 'mine');
  await submitAgentAction(match.id, botB2.id, 'mine');

  // Verify contract proposed in DB
  const contracts = await prisma.gameContract.findMany({ where: { matchId: match.id } });
  assert(contracts.length === 1, 'Expected one contract in DB');
  assert(contracts[0].status === 'pending', 'Expected contract status to be pending');

  const contract = contracts[0];
  console.log('Round 2 Passed! Contract proposed successfully.');

  // ROUND 3: Bot A2 accepts the contract proposed by Bot A1
  console.log('Running Round 3: Accepting contract...');
  await submitAgentAction(match.id, botA2.id, `accept_contract:${contract.id}`);
  await submitAgentAction(match.id, botA1.id, 'mine'); // A1 mines (+3 metal -> total 6 metal before swap)
  await submitAgentAction(match.id, botB1.id, 'mine');
  await submitAgentAction(match.id, botB2.id, 'mine');

  // Verify contract completed
  const updatedContract = await prisma.gameContract.findUnique({ where: { id: contract.id } });
  assert(updatedContract!.status === 'completed', `Expected contract status completed, got ${updatedContract!.status}`);

  // Verify DB inventories swapped immediately
  const invA1_metal = await prisma.agentInventory.findUnique({ where: { agentId_resourceKey: { agentId: botA1.id, resourceKey: 'metal' } } });
  const invA1_fuel = await prisma.agentInventory.findUnique({ where: { agentId_resourceKey: { agentId: botA1.id, resourceKey: 'fuel' } } });
  const invA2_metal = await prisma.agentInventory.findUnique({ where: { agentId_resourceKey: { agentId: botA2.id, resourceKey: 'metal' } } });
  const invA2_fuel = await prisma.agentInventory.findUnique({ where: { agentId_resourceKey: { agentId: botA2.id, resourceKey: 'fuel' } } });

  // A1: Had 3 metal (from R1) + 3 metal (from R3 mine) = 6 metal. Swaps 3 metal for 3 fuel -> 3 metal, 3 fuel.
  assert(invA1_metal!.quantity === 3, `Expected Bot A1 metal to be 3, got ${invA1_metal?.quantity}`);
  assert(invA1_fuel!.quantity === 3, `Expected Bot A1 fuel to be 3, got ${invA1_fuel?.quantity}`);
  // A2: Had 3 fuel (from R1) + 3 fuel (from R2 mine) = 6 fuel. Swaps 3 fuel for 3 metal -> 3 metal, 3 fuel.
  assert(invA2_metal!.quantity === 3, `Expected Bot A2 metal to be 3, got ${invA2_metal?.quantity}`);
  assert(invA2_fuel!.quantity === 3, `Expected Bot A2 fuel to be 3, got ${invA2_fuel?.quantity}`);
  console.log('Round 3 Passed! Contract acceptance and inventory swap completed successfully.');

  // ROUND 4: Setup build condition and build the colony module!
  console.log('Running Round 4: Building colony and finishing match...');
  
  // Set DB inventories of Bot A1 to exactly 10 metal and 10 fuel to pass the build validator
  await prisma.agentInventory.upsert({
    where: { agentId_resourceKey: { agentId: botA1.id, resourceKey: 'metal' } },
    update: { quantity: 10 },
    create: { agentId: botA1.id, resourceKey: 'metal', quantity: 10 }
  });
  await prisma.agentInventory.upsert({
    where: { agentId_resourceKey: { agentId: botA1.id, resourceKey: 'fuel' } },
    update: { quantity: 10 },
    create: { agentId: botA1.id, resourceKey: 'fuel', quantity: 10 }
  });

  // Also we need to sync the active round payload so the VM doesn't complain
  const round3 = await prisma.round.findUnique({
    where: { matchId_roundNumber: { matchId: match.id, roundNumber: 3 } }
  });
  const stateR3 = JSON.parse(round3!.payload!);
  const updatedStateR3 = {
    ...stateR3,
    resources: {
      ...stateR3.resources,
      [botA1.id]: { metal: 10, fuel: 10, moduleBuilt: false }
    }
  };
  await prisma.round.update({
    where: { matchId_roundNumber: { matchId: match.id, roundNumber: 3 } },
    data: { payload: JSON.stringify(updatedStateR3) }
  });

  await submitAgentAction(match.id, botA1.id, 'build');
  await submitAgentAction(match.id, botA2.id, 'mine');
  await submitAgentAction(match.id, botB1.id, 'mine');
  await submitAgentAction(match.id, botB2.id, 'mine');

  // Verify match finished
  const finishedMatch = await prisma.match.findUnique({ where: { id: match.id } });
  assert(finishedMatch!.status === 'finished', `Expected match status to be finished, got ${finishedMatch!.status}`);

  // Verify DB Inventory has been updated post-match (spent 10 metal/fuel to build!)
  const dbInvA1_metal = await prisma.agentInventory.findUnique({ where: { agentId_resourceKey: { agentId: botA1.id, resourceKey: 'metal' } } });
  const dbInvA1_fuel = await prisma.agentInventory.findUnique({ where: { agentId_resourceKey: { agentId: botA1.id, resourceKey: 'fuel' } } });
  assert(dbInvA1_metal!.quantity === 0, `Expected Bot A1 to have spent metals (0 left), got ${dbInvA1_metal?.quantity}`);
  assert(dbInvA1_fuel!.quantity === 0, `Expected Bot A1 to have spent fuel (0 left), got ${dbInvA1_fuel?.quantity}`);

  // Verify Team ELO adjusted
  const sbA1 = await prisma.scoreboard.findUnique({ where: { agentId: botA1.id } });
  const sbA2 = await prisma.scoreboard.findUnique({ where: { agentId: botA2.id } });
  const sbB1 = await prisma.scoreboard.findUnique({ where: { agentId: botB1.id } });
  const sbB2 = await prisma.scoreboard.findUnique({ where: { agentId: botB2.id } });

  assert(sbA1!.elo > 1000, `Expected Team Alpha ELO to increase, Bot A1 ELO: ${sbA1!.elo}`);
  assert(sbA2!.elo > 1000, `Expected Team Alpha ELO to increase, Bot A2 ELO: ${sbA2!.elo}`);
  assert(sbB1!.elo < 1000, `Expected Team Beta ELO to decrease, Bot B1 ELO: ${sbB1!.elo}`);
  assert(sbB2!.elo < 1000, `Expected Team Beta ELO to decrease, Bot B2 ELO: ${sbB2!.elo}`);

  console.log(`Team Alpha ELO increased to: ${sbA1!.elo} and ${sbA2!.elo}`);
  console.log(`Team Beta ELO decreased to: ${sbB1!.elo} and ${sbB2!.elo}`);
  console.log('Round 4 Passed! Space Colony Resource Trading Integration Test Passed Successfully!');
  console.log('--- All Space Colony Tests Passed Successfully! ---');
}

runTest().catch(err => {
  console.error('SPACE COLONY TEST FAILED:', err.message);
  process.exit(1);
});
