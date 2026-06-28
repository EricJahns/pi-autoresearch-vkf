/**
 * Keyboard shortcut configuration.
 *
 * The fullscreen research dashboard shortcut defaults to ctrl+g ("graph of
 * knowledge") and can be overridden with the PI_AUTORESEARCH_SHORTCUT environment
 * variable, or disabled entirely by setting it to an empty string or "none".
 */
import type { KeyId } from "@earendil-works/pi-tui";

export interface ShortcutConfig {
  /** Open the fullscreen research dashboard. `undefined` disables it. */
  fullscreenDashboard?: KeyId;
  /** Open the live progress HTML in the default browser. `undefined` disables it. */
  openBrowser?: KeyId;
}

const DEFAULT_FULLSCREEN: KeyId = "ctrl+g";
const DEFAULT_OPEN_BROWSER: KeyId = "ctrl+o";

function resolve(envVar: string, fallback: KeyId): KeyId | undefined {
  const override = process.env[envVar]?.trim();
  if (override === undefined) return fallback;
  if (override === "" || override.toLowerCase() === "none") return undefined;
  return override as KeyId;
}

export function loadShortcuts(): ShortcutConfig {
  return {
    fullscreenDashboard: resolve("PI_AUTORESEARCH_SHORTCUT", DEFAULT_FULLSCREEN),
    openBrowser: resolve("PI_AUTORESEARCH_OPEN_SHORTCUT", DEFAULT_OPEN_BROWSER),
  };
}
