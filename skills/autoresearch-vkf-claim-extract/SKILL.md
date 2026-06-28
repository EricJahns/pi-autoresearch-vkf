---
name: autoresearch-vkf-claim-extract
description: Convert gathered literature into structured, reusable VKF claim cards (research atoms). Use after autoresearch-vkf-knowledge-gather to stage candidate claims in memory with remember_claim. Turns noisy papers into small, checkable, reusable assertions.
---

# Extract claims from literature

Papers are too big and noisy to reuse directly. Your job is to distill each
gathered source into **research atoms**: small, checkable, reusable claims the
loop can act on. One assertion per claim.

## For each candidate technique

Call `remember_claim` with:

- **title** — a short, specific handle, e.g. "Adaptive gradient clipping
  stabilizes early LLM training".
- **assertion** — the single checkable statement. Not "AdaGC is good" but
  "Replacing static gradient clipping with EMA-based adaptive clipping lowers
  early-training validation loss for small transformers."
- **mechanism** — *why* it should work. This is the most valuable field: it's
  what later lets the autoresearch-vkf-hypothesis-loop transfer the idea across domains.
- **context** — where it applies (architecture, scale, dataset regime).
- **implementation_recipe** — concretely how to apply it in this codebase.
- **failure_modes** — known/suspected ways it breaks or interacts badly.
- **confidence** — your initial belief in [0,1] that it helps *our* goal.
- **recency_score** / **reliability_score** — keep these separate; a recent paper
  can be high-recency, low-reliability.
- **paper** — the source `{ title, source_url, authors?, year?, summary? }`. Pass
  this so the source PaperCard is created and the claim's provenance resolves.

## Rules

- **One number/mechanism per claim.** Split multi-result findings into separate
  claims.
- **Separate reproducible from rhetorical.** "Improves perplexity by 3%" is a
  claim; "is more elegant" is not.
- **Ground every claim in a mechanism.** A claim with no mechanism can't be
  transferred and is hard to falsify — flag it as low confidence.
- **Stay honest about evidence.** Reflect whether the source was empirical,
  theoretical, or anecdotal in the confidence/reliability you assign.

Everything you stage here is a **candidate** (status `draft`) with a transaction
record — nothing is trusted yet. Hand off to **autoresearch-vkf-claim-verify**.
