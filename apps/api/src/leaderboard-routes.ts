import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "./generated/prisma/client.js";
import { requireAuth } from "./auth.js";
import { compareStandings } from "./domain.js";

export function createLeaderboardRouter(prisma: PrismaClient) {
  const router = Router();
  router.use(requireAuth);
  router.get("/", async (req, res, next) => {
    try {
      const query = z.object({ search: z.string().max(100).optional(), skip: z.coerce.number().int().min(0).default(0), take: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query);
      if (!query.success) return res.status(400).json({ error: "Invalid leaderboard query" });
      const event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" } });
      if (!event) return res.json({ visibility: "HIDDEN", rows: [], total: 0 });
      if (req.auth!.role !== "ADMIN" && event.leaderboardVisibility === "HIDDEN") return res.status(403).json({ error: "The administrator has hidden the leaderboard" });
      const where = { active: true, ...(query.data.search ? { OR: [{ name: { contains: query.data.search, mode: "insensitive" as const } }, { teamCode: { contains: query.data.search, mode: "insensitive" as const } }] } : {}) };
      const [teams, total] = await Promise.all([
        prisma.team.findMany({ where, include: { score: true, problems: true } }),
        prisma.team.count({ where }),
      ]);
      const ranked = teams.map((team) => {
        const solved = team.problems.filter((row) => row.status === "SOLVED");
        return {
          teamId: team.id, teamCode: team.teamCode, teamName: team.name,
          solvedProblems: solved.length,
          solutionScore: team.score?.solution ?? 0,
          timingScore: team.score?.timing ?? 0,
          creditBonus: team.score?.creditBonus ?? 0,
          adjustments: team.score?.adjustments ?? 0,
          totalScore: team.score?.total ?? 0,
        };
      }).sort(compareStandings);
      const rows = ranked.slice(query.data.skip, query.data.skip + query.data.take).map((row, index) => ({ rank: query.data.skip + index + 1, ...row, currentTeam: row.teamId === req.auth!.teamId }));
      res.json({ visibility: event.leaderboardVisibility, rows, total, skip: query.data.skip, take: query.data.take });
    } catch (error) { next(error); }
  });
  return router;
}
