import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "./generated/prisma/client.js";
import argon2 from "argon2";
import type { SessionUser } from "@algorithm-auction/shared";

export const SESSION_COOKIE = "aa_session";
const cookieOptions = (production: boolean, expires?: Date) => ({
  httpOnly: true,
  secure: production,
  sameSite: "strict" as const,
  path: "/",
  ...(expires ? { expires } : {}),
});

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

declare global {
  namespace Express {
    interface Request { auth?: SessionUser; }
  }
}

export async function login(prisma: PrismaClient, email: string, password: string, res: Response, production: boolean, ttlHours: number) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user?.active || !(await argon2.verify(user.passwordHash, password).catch(() => false))) return null;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await prisma.session.create({ data: { tokenHash: digest(token), userId: user.id, expiresAt } });
  res.cookie(SESSION_COOKIE, token, cookieOptions(production, expiresAt));
  return { id: user.id, email: user.email, role: user.role, teamId: user.teamId } satisfies SessionUser;
}

export async function logout(prisma: PrismaClient, token: string | undefined, res: Response, production: boolean) {
  if (token) await prisma.session.deleteMany({ where: { tokenHash: digest(token) } });
  res.clearCookie(SESSION_COOKIE, cookieOptions(production));
}

export function sessionLookup(prisma: PrismaClient) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      const session = await prisma.session.findUnique({
        where: { tokenHash: digest(token) },
        include: { user: { select: { id: true, email: true, role: true, teamId: true, active: true } } },
      });
      if (session && session.expiresAt > new Date() && session.user.active) {
        req.auth = { id: session.user.id, email: session.user.email, role: session.user.role, teamId: session.user.teamId };
      }
    }
    next();
    } catch (error) { next(error); }
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "Authentication required" });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "Authentication required" });
  if (req.auth.role !== "ADMIN") return res.status(403).json({ error: "Administrator access required" });
  next();
}
