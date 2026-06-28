import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveResearchMode,
  makeConfig,
  researchMode,
} from "../extensions/pi-autoresearch-vkf/config.ts";

test("deriveResearchMode turns exploration off for explicit tuning goals", () => {
  for (const goal of [
    "Tune the batch size for lower loss",
    "hyperparameter sweep over learning rate",
    "grid search the augmentation strength",
  ]) {
    const m = deriveResearchMode(goal);
    assert.equal(m.exploreFraction, 0, goal);
    assert.equal(m.altitudePreference, "tuning", goal);
  }
});

test("deriveResearchMode reserves exploration for open-ended goals", () => {
  const m = deriveResearchMode("Improve CIFAR-100 accuracy under the same budget");
  assert.equal(m.exploreFraction, 0.3);
  assert.equal(m.altitudePreference, "high");
});

test("makeConfig derives the mode from the goal", () => {
  const tuning = makeConfig({ name: "n", goal: "tune dropout", command: "c", metricName: "m" });
  assert.equal(tuning.exploreFraction, 0);
  assert.equal(tuning.altitudePreference, "tuning");

  const open = makeConfig({ name: "n", goal: "make it faster somehow", command: "c", metricName: "m" });
  assert.equal(open.altitudePreference, "high");
});

test("researchMode backfills legacy configs missing the fields", () => {
  // Simulate a pre-0.8.5 config object.
  const legacy = { name: "n", goal: "tune the optimizer", command: "c", metricName: "m", direction: "higher", memoryProfile: 1, owner: "o", createdAt: "" };
  const m = researchMode(legacy);
  assert.equal(m.exploreFraction, 0);
  assert.equal(m.altitudePreference, "tuning");
});
