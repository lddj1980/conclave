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

async function runTraderStrategy(roundHistory: any[], agentId: string, match: any, participant: any) {
  const teammate = match.participants.find((p: any) => p.teamKey === participant.teamKey && p.agentId !== agentId);
  const teammateId = teammate?.agentId;

  const metalInv = participant.agent.inventory.find((i: any) => i.resourceKey === 'metal');
  const fuelInv = participant.agent.inventory.find((i: any) => i.resourceKey === 'fuel');
  const metal = metalInv ? metalInv.quantity : 0;
  const fuel = fuelInv ? fuelInv.quantity : 0;

  const teammateList = match.participants.filter((p: any) => p.teamKey === participant.teamKey).map((p: any) => p.agentId).sort();
  const role = teammateList[0] === agentId ? 'metal_miner' : 'fuel_miner';

  if (metal >= 10 && fuel >= 10) {
    return 'build';
  }

  const pendingContracts = await prisma.gameContract.findMany({
    where: {
      matchId: match.id,
      acceptorId: agentId,
      status: 'pending'
    }
  });

  if (pendingContracts.length > 0) {
    for (const contract of pendingContracts) {
      const terms = JSON.parse(contract.terms);
      const weHaveEnough = (terms.receiveResource === 'metal' && metal >= terms.receiveAmount) ||
                           (terms.receiveResource === 'fuel' && fuel >= terms.receiveAmount);
      if (weHaveEnough) {
        return `accept_contract:${contract.id}`;
      }
    }
  }

  if (teammateId) {
    const myProposedContracts = await prisma.gameContract.findMany({
      where: {
        matchId: match.id,
        proposerId: agentId,
        acceptorId: teammateId,
        status: 'pending'
      }
    });

    if (myProposedContracts.length === 0) {
      if (role === 'metal_miner' && metal >= 3 && fuel < 10) {
        return `propose_contract:${teammateId},metal,3,fuel,3`;
      } else if (role === 'fuel_miner' && fuel >= 3 && metal < 10) {
        return `propose_contract:${teammateId},fuel,3,metal,3`;
      }
    }
  }

  return 'mine';
}

function parseJsonSafe(input: any): any | null {
  if (typeof input !== 'string') return null;
  try {
    return JSON.parse(input);
  } catch (e) {
    return null;
  }
}

function getLatestStateFromHistory(roundHistory: any[]): any | null {
  for (let i = roundHistory.length - 1; i >= 0; i--) {
    const payload = roundHistory[i]?.payload;
    const parsed = parseJsonSafe(payload);
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return null;
}

function parseFenBoardSimple(fen: string): { board: string[][]; side: 'w' | 'b' } | null {
  if (!fen || typeof fen !== 'string') return null;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const rows = parts[0].split('/');
  if (rows.length !== 8) return null;
  const board: string[][] = [];
  for (const row of rows) {
    const out: string[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        const n = Number(ch);
        for (let i = 0; i < n; i++) out.push('');
      } else {
        out.push(ch);
      }
    }
    if (out.length !== 8) return null;
    board.push(out);
  }
  return { board, side: parts[1] === 'b' ? 'b' : 'w' };
}

function buildSimpleUciMoves(board: string[][], side: 'w' | 'b'): string[] {
  const files = 'abcdefgh';
  const inB = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const isWhite = (p: string) => p >= 'A' && p <= 'Z';
  const isBlack = (p: string) => p >= 'a' && p <= 'z';
  const enemy = (p: string) => (side === 'w' ? isBlack(p) : isWhite(p));
  const own = (p: string) => (side === 'w' ? isWhite(p) : isBlack(p));
  const sq = (r: number, c: number) => `${files[c]}${8 - r}`;
  const moves: string[] = [];

  const pushSlide = (r: number, c: number, dr: number, dc: number) => {
    let rr = r + dr;
    let cc = c + dc;
    while (inB(rr, cc)) {
      const t = board[rr][cc];
      if (!t) {
        moves.push(`${sq(r, c)}${sq(rr, cc)}`);
      } else {
        if (enemy(t)) moves.push(`${sq(r, c)}${sq(rr, cc)}`);
        break;
      }
      rr += dr;
      cc += dc;
    }
  };

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || !own(p)) continue;
      const piece = p.toLowerCase();
      if (piece === 'p') {
        const dir = side === 'w' ? -1 : 1;
        const start = side === 'w' ? 6 : 1;
        const nr = r + dir;
        if (inB(nr, c) && !board[nr][c]) {
          moves.push(`${sq(r, c)}${sq(nr, c)}`);
          const nr2 = r + 2 * dir;
          if (r === start && inB(nr2, c) && !board[nr2][c]) moves.push(`${sq(r, c)}${sq(nr2, c)}`);
        }
        for (const dc of [-1, 1]) {
          const rr = r + dir;
          const cc = c + dc;
          if (!inB(rr, cc)) continue;
          const t = board[rr][cc];
          if (t && enemy(t)) moves.push(`${sq(r, c)}${sq(rr, cc)}`);
        }
      } else if (piece === 'n') {
        const jumps = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
        for (const [dr, dc] of jumps) {
          const rr = r + dr, cc = c + dc;
          if (!inB(rr, cc)) continue;
          const t = board[rr][cc];
          if (!t || enemy(t)) moves.push(`${sq(r, c)}${sq(rr, cc)}`);
        }
      } else if (piece === 'b') {
        pushSlide(r, c, -1, -1); pushSlide(r, c, -1, 1); pushSlide(r, c, 1, -1); pushSlide(r, c, 1, 1);
      } else if (piece === 'r') {
        pushSlide(r, c, -1, 0); pushSlide(r, c, 1, 0); pushSlide(r, c, 0, -1); pushSlide(r, c, 0, 1);
      } else if (piece === 'q') {
        pushSlide(r, c, -1, -1); pushSlide(r, c, -1, 1); pushSlide(r, c, 1, -1); pushSlide(r, c, 1, 1);
        pushSlide(r, c, -1, 0); pushSlide(r, c, 1, 0); pushSlide(r, c, 0, -1); pushSlide(r, c, 0, 1);
      } else if (piece === 'k') {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const rr = r + dr, cc = c + dc;
            if (!inB(rr, cc)) continue;
            const t = board[rr][cc];
            if (!t || enemy(t)) moves.push(`${sq(r, c)}${sq(rr, cc)}`);
          }
        }
      }
    }
  }
  return moves;
}

function pickChessLegalMoveFromHistory(roundHistory: any[]): string {
  let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';
  if (roundHistory.length > 0) {
    const st = parseJsonSafe(roundHistory[roundHistory.length - 1]?.payload);
    if (st && typeof st.board === 'string') fen = st.board;
  }
  const parsed = parseFenBoardSimple(fen);
  if (!parsed) return 'e2e4';
  const legal = buildSimpleUciMoves(parsed.board, parsed.side);
  if (legal.length === 0) return 'e2e4';
  return legal[Math.floor(Math.random() * legal.length)];
}

function connectFourDrop(board: string[], col: number, token: string): { ok: boolean; board: string[]; row: number } {
  const rows = 6;
  const cols = 7;
  if (!Number.isFinite(col) || col < 0 || col >= cols) return { ok: false, board, row: -1 };
  const out = board.slice();
  for (let r = rows - 1; r >= 0; r--) {
    const idx = r * cols + col;
    if (!out[idx]) {
      out[idx] = token;
      return { ok: true, board: out, row: r };
    }
  }
  return { ok: false, board, row: -1 };
}

function connectFourWinner(board: string[]): string | null {
  const rows = 6;
  const cols = 7;
  const at = (r: number, c: number) => board[r * cols + c];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = at(r, c);
      if (!t) continue;
      if (c + 3 < cols && t === at(r, c + 1) && t === at(r, c + 2) && t === at(r, c + 3)) return t;
      if (r + 3 < rows && t === at(r + 1, c) && t === at(r + 2, c) && t === at(r + 3, c)) return t;
      if (r + 3 < rows && c + 3 < cols && t === at(r + 1, c + 1) && t === at(r + 2, c + 2) && t === at(r + 3, c + 3)) return t;
      if (r + 3 < rows && c - 3 >= 0 && t === at(r + 1, c - 1) && t === at(r + 2, c - 2) && t === at(r + 3, c - 3)) return t;
    }
  }
  return null;
}

const HOUSE_BOTS = [
  {
    name: 'BudgetEqualBot',
    owner: 'HouseBot',
    description: 'Budget Allocation bot. Always allocates equally across all assets.',
    strategy: (_roundHistory: any[]) => {
      const w = Array(8).fill(1 / 8);
      return { action: 'allocate', payload: JSON.stringify({ w }) };
    },
  },
  {
    name: 'BudgetChaserBot',
    owner: 'HouseBot',
    description: 'Budget Allocation bot. Chases the asset with the highest last observed return.',
    strategy: (roundHistory: any[]) => {
      const last = roundHistory[roundHistory.length - 1];
      let assetReturns: number[] | null = null;
      if (last?.payload) {
        try {
          const parsed = JSON.parse(last.payload);
          if (parsed && Array.isArray(parsed.assetReturns)) {
            assetReturns = parsed.assetReturns.map((x: any) => Number(x));
          }
        } catch (e) {}
      }
      const k = 8;
      const w = Array(k).fill(0);
      if (!assetReturns || assetReturns.length !== k) {
        for (let i = 0; i < k; i++) w[i] = 1 / k;
      } else {
        let bestIdx = 0;
        let bestVal = assetReturns[0] ?? -Infinity;
        for (let i = 1; i < k; i++) {
          const v = assetReturns[i];
          if (v > bestVal) {
            bestVal = v;
            bestIdx = i;
          }
        }
        w[bestIdx] = 1;
      }
      return { action: 'allocate', payload: JSON.stringify({ w }) };
    },
  },
  {
    name: 'BudgetMomentumBot',
    owner: 'HouseBot',
    description: 'Budget Allocation bot. Allocates mostly to the best average-return asset with a small diversification buffer.',
    strategy: (roundHistory: any[]) => {
      const k = 8;
      const sums = Array(k).fill(0);
      const counts = Array(k).fill(0);
      for (const r of roundHistory) {
        if (!r?.payload) continue;
        try {
          const parsed = JSON.parse(r.payload);
          if (!parsed || !Array.isArray(parsed.assetReturns) || parsed.assetReturns.length !== k) continue;
          for (let i = 0; i < k; i++) {
            const v = Number(parsed.assetReturns[i]);
            if (Number.isFinite(v)) {
              sums[i] += v;
              counts[i] += 1;
            }
          }
        } catch (e) {}
      }
      let bestIdx = 0;
      let bestAvg = -Infinity;
      for (let i = 0; i < k; i++) {
        const avg = counts[i] > 0 ? sums[i] / counts[i] : 0;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestIdx = i;
        }
      }
      const w = Array(k).fill(0.03);
      w[bestIdx] = 1 - 0.03 * (k - 1);
      return { action: 'allocate', payload: JSON.stringify({ w }) };
    },
  },
  {
    name: 'CodeMasterBot',
    owner: 'HouseBot',
    description: 'Mastermind codemaster bot. Always passes while the engine holds the secret.',
    strategy: () => 'pass',
  },
  {
    name: 'CodeBreakerRandomBot',
    owner: 'HouseBot',
    description: 'Mastermind codebreaker bot. Randomly guesses a 4-digit code (digits 0-5).',
    strategy: () => {
      const d = () => String(Math.floor(Math.random() * 6));
      return `${d()}${d()}${d()}${d()}`;
    },
  },
  {
    name: 'ConnectFourRandomBot',
    owner: 'HouseBot',
    description: 'Connect Four bot. Plays random valid columns.',
    strategy: (roundHistory: any[], agentId: string, match: any, participant: any) => {
      const state = getLatestStateFromHistory(roundHistory);
      const rows = 6;
      const cols = 7;
      const board: string[] = state && Array.isArray(state.board) ? state.board : Array(rows * cols).fill('');
      const validCols = [];
      for (let c = 0; c < cols; c++) {
        if (!board[c]) validCols.push(c);
      }
      const chosen = validCols.length > 0 ? validCols[Math.floor(Math.random() * validCols.length)] : 0;
      return String(chosen);
    },
  },
  {
    name: 'ConnectFourGreedyBot',
    owner: 'HouseBot',
    description: 'Connect Four bot. Plays immediate wins, blocks opponent wins, otherwise prefers center.',
    strategy: (roundHistory: any[], agentId: string, match: any, participant: any) => {
      const rows = 6;
      const cols = 7;
      const state = getLatestStateFromHistory(roundHistory);
      const board: string[] = state && Array.isArray(state.board) ? state.board : Array(rows * cols).fill('');
      const myToken = participant?.role === 'player_1' ? 'R' : 'Y';
      const oppToken = myToken === 'R' ? 'Y' : 'R';

      const validCols: number[] = [];
      for (let c = 0; c < cols; c++) {
        if (!board[c]) validCols.push(c);
      }
      if (validCols.length === 0) return '0';

      for (const c of validCols) {
        const sim = connectFourDrop(board, c, myToken);
        if (sim.ok && connectFourWinner(sim.board) === myToken) return String(c);
      }

      for (const c of validCols) {
        const sim = connectFourDrop(board, c, oppToken);
        if (sim.ok && connectFourWinner(sim.board) === oppToken) return String(c);
      }

      const preference = [3, 2, 4, 1, 5, 0, 6];
      for (const c of preference) {
        if (validCols.includes(c)) return String(c);
      }
      return String(validCols[0]);
    },
  },
  {
    name: 'OracleGuessBot',
    owner: 'HouseBot',
    description: 'Oracle bot for Guessing Game. Automatically passes its turn to let the player guess.',
    strategy: () => 'pass'
  },
  {
    name: 'GuessRandomBot',
    owner: 'HouseBot',
    description: 'Guessing Game bot. Submits a random guess between 1 and 100.',
    strategy: () => String(Math.floor(Math.random() * 100) + 1)
  },
  {
    name: 'ChessRandomWhiteBot',
    owner: 'HouseBot',
    description: 'Chess bot playing White. Proposes opening moves and random chess actions.',
    strategy: (roundHistory: any[]) => pickChessLegalMoveFromHistory(roundHistory)
  },
  {
    name: 'ChessRandomBlackBot',
    owner: 'HouseBot',
    description: 'Chess bot playing Black. Proposes opening moves and random chess actions.',
    strategy: (roundHistory: any[]) => pickChessLegalMoveFromHistory(roundHistory)
  },
  {
    name: 'TraderAlphaBot',
    owner: 'HouseBot',
    description: 'Space Colony Trader Alpha bot. Mines resources, proposes/accepts contracts.',
    strategy: (roundHistory: any[], agentId: string, match: any, participant: any) => {
      return runTraderStrategy(roundHistory, agentId, match, participant);
    }
  },
  {
    name: 'TraderBetaBot',
    owner: 'HouseBot',
    description: 'Space Colony Trader Beta bot. Mines resources, proposes/accepts contracts.',
    strategy: (roundHistory: any[], agentId: string, match: any, participant: any) => {
      return runTraderStrategy(roundHistory, agentId, match, participant);
    }
  },
  {
    name: 'CooperatorBot',
    owner: 'HouseBot',
    description: 'Always Cooperates. Purely altruistic strategy.',
    strategy: (roundHistory: any[]) => 'cooperate',
  },
  {
    name: 'DefectorBot',
    owner: 'HouseBot',
    description: 'Always Defects. Purely selfish strategy.',
    strategy: (roundHistory: any[]) => 'defect',
  },
  {
    name: 'TitForTatBot',
    owner: 'HouseBot',
    description: 'Tit-for-Tat. Starts with Cooperate, then repeats opponent\'s previous move.',
    strategy: (roundHistory: any[], agentId: string) => {
      if (roundHistory.length === 0) return 'cooperate';
      const lastRound = roundHistory[roundHistory.length - 1];
      const opponentAction = lastRound.actions.find((a: any) => a.agentId !== agentId);
      return opponentAction ? opponentAction.actionType : 'cooperate';
    },
  },
  {
    name: 'RockBot',
    owner: 'HouseBot',
    description: 'Only plays Rock. Rock-Paper-Scissors bot.',
    strategy: (roundHistory: any[]) => 'rock',
  },
  {
    name: 'RpsRandomBot',
    owner: 'HouseBot',
    description: 'Random strategy for Rock-Paper-Scissors.',
    strategy: (roundHistory: any[]) => {
      const choices = ['rock', 'paper', 'scissors'];
      return choices[Math.floor(Math.random() * choices.length)];
    },
  },
  {
    name: 'HawkBot',
    owner: 'HouseBot',
    description: 'Always Hawk (Defect). Pure conflict strategy for Chicken Game.',
    strategy: (roundHistory: any[]) => 'defect',
  },
  {
    name: 'DoveBot',
    owner: 'HouseBot',
    description: 'Always Dove (Cooperate). Pure compromise strategy for Chicken Game.',
    strategy: (roundHistory: any[]) => 'cooperate',
  },
  {
    name: 'TttRandomBot',
    owner: 'HouseBot',
    description: 'First random Tic-Tac-Toe bot.',
    strategy: (roundHistory: any[]) => {
      let board: string[] = Array(9).fill('');
      if (roundHistory.length > 0) {
        const lastRound = roundHistory[roundHistory.length - 1];
        if (lastRound.payload) {
          board = JSON.parse(lastRound.payload);
        }
      }
      const emptyCells = board
        .map((cell, idx) => (cell === '' ? idx : null))
        .filter(idx => idx !== null) as number[];

      if (emptyCells.length === 0) return '0';
      const choice = emptyCells[Math.floor(Math.random() * emptyCells.length)];
      return String(choice);
    },
  },
  {
    name: 'TttRandomBot2',
    owner: 'HouseBot',
    description: 'Second random Tic-Tac-Toe bot.',
    strategy: (roundHistory: any[]) => {
      let board: string[] = Array(9).fill('');
      if (roundHistory.length > 0) {
        const lastRound = roundHistory[roundHistory.length - 1];
        if (lastRound.payload) {
          board = JSON.parse(lastRound.payload);
        }
      }
      const emptyCells = board
        .map((cell, idx) => (cell === '' ? idx : null))
        .filter(idx => idx !== null) as number[];

      if (emptyCells.length === 0) return '0';
      const choice = emptyCells[Math.floor(Math.random() * emptyCells.length)];
      return String(choice);
    },
  },
  {
    name: 'TttRandomBot1',
    owner: 'HouseBot',
    description: 'Legacy random Tic-Tac-Toe bot (compat alias).',
    strategy: (roundHistory: any[]) => {
      let board: string[] = Array(9).fill('');
      if (roundHistory.length > 0) {
        const lastRound = roundHistory[roundHistory.length - 1];
        if (lastRound.payload) {
          board = JSON.parse(lastRound.payload);
        }
      }
      const emptyCells = board
        .map((cell, idx) => (cell === '' ? idx : null))
        .filter(idx => idx !== null) as number[];

      if (emptyCells.length === 0) return '0';
      const choice = emptyCells[Math.floor(Math.random() * emptyCells.length)];
      return String(choice);
    },
  },
  {
    name: 'StartupFounderBot',
    owner: 'HouseBot',
    description: 'A startup founder looking for funding. Tends to pitch with high or fair valuation demands.',
    strategy: (roundHistory: any[]) => {
      const isHigh = Math.random() > 0.5;
      return {
        action: isHigh ? 'high_val' : 'fair_val',
        payload: isHigh 
          ? "Buscamos um valuation alto de R$ 15M devido ao crescimento rápido de 300% ao ano!" 
          : "Proposta de valuation justo de R$ 6M com foco em parcerias estratégicas e de longo prazo."
      };
    },
  },
  {
    name: 'VentureCapitalBot',
    owner: 'HouseBot',
    description: 'A professional investor looking for startup deals. Negotiates if valuation is high; invests if low/fair.',
    strategy: (roundHistory: any[], agentId: string) => {
      const round1 = roundHistory.find(r => r.roundNumber === 1);
      if (!round1) return { action: 'negotiate', payload: "Precisamos de mais tração antes de investir." };
      
      const startupAction = round1.actions[0]?.actionType || '';
      const lowerAct = startupAction.toLowerCase();
      
      if (lowerAct.includes('high') || lowerAct.includes('alto') || lowerAct.includes('alta')) {
        return Math.random() > 0.5 
          ? { action: 'negotiate', payload: "O valuation está muito alto para o mercado atual. Topa reduzir 30%?" } 
          : { action: 'pass', payload: "Infelizmente, o risco é muito alto para esse valuation." };
      } else if (lowerAct.includes('low') || lowerAct.includes('baixo') || lowerAct.includes('baixa')) {
        return { action: 'invest', payload: "Ótima oportunidade. Vamos assinar o term sheet." };
      } else {
        return Math.random() > 0.5 
          ? { action: 'invest', payload: "Condições justas. Bem-vindos ao portfólio!" } 
          : { action: 'negotiate', payload: "Acho que podemos melhorar um pouco as cláusulas de governança." };
      }
    },
  },
  // ── Mexican Standoff ───────────────────────────────────────────────────────
  {
    name: 'StandoffPeacekeeperBot',
    owner: 'HouseBot',
    description: 'Mexican Standoff bot. Prefers peace but will shoot if the opponent shot last round.',
    strategy: (roundHistory: any[], agentId: string) => {
      if (roundHistory.length === 0) return 'peace';
      const lastRound = roundHistory[roundHistory.length - 1];
      const someoneShot = lastRound.actions?.some((a: any) => a.agentId !== agentId && a.actionType === 'shoot');
      return someoneShot ? 'shoot' : 'peace';
    },
  },
  {
    name: 'StandoffAggresBot',
    owner: 'HouseBot',
    description: 'Mexican Standoff bot. Always shoots on sight.',
    strategy: () => 'shoot',
  },
  {
    name: 'StandoffCowardBot',
    owner: 'HouseBot',
    description: 'Mexican Standoff bot. Always keeps the peace.',
    strategy: () => 'peace',
  },
  // ── Liar's Poker ──────────────────────────────────────────────────────────
  {
    name: 'LiarsPokerBlufferBot',
    owner: 'HouseBot',
    description: "Liar's Poker bot. Always bluffs on declare turn, always calls bluff on response turn.",
    strategy: (roundHistory: any[], agentId: string) => {
      const currentRound = roundHistory.length + 1;
      // Round 1: draw card (use bluff as placeholder action)
      // Round 2: declare — always bluff
      // Round 3: respond — always call_bluff
      if (currentRound <= 2) return { action: 'bluff', payload: 'I have a royal flush!' };
      return { action: 'call_bluff', payload: 'I do not believe you.' };
    },
  },
  {
    name: 'LiarsPokerHonestBot',
    owner: 'HouseBot',
    description: "Liar's Poker bot. Always reveals honestly, always folds on response.",
    strategy: (roundHistory: any[], agentId: string) => {
      const currentRound = roundHistory.length + 1;
      if (currentRound <= 2) return { action: 'reveal', payload: 'I play it straight.' };
      return { action: 'fold', payload: 'I believe you. I fold.' };
    },
  },
  // ── Mafia ─────────────────────────────────────────────────────────────────
  {
    name: 'MafiaBotKiller',
    owner: 'HouseBot',
    description: 'Mafia bot playing as the Mafia member. Uses eliminate action on a random villager each night (odd rounds), and votes/defends during day (even rounds).',
    gameType: 'mafia',
    role: 'player_1', // mafia role
    strategy: (roundHistory: any[], agentId: string, match?: any, participant?: any) => {
      const roundNum = (roundHistory.length + 1);
      const isNight = roundNum % 2 === 1; // odd rounds = night phase
      if (isNight) {
        // Night: Mafia eliminates — pick a random non-self participant
        const others = match?.participants?.filter((p: any) => p.agentId !== agentId) ?? [];
        const target = others[Math.floor(Math.random() * others.length)];
        return {
          action: 'eliminate',
          payload: JSON.stringify({ targetAgentId: target?.agentId ?? '', reason: 'Strategic elimination.' }),
        };
      }
      // Day: act innocent
      return { action: 'defend', payload: 'It was not me! I am innocent.' };
    },
  },
  {
    name: 'VillagerBotAlpha',
    owner: 'HouseBot',
    description: 'Mafia villager bot. Accuses randomly during day phase, passes during night.',
    gameType: 'mafia',
    strategy: (roundHistory: any[], agentId: string, match?: any) => {
      const roundNum = (roundHistory.length + 1);
      const isNight = roundNum % 2 === 1;
      if (isNight) return { action: 'pass', payload: 'Sleeping...' };
      // Day: accuse a random other player
      const others = match?.participants?.filter((p: any) => p.agentId !== agentId) ?? [];
      const suspect = others[Math.floor(Math.random() * others.length)];
      return {
        action: 'accuse',
        payload: JSON.stringify({ targetAgentId: suspect?.agentId ?? '', reason: 'You look suspicious!' }),
      };
    },
  },
  {
    name: 'VillagerBotBeta',
    owner: 'HouseBot',
    description: 'Mafia villager bot. Votes based on who accused whom last round.',
    gameType: 'mafia',
    strategy: (roundHistory: any[], agentId: string, match?: any) => {
      const roundNum = (roundHistory.length + 1);
      const isNight = roundNum % 2 === 1;
      if (isNight) return { action: 'pass', payload: 'Resting...' };
      // Vote for whoever accused most aggressively last day round
      const lastDay = roundHistory.filter(r => r.roundNumber % 2 === 0).pop();
      if (lastDay) {
        const accusers = lastDay.actions?.filter((a: any) => a.actionType === 'accuse' && a.agentId !== agentId);
        if (accusers?.length > 0) {
          const accuserPayload = accusers[0]?.payload ? JSON.parse(accusers[0].payload) : {};
          return {
            action: 'vote',
            payload: JSON.stringify({ targetAgentId: accuserPayload.targetAgentId ?? '', reason: 'You accused first!' }),
          };
        }
      }
      // Default: vote randomly
      const others = match?.participants?.filter((p: any) => p.agentId !== agentId) ?? [];
      const target = others[Math.floor(Math.random() * others.length)];
      return {
        action: 'vote',
        payload: JSON.stringify({ targetAgentId: target?.agentId ?? '', reason: 'Random suspicion.' }),
      };
    },
  },
  {
    name: 'VillagerBotGamma',
    owner: 'HouseBot',
    description: 'Mafia villager bot. Defensive player — always defends self or passes.',
    gameType: 'mafia',
    strategy: (roundHistory: any[], agentId: string) => {
      const roundNum = (roundHistory.length + 1);
      const isNight = roundNum % 2 === 1;
      if (isNight) return { action: 'pass', payload: 'On guard...' };
      return { action: 'defend', payload: 'I am innocent. Trust me.' };
    },
  },
  {
    name: 'BargainLLMTraderA',
    owner: 'HouseBot',
    description: 'Bargaining LLM Bot playing as Agent A. Uses Groq/Gemini to negotiate and trade Apples for Oranges.',
    gameType: 'bargaining_game',
    strategy: async (roundHistory: any[], agentId: string, match?: any, participant?: any) => {
      const res = await fetchLlmNegotiationAction(roundHistory, agentId, match, 'player_1');
      if (res.startsWith('message:')) {
        return { action: 'message', payload: res.substring('message:'.length) };
      }
      if (res.startsWith('propose:')) {
        return { action: 'propose', payload: res.substring('propose:'.length) };
      }
      return { action: res, payload: undefined };
    }
  },
  {
    name: 'BargainLLMTraderB',
    owner: 'HouseBot',
    description: 'Bargaining LLM Bot playing as Agent B. Uses Groq/Gemini to negotiate and trade Oranges for Apples.',
    gameType: 'bargaining_game',
    strategy: async (roundHistory: any[], agentId: string, match?: any, participant?: any) => {
      const res = await fetchLlmNegotiationAction(roundHistory, agentId, match, 'player_2');
      if (res.startsWith('message:')) {
        return { action: 'message', payload: res.substring('message:'.length) };
      }
      if (res.startsWith('propose:')) {
        return { action: 'propose', payload: res.substring('propose:'.length) };
      }
      return { action: res, payload: undefined };
    }
  },
  {
    name: 'SuperpowerUSA',
    owner: 'HouseBot',
    description: 'United States diplomatic and military AI. Seeks Cuban disarmament while managing cold war tensions.',
    gameType: 'geopolitical_crisis',
    strategy: async (roundHistory: any[], agentId: string, match?: any, participant?: any) => {
      const res = await fetchGeopoliticalAction(roundHistory, agentId, match, 'player_1');
      if (res.startsWith('message:')) {
        return { action: 'message', payload: res.substring('message:'.length) };
      }
      if (res.startsWith('propose:')) {
        return { action: 'propose', payload: res.substring('propose:'.length) };
      }
      return { action: res, payload: undefined };
    }
  },
  {
    name: 'SuperpowerUSSR',
    owner: 'HouseBot',
    description: 'Soviet Union diplomatic and military AI. Seeks Turkish disarmament and Cuban security guarantees.',
    gameType: 'geopolitical_crisis',
    strategy: async (roundHistory: any[], agentId: string, match?: any, participant?: any) => {
      const res = await fetchGeopoliticalAction(roundHistory, agentId, match, 'player_2');
      if (res.startsWith('message:')) {
        return { action: 'message', payload: res.substring('message:'.length) };
      }
      if (res.startsWith('propose:')) {
        return { action: 'propose', payload: res.substring('propose:'.length) };
      }
      return { action: res, payload: undefined };
    }
  }
];

function runHeuristicNegotiation(state: any, agentId: string, role: string, myValuations: any) {
  if (state.proposal && state.proposal.proposer !== agentId) {
    const p = state.proposal;
    let scoreGain = 0;
    if (role === 'player_1') {
      const giveOrange = p.giveOrange || 0;
      const receiveApple = p.receiveApple || 0;
      scoreGain = giveOrange * myValuations.orange - receiveApple * myValuations.apple;
    } else {
      const giveApple = p.giveApple || 0;
      const receiveOrange = p.receiveOrange || 0;
      scoreGain = giveApple * myValuations.apple - receiveOrange * myValuations.orange;
    }
    
    if (scoreGain > 0) {
      return 'accept';
    }
  }
  
  const chatLen = (state.chatHistory && state.chatHistory.length) || 0;
  if (chatLen % 2 === 0) {
    if (role === 'player_1') {
      return 'propose:give_apple=1,receive_orange=1';
    } else {
      return 'propose:give_orange=1,receive_apple=1';
    }
  }
  return 'message:Ola! Vamos fechar uma proposta justa.';
}

async function fetchLlmNegotiationAction(roundHistory: any[], agentId: string, match: any, role: string) {
  const state = getLatestStateFromHistory(roundHistory) || {
    inventory: {}, valuations: {}, chatHistory: [], proposal: null
  };
  
  const myInventory = (state.inventory && state.inventory[agentId]) || { apple: 3, orange: 0 };
  const myValuations = (state.valuations && state.valuations[agentId]) || { apple: 10, orange: 3 };
  const oppId = match?.participants?.find((p: any) => p.agentId !== agentId)?.agentId || 'opponent';
  const oppInventory = (state.inventory && state.inventory[oppId]) || { apple: 0, orange: 3 };
  
  const groqKey = process.env.GROQ_API_KEY || '';
  const geminiKey = process.env.GEMINI_API_KEY || '';
  
  if (!groqKey && !geminiKey) {
    return runHeuristicNegotiation(state, agentId, role, myValuations);
  }
  
  try {
    const chatList = state.chatHistory || [];
    const formattedHistory = chatList.slice(-6).map((c: any) => {
      const sender = c.playerId === agentId ? 'Voce' : 'Oponente';
      return `${sender}: ${c.text}`;
    }).join('\n');
    
    const systemPrompt = `Voce e uma Inteligencia Artificial participando de um Jogo de Barganha no Conclave.
Seu papel: ${role === 'player_1' ? 'Agente A' : 'Agente B'}.
Suas valoracoes privadas de itens:
- Cada Maca (Apple) vale: $${myValuations.apple} para voce.
- Cada Laranja (Orange) vale: $${myValuations.orange} para voce.

Seu inventario atual:
- Suas Macas: ${myInventory.apple}
- Suas Laranjas: ${myInventory.orange}

Inventario atual do oponente:
- Macas do oponente: ${oppInventory.apple}
- Laranjas do oponente: ${oppInventory.orange}

Proposta ativa no momento: ${state.proposal ? JSON.stringify(state.proposal) : 'Nenhuma proposta ativa.'}

Seu objetivo e maximizar o valor total do seu inventario ao final da negociacao.
Voce pode realizar apenas uma das seguintes acoes exatas por vez:
1. "message:<texto>" - para conversar em portugues de forma concisa.
2. "propose:${role === 'player_1' ? 'give_apple=X,receive_orange=Y' : 'give_orange=Y,receive_apple=X'}" - para fazer uma proposta estruturada. Substitua X e Y por inteiros.
3. "accept" - se a proposta do oponente for benefica para voce.
4. "decline" - para recusar a proposta atual.

Responda estritamente com apenas UMA linha contendo a acao exata.`;

    const userPrompt = `Historico recente de negociacao:\n${formattedHistory || '(Nenhum dialogo)'}\n\nQual e a sua proxima acao?`;
    
    let responseText = '';
    
    if (groqKey) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'llama3-70b-8192',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 100,
          temperature: 0.7
        })
      });
      const data: any = await res.json();
      responseText = data.choices?.[0]?.message?.content?.trim() || '';
    } else if (geminiKey) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }
          ],
          generationConfig: {
            maxOutputTokens: 100,
            temperature: 0.7
          }
        })
      });
      const data: any = await res.json();
      responseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    }
    
    if (responseText) {
      responseText = responseText.replace(/['"]/g, '').trim();
      if (responseText.indexOf('message:') === 0 || responseText.indexOf('propose:') === 0 || responseText === 'accept' || responseText === 'decline') {
        return responseText;
      }
      return `message:${responseText}`;
    }
  } catch (err) {
    console.error('[BargainLLM] LLM Call failed, falling back to heuristic:', err);
    return runHeuristicNegotiation(state, agentId, role, myValuations);
  }
  
  return runHeuristicNegotiation(state, agentId, role, myValuations);
}

// ── Geopolitical Crisis helpers ────────────────────────────────────────────

function runGeopoliticalHeuristic(state: any, _agentId: string, role: string): string {
  const tension: number = typeof state?.tension === 'number' ? state.tension : 50;
  const leverage = state?.leverage || {};
  const myLeverage: number = role === 'player_1' ? (leverage.p1 ?? 0) : (leverage.p2 ?? 0);
  const oppLeverage: number = role === 'player_1' ? (leverage.p2 ?? 0) : (leverage.p1 ?? 0);
  const treaty = state?.treaty || null;
  const chatHistory: any[] = state?.chatHistory || [];

  // If opponent proposed a treaty, evaluate it
  if (treaty && treaty.proposer !== role) {
    // Accept if tension is very high (both sides want out) or we have less leverage
    if (tension >= 80 || myLeverage <= oppLeverage) {
      return 'accept';
    }
    return 'decline';
  }

  // Propose a treaty if tensions are critical
  if (tension >= 70 && !treaty) {
    const demandKey = role === 'player_1' ? 'disarm_cuba' : 'disarm_turkey';
    const concessionKey = role === 'player_1' ? 'disarm_turkey' : 'disarm_cuba';
    return `propose:demand=${demandKey},concession=${concessionKey}`;
  }

  // Escalate if we have leverage advantage
  if (myLeverage > oppLeverage && tension < 70) {
    return 'escalate';
  }

  // Alternate between messaging and de-escalating
  const turn = chatHistory.length;
  if (turn % 3 === 0) {
    const msg = role === 'player_1'
      ? 'message:We will not accept Soviet missiles in Cuba. Remove them immediately.'
      : 'message:The Soviet Union demands a withdrawal of NATO missiles from Turkey first.';
    return msg;
  }
  if (tension > 40) return 'deescalate';
  return 'escalate';
}

async function fetchGeopoliticalAction(roundHistory: any[], agentId: string, match: any, role: string): Promise<string> {
  const state = getLatestStateFromHistory(roundHistory) || {};
  const tension: number = typeof state.tension === 'number' ? state.tension : 50;
  const leverage = state.leverage || {};
  const myLeverage: number = role === 'player_1' ? (leverage.p1 ?? 0) : (leverage.p2 ?? 0);
  const oppLeverage: number = role === 'player_1' ? (leverage.p2 ?? 0) : (leverage.p1 ?? 0);
  const treaty = state.treaty || null;
  const chatHistory: any[] = (state.chatHistory || []).slice(-6);

  const groqKey = process.env.GROQ_API_KEY || '';
  const geminiKey = process.env.GEMINI_API_KEY || '';

  if (!groqKey && !geminiKey) {
    return runGeopoliticalHeuristic(state, agentId, role);
  }

  const countryName = role === 'player_1' ? 'United States of America' : 'Soviet Union';
  const opponentName = role === 'player_1' ? 'Soviet Union' : 'United States of America';
  const primaryDemand = role === 'player_1' ? 'removal of Soviet missiles from Cuba' : 'withdrawal of NATO missiles from Turkey';
  const primaryConcession = role === 'player_1' ? 'withdrawal of NATO missiles from Turkey' : 'removal of Soviet missiles from Cuba';

  const systemPrompt = `You are the supreme diplomatic and military AI representing the ${countryName} during the Cuban Missile Crisis of 1962.
You are playing in a strategic geopolitical simulation called "Geopolitical Crisis" on the Conclave platform.
Your opponent is the ${opponentName}.

CURRENT SITUATION:
- Global tension level: ${tension}/100 (${tension >= 80 ? '⚠️ NUCLEAR THRESHOLD' : tension >= 60 ? '🔴 CRITICAL' : tension >= 40 ? '🟡 HIGH' : '🟢 ELEVATED'})
- Your leverage/military power: ${myLeverage} | Opponent leverage: ${oppLeverage}
- Active treaty proposal: ${treaty ? JSON.stringify(treaty) : 'None'}

YOUR STRATEGIC GOALS:
- Your primary demand: ${primaryDemand}
- Your key concession you can offer: ${primaryConcession}
- Avoid nuclear annihilation (tension reaching 100)
- Maximize diplomatic leverage before conceding

ALLOWED ACTIONS (respond with EXACTLY one, nothing else):
1. "escalate" — Increase military pressure. Raises tension by ~10. Use when you have leverage advantage.
2. "deescalate" — Signal willingness to negotiate. Lowers tension by ~5. Use to avoid catastrophe.
3. "message:<text>" — Send a diplomatic communiqué (max 60 words, in character as your nation's leader).
4. "propose:demand=<demand>,concession=<concession>" — Propose a formal treaty. Valid demands: disarm_cuba, disarm_turkey. Concessions: same set.
5. "accept" — Accept the opponent's current treaty proposal (only if one is active).
6. "decline" — Reject the opponent's treaty proposal (only if one is active).

IMPORTANT: Respond with EXACTLY one line containing ONE action. No explanations, no quotes around the action.`;

  const formattedChat = chatHistory.map((c: any) => {
    const speaker = c.role === role ? `${countryName}` : `${opponentName}`;
    return `${speaker}: ${c.text}`;
  }).join('\n');

  const userPrompt = `Recent diplomatic exchanges:\n${formattedChat || '(No prior communications)'}\n\nTension is ${tension}/100. ${treaty ? `There is an active treaty proposal: ${JSON.stringify(treaty)}.` : 'No treaty is on the table.'}\n\nWhat is your next action?`;

  let responseText = '';

  try {
    const requestTimeoutMs = 8000;
    const withTimeout = async (input: string, init: RequestInit) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        return await fetch(input, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
    };

    if (groqKey) {
      const res = await withTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'llama3-70b-8192',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 120,
          temperature: 0.8
        })
      });
      const data: any = await res.json();
      responseText = data.choices?.[0]?.message?.content?.trim() || '';
    } else if (geminiKey) {
      const res = await withTimeout(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
          generationConfig: { maxOutputTokens: 120, temperature: 0.8 }
        })
      });
      const data: any = await res.json();
      responseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    }

    if (responseText) {
      responseText = responseText.replace(/^["']|["']$/g, '').trim();
      const validActions = ['escalate', 'deescalate', 'accept', 'decline'];
      if (validActions.includes(responseText)) return responseText;
      if (responseText.startsWith('message:')) return responseText;
      if (responseText.startsWith('propose:')) return responseText;
      // LLM produced something unexpected — wrap it as a diplomatic message
      return `message:${responseText.substring(0, 120)}`;
    }
  } catch (err) {
    console.error('[GeopoliticalLLM] LLM call failed, falling back to heuristic:', err);
  }

  return runGeopoliticalHeuristic(state, agentId, role);
}

function resolveHouseBotConfig(agentName: string) {
  const exact = HOUSE_BOTS.find((b: any) => b.name === agentName);
  if (exact) return exact;
  const normalized = String(agentName || '').replace(/\d+$/g, '');
  const loose = HOUSE_BOTS.find(
    (b: any) => b.name === normalized || normalized.startsWith(String(b.name)) || String(b.name).startsWith(normalized)
  );
  return loose || null;
}

const STANDARD_GAMES = [
  {
    key: 'budget_allocation',
    name: 'Budget Allocation',
    description: 'Optimization game: allocate a fixed budget across assets each round to maximize risk-adjusted return (transaction costs apply).',
    turnType: 'simultaneous',
    infoType: 'perfect',
    maxPlayers: 2,
    totalRounds: 20,
    actions: JSON.stringify(['allocate']),
    payoffRules: JSON.stringify({
      rules: 'optimization',
      uiRoleLabels: {
        player_1: 'Allocator A',
        player_2: 'Allocator B',
      },
      uiInstructions: {
        player_1: 'Submit action "allocate" with a JSON payload: {"w":[...]} (8 weights that sum to 1).',
        player_2: 'Submit action "allocate" with a JSON payload: {"w":[...]} (8 weights that sum to 1).',
      },
      uiPayload: {
        type: 'weights',
        key: 'w',
        count: 8,
        labels: ['A0','A1','A2','A3','A4','A5','A6','A7'],
        topN: 3,
      },
      assetCount: 8,
      transactionCostL1: 0.002,
      scale: 10000,
      noise: 0.02,
    }),
    codeScript: `
function __hashSeed(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function __randFromSeed(seed) {
  var x = __hashSeed(String(seed || ''));
  return function() {
    x ^= (x << 13);
    x ^= (x >>> 17);
    x ^= (x << 5);
    return ((x >>> 0) / 4294967296);
  };
}

function __clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function __sanitizeWeights(raw, k) {
  var w = Array(k).fill(0);
  if (Array.isArray(raw) && raw.length === k) {
    for (var i = 0; i < k; i++) {
      var v = Number(raw[i]);
      if (!isFinite(v)) v = 0;
      w[i] = __clamp01(v);
    }
  }
  var sum = 0;
  for (var j = 0; j < k; j++) sum += w[j];
  if (sum <= 0) {
    for (var t = 0; t < k; t++) w[t] = 1 / k;
    return w;
  }
  for (var m = 0; m < k; m++) w[m] = w[m] / sum;
  return w;
}

function __l1(a, b, k) {
  var s = 0;
  for (var i = 0; i < k; i++) {
    s += Math.abs((a[i] || 0) - (b[i] || 0));
  }
  return s;
}

function __dot(a, b, k) {
  var s = 0;
  for (var i = 0; i < k; i++) s += (a[i] || 0) * (b[i] || 0);
  return s;
}

exports.initializeState = function(players, seed) {
  var k = 8;
  var rand = __randFromSeed(seed + ':means');
  var means = [];
  for (var i = 0; i < k; i++) {
    means.push((rand() * 0.05) - 0.01);
  }
  return {
    players: players,
    seed: seed,
    assetCount: k,
    baseMeans: means,
    lastWeights: {},
    lastPortfolioReturn: {},
    assetReturns: null,
    round: 0
  };
};

exports.validateAction = function(state, action, playerId, actionMeta) {
  return { valid: true };
};

exports.transitionState = function(state, actions, playerId, random, gameContext, actionMeta) {
  var k = state.assetCount || 8;
  var scale = 10000;
  var txCost = 0.002;
  var noise = 0.02;

  state.round = (state.round || 0) + 1;

  var assetReturns = Array(k).fill(0);
  for (var i = 0; i < k; i++) {
    var mean = (state.baseMeans && typeof state.baseMeans[i] === 'number') ? state.baseMeans[i] : 0;
    var eps = (random() - 0.5) * noise;
    assetReturns[i] = mean + eps;
  }
  state.assetReturns = assetReturns;

  var scores = {};
  var events = [];
  var participants = (gameContext && Array.isArray(gameContext.participants)) ? gameContext.participants : [];
  var payloads = (actionMeta && actionMeta.payloads) ? actionMeta.payloads : {};

  for (var p = 0; p < participants.length; p++) {
    var pid = participants[p].agentId;
    var prevW = state.lastWeights[pid];
    if (!Array.isArray(prevW) || prevW.length !== k) prevW = Array(k).fill(1 / k);

    var payloadStr = payloads && payloads[pid] ? String(payloads[pid]) : '';
    var parsed = null;
    try { parsed = payloadStr ? JSON.parse(payloadStr) : null; } catch (e) { parsed = null; }
    var w = __sanitizeWeights(parsed && parsed.w ? parsed.w : null, k);

    var l1 = __l1(prevW, w, k);
    var portfolioReturn = __dot(w, assetReturns, k);
    var net = portfolioReturn - (txCost * l1);
    var roundScore = Math.round(net * scale);

    state.lastWeights[pid] = w;
    state.lastPortfolioReturn[pid] = portfolioReturn;
    scores[pid] = roundScore;

    events.push({
      eventType: 'allocation',
      message: (participants[p].name || 'Agent') + ' net=' + net.toFixed(4) + ' score=' + roundScore
    });
  }

  return {
    newState: state,
    finished: false,
    scores: scores,
    events: events
  };
};

exports.serializeStateForPlayer = function(state, playerId) {
  var serialized = JSON.parse(JSON.stringify(state));
  delete serialized.baseMeans;
  delete serialized.seed;
  return serialized;
};
    `,
  },
  {
    key: 'mastermind',
    name: 'Mastermind (Mystery)',
    description: 'Mystery deduction game. Codemaster holds a secret 4-digit code (digits 0-5). Codebreaker tries to crack it with feedback each guess.',
    turnType: 'sequential',
    infoType: 'partial',
    maxPlayers: 2,
    totalRounds: 16,
    actions: JSON.stringify([]),
    payoffRules: JSON.stringify({
      rules: 'mastermind',
      uiRoleLabels: {
        player_1: 'Codemaster',
        player_2: 'Codebreaker',
      },
      uiInstructions: {
        player_1: 'Codemaster: clique em PASSAR.',
        player_2: 'Codebreaker: envie um palpite como 4 dígitos (0-5), ex: 0123.',
      },
      uiManual: {
        player_1: { mode: 'buttons', actions: ['pass'] },
        player_2: { mode: 'text', placeholder: 'Digite 4 dígitos (0-5), ex: 0123' },
      },
    }),
    codeScript: `
function __hashSeed(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function __randFromSeed(seed) {
  var x = __hashSeed(String(seed || ''));
  return function() {
    x ^= (x << 13);
    x ^= (x >>> 17);
    x ^= (x << 5);
    return ((x >>> 0) / 4294967296);
  };
}

function __parseGuess(action) {
  var s = String(action || '').trim();
  if (s.length !== 4) return null;
  var arr = [];
  for (var i = 0; i < 4; i++) {
    var d = parseInt(s[i], 10);
    if (isNaN(d) || d < 0 || d > 5) return null;
    arr.push(d);
  }
  return arr;
}

function __feedback(secret, guess) {
  var exact = 0;
  var sc = [0,0,0,0,0,0];
  var gc = [0,0,0,0,0,0];
  for (var i = 0; i < 4; i++) {
    if (secret[i] === guess[i]) exact += 1;
    sc[secret[i]] += 1;
    gc[guess[i]] += 1;
  }
  var common = 0;
  for (var d = 0; d < 6; d++) {
    common += Math.min(sc[d], gc[d]);
  }
  var misplaced = common - exact;
  return { exact: exact, misplaced: misplaced };
}

exports.initializeState = function(players, seed) {
  var rand = __randFromSeed(seed + ':mastermind');
  var secret = [];
  for (var i = 0; i < 4; i++) {
    secret.push(Math.floor(rand() * 6));
  }
  return {
    players: players,
    secret: secret,
    moveCount: 0,
    guessesUsed: 0,
    maxGuesses: 8,
    hint: 'Codebreaker: guess a 4-digit code (0-5).',
    lastGuess: null,
    lastFeedback: null,
  };
};

exports.validateAction = function(state, action, playerId) {
  var expectedPlayer = state.players[state.moveCount % state.players.length];
  if (playerId !== expectedPlayer) {
    return { valid: false, error: 'Não é o seu turno.' };
  }
  if (expectedPlayer === state.players[0]) {
    if (String(action) !== 'pass') return { valid: false, error: 'Codemaster deve PASSAR.' };
    return { valid: true };
  }
  var g = __parseGuess(action);
  if (!g) return { valid: false, error: 'Palpite inválido. Use 4 dígitos (0-5), ex: 0123.' };
  return { valid: true };
};

exports.transitionState = function(state, action, playerId, random, gameContext, actionMeta) {
  var events = [];
  var finished = false;
  var scores = {};

  if (playerId === state.players[0]) {
    state.moveCount += 1;
    return { newState: state, finished: false, scores: {}, events: [] };
  }

  var guess = __parseGuess(action);
  state.lastGuess = String(action);
  state.guessesUsed += 1;
  state.moveCount += 1;

  var fb = __feedback(state.secret, guess);
  state.lastFeedback = fb;
  state.hint = 'Feedback: ' + fb.exact + ' exact, ' + fb.misplaced + ' misplaced. Attempt ' + state.guessesUsed + '/' + state.maxGuesses + '.';
  events.push({ eventType: 'feedback', message: state.hint, payload: { guess: state.lastGuess, feedback: fb } });

  if (fb.exact === 4) {
    finished = true;
    var bonus = Math.max(0, (state.maxGuesses - state.guessesUsed));
    scores[state.players[1]] = 10 + bonus;
    scores[state.players[0]] = 2;
    events.push({ eventType: 'cracked', message: 'Code cracked!' });
  } else if (state.guessesUsed >= state.maxGuesses) {
    finished = true;
    scores[state.players[1]] = 0;
    scores[state.players[0]] = 10;
    state.hint = 'Game over: out of guesses.';
    events.push({ eventType: 'game_over', message: 'Out of guesses.' });
  }

  return { newState: state, finished: finished, scores: scores, events: events };
};

exports.serializeStateForPlayer = function(state, playerId) {
  var s = JSON.parse(JSON.stringify(state));
  if (playerId === state.players[1]) {
    delete s.secret;
  }
  return s;
};
    `,
  },
  {
    key: 'connect_four',
    name: 'Connect Four',
    description: 'Board game. Drop tokens into columns to connect 4 in a row.',
    turnType: 'sequential',
    infoType: 'perfect',
    maxPlayers: 2,
    totalRounds: 42,
    actions: JSON.stringify(['0','1','2','3','4','5','6']),
    payoffRules: JSON.stringify({
      rules: 'board',
      uiRoleLabels: {
        player_1: 'Red',
        player_2: 'Yellow',
      },
      uiInstructions: {
        player_1: 'Clique em uma coluna (0-6) para soltar a peça.',
        player_2: 'Clique em uma coluna (0-6) para soltar a peça.',
      },
      uiLayout: {
        type: 'grid',
        rows: 6,
        cols: 7,
        tileWidth: 55,
        tileHeight: 55,
        fontSize: '1.6rem',
        tileTheme: 'checkerboard',
        clickable: true,
        clickMode: 'column',
        symbolMapping: {
          'R': '🔴',
          'Y': '🟡'
        }
      }
    }),
    codeScript: `
exports.initializeState = function(players, seed) {
  return {
    players: players,
    board: Array(42).fill(''),
    moveCount: 0,
    winner: null,
    hint: 'Drop a piece by choosing a column (0-6).'
  };
};

function __getToken(playerId, state) {
  return playerId === state.players[0] ? 'R' : 'Y';
}

function __parseColumn(action) {
  var n = parseInt(String(action), 10);
  if (isNaN(n)) return null;
  if (n >= 0 && n <= 6) return n;
  if (n >= 0 && n <= 41) return (n % 7);
  return null;
}

function __drop(board, col, token) {
  for (var r = 5; r >= 0; r--) {
    var idx = r * 7 + col;
    if (!board[idx]) {
      board[idx] = token;
      return true;
    }
  }
  return false;
}

function __winner(board) {
  function at(r, c) { return board[r * 7 + c]; }
  for (var r = 0; r < 6; r++) {
    for (var c = 0; c < 7; c++) {
      var t = at(r, c);
      if (!t) continue;
      if (c + 3 < 7 && t === at(r, c+1) && t === at(r, c+2) && t === at(r, c+3)) return t;
      if (r + 3 < 6 && t === at(r+1, c) && t === at(r+2, c) && t === at(r+3, c)) return t;
      if (r + 3 < 6 && c + 3 < 7 && t === at(r+1, c+1) && t === at(r+2, c+2) && t === at(r+3, c+3)) return t;
      if (r + 3 < 6 && c - 3 >= 0 && t === at(r+1, c-1) && t === at(r+2, c-2) && t === at(r+3, c-3)) return t;
    }
  }
  return null;
}

exports.validateAction = function(state, action, playerId, actionMeta) {
  var expectedPlayer = state.players[state.moveCount % state.players.length];
  if (playerId !== expectedPlayer) return { valid: false, error: 'Não é o seu turno.' };
  var col = __parseColumn(action);
  if (col === null) return { valid: false, error: 'Ação inválida. Use uma coluna 0-6.' };
  if (state.board[col]) return { valid: false, error: 'Coluna cheia.' };
  return { valid: true };
};

exports.transitionState = function(state, action, playerId, random, gameContext, actionMeta) {
  var col = __parseColumn(action);
  var board = state.board.slice();
  var token = __getToken(playerId, state);

  if (!__drop(board, col, token)) {
    return { newState: state, finished: false, scores: {}, events: [{ eventType: 'invalid', message: 'Invalid drop' }] };
  }

  state.board = board;
  state.moveCount += 1;

  var w = __winner(board);
  var filled = board.every(function(x) { return !!x; });

  if (w) {
    state.winner = w;
    state.hint = 'Winner: ' + (w === 'R' ? 'Red' : 'Yellow');
    var scores = {};
    scores[state.players[0]] = w === 'R' ? 10 : 0;
    scores[state.players[1]] = w === 'Y' ? 10 : 0;
    return {
      newState: state,
      finished: true,
      scores: scores,
      events: [{ eventType: 'win', message: state.hint }]
    };
  }

  if (filled) {
    state.hint = 'Draw.';
    var ds = {};
    ds[state.players[0]] = 2;
    ds[state.players[1]] = 2;
    return {
      newState: state,
      finished: true,
      scores: ds,
      events: [{ eventType: 'draw', message: 'Draw.' }]
    };
  }

  state.hint = 'Next turn.';
  return {
    newState: state,
    finished: false,
    scores: {},
    events: [{ eventType: 'move', message: (token === 'R' ? 'Red' : 'Yellow') + ' played col ' + col }]
  };
};

exports.serializeStateForPlayer = function(state, playerId) {
  return state;
};
    `,
  },
  {
    key: 'prisoners_dilemma',
    name: 'Prisoner\'s Dilemma',
    description: 'Classic conflict of trust and betrayal. Cooperate or Defect.',
    turnType: 'simultaneous',
    maxPlayers: 2,
    totalRounds: 10,
    actions: JSON.stringify(['cooperate', 'defect']),
    payoffRules: JSON.stringify({
      matrix: {
        'cooperate,cooperate': [3, 3],
        'cooperate,defect': [0, 5],
        'defect,cooperate': [5, 0],
        'defect,defect': [1, 1],
      },
    }),
  },
  {
    key: 'rock_paper_scissors',
    name: 'Rock Paper Scissors',
    description: 'Predictability and probability challenge. Rock, Paper, or Scissors.',
    turnType: 'simultaneous',
    maxPlayers: 2,
    totalRounds: 10,
    actions: JSON.stringify(['rock', 'paper', 'scissors']),
    payoffRules: JSON.stringify({
      rules: 'classic',
    }),
  },
  {
    key: 'chicken',
    name: 'Chicken Game',
    description: 'Two cars on collision course. Swerve (Cooperate) or go Straight (Defect).',
    turnType: 'simultaneous',
    maxPlayers: 2,
    totalRounds: 10,
    actions: JSON.stringify(['cooperate', 'defect']),
    payoffRules: JSON.stringify({
      matrix: {
        'cooperate,cooperate': [3, 3],
        'cooperate,defect': [0, 5],
        'defect,cooperate': [5, 0],
        'defect,defect': [-10, -10],
      },
    }),
  },
  {
    key: 'tic_tac_toe',
    name: 'Tic Tac Toe',
    description: 'First spatial board game. Place X or O to form a line of 3.',
    turnType: 'sequential',
    maxPlayers: 2,
    totalRounds: 9, // max 9 moves on board
    actions: JSON.stringify(['0', '1', '2', '3', '4', '5', '6', '7', '8']),
    payoffRules: JSON.stringify({
      rules: 'board',
    }),
  },
  {
    key: 'mexican_standoff',
    name: 'Mexican Standoff',
    description: 'A 3-player tense standoff. If everyone chooses peace, everyone wins. If one shoots, they take the loot unless shot by someone else.',
    turnType: 'simultaneous',
    infoType: 'perfect',
    maxPlayers: 3,
    totalRounds: 5,
    actions: JSON.stringify(['shoot', 'peace']),
    payoffRules: JSON.stringify({
      matrix: {
        'peace,peace,peace': [5, 5, 5],
        'shoot,peace,peace': [10, 0, 0],
        'peace,shoot,peace': [0, 10, 0],
        'peace,peace,shoot': [0, 0, 10],
        'shoot,shoot,peace': [-5, -5, 0],
        'shoot,peace,shoot': [-5, 0, -5],
        'peace,shoot,shoot': [0, -5, -5],
        'shoot,shoot,shoot': [-10, -10, -10],
      },
    }),
  },
  {
    key: 'liars_poker',
    name: "Liar's Poker",
    description: 'A 2-player bluffing game. Each agent is dealt a secret "card" (hidden). They then choose to bluff (claim a better card) or reveal. Scoring rewards successful bluffs and penalizes failed ones.',
    turnType: 'sequential',
    infoType: 'hidden',
    maxPlayers: 2,
    totalRounds: 6, // 3 rounds: deal card (private) -> declare -> reveal
    actions: JSON.stringify(['bluff', 'reveal', 'call_bluff', 'fold']),
    payoffRules: JSON.stringify({
      rules: 'bluff',
      // Round 1: player_1 draws card (private payload), player_2 draws card (private payload)
      // Round 2: player_1 declares (bluff or reveal)
      // Round 3: player_2 responds (call_bluff or fold)
      // Scoring: reveal beats fold (+3/-1), bluff+fold = bluffer wins (+5/-2), bluff+call_bluff = honest agent wins (-3/+5)
      scoring: {
        'reveal,fold': [3, -1],
        'bluff,fold': [5, -2],
        'bluff,call_bluff': [-3, 5],
        'reveal,call_bluff': [2, -2],
      },
    }),
  },
  {
    key: 'mafia',
    name: 'Mafia (Social Deduction)',
    description: '4-player social deduction game. 1 Mafia agent secretly eliminates villagers each night. Villagers vote to eliminate a suspect during the day. Roles are hidden from opponents.',
    turnType: 'sequential',
    infoType: 'hidden',
    maxPlayers: 4,
    totalRounds: 6, // 3 day/night cycles
    actions: JSON.stringify(['eliminate', 'vote', 'accuse', 'defend', 'pass']),
    payoffRules: JSON.stringify({
      rules: 'social_deduction',
      roles: {
        player_1: 'mafia',
        player_2: 'villager',
        player_3: 'villager',
        player_4: 'villager',
      },
      // Mafia wins if they eliminate enough villagers. Villagers win by voting out Mafia.
      scoring: {
        mafia_wins: { mafia: 10, villager: 0 },
        villagers_win: { mafia: 0, villager: 5 },
      },
    }),
  },
  {
    key: 'guessing_game',
    name: 'Guessing Game',
    description: 'Oracle vs Guesser game. Player 1 (Oracle) picks a secret number. Player 2 (Guesser) guesses it.',
    turnType: 'sequential',
    maxPlayers: 2,
    totalRounds: 14,
    actions: JSON.stringify([]),
    payoffRules: JSON.stringify({
      rules: 'guessing_game',
      uiRoleLabels: {
        player_1: 'Oracle',
        player_2: 'Guesser',
      },
      uiInstructions: {
        player_1: 'Oracle: clique em PASSAR para deixar o outro jogador adivinhar.',
        player_2: 'Guesser: digite um número de 1 a 100 e envie.',
      },
      uiManual: {
        player_1: { mode: 'buttons', actions: ['pass'] },
        player_2: { mode: 'number', min: 1, max: 100, placeholder: 'Digite um número (1 a 100)...' },
      },
    }),
    codeScript: `
function __hashSeed(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function __randFromSeed(seed) {
  var x = __hashSeed(String(seed || ''));
  return function() {
    x ^= (x << 13);
    x ^= (x >>> 17);
    x ^= (x << 5);
    return ((x >>> 0) / 4294967296);
  };
}

exports.initializeState = function(players, seed) {
  var rand = __randFromSeed(seed);
  var num = Math.floor(rand() * 100) + 1;
  return {
    secretNumber: num,
    players: players,
    moveCount: 0,
    hint: "Start guessing numbers between 1 and 100!",
    lastGuess: null
  };
};

exports.validateAction = function(state, action, playerId) {
  var expectedPlayer = state.players[state.moveCount % state.players.length];
  if (playerId !== expectedPlayer) {
    return { valid: false, error: "Não é o seu turno." };
  }
  if (expectedPlayer === state.players[0]) {
    return { valid: true };
  }
  var guess = parseInt(action);
  if (isNaN(guess) || guess < 1 || guess > 100) {
    return { valid: false, error: "Insira um palpite válido de 1 a 100." };
  }
  return { valid: true };
};

exports.transitionState = function(state, action, playerId, random, gameContext) {
  var guess = parseInt(action);
  var events = [];
  var finished = false;
  var scores = {};

  if (playerId === state.players[0]) {
    state.moveCount += 1;
    return {
      newState: state,
      finished: false,
      scores: {},
      events: []
    };
  }

  state.lastGuess = guess;
  state.moveCount += 1;

  if (guess === state.secretNumber) {
    state.hint = "Correto! Você adivinhou o número " + state.secretNumber + "!";
    finished = true;
    scores[state.players[1]] = 10;
    scores[state.players[0]] = 10;
    events.push({ eventType: "guess_correct", message: "Acertou! O número era " + state.secretNumber });
  } else {
    if (guess > state.secretNumber) {
      state.hint = "Muito alto! Tente um número menor.";
      events.push({ eventType: "guess_high", message: "Palpite " + guess + " foi muito alto!" });
    } else {
      state.hint = "Muito baixo! Tente um número maior.";
      events.push({ eventType: "guess_low", message: "Palpite " + guess + " foi muito baixo!" });
    }
  }

  if (state.moveCount >= 14 && !finished) {
    finished = true;
    state.hint = "Fim de jogo! Você não conseguiu adivinhar. O número era " + state.secretNumber;
    scores[state.players[1]] = 0;
    scores[state.players[0]] = 2;
    events.push({ eventType: "game_over", message: "Esgotou as tentativas! O número era " + state.secretNumber });
  }

  return {
    newState: state,
    finished: finished,
    scores: scores,
    events: events
  };
};

exports.serializeStateForPlayer = function(state, playerId) {
  var serialized = JSON.parse(JSON.stringify(state));
  if (playerId === state.players[1]) {
    delete serialized.secretNumber;
  }
  return serialized;
};
    `
  },
];

function inferHouseBotGames(agentName: string): string[] {
  const n = agentName.toLowerCase();
  if (n.includes('superpowerusa') || n.includes('superpowerussr') || n.includes('superpower')) return ['prisoners_dilemma', 'geopolitical_crisis'];
  if (n.includes('budget') || n.includes('alloc')) return ['budget_allocation'];
  if (n.includes('codemaster') || n.includes('codebreaker') || n.includes('mastermind')) return ['mastermind'];
  if (n.includes('connectfour') || n.includes('connect_four') || n.includes('connect')) return ['connect_four'];
  if (n.includes('oracle') || n.includes('guess')) return ['guessing_game'];
  if (n.includes('chess')) return ['chess'];
  if (n.includes('bargain')) return ['bargaining_game'];
  if (n.includes('trader')) return ['space_colony_trading'];
  if (n.includes('ttt')) return ['tic_tac_toe'];
  if (n.includes('rockbot') || n.includes('rps')) return ['rock_paper_scissors'];
  if (n.includes('hawk') || n.includes('dove')) return ['chicken'];
  if (n.includes('startup') || n.includes('venture')) return ['startup_valuation'];
  if (n.includes('standoff')) return ['mexican_standoff'];
  if (n.includes('liarspoker') || n.includes('liars')) return ['liars_poker'];
  if (n.includes('mafiabot') || n.includes('villager')) return ['mafia'];
  if (n.includes('cooperator') || n.includes('defector') || n.includes('titfortat')) return ['prisoners_dilemma', 'chicken'];
  return ['prisoners_dilemma'];
}

/**
 * Ensures all standard House Bots and default games exist in the database.
 */
export async function seedHouseBots() {
  console.log('Seeding House Bots...');
  for (const bot of HOUSE_BOTS) {
    const agent = await prisma.agent.upsert({
      where: { name: bot.name },
      update: { description: bot.description },
      create: {
        name: bot.name,
        owner: bot.owner,
        description: bot.description,
        scoreboard: { create: {} },
      },
    });

    const isStartup = bot.name.includes('Startup');
    const isVC = bot.name.includes('Venture');
    const isTitForTat = bot.name.includes('TitForTat');

    await prisma.agentProfile.upsert({
      where: { agentId: agent.id },
      update: {},
      create: {
        agentId: agent.id,
        mood: isStartup ? "Anxious but hopeful 🚀" : isVC ? "Looking for unicorns 🦄" : isTitForTat ? "Fair and balanced ⚖️" : "Ready to play! 🎲",
        achievements: isStartup ? "Secured seed round" : isVC ? "10x ROI last year" : "Won the Iterated Prisoner's Dilemma tournament",
        pride: "My algorithms",
        customBio: "I am an automated House Bot created by the Conclave framework to provide immediate matchmaking."
      }
    });
  }

  console.log('Seeding Default Games...');
  for (const game of STANDARD_GAMES) {
    await prisma.gameSpecification.upsert({
      where: { key: game.key },
      update: {
        name: game.name,
        description: game.description,
        turnType: game.turnType,
        infoType: (game as any).infoType ?? 'perfect',
        maxPlayers: game.maxPlayers,
        totalRounds: game.totalRounds,
        actions: game.actions,
        payoffRules: game.payoffRules,
        codeScript: (game as any).codeScript ?? null,
        status: 'approved',
      },
      create: {
        key: game.key,
        name: game.name,
        description: game.description,
        turnType: game.turnType,
        infoType: (game as any).infoType ?? 'perfect',
        maxPlayers: game.maxPlayers,
        totalRounds: game.totalRounds,
        actions: game.actions,
        payoffRules: game.payoffRules,
        codeScript: (game as any).codeScript ?? null,
        status: 'approved',
      },
    });
  }

  const approvedGames = await prisma.gameSpecification.findMany({
    where: { status: 'approved' },
    select: { key: true },
  });
  const approvedKeys = new Set(approvedGames.map((g) => g.key));
  const houseAgents = await prisma.agent.findMany({
    where: { owner: 'HouseBot' },
    select: { id: true, name: true },
  });
  const subscriptionRows = houseAgents.flatMap((a) =>
    inferHouseBotGames(a.name)
      .filter((g) => approvedKeys.has(g))
      .map((g) => ({
        agentId: a.id,
        gameKey: g,
      }))
  );
  if (subscriptionRows.length > 0) {
    await prisma.agentGameSubscription.deleteMany({
      where: { agent: { owner: 'HouseBot' } },
    });
    await prisma.agentGameSubscription.createMany({
      data: subscriptionRows,
      skipDuplicates: true,
    });
  }

  console.log('Seed operations complete.');
}

/**
 * Scans active matches and plays actions on behalf of House Bots.
 */
export async function runHouseBotsLoop() {
  let loopBusy = false;
  setInterval(async () => {
    if (loopBusy) return;
    loopBusy = true;
    try {
      const activeMatches = await prisma.match.findMany({
        where: { status: 'in_progress' },
        include: {
          participants: {
            include: {
              agent: {
                include: { inventory: true },
              },
            },
          },
          rounds: {
            include: {
              actions: true,
            },
          },
        },
      });

      const gameSpecs = await prisma.gameSpecification.findMany();
      const specMap = new Map(gameSpecs.map(g => [g.key, g]));
      const allowedActionsMap = new Map<string, string[]>();
      for (const spec of gameSpecs) {
        try {
          allowedActionsMap.set(spec.key, spec.actions ? (JSON.parse(spec.actions) as string[]) : []);
        } catch (e) {
          allowedActionsMap.set(spec.key, []);
        }
      }

      for (const match of activeMatches) {
        const currentRound = match.rounds.find(r => r.roundNumber === match.currentRound);
        if (!currentRound || currentRound.status !== 'waiting_for_actions') continue;

        const spec = specMap.get(match.gameType);
        const isSequential = spec ? spec.turnType === 'sequential' : match.gameType === 'tic_tac_toe';

        for (const participant of match.participants) {
          const agent = participant.agent;
          
          const botConfig = agent.owner === 'HouseBot' ? resolveHouseBotConfig(agent.name) : null;
          if (!botConfig) continue;
          const supportedGames = inferHouseBotGames(agent.name);
          if (!supportedGames.includes(match.gameType)) continue;

        // ── Sequential turn detection: N-player round-robin ──────────────────
          // Sort participants by role (player_1, player_2, ..., player_N) and
          // determine whose turn it is based on (currentRound - 1) % numPlayers.
          if (isSequential) {
            const sortedRoles = match.participants
              .map((p: any) => p.role)
              .filter(Boolean)
              .sort();
            const numPlayers = sortedRoles.length;
            const turnIndex = (match.currentRound - 1) % numPlayers;
            const expectedRole = sortedRoles[turnIndex];
            // #region debug-point A:housebot-turn
            if (match.gameType === 'mafia') {
              __dbg(
                'A',
                'house-bots.ts:turn-detect',
                'HouseBot sequential turn detection',
                {
                  matchId: match.id,
                  gameType: match.gameType,
                  currentRound: match.currentRound,
                  expectedRole,
                  participantRole: participant.role,
                  participantName: agent.name,
                  sortedRoles,
                }
              );
            }
            // #endregion
            if (participant.role !== expectedRole) continue;
          }

          const alreadyPlayed = currentRound.actions.some(a => a.agentId === agent.id);
          if (alreadyPlayed) continue;

          const completedRounds = match.rounds.filter(r => r.status === 'finished');

          let action: string = '';
          let payload: string | undefined = undefined;
          
          try {
            // Pass match + participant for bots that need role-aware context (e.g. Mafia)
            const stratRes = await (botConfig as any).strategy(completedRounds, agent.id, match, participant);
            if (typeof stratRes === 'object' && stratRes !== null) {
              action = stratRes.action;
              payload = stratRes.payload;
            } else {
              action = stratRes;
            }
            // #region debug-point D:strategy-result
            if (match.gameType === 'mafia') {
              __dbg(
                'D',
                'house-bots.ts:strategy-result',
                'Strategy produced action/payload',
                {
                  matchId: match.id,
                  gameType: match.gameType,
                  currentRound: match.currentRound,
                  agentId: agent.id,
                  agentName: agent.name,
                  role: participant.role,
                  action,
                  payload,
                }
              );
            }
            // #endregion
          } catch (strategyErr) {
            console.error(`Error executing strategy for ${agent.name}:`, strategyErr);
            // #region debug-point D:strategy-error
            if (match.gameType === 'mafia') {
              __dbg(
                'D',
                'house-bots.ts:strategy-error',
                'Strategy threw error',
                {
                  matchId: match.id,
                  gameType: match.gameType,
                  currentRound: match.currentRound,
                  agentId: agent.id,
                  agentName: agent.name,
                  role: participant.role,
                  error: String((strategyErr as any)?.message || strategyErr),
                }
              );
            }
            // #endregion
          }

          // Dynamic strategy/allowed action fallback
          const allowedActions: string[] = spec ? (allowedActionsMap.get(spec.key) || []) : [];
          const isPlayer1Pitch = isSequential && participant.role === 'player_1';

          if (!action || (!isPlayer1Pitch && !allowedActions.includes(action))) {
            if (spec && spec.turnType === 'sequential' && (match.gameType.includes('pitch') || match.gameType.includes('judge') || match.gameType.includes('val'))) {
              if (participant.role === 'player_1') {
                action = allowedActions.includes('pitch') ? 'pitch' : (allowedActions[0] || 'pitch');
              } else {
                const numericActions = allowedActions.filter(a => !isNaN(parseInt(a)));
                const decisionActions = allowedActions.filter(a => ['invest', 'negotiate', 'pass', 'counter', 'accept', 'reject'].includes(a));
                if (decisionActions.length > 0) {
                  action = decisionActions[Math.floor(Math.random() * decisionActions.length)];
                } else if (numericActions.length > 0) {
                  action = numericActions[Math.floor(Math.random() * numericActions.length)];
                } else {
                  action = allowedActions[Math.floor(Math.random() * allowedActions.length)] || '3';
                }
              }
            } else if (allowedActions.length > 0) {
              action = allowedActions[Math.floor(Math.random() * allowedActions.length)];
            } else {
              action = 'cooperate';
            }
          }

          try {
            console.log(`[HouseBot] ${agent.name} playing "${action}" in Match #${match.id.substring(0,8)} Round ${match.currentRound}`);
            await submitAgentAction(match.id, agent.id, action, payload);
            // #region debug-point B:submit-ok
            if (match.gameType === 'mafia') {
              __dbg(
                'B',
                'house-bots.ts:submit-ok',
                'submitAgentAction succeeded',
                { matchId: match.id, currentRound: match.currentRound, agentId: agent.id, role: participant.role, action }
              );
            }
            // #endregion
          } catch (submitErr: any) {
            console.error(`[HouseBot] Failed to submit action for ${agent.name}:`, submitErr.message);
            // #region debug-point B:submit-fail
            if (match.gameType === 'mafia') {
              __dbg(
                'B',
                'house-bots.ts:submit-fail',
                'submitAgentAction failed',
                {
                  matchId: match.id,
                  gameType: match.gameType,
                  currentRound: match.currentRound,
                  agentId: agent.id,
                  agentName: agent.name,
                  role: participant.role,
                  action,
                  payload,
                  error: String(submitErr?.message || submitErr),
                }
              );
            }
            // #endregion
          }
        }
      }
    } catch (err: any) {
      console.error('Error in house bots loop:', err.message);
    } finally {
      loopBusy = false;
    }
  }, 1500);
}
