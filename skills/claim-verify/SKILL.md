---
name: claim-verify
description: Verify staged candidate claims before the loop builds on them — check that the cited source really says it, classify the evidence, and confirm codebase relevance. Use after claim-extract to promote or downgrade claims with verify_claim. This is the trust layer that prevents memory poisoning.
---

# Verify claims

This is the trust layer. Its purpose is to stop **memory poisoning** — bad
knowledge that future runs unknowingly build on. A claim does not get to steer
experiments until it has survived this check.

## For each candidate claim

Check, in order:

1. **Does the source actually say this?** Open the `source_url`. Confirm the
   assertion is supported — and note *where*: abstract, main table, appendix, or
   speculation. A misread or hallucinated citation → `rejected`.
2. **What kind of evidence is it?** Empirical (with ablations) > empirical
   (single run) > theoretical > anecdotal. Weak evidence lowers confidence, not
   necessarily trust state.
3. **Is it relevant to our codebase and goal?** A true claim about a setting we
   can't reach is not actionable. If incompatible → `deprecated` with a reason.
4. **Has it already been tried here?** `recall_memory` first. If a prior
   experiment already settled it, don't re-stage — point at that result.

## Record the decision with `verify_claim`

- `source_verified` — citation checks out, evidence classified, relevant. Now
  eligible to drive hypotheses.
- `contradicted` — a source or prior local result disagrees; pass
  `conflicts_with` the other card's id.
- `deprecated` — true but stale/superseded/not applicable here.
- `rejected` — misread, hallucinated, or unsupported.
- (`locally_tested` / `replicated` are normally set by `log_experiment`, not here.)

Always give a **reason** — it becomes part of the audit trail (a VKF
transaction). After each call, the tool reports `vkf validate` so you can see the
bundle stays governed.

## Skepticism rules

- Never silently promote to a trusted state. Every promotion is explicit and
  audited.
- Prefer downgrading on doubt. `source_verified` should mean you actually opened
  the source.
- A claim's truth in a paper ≠ its usefulness for our goal. Keep those separate.

When the trusted set is healthy, hand back to **autoresearch-create** for the
**hypothesis-loop**.
