/**
 * The experiment **search tree** — the loop's backbone.
 *
 * A blind loop keeps one scalar baseline and judges every change against it. The
 * strongest autoresearch systems (AIDE, The AI Scientist v2) instead treat the
 * search as a *tree*: each experiment is a node that branches from a parent, and
 * the next move is chosen by best-first expansion — build on the best node so far,
 * but reserve budget to branch elsewhere. That lets the loop backtrack out of a
 * dead end instead of grinding forward from the latest (possibly worse) result.
 *
 * This module turns the flat {@link ./experiments.ts} log into that tree and picks
 * what to expand next. It is pure (no fs, no pi runtime) so it is fully
 * unit-testable, and it reuses the idea ranking in {@link ./scoring.ts}.
 */
import type { MetricDirection } from "./config.ts";
import type { Experiment, NodeKind } from "./experiments.ts";
import { selectBalanced, type IdeaInput, type ScoredIdea, type Slot } from "./scoring.ts";

export interface TreeNode {
  experiment: Experiment;
  children: TreeNode[];
  /** Depth from a root (root = 0). */
  depth: number;
}

/**
 * Resolve each experiment's parent id, inferring a linear chain for legacy rows
 * that predate `parent_id`: a row without a parent hangs off the most recent
 * *kept* node, else the immediately preceding node, else it's a root. Explicit
 * `parent_id`s (that resolve to a real, earlier node) always win.
 */
export function resolveParents(experiments: readonly Experiment[]): Map<string, string | undefined> {
  const byId = new Map(experiments.map((e) => [e.id, e]));
  const parents = new Map<string, string | undefined>();
  let prevId: string | undefined;
  let lastKeptId: string | undefined;
  for (const e of experiments) {
    let parent: string | undefined;
    if (e.parent_id && e.parent_id !== e.id && byId.has(e.parent_id)) {
      parent = e.parent_id;
    } else if (e.parent_id === undefined) {
      // Legacy / unparented: stitch into a chain so the tree is still connected.
      parent = lastKeptId ?? prevId;
    }
    parents.set(e.id, parent);
    prevId = e.id;
    if (e.kept === true) lastKeptId = e.id;
  }
  return parents;
}

/** Assemble the experiment forest (usually one root). Order is preserved. */
export function buildTree(experiments: readonly Experiment[]): TreeNode[] {
  const parents = resolveParents(experiments);
  const nodes = new Map<string, TreeNode>(
    experiments.map((e) => [e.id, { experiment: e, children: [], depth: 0 }]),
  );
  const roots: TreeNode[] = [];
  for (const e of experiments) {
    const node = nodes.get(e.id)!;
    const parentId = parents.get(e.id);
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  // Assign depths with a cycle-safe BFS from the roots.
  const seen = new Set<string>();
  const queue: TreeNode[] = roots.map((r) => {
    r.depth = 0;
    return r;
  });
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n.experiment.id)) continue;
    seen.add(n.experiment.id);
    for (const c of n.children) {
      c.depth = n.depth + 1;
      queue.push(c);
    }
  }
  return roots;
}

/** Compute the depth of every node by id (root = 0). */
export function depths(experiments: readonly Experiment[]): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (n: TreeNode): void => {
    out.set(n.experiment.id, n.depth);
    n.children.forEach(walk);
  };
  buildTree(experiments).forEach(walk);
  return out;
}

/** The best-valued node so far, respecting metric direction. `undefined` if none measured. */
export function bestNode(
  experiments: readonly Experiment[],
  direction: MetricDirection,
): Experiment | undefined {
  let best: Experiment | undefined;
  for (const e of experiments) {
    if (e.value === undefined) continue;
    if (best === undefined) best = e;
    else if (direction === "higher" ? e.value > best.value! : e.value < best.value!) best = e;
  }
  return best;
}

/**
 * Nodes worth expanding from: the best node plus the current leaves (nodes with no
 * children). De-duplicated, best node first. Useful for explaining the frontier.
 */
export function frontier(experiments: readonly Experiment[], direction: MetricDirection): Experiment[] {
  const haveChildren = new Set<string>();
  for (const id of resolveParents(experiments).values()) {
    if (id) haveChildren.add(id);
  }
  const leaves = experiments.filter((e) => !haveChildren.has(e.id));
  const best = bestNode(experiments, direction);
  const out: Experiment[] = [];
  const push = (e: Experiment | undefined): void => {
    if (e && !out.some((o) => o.id === e.id)) out.push(e);
  };
  push(best);
  leaves.forEach(push);
  return out;
}

export interface ExpansionPick {
  /** Id of the node to branch from, or `undefined` to draft a fresh root. */
  parent_id?: string;
  /** The move this would be (improve the best node, or branch to explore). */
  node_kind: NodeKind;
  r: ScoredIdea;
  idea: IdeaInput;
  slot: Slot;
}

/**
 * Best-first expansion: choose *which node to expand* and *which idea to apply*.
 *
 * Idea ranking + the explore/exploit budget come from {@link selectBalanced}; this
 * layer attaches each pick to a node. Exploit picks `improve` the best node so far
 * (build on what works); explore picks `branch` from it (a bigger swing that opens
 * new ground). With no measured node yet, every pick is a `draft` root.
 */
export function selectExpansion(
  experiments: readonly Experiment[],
  scored: readonly { r: ScoredIdea; idea: IdeaInput }[],
  opts: { direction: MetricDirection; exploreFraction: number; k: number },
): ExpansionPick[] {
  const picks = selectBalanced(scored, { exploreFraction: opts.exploreFraction, k: opts.k });
  const best = bestNode(experiments, opts.direction);
  return picks.map((p) => ({
    parent_id: best?.id,
    node_kind: best ? (p.slot === "explore" ? "branch" : "improve") : "draft",
    r: p.r,
    idea: p.idea,
    slot: p.slot,
  }));
}
