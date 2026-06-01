import prisma from '../db.js';

async function checkChess() {
  const chessSpec = await prisma.gameSpecification.findUnique({
    where: { key: 'chess' },
  });
  if (chessSpec && chessSpec.codeScript) {
    console.log(chessSpec.codeScript);
  } else {
    console.log('No script found');
  }
}

checkChess().catch(console.error);
