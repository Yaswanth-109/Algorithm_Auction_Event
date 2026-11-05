-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TEAM');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'READY', 'LIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "AuctionKind" AS ENUM ('POWER_CARD', 'PROBLEM');

-- CreateEnum
CREATE TYPE "PowerCardEffect" AS ENUM ('NONE', 'TIME_EXTENSION', 'CREDIT_GRANT', 'SCORE_BONUS');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('AVAILABLE', 'ACTIVE', 'SOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SOLVED', 'TIME_EXPIRED');

-- CreateEnum
CREATE TYPE "SubmissionKind" AS ENUM ('RUN', 'SUBMIT');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('QUEUED', 'RUNNING', 'ACCEPTED', 'PARTIAL', 'WRONG_ANSWER', 'COMPILE_ERROR', 'RUNTIME_ERROR', 'TIME_LIMIT', 'MEMORY_LIMIT', 'INTERNAL_ERROR');

-- CreateEnum
CREATE TYPE "LeaderboardVisibility" AS ENUM ('HIDDEN', 'PUBLIC', 'FINAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'TEAM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "teamId" TEXT,
    "teamSlot" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "teamCode" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "credits" INTEGER NOT NULL DEFAULT 1000,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Algorithm Auction',
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "codingRoundOpen" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "leaderboardVisibility" "LeaderboardVisibility" NOT NULL DEFAULT 'HIDDEN',
    "publicRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSettings" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startingCredits" INTEGER NOT NULL DEFAULT 1000,
    "creditBonusRate" DECIMAL(6,4) NOT NULL DEFAULT 0.1,
    "creditBonusRounding" TEXT NOT NULL DEFAULT 'FLOOR',
    "timingPointsMax" INTEGER NOT NULL DEFAULT 0,
    "partialCreditEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxSourceBytes" INTEGER NOT NULL DEFAULT 50000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PowerCard" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "benefits" JSONB NOT NULL,
    "conditions" TEXT,
    "usageLimit" INTEGER,
    "effectType" "PowerCardEffect" NOT NULL DEFAULT 'NONE',
    "effectValue" INTEGER NOT NULL DEFAULT 0,
    "startingBid" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PowerCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "problemCode" VARCHAR(32) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "difficulty" VARCHAR(24) NOT NULL,
    "statement" TEXT NOT NULL,
    "inputFormat" TEXT NOT NULL,
    "outputFormat" TEXT NOT NULL,
    "constraints" TEXT NOT NULL,
    "sampleExamples" JSONB NOT NULL,
    "startingBid" INTEGER NOT NULL DEFAULT 0,
    "maxBid" INTEGER,
    "timeLimitSeconds" INTEGER NOT NULL DEFAULT 1200,
    "maxScore" INTEGER NOT NULL DEFAULT 100,
    "maxTimingPoints" INTEGER NOT NULL DEFAULT 0,
    "isCommonHurdle" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "AuctionKind" NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionItem" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "cardId" TEXT,
    "problemId" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'AVAILABLE',
    "currentBid" INTEGER NOT NULL DEFAULT 0,
    "highestTeamId" TEXT,
    "closesAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AuctionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "auctionItemId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamCard" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "usesRemaining" INTEGER,

    CONSTRAINT "TeamCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PowerCardActivation" (
    "id" TEXT NOT NULL,
    "teamCardId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "problemId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "effectType" "PowerCardEffect" NOT NULL,
    "effectValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PowerCardActivation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamProblem" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "status" "ProblemStatus" NOT NULL DEFAULT 'NOT_STARTED',

    CONSTRAINT "TeamProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodingSession" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "violationCount" INTEGER NOT NULL DEFAULT 0,
    "savedCode" TEXT NOT NULL DEFAULT '',
    "language" VARCHAR(16) NOT NULL DEFAULT 'PYTHON',
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CodingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "kind" "SubmissionKind" NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "source" TEXT NOT NULL,
    "customInput" TEXT,
    "runOutput" TEXT,
    "runError" TEXT,
    "compileOutput" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'QUEUED',
    "workerLeaseUntil" TIMESTAMP(3),
    "score" INTEGER NOT NULL DEFAULT 0,
    "executionMs" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseResult" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "awardedScore" INTEGER NOT NULL,
    "executionMs" INTEGER,

    CONSTRAINT "TestCaseResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "teamId" TEXT NOT NULL,
    "solution" INTEGER NOT NULL DEFAULT 0,
    "timing" INTEGER NOT NULL DEFAULT 0,
    "creditBonus" INTEGER NOT NULL DEFAULT 0,
    "adjustments" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("teamId")
);

-- CreateTable
CREATE TABLE "ScoreAdjustment" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "oldValue" INTEGER NOT NULL,
    "newValue" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "actorId" TEXT,
    "action" VARCHAR(100) NOT NULL,
    "targetType" VARCHAR(80) NOT NULL,
    "targetId" TEXT,
    "details" JSONB NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "kind" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_teamId_idx" ON "User"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "User_teamId_teamSlot_key" ON "User"("teamId", "teamSlot");

-- CreateIndex
CREATE UNIQUE INDEX "Team_teamCode_key" ON "Team"("teamCode");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventSettings_eventId_key" ON "EventSettings"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PowerCard_supersedesId_key" ON "PowerCard"("supersedesId");

-- CreateIndex
CREATE INDEX "PowerCard_eventId_published_idx" ON "PowerCard"("eventId", "published");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_supersedesId_key" ON "Problem"("supersedesId");

-- CreateIndex
CREATE INDEX "Problem_eventId_problemCode_idx" ON "Problem"("eventId", "problemCode");

-- CreateIndex
CREATE INDEX "Problem_eventId_published_idx" ON "Problem"("eventId", "published");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_eventId_problemCode_version_key" ON "Problem"("eventId", "problemCode", "version");

-- CreateIndex
CREATE INDEX "TestCase_problemId_isSample_position_idx" ON "TestCase"("problemId", "isSample", "position");

-- CreateIndex
CREATE INDEX "Auction_eventId_status_idx" ON "Auction"("eventId", "status");

-- CreateIndex
CREATE INDEX "AuctionItem_auctionId_status_idx" ON "AuctionItem"("auctionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_idempotencyKey_key" ON "Bid"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Bid_auctionItemId_createdAt_idx" ON "Bid"("auctionItemId", "createdAt");

-- CreateIndex
CREATE INDEX "Bid_teamId_createdAt_idx" ON "Bid"("teamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamCard_teamId_cardId_key" ON "TeamCard"("teamId", "cardId");

-- CreateIndex
CREATE UNIQUE INDEX "PowerCardActivation_idempotencyKey_key" ON "PowerCardActivation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PowerCardActivation_teamCardId_createdAt_idx" ON "PowerCardActivation"("teamCardId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamProblem_teamId_problemId_key" ON "TeamProblem"("teamId", "problemId");

-- CreateIndex
CREATE INDEX "CodingSession_teamId_deadlineAt_idx" ON "CodingSession"("teamId", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "CodingSession_teamId_problemId_key" ON "CodingSession"("teamId", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_idempotencyKey_key" ON "Submission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Submission_teamId_problemId_createdAt_idx" ON "Submission"("teamId", "problemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseResult_submissionId_testCaseId_key" ON "TestCaseResult"("submissionId", "testCaseId");

-- CreateIndex
CREATE INDEX "ScoreAdjustment_teamId_createdAt_idx" ON "ScoreAdjustment"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_eventId_createdAt_idx" ON "AuditLog"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_teamId_createdAt_idx" ON "Notification"("teamId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSettings" ADD CONSTRAINT "EventSettings_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerCard" ADD CONSTRAINT "PowerCard_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerCard" ADD CONSTRAINT "PowerCard_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "PowerCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionItem" ADD CONSTRAINT "AuctionItem_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionItem" ADD CONSTRAINT "AuctionItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PowerCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionItem" ADD CONSTRAINT "AuctionItem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionItem" ADD CONSTRAINT "AuctionItem_highestTeamId_fkey" FOREIGN KEY ("highestTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_auctionItemId_fkey" FOREIGN KEY ("auctionItemId") REFERENCES "AuctionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCard" ADD CONSTRAINT "TeamCard_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCard" ADD CONSTRAINT "TeamCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PowerCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerCardActivation" ADD CONSTRAINT "PowerCardActivation_teamCardId_fkey" FOREIGN KEY ("teamCardId") REFERENCES "TeamCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerCardActivation" ADD CONSTRAINT "PowerCardActivation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProblem" ADD CONSTRAINT "TeamProblem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProblem" ADD CONSTRAINT "TeamProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodingSession" ADD CONSTRAINT "CodingSession_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodingSession" ADD CONSTRAINT "CodingSession_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseResult" ADD CONSTRAINT "TestCaseResult_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseResult" ADD CONSTRAINT "TestCaseResult_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreAdjustment" ADD CONSTRAINT "ScoreAdjustment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreAdjustment" ADD CONSTRAINT "ScoreAdjustment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
