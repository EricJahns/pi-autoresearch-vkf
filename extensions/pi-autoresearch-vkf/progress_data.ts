/**
 * The dashboard data payload — the single JSON document the interactive progress
 * page renders from.
 *
 * Splitting *data* (this module) from *rendering* ({@link ./progress_html.ts}) is
 * what makes the page live and interactive: the HTML shell is written once, and
 * this payload is re-emitted as a `data.json` sidecar on every state change. The
 * page fetches it and re-renders in place, so filters/scroll/selection survive a
 * refresh (unlike the old whole-page `<meta refresh>`).
 *
 * Pure module (data in, data out) so it is fully unit-testable.
 */
import { ALTITUDES, LEVERS } from "./cards.ts";
import type { MetricDirection } from "./config.ts";
import { experimentMetrics, type Experiment } from "./experiments.ts";
import { bucketKey } from "./scoring.ts";
import { depths } from "./tree.ts";

/** One experiment as the dashboard consumes it (tree + metrics included). */
export interface DashboardExperiment {
  id: string;
  description: string;
  value?: number;
  outcome: "win" | "loss" | "inconclusive" | "pending";
  kept?: boolean;
  claim_id?: string;
  parent_id?: string;
  node_kind?: string;
  depth: number;
  lever?: string;
  altitude?: string;
  metrics: Record<string, number>;
  baseline?: number;
  commit?: string;
  notes?: string;
  ts: string;
}

/** lever × altitude coverage grid, so the page can show where the search has gone. */
export interface CoverageGrid {
  levers: readonly string[];
  altitudes: readonly string[];
  /** Count of experiments per `bucketKey(lever, altitude)`. */
  counts: Record<string, number>;
}

/** One node in the idea-lineage graph (paper → claim → experiment). */
export interface LineageNode {
  id: string;
  type: "paper" | "claim" | "experiment";
  title: string;
  /** Memory lifecycle state (claims) — drives colour. */
  state?: string;
  /** Belief in [0,1] (claims), for the node size/label. */
  belief?: number;
  /** win/loss/inconclusive/pending (experiments) — drives colour. */
  outcome?: string;
  /** Primary metric value (experiments). */
  value?: number;
  /** Tree depth (experiments), so the graph lays out the search chain. */
  depth?: number;
}

/** One typed edge in the idea-lineage graph. */
export interface LineageEdge {
  source: string;
  target: string;
  /** tested = experiment→claim, parent = experiment→experiment, evidenced = claim→paper. */
  kind: "tested" | "parent" | "evidenced";
}

/**
 * The idea-lineage graph, built purely from session + memory state (no `vkf` CLI).
 * Because it rides in every payload it survives live `data.json` refreshes, unlike
 * the heavier `vkf graph` output (which only the explicit export path attaches).
 */
export interface Lineage {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface DashboardData {
  name: string;
  goal: string;
  metricName: string;
  direction: MetricDirection;
  /** Session kind: classic metric loop, or ideation (research-plan) session. */
  mode?: "optimize" | "ideate";
  /** Loop autonomy ("continuous" | "confirm-each"), for the status line. */
  autonomy?: string;
  /** Iteration budget, when set — drives the budget burn-down. */
  maxIterations?: number;
  /** True when the session STOP file exists (user asked the loop to halt). */
  stopRequested?: boolean;
  /** The current research plan markdown (session/research_plan.md), if drafted. */
  researchPlan?: string;
  baseline?: number;
  best?: number;
  /** Every metric name seen across runs, primary first — drives the series toggles. */
  metricNames: string[];
  experiments: DashboardExperiment[];
  /** Memory lifecycle counts keyed by state name. */
  memory: Record<string, number>;
  /** Claims to surface, with numeric belief for the belief bars. */
  claims: { id: string; title: string; confidence: string; belief: number; state: string }[];
  coverage: CoverageGrid;
  /** Idea-lineage graph (paper → claim → experiment), built CLI-free so it is always present. */
  lineage: Lineage;
  /** Typed lineage graph from `vkf graph`, when the CLI is available (richer; export path only). */
  graph?: { nodes: unknown[]; edges: unknown[] };
  generatedAt: string;
  /** Seconds between live `data.json` polls; 0 disables. */
  refreshSeconds: number;
  /** Schema/app version, for the page footer and cache-busting. */
  version: string;
}

export interface BuildDashboardInput {
  name: string;
  goal: string;
  metricName: string;
  direction: MetricDirection;
  mode?: "optimize" | "ideate";
  autonomy?: string;
  maxIterations?: number;
  stopRequested?: boolean;
  researchPlan?: string;
  baseline?: number;
  experiments: readonly Experiment[];
  memory: Record<string, number>;
  claims: { id: string; title: string; confidence: string; belief: number; state: string }[];
  /** Source papers, for the lineage graph's first column (optional; CLI-free). */
  papers?: { id: string; title: string }[];
  /** All claim cards (any bucket) for lineage nodes + their source paper ids. */
  lineageClaims?: { id: string; title: string; belief?: number; state?: string; paper_ids?: string[] }[];
  graph?: { nodes: unknown[]; edges: unknown[] };
  generatedAt: string;
  refreshSeconds?: number;
  version: string;
}

/** Best metric value across runs, respecting direction. */
function bestValue(experiments: readonly Experiment[], direction: MetricDirection): number | undefined {
  const measured = experiments.filter((e) => e.value !== undefined).map((e) => e.value!);
  if (measured.length === 0) return undefined;
  return direction === "higher" ? Math.max(...measured) : Math.min(...measured);
}

/**
 * Build the idea-lineage graph (paper → claim → experiment, plus the experiment
 * search tree) from local state alone — no `vkf` CLI. Claim nodes come from
 * `lineageClaims` when supplied, else fall back to the surfaced `claims`; any
 * claim an experiment references but that is otherwise missing is added as a stub
 * so every edge has both endpoints.
 */
function buildLineage(
  papers: { id: string; title: string }[],
  claims: { id: string; title: string; belief?: number; state?: string; paper_ids?: string[] }[],
  experiments: DashboardExperiment[],
): Lineage {
  const nodes = new Map<string, LineageNode>();
  const edges: LineageEdge[] = [];

  for (const p of papers) nodes.set(p.id, { id: p.id, type: "paper", title: p.title });
  for (const c of claims) {
    nodes.set(c.id, { id: c.id, type: "claim", title: c.title, state: c.state, belief: c.belief });
    for (const pid of c.paper_ids ?? []) {
      if (nodes.has(pid)) edges.push({ source: c.id, target: pid, kind: "evidenced" });
    }
  }
  for (const e of experiments) {
    nodes.set(e.id, {
      id: e.id,
      type: "experiment",
      title: e.description,
      outcome: e.outcome,
      value: e.value,
      depth: e.depth,
    });
    if (e.claim_id) {
      if (!nodes.has(e.claim_id)) nodes.set(e.claim_id, { id: e.claim_id, type: "claim", title: e.claim_id });
      edges.push({ source: e.id, target: e.claim_id, kind: "tested" });
    }
    if (e.parent_id && nodes.has(e.parent_id)) {
      edges.push({ source: e.id, target: e.parent_id, kind: "parent" });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/** Assemble the full dashboard payload from session + memory state. */
export function buildDashboardData(input: BuildDashboardInput): DashboardData {
  const depthById = depths(input.experiments);

  // Coverage grid + every metric series seen (primary first).
  const counts: Record<string, number> = {};
  const metricNames: string[] = [input.metricName];
  const experiments: DashboardExperiment[] = input.experiments.map((e) => {
    const metrics = experimentMetrics(e, input.metricName);
    for (const k of Object.keys(metrics)) if (!metricNames.includes(k)) metricNames.push(k);
    if (e.lever || e.altitude) {
      const key = bucketKey(e.lever, e.altitude);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return {
      id: e.id,
      description: e.description,
      value: e.value,
      outcome: e.outcome,
      kept: e.kept,
      claim_id: e.claim_id,
      parent_id: e.parent_id,
      node_kind: e.node_kind,
      depth: depthById.get(e.id) ?? 0,
      lever: e.lever,
      altitude: e.altitude,
      metrics,
      baseline: e.baseline,
      commit: e.commit,
      notes: e.notes,
      ts: e.ts,
    };
  });

  return {
    name: input.name,
    goal: input.goal,
    metricName: input.metricName,
    direction: input.direction,
    mode: input.mode,
    autonomy: input.autonomy,
    maxIterations: input.maxIterations,
    stopRequested: input.stopRequested,
    researchPlan: input.researchPlan,
    baseline: input.baseline,
    best: bestValue(input.experiments, input.direction),
    metricNames,
    experiments,
    memory: input.memory,
    claims: input.claims,
    coverage: { levers: LEVERS, altitudes: ALTITUDES, counts },
    lineage: buildLineage(input.papers ?? [], input.lineageClaims ?? input.claims, experiments),
    graph: input.graph,
    generatedAt: input.generatedAt,
    refreshSeconds: input.refreshSeconds ?? 5,
    version: input.version,
  };
}
