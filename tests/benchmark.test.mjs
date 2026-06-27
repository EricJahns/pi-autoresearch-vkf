import assert from "node:assert/strict";
import { test } from "node:test";

import { runBaseline, runOurs, runScenario } from "../benchmark/harness.ts";
import { SCENARIOS } from "../benchmark/scenarios.ts";

const scenario = SCENARIOS[0];

test("runs are deterministic for a fixed seed", () => {
  assert.deepEqual(runOurs(scenario, 7), runOurs(scenario, 7));
  assert.deepEqual(runBaseline(scenario, 7), runBaseline(scenario, 7));
});

test("ours never repeats experiments; baseline can", () => {
  const ours = runOurs(scenario, 3);
  assert.equal(ours.wastedExperiments, 0);
});

test("only ours discovers synthesized combos", () => {
  // Across several seeds, ours discovers the combo and baseline never does.
  let oursCombos = 0;
  let baseCombos = 0;
  for (let s = 0; s < 20; s++) {
    oursCombos += runOurs(scenario, s).combosDiscovered;
    baseCombos += runBaseline(scenario, s).combosDiscovered;
  }
  assert.ok(oursCombos > 0);
  assert.equal(baseCombos, 0);
});

test("ours reaches a better mean improvement than baseline", () => {
  const report = runScenario(scenario, 50);
  assert.ok(report.ours.bestImprovement > report.baseline.bestImprovement);
  assert.ok(report.ours.foundOptimumRate >= report.baseline.foundOptimumRate);
});

test("every scenario's combo parents are real ideas (sanity)", () => {
  for (const s of SCENARIOS) {
    const ids = new Set(s.ideas.map((i) => i.id));
    for (const combo of s.combos) {
      for (const p of combo.parents) assert.ok(ids.has(p), `combo parent ${p} missing in ${s.name}`);
    }
  }
});
