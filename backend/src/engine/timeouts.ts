import prisma from '../db.js';
import { submitAgentAction } from './match-resolver.js';

// #region debug-point Z:dbg-helper
const __dbg = (hypothesisId: string, location: string, msg: string, data?: any) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    let url = 'http://127.0.0.1:7777/event';
    let sessionId = 'mafia-agent-timeout';
    try {
      const env = fs.readFileSync('.dbg/mafia-agent-timeout.env', 'utf8');
      url = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || url;
      sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || sessionId;
    } catch (e) {}
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        runId: 'pre-fix',
        hypothesisId,
        location,
        msg: `[DEBUG] ${msg}`,
        data: data || {},
        ts: Date.now(),
      }),
    }).catch(() => {});
  } catch (e) {}
};
// #endregion

export function runTimeoutsLoop() {
  setInterval(async () => {
     try {
       const activeMatches = await prisma.match.findMany({
         where: { status: 'in_progress' },
         include: {
           participants: {
             include: { agent: true },
           },
           rounds: {
             include: { actions: true },
           },
         },
       });

       const now = new Date();
       const TIMEOUT_LIMIT_MS = 30000; // 30 seconds timeout limit

       for (const match of activeMatches) {
         const currentRound = match.rounds.find(r => r.roundNumber === match.currentRound);
         if (!currentRound || currentRound.status !== 'waiting_for_actions') continue;

         const elapsed = now.getTime() - new Date(currentRound.startedAt).getTime();
         if (elapsed < TIMEOUT_LIMIT_MS) continue;

         // Identify players who haven't played
         const gameSpec = await prisma.gameSpecification.findUnique({
           where: { key: match.gameType },
         });
         const isSequential = gameSpec ? gameSpec.turnType === 'sequential' : match.gameType === 'tic_tac_toe';

         if (isSequential) {
           // Find whose turn it is
           const sortedRoles = match.participants
             .map((p) => p.role)
             .filter(Boolean)
             .sort() as string[];
           const numPlayers = sortedRoles.length;
           if (numPlayers === 0) continue;
           const turnIndex = (match.currentRound - 1) % numPlayers;
           const expectedRole = sortedRoles[turnIndex];
           const activeParticipant = match.participants.find(p => p.role === expectedRole);

           if (activeParticipant) {
             console.log(`[TimeoutManager] Agent ${activeParticipant.agent.name} timed out in Match #${match.id.substring(0,8)} sequential round.`);
            // #region debug-point C:timeout-seq
            if (match.gameType === 'mafia') {
              __dbg(
                'C',
                'timeouts.ts:timeout-seq',
                'Timeout triggered for sequential match',
                {
                  matchId: match.id,
                  gameType: match.gameType,
                  currentRound: match.currentRound,
                  expectedRole,
                  activeAgentId: activeParticipant.agentId,
                  activeAgentName: activeParticipant.agent.name,
                  activeRole: activeParticipant.role,
                  participantCount: match.participants.length,
                  sortedRoles,
                  roundStartedAt: currentRound.startedAt,
                }
              );
            }
            // #endregion
             // Force match finish with WO
             await prisma.$transaction(async (tx) => {
               await tx.match.update({
                 where: { id: match.id },
                 data: { status: 'finished', finishedAt: new Date() },
               });
               // Assign 0 to timed out agent, default points to others
               for (const p of match.participants) {
                 await tx.matchParticipant.update({
                   where: { id: p.id },
                   data: { score: p.id === activeParticipant.id ? 0 : 5 },
                 });
                 await tx.agent.update({
                   where: { id: p.agentId },
                   data: { status: 'idle' },
                 });
               }
               await tx.matchLog.create({
                 data: {
                   matchId: match.id,
                   eventType: 'timeout',
                   message: `Match finished due to agent '${activeParticipant.agent.name}' timeout.`,
                 },
               });
             });
           }
         } else {
           // Simultaneous: find all players who haven't played
           const playedAgentIds = new Set(currentRound.actions.map(a => a.agentId));
           const timedOutParticipants = match.participants.filter(p => !playedAgentIds.has(p.agentId));

           const allowedActions = gameSpec ? JSON.parse(gameSpec.actions) as string[] : ['cooperate'];
           const defaultAction = allowedActions[0] || 'cooperate';

           for (const p of timedOutParticipants) {
             console.log(`[TimeoutManager] Agent ${p.agent.name} timed out in Match #${match.id.substring(0,8)} simultaneous round. Playing default action: ${defaultAction}.`);
             try {
               await submitAgentAction(match.id, p.agentId, defaultAction, 'TIMEOUT AUTO-PLAY');
             } catch (err: any) {
               console.error(`[TimeoutManager] Failed to submit auto-action for ${p.agent.name}:`, err.message);
             }
           }
         }
       }
     } catch (err: any) {
       console.error('Error in timeouts loop:', err.message);
     }
  }, 5000);
}
