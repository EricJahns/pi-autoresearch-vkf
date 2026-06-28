/**
 * Per-session runtime state. Research state itself lives on disk under `.autoresearch-vkf/session/`
 * and `.autoresearch-vkf/memory/`; this store only holds ephemeral UI bookkeeping so we
 * avoid redundant widget updates.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readConfig } from "./config.ts";
import { sessionPaths } from "./paths.ts";

export interface Runtime {
  /** Whether the live widget is currently displayed for this session. */
  widgetShown: boolean;
}

function createRuntimeStore() {
  const store = new Map<string, Runtime>();
  return {
    ensure(key: string): Runtime {
      let rt = store.get(key);
      if (!rt) {
        rt = { widgetShown: false };
        store.set(key, rt);
      }
      return rt;
    },
    drop(key: string): void {
      store.delete(key);
    },
  };
}

export const runtimeStore = createRuntimeStore();

/**
 * Resolve the project root used for `.autoresearch-vkf/session/` and `.autoresearch-vkf/memory/`. Honors
 * `workingDir` from the session config when present, otherwise falls back to cwd.
 */
export function resolveRoot(ctx: ExtensionContext): string {
  const config = readConfig(sessionPaths(ctx.cwd).config);
  return config?.workingDir ?? ctx.cwd;
}

/** Stable per-session key (cwd is sufficient since state is per-project). */
export function sessionKey(ctx: ExtensionContext): string {
  return ctx.cwd;
}
