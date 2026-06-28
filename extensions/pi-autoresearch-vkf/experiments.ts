/**
 * The session experiment model: the source of truth for what the current loop
 * has tried and how it turned out. `.auto/experiments.json` is an array of
 * {@link Experiment} objects.
 *
 * This is the ephemeral, per-run view (counts, best metric, the dashboard).
 * Durable results are *also* written to the VKF memory bundle as experiment cards
 * so future runs can recall them — see {@link ./cards.ts}.
 *
 * Pure module (only `node:fs`) so the outcome logic is unit-testable.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { MetricDirection } from "./config.ts";

export type Outcome = "win" | "loss" | "inconclusive" | "pending";

export const OUTCOMES: readonly Outcome[] = ["win", "loss", "inconclusive", "pending"];

export interface Experiment {
  /** Stable id, e.g. "exp-003-adagc". */
  id: string;
  /** What was changed, in words. */
  description: string;
  /** Claim/idea this experiment tested (a VKF id, e.g. "claim:adagc"). */
  claim_id?: string;
  /** Primary metric value obtained (the session's configured metric). */
  value?: number;
  /** All `METRIC name=value` pairs recorded for this run, primary metric included. */
  metrics?: Record<string, number>;
  /** Short (7-char) commit hash capturing the change, if known. */
  commit?: string;
  /** Baseline this run was compared against. */
  baseline?: number;
  /** Outcome relative to the baseline and metric direction. */
  outcome: Outcome;
  /** Whether the change was kept (vs reverted). */
  kept?: boolean;
  /** Memory experiment-card id written back to the bundle, if any. */
  memory_card?: string;
  /** Free-form notes: deviations, surprises, next steps. */
  notes?: string;
  /** ISO timestamp. */
  ts: string;
}

const GLYPH: Record<Outcome, string> = {
  win: "✓",
  loss: "✗",
  inconclusive: "~",
  pending: "·",
};

export const OUTCOME_GLYPH = GLYPH;

/**
 * Derive an outcome from a measured value vs the baseline. `threshold` is the
 * minimum relative change (fraction) to count as a real win/loss rather than
 * noise — anything smaller is `inconclusive`.
 */
export function deriveOutcome(
  baseline: number | undefined,
  value: number,
  direction: MetricDirection,
  threshold = 0.0,
): Outcome {
  if (baseline === undefined) return "inconclusive";
  const denom = Math.max(Math.abs(baseline), 1e-9);
  const relChange = (value - baseline) / denom;
  const improved = direction === "higher" ? relChange : -relChange;
  if (improved > threshold) return "win";
  if (improved < -threshold) return "loss";
  return "inconclusive";
}

export function readExperiments(path: string): Experiment[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a JSON array of experiments`);
  return parsed as Experiment[];
}

export function writeExperiments(path: string, experiments: Experiment[]): void {
  writeFileSync(path, JSON.stringify(experiments, null, 2) + "\n", "utf8");
}

/** Append a new experiment (experiments are immutable once logged). */
export function appendExperiment(experiments: Experiment[], exp: Experiment): Experiment[] {
  return [...experiments, exp];
}

export interface ExperimentSummary {
  total: number;
  win: number;
  loss: number;
  inconclusive: number;
  pending: number;
  /** Runs whose change was kept (`kept === true`). */
  kept: number;
  /** Runs whose change was reverted (`kept === false`). */
  discarded: number;
  /** Best metric value seen, respecting direction. */
  best?: number;
}

export function summarize(
  experiments: Experiment[],
  direction: MetricDirection,
): ExperimentSummary {
  const s: ExperimentSummary = {
    total: experiments.length,
    win: 0,
    loss: 0,
    inconclusive: 0,
    pending: 0,
    kept: 0,
    discarded: 0,
  };
  for (const e of experiments) {
    s[e.outcome] += 1;
    if (e.kept === true) s.kept += 1;
    else if (e.kept === false) s.discarded += 1;
    if (e.value !== undefined) {
      if (s.best === undefined) s.best = e.value;
      else s.best = direction === "higher" ? Math.max(s.best, e.value) : Math.min(s.best, e.value);
    }
  }
  return s;
}

/** The metrics map for a run, falling back to the primary value for older records. */
export function experimentMetrics(e: Experiment, primaryMetric: string): Record<string, number> {
  if (e.metrics && Object.keys(e.metrics).length > 0) return e.metrics;
  return e.value === undefined ? {} : { [primaryMetric]: e.value };
}
