import prisma from '../db.js';

const chessPayoffRules = JSON.stringify({
  rules: "chess",
  uiLayout: {
    type: "grid",
    rows: 8,
    cols: 8,
    tileWidth: 45,
    tileHeight: 45,
    fontSize: "1.8rem",
    tileTheme: "checkerboard",
    symbolMapping: {
      p: "♟", r: "♜", n: "♞", b: "♝", q: "♛", k: "♚",
      P: "♙", R: "♖", N: "♘", B: "♗", Q: "♕", K: "♔"
    }
  }
});

async function updatePayoff() {
  await prisma.gameSpecification.update({
    where: { key: 'chess' },
    data: { payoffRules: chessPayoffRules }
  });
  console.log('Chess payoffRules and uiLayout updated in DB!');
}

updatePayoff().catch(console.error);
