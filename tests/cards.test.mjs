import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  STATE_MAP,
  beliefFromEvidence,
  buildClaimCard,
  buildExperimentCard,
  buildPaperCard,
  confidenceLabel,
  findCard,
  isTrustedForHypotheses,
  listCards,
  scaffoldMemoryBundle,
  slugify,
  transitionCard,
  updateBelief,
  writeCard,
  writeTransaction,
} from "../extensions/pi-autoresearch-vkf/cards.ts";
import { parseFrontmatter } from "../extensions/pi-autoresearch-vkf/frontmatter.ts";

test("STATE_MAP covers every memory state with valid VKF status", () => {
  const valid = new Set(["draft", "active", "verified", "disputed", "deprecated", "retracted"]);
  for (const [, v] of Object.entries(STATE_MAP)) {
    assert.ok(valid.has(v.status), `unexpected status ${v.status}`);
    assert.ok(["staging", "verified", "deprecated"].includes(v.bucket));
  }
});

test("confidenceLabel maps numeric belief to VKF enum", () => {
  assert.equal(confidenceLabel(0.1), "low");
  assert.equal(confidenceLabel(0.5), "medium");
  assert.equal(confidenceLabel(0.9), "high");
});

test("updateBelief moves and clamps", () => {
  assert.ok(updateBelief(0.5, "win") > 0.5);
  assert.ok(updateBelief(0.5, "loss") < 0.5);
  assert.ok(updateBelief(0.95, "win") <= 0.98);
  assert.ok(updateBelief(0.05, "loss") >= 0.02);
});

test("beliefFromEvidence is a clamped Beta posterior mean", () => {
  assert.equal(beliefFromEvidence(0, 0), 0.5); // no evidence → prior
  assert.equal(beliefFromEvidence(0, 0, 0.3), 0.3); // honors prior when no evidence
  assert.equal(beliefFromEvidence(2, 1), (2 + 1) / (2 + 1 + 2)); // 0.6
  assert.ok(beliefFromEvidence(5, 0) > beliefFromEvidence(2, 0)); // more wins → higher
  assert.ok(beliefFromEvidence(0, 5) < 0.34); // losses pull it low
  assert.ok(beliefFromEvidence(100, 0) <= 0.98); // clamped
  assert.ok(beliefFromEvidence(0, 100) >= 0.02);
});

test("slugify produces VKF-id-safe slugs", () => {
  assert.match(`claim:${slugify("AdaGC: a New! Method")}`, /^[a-z][a-z0-9_]*:[a-z0-9][a-z0-9_\-]*$/);
});

test("built cards parse and carry research-layer fields", () => {
  const claim = buildClaimCard({
    title: "AdaGC stabilizes early training",
    assertion: "Adaptive clipping lowers early loss.",
    mechanism: "EMA threshold tracks gradient scale.",
    paper_id: "paper:adagc",
    confidence: 0.6,
    owner: "agent:autoresearch",
  });
  const { data, body } = parseFrontmatter(claim.content);
  assert.equal(data.type, "claim");
  assert.equal(data.status, "draft");
  assert.equal(data.memory_state, "candidate");
  assert.equal(data.belief, 0.6);
  assert.equal(data.confidence, "medium"); // categorical mirror, schema-valid
  assert.deepEqual(data.depends_on, ["paper:adagc"]);
  assert.match(body, /:::claim/);
  assert.match(body, /confidence: medium/);
});

test("lifecycle: write, transition across buckets, transaction", () => {
  const root = mkdtempSync(join(tmpdir(), "vkfmem-"));
  try {
    scaffoldMemoryBundle(root, "test", 1);

    const paper = buildPaperCard({
      title: "AdaGC paper",
      source_url: "https://arxiv.org/abs/2401.00001",
      summary: "Adaptive gradient clipping.",
      owner: "agent:autoresearch",
    });
    writeCard(root, "staging", paper.file, paper.content);

    const claim = buildClaimCard({
      title: "AdaGC helps",
      assertion: "It lowers early loss.",
      paper_id: paper.id,
      confidence: 0.5,
      owner: "agent:autoresearch",
    });
    writeCard(root, "staging", claim.file, claim.content);

    assert.equal(listCards(root, { bucket: "staging" }).length, 2);
    assert.ok(findCard(root, claim.id));

    // Promote claim → verified bucket.
    const moved = transitionCard(root, claim.id, "locally_tested", {
      verification: "verified_by_local_experiment",
      confidence: 0.65,
    });
    assert.equal(moved.bucket, "verified");
    assert.equal(moved.meta.status, "verified");
    assert.equal(moved.meta.memory_state, "locally_tested");
    assert.equal(moved.meta.belief, 0.65);
    assert.ok(isTrustedForHypotheses("locally_tested"));

    assert.equal(listCards(root, { bucket: "verified" }).length, 1);
    assert.equal(listCards(root, { bucket: "staging" }).length, 1); // paper remains

    const exp = buildExperimentCard({
      title: "try adagc",
      hypothesis: "lowers loss",
      claim_id: claim.id,
      metric_name: "loss",
      baseline: 1.0,
      value: 0.9,
      outcome: "win",
      owner: "agent:autoresearch",
    });
    writeCard(root, "verified", exp.file, exp.content);
    assert.equal(parseFrontmatter(exp.content).data.outcome, "win");

    const txPath = writeTransaction(root, {
      action: "promoted",
      target: claim.id,
      actor: "agent:autoresearch",
      reason: "local win",
      changedFields: ["memory_state: candidate → locally_tested"],
    });
    assert.match(txPath, /transactions\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("experiment cards carry a profile-2 reproduction block and tree edges", () => {
  const exp = buildExperimentCard({
    title: "try adagc",
    hypothesis: "lowers loss",
    claim_id: "claim:adagc",
    parent_id: "experiment:prev_xyz",
    node_kind: "improve",
    metric_name: "loss",
    baseline: 1.0,
    value: 0.9,
    outcome: "win",
    reproduction: { command: "bash .auto/measure.sh", metric_name: "loss", value: 0.9 },
    next_suggestions: ["sweep the EMA decay", "try on the larger model"],
    owner: "agent:autoresearch",
  });
  const { data, body } = parseFrontmatter(exp.content);
  // Tree + claim edges feed `vkf graph`.
  assert.deepEqual(data.depends_on, ["claim:adagc", "experiment:prev_xyz"]);
  assert.equal(data.parent, "experiment:prev_xyz");
  assert.equal(data.node_kind, "improve");
  // Profile-2 reproduction block (nested object).
  assert.equal(data.verification.method, "command");
  assert.equal(data.verification.command, "bash .auto/measure.sh");
  assert.equal(data.verification.expected.metric, "loss");
  assert.equal(data.verification.expected.value, 0.9);
  // Structured feedback lands in the body.
  assert.match(body, /## Next steps/);
  assert.match(body, /sweep the EMA decay/);
});
