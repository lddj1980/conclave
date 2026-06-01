export type TTTBoard = string[]; // Array of 9 strings: 'X', 'O', or ''

export interface TTTResult {
  board: TTTBoard;
  valid: boolean;
  winner: 'X' | 'O' | null;
  isDraw: boolean;
}

const WIN_PATTERNS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
  [0, 4, 8], [2, 4, 6]             // Diagonals
];

export function checkWinner(board: TTTBoard): 'X' | 'O' | null {
  for (const pattern of WIN_PATTERNS) {
    const [a, b, c] = pattern;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as 'X' | 'O';
    }
  }
  return null;
}

export function playTTTTurn(
  currentBoard: TTTBoard,
  cellIndex: number,
  symbol: 'X' | 'O'
): TTTResult {
  // Copy board
  const newBoard = [...currentBoard];

  // Validate range and occupancy
  if (cellIndex < 0 || cellIndex > 8 || newBoard[cellIndex] !== '') {
    return {
      board: currentBoard,
      valid: false,
      winner: null,
      isDraw: false,
    };
  }

  // Apply move
  newBoard[cellIndex] = symbol;

  const winner = checkWinner(newBoard);
  const isDraw = !winner && newBoard.every(cell => cell !== '');

  return {
    board: newBoard,
    valid: true,
    winner,
    isDraw,
  };
}
