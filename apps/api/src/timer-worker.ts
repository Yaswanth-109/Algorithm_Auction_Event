import type { Server } from "socket.io";
import type { PrismaClient } from "./generated/prisma/client.js";

export function startTimerWorker(prisma: PrismaClient, io: Server) {
  let busy = false;
  let closed = false;
  const sweep = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" }, select: { status: true } });
      if (event?.status === "PAUSED") return;
      const expired = await prisma.codingSession.findMany({ where: { endedAt: null, deadlineAt: { lte: new Date() } }, orderBy: { deadlineAt: "asc" }, take: 100, select: { id: true, teamId: true, problemId: true } });
      for (const session of expired) {
        const changed = await prisma.$transaction(async (tx) => {
          const result = await tx.codingSession.updateMany({ where: { id: session.id, endedAt: null }, data: { endedAt: new Date() } });
          if (!result.count) return false;
          await tx.teamProblem.updateMany({ where: { teamId: session.teamId, problemId: session.problemId, status: "IN_PROGRESS" }, data: { status: "TIME_EXPIRED" } });
          await tx.auditLog.create({ data: { action: "coding_session.time_expired", targetType: "CodingSession", targetId: session.id, details: { teamId: session.teamId, problemId: session.problemId } } });
          await tx.team.update({ where: { id: session.teamId }, data: { revision: { increment: 1 } } });
          return true;
        });
        if (changed) {
          io.to(`team:${session.teamId}`).emit("team.updated", { teamId: session.teamId, revision: Date.now() });
          io.to("event:admin").emit("team.updated", { teamId: session.teamId, revision: Date.now() });
        }
      }
    } catch (error) { console.error("timer_worker_failed", error); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void sweep(), 1000);
  void sweep();
  return async () => { closed = true; clearInterval(timer); while (busy) await new Promise((resolve) => setTimeout(resolve, 10)); };
}
