import { Router, Request, Response } from 'express';
import prisma from '../db.js';
import { submitAgentAction } from '../engine/match-resolver.js';
import { computeMatchIntegrityHashTx, refreshMatchIntegrityHashTx } from '../engine/integrity.js';
import {
  createDailySnapshots,
  ensureActiveSeason,
  getSeasonLeaderboard,
  getWeeklyBadges,
  getWeeklyLeaderboard,
  getWeeklyLeaderboardWithChangelog,
  getPublicAgentProfile,
  getTrustScoreForAgent,
  getSeasonManifest,
} from '../engine/season-analytics.js';
import { createSandbox } from '../engine/sandbox.js';
import { createAgentToken, hashAgentToken, computeTokenExpiry, verifyEd25519Signature } from '../security/agent-token.js';
import { securityConfig } from '../config/security.js';
import { extractAgentToken, resolveAgentFromToken, requireAdminTokenConfigured } from '../security/request-auth.js';
import { validateGameProposal } from '../engine/proposal-validation.js';
import { createGameProposal } from '../engine/proposal-service.js';
import { runOfficialBenchmark } from '../engine/official-benchmark.js';
import { rateLimiter } from '../middleware/rate-limiter.js';
import { submitPrediction } from '../engine/worldcup-prediction.js';


const router = Router();
const sensitiveLimiter = rateLimiter(60, 60000);
const authLimiter = rateLimiter(30, 60000);

function isAuthEnforced(): boolean {
  return !!securityConfig.secureAuthEnforced;
}

function isAdminEnforced(): boolean {
  return !!securityConfig.secureAdminEnforced;
}

function unauthorized(message = 'Authentication required') {
  return { error: message, status: 401 as const };
}

function forbidden(message = 'Forbidden') {
  return { error: message, status: 403 as const };
}

async function requireAgentIdentity(req: Request) {
  const token = extractAgentToken(req);
  if (!token) {
    return { agent: null, error: unauthorized('agentToken is required for this action') };
  }
  const agent = await resolveAgentFromToken(token);
  if (!agent) {
    return { agent: null, error: unauthorized('Invalid or expired agentToken') };
  }
  return { agent, token, error: undefined };
}

function requireAdminAccess(req: Request) {
  if (!isAdminEnforced()) return { ok: true as const, actor: String(req.body?.actor || 'admin') };
  const bearer = extractAgentToken(req) || '';
  let configuredToken = '';
  try {
    configuredToken = requireAdminTokenConfigured();
  } catch (err: any) {
    return { ok: false as const, ...forbidden(err?.message || 'Admin API token is not configured') };
  }
  if (bearer !== configuredToken) {
    return { ok: false as const, ...forbidden('Admin token required') };
  }
  return { ok: true as const, actor: String(req.body?.actor || 'admin') };
}

function sanitizeAgentForPublicView(agent: any, viewerAgentId?: string | null) {
  if (!agent) return agent;
  const {
    authTokenHash,
    authTokenExpiresAt,
    authTokenLastRotatedAt,
    authTokenLastUsedAt,
    authKeyAlgorithm,
    authPublicKeyPem,
    recoverySeed,
    ...rest
  } = agent as any;

  const inventory =
    viewerAgentId && viewerAgentId === agent.id && Array.isArray(agent.inventory)
      ? agent.inventory
      : [];

  return {
    ...rest,
    inventory,
  };
}

function sanitizeMatchForPublicView(match: any, viewerAgentId?: string | null) {
  if (!match) return match;
  return {
    ...match,
    participants: Array.isArray(match.participants)
      ? match.participants.map((participant: any) => ({
          ...participant,
          agent: sanitizeAgentForPublicView(participant.agent, viewerAgentId),
        }))
      : [],
    contracts: [],
  };
}

// Agents
router.get('/agents', async (req: Request, res: Response) => {
  try {
    const gameType = req.query.gameType ? String(req.query.gameType) : undefined;
    const agents = await prisma.agent.findMany({
      where: gameType
        ? {
            subscriptions: {
              some: {
                gameKey: gameType,
              },
            },
          }
        : undefined,
      include: {
        scoreboard: true,
        profile: true,
        subscriptions: true,
      },
    });
    res.json(agents);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agents', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { name, owner, description, subscriptions, mcpClientName } = req.body;
    const isHumanRaw = req.body?.isHuman;
    const isHuman =
      isHumanRaw === true ||
      isHumanRaw === 1 ||
      isHumanRaw === '1' ||
      (typeof isHumanRaw === 'string' && isHumanRaw.toLowerCase() === 'true');
    if (!name || !owner) {
      return res.status(400).json({ error: 'Name and Owner are required' });
    }

    const agent = await prisma.$transaction(async (tx) => {
      const plainToken = createAgentToken();
      const created = await tx.agent.create({
        data: {
          name,
          owner,
          isHuman,
          description,
          mcpClientName: String(mcpClientName || '').trim() || null,
          scoreboard: {
            create: {},
          },
        },
        include: { scoreboard: true },
      });
      await tx.agent.update({
        where: { id: created.id },
        data: {
          authTokenHash: hashAgentToken(plainToken),
          authTokenLastRotatedAt: new Date(),
          authTokenExpiresAt: computeTokenExpiry(),
        },
      });

      if (Array.isArray(subscriptions) && subscriptions.length > 0) {
        const uniqueGames = [...new Set(subscriptions.map((g: any) => String(g).trim()).filter(Boolean))];
        if (uniqueGames.length > 0) {
          await tx.agentGameSubscription.createMany({
            data: uniqueGames.map((gameKey) => ({
              agentId: created.id,
              gameKey,
            })),
            skipDuplicates: true,
          });
        }
      }

      return { created, plainToken };
    });
    res.status(201).json({ ...agent.created, agentToken: agent.plainToken });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/agents/:id/token/rotate', authLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (isAuthEnforced()) {
      const token = extractAgentToken(req);
      const tokenAgent = token ? await resolveAgentFromToken(token) : null;
      const challengeNonce = String(req.body?.challengeNonce || '').trim();
      const signatureBase64 = String(req.body?.signatureBase64 || '').trim();
      const currentTokenOk = !!tokenAgent && tokenAgent.id === agent.id;
      const signatureOk =
        !!agent.authPublicKeyPem &&
        !!challengeNonce &&
        !!signatureBase64 &&
        verifyEd25519Signature(`${agent.id}:${challengeNonce}`, signatureBase64, agent.authPublicKeyPem);

      if (!currentTokenOk && !signatureOk) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'Provide the current agentToken or a valid Ed25519 challenge signature to rotate this token.',
        });
      }
    }

    const token = createAgentToken();
    await prisma.agent.update({
      where: { id },
      data: {
        authTokenHash: hashAgentToken(token),
        authTokenLastRotatedAt: new Date(),
        authTokenExpiresAt: computeTokenExpiry(),
      },
    });

    res.json({ agentId: id, agentName: agent.name, agentToken: token });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/agents/:id/subscriptions', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (isAuthEnforced()) {
      const authResult = await requireAgentIdentity(req);
      if (authResult.error) {
        return res.status(authResult.error.status).json({ error: authResult.error.error });
      }
      if (authResult.agent?.id !== id) {
        return res.status(403).json({ error: 'Authenticated agent does not match target agent' });
      }
    }
    const gameKeysRaw = req.body?.gameKeys ?? req.body?.gameKey;
    const gameKeys = Array.isArray(gameKeysRaw) ? gameKeysRaw : [gameKeysRaw];
    const normalized = [...new Set(gameKeys.map((g: any) => String(g || '').trim()).filter(Boolean))];

    if (normalized.length === 0) {
      return res.status(400).json({ error: 'gameKey or gameKeys is required' });
    }

    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await prisma.agentGameSubscription.createMany({
      data: normalized.map((gameKey) => ({
        agentId: id,
        gameKey,
      })),
      skipDuplicates: true,
    });

    const updated = await prisma.agent.findUnique({
      where: { id },
      include: { subscriptions: true },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/agents/:id/profile', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (isAuthEnforced()) {
      const authResult = await requireAgentIdentity(req);
      if (authResult.error) {
        return res.status(authResult.error.status).json({ error: authResult.error.error });
      }
      if (authResult.agent?.id !== id) {
        return res.status(403).json({ error: 'Authenticated agent does not match target agent' });
      }
    }
    const { mood, achievements, pride, customBio } = req.body;
    const profile = await prisma.agentProfile.upsert({
      where: { agentId: id },
      update: { mood, achievements, pride, customBio },
      create: { agentId: id, mood, achievements, pride, customBio },
    });
    res.json(profile);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agents/:id/deactivate', authLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (isAuthEnforced()) {
      const authResult = await requireAgentIdentity(req);
      if (authResult.error) {
        return res.status(authResult.error.status).json({ error: authResult.error.error });
      }
      if (authResult.agent?.id !== id) {
        return res.status(403).json({ error: 'Authenticated agent does not match target agent' });
      }
    }

    await prisma.agent.update({
      where: { id },
      data: {
        status: 'offline',
        authTokenExpiresAt: new Date(0),
      },
    });

    res.json({ ok: true, agentId: id, agentName: agent.name, status: 'offline' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Matches
router.get('/matches', async (req: Request, res: Response) => {
  try {
    const matches = await prisma.match.findMany({
      include: {
        participants: {
          include: { agent: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(matches.map((match) => sanitizeMatchForPublicView(match)));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/matches/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        participants: {
          include: {
            agent: {
              include: { inventory: true }
            }
          },
        },
        rounds: {
          include: {
            actions: {
              include: { agent: true },
            },
          },
          orderBy: { roundNumber: 'asc' },
        },
        logs: {
          orderBy: { createdAt: 'asc' },
        },
        contracts: true,
      },
    });

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const token = extractAgentToken(req);
    const tokenAgent = token ? await resolveAgentFromToken(token) : null;
    const queryAgentId = req.query.agentId ? String(req.query.agentId) : undefined;
    const agentId = tokenAgent?.id || (!isAuthEnforced() ? queryAgentId : undefined);
    const gameSpec = await prisma.gameSpecification.findUnique({
      where: { key: match.gameType },
    });

    if (agentId && gameSpec && gameSpec.codeScript) {
      try {
        const sandbox = createSandbox(gameSpec.codeScript);
        for (const r of match.rounds) {
          if (r.payload) {
            const fullState = JSON.parse(r.payload);
            const filteredState = sandbox.serializeStateForPlayer(fullState, agentId);
            r.payload = JSON.stringify(filteredState);
          }
        }
      } catch (e) {
        // Fallback to original payload if filtering fails
      }
    }

    let gameSpecForClient: any = null;
    if (gameSpec) {
      const { codeScript, actionSchema, ...rest } = gameSpec as any;
      gameSpecForClient = rest;
    }

    const publicMatch = {
      ...match,
      participants: match.participants.map((p) => ({
        ...p,
        agent: sanitizeAgentForPublicView(p.agent, agentId),
      })),
      rounds: match.rounds.map((r) => ({
        ...r,
        payload:
          agentId && gameSpec && gameSpec.codeScript
            ? r.payload
            : gameSpec?.key === 'geopolitical_crisis'
              ? r.payload
            : gameSpec?.infoType === 'perfect'
              ? r.payload
              : null,
        actions: r.actions.map((a) => ({
          ...a,
          payload: a.visibility === 'private' && agentId !== a.agentId ? null : a.payload,
          targetAgent: a.visibility === 'private' && agentId !== a.agentId ? null : a.targetAgent,
        })),
      })),
      gameSpec: gameSpecForClient,
      contracts: agentId ? match.contracts : [],
    };

    res.json(publicMatch);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/matches', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { createdBy, totalRounds, gameType, matchSeed, engineVersion, rulesVersion } = req.body;
    const gType = gameType || 'prisoners_dilemma';
    const gameSpec = await prisma.gameSpecification.findUnique({
      where: { key: String(gType) },
    });
    const roundsCountRaw = parseInt(totalRounds);
    const roundsCount = Number.isFinite(roundsCountRaw)
      ? roundsCountRaw
      : (gameSpec ? gameSpec.totalRounds : 10);
    const maxPlayers = gameSpec ? gameSpec.maxPlayers : 2;

    const match = await prisma.$transaction(async (tx) => {
      const created = await tx.match.create({
        data: {
          createdBy: createdBy || 'System',
          totalRounds: roundsCount,
          gameType: gType,
          maxPlayers,
          matchSeed: String(matchSeed || `${gType}-${Date.now()}`),
          engineVersion: String(engineVersion || 'engine-v1'),
          rulesVersion: String(rulesVersion || `${gType}-rules-v1`),
          status: 'waiting_for_players',
        },
      });
      await refreshMatchIntegrityHashTx(tx, created.id);
      return created;
    });

    res.status(201).json(match);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/matches/:id/join', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { agentId, agentVersion } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'AgentId is required' });
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (agent.status === 'offline') {
      return res.status(400).json({ error: 'Agent is deactivated' });
    }

    if (isAuthEnforced() && agent.owner !== 'HouseBot') {
      const authResult = await requireAgentIdentity(req);
      if (authResult.error) {
        return res.status(authResult.error.status).json({ error: authResult.error.error });
      }
      if (authResult.agent?.id !== agentId) {
        return res.status(403).json({ error: 'Authenticated agent does not match join request' });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id },
        include: { participants: true },
      });

      if (!match) {
        throw new Error('Match not found');
      }

      if (match.status !== 'waiting_for_players') {
        throw new Error('Match is not accepting players');
      }

      if (match.participants.length >= match.maxPlayers) {
        throw new Error('Match is full');
      }

      const role = `player_${match.participants.length + 1}`;

      const participant = await tx.matchParticipant.create({
        data: {
          matchId: id,
          agentId,
          agentVersion: agentVersion ? String(agentVersion) : null,
          role,
        },
      });

      await tx.agent.update({
        where: { id: agentId },
        data: { status: 'in_match' },
      });

      await tx.matchLog.create({
        data: {
          matchId: id,
          eventType: 'agent_joined',
          message: `Agent '${agent.name}' joined the match as ${role}`,
          payload: JSON.stringify({ agentId, role }),
        },
      });

      let updatedStatus = match.status;
      if (match.participants.length + 1 === match.maxPlayers) {
        updatedStatus = 'ready';
        await tx.match.update({
          where: { id },
          data: { status: 'ready' },
        });
      }

      await refreshMatchIntegrityHashTx(tx, id);

      return { participant, matchStatus: updatedStatus };
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/matches/:id/start', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const matchForAuth = isAuthEnforced()
      ? await prisma.match.findUnique({
          where: { id },
          include: { participants: { include: { agent: true } } },
        })
      : null;
    if (isAuthEnforced() && !matchForAuth) {
      return res.status(404).json({ error: 'Match not found' });
    }
    if (isAuthEnforced() && matchForAuth) {
      const hasHouseBotsOnly = matchForAuth.participants.every((p) => p.agent.owner === 'HouseBot');
      if (!hasHouseBotsOnly) {
        const authResult = await requireAgentIdentity(req);
        if (authResult.error) {
          return res.status(authResult.error.status).json({ error: authResult.error.error });
        }
        const isParticipant = matchForAuth.participants.some((p) => p.agentId === authResult.agent?.id);
        if (!isParticipant) {
          return res.status(403).json({ error: 'Authenticated agent is not a participant in this match' });
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id },
        include: { participants: true },
      });

      if (!match) {
        throw new Error('Match not found');
      }

      if (match.status !== 'ready' && match.status !== 'waiting_for_players') {
        throw new Error('Match cannot be started (status: ' + match.status + ')');
      }

      if (match.participants.length < match.maxPlayers) {
        throw new Error(`Need ${match.maxPlayers} players to start`);
      }

      const updated = await tx.match.update({
        where: { id },
        data: {
          status: 'in_progress',
          currentRound: 1,
          startedAt: new Date(),
        },
      });

      // For sequential board games (like Tic-Tac-Toe), initialize payload board state in Round 1
      const initialPayload = match.gameType === 'tic_tac_toe' 
        ? JSON.stringify(Array(9).fill('')) 
        : null;

      await tx.round.create({
        data: {
          matchId: id,
          roundNumber: 1,
          status: 'waiting_for_actions',
          payload: initialPayload,
        },
      });

      const p1 = match.participants.find(p => p.role === 'player_1')!;
      await tx.matchLog.create({
        data: {
          matchId: id,
          eventType: 'match_started',
          message: match.gameType === 'tic_tac_toe'
            ? `Match started! Turn for ${p1.agentId} (X)`
            : 'Match started! Round 1 is active.',
        },
      });

      await refreshMatchIntegrityHashTx(tx, id);
      return updated;
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/matches/:id/verify', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id },
        select: {
          id: true,
          integrityHash: true,
          integrityUpdatedAt: true,
        },
      });

      if (!match) {
        throw new Error('Match not found');
      }

      const computedHash = await computeMatchIntegrityHashTx(tx, id);
      const isValid = match.integrityHash === computedHash;

      return {
        matchId: id,
        storedHash: match.integrityHash,
        computedHash,
        isValid,
        integrityUpdatedAt: match.integrityUpdatedAt,
      };
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/matches/:id/actions', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { agentId, action, payload } = req.body;
    const authResult = isAuthEnforced() ? await requireAgentIdentity(req) : null;

    if (authResult && authResult.error) {
      return res.status(authResult.error.status).json({ error: authResult.error.error });
    }

    const effectiveAgentId = authResult?.agent?.id || agentId;
    if (!effectiveAgentId || action === undefined) {
      return res.status(400).json({ error: 'AgentId and action are required' });
    }

    if (authResult?.agent && agentId && agentId !== authResult.agent.id) {
      console.warn(`Ignoring mismatched agentId in authenticated action request. Requested=${agentId} Authenticated=${authResult.agent.id}`);
    }

    const result = await submitAgentAction(id, effectiveAgentId, String(action), payload);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Scoreboard
router.get('/scoreboard', async (req: Request, res: Response) => {
  try {
    const scoreboard = await prisma.scoreboard.findMany({
      include: { agent: true },
      orderBy: { elo: 'desc' },
    });
    res.json(scoreboard);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/scoreboard/game/:gameKey', async (req: Request, res: Response) => {
  try {
    const { gameKey } = req.params;
    const limit = req.query.limit ? Math.max(1, Math.min(200, Number(req.query.limit))) : 50;

    const matches = await prisma.match.findMany({
      where: { gameType: String(gameKey), status: 'finished' },
      include: {
        participants: {
          include: {
            agent: {
              include: { scoreboard: true, profile: true },
            },
          },
        },
      },
      orderBy: { finishedAt: 'desc' },
      take: 500,
    });

    const byAgent = new Map<string, any>();
    for (const m of matches) {
      const maxScore = m.participants.reduce((acc, p) => Math.max(acc, p.score), Number.NEGATIVE_INFINITY);
      const winners = new Set(m.participants.filter((p) => p.score === maxScore).map((p) => p.agentId));
      const isDraw = winners.size > 1;
      for (const p of m.participants) {
        const existing = byAgent.get(p.agentId) || {
          agentId: p.agentId,
          name: p.agent.name,
          owner: p.agent.owner,
          elo: p.agent.scoreboard?.elo ?? 1000,
          gamesPlayedInGame: 0,
          winsInGame: 0,
          lossesInGame: 0,
          drawsInGame: 0,
          totalScoreInGame: 0,
        };
        existing.gamesPlayedInGame += 1;
        existing.totalScoreInGame += p.score;
        if (isDraw && winners.has(p.agentId)) existing.drawsInGame += 1;
        else if (!isDraw && winners.has(p.agentId)) existing.winsInGame += 1;
        else existing.lossesInGame += 1;
        byAgent.set(p.agentId, existing);
      }
    }

    const rows = Array.from(byAgent.values())
      .map((r) => ({
        ...r,
        winRateInGame: r.gamesPlayedInGame > 0 ? Number((r.winsInGame / r.gamesPlayedInGame).toFixed(4)) : 0,
        avgScoreInGame: r.gamesPlayedInGame > 0 ? Number((r.totalScoreInGame / r.gamesPlayedInGame).toFixed(3)) : 0,
      }))
      .sort((a, b) =>
        b.winsInGame - a.winsInGame ||
        b.winRateInGame - a.winRateInGame ||
        b.elo - a.elo ||
        b.gamesPlayedInGame - a.gamesPlayedInGame
      )
      .slice(0, limit)
      .map((r, i) => ({ rank: i + 1, ...r }));

    res.json({
      gameKey: String(gameKey),
      basedOnFinishedMatches: matches.length,
      leaderboard: rows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/seasons/active', async (_req: Request, res: Response) => {
  try {
    const season = await ensureActiveSeason();
    res.status(201).json(season);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/seasons/season-1/manifest', async (_req: Request, res: Response) => {
  res.json(getSeasonManifest());
});

router.post('/analytics/snapshots/daily', async (req: Request, res: Response) => {
  try {
    const date = req.body?.date ? new Date(req.body.date) : undefined;
    const result = await createDailySnapshots(date);
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/analytics/snapshots', async (req: Request, res: Response) => {
  try {
    const seasonKey = req.query.seasonKey ? String(req.query.seasonKey) : undefined;
    const date = req.query.date ? new Date(String(req.query.date)) : undefined;

    const season = seasonKey
      ? await prisma.season.findUnique({ where: { key: seasonKey } })
      : await prisma.season.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } });

    if (!season) return res.json([]);

    const where: any = { seasonId: season.id };
    if (date && !Number.isNaN(date.getTime())) {
      date.setUTCHours(0, 0, 0, 0);
      where.snapshotDate = date;
    }

    const snapshots = await prisma.agentPerformanceSnapshot.findMany({
      where,
      include: { agent: true, season: true },
      orderBy: [{ snapshotDate: 'desc' }, { elo: 'desc' }],
    });

    res.json(snapshots);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/analytics/leaderboard', async (req: Request, res: Response) => {
  try {
    const seasonKey = req.query.seasonKey ? String(req.query.seasonKey) : undefined;
    const result = await getSeasonLeaderboard(seasonKey);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/community/leaderboard/weekly', async (req: Request, res: Response) => {
  try {
    const seasonKey = req.query.seasonKey ? String(req.query.seasonKey) : undefined;
    const result = await getWeeklyLeaderboard(seasonKey);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/community/leaderboard/weekly-changelog', async (req: Request, res: Response) => {
  try {
    const seasonKey = req.query.seasonKey ? String(req.query.seasonKey) : undefined;
    const result = await getWeeklyLeaderboardWithChangelog(seasonKey);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/community/badges/weekly', async (req: Request, res: Response) => {
  try {
    const seasonKey = req.query.seasonKey ? String(req.query.seasonKey) : undefined;
    const result = await getWeeklyBadges(seasonKey);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/community/agents/:id/public-profile', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await getPublicAgentProfile(id);
    res.json(result);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

router.get('/community/agents/:id/trust-score', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const seasonKey = req.query.seasonKey ? String(req.query.seasonKey) : undefined;
    const result = await getTrustScoreForAgent(id, seasonKey);
    res.json(result);
  } catch (error: any) {
    res.json({
      agentId: req.params.id,
      trustScore: null,
      status: 'unavailable_yet',
      reason: error?.message || 'No trust data yet',
    });
  }
});

router.get('/community/rating-methodology', async (_req: Request, res: Response) => {
  res.json({
    version: 'v1',
    transparencyLevel: 'partial',
    conclaveRating: {
      formula:
        'conclaveRating = elo*0.65 + stabilityScore*2.2 + crossGameScore*1.5 - exploitRiskScore*1.4 - suspicionFlags*20',
      notes: [
        'Weights are public for credibility.',
        'Detection thresholds and anti-gaming heuristics are intentionally partial.',
      ],
    },
    trustScore: {
      range: '0..100',
      formula:
        'trustScore = clamp(stabilityScore*0.45 + crossGameScore*0.35 + (100-exploitRiskScore)*0.2 - suspicionFlags*8)',
      notes: [
        'Higher is better.',
        'Suspicion flags heavily reduce trust.',
      ],
    },
  });
});

// ----------------------------------------------------
// DYNAMIC GAME FRAMEWORK & PROPOSALS API
// ----------------------------------------------------

router.get('/games', async (req: Request, res: Response) => {
  try {
    const games = await prisma.gameSpecification.findMany({
      where: { status: 'approved' },
    });
    res.json(
      games.map((g) => {
        const { codeScript, actionSchema, ...rest } = g as any;
        return rest;
      })
    );
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/proposals', async (req: Request, res: Response) => {
  try {
    const proposals = await prisma.gameSpecification.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(
      proposals.map((g) => {
        const { codeScript, actionSchema, ...rest } = g as any;
        return rest;
      })
    );
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/proposals', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const validation = validateGameProposal(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: 'Proposal validation failed', details: validation.errors, warnings: validation.warnings });
    }
    const result = await createGameProposal(req.body);
    res.status(201).json(result.proposal);
  } catch (error: any) {
    const details = Array.isArray(error?.details) ? error.details : undefined;
    if (error?.message === 'Proposal validation failed') {
      return res.status(400).json({ error: error.message, details, warnings: Array.isArray(error?.warnings) ? error.warnings : [] });
    }
    if (error?.code === 'FAST_TRACK_DISABLED_FOR_SCRIPT') {
      return res.status(400).json({
        error: 'Script-bearing proposals must go through trial before approval',
        message: 'Fast-track is disabled for proposals that include codeScript.',
      });
    }
    res.status(400).json({ error: error.message });
  }
});

router.post('/proposals/validate', sensitiveLimiter, async (req: Request, res: Response) => {
  const validation = validateGameProposal(req.body || {});
  if (!validation.ok) {
    return res.status(400).json(validation);
  }
  res.json(validation);
});

router.get('/benchmarks/official/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const includeHidden = String(req.query.includeHidden || '').toLowerCase() === 'true';
    const result = await runOfficialBenchmark(agentId, includeHidden);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/benchmarks/official/:agentId/certify', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const result = await runOfficialBenchmark(agentId, true);
    const b = result.benchmark;
    const labels: string[] = [];
    if (b.finalScore >= 60) labels.push('Verified');
    if (b.finalScore >= 75) labels.push('Stable');
    if ((b.summary?.diversity || 0) >= 3) labels.push('Generalist');
    const seal = b.finalScore >= 85 ? 'Verified Strong' : b.finalScore >= 60 ? 'Verified' : 'Needs Improvement';

    const cert = await prisma.agentCertification.create({
      data: {
        agentId,
        suite: 'official-v1',
        finalScore: b.finalScore,
        visibleScore: b.visibleScore,
        hiddenScore: b.hiddenScore ?? null,
        seal,
        labels: JSON.stringify(labels),
        details: JSON.stringify({ scenarios: b.scenarios, hiddenIncluded: true }),
      },
    });

    res.json({ certification: cert, labels, benchmark: b });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/benchmarks/certifications/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const certs = await prisma.agentCertification.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json(certs);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/proposals/:id/approve', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminAccess = requireAdminAccess(req);
    if (!adminAccess.ok) return res.status(adminAccess.status).json({ error: adminAccess.error });
    const actor = String(req.body?.actor || adminAccess.actor || 'admin');
    const proposal = await prisma.$transaction(async (tx) => {
      const current = await tx.gameSpecification.findUnique({ where: { id } });
      if (!current) {
        throw new Error('Proposal not found');
      }
      if (current.codeScript && current.status !== 'trial_active') {
        throw new Error('Script-bearing proposals must complete trial before approval');
      }
      const updated = await tx.gameSpecification.update({
        where: { id },
        data: { status: 'approved' },
      });
      await tx.proposalAuditLog.create({
        data: {
          proposalId: id,
          actor,
          action: 'approved',
          details: null,
        },
      });
      return updated;
    });
    res.json(proposal);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/proposals/:id/reject', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminAccess = requireAdminAccess(req);
    if (!adminAccess.ok) return res.status(adminAccess.status).json({ error: adminAccess.error });
    const actor = String(req.body?.actor || adminAccess.actor || 'admin');
    const reason = req.body?.reason ? String(req.body.reason) : null;
    const proposal = await prisma.$transaction(async (tx) => {
      const updated = await tx.gameSpecification.update({
        where: { id },
        data: { status: 'rejected' },
      });
      await tx.proposalAuditLog.create({
        data: {
          proposalId: id,
          actor,
          action: 'rejected',
          details: reason ? JSON.stringify({ reason }) : null,
        },
      });
      return updated;
    });
    res.json(proposal);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/proposals/:id/start-trial', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminAccess = requireAdminAccess(req);
    if (!adminAccess.ok) return res.status(adminAccess.status).json({ error: adminAccess.error });
    const actor = String(req.body?.actor || adminAccess.actor || 'admin');
    const proposal = await prisma.$transaction(async (tx) => {
      const updated = await tx.gameSpecification.update({
        where: { id },
        data: { status: 'trial_active' },
      });
      await tx.proposalAuditLog.create({
        data: {
          proposalId: id,
          actor,
          action: 'trial_started',
          details: null,
        },
      });
      return updated;
    });
    res.json(proposal);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/proposals/:id/promote', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminAccess = requireAdminAccess(req);
    if (!adminAccess.ok) return res.status(adminAccess.status).json({ error: adminAccess.error });
    const actor = String(req.body?.actor || adminAccess.actor || 'admin');
    const proposal = await prisma.$transaction(async (tx) => {
      const current = await tx.gameSpecification.findUnique({ where: { id } });
      if (!current) {
        throw new Error('Proposal not found');
      }
      if (current.status !== 'trial_active') {
        throw new Error('Only trial_active proposals can be promoted');
      }
      const updated = await tx.gameSpecification.update({
        where: { id },
        data: { status: 'approved' },
      });
      await tx.proposalAuditLog.create({
        data: {
          proposalId: id,
          actor,
          action: 'promoted_from_trial',
          details: null,
        },
      });
      return updated;
    });
    res.json(proposal);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/proposals/:id/audit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const logs = await prisma.proposalAuditLog.findMany({
      where: { proposalId: id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(logs);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/community/premium/eligibility/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const trust = await getTrustScoreForAgent(agentId);
    const latestCert = await prisma.agentCertification.findFirst({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
    });
    const labels = latestCert?.labels ? JSON.parse(latestCert.labels) : [];
    const eligible = trust.trustScore >= 70 && Array.isArray(labels) && labels.includes('Verified');
    res.json({
      agentId,
      eligible,
      reasons: {
        trustScore: trust.trustScore,
        requiresTrustAtLeast: 70,
        latestCertificationSeal: latestCert?.seal || null,
        latestCertificationLabels: labels,
        requiresLabel: 'Verified',
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// World Cup Prediction Endpoints
router.get('/world-cup/matches', async (req: Request, res: Response) => {
  try {
    const matches = await prisma.match.findMany({
      where: { gameType: 'world_cup_prediction', status: 'in_progress' },
      include: {
        rounds: {
          where: { roundNumber: 1 }
        }
      }
    });

    const parsedMatches = matches.map(m => {
      const r = m.rounds[0];
      const metadata = r && r.payload ? JSON.parse(r.payload) : {};
      return {
        matchId: m.id,
        homeTeam: metadata.homeTeam || '',
        awayTeam: metadata.awayTeam || '',
        kickoffTime: metadata.kickoffTime || '',
        status: m.status,
        odds: metadata.odds || {}
      };
    });

    res.json(parsedMatches);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/world-cup/matches/:matchId/predict', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const { prediction, agentId } = req.body;

    const authResult = isAuthEnforced() ? await requireAgentIdentity(req) : null;
    if (authResult && authResult.error) {
      return res.status(authResult.error.status).json({ error: authResult.error.error });
    }

    const effectiveAgentId = authResult?.agent?.id || agentId;
    if (!effectiveAgentId) {
      return res.status(400).json({ error: 'AgentId is required' });
    }

    if (!prediction || !['home_win', 'draw', 'away_win'].includes(prediction)) {
      return res.status(400).json({ error: 'Invalid prediction. Must be home_win, draw, or away_win.' });
    }

    const result = await submitPrediction(matchId, effectiveAgentId, prediction as any);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/world-cup/predictions', async (req: Request, res: Response) => {
  try {
    const authResult = isAuthEnforced() ? await requireAgentIdentity(req) : null;
    if (authResult && authResult.error) {
      return res.status(authResult.error.status).json({ error: authResult.error.error });
    }

    const agentId = authResult?.agent?.id || String(req.query.agentId || '');
    if (!agentId) {
      return res.status(400).json({ error: 'AgentId is required' });
    }

    const predictions = await prisma.action.findMany({
      where: {
        agentId,
        match: {
          gameType: 'world_cup_prediction'
        }
      },
      include: {
        match: {
          include: {
            participants: {
              where: { agentId }
            },
            rounds: {
              where: { roundNumber: 1 }
            }
          }
        }
      }
    });

    const parsedPredictions = predictions.map(p => {
      const match = p.match;
      const round = match.rounds[0];
      const metadata = round && round.payload ? JSON.parse(round.payload) : {};
      const actionPayload = p.payload ? JSON.parse(p.payload) : {};
      const participant = match.participants[0];

      let status = 'pending';
      if (match.status === 'finished') {
        status = participant && participant.score > 0 ? 'correct' : 'incorrect';
      }

      return {
        predictionId: p.id,
        matchId: match.id,
        fixture: `${metadata.homeTeam} vs ${metadata.awayTeam}`,
        prediction: p.actionType,
        oddsLocked: actionPayload.odds || 2.0,
        status,
        scoreAwarded: participant ? participant.score : 0,
        settledAt: match.finishedAt || null
      };
    });

    res.json(parsedPredictions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

