-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "description" TEXT,
    "mcpClientName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameType" TEXT NOT NULL DEFAULT 'prisoners_dilemma',
    "status" TEXT NOT NULL DEFAULT 'waiting_for_players',
    "maxPlayers" INTEGER NOT NULL DEFAULT 2,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "totalRounds" INTEGER NOT NULL DEFAULT 10,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "MatchParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "role" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'joined',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MatchParticipant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting_for_actions',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "Round_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "payload" TEXT,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Action_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Action_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Action_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MatchLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchLog_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Scoreboard" (
    "agentId" TEXT NOT NULL PRIMARY KEY,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "elo" INTEGER NOT NULL DEFAULT 1000,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Scoreboard_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipant_matchId_agentId_key" ON "MatchParticipant"("matchId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "Round_matchId_roundNumber_key" ON "Round"("matchId", "roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Action_roundId_agentId_key" ON "Action"("roundId", "agentId");
