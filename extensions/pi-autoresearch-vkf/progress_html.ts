/**
 * Self-contained "progress as it goes" dashboard for an autoresearch run.
 *
 * Renders the session — goal, metric-over-time chart, experiment timeline, and the
 * research-memory lifecycle — as a single HTML string with inline CSS and an inline
 * SVG chart. No build step, no external assets, no JS dependency: write it to a
 * file and open it. A `<meta refresh>` makes an open tab pick up the next export
 * while the loop runs.
 *
 * This is the metrics/progress companion to VKF's `vkf html` idea-lineage graph.
 * Pure module (string in, string out) so it is fully unit-testable.
 */

export interface ProgressExperiment {
  id: string;
  description: string;
  value?: number;
  outcome: "win" | "loss" | "inconclusive" | "pending";
  kept?: boolean;
  claim_id?: string;
  ts: string;
}

export interface ProgressData {
  name: string;
  goal: string;
  metricName: string;
  direction: "higher" | "lower";
  baseline?: number;
  experiments: ProgressExperiment[];
  /** Memory lifecycle counts keyed by state name. */
  memory: Record<string, number>;
  /** A few verified claims to surface, with their belief confidence. */
  claims: { title: string; confidence: string; state: string }[];
  generatedAt: string;
  /** Seconds between auto-refreshes; 0 disables. Default 5. */
  refreshSeconds?: number;
}

const OUTCOME_COLOR: Record<ProgressExperiment["outcome"], string> = {
  win: "#2ea043",
  loss: "#cf222e",
  inconclusive: "#9a6700",
  pending: "#57606a",
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const trimNum = (v: number): string =>
  Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));

/**
 * Build an inline SVG line chart of metric value across experiments, colored by
 * outcome, with the baseline drawn as a dashed reference line. Returns a
 * placeholder when there are too few points to plot.
 */
export function renderChart(data: ProgressData, width = 720, height = 240): string {
  const pts = data.experiments
    .map((e, i) => ({ i, v: e.value, outcome: e.outcome }))
    .filter((p): p is { i: number; v: number; outcome: ProgressExperiment["outcome"] } => p.v !== undefined);

  if (pts.length === 0) {
    return `<div class="empty">No measured experiments yet — the chart appears once results are logged.</div>`;
  }

  const pad = { l: 48, r: 16, t: 16, b: 28 };
  const W = width;
  const H = height;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const values = pts.map((p) => p.v);
  if (data.baseline !== undefined) values.push(data.baseline);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    // Avoid divide-by-zero; pad a flat series.
    min -= 1;
    max += 1;
  }
  const x = (i: number): number =>
    pad.l + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const y = (v: number): number => pad.t + innerH - ((v - min) / (max - min)) * innerH;

  const linePath = pts
    .map((p, idx) => `${idx === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");

  const dots = pts
    .map(
      (p) =>
        `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4" fill="${OUTCOME_COLOR[p.outcome]}"><title>${escapeHtml(
          `${data.metricName}=${trimNum(p.v)} (${p.outcome})`,
        )}</title></circle>`,
    )
    .join("");

  const baselineLine =
    data.baseline !== undefined
      ? `<line x1="${pad.l}" y1="${y(data.baseline).toFixed(1)}" x2="${W - pad.r}" y2="${y(
          data.baseline,
        ).toFixed(1)}" stroke="#8c959f" stroke-dasharray="4 3" stroke-width="1"/>` +
        `<text x="${W - pad.r}" y="${(y(data.baseline) - 4).toFixed(1)}" text-anchor="end" class="axis">baseline ${trimNum(
          data.baseline,
        )}</text>`
      : "";

  const yTicks = [min, (min + max) / 2, max]
    .map(
      (v) =>
        `<text x="${pad.l - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" class="axis">${trimNum(v)}</text>`,
    )
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="metric over time">
  <rect x="${pad.l}" y="${pad.t}" width="${innerW}" height="${innerH}" fill="#fff" stroke="#d0d7de"/>
  ${yTicks}
  ${baselineLine}
  <path d="${linePath}" fill="none" stroke="#0969da" stroke-width="2"/>
  ${dots}
  <text x="${pad.l}" y="${H - 8}" class="axis">experiment 1</text>
  <text x="${W - pad.r}" y="${H - 8}" text-anchor="end" class="axis">experiment ${pts.length}</text>
</svg>`;
}

function badge(outcome: ProgressExperiment["outcome"]): string {
  return `<span class="badge" style="background:${OUTCOME_COLOR[outcome]}">${outcome}</span>`;
}

export function renderProgressHtml(data: ProgressData): string {
  const refresh = data.refreshSeconds ?? 5;
  const wins = data.experiments.filter((e) => e.outcome === "win").length;
  const losses = data.experiments.filter((e) => e.outcome === "loss").length;
  const inconclusive = data.experiments.filter((e) => e.outcome === "inconclusive").length;
  const measured = data.experiments.filter((e) => e.value !== undefined).map((e) => e.value!);
  const best =
    measured.length === 0
      ? undefined
      : data.direction === "higher"
        ? Math.max(...measured)
        : Math.min(...measured);

  const rows = [...data.experiments]
    .reverse()
    .map(
      (e) => `<tr>
      <td class="mono">${escapeHtml(e.id)}</td>
      <td>${badge(e.outcome)}${e.kept ? ' <span class="kept">kept</span>' : ""}</td>
      <td class="mono">${e.value === undefined ? "—" : escapeHtml(trimNum(e.value))}</td>
      <td>${escapeHtml(e.description)}</td>
      <td class="mono dim">${e.claim_id ? escapeHtml(e.claim_id) : ""}</td>
    </tr>`,
    )
    .join("\n");

  const memoryChips = Object.entries(data.memory)
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `<span class="chip">${escapeHtml(state)}: <b>${n}</b></span>`)
    .join(" ");

  const claimRows = data.claims
    .map(
      (c) =>
        `<li><b>${escapeHtml(c.title)}</b> <span class="dim">— ${escapeHtml(c.state)}, confidence ${escapeHtml(
          c.confidence,
        )}</span></li>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
${refresh > 0 ? `<meta http-equiv="refresh" content="${refresh}"/>` : ""}
<title>pi-autoresearch-vkf — ${escapeHtml(data.name)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f6f8fa; color: #1f2328; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 24px 20px 64px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 10px; color: #424a53; text-transform: uppercase; letter-spacing: .04em; }
  .goal { color: #57606a; margin: 0 0 16px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; }
  .card { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 16px; min-width: 120px; }
  .card .k { font-size: 12px; color: #57606a; }
  .card .v { font-size: 22px; font-weight: 600; }
  .panel { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eaeef2; vertical-align: top; }
  th { font-size: 12px; color: #57606a; text-transform: uppercase; letter-spacing: .03em; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .dim { color: #8c959f; }
  .badge { color: #fff; border-radius: 10px; padding: 1px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  .kept { color: #2ea043; font-size: 11px; font-weight: 600; }
  .chip { display: inline-block; background: #eaeef2; border-radius: 12px; padding: 2px 10px; margin: 2px 0; }
  .axis { font-size: 10px; fill: #8c959f; font-family: ui-monospace, monospace; }
  .empty { color: #8c959f; padding: 24px; text-align: center; }
  ul { margin: 0; padding-left: 18px; }
  footer { margin-top: 32px; color: #8c959f; font-size: 12px; }
  a { color: #0969da; }
</style>
</head>
<body>
<div class="wrap">
  <h1>pi-autoresearch-vkf · ${escapeHtml(data.name)}</h1>
  <p class="goal">${escapeHtml(data.goal)}</p>

  <div class="cards">
    <div class="card"><div class="k">Best ${escapeHtml(data.metricName)} (${escapeHtml(data.direction)})</div><div class="v">${best === undefined ? "—" : escapeHtml(trimNum(best))}</div></div>
    <div class="card"><div class="k">Wins</div><div class="v" style="color:${OUTCOME_COLOR.win}">${wins}</div></div>
    <div class="card"><div class="k">Losses</div><div class="v" style="color:${OUTCOME_COLOR.loss}">${losses}</div></div>
    <div class="card"><div class="k">Inconclusive</div><div class="v" style="color:${OUTCOME_COLOR.inconclusive}">${inconclusive}</div></div>
    <div class="card"><div class="k">Experiments</div><div class="v">${data.experiments.length}</div></div>
  </div>

  <h2>${escapeHtml(data.metricName)} over time</h2>
  <div class="panel">${renderChart(data)}</div>

  <h2>Experiment timeline</h2>
  <div class="panel">
    ${data.experiments.length === 0 ? '<div class="empty">No experiments logged yet.</div>' : `<table>
      <thead><tr><th>id</th><th>outcome</th><th>${escapeHtml(data.metricName)}</th><th>change</th><th>from claim</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`}
  </div>

  <h2>Research memory</h2>
  <div class="panel">
    <div>${memoryChips || '<span class="dim">empty — gather and verify some claims</span>'}</div>
    ${claimRows ? `<h3 style="font-size:13px;margin:14px 0 6px;color:#57606a">Verified claims</h3><ul>${claimRows}</ul>` : ""}
    <p class="dim" style="margin-top:14px">For the full idea-lineage graph (paper → claim → experiment), open <span class="mono">dashboard.html</span> (generated by <span class="mono">vkf html</span>).</p>
  </div>

  <footer>Generated ${escapeHtml(data.generatedAt)}${refresh > 0 ? ` · auto-refreshes every ${refresh}s` : ""}.</footer>
</div>
</body>
</html>`;
}
