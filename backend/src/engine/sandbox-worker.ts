import vm from 'node:vm';
import { readFileSync } from 'node:fs';

type WorkerRequest =
  | { op: 'initializeState'; code: string; players: string[]; seed: string }
  | { op: 'validateAction'; code: string; state: any; action: any; playerId: string; actionMeta?: any }
  | { op: 'transitionState'; code: string; state: any; action: any; playerId: string; randomSeed: string; gameContext?: any; actionMeta?: any }
  | { op: 'serializeStateForPlayer'; code: string; state: any; playerId: string };

function hardenContext() {
  const sandboxExports = {} as any;
  return {
    exports: sandboxExports,
    module: { exports: sandboxExports },
    require: undefined,
    process: undefined,
    global: undefined,
    globalThis: undefined,
    self: undefined,
    window: undefined,
    Buffer: undefined,
    Function: undefined,
    eval: undefined,
    console: {
      log: (...args: any[]) => console.log('[Sandbox Log]:', ...args),
      error: (...args: any[]) => console.error('[Sandbox Error]:', ...args),
      warn: (...args: any[]) => console.warn('[Sandbox Warn]:', ...args),
    },
    Math: {
      abs: Math.abs, acos: Math.acos, acosh: Math.acosh, asin: Math.asin, asinh: Math.asinh,
      atan: Math.atan, atan2: Math.atan2, atanh: Math.atanh, cbrt: Math.cbrt, ceil: Math.ceil,
      clz32: Math.clz32, cos: Math.cos, cosh: Math.cosh, exp: Math.exp, expm1: Math.expm1,
      floor: Math.floor, fround: Math.fround, hypot: Math.hypot, imul: Math.imul, log: Math.log,
      log10: Math.log10, log1p: Math.log1p, log2: Math.log2, max: Math.max, min: Math.min,
      pow: Math.pow, round: Math.round, sign: Math.sign, sin: Math.sin, sinh: Math.sinh,
      sqrt: Math.sqrt, tan: Math.tan, tanh: Math.tanh, trunc: Math.trunc,
      E: Math.E, LN2: Math.LN2, LN10: Math.LN10, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E,
      PI: Math.PI, SQRT1_2: Math.SQRT1_2, SQRT2: Math.SQRT2,
      random: () => {
        throw new Error('Use the provided random() function parameter for determinism.');
      },
    },
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date,
    RegExp,
    Error,
    Map,
    Set,
    Promise,
  };
}

function createEngine(code: string) {
  const context = hardenContext();
  vm.createContext(context, {
    codeGeneration: { strings: false, wasm: false },
  });
  const script = new vm.Script(code, { filename: 'game-script.js' });
  script.runInContext(context, { timeout: 1000 });
  return context.exports;
}

function runRandom(seed: string) {
  let x = 0;
  for (let i = 0; i < seed.length; i++) {
    x = (x << 5) - x + seed.charCodeAt(i);
    x |= 0;
  }
  return () => {
    let t = (x += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  const raw = readFileSync(0, 'utf8');
  const req = JSON.parse(raw) as WorkerRequest;
  const engine = createEngine(req.code);

  let result: any;
  switch (req.op) {
    case 'initializeState':
      result = typeof engine.initializeState === 'function' ? engine.initializeState(req.players, req.seed) : {};
      break;
    case 'validateAction':
      result = typeof engine.validateAction === 'function'
        ? engine.validateAction(req.state, req.action, req.playerId, req.actionMeta)
        : { valid: true };
      break;
    case 'transitionState':
      result = typeof engine.transitionState === 'function'
        ? engine.transitionState(req.state, req.action, req.playerId, runRandom(req.randomSeed), req.gameContext, req.actionMeta)
        : { newState: req.state, events: [], finished: false, scores: {} };
      break;
    case 'serializeStateForPlayer':
      result = typeof engine.serializeStateForPlayer === 'function'
        ? engine.serializeStateForPlayer(req.state, req.playerId)
        : req.state;
      break;
    default:
      throw new Error(`Unsupported op: ${(req as any).op}`);
  }

  process.stdout.write(JSON.stringify({ ok: true, result }));
}

try {
  main();
} catch (err: any) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(err?.message || err) }));
  process.exitCode = 1;
}

