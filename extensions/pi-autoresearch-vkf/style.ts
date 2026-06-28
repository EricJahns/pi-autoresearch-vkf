/**
 * Tiny ANSI styling helpers for the live widget and fullscreen overlay.
 *
 * We deliberately use the 16 *named* ANSI colors (green/red/yellow/…) rather
 * than fixed hex: terminals map them onto the user's own palette, so the widget
 * stays legible and on-theme in both light and dark schemes without us plumbing
 * pi's Theme through the `string[]` widget API. pi renders these lines through
 * ANSI-aware width helpers, so the escape codes don't disturb column alignment.
 *
 * Honors `NO_COLOR` (https://no-color.org): set it to any value to get plain text.
 */

const ENABLED = !process.env.NO_COLOR;

const SGR = {
  reset: 0,
  bold: 1,
  dim: 2,
  italic: 3,
  red: 31,
  green: 32,
  yellow: 33,
  cyan: 36,
  gray: 90,
} as const;

function wrap(code: number, text: string): string {
  if (!ENABLED || text === "") return text;
  return `\x1b[${code}m${text}\x1b[${SGR.reset}m`;
}

export const style = {
  bold: (t: string): string => wrap(SGR.bold, t),
  dim: (t: string): string => wrap(SGR.dim, t),
  italic: (t: string): string => wrap(SGR.italic, t),
  /** Brand / headings / focal numbers. */
  accent: (t: string): string => wrap(SGR.cyan, t),
  /** Wins, kept changes, improvements. */
  success: (t: string): string => wrap(SGR.green, t),
  /** Losses, discards, regressions. */
  error: (t: string): string => wrap(SGR.red, t),
  /** Candidates, inconclusive, warnings. */
  warn: (t: string): string => wrap(SGR.yellow, t),
  /** Secondary text — labels, separators, older rows. */
  muted: (t: string): string => wrap(SGR.gray, t),
};

/** The outcome → color map shared by the status and metric columns. */
export function outcomeStyle(outcome: string): (t: string) => string {
  switch (outcome) {
    case "win":
      return style.success;
    case "loss":
      return style.error;
    case "inconclusive":
      return style.warn;
    default:
      return style.muted;
  }
}
