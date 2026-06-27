import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMetrics, readMetric } from "../extensions/pi-autoresearch-vkf/metrics.ts";

test("parses METRIC lines amid other output", () => {
  const out = `building...\nMETRIC wall_clock_s=12.34\nrandom noise\nMETRIC bundle_kb=210\n`;
  assert.deepEqual(parseMetrics(out), { wall_clock_s: 12.34, bundle_kb: 210 });
});

test("last value wins on duplicates", () => {
  assert.deepEqual(parseMetrics("METRIC x=1\nMETRIC x=2"), { x: 2 });
});

test("handles scientific notation and negatives", () => {
  assert.deepEqual(parseMetrics("METRIC loss=-1.5e-3"), { loss: -0.0015 });
});

test("readMetric picks a named metric", () => {
  assert.equal(readMetric("METRIC acc=0.91", "acc"), 0.91);
  assert.equal(readMetric("METRIC acc=0.91", "missing"), undefined);
});

test("ignores non-metric lines", () => {
  assert.deepEqual(parseMetrics("metric x = 5\nMETRICS y=6\n"), {});
});
