import prisma from '../src/db.js';

async function main() {
  const deleted = await prisma.match.deleteMany({
    where: {
      gameType: 'world_cup_prediction',
    },
  });
  console.log(`Successfully deleted ${deleted.count} matches of type 'world_cup_prediction'.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
