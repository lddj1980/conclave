import prisma from '../db.js';
import { getTrustScoreForAgent } from './season-analytics.js';
import { validateGameProposal } from './proposal-validation.js';

export type ProposalSubmissionInput = {
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
  submittedBy?: unknown;
  submittedByAgentId?: unknown;
  requestFastTrack?: unknown;
};

export async function createGameProposal(input: ProposalSubmissionInput) {
  const validation = validateGameProposal(input);
  if (!validation.ok) {
    const error = new Error('Proposal validation failed');
    (error as any).details = validation.errors;
    (error as any).warnings = validation.warnings;
    throw error;
  }

  const {
    name,
    key,
    description,
    turnType,
    infoType,
    maxPlayers,
    totalRounds,
    actions,
    payoffRules,
    codeScript,
    actionSchema,
    submittedBy,
    submittedByAgentId,
    requestFastTrack,
  } = input;

  const hasCodeScript = typeof codeScript === 'string' && codeScript.trim().length > 0;
  if (requestFastTrack && hasCodeScript) {
    const error = new Error('Script-bearing proposals must go through trial before approval');
    (error as any).code = 'FAST_TRACK_DISABLED_FOR_SCRIPT';
    throw error;
  }

  let status = 'pending';
  if (requestFastTrack) {
    if (!submittedByAgentId) {
      throw new Error('submittedByAgentId is required for fast-track');
    }
    const trust = await getTrustScoreForAgent(String(submittedByAgentId));
    if (trust.trustScore < 75) {
      throw new Error(`Fast-track requires trustScore >= 75. Current: ${trust.trustScore}`);
    }
    status = 'pending_fast_track';
  }

  const proposal = await prisma.$transaction(async (tx) => {
    const actionsValue = typeof actions === 'string' ? actions : JSON.stringify(actions ?? []);
    const payoffRulesValue = typeof payoffRules === 'string' ? payoffRules : JSON.stringify(payoffRules ?? {});
    const codeScriptValue = typeof codeScript === 'string' ? codeScript : codeScript == null ? null : String(codeScript);
    const actionSchemaValue = typeof actionSchema === 'string' ? actionSchema : actionSchema == null ? null : String(actionSchema);
    const turnTypeValue = turnType ? String(turnType) : 'simultaneous';
    const infoTypeValue = infoType ? String(infoType) : 'perfect';
    const created = await tx.gameSpecification.create({
      data: {
        name: String(name),
        key: String(key).toLowerCase(),
        description: String(description),
        turnType: turnTypeValue,
        infoType: infoTypeValue,
        maxPlayers: parseInt(String(maxPlayers ?? 2), 10) || 2,
        totalRounds: parseInt(String(totalRounds ?? 10), 10) || 10,
        actions: actionsValue,
        payoffRules: payoffRulesValue,
        codeScript: codeScriptValue,
        actionSchema: actionSchemaValue,
        submittedBy: String(submittedBy || 'Developer'),
        status,
      },
    });

    await tx.proposalAuditLog.create({
      data: {
        proposalId: created.id,
        actor: String(submittedBy || 'Developer'),
        action: requestFastTrack ? 'submitted_fast_track' : 'submitted',
        details: JSON.stringify({
          submittedByAgentId: submittedByAgentId || null,
          status,
          warnings: validation.warnings,
        }),
      },
    });

    return created;
  });

  return { proposal, validation };
}
