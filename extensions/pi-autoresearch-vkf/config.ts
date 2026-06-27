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
  /** Actor id recorded as the owner/author of agent-written VKF objects. */
  owner: string;
  /** ISO timestamp the session was created. */
  createdAt: string;
}

export const DEFAULT_OWNER = "agent:autoresearch";
export const DEFAULT_MEMORY_PROFILE = 1 as const;

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
  owner?: string;
}): ResearchConfig {
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
    owner: params.owner ?? DEFAULT_OWNER,
    createdAt: new Date().toISOString(),
  };
}
