import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const dump = {
    exportedAt: new Date().toISOString(),
    agents: await prisma.agent.findMany(),
    agentProfiles: await prisma.agentProfile.findMany(),
    scoreboards: await prisma.scoreboard.findMany(),
    gameSpecifications: await prisma.gameSpecification.findMany(),
    seasons: await prisma.season.findMany(),
    matches: await prisma.match.findMany(),
    matchParticipants: await prisma.matchParticipant.findMany(),
    rounds: await prisma.round.findMany(),
    actions: await prisma.action.findMany(),
    matchLogs: await prisma.matchLog.findMany(),
    agentPerformanceSnapshots: await prisma.agentPerformanceSnapshot.findMany(),
  };

  const outputPath = path.resolve(process.cwd(), 'prisma', 'sqlite-export.json');
  await fs.writeFile(outputPath, JSON.stringify(dump, null, 2), 'utf8');
  console.log(`SQLite export written to ${outputPath}`);
}

main()
  .catch((err) => {
    console.error('Export failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
