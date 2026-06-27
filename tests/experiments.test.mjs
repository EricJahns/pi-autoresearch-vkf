import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveOutcome,
  summarize,
} from "../extensions/pi-autoresearch-vkf/experiments.ts";

test("deriveOutcome: higher-is-better", () => {
  assert.equal(deriveOutcome(100, 110, "higher"), "win");
  assert.equal(deriveOutcome(100, 90, "higher"), "loss");
  assert.equal(deriveOutcome(100, 100, "higher"), "inconclusive");
});

test("deriveOutcome: lower-is-better", () => {
  assert.equal(deriveOutcome(10, 8, "lower"), "win");
  assert.equal(deriveOutcome(10, 12, "lower"), "loss");
});

test("deriveOutcome: no baseline is inconclusive", () => {
  assert.equal(deriveOutcome(undefined, 5, "higher"), "inconclusive");
});

test("deriveOutcome: respects noise threshold", () => {
  // 1% change with a 5% threshold → inconclusive
  assert.equal(deriveOutcome(100, 101, "higher", 0.05), "inconclusive");
  assert.equal(deriveOutcome(100, 110, "higher", 0.05), "win");
});

test("summarize counts outcomes and tracks best", () => {
  const exps = [
    { id: "a", description: "", outcome: "win", value: 5, ts: "" },
    { id: "b", description: "", outcome: "loss", value: 3, ts: "" },
    { id: "c", description: "", outcome: "win", value: 9, ts: "" },
  ];
  const s = summarize(exps, "higher");
  assert.equal(s.win, 2);
  assert.equal(s.loss, 1);
  assert.equal(s.best, 9);
  assert.equal(summarize(exps, "lower").best, 3);
});
