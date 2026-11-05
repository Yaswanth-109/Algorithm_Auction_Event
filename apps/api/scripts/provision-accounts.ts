import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: path.join(root, ".env") });
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in the project root .env before provisioning accounts.");

type Credential = { role: "ADMIN" | "TEAM"; label: string; email: string; password: string; teamCode?: string; teamName?: string; teamSlot?: number };
const { accounts } = JSON.parse(await fs.readFile(path.join(root, "credentials.seed.json"), "utf8")) as { accounts: Credential[] };
const admins = accounts.filter((account) => account.role === "ADMIN");
const members = accounts.filter((account) => account.role === "TEAM");
const teams = [...new Set(members.map((member) => member.teamCode))];
const emails = accounts.map((account) => account.email.toLowerCase());
if (admins.length !== 2 || members.length !== 20 || teams.length !== 10 || new Set(emails).size !== accounts.length || accounts.some((a) => a.password.length < 12 || !a.email.includes("@"))) {
  throw new Error("Credential seed must contain two admins and ten unique two-member teams with valid credentials.");
}

const passwordHashes = await Promise.all(accounts.map((account) => argon2.hash(account.password, { type: argon2.argon2id })));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  await prisma.$transaction(async (tx) => {
    const [existingUsers, existingTeams] = await Promise.all([
      tx.user.count({ where: { email: { in: emails } } }),
      tx.team.count({ where: { teamCode: { in: teams as string[] } } }),
    ]);
    if (existingUsers || existingTeams) throw new Error("Provisioning stopped: one or more generated emails or team codes already exist. No records were changed.");

    let event = await tx.event.findFirst({ orderBy: { createdAt: "asc" } });
    if (!event) event = await tx.event.create({ data: { name: "Algorithm Auction", settings: { create: { startingCredits: 1000, creditBonusRate: 0.1 } } } });
    const settings = await tx.eventSettings.upsert({ where: { eventId: event.id }, create: { eventId: event.id, startingCredits: 1000, creditBonusRate: 0.1 }, update: {} });

    for (const admin of admins) {
      const index = accounts.indexOf(admin);
      await tx.user.create({ data: { email: admin.email.toLowerCase(), passwordHash: passwordHashes[index], role: "ADMIN" } });
    }
    for (const teamCode of teams as string[]) {
      const teamMembers = members.filter((member) => member.teamCode === teamCode).sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0));
      if (teamMembers.length !== 2 || teamMembers[0].teamSlot !== 1 || teamMembers[1].teamSlot !== 2) throw new Error(`Team ${teamCode} must have member slots 1 and 2.`);
      const team = await tx.team.create({ data: { teamCode, name: teamMembers[0].teamName!, credits: settings.startingCredits } });
      await tx.user.createMany({ data: teamMembers.map((member) => ({ email: member.email.toLowerCase(), passwordHash: passwordHashes[accounts.indexOf(member)], role: "TEAM" as const, teamId: team.id, teamSlot: member.teamSlot! })) });
      await tx.score.create({ data: { teamId: team.id } });
    }
  }, { isolationLevel: "Serializable" });
  console.log("Provisioned two administrators and five two-member teams. Passwords are stored in credentials.seed.json and the credentials workbook.");
} finally {
  await prisma.$disconnect();
}
