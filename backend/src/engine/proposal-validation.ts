type ProposalInput = {
  name?: unknown;
  key?: unknown;
  description?: unknown;
  turnType?: unknown;
  infoType?: unknown;
  maxPlayers?: unknown;
  totalRounds?: unknown;
  actions?: unknown;
  payoffRules?: unknown;
  codeScript?: unknown;
  actionSchema?: unknown;
};

const FORBIDDEN_SCRIPT_PATTERNS = [
  /require\s*\(\s*['"]fs['"]\s*\)/i,
  /require\s*\(\s*['"]child_process['"]\s*\)/i,
  /\bprocess\./i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\bimport\s*\(/i,
];

export function validateGameProposal(input: ProposalInput) {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = String(input.name || '').trim();
  const key = String(input.key || '').trim().toLowerCase();
  const description = String(input.description || '').trim();
  const turnType = String(input.turnType || 'simultaneous');
  const infoType = String(input.infoType || 'perfect');
  const maxPlayers = Number(input.maxPlayers ?? 2);
  const totalRounds = Number(input.totalRounds ?? 10);
  const actionsRaw = input.actions;
  const payoffRulesRaw = input.payoffRules;
  const codeScript = String(input.codeScript || '');

  if (!name || name.length < 3) errors.push('name must have at least 3 chars');
  if (!/^[a-z0-9_]{3,40}$/.test(key)) errors.push('key must match ^[a-z0-9_]{3,40}$');
  if (!description || description.length < 12) errors.push('description must have at least 12 chars');
  if (!['simultaneous', 'sequential'].includes(turnType)) errors.push('turnType must be simultaneous or sequential');
  if (!['perfect', 'hidden', 'partial'].includes(infoType)) errors.push('infoType must be perfect, hidden or partial');
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 12) errors.push('maxPlayers must be between 2 and 12');
  if (!Number.isInteger(totalRounds) || totalRounds < 1 || totalRounds > 500) errors.push('totalRounds must be between 1 and 500');

  let actions: string[] = [];
  try {
    const parsed = typeof actionsRaw === 'string' ? JSON.parse(actionsRaw) : actionsRaw;
    if (!Array.isArray(parsed) || parsed.length < 2) {
      errors.push('actions must be a JSON array with at least 2 actions');
    } else {
      actions = parsed.map((a) => String(a).trim()).filter(Boolean);
      const unique = new Set(actions);
      if (unique.size !== actions.length) errors.push('actions must not contain duplicates');
      if (actions.some((a) => a.length > 40)) errors.push('each action must be <= 40 chars');
    }
  } catch {
    errors.push('actions must be valid JSON');
  }

  try {
    const parsed = typeof payoffRulesRaw === 'string' ? JSON.parse(payoffRulesRaw) : payoffRulesRaw;
    if (parsed == null || typeof parsed !== 'object') {
      errors.push('payoffRules must be a JSON object');
    }
  } catch {
    errors.push('payoffRules must be valid JSON');
  }

  if (codeScript.length > 0) {
    if (codeScript.length > 30000) errors.push('codeScript too large (max 30k chars)');
    for (const pattern of FORBIDDEN_SCRIPT_PATTERNS) {
      if (pattern.test(codeScript)) {
        errors.push(`codeScript contains forbidden construct: ${pattern}`);
        break;
      }
    }
    if (!/module\.exports|exports\./.test(codeScript)) {
      warnings.push('codeScript does not appear to export handlers');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalized: {
      name,
      key,
      description,
      turnType,
      infoType,
      maxPlayers,
      totalRounds,
      actions,
    },
  };
}

