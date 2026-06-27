import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVIDENCE_STRENGTH,
  jaccard,
  maxSimilarity,
  rankIdeas,
  scoreIdea,
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
