import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const allowedDevOrigins = [...new Set([process.env.WEB_ORIGIN, ...(process.env.WEB_ORIGINS ?? "").split(",")]
  .filter((origin): origin is string => Boolean(origin))
  .flatMap((origin) => {
    try { return [new URL(origin).hostname]; }
    catch { return []; }
  }))];

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(configDirectory, "../.."),
  allowedDevOrigins,
};
export default config;
