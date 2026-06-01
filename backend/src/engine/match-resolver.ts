import prisma from '../db.js';
import { calculateRoundScores, calculateElo, Move } from './prisoners-dilemma.js';
import { calculateRPSRoundScores, RPSMove } from './rock-paper-scissors.js';
import { calculateChickenRoundScores, ChickenMove } from './chicken.js';
import { playTTTTurn, TTTBoard } from './tic-tac-toe.js';
import { refreshMatchIntegrityHashTx } from './integrity.js';
import { createSandbox } from './sandbox.js';
import { createPRNG } from './prng.js';

// #region debug-point Z:dbg-helper
const __dbg = (hypothesisId: string, location: string, msg: string, data?: any) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    let url = 'http://127.0.0.1:7777/event';
    let sessionId = 'mafia-agent-timeout';
    try {
      const env = fs.readFileSync('.dbg/mafia-agent-timeout.env', 'utf8');
      url = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || url;
      sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || sessionId;
    } catch (e) {}
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        runId: 'pre-fix',
        hypothesisId,
        location,
        msg: `[DEBUG] ${msg}`,
        data: data || {},
        ts: Date.now(),
      }),
    }).catch(() => {});
  } catch (e) {}
};
// #endregion

export async function submitAgentAction(
  matchId: string,
  agentId: string,
  move: string,
  payload?: string
) {
  return await prisma.$transaction(async (tx) => {
    // 1. Get Match and Participant info
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: {
        participants: {
          include: { agent: true },
        },
      },
    });

    if (!match) {
      throw new Error(`Match ${matchId} not found.`);
    }

    if (match.status !== 'in_progress') {
      throw new Error(`Match ${matchId} is not in progress. Current status: ${match.status}`);
    }

    const participant = match.participants.find((p) => p.agentId === agentId);
    if (!participant) {
      throw new Error(`Agent ${agentId} is not a participant in match ${matchId}.`);
    }

    const roleOrderedParticipants = [...match.participants].sort((a, b) =>
      (a.role || '').localeCompare(b.role || '')
    );
    const roleOrderedPlayerIds = roleOrderedParticipants.map((p) => p.agentId);

    // Fetch the game specification from the database
    const gameSpec = await tx.gameSpecification.findUnique({
      where: { key: match.gameType },
    });

    const isSequential = gameSpec ? gameSpec.turnType === 'sequential' : match.gameType === 'tic_tac_toe';

    // Find the active round
    const currentRoundNumber = match.currentRound;
    const round = await tx.round.findUnique({
      where: {
        matchId_roundNumber: {
          matchId,
          roundNumber: currentRoundNumber,
        },
      },
    });

    if (!round) {
      throw new Error(`Round ${currentRoundNumber} not found for match ${matchId}.`);
    }

    if (round.status !== 'waiting_for_actions') {
      throw new Error(`Round ${currentRoundNumber} is already resolved.`);
    }

    if (isSequential) {
      if (gameSpec && gameSpec.codeScript) {
        // Dynamic turn validation
        const sortedRoles = [...match.participants].sort((a,b) => (a.role || '').localeCompare(b.role || ''));
        const expectedRoleIndex = (currentRoundNumber - 1) % sortedRoles.length;
        const expectedParticipant = sortedRoles[expectedRoleIndex];
        if (expectedParticipant.agentId !== agentId) {
          throw new Error(`It is not your turn. Waiting for player ${expectedParticipant.role} (${expectedParticipant.agent.name}).`);
        }

        // Load current state for validation
        const sandbox = createSandbox(gameSpec.codeScript);
        let boardState: any = {};
        if (currentRoundNumber > 1) {
          const prevRound = await tx.round.findUnique({
            where: { matchId_roundNumber: { matchId, roundNumber: currentRoundNumber - 1 } },
          });
          if (prevRound && prevRound.payload) {
            boardState = JSON.parse(prevRound.payload);
          }
        } else {
          boardState = sandbox.initializeState(roleOrderedPlayerIds, match.matchSeed);
        }

        const valRes = sandbox.validateAction(boardState, move, agentId, { action: move, payload, agentId });
        if (!valRes.valid) {
          throw new Error(valRes.error || `Invalid move: ${move}`);
        }
      } else {
        // Legacy role validation
        const expectedRoleIndex = (currentRoundNumber - 1) % roleOrderedParticipants.length;
        const expectedParticipant = roleOrderedParticipants[expectedRoleIndex];
        const expectedRole = expectedParticipant?.role || null;
        // #region debug-point A:legacy-role-validation
        __dbg(
          'A',
          'match-resolver.ts:legacy-role-validation',
          'Sequential role validation (no codeScript)',
          {
            matchId,
            gameType: match.gameType,
            currentRoundNumber,
            agentId,
            participantRole: participant.role,
            expectedRole,
            expectedAgentId: expectedParticipant?.agentId,
            maxPlayers: match.maxPlayers,
          }
        );
        // #endregion
        if (expectedParticipant && expectedParticipant.agentId !== agentId) {
          // #region debug-point A:legacy-reject
          __dbg(
            'A',
            'match-resolver.ts:legacy-role-reject',
            'Rejecting move due to expected participant mismatch',
            {
              matchId,
              agentId,
              move,
              participantRole: participant.role,
              expectedRole,
              expectedAgentId: expectedParticipant.agentId,
              currentRoundNumber,
            }
          );
          // #endregion
          throw new Error(`It is not your turn. Waiting for player ${expectedRole}.`);
        }
      }

      // Check if action already submitted
      const existingAction = await tx.action.findFirst({
        where: { roundId: round.id },
      });
      if (existingAction) {
        throw new Error(`Round ${currentRoundNumber} already has a move.`);
      }

      // Record move
      await tx.action.create({
        data: {
          matchId,
          roundId: round.id,
          agentId,
          actionType: move,
          payload,
        },
      });

      // Check if this is Tic-Tac-Toe
      if (match.gameType === 'tic_tac_toe') {
        const cellIndex = parseInt(move);
        if (isNaN(cellIndex) || cellIndex < 0 || cellIndex > 8) {
          throw new Error(`Invalid move: ${move}. Must be cell index 0-8.`);
        }

        let boardState: TTTBoard = Array(9).fill('');
        if (currentRoundNumber > 1) {
          const prevRound = await tx.round.findUnique({
            where: {
              matchId_roundNumber: {
                matchId,
                roundNumber: currentRoundNumber - 1,
              },
            },
          });
          if (prevRound && prevRound.payload) {
            boardState = JSON.parse(prevRound.payload);
          }
        }

        const symbol = participant.role === 'player_1' ? 'X' : 'O';
        const playRes = playTTTTurn(boardState, cellIndex, symbol);

        if (!playRes.valid) {
          throw new Error(`Cell ${cellIndex} is already occupied or invalid.`);
        }

        // Update round
        await tx.round.update({
          where: { id: round.id },
          data: {
            status: 'finished',
            payload: JSON.stringify(playRes.board),
            finishedAt: new Date(),
          },
        });

        await tx.matchLog.create({
          data: {
            matchId,
            eventType: 'action_submitted',
            message: `${participant.agent.name} (${symbol}) played cell ${cellIndex}`,
            payload: JSON.stringify({ agentId, cellIndex, symbol, board: playRes.board }),
          },
        });

        if (playRes.winner || playRes.isDraw) {
          // Finish match
          let outcome1: 1 | 0.5 | 0 = 0.5;
          let outcome2: 1 | 0.5 | 0 = 0.5;
          let winnerId: string | null = null;

          const player1Part = match.participants.find(p => p.role === 'player_1')!;
          const player2Part = match.participants.find(p => p.role === 'player_2')!;

          if (playRes.winner === 'X') {
            outcome1 = 1;
            outcome2 = 0;
            winnerId = player1Part.agentId;
          } else if (playRes.winner === 'O') {
            outcome1 = 0;
            outcome2 = 1;
            winnerId = player2Part.agentId;
          }

          await tx.matchParticipant.update({
            where: { id: player1Part.id },
            data: { score: outcome1 === 1 ? 10 : (outcome1 === 0.5 ? 2 : 0) },
          });
          await tx.matchParticipant.update({
            where: { id: player2Part.id },
            data: { score: outcome2 === 1 ? 10 : (outcome2 === 0.5 ? 2 : 0) },
          });

          await tx.match.update({
            where: { id: matchId },
            data: { status: 'finished', finishedAt: new Date() },
          });

          const sb1 = await tx.scoreboard.upsert({
            where: { agentId: player1Part.agentId },
            update: {},
            create: { agentId: player1Part.agentId },
          });
          const sb2 = await tx.scoreboard.upsert({
            where: { agentId: player2Part.agentId },
            update: {},
            create: { agentId: player2Part.agentId },
          });

          const eloCalc = calculateElo(sb1.elo, sb2.elo, outcome1);

          await tx.scoreboard.update({
            where: { agentId: player1Part.agentId },
            data: {
              gamesPlayed: { increment: 1 },
              wins: { increment: outcome1 === 1 ? 1 : 0 },
              losses: { increment: outcome1 === 0 ? 1 : 0 },
              draws: { increment: outcome1 === 0.5 ? 1 : 0 },
              totalScore: { increment: outcome1 === 1 ? 10 : (outcome1 === 0.5 ? 2 : 0) },
              elo: eloCalc.newRatingA,
            },
          });

          await tx.scoreboard.update({
            where: { agentId: player2Part.agentId },
            data: {
              gamesPlayed: { increment: 1 },
              wins: { increment: outcome2 === 1 ? 1 : 0 },
              losses: { increment: outcome2 === 0 ? 1 : 0 },
              draws: { increment: outcome2 === 0.5 ? 1 : 0 },
              totalScore: { increment: outcome2 === 1 ? 10 : (outcome2 === 0.5 ? 2 : 0) },
              elo: eloCalc.newRatingB,
            },
          });

          await tx.agent.update({ where: { id: player1Part.agentId }, data: { status: 'idle' } });
          await tx.agent.update({ where: { id: player2Part.agentId }, data: { status: 'idle' } });

          const winnerName = playRes.winner ? (playRes.winner === 'X' ? player1Part.agent.name : player2Part.agent.name) : null;
          await tx.matchLog.create({
            data: {
              matchId,
              eventType: 'match_finished',
              message: winnerName ? `Match finished! Winner: ${winnerName}.` : 'Match finished! It is a Tie.',
            },
          });
        } else {
          // Next round
          const nextRoundNumber = currentRoundNumber + 1;
          await tx.match.update({
            where: { id: matchId },
            data: { currentRound: nextRoundNumber },
          });

          await tx.round.create({
            data: {
              matchId,
              roundNumber: nextRoundNumber,
              status: 'waiting_for_actions',
              payload: JSON.stringify(playRes.board),
            },
          });

          const nextRole = nextRoundNumber % 2 === 1 ? 'player_1' : 'player_2';
          const nextParticipant = match.participants.find(p => p.role === nextRole)!;
          await tx.matchLog.create({
            data: {
              matchId,
              eventType: 'round_started',
              message: `Round ${nextRoundNumber} started. Turn for ${nextParticipant.agent.name} (${nextRole === 'player_1' ? 'X' : 'O'})`,
            },
          });
        }
      } else if (gameSpec && gameSpec.codeScript) {
        // Mark current round finished
        await tx.round.update({
          where: { id: round.id },
          data: {
            status: 'finished',
            finishedAt: new Date(),
          },
        });

        await tx.matchLog.create({
          data: {
            matchId,
            eventType: 'action_submitted',
            message: `${participant.agent.name} submitted their sequential action: "${move}"`,
          },
        });

        // Load state and run VM transition
        const sandbox = createSandbox(gameSpec.codeScript);
        let boardState: any = {};
        if (currentRoundNumber > 1) {
          const prevRound = await tx.round.findUnique({
            where: {
              matchId_roundNumber: {
                matchId,
                roundNumber: currentRoundNumber - 1,
              },
            },
          });
          if (prevRound && prevRound.payload) {
            boardState = JSON.parse(prevRound.payload);
          }
        } else {
          boardState = sandbox.initializeState(roleOrderedPlayerIds, match.matchSeed);
        }

        const prng = createPRNG(match.matchSeed + '_' + currentRoundNumber);
        
        // Load contracts and inventories
        const activeContracts = await tx.gameContract.findMany({
          where: { matchId },
        });
        const participantAgentIds = match.participants.map(p => p.agentId);
        const dbInventories = await tx.agentInventory.findMany({
          where: { agentId: { in: participantAgentIds } },
        });
        const playerInventories: Record<string, Record<string, number>> = {};
        for (const pid of participantAgentIds) {
          playerInventories[pid] = {};
        }
        for (const inv of dbInventories) {
          playerInventories[inv.agentId][inv.resourceKey] = inv.quantity;
        }

        const gameContext = {
          contracts: activeContracts,
          inventories: playerInventories,
          participants: roleOrderedParticipants.map(p => ({
            agentId: p.agentId,
            teamKey: p.teamKey,
            role: p.role,
            name: p.agent.name,
          })),
        };

        const { newState, finished, scores, events, contractUpdates, inventoryUpdates } = sandbox.transitionState(
          boardState,
          move,
          agentId,
          prng,
          gameContext,
          { action: move, payload, agentId }
        );

        // Process contract updates
        if (contractUpdates && Array.isArray(contractUpdates)) {
          for (const update of contractUpdates) {
            if (update.action === 'create') {
              await tx.gameContract.create({
                data: {
                  matchId,
                  proposerId: update.proposerId,
                  acceptorId: update.acceptorId,
                  terms: JSON.stringify(update.terms),
                  status: update.status || 'pending',
                },
              });
            } else if (update.action === 'update') {
              await tx.gameContract.update({
                where: { id: update.id },
                data: {
                  status: update.status,
                },
              });
            }
          }
        }

        // Update round payload
        await tx.round.update({
          where: { id: round.id },
          data: {
            payload: JSON.stringify(newState),
          },
        });

        // Write transition logs
        if (events && Array.isArray(events)) {
          for (const evt of events) {
            await tx.matchLog.create({
              data: {
                matchId,
                eventType: evt.eventType || 'sandbox_event',
                message: evt.message || 'Sandbox event triggered',
                payload: evt.payload ? JSON.stringify(evt.payload) : null,
              },
            });
          }
        }

        // Apply inventory updates
        if (inventoryUpdates) {
          for (const aId of Object.keys(inventoryUpdates)) {
            const resources = inventoryUpdates[aId];
            for (const resourceKey of Object.keys(resources)) {
              const amount = resources[resourceKey];
              if (amount === 0) continue;
              await tx.agentInventory.upsert({
                where: {
                  agentId_resourceKey: {
                    agentId: aId,
                    resourceKey,
                  },
                },
                update: {
                  quantity: { increment: amount },
                },
                create: {
                  agentId: aId,
                  resourceKey,
                  quantity: amount,
                },
              });
            }
          }
        }

        const isLastRound = currentRoundNumber >= match.totalRounds || finished;
        if (isLastRound) {
          // Finish match!
          await tx.match.update({
            where: { id: matchId },
            data: { status: 'finished', finishedAt: new Date() },
          });

          // N-Player ELO and Scoreboard update using scores from script
          const activeParticipants = match.participants;
          const sortedParticipants = [...activeParticipants].sort((a,b) => (a.role || '').localeCompare(b.role || ''));

          for (const p of sortedParticipants) {
            const pScore = scores[p.agentId] ?? (isLastRound ? 3 : 0);
            await tx.matchParticipant.update({
              where: { id: p.id },
              data: { score: pScore },
            });
            p.score = pScore; // Update memory reference for ELO calculation below
          }

          // ELO Calculation for N-players (FFA or Teams)
          const hasTeams = sortedParticipants.some(p => p.teamKey);
          
          if (hasTeams) {
            const teams = [...new Set(sortedParticipants.map(p => p.teamKey).filter(Boolean))] as string[];
            const teamRatings: Record<string, number> = {};
            const teamScores: Record<string, number> = {};
            const teamMembers: Record<string, typeof sortedParticipants> = {};
            
            for (const t of teams) {
              const members = sortedParticipants.filter(p => p.teamKey === t);
              teamMembers[t] = members;
              teamScores[t] = members.reduce((sum, m) => sum + m.score, 0) / members.length;
              
              let totalElo = 0;
              for (const m of members) {
                const sb = await tx.scoreboard.upsert({
                  where: { agentId: m.agentId },
                  update: {},
                  create: { agentId: m.agentId },
                });
                totalElo += sb.elo;
              }
              teamRatings[t] = totalElo / members.length;
            }
            
            const teamEloChanges: Record<string, number> = {};
            for (const t of teams) {
              teamEloChanges[t] = 0;
            }
            
            for (let i = 0; i < teams.length; i++) {
              const t1 = teams[i];
              for (let j = 0; j < teams.length; j++) {
                if (i === j) continue;
                const t2 = teams[j];
                
                let outcome: 1 | 0.5 | 0 = 0.5;
                if (teamScores[t1] > teamScores[t2]) outcome = 1;
                else if (teamScores[t1] < teamScores[t2]) outcome = 0;
                
                const eloCalc = calculateElo(Math.round(teamRatings[t1]), Math.round(teamRatings[t2]), outcome);
                teamEloChanges[t1] += (eloCalc.newRatingA - Math.round(teamRatings[t1]));
              }
            }
            
            for (const t of teams) {
              const avgChange = Math.round(teamEloChanges[t] / Math.max(1, teams.length - 1));
              const members = teamMembers[t];
              
              for (const m of members) {
                const isWin = teamScores[t] > Math.min(...teams.map(ot => ot !== t ? teamScores[ot] : Infinity));
                const isLoss = teamScores[t] < Math.max(...teams.map(ot => ot !== t ? teamScores[ot] : -Infinity));
                const isDraw = !isWin && !isLoss;
                
                await tx.scoreboard.update({
                  where: { agentId: m.agentId },
                  data: {
                    gamesPlayed: { increment: 1 },
                    wins: { increment: isWin ? 1 : 0 },
                    losses: { increment: isLoss ? 1 : 0 },
                    draws: { increment: isDraw ? 1 : 0 },
                    totalScore: { increment: m.score },
                    elo: { increment: avgChange },
                  },
                });
                await tx.agent.update({ where: { id: m.agentId }, data: { status: 'idle' } });
              }
            }
          } else {
            // ELO Calculation for N-players (FFA)
            for (let i = 0; i < sortedParticipants.length; i++) {
               const p1 = sortedParticipants[i];
               let eloChange = 0;
               const sb1 = await tx.scoreboard.upsert({
                 where: { agentId: p1.agentId },
                 update: {},
                 create: { agentId: p1.agentId },
               });
               
               let wins = 0, losses = 0, draws = 0;

               for (let j = 0; j < sortedParticipants.length; j++) {
                 if (i === j) continue;
                 const p2 = sortedParticipants[j];
                 const sb2 = await tx.scoreboard.upsert({
                   where: { agentId: p2.agentId },
                   update: {},
                   create: { agentId: p2.agentId },
                 });

                 let outcome: 1 | 0.5 | 0 = 0.5;
                 if (p1.score > p2.score) { outcome = 1; wins++; }
                 else if (p1.score < p2.score) { outcome = 0; losses++; }
                 else { draws++; }

                 const eloCalc = calculateElo(sb1.elo, sb2.elo, outcome);
                 eloChange += (eloCalc.newRatingA - sb1.elo);
               }

               const finalEloChange = Math.round(eloChange / Math.max(1, sortedParticipants.length - 1));

               await tx.scoreboard.update({
                 where: { agentId: p1.agentId },
                 data: {
                   gamesPlayed: { increment: 1 },
                   wins: { increment: wins > 0 && wins >= losses ? 1 : 0 },
                   losses: { increment: losses > wins ? 1 : 0 },
                   draws: { increment: draws > 0 && wins === 0 && losses === 0 ? 1 : 0 },
                   totalScore: { increment: p1.score },
                   elo: { increment: finalEloChange },
                 },
               });

               await tx.agent.update({ where: { id: p1.agentId }, data: { status: 'idle' } });
            }
          }

          const topScorer = sortedParticipants.reduce((prev, curr) => (prev.score > curr.score) ? prev : curr);

          await tx.matchLog.create({
            data: {
              matchId,
              eventType: 'match_finished',
              message: `Match finished! Top Scorer: ${topScorer.agent.name} (${topScorer.score} pts).`,
            },
          });

        } else {
          // Next round
          const nextRoundNumber = currentRoundNumber + 1;
          await tx.match.update({
            where: { id: matchId },
            data: { currentRound: nextRoundNumber },
          });

          await tx.round.create({
            data: {
              matchId,
              roundNumber: nextRoundNumber,
              status: 'waiting_for_actions',
              payload: JSON.stringify(newState),
            },
          });

          // N-player turn sequencing
          const activeParticipants = match.participants;
          const sortedRoles = [...activeParticipants].sort((a,b) => (a.role || '').localeCompare(b.role || ''));
          const nextRoleIndex = (nextRoundNumber - 1) % sortedRoles.length;
          const nextParticipant = sortedRoles[nextRoleIndex];
          
          await tx.matchLog.create({
            data: {
              matchId,
              eventType: 'round_started',
              message: `Round ${nextRoundNumber} started. Turn for ${nextParticipant.agent.name} (${nextParticipant.role})`,
            },
          });
        }
      } else {
        // GENERAL SEQUENTIAL GAME (like dynamic sequential debate/pitch and judge)
        // If it's a dynamic sequential game, we resolve the round after each player acts
        // Mark current round finished
        await tx.round.update({
          where: { id: round.id },
          data: {
            status: 'finished',
            finishedAt: new Date(),
          },
        });

        await tx.matchLog.create({
          data: {
            matchId,
            eventType: 'action_submitted',
            message: `${participant.agent.name} submitted their sequential action: "${move}"`,
          },
        });

        // Is it the last round?
        if (currentRoundNumber >= match.totalRounds) {
          // Finish match!
          const allActions = await tx.action.findMany({
            where: { matchId },
            include: { agent: true },
          });

          // Map the final action of each participant
          const activeParticipants = match.participants;
          const sortedParticipants = [...activeParticipants].sort((a,b) => (a.role || '').localeCompare(b.role || ''));
          
          let agentScores = sortedParticipants.map(() => 3); // Default 3 points

          const rules = gameSpec?.payoffRules ? JSON.parse(gameSpec.payoffRules) : null;

          if (rules?.matrix) {
            // Get the last action of each participant
            const moves = sortedParticipants.map(part => {
              const partActions = allActions.filter(a => a.agentId === part.agentId);
              return partActions.length > 0 ? partActions[partActions.length - 1].actionType : '';
            });

            // Basic parsing of keywords if empty
            const mappedMoves = moves.map(m => {
              let move = m.toLowerCase();
              if (move.includes('high') || move.includes('alto')) return 'high_val';
              if (move.includes('low') || move.includes('baixo')) return 'low_val';
              if (move.includes('fair') || move.includes('justo')) return 'fair_val';
              return m;
            });

            const key = mappedMoves.join(',');
            if (rules.matrix[key]) {
              agentScores = rules.matrix[key];
            } else if (mappedMoves.length === 2) {
              const altKey = `${mappedMoves[1]},${mappedMoves[0]}`;
              if (rules.matrix[altKey]) {
                agentScores = [rules.matrix[altKey][1], rules.matrix[altKey][0]];
              }
            }
          } else if (match.gameType.includes('judge') || match.gameType.includes('pitch')) {
            // Specific logic for pitch & judge (the judge gives score)
            const judgeAction = allActions.find(a => a.agentId !== allActions[0].agentId);
            const scoreVal = parseInt(judgeAction?.actionType || '3');
            agentScores[0] = isNaN(scoreVal) ? 3 : scoreVal;
            agentScores[1] = 3; // Judge gets flat 3
          }

          // Assign scores
          for (let i = 0; i < sortedParticipants.length; i++) {
            const scoreDelta = agentScores[i] || 0;
            await tx.matchParticipant.update({
              where: { id: sortedParticipants[i].id },
              data: { score: scoreDelta }, // Sequential assigns absolute score for now
            });
            sortedParticipants[i].score = scoreDelta; // Update memory for ELO
          }

          await tx.match.update({
            where: { id: matchId },
            data: { status: 'finished', finishedAt: new Date() },
          });

          // N-Player ELO Calculation
          for (let i = 0; i < sortedParticipants.length; i++) {
             const p1 = sortedParticipants[i];
             let eloChange = 0;
             const sb1 = await tx.scoreboard.upsert({
               where: { agentId: p1.agentId },
               update: {},
               create: { agentId: p1.agentId },
             });
             
             let wins = 0, losses = 0, draws = 0;

             for (let j = 0; j < sortedParticipants.length; j++) {
               if (i === j) continue;
               const p2 = sortedParticipants[j];
               const sb2 = await tx.scoreboard.upsert({
                 where: { agentId: p2.agentId },
                 update: {},
                 create: { agentId: p2.agentId },
               });

               let outcome: 1 | 0.5 | 0 = 0.5;
               if (p1.score > p2.score) { outcome = 1; wins++; }
               else if (p1.score < p2.score) { outcome = 0; losses++; }
               else { draws++; }

               const eloCalc = calculateElo(sb1.elo, sb2.elo, outcome);
               eloChange += (eloCalc.newRatingA - sb1.elo);
             }

             const finalEloChange = Math.round(eloChange / Math.max(1, sortedParticipants.length - 1));

             await tx.scoreboard.update({
               where: { agentId: p1.agentId },
               data: {
                 gamesPlayed: { increment: 1 },
                 wins: { increment: wins > 0 && wins >= losses ? 1 : 0 },
                 losses: { increment: losses > wins ? 1 : 0 },
                 draws: { increment: draws > 0 && wins === 0 && losses === 0 ? 1 : 0 },
                 totalScore: { increment: p1.score },
                 elo: { increment: finalEloChange },
               },
             });

             await tx.agent.update({ where: { id: p1.agentId }, data: { status: 'idle' } });
          }

          const topScorer = sortedParticipants.reduce((prev, curr) => (prev.score > curr.score) ? prev : curr);

          await tx.matchLog.create({
            data: {
              matchId,
              eventType: 'match_finished',
              message: `Match finished! Top Scorer: ${topScorer.agent.name} (${topScorer.score} pts).`,
            },
          });
        } else {
          // Start next sequential round
          const nextRoundNumber = currentRoundNumber + 1;
          await tx.match.update({
            where: { id: matchId },
            data: { currentRound: nextRoundNumber },
          });

          await tx.round.create({
            data: {
              matchId,
              roundNumber: nextRoundNumber,
              status: 'waiting_for_actions',
            },
          });

          // N-player turn sequencing
          const activeParticipants = match.participants;
          const sortedRoles = [...activeParticipants].sort((a,b) => (a.role || '').localeCompare(b.role || ''));
          const nextRoleIndex = (nextRoundNumber - 1) % sortedRoles.length;
          const nextParticipant = sortedRoles[nextRoleIndex];
          
          await tx.matchLog.create({
            data: {
              matchId,
              eventType: 'round_started',
              message: `Round ${nextRoundNumber} started. Turn for ${nextParticipant.agent.name} (${nextParticipant.role})`,
            },
          });
        }
      }

      await refreshMatchIntegrityHashTx(tx, matchId);
      return { status: 'success', currentRound: currentRoundNumber + 1 };
    } else {
      // ----------------------------------------------------
      // SIMULTANEOUS GAMES (Prisoner's Dilemma, RPS, Chicken)
      // ----------------------------------------------------
      
      const existingAction = await tx.action.findUnique({
        where: {
          roundId_agentId: {
            roundId: round.id,
            agentId,
          },
        },
      });

      if (existingAction) {
        throw new Error(`Agent ${agentId} has already submitted an action for round ${currentRoundNumber}.`);
      }

      await tx.action.create({
        data: {
          matchId,
          roundId: round.id,
          agentId,
          actionType: move,
          payload,
        },
      });

      await tx.matchLog.create({
        data: {
          matchId,
          eventType: 'action_submitted',
          message: `Agent '${participant.agent.name}' submitted action for round ${currentRoundNumber}`,
        },
      });

      const actionsCount = await tx.action.count({
        where: { roundId: round.id },
      });

      if (actionsCount === match.maxPlayers) {
        const roundActions = await tx.action.findMany({
          where: { roundId: round.id },
          include: { agent: true },
        });

        // Sort by role to ensure deterministic arrays
        const sortedActions = roundActions.sort((a, b) => {
          const pA = match.participants.find(p => p.agentId === a.agentId);
          const pB = match.participants.find(p => p.agentId === b.agentId);
          return (pA?.role || '').localeCompare(pB?.role || '');
        });

        let agentScores = sortedActions.map(() => 0);
        let forceFinished = false;
        let pendingInventoryUpdates: any = null;

        // DYNAMIC GAME VM OR MATRIX RESOLVER
        if (gameSpec && gameSpec.codeScript) {
          const sandbox = createSandbox(gameSpec.codeScript);
          let boardState: any = {};
          if (currentRoundNumber > 1) {
            const prevRound = await tx.round.findUnique({
              where: {
                matchId_roundNumber: {
                  matchId,
                  roundNumber: currentRoundNumber - 1,
                },
              },
            });
            if (prevRound && prevRound.payload) {
              boardState = JSON.parse(prevRound.payload);
            }
          } else {
            boardState = sandbox.initializeState(roleOrderedPlayerIds, match.matchSeed);
          }

          const prng = createPRNG(match.matchSeed + '_' + currentRoundNumber);
          const actionsMap = sortedActions.reduce((acc, act) => {
            acc[act.agentId] = act.actionType;
            return acc;
          }, {} as Record<string, string>);

          // Load contracts and inventories
          const activeContracts = await tx.gameContract.findMany({
            where: { matchId },
          });
          const participantAgentIds = match.participants.map(p => p.agentId);
          const dbInventories = await tx.agentInventory.findMany({
            where: { agentId: { in: participantAgentIds } },
          });
          const playerInventories: Record<string, Record<string, number>> = {};
          for (const pid of participantAgentIds) {
            playerInventories[pid] = {};
          }
          for (const inv of dbInventories) {
            playerInventories[inv.agentId][inv.resourceKey] = inv.quantity;
          }

          const gameContext = {
            contracts: activeContracts,
            inventories: playerInventories,
            participants: match.participants.map(p => ({
              agentId: p.agentId,
              teamKey: p.teamKey,
              role: p.role,
              name: p.agent.name,
            })),
          };

          const { newState, finished, scores, events, contractUpdates, inventoryUpdates } = sandbox.transitionState(
            boardState,
            actionsMap,
            '',
            prng,
            gameContext,
            {
              actions: actionsMap,
              payloads: sortedActions.reduce((acc, act) => {
                acc[act.agentId] = act.payload ?? null;
                return acc;
              }, {} as Record<string, string | null>),
            }
          );

          forceFinished = finished;

          // Apply inventory updates immediately
          if (inventoryUpdates) {
            for (const aId of Object.keys(inventoryUpdates)) {
              const resources = inventoryUpdates[aId];
              for (const resourceKey of Object.keys(resources)) {
                const amount = resources[resourceKey];
                if (amount === 0) continue;
                await tx.agentInventory.upsert({
                  where: {
                    agentId_resourceKey: {
                      agentId: aId,
                      resourceKey,
                    },
                  },
                  update: {
                    quantity: { increment: amount },
                  },
                  create: {
                    agentId: aId,
                    resourceKey,
                    quantity: amount,
                  },
                });
              }
            }
          }

          // Process contract updates
          if (contractUpdates && Array.isArray(contractUpdates)) {
            for (const update of contractUpdates) {
              if (update.action === 'create') {
                await tx.gameContract.create({
                  data: {
                    matchId,
                    proposerId: update.proposerId,
                    acceptorId: update.acceptorId,
                    terms: JSON.stringify(update.terms),
                    status: update.status || 'pending',
                  },
                });
              } else if (update.action === 'update') {
                await tx.gameContract.update({
                  where: { id: update.id },
                  data: {
                    status: update.status,
                  },
                });
              }
            }
          }

          // Update current round payload
          await tx.round.update({
            where: { id: round.id },
            data: {
              payload: JSON.stringify(newState),
            },
          });

          // Write sandbox events
          if (events && Array.isArray(events)) {
            for (const evt of events) {
              await tx.matchLog.create({
                data: {
                  matchId,
                  eventType: evt.eventType || 'sandbox_event',
                  message: evt.message || 'Sandbox event triggered',
                  payload: evt.payload ? JSON.stringify(evt.payload) : null,
                },
              });
            }
          }

          agentScores = sortedActions.map(act => scores[act.agentId] ?? 0);

        } else if (gameSpec && gameSpec.payoffRules) {
          const rules = JSON.parse(gameSpec.payoffRules);
          const allowedActions: string[] = JSON.parse(gameSpec.actions);
          
          const moves = sortedActions.map(act => 
            allowedActions.includes(act.actionType) ? act.actionType : allowedActions[0]
          );

          if (rules.matrix) {
            const key = moves.join(',');
            if (rules.matrix[key]) {
               agentScores = rules.matrix[key];
            } else if (moves.length === 2) {
               // 2-player fallback for symmetric definitions
               const altKey = `${moves[1]},${moves[0]}`;
               if (rules.matrix[altKey]) {
                 agentScores = [rules.matrix[altKey][1], rules.matrix[altKey][0]];
               }
            }
          } else {
             // Default to 1 point each if rules are missing
             agentScores = agentScores.map(() => 1);
          }
        } else {
           // HARDCODED 2-PLAYER FALLBACKS
           const act1 = sortedActions[0];
           const act2 = sortedActions[1];
           if (act1 && act2) {
             let res: any;
             if (match.gameType === 'rock_paper_scissors') {
               res = calculateRPSRoundScores(act1.agentId, act1.actionType as RPSMove, act2.agentId, act2.actionType as RPSMove);
             } else if (match.gameType === 'chicken') {
               res = calculateChickenRoundScores(act1.agentId, act1.actionType as ChickenMove, act2.agentId, act2.actionType as ChickenMove);
             } else {
               res = calculateRoundScores(act1.agentId, act1.actionType as Move, act2.agentId, act2.actionType as Move);
             }
             agentScores = [res.agent1Score, res.agent2Score];
           }
        }

        // Update round
        await tx.round.update({
          where: { id: round.id },
          data: { status: 'finished', finishedAt: new Date() },
        });

        // Update participant scores
        for (let i = 0; i < sortedActions.length; i++) {
          const scoreDelta = agentScores[i] || 0;
          await tx.matchParticipant.update({
            where: { matchId_agentId: { matchId, agentId: sortedActions[i].agentId } },
            data: { score: { increment: scoreDelta } },
          });
        }

        const msgLog = sortedActions.map((a, i) => `${a.agent.name} (${a.actionType}): +${agentScores[i]||0}`).join(' vs ');
        await tx.matchLog.create({
          data: {
            matchId,
            eventType: 'round_resolved',
            message: `Round ${currentRoundNumber} resolved: ${msgLog}`,
          },
        });

        // Is it the final round?
        if (currentRoundNumber >= match.totalRounds || forceFinished) {
          // Finish match!
          await tx.match.update({
            where: { id: matchId },
            data: { status: 'finished', finishedAt: new Date() },
          });



          // Fetch final scores
          const finalParticipants = await tx.matchParticipant.findMany({
            where: { matchId },
            include: { agent: true }
          });

          // ELO Calculation for N-players (FFA or Teams)
          const hasTeams = finalParticipants.some(p => p.teamKey);
          
          if (hasTeams) {
            const teams = [...new Set(finalParticipants.map(p => p.teamKey).filter(Boolean))] as string[];
            const teamRatings: Record<string, number> = {};
            const teamScores: Record<string, number> = {};
            const teamMembers: Record<string, typeof finalParticipants> = {};
            
            for (const t of teams) {
              const members = finalParticipants.filter(p => p.teamKey === t);
              teamMembers[t] = members;
              teamScores[t] = members.reduce((sum, m) => sum + m.score, 0) / members.length;
              
              let totalElo = 0;
              for (const m of members) {
                const sb = await tx.scoreboard.upsert({
                  where: { agentId: m.agentId },
                  update: {},
                  create: { agentId: m.agentId },
                });
                totalElo += sb.elo;
              }
              teamRatings[t] = totalElo / members.length;
            }
            
            const teamEloChanges: Record<string, number> = {};
            for (const t of teams) {
              teamEloChanges[t] = 0;
            }
            
            for (let i = 0; i < teams.length; i++) {
              const t1 = teams[i];
              for (let j = 0; j < teams.length; j++) {
                if (i === j) continue;
                const t2 = teams[j];
                
                let outcome: 1 | 0.5 | 0 = 0.5;
                if (teamScores[t1] > teamScores[t2]) outcome = 1;
                else if (teamScores[t1] < teamScores[t2]) outcome = 0;
                
                const eloCalc = calculateElo(Math.round(teamRatings[t1]), Math.round(teamRatings[t2]), outcome);
                teamEloChanges[t1] += (eloCalc.newRatingA - Math.round(teamRatings[t1]));
              }
            }
            
            for (const t of teams) {
              const avgChange = Math.round(teamEloChanges[t] / Math.max(1, teams.length - 1));
              const members = teamMembers[t];
              
              for (const m of members) {
                const isWin = teamScores[t] > Math.min(...teams.map(ot => ot !== t ? teamScores[ot] : Infinity));
                const isLoss = teamScores[t] < Math.max(...teams.map(ot => ot !== t ? teamScores[ot] : -Infinity));
                const isDraw = !isWin && !isLoss;
                
                await tx.scoreboard.update({
                  where: { agentId: m.agentId },
                  data: {
                    gamesPlayed: { increment: 1 },
                    wins: { increment: isWin ? 1 : 0 },
                    losses: { increment: isLoss ? 1 : 0 },
                    draws: { increment: isDraw ? 1 : 0 },
                    totalScore: { increment: m.score },
                    elo: { increment: avgChange },
                  },
                });
                await tx.agent.update({ where: { id: m.agentId }, data: { status: 'idle' } });
              }
            }
          } else {
            // ELO Calculation for N-players: Free-For-All comparison
            for (let i = 0; i < finalParticipants.length; i++) {
               const p1 = finalParticipants[i];
               let eloChange = 0;
               const sb1 = await tx.scoreboard.upsert({
                 where: { agentId: p1.agentId },
                 update: {},
                 create: { agentId: p1.agentId },
               });
               
               let wins = 0;
               let losses = 0;
               let draws = 0;

               for (let j = 0; j < finalParticipants.length; j++) {
                 if (i === j) continue;
                 const p2 = finalParticipants[j];
                 const sb2 = await tx.scoreboard.upsert({
                   where: { agentId: p2.agentId },
                   update: {},
                   create: { agentId: p2.agentId },
                 });

                 let outcome: 1 | 0.5 | 0 = 0.5;
                 if (p1.score > p2.score) { outcome = 1; wins++; }
                 else if (p1.score < p2.score) { outcome = 0; losses++; }
                 else { draws++; }

                 const eloCalc = calculateElo(sb1.elo, sb2.elo, outcome);
                 eloChange += (eloCalc.newRatingA - sb1.elo);
               }

               // Average the ELO change in N-player matches
               const finalEloChange = Math.round(eloChange / Math.max(1, finalParticipants.length - 1));

               await tx.scoreboard.update({
                 where: { agentId: p1.agentId },
                 data: {
                   gamesPlayed: { increment: 1 },
                   wins: { increment: wins > 0 && wins >= losses ? 1 : 0 },
                   losses: { increment: losses > wins ? 1 : 0 },
                   draws: { increment: draws > 0 && wins === 0 && losses === 0 ? 1 : 0 },
                   totalScore: { increment: p1.score },
                   elo: { increment: finalEloChange },
                 },
               });

               await tx.agent.update({ where: { id: p1.agentId }, data: { status: 'idle' } });
            }
          }

          const topScorer = finalParticipants.reduce((prev, curr) => (prev.score > curr.score) ? prev : curr);

          await tx.matchLog.create({
            data: {
              matchId,
              eventType: 'match_finished',
              message: `Match finished! Top Scorer: ${topScorer.agent.name} with ${topScorer.score} points. ELO updates complete.`,
            },
          });
        } else {
          // Next round
          const nextRoundNumber = currentRoundNumber + 1;
          await tx.match.update({
            where: { id: matchId },
            data: { currentRound: nextRoundNumber },
          });

          await tx.round.create({
            data: {
              matchId,
              roundNumber: nextRoundNumber,
              status: 'waiting_for_actions',
            },
          });

          await tx.matchLog.create({
            data: {
              matchId,
              eventType: 'round_started',
              message: `Round ${nextRoundNumber} started`,
            },
          });
        }
      }

      await refreshMatchIntegrityHashTx(tx, matchId);
      return { status: 'success', currentRound: match.currentRound };
    }
  });
}
