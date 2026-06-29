/**
 * The research-memory model: VKF cards and their lifecycle.
 *
 * Durable knowledge is stored as VKF objects (markdown + YAML frontmatter) under
 * `.autoresearch-vkf/memory/`. Each card is one reusable "research atom": a paper, a
 * claim extracted from it, a concept/mechanism, or an experiment result.
 *
 * The vision's memory states (candidate → source_verified → locally_tested →
 * replicated → contradicted → deprecated → retired) are not a parallel state
 * machine — they map directly onto VKF's `status` lifecycle plus a lifecycle
 * *directory*, so `vkf validate` gates the whole bundle. See {@link STATE_MAP}.
 *
 * This module is pure (only `node:fs` + {@link ./frontmatter.ts}) so it can be
 * unit-tested without the pi runtime. Validation, the typed graph, and freshness
 * are delegated to the real `vkf` CLI in {@link ./vkf.ts}.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import {
  assembleCard,
  parseFrontmatter,
  type YamlValue,
} from "./frontmatter.ts";
import {
  ensureMemoryDirs,
  LIFECYCLE_DIRS,
  lifecycleDir,
  memoryPaths,
  type LifecycleDir,
} from "./paths.ts";

/** The kinds of research atom we store. */
export type CardType = "paper" | "claim" | "concept" | "experiment";

/**
 * Where a piece of knowledge sits in its trust lifecycle. The names follow the
 * project vision; each maps to a VKF `status` and a lifecycle directory.
 */
export type MemoryState =
  | "candidate"
  | "source_verified"
  | "locally_tested"
  | "replicated"
  | "contradicted"
  | "deprecated"
  | "retired";

export const MEMORY_STATES: readonly MemoryState[] = [
  "candidate",
  "source_verified",
  "locally_tested",
  "replicated",
  "contradicted",
  "deprecated",
  "retired",
];

/**
 * Which part of the system under study an idea touches. Deliberately
 * domain-neutral so it works for any optimization target (model loss, test
 * runtime, bundle size, …), not just ML.
 */
export type Lever =
  | "data"
  | "objective"
  | "representation"
  | "algorithm"
  | "architecture"
  | "evaluation"
  | "constraints";

export const LEVERS: readonly Lever[] = [
  "data",
  "objective",
  "representation",
  "algorithm",
  "architecture",
  "evaluation",
  "constraints",
];

/**
 * How big a change an idea is, low to high. `hyperparameter` tweaks a value;
 * `component` swaps a module; `mechanism` changes *how* something works;
 * `reframe` changes *what* is optimized or measured.
 */
export type Altitude = "hyperparameter" | "component" | "mechanism" | "reframe";

export const ALTITUDES: readonly Altitude[] = [
  "hyperparameter",
  "component",
  "mechanism",
  "reframe",
];

/** How a card's content has been checked (the vision's verified_by_* axis). */
export type Verification =
  | "reported_by_paper"
  | "verified_by_agent"
  | "verified_by_local_experiment"
  | "verified_by_independent_reproduction"
  | "contradicted_by_local_experiment";

/** Mapping from a memory state to its VKF status and lifecycle bucket. */
export const STATE_MAP: Record<
  MemoryState,
  { bucket: LifecycleDir; status: string }
> = {
  candidate: { bucket: "staging", status: "draft" },
  source_verified: { bucket: "verified", status: "active" },
  locally_tested: { bucket: "verified", status: "verified" },
  replicated: { bucket: "verified", status: "verified" },
  contradicted: { bucket: "deprecated", status: "disputed" },
  deprecated: { bucket: "deprecated", status: "deprecated" },
  retired: { bucket: "deprecated", status: "retracted" },
};

/** Only states at this trust level or above should drive serious hypotheses. */
export function isTrustedForHypotheses(state: MemoryState): boolean {
  return state === "source_verified" || state === "locally_tested" || state === "replicated";
}

// ── confidence (belief) ───────────────────────────────────────────────────────

/** Map a numeric belief in [0,1] to VKF's categorical claim confidence. */
export function confidenceLabel(value: number): "low" | "medium" | "high" {
  if (value < 0.34) return "low";
  if (value < 0.67) return "medium";
  return "high";
}

/** Update a belief given an experiment outcome. Clamped to (0,1).
 *
 * Kept for callers that only have the previous scalar; prefer
 * {@link beliefFromEvidence} when win/loss tallies are available — it accumulates
 * evidence instead of letting the latest result overwrite the history. */
export function updateBelief(
  current: number,
  outcome: "win" | "loss" | "inconclusive",
): number {
  const delta = outcome === "win" ? 0.15 : outcome === "loss" ? -0.2 : -0.02;
  return Math.min(0.98, Math.max(0.02, current + delta));
}

/**
 * Belief from accumulated evidence: the mean of a Beta(wins+1, losses+1)
 * posterior, `(wins + 1) / (wins + losses + 2)`, clamped to (0.02, 0.98).
 *
 * This is the principled replacement for nudging a scalar by a fixed delta: two
 * wins then a loss lands at a calibrated 0.6, not wherever the last ±delta left
 * it, and the value is reproducible from the recorded tally. Inconclusive runs
 * carry no evidence, so they don't move it. `prior` (default 0.5) only matters
 * before any evidence exists.
 */
export function beliefFromEvidence(wins: number, losses: number, prior = 0.5): number {
  const w = Math.max(0, Math.floor(wins));
  const l = Math.max(0, Math.floor(losses));
  if (w + l === 0) return Math.min(0.98, Math.max(0.02, prior));
  return Math.min(0.98, Math.max(0.02, (w + 1) / (w + l + 2)));
}

// ── identifiers ────────────────────────────────────────────────────────────────

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "untitled";
}

const today = (): string => new Date().toISOString().slice(0, 10);

// ── bundle scaffolding ─────────────────────────────────────────────────────────

/**
 * Create the `.autoresearch-vkf/memory/` VKF bundle if absent: the lifecycle directories
 * and the `vkf.bundle.yaml` manifest. Idempotent. Returns true if it created the
 * manifest (i.e. this was a fresh bundle).
 */
export function scaffoldMemoryBundle(
  root: string,
  name: string,
  profile: 1 | 2,
): boolean {
  const p = ensureMemoryDirs(root);
  if (existsSync(p.bundle)) return false;
  const manifest = [
    "vkf_version: 0.2.0",
    'okf_version: "0.1"',
    `name: ${slugify(name) || "research-memory"}`,
    "summary: Long-term verifiable research memory for autoresearch.",
    `profile: ${profile}`,
    "",
  ].join("\n");
  writeFileSync(p.bundle, manifest, "utf8");
  return true;
}

// ── card shape ─────────────────────────────────────────────────────────────────

export interface Card {
  /** Absolute path on disk. */
  path: string;
  /** Lifecycle bucket the file currently lives in. */
  bucket: LifecycleDir;
  /** Parsed frontmatter. */
  meta: Record<string, YamlValue>;
  /** Markdown body after the frontmatter. */
  body: string;
}

const fileName = (type: CardType, slug: string): string => `${type}-${slug}.md`;

function baseFrontmatter(args: {
  id: string;
  type: CardType;
  title: string;
  state: MemoryState;
  verification: Verification;
  owner: string;
  tags?: string[];
  dependsOn?: string[];
  conflictsWith?: string[];
  confidence?: number;
}): Record<string, YamlValue> {
  const { status } = STATE_MAP[args.state];
  const verifiedStatuses = new Set(["active", "verified"]);
  return {
    vkf_version: "0.2.0",
    id: args.id,
    type: args.type,
    title: args.title,
    status,
    owners: [args.owner],
    visibility: "internal",
    created: today(),
    last_verified: verifiedStatuses.has(status) ? today() : null,
    valid_until: null,
    tags: args.tags ?? [],
    depends_on: args.dependsOn ?? [],
    conflicts_with: args.conflictsWith ?? [],
    // VKF-on-top research-layer fields (the source of truth for our tools):
    memory_state: args.state,
    // `verification` is reserved by VKF for a reproducibility block (command/
    // expected), so the research-layer trust axis uses `verification_level`.
    verification_level: args.verification,
    // Numeric belief is our research-layer field; `confidence` mirrors it onto
    // VKF's categorical enum so the bundle stays schema-valid.
    belief: args.confidence ?? 0.5,
    confidence: confidenceLabel(args.confidence ?? 0.5),
    access: {
      allowed_uses: ["internal_question_answering"] as YamlValue,
      forbidden_uses: ["public_release"] as YamlValue,
    },
  };
}

// ── builders ─────────────────────────────────────────────────────────────────

export interface PaperInput {
  title: string;
  source_url: string;
  authors?: string;
  year?: number;
  summary: string;
  owner: string;
}

export function buildPaperCard(input: PaperInput): { id: string; file: string; content: string } {
  const slug = slugify(input.title);
  const id = `paper:${slug}`;
  const meta = baseFrontmatter({
    id,
    type: "paper",
    title: input.title,
    state: "candidate",
    verification: "reported_by_paper",
    owner: input.owner,
  });
  meta["source_url"] = input.source_url;
  if (input.authors) meta["authors"] = input.authors;
  if (input.year) meta["year"] = input.year;
  const body = [
    `# ${input.title}`,
    "",
    "## Summary",
    "",
    input.summary,
    "",
    "## Source",
    "",
    `- URL: ${input.source_url}`,
    input.authors ? `- Authors: ${input.authors}` : "",
    input.year ? `- Year: ${input.year}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { id, file: fileName("paper", slug), content: assembleCard(meta, body) };
}

export interface ClaimInput {
  title: string;
  /** The single checkable assertion (the research atom). */
  assertion: string;
  mechanism?: string;
  context?: string;
  implementation_recipe?: string;
  failure_modes?: string;
  /** Source paper id (e.g. "paper:adagc"), if any. */
  paper_id?: string;
  source_url?: string;
  recency_score?: number;
  reliability_score?: number;
  confidence?: number;
  /** Priority-scoring inputs (see ./scoring.ts); all optional, in [0,1]. */
  expected_value?: number;
  feasibility?: number;
  info_gain?: number;
  implementation_cost?: number;
  /** Where the idea came from: literature vs an agent-synthesized hypothesis. */
  origin?: "literature" | "contradiction" | "transfer" | "synthesis";
  /** Which part of the system this idea touches (for coverage + novelty). */
  lever?: Lever;
  /** How big a change this idea is (for coverage + novelty). */
  altitude?: Altitude;
  /** Ids of cards this idea was synthesized from (for contradiction/transfer). */
  derived_from?: string[];
  owner: string;
}

export function buildClaimCard(input: ClaimInput): { id: string; file: string; content: string } {
  const slug = slugify(input.title);
  const id = `claim:${slug}`;
  const confidence = input.confidence ?? 0.5;
  const meta = baseFrontmatter({
    id,
    type: "claim",
    title: input.title,
    state: "candidate",
    verification: "reported_by_paper",
    owner: input.owner,
    dependsOn: input.paper_id ? [input.paper_id] : [],
    confidence,
  });
  if (input.mechanism) meta["mechanism"] = input.mechanism;
  if (input.context) meta["context"] = input.context;
  if (input.source_url) meta["source_url"] = input.source_url;
  if (input.recency_score !== undefined) meta["recency_score"] = input.recency_score;
  if (input.reliability_score !== undefined) meta["reliability_score"] = input.reliability_score;
  if (input.expected_value !== undefined) meta["expected_value"] = input.expected_value;
  if (input.feasibility !== undefined) meta["feasibility"] = input.feasibility;
  if (input.info_gain !== undefined) meta["info_gain"] = input.info_gain;
  if (input.implementation_cost !== undefined) meta["implementation_cost"] = input.implementation_cost;
  meta["origin"] = input.origin ?? "literature";
  if (input.lever) meta["lever"] = input.lever;
  if (input.altitude) meta["altitude"] = input.altitude;
  if (input.derived_from && input.derived_from.length) meta["derived_from"] = input.derived_from;

  const evidence = input.paper_id
    ? [`  - source: ${input.paper_id}`, "    type: paper", "    strength: moderate"]
    : ["  - source: (unsourced)", "    type: anecdote", "    strength: weak"];

  const body = [
    `# ${input.title}`,
    "",
    "## Summary",
    "",
    input.assertion,
    "",
    input.mechanism ? "## Mechanism\n\n" + input.mechanism + "\n" : "",
    "## Assertion",
    "",
    ":::claim",
    "---",
    `id: ${id}_assertion`,
    `confidence: ${confidenceLabel(confidence)}`,
    "evidence:",
    ...evidence,
    "---",
    input.assertion,
    ":::",
    "",
    input.implementation_recipe ? "## Implementation recipe\n\n" + input.implementation_recipe + "\n" : "",
    input.failure_modes ? "## Failure modes\n\n" + input.failure_modes + "\n" : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { id, file: fileName("claim", slug), content: assembleCard(meta, body) };
}

export interface ExperimentInput {
  title: string;
  hypothesis: string;
  /** Claim this experiment tested (e.g. "claim:adagc"). */
  claim_id?: string;
  /** Experiment node this one branched from in the search tree (a VKF id). */
  parent_id?: string;
  /** What kind of move this node is, for the lineage graph. */
  node_kind?: string;
  metric_name: string;
  baseline?: number;
  value: number;
  outcome: "win" | "loss" | "inconclusive";
  conditions?: string;
  notes?: string;
  commit?: string;
  /**
   * Reproduction recipe for a profile-2 `verification` block: the command that
   * reproduces this result and the metric value it should print. Lets
   * `vkf validate --profile 2` confirm the experiment is replayable.
   */
  reproduction?: { command: string; metric_name?: string; value?: number; tolerance?: number };
  /** Structured next-step suggestions (RD-Agent-style feedback). */
  next_suggestions?: string[];
  /** Tags inherited from the tested claim (for coverage). */
  lever?: Lever;
  altitude?: Altitude;
  owner: string;
}

export function buildExperimentCard(input: ExperimentInput): {
  id: string;
  file: string;
  content: string;
} {
  const slug = `${slugify(input.title)}_${Date.now().toString(36)}`;
  const id = `experiment:${slug}`;
  // A local experiment is a verified-by-local-experiment artifact regardless of
  // whether the idea won — a loss is a real, recorded negative result.
  const state: MemoryState = "locally_tested";
  const meta = baseFrontmatter({
    id,
    type: "experiment",
    title: input.title,
    state,
    verification:
      input.outcome === "loss"
        ? "contradicted_by_local_experiment"
        : "verified_by_local_experiment",
    owner: input.owner,
    // Depend on the tested claim AND the parent node, so `vkf graph` renders the
    // actual search tree (paper → claim → experiment → experiment …).
    dependsOn: [input.claim_id, input.parent_id].filter((x): x is string => !!x),
  });
  meta["metric_name"] = input.metric_name;
  if (input.baseline !== undefined) meta["baseline"] = input.baseline;
  meta["value"] = input.value;
  meta["outcome"] = input.outcome;
  if (input.commit) meta["commit"] = input.commit;
  if (input.parent_id) meta["parent"] = input.parent_id;
  if (input.node_kind) meta["node_kind"] = input.node_kind;
  if (input.lever) meta["lever"] = input.lever;
  if (input.altitude) meta["altitude"] = input.altitude;
  const delta =
    input.baseline !== undefined ? Number((input.value - input.baseline).toFixed(6)) : undefined;
  if (delta !== undefined) meta["delta"] = delta;

  // Profile-2 reproduction block. VKF reserves `verification` for a reproducibility
  // record (command + expected result); attaching it lets the bundle validate at
  // the strict `verified` profile rather than only the governed profile 1.
  if (input.reproduction) {
    const expected: Record<string, YamlValue> = {
      metric: input.reproduction.metric_name ?? input.metric_name,
      value: input.reproduction.value ?? input.value,
    };
    if (input.reproduction.tolerance !== undefined) expected["tolerance"] = input.reproduction.tolerance;
    meta["verification"] = {
      method: "command",
      command: input.reproduction.command,
      expected,
    } as YamlValue;
  }

  const body = [
    `# ${input.title}`,
    "",
    "## Hypothesis",
    "",
    input.hypothesis,
    "",
    "## Result",
    "",
    `- Metric: ${input.metric_name}`,
    input.baseline !== undefined ? `- Baseline: ${input.baseline}` : "",
    `- Observed: ${input.value}`,
    delta !== undefined ? `- Delta: ${delta}` : "",
    `- Outcome: **${input.outcome}**`,
    "",
    "## Method",
    "",
    input.hypothesis,
    "",
    input.conditions ? "## Conditions\n\n" + input.conditions + "\n" : "",
    input.notes ? "## Notes\n\n" + input.notes + "\n" : "",
    input.next_suggestions && input.next_suggestions.length
      ? "## Next steps\n\n" + input.next_suggestions.map((s) => `- ${s}`).join("\n") + "\n"
      : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { id, file: fileName("experiment", slug), content: assembleCard(meta, body) };
}

// ── persistence ────────────────────────────────────────────────────────────────

function readCardFile(path: string, bucket: LifecycleDir): Card {
  const { data, body } = parseFrontmatter(readFileSync(path, "utf8"));
  return { path, bucket, meta: data, body };
}

/** Write a freshly built card into a lifecycle bucket. Returns the path. */
export function writeCard(
  root: string,
  bucket: LifecycleDir,
  file: string,
  content: string,
): string {
  const dir = lifecycleDir(root, bucket);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, content, "utf8");
  return path;
}

/** List every card, optionally filtered by bucket and/or type. */
export function listCards(
  root: string,
  filter: { bucket?: LifecycleDir; type?: CardType } = {},
): Card[] {
  const buckets = filter.bucket ? [filter.bucket] : LIFECYCLE_DIRS;
  const out: Card[] = [];
  for (const bucket of buckets) {
    const dir = lifecycleDir(root, bucket);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      try {
        const card = readCardFile(join(dir, name), bucket);
        if (filter.type && card.meta["type"] !== filter.type) continue;
        out.push(card);
      } catch {
        // Skip unparseable files rather than failing the whole listing.
      }
    }
  }
  return out;
}

/** Find a card by VKF id across all lifecycle buckets. */
export function findCard(root: string, id: string): Card | undefined {
  return listCards(root).find((c) => c.meta["id"] === id);
}

/**
 * Transition a card to a new memory state: rewrite `status`/`memory_state`/
 * `verification`/`last_verified` and move the file into the matching bucket.
 * Returns the updated card. Never silently promotes to a trusted state without a
 * caller decision — that policy lives in the tools.
 */
export function transitionCard(
  root: string,
  id: string,
  state: MemoryState,
  opts: {
    verification?: Verification;
    confidence?: number;
    conflictsWith?: string;
    /** Accumulated experiment evidence backing the belief, persisted on the card. */
    evidence?: { wins: number; losses: number };
  } = {},
): Card {
  const card = findCard(root, id);
  if (!card) throw new Error(`no card with id "${id}" in the memory bundle`);
  const { bucket, status } = STATE_MAP[state];

  card.meta["status"] = status;
  card.meta["memory_state"] = state;
  if (opts.verification) card.meta["verification_level"] = opts.verification;
  if (opts.confidence !== undefined) {
    card.meta["belief"] = opts.confidence;
    card.meta["confidence"] = confidenceLabel(opts.confidence);
  }
  if (opts.evidence) {
    card.meta["evidence_wins"] = opts.evidence.wins;
    card.meta["evidence_losses"] = opts.evidence.losses;
  }
  if (status === "active" || status === "verified") card.meta["last_verified"] = today();
  if (opts.conflictsWith) {
    const existing = Array.isArray(card.meta["conflicts_with"])
      ? (card.meta["conflicts_with"] as YamlValue[])
      : [];
    if (!existing.includes(opts.conflictsWith)) existing.push(opts.conflictsWith);
    card.meta["conflicts_with"] = existing;
  }

  const content = assembleCard(card.meta, card.body);
  const destDir = lifecycleDir(root, bucket);
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, basename(card.path));
  writeFileSync(card.path, content, "utf8");
  if (destPath !== card.path) {
    renameSync(card.path, destPath);
  }
  return { ...card, path: destPath, bucket };
}

// ── transactions (propose-don't-promote audit trail) ──────────────────────────

export interface TransactionInput {
  action: "created" | "promoted" | "demoted" | "updated";
  target: string;
  actor: string;
  reason: string;
  changedFields: string[];
  requiresHumanApproval?: boolean;
}

/** Append a VKF transaction record documenting an agent-driven change. */
export function writeTransaction(root: string, tx: TransactionInput): string {
  const ts = new Date();
  const stamp = ts.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const id = `transaction:${slugify(tx.target)}_${stamp}`;
  const meta: Record<string, YamlValue> = {
    vkf_version: "0.2.0",
    id,
    type: "transaction",
    title: `${tx.action}: ${tx.target}`,
    visibility: "internal",
    created: ts.toISOString().slice(0, 10),
    actor: tx.actor,
    action: tx.action,
    target: tx.target,
    timestamp: ts.toISOString(),
    reason: tx.reason,
    requires_human_approval: tx.requiresHumanApproval ?? false,
    changed_fields: tx.changedFields,
  };
  const body = [
    "# Transaction",
    "",
    `Agent \`${tx.actor}\` ${tx.action} \`${tx.target}\`.`,
    "",
    "## Reason",
    "",
    tx.reason,
  ].join("\n");
  const dir = memoryPaths(root).transactions;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${stamp}-${slugify(tx.target)}.md`);
  writeFileSync(path, assembleCard(meta, body), "utf8");
  return path;
}
