import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!process.env.DATABASE_URL || !email || !password || password.length < 12) {
  throw new Error("Set DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD (at least 12 characters) in the process environment.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const existing = await prisma.user.count({ where: { role: "ADMIN" } });
  if (existing > 0) throw new Error("An administrator already exists. Use the admin password reset workflow instead.");
  await prisma.user.create({ data: { email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), role: "ADMIN" } });
  console.log(`Created the initial administrator account: ${email}`);
} finally {
  await prisma.$disconnect();
}
