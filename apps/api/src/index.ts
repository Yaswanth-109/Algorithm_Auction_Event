import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { LoginSchema } from "@algorithm-auction/shared";
import { env } from "./config.js";
import { login, logout, requireAdmin, requireAuth, sessionLookup, SESSION_COOKIE } from "./auth.js";
import { createAdminRouter } from "./admin-routes.js";
import { createAuctionRouters } from "./auction-routes.js";
import { createTeamRouter } from "./team-routes.js";
import { createSubmissionRouters } from "./submission-routes.js";
import { startSubmissionWorker } from "./submission-worker.js";
import { createLeaderboardRouter } from "./leaderboard-routes.js";
import { createPublicDisplayRouter } from "./public-display-routes.js";
import { startTimerWorker } from "./timer-worker.js";
import { startAuctionWorker } from "./auction-worker.js";
import { createCodingCollaboration } from "./coding-collaboration.js";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
const allowedWebOrigins = new Set([env.WEB_ORIGIN, ...(env.WEB_ORIGINS ?? "").split(",")].map((origin) => origin.trim()).filter(Boolean));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: [...allowedWebOrigins], credentials: true } });
const codingCollaboration = createCodingCollaboration(io, prisma);

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: [...allowedWebOrigins], credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));
app.use(express.json({ limit: "3mb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" && !allowedWebOrigins.has(req.get("origin") ?? "")) {
    return res.status(403).json({ error: "Request origin is not allowed" });
  }
  next();
});
app.use((req, res, next) => {
  req.headers["x-request-id"] ??= randomUUID();
  res.setHeader("X-Request-Id", req.headers["x-request-id"] as string);
  next();
});
app.use(sessionLookup(prisma));

const loginLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/ready", async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ status: "ready", database: "connected" }); }
  catch { res.status(503).json({ status: "not_ready" }); }
});

app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid email or password" });
    const user = await login(prisma, parsed.data.email, parsed.data.password, res, env.NODE_ENV === "production", env.SESSION_TTL_HOURS);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    res.json({ user });
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try { await logout(prisma, req.cookies?.[SESSION_COOKIE], res, env.NODE_ENV === "production"); res.status(204).end(); }
  catch (error) { next(error); }
});

app.get("/api/auth/session", requireAuth, (req, res) => res.json({ user: req.auth }));
const auctionRouters = createAuctionRouters(prisma, io);
app.use("/api/admin/auctions", auctionRouters.admin);
app.use("/api/auctions", auctionRouters.user);
app.use("/api/team", createTeamRouter(prisma, io));
const submissionRouters = createSubmissionRouters(prisma);
app.use("/api/team/submissions", submissionRouters.team);
app.use("/api/admin/submissions", submissionRouters.admin);
app.use("/api/leaderboard", createLeaderboardRouter(prisma));
app.use("/api/public-display", createPublicDisplayRouter(prisma));
app.use("/api/admin", createAdminRouter(prisma, io, codingCollaboration));
app.get("/api/admin/ping", requireAdmin, (_req, res) => res.json({ ok: true }));

io.use(async (socket, next) => {
  try {
    if (!allowedWebOrigins.has(socket.handshake.headers.origin ?? "")) return next(new Error("origin_not_allowed"));
    const cookieHeader = socket.handshake.headers.cookie ?? "";
    const raw = cookieHeader.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    if (!raw) return next(new Error("unauthorized"));
    const token = decodeURIComponent(raw);
    const tokenHash = (await import("node:crypto")).createHash("sha256").update(token).digest("hex");
    const session = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!session || session.expiresAt <= new Date() || !session.user.active) return next(new Error("unauthorized"));
    socket.data.user = { id: session.user.id, role: session.user.role, teamId: session.user.teamId };
    next();
  } catch { next(new Error("unauthorized")); }
});

io.on("connection", (socket) => {
  const user = socket.data.user as { id: string; role: string; teamId: string | null };
  codingCollaboration.attach(socket, user);
  if (user.role === "ADMIN") {
    socket.join(["event:admin", "event:teams"]);
    void (async () => {
      const onlineSockets = await io.fetchSockets();
      const presence = new Map<string, Set<string>>();
      for (const onlineSocket of onlineSockets) {
        const onlineUser = onlineSocket.data.user as { id: string; role: string; teamId: string | null };
        if (onlineUser.role !== "TEAM" || !onlineUser.teamId) continue;
        const members = presence.get(onlineUser.teamId) ?? new Set<string>();
        members.add(onlineUser.id);
        presence.set(onlineUser.teamId, members);
      }
      socket.emit("team.presence.snapshot", [...presence].map(([teamId, members]) => ({ teamId, connectedMembers: [...members] })));
    })().catch((error) => console.error("team_presence_snapshot_failed", error));
  }
  else if (user.teamId) {
    socket.join([`team:${user.teamId}`, "event:teams"]);
    const announcePresence = async () => {
      const sockets = await io.in(`team:${user.teamId}`).fetchSockets();
      const connectedMembers = [...new Set(sockets.map((active) => (active.data.user as { id: string }).id))];
      const payload = { teamId: user.teamId, connectedMembers };
      io.to(`team:${user.teamId}`).emit("team.presence", payload);
      io.to("event:admin").emit("team.presence", payload);
    };
    void announcePresence();
    socket.on("disconnect", () => void announcePresence());
  }
  socket.on("team:join", (requestedTeamId: unknown, callback?: (result: { ok: boolean }) => void) => {
    if (user.role === "ADMIN" || (typeof requestedTeamId === "string" && user.teamId === requestedTeamId)) {
      if (typeof requestedTeamId === "string") socket.join(`team:${requestedTeamId}`);
      callback?.({ ok: true });
    } else callback?.({ ok: false });
  });
});

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Keep database and implementation details out of client responses.
  console.error("request_failed", error);
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;
    if (code === "P2002") return res.status(409).json({ error: "A record with one of those unique values already exists" });
    if (code === "P2025") return res.status(404).json({ error: "The requested record was not found" });
    if (code === "P2034") return res.status(409).json({ error: "This change conflicted with another update. Please retry." });
  }
  res.status(500).json({ error: "Internal server error" });
});

const stopSubmissionWorker = startSubmissionWorker(prisma, io);
const stopTimerWorker = startTimerWorker(prisma, io);
const stopAuctionWorker = startAuctionWorker(prisma, io);
httpServer.listen(env.PORT, "0.0.0.0", () => console.log(`api_listening port=${env.PORT}`));

const shutdown = async () => { await stopSubmissionWorker(); await stopTimerWorker(); await stopAuctionWorker(); await codingCollaboration.flush(); io.close(); await prisma.$disconnect(); httpServer.close(); };
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
