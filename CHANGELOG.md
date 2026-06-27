# Changelog

## 0.4.0 — unreleased

Phase 4: global cross-project memory + a benchmark vs standard autoresearch.

- **Global shared memory**: a cross-project VKF bundle (default
  `~/.config/pi-autoresearch-vkf`, override `$PI_AUTORESEARCH_GLOBAL_ROOT`),
  reusing the same card helpers via a `globalRoot()` resolver.
- **`promote_to_global` tool**: copies a trusted card (source_verified+) into
  global memory with a transaction; only durable, verified knowledge is shareable.
- **`recall_memory` `scope`** param (`project` / `global` / `both`) surfaces
  knowledge learned in other repos.
- **Benchmark harness** (`benchmark/`): standard blind autoresearch vs ours over
  deterministic, ground-truth idea-environments. Ours is driven through the *real*
  `scoring.ts` (rankIdeas) and `synthesis.ts` (findContradictions), so it
  benchmarks shipped code. Metrics: best improvement, unique mechanisms, wasted
  experiments, dead-ends retried, synthesized ideas, found-optimum rate. `npm run
  bench`; `--update-readme` writes results between `<!-- BENCH:START/END -->`.
- Across scenarios, ours reaches the (synthesis-only) optimum 100% vs 0%, with
  ~3× the best improvement, zero repeats, and fewer dead-end retries.

Knowledge ingestion:
- `knowledge-gather` now states an explicit backend order: prefer Paper Lantern
  MCP tools when connected, else fall back to the always-available `WebSearch` /
  `WebFetch`. Paper Lantern is an optional upgrade, not a requirement.
- README documents both as requirements and how to connect Paper Lantern's MCP
  server to pi (no extension config needed — its tools surface to the agent).

## 0.3.0 — unreleased

Phase 3: hypothesis synthesis — generate novel ideas, don't just retrieve them.

- **`synthesis.ts`** (pure, unit-tested): mechanism/context/topic similarity;
  contradiction mining (explicit conflicts, outcome flips, same-goal/different-
  mechanism); cross-domain transfer scored by `mechanism_sim × (1 − context_sim)`.
- **`find_contradictions` tool** — surfaces tensions in memory as generative
  hypothesis questions.
- **`find_transfers` tool** — mechanism (not keyword) search for cross-domain
  analogies to import into the current problem.
- **Idea provenance** — `remember_claim`/`buildClaimCard` accept `origin`
  (literature / contradiction / transfer / synthesis) and `derived_from`, so
  agent-synthesized hypotheses are traceable to their seeds.
- **New skills**: `contradiction-miner`, `cross-domain-transfer`,
  `idea-tournament`; orchestrator updated with a synthesis step.

## 0.2.0 — unreleased

Phase 2: novelty & priority scoring.

- **`score_ideas` tool** ranks untested claims by
  `priority = expected_value × feasibility × evidence_strength × novelty ×
  info_gain ÷ implementation_cost`, returning the full factor breakdown.
- **`scoring.ts`** (pure, unit-tested): token Jaccard novelty that penalizes
  similarity to already-tried experiments, settled claims, and a configurable
  standard playbook; evidence strength derived from verification level +
  reliability; info-gain from belief uncertainty.
- **Scoring inputs on claims**: `remember_claim` accepts optional
  `expected_value`, `feasibility`, `info_gain`, `implementation_cost`; all factors
  fall back to sensible derivations when omitted.
- `hypothesis-loop` now scores instead of guessing the next experiment.

## 0.1.0 — unreleased

Initial MVP: autoresearch with verifiable long-term memory.

- **Two-layer persistence**: ephemeral `.auto/` session + durable
  `.research-memory/` VKF bundle that persists across runs.
- **Seven tools**: `init_research`, `remember_claim`, `verify_claim`,
  `recall_memory`, `run_experiment`, `log_experiment`, `research_status`.
- **Six skills**: `autoresearch-create` (spine), `knowledge-gather`,
  `claim-extract`, `claim-verify`, `hypothesis-loop`, `research-report`.
- **VKF bridge**: shells out to the `vkf` CLI (auto-detected in a `VKF` conda env
  or via `$PI_AUTORESEARCH_VKF`) for validation, graph, freshness, and permission
  checks; reads/writes bundle markdown directly. Degrades gracefully when `vkf`
  is absent.
- **Trust lifecycle**: memory states (candidate → source_verified →
  locally_tested/replicated → contradicted → deprecated → retired) mapped onto
  VKF `status` + a staging/verified/deprecated directory layout, with a
  transaction record for every change (propose-don't-promote).
- **Belief updates**: numeric belief per claim, mirrored to VKF's categorical
  `confidence`, updated on each experiment outcome.
- Generated bundles validate at VKF Profile 1 (governed).
