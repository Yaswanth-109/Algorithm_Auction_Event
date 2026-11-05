export type RoundingRule = "FLOOR" | "CEIL" | "ROUND";

export function calculateCreditBonus(credits: number, reservedCredits: number, rate = 0.1, rounding: RoundingRule = "FLOOR") {
  const raw = Math.max(0, credits - reservedCredits) * rate;
  if (rounding === "CEIL") return Math.ceil(raw);
  if (rounding === "ROUND") return Math.round(raw);
  return Math.floor(raw);
}

export function calculateTimingPoints(remainingSeconds: number, totalSeconds: number) {
  if (totalSeconds <= 0) return 0;
  const remaining = Math.max(0, Math.min(remainingSeconds, totalSeconds));
  return Math.floor(remaining / 10) / 2;
}

export function calculateWeightedScore(results: { passed: boolean; weight: number }[], partialCredit: boolean, maximum: number) {
  const score = results.reduce((sum, result) => sum + (result.passed ? result.weight : 0), 0);
  if (!partialCredit && results.some((result) => !result.passed)) return 0;
  return Math.min(maximum, score);
}

export function validateBid(input: { amount: number; currentBid: number; hasLeader: boolean; availableCredits: number; maximumBid?: number | null }) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) return "Bid must be a positive whole number";
  if ((input.hasLeader && input.amount <= input.currentBid) || (!input.hasLeader && input.amount < input.currentBid)) return "Bid must meet the opening price and exceed any existing bid";
  if (input.maximumBid !== null && input.maximumBid !== undefined && input.amount > input.maximumBid) return "Bid exceeds the configured maximum";
  if (input.amount > input.availableCredits) return "Bid exceeds available credits";
  return null;
}

export function compareStandings(a: { totalScore: number; solutionScore: number; solvedProblems: number; timingScore: number; teamCode: string }, b: { totalScore: number; solutionScore: number; solvedProblems: number; timingScore: number; teamCode: string }) {
  return b.totalScore - a.totalScore || b.solutionScore - a.solutionScore || b.solvedProblems - a.solvedProblems || b.timingScore - a.timingScore || a.teamCode.localeCompare(b.teamCode);
}
