import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { env } from "./config.js";

export type ExecutionResult = {
  statusId: number;
  status: string;
  stdout: string;
  stderr: string;
  compileOutput: string;
  executionMs: number | null;
  memoryKb: number | null;
};

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64");
const decode = (value: string | null | undefined) => value ? Buffer.from(value, "base64").toString("utf8") : "";
const wait = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));
const OUTPUT_LIMIT = 1024 * 1024;
const COMPILE_ERROR_EXIT = 86;

function languageId(language: string) {
  switch (language) {
    case "PYTHON": return env.JUDGE0_PYTHON_ID;
    case "JAVA": return env.JUDGE0_JAVA_ID;
    case "C": return env.JUDGE0_C_ID;
    case "CPP": return env.JUDGE0_CPP_ID;
    default: throw new Error("Unsupported programming language");
  }
}

function localCommand(language: string) {
  switch (language) {
    case "PYTHON": return { filename: "main.py", command: ["python3", "-B", "/workspace/main.py"] };
    case "JAVA": return {
      filename: "Main.java",
      command: ["sh", "-c", "javac -J-Xmx256m -J-XX:ActiveProcessorCount=1 Main.java 2>/tmp/compile.err || { cat /tmp/compile.err >&2; exit 86; }; exec java -XX:ActiveProcessorCount=1 -XX:+UseSerialGC -Xmx256m -cp /workspace Main"],
    };
    case "C": return {
      filename: "main.c",
      command: ["sh", "-c", "gcc -std=c17 -O2 -pipe main.c -o /workspace/main 2>/tmp/compile.err || { cat /tmp/compile.err >&2; exit 86; }; exec ./main"],
    };
    case "CPP": return {
      filename: "main.cpp",
      command: ["sh", "-c", "g++ -std=c++20 -O2 -pipe main.cpp -o /workspace/main 2>/tmp/compile.err || { cat /tmp/compile.err >&2; exit 86; }; exec ./main"],
    };
    default: throw new Error("Unsupported programming language");
  }
}

function killContainer(containerName: string) {
  const killer = spawn(env.DOCKER_BIN, ["kill", containerName], { stdio: "ignore" });
  killer.on("error", () => {});
}

async function executeInDocker(source: string, language: string, stdin: string): Promise<ExecutionResult> {
  const startedAt = Date.now();
  const directory = await mkdtemp(path.join(os.tmpdir(), "algorithm-auction-"));
  const containerName = `algorithm-auction-${randomUUID()}`;
  try {
    await chmod(directory, 0o777);
    const spec = localCommand(language);
    await writeFile(path.join(directory, spec.filename), source, { mode: 0o644 });

    const args = [
      "run", "--rm", "--init", "--interactive", "--name", containerName,
      "--network", "none", "--memory", "512m", "--memory-swap", "512m", "--cpus", "1",
      "--pids-limit", "64", "--ulimit", "core=0", "--ulimit", "fsize=10485760:10485760",
      "--read-only", "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
      "--user", "65534:65534", "--env", "HOME=/tmp", "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=64m,mode=1777",
      "--mount", `type=bind,source=${directory},target=/workspace`, "--workdir", "/workspace",
      env.LOCAL_EXECUTION_IMAGE, ...spec.command,
    ];

    return await new Promise<ExecutionResult>((resolve, reject) => {
      const child = spawn(env.DOCKER_BIN, args, { stdio: ["pipe", "pipe", "pipe"] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let timedOut = false;
      let outputExceeded = false;
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killContainer(containerName);
      }, env.LOCAL_EXECUTION_TIMEOUT_MS);
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > OUTPUT_LIMIT) {
          outputExceeded = true;
          killContainer(containerName);
          return;
        }
        target.push(chunk);
      };
      child.stdout.on("data", collect(stdout));
      child.stderr.on("data", collect(stderr));
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Unable to start the Docker execution service: ${error.message}`));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const out = Buffer.concat(stdout).toString("utf8");
        const err = Buffer.concat(stderr).toString("utf8");
        const executionMs = Date.now() - startedAt;
        if (timedOut) return resolve({ statusId: 5, status: "Time Limit Exceeded", stdout: out, stderr: err || "Execution time limit exceeded", compileOutput: "", executionMs, memoryKb: null });
        if (outputExceeded) return resolve({ statusId: 11, status: "Runtime Error", stdout: out, stderr: "Output exceeded the 1 MiB limit", compileOutput: "", executionMs, memoryKb: null });
        if (code === COMPILE_ERROR_EXIT) return resolve({ statusId: 6, status: "Compilation Error", stdout: out, stderr: err, compileOutput: err, executionMs, memoryKb: null });
        if (code !== 0) return resolve({ statusId: 7, status: "Runtime Error", stdout: out, stderr: err || `Program exited with code ${code ?? "unknown"}`, compileOutput: "", executionMs, memoryKb: null });
        resolve({ statusId: 3, status: "Accepted", stdout: out, stderr: err, compileOutput: "", executionMs, memoryKb: null });
      });
      child.stdin.end(stdin);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function executeWithJudge0(source: string, language: string, stdin: string, expectedOutput?: string): Promise<ExecutionResult> {
  if (!env.JUDGE0_URL) throw new Error("JUDGE0_URL is not configured");
  const baseUrl = env.JUDGE0_URL.replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.JUDGE0_AUTH_TOKEN) headers["X-Auth-Token"] = env.JUDGE0_AUTH_TOKEN;
  const response = await fetch(`${baseUrl}/submissions?base64_encoded=true&wait=false`, {
    method: "POST", headers, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ source_code: encode(source), language_id: languageId(language), stdin: encode(stdin), ...(expectedOutput === undefined ? {} : { expected_output: encode(expectedOutput) }) }),
  });
  if (!response.ok) throw new Error(`Execution service returned ${response.status}`);
  const created = await response.json() as { token?: string };
  if (!created.token) throw new Error("Execution service did not return a job token");

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await wait(500);
    const resultResponse = await fetch(`${baseUrl}/submissions/${encodeURIComponent(created.token)}?base64_encoded=true&fields=stdout,stderr,compile_output,message,status,time,memory`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!resultResponse.ok) throw new Error(`Execution service returned ${resultResponse.status}`);
    const result = await resultResponse.json() as { stdout?: string | null; stderr?: string | null; compile_output?: string | null; message?: string | null; time?: string | number | null; memory?: number | null; status?: { id: number; description: string } };
    if (!result.status || result.status.id === 1 || result.status.id === 2) continue;
    return {
      statusId: result.status.id,
      status: result.status.description,
      stdout: decode(result.stdout),
      stderr: decode(result.stderr ?? result.message),
      compileOutput: decode(result.compile_output),
      executionMs: result.time === null || result.time === undefined ? null : Math.round(Number(result.time) * 1000),
      memoryKb: result.memory ?? null,
    };
  }
  return { statusId: 5, status: "Time Limit Exceeded", stdout: "", stderr: "Execution service response timed out", compileOutput: "", executionMs: null, memoryKb: null };
}

export async function execute(source: string, language: string, stdin: string, expectedOutput?: string): Promise<ExecutionResult> {
  if (env.EXECUTION_BACKEND === "docker") return executeInDocker(source, language, stdin);
  if (env.EXECUTION_BACKEND === "judge0") return executeWithJudge0(source, language, stdin, expectedOutput);
  throw new Error("Code execution is disabled");
}

export function outputMatches(actual: string, expected: string) {
  return actual.replace(/\r\n/g, "\n").trim() === expected.replace(/\r\n/g, "\n").trim();
}
