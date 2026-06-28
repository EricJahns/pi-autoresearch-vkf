# Changelog

## 0.6.0

Add keyless web access so the gather step works on stock pi.

- New tools **`WebSearch`** (DuckDuckGo HTML, no API key) and **`WebFetch`**
  (JSON/text verbatim, HTML reduced to readable text). The pi host ships no web
  tools, but `autoresearch-vkf-knowledge-gather` assumed they existed — the agent
  reported it had no web search. These supply the named tools the skill already
  references, against the free literature APIs (arXiv, OpenAlex, Crossref,
  Semantic Scholar). No session required; no setup or keys.
- Tool names match Claude-Code casing so `pi-ai`'s tool-name table keeps prompt
  caching aligned. `WebSearch` degrades gracefully to a WebFetch-an-API hint when
  the search backend rate-limits or changes layout.

Make the browser progress dashboard automatic and live.

- `progress.html` is now written on `init_research` (so it exists from iteration
  zero) and refreshed after every `remember_claim`, `verify_claim`, and
  `vkf_log_experiment`. Previously it was only written when the agent explicitly
  called `export_dashboard`, which most runs never did — so the dashboard was
  effectively never created and never updated during a run.
- The page already meta-refreshes itself, so an open browser tab now tracks the
  loop live with no manual step. `export_dashboard` is now for the heavier
  vkf-CLI idea-lineage graph (`dashboard.html`), a custom refresh interval, or
  opening the page in a browser.

## 0.5.2

Prefixed all skill names with `autoresearch-vkf-` to avoid namespace conflicts
with other tooling. Renamed `knowledge-gather`, `claim-extract`, `claim-verify`,
`contradiction-miner`, `cross-domain-transfer`, `idea-tournament`,
`hypothesis-loop`, and `research-report`; all cross-references in the skills,
the README, and the extension were updated accordingly. No behavior change.


## 0.5.1

Fix tool/skill name collisions with pi-autoresearch (both can now load together).

- Tools `run_experiment` → **`vkf_run_experiment`** and `log_experiment` →
  **`vkf_log_experiment`** (pi-autoresearch registers the bare names; pi requires
  globally-unique tool names across loaded extensions).
- Skill `autoresearch-create` → **`autoresearch-vkf`** (pi-autoresearch ships a
  skill of the same name). Invoke the loop via the `autoresearch-vkf` skill now.
- Docs/skills/benchmark updated accordingly. No behavior change.

## 0.5.0 — first published release

Self-contained workspace (breaking path change).

- All package state now lives under a single namespaced directory,
  `.autoresearch-vkf/`, with `session/` (ephemeral run state, was `.auto/`) and
  `memory/` (the VKF bundle, was `.research-memory/`). This stops the session dir
  from colliding with pi-autoresearch's `.auto/` and makes the package's
  footprint obvious and self-contained.
- Global memory moves to `~/.autoresearch-vkf/memory/`;
  `PI_AUTORESEARCH_GLOBAL_ROOT` now names the *root* (default `~`).
- Internal: hardcoded `${root}/.research-memory` paths replaced with
  `memoryPaths(root)`; `paths.ts` exposes `pkgDir` and the session/memory
  subdir layout. Existing bundles can be migrated by moving `.auto` →
  `.autoresearch-vkf/session` and `.research-memory` → `.autoresearch-vkf/memory`.

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

Dashboards:
- New `export_dashboard` tool writes two self-contained browser pages to `.auto/`:
  `progress.html` (inline-SVG metric-over-time chart, experiment timeline, memory
  lifecycle; auto-refreshing) and `dashboard.html` (the interactive idea-lineage
  graph via `vkf html`).
- `progress_html.ts` is a pure, unit-tested renderer (no JS/asset deps); `vkf.ts`
  gains an `html()` bridge wrapper.

Knowledge ingestion:
- `knowledge-gather` uses the agent's built-in `WebSearch` / `WebFetch` against
  free, openly accessible databases — arXiv, Semantic Scholar, OpenAlex, Crossref
  — with no API keys, paid services, or MCP setup.
- README documents ingestion and the free sources used.

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
