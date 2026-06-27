/**
 * Filesystem layout for a pi-autoresearch-vkf project.
 *
 * Two persistence layers live side by side at the project root, split by lifetime:
 *
 *   .auto/             — the *session*: ephemeral state for the current research
 *                        loop (goal, experiment log, measure script). Like
 *                        pi-autoresearch's `.auto/`.
 *
 *   .research-memory/  — the *long-term memory*: a VKF bundle that persists across
 *                        runs and is versioned with the repo. This is the layer
 *                        that makes the agent build on what it learned instead of
 *                        rediscovering it.
 *
 * Keeping the layout in one place means the tools, the dashboard, the VKF bridge
 * and the skills all agree on where things live.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Name of the per-run session directory. */
export const SESSION_DIR = ".auto";
/** Name of the durable VKF memory bundle directory. */
export const MEMORY_DIR = ".research-memory";

/** The three lifecycle directories inside the memory bundle. */
export const LIFECYCLE_DIRS = ["staging", "verified", "deprecated"] as const;
export type LifecycleDir = (typeof LIFECYCLE_DIRS)[number];

/** Absolute paths of the session (`.auto/`) contract for a project root. */
export function sessionPaths(root: string) {
  const dir = join(root, SESSION_DIR);
  return {
    dir,
    config: join(dir, "config.json"),
    prompt: join(dir, "prompt.md"),
    experiments: join(dir, "experiments.json"),
    log: join(dir, "log.jsonl"),
    measure: join(dir, "measure.sh"),
    checks: join(dir, "checks.sh"),
    report: join(dir, "report.md"),
  } as const;
}

/** Absolute paths of the memory bundle (`.research-memory/`) contract. */
export function memoryPaths(root: string) {
  const dir = join(root, MEMORY_DIR);
  return {
    dir,
    bundle: join(dir, "vkf.bundle.yaml"),
    staging: join(dir, "staging"),
    verified: join(dir, "verified"),
    deprecated: join(dir, "deprecated"),
    transactions: join(dir, "transactions"),
  } as const;
}

/** Resolve the absolute directory for a given lifecycle bucket. */
export function lifecycleDir(root: string, bucket: LifecycleDir): string {
  return join(memoryPaths(root).dir, bucket);
}

/** True when a `.auto/` session already exists at the given root. */
export function hasSession(root: string): boolean {
  return existsSync(sessionPaths(root).dir);
}

/** True when a `.research-memory/` bundle already exists at the given root. */
export function hasMemory(root: string): boolean {
  return existsSync(memoryPaths(root).bundle);
}

/** Create the `.auto/` directory tree if absent. Idempotent. */
export function ensureSessionDirs(root: string): ReturnType<typeof sessionPaths> {
  const p = sessionPaths(root);
  if (!existsSync(p.dir)) mkdirSync(p.dir, { recursive: true });
  return p;
}

/** Create the `.research-memory/` bundle tree if absent. Idempotent. */
export function ensureMemoryDirs(root: string): ReturnType<typeof memoryPaths> {
  const p = memoryPaths(root);
  for (const dir of [p.dir, p.staging, p.verified, p.deprecated, p.transactions]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return p;
}
