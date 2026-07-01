/**
 * Filesystem layout for pi-autoresearch-vkf.
 *
 * Everything the package owns lives under a single self-contained, namespaced
 * directory so it never collides with other tools (notably pi-autoresearch's
 * `.auto/`) and is obvious at a glance:
 *
 *   <root>/.autoresearch-vkf/
 *     session/         — ephemeral state for the current run (goal, experiment
 *                        log, measure script, dashboards). Safe to gitignore.
 *     memory/          — the durable VKF knowledge bundle that persists across
 *                        runs (papers, claims, experiments). Meant to be
 *                        committed: it's the long-term research memory.
 *
 * The global, cross-project bundle uses the same shape at `~/.autoresearch-vkf/`
 * (override with $PI_AUTORESEARCH_GLOBAL_ROOT) — it's just another root, so every
 * card/session helper works on it unchanged.
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The single namespaced directory the package owns inside a root. */
export const PKG_DIR = ".autoresearch-vkf";
/** Subdirectory of {@link PKG_DIR} holding ephemeral per-run session state. */
export const SESSION_SUBDIR = "session";
/** Subdirectory of {@link PKG_DIR} holding the durable VKF memory bundle. */
export const MEMORY_SUBDIR = "memory";

/** The three lifecycle directories inside the memory bundle. */
export const LIFECYCLE_DIRS = ["staging", "verified", "deprecated"] as const;
export type LifecycleDir = (typeof LIFECYCLE_DIRS)[number];

/** Absolute path of the package's namespaced directory for a given root. */
export function pkgDir(root: string): string {
  return join(root, PKG_DIR);
}

/** Absolute paths of the session contract (`.autoresearch-vkf/session/`). */
export function sessionPaths(root: string) {
  const dir = join(root, PKG_DIR, SESSION_SUBDIR);
  return {
    dir,
    config: join(dir, "config.json"),
    prompt: join(dir, "prompt.md"),
    experiments: join(dir, "experiments.json"),
    log: join(dir, "log.jsonl"),
    measure: join(dir, "measure.sh"),
    // User brake for continuous autonomy: creating this file halts the loop.
    stop: join(dir, "STOP"),
    researchPlan: join(dir, "research_plan.md"),
    checks: join(dir, "checks.sh"),
    report: join(dir, "report.md"),
    progressHtml: join(dir, "progress.html"),
    progressData: join(dir, "data.json"),
    dashboardHtml: join(dir, "dashboard.html"),
  } as const;
}

/** Absolute paths of the memory bundle (`.autoresearch-vkf/memory/`). */
export function memoryPaths(root: string) {
  const dir = join(root, PKG_DIR, MEMORY_SUBDIR);
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

/**
 * The root of the global, cross-project memory. The global bundle then lives at
 * `<globalRoot>/.autoresearch-vkf/memory/`. Defaults to the home directory (so
 * `~/.autoresearch-vkf/memory/`); override with $PI_AUTORESEARCH_GLOBAL_ROOT.
 */
export function globalRoot(): string {
  const override = process.env.PI_AUTORESEARCH_GLOBAL_ROOT?.trim();
  return override || homedir();
}

/** True when the global memory bundle has been created. */
export function hasGlobalMemory(): boolean {
  return existsSync(memoryPaths(globalRoot()).bundle);
}

/** True when a session already exists at the given root. */
export function hasSession(root: string): boolean {
  return existsSync(sessionPaths(root).dir);
}

/** True when a memory bundle already exists at the given root. */
export function hasMemory(root: string): boolean {
  return existsSync(memoryPaths(root).bundle);
}

/** Create the session directory tree if absent. Idempotent. */
export function ensureSessionDirs(root: string): ReturnType<typeof sessionPaths> {
  const p = sessionPaths(root);
  if (!existsSync(p.dir)) mkdirSync(p.dir, { recursive: true });
  return p;
}

/** Create the memory bundle tree if absent. Idempotent. */
export function ensureMemoryDirs(root: string): ReturnType<typeof memoryPaths> {
  const p = memoryPaths(root);
  for (const dir of [p.dir, p.staging, p.verified, p.deprecated, p.transactions]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return p;
}
