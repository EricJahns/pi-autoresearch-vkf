---
name: autoresearch-vkf-cross-domain-transfer
description: Generate novel ideas by importing a mechanism from another field into the current problem. Use when you want surprising analogies that keyword search misses — search by mechanism, not keywords.
---

# Cross-domain mechanism transfer

A lot of novelty comes from importing a mechanism that solves a *structurally
similar* problem in another field. Keyword search finds the obvious papers;
**mechanism search finds the surprising analogies.**

## Frame the problem by its mechanism

Don't ask "papers about SNN training". Ask: *what is the structure of my problem?*

- "methods that stabilize discrete nonlinear dynamical systems during gradient
  training"
- "techniques that regulate instability through dynamic scale control"
- "ways to route computation sparsely under an event-driven constraint"

## Find transfer candidates

Call `find_transfers` with:

- `problem` — the mechanism description above (the *how*, not keywords),
- `context` — your target domain (e.g. "spiking neural networks"),

It ranks memory claims by `mechanism_similarity × (1 − context_similarity)` —
high mechanism overlap, low domain overlap = a strong cross-domain analogy.

Example: adaptive gradient clipping (LLMs) and voltage normalization (SNNs) both
*regulate instability through dynamic scale control*. The transfer:

> "Try an adaptive surrogate-slope controller using spike-rate EMA" — importing the
> dynamic-scale-control mechanism into the SNN domain.

## Turn a transfer into a hypothesis

Record the best candidate with `remember_claim`:

- `origin: "transfer"`,
- `derived_from: [<source_id>]`,
- a `mechanism` explaining *why the mechanism should carry over* (the analogy must
  be mechanistic, not superficial),
- `lever` and `altitude` of the transferred idea in *your* target system,
- `context` = your target domain,
- a starting `confidence` (transfers are speculative; start low–medium),
- `failure_modes` — note where the analogy might break (the assumptions the source
  domain has that yours doesn't).

Then let `autoresearch-vkf-claim-verify` and `score_ideas` decide if it earns an experiment.

## Discipline

- **Require a mechanistic reason for transfer**, not just surface similarity. "Both
  use matrices" is not a transfer.
- If you gathered claims only from your own domain, there's nothing to transfer
  *from* — use `autoresearch-vkf-knowledge-gather` to pull in adjacent fields first.
