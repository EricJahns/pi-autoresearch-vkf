import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDashboardData } from "../extensions/pi-autoresearch-vkf/progress_data.ts";

const baseInput = (over = {}) => ({
  name: "n",
  goal: "g",
  metricName: "acc",
  direction: "higher",
  baseline: 0.5,
  experiments: [],
  memory: { candidate: 1 },
  claims: [],
  generatedAt: "2026-06-27T00:00:00Z",
  version: "0.9.0",
  ...over,
});

test("best value respects direction", () => {
  const exps = [
    { id: "exp-001", description: "a", value: 0.6, outcome: "win", ts: "" },
    { id: "exp-002", description: "b", value: 0.4, outcome: "loss", ts: "" },
  ];
  assert.equal(buildDashboardData(baseInput({ experiments: exps })).best, 0.6);
  assert.equal(buildDashboardData(baseInput({ experiments: exps, direction: "lower" })).best, 0.4);
});

test("collects every metric series, primary first", () => {
  const exps = [
    { id: "exp-001", description: "a", value: 0.6, outcome: "win", metrics: { acc: 0.6, loss: 1.2 }, ts: "" },
    { id: "exp-002", description: "b", value: 0.7, outcome: "win", metrics: { acc: 0.7, f1: 0.5 }, ts: "" },
  ];
  const d = buildDashboardData(baseInput({ experiments: exps }));
  assert.equal(d.metricNames[0], "acc");
  assert.deepEqual(new Set(d.metricNames), new Set(["acc", "loss", "f1"]));
});

test("builds the lever x altitude coverage grid", () => {
  const exps = [
    { id: "exp-001", description: "a", value: 1, outcome: "win", lever: "algorithm", altitude: "mechanism", ts: "" },
    { id: "exp-002", description: "b", value: 1, outcome: "win", lever: "algorithm", altitude: "mechanism", ts: "" },
    { id: "exp-003", description: "c", value: 1, outcome: "win", lever: "data", altitude: "hyperparameter", ts: "" },
  ];
  const d = buildDashboardData(baseInput({ experiments: exps }));
  assert.equal(d.coverage.counts["algorithm|mechanism"], 2);
  assert.equal(d.coverage.counts["data|hyperparameter"], 1);
  assert.ok(d.coverage.levers.includes("algorithm"));
  assert.ok(d.coverage.altitudes.includes("mechanism"));
});

test("builds the paper -> claim -> experiment lineage graph", () => {
  const d = buildDashboardData(
    baseInput({
      experiments: [
        { id: "exp-001", description: "try agc", value: 0.9, outcome: "win", claim_id: "claim:agc", ts: "" },
        { id: "exp-002", description: "agc combo", value: 0.85, outcome: "win", claim_id: "claim:agc", parent_id: "exp-001", ts: "" },
      ],
      papers: [{ id: "paper:adagc", title: "AdaGC" }],
      lineageClaims: [{ id: "claim:agc", title: "AGC helps", belief: 0.8, state: "replicated", paper_ids: ["paper:adagc"] }],
    }),
  );
  const types = d.lineage.nodes.reduce((m, n) => ((m[n.type] = (m[n.type] || 0) + 1), m), {});
  assert.deepEqual(types, { paper: 1, claim: 1, experiment: 2 });
  const kinds = new Set(d.lineage.edges.map((e) => `${e.source}->${e.target}:${e.kind}`));
  assert.ok(kinds.has("claim:agc->paper:adagc:evidenced"));
  assert.ok(kinds.has("exp-001->claim:agc:tested"));
  assert.ok(kinds.has("exp-002->exp-001:parent"));
});

test("lineage adds a stub claim node when an experiment references a missing claim", () => {
  const d = buildDashboardData(
    baseInput({
      experiments: [{ id: "exp-001", description: "x", value: 1, outcome: "win", claim_id: "claim:ghost", ts: "" }],
    }),
  );
  const ghost = d.lineage.nodes.find((n) => n.id === "claim:ghost");
  assert.ok(ghost && ghost.type === "claim");
  assert.ok(d.lineage.edges.some((e) => e.source === "exp-001" && e.target === "claim:ghost" && e.kind === "tested"));
});

test("carries tree depth onto experiments", () => {
  const exps = [
    { id: "exp-001", description: "a", value: 1, outcome: "win", ts: "" },
    { id: "exp-002", description: "b", value: 1, outcome: "win", parent_id: "exp-001", ts: "" },
  ];
  const d = buildDashboardData(baseInput({ experiments: exps }));
  const byId = Object.fromEntries(d.experiments.map((e) => [e.id, e]));
  assert.equal(byId["exp-001"].depth, 0);
  assert.equal(byId["exp-002"].depth, 1);
});
