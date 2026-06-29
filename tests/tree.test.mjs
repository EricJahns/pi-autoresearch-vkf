import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bestNode,
  buildTree,
  depths,
  frontier,
  resolveParents,
  selectExpansion,
} from "../extensions/pi-autoresearch-vkf/tree.ts";

const exp = (id, over = {}) => ({ id, description: id, outcome: "win", ts: "", ...over });

test("resolveParents honors explicit parent_id", () => {
  const exps = [exp("a"), exp("b", { parent_id: "a" }), exp("c", { parent_id: "a" })];
  const p = resolveParents(exps);
  assert.equal(p.get("a"), undefined);
  assert.equal(p.get("b"), "a");
  assert.equal(p.get("c"), "a");
});

test("resolveParents infers a linear chain for legacy rows (kept-aware)", () => {
  // No parent_id anywhere: each hangs off the most recent kept node, else previous.
  const exps = [
    exp("a", { kept: true }),
    exp("b", { kept: false }),
    exp("c", { kept: false }),
  ];
  const p = resolveParents(exps);
  assert.equal(p.get("a"), undefined); // root
  assert.equal(p.get("b"), "a"); // kept a
  assert.equal(p.get("c"), "a"); // still hangs off the last kept (a), not b
});

test("buildTree nests children and depths are assigned", () => {
  const exps = [exp("a"), exp("b", { parent_id: "a" }), exp("c", { parent_id: "b" })];
  const roots = buildTree(exps);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].experiment.id, "a");
  assert.equal(roots[0].children[0].experiment.id, "b");
  const d = depths(exps);
  assert.equal(d.get("a"), 0);
  assert.equal(d.get("b"), 1);
  assert.equal(d.get("c"), 2);
});

test("buildTree is cycle-safe (self / mutual parent_id ignored or contained)", () => {
  const exps = [exp("a", { parent_id: "a" }), exp("b", { parent_id: "a" })];
  // a's self-parent is ignored (treated as root); must not infinite-loop.
  const roots = buildTree(exps);
  assert.ok(roots.length >= 1);
});

test("bestNode respects direction", () => {
  const exps = [exp("a", { value: 10 }), exp("b", { value: 5 }), exp("c", { value: 8 })];
  assert.equal(bestNode(exps, "higher").id, "a");
  assert.equal(bestNode(exps, "lower").id, "b");
  assert.equal(bestNode([], "higher"), undefined);
});

test("frontier surfaces the best node and the leaves", () => {
  const exps = [exp("a", { value: 5 }), exp("b", { parent_id: "a", value: 9 })];
  const f = frontier(exps, "higher");
  assert.equal(f[0].id, "b"); // best first
  assert.ok(f.some((e) => e.id === "b"));
});

test("selectExpansion attaches picks to the best node (improve/branch), or drafts when empty", () => {
  const idea = (id, over = {}) => ({ id, title: id, text: id, belief: 0.5, ...over });
  const scored = [
    { r: { id: "i1", title: "i1", priority: 1, bucket: "algorithm|mechanism", max_similarity: 0, factors: {} }, idea: idea("i1", { altitude: "mechanism" }) },
    { r: { id: "i2", title: "i2", priority: 0.5, bucket: "data|hyperparameter", max_similarity: 0, factors: {} }, idea: idea("i2", { altitude: "hyperparameter" }) },
  ];

  // No experiments yet → everything drafts a root.
  const draftPicks = selectExpansion([], scored, { direction: "higher", exploreFraction: 0.5, k: 2 });
  assert.ok(draftPicks.every((p) => p.node_kind === "draft" && p.parent_id === undefined));

  // With a best node, picks expand it; explore→branch, exploit→improve.
  const exps = [exp("a", { value: 9 })];
  const picks = selectExpansion(exps, scored, { direction: "higher", exploreFraction: 0.5, k: 2 });
  assert.ok(picks.every((p) => p.parent_id === "a"));
  for (const p of picks) {
    assert.equal(p.node_kind, p.slot === "explore" ? "branch" : "improve");
  }
});
