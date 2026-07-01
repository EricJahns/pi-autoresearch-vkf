---
name: autoresearch-vkf-research-plan
description: Turn a VKF knowledge base into a ranked portfolio of novel research hypotheses — no measurable metric required. Use when the user wants research plans, novel ideas, or a research agenda drawn from accumulated knowledge (rather than optimizing a number). Drives an ideation session; the deliverable is research_plan.md.
---

# Research-plan / ideation mode

Not every research task starts with a metric. When the user wants **novel
research plans and ideas** from the knowledge base, run an *ideation session*:
same memory, same trust lifecycle, but the deliverable is a ranked, evidenced
research agenda — `session/research_plan.md` — instead of a metric delta.

## Workflow

1. **Init without a command.** Call `init_research` with the goal but **no
   `command`/`metric_name`** — that marks the session `ideate`. (Autonomy rules
   still apply: confirm the goal once, then work without check-ins.)

2. **Recall first.** `recall_memory` (project and `scope: "both"` if global
   memory exists). The knowledge base is the raw material — read all groups,
   including negatives and conflicts.

3. **Deepen the base where it's thin.** Use **autoresearch-vkf-knowledge-gather**
   → **autoresearch-vkf-claim-extract** → **autoresearch-vkf-claim-verify** on the
   goal's sub-topics. Ideation quality is capped by claim quality: mechanisms
   matter most, since every synthesis operator works on mechanisms.

4. **Synthesize — this is where novelty comes from.** Run all three operators
   and study their output, not just the top line:
   - `find_contradictions` — tensions whose resolution is a research question;
   - `find_transfers` — mechanisms from other domains (describe the goal by its
     *mechanism*, not keywords);
   - `find_compositions` — pairs of trusted claims whose mechanisms are
     complementary; a composition is an idea **no single paper states**.
   Write the promising ones into memory with `remember_claim`
   (origin `contradiction`/`transfer`/`synthesis`, `derived_from` set) so they
   are ranked alongside literature-derived ideas.

5. **Draft the plan.** `draft_research_plan` ranks every untested idea
   (EV × feasibility × evidence × novelty × info-gain ÷ cost) and writes
   `research_plan.md`: each hypothesis with its mechanism, evidence trail,
   novelty basis, and a proposed falsifying experiment, plus the open tensions
   and composition opportunities. Re-run it as the base grows — it's cheap.

6. **Iterate.** A good agenda takes 2–4 rounds of gather → synthesize → re-plan.
   Stop when the top hypotheses are mechanism-level, evidenced, and mutually
   distinct (different `lever·altitude` buckets), then present the plan.

## Quality bar

- Prefer **mechanism/reframe-altitude** hypotheses; a plan of knob tweaks is a
  failed ideation run (see the orchestrator's "novel over knobs" rule).
- Every hypothesis must cite its cards (`claim:…`, `paper:…`) — an idea without
  a lineage is a guess, not a plan item.
- Surface disagreement honestly: a tension left open belongs in the plan as a
  question, not silently dropped.

If the user later picks a hypothesis to test, start an optimize session
(`init_research` with a measure command) and hand to
**autoresearch-vkf-hypothesis-loop**.
