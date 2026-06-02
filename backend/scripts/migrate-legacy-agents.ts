import prisma from '../src/db.js';
import { createAgentToken, hashAgentToken, computeTokenExpiry } from '../src/security/agent-token.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const legacyAgents = await prisma.agent.findMany({
    where: {
      NOT: { owner: { in: ['HouseBot', 'System'] } },
      authPublicKeyPem: null,
    },
    select: { id: true, name: true, owner: true, authTokenHash: true },
    orderBy: { createdAt: 'asc' },
  });

  if (legacyAgents.length === 0) {
    console.log('No legacy non built-in agents found.');
    return;
  }

  const out: Array<{ id: string; name: string; owner: string; bootstrapToken: string; expiresAt: string }> = [];
  const now = new Date();
  const expiry = computeTokenExpiry(now, 15); // grace window for legacy bootstrap

  for (const a of legacyAgents) {
    const token = createAgentToken();
    await prisma.agent.update({
      where: { id: a.id },
      data: {
        authTokenHash: hashAgentToken(token),
        authTokenLastRotatedAt: now,
        authTokenExpiresAt: expiry,
      },
    });
    out.push({
      id: a.id,
      name: a.name,
      owner: a.owner,
      bootstrapToken: token,
      expiresAt: expiry.toISOString(),
    });
  }

  const outDir = process.env.CONCLAVE_BOOTSTRAP_EXPORT_DIR
    ? path.resolve(process.env.CONCLAVE_BOOTSTRAP_EXPORT_DIR)
    : path.join(os.tmpdir(), 'conclave', 'bootstrap-exports');
  await fs.mkdir(outDir, { recursive: true });

  const outPath = path.join(
    outDir,
    `legacy-agent-bootstrap-tokens-${now.toISOString().replace(/[:.]/g, '-')}.json`
  );
  await fs.writeFile(outPath, JSON.stringify({ generatedAt: now.toISOString(), agents: out }, null, 2), 'utf8');

  console.log(`Migrated ${out.length} legacy agents.`);
  console.log(`Bootstrap tokens written outside the repo to: ${outPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
