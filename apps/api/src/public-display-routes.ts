import { Router } from "express";
import type { PrismaClient } from "./generated/prisma/client.js";
import { compareStandings } from "./domain.js";

/** Read-only, unauthenticated endpoints intended for the venue LED screen. */
export function createPublicDisplayRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/catalog", async (_req, res, next) => {
    try {
      const event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      if (!event) return res.json({ cards: [], problems: [] });
      const [cards, problems] = await Promise.all([
        prisma.powerCard.findMany({ where: { eventId: event.id, published: true }, orderBy: [{ name: "asc" }, { version: "desc" }], select: { id: true, name: true, description: true, benefits: true, conditions: true, effectType: true, effectValue: true, imageData: true, updatedAt: true } }),
        prisma.problem.findMany({ where: { eventId: event.id, published: true }, orderBy: [{ problemCode: "asc" }, { version: "desc" }], select: { id: true, problemCode: true, title: true, statement: true, inputFormat: true, outputFormat: true, constraints: true, sampleExamples: true, timeLimitSeconds: true, maxScore: true } }),
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.json({ cards: cards.map(({ imageData, ...card }) => ({ ...card, imageUrl: imageData ? `/api/public-display/cards/${card.id}/image?v=${card.updatedAt.getTime()}` : null })), problems });
    } catch (error) { next(error); }
  });

  router.get("/cards/:cardId/image", async (req, res, next) => {
    try {
      const event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      const card = event ? await prisma.powerCard.findFirst({ where: { id: String(req.params.cardId), eventId: event.id, published: true }, select: { imageData: true } }) : null;
      const match = card?.imageData?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) return res.status(404).json({ error: "Published power card image not found" });
      res.setHeader("Content-Type", match[1]);
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(Buffer.from(match[2], "base64"));
    } catch (error) { next(error); }
  });

  router.get("/current", async (_req, res, next) => {
    try {
      const event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" }, include: {
        displayCard: { select: { id: true, published: true, name: true, description: true, imageData: true, benefits: true, conditions: true, effectType: true, effectValue: true, updatedAt: true } },
        displayProblem: { select: { id: true, published: true, problemCode: true, title: true, statement: true, inputFormat: true, outputFormat: true, constraints: true, sampleExamples: true, timeLimitSeconds: true, maxScore: true } },
      } });
      const card = event?.displayCard?.published ? event.displayCard : null;
      const { imageData, updatedAt, ...cardFields } = card ?? { imageData: null, updatedAt: null };
      res.setHeader("Cache-Control", "no-store");
      res.json({ card: card ? { ...cardFields, imageUrl: imageData ? `/api/public-display/cards/${card.id}/image?v=${updatedAt.getTime()}` : null } : null, problem: event?.displayProblem?.published ? event.displayProblem : null });
    } catch (error) { next(error); }
  });

  router.get("/leaderboard", async (_req, res, next) => {
    try {
      const event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" } });
      if (!event) return res.json({ visibility: "HIDDEN", rows: [] });
      if (event.leaderboardVisibility === "HIDDEN") return res.status(403).json({ error: "The administrator has hidden the leaderboard" });
      const teams = await prisma.team.findMany({ where: { active: true }, include: { score: true, problems: true } });
      const rows = teams.map((team) => ({
        teamId: team.id, teamCode: team.teamCode, teamName: team.name,
        solvedProblems: team.problems.filter((row) => row.status === "SOLVED").length,
        totalScore: team.score?.total ?? 0,
        solutionScore: team.score?.solution ?? 0,
        timingScore: team.score?.timing ?? 0,
        creditBonus: team.score?.creditBonus ?? 0,
      })).sort(compareStandings).map((row, index) => ({ rank: index + 1, ...row }));
      res.setHeader("Cache-Control", "no-store");
      res.json({ visibility: event.leaderboardVisibility, rows });
    } catch (error) { next(error); }
  });

  return router;
}
