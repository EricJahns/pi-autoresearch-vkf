---
name: autoresearch-vkf
description: Run an autoresearch loop with verifiable long-term memory. Use when asked to optimize/improve a measurable target (test speed, bundle size, model loss, build time, Lighthouse score, …) by drawing on the research literature and remembering what was learned across runs. Orchestrates init → gather literature → extract & verify claims → recall → experiment → write results back to VKF memory → report.
---

# Autoresearch with verifiable memory

Your job: improve a measurable target, but unlike a blind optimization loop, you
**ground ideas in the literature and accumulate verifiable memory** so each run
starts smarter than the last. You do not just mutate code and keep what wins —
you build a living, auditable research memory and choose experiments from it.

You are the spine. Delegate the specialized work to the sub-skills below.

## Tools (provided by the pi-autoresearch-vkf extension)

- `init_research` — scaffold the `.autoresearch-vkf/` workspace (session + memory VKF bundle) (once).
- `remember_claim` — stage a literature-derived candidate claim (+ its source paper).
- `verify_claim` — advance/downgrade a card's trust lifecycle (audited).
- `recall_memory` — query memory for trusted claims, candidates, prior experiments, negatives, conflicts.
- `score_ideas` — rank untested ideas by priority (EV × feasibility × evidence × novelty × info_gain ÷ cost).
- `find_contradictions` — mine memory for tensions that seed novel hypotheses.
- `find_transfers` — cross-domain mechanism search for surprising analogies.
- `vkf_run_experiment` — run the measurement command, capture `METRIC name=value`.
- `vkf_log_experiment` — record a result and write it back to memory (updates belief & lifecycle).
- `research_status` — show session + memory state.

## The two layers

| Layer | Where | Lifetime |
|-------|-------|----------|
| Session | `.autoresearch-vkf/session/` | this run — goal, experiment log, measure script |
| Memory | `.autoresearch-vkf/memory/` | **persists across runs** — a VKF bundle of papers, claims, experiments |

Memory has a trust lifecycle. Cards move `candidate → source_verified →
locally_tested/replicated`, or `contradicted → deprecated → retired`. Only
`source_verified`+ should drive serious hypotheses; only `locally_tested`+ should
strongly steer experiments. Everything you write is a *proposal* with a
transaction record — promotion is an explicit, audited step.

## Workflow

1. **Confirm inputs.** Ask for and confirm:
   - the **goal** (what to improve) and the **metric** + which **direction** is better;
   - the **command** that prints `METRIC <name>=<number>` (edit `.autoresearch-vkf/session/measure.sh`);
   - the **files in scope** and any compute/time budget.

2. **Init.** Call `init_research` with those. This also creates the memory bundle.

3. **Recall first.** Call `recall_memory` (with a query about the goal) *before*
   gathering anything. If prior runs already learned something, build on it and
   skip rediscovery.

4. **Gather literature** → use the **knowledge-gather** skill to find candidate
   techniques (via `WebSearch`/`WebFetch` against free databases — arXiv, Semantic
   Scholar, OpenAlex), then **claim-extract** to turn them into structured claims
   via `remember_claim`. Then **claim-verify** to check citations and codebase fit.

4b. **Synthesize new ideas** (optional but high-value) → mine memory for novelty
   instead of only retrieving it: **contradiction-miner** (tensions →
   hypotheses), **cross-domain-transfer** (import a mechanism from another field).
   When many ideas compete for budget, run the **idea-tournament** skill to pick
   the 2–3 worth testing.

5. **Loop** → use the **hypothesis-loop** skill: `recall_memory` → pick the
   highest-value, sufficiently-novel idea → implement the smallest falsifying
   change → `vkf_run_experiment` → `vkf_log_experiment` → repeat. Keep wins, revert
   regressions; either way the result is now in memory.

6. **Report** → use the **research-report** skill to produce the lineage report
   (paper → claim → hypothesis → patch → metric Δ → status → memory update).

Keep `.autoresearch-vkf/session/prompt.md` current so a fresh agent can continue. The loop is
resumable: on restart, read `.autoresearch-vkf/session/` and `recall_memory`, then continue.
