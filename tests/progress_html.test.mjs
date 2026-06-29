import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeHtml, renderDashboardHtml } from "../extensions/pi-autoresearch-vkf/progress_html.ts";

const base = {
  name: "Speed up tests",
  goal: "Reduce wall clock",
  metricName: "wall_clock_s",
  direction: "lower",
  baseline: 10,
  best: 8,
  metricNames: ["wall_clock_s"],
  experiments: [],
  memory: { candidate: 2, locally_tested: 1, contradicted: 1 },
  claims: [{ id: "claim:adagc", title: "AdaGC helps", confidence: "high", belief: 0.8, state: "locally_tested" }],
  coverage: { levers: ["algorithm"], altitudes: ["mechanism"], counts: { "algorithm|mechanism": 1 } },
  generatedAt: "2026-06-27T00:00:00Z",
  refreshSeconds: 5,
  version: "0.9.0",
};

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), "&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;");
});

test("renderDashboardHtml is a self-contained interactive document", () => {
  const html = renderDashboardHtml(base);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/); // inline CSS, no external assets
  assert.match(html, /<script>/); // the inline vanilla-JS app
  assert.match(html, /Speed up tests/);
  // Live refresh is via a data.json sidecar fetch, not a whole-page meta refresh.
  assert.ok(!/http-equiv="refresh"/.test(html));
  assert.match(html, /data\.json/);
});

test("embeds the payload as inline JSON, safely", () => {
  const html = renderDashboardHtml({
    ...base,
    experiments: [
      { id: "exp-001", description: "try a", value: 9, outcome: "win", kept: true, depth: 0, metrics: { wall_clock_s: 9 }, ts: "" },
    ],
  });
  assert.match(html, /id="vkf-data"/);
  assert.match(html, /exp-001/);
  // `<` inside embedded JSON must be neutralized so it can't break out of <script>.
  assert.ok(!html.includes("</script>x"));
});

test("escapes a malicious experiment description in the embedded JSON", () => {
  const html = renderDashboardHtml({
    ...base,
    experiments: [
      { id: "exp-001", description: "</script><img src=x>", value: 9, outcome: "win", depth: 0, metrics: {}, ts: "" },
    ],
  });
  // Neutralizing `<` is enough to stop a `</script>` breakout; `>` need not be escaped.
  assert.ok(!html.includes("</script><img"));
  assert.match(html, /\\u003c\/script>/);
});

test("references the search tree and coverage containers", () => {
  const html = renderDashboardHtml(base);
  assert.match(html, /id="tree"/);
  assert.match(html, /id="heatmap"/);
  assert.match(html, /id="chart"/);
});
