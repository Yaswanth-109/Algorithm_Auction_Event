import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { PrismaClient } from "./generated/prisma/client.js";
import { requireAdmin, requireAuth } from "./auth.js";
import { env } from "./config.js";
import { LanguageSchema } from "@algorithm-auction/shared";

const SourceInput = z.object({ source: z.string().min(1).max(50000), language: LanguageSchema, customInput: z.string().max(100000).optional() }).strict();
const Key = z.string().min(8).max(100).regex(/^[A-Za-z0-9._:-]+$/);

const safeSubmission = {
  id: true, teamId: true, problemId: true, kind: true, language: true, status: true,
  score: true, executionMs: true, createdAt: true, runOutput: true, runError: true, compileOutput: true,
} as const;

export function createSubmissionRouters(prisma: PrismaClient) {
  const team = Router();
  team.use(requireAuth);
  const admin = Router();
  admin.use(requireAdmin);
  const limiter = rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (req) => req.auth?.id ?? "anonymous" });

  team.post("/:sessionId/run", limiter, (req, res, next) => createSubmission("RUN", req, res, next));
  team.post("/:sessionId/submit", limiter, (req, res, next) => createSubmission("SUBMIT", req, res, next));

  async function createSubmission(kind: "RUN" | "SUBMIT", req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
    try {
      if (req.auth?.role !== "TEAM" || !req.auth.teamId) return res.status(403).json({ error: "Team account required" });
      const input = SourceInput.safeParse(req.body);
      const idempotencyKey = Key.safeParse(req.get("Idempotency-Key"));
      if (!input.success || !idempotencyKey.success) return res.status(400).json({ error: "Provide source code, a supported language, and an Idempotency-Key header" });
      const session = await prisma.codingSession.findFirst({ where: { id: String(req.params.sessionId), teamId: req.auth.teamId }, include: { problem: true } });
      if (!session) return res.status(404).json({ error: "Coding session not found" });
      if (session.endedAt || session.deadlineAt <= new Date()) {
        await prisma.$transaction([
          prisma.codingSession.update({ where: { id: session.id }, data: { endedAt: session.endedAt ?? new Date() } }),
          prisma.teamProblem.updateMany({ where: { teamId: session.teamId, problemId: session.problemId, status: "IN_PROGRESS" }, data: { status: "TIME_EXPIRED" } }),
        ]);
        return res.status(409).json({ error: "The server-side problem timer has expired" });
      }
      const [event, setting] = await Promise.all([
        prisma.event.findFirst({ orderBy: { createdAt: "asc" } }),
        prisma.eventSettings.findFirst(),
      ]);
      if (env.EXECUTION_BACKEND === "disabled" || (env.EXECUTION_BACKEND === "judge0" && !env.JUDGE0_URL)) return res.status(503).json({ error: "The administrator has not configured a code execution service" });
      if (!event?.codingRoundOpen || event.status !== "LIVE") return res.status(409).json({ error: "The coding round is not active" });
      if (Buffer.byteLength(input.data.source, "utf8") > (setting?.maxSourceBytes ?? 50000)) return res.status(413).json({ error: "Source code exceeds the configured size limit" });
      const assignment = await prisma.teamProblem.findUnique({ where: { teamId_problemId: { teamId: session.teamId, problemId: session.problemId } } });
      if (!assignment || assignment.unassignedAt) return res.status(403).json({ error: "Problem is not assigned to this team" });
      if (kind === "SUBMIT" && ["SOLVED", "TIME_EXPIRED"].includes(assignment.status)) return res.status(409).json({ error: "This problem attempt is already finished" });

      const result = await prisma.$transaction(async (tx) => {
        const old = await tx.submission.findUnique({ where: { idempotencyKey: idempotencyKey.data } });
        if (old) {
          if (old.teamId !== req.auth!.teamId || old.problemId !== session.problemId || old.kind !== kind || old.source !== input.data.source || (kind === "RUN" && old.customInput !== (input.data.customInput ?? null))) throw Object.assign(new Error("Idempotency key was already used for a different submission"), { status: 409 });
          return old;
        }
        const created = await tx.submission.create({ data: {
          teamId: session.teamId, problemId: session.problemId, kind, language: input.data.language,
          source: input.data.source, customInput: kind === "RUN" ? input.data.customInput ?? null : null,
          idempotencyKey: idempotencyKey.data,
        } });
        if (kind === "SUBMIT") await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "submission.queued", targetType: "Submission", targetId: created.id, details: { teamId: session.teamId, problemId: session.problemId, language: input.data.language } } });
        return created;
      }, { isolationLevel: "Serializable" });
      res.status(202).json({ submission: { id: result.id, status: result.status, kind: result.kind, createdAt: result.createdAt } });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Submission rejected" });
      if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2034") return res.status(409).json({ error: "Submission conflicted with another update. Retry with a new idempotency key." });
      next(error);
    }
  }

  team.get("/:submissionId", async (req, res, next) => {
    try {
      if (req.auth?.role !== "TEAM" || !req.auth.teamId) return res.status(403).json({ error: "Team account required" });
      const submission = await prisma.submission.findFirst({ where: { id: req.params.submissionId, teamId: req.auth.teamId }, select: safeSubmission });
      if (!submission) return res.status(404).json({ error: "Submission not found" });
      if (submission.kind === "SUBMIT") {
        const [results, total] = await Promise.all([
          prisma.testCaseResult.findMany({ where: { submissionId: submission.id }, select: { passed: true, awardedScore: true, executionMs: true } }),
          prisma.testCase.count({ where: { problemId: submission.problemId, isSample: false } }),
        ]);
        res.json({ submission: { ...submission, runOutput: null, runError: null, compileOutput: null }, results: { attempted: results.length, passed: results.filter((row) => row.passed).length, total, score: results.reduce((sum, row) => sum + row.awardedScore, 0) } });
      } else res.json({ submission });
    } catch (error) { next(error); }
  });

  admin.get("/", async (req, res, next) => {
    try {
      const parsed = z.object({ teamId: z.string().optional(), skip: z.coerce.number().int().min(0).default(0), take: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: "Invalid pagination" });
      const [submissions, total] = await Promise.all([
        prisma.submission.findMany({ where: parsed.data.teamId ? { teamId: parsed.data.teamId } : {}, orderBy: { createdAt: "desc" }, skip: parsed.data.skip, take: parsed.data.take, include: { team: { select: { teamCode: true, name: true } }, problem: { select: { problemCode: true, title: true } } } }),
        prisma.submission.count({ where: parsed.data.teamId ? { teamId: parsed.data.teamId } : {} }),
      ]);
      res.json({ submissions, total, skip: parsed.data.skip, take: parsed.data.take });
    } catch (error) { next(error); }
  });

  return { team, admin };
}
