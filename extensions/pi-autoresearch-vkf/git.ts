/**
 * Git helpers for capturing each experiment's change as a commit on a dedicated
 * per-idea branch (`autoresearch-vkf-<idea>`), so a reverted change is never
 * lost and the dashboard can link to the exact commit.
 *
 * The snapshot is **non-destructive**: it writes a commit onto the side branch
 * via a throwaway index + `write-tree`/`commit-tree`/`update-ref`, never touching
 * HEAD, the real index, or the working tree. The loop keeps its keep-vs-revert
 * behaviour; the branch is just an always-recoverable audit trail of every change.
 *
 * Pure module: only node builtins (child_process / fs / os / path), no pi
 * runtime, so it is unit-testable against a throwaway repo.
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: env ? { ...process.env, ...env } : process.env,
  }).trim();
}

function tryGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string | undefined {
  try {
    return git(cwd, args, env);
  } catch {
    return undefined;
  }
}

/**
 * Branch name for an idea: `autoresearch-vkf-<slug>`. Strips a leading VKF type
 * prefix (`claim:` / `idea:` / …) and reduces the rest to a git-ref-safe slug.
 */
export function branchNameForIdea(idea: string): string {
  const slug =
    idea
      .replace(/^(claim|idea|concept|paper|experiment):/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/g, "") || "idea";
  return `autoresearch-vkf-${slug}`;
}

export interface Snapshot {
  /** Full 40-char commit SHA of the snapshot. */
  full: string;
  /** 7-char short SHA, for compact display. */
  short: string;
  /** The branch the snapshot was committed onto. */
  branch: string;
}

/**
 * Snapshot the current working tree (tracked changes + new files, respecting
 * `.gitignore`) as a commit on `branch`, WITHOUT touching HEAD, the index, or the
 * working tree. Returns `undefined` when `cwd` isn't a git repo, has no commits
 * yet, or there is nothing new to capture since the branch tip.
 */
export function snapshotToBranch(
  cwd: string,
  branch: string,
  message: string,
  author?: { name?: string; email?: string },
): Snapshot | undefined {
  // Must be a repo with at least one commit (HEAD resolvable).
  const head = tryGit(cwd, ["rev-parse", "--verify", "HEAD"]);
  if (!head) return undefined;

  const idx = join(tmpdir(), `autoresearch-vkf-index-${process.pid}-${Date.now()}`);
  const idxEnv: NodeJS.ProcessEnv = { GIT_INDEX_FILE: idx };
  try {
    // Stage HEAD, then all working-tree changes, into the throwaway index.
    if (tryGit(cwd, ["read-tree", "HEAD"], idxEnv) === undefined) return undefined;
    tryGit(cwd, ["add", "-A"], idxEnv);
    const tree = tryGit(cwd, ["write-tree"], idxEnv);
    if (!tree) return undefined;

    // Parent = the existing side-branch tip if present, else current HEAD, so
    // repeated experiments on one idea stack as a readable chain of commits.
    const parent = tryGit(cwd, ["rev-parse", "--verify", `refs/heads/${branch}`]) ?? head;
    // Nothing new since the parent's tree? Don't create an empty commit.
    if (tryGit(cwd, ["rev-parse", `${parent}^{tree}`]) === tree) return undefined;

    const env: NodeJS.ProcessEnv = { ...idxEnv };
    const name = author?.name || "autoresearch-vkf";
    const email = author?.email || "autoresearch-vkf@localhost";
    env.GIT_AUTHOR_NAME = name;
    env.GIT_COMMITTER_NAME = name;
    env.GIT_AUTHOR_EMAIL = email;
    env.GIT_COMMITTER_EMAIL = email;

    const full = tryGit(cwd, ["commit-tree", tree, "-p", parent, "-m", message], env);
    if (!full) return undefined;
    if (tryGit(cwd, ["update-ref", `refs/heads/${branch}`, full]) === undefined) return undefined;
    return { full, short: full.slice(0, 7), branch };
  } finally {
    try {
      if (existsSync(idx)) rmSync(idx);
    } catch {
      /* best-effort cleanup */
    }
  }
}

/** Parse a git remote URL (scp-like or scheme form) into an https base + host. */
function httpBaseFromRemote(remote: string): { url: string; host: string } | undefined {
  const r = remote.trim();
  let host: string;
  let path: string;
  const scp = /^[^@]+@([^:/]+):(.+)$/.exec(r); // git@github.com:owner/repo.git
  if (scp) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(r); // https://…/owner/repo.git
    if (!m) return undefined;
    host = m[1]!;
    path = m[2]!;
  }
  host = host.replace(/:\d+$/, "");
  path = path.replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!host || !path) return undefined;
  return { url: `https://${host}/${path}`, host };
}

/**
 * A web URL for `fullSha` built from the repo's `origin` remote (GitHub/GitLab/
 * Bitbucket-style hosts). Returns `undefined` when there is no resolvable remote.
 */
export function remoteCommitUrl(cwd: string, fullSha: string): string | undefined {
  const remote = tryGit(cwd, ["remote", "get-url", "origin"]);
  const base = remote ? httpBaseFromRemote(remote) : undefined;
  if (!base) return undefined;
  const seg = base.host.includes("gitlab") ? "/-/commit/" : "/commit/";
  return `${base.url}${seg}${fullSha}`;
}

/** A web URL for `branch` on the `origin` remote, or `undefined` if none. */
export function remoteBranchUrl(cwd: string, branch: string): string | undefined {
  const remote = tryGit(cwd, ["remote", "get-url", "origin"]);
  const base = remote ? httpBaseFromRemote(remote) : undefined;
  if (!base) return undefined;
  const seg = base.host.includes("gitlab") ? "/-/tree/" : "/tree/";
  return `${base.url}${seg}${encodeURIComponent(branch)}`;
}
