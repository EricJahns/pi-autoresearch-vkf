---
name: autoresearch-vkf-hypothesis-loop
description: The core experiment loop — recall memory, pick the highest-value sufficiently-novel idea, run the smallest falsifying experiment, and write the result back to memory. Use to drive iterations of an autoresearch loop after claims have been gathered and verified.
---

# Hypothesis loop

This is the engine. Each iteration turns trusted knowledge into a tested result
and feeds it back into memory. Unlike a blind keep-what-wins loop, you choose
ideas deliberately and you never repeat settled work.

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

3. **Pick an idea — score, don't guess.** Call `score_ideas`. It ranks untested
   claims by
   `priority = EV × feasibility × evidence × novelty × info_gain × altitude_affinity ÷ cost`,
   where **novelty** blends lexical distance with *structural* novelty — how
   under-explored the idea's `lever·altitude` bucket is. So a reworded tweak to a
   bucket you've already hammered scores low even if its wording is fresh. Read the
   factor breakdown — it tells you *why* an idea ranks where it does. Prefer ideas
   backed by `source_verified`+ claims. The `⚠ similar to explored/playbook` flag
   marks ideas you've effectively already covered.

   **Honor the budget-balanced shortlist.** `score_ideas` also returns a shortlist
   that tags each pick `[exploit]` (a reliable incremental move) or
   `[explore ⟵ reserved]` (a high-altitude / high-uncertainty bet given a reserved
   slot). Across the run, actually spend the reserved explore slots — don't let
   every iteration collapse onto exploit. The coverage line in the widget shows
   when you're stuck in one corner. *Exception:* if the user asked for tuning, the
   mode is already `tuning`/`explore 0%` and exploit picks are correct — or call
   `set_research_mode` to steer it yourself.

4. **Form a structured hypothesis** before touching code:
   - *mechanism* (why it should work), *intervention* (the smallest change),
     *prediction* (what metric moves, and a guardrail metric that must not
     regress), *risk* (what could break), *novelty basis* (why it's not a repeat).

5. **Run the smallest falsifying experiment.** Make the minimal change in scope,
   then `vkf_run_experiment`. Read the `METRIC` line — don't eyeball logs.

6. **Judge honestly, then `vkf_log_experiment`.** Record the value, the tested
   `claim_id`, whether you `kept` it, conditions, and notes. The tool:
   - derives win/loss/inconclusive vs the baseline,
   - writes an **experiment card back to memory** (a loss is durable knowledge),
   - updates the claim's **belief** and lifecycle (`win` → `locally_tested`;
     repeated `loss` → `contradicted`).
   Keep wins, revert regressions — either way it's now remembered.

7. **Update `.autoresearch-vkf/session/prompt.md`** with the takeaway and repeat.

## Guardrails

- **Don't just "train longer."** Increasing epochs / training steps / wall-clock
  is not a mechanism — it buys metric with compute and teaches you nothing about
  the problem. Do **not** propose it unless the user explicitly asked to tune the
  training budget, **or** there's direct evidence of under-training (e.g. the loss
  curve is still clearly descending at the end of the run). The same caution
  applies to other pure-budget knobs (more data passes, bigger model just to brute
  the metric). Prefer a hypothesis that changes *how* the method works.
- **No metric gaming.** If a "win" came from changing the measurement or leaving
  the method behind, log it as `inconclusive` with a note — don't bank a fake win.
- **Respect the budget** (`max_iterations`, compute/time). Stop and report when
  hit.
- **One variable at a time** so the result attributes cleanly to the hypothesis.

When you've made meaningful progress or exhausted promising ideas, hand to
**autoresearch-vkf-research-report**.
