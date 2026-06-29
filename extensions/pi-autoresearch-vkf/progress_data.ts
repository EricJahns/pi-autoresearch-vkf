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

export interface DashboardData {
  name: string;
  goal: string;
  metricName: string;
  direction: MetricDirection;
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
  /** Typed lineage graph from `vkf graph`, when the CLI is available. */
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
  baseline?: number;
  experiments: readonly Experiment[];
  memory: Record<string, number>;
  claims: { id: string; title: string; confidence: string; belief: number; state: string }[];
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
    baseline: input.baseline,
    best: bestValue(input.experiments, input.direction),
    metricNames,
    experiments,
    memory: input.memory,
    claims: input.claims,
    coverage: { levers: LEVERS, altitudes: ALTITUDES, counts },
    graph: input.graph,
    generatedAt: input.generatedAt,
    refreshSeconds: input.refreshSeconds ?? 5,
    version: input.version,
  };
}
