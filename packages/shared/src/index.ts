import { z } from "zod";

export const RoleSchema = z.enum(["ADMIN", "TEAM"]);
export type Role = z.infer<typeof RoleSchema>;

export const LanguageSchema = z.enum(["PYTHON", "JAVA", "C", "CPP"]);
export type Language = z.infer<typeof LanguageSchema>;

export const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
}).strict();

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  teamId: string | null;
};

export type RealtimeEvent =
  | { type: "team.updated"; teamId: string; revision: number }
  | { type: "auction.updated"; auctionId: string; revision: number }
  | { type: "event.updated"; eventId: string; revision: number }
  | { type: "submission.updated"; submissionId: string; teamId: string }
  | { type: "leaderboard.updated"; eventId: string; revision: number };
