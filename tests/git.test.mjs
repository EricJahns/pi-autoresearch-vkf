import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  branchNameForIdea,
  remoteCommitUrl,
  snapshotToBranch,
} from "../extensions/pi-autoresearch-vkf/git.ts";

const g = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

let repo;
before(() => {
  repo = mkdtempSync(join(tmpdir(), "autoresearch-git-test-"));
  g(repo, "init", "-q");
  g(repo, "config", "user.email", "t@t");
  g(repo, "config", "user.name", "t");
  g(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "a.txt"), "one\n");
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", "init");
});
after(() => rmSync(repo, { recursive: true, force: true }));

test("branchNameForIdea strips the type prefix and slugifies", () => {
  assert.equal(branchNameForIdea("claim:AdaGC helps a lot!"), "autoresearch-vkf-adagc-helps-a-lot");
  assert.equal(branchNameForIdea(""), "autoresearch-vkf-idea");
});

test("snapshotToBranch captures changes without touching HEAD, index, or working tree", () => {
  const headBefore = g(repo, "rev-parse", "HEAD");
  const statusBefore = g(repo, "status", "--porcelain");
  // A tracked edit + a brand-new untracked file.
  writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
  writeFileSync(join(repo, "b.txt"), "new file\n");
  const statusAfterEdit = g(repo, "status", "--porcelain");

  const snap = snapshotToBranch(repo, "autoresearch-vkf-demo", "exp-001 win");
  assert.ok(snap, "expected a snapshot");
  assert.equal(snap.branch, "autoresearch-vkf-demo");
  assert.match(snap.full, /^[0-9a-f]{40}$/);
  assert.equal(snap.short, snap.full.slice(0, 7));

  // The branch ref points at the snapshot and its tree contains both files.
  assert.equal(g(repo, "rev-parse", "refs/heads/autoresearch-vkf-demo"), snap.full);
  const listed = g(repo, "ls-tree", "-r", "--name-only", snap.full).split("\n");
  assert.ok(listed.includes("a.txt") && listed.includes("b.txt"));
  assert.equal(g(repo, "show", `${snap.full}:a.txt`), "one\ntwo");

  // Non-destructive: HEAD unchanged, and the working tree / real index are as they
  // were before the snapshot (the pending edit is still pending, nothing staged).
  assert.equal(g(repo, "rev-parse", "HEAD"), headBefore);
  assert.notEqual(statusBefore, statusAfterEdit); // sanity: there were changes
  assert.equal(g(repo, "status", "--porcelain"), statusAfterEdit);
});

test("a second snapshot with no further changes is skipped (no empty commit)", () => {
  const again = snapshotToBranch(repo, "autoresearch-vkf-demo", "exp-002 noop");
  assert.equal(again, undefined);
});

test("remoteCommitUrl builds a GitHub commit URL from origin (scp and https forms)", () => {
  assert.equal(remoteCommitUrl(repo, "abc"), undefined); // no remote yet
  g(repo, "remote", "add", "origin", "git@github.com:owner/repo.git");
  assert.equal(remoteCommitUrl(repo, "deadbeef"), "https://github.com/owner/repo/commit/deadbeef");
  g(repo, "remote", "set-url", "origin", "https://github.com/owner/repo.git");
  assert.equal(remoteCommitUrl(repo, "deadbeef"), "https://github.com/owner/repo/commit/deadbeef");
});

test("snapshotToBranch returns undefined outside a git repo", () => {
  const plain = mkdtempSync(join(tmpdir(), "autoresearch-nogit-"));
  try {
    assert.equal(snapshotToBranch(plain, "autoresearch-vkf-x", "m"), undefined);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});
