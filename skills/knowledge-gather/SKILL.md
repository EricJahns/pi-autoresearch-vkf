---
name: knowledge-gather
description: Gather frontier knowledge relevant to a research goal — search papers, repos, docs, and benchmarks for candidate techniques. Use as the discovery step of an autoresearch loop, before extracting claims. Collects candidate knowledge; it does not invent ideas or run experiments.
---

# Gather frontier knowledge

Your single job: **collect candidate techniques** relevant to the current goal.
You are a librarian, not an inventor — do not propose novel combinations here, and
do not run experiments. Find what others have done and bring back the receipts.

## Which search backend to use

Decide once, at the start of gathering, in this order:

1. **Paper Lantern, if its MCP tools are available.** Check the tools you've been
   given for a Paper Lantern search/collection tool (names usually contain
   `paper_lantern` / `paperlantern`). If present, **prefer it** — it's purpose-built
   for paper search, high-level overviews, and curated collections, and tends to
   surface better candidates than raw web search. Use its overview/collection
   features to learn the area, then its search to pull specific papers.
2. **Otherwise, fall back to `WebSearch` + `WebFetch`** (always available). This is
   the default path and works fully on its own — Paper Lantern is an upgrade, not a
   requirement. Use `WebSearch` to find papers/repos and `WebFetch` to read them
   (prefer arXiv HTML/abstract pages and Semantic Scholar over PDFs when you can).

State which backend you're using in your first message so the run is reproducible.

## Where to look (whichever backend)

- **arXiv / Semantic Scholar** — search by the *mechanism* of your problem, not
  just keywords. Keyword search finds the obvious; mechanism search finds
  surprising analogies (e.g. "methods that stabilize discrete nonlinear dynamical
  systems during gradient training", not "SNN training tricks").
- **GitHub / docs / issues / benchmark reports / blog posts** — for
  implementation hints and whether a technique actually ships.

## What to collect

For each candidate, capture enough to become a claim later:

- **title** and **source_url** (arXiv id / DOI / URL)
- **claim** — what the source asserts (one checkable sentence)
- **mechanism** — *why* it works (this is what enables transfer)
- **reported_result** — the evidence the source gives
- **implementation_hint** — how you'd apply it here
- **limitations / failure_modes** — when it doesn't apply
- **recency** and a rough **reliability** read (a 2026 paper may be novel but
  weakly evidenced; a 2017 method may be boring but robust)

## Discipline

- **Don't trust "paper says X" as "X is true."** Note whether a result is from an
  abstract, a main table, an appendix, or speculation; empirical vs theoretical
  vs anecdotal. This becomes the claim's evidence strength.
- **Aim for ~10–20 strong candidates**, not hundreds. Favor load-bearing,
  mechanism-clear techniques over exhaustive grids.
- **Look for contradictions and gaps** between sources — they're the richest
  seeds for novel hypotheses later.

Hand the collected candidates to **claim-extract**, which writes them into memory
with `remember_claim`.
