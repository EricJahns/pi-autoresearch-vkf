/**
 * Benchmark harness: standard (blind) autoresearch vs ours (VKF memory + novelty
 * scoring + hypothesis synthesis).
 *
 * What this measures — and what it does not. A full end-to-end benchmark would run
 * a real LLM agent editing real repos; that's the "killer demo" and needs an API
 * key, compute, and human novelty ratings (see benchmark/README.md). This harness
 * instead isolates the *search policy*: given the same idea-environment with known
 * ground truth and the same experiment budget, does the memory+scoring+synthesis
 * policy search better than a blind one?
 *
 * Crucially, both policies are driven through the **real** modules under test —
 * `scoring.ts` (rankIdeas) and `synthesis.ts` (findContradictions) — so this
 * benchmarks the actual code, not a reimplementation. Only the agent's *reasoning*
 * and the *environment* are simulated, and deterministically (seeded), so results
 * are reproducible.
 */
import { rankIdeas, type IdeaInput } from "../extensions/pi-autoresearch-vkf/scoring.ts";
import {
  contextSimilarity,
  findContradictions,
  type CardLike,
} from "../extensions/pi-autoresearch-vkf/synthesis.ts";

export interface GroundTruthIdea {
  id: string;
  title: string;
  mechanism: string;
  context: string;
  /** True metric improvement if tried (e.g. loss reduction). 0/negative = dud. */
  trueDelta: number;
  isPlaybook?: boolean;
  /** Agent's a-priori attraction to this idea, [0,1] (EV proxy). */
  priorEV: number;
  recency: number;
  reliability: number;
  cost?: number;
  /** Ideas in the same dead-end family share a group id. */
  deadEndGroup?: string;
}

/** A synthesized idea unlocked only when both parents have been tried AND the
 *  contradiction miner flags the pair — i.e. discoverable solely by synthesis. */
export interface Combo {
  id: string;
  title: string;
  mechanism: string;
  context: string;
  parents: [string, string];
  trueDelta: number;
  priorEV: number;
  recency: number;
  reliability: number;
}

export interface Scenario {
  name: string;
  /** Starting metric (lower is better, e.g. validation loss). */
  baseline: number;
  /** Experiment budget (number of runs allowed). */
  budget: number;
  /** Improvement at/above which we count the run as finding the optimum. */
  optimumImprovement: number;
  ideas: GroundTruthIdea[];
  combos: Combo[];
}

export interface RunMetrics {
  bestImprovement: number;
  uniqueMechanisms: number;
  wastedExperiments: number;
  deadEndsRetried: number;
  combosDiscovered: number;
  foundOptimum: boolean;
}

// ── seeded RNG ─────────────────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const NOISE_SIGMA = 0.008;

/** Deterministic noisy measurement for trying `ideaId` under `seed` — the same
 *  regardless of policy or ordering, so both policies are judged on equal draws. */
function observe(trueDelta: number, ideaId: string, seed: number): number {
  const rng = mulberry32(hashStr(`${seed}|${ideaId}`));
  return trueDelta + NOISE_SIGMA * gauss(rng);
}

// ── shared types ───────────────────────────────────────────────────────────────

type Candidate = GroundTruthIdea | (Combo & { isCombo: true });
const isCombo = (c: Candidate): c is Combo & { isCombo: true } => "parents" in c;

const text = (c: { title: string; mechanism?: string; context?: string }): string =>
  `${c.title} ${c.mechanism ?? ""} ${c.context ?? ""}`;

const LOSS_THRESHOLD = 0.005; // observed delta at/below this counts as a dud/loss

// ── baseline: standard autoresearch (blind) ────────────────────────────────────
/**
 * Models a loop with no structured memory: it reaches for ideas by apparent value
 * (EV-greedy, favoring the obvious playbook), and — lacking durable memory across
 * context resets — sometimes re-tries what it already ran. No novelty awareness,
 * no dead-end abandonment, no synthesis.
 */
export function runBaseline(scenario: Scenario, seed: number): RunMetrics {
  const rng = mulberry32(hashStr(`baseline|${seed}`));
  const forgetRate = 0.25;
  const byEV = [...scenario.ideas].sort((a, b) => b.priorEV - a.priorEV);

  const tried: string[] = [];
  const triedSet = new Set<string>();
  const mechanisms = new Set<string>();
  const deadEndsSeen = new Set<string>();
  let best = 0;
  let wasted = 0;
  let deadEndsRetried = 0;

  const record = (idea: GroundTruthIdea, repeat: boolean): void => {
    const delta = observe(idea.trueDelta, idea.id, seed);
    if (delta > best) best = delta;
    if (repeat) {
      wasted++;
      return;
    }
    mechanisms.add(idea.mechanism);
    if (idea.deadEndGroup) {
      if (deadEndsSeen.has(idea.deadEndGroup)) deadEndsRetried++;
      deadEndsSeen.add(idea.deadEndGroup);
    }
    tried.push(idea.id);
    triedSet.add(idea.id);
  };

  for (let step = 0; step < scenario.budget; step++) {
    const untried = byEV.filter((i) => !triedSet.has(i.id));
    if (tried.length > 0 && (rng() < forgetRate || untried.length === 0)) {
      // No durable memory: re-run something already tried.
      const pick = tried[Math.floor(rng() * tried.length)]!;
      const idea = scenario.ideas.find((i) => i.id === pick)!;
      record(idea, true);
    } else {
      record(untried[0]!, false);
    }
  }

  return {
    bestImprovement: best,
    uniqueMechanisms: mechanisms.size,
    wastedExperiments: wasted,
    deadEndsRetried,
    combosDiscovered: 0,
    foundOptimum: best >= scenario.optimumImprovement,
  };
}

// ── ours: memory + novelty scoring + synthesis ─────────────────────────────────
/**
 * Durable memory (never repeats), priority ranking via the real `rankIdeas`
 * (novelty-aware), belief updates that abandon a dead-end family, and hypothesis
 * synthesis via the real `findContradictions` to unlock combos outside the
 * retrieved pool.
 */
export function runOurs(scenario: Scenario, seed: number): RunMetrics {
  const beliefs = new Map<string, number>();
  for (const i of scenario.ideas) beliefs.set(i.id, i.priorEV);

  const pool: Candidate[] = [...scenario.ideas];
  const triedSet = new Set<string>();
  const triedCards: CardLike[] = [];
  const mechanisms = new Set<string>();
  const deadEndsSeen = new Set<string>();
  let best = 0;
  let deadEndsRetried = 0;
  let combosDiscovered = 0;

  for (let step = 0; step < scenario.budget; step++) {
    const untried = pool.filter((c) => !triedSet.has(c.id));
    if (untried.length === 0) break;

    const inputs: IdeaInput[] = untried.map((c) => ({
      id: c.id,
      title: c.title,
      text: text(c),
      belief: beliefs.get(c.id) ?? c.priorEV,
      recency_score: c.recency,
      reliability_score: c.reliability,
      expected_value: c.priorEV,
      feasibility: 0.7,
      implementation_cost: isCombo(c) ? 0.5 : (c.cost ?? 0.4),
    }));
    const ranked = rankIdeas(inputs, { explored: triedCards.map(text) });
    const pickId = ranked[0]!.id;
    const pick = untried.find((c) => c.id === pickId)!;

    const delta = observe(pick.trueDelta, pick.id, seed);
    if (delta > best) best = delta;

    triedSet.add(pick.id);
    mechanisms.add(pick.mechanism);
    if (isCombo(pick)) combosDiscovered++;
    if (!isCombo(pick) && pick.deadEndGroup) {
      if (deadEndsSeen.has(pick.deadEndGroup)) deadEndsRetried++;
      deadEndsSeen.add(pick.deadEndGroup);
    }

    const won = delta > LOSS_THRESHOLD;
    const card: CardLike = {
      id: pick.id,
      title: pick.title,
      mechanism: pick.mechanism,
      context: pick.context,
      text: text(pick),
      memory_state: won ? "locally_tested" : "contradicted",
    };
    triedCards.push(card);

    // Belief update: a loss is evidence the whole *regime* is bad, so deprioritize
    // untried ideas sharing the failed idea's context (the dead-end region). This
    // is the memory advantage — a blind loop keeps reaching back into the region
    // because each member looked individually attractive.
    if (!won) {
      for (const c of pool) {
        if (triedSet.has(c.id)) continue;
        const other: CardLike = { id: c.id, title: c.title, context: c.context, text: text(c) };
        if (contextSimilarity(card, other) > 0.5) {
          beliefs.set(c.id, (beliefs.get(c.id) ?? c.priorEV) * 0.25);
        }
      }
    }

    // Synthesis: a combo unlocks only when both parents are tried AND the real
    // contradiction miner flags the pair.
    const tensions = findContradictions(triedCards);
    for (const combo of scenario.combos) {
      const [pa, pb] = combo.parents;
      if (!triedSet.has(pa) || !triedSet.has(pb)) continue;
      if (pool.some((c) => c.id === combo.id)) continue;
      const flagged = tensions.some(
        (t) => (t.a === pa && t.b === pb) || (t.a === pb && t.b === pa),
      );
      if (flagged) {
        pool.push({ ...combo, isCombo: true });
        beliefs.set(combo.id, combo.priorEV);
      }
    }
  }

  return {
    bestImprovement: best,
    uniqueMechanisms: mechanisms.size,
    wastedExperiments: 0,
    deadEndsRetried,
    combosDiscovered,
    foundOptimum: best >= scenario.optimumImprovement,
  };
}

// ── aggregation & reporting ────────────────────────────────────────────────────

export interface Aggregate {
  bestImprovement: number;
  uniqueMechanisms: number;
  wastedExperiments: number;
  deadEndsRetried: number;
  combosDiscovered: number;
  foundOptimumRate: number;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function aggregate(
  scenario: Scenario,
  run: (s: Scenario, seed: number) => RunMetrics,
  seeds: number,
): Aggregate {
  const results = Array.from({ length: seeds }, (_, s) => run(scenario, s));
  return {
    bestImprovement: mean(results.map((r) => r.bestImprovement)),
    uniqueMechanisms: mean(results.map((r) => r.uniqueMechanisms)),
    wastedExperiments: mean(results.map((r) => r.wastedExperiments)),
    deadEndsRetried: mean(results.map((r) => r.deadEndsRetried)),
    combosDiscovered: mean(results.map((r) => r.combosDiscovered)),
    foundOptimumRate: mean(results.map((r) => (r.foundOptimum ? 1 : 0))),
  };
}

export interface ScenarioReport {
  name: string;
  baseline: Aggregate;
  ours: Aggregate;
}

export function runScenario(scenario: Scenario, seeds: number): ScenarioReport {
  return {
    name: scenario.name,
    baseline: aggregate(scenario, runBaseline, seeds),
    ours: aggregate(scenario, runOurs, seeds),
  };
}

export function renderReport(reports: ScenarioReport[], seeds: number): string {
  const pct = (n: number): string => (n * 100).toFixed(0) + "%";
  const f2 = (n: number): string => n.toFixed(3);
  const lines: string[] = [];
  lines.push(`# Benchmark: standard autoresearch vs pi-autoresearch-vkf`);
  lines.push("");
  lines.push(`Mean over ${seeds} seeds per scenario. "Standard" = blind loop (EV-greedy,`);
  lines.push(`no durable memory, no synthesis). "Ours" = VKF memory + novelty scoring +`);
  lines.push(`contradiction synthesis, driven through the real scoring/synthesis modules.`);
  lines.push("");

  for (const r of reports) {
    lines.push(`## ${r.name}`);
    lines.push("");
    lines.push(`| Metric | Standard | Ours |`);
    lines.push(`|---|---:|---:|`);
    lines.push(`| Best improvement (higher better) | ${f2(r.baseline.bestImprovement)} | **${f2(r.ours.bestImprovement)}** |`);
    lines.push(`| Unique mechanisms tried | ${r.baseline.uniqueMechanisms.toFixed(1)} | **${r.ours.uniqueMechanisms.toFixed(1)}** |`);
    lines.push(`| Wasted (repeat) experiments | ${r.baseline.wastedExperiments.toFixed(1)} | **${r.ours.wastedExperiments.toFixed(1)}** |`);
    lines.push(`| Dead-ends retried | ${r.baseline.deadEndsRetried.toFixed(1)} | **${r.ours.deadEndsRetried.toFixed(1)}** |`);
    lines.push(`| Synthesized ideas discovered | ${r.baseline.combosDiscovered.toFixed(1)} | **${r.ours.combosDiscovered.toFixed(1)}** |`);
    lines.push(`| Found optimum (rate) | ${pct(r.baseline.foundOptimumRate)} | **${pct(r.ours.foundOptimumRate)}** |`);
    lines.push("");
  }
  return lines.join("\n");
}
