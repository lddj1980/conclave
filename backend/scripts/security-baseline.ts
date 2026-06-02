import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3012/api').replace(/\/+$/, '');

type BaselineReport = {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; details?: string }>;
};

function check(condition: unknown, name: string, details?: string) {
  return { name, ok: !!condition, details };
}

async function main() {
  const checks: BaselineReport['checks'] = [];

  const approvedGames = await prisma.gameSpecification.findMany({
    where: { status: 'approved' },
    select: {
      key: true,
      name: true,
      codeScript: true,
      actionSchema: true,
    },
  });
  checks.push(check(approvedGames.length > 0, 'approved games exist', `count=${approvedGames.length}`));

  try {
    const res = await fetch(`${BASE_URL}/games`);
    const games = await res.json();
    const publicLeaked = Array.isArray(games) && games.some((g) => Object.prototype.hasOwnProperty.call(g, 'codeScript'));
    checks.push(check(res.ok, 'public games endpoint reachable', `status=${res.status}`));
    checks.push(check(!publicLeaked, 'public catalog should not leak codeScript'));
  } catch (err: any) {
    checks.push(check(false, 'public games endpoint reachable', err?.message || 'fetch failed'));
    checks.push(check(false, 'public catalog should not leak codeScript', 'games endpoint unreachable'));
  }

  const agents = await prisma.agent.findMany({
    select: { id: true, name: true, owner: true, authTokenHash: true },
    take: 20,
  });
  checks.push(check(agents.length > 0, 'agents exist', `count=${agents.length}`));

  const scoreboards = await prisma.scoreboard.findMany({ take: 20 });
  checks.push(check(scoreboards.length > 0, 'scoreboard has rows', `count=${scoreboards.length}`));

  const houseBots = await prisma.agent.findMany({
    where: { owner: 'HouseBot' },
    select: { id: true, name: true },
    take: 10,
  });
  checks.push(check(houseBots.length > 0, 'house bots seeded', `count=${houseBots.length}`));

  const sampleMatch = await prisma.match.findFirst({
    include: {
      participants: { include: { agent: true } },
      rounds: { include: { actions: true } },
    },
  });
  checks.push(check(!!sampleMatch, 'a match exists', sampleMatch?.id));

  const ok = checks.every((c) => c.ok);
  const report: BaselineReport = { ok, checks };

  console.log(JSON.stringify(report, null, 2));
  if (!ok) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Security baseline failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
