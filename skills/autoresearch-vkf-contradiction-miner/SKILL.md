---
name: autoresearch-vkf-contradiction-miner
description: Generate novel hypotheses from tensions already in memory — conflicting claims, ideas that won in one place and lost in another, and different mechanisms aimed at the same goal. Use when the loop needs fresh, non-obvious ideas rather than more literature.
---

# Mine contradictions into hypotheses

The richest novel ideas don't come from copying nearby literature — they come from
the **tensions** already sitting in memory. Your job: surface those tensions and
turn the promising ones into testable hypotheses.

## Find the tensions

Call `find_contradictions`. It returns tension pairs of three kinds, each with a
generative question:

- **explicit** — two claims linked by `conflicts_with`.
- **outcome_flip** — a claim that *worked* here and a similar one that was
  *contradicted*. "Why did X hold while the similar Y failed?"
- **same_goal_diff_mechanism** — two claims targeting the same goal via different
  mechanisms. "Can the mechanisms be unified or combined?"

Examples of the shape you're looking for:

- Paper A says normalization is critical; Paper B removes it successfully →
  *under what condition can we remove it?*
- A stabilizes with clipping; B stabilizes with an LR schedule → *can these be one
  adaptive schedule?*

## Turn a tension into a hypothesis

Pick the highest-signal, most goal-relevant tension. Write a **structured
hypothesis** answering its question:

- *mechanism* — why your proposed resolution should work,
- *intervention* — the smallest change that tests it,
- *prediction* — the metric that should move (+ a guardrail),
- *novelty basis* — why this isn't a repeat.

Record it with `remember_claim`, setting:

- `origin: "contradiction"`,
- `derived_from: [<id_a>, <id_b>]` (the two cards in tension),
- a `mechanism` (required — a hypothesis with no mechanism is just noise),
- an honest `confidence` (these are speculative; start low–medium).

It enters memory as a **candidate** like any other idea — then `autoresearch-vkf-claim-verify` and
the `autoresearch-vkf-hypothesis-loop` (via `score_ideas`) decide whether it's worth testing.

## Discipline

- **Ground every hypothesis in a mechanism.** Don't combine things just because no
  one has — bad novelty is novel only because it's bad.
- **Prefer tensions near the goal.** A fascinating contradiction far from the
  metric you're optimizing is a distraction.
