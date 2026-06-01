import vm from 'node:vm';

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

export function createSandbox(code: string): GameEngine {
  // Create an isolated context
  const sandboxExports = {} as any;
  const context = {
    exports: sandboxExports,
    module: { exports: sandboxExports },
    console: {
      log: (...args: any[]) => console.log('[Sandbox Log]:', ...args),
      error: (...args: any[]) => console.error('[Sandbox Error]:', ...args),
      warn: (...args: any[]) => console.warn('[Sandbox Warn]:', ...args),
    },
    Math: {
      // Keep pure mathematical functions
      abs: Math.abs, acos: Math.acos, acosh: Math.acosh, asin: Math.asin, asinh: Math.asinh,
      atan: Math.atan, atan2: Math.atan2, atanh: Math.atanh, cbrt: Math.cbrt, ceil: Math.ceil,
      clz32: Math.clz32, cos: Math.cos, cosh: Math.cosh, exp: Math.exp, expm1: Math.expm1,
      floor: Math.floor, fround: Math.fround, hypot: Math.hypot, imul: Math.imul, log: Math.log,
      log10: Math.log10, log1p: Math.log1p, log2: Math.log2, max: Math.max, min: Math.min,
      pow: Math.pow, round: Math.round, sign: Math.sign, sin: Math.sin, sinh: Math.sinh,
      sqrt: Math.sqrt, tan: Math.tan, tanh: Math.tanh, trunc: Math.trunc,
      E: Math.E, LN2: Math.LN2, LN10: Math.LN10, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E,
      PI: Math.PI, SQRT1_2: Math.SQRT1_2, SQRT2: Math.SQRT2,
      // Forbid un-seeded random
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

  vm.createContext(context);

  // Run code to populate exports
  const script = new vm.Script(code);
  script.runInContext(context, { timeout: 1000 });

  // Get the populated export functions
  const engine = context.exports;

  return {
    initializeState(players: string[], seed: string) {
      if (typeof engine.initializeState !== 'function') {
        return {};
      }
      // Run function in VM context to maintain security boundaries
      const runFn = new vm.Script('exports.initializeState(players, seed)');
      const callCtx = vm.createContext({ ...context, players, seed });
      return runFn.runInContext(callCtx, { timeout: 1000 });
    },
    validateAction(state: any, action: any, playerId: string, actionMeta?: any) {
      if (typeof engine.validateAction !== 'function') {
        return { valid: true };
      }
      const runFn = new vm.Script('exports.validateAction(state, action, playerId, actionMeta)');
      const callCtx = vm.createContext({ ...context, state, action, playerId, actionMeta });
      return runFn.runInContext(callCtx, { timeout: 1000 });
    },
    transitionState(state: any, action: any, playerId: string, random: () => number, gameContext?: any, actionMeta?: any) {
      if (typeof engine.transitionState !== 'function') {
        return { newState: state, events: [], finished: false, scores: {} };
      }
      const runFn = new vm.Script('exports.transitionState(state, action, playerId, random, gameContext, actionMeta)');
      const callCtx = vm.createContext({ ...context, state, action, playerId, random, gameContext, actionMeta });
      return runFn.runInContext(callCtx, { timeout: 1000 });
    },
    serializeStateForPlayer(state: any, playerId: string) {
      if (typeof engine.serializeStateForPlayer !== 'function') {
        return state;
      }
      const runFn = new vm.Script('exports.serializeStateForPlayer(state, playerId)');
      const callCtx = vm.createContext({ ...context, state, playerId });
      return runFn.runInContext(callCtx, { timeout: 1000 });
    },
  };
}
