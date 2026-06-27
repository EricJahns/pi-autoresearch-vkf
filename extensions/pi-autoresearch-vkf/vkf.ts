/**
 * Bridge to the `vkf` CLI (the Verifiable-Knowledge-Format Python package).
 *
 * Per the project plan we shell out to the real CLI for the things that need the
 * reference implementation — validation, the typed graph, freshness, and
 * permission checks — and read/write the bundle's markdown ourselves (see
 * {@link ./cards.ts}). There is no long-running process.
 *
 * VKF is *optional*: if the CLI can't be found, the bridge reports that cleanly
 * and the tools degrade to "memory works, validation is skipped (install vkf to
 * enable trust gating)" rather than failing.
 *
 * Resolution order for the CLI:
 *   1. $PI_AUTORESEARCH_VKF — an explicit path to the `vkf` executable.
 *   2. the `vkf` binary inside the conda env named by
 *      $PI_AUTORESEARCH_VKF_CONDA_ENV (default "VKF"), under common conda roots.
 *   3. `conda run -n <env> vkf …` as a last resort.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface VkfInvocation {
  file: string;
  prefixArgs: string[];
}

export interface VkfResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  /** Set when the CLI could not be located/spawned at all. */
  unavailable?: boolean;
}

const condaEnv = (): string => process.env.PI_AUTORESEARCH_VKF_CONDA_ENV?.trim() || "VKF";

let cached: VkfInvocation | null | undefined;

/** Locate the `vkf` CLI. Returns `null` when nothing usable is found. */
export function resolveVkf(): VkfInvocation | null {
  if (cached !== undefined) return cached;

  const explicit = process.env.PI_AUTORESEARCH_VKF?.trim();
  if (explicit) {
    cached = { file: explicit, prefixArgs: [] };
    return cached;
  }

  const env = condaEnv();
  const home = homedir();
  const candidates = [
    join(home, "miniconda3", "envs", env, "bin", "vkf"),
    join(home, "anaconda3", "envs", env, "bin", "vkf"),
    join(home, ".conda", "envs", env, "bin", "vkf"),
    join(home, "miniforge3", "envs", env, "bin", "vkf"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      cached = { file: c, prefixArgs: [] };
      return cached;
    }
  }

  // Last resort: rely on `conda` being on PATH.
  cached = { file: "conda", prefixArgs: ["run", "-n", env, "vkf"] };
  return cached;
}

/** Reset the cached CLI resolution (used by tests). */
export function resetVkfCache(): void {
  cached = undefined;
}

function run(args: string[], cwd?: string): VkfResult {
  const inv = resolveVkf();
  if (!inv) return { ok: false, code: -1, stdout: "", stderr: "vkf CLI not found", unavailable: true };
  try {
    const proc = spawnSync(inv.file, [...inv.prefixArgs, ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (proc.error) {
      const enoent = (proc.error as NodeJS.ErrnoException).code === "ENOENT";
      return {
        ok: false,
        code: -1,
        stdout: proc.stdout ?? "",
        stderr: proc.stderr ?? String(proc.error),
        unavailable: enoent,
      };
    }
    return {
      ok: proc.status === 0,
      code: proc.status ?? -1,
      stdout: proc.stdout ?? "",
      stderr: proc.stderr ?? "",
    };
  } catch (err) {
    return { ok: false, code: -1, stdout: "", stderr: String(err), unavailable: true };
  }
}

/** True when the CLI appears to be installed and runnable. */
export function isAvailable(): boolean {
  return !run(["--version"]).unavailable;
}

// ── typed wrappers ─────────────────────────────────────────────────────────────

export interface ValidateReport {
  available: boolean;
  passed: boolean;
  profile?: number;
  summary?: { ERROR: number; WARNING: number; INFO: number };
  issues?: { level: string; path: string; message: string }[];
  raw: string;
}

/** Run `vkf validate <dir> --profile N --format json`. */
export function validate(memoryDir: string, profile: number): ValidateReport {
  const res = run(["validate", memoryDir, "--profile", String(profile), "--format", "json"]);
  if (res.unavailable) return { available: false, passed: false, raw: res.stderr };
  try {
    const parsed = JSON.parse(res.stdout) as {
      profile: number;
      summary: { ERROR: number; WARNING: number; INFO: number };
      issues: { level: string; path: string; message: string }[];
    };
    return {
      available: true,
      passed: (parsed.summary?.ERROR ?? 0) === 0,
      profile: parsed.profile,
      summary: parsed.summary,
      issues: parsed.issues,
      raw: res.stdout,
    };
  } catch {
    return { available: true, passed: res.ok, raw: res.stdout || res.stderr };
  }
}

export interface GraphResult {
  available: boolean;
  nodes: unknown[];
  edges: unknown[];
  raw: string;
}

/** Run `vkf graph <dir>` (JSON to stdout). */
export function graph(memoryDir: string): GraphResult {
  const res = run(["graph", memoryDir]);
  if (res.unavailable) return { available: false, nodes: [], edges: [], raw: res.stderr };
  try {
    const parsed = JSON.parse(res.stdout) as { nodes: unknown[]; edges: unknown[] };
    return { available: true, nodes: parsed.nodes ?? [], edges: parsed.edges ?? [], raw: res.stdout };
  } catch {
    return { available: true, nodes: [], edges: [], raw: res.stdout || res.stderr };
  }
}

/** Run `vkf freshness <dir>` (JSON to stdout). */
export function freshness(memoryDir: string): { available: boolean; report: unknown; raw: string } {
  const res = run(["freshness", memoryDir]);
  if (res.unavailable) return { available: false, report: null, raw: res.stderr };
  try {
    return { available: true, report: JSON.parse(res.stdout), raw: res.stdout };
  } catch {
    return { available: true, report: null, raw: res.stdout || res.stderr };
  }
}

export interface CheckResult {
  available: boolean;
  allowed: boolean;
  requiresReview: boolean;
  reason: string;
  raw: string;
}

/** Run `vkf check <file> --use <ctx> [--role <role>] --format json`. */
export function check(filePath: string, use: string, role?: string): CheckResult {
  const args = ["check", filePath, "--use", use, "--format", "json"];
  if (role) args.push("--role", role);
  const res = run(args);
  if (res.unavailable) {
    return { available: false, allowed: true, requiresReview: false, reason: "vkf unavailable", raw: res.stderr };
  }
  try {
    const parsed = JSON.parse(res.stdout) as {
      allowed: boolean;
      requires_review: boolean;
      reason: string;
    };
    return {
      available: true,
      allowed: parsed.allowed,
      requiresReview: parsed.requires_review,
      reason: parsed.reason,
      raw: res.stdout,
    };
  } catch {
    return { available: true, allowed: res.ok, requiresReview: false, reason: res.stderr, raw: res.stdout };
  }
}
