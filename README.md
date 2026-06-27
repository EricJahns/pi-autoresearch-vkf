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

You also need the `vkf` CLI for trust gating (validation, graph, freshness,
permissions). The extension finds it automatically inside a conda env named `VKF`,
or set `$PI_AUTORESEARCH_VKF` to the `vkf` executable. Without it, memory still
works but validation is skipped.

## Usage

In a project you want to optimize:

```
optimize the test suite runtime, using the research literature and remembering what works
```

The **autoresearch-create** skill drives it: confirm goal/metric/command → init →
gather literature → extract & verify claims → loop (recall → experiment →
write-back) → report. All state lives in two folders at the project root, so work
**survives restarts and context resets**.

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

### Two layers

| Layer | Folder | Lifetime |
|-------|--------|----------|
| **Session** | `.auto/` | this run — goal, experiment log, measure script |
| **Memory** | `.research-memory/` | **persists across runs** — a VKF bundle |

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
| `init_research` | Scaffold the `.auto/` session and `.research-memory/` VKF bundle. |
| `remember_claim` | Stage a literature-derived candidate claim (+ its source paper). |
| `verify_claim` | Advance/downgrade a card's trust lifecycle (audited). |
| `recall_memory` | Query memory: trusted claims, candidates, prior experiments, negatives, conflicts. |
| `run_experiment` | Run the measurement command; capture `METRIC name=value`. |
| `log_experiment` | Record a result, write it back to memory, update belief & lifecycle. |
| `research_status` | Show session experiments + memory lifecycle. |

### Skills

| Skill | Role |
|-------|------|
| `autoresearch-create` | Orchestrator / spine — the entry point. |
| `knowledge-gather` | Find candidate techniques (Paper Lantern / arXiv / Semantic Scholar / GitHub). |
| `claim-extract` | Distill sources into reusable claim cards. |
| `claim-verify` | Check citations & codebase fit — the trust layer. |
| `hypothesis-loop` | Pick the next idea and run the smallest falsifying experiment. |
| `research-report` | The auditable lineage report. |

### The `.research-memory/` bundle

```
.research-memory/
  vkf.bundle.yaml      # profile 1 (governed); 2 (verified) once evidence lands
  staging/             # candidates (status: draft)
  verified/            # source-/locally-verified, replicated
  deprecated/          # contradicted / retired
  transactions/        # one record per promote/demote/write-back
```

It's just markdown — human-readable, version-controllable, and auditable. Run
`vkf validate .research-memory`, `vkf graph`, `vkf freshness`, or `vkf html` over
it any time.

## Configuration

- `PI_AUTORESEARCH_VKF` — path to the `vkf` executable (overrides auto-detection).
- `PI_AUTORESEARCH_VKF_CONDA_ENV` — conda env to find `vkf` in (default `VKF`).
- `PI_AUTORESEARCH_SHORTCUT` — key for the fullscreen dashboard (default `ctrl+g`;
  set to `none` to disable).

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --experimental-strip-types --test tests/*.test.mjs
```

`npm test` requires a Node 22+ build with TypeScript stripping support (the same
requirement pi has for loading `.ts` extensions). On a Node built without it, run
the tests through a loader instead, e.g. `node --import tsx --test tests/*.test.mjs`.

## Roadmap

This is the lean MVP. Planned next:

- **Novelty scorer & belief dynamics** — `priority = EV × feasibility × evidence ×
  novelty × info_gain ÷ cost`; separate recency vs reliability.
- **Contradiction miner & cross-domain transfer** — generate hypotheses from
  tensions between claims and from mechanism (not keyword) search.
- **Idea tournament** — multi-agent debate over candidate ideas before testing.
- **Global shared memory** — a promoted cross-project bundle.
- **Benchmark** — baseline vs +literature vs +VKF memory.

## License

MIT
