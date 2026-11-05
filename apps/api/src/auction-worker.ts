import type { Server } from "socket.io";
import type { PrismaClient } from "./generated/prisma/client.js";
import { settleAuction } from "./auction-settlement.js";

export function startAuctionWorker(prisma: PrismaClient, io: Server) {
  let busy = false;
  let closed = false;
  const sweep = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const due = await prisma.auction.findMany({ where: { status: "OPEN", endsAt: { lte: new Date() }, event: { status: { notIn: ["PAUSED", "ENDED"] } } }, select: { id: true, eventId: true }, take: 50 });
      for (const auction of due) {
        try {
          const result = await settleAuction(prisma, auction.id, null);
          if (result.settled) {
            const revision = Date.now();
            io.to("event:admin").emit("auction.updated", { auctionId: auction.id, revision });
            io.to("event:teams").emit("auction.updated", { auctionId: auction.id, revision });
            io.to("event:admin").emit("leaderboard.updated", { eventId: result.eventId, revision });
            io.to("event:teams").emit("leaderboard.updated", { eventId: result.eventId, revision });
          }
        } catch (error) { console.error("auction_settlement_failed", { auctionId: auction.id, error }); }
      }
    } catch (error) { console.error("auction_worker_failed", error); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void sweep(), 1000);
  void sweep();
  return async () => { closed = true; clearInterval(timer); while (busy) await new Promise((resolve) => setTimeout(resolve, 10)); };
}
