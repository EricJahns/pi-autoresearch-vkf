# Changelog

## 0.10.0

Autonomy, ideation mode, and multi-agent research. The loop now keeps itself
running, can produce a research *plan* (not just a metric delta), and avoids
hyperparameter tweaks unless explicitly asked to tune.

- **Autonomy contract.** New `autonomy: "continuous" | "confirm-each"` on
  `init_research` (default continuous). In continuous mode the loop is
  pre-authorized: `plan_next_step` and `vkf_log_experiment` now end every result
  with a continuation directive + budget state (`iteration N/M … continue now`),
  so the agent no longer stalls asking "should I continue?" — the directive
  recurs in tool output where skill prose fades from context. The user's brake
  is a **STOP sentinel** (`.autoresearch-vkf/session/STOP`): `vkf_run_experiment`
  refuses to run while it exists and the loop tools tell the agent to halt and
  report. The orchestrator + hypothesis-loop skills carry the matching contract
  (valid stop conditions only; check-ins are a contract violation).
- **Novel-over-knobs by default.** The default (`high`) altitude mode now
  penalizes hyperparameter-altitude ideas ~3× (affinity 0.7 → 0.35), and the
  skills forbid proposing knob tweaks at all unless the user explicitly asked
  for tuning (`tuning` mode restores parity) or a knob is demonstrably the
  limiting factor.
- **Ideation mode + `draft_research_plan`.** `init_research` without a
  `command` starts an *ideation* session: no measurement loop; the deliverable
  is `session/research_plan.md` — a ranked hypothesis portfolio (mechanism,
  evidence trail, novelty basis, proposed falsifying experiment) plus open
  tensions and composition opportunities. New skill
  `autoresearch-vkf-research-plan` orchestrates it.
- **`find_compositions` (synthesis).** New pure `findCompositions` + tool:
  pairs of *trusted* claims with complementary mechanisms (goal-relevant, low
  mechanism overlap, different levers boosted) — hypotheses no single source
  states, the kind the benchmark's optima are made of.
- **Multi-agent research.** Skills now fan out independent work when the host
  supports sub-agents (parallel gatherers per sub-topic, parallel claim
  verification, idea-tournament roles as truly independent judges with an
  advocate/skeptic rebuttal round); memory writes stay with the spine.
- **Structured handoff.** `session/prompt.md` is now a fixed-schema handoff
  (Current state / Open questions / Dead ends / Key wins / Open directions)
  carrying the autonomy directive, so a fresh agent resumes — and keeps going —
  from the file alone.
- **UI.** Widget + Alt+G overlay gain a loop-state line (mode · autonomy ·
  iteration N/M, `⏸ STOP requested`, `★ new best`); the browser dashboard gains
  the same status header with a budget burn-down bar and a Research-plan panel
  that live-refreshes with `data.json`.

## 0.9.1

Dashboard redesign: wider, denser, and the idea-lineage graph is now built in.

- **Wider, multi-column layout.** The progress page grew from a narrow 1100px
  column to a fluid layout (up to 1680px) that uses the horizontal space: chart +
  selected-node, search-tree + knowledge-graph, and coverage + memory each sit
  side by side, collapsing to a single column under ~1020px. Fixes the big blank
  band that the old 2fr/1fr split left down the middle.
- **Knowledge graph, embedded.** The paper → claim → experiment lineage is now a
  panel on the progress page itself, not just the separate `dashboard.html`. It is
  built **CLI-free** in `progress_data.ts` (`buildLineage`) from session + memory
  state, so it rides in every `data.json` payload and survives live refreshes
  (unlike the `vkf graph` output, which only the export path attaches). Nodes are
  coloured by type/outcome and laid out left-to-right by lineage rank; clicking an
  experiment node selects it in the search tree and detail panel too. `dashboard.html`
  (`vkf html`) remains the richer typed view with conflict edges.
- New optional `papers`/`lineageClaims` inputs to `buildDashboardData`; payload
  gains a `lineage` field. Backward compatible (both default to empty / the
  surfaced claims).

## 0.9.0

A major release that turns the loop into an explicit search and makes memory and
the dashboard first-class. Inspired by agentic tree-search (AIDE, The AI Scientist
v2) and RD-Agent's structured Research→Development cycle.

- **Experiment tree-search.** Experiments are now *nodes* in a search tree: each
  branches from a `parent_id` and is judged against the **parent's value**, not one
  global baseline. The loop can build on the best node or backtrack and branch out
  of a dead end. New pure `tree.ts` (`buildTree`, `bestNode`, `frontier`,
  `selectExpansion`); `Experiment` gains `parent_id`/`node_kind`/`depth` (all
  optional — legacy sessions read as a linear chain).
- **`plan_next_step` tool.** Best-first expansion that decides *which node to
  expand* and *which idea to apply* together, honoring the explore/exploit budget.
  `vkf_log_experiment` takes `parent_id`/`node_kind`/`next_suggestions`.
- **Belief from evidence.** Claim belief is now the mean of a Beta posterior over
  the accumulated win/loss tally (`beliefFromEvidence`), persisted on the card —
  repeated tests compound instead of a fixed ±delta overwriting history.
- **Profile-2 reproduction blocks.** Experiment cards carry a `verification`
  reproduction block (command + expected metric), so `vkf validate --profile 2`
  passes (closes the roadmap item). Parent/claim edges are written so `vkf graph`
  renders the real lineage + search tree.
- **`research_graph` tool.** Surfaces the typed `vkf graph` (nodes + edges);
  degrades cleanly without the CLI. **Freshness** now down-weights stale knowledge
  in scoring instead of only warning.
- **Interactive dashboard.** `progress.html` is rebuilt as a self-contained
  vanilla-JS app (no build, no deps) that fetches a `data.json` sidecar and
  re-renders **in place** (filters/scroll/selection survive refresh — no more
  whole-page `<meta refresh>`). Adds a multi-metric chart with series toggles +
  log scale + hover tooltips, an interactive **search-tree** view with a node
  detail panel, a lever × altitude **coverage heatmap**, belief bars, a
  filter/sortable experiment table, and a light/dark toggle.

## 0.8.11

- **Fix: alt+g dashboard now updates live.** The fullscreen overlay rendered once
  and never refreshed, so it went stale while the agent kept working. It now
  re-reads the session on a 1s timer and asks the TUI to redraw, so experiments,
  metrics, and memory state track agent progress while the overlay is open (the
  timer is cleared when you close it).

## 0.8.10

- **No repeated small-knob fine-tuning.** Generalizes the 0.8.9 "train longer"
  guard to all low-altitude hyperparameter tweaks (LR-schedule shape, warmup,
  batch size, weight decay, dropout, …). They may be tried once but must never
  become the loop's default move, and the same knob isn't tuned again unless it's
  demonstrably the limiting factor — the last adjustment gave a significant gain
  and the metric is still clearly improving, not stagnating. Once returns flatten,
  the loop abandons the knob and goes higher-altitude.

## 0.8.9

Bias the loop toward research over reflexive tweaking.

- **More research between experiments.** The hypothesis loop now treats literature
  gathering and synthesis (contradiction-mining, cross-domain transfer) as a
  recurring step, not a one-shot up-front phase — especially after a loss, a
  surprise, or when the remaining ideas are all incremental. The agent should read
  more between goes and pick from a richer, better-grounded idea set.
- **"Just train longer" is no longer a go-to.** Increasing epochs / training steps
  is penalized as a standard-playbook move and the hypothesis-loop skill blocks it
  unless the user explicitly asks to tune the training budget, or there's direct
  evidence of under-training. Same caution for other pure-budget knobs.

## 0.8.8

- **Fix: fullscreen overlay (alt+g) crash on narrow terminals.** The overlay
  rendered un-truncated lines, so a long goal/description/claim title wider than
  the terminal crashed pi (`Rendered line … exceeds terminal width`). Each line is
  now clipped to the viewport width with the ANSI-aware `truncateToWidth`.

## 0.8.7

Nicer widget: color and run numbers.

- **Colored widget & overlay.** The live widget and fullscreen overlay now use
  ANSI color (named colors that follow your terminal theme): green wins / red
  losses / yellow inconclusive, a bold-accent brand line, muted scaffolding, and
  the status + primary-metric columns tinted by outcome. Honors `NO_COLOR`.
- **Run-number column + newest-at-bottom.** The runs table gains a `#` column and
  is ordered oldest→newest (newest highlighted at the bottom); the shortcut hint
  moved into the header block so pi's bottom-truncation can't hide it.

## 0.8.6

Avoid pi's reserved keybindings.

- **Default shortcuts moved to alt+.** The fullscreen dashboard and open-in-browser
  shortcuts now default to **alt+g** and **alt+o** (were `ctrl+g`/`ctrl+o`), which
  pi reserves. Override with `PI_AUTORESEARCH_SHORTCUT` /
  `PI_AUTORESEARCH_OPEN_SHORTCUT` as before.

## 0.8.5

Make novelty structural and reserve budget for high-altitude bets — so the loop
stops defaulting to incremental hyperparameter tuning (unless that's the goal).

- **Structural novelty.** `score_ideas` novelty now blends lexical distance with
  *structural* novelty: how under-explored an idea's `lever·altitude` bucket is.
  A reworded tweak to a bucket you've already hammered now scores low even though
  its wording is fresh — the gap the old lexical-only novelty couldn't see.
- **Altitude bias (goal-gated).** Priority gains an `altitude_affinity` factor.
  Open-ended goals mildly favor mechanism/reframe ideas; an explicit tuning goal
  ("tune", "sweep", "hyperparameter", "grid search") sets it to neutral so tweaks
  rank normally — if you asked for tuning, you get tuning.
- **Explore/exploit budget.** `score_ideas` returns a budget-balanced shortlist
  that reserves `⌈exploreFraction·k⌉` slots for explore bets (high-altitude or
  under-explored buckets) even when their raw priority is lower, with bucket
  diversification so the batch isn't k near-duplicates. Default 30% exploration;
  0% under a tuning goal.
- **`set_research_mode`** tool steers `explore_fraction` / `altitude_preference`
  mid-run. The hypothesis-loop skill now tells the agent to honor the explore
  quota across a run.

## 0.8.0

Tag ideas by *lever* and *altitude*, and surface a coverage map (the rut-detector).

- `remember_claim` gains **`lever`** (which part of the system an idea touches:
  data / objective / representation / algorithm / architecture / evaluation /
  constraints) and **`altitude`** (how big the change is: hyperparameter <
  component < mechanism < reframe). Both are domain-neutral, so they work for any
  optimization target, not just ML.
- Experiments inherit the tested claim's lever/altitude, so coverage reflects what
  was actually run. Tags are persisted on the durable experiment card too.
- The widget shows a **coverage line**: how runs spread across `lever·altitude`
  buckets plus the levers never touched — e.g. `algorithm·hp ×11 · architecture·mech
  ×1 | untouched: data, objective, constraints`. One glance shows when the loop is
  stuck tweaking one corner.
- Claim-extract / contradiction-miner / cross-domain-transfer skills now instruct
  the agent to tag every claim.

This is groundwork: a later release uses these tags for structural-novelty scoring
and an explore/exploit experiment budget.

## 0.7.0

Turn the live widget into a tabular experiment view and add a one-key browser open.

- The above-editor widget now shows a **table of the recent runs** — truncated
  7-char commit, a column per recorded metric, status (keep/discard/outcome), and
  a short description — above run/kept/discarded counts and the memory tally.
  Columns are data-driven from each run's `METRIC name=value` lines (no metric
  names are hardcoded; the session's configured metric is pinned first), capped at
  5 columns for readability — the browser page still has every metric.
- Experiments now persist **all** parsed metrics and the capturing commit (the
  working dir's `HEAD` by default), not just the primary metric value.
- **Open in browser**: press **Ctrl+O** (configurable via
  `PI_AUTORESEARCH_OPEN_SHORTCUT`) or run **`/research-open`** to launch the live
  `progress.html` in your default browser. The widget footer advertises the keys.

## 0.6.0

Add keyless web access so the gather step works on stock pi.

- New tools **`WebSearch`** (DuckDuckGo HTML, no API key) and **`WebFetch`**
  (JSON/text verbatim, HTML reduced to readable text). The pi host ships no web
  tools, but `autoresearch-vkf-knowledge-gather` assumed they existed — the agent
  reported it had no web search. These supply the named tools the skill already
  references, against the free literature APIs (arXiv, OpenAlex, Crossref,
  Semantic Scholar). No session required; no setup or keys.
- Tool names match Claude-Code casing so `pi-ai`'s tool-name table keeps prompt
  caching aligned. `WebSearch` degrades gracefully to a WebFetch-an-API hint when
  the search backend rate-limits or changes layout.

Make the browser progress dashboard automatic and live.

- `progress.html` is now written on `init_research` (so it exists from iteration
  zero) and refreshed after every `remember_claim`, `verify_claim`, and
  `vkf_log_experiment`. Previously it was only written when the agent explicitly
  called `export_dashboard`, which most runs never did — so the dashboard was
  effectively never created and never updated during a run.
- The page already meta-refreshes itself, so an open browser tab now tracks the
  loop live with no manual step. `export_dashboard` is now for the heavier
  vkf-CLI idea-lineage graph (`dashboard.html`), a custom refresh interval, or
  opening the page in a browser.

## 0.5.2

Prefixed all skill names with `autoresearch-vkf-` to avoid namespace conflicts
with other tooling. Renamed `knowledge-gather`, `claim-extract`, `claim-verify`,
`contradiction-miner`, `cross-domain-transfer`, `idea-tournament`,
`hypothesis-loop`, and `research-report`; all cross-references in the skills,
the README, and the extension were updated accordingly. No behavior change.


## 0.5.1

Fix tool/skill name collisions with pi-autoresearch (both can now load together).

- Tools `run_experiment` → **`vkf_run_experiment`** and `log_experiment` →
  **`vkf_log_experiment`** (pi-autoresearch registers the bare names; pi requires
  globally-unique tool names across loaded extensions).
- Skill `autoresearch-create` → **`autoresearch-vkf`** (pi-autoresearch ships a
  skill of the same name). Invoke the loop via the `autoresearch-vkf` skill now.
- Docs/skills/benchmark updated accordingly. No behavior change.

## 0.5.0 — first published release

Self-contained workspace (breaking path change).

- All package state now lives under a single namespaced directory,
  `.autoresearch-vkf/`, with `session/` (ephemeral run state, was `.auto/`) and
  `memory/` (the VKF bundle, was `.research-memory/`). This stops the session dir
  from colliding with pi-autoresearch's `.auto/` and makes the package's
  footprint obvious and self-contained.
- Global memory moves to `~/.autoresearch-vkf/memory/`;
  `PI_AUTORESEARCH_GLOBAL_ROOT` now names the *root* (default `~`).
- Internal: hardcoded `${root}/.research-memory` paths replaced with
  `memoryPaths(root)`; `paths.ts` exposes `pkgDir` and the session/memory
  subdir layout. Existing bundles can be migrated by moving `.auto` →
  `.autoresearch-vkf/session` and `.research-memory` → `.autoresearch-vkf/memory`.

## 0.4.0 — unreleased

Phase 4: global cross-project memory + a benchmark vs standard autoresearch.

- **Global shared memory**: a cross-project VKF bundle (default
  `~/.config/pi-autoresearch-vkf`, override `$PI_AUTORESEARCH_GLOBAL_ROOT`),
  reusing the same card helpers via a `globalRoot()` resolver.
- **`promote_to_global` tool**: copies a trusted card (source_verified+) into
  global memory with a transaction; only durable, verified knowledge is shareable.
- **`recall_memory` `scope`** param (`project` / `global` / `both`) surfaces
  knowledge learned in other repos.
- **Benchmark harness** (`benchmark/`): standard blind autoresearch vs ours over
  deterministic, ground-truth idea-environments. Ours is driven through the *real*
  `scoring.ts` (rankIdeas) and `synthesis.ts` (findContradictions), so it
  benchmarks shipped code. Metrics: best improvement, unique mechanisms, wasted
  experiments, dead-ends retried, synthesized ideas, found-optimum rate. `npm run
  bench`; `--update-readme` writes results between `<!-- BENCH:START/END -->`.
- Across scenarios, ours reaches the (synthesis-only) optimum 100% vs 0%, with
  ~3× the best improvement, zero repeats, and fewer dead-end retries.

Dashboards:
- New `export_dashboard` tool writes two self-contained browser pages to `.auto/`:
  `progress.html` (inline-SVG metric-over-time chart, experiment timeline, memory
  lifecycle; auto-refreshing) and `dashboard.html` (the interactive idea-lineage
  graph via `vkf html`).
- `progress_html.ts` is a pure, unit-tested renderer (no JS/asset deps); `vkf.ts`
  gains an `html()` bridge wrapper.

Knowledge ingestion:
- `knowledge-gather` uses the agent's built-in `WebSearch` / `WebFetch` against
  free, openly accessible databases — arXiv, Semantic Scholar, OpenAlex, Crossref
  — with no API keys, paid services, or MCP setup.
- README documents ingestion and the free sources used.

## 0.3.0 — unreleased

Phase 3: hypothesis synthesis — generate novel ideas, don't just retrieve them.

- **`synthesis.ts`** (pure, unit-tested): mechanism/context/topic similarity;
  contradiction mining (explicit conflicts, outcome flips, same-goal/different-
  mechanism); cross-domain transfer scored by `mechanism_sim × (1 − context_sim)`.
- **`find_contradictions` tool** — surfaces tensions in memory as generative
  hypothesis questions.
- **`find_transfers` tool** — mechanism (not keyword) search for cross-domain
  analogies to import into the current problem.
- **Idea provenance** — `remember_claim`/`buildClaimCard` accept `origin`
  (literature / contradiction / transfer / synthesis) and `derived_from`, so
  agent-synthesized hypotheses are traceable to their seeds.
- **New skills**: `contradiction-miner`, `cross-domain-transfer`,
  `idea-tournament`; orchestrator updated with a synthesis step.

## 0.2.0 — unreleased

Phase 2: novelty & priority scoring.

- **`score_ideas` tool** ranks untested claims by
  `priority = expected_value × feasibility × evidence_strength × novelty ×
  info_gain ÷ implementation_cost`, returning the full factor breakdown.
- **`scoring.ts`** (pure, unit-tested): token Jaccard novelty that penalizes
  similarity to already-tried experiments, settled claims, and a configurable
  standard playbook; evidence strength derived from verification level +
  reliability; info-gain from belief uncertainty.
- **Scoring inputs on claims**: `remember_claim` accepts optional
  `expected_value`, `feasibility`, `info_gain`, `implementation_cost`; all factors
  fall back to sensible derivations when omitted.
- `hypothesis-loop` now scores instead of guessing the next experiment.

## 0.1.0 — unreleased

Initial MVP: autoresearch with verifiable long-term memory.

- **Two-layer persistence**: ephemeral `.auto/` session + durable
  `.research-memory/` VKF bundle that persists across runs.
- **Seven tools**: `init_research`, `remember_claim`, `verify_claim`,
  `recall_memory`, `run_experiment`, `log_experiment`, `research_status`.
- **Six skills**: `autoresearch-create` (spine), `knowledge-gather`,
  `claim-extract`, `claim-verify`, `hypothesis-loop`, `research-report`.
- **VKF bridge**: shells out to the `vkf` CLI (auto-detected in a `VKF` conda env
  or via `$PI_AUTORESEARCH_VKF`) for validation, graph, freshness, and permission
  checks; reads/writes bundle markdown directly. Degrades gracefully when `vkf`
  is absent.
- **Trust lifecycle**: memory states (candidate → source_verified →
  locally_tested/replicated → contradicted → deprecated → retired) mapped onto
  VKF `status` + a staging/verified/deprecated directory layout, with a
  transaction record for every change (propose-don't-promote).
- **Belief updates**: numeric belief per claim, mirrored to VKF's categorical
  `confidence`, updated on each experiment outcome.
- Generated bundles validate at VKF Profile 1 (governed).
