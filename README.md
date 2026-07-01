# pi-autoresearch-vkf

> **Autoresearch that remembers — and can prove what it learned.**

[![npm](https://img.shields.io/npm/v/pi-autoresearch-vkf.svg)](https://www.npmjs.com/package/pi-autoresearch-vkf)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)

Most AI research loops forget everything between runs. They re-read the same
papers, re-try ideas that already failed, and can't tell you why they believed
something worked. This one keeps a lab notebook: it reads the literature, records
what it learned, checks whether it's actually true, runs the experiment, and
remembers the result — so the next run starts where the last one left off instead
of from scratch.

In our benchmarks that's the difference between finding the best answer every time
and never finding it, with zero repeated experiments along the way.

A [pi](https://pi.dev) extension that turns a blind optimization loop into a
self-improving researcher with **verifiable long-term memory**. The memory layer is
[VKF](https://github.com/EricJahns/Verifiable-Knowledge-Format) (Verifiable
Knowledge Format): markdown + YAML knowledge objects with provenance, evidence,
confidence, and a trust lifecycle, gated by the real `vkf` CLI.

**Contents:** [Why](#why) · [Install](#install) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Benchmark](#benchmark) · [Watching progress](#watching-progress) · [Reference](#reference) · [Development](#development) · [Roadmap](#roadmap) · [License](#license)

## Why

A plain autoresearch loop tries an idea, measures it, keeps wins, reverts
regressions — and forgets everything. It can't say *where* a good idea came from,
*what* it already tried, or *whether* a win was real. This extension adds the
missing layer:

```
RAG agent:        retrieve papers → try idea → forget context
pi-autoresearch-vkf:
                  retrieve → extract claims → verify → store
                  → hypothesize → test → update belief
                  → avoid repeated failures → improve future search
```

Agents with scientific memory that is **verifiable, lifecycle-managed, and auditable**.

## Install

```sh
pi install npm:pi-autoresearch-vkf
# or, from a local checkout:
pi install file:/path/to/pi-autoresearch-vkf
```

### Requirements

| Dependency | For | Required? |
|---|---|---|
| **`vkf` CLI** | Trust gating — validation, graph, freshness, permission checks | Recommended (memory still works without it; validation is skipped) |
| **Web tools** (`WebSearch` / `WebFetch`) | Ingesting new knowledge from the literature | Recommended — the ingestion path |

The extension finds `vkf` automatically inside a conda env named `VKF`, or set
`$PI_AUTORESEARCH_VKF` to the `vkf` executable.

## Quick start

In a project you want to optimize, just say what you want:

```
optimize the test suite runtime, using the research literature and remembering what works
```

The **autoresearch-vkf** skill drives the rest: confirm goal/metric/command → init →
gather literature → extract & verify claims → loop (recall → experiment →
write-back) → report. All state lives in one self-contained `.autoresearch-vkf/`
folder at the project root, so work **survives restarts and context resets**.

The loop runs **autonomously by default**: after the one up-front confirmation it
keeps iterating without asking (the tools re-assert this every step). To pause it
at any time, create the STOP file — `touch .autoresearch-vkf/session/STOP` — and
the loop halts and reports; delete it to resume. Prefer to be asked each step?
Init with `autonomy: "confirm-each"`.

No measurable metric yet? Ask for **research plans/ideas instead** — an ideation
session (init without a command) mines the knowledge base with contradiction /
transfer / composition synthesis and delivers a ranked, evidenced research agenda
in `session/research_plan.md`.

> **Knowledge ingestion** uses the agent's built-in `WebSearch` + `WebFetch`
> against free, open databases (arXiv, Semantic Scholar, OpenAlex, Crossref) — no
> API keys, no paid services, no MCP setup. No web tools? Paste papers/PDFs/findings
> for the agent to extract, or seed claims from its own knowledge (marked
> low-reliability until verified). See [Knowledge sources](#knowledge-sources).

## How it works

```
goal ─► recall_memory ─► gather literature ─► remember_claim (candidates)
   │                                              │
   │                                         verify_claim ──► trusted claims
   ▼                                              │
 autoresearch-vkf-hypothesis-loop:  recall ─► pick idea ─► vkf_run_experiment ─► vkf_log_experiment
   │                                                            │
   │                                  writes experiment card back to memory,
   │                                  updates the claim's belief & lifecycle
   ▼
 autoresearch-vkf-research-report   (paper → claim → hypothesis → patch → metric Δ → memory update)
```

### One self-contained workspace

Everything the package owns lives under a single namespaced `.autoresearch-vkf/`
directory, so it never collides with other tools and is obvious at a glance:

| Layer | Folder | Lifetime |
|-------|--------|----------|
| **Session** | `.autoresearch-vkf/session/` | this run — goal, experiment log, measure script, dashboards (safe to gitignore) |
| **Project memory** | `.autoresearch-vkf/memory/` | **persists across runs** — the VKF bundle (meant to be committed) |
| **Global memory** | `~/.autoresearch-vkf/memory/` | **persists across projects** — trusted knowledge promoted from any repo |

```
.autoresearch-vkf/
  session/             # ephemeral per-run state (config, experiment log, dashboards)
  memory/              # the durable VKF knowledge bundle:
    vkf.bundle.yaml    #   profile 1 (governed); 2 (verified) once evidence lands
    staging/           #   candidates (status: draft)
    verified/          #   source-/locally-verified, replicated
    deprecated/        #   contradicted / retired
    transactions/      #   one record per promote/demote/write-back
```

The `memory/` bundle is just markdown — human-readable, version-controllable, and
auditable. Run `vkf validate .autoresearch-vkf/memory`, `vkf graph`,
`vkf freshness`, or `vkf html` over it any time.

### The memory lifecycle

Every card carries a trust state. Agents *propose*; promotion is explicit and
audited (a VKF transaction is written for each change):

| Memory state | VKF status | Directory |
|---|---|---|
| `candidate` | `draft` | `staging/` |
| `source_verified` | `active` | `verified/` |
| `locally_tested` / `replicated` | `verified` | `verified/` |
| `contradicted` | `disputed` | `deprecated/` |
| `deprecated` | `deprecated` | `deprecated/` |
| `retired` | `retracted` | `deprecated/` |

Only `source_verified`+ drives serious hypotheses; only `locally_tested`+ strongly
steers experiments. This — plus the staging area and the citation-checking
verifier — is the defense against **memory poisoning**.

## Benchmark

Does verifiable memory + novelty scoring + synthesis actually search better than a
blind loop? `npm run bench` runs both policies over deterministic, ground-truth
idea-environments — driving *ours* through the real `scoring.ts` and `synthesis.ts`
— and reports the difference. See [benchmark/README.md](benchmark/README.md) for
exactly what is and isn't simulated.

<!-- BENCH:START -->

Mean over 500 seeds per scenario. "Standard" = blind loop (EV-greedy,
no durable memory, no synthesis). "Ours" = VKF memory + novelty scoring +
contradiction synthesis, driven through the real scoring/synthesis modules.

### Tiny-LM validation loss (budget 10)

| Metric | Standard | Ours |
|---|---:|---:|
| Best improvement (higher better) | 0.035 | **0.130** |
| Unique mechanisms tried | 7.8 | **10.0** |
| Wasted (repeat) experiments | 2.2 | **0.0** |
| Dead-ends retried | 1.4 | **1.0** |
| Synthesized ideas discovered | 0.0 | **1.0** |
| Found optimum (rate) | 0% | **100%** |

### Inference latency (budget 8)

| Metric | Standard | Ours |
|---|---:|---:|
| Best improvement (higher better) | 0.043 | **0.150** |
| Unique mechanisms tried | 6.3 | **8.0** |
| Wasted (repeat) experiments | 1.7 | **0.0** |
| Dead-ends retried | 1.7 | **1.0** |
| Synthesized ideas discovered | 0.0 | **1.0** |
| Found optimum (rate) | 0% | **100%** |

<!-- BENCH:END -->

The global optimum in each scenario is a *synthesized* idea a blind loop can't
construct, so it reaches it 0% of the time; ours gets both parents tried (memory +
novelty), then synthesis unlocks the combo.

## Watching progress

Three live views, in increasing detail:

- **Widget** (always on, above the editor) — run/kept/discarded counts, best
  metric, memory tally, the shortcut hints, and a color-coded table of the recent
  runs (# · commit · every metric · status · change), newest at the bottom;
  refreshes after every tool call. (Colors follow your terminal theme; set
  `NO_COLOR` for plain text.)
- **Fullscreen overlay** — press **Alt+G** (or call `research_status`) for the
  full experiment list, memory lifecycle, and verified claims.
- **Browser dashboards** — press **Alt+O** (or run `/research-open`). `export_dashboard`
  writes two self-contained pages to `.autoresearch-vkf/session/`:
  - `progress.html` — an **interactive** dashboard (vanilla JS, no build, no
    dependencies) in a wide, multi-column layout: a multi-metric chart (toggle
    series, log scale, hover tooltips), the **search-tree** view, the embedded
    **knowledge graph** (paper → claim → experiment lineage, built without the
    `vkf` CLI so it tracks live), a clickable node detail panel shared across both
    graphs, a lever × altitude **coverage heatmap**, belief bars, a filter/sortable
    experiment table, and a light/dark toggle. It reads a `data.json` sidecar and
    re-renders *in place*, so an open tab tracks the run live without losing your
    filters or scroll.
  - `dashboard.html` — the richer typed **idea-lineage graph** (paper → claim →
    experiment, with conflict/derived-from edges), generated by `vkf html`.

  ```sh
  open .autoresearch-vkf/session/progress.html    # watch progress as it goes
  open .autoresearch-vkf/session/dashboard.html   # explore the knowledge lineage
  ```

## Reference

<details>
<summary><strong>Tools</strong></summary>

| Tool | What it does |
|------|--------------|
| `init_research` | Scaffold the `.autoresearch-vkf/` workspace (session + memory VKF bundle). Takes `autonomy` (`continuous` default / `confirm-each`); omit the measure `command` for an **ideation** session. |
| `remember_claim` | Stage a literature-derived candidate claim (+ its source paper). |
| `verify_claim` | Advance/downgrade a card's trust lifecycle (audited). |
| `recall_memory` | Query memory (project / global / both): trusted claims, candidates, prior experiments, negatives, conflicts. |
| `score_ideas` | Rank untested ideas by `EV × feasibility × evidence × novelty × info_gain × altitude_affinity × freshness ÷ cost` (novelty includes *structural* novelty: how under-explored the idea's lever·altitude bucket is; freshness down-weights stale knowledge); returns a budget-balanced explore/exploit shortlist. |
| `plan_next_step` | Best-first tree expansion: pick *which experiment node to branch from* AND *which idea to apply* next (improve the best node, or branch to explore). |
| `set_research_mode` | Steer the explore/exploit budget and altitude bias mid-run (e.g. switch to `tuning` when the user explicitly wants a sweep). |
| `find_contradictions` | Mine memory for tensions between claims — each a seed for a novel hypothesis. |
| `find_transfers` | Cross-domain mechanism search: same *how*, different *where*. |
| `find_compositions` | Combine trusted claims with complementary mechanisms into hypotheses no single source states. |
| `draft_research_plan` | Write `session/research_plan.md`: the ranked hypothesis portfolio (mechanism, evidence trail, novelty basis, proposed experiment) + open tensions and compositions. |
| `vkf_run_experiment` | Run the measurement command; capture `METRIC name=value`. |
| `vkf_log_experiment` | Record a result as a tree node (branches from `parent_id`, judged vs the parent's value), write it back to memory with a profile-2 reproduction block, update belief from accumulated evidence & lifecycle. |
| `promote_to_global` | Copy a trusted card into the cross-project global memory. |
| `research_graph` | The typed knowledge graph (papers → claims → experiments, conflicts, the search tree) via `vkf graph`. |
| `export_dashboard` | Write browser dashboards: the interactive progress page + the `vkf html` idea-lineage graph. |
| `research_status` | Show session experiments + memory lifecycle. |

</details>

<details>
<summary><strong>Skills</strong></summary>

| Skill | Role |
|-------|------|
| `autoresearch-vkf` | Orchestrator / spine — the entry point. |
| `autoresearch-vkf-knowledge-gather` | Find candidate techniques via WebSearch/WebFetch (arXiv / Semantic Scholar / OpenAlex / GitHub). |
| `autoresearch-vkf-claim-extract` | Distill sources into reusable claim cards. |
| `autoresearch-vkf-claim-verify` | Check citations & codebase fit — the trust layer. |
| `autoresearch-vkf-contradiction-miner` | Turn tensions in memory into novel hypotheses. |
| `autoresearch-vkf-cross-domain-transfer` | Import a mechanism from another field. |
| `autoresearch-vkf-idea-tournament` | Multi-perspective debate to pick the 2–3 ideas worth testing. |
| `autoresearch-vkf-hypothesis-loop` | Pick the next idea and run the smallest falsifying experiment. |
| `autoresearch-vkf-research-plan` | Ideation mode: turn the knowledge base into a ranked research agenda (no metric needed). |
| `autoresearch-vkf-research-report` | The auditable lineage report. |

</details>

<details>
<summary><strong>Knowledge sources</strong></summary>

The extension stores and reasons over knowledge; it does **not** fetch papers
itself. Gathering is done by the host agent through the
`autoresearch-vkf-knowledge-gather` skill, using the agent's built-in
**`WebSearch` + `WebFetch`** against free, openly accessible databases — no API
keys, no paid services, no MCP setup:

- **arXiv** (`arxiv.org`, `export.arxiv.org/api`)
- **Semantic Scholar** (`api.semanticscholar.org` Graph API)
- **OpenAlex** (`api.openalex.org`)
- **Crossref** (`api.crossref.org`)
- GitHub / docs / benchmark reports / blogs for implementation hints

The agent reads sources and calls `remember_claim` to persist each finding as a
VKF card. If the host has no web tools, you can still ingest by pasting papers /
PDFs / findings for the agent to extract, or by seeding claims from the agent's
own knowledge (marked low-reliability until verified).

</details>

<details>
<summary><strong>Configuration</strong></summary>

| Variable | Purpose |
|---|---|
| `PI_AUTORESEARCH_VKF` | Path to the `vkf` executable (overrides auto-detection). |
| `PI_AUTORESEARCH_VKF_CONDA_ENV` | Conda env to find `vkf` in (default `VKF`). |
| `PI_AUTORESEARCH_GLOBAL_ROOT` | Root for the global cross-project memory (default `~`, i.e. `~/.autoresearch-vkf/memory/`). |
| `PI_AUTORESEARCH_SHORTCUT` | Key for the fullscreen dashboard (default `alt+g`; `none` to disable). |
| `PI_AUTORESEARCH_OPEN_SHORTCUT` | Key to open the progress page in the browser (default `alt+o`; `none` to disable — `/research-open` still works). |

</details>

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --experimental-strip-types --test tests/*.test.mjs
npm run bench       # standard autoresearch vs ours
```

`npm test` requires a Node 22+ build with TypeScript stripping support (the same
requirement pi has for loading `.ts` extensions). On a Node built without it, run
the tests through a loader instead, e.g. `node --import tsx --test tests/*.test.mjs`.

<details>
<summary><strong>Publishing</strong></summary>

The package ships its `.ts` extensions and `.md` skills as-is (pi loads them
directly — no build step). The `files` whitelist publishes only `extensions/`,
`skills/`, and the docs; `prepublishOnly` runs `typecheck` as a gate.

Two ways to release:

- **Tagged CI release (recommended).** Add an npm *Automation* token as the repo
  secret `NPM_TOKEN`, then bump the version and push a matching tag — the
  [`publish.yml`](.github/workflows/publish.yml) workflow publishes with provenance:
  ```sh
  npm version patch        # or minor/major — updates package.json + makes a tag
  git push --follow-tags
  ```
- **Manual.** `npm login`, then:
  ```sh
  npm publish --access public      # prepublishOnly runs typecheck first
  ```

Verify what will ship first with `npm pack --dry-run`.

</details>

## Roadmap

All four planned phases are in: the lean MVP (Phase 1), the **novelty scorer**
(Phase 2), the **hypothesis-synthesis layer** (Phase 3 — `find_contradictions`,
`find_transfers`, `autoresearch-vkf-idea-tournament`), and **global cross-project
memory + the benchmark** (Phase 4). v0.9.0 adds the **experiment tree-search**
loop (`plan_next_step`), **evidence-based belief**, **profile-2 reproduction
blocks**, the typed `research_graph`, and an interactive dashboard.

Possible next steps:

- **End-to-end live benchmark** — a real LLM agent on real repos with human
  novelty ratings (the controlled harness here isolates the search policy).
- **Tree-aware benchmark** — extend the harness to credit backtracking / node
  re-expansion, not just the idea-selection policy.

## License

MIT
