/**
 * Hypothesis synthesis — turn stored memory into *new* ideas, not just retrieval.
 *
 * Most agents generate ideas by copying nearby literature. The richer seeds are
 * the tensions and analogies already latent in memory:
 *
 *  - **Contradiction mining** — where two claims pull in opposite directions
 *    (an explicit conflict, the same idea that won here and lost there, or two
 *    different mechanisms aimed at the same goal). Each tension is a question
 *    worth a hypothesis: "under what condition does X hold?".
 *
 *  - **Cross-domain transfer** — a mechanism that solves a structurally similar
 *    problem in *another* domain. Found by mechanism similarity with *low* context
 *    similarity (same how, different where). Keyword search finds the obvious;
 *    mechanism search finds the surprising analogy.
 *
 *  - **Composition** — two *trusted* claims whose mechanisms are complementary
 *    (both relevant to the goal, low mechanism overlap) combined into one
 *    hypothesis. The benchmark's global optima are exactly such combinations —
 *    ideas no single paper states, so retrieval alone can never propose them.
 *
 * Pure module (reuses ./scoring.ts tokenization) so it is fully unit-testable.
 */
import { jaccard, tokenize } from "./scoring.ts";
import type { MemoryState } from "./cards.ts";

/** Minimal shape the synthesis functions need from a memory card. */
export interface CardLike {
  id: string;
  title: string;
  /** The mechanism — *how/why* it works. */
  mechanism?: string;
  /** The context/goal — *where* it applies. */
  context?: string;
  /** Full descriptive text (title + assertion/body) for topic similarity. */
  text: string;
  memory_state?: MemoryState;
  conflicts_with?: string[];
  /** System part the claim touches (see ./cards.ts LEVERS) — different levers compose better. */
  lever?: string;
}

const mechTokens = (c: CardLike): Set<string> => tokenize(c.mechanism ?? "");
const ctxTokens = (c: CardLike): Set<string> => tokenize(c.context ?? "");

/** Topic similarity from full text. */
export function topicSimilarity(a: CardLike, b: CardLike): number {
  return jaccard(tokenize(a.text), tokenize(b.text));
}
/** How similar two cards' mechanisms are. */
export function mechanismSimilarity(a: CardLike, b: CardLike): number {
  return jaccard(mechTokens(a), mechTokens(b));
}
/** How similar two cards' contexts/goals are. */
export function contextSimilarity(a: CardLike, b: CardLike): number {
  return jaccard(ctxTokens(a), ctxTokens(b));
}

const WORKED = new Set<MemoryState>(["locally_tested", "replicated"]);

export type TensionKind = "explicit" | "outcome_flip" | "same_goal_diff_mechanism";

export interface Tension {
  kind: TensionKind;
  a: string;
  b: string;
  /** Human-readable description of the tension. */
  detail: string;
  /** A generative question this tension poses — the seed for a new hypothesis. */
  question: string;
  /** Strength of the signal, [0,1], for ranking. */
  strength: number;
}

export interface ContradictionOptions {
  /** Min topic similarity to consider two claims "about the same thing". */
  topicThreshold?: number;
  /** Min context similarity for "same goal". */
  contextThreshold?: number;
  /** Max mechanism similarity for "different mechanism". */
  mechanismThreshold?: number;
}

/**
 * Find tensions among a set of claim cards. Returns one {@link Tension} per
 * conflicting pair (deduplicated, strongest first).
 */
export function findContradictions(
  cards: readonly CardLike[],
  opts: ContradictionOptions = {},
): Tension[] {
  const topicThreshold = opts.topicThreshold ?? 0.34;
  const contextThreshold = opts.contextThreshold ?? 0.34;
  const mechanismThreshold = opts.mechanismThreshold ?? 0.2;

  const byId = new Map(cards.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: Tension[] = [];
  const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

  // 1) Explicit conflicts_with links.
  for (const c of cards) {
    for (const other of c.conflicts_with ?? []) {
      if (!byId.has(other)) continue;
      const key = pairKey(c.id, other);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: "explicit",
        a: c.id,
        b: other,
        detail: `${c.id} is explicitly marked conflicting with ${other}.`,
        question: `${c.id} and ${other} disagree — what condition decides which one holds here?`,
        strength: 1,
      });
    }
  }

  // 2) Pairwise topic-similar claims with diverging signals.
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i]!;
      const b = cards[j]!;
      const key = pairKey(a.id, b.id);
      if (seen.has(key)) continue;

      const topic = topicSimilarity(a, b);

      // 2a) outcome flip: similar topic, one worked, one was contradicted.
      const aWorked = WORKED.has(a.memory_state as MemoryState);
      const bWorked = WORKED.has(b.memory_state as MemoryState);
      const aFailed = a.memory_state === "contradicted";
      const bFailed = b.memory_state === "contradicted";
      if (topic >= topicThreshold && ((aWorked && bFailed) || (bWorked && aFailed))) {
        const won = aWorked ? a : b;
        const lost = aWorked ? b : a;
        seen.add(key);
        out.push({
          kind: "outcome_flip",
          a: won.id,
          b: lost.id,
          detail: `${won.id} worked but the similar ${lost.id} was contradicted (topic sim ${topic.toFixed(2)}).`,
          question: `Why did ${won.id} hold while ${lost.id} failed? What condition flips the outcome?`,
          strength: topic,
        });
        continue;
      }

      // 2b) same goal, different mechanism.
      const ctx = contextSimilarity(a, b);
      const mech = mechanismSimilarity(a, b);
      if (ctx >= contextThreshold && mech <= mechanismThreshold && !aFailed && !bFailed) {
        seen.add(key);
        out.push({
          kind: "same_goal_diff_mechanism",
          a: a.id,
          b: b.id,
          detail: `${a.id} and ${b.id} target the same goal (context sim ${ctx.toFixed(2)}) via different mechanisms (mech sim ${mech.toFixed(2)}).`,
          question: `${a.id} and ${b.id} solve the same problem differently — can their mechanisms be unified or combined?`,
          strength: ctx * (1 - mech),
        });
      }
    }
  }

  return out.sort((x, y) => y.strength - x.strength);
}

export interface Transfer {
  /** The source card whose mechanism might transfer. */
  from: string;
  title: string;
  mechanism_similarity: number;
  context_similarity: number;
  /** mechanism_similarity × (1 − context_similarity): high = strong analogy. */
  transfer_score: number;
  suggestion: string;
}

/**
 * Find cross-domain transfer candidates for a target problem: cards whose
 * *mechanism* is similar but whose *context* differs (same how, different where).
 *
 * `target` is treated as a pseudo-card — pass a real card or a free-text problem
 * (set both `mechanism` and `context`/`text` from the description).
 */
export function findTransfers(
  target: CardLike,
  cards: readonly CardLike[],
  opts: { minMechanismSimilarity?: number; maxContextSimilarity?: number } = {},
): Transfer[] {
  const minMech = opts.minMechanismSimilarity ?? 0.15;
  const maxCtx = opts.maxContextSimilarity ?? 0.5;

  const out: Transfer[] = [];
  for (const c of cards) {
    if (c.id === target.id) continue;
    const mech = mechanismSimilarity(target, c);
    const ctx = contextSimilarity(target, c);
    if (mech < minMech || ctx > maxCtx) continue;
    const score = mech * (1 - ctx);
    out.push({
      from: c.id,
      title: c.title,
      mechanism_similarity: mech,
      context_similarity: ctx,
      transfer_score: score,
      suggestion:
        `Mechanism of ${c.id} ("${(c.mechanism ?? c.title).slice(0, 80)}") may transfer: ` +
        `similar mechanism, different domain. Adapt it to the target problem.`,
    });
  }
  return out.sort((a, b) => b.transfer_score - a.transfer_score);
}

// ── composition ───────────────────────────────────────────────────────────────

/** States trusted enough to be a composition parent. */
const COMPOSABLE = new Set<MemoryState>(["source_verified", "locally_tested", "replicated"]);

export interface Composition {
  /** The two parent claims to combine. */
  a: string;
  b: string;
  titleA: string;
  titleB: string;
  /** How relevant the *weaker* parent is to the goal, [0,1]. */
  goal_relevance: number;
  /** Mechanism overlap between the parents — low means complementary. */
  mechanism_overlap: number;
  /** Ranking score: relevance × complementarity × evidence. */
  score: number;
  suggestion: string;
}

export interface CompositionOptions {
  /** Min per-parent goal relevance (topic similarity to the goal text). */
  minGoalRelevance?: number;
  /** Max mechanism overlap — above this the pair is redundant, not composable. */
  maxMechanismOverlap?: number;
}

/**
 * Find pairs of *trusted* claims worth composing into a single novel hypothesis:
 * both relevant to the goal, mechanisms mostly non-overlapping (complementary,
 * not redundant), neither contradicted. Pairs touching *different levers* get a
 * boost — combining a data-lever idea with an algorithm-lever idea is a real
 * combination, not a restatement. `goal` is free text (the research goal).
 */
export function findCompositions(
  goal: string,
  cards: readonly CardLike[],
  opts: CompositionOptions = {},
): Composition[] {
  const minRel = opts.minGoalRelevance ?? 0.05;
  const maxOverlap = opts.maxMechanismOverlap ?? 0.34;
  const goalTokens = tokenize(goal);

  const trusted = cards.filter(
    (c) => COMPOSABLE.has(c.memory_state as MemoryState) && (c.mechanism ?? "").trim(),
  );
  const relevance = new Map<string, number>(
    trusted.map((c) => [c.id, jaccard(goalTokens, tokenize(c.text))]),
  );
  const evidence = (c: CardLike): number =>
    c.memory_state === "replicated" ? 1 : c.memory_state === "locally_tested" ? 0.9 : 0.7;

  const out: Composition[] = [];
  for (let i = 0; i < trusted.length; i++) {
    for (let j = i + 1; j < trusted.length; j++) {
      const a = trusted[i]!;
      const b = trusted[j]!;
      const rel = Math.min(relevance.get(a.id)!, relevance.get(b.id)!);
      if (rel < minRel) continue;
      const overlap = mechanismSimilarity(a, b);
      if (overlap > maxOverlap) continue;
      const leverBoost = a.lever && b.lever && a.lever !== b.lever ? 1.15 : 1;
      const score = rel * (1 - overlap) * evidence(a) * evidence(b) * leverBoost;
      out.push({
        a: a.id,
        b: b.id,
        titleA: a.title,
        titleB: b.title,
        goal_relevance: rel,
        mechanism_overlap: overlap,
        score,
        suggestion:
          `Compose ${a.id} + ${b.id}: their mechanisms are complementary` +
          (leverBoost > 1 ? ` and touch different levers (${a.lever} + ${b.lever})` : "") +
          ` — one hypothesis applying both, which no single source proposes.`,
      });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}
