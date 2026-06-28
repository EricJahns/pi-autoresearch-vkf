/**
 * Session configuration persisted to `.auto/config.json`.
 *
 * Describes the optimization target for the current research loop: what we are
 * trying to improve, how to measure it, and which direction is "better". The
 * durable knowledge produced along the way lives in the VKF memory bundle, not
 * here.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Which direction of the metric counts as an improvement. */
export type MetricDirection = "higher" | "lower";

/**
 * How strongly idea selection should favor higher-altitude (less incremental)
 * ideas. `tuning` removes the bias entirely so hyperparameter sweeps rank
 * normally; `high` gives a mild lift to mechanism/reframe ideas; `any` is neutral.
 */
export type AltitudePreference = "any" | "high" | "tuning";

export interface ResearchConfig {
  /** Human-readable session name, e.g. "Speed up the test suite". */
  name: string;
  /** The research goal / optimization objective, in words. */
  goal: string;
  /** Command (run via `bash -lc`) that prints `METRIC name=number` lines. */
  command: string;
  /** Display name of the metric being optimized, e.g. "wall_clock_s". */
  metricName: string;
  /** Which direction is better. */
  direction: MetricDirection;
  /** Baseline metric value before any change (filled once measured). */
  baseline?: number;
  /** Files/globs the loop is allowed to modify. */
  filesInScope?: string[];
  /** Working directory for experiment commands (defaults to project root). */
  workingDir?: string;
  /** Optional cap on loop iterations. */
  maxIterations?: number;
  /** VKF conformance profile the memory bundle commits to (1 governed, 2 verified). */
  memoryProfile: 1 | 2;
  /** Fraction of the experiment budget reserved for exploratory (high-altitude /
   * high-uncertainty) ideas, in [0,1]. 0 ⇒ pure priority order (e.g. tuning). */
  exploreFraction: number;
  /** Altitude bias for scoring (see {@link AltitudePreference}). */
  altitudePreference: AltitudePreference;
  /** Actor id recorded as the owner/author of agent-written VKF objects. */
  owner: string;
  /** ISO timestamp the session was created. */
  createdAt: string;
}

export const DEFAULT_OWNER = "agent:autoresearch";
export const DEFAULT_MEMORY_PROFILE = 1 as const;

/**
 * Pick the default research mode from the goal text. An explicit tuning goal
 * ("tune", "sweep", "hyperparameter", "grid search") turns exploration off and
 * removes the altitude bias — if the user asked for tuning, they get tuning.
 * Otherwise reserve 30% of the budget for exploration and mildly favor altitude.
 */
export function deriveResearchMode(goal: string): {
  exploreFraction: number;
  altitudePreference: AltitudePreference;
} {
  const tuning = /\b(tune|tuning|sweep|hyper-?parameter|grid\s*search)\b/i.test(goal);
  return tuning
    ? { exploreFraction: 0, altitudePreference: "tuning" }
    : { exploreFraction: 0.3, altitudePreference: "high" };
}

/**
 * The effective explore/exploit mode for a config, falling back to a goal-derived
 * default for sessions created before these fields existed.
 */
export function researchMode(config: ResearchConfig): {
  exploreFraction: number;
  altitudePreference: AltitudePreference;
} {
  const fallback = deriveResearchMode(config.goal);
  return {
    exploreFraction: config.exploreFraction ?? fallback.exploreFraction,
    altitudePreference: config.altitudePreference ?? fallback.altitudePreference,
  };
}

export function readConfig(configPath: string): ResearchConfig | undefined {
  if (!existsSync(configPath)) return undefined;
  const raw = readFileSync(configPath, "utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as ResearchConfig;
}

export function writeConfig(configPath: string, config: ResearchConfig): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/** Build a config from init params, applying defaults. */
export function makeConfig(params: {
  name: string;
  goal: string;
  command: string;
  metricName: string;
  direction?: MetricDirection;
  filesInScope?: string[];
  workingDir?: string;
  maxIterations?: number;
  memoryProfile?: 1 | 2;
  exploreFraction?: number;
  altitudePreference?: AltitudePreference;
  owner?: string;
}): ResearchConfig {
  const mode = deriveResearchMode(params.goal);
  return {
    name: params.name,
    goal: params.goal,
    command: params.command,
    metricName: params.metricName,
    direction: params.direction ?? "higher",
    filesInScope: params.filesInScope,
    workingDir: params.workingDir,
    maxIterations: params.maxIterations,
    memoryProfile: params.memoryProfile ?? DEFAULT_MEMORY_PROFILE,
    exploreFraction: params.exploreFraction ?? mode.exploreFraction,
    altitudePreference: params.altitudePreference ?? mode.altitudePreference,
    owner: params.owner ?? DEFAULT_OWNER,
    createdAt: new Date().toISOString(),
  };
}
