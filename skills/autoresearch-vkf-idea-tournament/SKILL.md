---
name: idea-tournament
description: Run a structured multi-perspective tournament over candidate ideas to pick the 2-3 worth testing. Use when there are many candidate hypotheses competing for limited experiment budget.
---

# Idea tournament

When many ideas compete for a limited experiment budget, don't just take the top
of one ranking. Run a tournament: judge each idea from several perspectives, then
advance only the best 2–3 to the `hypothesis-loop`.

## Assemble the field

Gather candidates from every source:

- `score_ideas` — the priority-ranked untested claims (the quantitative seed).
- `find_contradictions` — hypotheses from tensions.
- `find_transfers` — cross-domain mechanism imports.
- `recall_memory` — to see what's already been tried (exclude repeats).

## Judge each finalist from five perspectives

For the top ~6 candidates, score each (1–5) from each role, and write a one-line
rationale per role:

| Role | Asks |
|------|------|
| **Literature** | How strong is the evidence behind it? (verification level, reliability) |
| **Engineer** | How feasible is it within scope and budget? |
| **Skeptic** | What are the failure modes? How could a "win" be fake (metric gaming)? |
| **Novelty** | How far is it from what we've already tried and the standard playbook? |
| **Experiment** | What's the cheapest experiment that could falsify it? |

The `score_ideas` factor breakdown gives you the quantitative backbone
(EV, feasibility, evidence, novelty, info-gain, cost); the roles add the judgment
the numbers miss — especially the Skeptic's failure-mode and gaming checks.

## Pick winners and record the verdict

- Advance the **2–3** ideas that are strong *and* sufficiently distinct from each
  other (don't advance three flavors of the same idea — spend budget on coverage).
- For each advanced idea, make sure its card has an honest `confidence`,
  `failure_modes`, and a planned guardrail metric.
- For ideas you reject, say why in the card `notes` (or downgrade via
  `verify_claim`) so the tournament's reasoning is remembered and they aren't
  re-litigated next round.

Hand the 2–3 winners to the **hypothesis-loop**.

## Discipline

- **Diversity over greed.** Three high-EV near-duplicates is worse than two strong
  ideas exploring different regions.
- **The Skeptic has veto.** An idea that can only "win" by gaming the metric is out,
  regardless of its priority score.
