# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`pi-autoresearch-vkf` is a **[pi](https://pi.dev) extension** (not a standalone
app) that turns a blind optimization loop into a self-improving researcher with
verifiable long-term memory. pi loads the `.ts` extensions and `.md` skills
**directly — there is no build step**. The memory layer is VKF (Verifiable
Knowledge Format): markdown + YAML cards with a trust lifecycle, optionally gated
by the real `vkf` CLI.

See `README.md` for the user-facing tool/skill reference, configuration env vars,
and benchmark results — don't duplicate those tables here.

## Commands

- `npm run typecheck` — `tsc --noEmit`. The real correctness gate (also runs in `prepublishOnly`).
- `npm test` — `node --experimental-strip-types --test tests/*.test.mjs`.
  **Gotcha:** on a Node build without TypeScript stripping this fails with
  `ERR_NO_TYPESCRIPT`. Fall back to the tsx loader:
  `node_modules/.bin/tsx --test tests/*.test.mjs` (or `node --import tsx --test tests/*.test.mjs`).
- Run a single test file: `node --experimental-strip-types --test tests/scoring.test.mjs`
  (or via tsx as above).
- `npm run bench` — `benchmark/run.ts --seeds 500`: standard blind loop vs. ours over
  deterministic ground-truth scenarios. The harness lives in `benchmark/`
  (`scenarios.ts` defines the ground-truth idea-environments, `harness.ts` runs both
  policies — *ours* through the real `scoring.ts`/`synthesis.ts`, `run.ts` is the entry
  point and can rewrite the `BENCH:START/END` block in `README.md`).

Node >= 22 is required.

## Architecture

The split is deliberate: **the extension is the machinery; the skills are the
domain knowledge.** The extension (`extensions/pi-autoresearch-vkf/`) provides
deterministic, unit-testable tools; the skills (`skills/`) are markdown that tell
the host agent how to search literature, extract claims, and pick experiments.

### Extension entry point and tools

`extensions/pi-autoresearch-vkf/index.ts` is the single `registerTool` site. Each
tool is a typebox-validated `pi.registerTool(...)`. The loop's spine:
`init_research` → `remember_claim` → `verify_claim` → `recall_memory` →
`plan_next_step` (best-first tree expansion: which node to branch from + which idea)
→ `vkf_run_experiment` → `vkf_log_experiment` (records a tree node), plus synthesis
(`find_contradictions`, `find_transfers`, `find_compositions`), `score_ideas`,
`draft_research_plan` (the ideation-mode deliverable — init without a `command`
makes the session `ideate`), `research_graph` (`vkf graph`), `promote_to_global`,
dashboards, and keyless `WebSearch`/`WebFetch` (the pi host ships no web tools, so
the extension provides them, named to match the skill text).

**Autonomy:** the loop is pre-authorized by default (`autonomy: "continuous"`).
`continuationNote` in `index.ts` appends the continue-don't-ask directive + budget
state to every `plan_next_step`/`vkf_log_experiment` result (tool output recurs in
context; skill prose fades — that's why it lives here, not only in the skills).
The user's brake is the `session/STOP` sentinel, checked by `vkf_run_experiment`.

### The memory model (`cards.ts`)

Durable knowledge is VKF cards (markdown + YAML frontmatter) under
`.autoresearch-vkf/memory/`, one card per research atom (`paper` | `claim` |
`concept` | `experiment`). The key abstraction is the **memory-state lifecycle**,
which is NOT a parallel state machine — it maps directly onto VKF's `status` plus
a lifecycle *directory* via `STATE_MAP`:

`candidate`(staging) → `source_verified` / `locally_tested` / `replicated`(verified)
→ `contradicted` / `deprecated` / `retired`(deprecated).

`isTrustedForHypotheses()` is the trust gate. `transitionCard()` rewrites
frontmatter and moves the file between buckets. **Promotion is never silent:**
every change writes a transaction record (`writeTransaction`) — the audit trail
and the defense against memory poisoning. `cards.ts` is intentionally pure
(`node:fs` + `frontmatter.ts` only) so it's unit-testable without the pi runtime.

### Workspace layout (`paths.ts`)

Everything lives under one namespaced dir so it never collides with other tools:
- `.autoresearch-vkf/session/` — ephemeral per-run state (config, experiment log, measure.sh, dashboards). Gitignorable.
- `.autoresearch-vkf/memory/` — the durable VKF bundle (papers/claims/experiments). Meant to be committed.
- Global cross-project memory uses the **same shape** at `~/.autoresearch-vkf/`
  (override via `$PI_AUTORESEARCH_GLOBAL_ROOT`). It's just another `root`, so every
  card/path helper works on it unchanged — this is why helpers take a `root` arg.

### The `vkf` CLI bridge (`vkf.ts`)

VKF is **optional**. The extension reads/writes the bundle markdown itself and
shells out to the `vkf` CLI only for validation, the typed graph, freshness, and
the lineage HTML. If the CLI isn't found, tools degrade cleanly ("memory works,
validation skipped") instead of failing. Resolution order: `$PI_AUTORESEARCH_VKF`
→ a `vkf` binary in the conda env named by `$PI_AUTORESEARCH_VKF_CONDA_ENV`
(default `VKF`) → `conda run`.

### Search tree, scoring & synthesis

- `tree.ts` — the experiment **search tree** (pure). `buildTree`/`bestNode`/
  `frontier` turn the flat `experiments.json` into a tree (inferring a linear chain
  for legacy rows); `selectExpansion` does best-first expansion (which node to
  branch from + which idea), reusing `selectBalanced`. Each `Experiment` carries
  `parent_id`/`node_kind`/`depth`; outcomes are judged against the *parent node's*
  value (`nodeBaseline` in `experiments.ts`), not one global baseline.
- `scoring.ts` — ranks untested ideas by
  `EV × feasibility × evidence × novelty × info_gain × altitude_affinity × freshness ÷ cost`,
  where novelty blends lexical (Jaccard) distance with *structural* novelty (how
  under-explored the idea's lever·altitude bucket is) and `freshness` down-weights
  stale cards. `selectBalanced` reserves explore slots for high-altitude bets.
- `synthesis.ts` — `findContradictions` / `findTransfers` generate novel
  hypotheses from tensions and cross-domain mechanism matches.
- Claim belief is the mean of a Beta posterior over the win/loss tally
  (`beliefFromEvidence` in `cards.ts`), persisted on the card so evidence compounds.
- `Lever` (data/objective/representation/algorithm/architecture/evaluation/constraints)
  and `Altitude` (hyperparameter/component/mechanism/reframe) are domain-neutral
  tags that drive coverage and structural novelty (defined in `cards.ts`).

### Dashboard

`progress_data.ts` (pure) builds the `data.json` payload; `progress_html.ts` emits
a self-contained vanilla-JS shell that fetches that sidecar and re-renders in place
(no build, no deps). `index.ts`'s `writeProgressDashboard` writes both on every
state change. Keep the client JS in `progress_html.ts` as the array-of-lines
`APP_JS` so its own template literals don't clash with the module's template
strings. The page embeds an idea-lineage graph (paper → claim → experiment) built
**CLI-free** by `buildLineage` in `progress_data.ts` so it rides in every payload
and survives live refresh; the heavier *typed* `vkf html` lineage (with conflict
edges) stays in `export_dashboard`. The
in-terminal views are separate: the always-on widget and the Alt+G fullscreen
overlay (`research_status`) render through `dashboard.ts`/`render.ts`/`style.ts`.

### Skills

`skills/autoresearch-vkf/SKILL.md` is the orchestrator/spine; the rest are
sub-skills (knowledge-gather, claim-extract, claim-verify, contradiction-miner,
cross-domain-transfer, idea-tournament, hypothesis-loop, research-plan,
research-report) it delegates to. Skills are prose, not code — keep tool names in skill text in sync
with the actual tool names in `index.ts`, since the agent matches on them.

## Conventions

- TS is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`; imports
  use explicit `.ts` extensions (`allowImportingTsExtensions`).
- Tests are `.mjs` under `tests/`, importing the `.ts` modules directly; keep the
  pure modules (`cards.ts`, `scoring.ts`, `synthesis.ts`, `frontmatter.ts`, etc.)
  free of pi-runtime imports so they stay testable.
- Bump the version in `package.json` per change (the CHANGELOG tracks releases);
  publishing is tag-driven CI (`.github/workflows/publish.yml`) with `typecheck` as the gate.
