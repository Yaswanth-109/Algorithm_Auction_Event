import { Router } from "express";
import { z } from "zod";
import argon2 from "argon2";
import type { Server } from "socket.io";
import type { Prisma, PrismaClient } from "./generated/prisma/client.js";
import { requireAdmin } from "./auth.js";
import { calculateCreditBonus, calculateTimingPoints } from "./domain.js";

const MemberInput = z.object({ email: z.string().email().max(254), password: z.string().min(12).max(256) }).strict();
const TeamInput = z.object({
  teamCode: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(100),
  members: z.array(MemberInput).length(2),
}).strict();
const CardInput = z.object({
  name: z.string().trim().min(1).max(100), description: z.string().min(1).max(10000),
  imageData: z.string().max(2_800_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).nullable().optional(),
  benefits: z.array(z.string().trim().min(1).max(500)).max(20), conditions: z.string().max(5000).nullable().optional(),
  usageLimit: z.number().int().positive().nullable().optional(), effectType: z.enum(["NONE", "TIME_EXTENSION", "CREDIT_GRANT", "SCORE_BONUS"]).default("NONE"),
  effectValue: z.number().int().nonnegative().max(100000).default(0), startingBid: z.number().int().nonnegative(),
}).strict();
const CaseInput = z.object({ input: z.string().max(100000), expected: z.string().max(100000), weight: z.number().int().nonnegative(), isSample: z.boolean(), position: z.number().int().nonnegative() }).strict();
const ProblemInput = z.object({
  problemCode: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/), title: z.string().trim().min(1).max(150),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD", "EXPERT"]), statement: z.string().min(1).max(50000),
  inputFormat: z.string().min(1).max(10000), outputFormat: z.string().min(1).max(10000), constraints: z.string().min(1).max(10000),
  sampleExamples: z.array(z.object({ input: z.string().max(100000), output: z.string().max(100000), explanation: z.string().max(10000).optional() }).strict()).max(20),
  startingBid: z.number().int().nonnegative(), maxBid: z.number().int().nonnegative().nullable().optional(),
  timeLimitSeconds: z.number().int().min(60).max(86400), maxScore: z.number().int().positive(), maxTimingPoints: z.number().int().nonnegative().default(0),
  testCases: z.array(CaseInput).min(1).max(1000),
}).strict().superRefine((problem, context) => {
  const samples = problem.testCases.filter((testCase) => testCase.isSample);
  const official = problem.testCases.filter((testCase) => !testCase.isSample);
  if (!samples.length) context.addIssue({ code: "custom", path: ["testCases"], message: "At least one visible sample is required" });
  if (!official.length) context.addIssue({ code: "custom", path: ["testCases"], message: "At least one hidden official test case is required" });
  if (official.reduce((sum, testCase) => sum + testCase.weight, 0) !== problem.maxScore) context.addIssue({ code: "custom", path: ["testCases"], message: "Official test case weights must add up to the maximum score" });
  if (problem.maxBid !== null && problem.maxBid !== undefined && problem.maxBid < problem.startingBid) context.addIssue({ code: "custom", path: ["maxBid"], message: "Maximum bid cannot be lower than the starting bid" });
});

export function createAdminRouter(prisma: PrismaClient, io: Server, codingCollaboration: { resetSessions(sessionIds: string[]): Promise<void> }) {
  const router = Router();
  router.use(requireAdmin);

  async function getEvent() {
    let event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" } });
    if (!event) event = await prisma.event.create({ data: { name: "Algorithm Auction", settings: { create: {} } } });
    return event;
  }

  const audit = (actorId: string, action: string, targetType: string, targetId: string | null, details: object) =>
    prisma.auditLog.create({ data: { actorId, action, targetType, targetId, details } });

  async function closeLiveAuctionItems(tx: Prisma.TransactionClient, where: Prisma.AuctionItemWhereInput) {
    const items = await tx.auctionItem.findMany({
      where: { ...where, status: { in: ["AVAILABLE", "ACTIVE"] }, auction: { status: { in: ["SCHEDULED", "OPEN"] } } },
      select: { id: true, auctionId: true, highestTeamId: true, currentBid: true },
    });
    for (const item of items) {
      if (item.highestTeamId && item.currentBid > 0) await tx.team.update({ where: { id: item.highestTeamId }, data: { reservedCredits: { decrement: item.currentBid }, revision: { increment: 1 } } });
    }
    if (items.length) await tx.auctionItem.updateMany({ where: { id: { in: items.map((item) => item.id) } }, data: { status: "CLOSED", revision: { increment: 1 } } });
    return { auctionIds: [...new Set(items.map((item) => item.auctionId))], teamIds: [...new Set(items.flatMap((item) => item.highestTeamId ? [item.highestTeamId] : []))] };
  }

  async function deleteAuctionItems(tx: Prisma.TransactionClient, where: Prisma.AuctionItemWhereInput) {
    const items = await tx.auctionItem.findMany({ where, select: { id: true, auctionId: true, status: true, highestTeamId: true, currentBid: true } });
    for (const item of items) {
      if (!item.highestTeamId || item.currentBid <= 0) continue;
      if (item.status === "SOLD") await tx.team.update({ where: { id: item.highestTeamId }, data: { credits: { increment: item.currentBid }, revision: { increment: 1 } } });
      else if (item.status === "AVAILABLE" || item.status === "ACTIVE") await tx.team.update({ where: { id: item.highestTeamId }, data: { reservedCredits: { decrement: item.currentBid }, revision: { increment: 1 } } });
    }
    const ids = items.map((item) => item.id);
    const bids = ids.length ? await tx.bid.deleteMany({ where: { auctionItemId: { in: ids } } }) : { count: 0 };
    if (ids.length) await tx.auctionItem.deleteMany({ where: { id: { in: ids } } });
    return {
      auctionIds: [...new Set(items.map((item) => item.auctionId))],
      teamIds: [...new Set(items.flatMap((item) => item.highestTeamId ? [item.highestTeamId] : []))],
      itemCount: items.length,
      bidCount: bids.count,
    };
  }

  async function recalculateTeamScore(tx: Prisma.TransactionClient, eventId: string, teamId: string) {
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { scoreResetAt: true, creditBonusAwardedAt: true } });
    const [team, currentScore, assignments, submissions] = await Promise.all([
      tx.team.findUnique({ where: { id: teamId }, select: { id: true } }),
      tx.score.findUnique({ where: { teamId } }),
      tx.teamProblem.findMany({ where: { teamId }, include: { problem: true } }),
      tx.submission.findMany({ where: { teamId, kind: "SUBMIT", createdAt: { gte: event?.scoreResetAt ?? new Date(0) }, status: { in: ["ACCEPTED", "PARTIAL", "WRONG_ANSWER"] } }, orderBy: { createdAt: "asc" } }),
    ]);
    if (!team) return;
    const bestByProblem = new Map<string, (typeof submissions)[number]>();
    for (const submission of submissions) {
      const previous = bestByProblem.get(submission.problemId);
      if (!previous || submission.score > previous.score) bestByProblem.set(submission.problemId, submission);
    }
    let solution = 0;
    let timing = 0;
    for (const assignment of assignments) {
      const best = bestByProblem.get(assignment.problemId);
      if (!best) continue;
      solution += best.score;
      if (best.status === "ACCEPTED" && best.score >= assignment.problem.maxScore) {
        const coding = await tx.codingSession.findUnique({ where: { teamId_problemId: { teamId, problemId: assignment.problemId } } });
        if (coding) {
          const elapsed = Math.max(0, (best.createdAt.getTime() - coding.startedAt.getTime()) / 1000);
          timing += calculateTimingPoints(Math.max(0, assignment.problem.timeLimitSeconds - elapsed), assignment.problem.timeLimitSeconds);
        }
      }
    }
    const creditBonus = event?.creditBonusAwardedAt ? currentScore?.creditBonus ?? 0 : 0;
    const adjustments = currentScore?.adjustments ?? 0;
    await tx.score.upsert({ where: { teamId }, create: { teamId, solution, timing, creditBonus, adjustments, total: solution + timing + creditBonus + adjustments }, update: { solution, timing, creditBonus, adjustments, total: solution + timing + creditBonus + adjustments, revision: { increment: 1 } } });
  }

  router.get("/teams", async (_req, res, next) => {
    try {
      const teams = await prisma.team.findMany({ orderBy: { teamCode: "asc" }, include: { users: { select: { id: true, email: true, teamSlot: true, active: true } }, score: true } });
      res.json({ teams: teams.map((team) => ({ ...team, availableCredits: team.credits - team.reservedCredits })) });
    } catch (error) { next(error); }
  });

  router.get("/teams/:teamId/coding-sessions", async (req, res, next) => {
    try {
      const team = await prisma.team.findUnique({ where: { id: req.params.teamId }, select: { id: true } });
      if (!team) return res.status(404).json({ error: "Team not found" });
      const serverNow = Date.now();
      const sessions = await prisma.codingSession.findMany({
        where: { teamId: team.id, endedAt: null, deadlineAt: { gt: new Date(serverNow) } },
        orderBy: { startedAt: "asc" },
        select: { id: true, startedAt: true, deadlineAt: true, problem: { select: { id: true, problemCode: true, title: true } } },
      });
      res.json({ serverNow, sessions: sessions.map((session) => ({ ...session, remainingSeconds: Math.max(0, Math.ceil((session.deadlineAt.getTime() - serverNow) / 1000)) })) });
    } catch (error) { next(error); }
  });

  router.post("/teams/:teamId/coding-sessions/:sessionId/extend", async (req, res, next) => {
    try {
      const input = z.object({ extraSeconds: z.number().int().min(1).max(7200) }).strict().safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Provide an extension from 1 to 7,200 seconds" });
      const event = await getEvent();
      const result = await prisma.$transaction(async (tx) => {
        const session = await tx.codingSession.findFirst({ where: { id: req.params.sessionId, teamId: req.params.teamId } });
        if (!session) throw Object.assign(new Error("Coding session not found for this team"), { status: 404 });
        const now = new Date();
        if (session.endedAt || session.deadlineAt <= now) throw Object.assign(new Error("This algorithm session has expired and cannot be extended"), { status: 409 });
        const deadlineAt = new Date(session.deadlineAt.getTime() + input.data.extraSeconds * 1000);
        const updated = await tx.codingSession.updateMany({ where: { id: session.id, teamId: session.teamId, endedAt: null, deadlineAt: session.deadlineAt }, data: { deadlineAt, revision: { increment: 1 } } });
        if (updated.count !== 1) throw Object.assign(new Error("The coding timer changed. Refresh and try again."), { status: 409 });
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "coding_session.time_extended_by_admin", targetType: "CodingSession", targetId: session.id, details: { teamId: session.teamId, problemId: session.problemId, extraSeconds: input.data.extraSeconds, previousDeadlineAt: session.deadlineAt.toISOString(), deadlineAt: deadlineAt.toISOString() } } });
        return { sessionId: session.id, teamId: session.teamId, problemId: session.problemId, previousDeadlineAt: session.deadlineAt, deadlineAt };
      }, { isolationLevel: "Serializable" });
      const timerUpdate = { sessionId: result.sessionId, deadlineAt: result.deadlineAt.toISOString(), serverNow: Date.now() };
      io.to(`team:${result.teamId}`).emit("coding.timer.updated", timerUpdate);
      io.to("event:admin").emit("coding.timer.updated", { ...timerUpdate, teamId: result.teamId, problemId: result.problemId });
      res.json({ extended: true, ...timerUpdate, extraSeconds: input.data.extraSeconds });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Timer extension rejected" });
      next(error);
    }
  });

  router.get("/teams/:teamId/score-adjustments", async (req, res, next) => {
    try {
      const team = await prisma.team.findUnique({ where: { id: req.params.teamId }, include: { scoreAdjustments: { orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { email: true } } } } } });
      if (!team) return res.status(404).json({ error: "Team not found" });
      res.json({ score: team.scoreAdjustments });
    } catch (error) { next(error); }
  });

  router.post("/teams/:teamId/score-adjustments", async (req, res, next) => {
    try {
      const input = z.object({ delta: z.number().int().min(-100000).max(100000), reason: z.string().trim().min(5).max(500) }).strict().safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Provide a score change and a reason of at least five characters" });
      const result = await prisma.$transaction(async (tx) => {
        const score = await tx.score.findUnique({ where: { teamId: req.params.teamId } });
        if (!score) throw Object.assign(new Error("Team score not found"), { status: 404 });
        const oldValue = score.adjustments;
        const newValue = oldValue + input.data.delta;
        const updated = await tx.score.update({ where: { teamId: req.params.teamId }, data: { adjustments: newValue, total: score.solution + score.timing + score.creditBonus + newValue, revision: { increment: 1 } } });
        const adjustment = await tx.scoreAdjustment.create({ data: { teamId: req.params.teamId, actorId: req.auth!.id, oldValue, newValue, reason: input.data.reason } });
        await tx.auditLog.create({ data: { actorId: req.auth!.id, action: "score.adjusted", targetType: "Team", targetId: req.params.teamId, details: { oldValue, newValue, delta: input.data.delta, reason: input.data.reason } } });
        return { updated, adjustment };
      }, { isolationLevel: "Serializable" });
      io.to("event:admin").emit("leaderboard.updated", { revision: result.updated.revision });
      io.to("event:teams").emit("leaderboard.updated", { revision: result.updated.revision });
      res.status(201).json(result);
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Score change rejected" });
      next(error);
    }
  });

  router.post("/scores/reset", async (req, res, next) => {
    try {
      const input = z.object({ confirmation: z.literal("RESET ALL SCORES") }).strict().safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: 'Type "RESET ALL SCORES" to confirm the reset' });
      const event = await getEvent();
      const result = await prisma.$transaction(async (tx) => {
        const currentEvent = await tx.event.findUniqueOrThrow({ where: { id: event.id } });
        if (currentEvent.codingRoundOpen) throw Object.assign(new Error("Close the coding round before resetting the scoreboard"), { status: 409 });
        const runningSubmissions = await tx.submission.count({ where: { status: "RUNNING" } });
        if (runningSubmissions > 0) throw Object.assign(new Error("Wait for running code evaluations to finish before resetting the scoreboard"), { status: 409 });
        const resetAt = new Date();
        const [teams, scores, adjustments] = await Promise.all([
          tx.team.count(),
          tx.score.updateMany({ data: { solution: 0, timing: 0, creditBonus: 0, adjustments: 0, total: 0, revision: { increment: 1 } } }),
          tx.scoreAdjustment.deleteMany(),
        ]);
        await tx.event.update({ where: { id: event.id }, data: { scoreResetAt: resetAt, publicRevision: { increment: 1 } } });
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "scoreboard.reset", targetType: "Event", targetId: event.id, details: { resetAt: resetAt.toISOString(), teams, scoresReset: scores.count, scoreHistoryCleared: adjustments.count } } });
        return { resetAt, teams, scoresReset: scores.count, scoreHistoryCleared: adjustments.count };
      }, { isolationLevel: "Serializable" });
      io.to("event:admin").emit("leaderboard.updated", { revision: Date.now() });
      io.to("event:teams").emit("leaderboard.updated", { revision: Date.now() });
      res.json({ reset: true, ...result });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Scoreboard reset rejected" });
      next(error);
    }
  });

  router.post("/teams", async (req, res, next) => {
    try {
      const input = TeamInput.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Invalid team details", details: input.error.flatten() });
      const members = input.data.members.map((member) => ({ ...member, email: member.email.toLowerCase() }));
      if (new Set(members.map((member) => member.email)).size !== 2) return res.status(400).json({ error: "Team member emails must be different" });
      const passwordHashes = await Promise.all(members.map(({ password }) => argon2.hash(password, { type: argon2.argon2id })));
      const event = await getEvent();
      const team = await prisma.$transaction(async (tx) => {
        const created = await tx.team.create({ data: { teamCode: input.data.teamCode, name: input.data.name, credits: (await tx.eventSettings.findUnique({ where: { eventId: event.id } }))?.startingCredits ?? 1000 } });
        await tx.user.createMany({ data: members.map((member, index) => ({ email: member.email, passwordHash: passwordHashes[index], role: "TEAM", teamId: created.id, teamSlot: index + 1 })) });
        await tx.score.create({ data: { teamId: created.id } });
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "team.created", targetType: "Team", targetId: created.id, details: { teamCode: created.teamCode, memberCount: 2 } } });
        return tx.team.findUniqueOrThrow({ where: { id: created.id }, include: { users: { select: { id: true, email: true, teamSlot: true } }, score: true } });
      }, { isolationLevel: "Serializable" });
      res.status(201).json({ team });
    } catch (error) { next(error); }
  });

  router.patch("/teams/:teamId", async (req, res, next) => {
    try {
      const input = z.object({ name: z.string().trim().min(2).max(100).optional(), active: z.boolean().optional() }).strict().safeParse(req.body);
      if (!input.success || !Object.keys(input.data ?? {}).length) return res.status(400).json({ error: "Provide a team name or active state" });
      const team = await prisma.team.update({ where: { id: req.params.teamId }, data: { ...input.data, revision: { increment: 1 } } });
      await audit(req.auth!.id, "team.updated", "Team", team.id, input.data);
      io.to(`team:${team.id}`).emit("team.updated", { teamId: team.id, revision: team.revision });
      io.to("event:admin").emit("team.updated", { teamId: team.id, revision: team.revision });
      res.json({ team });
    } catch (error) { next(error); }
  });

  router.post("/teams/:teamId/credits/deduct", async (req, res, next) => {
    try {
      const input = z.object({ amount: z.number().int().positive().max(100000), reason: z.string().trim().min(3).max(200) }).strict().safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Provide a credit amount and physical auction item or reason" });
      const event = await getEvent();
      const result = await prisma.$transaction(async (tx) => {
        const current = await tx.team.findUnique({ where: { id: req.params.teamId }, select: { id: true, credits: true, reservedCredits: true, revision: true } });
        if (!current) throw Object.assign(new Error("Team not found"), { status: 404 });
        const availableCredits = current.credits - current.reservedCredits;
        if (input.data.amount > availableCredits) throw Object.assign(new Error(`Cannot deduct ${input.data.amount} credits; this team has only ${availableCredits} available`), { status: 409 });
        const updated = await tx.team.updateMany({ where: { id: current.id, credits: current.credits, reservedCredits: current.reservedCredits, revision: current.revision }, data: { credits: { decrement: input.data.amount }, revision: { increment: 1 } } });
        if (updated.count !== 1) throw Object.assign(new Error("The team balance changed. Refresh and try again."), { status: 409 });
        await recalculateTeamScore(tx, event.id, current.id);
        const team = await tx.team.findUniqueOrThrow({ where: { id: current.id }, select: { id: true, credits: true, reservedCredits: true, revision: true } });
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "team.physical_auction_credits_deducted", targetType: "Team", targetId: team.id, details: { amount: input.data.amount, reason: input.data.reason, previousAvailableCredits: availableCredits, availableCredits: team.credits - team.reservedCredits } } });
        return team;
      }, { isolationLevel: "Serializable" });
      io.to(`team:${result.id}`).emit("team.updated", { teamId: result.id, revision: result.revision });
      io.to("event:admin").emit("team.updated", { teamId: result.id, revision: result.revision });
      io.to("event:admin").emit("leaderboard.updated", { revision: result.revision });
      io.to("event:teams").emit("leaderboard.updated", { revision: result.revision });
      res.json({ team: result, availableCredits: result.credits - result.reservedCredits });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Credit deduction rejected" });
      next(error);
    }
  });

  router.post("/credits/reset", async (req, res, next) => {
    try {
      const input = z.object({ confirmation: z.literal("RESET ALL TEAM CREDITS") }).strict().safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: 'Confirm with "RESET ALL TEAM CREDITS"' });
      const event = await getEvent();
      const result = await prisma.$transaction(async (tx) => {
        const startingCredits = (await tx.eventSettings.findUnique({ where: { eventId: event.id }, select: { startingCredits: true } }))?.startingCredits ?? 1000;
        const teams = await tx.team.findMany({ select: { id: true, reservedCredits: true } });
        if (teams.some((team) => team.reservedCredits > 0)) throw Object.assign(new Error("Close or settle auctions with active bids before resetting all team credits"), { status: 409 });
        await tx.team.updateMany({ data: { credits: startingCredits, reservedCredits: 0, revision: { increment: 1 } } });
        for (const team of teams) await recalculateTeamScore(tx, event.id, team.id);
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "credits.reset_all", targetType: "Event", targetId: event.id, details: { startingCredits, teamsReset: teams.length } } });
        const updatedTeams = await tx.team.findMany({ select: { id: true, revision: true } });
        return { startingCredits, teamsReset: updatedTeams.length, teams: updatedTeams };
      }, { isolationLevel: "Serializable" });
      for (const team of result.teams) {
        io.to(`team:${team.id}`).emit("team.updated", { teamId: team.id, revision: team.revision });
        io.to("event:admin").emit("team.updated", { teamId: team.id, revision: team.revision });
      }
      io.to("event:admin").emit("leaderboard.updated", { revision: Date.now() });
      io.to("event:teams").emit("leaderboard.updated", { revision: Date.now() });
      res.json({ reset: true, startingCredits: result.startingCredits, teamsReset: result.teamsReset });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Credit reset rejected" });
      next(error);
    }
  });

  router.get("/teams/:teamId/allocations", async (req, res, next) => {
    try {
      const team = await prisma.team.findUnique({
        where: { id: req.params.teamId },
        include: {
          cards: { include: { card: { select: { id: true, name: true } } } },
          problems: { where: { unassignedAt: null }, include: { problem: { select: { id: true, problemCode: true, title: true } } }, orderBy: { problem: { problemCode: "asc" } } },
        },
      });
      if (!team) return res.status(404).json({ error: "Team not found" });
      res.json({
        powerCards: team.cards.map(({ card, usesRemaining }) => ({ ...card, usesRemaining })),
        problems: team.problems.map(({ problem, status }) => ({ ...problem, status })),
      });
    } catch (error) { next(error); }
  });

  router.delete("/teams/:teamId/allocations/problems/:problemId", async (req, res, next) => {
    try {
      const event = await getEvent();
      const result = await prisma.$transaction(async (tx) => {
        const assignment = await tx.teamProblem.findUnique({
          where: { teamId_problemId: { teamId: req.params.teamId, problemId: req.params.problemId } },
          include: { problem: { select: { problemCode: true, title: true } } },
        });
        if (!assignment || assignment.unassignedAt) throw Object.assign(new Error("This algorithm is not assigned to the selected team"), { status: 404 });
        const [activeSession, pendingSubmissions] = await Promise.all([
          tx.codingSession.findFirst({ where: { teamId: assignment.teamId, problemId: assignment.problemId, endedAt: null, deadlineAt: { gt: new Date() } }, select: { id: true } }),
          tx.submission.count({ where: { teamId: assignment.teamId, problemId: assignment.problemId, status: { in: ["QUEUED", "RUNNING"] } } }),
        ]);
        if (activeSession) throw Object.assign(new Error("This team is actively working on this algorithm. End or wait for the session before unassigning it."), { status: 409 });
        if (pendingSubmissions > 0) throw Object.assign(new Error("Wait for this algorithm’s queued or running code evaluations to finish before unassigning it."), { status: 409 });
        const unassignedAt = new Date();
        await tx.teamProblem.update({ where: { id: assignment.id }, data: { unassignedAt } });
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "team.algorithm_unassigned", targetType: "TeamProblem", targetId: assignment.id, details: { teamId: assignment.teamId, problemId: assignment.problemId, problemCode: assignment.problem.problemCode, previousStatus: assignment.status, unassignedAt: unassignedAt.toISOString(), codingHistoryPreserved: true } } });
        const team = await tx.team.update({ where: { id: assignment.teamId }, data: { revision: { increment: 1 } } });
        return { teamId: team.id, revision: team.revision, problem: assignment.problem, unassignedAt };
      }, { isolationLevel: "Serializable" });
      io.to(`team:${result.teamId}`).emit("team.updated", { teamId: result.teamId, revision: result.revision });
      io.to("event:admin").emit("team.updated", { teamId: result.teamId, revision: result.revision });
      res.json({ unassigned: true, historyPreserved: true, ...result });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Unassign rejected" });
      next(error);
    }
  });

  router.put("/teams/:teamId/allocations", async (req, res, next) => {
    try {
      const input = z.object({ powerCardIds: z.array(z.string()).max(100).optional(), problemIds: z.array(z.string()).max(2).optional() }).strict().refine((data) => data.powerCardIds !== undefined || data.problemIds !== undefined).safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Provide power card selections or up to two algorithm selections" });
      if ((input.data.powerCardIds && new Set(input.data.powerCardIds).size !== input.data.powerCardIds.length) || (input.data.problemIds && new Set(input.data.problemIds).size !== input.data.problemIds.length)) return res.status(400).json({ error: "Allocation IDs must be unique" });
      const team = await prisma.team.findUnique({ where: { id: req.params.teamId } });
      if (!team) return res.status(404).json({ error: "Team not found" });
      const event = await getEvent();
      const [cards, problems, running] = await Promise.all([
        input.data.powerCardIds !== undefined ? prisma.powerCard.findMany({ where: { id: { in: input.data.powerCardIds }, eventId: event.id, published: true } }) : Promise.resolve([]),
        input.data.problemIds !== undefined ? prisma.problem.findMany({ where: { id: { in: input.data.problemIds }, eventId: event.id, published: true } }) : Promise.resolve([]),
        prisma.codingSession.count({ where: { teamId: team.id, endedAt: null, deadlineAt: { gt: new Date() } } }),
      ]);
      if ((input.data.powerCardIds !== undefined && cards.length !== input.data.powerCardIds.length) || (input.data.problemIds !== undefined && problems.length !== input.data.problemIds.length)) return res.status(400).json({ error: "Allocations must use published items from this event" });
      if (running > 0) return res.status(409).json({ error: "A team with an active coding session cannot be reallocated" });
      await prisma.$transaction(async (tx) => {
        if (input.data.powerCardIds !== undefined) {
          await tx.teamCard.deleteMany({ where: { teamId: team.id } });
          if (cards.length) await tx.teamCard.createMany({ data: cards.map((card) => ({ teamId: team.id, cardId: card.id, usesRemaining: card.usageLimit })) });
        }
        if (input.data.problemIds !== undefined) {
          if (problems.length > 2) throw Object.assign(new Error("A team can have at most two active algorithms"), { status: 409 });
          for (const problem of problems) {
            const previous = await tx.teamProblem.findUnique({ where: { teamId_problemId: { teamId: team.id, problemId: problem.id } } });
            if (previous?.unassignedAt) {
              const [sessions, submissions] = await Promise.all([
                tx.codingSession.count({ where: { teamId: team.id, problemId: problem.id } }),
                tx.submission.count({ where: { teamId: team.id, problemId: problem.id } }),
              ]);
              if (sessions || submissions) throw Object.assign(new Error(`${problem.problemCode} has preserved coding history and cannot be reassigned to this team`), { status: 409 });
            }
          }
          await tx.teamProblem.updateMany({ where: { teamId: team.id, unassignedAt: null }, data: { unassignedAt: new Date() } });
          for (const problem of problems) {
            await tx.teamProblem.upsert({
              where: { teamId_problemId: { teamId: team.id, problemId: problem.id } },
              update: { unassignedAt: null, status: "NOT_STARTED" },
              create: { teamId: team.id, problemId: problem.id },
            });
          }
        }
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "team.allocations_changed", targetType: "Team", targetId: team.id, details: { ...(input.data.powerCardIds !== undefined ? { powerCardIds: cards.map((card) => card.id) } : {}), ...(input.data.problemIds !== undefined ? { problemIds: problems.map((problem) => problem.id) } : {}) } } });
        await tx.team.update({ where: { id: team.id }, data: { revision: { increment: 1 } } });
      });
      io.to(`team:${team.id}`).emit("team.updated", { teamId: team.id, revision: Date.now() });
      io.to("event:admin").emit("team.updated", { teamId: team.id, revision: Date.now() });
      res.json({ allocated: true, powerCards: cards.length, problems: problems.length });
    } catch (error) { next(error); }
  });

  router.post("/teams/:teamId/allocations/problems", async (req, res, next) => {
    try {
      const input = z.object({ problemId: z.string().min(1) }).strict().safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Choose one published algorithm to assign" });
      const team = await prisma.team.findUnique({ where: { id: req.params.teamId }, select: { id: true } });
      if (!team) return res.status(404).json({ error: "Team not found" });
      const event = await getEvent();
      const result = await prisma.$transaction(async (tx) => {
        const problem = await tx.problem.findFirst({ where: { id: input.data.problemId, eventId: event.id, published: true }, select: { id: true, problemCode: true, title: true } });
        if (!problem) throw Object.assign(new Error("Choose a published algorithm from this event"), { status: 404 });
        const existing = await tx.teamProblem.findUnique({ where: { teamId_problemId: { teamId: team.id, problemId: problem.id } } });
        if (existing && !existing.unassignedAt) throw Object.assign(new Error("This algorithm is already assigned to the team"), { status: 409 });
        const activeCount = await tx.teamProblem.count({ where: { teamId: team.id, unassignedAt: null } });
        if (activeCount >= 2) throw Object.assign(new Error("This team already has the maximum of two active algorithms"), { status: 409 });
        if (existing?.unassignedAt) {
          const [sessions, submissions] = await Promise.all([
            tx.codingSession.count({ where: { teamId: team.id, problemId: problem.id } }),
            tx.submission.count({ where: { teamId: team.id, problemId: problem.id } }),
          ]);
          if (sessions || submissions) throw Object.assign(new Error("This algorithm has coding history and cannot be reassigned to this team"), { status: 409 });
          await tx.teamProblem.update({ where: { id: existing.id }, data: { unassignedAt: null, status: "NOT_STARTED" } });
        } else {
          await tx.teamProblem.create({ data: { teamId: team.id, problemId: problem.id } });
        }
        const updatedTeam = await tx.team.update({ where: { id: team.id }, data: { revision: { increment: 1 } }, select: { revision: true } });
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "team.algorithm_assigned", targetType: "Team", targetId: team.id, details: { problemId: problem.id, problemCode: problem.problemCode } } });
        return { problem, revision: updatedTeam.revision };
      }, { isolationLevel: "Serializable" });
      io.to(`team:${team.id}`).emit("team.updated", { teamId: team.id, revision: result.revision });
      io.to("event:admin").emit("team.updated", { teamId: team.id, revision: result.revision });
      res.status(201).json({ assigned: true, problem: result.problem });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Algorithm assignment rejected" });
      next(error);
    }
  });

  router.post("/teams/:teamId/reset-password", async (req, res, next) => {
    try {
      const input = z.object({ userId: z.string(), password: z.string().min(12).max(256) }).strict().safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Password must contain at least 12 characters" });
      const user = await prisma.user.findFirst({ where: { id: input.data.userId, teamId: req.params.teamId, role: "TEAM" } });
      if (!user) return res.status(404).json({ error: "Team member not found" });
      const passwordHash = await argon2.hash(input.data.password, { type: argon2.argon2id });
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
        prisma.session.deleteMany({ where: { userId: user.id } }),
        audit(req.auth!.id, "team.password_reset", "User", user.id, { teamId: req.params.teamId }),
      ]);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.post("/team-credentials/reset", async (req, res, next) => {
    try {
      const input = z.object({ confirmation: z.literal("RESET TEAM LOGIN CREDENTIALS") }).strict().safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: 'Confirm with "RESET TEAM LOGIN CREDENTIALS"' });
      const event = await getEvent();
      const teams = await prisma.team.findMany({ orderBy: { teamCode: "asc" }, include: { users: { where: { role: "TEAM" }, select: { id: true, email: true, teamSlot: true }, orderBy: { teamSlot: "asc" } } } });
      if (!teams.length || teams.length > 26 || teams.some((team) => team.users.length !== 2 || !team.users.some((user) => user.teamSlot === 1) || !team.users.some((user) => user.teamSlot === 2))) {
        return res.status(409).json({ error: "Every team must have exactly two members, and there can be at most 26 teams" });
      }
      const credentials = teams.flatMap((team, index) => {
        const letter = String.fromCharCode(65 + index);
        return team.users.map((user) => ({ teamId: team.id, teamCode: team.teamCode, userId: user.id, teamSlot: user.teamSlot!, email: `team${letter.toLowerCase()}.member${user.teamSlot}@algorithmauction.local`, password: `team${letter}member${user.teamSlot}_2026` }));
      });
      const ids = credentials.map((credential) => credential.userId);
      const conflicting = await prisma.user.findFirst({ where: { email: { in: credentials.map((credential) => credential.email) }, id: { notIn: ids } }, select: { id: true } });
      if (conflicting) return res.status(409).json({ error: "A generated team email is already used by another account. No credentials were changed." });
      const passwordHashes = await Promise.all(credentials.map((credential) => argon2.hash(credential.password, { type: argon2.argon2id })));
      await prisma.$transaction(async (tx) => {
        for (const [index, credential] of credentials.entries()) {
          await tx.user.update({ where: { id: credential.userId }, data: { email: credential.email, passwordHash: passwordHashes[index] } });
        }
        await tx.session.deleteMany({ where: { userId: { in: ids } } });
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "team.login_credentials_reset", targetType: "Event", targetId: event.id, details: { teamsUpdated: teams.length, teamAccountsUpdated: credentials.length, emailPattern: "teamA.member1@algorithmauction.local", existingSessionsRevoked: true } } });
      }, { isolationLevel: "Serializable" });
      res.json({ updated: true, credentials: credentials.map(({ teamId, teamCode, userId, ...credential }) => ({ ...credential, teamCode })) });
    } catch (error) { next(error); }
  });

  router.get("/power-cards", async (_req, res, next) => {
    try {
      const event = await getEvent();
      const cards = await prisma.powerCard.findMany({ where: { eventId: event.id }, include: { successor: { select: { id: true, published: true, version: true } } }, orderBy: [{ name: "asc" }, { version: "desc" }] });
      res.json({ cards: cards.map(({ imageData, ...card }) => ({ ...card, imageUrl: imageData ? `/api/admin/power-cards/${card.id}/image?v=${card.updatedAt.getTime()}` : null })) });
    }
    catch (error) { next(error); }
  });

  router.get("/power-cards/:cardId/image", async (req, res, next) => {
    try {
      const card = await prisma.powerCard.findUnique({ where: { id: String(req.params.cardId) }, select: { imageData: true } });
      const match = card?.imageData?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) return res.status(404).json({ error: "Power card image not found" });
      res.setHeader("Content-Type", match[1]);
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(Buffer.from(match[2], "base64"));
    } catch (error) { next(error); }
  });

  router.post("/power-cards", async (req, res, next) => {
    try {
      const input = CardInput.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Invalid power card", details: input.error.flatten() });
      const event = await getEvent();
      const card = await prisma.powerCard.create({ data: { eventId: event.id, ...input.data, benefits: input.data.benefits, published: false } });
      await audit(req.auth!.id, "power_card.draft_created", "PowerCard", card.id, { name: card.name });
      const { imageData, ...savedCard } = card;
      res.status(201).json({ card: { ...savedCard, imageUrl: imageData ? `/api/admin/power-cards/${card.id}/image?v=${card.updatedAt.getTime()}` : null } });
    } catch (error) { next(error); }
  });

  router.put("/power-cards/:cardId", async (req, res, next) => {
    try {
      const input = CardInput.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Invalid power card", details: input.error.flatten() });
      const current = await prisma.powerCard.findUnique({ where: { id: req.params.cardId } });
      if (!current) return res.status(404).json({ error: "Power card not found" });
      const imageData = input.data.imageData === undefined ? current.imageData : input.data.imageData;
      const card = current.published
        ? await prisma.powerCard.create({ data: { eventId: current.eventId, supersedesId: current.id, version: current.version + 1, ...input.data, imageData, benefits: input.data.benefits, published: false } })
        : await prisma.powerCard.update({ where: { id: current.id }, data: { ...input.data, benefits: input.data.benefits } });
      await audit(req.auth!.id, "power_card.draft_saved", "PowerCard", card.id, { sourceVersionId: current.id, version: card.version });
      const { imageData: savedImage, ...savedCard } = card;
      res.json({ card: { ...savedCard, imageUrl: savedImage ? `/api/admin/power-cards/${card.id}/image?v=${card.updatedAt.getTime()}` : null } });
    } catch (error) { next(error); }
  });

  router.post("/power-cards/:cardId/publish", async (req, res, next) => {
    try {
      const card = await prisma.powerCard.findUnique({ where: { id: req.params.cardId } });
      if (!card) return res.status(404).json({ error: "Power card not found" });
      await prisma.$transaction(async (tx) => {
        if (card.supersedesId) {
          await tx.powerCard.update({ where: { id: card.supersedesId }, data: { published: false } });
          await tx.event.updateMany({ where: { id: card.eventId, displayCardId: card.supersedesId }, data: { displayCardId: card.id } });
        }
        await tx.powerCard.update({ where: { id: card.id }, data: { published: true } });
        await tx.auditLog.create({ data: { actorId: req.auth!.id, action: "power_card.published", targetType: "PowerCard", targetId: card.id, details: { version: card.version } } });
      });
      io.to("event:admin").emit("event.updated", { eventId: card.eventId, revision: Date.now() });
      io.to("event:teams").emit("event.updated", { eventId: card.eventId, revision: Date.now() });
      res.json({ published: true, cardId: card.id });
    } catch (error) { next(error); }
  });

  router.post("/power-cards/:cardId/unpublish", async (req, res, next) => {
    try {
      const card = await prisma.powerCard.findUnique({ where: { id: req.params.cardId } });
      if (!card) return res.status(404).json({ error: "Power card not found" });
      if (!card.published) return res.status(409).json({ error: "Power card is already unpublished" });
      const result = await prisma.$transaction(async (tx) => {
        const closed = await closeLiveAuctionItems(tx, { cardId: card.id });
        for (const teamId of closed.teamIds) await recalculateTeamScore(tx, card.eventId, teamId);
        await tx.powerCard.update({ where: { id: card.id }, data: { published: false } });
        await tx.event.updateMany({ where: { id: card.eventId, displayCardId: card.id }, data: { displayCardId: null } });
        const event = await tx.event.update({ where: { id: card.eventId }, data: { publicRevision: { increment: 1 } }, select: { publicRevision: true } });
        await tx.auditLog.create({ data: { eventId: card.eventId, actorId: req.auth!.id, action: "power_card.unpublished", targetType: "PowerCard", targetId: card.id, details: { name: card.name, version: card.version, force: true, closedAuctionCount: closed.auctionIds.length } } });
        return { ...closed, revision: event.publicRevision };
      }, { isolationLevel: "Serializable" });
      io.to("event:admin").emit("event.updated", { eventId: card.eventId, revision: result.revision });
      io.to("event:teams").emit("event.updated", { eventId: card.eventId, revision: result.revision });
      io.to("event:admin").emit("leaderboard.updated", { revision: Date.now() });
      io.to("event:teams").emit("leaderboard.updated", { revision: Date.now() });
      for (const teamId of result.teamIds) io.to(`team:${teamId}`).emit("team.updated", { teamId, revision: Date.now() });
      for (const auctionId of result.auctionIds) {
        io.to("event:admin").emit("auction.updated", { auctionId, revision: Date.now() });
        io.to("event:teams").emit("auction.updated", { auctionId, revision: Date.now() });
      }
      res.json({ unpublished: true, cardId: card.id, auctionsClosed: result.auctionIds.length });
    } catch (error) { next(error); }
  });

  router.delete("/power-cards/:cardId", async (req, res, next) => {
    try {
      const card = await prisma.powerCard.findUnique({ where: { id: req.params.cardId }, include: { successor: { select: { id: true } } } });
      if (!card) return res.status(404).json({ error: "Power card not found" });
      const result = await prisma.$transaction(async (tx) => {
        const [assignmentRows, activationCount, auction] = await Promise.all([
          tx.teamCard.findMany({ where: { cardId: card.id }, select: { teamId: true } }),
          tx.powerCardActivation.count({ where: { teamCard: { cardId: card.id } } }),
          deleteAuctionItems(tx, { cardId: card.id }),
        ]);
        await tx.powerCardActivation.deleteMany({ where: { teamCard: { cardId: card.id } } });
        await tx.teamCard.deleteMany({ where: { cardId: card.id } });
        if (card.successor) await tx.powerCard.update({ where: { id: card.successor.id }, data: { supersedesId: card.supersedesId } });
        await tx.powerCard.delete({ where: { id: card.id } });
        const teamIds = [...new Set([...assignmentRows.map((row) => row.teamId), ...auction.teamIds])];
        for (const teamId of teamIds) await recalculateTeamScore(tx, card.eventId, teamId);
        const event = await tx.event.update({ where: { id: card.eventId }, data: { publicRevision: { increment: 1 } }, select: { publicRevision: true } });
        await tx.auditLog.create({ data: { eventId: card.eventId, actorId: req.auth!.id, action: "power_card.deleted", targetType: "PowerCard", targetId: card.id, details: { name: card.name, version: card.version, force: true, assignmentsRemoved: assignmentRows.length, activationsRemoved: activationCount, auctionItemsRemoved: auction.itemCount, bidsRemoved: auction.bidCount, spentAuctionCreditsRefunded: true, priorCardEffectsReversed: false } } });
        return { ...auction, teamIds, revision: event.publicRevision };
      }, { isolationLevel: "Serializable" });
      io.to("event:admin").emit("event.updated", { eventId: card.eventId, revision: result.revision });
      io.to("event:teams").emit("event.updated", { eventId: card.eventId, revision: result.revision });
      io.to("event:admin").emit("leaderboard.updated", { revision: Date.now() });
      io.to("event:teams").emit("leaderboard.updated", { revision: Date.now() });
      for (const teamId of result.teamIds) io.to(`team:${teamId}`).emit("team.updated", { teamId, revision: Date.now() });
      for (const auctionId of result.auctionIds) {
        io.to("event:admin").emit("auction.updated", { auctionId, revision: Date.now() });
        io.to("event:teams").emit("auction.updated", { auctionId, revision: Date.now() });
      }
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.delete("/problems/:problemId", async (req, res, next) => {
    try {
      const problem = await prisma.problem.findUnique({ where: { id: req.params.problemId }, include: { successor: { select: { id: true } }, assignments: { select: { teamId: true } }, submissions: { select: { id: true, teamId: true } }, testCases: { select: { id: true } } } });
      if (!problem) return res.status(404).json({ error: "Problem not found" });
      const affectedTeams = new Set([...problem.assignments.map((row) => row.teamId), ...problem.submissions.map((row) => row.teamId)]);
      const result = await prisma.$transaction(async (tx) => {
        const auction = await deleteAuctionItems(tx, { problemId: problem.id });
        const submissionIds = problem.submissions.map((row) => row.id);
        const testCaseIds = problem.testCases.map((row) => row.id);
        const resultFilters: Prisma.TestCaseResultWhereInput[] = [];
        if (submissionIds.length) resultFilters.push({ submissionId: { in: submissionIds } });
        if (testCaseIds.length) resultFilters.push({ testCaseId: { in: testCaseIds } });
        const testResults = resultFilters.length ? await tx.testCaseResult.deleteMany({ where: { OR: resultFilters } }) : { count: 0 };
        if (submissionIds.length) await tx.submission.deleteMany({ where: { id: { in: submissionIds } } });
        const sessions = await tx.codingSession.deleteMany({ where: { problemId: problem.id } });
        const assignments = await tx.teamProblem.deleteMany({ where: { problemId: problem.id } });
        const testCases = await tx.testCase.deleteMany({ where: { problemId: problem.id } });
        if (problem.successor) await tx.problem.update({ where: { id: problem.successor.id }, data: { supersedesId: problem.supersedesId } });
        await tx.problem.delete({ where: { id: problem.id } });

        const scoringTeams = new Set(affectedTeams);
        for (const teamId of auction.teamIds) scoringTeams.add(teamId);
        for (const teamId of scoringTeams) await recalculateTeamScore(tx, problem.eventId, teamId);
        const event = await tx.event.update({ where: { id: problem.eventId }, data: { publicRevision: { increment: 1 } }, select: { publicRevision: true } });
        await tx.auditLog.create({ data: { eventId: problem.eventId, actorId: req.auth!.id, action: "problem.deleted", targetType: "Problem", targetId: problem.id, details: { problemCode: problem.problemCode, title: problem.title, version: problem.version, force: true, assignmentsRemoved: assignments.count, codingSessionsRemoved: sessions.count, submissionsRemoved: submissionIds.length, testCasesRemoved: testCases.count, testResultsRemoved: testResults.count, auctionItemsRemoved: auction.itemCount, bidsRemoved: auction.bidCount, spentAuctionCreditsRefunded: true } } });
        return { ...auction, revision: event.publicRevision, teamIds: [...scoringTeams] };
      }, { isolationLevel: "Serializable" });
      io.to("event:admin").emit("event.updated", { eventId: problem.eventId, revision: result.revision });
      io.to("event:teams").emit("event.updated", { eventId: problem.eventId, revision: result.revision });
      io.to("event:admin").emit("leaderboard.updated", { revision: Date.now() });
      io.to("event:teams").emit("leaderboard.updated", { revision: Date.now() });
      for (const teamId of result.teamIds) io.to(`team:${teamId}`).emit("team.updated", { teamId, revision: Date.now() });
      for (const auctionId of result.auctionIds) {
        io.to("event:admin").emit("auction.updated", { auctionId, revision: Date.now() });
        io.to("event:teams").emit("auction.updated", { auctionId, revision: Date.now() });
      }
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.post("/problems/:problemId/test-cases", async (req, res, next) => {
    try {
      const input = CaseInput.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Invalid test case", details: input.error.flatten() });
      const problem = await prisma.problem.findUnique({ where: { id: req.params.problemId }, include: { testCases: true } });
      if (!problem) return res.status(404).json({ error: "Problem not found" });
      if (problem.published) return res.status(409).json({ error: "Create a new problem version before changing published test cases" });
      if (input.data.isSample && problem.testCases.some((row) => row.isSample && row.position === input.data.position)) return res.status(409).json({ error: "A sample already uses this position" });
      const testCase = await prisma.testCase.create({ data: { problemId: problem.id, ...input.data } });
      await audit(req.auth!.id, "test_case.created", "Problem", problem.id, { isSample: testCase.isSample, position: testCase.position });
      res.status(201).json({ testCase });
    } catch (error) { next(error); }
  });

  router.patch("/problems/:problemId/test-cases/:testCaseId", async (req, res, next) => {
    try {
      const input = CaseInput.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Invalid test case", details: input.error.flatten() });
      const problem = await prisma.problem.findUnique({ where: { id: req.params.problemId } });
      if (!problem) return res.status(404).json({ error: "Problem not found" });
      if (problem.published) return res.status(409).json({ error: "Create a new problem version before changing published test cases" });
      const testCase = await prisma.testCase.update({ where: { id: req.params.testCaseId, problemId: problem.id }, data: input.data });
      await audit(req.auth!.id, "test_case.updated", "Problem", problem.id, { testCaseId: testCase.id });
      res.json({ testCase });
    } catch (error) { next(error); }
  });

  router.delete("/problems/:problemId/test-cases/:testCaseId", async (req, res, next) => {
    try {
      const problem = await prisma.problem.findUnique({ where: { id: req.params.problemId } });
      if (!problem) return res.status(404).json({ error: "Problem not found" });
      if (problem.published) return res.status(409).json({ error: "Create a new problem version before changing published test cases" });
      await prisma.$transaction([prisma.testCase.delete({ where: { id: req.params.testCaseId, problemId: problem.id } }), audit(req.auth!.id, "test_case.deleted", "Problem", problem.id, { testCaseId: req.params.testCaseId })]);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.get("/problems", async (_req, res, next) => {
    try { const event = await getEvent(); res.json({ problems: await prisma.problem.findMany({ where: { eventId: event.id }, include: { testCases: { orderBy: { position: "asc" } }, successor: { select: { id: true, published: true, version: true } } }, orderBy: [{ problemCode: "asc" }, { version: "desc" }] }) }); }
    catch (error) { next(error); }
  });

  router.post("/problems/:problemId/reset-code-history", async (req, res, next) => {
    try {
      const event = await getEvent();
      const problem = await prisma.problem.findFirst({ where: { id: req.params.problemId, eventId: event.id }, select: { id: true, problemCode: true, title: true } });
      if (!problem) return res.status(404).json({ error: "Algorithm not found" });
      const result = await prisma.$transaction(async (tx) => {
        const running = await tx.submission.count({ where: { problemId: problem.id, status: "RUNNING" } });
        if (running) throw Object.assign(new Error("Wait for this algorithm’s running code evaluations to finish before resetting its history"), { status: 409 });
        const [sessions, submissions, assignments] = await Promise.all([
          tx.codingSession.findMany({ where: { problemId: problem.id }, select: { id: true, teamId: true } }),
          tx.submission.findMany({ where: { problemId: problem.id }, select: { teamId: true } }),
          tx.teamProblem.findMany({ where: { problemId: problem.id }, select: { teamId: true } }),
        ]);
        const submissionDelete = await tx.submission.deleteMany({ where: { problemId: problem.id } });
        await tx.codingSession.deleteMany({ where: { problemId: problem.id } });
        const assignmentReset = await tx.teamProblem.updateMany({ where: { problemId: problem.id }, data: { status: "NOT_STARTED" } });
        const teamIds = [...new Set([...sessions.map((row) => row.teamId), ...submissions.map((row) => row.teamId), ...assignments.map((row) => row.teamId)])];
        for (const teamId of teamIds) await recalculateTeamScore(tx, event.id, teamId);
        const revision = await tx.event.update({ where: { id: event.id }, data: { publicRevision: { increment: 1 } }, select: { publicRevision: true } });
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "problem.code_history_reset", targetType: "Problem", targetId: problem.id, details: { problemCode: problem.problemCode, title: problem.title, teamsAffected: teamIds.length, codingSessionsCleared: sessions.length, submissionsDeleted: submissionDelete.count, assignmentsReset: assignmentReset.count } } });
        return { sessionIds: sessions.map((row) => row.id), teamIds, revision: revision.publicRevision, sessionsCleared: sessions.length, submissionsDeleted: submissionDelete.count, teamsAffected: teamIds.length };
      }, { isolationLevel: "Serializable" });
      await codingCollaboration.resetSessions(result.sessionIds);
      for (const teamId of result.teamIds) io.to(`team:${teamId}`).emit("team.updated", { teamId, revision: Date.now() });
      io.to("event:admin").emit("leaderboard.updated", { revision: result.revision });
      io.to("event:teams").emit("leaderboard.updated", { revision: result.revision });
      io.to("event:admin").emit("event.updated", { eventId: event.id, revision: result.revision });
      res.json({ reset: true, problemId: problem.id, ...result, sessionIds: undefined });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Code history reset rejected" });
      next(error);
    }
  });

  router.post("/problems", async (req, res, next) => {
    try {
      const input = ProblemInput.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Invalid problem", details: input.error.flatten() });
      const { testCases, ...problem } = input.data;
      const event = await getEvent();
      const record = await prisma.problem.create({ data: { eventId: event.id, ...problem, sampleExamples: problem.sampleExamples, published: false, testCases: { create: testCases } }, include: { testCases: true } });
      await audit(req.auth!.id, "problem.draft_created", "Problem", record.id, { problemCode: record.problemCode, testCaseCount: testCases.length });
      res.status(201).json({ problem: record });
    } catch (error) { next(error); }
  });

  router.put("/problems/:problemId", async (req, res, next) => {
    try {
      const input = ProblemInput.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Invalid problem", details: input.error.flatten() });
      const current = await prisma.problem.findUnique({ where: { id: req.params.problemId }, include: { testCases: true } });
      if (!current) return res.status(404).json({ error: "Problem not found" });
      const { testCases, ...fields } = input.data;
      const record = await prisma.$transaction(async (tx) => {
        if (current.published) return tx.problem.create({ data: { eventId: current.eventId, supersedesId: current.id, version: current.version + 1, ...fields, sampleExamples: fields.sampleExamples, published: false, testCases: { create: testCases } }, include: { testCases: true } });
        await tx.testCase.deleteMany({ where: { problemId: current.id } });
        return tx.problem.update({ where: { id: current.id }, data: { ...fields, sampleExamples: fields.sampleExamples, testCases: { create: testCases } }, include: { testCases: true } });
      });
      await audit(req.auth!.id, "problem.draft_saved", "Problem", record.id, { sourceVersionId: current.id, version: record.version, testCaseCount: testCases.length });
      res.json({ problem: record });
    } catch (error) { next(error); }
  });

  router.post("/problems/:problemId/publish", async (req, res, next) => {
    try {
      const problem = await prisma.problem.findUnique({ where: { id: req.params.problemId } });
      if (!problem) return res.status(404).json({ error: "Problem not found" });
      const event = await getEvent();
      if (event.codingRoundOpen) return res.status(409).json({ error: "Pause the coding round before publishing problem changes" });
      const testCases = await prisma.testCase.findMany({ where: { problemId: problem.id } });
      const official = testCases.filter((testCase) => !testCase.isSample);
      if (!testCases.some((testCase) => testCase.isSample) || !official.length || official.reduce((sum, testCase) => sum + testCase.weight, 0) !== problem.maxScore) return res.status(409).json({ error: "Add at least one sample and official test cases whose weights sum to the maximum score" });
      await prisma.$transaction(async (tx) => {
        if (problem.supersedesId) {
          await tx.problem.update({ where: { id: problem.supersedesId }, data: { published: false } });
          await tx.event.updateMany({ where: { id: problem.eventId, displayProblemId: problem.supersedesId }, data: { displayProblemId: problem.id } });
        }
        await tx.problem.update({ where: { id: problem.id }, data: { published: true } });
        await tx.auditLog.create({ data: { actorId: req.auth!.id, action: "problem.published", targetType: "Problem", targetId: problem.id, details: { version: problem.version } } });
      });
      io.to("event:admin").emit("event.updated", { eventId: problem.eventId, revision: Date.now() });
      io.to("event:teams").emit("event.updated", { eventId: problem.eventId, revision: Date.now() });
      res.json({ published: true, problemId: problem.id });
    } catch (error) { next(error); }
  });

  router.post("/problems/:problemId/unpublish", async (req, res, next) => {
    try {
      const problem = await prisma.problem.findUnique({ where: { id: req.params.problemId } });
      if (!problem) return res.status(404).json({ error: "Problem not found" });
      if (!problem.published) return res.status(409).json({ error: "Algorithm is already unpublished" });
      const result = await prisma.$transaction(async (tx) => {
        const teams = await tx.teamProblem.findMany({ where: { problemId: problem.id, unassignedAt: null }, select: { teamId: true } });
        const closed = await closeLiveAuctionItems(tx, { problemId: problem.id });
        const unassignedAt = new Date();
        await tx.teamProblem.updateMany({ where: { problemId: problem.id, unassignedAt: null }, data: { unassignedAt } });
        const sessions = await tx.codingSession.updateMany({ where: { problemId: problem.id, endedAt: null }, data: { endedAt: unassignedAt, revision: { increment: 1 } } });
        await tx.problem.update({ where: { id: problem.id }, data: { published: false } });
        await tx.event.updateMany({ where: { id: problem.eventId, displayProblemId: problem.id }, data: { displayProblemId: null } });
        const teamIds = [...new Set([...teams.map((row) => row.teamId), ...closed.teamIds])];
        for (const teamId of teamIds) await recalculateTeamScore(tx, problem.eventId, teamId);
        const event = await tx.event.update({ where: { id: problem.eventId }, data: { publicRevision: { increment: 1 } }, select: { publicRevision: true } });
        await tx.auditLog.create({ data: { eventId: problem.eventId, actorId: req.auth!.id, action: "problem.unpublished", targetType: "Problem", targetId: problem.id, details: { problemCode: problem.problemCode, version: problem.version, force: true, teamsUnassigned: teams.length, activeSessionsEnded: sessions.count, auctionItemsClosed: closed.auctionIds.length, codingHistoryPreserved: true } } });
        return { ...closed, teamIds, revision: event.publicRevision, sessionsEnded: sessions.count };
      }, { isolationLevel: "Serializable" });
      io.to("event:admin").emit("event.updated", { eventId: problem.eventId, revision: result.revision });
      io.to("event:teams").emit("event.updated", { eventId: problem.eventId, revision: result.revision });
      io.to("event:admin").emit("leaderboard.updated", { revision: Date.now() });
      io.to("event:teams").emit("leaderboard.updated", { revision: Date.now() });
      for (const teamId of result.teamIds) io.to(`team:${teamId}`).emit("team.updated", { teamId, revision: Date.now() });
      for (const auctionId of result.auctionIds) {
        io.to("event:admin").emit("auction.updated", { auctionId, revision: Date.now() });
        io.to("event:teams").emit("auction.updated", { auctionId, revision: Date.now() });
      }
      res.json({ unpublished: true, problemId: problem.id, teamsUnassigned: result.teamIds.length, sessionsEnded: result.sessionsEnded });
    } catch (error) { next(error); }
  });

  router.get("/display", async (_req, res, next) => {
    try {
      const event = await getEvent();
      res.json({ displayCardId: event.displayCardId, displayProblemId: event.displayProblemId });
    } catch (error) { next(error); }
  });

  router.put("/display", async (req, res, next) => {
    try {
      const input = z.object({ kind: z.enum(["POWER_CARD", "PROBLEM"]), itemId: z.string().min(1).nullable() }).strict().safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Choose a power card or algorithm to display" });
      const event = await getEvent();
      if (input.data.itemId) {
        const available = input.data.kind === "POWER_CARD"
          ? await prisma.powerCard.findFirst({ where: { id: input.data.itemId, eventId: event.id, published: true }, select: { id: true } })
          : await prisma.problem.findFirst({ where: { id: input.data.itemId, eventId: event.id, published: true }, select: { id: true } });
        if (!available) return res.status(404).json({ error: "Only a published item in this event can be displayed" });
      }
      const data = input.data.kind === "POWER_CARD"
        ? { displayCardId: input.data.itemId, displayProblemId: null, publicRevision: { increment: 1 } }
        : { displayCardId: null, displayProblemId: input.data.itemId, publicRevision: { increment: 1 } };
      const updated = await prisma.event.update({ where: { id: event.id }, data, select: { displayCardId: true, displayProblemId: true, publicRevision: true } });
      await audit(req.auth!.id, input.data.itemId ? "event.display_item_set" : "event.display_item_cleared", "Event", event.id, { kind: input.data.kind, itemId: input.data.itemId });
      io.to("event:admin").emit("event.updated", { eventId: event.id, revision: updated.publicRevision });
      io.to("event:teams").emit("event.updated", { eventId: event.id, revision: updated.publicRevision });
      res.json({ displayCardId: updated.displayCardId, displayProblemId: updated.displayProblemId });
    } catch (error) { next(error); }
  });

  router.patch("/event", async (req, res, next) => {
    try {
      const input = z.object({ name: z.string().trim().min(2).max(120).optional(), status: z.enum(["DRAFT", "READY", "LIVE", "PAUSED", "ENDED"]).optional(), codingRoundOpen: z.boolean().optional(), leaderboardVisibility: z.enum(["HIDDEN", "PUBLIC", "FINAL"]).optional() }).strict().safeParse(req.body);
      if (!input.success || Object.keys(input.data ?? {}).length === 0) return res.status(400).json({ error: "Invalid event changes" });
      const event = await getEvent();
      if (input.data.codingRoundOpen === true && (input.data.status ?? event.status) !== "LIVE") return res.status(409).json({ error: "The coding round can only be opened while the event is LIVE" });
      const updated = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const currentEvent = await tx.event.findUniqueOrThrow({ where: { id: event.id } });
        let creditBonusAwardedAt = currentEvent.creditBonusAwardedAt;
        if (input.data.codingRoundOpen === true && !currentEvent.creditBonusAwardedAt) {
          const reservedTeams = await tx.team.count({ where: { active: true, reservedCredits: { gt: 0 } } });
          if (reservedTeams > 0) throw Object.assign(new Error("Settle or cancel outstanding online bids before opening the coding round"), { status: 409 });
          const [teams, settings] = await Promise.all([
            tx.team.findMany({ where: { active: true }, select: { id: true, credits: true, reservedCredits: true } }),
            tx.eventSettings.findUnique({ where: { eventId: event.id } }),
          ]);
          const rate = Number(settings?.creditBonusRate ?? 0.1);
          const rounding = (settings?.creditBonusRounding ?? "FLOOR") as "FLOOR" | "CEIL" | "ROUND";
          for (const team of teams) {
            const score = await tx.score.findUnique({ where: { teamId: team.id } });
            const creditBonus = calculateCreditBonus(team.credits, team.reservedCredits, rate, rounding);
            const solution = score?.solution ?? 0;
            const timing = score?.timing ?? 0;
            const adjustments = score?.adjustments ?? 0;
            await tx.score.upsert({
              where: { teamId: team.id },
              create: { teamId: team.id, solution, timing, creditBonus, adjustments, total: solution + timing + creditBonus + adjustments },
              update: { creditBonus, total: solution + timing + creditBonus + adjustments, revision: { increment: 1 } },
            });
          }
          creditBonusAwardedAt = now;
          await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "score.credit_bonus_awarded", targetType: "Event", targetId: event.id, details: { rate, rounding, teams: teams.map((team) => ({ teamId: team.id, remainingCredits: team.credits, bonus: calculateCreditBonus(team.credits, team.reservedCredits, rate, rounding) })) } } });
        }
        let pausedAt = event.pausedAt;
        if (input.data.status === "READY") {
          // Require every team to explicitly enter after the administrator
          // sets the event ready, including teams that clicked Start earlier.
          await tx.team.updateMany({ data: { startedAt: null, revision: { increment: 1 } } });
        }
        if (input.data.status === "PAUSED" && event.status !== "PAUSED") pausedAt = now;
        if (input.data.status === "LIVE" && event.status === "PAUSED" && event.pausedAt) {
          const pauseMs = Math.max(0, now.getTime() - event.pausedAt.getTime());
          const sessions = await tx.codingSession.findMany({ where: { endedAt: null }, select: { id: true, deadlineAt: true } });
          for (const session of sessions) await tx.codingSession.update({ where: { id: session.id }, data: { deadlineAt: new Date(session.deadlineAt.getTime() + pauseMs) } });
          const auctions = await tx.auction.findMany({ where: { eventId: event.id, status: { in: ["OPEN", "SCHEDULED"] }, endsAt: { not: null } }, include: { items: true } });
          for (const auction of auctions) {
            await tx.auction.update({ where: { id: auction.id }, data: { endsAt: new Date(auction.endsAt!.getTime() + pauseMs) } });
            for (const item of auction.items) if (item.closesAt) await tx.auctionItem.update({ where: { id: item.id }, data: { closesAt: new Date(item.closesAt.getTime() + pauseMs) } });
          }
          pausedAt = null;
        }
        if (input.data.status === "ENDED") pausedAt = null;
        const data = { ...input.data, ...(input.data.status === "PAUSED" ? { codingRoundOpen: false } : {}), pausedAt, creditBonusAwardedAt, publicRevision: { increment: 1 } };
        const value = await tx.event.update({ where: { id: event.id }, data });
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "event.settings_updated", targetType: "Event", targetId: event.id, details: input.data } });
        return value;
      });
      io.to("event:admin").emit("event.updated", { eventId: event.id, revision: updated.publicRevision });
      io.to("event:teams").emit("event.updated", { eventId: event.id, revision: updated.publicRevision });
      res.json({ event: updated });
    } catch (error) { next(error); }
  });

  router.get("/event", async (_req, res, next) => {
    try {
      const event = await getEvent();
      const settings = await prisma.eventSettings.findUnique({ where: { eventId: event.id } });
      res.json({ event, settings });
    } catch (error) { next(error); }
  });

  return router;
}
