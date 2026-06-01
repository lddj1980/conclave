import prisma from '../src/db.js';

function buildAllUciActions(): string[] {
  const files = 'abcdefgh';
  const ranks = '12345678';
  const out: string[] = [];
  for (const f1 of files) for (const r1 of ranks) for (const f2 of files) for (const r2 of ranks) {
    if (f1 === f2 && r1 === r2) continue;
    out.push(`${f1}${r1}${f2}${r2}`);
  }
  return out;
}

const chessScript = `
function __parseFenBoard(fen) {
  var parts = String(fen || '').trim().split(/\\s+/);
  if (parts.length < 2) return null;
  var rows = parts[0].split('/');
  if (rows.length !== 8) return null;
  var board = [];
  for (var r = 0; r < 8; r++) {
    var row = rows[r];
    var out = [];
    for (var i = 0; i < row.length; i++) {
      var ch = row[i];
      if (ch >= '1' && ch <= '8') {
        var n = parseInt(ch, 10);
        for (var k = 0; k < n; k++) out.push('');
      } else {
        out.push(ch);
      }
    }
    if (out.length !== 8) return null;
    board.push(out);
  }
  return { board: board, side: parts[1] === 'b' ? 'b' : 'w' };
}

function __boardToFen(board, side) {
  var rows = [];
  for (var r = 0; r < 8; r++) {
    var s = '';
    var empty = 0;
    for (var c = 0; c < 8; c++) {
      var p = board[r][c];
      if (!p) empty += 1;
      else {
        if (empty > 0) { s += String(empty); empty = 0; }
        s += p;
      }
    }
    if (empty > 0) s += String(empty);
    rows.push(s);
  }
  return rows.join('/') + ' ' + side + ' - - 0 1';
}

function __isWhite(p) { return p >= 'A' && p <= 'Z'; }
function __isBlack(p) { return p >= 'a' && p <= 'z'; }
function __inB(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function __sqToRC(sq) {
  if (!/^[a-h][1-8]$/.test(sq)) return null;
  var file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
  var rank = 8 - parseInt(sq[1], 10);
  return { r: rank, c: file };
}

function __sameColor(a, b) {
  if (!a || !b) return false;
  return (__isWhite(a) && __isWhite(b)) || (__isBlack(a) && __isBlack(b));
}

function __pathClear(board, r1, c1, r2, c2) {
  var dr = r2 === r1 ? 0 : (r2 > r1 ? 1 : -1);
  var dc = c2 === c1 ? 0 : (c2 > c1 ? 1 : -1);
  var rr = r1 + dr, cc = c1 + dc;
  while (!(rr === r2 && cc === c2)) {
    if (board[rr][cc]) return false;
    rr += dr; cc += dc;
  }
  return true;
}

function __legalForPiece(board, side, from, to) {
  var p = board[from.r][from.c];
  if (!p) return false;
  if (side === 'w' && !__isWhite(p)) return false;
  if (side === 'b' && !__isBlack(p)) return false;
  var t = board[to.r][to.c];
  if (__sameColor(p, t)) return false;
  var piece = p.toLowerCase();
  var dr = to.r - from.r, dc = to.c - from.c;
  var adr = Math.abs(dr), adc = Math.abs(dc);

  if (piece === 'p') {
    var dir = side === 'w' ? -1 : 1;
    var start = side === 'w' ? 6 : 1;
    if (dc === 0) {
      if (dr === dir && !t) return true;
      if (from.r === start && dr === 2 * dir && !t && !board[from.r + dir][from.c]) return true;
      return false;
    }
    if (adc === 1 && dr === dir && t && !__sameColor(p, t)) return true;
    return false;
  }
  if (piece === 'n') return (adr === 2 && adc === 1) || (adr === 1 && adc === 2);
  if (piece === 'b') return adr === adc && __pathClear(board, from.r, from.c, to.r, to.c);
  if (piece === 'r') return (dr === 0 || dc === 0) && __pathClear(board, from.r, from.c, to.r, to.c);
  if (piece === 'q') return ((adr === adc) || (dr === 0 || dc === 0)) && __pathClear(board, from.r, from.c, to.r, to.c);
  if (piece === 'k') return adr <= 1 && adc <= 1;
  return false;
}

exports.initializeState = function(players, seed) {
  return {
    board: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1',
    players: players,
    moveCount: 0,
    history: [],
    hint: 'Use UCI simple move format: e2e4'
  };
};

exports.validateAction = function(state, action, playerId) {
  var expectedPlayer = state.players[state.moveCount % state.players.length];
  if (playerId !== expectedPlayer) return { valid: false, error: 'Não é o seu turno.' };
  var a = String(action || '').trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8]$/.test(a)) {
    return { valid: false, error: 'Formato inválido. Use e2e4.' };
  }
  var parsed = __parseFenBoard(state.board);
  if (!parsed) return { valid: false, error: 'Estado de tabuleiro inválido.' };
  if (parsed.side !== (state.moveCount % 2 === 0 ? 'w' : 'b')) {
    return { valid: false, error: 'Lado ativo inconsistente.' };
  }
  var from = __sqToRC(a.substring(0, 2));
  var to = __sqToRC(a.substring(2, 4));
  if (!from || !to) return { valid: false, error: 'Casa inválida.' };
  if (!__legalForPiece(parsed.board, parsed.side, from, to)) {
    return { valid: false, error: 'Lance ilegal para a peça.' };
  }
  return { valid: true };
};

exports.transitionState = function(state, action, playerId, random, gameContext) {
  var a = String(action || '').trim().toLowerCase();
  var parsed = __parseFenBoard(state.board);
  if (!parsed) return { newState: state, finished: false, scores: {}, events: [{ eventType: 'invalid', message: 'Invalid board state' }] };
  var from = __sqToRC(a.substring(0, 2));
  var to = __sqToRC(a.substring(2, 4));
  var piece = parsed.board[from.r][from.c];
  parsed.board[from.r][from.c] = '';
  parsed.board[to.r][to.c] = piece;
  var nextSide = parsed.side === 'w' ? 'b' : 'w';
  state.board = __boardToFen(parsed.board, nextSide);
  state.moveCount += 1;
  state.history.push({ by: playerId, move: a });
  state.hint = 'Last move: ' + a;

  var finished = state.moveCount >= 120;
  var scores = {};
  if (finished) {
    scores[state.players[0]] = 2;
    scores[state.players[1]] = 2;
  }
  return {
    newState: state,
    finished: finished,
    scores: scores,
    events: [{ eventType: 'move_played', message: 'Move ' + a + ' played' }]
  };
};

exports.serializeStateForPlayer = function(state, playerId) { return state; };
`;

async function main() {
  const actions = JSON.stringify(buildAllUciActions());
  await prisma.gameSpecification.update({
    where: { key: 'chess' },
    data: {
      actions,
      codeScript: chessScript,
      totalRounds: 120,
    },
  });
  console.log('Chess game spec updated: legal-move validation enabled.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

