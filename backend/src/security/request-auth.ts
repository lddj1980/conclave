import type { Request } from 'express';
import prisma from '../db.js';
import { hashAgentToken, secureTokenEqual } from './agent-token.js';

function firstHeader(req: Request, names: string[]): string | null {
  for (const name of names) {
    const value = req.header(name);
    if (value && String(value).trim()) return String(value).trim();
  }
  return null;
}

export function extractBearerToken(req: Request): string | null {
  const authorization = firstHeader(req, ['authorization', 'Authorization']);
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function extractAgentToken(req: Request): string | null {
  return (
    extractBearerToken(req) ||
    firstHeader(req, ['x-agent-token', 'X-Agent-Token']) ||
    (req.body && typeof req.body === 'object' ? String(req.body.agentToken || '').trim() : null) ||
    (req.query && typeof req.query === 'object' ? String(req.query.agentToken || '').trim() : null)
  );
}

export async function resolveAgentFromToken(token: string) {
  if (!token) return null;
  const tokenHash = hashAgentToken(token);
  const agent = await prisma.agent.findFirst({
    where: {
      authTokenHash: tokenHash,
      OR: [{ authTokenExpiresAt: null }, { authTokenExpiresAt: { gt: new Date() } }],
    },
    select: {
      id: true,
      name: true,
      owner: true,
      isHuman: true,
      authTokenHash: true,
      authTokenExpiresAt: true,
    },
  });

  if (!agent || !agent.authTokenHash) return null;
  return secureTokenEqual(token, agent.authTokenHash) ? agent : null;
}

export function getAdminTokenFromEnv(): string {
  return String(process.env.CONCLAVE_ADMIN_API_TOKEN || process.env.ADMIN_API_TOKEN || '').trim();
}

export function requireAdminTokenConfigured(): string {
  const token = getAdminTokenFromEnv();
  if (!token) {
    throw new Error('Admin API token is not configured. Set CONCLAVE_ADMIN_API_TOKEN or ADMIN_API_TOKEN.');
  }
  return token;
}
