import assert from "node:assert/strict";
import { test } from "node:test";

import {
  escapeHtml,
  renderChart,
  renderProgressHtml,
} from "../extensions/pi-autoresearch-vkf/progress_html.ts";

const base = {
  name: "Speed up tests",
  goal: "Reduce wall clock",
  metricName: "wall_clock_s",
  direction: "lower",
  baseline: 10,
  memory: { candidate: 2, locally_tested: 1, contradicted: 1 },
  claims: [{ title: "AdaGC helps", confidence: "high", state: "locally_tested" }],
  generatedAt: "2026-06-27T00:00:00Z",
};

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), "&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;");
});

test("renderProgressHtml is a self-contained document", () => {
  const html = renderProgressHtml({ ...base, experiments: [] });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/); // inline CSS, no external assets
  assert.ok(!/<script/i.test(html)); // no JS dependency
  assert.match(html, /Speed up tests/);
  assert.match(html, /No experiments logged yet/);
});

test("renders a chart once there are measured experiments", () => {
  const html = renderProgressHtml({
    ...base,
    experiments: [
      { id: "exp-001", description: "try a", value: 9, outcome: "win", kept: true, ts: "" },
      { id: "exp-002", description: "try b", value: 11, outcome: "loss", ts: "" },
    ],
  });
  assert.match(html, /<svg/);
  assert.match(html, /exp-001/);
  assert.match(html, /baseline 10/);
});

test("chart handles a single point without dividing by zero", () => {
  const svg = renderChart({ ...base, experiments: [{ id: "exp-001", description: "x", value: 5, outcome: "win", ts: "" }] });
  assert.match(svg, /<circle/);
  assert.ok(!svg.includes("NaN"));
});

test("chart handles a flat series (all equal values)", () => {
  const svg = renderChart({
    ...base,
    baseline: undefined,
    experiments: [
      { id: "a", description: "", value: 5, outcome: "win", ts: "" },
      { id: "b", description: "", value: 5, outcome: "win", ts: "" },
    ],
  });
  assert.ok(!svg.includes("NaN"));
});

test("refresh meta is present by default and omitted when 0", () => {
  assert.match(renderProgressHtml({ ...base, experiments: [] }), /http-equiv="refresh"/);
  assert.ok(!/http-equiv="refresh"/.test(renderProgressHtml({ ...base, experiments: [], refreshSeconds: 0 })));
});

test("experiment descriptions are escaped in the timeline", () => {
  const html = renderProgressHtml({
    ...base,
    experiments: [{ id: "exp-001", description: "<script>x</script>", value: 9, outcome: "win", ts: "" }],
  });
  assert.ok(!html.includes("<script>x</script>"));
  assert.match(html, /&lt;script&gt;/);
});
