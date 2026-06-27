import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contextSimilarity,
  findContradictions,
  findTransfers,
  mechanismSimilarity,
} from "../extensions/pi-autoresearch-vkf/synthesis.ts";

test("explicit conflicts_with produces a tension", () => {
  const cards = [
    { id: "claim:a", title: "A", text: "normalization is critical", conflicts_with: ["claim:b"] },
    { id: "claim:b", title: "B", text: "normalization can be removed", conflicts_with: [] },
  ];
  const t = findContradictions(cards);
  assert.equal(t.length, 1);
  assert.equal(t[0].kind, "explicit");
  assert.equal(t[0].strength, 1);
});

test("outcome flip: similar topic, one worked, one contradicted", () => {
  const cards = [
    { id: "claim:win", title: "adaptive clipping helps", text: "adaptive gradient clipping stabilizes transformer training", memory_state: "locally_tested" },
    { id: "claim:lose", title: "adaptive clipping", text: "adaptive gradient clipping stabilizes transformer training", memory_state: "contradicted" },
  ];
  const t = findContradictions(cards);
  assert.ok(t.some((x) => x.kind === "outcome_flip"));
  const flip = t.find((x) => x.kind === "outcome_flip");
  assert.equal(flip.a, "claim:win"); // winner first
  assert.equal(flip.b, "claim:lose");
});

test("same goal, different mechanism", () => {
  const cards = [
    { id: "claim:clip", title: "clip", text: "stabilize training", context: "transformer pretraining stability", mechanism: "gradient norm thresholding", memory_state: "candidate" },
    { id: "claim:sched", title: "sched", text: "stabilize training", context: "transformer pretraining stability", mechanism: "learning rate warmup decay", memory_state: "candidate" },
  ];
  const t = findContradictions(cards);
  assert.ok(t.some((x) => x.kind === "same_goal_diff_mechanism"));
});

test("contradicted claims are excluded from same-goal pairing", () => {
  const cards = [
    { id: "claim:x", title: "x", text: "g", context: "shared goal context here", mechanism: "mech one alpha", memory_state: "contradicted" },
    { id: "claim:y", title: "y", text: "g", context: "shared goal context here", mechanism: "mech two beta", memory_state: "candidate" },
  ];
  const t = findContradictions(cards);
  assert.ok(!t.some((x) => x.kind === "same_goal_diff_mechanism"));
});

test("findTransfers favors high mechanism sim, low context sim", () => {
  const target = {
    id: "__t__", title: "t",
    mechanism: "dynamic scale control regulates instability",
    context: "spiking neural networks",
    text: "",
  };
  const cards = [
    { id: "claim:llm", title: "AdaGC", mechanism: "dynamic scale control regulates instability", context: "large language model pretraining", text: "" },
    { id: "claim:same", title: "same domain", mechanism: "unrelated routing trick", context: "spiking neural networks", text: "" },
  ];
  const transfers = findTransfers(target, cards);
  assert.ok(transfers.length >= 1);
  assert.equal(transfers[0].from, "claim:llm"); // cross-domain, same mechanism
});

test("similarity helpers behave", () => {
  const a = { id: "a", title: "", mechanism: "dynamic scale control", context: "llm", text: "" };
  const b = { id: "b", title: "", mechanism: "dynamic scale control", context: "snn", text: "" };
  assert.ok(mechanismSimilarity(a, b) > 0.9);
  assert.equal(contextSimilarity(a, b), 0); // different single-token domains
});
