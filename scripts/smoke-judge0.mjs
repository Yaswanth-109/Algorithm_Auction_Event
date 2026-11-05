import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envText = await readFile(path.join(root, ".env"), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/);
  return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
}));

if (!env.JUDGE0_URL || !env.JUDGE0_AUTH_TOKEN) {
  throw new Error("Set JUDGE0_URL and JUDGE0_AUTH_TOKEN in the project .env first.");
}

const baseUrl = env.JUDGE0_URL.replace(/\/$/, "");
const headers = { "Content-Type": "application/json", "X-Auth-Token": env.JUDGE0_AUTH_TOKEN };
const encode = (value) => Buffer.from(value, "utf8").toString("base64");
const createdResponse = await fetch(`${baseUrl}/submissions?base64_encoded=true&wait=false`, {
  method: "POST",
  headers,
  signal: AbortSignal.timeout(15_000),
  body: JSON.stringify({ language_id: 71, source_code: encode("print(input())"), stdin: encode("judge-ok") }),
});
if (!createdResponse.ok) throw new Error(`Judge0 rejected the sample (${createdResponse.status}).`);
const { token } = await createdResponse.json();
if (!token) throw new Error("Judge0 did not return a submission token.");

const deadline = Date.now() + 45_000;
let result;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const response = await fetch(`${baseUrl}/submissions/${encodeURIComponent(token)}?base64_encoded=true&fields=stdout,stderr,compile_output,status`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Judge0 status request failed (${response.status}).`);
  result = await response.json();
  if (result.status?.id !== 1 && result.status?.id !== 2) break;
}

const stdout = result?.stdout ? Buffer.from(result.stdout, "base64").toString("utf8").trim() : "";
if (result?.status?.id !== 3 || stdout !== "judge-ok") {
  throw new Error(`Sample failed: ${result?.status?.description ?? "no result"}; output: ${stdout || "(empty)"}`);
}
console.log("Judge0 is ready: Python sample ran successfully.");
