import type { PrismaClient } from "./generated/prisma/client.js";

export async function settleAuction(prisma: PrismaClient, auctionId: string, actorId: string | null) {
  return prisma.$transaction(async (tx) => {
    const auction = await tx.auction.findUnique({ where: { id: auctionId }, include: { items: true } });
    if (!auction || auction.status !== "OPEN") return { settled: false, eventId: auction?.eventId ?? null };
    let settledItems = 0;
    for (const item of auction.items.filter((row) => row.status === "ACTIVE")) {
      if (item.highestTeamId) {
        await tx.team.update({ where: { id: item.highestTeamId }, data: { credits: { decrement: item.currentBid }, reservedCredits: { decrement: item.currentBid }, revision: { increment: 1 } } });
        if (item.cardId) await tx.teamCard.create({ data: { teamId: item.highestTeamId, cardId: item.cardId } });
        if (item.problemId) await tx.teamProblem.create({ data: { teamId: item.highestTeamId, problemId: item.problemId } });
      }
      await tx.auctionItem.update({ where: { id: item.id }, data: { status: item.highestTeamId ? "SOLD" : "CLOSED", revision: { increment: 1 } } });
      settledItems++;
    }
    if (auction.kind === "PROBLEM") {
      const unclaimed = auction.items.filter((item) => item.status === "ACTIVE" && !item.highestTeamId && item.problemId);
      const teams = await tx.team.findMany({ where: { active: true }, orderBy: { teamCode: "asc" }, include: { problems: { where: { unassignedAt: null }, select: { id: true } } } });
      const candidates = await tx.problem.findMany({ where: { id: { in: unclaimed.map((item) => item.problemId!).filter(Boolean) } }, orderBy: [{ startingBid: "asc" }, { problemCode: "asc" }], select: { id: true, problemCode: true } });
      const remaining = [...candidates];
      const allocations: { teamId: string; problemId: string }[] = [];
      while (remaining.length && teams.some((team) => team.problems.length + allocations.filter((row) => row.teamId === team.id).length < 2)) {
        const eligible = teams.filter((team) => team.problems.length + allocations.filter((row) => row.teamId === team.id).length < 2)
          .sort((a, b) => (a.problems.length + allocations.filter((row) => row.teamId === a.id).length) - (b.problems.length + allocations.filter((row) => row.teamId === b.id).length) || a.teamCode.localeCompare(b.teamCode));
        const team = eligible[0]; const problem = remaining.shift();
        if (!team || !problem) break;
        await tx.teamProblem.create({ data: { teamId: team.id, problemId: problem.id } });
        allocations.push({ teamId: team.id, problemId: problem.id });
      }
      if (allocations.length) await tx.auditLog.create({ data: { eventId: auction.eventId, actorId, action: "auction.fair_allocation", targetType: "Auction", targetId: auction.id, details: { rule: "lowest algorithm count first, then team code; remaining problems ordered by starting bid then problem code", allocations } } });
    }
    await tx.auction.update({ where: { id: auction.id }, data: { status: "CLOSED" } });
    await tx.auditLog.create({ data: { eventId: auction.eventId, actorId, action: "auction.closed", targetType: "Auction", targetId: auction.id, details: { settledItems, automatic: actorId === null } } });
    const [teams, event] = await Promise.all([
      tx.team.findMany({ select: { id: true } }),
      tx.event.findUnique({ where: { id: auction.eventId }, select: { creditBonusAwardedAt: true } }),
    ]);
    for (const team of teams) {
      const score = await tx.score.findUnique({ where: { teamId: team.id } });
      const bonus = event?.creditBonusAwardedAt ? score?.creditBonus ?? 0 : 0;
      const solution = score?.solution ?? 0; const timing = score?.timing ?? 0; const adjustments = score?.adjustments ?? 0;
      await tx.score.upsert({ where: { teamId: team.id }, create: { teamId: team.id, solution, timing, adjustments, creditBonus: bonus, total: solution + timing + adjustments + bonus }, update: { creditBonus: bonus, total: solution + timing + adjustments + bonus, revision: { increment: 1 } } });
    }
    return { settled: true, eventId: auction.eventId, settledItems };
  }, { isolationLevel: "Serializable" });
}
