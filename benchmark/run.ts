/**
 * Benchmark entry point: run every scenario for both policies and print the
 * report. Optionally write it into the project README between the
 * <!-- BENCH:START --> / <!-- BENCH:END --> markers.
 *
 *   node --experimental-strip-types benchmark/run.ts [--seeds N] [--update-readme]
 *   # on a Node without TS stripping:
 *   node --import tsx benchmark/run.ts --seeds 500
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { renderReport, runScenario } from "./harness.ts";
import { SCENARIOS } from "./scenarios.ts";

function parseArgs(argv: string[]): { seeds: number; updateReadme: boolean } {
  let seeds = 500;
  let updateReadme = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--seeds") seeds = Number(argv[++i]);
    else if (argv[i] === "--update-readme") updateReadme = true;
  }
  return { seeds, updateReadme };
}

function main(): void {
  const { seeds, updateReadme } = parseArgs(process.argv.slice(2));
  const reports = SCENARIOS.map((s) => runScenario(s, seeds));
  const report = renderReport(reports, seeds);
  console.log(report);

  if (updateReadme) {
    const here = dirname(fileURLToPath(import.meta.url));
    const readmePath = join(here, "..", "README.md");
    const md = readFileSync(readmePath, "utf8");
    const start = "<!-- BENCH:START -->";
    const end = "<!-- BENCH:END -->";
    const si = md.indexOf(start);
    const ei = md.indexOf(end);
    if (si !== -1 && ei !== -1) {
      const block = `${start}\n\n${stripTitle(report)}\n${end}`;
      writeFileSync(readmePath, md.slice(0, si) + block + md.slice(ei + end.length), "utf8");
      console.error(`\nUpdated README benchmark section (${seeds} seeds).`);
    } else {
      console.error(`\nNo ${start}/${end} markers in README — skipped update.`);
    }
  }
}

/** Drop the top-level "# Benchmark…" heading so it nests under the README section. */
function stripTitle(report: string): string {
  return report.replace(/^# .*\n+/, "");
}

main();
