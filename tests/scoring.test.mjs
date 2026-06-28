import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifySlot,
  EVIDENCE_STRENGTH,
  jaccard,
  maxSimilarity,
  rankIdeas,
  scoreIdea,
  selectBalanced,
  tokenize,
} from "../extensions/pi-autoresearch-vkf/scoring.ts";

test("tokenize drops stopwords and short tokens", () => {
  const t = tokenize("The adaptive Gradient clipping improves stability");
  assert.ok(t.has("adaptive"));
  assert.ok(t.has("gradient"));
  assert.ok(t.has("clipping"));
  assert.ok(t.has("stability"));
  assert.ok(!t.has("the"));
  assert.ok(!t.has("improves")); // stopword
});

test("jaccard similarity", () => {
  assert.equal(jaccard(new Set(), new Set(["a"])), 0);
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["a", "b"])), 1);
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["b", "c"])), 1 / 3);
});

test("maxSimilarity finds the closest corpus entry", () => {
  const sim = maxSimilarity("adaptive gradient clipping for transformers", [
    "completely unrelated topic about gardening",
    "gradient clipping adaptive method",
  ]);
  assert.ok(sim > 0.3);
});

test("evidence strength rises with verification level", () => {
  assert.ok(
    EVIDENCE_STRENGTH.verified_by_local_experiment >
      EVIDENCE_STRENGTH.reported_by_paper,
  );
  assert.ok(
    EVIDENCE_STRENGTH.contradicted_by_local_experiment <
      EVIDENCE_STRENGTH.reported_by_paper,
  );
});

test("novelty drops when an idea matches explored ground", () => {
  const base = { id: "claim:x", title: "x", text: "adaptive gradient clipping stabilizes training", belief: 0.5 };
  const fresh = scoreIdea(base, { explored: ["totally different idea about caching layers"] });
  const stale = scoreIdea(base, { explored: ["adaptive gradient clipping stabilizes training"] });
  assert.ok(fresh.factors.novelty > stale.factors.novelty);
  assert.ok(stale.max_similarity > 0.8);
});

test("playbook ideas are penalized on novelty by default", () => {
  const playbookIdea = scoreIdea({ id: "claim:p", title: "p", text: "dropout regularization tuning", belief: 0.6 });
  const novelIdea = scoreIdea({ id: "claim:n", title: "n", text: "spike-rate ema surrogate slope controller", belief: 0.6 });
  assert.ok(novelIdea.factors.novelty > playbookIdea.factors.novelty);
});

test('"just train longer" is treated as a playbook move', () => {
  const epochs = scoreIdea({ id: "claim:e", title: "e", text: "increase epochs and train longer", belief: 0.6 });
  const mechanism = scoreIdea({ id: "claim:m", title: "m", text: "spike-rate ema surrogate slope controller", belief: 0.6 });
  assert.ok(mechanism.factors.novelty > epochs.factors.novelty, "epochs idea should score lower novelty");
  assert.ok(epochs.max_similarity > 0.5, "epochs idea should match the playbook");
});

test("info_gain peaks at uncertain belief", () => {
  const uncertain = scoreIdea({ id: "a", title: "a", text: "novel quux frobnicator", belief: 0.5 });
  const certain = scoreIdea({ id: "b", title: "b", text: "novel quux frobnicator", belief: 0.95 });
  assert.ok(uncertain.factors.info_gain > certain.factors.info_gain);
});

test("higher cost lowers priority, all else equal", () => {
  const cheap = scoreIdea({ id: "a", title: "a", text: "novel mechanism alpha", belief: 0.6, implementation_cost: 0.1 });
  const pricey = scoreIdea({ id: "b", title: "b", text: "novel mechanism alpha", belief: 0.6, implementation_cost: 0.9 });
  assert.ok(cheap.priority > pricey.priority);
});

test("rankIdeas sorts by priority descending and applies overrides", () => {
  const ideas = [
    { id: "claim:weak", title: "weak", text: "dropout tuning", belief: 0.3, implementation_cost: 0.8 },
    { id: "claim:strong", title: "strong", text: "novel cross-domain voltage controller", belief: 0.6, expected_value: 0.9, feasibility: 0.9, implementation_cost: 0.2 },
  ];
  const ranked = rankIdeas(ideas);
  assert.equal(ranked[0].id, "claim:strong");
  assert.ok(ranked[0].priority > ranked[1].priority);
});

// ── structural novelty + altitude affinity + explore/exploit (steps 3-4) ──────

test("structural novelty collapses for a saturated bucket, high for an empty one", () => {
  const opts = {
    exploredTotal: 10,
    bucketCounts: { "algorithm|hyperparameter": 9 },
  };
  const saturated = scoreIdea(
    { id: "a", title: "a", text: "fresh wording xyzzy", belief: 0.6, lever: "algorithm", altitude: "hyperparameter" },
    opts,
  );
  const empty = scoreIdea(
    { id: "b", title: "b", text: "fresh wording xyzzy", belief: 0.6, lever: "data", altitude: "mechanism" },
    opts,
  );
  assert.ok(saturated.factors.structural_novelty < 0.2, "saturated bucket → low structural novelty");
  assert.equal(empty.factors.structural_novelty, 1, "untouched bucket → full structural novelty");
  // Lexically identical text, yet the saturated one ends up less novel overall.
  assert.ok(empty.factors.novelty > saturated.factors.novelty);
  assert.equal(saturated.bucket, "algorithm|hyperparameter");
});

test("altitudePreference 'tuning' restores hyperparameter parity", () => {
  const tweak = { id: "a", title: "a", text: "same words here", belief: 0.6, altitude: "hyperparameter" };
  const high = scoreIdea(tweak, { altitudePreference: "high" });
  const tuning = scoreIdea(tweak, { altitudePreference: "tuning" });
  assert.ok(tuning.factors.altitude_affinity > high.factors.altitude_affinity);
  assert.equal(tuning.factors.altitude_affinity, 1);
  assert.ok(tuning.priority > high.priority);
});

test("selectBalanced reserves explore slots and diversifies buckets", () => {
  // belief 0.85 ⇒ low info-gain, so the saturated tweaks classify as exploit.
  const mk = (id, lever, altitude, belief = 0.85) => ({
    id, title: id, text: `${id} text`, belief, lever, altitude,
  });
  const ideas = [
    mk("t1", "algorithm", "hyperparameter"),
    mk("t2", "algorithm", "hyperparameter"),
    mk("t3", "algorithm", "hyperparameter"),
    mk("m1", "data", "mechanism"),
    mk("r1", "objective", "reframe"),
  ];
  // The algorithm·hyperparameter bucket is already saturated from prior runs.
  const opts = { exploredTotal: 10, bucketCounts: { "algorithm|hyperparameter": 10 } };
  const ranked = rankIdeas(ideas, opts);
  const scored = ranked.map((r) => ({ r, idea: ideas.find((i) => i.id === r.id) }));

  const balanced = selectBalanced(scored, { exploreFraction: 0.5, k: 4 });
  const explore = balanced.filter((p) => p.slot === "explore");
  assert.ok(explore.length >= 2, "reserves explore slots for the high-altitude bets");
  assert.ok(balanced.some((p) => p.r.id === "m1" || p.r.id === "r1"));

  // exploreFraction 0 ⇒ no reserved explore slots (pure exploit when available).
  const tuningPicks = selectBalanced(scored, { exploreFraction: 0, k: 3 });
  assert.equal(tuningPicks.filter((p) => p.slot === "explore").length, 0);
});

test("classifySlot marks high-altitude as explore, saturated low-info tweaks as exploit", () => {
  // Saturated bucket + confident belief ⇒ low structural novelty and low info-gain.
  const opts = { exploredTotal: 10, bucketCounts: { "algorithm|hyperparameter": 10 } };
  const reframeIdea = { id: "a", title: "a", text: "x", belief: 0.6, lever: "objective", altitude: "reframe" };
  const tweakIdea = { id: "b", title: "b", text: "x", belief: 0.9, lever: "algorithm", altitude: "hyperparameter" };
  assert.equal(classifySlot(scoreIdea(reframeIdea, opts), reframeIdea), "explore");
  assert.equal(classifySlot(scoreIdea(tweakIdea, opts), tweakIdea), "exploit");
});
