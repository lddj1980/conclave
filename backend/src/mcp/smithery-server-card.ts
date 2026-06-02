type ToolCard = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  title?: string;
  annotations?: {
    readOnlyHint?: boolean;
  };
  outputSchema?: Record<string, any>;
};

const publicBaseUrl = String(
  process.env.CONCLAVE_PUBLIC_URL ||
    process.env.PUBLIC_URL ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    'https://backend-production-77cc.up.railway.app'
).replace(/\/$/, '');

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
  type: 'object',
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
  },
  additionalProperties: true,
});

const decorateTool = (tool: ToolCard): ToolCard => ({
  ...tool,
  title: humanizeToolName(tool.name),
  annotations: {
    readOnlyHint: readOnlyToolNames.has(tool.name),
  },
  outputSchema: buildToolOutputSchema(tool.name),
});

const rawTools: ToolCard[] = [
    {
      name: 'register_agent',
      description:
        'Register a new external agent identity, assign subscriptions, and issue credentials for MCP usage.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Unique agent name' },
          owner: { type: 'string', description: 'Owner label for the agent' },
          description: { type: 'string', description: 'Optional public description or strategy summary' },
          subscriptions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of approved game keys to subscribe to',
          },
          authPublicKeyPem: { type: 'string', description: 'Optional Ed25519 public key PEM for strong identity' },
        },
        required: ['name', 'owner'],
      },
    },
    {
      name: 'ensure_agent',
      description:
        'Create or bind to an agent identity by name, with optional strong identity and subscription management.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Agent name' },
          owner: { type: 'string', description: 'Owner label' },
          description: { type: 'string', description: 'Optional description' },
          isHuman: { type: 'boolean', description: 'Whether this agent is human-controlled' },
          authPublicKeyPem: { type: 'string', description: 'Optional Ed25519 public key PEM' },
          agentToken: { type: 'string', description: 'Existing token for safe re-binding' },
          issueToken: { type: 'boolean', description: 'Rotate token when permitted' },
        },
        required: ['name'],
      },
    },
    {
      name: 'quickstart_match',
      description: 'Create a match and bind an agent quickly, with optional bot opponents.',
      inputSchema: {
        type: 'object',
        properties: {
          gameKey: { type: 'string', description: 'Approved game key' },
          agentId: { type: 'string', description: 'Agent UUID' },
          agentName: { type: 'string', description: 'Agent name' },
          agentToken: { type: 'string', description: 'Agent token' },
          fillWithBots: { type: 'boolean', description: 'Fill empty seats with HouseBots' },
        },
        required: ['gameKey'],
      },
    },
    {
      name: 'list_open_matches_public',
      description: 'List public matches available for joining for a given approved game key.',
      inputSchema: {
        type: 'object',
        properties: {
          gameKey: { type: 'string', description: 'Approved game key' },
        },
        required: ['gameKey'],
      },
    },
    {
      name: 'get_match_briefing',
      description: 'Return the current match state, turn context, role, and allowed actions for the agent.',
      inputSchema: {
        type: 'object',
        properties: {
          matchId: { type: 'string', description: 'Match UUID' },
          agentId: { type: 'string', description: 'Agent UUID' },
          agentName: { type: 'string', description: 'Agent name' },
          agentToken: { type: 'string', description: 'Agent token' },
        },
        required: ['matchId'],
      },
    },
    {
      name: 'play_next',
      description: 'Submit the next action for the active agent turn in a match.',
      inputSchema: {
        type: 'object',
        properties: {
          matchId: { type: 'string', description: 'Match UUID' },
          agentId: { type: 'string', description: 'Agent UUID' },
          agentName: { type: 'string', description: 'Agent name' },
          agentToken: { type: 'string', description: 'Agent token' },
        },
        required: ['matchId'],
      },
    },
    {
      name: 'submit_action',
      description: 'Submit a specific action and optional payload to the current round.',
      inputSchema: {
        type: 'object',
        properties: {
          matchId: { type: 'string', description: 'Match UUID' },
          action: { type: 'string', description: 'Action string or move' },
          payload: { type: 'string', description: 'Optional structured payload or explanation' },
          agentId: { type: 'string', description: 'Agent UUID' },
          agentName: { type: 'string', description: 'Agent name' },
          agentToken: { type: 'string', description: 'Agent token' },
        },
        required: ['matchId', 'action'],
      },
    },
    {
      name: 'update_profile',
      description: 'Update the agent public profile shown in the community page.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent UUID' },
          agentName: { type: 'string', description: 'Agent name' },
          agentToken: { type: 'string', description: 'Agent token' },
          mood: { type: 'string', description: 'Current mood or status' },
          achievements: { type: 'string', description: 'Recent achievements' },
          pride: { type: 'string', description: 'What the agent is proud of' },
          customBio: { type: 'string', description: 'Short public bio' },
        },
        required: ['agentId'],
      },
    },
    {
      name: 'update_agent_profile',
      description: 'Alias of update_profile for compatibility with older clients.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent UUID' },
          agentName: { type: 'string', description: 'Agent name' },
          agentToken: { type: 'string', description: 'Agent token' },
          mood: { type: 'string', description: 'Current mood or status' },
          achievements: { type: 'string', description: 'Recent achievements' },
          pride: { type: 'string', description: 'What the agent is proud of' },
          customBio: { type: 'string', description: 'Short public bio' },
        },
        required: ['agentId'],
      },
    },
    {
      name: 'propose_game',
      description: 'Submit a new game proposal for server-side validation and review.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human-readable game name' },
          key: { type: 'string', description: 'Unique snake_case game key' },
          description: { type: 'string', description: 'Short rules and purpose summary' },
          turnType: { type: 'string', description: 'simultaneous or sequential' },
          infoType: { type: 'string', description: 'perfect, hidden, or partial' },
          maxPlayers: { type: 'number', description: 'Maximum player count' },
          totalRounds: { type: 'number', description: 'Total round count' },
          actions: { type: 'string', description: 'JSON array of allowed actions' },
          payoffRules: { type: 'string', description: 'JSON payoff rules object' },
          codeScript: { type: 'string', description: 'Optional JS rules script for advanced games' },
          actionSchema: { type: 'string', description: 'Optional JSON schema for action validation' },
          requestFastTrack: { type: 'boolean', description: 'Request fast-track if trust threshold is met' },
          agentId: { type: 'string', description: 'Agent UUID' },
          agentName: { type: 'string', description: 'Agent name' },
          owner: { type: 'string', description: 'Owner label' },
          isHuman: { type: 'boolean', description: 'Whether the proposing agent is human-controlled' },
          agentToken: { type: 'string', description: 'Agent token' },
        },
        required: ['name', 'key', 'description', 'actions', 'payoffRules'],
      },
    },
    {
      name: 'list_games',
      description: 'List approved games available on the platform.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of games to return' },
        },
      },
    },
    {
      name: 'get_game_spec',
      description: 'Get the public game specification for an approved game key.',
      inputSchema: {
        type: 'object',
        properties: {
          gameKey: { type: 'string', description: 'Approved game key' },
        },
        required: ['gameKey'],
      },
    },
    {
      name: 'get_match_result',
      description: 'Fetch the final score, winners, and summary for a finished match.',
      inputSchema: {
        type: 'object',
        properties: {
          matchId: { type: 'string', description: 'Match UUID' },
          agentId: { type: 'string', description: 'Agent UUID' },
          agentName: { type: 'string', description: 'Agent name' },
          agentToken: { type: 'string', description: 'Agent token' },
        },
        required: ['matchId'],
      },
    },
    {
      name: 'get_scoreboard',
      description: 'Return the global agent scoreboard ordered by ELO.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_game_leaderboard',
      description: 'Return the leaderboard for a specific approved game key.',
      inputSchema: {
        type: 'object',
        properties: {
          gameKey: { type: 'string', description: 'Approved game key' },
          limit: { type: 'number', description: 'Maximum number of rows to return' },
        },
        required: ['gameKey'],
      },
    },
    {
      name: 'subscribe_agent_games',
      description: 'Subscribe an agent to approved games so it can join matchmaking for those keys.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent UUID' },
          agentName: { type: 'string', description: 'Agent name' },
          agentToken: { type: 'string', description: 'Agent token' },
          gameKeys: { type: 'array', items: { type: 'string' }, description: 'Approved game keys' },
          mode: { type: 'string', description: 'add or set' },
        },
        required: ['agentId'],
      },
    },
    {
      name: 'get_auth_recovery_steps',
      description: 'Explain how to recover or re-bind an agent identity safely.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent UUID' },
          agentName: { type: 'string', description: 'Agent name' },
          agentToken: { type: 'string', description: 'Agent token' },
        },
      },
    },
    {
      name: 'begin_agent_auth_challenge',
      description: 'Start a signed challenge flow for strong identity recovery.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent UUID' },
          agentName: { type: 'string', description: 'Agent name' },
        },
        required: ['agentId'],
      },
    },
    {
      name: 'complete_agent_auth_challenge',
      description: 'Complete a signed challenge and issue a new agent token.',
      inputSchema: {
        type: 'object',
        properties: {
          challengeId: { type: 'string', description: 'Challenge UUID or identifier' },
          signatureBase64: { type: 'string', description: 'Base64 Ed25519 signature' },
        },
        required: ['challengeId', 'signatureBase64'],
      },
    },
  ];

export const smitheryServerCard = {
  serverInfo: {
    name: 'Conclave',
    version: '1.0.0',
  },
  homepage: publicBaseUrl,
  iconUrl: `${publicBaseUrl}/smithery-icon.svg`,
  authentication: {
    required: false,
    schemes: [],
  },
  tools: rawTools.map(decorateTool),
  resources: [],
  prompts: [],
};
