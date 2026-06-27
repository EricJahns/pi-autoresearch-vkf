/**
 * Parse `METRIC name=number` lines from experiment command output.
 *
 * The measure command (or `.auto/measure.sh`) signals results by printing lines
 * of the form `METRIC <name>=<number>` (the pi-autoresearch convention). This
 * pure helper extracts them so a tool can read a metric without the agent having
 * to eyeball stdout.
 */

const METRIC_RE = /^\s*METRIC\s+([A-Za-z0-9_.-]+)\s*=\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*$/;

/** Extract all `METRIC name=value` pairs from text, last-wins on duplicates. */
export function parseMetrics(output: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of output.split("\n")) {
    const m = line.match(METRIC_RE);
    if (m) out[m[1]!] = Number(m[2]);
  }
  return out;
}

/** Pick a specific metric by name from command output, if present. */
export function readMetric(output: string, name: string): number | undefined {
  return parseMetrics(output)[name];
}
