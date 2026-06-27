# Benchmark: standard autoresearch vs pi-autoresearch-vkf

This benchmark answers one question: **given the same idea-environment and the
same experiment budget, does verifiable memory + novelty scoring + hypothesis
synthesis search better than a blind optimization loop?**

```sh
npm run bench                      # 500 seeds/scenario (default)
node --import tsx benchmark/run.ts --seeds 1000
node --import tsx benchmark/run.ts --update-readme   # write results into ../README.md
```

## What is and isn't simulated

A full end-to-end benchmark would run a real LLM agent editing real repositories,
measuring real metrics, with human novelty ratings. That's the "killer demo" — it
needs an API key, compute, and human raters, so it isn't what runs in CI.

Instead this harness isolates the **search policy** and makes everything else
deterministic and reproducible:

- **The environment is simulated** — each scenario (`scenarios.ts`) is a pool of
  candidate ideas with *known ground-truth* effects: obvious playbook moves with
  small real effect, a tempting dead-end family that's all loss, genuinely good
  novel ideas, and a **combo** whose large payoff exists only as the synthesis of
  two parent ideas.
- **Measurements are seeded** — trying an idea returns its true effect plus
  deterministic Gaussian noise keyed on `(seed, ideaId)`, so both policies see the
  *same* draw for the same idea. Results are averaged over many seeds.
- **The policies are real code, not a mock.** Both are driven through the actual
  modules under test:
  - *Ours* selects with the real `scoring.ts` `rankIdeas` (novelty-aware priority)
    and unlocks combos only when the real `synthesis.ts` `findContradictions`
    flags the parent pair.
  - *Standard* is a faithful model of a blind loop: EV-greedy (it reaches for the
    obvious high-prior playbook first), no durable memory (it re-runs work after
    "context resets"), no dead-end abandonment, no synthesis.

So the agent's *reasoning* is stylized, but the **selection and synthesis
machinery being compared is the shipped code.**

## What the metrics mean

| Metric | Meaning |
|--------|---------|
| **Best improvement** | Largest true metric gain found within budget (higher is better). |
| **Unique mechanisms tried** | Breadth of the search — distinct mechanisms explored. |
| **Wasted (repeat) experiments** | Budget spent re-running already-tried ideas. Memory should drive this to 0. |
| **Dead-ends retried** | Times the loop re-entered a region already known to fail. |
| **Synthesized ideas discovered** | Combos reachable only via contradiction synthesis. |
| **Found optimum (rate)** | Fraction of seeds that reached the scenario's optimal improvement. |

## How to read the result

The headline is **Best improvement** and **Found optimum rate**: the scenarios are
built so the global optimum is the synthesized combo, which a blind loop *cannot*
reach because it never combines ideas. Memory (no repeats, dead-end abandonment)
and novelty scoring (breadth over the obvious playbook) get both parents tried;
synthesis then unlocks the combo. The other columns explain *why* the headline
moves.

This is a controlled demonstration, not a claim about any specific real workload —
the magnitude depends on how much a domain rewards combination and breadth. The
direction, however, is structural: a loop with no memory and no synthesis cannot
avoid repeats it can't remember, nor discover ideas it can't construct.
