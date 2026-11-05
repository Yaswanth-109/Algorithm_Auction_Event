import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url(),
  WEB_ORIGINS: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  EXECUTION_BACKEND: z.enum(["disabled", "judge0", "docker"]).default("judge0"),
  JUDGE0_URL: z.string().url().optional(),
  JUDGE0_AUTH_TOKEN: z.string().optional(),
  JUDGE0_PYTHON_ID: z.coerce.number().int().positive().default(71),
  JUDGE0_JAVA_ID: z.coerce.number().int().positive().default(62),
  JUDGE0_C_ID: z.coerce.number().int().positive().default(50),
  JUDGE0_CPP_ID: z.coerce.number().int().positive().default(54),
  LOCAL_EXECUTION_IMAGE: z.string().min(1).default("algorithm-auction-runner:local"),
  LOCAL_EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  DOCKER_BIN: z.string().min(1).default("docker"),
  SUBMISSION_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
});

export const env = EnvSchema.parse(process.env);
