import { Router } from "express";
import { z } from "zod";
import type { Server } from "socket.io";
import type { PrismaClient } from "./generated/prisma/client.js";
import { requireAuth } from "./auth.js";

const Language = z.enum(["PYTHON", "JAVA", "C", "CPP"]);

export function createTeamRouter(prisma: PrismaClient, io: Server) {
  const router = Router();
  router.use(requireAuth);

  function teamId(req: import("express").Request) {
    return req.auth?.role === "TEAM" ? req.auth.teamId : null;
  }
  const emitTeam = (id: string, revision: number) => {
    io.to(`team:${id}`).emit("team.updated", { teamId: id, revision });
    io.to("event:admin").emit("team.updated", { teamId: id, revision });
  };

  router.get("/", async (req, res, next) => {
    try {
      const id = teamId(req);
      if (!id) return res.status(403).json({ error: "Team account required" });
      const [team, event] = await Promise.all([
        prisma.team.findUnique({ where: { id }, include: {
          users: { select: { id: true, email: true, teamSlot: true, active: true } },
          cards: { include: { card: { select: { id: true, name: true, description: true, benefits: true, conditions: true, usageLimit: true, effectType: true, effectValue: true } } } },
          problems: { where: { unassignedAt: null, problem: { published: true } }, include: { problem: { include: { _count: { select: { testCases: true } }, testCases: { where: { isSample: true }, orderBy: { position: "asc" }, select: { input: true, expected: true, position: true } } } } } },
          score: true,
        } }),
        prisma.event.findFirst({ orderBy: { createdAt: "asc" } }),
      ]);
      if (!team) return res.status(404).json({ error: "Team not found" });
      if (!team.active) return res.status(403).json({ error: "Team account is inactive" });
      res.json({
        team: { id: team.id, teamCode: team.teamCode, name: team.name, startedAt: team.startedAt, credits: team.credits, reservedCredits: team.reservedCredits, availableCredits: team.credits - team.reservedCredits, revision: team.revision, users: team.users, cards: team.cards, problems: team.problems, score: team.score },
        event: event ? { id: event.id, name: event.name, status: event.status, codingRoundOpen: event.codingRoundOpen } : null,
      });
    } catch (error) { next(error); }
  });

  router.get("/catalog", async (req, res, next) => {
    try {
      const id = teamId(req);
      if (!id) return res.status(403).json({ error: "Team account required" });
      const [team, event] = await Promise.all([
        prisma.team.findUnique({ where: { id }, select: { active: true, startedAt: true, teamCode: true, name: true, credits: true, reservedCredits: true } }),
        prisma.event.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }),
      ]);
      if (!team?.active) return res.status(403).json({ error: "Team account is inactive" });
      if (!team.startedAt) return res.status(409).json({ error: "Start your team session to view the event catalog" });
      const teamBalance = { teamCode: team.teamCode, name: team.name, availableCredits: team.credits - team.reservedCredits };
      if (!event) return res.json({ team: teamBalance, cards: [], problems: [] });
      const [cards, problems] = await Promise.all([
        prisma.powerCard.findMany({ where: { eventId: event.id, published: true }, orderBy: [{ name: "asc" }, { version: "desc" }], select: { id: true, name: true, description: true, benefits: true, conditions: true, usageLimit: true, effectType: true, effectValue: true, imageData: true, updatedAt: true } }),
        prisma.problem.findMany({ where: { eventId: event.id, published: true }, orderBy: [{ problemCode: "asc" }, { version: "desc" }], select: { id: true, problemCode: true, title: true, difficulty: true, statement: true, inputFormat: true, outputFormat: true, constraints: true, sampleExamples: true, timeLimitSeconds: true, maxScore: true } }),
      ]);
      res.json({ team: teamBalance, cards: cards.map(({ imageData, ...card }) => ({ ...card, imageUrl: imageData ? `/api/team/catalog/cards/${card.id}/image?v=${card.updatedAt.getTime()}` : null })), problems });
    } catch (error) { next(error); }
  });

  router.get("/catalog/cards/:cardId/image", async (req, res, next) => {
    try {
      const id = teamId(req);
      if (!id) return res.status(403).json({ error: "Team account required" });
      const [team, event] = await Promise.all([
        prisma.team.findUnique({ where: { id }, select: { active: true, startedAt: true } }),
        prisma.event.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }),
      ]);
      if (!team?.active || !team.startedAt) return res.status(403).json({ error: "Start an active team session to view this image" });
      const card = event ? await prisma.powerCard.findFirst({ where: { id: String(req.params.cardId), eventId: event.id, published: true }, select: { imageData: true } }) : null;
      const match = card?.imageData?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) return res.status(404).json({ error: "Published power card image not found" });
      res.setHeader("Content-Type", match[1]);
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(Buffer.from(match[2], "base64"));
    } catch (error) { next(error); }
  });

  router.get("/display", async (req, res, next) => {
    try {
      const id = teamId(req);
      if (!id) return res.status(403).json({ error: "Team account required" });
      const team = await prisma.team.findUnique({ where: { id }, select: { active: true, startedAt: true, teamCode: true, name: true, credits: true, reservedCredits: true } });
      if (!team?.active) return res.status(403).json({ error: "Team account is inactive" });
      if (!team.startedAt) return res.status(409).json({ error: "Start your team session to open the event display" });
      const event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" }, include: {
        displayCard: { select: { id: true, published: true, name: true, description: true, imageData: true, benefits: true, conditions: true, effectType: true, effectValue: true, updatedAt: true } },
        displayProblem: { select: { id: true, published: true, problemCode: true, title: true, difficulty: true, statement: true, inputFormat: true, outputFormat: true, constraints: true, sampleExamples: true, timeLimitSeconds: true, maxScore: true } },
      } });
      const teams = await prisma.team.findMany({ where: { active: true }, orderBy: { teamCode: "asc" }, select: {
        id: true, teamCode: true, name: true,
        cards: { select: { card: { select: { id: true, name: true, published: true } } } },
        problems: { where: { unassignedAt: null, problem: { published: true } }, select: { problem: { select: { id: true, problemCode: true, title: true, difficulty: true } } } },
      } });
      const card = event?.displayCard?.published ? event.displayCard : null;
      const featuredCard = card ? (({ imageData, updatedAt, ...fields }) => ({ ...fields, imageUrl: imageData ? `/api/team/catalog/cards/${card.id}/image?v=${updatedAt.getTime()}` : null }))(card) : null;
      const featuredProblem = event?.displayProblem?.published ? event.displayProblem : null;
      res.json({ team: { teamCode: team.teamCode, name: team.name, availableCredits: team.credits - team.reservedCredits }, featuredCard, featuredProblem, teams: teams.map((row) => ({ id: row.id, teamCode: row.teamCode, name: row.name, cards: row.cards.map(({ card: assigned }) => ({ id: assigned.id, name: assigned.name })), problems: row.problems.map(({ problem }) => problem) })) });
    } catch (error) { next(error); }
  });

  router.post("/start", async (req, res, next) => {
    try {
      const id = teamId(req);
      if (!id) return res.status(403).json({ error: "Team account required" });
      const event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" }, select: { status: true } });
      if (!event || (event.status !== "READY" && event.status !== "LIVE")) {
        return res.status(409).json({ error: "Your team can start after the administrator sets the event to READY" });
      }
      const changed = await prisma.team.updateMany({ where: { id, startedAt: null }, data: { startedAt: new Date(), revision: { increment: 1 } } });
      const team = await prisma.team.findUnique({ where: { id }, select: { id: true, startedAt: true, revision: true } });
      if (!team) return res.status(404).json({ error: "Team not found" });
      if (changed.count) emitTeam(team.id, team.revision);
      res.json({ startedAt: team.startedAt });
    } catch (error) { next(error); }
  });

  router.post("/cards/:cardId/activate", async (req, res, next) => {
    try {
      const id = teamId(req);
      if (!id) return res.status(403).json({ error: "Team account required" });
      const key = z.string().min(8).max(100).regex(/^[A-Za-z0-9._:-]+$/).safeParse(req.get("Idempotency-Key"));
      const input = z.object({ problemId: z.string().optional() }).strict().safeParse(req.body ?? {});
      if (!key.success || !input.success) return res.status(400).json({ error: "Provide a valid idempotency key and optional problem selection" });
      const event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" } });
      if (!event || event.status !== "LIVE") return res.status(409).json({ error: "Power cards can only be activated while the event is LIVE" });
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.powerCardActivation.findUnique({ where: { idempotencyKey: key.data }, include: { teamCard: { include: { card: true } } } });
        if (existing) {
          if (existing.teamCard.teamId !== id || existing.actorId !== req.auth!.id || existing.teamCard.cardId !== req.params.cardId) throw Object.assign(new Error("Idempotency key was already used for another card action"), { status: 409 });
          return { activation: existing, repeated: true, timerUpdate: null as { sessionId: string; deadlineAt: Date } | null };
        }
        let timerUpdate: { sessionId: string; deadlineAt: Date } | null = null;
        const assignment = await tx.teamCard.findUnique({ where: { teamId_cardId: { teamId: id, cardId: String(req.params.cardId) } }, include: { card: true } });
        if (!assignment) throw Object.assign(new Error("Power card is not assigned to this team"), { status: 404 });
        if (assignment.usesRemaining !== null && assignment.usesRemaining <= 0) throw Object.assign(new Error("This power card has no uses remaining"), { status: 409 });
        let problemId: string | null = input.data.problemId ?? null;
        if (assignment.card.effectType === "TIME_EXTENSION") {
          if (!problemId) throw Object.assign(new Error("Select the active problem to extend"), { status: 400 });
          const session = await tx.codingSession.findFirst({ where: { teamId: id, problemId, endedAt: null, deadlineAt: { gt: new Date() } } });
          if (!session) throw Object.assign(new Error("No active timer exists for that assigned problem"), { status: 409 });
          const updatedSession = await tx.codingSession.update({ where: { id: session.id }, data: { deadlineAt: new Date(session.deadlineAt.getTime() + assignment.card.effectValue * 1000), revision: { increment: 1 } } });
          timerUpdate = { sessionId: session.id, deadlineAt: updatedSession.deadlineAt };
        } else if (problemId) return Promise.reject(Object.assign(new Error("This card does not target a problem"), { status: 400 }));
        const activatedAt = new Date();
        if (assignment.usesRemaining !== null) {
          const consumed = await tx.teamCard.updateMany({ where: { id: assignment.id, usesRemaining: { gt: 0 } }, data: { usesRemaining: { decrement: 1 }, activatedAt } });
          if (consumed.count !== 1) throw Object.assign(new Error("This power card has no uses remaining"), { status: 409 });
        } else await tx.teamCard.update({ where: { id: assignment.id }, data: { activatedAt } });
        if (assignment.card.effectType === "CREDIT_GRANT") {
          await tx.team.update({ where: { id }, data: { credits: { increment: assignment.card.effectValue }, revision: { increment: 1 } } });
          const currentEvent = await tx.event.findUnique({ where: { id: event.id }, select: { creditBonusAwardedAt: true } });
          const score = await tx.score.findUnique({ where: { teamId: id } });
          if (score && !currentEvent?.creditBonusAwardedAt) {
            const creditBonus = 0;
            await tx.score.update({ where: { teamId: id }, data: { creditBonus, total: score.solution + score.timing + creditBonus + score.adjustments, revision: { increment: 1 } } });
          }
        }
        if (assignment.card.effectType === "SCORE_BONUS") {
          const score = await tx.score.findUnique({ where: { teamId: id } });
          if (score) {
            const newAdjustments = score.adjustments + assignment.card.effectValue;
            await tx.score.update({ where: { teamId: id }, data: { adjustments: newAdjustments, total: score.solution + score.timing + score.creditBonus + newAdjustments, revision: { increment: 1 } } });
            await tx.scoreAdjustment.create({ data: { teamId: id, actorId: req.auth!.id, oldValue: score.adjustments, newValue: newAdjustments, reason: `Power card activated: ${assignment.card.name}` } });
          }
        }
        const activation = await tx.powerCardActivation.create({ data: { teamCardId: assignment.id, actorId: req.auth!.id, problemId, idempotencyKey: key.data, effectType: assignment.card.effectType, effectValue: assignment.card.effectValue } });
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "power_card.activated", targetType: "PowerCardActivation", targetId: activation.id, details: { teamId: id, cardId: assignment.cardId, effectType: assignment.card.effectType, effectValue: assignment.card.effectValue, problemId } } });
        return { activation, repeated: false, timerUpdate };
      }, { isolationLevel: "Serializable" });
      emitTeam(id, Date.now());
      if (result.timerUpdate) io.to(`team:${id}`).emit("coding.timer.updated", { sessionId: result.timerUpdate.sessionId, deadlineAt: result.timerUpdate.deadlineAt.toISOString(), serverNow: Date.now() });
      if (!result.repeated) io.to("event:admin").emit("leaderboard.updated", { revision: Date.now() });
      res.status(result.repeated ? 200 : 201).json(result);
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Card activation rejected" });
      next(error);
    }
  });

  router.post("/coding-round/start", async (req, res, next) => {
    try {
      const id = teamId(req);
      if (!id) return res.status(403).json({ error: "Team account required" });
      const [team, event, problems] = await Promise.all([
        prisma.team.findUnique({ where: { id } }),
        prisma.event.findFirst({ orderBy: { createdAt: "asc" } }),
        prisma.teamProblem.findMany({ where: { teamId: id, unassignedAt: null, problem: { published: true } }, include: { problem: { select: { id: true, title: true, difficulty: true, timeLimitSeconds: true, maxScore: true } } } }),
      ]);
      if (!team?.startedAt) return res.status(409).json({ error: "Press START on the team dashboard before joining the event" });
      if (!event?.codingRoundOpen || event.status !== "LIVE") return res.status(409).json({ error: "The administrator has not opened the coding round" });
      res.json({ problems: problems.map(({ problem }) => problem) });
    } catch (error) { next(error); }
  });

  router.post("/problems/:problemId/start", async (req, res, next) => {
    try {
      const id = teamId(req);
      if (!id) return res.status(403).json({ error: "Team account required" });
      const result = await prisma.$transaction(async (tx) => {
        const [team, event, assignment] = await Promise.all([
          tx.team.findUnique({ where: { id } }),
          tx.event.findFirst({ orderBy: { createdAt: "asc" } }),
          tx.teamProblem.findUnique({ where: { teamId_problemId: { teamId: id, problemId: req.params.problemId } }, include: { problem: true } }),
        ]);
        if (!assignment || assignment.unassignedAt) throw Object.assign(new Error("Problem is not assigned to this team"), { status: 404 });
        if (!team?.startedAt || !event?.codingRoundOpen || event.status !== "LIVE") throw Object.assign(new Error("Coding round is not open for this team"), { status: 409 });
        if (assignment.status === "SOLVED" || assignment.status === "TIME_EXPIRED") throw Object.assign(new Error("This problem attempt is already finished"), { status: 409 });
        const existing = await tx.codingSession.findUnique({ where: { teamId_problemId: { teamId: id, problemId: assignment.problemId } } });
        const now = new Date();
        if (existing) {
          if (existing.deadlineAt <= now || existing.endedAt) {
            throw Object.assign(new Error("Time has expired for this problem"), { status: 409 });
          }
          return { session: existing, problem: assignment.problem, reused: true };
        }
        const deadlineAt = new Date(now.getTime() + assignment.problem.timeLimitSeconds * 1000);
        const session = await tx.codingSession.create({ data: { teamId: id, problemId: assignment.problemId, startedAt: now, deadlineAt } });
        await tx.teamProblem.update({ where: { id: assignment.id }, data: { status: "IN_PROGRESS" } });
        await tx.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "coding_session.started", targetType: "CodingSession", targetId: session.id, details: { teamId: id, problemId: assignment.problemId, startedAt: now, deadlineAt } } });
        return { session, problem: assignment.problem, reused: false };
      }, { isolationLevel: "Serializable" });
      emitTeam(id, Date.now());
      res.status(result.reused ? 200 : 201).json({ session: result.session, problem: { id: result.problem.id, problemCode: result.problem.problemCode, title: result.problem.title, difficulty: result.problem.difficulty, statement: result.problem.statement, inputFormat: result.problem.inputFormat, outputFormat: result.problem.outputFormat, constraints: result.problem.constraints, sampleExamples: result.problem.sampleExamples, timeLimitSeconds: result.problem.timeLimitSeconds, maxScore: result.problem.maxScore, maxTimingPoints: result.problem.maxTimingPoints } });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Could not start problem" });
      next(error);
    }
  });

  router.get("/coding/:sessionId", async (req, res, next) => {
    try {
      const id = teamId(req);
      if (!id) return res.status(403).json({ error: "Team account required" });
      const session = await prisma.codingSession.findFirst({
        where: { id: req.params.sessionId, teamId: id },
        include: {
          problem: {
            include: {
              testCases: { where: { isSample: true }, orderBy: { position: "asc" }, select: { input: true, expected: true, position: true } },
            },
          },
        },
      });
      if (!session) return res.status(404).json({ error: "Coding session not found" });
      const serverNow = Date.now();
      const remainingSeconds = Math.max(0, Math.ceil((session.deadlineAt.getTime() - serverNow) / 1000));
      res.json({ serverNow, session: { id: session.id, startedAt: session.startedAt, deadlineAt: session.deadlineAt, remainingSeconds, endedAt: session.endedAt, savedCode: session.savedCode, language: session.language, revision: session.revision }, problem: session.problem });
    } catch (error) { next(error); }
  });

  router.put("/coding/:sessionId/autosave", async (req, res, next) => {
    try {
      const id = teamId(req);
      if (!id) return res.status(403).json({ error: "Team account required" });
      const input = z.object({ source: z.string().max(50000), language: Language, revision: z.number().int().nonnegative() }).strict().safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Invalid code save" });
      const bytes = Buffer.byteLength(input.data.source, "utf8");
      const settings = await prisma.eventSettings.findFirst();
      if (bytes > (settings?.maxSourceBytes ?? 50000)) return res.status(413).json({ error: "Source code is too large" });
      const updated = await prisma.codingSession.updateMany({
        where: { id: req.params.sessionId, teamId: id, endedAt: null, deadlineAt: { gt: new Date() }, revision: input.data.revision },
        data: { savedCode: input.data.source, language: input.data.language, revision: { increment: 1 } },
      });
      if (updated.count !== 1) return res.status(409).json({ error: "Session expired or code changed in the other team member's editor. Reload the latest saved version." });
      io.to(`team:${id}`).emit("coding.updated", { sessionId: req.params.sessionId, revision: input.data.revision + 1 });
      res.json({ saved: true, revision: input.data.revision + 1, savedAt: new Date().toISOString() });
    } catch (error) { next(error); }
  });

  router.post("/coding/:sessionId/violation", async (req, res, next) => {
    try {
      const id = teamId(req);
      if (!id) return res.status(403).json({ error: "Team account required" });
      const input = z.object({ kind: z.enum(["FULLSCREEN_EXIT", "LEAVE_WARNING"]) }).strict().safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Invalid violation record" });
      const session = await prisma.codingSession.findFirst({ where: { id: req.params.sessionId, teamId: id } });
      if (!session) return res.status(404).json({ error: "Coding session not found" });
      const [updated] = await prisma.$transaction([
        prisma.codingSession.update({ where: { id: session.id }, data: { violationCount: { increment: 1 } } }),
        prisma.auditLog.create({ data: { actorId: req.auth!.id, action: "coding_session.violation", targetType: "CodingSession", targetId: session.id, details: { teamId: id, kind: input.data.kind, clientReportedAt: new Date().toISOString() } } }),
      ]);
      io.to("event:admin").emit("team.violation", { teamId: id, sessionId: session.id, kind: input.data.kind, violationCount: updated.violationCount });
      res.status(202).json({ recorded: true, violationCount: updated.violationCount });
    } catch (error) { next(error); }
  });

  return router;
}
