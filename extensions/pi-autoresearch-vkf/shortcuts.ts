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
}

const DEFAULT_FULLSCREEN: KeyId = "ctrl+g";

export function loadShortcuts(): ShortcutConfig {
  const override = process.env.PI_AUTORESEARCH_SHORTCUT?.trim();
  if (override === undefined) return { fullscreenDashboard: DEFAULT_FULLSCREEN };
  if (override === "" || override.toLowerCase() === "none") return {};
  return { fullscreenDashboard: override as KeyId };
}
