---
name: hypothesis-loop
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

2. **Pick an idea.** Prefer ideas backed by `source_verified`+ claims. Balance:
   - **expected value** — how much it could move the metric,
   - **feasibility** — implementation cost within scope,
   - **evidence strength** — confidence/reliability of the backing claim,
   - **novelty** — distance from already-tried and from the standard playbook;
     penalize ideas close to exhausted/negative memory,
   - **information gain** — even a likely-small win that explores a new region can
     be worth it.
   Don't always take the highest expected win — sometimes explore.

3. **Form a structured hypothesis** before touching code:
   - *mechanism* (why it should work), *intervention* (the smallest change),
     *prediction* (what metric moves, and a guardrail metric that must not
     regress), *risk* (what could break), *novelty basis* (why it's not a repeat).

4. **Run the smallest falsifying experiment.** Make the minimal change in scope,
   then `run_experiment`. Read the `METRIC` line — don't eyeball logs.

5. **Judge honestly, then `log_experiment`.** Record the value, the tested
   `claim_id`, whether you `kept` it, conditions, and notes. The tool:
   - derives win/loss/inconclusive vs the baseline,
   - writes an **experiment card back to memory** (a loss is durable knowledge),
   - updates the claim's **belief** and lifecycle (`win` → `locally_tested`;
     repeated `loss` → `contradicted`).
   Keep wins, revert regressions — either way it's now remembered.

6. **Update `.auto/prompt.md`** with the takeaway and repeat.

## Guardrails

- **No metric gaming.** If a "win" came from changing the measurement or leaving
  the method behind, log it as `inconclusive` with a note — don't bank a fake win.
- **Respect the budget** (`max_iterations`, compute/time). Stop and report when
  hit.
- **One variable at a time** so the result attributes cleanly to the hypothesis.

When you've made meaningful progress or exhausted promising ideas, hand to
**research-report**.
