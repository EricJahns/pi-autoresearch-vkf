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
import type { Verification } from "./cards.ts";

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
}

export interface ScoreFactors {
  expected_value: number;
  feasibility: number;
  evidence_strength: number;
  novelty: number;
  info_gain: number;
  implementation_cost: number;
}

export interface ScoredIdea {
  id: string;
  title: string;
  priority: number;
  factors: ScoreFactors;
  /** Max similarity to already-explored / playbook text (drives novelty). */
  max_similarity: number;
}

export interface ScoreOptions {
  /** Texts of ideas already explored (tried experiments, settled claims). */
  explored?: readonly string[];
  /** Standard-playbook phrases to penalize. Defaults to DEFAULT_PLAYBOOK. */
  playbook?: readonly string[];
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
  const novelty = clamp((1 - max_similarity) * (0.5 + 0.5 * recency), 0, 1);

  const info_gain = clamp(idea.info_gain ?? 1 - Math.abs(belief - 0.5) * 2, 0.05, 1);
  const implementation_cost = clamp(idea.implementation_cost ?? 0.4, 0.05, 1);

  const priority =
    (expected_value * feasibility * evidence_strength * novelty * info_gain) /
    implementation_cost;

  return {
    id: idea.id,
    title: idea.title,
    priority,
    factors: { expected_value, feasibility, evidence_strength, novelty, info_gain, implementation_cost },
    max_similarity,
  };
}

/** Score and rank ideas, highest priority first. */
export function rankIdeas(ideas: readonly IdeaInput[], opts: ScoreOptions = {}): ScoredIdea[] {
  return ideas.map((i) => scoreIdea(i, opts)).sort((a, b) => b.priority - a.priority);
}
