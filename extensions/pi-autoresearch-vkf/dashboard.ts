/**
 * Renders research status as plain text lines for the live widget (above the
 * editor) and the fullscreen overlay. Dependency-light: it reads `.autoresearch-vkf/session/` and
 * `.autoresearch-vkf/memory/` from disk and returns `string[]`, so it works regardless
 * of theme support.
 *
 * The two halves mirror the architecture: the *session* (what this run has
 * tried) and the *memory* (durable knowledge by lifecycle state).
 */
import { existsSync } from "node:fs";
import { autonomyMode, readConfig, sessionMode, type ResearchConfig } from "./config.ts";
import {
  LEVERS,
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
import { outcomeStyle, style } from "./style.ts";

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
    `${style.success(OUTCOME_GLYPH.win + " " + s.win)}  ` +
    `${style.error(OUTCOME_GLYPH.loss + " " + s.loss)}  ` +
    `${style.warn(OUTCOME_GLYPH.inconclusive + " " + s.inconclusive)}  ` +
    `${style.muted("(best " + config.metricName + ": ")}${style.accent(best)}${style.muted(")")}`
  );
}

function memoryLine(root: string): string {
  const c = memoryCounts(root);
  const verified = c.source_verified + c.locally_tested + c.replicated;
  return (
    style.muted("memory: ") +
    `${style.warn(c.candidate + " candidate")}${style.muted(" · ")}` +
    `${style.success(verified + " verified")}${style.muted(" · ")}` +
    `${style.error(c.contradicted + " contradicted")}`
  );
}

/**
 * The loop-state line: session mode, autonomy, budget burn, and the user's
 * STOP request when present. This is what makes unattended (continuous) runs
 * legible at a glance — the UI replaces mid-loop check-ins.
 */
function loopLine(root: string, config: ResearchConfig): string {
  const p = sessionPaths(root);
  const experiments = readExperiments(p.experiments);
  const iter = config.maxIterations
    ? `iteration ${experiments.length}/${config.maxIterations}`
    : `iteration ${experiments.length}`;
  const parts = [
    style.muted("loop: ") + sessionMode(config) + style.muted(" · ") + autonomyMode(config) + style.muted(" · ") + iter,
  ];
  if (existsSync(p.stop)) parts.push(style.error("⏸ STOP requested"));
  const last = experiments[experiments.length - 1];
  const best = summarize(experiments, config.direction).best;
  if (last?.value !== undefined && last.value === best && last.outcome === "win") {
    parts.push(style.accent("★ new best"));
  }
  return parts.join(style.muted(" · "));
}

const ALT_ABBR: Record<string, string> = {
  hyperparameter: "hp",
  component: "comp",
  mechanism: "mech",
  reframe: "reframe",
};

/**
 * The rut-detector: how the experiments we've actually run spread across
 * `lever·altitude` buckets, plus the levers never touched. One glance shows
 * "11 tweaks to the algorithm, never touched the data or the objective".
 * Returns `undefined` when nothing has been tagged yet.
 */
function coverageLine(root: string): string | undefined {
  const experiments = readExperiments(sessionPaths(root).experiments);
  const counts = new Map<string, number>();
  const touchedLevers = new Set<string>();
  let untagged = 0;
  for (const e of experiments) {
    if (!e.lever && !e.altitude) {
      untagged += 1;
      continue;
    }
    if (e.lever) touchedLevers.add(e.lever);
    const key = `${e.lever ?? "?"}·${ALT_ABBR[e.altitude ?? ""] ?? e.altitude ?? "?"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0 && untagged === 0) return undefined;

  const buckets = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, n]) => `${k} ×${n}`);
  if (untagged > 0) buckets.push(`untagged ×${untagged}`);

  const untouched = LEVERS.filter((l) => !touchedLevers.has(l));
  const tail = untouched.length
    ? style.muted("   |   untouched: ") + style.warn(untouched.join(", "))
    : "";
  return style.muted("coverage: ") + buckets.join(style.muted(" · ")) + tail;
}

/** keep / discard if decided, otherwise the raw outcome (win/loss/…). */
function statusLabel(e: Experiment): string {
  const word = e.kept === true ? "keep" : e.kept === false ? "discard" : e.outcome;
  return `${OUTCOME_GLYPH[e.outcome]} ${word}`;
}

/** Optional per-element styling for {@link renderTable}. */
interface TableStyle {
  /** Wraps each header cell (after padding). */
  header?: (t: string) => string;
  /** Wraps the whole rule line. */
  rule?: (t: string) => string;
  /** Wraps a body cell. `text` is already padded; `col`/`row` are 0-based. */
  cell?: (text: string, col: number, row: number) => string;
}

/**
 * Render a fixed-width text table: header row, a rule, then the body rows.
 * `align[i]` controls per-column justification ("r" right-justifies numbers).
 *
 * Column widths are measured on the *plain* text and padding is applied before
 * any color, so ANSI escapes from `style` never disturb alignment. The trailing
 * (left-aligned) column is left unpadded so colored cells carry no stray spaces.
 */
function renderTable(
  headers: string[],
  rows: string[][],
  align: ("l" | "r")[],
  ts: TableStyle = {},
): string[] {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const last = headers.length - 1;
  const pad = (c: string, i: number): string => {
    if (i === last && align[i] !== "r") return c; // trailing free column: no padding
    return align[i] === "r" ? c.padStart(widths[i]!) : c.padEnd(widths[i]!);
  };
  const headerLine = headers
    .map((h, i) => (ts.header ? ts.header(pad(h, i)) : pad(h, i)))
    .join("  ")
    .trimEnd();
  const rule = widths.map((w) => "─".repeat(w)).join("  ");
  const ruleLine = ts.rule ? ts.rule(rule) : rule;
  const body = rows.map((cells, r) =>
    cells
      .map((c, i) => {
        const padded = pad(c, i);
        return ts.cell ? ts.cell(padded, i, r) : padded;
      })
      .join("  "),
  );
  return [headerLine, ruleLine, ...body];
}

/**
 * The recent-runs table: # · commit · each metric · status · description.
 *
 * Ordered oldest→newest (newest at the bottom), showing only the last
 * `WIDGET_ROWS`. pi truncates an over-tall widget from the *bottom*, so the
 * caller keeps the shortcut hint above this table; the `#` run-number column
 * keeps every row identifiable even when older runs are dropped off the top.
 */
function runsTable(root: string, metricName: string): string[] {
  const experiments = readExperiments(sessionPaths(root).experiments);
  if (experiments.length === 0) return ["(no experiments yet)"];

  const start = Math.max(0, experiments.length - WIDGET_ROWS);
  const recent = experiments.slice(start); // oldest→newest, newest last
  const perRow = recent.map((e) => experimentMetrics(e, metricName));

  // Metric columns: the primary metric first, then any others seen, sorted.
  // Cap at 5 columns total to keep the widget readable (the web page has them all).
  const others = new Set<string>();
  for (const m of perRow) for (const k of Object.keys(m)) if (k !== metricName) others.add(k);
  const metricCols = [metricName, ...[...others].sort()].slice(0, 5);

  const headers = ["#", "commit", ...metricCols, "status", "change"];
  const align: ("l" | "r")[] = ["r", "l", ...metricCols.map((): "r" => "r"), "l", "l"];
  const rows = recent.map((e, i) => {
    const m = perRow[i]!;
    return [
      String(start + i + 1),
      e.commit ?? "—",
      ...metricCols.map((c) => (m[c] === undefined ? "—" : trimNum(m[c]!))),
      statusLabel(e),
      e.description.length > 40 ? e.description.slice(0, 39) + "…" : e.description,
    ];
  });

  // Column landmarks for the cell colorizer.
  const idxCol = 0;
  const commitCol = 1;
  const primaryCol = 2; // the primary metric is always the first metric column
  const statusCol = 2 + metricCols.length;
  const newest = recent.length - 1;

  return renderTable(headers, rows, align, {
    header: style.bold,
    rule: style.muted,
    cell: (text, col, row) => {
      const tint = outcomeStyle(recent[row]!.outcome);
      if (col === idxCol) return row === newest ? style.bold(style.accent(text)) : style.muted(text);
      if (col === commitCol) return style.muted(text);
      if (col === primaryCol) return tint(text);
      if (col === statusCol) return tint(text);
      return text;
    },
  });
}

/** Compact widget shown above the editor. Returns `[]` when there is no session. */
export function buildWidgetLines(root: string): string[] {
  const config = readConfig(sessionPaths(root).config);
  if (!config) return [];
  const s = summarize(readExperiments(sessionPaths(root).experiments), config.direction);
  const best = s.best === undefined ? "—" : trimNum(s.best);
  const dot = style.muted(" · ");
  const runsLine =
    style.muted("runs: ") + style.bold(String(s.total)) + dot +
    style.success("kept: " + s.kept) + dot +
    style.error("discarded: " + s.discarded) + dot +
    style.warn("inconclusive: " + s.inconclusive) + dot +
    style.muted("best " + config.metricName + ": ") + style.accent(best);
  const coverage = coverageLine(root);
  const hint = shortcutHint();
  const title =
    style.accent(style.bold("pi-autoresearch-vkf")) + style.muted(" · ") + config.name;
  // The shortcut hint sits in the header block (above the runs table): pi
  // truncates an over-tall widget from the bottom, so anything below the table
  // would be the first thing cut. Keeping it up top guarantees it stays visible.
  return [
    title,
    runsLine,
    loopLine(root, config),
    ...(coverage ? [coverage] : []),
    memoryLine(root),
    ...(hint ? [style.muted(hint)] : []),
    "",
    ...runsTable(root, config.metricName),
  ];
}

/** Full status for the fullscreen overlay. */
export function buildFullscreenLines(root: string): string[] {
  const p = sessionPaths(root);
  const config = readConfig(p.config);
  if (!config) {
    return ["No pi-autoresearch-vkf session in this directory.", "", "Press any key to close."];
  }

  const section = (label: string): string => style.accent(style.bold(`── ${label} ──`));

  const lines: string[] = [];
  lines.push(style.accent(style.bold("pi-autoresearch-vkf")) + style.muted(" — ") + config.name);
  lines.push(style.muted("goal:    ") + config.goal);
  lines.push(style.muted("metric:  ") + config.metricName + style.muted(` (${config.direction} is better)`));
  if (config.baseline !== undefined) {
    lines.push(style.muted("baseline: ") + trimNum(config.baseline));
  }
  lines.push(loopLine(root, config));
  if (existsSync(p.researchPlan)) {
    lines.push(style.muted("plan:    ") + p.researchPlan);
  }
  lines.push("");
  lines.push(section("session experiments"));
  lines.push(experimentLine(root));

  const experiments = readExperiments(p.experiments);
  for (const e of experiments.slice(-12)) {
    const tint = outcomeStyle(e.outcome);
    const v = e.value === undefined ? "—" : trimNum(e.value);
    const kept = e.kept ? style.success(", kept") : "";
    lines.push(
      `${tint(OUTCOME_GLYPH[e.outcome])} ${style.muted(e.id)}  ${e.description}  ` +
        style.muted(`(${config.metricName}=`) + tint(v) + kept + style.muted(")"),
    );
  }

  lines.push("");
  lines.push(section("research memory (VKF)"));
  const counts = memoryCounts(root);
  for (const state of MEMORY_STATES) {
    if (counts[state] > 0) lines.push(`  ${style.bold(String(counts[state]))}× ${style.muted(state)}`);
  }

  const verified: Card[] = listCards(root, { bucket: "verified" });
  if (verified.length) {
    lines.push("");
    lines.push(style.success("  verified claims:"));
    for (const c of verified.filter((c) => c.meta["type"] === "claim").slice(0, 8)) {
      const conf = c.meta["confidence"];
      lines.push(`    ${style.success("•")} ${c.meta["title"]}  ${style.muted(`(confidence ${conf})`)}`);
    }
  }

  lines.push("");
  lines.push(style.muted("Press any key to close."));
  return lines;
}
