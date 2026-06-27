/**
 * Renders research status as plain text lines for the live widget (above the
 * editor) and the fullscreen overlay. Dependency-light: it reads `.auto/` and
 * `.research-memory/` from disk and returns `string[]`, so it works regardless
 * of theme support.
 *
 * The two halves mirror the architecture: the *session* (what this run has
 * tried) and the *memory* (durable knowledge by lifecycle state).
 */
import { readConfig } from "./config.ts";
import {
  listCards,
  MEMORY_STATES,
  type Card,
  type MemoryState,
} from "./cards.ts";
import {
  OUTCOME_GLYPH,
  readExperiments,
  summarize,
} from "./experiments.ts";
import { hasMemory, sessionPaths } from "./paths.ts";

const trimNum = (v: number): string =>
  Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));

function memoryCounts(root: string): Record<MemoryState, number> {
  const counts = Object.fromEntries(MEMORY_STATES.map((s) => [s, 0])) as Record<MemoryState, number>;
  if (!hasMemory(root)) return counts;
  for (const card of listCards(root)) {
    const state = card.meta["memory_state"] as MemoryState | undefined;
    if (state && state in counts) counts[state] += 1;
  }
  return counts;
}

function experimentLine(root: string): string {
  const p = sessionPaths(root);
  const config = readConfig(p.config);
  if (!config) return "";
  const s = summarize(readExperiments(p.experiments), config.direction);
  const best = s.best === undefined ? "—" : `${trimNum(s.best)}`;
  return (
    `${OUTCOME_GLYPH.win} ${s.win}  ${OUTCOME_GLYPH.loss} ${s.loss}  ` +
    `${OUTCOME_GLYPH.inconclusive} ${s.inconclusive}  (best ${config.metricName}: ${best})`
  );
}

function memoryLine(root: string): string {
  const c = memoryCounts(root);
  const verified = c.source_verified + c.locally_tested + c.replicated;
  return `memory: ${c.candidate} candidate · ${verified} verified · ${c.contradicted} contradicted`;
}

/** Compact widget shown above the editor. Returns `[]` when there is no session. */
export function buildWidgetLines(root: string): string[] {
  const config = readConfig(sessionPaths(root).config);
  if (!config) return [];
  return [`pi-autoresearch-vkf · ${config.name}`, experimentLine(root), memoryLine(root)];
}

/** Full status for the fullscreen overlay. */
export function buildFullscreenLines(root: string): string[] {
  const p = sessionPaths(root);
  const config = readConfig(p.config);
  if (!config) {
    return ["No pi-autoresearch-vkf session in this directory.", "", "Press any key to close."];
  }

  const lines: string[] = [];
  lines.push(`pi-autoresearch-vkf — ${config.name}`);
  lines.push(`goal:    ${config.goal}`);
  lines.push(`metric:  ${config.metricName} (${config.direction} is better)`);
  if (config.baseline !== undefined) lines.push(`baseline: ${trimNum(config.baseline)}`);
  lines.push("");
  lines.push("── session experiments ──");
  lines.push(experimentLine(root));

  const experiments = readExperiments(p.experiments);
  for (const e of experiments.slice(-12)) {
    const v = e.value === undefined ? "—" : trimNum(e.value);
    lines.push(
      `${OUTCOME_GLYPH[e.outcome]} ${e.id}  ${e.description}  (${config.metricName}=${v}${e.kept ? ", kept" : ""})`,
    );
  }

  lines.push("");
  lines.push("── research memory (VKF) ──");
  const counts = memoryCounts(root);
  for (const state of MEMORY_STATES) {
    if (counts[state] > 0) lines.push(`  ${counts[state]}× ${state}`);
  }

  const verified: Card[] = listCards(root, { bucket: "verified" });
  if (verified.length) {
    lines.push("");
    lines.push("  verified claims:");
    for (const c of verified.filter((c) => c.meta["type"] === "claim").slice(0, 8)) {
      const conf = c.meta["confidence"];
      lines.push(`    • ${c.meta["title"]}  (confidence ${conf})`);
    }
  }

  lines.push("");
  lines.push("Press any key to close.");
  return lines;
}
