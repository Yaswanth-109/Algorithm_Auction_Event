import assert from "node:assert/strict";
import test from "node:test";
import { outputMatches } from "./execution.js";

test("output comparison normalizes line endings and outer whitespace", () => {
  assert.equal(outputMatches(" 42\r\n", "42\n"), true);
  assert.equal(outputMatches("42 43", "42 44"), false);
});
