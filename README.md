# pi-autoresearch-vkf

> **Autoresearch that remembers — and can prove what it learned.**

A [pi](https://pi.dev) extension that turns a blind optimization loop into a
self-improving researcher with **verifiable long-term memory**. It gathers
frontier literature, distills it into structured claims, *verifies* them, runs
experiments, and writes the results back to a git-native knowledge bundle — so the
next run builds on what was learned instead of rediscovering the obvious.

The memory layer is [VKF](https://github.com/EricJahns/Verifiable-Knowledge-Format)
(Verifiable Knowledge Format): markdown + YAML knowledge objects with provenance,
evidence, confidence, and a trust lifecycle, gated by the real `vkf` CLI.

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

The novelty isn't "autoresearch + RAG." It's that the agent's scientific memory is
**verifiable, lifecycle-managed, and auditable**.

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

- **`vkf` CLI** — the extension finds it automatically inside a conda env named
  `VKF`, or set `$PI_AUTORESEARCH_VKF` to the `vkf` executable.

### Knowledge sources (how ingestion works)

The extension stores and reasons over knowledge; it does **not** fetch papers
itself. Gathering is done by the host agent through the `knowledge-gather` skill,
using the agent's built-in **`WebSearch` + `WebFetch`** against free, openly
accessible databases — no API keys, no paid services, no MCP setup:

- **arXiv** (`arxiv.org`, `export.arxiv.org/api`)
- **Semantic Scholar** (`api.semanticscholar.org` Graph API)
- **OpenAlex** (`api.openalex.org`)
- **Crossref** (`api.crossref.org`)
- GitHub / docs / benchmark reports / blogs for implementation hints

The agent reads sources and calls `remember_claim` to persist each finding as a
VKF card. If the host has no web tools, you can still ingest by pasting papers /
PDFs / findings for the agent to extract, or by seeding claims from the agent's
own knowledge (marked low-reliability until verified).

## Usage

In a project you want to optimize:

```
optimize the test suite runtime, using the research literature and remembering what works
```

The **autoresearch-create** skill drives it: confirm goal/metric/command → init →
gather literature → extract & verify claims → loop (recall → experiment →
write-back) → report. All state lives in one self-contained `.autoresearch-vkf/`
folder at the project root, so work **survives restarts and context resets**.

## How it works

```
goal ─► recall_memory ─► gather literature ─► remember_claim (candidates)
   │                                              │
   │                                         verify_claim ──► trusted claims
   ▼                                              │
 hypothesis-loop:  recall ─► pick idea ─► run_experiment ─► log_experiment
   │                                                            │
   │                                  writes experiment card back to memory,
   │                                  updates the claim's belief & lifecycle
   ▼
 research-report   (paper → claim → hypothesis → patch → metric Δ → memory update)
```

### One self-contained workspace

Everything the package owns lives under a single namespaced `.autoresearch-vkf/`
directory, so it never collides with other tools and is obvious at a glance:

| Layer | Folder | Lifetime |
|-------|--------|----------|
| **Session** | `.autoresearch-vkf/session/` | this run — goal, experiment log, measure script, dashboards (safe to gitignore) |
| **Project memory** | `.autoresearch-vkf/memory/` | **persists across runs** — the VKF bundle (meant to be committed) |
| **Global memory** | `~/.autoresearch-vkf/memory/` | **persists across projects** — trusted knowledge promoted from any repo |

### The memory lifecycle

Every card carries a trust state. Agents *propose*; promotion is explicit and
audited (a VKF transaction is written for each change). The vision's states map
directly onto VKF `status` + a lifecycle directory:

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

### Tools

| Tool | What it does |
|------|--------------|
| `init_research` | Scaffold the `.autoresearch-vkf/` workspace (session + memory VKF bundle). |
| `remember_claim` | Stage a literature-derived candidate claim (+ its source paper). |
| `verify_claim` | Advance/downgrade a card's trust lifecycle (audited). |
| `recall_memory` | Query memory (project / global / both): trusted claims, candidates, prior experiments, negatives, conflicts. |
| `score_ideas` | Rank untested ideas by `EV × feasibility × evidence × novelty × info_gain ÷ cost`. |
| `find_contradictions` | Mine memory for tensions between claims — each a seed for a novel hypothesis. |
| `find_transfers` | Cross-domain mechanism search: same *how*, different *where*. |
| `run_experiment` | Run the measurement command; capture `METRIC name=value`. |
| `log_experiment` | Record a result, write it back to memory, update belief & lifecycle. |
| `promote_to_global` | Copy a trusted card into the cross-project global memory. |
| `export_dashboard` | Write browser dashboards: a live progress page + the `vkf html` idea-lineage graph. |
| `research_status` | Show session experiments + memory lifecycle. |

### Skills

| Skill | Role |
|-------|------|
| `autoresearch-create` | Orchestrator / spine — the entry point. |
| `knowledge-gather` | Find candidate techniques via WebSearch/WebFetch (arXiv / Semantic Scholar / OpenAlex / GitHub). |
| `claim-extract` | Distill sources into reusable claim cards. |
| `claim-verify` | Check citations & codebase fit — the trust layer. |
| `contradiction-miner` | Turn tensions in memory into novel hypotheses. |
| `cross-domain-transfer` | Import a mechanism from another field. |
| `idea-tournament` | Multi-perspective debate to pick the 2–3 ideas worth testing. |
| `hypothesis-loop` | Pick the next idea and run the smallest falsifying experiment. |
| `research-report` | The auditable lineage report. |

### The `.autoresearch-vkf/` workspace

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

## Tiny-LM validation loss (budget 10)

| Metric | Standard | Ours |
|---|---:|---:|
| Best improvement (higher better) | 0.035 | **0.130** |
| Unique mechanisms tried | 7.8 | **10.0** |
| Wasted (repeat) experiments | 2.2 | **0.0** |
| Dead-ends retried | 1.4 | **1.0** |
| Synthesized ideas discovered | 0.0 | **1.0** |
| Found optimum (rate) | 0% | **100%** |

## Inference latency (budget 8)

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

- **Widget** (always on, above the editor) — win/loss counts, best metric, memory
  state tally; refreshes after every tool call.
- **Fullscreen overlay** — press **Ctrl+G** (or call `research_status`) for the
  full experiment list, memory lifecycle, and verified claims.
- **Browser dashboards** — `export_dashboard` writes two self-contained pages to
  `.autoresearch-vkf/session/`:
  - `progress.html` — metric-over-time chart, experiment timeline, and memory
    lifecycle; auto-refreshes so an open tab tracks the run live.
  - `dashboard.html` — the interactive **idea-lineage graph** (paper → claim →
    experiment, with conflict/derived-from edges), generated by `vkf html`.

  ```sh
  open .autoresearch-vkf/session/progress.html    # watch progress as it goes
  open .autoresearch-vkf/session/dashboard.html   # explore the knowledge lineage
  ```

## Configuration

- `PI_AUTORESEARCH_VKF` — path to the `vkf` executable (overrides auto-detection).
- `PI_AUTORESEARCH_VKF_CONDA_ENV` — conda env to find `vkf` in (default `VKF`).
- `PI_AUTORESEARCH_GLOBAL_ROOT` — root for the global cross-project memory
  (default `~`, i.e. the bundle lives at `~/.autoresearch-vkf/memory/`).
- `PI_AUTORESEARCH_SHORTCUT` — key for the fullscreen dashboard (default `ctrl+g`;
  set to `none` to disable).

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

## Publishing

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

## Roadmap

All four planned phases are in: the lean MVP (Phase 1), the **novelty scorer**
(Phase 2), the **hypothesis-synthesis layer** (Phase 3 — `find_contradictions`,
`find_transfers`, `idea-tournament`), and **global cross-project memory + the
benchmark** (Phase 4).

Possible next steps:

- **End-to-end live benchmark** — a real LLM agent on real repos with human
  novelty ratings (the controlled harness here isolates the search policy).
- **Bundle profile 2** — attach reproduction `verification` blocks to experiment
  cards so memory validates at the strict `verified` profile.

(Knowledge ingestion via `WebSearch`/`WebFetch` against free databases (arXiv,
Semantic Scholar, OpenAlex, Crossref) is built in — see
[Knowledge sources](#knowledge-sources-how-ingestion-works).)

## License

MIT
