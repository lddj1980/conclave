import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Dump = {
  agents: any[];
  agentProfiles: any[];
  scoreboards: any[];
  gameSpecifications: any[];
  seasons: any[];
  matches: any[];
  matchParticipants: any[];
  rounds: any[];
  actions: any[];
  matchLogs: any[];
  agentPerformanceSnapshots: any[];
};

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(value);
}

async function main() {
  const inputPath = path.resolve(process.cwd(), 'prisma', 'sqlite-export.json');
  const raw = await fs.readFile(inputPath, 'utf8');
  const dump = JSON.parse(raw) as Dump;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('TRUNCATE TABLE "AgentPerformanceSnapshot", "Action", "Round", "MatchLog", "MatchParticipant", "Match", "AgentProfile", "Scoreboard", "GameSpecification", "Season", "Agent" RESTART IDENTITY CASCADE;');

    if (dump.agents.length) {
      await tx.agent.createMany({ data: dump.agents, skipDuplicates: true });
    }
    if (dump.agentProfiles.length) {
      await tx.agentProfile.createMany({
        data: dump.agentProfiles.map((row) => ({
          ...row,
          updatedAt: toDate(row.updatedAt),
        })),
        skipDuplicates: true,
      });
    }
    if (dump.scoreboards.length) {
      await tx.scoreboard.createMany({
        data: dump.scoreboards.map((row) => ({
          ...row,
          updatedAt: toDate(row.updatedAt),
        })),
        skipDuplicates: true,
      });
    }
    if (dump.gameSpecifications.length) {
      await tx.gameSpecification.createMany({
        data: dump.gameSpecifications.map((row) => ({
          ...row,
          createdAt: toDate(row.createdAt),
        })),
        skipDuplicates: true,
      });
    }
    if (dump.seasons.length) {
      await tx.season.createMany({
        data: dump.seasons.map((row) => ({
          ...row,
          startedAt: toDate(row.startedAt),
          endedAt: toDate(row.endedAt),
          createdAt: toDate(row.createdAt),
        })),
        skipDuplicates: true,
      });
    }
    if (dump.matches.length) {
      await tx.match.createMany({
        data: dump.matches.map((row) => ({
          ...row,
          integrityUpdatedAt: toDate(row.integrityUpdatedAt),
          createdAt: toDate(row.createdAt),
          startedAt: toDate(row.startedAt),
          finishedAt: toDate(row.finishedAt),
        })),
        skipDuplicates: true,
      });
    }
    if (dump.matchParticipants.length) {
      await tx.matchParticipant.createMany({
        data: dump.matchParticipants.map((row) => ({
          ...row,
          joinedAt: toDate(row.joinedAt),
        })),
        skipDuplicates: true,
      });
    }
    if (dump.rounds.length) {
      await tx.round.createMany({
        data: dump.rounds.map((row) => ({
          ...row,
          startedAt: toDate(row.startedAt),
          finishedAt: toDate(row.finishedAt),
        })),
        skipDuplicates: true,
      });
    }
    if (dump.actions.length) {
      await tx.action.createMany({
        data: dump.actions.map((row) => ({
          ...row,
          createdAt: toDate(row.createdAt),
        })),
        skipDuplicates: true,
      });
    }
    if (dump.matchLogs.length) {
      await tx.matchLog.createMany({
        data: dump.matchLogs.map((row) => ({
          ...row,
          createdAt: toDate(row.createdAt),
        })),
        skipDuplicates: true,
      });
    }
    if (dump.agentPerformanceSnapshots.length) {
      await tx.agentPerformanceSnapshot.createMany({
        data: dump.agentPerformanceSnapshots.map((row) => ({
          ...row,
          snapshotDate: toDate(row.snapshotDate),
          createdAt: toDate(row.createdAt),
        })),
        skipDuplicates: true,
      });
    }
  });

  console.log('Data import to PostgreSQL completed successfully.');
}

main()
  .catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
