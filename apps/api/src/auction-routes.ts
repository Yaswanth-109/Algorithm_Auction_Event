import { Router } from "express";
import { z } from "zod";
import type { Server } from "socket.io";
import type { PrismaClient } from "./generated/prisma/client.js";
import { requireAdmin, requireAuth } from "./auth.js";
import { settleAuction } from "./auction-settlement.js";
import { validateBid } from "./domain.js";

const BidInput = z.object({ amount: z.number().int().positive() }).strict();
const IdempotencyKey = z.string().min(8).max(100).regex(/^[A-Za-z0-9._:-]+$/);

export function createAuctionRouters(prisma: PrismaClient, io: Server) {
  const admin = Router();
  admin.use(requireAdmin);
  const user = Router();
  user.use(requireAuth);

  admin.get("/", async (_req, res, next) => {
    try { res.json({ auctions: await prisma.auction.findMany({ orderBy: { createdAt: "desc" }, include: { items: { include: { highestTeam: { select: { teamCode: true, name: true } }, card: { select: { name: true } }, problem: { select: { problemCode: true, title: true } } } } } }) }); }
    catch (error) { next(error); }
  });

  async function emitAuction(auctionId: string) {
    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) return;
    const revision = Date.now();
    io.to("event:admin").emit("auction.updated", { auctionId, revision });
    io.to("event:teams").emit("auction.updated", { auctionId, revision });
    io.to("event:admin").emit("leaderboard.updated", { eventId: auction.eventId, revision });
  }

  admin.post("/", async (req, res, next) => {
    try {
      const parsed = z.object({ kind: z.enum(["POWER_CARD", "PROBLEM"]), itemIds: z.array(z.string()).min(1).max(500), endsAt: z.string().datetime() }).strict().safeParse(req.body);
      if (!parsed.success || new Set(parsed.data?.itemIds ?? []).size !== parsed.data?.itemIds.length) return res.status(400).json({ error: "Provide a valid item list and closing timestamp" });
      const endsAt = new Date(parsed.data.endsAt);
      if (endsAt <= new Date()) return res.status(400).json({ error: "Auction close time must be in the future" });
      const event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" } });
      if (!event || !["READY", "LIVE"].includes(event.status)) return res.status(409).json({ error: "Set the event to READY or LIVE before creating auctions" });
      const itemRows = parsed.data.kind === "POWER_CARD"
        ? await prisma.powerCard.findMany({ where: { id: { in: parsed.data.itemIds }, eventId: event.id, published: true } })
        : await prisma.problem.findMany({ where: { id: { in: parsed.data.itemIds }, eventId: event.id, published: true } });
      if (itemRows.length !== parsed.data.itemIds.length) return res.status(400).json({ error: "Every auction item must be published and belong to this event" });
      const previous = await prisma.auctionItem.findMany({ where: parsed.data.kind === "POWER_CARD" ? { cardId: { in: parsed.data.itemIds }, status: { in: ["AVAILABLE", "ACTIVE", "SOLD"] } } : { problemId: { in: parsed.data.itemIds }, status: { in: ["AVAILABLE", "ACTIVE", "SOLD"] } }, select: { id: true } });
      if (previous.length) return res.status(409).json({ error: "One or more items are already in an active or completed auction" });
      const auction = await prisma.auction.create({
        data: {
          eventId: event.id, kind: parsed.data.kind, status: "SCHEDULED", endsAt,
          items: { create: itemRows.map((item) => ({
            ...(parsed.data.kind === "POWER_CARD" ? { cardId: item.id, currentBid: (item as { startingBid: number }).startingBid } : { problemId: item.id, currentBid: (item as { startingBid: number }).startingBid }),
            status: "AVAILABLE", closesAt: endsAt,
          })) },
        }, include: { items: true },
      });
      await prisma.auditLog.create({ data: { eventId: event.id, actorId: req.auth!.id, action: "auction.created", targetType: "Auction", targetId: auction.id, details: { kind: auction.kind, itemCount: auction.items.length, endsAt } } });
      res.status(201).json({ auction });
    } catch (error) { next(error); }
  });

  admin.post("/:auctionId/open", async (req, res, next) => {
    try {
      const auction = await prisma.auction.findUnique({ where: { id: req.params.auctionId }, include: { event: true } });
      if (!auction) return res.status(404).json({ error: "Auction not found" });
      if (!["READY", "LIVE"].includes(auction.event.status)) return res.status(409).json({ error: "Event must be READY or LIVE" });
      if (auction.status !== "SCHEDULED" || !auction.endsAt || auction.endsAt <= new Date()) return res.status(409).json({ error: "Auction is not scheduled or its close time has passed" });
      const [otherOpen, unfinishedCards, completedCards] = await Promise.all([
        prisma.auction.findFirst({ where: { eventId: auction.eventId, id: { not: auction.id }, status: "OPEN" }, select: { id: true } }),
        auction.kind === "PROBLEM" ? prisma.auction.findFirst({ where: { eventId: auction.eventId, kind: "POWER_CARD", status: { not: "CLOSED" } }, select: { id: true } }) : Promise.resolve(null),
        auction.kind === "PROBLEM" ? prisma.auction.findFirst({ where: { eventId: auction.eventId, kind: "POWER_CARD", status: "CLOSED" }, select: { id: true } }) : Promise.resolve({ id: "not-applicable" }),
      ]);
      if (otherOpen) return res.status(409).json({ error: "Close the current auction before opening another" });
      if (unfinishedCards) return res.status(409).json({ error: "Complete the Power Card Auction before opening the Algorithm Auction" });
      if (!completedCards) return res.status(409).json({ error: "Run and close the Power Card Auction before opening the Algorithm Auction" });
      await prisma.$transaction(async (tx) => {
        await tx.auction.update({ where: { id: auction.id }, data: { status: "OPEN", startsAt: new Date() } });
        await tx.auctionItem.updateMany({ where: { auctionId: auction.id, status: "AVAILABLE" }, data: { status: "ACTIVE" } });
        await tx.auditLog.create({ data: { eventId: auction.eventId, actorId: req.auth!.id, action: "auction.opened", targetType: "Auction", targetId: auction.id, details: {} } });
      });
      await emitAuction(auction.id);
      res.json({ opened: true });
    } catch (error) { next(error); }
  });

  admin.post("/:auctionId/close", async (req, res, next) => {
    try {
      const auction = await prisma.auction.findUnique({ where: { id: req.params.auctionId }, include: { items: true } });
      if (!auction) return res.status(404).json({ error: "Auction not found" });
      if (auction.status !== "OPEN") return res.status(409).json({ error: "Auction is not open" });
      await settleAuction(prisma, auction.id, req.auth!.id);
      await emitAuction(auction.id);
      res.json({ closed: true });
    } catch (error) { next(error); }
  });

  user.get("/", async (req, res, next) => {
    try {
      const event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" } });
      if (!event || !req.auth!.teamId) return res.json({ auctions: [] });
      const auctions = await prisma.auction.findMany({
        where: { eventId: event.id, status: { in: ["OPEN", "SCHEDULED"] } },
        include: {
          items: {
            where: { status: { in: ["ACTIVE", "AVAILABLE"] } },
            include: {
              highestTeam: { select: { id: true, teamCode: true, name: true } },
              card: { select: { id: true, name: true, description: true, benefits: true, conditions: true, startingBid: true, usageLimit: true, effectType: true, effectValue: true } },
              problem: { select: { id: true, problemCode: true, title: true, difficulty: true, statement: true, inputFormat: true, outputFormat: true, constraints: true, sampleExamples: true, startingBid: true, maxBid: true, timeLimitSeconds: true, maxScore: true, maxTimingPoints: true } },
            },
          },
        },
      });
      res.json({ auctions, teamId: req.auth!.teamId, availableCredits: await prisma.team.findUnique({ where: { id: req.auth!.teamId }, select: { credits: true, reservedCredits: true } }).then((value) => value ? value.credits - value.reservedCredits : 0) });
    } catch (error) { next(error); }
  });

  user.post("/items/:itemId/bids", async (req, res, next) => {
    try {
      if (req.auth!.role !== "TEAM" || !req.auth!.teamId) return res.status(403).json({ error: "Team account required" });
      const input = BidInput.safeParse(req.body);
      const key = IdempotencyKey.safeParse(req.get("Idempotency-Key"));
      if (!input.success || !key.success) return res.status(400).json({ error: "Provide a positive integer bid and an Idempotency-Key header" });
      const item = await prisma.$transaction(async (tx) => {
        const previous = await tx.bid.findUnique({ where: { idempotencyKey: key.data } });
        if (previous) {
        if (previous.teamId !== req.auth!.teamId || previous.auctionItemId !== String(req.params.itemId) || previous.amount !== input.data.amount) throw Object.assign(new Error("Idempotency key was already used for a different bid"), { status: 409 });
          return tx.auctionItem.findUniqueOrThrow({ where: { id: previous.auctionItemId }, include: { highestTeam: { select: { id: true, teamCode: true, name: true } } } });
        }
        const auctionItem = await tx.auctionItem.findUnique({ where: { id: String(req.params.itemId) }, include: { auction: { include: { event: true } }, problem: true, card: true } });
        if (!auctionItem || auctionItem.status !== "ACTIVE" || auctionItem.auction.status !== "OPEN" || !auctionItem.auction.endsAt || auctionItem.auction.endsAt <= new Date()) throw Object.assign(new Error("This auction item is not accepting bids"), { status: 409 });
        if (auctionItem.auction.event.status === "PAUSED" || auctionItem.auction.event.status === "ENDED") throw Object.assign(new Error("The event is paused or has ended"), { status: 409 });
        const amount = input.data.amount;
        const team = await tx.team.findUnique({ where: { id: req.auth!.teamId! } });
        if (!team?.active) throw Object.assign(new Error("Team is not active"), { status: 403 });
        const available = team.credits - team.reservedCredits + (auctionItem.highestTeamId === team.id ? auctionItem.currentBid : 0);
        const bidError = validateBid({ amount, currentBid: auctionItem.currentBid, hasLeader: Boolean(auctionItem.highestTeamId), availableCredits: available, maximumBid: auctionItem.problem?.maxBid });
        if (bidError) throw Object.assign(new Error(bidError), { status: 400 });
        if (auctionItem.problemId && auctionItem.highestTeamId !== team.id) {
          const acquired = await tx.teamProblem.count({ where: { teamId: team.id, unassignedAt: null } });
          const leading = await tx.auctionItem.count({ where: { highestTeamId: team.id, status: "ACTIVE", problemId: { not: null }, id: { not: auctionItem.id } } });
          if (acquired + leading >= 2) throw Object.assign(new Error("Your team can have at most two algorithm problems"), { status: 409 });
        }
        if (auctionItem.highestTeamId) await tx.team.update({ where: { id: auctionItem.highestTeamId }, data: { reservedCredits: { decrement: auctionItem.currentBid }, revision: { increment: 1 } } });
        await tx.team.update({ where: { id: team.id }, data: { reservedCredits: { increment: amount }, revision: { increment: 1 } } });
        await tx.bid.create({ data: { auctionItemId: auctionItem.id, teamId: team.id, amount, idempotencyKey: key.data } });
        return tx.auctionItem.update({ where: { id: auctionItem.id }, data: { currentBid: amount, highestTeamId: team.id, revision: { increment: 1 } }, include: { highestTeam: { select: { id: true, teamCode: true, name: true } } } });
      }, { isolationLevel: "Serializable" });
      await emitAuction(item.auctionId);
      res.status(201).json({ item });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return res.status(Number((error as { status: number }).status)).json({ error: (error as { message?: string }).message ?? "Bid was rejected" });
      if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2034") return res.status(409).json({ error: "Bid conflicted with another update. Submit again with a new idempotency key." });
      next(error);
    }
  });

  user.get("/items/:itemId/history", async (req, res, next) => {
    try {
      const item = await prisma.auctionItem.findUnique({ where: { id: String(req.params.itemId) }, select: { id: true } });
      if (!item) return res.status(404).json({ error: "Auction item not found" });
      const bids = await prisma.bid.findMany({ where: { auctionItemId: item.id }, orderBy: { createdAt: "desc" }, take: 100, include: { team: { select: { teamCode: true, name: true } } } });
      res.json({ bids: bids.map((bid) => ({ id: bid.id, amount: bid.amount, teamCode: bid.team.teamCode, teamName: bid.team.name, createdAt: bid.createdAt })) });
    } catch (error) { next(error); }
  });

  return { admin, user };
}
