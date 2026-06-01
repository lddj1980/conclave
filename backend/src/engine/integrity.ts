import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export async function computeMatchIntegrityHashTx(tx: Prisma.TransactionClient, matchId: string): Promise<string> {
  const match = await tx.match.findUnique({
    where: { id: matchId },
    include: {
      participants: {
        include: { agent: true },
      },
      rounds: {
        include: {
          actions: true,
        },
      },
      logs: true,
    },
  });

  if (!match) {
    throw new Error(`Match ${matchId} not found for integrity hash computation.`);
  }

  const canonicalPayload = {
    match: {
      id: match.id,
      gameType: match.gameType,
      matchSeed: match.matchSeed,
      engineVersion: match.engineVersion,
      rulesVersion: match.rulesVersion,
      status: match.status,
      maxPlayers: match.maxPlayers,
      currentRound: match.currentRound,
      totalRounds: match.totalRounds,
      startedAt: match.startedAt?.toISOString() || null,
      finishedAt: match.finishedAt?.toISOString() || null,
    },
    participants: [...match.participants]
      .sort((a, b) => (a.role || '').localeCompare(b.role || ''))
      .map((p) => ({
        agentId: p.agentId,
        role: p.role,
        score: p.score,
        status: p.status,
        agentVersion: p.agentVersion || null,
        agentName: p.agent.name,
      })),
    rounds: [...match.rounds]
      .sort((a, b) => a.roundNumber - b.roundNumber)
      .map((r) => ({
        roundNumber: r.roundNumber,
        status: r.status,
        payload: r.payload || null,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() || null,
        actions: [...r.actions]
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.agentId.localeCompare(b.agentId))
          .map((a) => ({
            agentId: a.agentId,
            actionType: a.actionType,
            payload: a.payload || null,
            visibility: a.visibility,
            targetAgent: a.targetAgent || null,
            valid: a.valid,
            createdAt: a.createdAt.toISOString(),
          })),
      })),
    logs: [...match.logs]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((l) => ({
        visibility: l.visibility,
        eventType: l.eventType,
        message: l.message,
        payload: l.payload || null,
        createdAt: l.createdAt.toISOString(),
      })),
  };

  return sha256(JSON.stringify(canonicalPayload));
}

export async function refreshMatchIntegrityHashTx(tx: Prisma.TransactionClient, matchId: string): Promise<string> {
  const integrityHash = await computeMatchIntegrityHashTx(tx, matchId);
  await tx.match.update({
    where: { id: matchId },
    data: {
      integrityHash,
      integrityUpdatedAt: new Date(),
    },
  });
  return integrityHash;
}
