/**
 * Renders research status as plain text lines for the live widget (above the
 * editor) and the fullscreen overlay. Dependency-light: it reads `.autoresearch-vkf/session/` and
 * `.autoresearch-vkf/memory/` from disk and returns `string[]`, so it works regardless
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
  experimentMetrics,
  OUTCOME_GLYPH,
  readExperiments,
  summarize,
  type Experiment,
} from "./experiments.ts";
import { hasMemory, sessionPaths } from "./paths.ts";
import { loadShortcuts } from "./shortcuts.ts";

/** How many recent runs the live widget table shows. */
const WIDGET_ROWS = 7;

/** A one-line footer advertising the configured shortcuts (the "buttons"). */
function shortcutHint(): string | undefined {
  const s = loadShortcuts();
  const parts: string[] = [];
  if (s.openBrowser) parts.push(`${s.openBrowser} open in browser`);
  if (s.fullscreenDashboard) parts.push(`${s.fullscreenDashboard} dashboard`);
  return parts.length ? parts.join(" · ") : undefined;
}

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

/** keep / discard if decided, otherwise the raw outcome (win/loss/…). */
function statusLabel(e: Experiment): string {
  const word = e.kept === true ? "keep" : e.kept === false ? "discard" : e.outcome;
  return `${OUTCOME_GLYPH[e.outcome]} ${word}`;
}

/**
 * Render a fixed-width text table: header row, a rule, then the body rows.
 * `align[i]` controls per-column justification ("r" right-justifies numbers).
 */
function renderTable(headers: string[], rows: string[][], align: ("l" | "r")[]): string[] {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmt = (cells: string[]): string =>
    cells
      .map((c, i) => (align[i] === "r" ? c.padStart(widths[i]!) : c.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [fmt(headers), widths.map((w) => "─".repeat(w)).join("  "), ...rows.map(fmt)];
}

/** The recent-runs table: commit · each metric · status · description. */
function runsTable(root: string, metricName: string): string[] {
  const experiments = readExperiments(sessionPaths(root).experiments);
  if (experiments.length === 0) return ["(no experiments yet)"];

  const recent = experiments.slice(-WIDGET_ROWS).reverse(); // newest first
  const perRow = recent.map((e) => experimentMetrics(e, metricName));

  // Metric columns: the primary metric first, then any others seen, sorted.
  // Cap at 5 columns total to keep the widget readable (the web page has them all).
  const others = new Set<string>();
  for (const m of perRow) for (const k of Object.keys(m)) if (k !== metricName) others.add(k);
  const metricCols = [metricName, ...[...others].sort()].slice(0, 5);

  const headers = ["commit", ...metricCols, "status", "change"];
  const align: ("l" | "r")[] = ["l", ...metricCols.map((): "r" => "r"), "l", "l"];
  const rows = recent.map((e, i) => {
    const m = perRow[i]!;
    return [
      e.commit ?? "—",
      ...metricCols.map((c) => (m[c] === undefined ? "—" : trimNum(m[c]!))),
      statusLabel(e),
      e.description.length > 40 ? e.description.slice(0, 39) + "…" : e.description,
    ];
  });
  return renderTable(headers, rows, align);
}

/** Compact widget shown above the editor. Returns `[]` when there is no session. */
export function buildWidgetLines(root: string): string[] {
  const config = readConfig(sessionPaths(root).config);
  if (!config) return [];
  const s = summarize(readExperiments(sessionPaths(root).experiments), config.direction);
  const best = s.best === undefined ? "—" : trimNum(s.best);
  const runsLine =
    `runs: ${s.total} · kept: ${s.kept} · discarded: ${s.discarded} · ` +
    `inconclusive: ${s.inconclusive} · best ${config.metricName}: ${best}`;
  const hint = shortcutHint();
  return [
    `pi-autoresearch-vkf · ${config.name}`,
    runsLine,
    memoryLine(root),
    "",
    ...runsTable(root, config.metricName),
    ...(hint ? ["", hint] : []),
  ];
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
