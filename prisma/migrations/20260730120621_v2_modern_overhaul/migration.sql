-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "avatar" TEXT
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameTitle" TEXT NOT NULL,
    "gameCoverUrl" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "maxPlayers" INTEGER NOT NULL DEFAULT 4,
    "discordChannelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorId" TEXT NOT NULL,
    CONSTRAINT "GameSession_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RSVP" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RSVP_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RSVP_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RSVP_sessionId_userId_key" ON "RSVP"("sessionId", "userId");
