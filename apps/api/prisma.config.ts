import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
