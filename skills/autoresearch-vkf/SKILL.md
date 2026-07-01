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

## Autonomy contract

Step 1 (confirm inputs) is the **only** point where you check in with the user.
Once inputs are confirmed and `init_research` has run with `autonomy:
"continuous"` (the default), the loop is **pre-authorized**: run iteration after
iteration without pausing to ask permission, offer options, or say "shall I
continue?". Ending your turn with a question or a plan instead of the next
experiment is a contract violation, not politeness. The user's brake is the
STOP file (`.autoresearch-vkf/session/STOP`) — its existence, not your asking,
is how they pause you; the tools check it and tell you when to halt.

The only valid reasons to stop mid-run:
- the iteration budget (`max_iterations`) is exhausted;
- the goal is met or all promising ideas are exhausted (→ report);
- the STOP file exists, or the user interrupts;
- you are blocked on something only the user can do (credentials, hardware,
  a destructive/out-of-scope action). State the blocker, then stop.

Progress reporting happens through the widget/dashboards and the final report —
not through mid-loop check-ins. If the user asked to be consulted each step,
init with `autonomy: "confirm-each"` instead.

## Focus: novel over knobs

Default the loop to **novel, mechanism-level changes relevant to the research
goal**. Hyperparameter-altitude ideas (LR, schedules, batch size, epochs, …)
are off the menu — scoring already penalizes them hard in the default mode —
unless the **user explicitly asks for tuning**, in which case init derives (or
you set via `set_research_mode`) the `tuning` mode and they rank normally.

## Tools (provided by the pi-autoresearch-vkf extension)

- `init_research` — scaffold the `.autoresearch-vkf/` workspace (session + memory VKF bundle) (once).
- `remember_claim` — stage a literature-derived candidate claim (+ its source paper).
- `verify_claim` — advance/downgrade a card's trust lifecycle (audited).
- `recall_memory` — query memory for trusted claims, candidates, prior experiments, negatives, conflicts.
- `score_ideas` — rank untested ideas by priority (EV × feasibility × evidence × novelty × info_gain × freshness ÷ cost).
- `plan_next_step` — best-first expansion: pick which experiment node to branch from AND which idea to apply next.
- `find_contradictions` — mine memory for tensions that seed novel hypotheses.
- `find_transfers` — cross-domain mechanism search for surprising analogies.
- `find_compositions` — combine trusted claims with complementary mechanisms into hypotheses no single source states.
- `draft_research_plan` — write the ranked hypothesis portfolio (`session/research_plan.md`).
- `vkf_run_experiment` — run the measurement command, capture `METRIC name=value`.
- `vkf_log_experiment` — record a result as a tree node and write it back to memory (updates belief from evidence & lifecycle).
- `research_graph` — the typed knowledge graph (papers → claims → experiments, conflicts, the search tree) via `vkf graph`.
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

## Two session kinds

- **Optimize** (a measurable target exists): the workflow below.
- **Ideate** (the user wants novel research plans/ideas from the knowledge
  base, no metric yet): use the **autoresearch-vkf-research-plan** skill —
  `init_research` *without* a command, gather → verify → synthesize
  (`find_contradictions` / `find_transfers` / `find_compositions`) →
  `draft_research_plan`. The deliverable is `session/research_plan.md`.

## Workflow

1. **Confirm inputs** (the one and only check-in). Ask for and confirm:
   - the **goal** (what to improve) and the **metric** + which **direction** is better;
   - the **command** that prints `METRIC <name>=<number>` (edit `.autoresearch-vkf/session/measure.sh`);
   - the **files in scope** and any compute/time budget.

2. **Init.** Call `init_research` with those. This also creates the memory bundle.

3. **Recall first.** Call `recall_memory` (with a query about the goal) *before*
   gathering anything. If prior runs already learned something, build on it and
   skip rediscovery.

4. **Gather literature** → use the **autoresearch-vkf-knowledge-gather** skill to find candidate
   techniques (via `WebSearch`/`WebFetch` against free databases — arXiv, Semantic
   Scholar, OpenAlex), then **autoresearch-vkf-claim-extract** to turn them into structured claims
   via `remember_claim`. Then **autoresearch-vkf-claim-verify** to check citations and codebase fit.

4b. **Synthesize new ideas** (optional but high-value) → mine memory for novelty
   instead of only retrieving it: **autoresearch-vkf-contradiction-miner** (tensions →
   hypotheses), **autoresearch-vkf-cross-domain-transfer** (import a mechanism from another field).
   When many ideas compete for budget, run the **autoresearch-vkf-idea-tournament** skill to pick
   the 2–3 worth testing.

5. **Loop** → use the **autoresearch-vkf-hypothesis-loop** skill: `recall_memory` →
   **refresh research** → `plan_next_step` (which node to expand + which idea) →
   implement the smallest falsifying change → `vkf_run_experiment` →
   `vkf_log_experiment(parent_id, node_kind)` → repeat. The search is a **tree**:
   build on the best node, or backtrack and branch when a path dead-ends. Keep
   wins, revert regressions; either way the result is now a node in memory.
   Gathering literature isn't a one-shot up-front step:
   each result re-opens questions, so keep returning to the literature and the
   synthesis skills (step 4b) between experiments rather than grinding the same
   ideas. Reading more between goes is the point. And don't lean on small knobs to
   move the metric — repeatedly fine-tuning a scheduler, LR, or epochs is off the
   table unless that knob is clearly the limiting factor (it's still yielding
   significant, non-stagnating gains) or the user asked for it; otherwise change
   *how* the method works.

6. **Report** → use the **autoresearch-vkf-research-report** skill to produce the lineage report
   (paper → claim → hypothesis → patch → metric Δ → status → memory update).

## Parallelize the independent work

When the host supports sub-agents/background tasks, don't do embarrassingly
parallel work serially:

- **Gather** — fan out one gatherer per sub-topic/source family (arXiv vs
  Semantic Scholar vs GitHub), each returning structured candidates; you (the
  spine) stage them via `remember_claim` so every memory write stays in one
  place and the audit trail is coherent.
- **Verify** — claims are independent; verify several in parallel, one
  sub-agent per claim, each reporting a decision + reason for `verify_claim`.
- **Tournament** — the idea-tournament skill's roles run as independent agents.

Never delegate the memory writes themselves or `vkf_log_experiment` — workers
research and report; the spine writes. No sub-agents? Just do these steps
serially yourself.

## The handoff document

`.autoresearch-vkf/session/prompt.md` is the structured handoff: it carries the
autonomy directive and a fixed schema (Current state / Open questions / Dead
ends / Key wins / Open directions). **Update "Current state" (iteration, best
node, last/next action) and the takeaway sections after every iteration** — a
fresh agent must be able to resume from this file plus `recall_memory` alone,
*including the fact that it should keep going without asking*. On restart:
read `.autoresearch-vkf/session/prompt.md`, `recall_memory`, then continue the loop.
