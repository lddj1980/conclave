export function parseJsonSafe(input: any): any | null {
  if (typeof input !== 'string') return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

export function parseFenBoardSimple(fen: string): { board: string[][]; side: 'w' | 'b' } | null {
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

export function buildSimpleUciMoves(board: string[][], side: 'w' | 'b'): string[] {
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

export function getChessLegalMovesFromRoundPayload(payload: any): string[] {
  const parsed = typeof payload === 'string' ? parseJsonSafe(payload) : payload;
  const fen = parsed && typeof parsed.board === 'string'
    ? parsed.board
    : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';
  const board = parseFenBoardSimple(fen);
  if (!board) return [];
  return buildSimpleUciMoves(board.board, board.side);
}

export function getChessLegalMovesFromState(state: any): string[] {
  return getChessLegalMovesFromRoundPayload(state);
}
