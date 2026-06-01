-- AlterTable
ALTER TABLE "Round" ADD COLUMN "payload" TEXT;

-- CreateTable
CREATE TABLE "GameSpecification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "turnType" TEXT NOT NULL DEFAULT 'simultaneous',
    "maxPlayers" INTEGER NOT NULL DEFAULT 2,
    "totalRounds" INTEGER NOT NULL DEFAULT 10,
    "actions" TEXT NOT NULL,
    "payoffRules" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL DEFAULT 'Developer',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "GameSpecification_key_key" ON "GameSpecification"("key");
