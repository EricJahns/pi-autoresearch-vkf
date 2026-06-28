---
name: autoresearch-vkf-knowledge-gather
description: Gather frontier knowledge relevant to a research goal — search papers, repos, docs, and benchmarks for candidate techniques. Use as the discovery step of an autoresearch loop, before extracting claims. Collects candidate knowledge; it does not invent ideas or run experiments.
---

# Gather frontier knowledge

Your single job: **collect candidate techniques** relevant to the current goal.
You are a librarian, not an inventor — do not propose novel combinations here, and
do not run experiments. Find what others have done and bring back the receipts.

## How to search

Use `WebSearch` to find sources and `WebFetch` to read them. No API keys, no
paid services, no extra setup — just the agent's built-in web tools against free,
openly accessible databases.

Search by the *mechanism* of your problem, not just keywords. Keyword search finds
the obvious; mechanism search finds surprising analogies (e.g. "methods that
stabilize discrete nonlinear dynamical systems during gradient training", not
"SNN training tricks").

## Free sources to draw on

All of these are free and reachable with `WebFetch` (no key required):

- **arXiv** — `arxiv.org` abstract/HTML pages, or the API at
  `export.arxiv.org/api/query?search_query=...`. Prefer HTML/abstract pages over
  PDFs; they parse far better.
- **Semantic Scholar** — the free Graph API,
  `api.semanticscholar.org/graph/v1/paper/search?query=...` (returns titles,
  abstracts, years, citation counts — good for a reliability read).
- **OpenAlex** — `api.openalex.org/works?search=...` (free, no key; great for
  breadth and finding related work).
- **Crossref** — `api.crossref.org/works?query=...` (resolve DOIs / metadata).
- **GitHub / docs / issues / benchmark reports / blog posts** — for
  implementation hints and whether a technique actually ships.

If the host has no web tools at all, fall back to sources the user provides
(pasted papers, PDFs, URLs) or seed claims from your own knowledge — marked
low-reliability until verified.

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

Hand the collected candidates to **autoresearch-vkf-claim-extract**, which writes them into memory
with `remember_claim`.
