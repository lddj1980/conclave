import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface GameEngine {
  initializeState(players: string[], seed: string): any;
  validateAction(state: any, action: any, playerId: string, actionMeta?: any): { valid: boolean; error?: string };
  transitionState(
    state: any,
    action: any,
    playerId: string,
    random: () => number,
    gameContext?: any,
    actionMeta?: any
  ): {
    newState: any;
    events: any[];
    finished: boolean;
    scores: Record<string, number>;
    contractUpdates?: any[];
    inventoryUpdates?: any;
  };
  serializeStateForPlayer(state: any, playerId: string): any;
}

type SandboxRequest =
  | { op: 'initializeState'; code: string; players: string[]; seed: string }
  | { op: 'validateAction'; code: string; state: any; action: any; playerId: string; actionMeta?: any }
  | { op: 'transitionState'; code: string; state: any; action: any; playerId: string; randomSeed: string; gameContext?: any; actionMeta?: any }
  | { op: 'serializeStateForPlayer'; code: string; state: any; playerId: string };

type SandboxResponse = { ok: true; result: any } | { ok: false; error: string };

function resolveWorkerPath() {
  const tsWorkerPath = path.join(__dirname, 'sandbox-worker.ts');
  const jsWorkerPath = path.join(__dirname, 'sandbox-worker.js');
  if (existsSync(tsWorkerPath)) return tsWorkerPath;
  if (existsSync(jsWorkerPath)) return jsWorkerPath;
  return jsWorkerPath;
}

function invokeWorker(request: SandboxRequest, timeoutMs = 3000) {
  const workerPath = resolveWorkerPath();
  const isTs = workerPath.endsWith('.ts');
  const args = isTs ? ['--import', 'tsx', workerPath] : [workerPath];

  const result = spawnSync(process.execPath, args, {
    input: JSON.stringify(request),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
    },
  });

  if (result.error) {
    throw new Error(`Sandbox worker failed: ${result.error.message}`);
  }

  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();

  if (!stdout) {
    throw new Error(`Sandbox worker returned no output${stderr ? `: ${stderr}` : ''}`);
  }

  let parsed: SandboxResponse;
  try {
    parsed = JSON.parse(stdout) as SandboxResponse;
  } catch (error: any) {
    throw new Error(`Sandbox worker returned invalid JSON${stderr ? `; stderr: ${stderr}` : ''}: ${String(error?.message || error)}`);
  }

  if (!parsed.ok) {
    throw new Error(parsed.error || 'Sandbox worker error');
  }

  const exitStatus = typeof result.status === 'number' ? result.status : 0;
  if (exitStatus !== 0) {
    throw new Error(`Sandbox worker exited with status ${exitStatus}${stderr ? `: ${stderr}` : ''}`);
  }

  return parsed.result;
}

export function createSandbox(code: string): GameEngine {
  return {
    initializeState(players: string[], seed: string) {
      return invokeWorker({ op: 'initializeState', code, players, seed });
    },
    validateAction(state: any, action: any, playerId: string, actionMeta?: any) {
      const result = invokeWorker({ op: 'validateAction', code, state, action, playerId, actionMeta });
      return result || { valid: true };
    },
    transitionState(state: any, action: any, playerId: string, random: () => number, gameContext?: any, actionMeta?: any) {
      const randomSeed = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
      const result = invokeWorker({
        op: 'transitionState',
        code,
        state,
        action,
        playerId,
        randomSeed,
        gameContext,
        actionMeta,
      });
      if (!result) {
        return { newState: state, events: [], finished: false, scores: {} };
      }
      return result;
    },
    serializeStateForPlayer(state: any, playerId: string) {
      return invokeWorker({ op: 'serializeStateForPlayer', code, state, playerId });
    },
  };
}
