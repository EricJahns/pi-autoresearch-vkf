---
name: autoresearch-vkf-hypothesis-loop
description: The core experiment loop — recall memory, pick the highest-value sufficiently-novel idea, run the smallest falsifying experiment, and write the result back to memory. Use to drive iterations of an autoresearch loop after claims have been gathered and verified.
---

# Hypothesis loop

This is the engine. Each iteration turns trusted knowledge into a tested result
and feeds it back into memory. Unlike a blind keep-what-wins loop, you choose
ideas deliberately and you never repeat settled work.

**The search is a tree, not a line.** Every experiment is a *node* that branches
from a parent, and its outcome is judged against that parent's value — not one
global baseline. So you can build on the best result so far, or **backtrack** to an
earlier, better node and branch in a new direction when a path dead-ends. Don't
just keep mutating the latest run. `plan_next_step` picks *which node to expand*
and *which idea to apply* for you; pass its `parent_id` + `node_kind` to
`vkf_log_experiment`.

## Each iteration

1. **Recall.** Call `recall_memory` (query the goal). Read all four groups:
   trusted claims, candidates, **already-tried** experiments, and
   **negatives/conflicts**. The tried/negative lists are guardrails — do not
   re-run them unless conditions changed.

2. **Research before you reach for the next tweak.** Don't immediately re-pick from
   the ideas already on hand — most iterations should start by *learning something
   new*. Before scoring, refresh the knowledge base when any of these hold (and at
   least every few iterations regardless):
   - the last result was a loss, inconclusive, or a surprise;
   - the remaining untested ideas are mostly incremental / same-bucket;
   - you're about to repeat a lever you've already worked.

   Spend that time on real research, not a quick search: run
   **autoresearch-vkf-knowledge-gather** for fresh literature on the *specific*
   sub-problem the last experiment exposed, **autoresearch-vkf-contradiction-miner**
   to turn tensions in memory into new hypotheses, or
   **autoresearch-vkf-cross-domain-transfer** to import a mechanism from another
   field. Extract and verify what you find (`remember_claim` → claim-verify) so the
   next pick chooses from a *richer, better-grounded* set of ideas. A good loop
   reads more than it tweaks.

3. **Plan the next step — don't guess.** Call `plan_next_step`. It does best-first
   expansion: it ranks untested claims by
   `priority = EV × feasibility × evidence × novelty × info_gain × altitude_affinity × freshness ÷ cost`
   (where **novelty** blends lexical distance with *structural* novelty — how
   under-explored the idea's `lever·altitude` bucket is, so a reworded tweak to a
   bucket you've hammered scores low; and **freshness** down-weights stale
   knowledge), **and** attaches each idea to a node to expand: `improve` the best
   node, or `branch` from it to explore. It reports the best node so far and a
   budget-balanced shortlist tagging each pick `[exploit]` (a reliable incremental
   move) or `[explore]` (a high-altitude / high-uncertainty bet given a reserved
   slot). Read the factor breakdown — it tells you *why* a pick ranks where it does.

   **Honor the explore quota.** Across the run, actually spend the reserved explore
   picks — don't let every iteration collapse onto `improve` the same node. The
   coverage line in the widget (and the dashboard heatmap) shows when you're stuck
   in one corner. When a branch stops paying off, expand a different node rather
   than grinding the latest. *Exception:* if the user asked for tuning, the mode is
   already `tuning`/`explore 0%` and exploit picks are correct — or call
   `set_research_mode` to steer it yourself.
   (`score_ideas` still exists if you only want the idea ranking without a node.)

4. **Form a structured hypothesis** before touching code:
   - *mechanism* (why it should work), *intervention* (the smallest change),
     *prediction* (what metric moves, and a guardrail metric that must not
     regress), *risk* (what could break), *novelty basis* (why it's not a repeat).

5. **Run the smallest falsifying experiment.** Make the minimal change in scope,
   then `vkf_run_experiment`. Read the `METRIC` line — don't eyeball logs.

6. **Judge honestly, then `vkf_log_experiment`.** Record the value, the tested
   `claim_id`, the `parent_id` + `node_kind` from `plan_next_step`, whether you
   `kept` it, conditions, notes, and any `next_suggestions` the result implies. The
   tool:
   - judges win/loss/inconclusive against the **parent node's** value (the tree
     baseline), not a single global one,
   - writes an **experiment card back to memory** (a loss is durable knowledge),
     with a profile-2 reproduction block and the parent edge for `vkf graph`,
   - updates the claim's **belief from accumulated evidence** (the win/loss tally,
     not a fixed nudge) and its lifecycle (`win` → `locally_tested`; repeated `loss`
     → `contradicted`).
   Keep wins, revert regressions — either way it's now remembered, and the node is
   in the tree to branch from later.

7. **Update `.autoresearch-vkf/session/prompt.md`** with the takeaway and repeat.

## Guardrails

- **Don't repeatedly fine-tune small knobs.** Low-altitude hyperparameter tweaks —
  LR-schedule shape, warmup length, batch size, weight decay, dropout rate, and the
  like — are fine to *try once*, but they must **never become the loop's default
  move**, and the same knob must not be tuned again and again. Revisit a knob only
  when there's an extremely strong reason to believe it's the current *limiting
  factor* — concretely, the last adjustment to that lever produced a **significant**
  metric gain and the metric is **still clearly improving, not stagnating**. The
  moment returns flatten, abandon that lever and go higher-altitude (change *how*
  the method works) instead of squeezing the same knob. The widget's coverage line
  is your tell: if one `lever·altitude` bucket keeps growing, stop feeding it.
- **Don't just "train longer."** Increasing epochs / training steps / wall-clock is
  the limiting case of the rule above: it's not a mechanism — it buys metric with
  compute and teaches you nothing. Do **not** propose it unless the user explicitly
  asked to tune the training budget, **or** there's direct evidence of
  under-training (e.g. the loss curve is still clearly descending at the end of the
  run). The same caution applies to other pure-budget knobs (more data passes,
  bigger model just to brute the metric). Prefer a hypothesis that changes *how* the
  method works.
- **No metric gaming.** If a "win" came from changing the measurement or leaving
  the method behind, log it as `inconclusive` with a note — don't bank a fake win.
- **Respect the budget** (`max_iterations`, compute/time). Stop and report when
  hit.
- **One variable at a time** so the result attributes cleanly to the hypothesis.

When you've made meaningful progress or exhausted promising ideas, hand to
**autoresearch-vkf-research-report**.
