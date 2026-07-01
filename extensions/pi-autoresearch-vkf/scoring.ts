/**
 * Novelty & priority scoring — the layer that makes idea selection deliberate
 * rather than RAG-random.
 *
 * The loop should not just retrieve nearby literature and try it. It should rank
 * candidate ideas by a transparent priority:
 *
 *   priority = expected_value
 *            × feasibility
 *            × evidence_strength
 *            × novelty
 *            × information_gain
 *            ÷ implementation_cost
 *
 * Most factors are derived automatically from a card's existing fields (belief,
 * verification level, recency/reliability) so the agent gets a useful ranking for
 * free, but every factor can be overridden when the agent knows better. The
 * function returns the full factor breakdown so a ranking is never a black box.
 *
 * Pure module (no fs, no pi runtime) so it is fully unit-testable.
 */
import type { Altitude, Verification } from "./cards.ts";
import type { AltitudePreference } from "./config.ts";

/** Evidence strength implied by a card's verification level, in [0,1]. */
export const EVIDENCE_STRENGTH: Record<Verification, number> = {
  reported_by_paper: 0.4,
  verified_by_agent: 0.6,
  verified_by_local_experiment: 0.85,
  verified_by_independent_reproduction: 0.95,
  contradicted_by_local_experiment: 0.1,
};

/**
 * The "standard playbook" — obvious moves an autoresearch loop rediscovers on
 * every dataset. Ideas close to these are penalized on novelty so the loop
 * spends its budget on less-trodden ground. Extendable per domain.
 */
export const DEFAULT_PLAYBOOK: readonly string[] = [
  "gradient clipping",
  "cosine learning rate schedule",
  "warmup schedule",
  "batch size tuning",
  "dropout regularization",
  "weight decay tuning",
  "swiglu activation",
  "label smoothing",
  "mixed precision training",
  "data augmentation",
  "early stopping",
  "layer normalization",
  // "Just train longer" — the cheapest, least-novel lever. It buys metric at the
  // cost of compute without teaching us anything about the problem, so it's
  // penalized by default. The hypothesis-loop skill blocks it outright unless the
  // user explicitly asks or there's evidence of under-training.
  "increase epochs train longer",
  "more training steps iterations",
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "over", "under",
  "via", "than", "then", "when", "while", "using", "use", "uses", "based", "can",
  "will", "may", "our", "its", "are", "was", "were", "has", "have", "had", "not",
  "but", "all", "any", "more", "less", "most", "some", "such", "improve",
  "improves", "improved", "method", "approach", "result", "results",
]);

/** Lowercase word-token set, dropping short tokens and stopwords. */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

/** Jaccard similarity of two token sets, in [0,1]. Empty/empty = 0. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Largest Jaccard similarity of `text` against any string in `corpus`. */
export function maxSimilarity(text: string, corpus: readonly string[]): number {
  const tokens = tokenize(text);
  let max = 0;
  for (const other of corpus) {
    const sim = jaccard(tokens, tokenize(other));
    if (sim > max) max = sim;
  }
  return max;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface IdeaInput {
  id: string;
  title: string;
  /** Concatenated descriptive text (title + mechanism + context + body). */
  text: string;
  /** Numeric belief in [0,1] that this helps the goal. */
  belief: number;
  verification_level?: Verification;
  recency_score?: number;
  reliability_score?: number;
  /** Optional explicit overrides for the priority factors. */
  expected_value?: number;
  feasibility?: number;
  info_gain?: number;
  implementation_cost?: number;
  /** Coverage tags (see ./cards.ts) — drive structural novelty + altitude bias. */
  lever?: string;
  altitude?: Altitude | string;
  /** Flagged stale (valid_until passed, or `vkf freshness` flagged it). Penalized. */
  stale?: boolean;
}

export interface ScoreFactors {
  expected_value: number;
  feasibility: number;
  evidence_strength: number;
  novelty: number;
  /** How under-explored this idea's lever·altitude bucket is, [0,1]. */
  structural_novelty: number;
  /** Goal-gated bias for the idea's altitude (1 = neutral). */
  altitude_affinity: number;
  info_gain: number;
  implementation_cost: number;
  /** Freshness multiplier: 1 when current, <1 when flagged stale. */
  freshness: number;
}

export interface ScoredIdea {
  id: string;
  title: string;
  priority: number;
  factors: ScoreFactors;
  /** Max similarity to already-explored / playbook text (drives novelty). */
  max_similarity: number;
  /** The `lever|altitude` bucket this idea falls in. */
  bucket: string;
}

/**
 * Altitude bias per preference mode; missing altitude is treated as neutral.
 * `high` (the default for non-tuning goals) penalizes hyperparameter-altitude
 * ideas hard: knob tweaks are off the loop's menu unless the user explicitly
 * asks for tuning (which switches the mode and restores them to parity).
 */
const ALTITUDE_AFFINITY: Record<AltitudePreference, Record<string, number>> = {
  any: { hyperparameter: 1, component: 1, mechanism: 1, reframe: 1 },
  high: { hyperparameter: 0.35, component: 0.85, mechanism: 1, reframe: 1 },
  tuning: { hyperparameter: 1, component: 0.8, mechanism: 0.6, reframe: 0.5 },
};

export function bucketKey(lever?: string, altitude?: string): string {
  return `${lever ?? "untagged"}|${altitude ?? "untagged"}`;
}

export interface ScoreOptions {
  /** Texts of ideas already explored (tried experiments, settled claims). */
  explored?: readonly string[];
  /** Standard-playbook phrases to penalize. Defaults to DEFAULT_PLAYBOOK. */
  playbook?: readonly string[];
  /** Count of already-run experiments per `lever|altitude` bucket. */
  bucketCounts?: Record<string, number>;
  /** Total already-run experiments (denominator for bucket saturation). */
  exploredTotal?: number;
  /** Altitude bias mode. Default "any" (neutral). */
  altitudePreference?: AltitudePreference;
}

/**
 * Score one idea, returning its priority and the factor breakdown.
 *
 * - evidence_strength: from the verification level, averaged with reliability.
 * - novelty: how far the idea is from explored/playbook ground, lifted by
 *   recency (recent *and* dissimilar = most novel).
 * - info_gain: highest when belief is uncertain (~0.5) — that's where a test
 *   teaches the most.
 */
export function scoreIdea(idea: IdeaInput, opts: ScoreOptions = {}): ScoredIdea {
  const explored = opts.explored ?? [];
  const playbook = opts.playbook ?? DEFAULT_PLAYBOOK;

  const belief = clamp(idea.belief ?? 0.5, 0, 1);
  const expected_value = clamp(idea.expected_value ?? belief, 0, 1);
  const feasibility = clamp(idea.feasibility ?? 0.6, 0, 1);

  const evidenceBase = idea.verification_level
    ? EVIDENCE_STRENGTH[idea.verification_level]
    : 0.4;
  const evidence_strength =
    idea.reliability_score !== undefined
      ? clamp((evidenceBase + idea.reliability_score) / 2, 0, 1)
      : evidenceBase;

  const max_similarity = Math.max(
    maxSimilarity(idea.text, explored),
    maxSimilarity(idea.text, playbook),
  );
  const recency = clamp(idea.recency_score ?? 0.5, 0, 1);
  const lexicalNovelty = (1 - max_similarity) * (0.5 + 0.5 * recency);

  // Structural novelty: how under-explored this idea's lever·altitude bucket is.
  // A 12th tweak to an already-saturated bucket is *lexically* fresh but
  // structurally stale — this is what actually pushes the loop off tuning.
  const bucket = bucketKey(idea.lever, idea.altitude);
  const exploredTotal = opts.exploredTotal ?? 0;
  const saturation = exploredTotal > 0 ? (opts.bucketCounts?.[bucket] ?? 0) / exploredTotal : 0;
  const structural_novelty = clamp(1 - saturation, 0, 1);
  const novelty = clamp(lexicalNovelty * (0.5 + 0.5 * structural_novelty), 0, 1);

  // Goal-gated altitude bias. Neutral by default; "tuning" leaves tweaks alone.
  const affinity = ALTITUDE_AFFINITY[opts.altitudePreference ?? "any"];
  const altitude_affinity = affinity[idea.altitude ?? "component"] ?? 1;

  const info_gain = clamp(idea.info_gain ?? 1 - Math.abs(belief - 0.5) * 2, 0.05, 1);
  const implementation_cost = clamp(idea.implementation_cost ?? 0.4, 0.05, 1);

  // Stale knowledge shouldn't steer the loop on equal footing with current
  // evidence — halve its priority rather than dropping it outright (it may still
  // be worth re-verifying). Driven by valid_until / `vkf freshness`.
  const freshness = idea.stale ? 0.5 : 1;

  const priority =
    (expected_value * feasibility * evidence_strength * novelty * info_gain * altitude_affinity * freshness) /
    implementation_cost;

  return {
    id: idea.id,
    title: idea.title,
    priority,
    factors: {
      expected_value,
      feasibility,
      evidence_strength,
      novelty,
      structural_novelty,
      altitude_affinity,
      info_gain,
      implementation_cost,
      freshness,
    },
    max_similarity,
    bucket,
  };
}

/** Score and rank ideas, highest priority first. */
export function rankIdeas(ideas: readonly IdeaInput[], opts: ScoreOptions = {}): ScoredIdea[] {
  return ideas.map((i) => scoreIdea(i, opts)).sort((a, b) => b.priority - a.priority);
}

// ── explore / exploit budget ────────────────────────────────────────────────

export type Slot = "explore" | "exploit";

/**
 * An idea is an *explore* bet if it's high-altitude (mechanism/reframe) or it
 * opens up an under-explored `lever·altitude` bucket. Everything else is an
 * *exploit* — a reliable, incremental move on well-trodden ground. (Outcome
 * uncertainty already feeds `info_gain` in the priority; using it here too would
 * mark almost every mid-belief idea "explore" and wash out the distinction.)
 */
export function classifySlot(r: ScoredIdea, idea: IdeaInput): Slot {
  const highAltitude = idea.altitude === "mechanism" || idea.altitude === "reframe";
  return highAltitude || r.factors.structural_novelty > 0.6 ? "explore" : "exploit";
}

export interface BalancedPick {
  r: ScoredIdea;
  idea: IdeaInput;
  slot: Slot;
}

interface Candidate extends BalancedPick {}

/** Take up to `n` from `pool`, preferring unseen buckets, then filling the rest. */
function pickDiverse(
  pool: Candidate[],
  n: number,
  usedBuckets: Set<string>,
  chosen: Set<string>,
): Candidate[] {
  const out: Candidate[] = [];
  for (const pass of [true, false]) {
    for (const c of pool) {
      if (out.length >= n) break;
      if (chosen.has(c.r.id)) continue;
      if (pass && usedBuckets.has(c.r.bucket)) continue; // first pass: distinct buckets
      out.push(c);
      chosen.add(c.r.id);
      usedBuckets.add(c.r.bucket);
    }
  }
  return out;
}

/**
 * Pick the next `k` experiments, reserving ⌈exploreFraction·k⌉ slots for explore
 * bets even when their raw priority is lower — this is the mechanism that stops
 * reliable small tweaks from crowding out high-variance conceptual bets. Within
 * each slot type, prefer distinct `lever·altitude` buckets so the batch isn't k
 * near-duplicates. `exploreFraction = 0` ⇒ no reserved explore slots.
 */
export function selectBalanced(
  scored: readonly { r: ScoredIdea; idea: IdeaInput }[],
  opts: { exploreFraction: number; k: number },
): BalancedPick[] {
  const k = Math.max(1, Math.floor(opts.k));
  const frac = clamp(opts.exploreFraction, 0, 1);
  const exploreSlots = Math.ceil(frac * k);
  const exploitSlots = k - exploreSlots;

  const ranked: Candidate[] = [...scored]
    .sort((a, b) => b.r.priority - a.r.priority)
    .map((s) => ({ ...s, slot: classifySlot(s.r, s.idea) }));

  const exploit = ranked.filter((c) => c.slot === "exploit");
  const explore = ranked.filter((c) => c.slot === "explore");

  const usedBuckets = new Set<string>();
  const chosen = new Set<string>();
  const picks: Candidate[] = [
    ...pickDiverse(exploit, exploitSlots, usedBuckets, chosen),
    ...pickDiverse(explore, exploreSlots, usedBuckets, chosen),
  ];
  // Backfill from anything left if a pool came up short.
  if (picks.length < k) {
    picks.push(...pickDiverse(ranked, k - picks.length, usedBuckets, chosen));
  }
  return picks.sort((a, b) => b.r.priority - a.r.priority);
}
