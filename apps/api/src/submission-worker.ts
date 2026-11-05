import type { Server } from "socket.io";
import type { PrismaClient } from "./generated/prisma/client.js";
import { execute, outputMatches, type ExecutionResult } from "./execution.js";
import { env } from "./config.js";
import { calculateTimingPoints, calculateWeightedScore } from "./domain.js";

function statusForExecution(statusId: number) {
  if (statusId === 3) return "ACCEPTED" as const;
  if (statusId === 4) return "WRONG_ANSWER" as const;
  if (statusId === 5) return "TIME_LIMIT" as const;
  if (statusId === 6) return "COMPILE_ERROR" as const;
  if (statusId >= 7 && statusId <= 12) return "RUNTIME_ERROR" as const;
  return "INTERNAL_ERROR" as const;
}

async function processSubmission(prisma: PrismaClient, io: Server, submissionId: string) {
  const submission = await prisma.submission.findUnique({ where: { id: submissionId }, include: { problem: { include: { testCases: { orderBy: { position: "asc" } } } } } });
  if (!submission) return;
  try {
    if (submission.kind === "RUN") {
      const cases = submission.customInput !== null
        ? [{ input: submission.customInput, expected: null, id: null as string | null, weight: 0 }]
        : submission.problem.testCases.filter((testCase) => testCase.isSample).map((testCase) => ({ input: testCase.input, expected: testCase.expected, id: testCase.id, weight: 0 }));
      if (!cases.length) throw new Error("No sample cases are configured for this problem");
      const results: { result: ExecutionResult; passed: boolean }[] = [];
      for (const testCase of cases) {
        const result = await execute(submission.source, submission.language, testCase.input, testCase.expected ?? undefined);
        results.push({ result, passed: result.statusId === 3 && (testCase.expected === null || outputMatches(result.stdout, testCase.expected)) });
        if (![3, 4].includes(result.statusId)) break;
      }
      const failedExec = results.find(({ result }) => result.statusId !== 3 && result.statusId !== 4)?.result;
      const failedExpected = results.some(({ passed }) => !passed);
      const aggregate = failedExec ? statusForExecution(failedExec.statusId) : failedExpected ? "WRONG_ANSWER" : "ACCEPTED";
      const actualText = results.map(({ result, passed }, index) => `Sample ${index + 1}: ${passed ? "PASSED" : "FAILED"}\n${result.stdout}`).join("\n\n");
      const errorText = results.map(({ result }) => [result.compileOutput, result.stderr].filter(Boolean).join("\n")).filter(Boolean).join("\n");
      const runtime = results.reduce((sum, { result }) => sum + (result.executionMs ?? 0), 0);
      await prisma.submission.update({ where: { id: submission.id }, data: { status: aggregate, workerLeaseUntil: null, score: 0, runOutput: actualText, runError: errorText || null, compileOutput: results.map(({ result }) => result.compileOutput).filter(Boolean).join("\n") || null, executionMs: runtime || null } });
      io.to(`team:${submission.teamId}`).emit("submission.updated", { submissionId: submission.id, teamId: submission.teamId });
      return;
    }

    const official = submission.problem.testCases.filter((testCase) => !testCase.isSample);
    if (!official.length) throw new Error("No official test cases are configured");
    const settings = await prisma.eventSettings.findFirst();
    const results: { testCase: (typeof official)[number]; result: ExecutionResult; passed: boolean }[] = [];
    for (const testCase of official) {
      const result = await execute(submission.source, submission.language, testCase.input, testCase.expected);
      const passed = result.statusId === 3 && outputMatches(result.stdout, testCase.expected);
      results.push({ testCase, result, passed });
      if (result.statusId !== 3 && result.statusId !== 4) break;
    }
    const attempted = results.length;
    const allPassed = attempted === official.length && results.every((row) => row.passed);
    const policyScore = calculateWeightedScore(results.map((row) => ({ passed: row.passed, weight: row.testCase.weight })), settings?.partialCreditEnabled !== false, submission.problem.maxScore);
    const exceptional = results.find(({ result }) => result.statusId !== 3 && result.statusId !== 4)?.result;
    const status = exceptional ? statusForExecution(exceptional.statusId) : allPassed ? "ACCEPTED" : policyScore > 0 ? "PARTIAL" : "WRONG_ANSWER";
    await prisma.$transaction(async (tx) => {
      if (results.length) await tx.testCaseResult.createMany({ data: results.map(({ testCase, passed, result }) => ({ submissionId: submission.id, testCaseId: testCase.id, passed, awardedScore: passed && settings?.partialCreditEnabled !== false ? testCase.weight : 0, executionMs: result.executionMs })) });
      await tx.submission.update({ where: { id: submission.id }, data: { status, workerLeaseUntil: null, score: policyScore, executionMs: results.reduce((sum, row) => sum + (row.result.executionMs ?? 0), 0) || null } });

      const event = await tx.event.findFirst({ orderBy: { createdAt: "asc" }, select: { scoreResetAt: true, creditBonusAwardedAt: true } });
      const scoringStart = event?.scoreResetAt ?? new Date(0);
      const assignments = await tx.teamProblem.findMany({ where: { teamId: submission.teamId }, include: { problem: true } });
      const submissions = await tx.submission.findMany({ where: { teamId: submission.teamId, kind: "SUBMIT", createdAt: { gte: scoringStart }, status: { in: ["ACCEPTED", "PARTIAL", "WRONG_ANSWER"] } }, orderBy: { createdAt: "asc" } });
      const bestByProblem = new Map<string, (typeof submissions)[number]>();
      for (const row of submissions) {
        const previous = bestByProblem.get(row.problemId);
        if (!previous || row.score > previous.score) bestByProblem.set(row.problemId, row);
      }
      let solution = 0; let timing = 0;
      for (const assignment of assignments) {
        const best = bestByProblem.get(assignment.problemId);
        if (!best) continue;
        solution += best.score;
        if (best.status === "ACCEPTED" && best.score >= assignment.problem.maxScore) {
          const coding = await tx.codingSession.findUnique({ where: { teamId_problemId: { teamId: submission.teamId, problemId: assignment.problemId } } });
          if (coding) {
            const elapsed = Math.max(0, (best.createdAt.getTime() - coding.startedAt.getTime()) / 1000);
            const remaining = Math.max(0, assignment.problem.timeLimitSeconds - elapsed);
            timing += calculateTimingPoints(remaining, assignment.problem.timeLimitSeconds);
            await tx.codingSession.update({ where: { id: coding.id }, data: { endedAt: coding.endedAt ?? best.createdAt } });
          }
          await tx.teamProblem.update({ where: { id: assignment.id }, data: { status: "SOLVED" } });
        }
      }
      if (submission.createdAt < scoringStart) {
        if (status === "ACCEPTED" && policyScore >= submission.problem.maxScore) {
          await tx.teamProblem.updateMany({ where: { teamId: submission.teamId, problemId: submission.problemId, status: "IN_PROGRESS" }, data: { status: "SOLVED" } });
          await tx.codingSession.updateMany({ where: { teamId: submission.teamId, problemId: submission.problemId, endedAt: null }, data: { endedAt: submission.createdAt } });
        }
        return;
      }
      const existingScore = await tx.score.findUnique({ where: { teamId: submission.teamId } });
      const bonus = event?.creditBonusAwardedAt ? existingScore?.creditBonus ?? 0 : 0;
      const adjustments = existingScore?.adjustments ?? 0;
      await tx.score.upsert({ where: { teamId: submission.teamId }, create: { teamId: submission.teamId, solution, timing, creditBonus: bonus, adjustments, total: solution + timing + bonus + adjustments }, update: { solution, timing, creditBonus: bonus, total: solution + timing + bonus + adjustments, revision: { increment: 1 } } });
    }, { isolationLevel: "Serializable" });
    io.to(`team:${submission.teamId}`).emit("submission.updated", { submissionId: submission.id, teamId: submission.teamId });
    io.to("event:admin").emit("submission.updated", { submissionId: submission.id, teamId: submission.teamId });
    io.to("event:admin").emit("leaderboard.updated", { revision: Date.now() });
    io.to("event:teams").emit("leaderboard.updated", { revision: Date.now() });
  } catch (error) {
    console.error("submission_evaluation_failed", { submissionId, error });
    await prisma.submission.updateMany({ where: { id: submissionId, status: "RUNNING" }, data: { status: "INTERNAL_ERROR", workerLeaseUntil: null } });
    io.to(`team:${submission.teamId}`).emit("submission.updated", { submissionId, teamId: submission.teamId });
  }
}

export function startSubmissionWorker(prisma: PrismaClient, io: Server) {
  let active = 0;
  let reserved = 0;
  let closed = false;
  const processOne = async () => {
    if (active + reserved >= env.SUBMISSION_CONCURRENCY || closed) return;
    reserved++;
    let reservedTransferred = false;
    try {
      await prisma.submission.updateMany({ where: { status: "RUNNING", workerLeaseUntil: { lt: new Date() } }, data: { status: "QUEUED", workerLeaseUntil: null } });
      const queued = await prisma.submission.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (queued) {
        const claimed = await prisma.submission.updateMany({ where: { id: queued.id, status: "QUEUED" }, data: { status: "RUNNING", workerLeaseUntil: new Date(Date.now() + 2 * 60 * 60 * 1000) } });
        if (claimed.count === 1) {
          active++;
          reserved--;
          reservedTransferred = true;
          try { await processSubmission(prisma, io, queued.id); }
          finally { active--; }
        }
      }
    } catch (error) { console.error("submission_worker_failed", error); }
    finally { if (!reservedTransferred) reserved--; }
  };
  const timer = setInterval(() => void processOne(), 500);
  void processOne();
  return async () => { closed = true; clearInterval(timer); while (active > 0) await new Promise((resolve) => setTimeout(resolve, 10)); };
}
