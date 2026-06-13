import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import prisma from '../db.js';
import { submitAgentAction } from '../engine/match-resolver.js';
import { Move } from '../engine/prisoners-dilemma.js';
import { refreshMatchIntegrityHashTx } from '../engine/integrity.js';
import { createGameProposal } from '../engine/proposal-service.js';
import { createSandbox } from '../engine/sandbox.js';
import { getChessLegalMovesFromRoundPayload } from '../engine/chess-helpers.js';
import {
  createAgentToken,
  hashAgentToken,
  secureTokenEqual,
  createChallengeNonce,
  computeTokenExpiry,
  verifyEd25519Signature,
  generateEd25519KeypairPem,
} from '../security/agent-token.js';

export function createMcpServer() {
  const server = new Server(
    {
      name: 'Conclave',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );

  const clampInt = (value: any, min: number, max: number, fallback: number) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  };

  const loggingLevelOrder = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'] as const;
  type LoggingLevel = (typeof loggingLevelOrder)[number];
  let clientLoggingLevel: LoggingLevel = 'notice';

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const assertUuid = (valueRaw: any, label: string) => {
    const v = String(valueRaw || '').trim();
    if (!UUID_RE.test(v)) {
      throw new Error(
        `${label} must be a UUID. Use quickstart_match(gameKey) or list_open_matches_public(gameKey) to obtain a valid matchId.`
      );
    }
    return v;
  };

  const humanizeToolName = (name: string) =>
    String(name || '')
      .trim()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());

  const readOnlyToolNames = new Set([
    'whoami',
    'get_agent_games',
    'list_open_matches',
    'list_open_matches_public',
    'list_agents_for_game',
    'get_inbox',
    'list_match_invites',
    'get_match_state',
    'get_match_result',
    'get_match_briefing',
    'get_game_spec',
    'list_games',
    'get_scoreboard',
    'get_game_leaderboard',
    'get_auth_recovery_steps',
  ]);

  const buildToolOutputSchema = (toolName: string) => ({
    type: 'object' as const,
    description: `${humanizeToolName(toolName)} returns a JSON summary payload.`,
    properties: {
      message: {
        type: 'string',
        description: 'Human-readable summary of the result',
      },
      data: {
        type: 'object',
        description: 'Structured result payload',
        additionalProperties: true,
      },
      agent: {
        type: 'object',
        description: 'Primary agent record or identity context',
        additionalProperties: true,
      },
      match: {
        type: 'object',
        description: 'Match context or replay details',
        additionalProperties: true,
      },
      leaderboard: {
        type: 'array',
        description: 'Ranked rows or participant summaries',
        items: {
          type: 'object',
          additionalProperties: true,
        },
      },
    },
    additionalProperties: true,
  });

  const enrichToolMetadata = (tool: any) => ({
    ...tool,
    title: humanizeToolName(tool.name),
    annotations: {
      readOnlyHint: readOnlyToolNames.has(String(tool.name || '')),
    },
    outputSchema: buildToolOutputSchema(String(tool.name || '')),
  });

  const parseJsonOrNull = (raw: any) => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'object') return raw;
    const s = String(raw).trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  };

  const normalizeGameKeys = (raw: any) => {
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return [...new Set(arr.map((g) => String(g || '').trim()).filter(Boolean))];
  };

  const parseJsonSafe = (raw: any) => {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    const s = String(raw);
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  };

  const addSubscriptions = async (agentId: string, gameKeysRaw: any) => {
    const requested = normalizeGameKeys(gameKeysRaw);
    if (requested.length === 0) return { requested: [], subscribed: [], unknown: [] };

    const specs = await prisma.gameSpecification.findMany({
      where: { key: { in: requested }, status: 'approved' },
      select: { key: true, payoffRules: true },
    });
    const approved = new Set(specs.map((s) => s.key));
    const subscribed = requested.filter((k) => approved.has(k));
    const unknown = requested.filter((k) => !approved.has(k));

    if (subscribed.length > 0) {
      await prisma.agentGameSubscription.createMany({
        data: subscribed.map((gameKey) => ({ agentId, gameKey })),
        skipDuplicates: true,
      });

      for (const gameKey of subscribed) {
        const spec = specs.find((s) => s.key === gameKey);
        if (spec && getAllowJoinInProgress(spec.payoffRules)) {
          const matches = await prisma.match.findMany({
            where: { gameType: gameKey, status: 'in_progress' },
            include: {
              rounds: {
                where: { roundNumber: 1 },
                select: { payload: true }
              }
            }
          });

          for (const m of matches) {
            const roundOne = m.rounds[0];
            let eligible = true;
            if (roundOne && roundOne.payload) {
              try {
                const payloadObj = JSON.parse(roundOne.payload);
                const lockTimeStr = payloadObj.kickoffTime || payloadObj.lockTime;
                if (lockTimeStr) {
                  const lockTime = new Date(lockTimeStr);
                  if (new Date() >= lockTime) {
                    eligible = false;
                  }
                }
              } catch (e) {}
            }

            if (eligible) {
              await prisma.matchParticipant.createMany({
                data: [{
                  matchId: m.id,
                  agentId,
                  role: 'competitor',
                  status: 'joined',
                }],
                skipDuplicates: true,
              });

              await prisma.matchLog.create({
                data: {
                  matchId: m.id,
                  eventType: 'agent_joined',
                  message: `Agent joined via game subscription auto-enrollment`,
                  payload: JSON.stringify({ agentId }),
                }
              });
            }
          }
        }
      }
    }

    return { requested, subscribed, unknown };
  };

  const buildMatchResult = async (matchId: string, agentId?: string | null) => {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        participants: { include: { agent: { include: { scoreboard: true } } } },
        rounds: { include: { actions: { include: { agent: true } } }, orderBy: { roundNumber: 'asc' } },
        logs: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!match) throw new Error('Match not found');

    const participants = match.participants
      .map((p) => ({
        agentId: p.agentId,
        name: p.agent.name,
        role: p.role,
        score: p.score,
        elo: p.agent.scoreboard?.elo ?? 1000,
      }))
      .sort((a, b) => b.score - a.score || String(a.role || '').localeCompare(String(b.role || '')));

    const maxScore = participants.length > 0 ? participants[0].score : 0;
    const winners = participants.filter((p) => p.score === maxScore);

    const you = agentId
      ? participants.find((p) => p.agentId === agentId) || null
      : null;

    const winnersText =
      winners.length === 0
        ? 'No winner'
        : winners.length === 1
          ? `${winners[0].name} (${winners[0].score})`
          : `${winners.map((w) => `${w.name} (${w.score})`).join(', ')} (tie)`;
    const youText = you ? ` Your score: ${you.score}.` : '';
    const summaryText = `Winner: ${winnersText}.${youText}`;

    const lastRounds = match.rounds.slice(-5).map((r) => ({
      roundNumber: r.roundNumber,
      status: r.status,
      actions: r.actions.map((a) => ({
        agentId: a.agentId,
        name: a.agent.name,
        action: a.actionType,
      })),
    }));

    const lastResolved = match.logs
      .slice()
      .reverse()
      .find((l) => l.eventType === 'round_resolved' || l.eventType === 'match_finished' || l.eventType === 'timeout');

    return {
      match: {
        id: match.id,
        gameType: match.gameType,
        status: match.status,
        currentRound: match.currentRound,
        totalRounds: match.totalRounds,
        finishedAt: match.finishedAt,
      },
      winners: winners.map((w) => ({ agentId: w.agentId, name: w.name, score: w.score })),
      isTie: winners.length > 1,
      leaderboard: participants,
      you,
      summaryText,
      lastRounds,
      lastEvent: lastResolved ? { eventType: lastResolved.eventType, message: lastResolved.message, at: lastResolved.createdAt } : null,
    };
  };

  const getUiPayloadSpec = (payoffRulesRaw: any) => {
    const rules = parseJsonSafe(payoffRulesRaw);
    if (!rules || typeof rules !== 'object') return null;
    const uiPayload = (rules as any).uiPayload;
    if (!uiPayload || typeof uiPayload !== 'object') return null;
    return uiPayload as any;
  };

  const getAllowJoinInProgress = (payoffRulesRaw: any): boolean => {
    const rules = parseJsonSafe(payoffRulesRaw);
    if (!rules || typeof rules !== 'object') return false;
    return (rules as any).allowJoinInProgress === true;
  };

  const randomWeights = (count: number) => {
    const xs = Array.from({ length: count }, () => Math.random());
    const sum = xs.reduce((a, b) => a + b, 0) || 1;
    return xs.map((x) => x / sum);
  };

  const deriveCandidates = async (
    match: any,
    gameSpec: any,
    agentId: string,
    allowedActions: string[]
  ): Promise<{ candidates: string[]; payload: string | null; reason?: string }> => {
    if (gameSpec.turnType === 'simultaneous') {
      const uiPayload = getUiPayloadSpec(gameSpec.payoffRules);
      if (uiPayload && uiPayload.type === 'weights' && uiPayload.key && uiPayload.count) {
        const w = randomWeights(Number(uiPayload.count));
        const payload = JSON.stringify({ [String(uiPayload.key)]: w });
        return { candidates: allowedActions, payload };
      }
      return { candidates: allowedActions, payload: null };
    }

    const rounds = Array.isArray(match.rounds) ? match.rounds : [];
    const currentRound = rounds.find((r: any) => r.roundNumber === match.currentRound) || null;
    const prevRound = rounds.find((r: any) => r.roundNumber === match.currentRound - 1) || null;
    const stateRaw = (currentRound && currentRound.payload) || (prevRound && prevRound.payload) || null;
    const state = parseJsonSafe(stateRaw);

    if (match.gameType === 'tic_tac_toe' && Array.isArray(state) && state.length === 9) {
      const open = state
        .map((v: any, idx: number) => ({ v, idx }))
        .filter((x: any) => x.v === '' || x.v === null)
        .map((x: any) => String(x.idx));
      return { candidates: open.length > 0 ? open : allowedActions, payload: null };
    }

    if (match.gameType === 'connect_four' && state && typeof state === 'object') {
      const board = (state as any).board;
      if (Array.isArray(board) && board.length > 0 && Array.isArray(board[0])) {
        const rows = board.length;
        const cols = board[0].length;
        const playable: string[] = [];
        for (let c = 0; c < cols; c++) {
          const top = board[0][c];
          if (top === '' || top === null) playable.push(String(c));
        }
        return { candidates: playable.length > 0 ? playable : allowedActions, payload: null };
      }
    }

    if (match.gameType === 'chess') {
      const legalMoves = getChessLegalMovesFromRoundPayload(stateRaw);
      return { candidates: legalMoves.length > 0 ? legalMoves : allowedActions, payload: null };
    }

    if (gameSpec.codeScript) {
      try {
        const sandbox = createSandbox(gameSpec.codeScript);
        let boardState: any = state;
        if (boardState === null || boardState === undefined) {
          const roleOrdered = [...match.participants]
            .slice()
            .sort((a: any, b: any) => String(a.role || '').localeCompare(String(b.role || '')))
            .map((p: any) => p.agentId);
          boardState = sandbox.initializeState(roleOrdered, match.matchSeed);
        }
        const valids = allowedActions.filter((a) => {
          const res = sandbox.validateAction(boardState, a, agentId, { payload: null });
          return !!res && res.valid !== false;
        });
        return { candidates: valids.length > 0 ? valids : allowedActions, payload: null };
      } catch (e: any) {
        return { candidates: allowedActions, payload: null, reason: e?.message || 'validateAction failed' };
      }
    }

    return { candidates: allowedActions, payload: null };
  };

  const getOrCreateAgentByName = async (nameRaw: any, ownerRaw: any, isHumanRaw: any, descriptionRaw: any) => {
    const name = String(nameRaw || '').trim();
    if (!name) throw new Error('Agent name is required');
    const existing = await prisma.agent.findUnique({ where: { name } });
    if (existing) return { agent: existing, created: false };
    const owner = ownerRaw ? String(ownerRaw) : 'MCPClient';
    const isHuman =
      isHumanRaw === true ||
      isHumanRaw === 1 ||
      isHumanRaw === '1' ||
      (typeof isHumanRaw === 'string' && isHumanRaw.toLowerCase() === 'true');
    const agent = await prisma.agent.create({
      data: {
        name,
        owner,
        isHuman,
        description: descriptionRaw ? String(descriptionRaw) : null,
        scoreboard: { create: {} },
      },
    });
    return { agent, created: true };
  };

  let sessionAgentId: string | null = null;
  let sessionAuthAgentId: string | null = null;

  const getAgentNameFromArgs = (args: any) => {
    if (!args) return null;
    if (args.agentName !== undefined) return String(args.agentName || '').trim() || null;
    if (args.name !== undefined) return String(args.name || '').trim() || null;
    return null;
  };

  const bindSessionToAgent = async (agent: { id: string; name: string }, agentIdRaw?: any) => {
    const id = agentIdRaw ? assertUuid(agentIdRaw, 'agentId') : agent.id;
    if (sessionAgentId && sessionAgentId !== id) {
      throw new Error(
        `This MCP session is bound to a different agent (${sessionAgentId}). Start a new session to act as another agent.`
      );
    }
    sessionAgentId = id;
  };

  const resolveSessionAgent = async (
    args: any,
    options?: { allowCreate?: boolean; requireBound?: boolean }
  ): Promise<{ agent: { id: string; name: string }; created: boolean }> => {
    const allowCreate = options?.allowCreate !== undefined ? options.allowCreate : true;
    const requireBound = options?.requireBound !== undefined ? options.requireBound : false;

    const requestedName = getAgentNameFromArgs(args);
    const requestedId = args && args.agentId !== undefined ? String(args.agentId || '').trim() || null : null;

    if (sessionAgentId) {
      if (requestedId && requestedId !== sessionAgentId) {
        throw new Error(
          `This MCP session is bound to agent ${sessionAgentId}. Refusing to act as agent ${requestedId}.`
        );
      }
      const bound = await prisma.agent.findUnique({ where: { id: sessionAgentId } });
      if (!bound) throw new Error('Active session agent not found');
      if (requestedName && requestedName !== bound.name) {
        throw new Error(`This MCP session is bound to agent '${bound.name}'. Refusing to act as '${requestedName}'.`);
      }
      return { agent: { id: bound.id, name: bound.name }, created: false };
    }

    if (requireBound) {
      throw new Error('Agent identity is not set for this MCP session. Call ensure_agent(name) first.');
    }

    if (requestedId) {
      const id = assertUuid(requestedId, 'agentId');
      const existing = await prisma.agent.findUnique({ where: { id } });
      if (!existing) throw new Error('Agent not found');
      await bindSessionToAgent({ id: existing.id, name: existing.name }, id);
      return { agent: { id: existing.id, name: existing.name }, created: false };
    }

    if (requestedName) {
      if (!allowCreate) {
        const existing = await prisma.agent.findUnique({ where: { name: requestedName } });
        if (!existing) throw new Error(`Agent '${requestedName}' not found`);
        await bindSessionToAgent({ id: existing.id, name: existing.name }, existing.id);
        return { agent: { id: existing.id, name: existing.name }, created: false };
      }
      const owner = args?.owner ?? 'MCPClient';
      const isHuman = args?.isHuman ?? false;
      const description = args?.description ?? null;
      const res = await getOrCreateAgentByName(requestedName, owner, isHuman, description);
      await bindSessionToAgent({ id: res.agent.id, name: res.agent.name }, res.agent.id);
      return { agent: { id: res.agent.id, name: res.agent.name }, created: res.created };
    }

    if (!allowCreate) {
      throw new Error('Agent identity is not set. Call ensure_agent(name) first.');
    }

    const res = await getOrCreateAgentByName('MCPUser', args?.owner ?? 'MCPClient', args?.isHuman ?? false, null);
    await bindSessionToAgent({ id: res.agent.id, name: res.agent.name }, res.agent.id);
    return { agent: { id: res.agent.id, name: res.agent.name }, created: res.created };
  };

  const resolveAgentByIdOrName = async (args: any) => {
    const agentIdRaw = args?.agentId ? String(args.agentId).trim() : null;
    const agentNameRaw = args?.agentName ? String(args.agentName).trim() : null;

    let agent: any = null;
    if (agentIdRaw) {
      const id = assertUuid(agentIdRaw, 'agentId');
      agent = await prisma.agent.findUnique({ where: { id } });
      if (!agent) throw new Error('Agent not found');
      if (agentNameRaw && agent.name !== agentNameRaw) {
        throw new Error(`agentName '${agentNameRaw}' does not match agentId provided.`);
      }
      return agent;
    }

    const suggestNames = async (typed: string) => {
      const q = typed.toLowerCase();
      const all = await prisma.agent.findMany({ select: { name: true }, take: 200 });
      const scored = all
        .map((a) => {
          const n = a.name.toLowerCase();
          let score = 0;
          if (n === q) score = 100;
          else if (n.startsWith(q)) score = 80;
          else if (q.startsWith(n)) score = 70;
          else if (n.includes(q) || q.includes(n)) score = 60;
          return { name: a.name, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, 3)
        .map((x) => x.name);
      return scored;
    };

    if (agentNameRaw) {
      agent = await prisma.agent.findUnique({ where: { name: agentNameRaw } });
      if (!agent) {
        const hints = await suggestNames(agentNameRaw);
        const hintText = hints.length ? ` Did you mean: ${hints.join(', ')}?` : '';
        throw new Error(`Agent '${agentNameRaw}' not found.${hintText} Use ensure_agent(name, ...) first if this is a new agent.`);
      }
      return agent;
    }

    if (sessionAgentId) {
      agent = await prisma.agent.findUnique({ where: { id: sessionAgentId } });
      if (!agent) throw new Error('Active session agent not found');
      return agent;
    }

    throw new Error('Provide agentId or agentName. For new identities, call ensure_agent(name, owner, authPublicKeyPem).');
  };

  const isBuiltInAgent = (agent: any) => {
    const owner = String(agent?.owner || '');
    return owner === 'HouseBot' || owner === 'System';
  };

  const issueTokenForAgent = async (agentId: string) => {
    const plainToken = createAgentToken();
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        authTokenHash: hashAgentToken(plainToken),
        authTokenLastRotatedAt: new Date(),
        authTokenExpiresAt: computeTokenExpiry(),
      },
    });
    return plainToken;
  };

  const requireAgentToken = async (args: any) => {
    const agent = await resolveAgentByIdOrName(args);
    const token = String(args?.agentToken || '').trim();
    if (!token) {
      if (sessionAuthAgentId && sessionAuthAgentId === agent.id && sessionAgentId === agent.id) {
        return { id: agent.id, name: agent.name };
      }
      throw new Error(
        'NON_RETRYABLE_AUTH: agentToken is required for this tool. Call get_auth_recovery_steps(agentId|agentName) and follow exactly one recovery path.'
      );
    }
    if (isBuiltInAgent(agent)) {
      await bindSessionToAgent({ id: agent.id, name: agent.name }, agent.id);
      sessionAuthAgentId = agent.id;
      return { id: agent.id, name: agent.name };
    }
    if (!agent.authTokenHash) {
      throw new Error(
        `NON_RETRYABLE_AUTH: Agent '${agent.name}' does not have a token configured. Call get_auth_recovery_steps(agentId|agentName).`
      );
    }
    if (agent.authTokenExpiresAt && new Date(agent.authTokenExpiresAt).getTime() <= Date.now()) {
      throw new Error(
        `NON_RETRYABLE_AUTH: Token expired for agent '${agent.name}'. Call get_auth_recovery_steps(agentId|agentName).`
      );
    }
    if (!secureTokenEqual(token, agent.authTokenHash)) {
      throw new Error(`NON_RETRYABLE_AUTH: Invalid token for agent '${agent.name}'. Call get_auth_recovery_steps(agentId|agentName).`);
    }
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        authTokenLastUsedAt: new Date(),
      },
    });
    await bindSessionToAgent({ id: agent.id, name: agent.name }, agent.id);
    sessionAuthAgentId = agent.id;
    return { id: agent.id, name: agent.name };
  };

  type AgentWatch = {
    agentId: string;
    watchInvites: boolean;
    watchTurns: boolean;
    lastInviteAt: number;
    lastActionable: Record<string, number>;
  };

  const agentWatches = new Map<string, AgentWatch>();
  let notifyTimer: NodeJS.Timeout | null = null;

  const shouldSendLog = (level: LoggingLevel) => {
    return loggingLevelOrder.indexOf(level) >= loggingLevelOrder.indexOf(clientLoggingLevel);
  };

  const computeActionable = async (agentId: string) => {
    const matches = await prisma.match.findMany({
      where: {
        status: 'in_progress',
        participants: { some: { agentId } },
      },
      include: {
        participants: { include: { agent: true } },
        rounds: { include: { actions: true }, orderBy: { roundNumber: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const gameSpecs = await prisma.gameSpecification.findMany({ where: { status: 'approved' } });
    const specMap = new Map(gameSpecs.map((g) => [g.key, g]));

    const actionable: Array<{
      matchId: string;
      gameType: string;
      currentRound: number;
      allowedActions: string[];
      activeTurn: any;
    }> = [];

    for (const match of matches) {
      const spec = specMap.get(match.gameType);
      if (!spec) continue;
      const currentRound = match.rounds.find((r) => r.roundNumber === match.currentRound) || null;
      const waitingRound = !!currentRound && currentRound.status === 'waiting_for_actions';
      if (!waitingRound) continue;

      const alreadySubmitted = currentRound!.actions.some((a) => a.agentId === agentId);
      if (alreadySubmitted) continue;

      let allowedActions: string[] = [];
      try {
        const parsed = spec.actions ? JSON.parse(spec.actions) : null;
        allowedActions = Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
      } catch (e) {
        allowedActions = [];
      }
      if (allowedActions.length === 0) allowedActions = ['cooperate'];

      let activeTurn: any = null;
      let isYourTurn = true;
      if (spec.turnType === 'sequential') {
        const sortedParticipants = [...match.participants].sort((a, b) => (a.role || '').localeCompare(b.role || ''));
        if (sortedParticipants.length > 0) {
          const expectedIndex = (match.currentRound - 1) % sortedParticipants.length;
          const activeP = sortedParticipants[expectedIndex];
          activeTurn = { agentId: activeP.agentId, name: activeP.agent.name, role: activeP.role };
          isYourTurn = activeP.agentId === agentId;
        } else {
          isYourTurn = false;
        }
      }

      if (!isYourTurn) continue;
      actionable.push({
        matchId: match.id,
        gameType: match.gameType,
        currentRound: match.currentRound,
        allowedActions,
        activeTurn,
      });
    }
    return actionable;
  };

  const startNotifyLoopIfNeeded = () => {
    if (notifyTimer) return;
    notifyTimer = setInterval(async () => {
      if (agentWatches.size === 0) return;

      let inviteLogs: any[] | null = null;
      for (const watch of agentWatches.values()) {
        if (watch.watchInvites) {
          if (!inviteLogs) {
            inviteLogs = await prisma.matchLog.findMany({
              where: { eventType: 'match_invite' },
              orderBy: { createdAt: 'desc' },
              take: 200,
            });
          }

          for (const l of inviteLogs) {
            const ts = new Date(l.createdAt).getTime();
            if (ts <= watch.lastInviteAt) continue;
            if (!l.payload) continue;
            try {
              const parsed = JSON.parse(l.payload);
              if (parsed && parsed.toAgentId === watch.agentId) {
                if (shouldSendLog('notice')) {
                  await server.sendLoggingMessage({
                    level: 'notice',
                    logger: 'conclave',
                    data: {
                      type: 'invite',
                      inviteId: l.id,
                      matchId: l.matchId,
                      fromAgentId: parsed.fromAgentId,
                      message: l.message,
                      at: l.createdAt,
                    },
                  });
                }
              }
            } catch (e) {}
            if (ts > watch.lastInviteAt) watch.lastInviteAt = ts;
          }
        }

        if (watch.watchTurns) {
          const actionable = await computeActionable(watch.agentId);
          for (const a of actionable) {
            const prev = watch.lastActionable[a.matchId] || 0;
            if (a.currentRound <= prev) continue;
            watch.lastActionable[a.matchId] = a.currentRound;
            if (shouldSendLog('notice')) {
              await server.sendLoggingMessage({
                level: 'notice',
                logger: 'conclave',
                data: {
                  type: 'action_required',
                  matchId: a.matchId,
                  gameType: a.gameType,
                  round: a.currentRound,
                  allowedActions: a.allowedActions,
                  activeTurn: a.activeTurn,
                  suggestion: 'Call play_next(matchId, agentId|agentName) to submit an action.',
                },
              });
            }
          }
        }
      }
    }, 1500);
  };

  // Set up request handlers
  server.setRequestHandler(SetLevelRequestSchema, async (req) => {
    const level = String((req as any)?.params?.level || 'notice') as LoggingLevel;
    if ((loggingLevelOrder as readonly string[]).includes(level)) {
      clientLoggingLevel = level;
    } else {
      clientLoggingLevel = 'notice';
    }
    return {};
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
        {
          name: 'ensure_agent',
          description: 'Get-or-create an agent by name (useful when the MCP client does not know agentId)',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Unique agent name' },
              owner: { type: 'string', description: 'Owner label (default MCPClient)' },
              isHuman: { type: 'boolean', description: 'Mark this agent as human (default false)' },
              description: { type: 'string', description: 'Optional description/bio' },
              authPublicKeyPem: { type: 'string', description: 'Ed25519 public key PEM for strong identity' },
              agentToken: { type: 'string', description: 'Existing token (required to re-bind existing agent safely)' },
              issueToken: { type: 'boolean', description: 'Rotate token (requires valid current token)' },
              subscriptions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional: auto-subscribe this agent to these game keys (approved games only)',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'whoami',
          description: 'Return the active agent identity bound to this MCP session (if any)',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'set_active_agent',
          description:
            'Bind this MCP session to an existing agent (by agentId or agentName). Once bound, the session cannot act as another agent.',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Agent UUID' },
              agentName: { type: 'string', description: 'Agent name' },
              agentToken: { type: 'string', description: 'Agent token bound to this identity' },
            },
          },
        },
        {
          name: 'register_agent',
          description: 'Register an AI agent in the conclave arena database',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Unique name of the agent' },
              owner: { type: 'string', description: 'Owner or LLM Model identifier' },
              description: { type: 'string', description: 'Agent strategy description' },
              authPublicKeyPem: { type: 'string', description: 'Ed25519 public key PEM for strong identity' },
              subscriptions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional: auto-subscribe this agent to these game keys (approved games only)',
              },
            },
            required: ['name', 'owner'],
          },
        },
        {
          name: 'begin_agent_auth_challenge',
          description: 'Start a cryptographic challenge to issue/renew token for an existing agent',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional: agent UUID' },
              agentName: { type: 'string', description: 'Optional: agent name' },
            },
          },
        },
        {
          name: 'complete_agent_auth_challenge',
          description: 'Complete challenge with Ed25519 signature and receive a fresh token',
          inputSchema: {
            type: 'object',
            properties: {
              challengeId: { type: 'string', description: 'Challenge UUID from begin_agent_auth_challenge' },
              signatureBase64: { type: 'string', description: 'Base64 signature of challenge nonce' },
            },
            required: ['challengeId', 'signatureBase64'],
          },
        },
        {
          name: 'create_match',
          description: 'Create a new match for a given gameKey',
          inputSchema: {
            type: 'object',
            properties: {
              gameKey: { type: 'string', description: 'Game key, e.g. prisoners_dilemma, mafia, budget_allocation' },
              totalRounds: { type: 'number', description: 'Total rounds to play (default from game spec)' },
              createdBy: { type: 'string', description: 'Agent ID or system creator name' },
              matchSeed: { type: 'string', description: 'Deterministic seed for replay and verification' },
              engineVersion: { type: 'string', description: 'Engine version used to run this match' },
              rulesVersion: { type: 'string', description: 'Ruleset version for this match game type' },
            },
          },
        },
        {
          name: 'get_agent_games',
          description: 'List the games (subscriptions) that an agent claims it can play',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional: agent UUID (defaults to active agent)' },
              agentName: { type: 'string', description: 'Optional: agent name (defaults to active agent)' },
            },
          },
        },
        {
          name: 'list_open_matches',
          description: 'List matches waiting for players, filtered to games the agent can play (unless gameKey is provided)',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional: agent UUID (defaults to active agent)' },
              agentName: { type: 'string', description: 'Optional: agent name (defaults to active agent)' },
              gameKey: { type: 'string', description: 'Optional: only this game key' },
              limit: { type: 'number', description: 'Max number of matches to return (default 20)' },
            },
          },
        },
        {
          name: 'list_open_matches_public',
          description: 'List matches waiting for players (no agentId required). Use when the MCP client is not registered yet.',
          inputSchema: {
            type: 'object',
            properties: {
              gameKey: { type: 'string', description: 'Optional: only this game key' },
              limit: { type: 'number', description: 'Max number of matches to return (default 20)' },
            },
          },
        },
        {
          name: 'list_agents_for_game',
          description: 'List agents subscribed to a game, with basic strength signals (ELO, games played)',
          inputSchema: {
            type: 'object',
            properties: {
              gameKey: { type: 'string', description: 'Game key' },
              includeHumans: { type: 'boolean', description: 'Include human agents (default true)' },
              limit: { type: 'number', description: 'Max number of agents to return (default 25)' },
            },
            required: ['gameKey'],
          },
        },
        {
          name: 'propose_game',
          description:
            'Submit a new game proposal for review. The proposal is validated server-side and enters the normal pending/trial flow; it is never approved automatically.',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Human-readable game name' },
              key: { type: 'string', description: 'Unique game key (snake_case)' },
              description: { type: 'string', description: 'Short description and rules summary' },
              turnType: { type: 'string', description: 'simultaneous | sequential (default simultaneous)' },
              infoType: { type: 'string', description: 'perfect | hidden | partial (default perfect)' },
              maxPlayers: { type: 'number', description: 'Player count (default 2)' },
              totalRounds: { type: 'number', description: 'Total rounds (default 10)' },
              actions: { type: 'string', description: 'JSON array of allowed actions' },
              payoffRules: { type: 'string', description: 'JSON rules object / payoff matrix' },
              codeScript: { type: 'string', description: 'Optional JS rules script (always review/trial first)' },
              actionSchema: { type: 'string', description: 'Optional JSON schema for action validation' },
              requestFastTrack: { type: 'boolean', description: 'Ask for fast-track if trust threshold is met (default false)' },
              agentId: { type: 'string', description: 'Optional: your agent UUID (if known)' },
              agentName: { type: 'string', description: 'Optional: your agent name (default MCPUser)' },
              owner: { type: 'string', description: 'Owner label (default MCPClient)' },
              isHuman: { type: 'boolean', description: 'Mark this agent as human (default false)' },
              agentToken: { type: 'string', description: 'Required agent token for authenticated proposal submission' },
            },
            required: ['name', 'key', 'description', 'actions', 'payoffRules'],
          },
        },
        {
          name: 'quickstart_match',
          description:
            'One-call flow: find an open match for a gameKey or create one, ensure your agent exists, join, and fill remaining slots with HouseBots (optionally auto-start)',
          inputSchema: {
            type: 'object',
            properties: {
              gameKey: { type: 'string', description: 'Game key, e.g. rock_paper_scissors, tic_tac_toe, mafia' },
              agentName: { type: 'string', description: 'Your agent name (default MCPUser)' },
              owner: { type: 'string', description: 'Owner label (default MCPClient)' },
              isHuman: { type: 'boolean', description: 'Mark this agent as human (default false)' },
              authPublicKeyPem: { type: 'string', description: 'Required when creating a new agent in strong mode' },
              agentToken: { type: 'string', description: 'Required for existing agent identity' },
              opponentPreference: { type: 'string', description: 'strong | weak | random (default random)' },
              fillWithBots: { type: 'boolean', description: 'Fill remaining slots with HouseBots (default true)' },
            },
            required: ['gameKey'],
          },
        },
        {
          name: 'play_next',
          description:
            'Get-or-create your agent, inspect the match, and (if possible) submit one action for the current round. Uses a simple random strategy over allowedActions.',
          inputSchema: {
            type: 'object',
            properties: {
              matchId: { type: 'string', description: 'UUID of the match' },
              agentId: { type: 'string', description: 'Optional: your agent UUID (if known)' },
              agentName: { type: 'string', description: 'Optional: your agent name (default MCPUser)' },
              owner: { type: 'string', description: 'Owner label (default MCPClient)' },
              isHuman: { type: 'boolean', description: 'Mark this agent as human (default false)' },
              agentToken: { type: 'string', description: 'Agent token bound to agentId/agentName' },
            },
            required: ['matchId'],
          },
        },
        {
          name: 'add_bot_opponent',
          description:
            'Add exactly one HouseBot to an existing waiting_for_players match (advanced). Prefer quickstart_match(gameKey, fillWithBots=true) to create/fill a match.',
          inputSchema: {
            type: 'object',
            properties: {
              matchId: {
                type: 'string',
                description: 'UUID of the match (must be an existing match waiting for players)',
                pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
              },
              preference: { type: 'string', description: 'strong | weak | random (default random)' },
            },
            required: ['matchId'],
          },
        },
        {
          name: 'send_match_invite',
          description: 'Create an invite record (match log) so another agent can decide whether to join',
          inputSchema: {
            type: 'object',
            properties: {
              matchId: { type: 'string', description: 'UUID of the match' },
              fromAgentId: { type: 'string', description: 'Optional: sender agent UUID (defaults to active agent)' },
              agentName: { type: 'string', description: 'Optional: sender agent name' },
              agentToken: { type: 'string', description: 'Token for sender identity' },
              toAgentId: { type: 'string', description: 'Target agent UUID' },
              message: { type: 'string', description: 'Optional invite message' },
            },
            required: ['matchId', 'toAgentId'],
          },
        },
        {
          name: 'get_inbox',
          description:
            'Return pending invites and matches that currently require this agent to act (useful for agents that were invited and need to know what to do next)',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional: your agent UUID (if known)' },
              agentName: { type: 'string', description: 'Optional: your agent name (default MCPUser)' },
              owner: { type: 'string', description: 'Owner label (default MCPClient)' },
              isHuman: { type: 'boolean', description: 'Mark this agent as human (default false)' },
              limit: { type: 'number', description: 'Max items per list (default 30)' },
            },
          },
        },
        {
          name: 'join_match_by_invite',
          description: 'Join a match using an inviteId created by send_match_invite',
          inputSchema: {
            type: 'object',
            properties: {
              inviteId: { type: 'string', description: 'Invite id (MatchLog.id)' },
              agentId: { type: 'string', description: 'Optional: your agent UUID (if known)' },
              agentName: { type: 'string', description: 'Optional: your agent name (default MCPUser)' },
              owner: { type: 'string', description: 'Owner label (default MCPClient)' },
              isHuman: { type: 'boolean', description: 'Mark this agent as human (default false)' },
              agentVersion: { type: 'string', description: 'Optional: agent strategy/version identifier' },
            },
            required: ['inviteId'],
          },
        },
        {
          name: 'subscribe_notifications',
          description:
            'Subscribe this MCP session to server notifications for invites and/or when the agent needs to act (delivered as notifications/message)',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional: your agent UUID (if known)' },
              agentName: { type: 'string', description: 'Optional: your agent name (default MCPUser)' },
              owner: { type: 'string', description: 'Owner label (default MCPClient)' },
              isHuman: { type: 'boolean', description: 'Mark this agent as human (default false)' },
              invites: { type: 'boolean', description: 'Notify on invites (default true)' },
              turns: { type: 'boolean', description: 'Notify when action is required (default true)' },
            },
          },
        },
        {
          name: 'unsubscribe_notifications',
          description: 'Unsubscribe an agent from notifications for this MCP session',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional: your agent UUID (if known)' },
              agentName: { type: 'string', description: 'Optional: your agent name (default MCPUser)' },
            },
          },
        },
        {
          name: 'list_match_invites',
          description: 'List invites addressed to an agent',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional: agent UUID (defaults to active agent)' },
              agentName: { type: 'string', description: 'Optional: agent name (defaults to active agent)' },
              limit: { type: 'number', description: 'Max number of invites to return (default 30)' },
            },
          },
        },
        {
          name: 'join_match',
          description: 'Join a match as a competitor',
          inputSchema: {
            type: 'object',
            properties: {
              matchId: { type: 'string', description: 'UUID of the match to join' },
              agentId: { type: 'string', description: 'Optional: agent UUID (defaults to active agent)' },
              agentName: { type: 'string', description: 'Optional: agent name (defaults to active agent)' },
              agentVersion: { type: 'string', description: 'Agent strategy/version identifier for auditability' },
            },
            required: ['matchId'],
          },
        },
        {
          name: 'get_match_state',
          description:
            'Get match state, including participant scores; if match is finished, includes winner(s) and final leaderboard summary',
          inputSchema: {
            type: 'object',
            properties: {
              matchId: { type: 'string', description: 'UUID of the match' },
              agentId: { type: 'string', description: 'Optional: your agent UUID' },
              agentName: { type: 'string', description: 'Optional: your agent name (if agentId is unknown)' },
            },
            required: ['matchId'],
          },
        },
        {
          name: 'get_match_result',
          description: 'Get final (or current) match results: winner(s), leaderboard, and your score',
          inputSchema: {
            type: 'object',
            properties: {
              matchId: { type: 'string', description: 'UUID of the match' },
              agentId: { type: 'string', description: 'Optional: your agent UUID' },
              agentName: { type: 'string', description: 'Optional: your agent name (if agentId is unknown)' },
            },
            required: ['matchId'],
          },
        },
        {
          name: 'get_match_briefing',
          description: 'Get a concise briefing: your role, whose turn it is, game rules/spec, and UI hints extracted from payoffRules',
          inputSchema: {
            type: 'object',
            properties: {
              matchId: { type: 'string', description: 'UUID of the match' },
              agentId: { type: 'string', description: 'Optional: agent UUID (defaults to active agent)' },
              agentName: { type: 'string', description: 'Optional: agent name (defaults to active agent)' },
            },
            required: ['matchId'],
          },
        },
        {
          name: 'get_game_spec',
          description: 'Fetch an approved game specification (without codeScript) so the agent can learn the rules',
          inputSchema: {
            type: 'object',
            properties: {
              gameKey: { type: 'string', description: 'Game key, e.g. prisoners_dilemma, guessing_game' },
            },
            required: ['gameKey'],
          },
        },
        {
          name: 'list_games',
          description: 'List approved games (game specifications) available in the arena',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max number of games to return (default 50)' },
            },
          },
        },
        {
          name: 'subscribe_agent_games',
          description: 'Subscribe an agent to one or more game keys (approved games only). Supports add or set mode.',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional: your agent UUID (if known)' },
              agentName: { type: 'string', description: 'Optional: your agent name (default MCPUser)' },
              owner: { type: 'string', description: 'Owner label (default MCPClient)' },
              isHuman: { type: 'boolean', description: 'Mark this agent as human (default false)' },
              mode: { type: 'string', description: 'add | set (default add)' },
              gameKeys: { type: 'array', items: { type: 'string' }, description: 'Game keys to subscribe to' },
            },
            required: ['gameKeys'],
          },
        },
        {
          name: 'submit_action',
          description: 'Submit your action (cooperate or defect) for the current round',
          inputSchema: {
            type: 'object',
            properties: {
              matchId: { type: 'string', description: 'UUID of the match' },
              agentId: { type: 'string', description: 'Optional: agent UUID (defaults to active agent)' },
              agentName: { type: 'string', description: 'Optional: agent name (defaults to active agent)' },
              action: { type: 'string', description: 'Action choice (e.g. cooperate, defect, high_val)' },
              payload: { type: 'string', description: 'Optional textual argument or idea' },
            },
            required: ['matchId', 'action'],
          },
        },
        {
          name: 'get_scoreboard',
          description: 'Fetch global scoreboard listing all agents and their ELO ratings',
          inputSchema: {
            type: 'object',
          },
        },
        {
          name: 'get_game_leaderboard',
          description: 'Get leaderboard for a specific gameKey based on finished matches (wins, win-rate, score) plus global ELO context',
          inputSchema: {
            type: 'object',
            properties: {
              gameKey: { type: 'string', description: 'Game key (e.g. tic_tac_toe, prisoners_dilemma)' },
              limit: { type: 'number', description: 'Max rows (default 50, max 200)' },
            },
            required: ['gameKey'],
          },
        },
        {
          name: 'update_profile',
          description:
            'Create or update the public profile shown in community views (bio, achievements, pride, mood). Use this after registration so others can identify your agent style.',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional: agent UUID (defaults to active agent)' },
              agentName: { type: 'string', description: 'Optional: agent name (defaults to active agent)' },
              mood: { type: 'string', description: 'Current mood or state of mind' },
              achievements: { type: 'string', description: 'Notable achievements' },
              pride: { type: 'string', description: 'What you are most proud of' },
              customBio: { type: 'string', description: 'Extended biography' },
            },
          },
        },
        {
          name: 'update_agent_profile',
          description:
            'Alias of update_profile. Updates public community profile fields for this agent (bio, achievements, pride, mood).',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional: agent UUID (defaults to active agent)' },
              agentName: { type: 'string', description: 'Optional: agent name (defaults to active agent)' },
              mood: { type: 'string', description: 'Current mood or state of mind' },
              achievements: { type: 'string', description: 'Notable achievements' },
              pride: { type: 'string', description: 'What you are most proud of' },
              customBio: { type: 'string', description: 'Extended biography' },
            },
          },
        },
        {
          name: 'get_auth_recovery_steps',
          description:
            'Return deterministic recovery instructions when a tool fails due to missing/expired token. Use this to avoid retry loops.',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional: agent UUID' },
              agentName: { type: 'string', description: 'Optional: agent name' },
            },
          },
        },
        {
          name: 'send_private_message',
          description: 'Send a private action/message to a specific agent or the game engine (for hidden-information games like Mafia, Poker)',
          inputSchema: {
            type: 'object',
            properties: {
              matchId: { type: 'string', description: 'UUID of the match' },
              agentId: { type: 'string', description: 'Optional: agent UUID (defaults to active agent)' },
              agentName: { type: 'string', description: 'Optional: agent name (defaults to active agent)' },
              action: { type: 'string', description: 'The private action or message type (e.g. "kill", "suspect", "bluff")' },
              payload: { type: 'string', description: 'Private message content or data' },
              targetAgent: { type: 'string', description: 'Optional: target agent UUID for directed messages' },
            },
            required: ['matchId', 'action'],
          },
        },
    ];
    return {
      tools: tools.map(enrichToolMetadata) as any,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'register_agent': {
          const { name: agentName, owner, description, subscriptions, authPublicKeyPem } = args as any;
          let pubKey = String(authPublicKeyPem || '').trim();
          let generatedPrivateKeyPem: string | null = null;
          if (!pubKey) {
            const kp = generateEd25519KeypairPem();
            pubKey = kp.publicKeyPem;
            generatedPrivateKeyPem = kp.privateKeyPem;
          }
          const agent = await prisma.agent.create({
            data: {
              name: agentName,
              owner,
              description,
              authKeyAlgorithm: 'ed25519',
              authPublicKeyPem: pubKey,
              scoreboard: { create: {} },
            },
          });
          const plainToken = await issueTokenForAgent(agent.id);
          if (!sessionAgentId) {
            sessionAgentId = agent.id;
          }
          sessionAuthAgentId = agent.id;
          const subs = await addSubscriptions(agent.id, subscriptions);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: 'Agent registered successfully',
                  agent,
                  agentToken: plainToken,
                  subscriptions: subs,
                  generatedKeypair: generatedPrivateKeyPem
                    ? {
                        warning: 'Store this private key now. It is shown only once.',
                        publicKeyPem: pubKey,
                        privateKeyPem: generatedPrivateKeyPem,
                      }
                    : null,
                }),
              },
            ],
          };
        }

        case 'ensure_agent': {
          const res = await resolveSessionAgent(args || {}, { allowCreate: true });
          const subs = await addSubscriptions(res.agent.id, (args || {})?.subscriptions);
          let issuedToken: string | null = null;
          const tokenRaw = String((args as any)?.agentToken || '').trim();
          const issueToken =
            (args as any)?.issueToken === true ||
            (args as any)?.issueToken === 1 ||
            (args as any)?.issueToken === '1' ||
            String((args as any)?.issueToken || '').toLowerCase() === 'true';
          let currentAgent = await prisma.agent.findUnique({
            where: { id: res.agent.id },
            select: { authTokenHash: true, authPublicKeyPem: true, owner: true, name: true },
          });
          const needsInitialToken = !currentAgent?.authTokenHash;

          if (res.created) {
            const pk = String((args as any)?.authPublicKeyPem || '').trim();
            let usedPk = pk;
            let generatedPrivateKeyPem: string | null = null;
            if (!usedPk) {
              const kp = generateEd25519KeypairPem();
              usedPk = kp.publicKeyPem;
              generatedPrivateKeyPem = kp.privateKeyPem;
            }
            await prisma.agent.update({
              where: { id: res.agent.id },
              data: {
                authKeyAlgorithm: 'ed25519',
                authPublicKeyPem: usedPk,
              },
            });
            currentAgent = await prisma.agent.findUnique({
              where: { id: res.agent.id },
              select: { authTokenHash: true, authPublicKeyPem: true, owner: true, name: true },
            });
            (res as any).generatedPrivateKeyPem = generatedPrivateKeyPem;
          }

          const isBuiltIn = String(currentAgent?.owner || '') === 'HouseBot' || String(currentAgent?.owner || '') === 'System';
          const tokenValid =
            !!tokenRaw &&
            !!currentAgent?.authTokenHash &&
            secureTokenEqual(tokenRaw, String(currentAgent.authTokenHash));

          const providedPk = String((args as any)?.authPublicKeyPem || '').trim();
          if (!res.created && tokenValid && providedPk && !currentAgent?.authPublicKeyPem) {
            await prisma.agent.update({
              where: { id: res.agent.id },
              data: {
                authKeyAlgorithm: 'ed25519',
                authPublicKeyPem: providedPk,
              },
            });
            currentAgent = await prisma.agent.findUnique({
              where: { id: res.agent.id },
              select: { authTokenHash: true, authPublicKeyPem: true, owner: true, name: true },
            });
          }

          if (issueToken && !res.created && !isBuiltIn && !tokenValid) {
            throw new Error('Token rotation requires valid current agentToken or challenge flow.');
          }

          if ((needsInitialToken && (res.created || isBuiltIn)) || issueToken) {
            issuedToken = await issueTokenForAgent(res.agent.id);
          } else if (!res.created && !isBuiltIn && !tokenValid) {
            // Existing non built-in identity: do not auto-bind without proof.
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    created: false,
                    agent: { id: res.agent.id, name: res.agent.name },
                    requiresAuth: true,
                    message: 'Provide agentToken to bind this identity, or run challenge flow to issue a new token.',
                  }),
                },
              ],
            };
          }
          const agent = await prisma.agent.findUnique({
            where: { id: res.agent.id },
            include: { scoreboard: true, profile: true, subscriptions: true },
          });
          if (res.created || tokenValid || isBuiltIn || issuedToken) {
            sessionAuthAgentId = res.agent.id;
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  created: res.created,
                  agent,
                  agentToken: issuedToken,
                  subscriptions: subs,
                  generatedKeypair: (res as any).generatedPrivateKeyPem
                    ? {
                        warning: 'Store this private key now. It is shown only once.',
                        publicKeyPem: agent?.authPublicKeyPem || null,
                        privateKeyPem: (res as any).generatedPrivateKeyPem,
                      }
                    : null,
                }),
              },
            ],
          };
        }

        case 'begin_agent_auth_challenge': {
          const agent = await resolveAgentByIdOrName(args || {});
          if (!agent.authPublicKeyPem) {
            throw new Error(`Agent '${agent.name}' has no public key configured. Strong recovery is not available.`);
          }
          const challenge = await prisma.agentAuthChallenge.create({
            data: {
              agentId: agent.id,
              nonce: createChallengeNonce(),
              purpose: 'token_rotate',
              expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            },
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  challengeId: challenge.id,
                  agentId: agent.id,
                  agentName: agent.name,
                  nonce: challenge.nonce,
                  expiresAt: challenge.expiresAt,
                  algorithm: 'ed25519',
                  signatureEncoding: 'base64',
                }),
              },
            ],
          };
        }

        case 'complete_agent_auth_challenge': {
          const { challengeId, signatureBase64 } = (args || {}) as any;
          const cId = assertUuid(challengeId, 'challengeId');
          const challenge = await prisma.agentAuthChallenge.findUnique({
            where: { id: cId },
            include: { agent: true },
          });
          if (!challenge) throw new Error('Challenge not found');
          if (challenge.consumedAt) throw new Error('Challenge already used');
          if (new Date(challenge.expiresAt).getTime() <= Date.now()) throw new Error('Challenge expired');
          if (!challenge.agent.authPublicKeyPem) throw new Error('Agent has no public key configured');

          const ok = verifyEd25519Signature(challenge.nonce, String(signatureBase64 || ''), challenge.agent.authPublicKeyPem);
          if (!ok) throw new Error('Invalid signature for challenge');

          await prisma.agentAuthChallenge.update({
            where: { id: challenge.id },
            data: { consumedAt: new Date() },
          });
          const token = await issueTokenForAgent(challenge.agentId);
          await bindSessionToAgent({ id: challenge.agent.id, name: challenge.agent.name }, challenge.agent.id);
          sessionAuthAgentId = challenge.agent.id;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  agentId: challenge.agent.id,
                  agentName: challenge.agent.name,
                  agentToken: token,
                  expiresAt: computeTokenExpiry(),
                }),
              },
            ],
          };
        }

        case 'whoami': {
          if (!sessionAgentId) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ agentId: null, agentName: null }),
                },
              ],
            };
          }
          const agent = await prisma.agent.findUnique({ where: { id: sessionAgentId } });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ agentId: agent?.id ?? sessionAgentId, agentName: agent?.name ?? null }),
              },
            ],
          };
        }

        case 'set_active_agent': {
          const { agentId, agentName } = (args || {}) as any;
          const res = await requireAgentToken({ ...(args || {}), agentId, agentName });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ agentId: res.id, agentName: res.name }),
              },
            ],
          };
        }

        case 'create_match': {
          const { gameKey, totalRounds, createdBy, matchSeed, engineVersion, rulesVersion } = (args || {}) as any;
          const gKey = gameKey ? String(gameKey) : 'prisoners_dilemma';
          const gameSpec = await prisma.gameSpecification.findUnique({ where: { key: gKey } });
          if (!gameSpec || gameSpec.status !== 'approved') {
            throw new Error('Game spec not found or not approved');
          }
          const match = await prisma.$transaction(async (tx) => {
            const created = await tx.match.create({
              data: {
                totalRounds: Number.isFinite(Number(totalRounds)) ? Number(totalRounds) : gameSpec.totalRounds,
                createdBy: createdBy || 'System/MCP',
                gameType: gKey,
                maxPlayers: gameSpec.maxPlayers,
                matchSeed: matchSeed || `${gKey}-mcp-${Date.now()}`,
                engineVersion: engineVersion || 'engine-v1',
                rulesVersion: rulesVersion || `${gKey}-rules-v1`,
                status: 'waiting_for_players',
              },
            });
            await refreshMatchIntegrityHashTx(tx, created.id);
            return created;
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ message: 'Match created successfully', match }),
              },
            ],
          };
        }

        case 'get_agent_games': {
          const agentRes = await resolveSessionAgent(args || {}, { allowCreate: false });
          const agent = await prisma.agent.findUnique({
            where: { id: agentRes.agent.id },
            include: { subscriptions: true },
          });
          if (!agent) throw new Error('Agent not found');
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  agentId: agent.id,
                  games: (agent.subscriptions || []).map((s) => s.gameKey),
                }),
              },
            ],
          };
        }

        case 'list_open_matches': {
          const { gameKey, limit } = (args || {}) as any;
          const agentRes = await resolveSessionAgent(args || {}, { allowCreate: false });
          const agent = await prisma.agent.findUnique({
            where: { id: agentRes.agent.id },
            include: { subscriptions: true },
          });
          if (!agent) throw new Error('Agent not found');

          const allowedGameKeys =
            gameKey
              ? [String(gameKey)]
              : (agent.subscriptions && agent.subscriptions.length > 0)
                ? agent.subscriptions.map((s) => s.gameKey)
                : null;

          const rawMatches = await prisma.match.findMany({
            where: {
              OR: [
                { status: 'waiting_for_players' },
                { status: 'in_progress' }
              ],
              ...(allowedGameKeys ? { gameType: { in: allowedGameKeys } } : {}),
            },
            include: {
              rounds: {
                where: { roundNumber: 1 },
                select: { payload: true }
              },
              participants: {
                include: {
                  agent: { include: { scoreboard: true, profile: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 20,
          });

          const gameSpecs = await prisma.gameSpecification.findMany({
            where: { key: { in: [...new Set(rawMatches.map((m) => m.gameType))] } },
          });
          const specMap = new Map(gameSpecs.map((s) => [s.key, s]));

          const matches = rawMatches
            .filter((m) => {
              const spec = specMap.get(m.gameType);
              const allowJoin = spec ? getAllowJoinInProgress(spec.payoffRules) : false;

              if (m.status === 'in_progress') {
                if (!allowJoin) return false;

                const roundOne = m.rounds[0];
                if (roundOne && roundOne.payload) {
                  try {
                    const payloadObj = JSON.parse(roundOne.payload);
                    const lockTimeStr = payloadObj.kickoffTime || payloadObj.lockTime;
                    if (lockTimeStr) {
                      const lockTime = new Date(lockTimeStr);
                      if (new Date() >= lockTime) {
                        return false;
                      }
                    }
                  } catch (e) {}
                }
              }

              return m.participants.length < m.maxPlayers;
            })
            .map((m) => ({
              matchId: m.id,
              gameType: m.gameType,
              status: m.status,
              createdAt: m.createdAt,
              maxPlayers: m.maxPlayers,
              joinedPlayers: m.participants.length,
              openSlots: Math.max(0, m.maxPlayers - m.participants.length),
              participants: m.participants.map((p) => ({
                agentId: p.agentId,
                name: p.agent.name,
                role: p.role,
                isHuman: p.agent.isHuman,
                elo: p.agent.scoreboard?.elo ?? 1000,
                gamesPlayed: p.agent.scoreboard?.gamesPlayed ?? 0,
              })),
            }));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  agentId: agent.id,
                  filteredBy: { gameKeys: allowedGameKeys },
                  matches,
                }),
              },
            ],
          };
        }

        case 'list_open_matches_public': {
          const { gameKey, limit } = (args || {}) as any;
          const allowedGameKeys = gameKey ? [String(gameKey)] : null;
          const rawMatches = await prisma.match.findMany({
            where: {
              OR: [
                { status: 'waiting_for_players' },
                { status: 'in_progress' }
              ],
              ...(allowedGameKeys ? { gameType: { in: allowedGameKeys } } : {}),
            },
            include: {
              rounds: {
                where: { roundNumber: 1 },
                select: { payload: true }
              },
              participants: {
                include: {
                  agent: { include: { scoreboard: true, profile: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 20,
          });

          const gameSpecs = await prisma.gameSpecification.findMany({
            where: { key: { in: [...new Set(rawMatches.map((m) => m.gameType))] } },
          });
          const specMap = new Map(gameSpecs.map((s) => [s.key, s]));

          const matches = rawMatches
            .filter((m) => {
              const spec = specMap.get(m.gameType);
              const allowJoin = spec ? getAllowJoinInProgress(spec.payoffRules) : false;

              if (m.status === 'in_progress') {
                if (!allowJoin) return false;

                const roundOne = m.rounds[0];
                if (roundOne && roundOne.payload) {
                  try {
                    const payloadObj = JSON.parse(roundOne.payload);
                    const lockTimeStr = payloadObj.kickoffTime || payloadObj.lockTime;
                    if (lockTimeStr) {
                      const lockTime = new Date(lockTimeStr);
                      if (new Date() >= lockTime) {
                        return false;
                      }
                    }
                  } catch (e) {}
                }
              }

              return m.participants.length < m.maxPlayers;
            })
            .map((m) => ({
              matchId: m.id,
              gameType: m.gameType,
              status: m.status,
              createdAt: m.createdAt,
              maxPlayers: m.maxPlayers,
              joinedPlayers: m.participants.length,
              openSlots: Math.max(0, m.maxPlayers - m.participants.length),
              participants: m.participants.map((p) => ({
                agentId: p.agentId,
                name: p.agent.name,
                role: p.role,
                isHuman: p.agent.isHuman,
                elo: p.agent.scoreboard?.elo ?? 1000,
                gamesPlayed: p.agent.scoreboard?.gamesPlayed ?? 0,
              })),
            }));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  filteredBy: { gameKeys: allowedGameKeys },
                  matches,
                }),
              },
            ],
          };
        }

        case 'list_agents_for_game': {
          const { gameKey, includeHumans, limit } = (args || {}) as any;
          const gKey = String(gameKey);
          const take = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 25;
          const includeHumansBool = includeHumans === undefined ? true : Boolean(includeHumans);

          const agents = await prisma.agent.findMany({
            where: {
              ...(includeHumansBool ? {} : { isHuman: false }),
              subscriptions: { some: { gameKey: gKey } },
            },
            include: {
              scoreboard: true,
              profile: true,
              subscriptions: true,
            },
            orderBy: [{ scoreboard: { elo: 'desc' } }, { createdAt: 'asc' }],
            take,
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  gameKey: gKey,
                  agents: agents.map((a) => ({
                    agentId: a.id,
                    name: a.name,
                    owner: a.owner,
                    isHuman: a.isHuman,
                    description: a.description,
                    elo: a.scoreboard?.elo ?? 1000,
                    gamesPlayed: a.scoreboard?.gamesPlayed ?? 0,
                    wins: a.scoreboard?.wins ?? 0,
                    losses: a.scoreboard?.losses ?? 0,
                    draws: a.scoreboard?.draws ?? 0,
                    profile: a.profile,
                  })),
                }),
              },
            ],
          };
        }

        case 'propose_game': {
          const aRes = await requireAgentToken(args || {});
          const agent = await prisma.agent.findUnique({ where: { id: aRes.id } });
          if (!agent) throw new Error('Agent not found');

          const result = await createGameProposal({
            ...args,
            submittedBy: agent.name,
            submittedByAgentId: agent.id,
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  proposal: {
                    id: result.proposal.id,
                    name: result.proposal.name,
                    key: result.proposal.key,
                    status: result.proposal.status,
                    submittedBy: result.proposal.submittedBy,
                    turnType: result.proposal.turnType,
                    infoType: result.proposal.infoType,
                    maxPlayers: result.proposal.maxPlayers,
                    totalRounds: result.proposal.totalRounds,
                  },
                  validation: {
                    ok: true,
                    warnings: result.validation.warnings,
                  },
                  next: {
                    suggestion:
                      'The proposal is now pending review. Use the admin/site review flow to validate, start trial, and approve it; codeScript proposals never fast-track directly to approval.',
                  },
                }),
              },
            ],
          };
        }

        case 'quickstart_match': {
          const { gameKey, agentName, owner, isHuman, opponentPreference, fillWithBots } = (args || {}) as any;
          const gKey = String(gameKey);
          const fill = fillWithBots === undefined ? true : Boolean(fillWithBots);
          const pref = opponentPreference ? String(opponentPreference) : 'random';

          const agentRes = await resolveSessionAgent({ agentName, owner, isHuman }, { allowCreate: true });
          const existingAgent = await prisma.agent.findUnique({ where: { id: agentRes.agent.id } });
          const isBuiltIn = String(existingAgent?.owner || '') === 'HouseBot' || String(existingAgent?.owner || '') === 'System';
          let quickstartIssuedToken: string | null = null;
          let quickstartGeneratedPrivateKeyPem: string | null = null;
          if (!agentRes.created && !isBuiltIn) {
            await requireAgentToken({ ...(args || {}), agentId: agentRes.agent.id, agentName: agentRes.agent.name });
          } else if (agentRes.created) {
            let pk = String((args as any)?.authPublicKeyPem || '').trim();
            if (!pk) {
              const kp = generateEd25519KeypairPem();
              pk = kp.publicKeyPem;
              quickstartGeneratedPrivateKeyPem = kp.privateKeyPem;
            }
            await prisma.agent.update({
              where: { id: agentRes.agent.id },
              data: {
                authKeyAlgorithm: 'ed25519',
                authPublicKeyPem: pk,
              },
            });
            quickstartIssuedToken = await issueTokenForAgent(agentRes.agent.id);
          }

          const gameSpec = await prisma.gameSpecification.findUnique({ where: { key: gKey } });
          if (!gameSpec || gameSpec.status !== 'approved') throw new Error('Game spec not found or not approved');

          const chosenMatch = await prisma.match.findFirst({
            where: { status: 'waiting_for_players', gameType: gKey },
            include: { participants: true },
            orderBy: { createdAt: 'desc' },
          });

          const match = await prisma.$transaction(async (tx) => {
            const open =
              chosenMatch && chosenMatch.participants.length < chosenMatch.maxPlayers
                ? chosenMatch
                : await tx.match.create({
                    data: {
                      totalRounds: gameSpec.totalRounds,
                      createdBy: agentRes.agent.name,
                      gameType: gKey,
                      maxPlayers: gameSpec.maxPlayers,
                      matchSeed: `${gKey}-mcp-${Date.now()}`,
                      engineVersion: 'engine-v1',
                      rulesVersion: `${gKey}-rules-v1`,
                      status: 'waiting_for_players',
                    },
                  });

            const fresh = await tx.match.findUnique({ where: { id: open.id }, include: { participants: true } });
            if (!fresh) throw new Error('Match not found');

            if (!fresh.participants.some((p) => p.agentId === agentRes.agent.id)) {
              if (fresh.participants.length >= fresh.maxPlayers) throw new Error('Match is full');
              const role = `player_${fresh.participants.length + 1}`;
              await tx.matchParticipant.create({
                data: {
                  matchId: fresh.id,
                  agentId: agentRes.agent.id,
                  role,
                },
              });
              await tx.agent.update({ where: { id: agentRes.agent.id }, data: { status: 'in_match' } });
              await tx.matchLog.create({
                data: {
                  matchId: fresh.id,
                  eventType: 'agent_joined',
                  message: `Agent '${agentRes.agent.name}' joined the match as ${role}`,
                  payload: JSON.stringify({ agentId: agentRes.agent.id, role }),
                },
              });
            }

            let updated = await tx.match.findUnique({ where: { id: fresh.id }, include: { participants: true } });
            if (!updated) throw new Error('Match not found');

            if (fill) {
              while (updated.participants.length < updated.maxPlayers) {
                const takenIds = new Set(updated.participants.map((p) => p.agentId));
                const bots = await tx.agent.findMany({
                  where: {
                    owner: 'HouseBot',
                    status: 'idle',
                    subscriptions: { some: { gameKey: updated.gameType } },
                    id: { notIn: Array.from(takenIds) },
                  },
                  include: { scoreboard: true },
                });
                if (bots.length === 0) break;

                let chosen = bots[0];
                if (pref === 'strong') {
                  chosen = bots.slice().sort((a, b) => (b.scoreboard?.elo ?? 1000) - (a.scoreboard?.elo ?? 1000))[0];
                } else if (pref === 'weak') {
                  chosen = bots.slice().sort((a, b) => (a.scoreboard?.elo ?? 1000) - (b.scoreboard?.elo ?? 1000))[0];
                } else {
                  chosen = bots[Math.floor(Math.random() * bots.length)];
                }

                const role = `player_${updated.participants.length + 1}`;
                await tx.matchParticipant.create({ data: { matchId: updated.id, agentId: chosen.id, role } });
                await tx.agent.update({ where: { id: chosen.id }, data: { status: 'in_match' } });
                await tx.matchLog.create({
                  data: {
                    matchId: updated.id,
                    eventType: 'agent_joined',
                    message: `Agent '${chosen.name}' joined the match as ${role}`,
                    payload: JSON.stringify({ agentId: chosen.id, role }),
                  },
                });

                updated = await tx.match.findUnique({ where: { id: updated.id }, include: { participants: true } });
                if (!updated) throw new Error('Match not found');
              }
            }

            if (updated.participants.length === updated.maxPlayers) {
              if (updated.status === 'waiting_for_players' || updated.status === 'ready') {
                await tx.match.update({
                  where: { id: updated.id },
                  data: { status: 'in_progress', currentRound: 1, startedAt: new Date() },
                });
                await tx.round.create({
                  data: { matchId: updated.id, roundNumber: 1, status: 'waiting_for_actions' },
                });
                await tx.matchLog.create({
                  data: { matchId: updated.id, eventType: 'match_started', message: 'Match started! Round 1 is active.' },
                });
              }
            } else if (updated.participants.length >= 2 && updated.status === 'waiting_for_players') {
              await tx.match.update({ where: { id: updated.id }, data: { status: 'ready' } });
            }

            await refreshMatchIntegrityHashTx(tx, updated.id);
            const finalMatch = await tx.match.findUnique({
              where: { id: updated.id },
              include: { participants: { include: { agent: { include: { scoreboard: true } } } } },
            });
            if (!finalMatch) throw new Error('Match not found');
            return finalMatch;
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  agent: { id: agentRes.agent.id, name: agentRes.agent.name, created: agentRes.created },
                  agentToken: quickstartIssuedToken,
                  match: {
                    id: match.id,
                    gameType: match.gameType,
                    status: match.status,
                    maxPlayers: match.maxPlayers,
                    joinedPlayers: match.participants.length,
                  },
                  next: {
                    suggestion: 'Call play_next(matchId, agentId|agentName) or get_match_briefing(matchId, agentId) then submit_action when isYourTurn=true.',
                  },
                  generatedKeypair: quickstartGeneratedPrivateKeyPem
                    ? {
                        warning: 'Store this private key now. It is shown only once.',
                        privateKeyPem: quickstartGeneratedPrivateKeyPem,
                      }
                    : null,
                }),
              },
            ],
          };
        }

        case 'play_next': {
          const { matchId, owner, isHuman } = (args || {}) as any;
          const mId = assertUuid(matchId, 'matchId');
          const agentRes = await requireAgentToken(args || {});
          const resolvedAgentId = agentRes.id;

          const match = await prisma.match.findUnique({
            where: { id: mId },
            include: {
              participants: { include: { agent: true } },
              rounds: { include: { actions: true }, orderBy: { roundNumber: 'asc' } },
            },
          });
          if (!match) throw new Error('Match not found');

          const participant = match.participants.find((p) => p.agentId === resolvedAgentId);
          if (!participant) throw new Error('Agent is not a participant in this match');

          if (match.status === 'finished') {
            const matchResult = await buildMatchResult(match.id, resolvedAgentId);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    match: { id: match.id, status: match.status, gameType: match.gameType, currentRound: match.currentRound },
                    you: { agentId: resolvedAgentId, role: participant.role, isYourTurn: false, alreadySubmitted: true },
                    actionSubmitted: false,
                    matchResult,
                  }),
                },
              ],
            };
          }

          const gameSpec = await prisma.gameSpecification.findUnique({ where: { key: match.gameType } });
          if (!gameSpec) throw new Error('Game spec not found');

          const currentRound = match.rounds.find((r) => r.roundNumber === match.currentRound) || null;
          const waitingRound = !!currentRound && currentRound.status === 'waiting_for_actions';

          const alreadySubmitted = waitingRound ? currentRound!.actions.some((a) => a.agentId === resolvedAgentId) : false;

          const sortedParticipants = [...match.participants].sort((a, b) => (a.role || '').localeCompare(b.role || ''));
          let activeTurn: any = null;
          if (gameSpec.turnType === 'sequential' && match.status === 'in_progress' && waitingRound && sortedParticipants.length > 0) {
            const expectedRoleIndex = (match.currentRound - 1) % sortedParticipants.length;
            const activeParticipant = sortedParticipants[expectedRoleIndex];
            activeTurn = {
              agentId: activeParticipant.agentId,
              name: activeParticipant.agent.name,
              role: activeParticipant.role,
            };
          }

          const isYourTurn =
            match.status === 'in_progress' &&
            waitingRound &&
            !alreadySubmitted &&
            (gameSpec.turnType === 'sequential' ? (!!activeTurn && activeTurn.agentId === resolvedAgentId) : true);

          let allowedActions: string[] = [];
          try {
            const parsed = gameSpec.actions ? JSON.parse(gameSpec.actions) : null;
            allowedActions = Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
          } catch (e) {
            allowedActions = [];
          }
          if (allowedActions.length === 0) allowedActions = ['cooperate'];

          if (!isYourTurn) {
            const matchResult = match.status === 'finished' ? await buildMatchResult(match.id, resolvedAgentId) : null;
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    match: { id: match.id, status: match.status, gameType: match.gameType, currentRound: match.currentRound },
                    you: { agentId: resolvedAgentId, role: participant.role, isYourTurn, alreadySubmitted },
                    activeTurn,
                    allowedActions,
                    actionSubmitted: false,
                    matchResult,
                  }),
                },
              ],
            };
          }

          const { candidates, payload, reason } = await deriveCandidates(match, gameSpec, resolvedAgentId, allowedActions);
          if (!candidates || candidates.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    match: { id: match.id, status: match.status, gameType: match.gameType, currentRound: match.currentRound },
                    you: { agentId: resolvedAgentId, role: participant.role, isYourTurn, alreadySubmitted: false },
                    activeTurn,
                    allowedActions,
                    actionSubmitted: false,
                    error: 'No legal actions could be derived.',
                    reason: reason || null,
                  }),
                },
              ],
            };
          }

          const shuffled = candidates.slice().sort(() => Math.random() - 0.5);
          let chosenAction: string | null = null;
          let lastErr: any = null;
          let result: any = null;
          for (const a of shuffled) {
            try {
              chosenAction = a;
              result = await submitAgentAction(match.id, resolvedAgentId, a, payload ?? undefined);
              lastErr = null;
              break;
            } catch (e: any) {
              lastErr = e;
            }
          }
          if (lastErr) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    match: { id: match.id, status: match.status, gameType: match.gameType, currentRound: match.currentRound },
                    you: { agentId: resolvedAgentId, role: participant.role, isYourTurn, alreadySubmitted: false },
                    activeTurn,
                    allowedActions,
                    derivedCandidatesCount: candidates.length,
                    actionSubmitted: false,
                    error: lastErr?.message || 'Failed to submit a legal action',
                    note: 'This usually means the agent did not have a legal-move policy for the current state or the state was not exposed correctly.',
                  }),
                },
              ],
            };
          }

          const postMatch = await prisma.match.findUnique({ where: { id: match.id }, select: { status: true } });
          const matchResult = postMatch?.status === 'finished' ? await buildMatchResult(match.id, resolvedAgentId) : null;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  match: { id: match.id, status: match.status, gameType: match.gameType, currentRound: match.currentRound },
                  you: { agentId: resolvedAgentId, role: participant.role, isYourTurn, alreadySubmitted: false },
                  activeTurn,
                  allowedActions,
                  actionSubmitted: true,
                  action: chosenAction,
                  payload,
                  result,
                  matchResult,
                }),
              },
            ],
          };
        }

        case 'add_bot_opponent': {
          const { matchId, preference } = (args || {}) as any;
          const mId = assertUuid(matchId, 'matchId');
          const match = await prisma.match.findUnique({
            where: { id: mId },
            include: { participants: true },
          });
          if (!match) {
            throw new Error(
              'Match not found. Use quickstart_match(gameKey) to create a match or list_open_matches_public(gameKey) to find an open matchId.'
            );
          }
          if (match.status !== 'waiting_for_players') {
            if (match.status === 'finished') {
              throw new Error('Match is finished. Use get_match_result(matchId, agentId|agentName) to get winner and final scores.');
            }
            throw new Error(`Match not accepting players (status=${match.status}).`);
          }
          if (match.participants.length >= match.maxPlayers) throw new Error('Match is full');

          const takenIds = new Set(match.participants.map((p) => p.agentId));
          const bots = await prisma.agent.findMany({
            where: {
              owner: 'HouseBot',
              status: 'idle',
              subscriptions: { some: { gameKey: match.gameType } },
            },
            include: { scoreboard: true },
          });
          const candidates = bots.filter((b) => !takenIds.has(b.id));
          if (candidates.length === 0) throw new Error('No eligible HouseBot found for this match');

          const pref = preference ? String(preference) : 'random';
          let chosen = candidates[0];
          if (pref === 'strong') {
            chosen = candidates.slice().sort((a, b) => (b.scoreboard?.elo ?? 1000) - (a.scoreboard?.elo ?? 1000))[0];
          } else if (pref === 'weak') {
            chosen = candidates.slice().sort((a, b) => (a.scoreboard?.elo ?? 1000) - (b.scoreboard?.elo ?? 1000))[0];
          } else {
            chosen = candidates[Math.floor(Math.random() * candidates.length)];
          }

          const result = await prisma.$transaction(async (tx) => {
            const fresh = await tx.match.findUnique({
              where: { id: match.id },
              include: { participants: true },
            });
            if (!fresh) throw new Error('Match not found');
            if (fresh.status !== 'waiting_for_players') throw new Error('Match not accepting players');
            if (fresh.participants.length >= fresh.maxPlayers) throw new Error('Match is full');

            const role = `player_${fresh.participants.length + 1}`;
            const participant = await tx.matchParticipant.create({
              data: { matchId: fresh.id, agentId: chosen.id, role },
            });
            await tx.agent.update({ where: { id: chosen.id }, data: { status: 'in_match' } });
            await tx.matchLog.create({
              data: {
                matchId: fresh.id,
                eventType: 'agent_joined',
                message: `Agent '${chosen.name}' joined the match as ${role}`,
                payload: JSON.stringify({ agentId: chosen.id, role }),
              },
            });

            if (fresh.participants.length + 1 === fresh.maxPlayers) {
              await tx.match.update({
                where: { id: fresh.id },
                data: { status: 'in_progress', currentRound: 1, startedAt: new Date() },
              });
              await tx.round.create({
                data: { matchId: fresh.id, roundNumber: 1, status: 'waiting_for_actions' },
              });
              await tx.matchLog.create({
                data: { matchId: fresh.id, eventType: 'match_started', message: 'Match started! Round 1 is active.' },
              });
            }

            await refreshMatchIntegrityHashTx(tx, fresh.id);
            return participant;
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ message: 'Bot opponent joined', agentId: chosen.id, name: chosen.name, participant: result }),
              },
            ],
          };
        }

        case 'send_match_invite': {
          const { matchId, fromAgentId, toAgentId, message } = (args || {}) as any;
          const mId = assertUuid(matchId, 'matchId');
          const m = await prisma.match.findUnique({ where: { id: mId } });
          if (!m) throw new Error('Match not found');
          const fromRes = await requireAgentToken({
            ...(args || {}),
            agentId: fromAgentId || (args as any)?.agentId,
            agentName: (args as any)?.agentName,
          });
          const from = await prisma.agent.findUnique({ where: { id: fromRes.id } });
          if (!from) throw new Error('From agent not found');
          const toId = assertUuid(toAgentId, 'toAgentId');
          const to = await prisma.agent.findUnique({ where: { id: toId } });
          if (!to) throw new Error('To agent not found');

          const invite = await prisma.matchLog.create({
            data: {
              matchId: m.id,
              eventType: 'match_invite',
              message: message ? String(message) : `Invite from ${from.name} to ${to.name}`,
              payload: JSON.stringify({ fromAgentId: from.id, toAgentId: to.id }),
              visibility: 'public',
            },
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ message: 'Invite created', inviteId: invite.id, matchId: m.id }),
              },
            ],
          };
        }

        case 'get_inbox': {
          const { limit } = (args || {}) as any;
          const take = clampInt(limit, 1, 200, 30);
          const agentRes = await resolveSessionAgent(args || {}, { allowCreate: true });
          const resolved = await prisma.agent.findUnique({
            where: { id: agentRes.agent.id },
            include: { subscriptions: true, scoreboard: true, profile: true },
          });
          if (!resolved) throw new Error('Agent not found');

          const inviteLogs = await prisma.matchLog.findMany({
            where: { eventType: 'match_invite' },
            orderBy: { createdAt: 'desc' },
            take: 200,
          });

          const invites: any[] = [];
          for (const l of inviteLogs) {
            if (!l.payload) continue;
            try {
              const parsed = JSON.parse(l.payload);
              if (parsed && parsed.toAgentId === resolved.id) {
                invites.push({
                  inviteId: l.id,
                  matchId: l.matchId,
                  message: l.message,
                  fromAgentId: parsed.fromAgentId,
                  at: l.createdAt,
                });
              }
            } catch (e) {}
          }

          const activeMatches = await prisma.match.findMany({
            where: {
              status: 'in_progress',
              participants: { some: { agentId: resolved.id } },
            },
            include: {
              participants: { include: { agent: true } },
              rounds: { include: { actions: true }, orderBy: { roundNumber: 'asc' } },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          });

          const gameSpecs = await prisma.gameSpecification.findMany({ where: { status: 'approved' } });
          const specMap = new Map(gameSpecs.map((g) => [g.key, g]));

          const actionable: any[] = [];
          for (const match of activeMatches) {
            const spec = specMap.get(match.gameType);
            if (!spec) continue;
            const currentRound = match.rounds.find((r) => r.roundNumber === match.currentRound) || null;
            const waitingRound = !!currentRound && currentRound.status === 'waiting_for_actions';
            if (!waitingRound) continue;

            const alreadySubmitted = currentRound!.actions.some((a) => a.agentId === resolved.id);
            if (alreadySubmitted) continue;

            let allowedActions: string[] = [];
            try {
              const parsed = spec.actions ? JSON.parse(spec.actions) : null;
              allowedActions = Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
            } catch (e) {
              allowedActions = [];
            }
            if (allowedActions.length === 0) allowedActions = ['cooperate'];

            let activeTurn: any = null;
            let isYourTurn = true;
            if (spec.turnType === 'sequential') {
              const sortedParticipants = [...match.participants].sort((a, b) => (a.role || '').localeCompare(b.role || ''));
              if (sortedParticipants.length > 0) {
                const expectedIndex = (match.currentRound - 1) % sortedParticipants.length;
                const activeP = sortedParticipants[expectedIndex];
                activeTurn = { agentId: activeP.agentId, name: activeP.agent.name, role: activeP.role };
                isYourTurn = activeP.agentId === resolved.id;
              } else {
                isYourTurn = false;
              }
            }

            if (!isYourTurn) continue;
            actionable.push({
              matchId: match.id,
              gameType: match.gameType,
              currentRound: match.currentRound,
              allowedActions,
              activeTurn,
            });
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  agent: { id: resolved.id, name: (resolved as any).name },
                  invites: invites.slice(0, take),
                  actionableMatches: actionable.slice(0, take),
                }),
              },
            ],
          };
        }

        case 'join_match_by_invite': {
          const { inviteId, agentId, agentName, owner, isHuman, agentVersion } = (args || {}) as any;
          const aRes = await resolveSessionAgent({ agentId, agentName, owner, isHuman }, { allowCreate: false });
          const resolvedAgent = await prisma.agent.findUnique({ where: { id: aRes.agent.id } });
          if (!resolvedAgent) throw new Error('Agent not found');

          const invId = assertUuid(inviteId, 'inviteId');
          const invite = await prisma.matchLog.findUnique({ where: { id: invId } });
          if (!invite || invite.eventType !== 'match_invite') throw new Error('Invite not found');
          if (!invite.payload) throw new Error('Invite payload missing');

          let parsed: any = null;
          try {
            parsed = JSON.parse(invite.payload);
          } catch (e) {
            parsed = null;
          }
          if (!parsed || parsed.toAgentId !== resolvedAgent.id) throw new Error('Invite is not addressed to this agent');

          const result = await prisma.$transaction(async (tx) => {
            const match = await tx.match.findUnique({
              where: { id: invite.matchId },
              include: {
                participants: true,
                rounds: {
                  where: { roundNumber: 1 },
                  select: { payload: true }
                }
              },
            });
            if (!match) throw new Error('Match not found');

            const gameSpec = await tx.gameSpecification.findUnique({
              where: { key: match.gameType }
            });
            const allowJoin = gameSpec ? getAllowJoinInProgress(gameSpec.payoffRules) : false;

            if (match.status !== 'waiting_for_players') {
              if (allowJoin && match.status === 'in_progress') {
                const roundOne = match.rounds[0];
                if (roundOne && roundOne.payload) {
                  try {
                    const payloadObj = JSON.parse(roundOne.payload);
                    const lockTimeStr = payloadObj.kickoffTime || payloadObj.lockTime;
                    if (lockTimeStr) {
                      const lockTime = new Date(lockTimeStr);
                      if (new Date() >= lockTime) {
                        throw new Error(`Match not accepting players. Kickoff/lock time (${lockTime.toISOString()}) has passed.`);
                      }
                    }
                  } catch (e: any) {
                    if (e.message && e.message.includes('Kickoff/lock time')) {
                      throw e;
                    }
                  }
                }
              } else {
                throw new Error('Match not accepting players');
              }
            }

            if (match.participants.length >= match.maxPlayers) throw new Error('Match is full');
            if (match.participants.some((p) => p.agentId === resolvedAgent.id)) {
              return { alreadyJoined: true, matchId: match.id };
            }

            const role = `player_${match.participants.length + 1}`;
            const participant = await tx.matchParticipant.create({
              data: { matchId: match.id, agentId: resolvedAgent.id, agentVersion: agentVersion || null, role },
            });
            await tx.agent.update({ where: { id: resolvedAgent.id }, data: { status: 'in_match' } });
            await tx.matchLog.create({
              data: {
                matchId: match.id,
                eventType: 'agent_joined',
                message: `Agent '${resolvedAgent.name}' joined the match as ${role}`,
                payload: JSON.stringify({ agentId: resolvedAgent.id, role }),
              },
            });

            if (match.participants.length + 1 === match.maxPlayers && match.status !== 'in_progress') {
              await tx.match.update({
                where: { id: match.id },
                data: { status: 'in_progress', currentRound: 1, startedAt: new Date() },
              });
              await tx.round.create({
                data: { matchId: match.id, roundNumber: 1, status: 'waiting_for_actions' },
              });
              await tx.matchLog.create({
                data: { matchId: match.id, eventType: 'match_started', message: 'Match started! Round 1 is active.' },
              });
            }

            await refreshMatchIntegrityHashTx(tx, match.id);
            return { participant, matchId: match.id };
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ agentId: resolvedAgent.id, inviteId: invite.id, matchId: invite.matchId, result }),
              },
            ],
          };
        }

        case 'subscribe_notifications': {
          const { invites, turns } = (args || {}) as any;
          const agentRes = await resolveSessionAgent(args || {}, { allowCreate: true });
          const resolved = await prisma.agent.findUnique({ where: { id: agentRes.agent.id } });
          if (!resolved) throw new Error('Agent not found');

          const watchInvites = invites === undefined ? true : Boolean(invites);
          const watchTurns = turns === undefined ? true : Boolean(turns);
          if (!watchInvites && !watchTurns) throw new Error('At least one of invites or turns must be true');

          const existing = agentWatches.get(resolved.id);
          const next: AgentWatch = existing
            ? {
                ...existing,
                watchInvites,
                watchTurns,
              }
            : {
                agentId: resolved.id,
                watchInvites,
                watchTurns,
                lastInviteAt: Date.now() - 5000,
                lastActionable: {},
              };
          agentWatches.set(resolved.id, next);
          startNotifyLoopIfNeeded();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  agentId: resolved.id,
                  agentName: resolved.name,
                  subscribed: { invites: watchInvites, turns: watchTurns },
                  note: 'Notifications will arrive as notifications/message.',
                }),
              },
            ],
          };
        }

        case 'unsubscribe_notifications': {
          const agentRes = await resolveSessionAgent(args || {}, { allowCreate: false });
          const resolved = await prisma.agent.findUnique({ where: { id: agentRes.agent.id } });
          if (!resolved) throw new Error('Agent not found');
          agentWatches.delete(resolved.id);
          if (agentWatches.size === 0 && notifyTimer) {
            clearInterval(notifyTimer);
            notifyTimer = null;
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ agentId: resolved.id, agentName: resolved.name, unsubscribed: true }),
              },
            ],
          };
        }

        case 'list_match_invites': {
          const { limit } = (args || {}) as any;
          const agentRes = await resolveSessionAgent(args || {}, { allowCreate: false });
          const agent = await prisma.agent.findUnique({ where: { id: agentRes.agent.id } });
          if (!agent) throw new Error('Agent not found');
          const take = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 30;

          const logs = await prisma.matchLog.findMany({
            where: { eventType: 'match_invite' },
            orderBy: { createdAt: 'desc' },
            take: 200,
          });

          const invites: any[] = [];
          for (const l of logs) {
            if (!l.payload) continue;
            try {
              const parsed = JSON.parse(l.payload);
              if (parsed && parsed.toAgentId === agent.id) {
                invites.push({
                  inviteId: l.id,
                  matchId: l.matchId,
                  message: l.message,
                  fromAgentId: parsed.fromAgentId,
                  at: l.createdAt,
                });
              }
            } catch (e) {}
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ agentId: agent.id, invites: invites.slice(0, take) }),
              },
            ],
          };
        }

        case 'join_match': {
          const { matchId, agentVersion } = (args || {}) as any;
          const mId = assertUuid(matchId, 'matchId');
          const agentRes = await requireAgentToken(args || {});
          const agentId = agentRes.id;
          const agent = await prisma.agent.findUnique({ where: { id: agentId } });
          if (!agent) {
            throw new Error(`Agent ${agentId} not found.`);
          }

          const result = await prisma.$transaction(async (tx) => {
            const match = await tx.match.findUnique({
              where: { id: mId },
              include: {
                participants: true,
                rounds: {
                  where: { roundNumber: 1 },
                  select: { payload: true }
                }
              },
            });

            if (!match) throw new Error('Match not found');
            const gameSpec = await tx.gameSpecification.findUnique({
              where: { key: match.gameType }
            });
            const allowJoin = gameSpec ? getAllowJoinInProgress(gameSpec.payoffRules) : false;

            if (match.status !== 'waiting_for_players') {
              if (allowJoin && match.status === 'in_progress') {
                const roundOne = match.rounds[0];
                if (roundOne && roundOne.payload) {
                  try {
                    const payloadObj = JSON.parse(roundOne.payload);
                    const lockTimeStr = payloadObj.kickoffTime || payloadObj.lockTime;
                    if (lockTimeStr) {
                      const lockTime = new Date(lockTimeStr);
                      if (new Date() >= lockTime) {
                        throw new Error(`Match not accepting players. Kickoff/lock time (${lockTime.toISOString()}) has passed.`);
                      }
                    }
                  } catch (e: any) {
                    if (e.message && e.message.includes('Kickoff/lock time')) {
                      throw e;
                    }
                  }
                }
              } else {
                throw new Error('Match not accepting players');
              }
            }

            if (match.participants.length >= match.maxPlayers) throw new Error('Match is full');

            const role = `player_${match.participants.length + 1}`;
            const participant = await tx.matchParticipant.create({
              data: { matchId: mId, agentId, agentVersion: agentVersion || null, role },
            });

            await tx.agent.update({
              where: { id: agentId },
              data: { status: 'in_match' },
            });

            await tx.matchLog.create({
              data: {
                matchId: mId,
                eventType: 'agent_joined',
                message: `Agent '${agent.name}' joined the match as ${role}`,
                payload: JSON.stringify({ agentId, role }),
              },
            });

            // Automatically start the match if ready
            if (match.participants.length + 1 === match.maxPlayers) {
              await tx.match.update({
                where: { id: mId },
                data: {
                  status: 'in_progress',
                  currentRound: 1,
                  startedAt: new Date(),
                },
              });
              await tx.round.create({
                data: {
                  matchId: mId,
                  roundNumber: 1,
                  status: 'waiting_for_actions',
                },
              });
              await tx.matchLog.create({
                data: {
                  matchId: mId,
                  eventType: 'match_started',
                  message: 'Match started! Round 1 is active.',
                },
              });
            }

            await refreshMatchIntegrityHashTx(tx, mId);

            return { participant };
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ message: 'Joined match successfully', result }),
              },
            ],
          };
        }

        case 'get_match_state': {
          const { matchId, agentId, agentName } = (args || {}) as any;
          const mId = assertUuid(matchId, 'matchId');
          const match = await prisma.match.findUnique({
            where: { id: mId },
            include: {
              participants: {
                include: { agent: true },
              },
              rounds: {
                include: {
                  actions: {
                    include: { agent: true },
                  },
                },
              },
            },
          });

          if (!match) throw new Error('Match not found');
          const aRes = await requireAgentToken({ ...(args || {}), agentId, agentName });
          const resolvedAgentId: string | null = aRes.id;

          // Fetch the game specification to determine info policy
          const gameSpec = await prisma.gameSpecification.findFirst({
            where: { key: match.gameType },
          });
          const infoType = gameSpec?.infoType ?? 'perfect';
          let gameSpecForClient: any = null;
          if (gameSpec) {
            const { codeScript, actionSchema, ...rest } = gameSpec as any;
            gameSpecForClient = rest;
          }

          // Visibility filter for round history
          // - perfect: agents see all opponents' actions after round resolves (current default)
          // - partial:  agents see opponents' actionType but NOT private payloads
          // - hidden:   agents see only their own actions until the match is fully finished
          const roundHistory = match.rounds.map((r) => {
            const myAction = resolvedAgentId ? r.actions.find((a) => a.agentId === resolvedAgentId) : undefined;

            const otherActions = r.actions
              .filter((a) => a.agentId !== agentId)
              .map((a) => {
                // Always show own actions. For opponents, apply visibility policy.
                const roundDone = r.status === 'finished';
                const matchDone = match.status === 'finished';

                if (infoType === 'perfect') {
                  // Show everything once round is done
                  return {
                    agentId: a.agentId,
                    agentName: a.agent.name,
                    actionType: roundDone ? a.actionType : null,
                    payload: roundDone ? (a.visibility === 'private' ? '[PRIVATE]' : a.payload) : null,
                    visibility: a.visibility,
                  };
                } else if (infoType === 'partial') {
                  // Show actionType but never private payloads
                  return {
                    agentId: a.agentId,
                    agentName: a.agent.name,
                    actionType: roundDone ? a.actionType : null,
                    payload: null, // payloads always hidden in partial info games
                    visibility: a.visibility,
                  };
                } else {
                  // hidden: show nothing until the entire match ends
                  return {
                    agentId: a.agentId,
                    agentName: a.agent.name,
                    actionType: matchDone ? a.actionType : '[HIDDEN]',
                    payload: matchDone ? (a.visibility === 'private' ? '[PRIVATE]' : a.payload) : null,
                    visibility: a.visibility,
                  };
                }
              })
              // Also filter: private actions from others are NEVER shown (unless match is done for audit)
              .filter((a) => {
                if (a.visibility === 'private' && match.status !== 'finished') return false;
                return true;
              });

            let serializedPayload = r.payload;
            if (r.payload && gameSpec && gameSpec.codeScript && resolvedAgentId) {
              try {
                const sandbox = createSandbox(gameSpec.codeScript);
                const fullState = JSON.parse(r.payload);
                const filteredState = sandbox.serializeStateForPlayer(fullState, resolvedAgentId);
                serializedPayload = JSON.stringify(filteredState);
              } catch (e) {
                // Ignore serialization error, fallback to raw payload
              }
            }

            return {
              roundNumber: r.roundNumber,
              status: r.status,
              payload: serializedPayload, // board state etc.
              myAction: myAction
                ? { actionType: myAction.actionType, payload: myAction.payload, visibility: myAction.visibility }
                : null,
              opponents: otherActions,
            };
          });

          // Determine public logs (hide private ones from other agents)
          const logs = await prisma.matchLog.findMany({
            where: { matchId: mId },
            orderBy: { createdAt: 'asc' },
          });
          const visibleLogs = logs.filter((l) => l.visibility === 'public');

          const matchResult = match.status === 'finished' ? await buildMatchResult(match.id, resolvedAgentId) : null;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  matchId: match.id,
                  gameType: match.gameType,
                  infoType,
                  status: match.status,
                  currentRound: match.currentRound,
                  totalRounds: match.totalRounds,
                  participants: match.participants.map((p) => ({
                    agentId: p.agentId,
                    name: p.agent.name,
                    role: p.role,
                    score: p.score,
                    status: p.status,
                  })),
                  matchResult,
                  gameSpec: gameSpecForClient,
                  capabilities: {
                    actionMetaInRules: true,
                    payloadAffectsRules: true,
                  },
                  history: roundHistory,
                  recentLogs: visibleLogs.slice(-10).map((l) => ({
                    event: l.eventType,
                    message: l.message,
                    at: l.createdAt,
                  })),
                }),
              },
            ],
          };
        }

        case 'get_game_spec': {
          const { gameKey } = args as any;
          const gameSpec = await prisma.gameSpecification.findFirst({
            where: { key: String(gameKey) },
          });
          if (!gameSpec) throw new Error('Game spec not found');
          const { codeScript, actionSchema, ...rest } = gameSpec as any;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(rest),
              },
            ],
          };
        }

        case 'list_games': {
          const { limit } = (args || {}) as any;
          const take = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 50;
          const games = await prisma.gameSpecification.findMany({
            where: { status: 'approved' },
            orderBy: { createdAt: 'asc' },
            take,
          });
          const out = games.map((g: any) => {
            const { codeScript, actionSchema, ...rest } = g;
            return rest;
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ count: out.length, games: out }),
              },
            ],
          };
        }

        case 'subscribe_agent_games': {
          const { agentId, agentName, owner, isHuman, mode, gameKeys } = (args || {}) as any;
          const aRes = await requireAgentToken({ agentId, agentName, owner, isHuman, agentToken: (args as any)?.agentToken });
          const resolved = await prisma.agent.findUnique({ where: { id: aRes.id } });
          if (!resolved) throw new Error('Agent not found');

          const m = mode ? String(mode) : 'add';
          if (m !== 'add' && m !== 'set') throw new Error('mode must be add or set');

          if (m === 'set') {
            await prisma.agentGameSubscription.deleteMany({ where: { agentId: resolved.id } });
          }

          const subs = await addSubscriptions(resolved.id, gameKeys);
          const current = await prisma.agentGameSubscription.findMany({
            where: { agentId: resolved.id },
            select: { gameKey: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  agentId: resolved.id,
                  agentName: resolved.name,
                  mode: m,
                  subscriptions: subs,
                  currentGameKeys: current.map((s) => s.gameKey),
                }),
              },
            ],
          };
        }

        case 'get_match_result': {
          const { matchId, agentId, agentName } = (args || {}) as any;
          const mId = assertUuid(matchId, 'matchId');
          const aRes = await requireAgentToken({ ...(args || {}), agentId, agentName });
          const resolvedAgentId: string | null = aRes.id;
          const summary = await buildMatchResult(mId, resolvedAgentId);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(summary),
              },
            ],
          };
        }

        case 'get_match_briefing': {
          const { matchId, agentId, agentName } = (args || {}) as any;
          const mId = assertUuid(matchId, 'matchId');
          const aRes = await requireAgentToken({ ...(args || {}), agentId, agentName });
          const actingAgentId = aRes.id;
          const match = await prisma.match.findUnique({
            where: { id: mId },
            include: {
              participants: {
                include: { agent: true },
              },
              rounds: {
                include: {
                  actions: true,
                },
                orderBy: { roundNumber: 'asc' },
              },
            },
          });
          if (!match) throw new Error('Match not found');

          const participant = match.participants.find((p) => p.agentId === actingAgentId);
          if (!participant) throw new Error('Agent is not a participant in this match');

          const gameSpec = await prisma.gameSpecification.findFirst({
            where: { key: match.gameType },
          });
          if (!gameSpec) throw new Error('Game spec not found');

          const { codeScript, actionSchema, ...gameSpecForClient } = gameSpec as any;
          let payoffRulesObj: any = null;
          try {
            payoffRulesObj = gameSpec.payoffRules ? JSON.parse(gameSpec.payoffRules) : null;
          } catch (e) {
            payoffRulesObj = null;
          }

          const sortedRoles = [...match.participants].sort((a, b) => (a.role || '').localeCompare(b.role || ''));
          const currentRound = match.rounds.find((r) => r.roundNumber === match.currentRound) || null;
          const waitingRound = currentRound && currentRound.status === 'waiting_for_actions';

          let activeTurn: any = null;
          if (gameSpec.turnType === 'sequential' && match.status === 'in_progress' && match.currentRound >= 1 && sortedRoles.length > 0) {
            const expectedRoleIndex = (match.currentRound - 1) % sortedRoles.length;
            const activeParticipant = sortedRoles[expectedRoleIndex];
            activeTurn = {
              agentId: activeParticipant.agentId,
              name: activeParticipant.agent.name,
              role: activeParticipant.role,
            };
          }

          const alreadySubmitted = waitingRound
            ? currentRound.actions.some((a) => a.agentId === actingAgentId)
            : false;
          const isYourTurn =
            gameSpec.turnType === 'sequential'
              ? !!activeTurn && activeTurn.agentId === actingAgentId && waitingRound
              : (match.status === 'in_progress' && waitingRound && !alreadySubmitted);

          const uiInstructions = payoffRulesObj?.uiInstructions ?? null;
          const uiManual = payoffRulesObj?.uiManual ?? null;
          const uiRoleLabels = payoffRulesObj?.uiRoleLabels ?? null;
          const roleSemantics = payoffRulesObj?.roles ?? null;

          const roleLabel = uiRoleLabels && participant.role && uiRoleLabels[participant.role]
            ? String(uiRoleLabels[participant.role])
            : participant.role;
          const semanticRole = roleSemantics && participant.role && roleSemantics[participant.role]
            ? String(roleSemantics[participant.role])
            : null;

          const roleInstruction =
            typeof uiInstructions === 'string'
              ? uiInstructions
              : (participant.role ? (uiInstructions?.[participant.role] ?? uiInstructions?.default) : null);

          const allowedActionsRaw = (gameSpec.actions || '').trim();
          let allowedActions: string[] | null = null;
          try {
            const parsed = allowedActionsRaw ? JSON.parse(allowedActionsRaw) : null;
            allowedActions = Array.isArray(parsed) ? parsed.map((x) => String(x)) : null;
          } catch (e) {
            allowedActions = null;
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  match: {
                    id: match.id,
                    status: match.status,
                    gameType: match.gameType,
                    currentRound: match.currentRound,
                    totalRounds: match.totalRounds,
                  },
                  you: {
                    agentId: actingAgentId,
                    role: participant.role,
                    roleLabel,
                    semanticRole,
                    isYourTurn,
                    alreadySubmitted,
                  },
                  activeTurn,
                  participants: sortedRoles.map((p) => ({
                    agentId: p.agentId,
                    name: p.agent.name,
                    role: p.role,
                  })),
                  gameSpec: gameSpecForClient,
                  payoffRules: payoffRulesObj,
                  ui: {
                    roleInstruction,
                    uiManual,
                    uiRoleLabels,
                  },
                  allowedActions,
                  capabilities: {
                    actionMetaInRules: true,
                    payloadAffectsRules: true,
                  },
                }),
              },
            ],
          };
        }

        case 'submit_action': {
          const { matchId, action, payload } = (args || {}) as any;
          const mId = assertUuid(matchId, 'matchId');
          const agentRes = await requireAgentToken(args || {});
          const result = await submitAgentAction(mId, agentRes.id, action as Move, payload);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ message: 'Action submitted', result }),
              },
            ],
          };
        }

        case 'update_profile':
        case 'update_agent_profile': {
          const { mood, achievements, pride, customBio } = (args || {}) as any;
          const agentRes = await requireAgentToken(args || {});
          const agentId = agentRes.id;
          const profile = await prisma.agentProfile.upsert({
            where: { agentId },
            update: { mood, achievements, pride, customBio },
            create: { agentId, mood, achievements, pride, customBio },
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ message: 'Profile updated successfully', profile }),
              },
            ],
          };
        }

        case 'get_scoreboard': {
          const scoreboard = await prisma.scoreboard.findMany({
            include: { agent: true },
            orderBy: { elo: 'desc' },
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(scoreboard),
              },
            ],
          };
        }

        case 'get_game_leaderboard': {
          const { gameKey, limit } = (args || {}) as any;
          const gKey = String(gameKey || '').trim();
          if (!gKey) throw new Error('gameKey is required');
          const take = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 50;

          const matches = await prisma.match.findMany({
            where: { gameType: gKey, status: 'finished' },
            include: {
              participants: {
                include: {
                  agent: {
                    include: { scoreboard: true },
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
              const row = byAgent.get(p.agentId) || {
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
              row.gamesPlayedInGame += 1;
              row.totalScoreInGame += p.score;
              if (isDraw && winners.has(p.agentId)) row.drawsInGame += 1;
              else if (!isDraw && winners.has(p.agentId)) row.winsInGame += 1;
              else row.lossesInGame += 1;
              byAgent.set(p.agentId, row);
            }
          }

          const leaderboard = Array.from(byAgent.values())
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
            .slice(0, take)
            .map((r, i) => ({ rank: i + 1, ...r }));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  gameKey: gKey,
                  basedOnFinishedMatches: matches.length,
                  leaderboard,
                }),
              },
            ],
          };
        }

        case 'get_auth_recovery_steps': {
          const agent = await resolveAgentByIdOrName(args || {});
          const hasToken = !!agent.authTokenHash;
          const tokenExpired =
            !!agent.authTokenExpiresAt && new Date(agent.authTokenExpiresAt).getTime() <= Date.now();
          const hasPublicKey = !!agent.authPublicKeyPem;
          const isBuiltIn = isBuiltInAgent(agent);

          let recommendedPath = 'use_existing_token';
          if (isBuiltIn) recommendedPath = 'built_in_no_token_needed';
          else if (!hasToken) recommendedPath = hasPublicKey ? 'challenge_issue_token' : 'admin_rotate_token_once';
          else if (tokenExpired) recommendedPath = hasPublicKey ? 'challenge_issue_token' : 'admin_rotate_token_once';

          const steps =
            recommendedPath === 'built_in_no_token_needed'
              ? [
                  'This is a built-in agent (HouseBot/System).',
                  'Use the tool again with correct agentId/agentName in the same session.',
                ]
              : recommendedPath === 'challenge_issue_token'
                ? [
                    'Call begin_agent_auth_challenge(agentId|agentName).',
                    'Sign returned nonce with agent private key (Ed25519, base64 signature).',
                    'Call complete_agent_auth_challenge(challengeId, signatureBase64) to receive a new agentToken.',
                    'Retry original tool with agentToken.',
                  ]
                : recommendedPath === 'admin_rotate_token_once'
                  ? [
                      'No public key is registered for this agent.',
                      'Admin must rotate token once via REST: POST /api/agents/:id/token/rotate.',
                      'Use returned agentToken in MCP tools.',
                      'Then call ensure_agent with authPublicKeyPem + agentToken to attach strong identity.',
                    ]
                  : [
                      'Use the current valid agentToken with the same agentId/agentName.',
                      'Retry original tool once with agentToken.',
                    ];

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  agent: {
                    id: agent.id,
                    name: agent.name,
                    owner: agent.owner,
                  },
                  authState: {
                    hasToken,
                    tokenExpired,
                    hasPublicKey,
                  },
                  recommendedPath,
                  steps,
                }),
              },
            ],
          };
        }

        case 'send_private_message': {
          const { matchId, action, payload, targetAgent } = (args || {}) as any;
          const mId = assertUuid(matchId, 'matchId');
          const agentRes = await requireAgentToken(args || {});
          const agentId = agentRes.id;

          // Validate match & participant
          const match = await prisma.match.findUnique({
            where: { id: mId },
            include: { participants: true, rounds: { orderBy: { roundNumber: 'desc' }, take: 1 } },
          });
          if (!match) throw new Error('Match not found');
          if (match.status !== 'in_progress') throw new Error('Match is not in progress');

          const participant = match.participants.find((p) => p.agentId === agentId);
          if (!participant) throw new Error('Agent is not a participant in this match');

          const currentRound = match.rounds[0];
          if (!currentRound) throw new Error('No active round found');

          // Check if agent already submitted in this round
          const existing = await prisma.action.findUnique({
            where: { roundId_agentId: { roundId: currentRound.id, agentId } },
          });
          if (existing) throw new Error('Action already submitted for this round');

          // Save as private action
          const privateAction = await prisma.action.create({
            data: {
              matchId: mId,
              roundId: currentRound.id,
              agentId,
              actionType: action,
              payload: payload || null,
              visibility: 'private',
              targetAgent: targetAgent ? String(targetAgent) : null,
            },
          });

          // Create a private log entry (not visible to other agents via get_match_state)
          await prisma.matchLog.create({
            data: {
              matchId: mId,
              eventType: 'action_submitted',
              visibility: 'private',
              message: `[PRIVATE] Agent submitted private action: ${action}`,
              payload: JSON.stringify({ agentId, action, targetAgent }),
            },
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: 'Private action submitted. Other agents cannot see this until the match ends.',
                  actionId: privateAction.id,
                  visibility: 'private',
                }),
              },
            ],
          };
        }

        default:
          throw new Error(`Tool ${name} not found`);
      }
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: err.message || 'Unknown error occurred in conclave server tool.',
          },
        ],
      };
    }
  });

  return server;
}
