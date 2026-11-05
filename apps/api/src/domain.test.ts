import assert from "node:assert/strict";
import test from "node:test";
import { calculateCreditBonus, calculateTimingPoints, calculateWeightedScore, compareStandings, validateBid } from "./domain.js";

test("credit bonus uses available credits and configured rounding", () => {
  assert.equal(calculateCreditBonus(1000, 0), 100);
  assert.equal(calculateCreditBonus(950, 50), 90);
  assert.equal(calculateCreditBonus(105, 0, 0.1, "FLOOR"), 10);
  assert.equal(calculateCreditBonus(105, 0, 0.1, "ROUND"), 11);
  assert.equal(calculateCreditBonus(105, 0, 0.1, "CEIL"), 11);
  assert.equal(calculateCreditBonus(100, 200), 0);
});

test("timing points use seconds and stay inside the configured range", () => {
  assert.equal(calculateTimingPoints(600, 1200), 30);
  assert.equal(calculateTimingPoints(1200, 1200), 60);
  assert.equal(calculateTimingPoints(0, 1200), 0);
  assert.equal(calculateTimingPoints(1400, 1200), 60);
  assert.equal(calculateTimingPoints(4, 0), 0);
});

test("weighted score honors partial-credit policy", () => {
  const cases = [{ passed: true, weight: 30 }, { passed: false, weight: 40 }, { passed: true, weight: 30 }];
  assert.equal(calculateWeightedScore(cases, true, 100), 60);
  assert.equal(calculateWeightedScore(cases, false, 100), 0);
  assert.equal(calculateWeightedScore([{ passed: true, weight: 120 }], true, 100), 100);
});

test("bids honor opening price, leader increment, limits, and available balance", () => {
  assert.equal(validateBid({ amount: 100, currentBid: 100, hasLeader: false, availableCredits: 100 }), null);
  assert.match(validateBid({ amount: 100, currentBid: 100, hasLeader: true, availableCredits: 200 })!, /exceed/);
  assert.match(validateBid({ amount: 120, currentBid: 100, hasLeader: false, availableCredits: 110 })!, /available/);
  assert.match(validateBid({ amount: 121, currentBid: 100, hasLeader: false, availableCredits: 200, maximumBid: 120 })!, /maximum/);
  assert.match(validateBid({ amount: 1.5, currentBid: 0, hasLeader: false, availableCredits: 100 })!, /whole/);
});

test("leaderboard tie breaks use solution, solved problems, timing, then team code", () => {
  const a = { totalScore: 100, solutionScore: 80, solvedProblems: 2, timingScore: 10, teamCode: "A" };
  const b = { totalScore: 100, solutionScore: 80, solvedProblems: 1, timingScore: 20, teamCode: "B" };
  assert.ok(compareStandings(a, b) < 0);
  assert.ok(compareStandings({ ...a, solutionScore: 81 }, a) < 0);
  assert.ok(compareStandings({ ...a, timingScore: 11 }, a) < 0);
});
