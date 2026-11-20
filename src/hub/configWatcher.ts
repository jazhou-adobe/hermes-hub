import { watch } from "node:fs";
import { basename, dirname } from "node:path";
import { loadConfigDetailed, type HubConfig } from "../config.ts";

export interface ConfigReload {
  config: HubConfig;
  restartNeeded: boolean;
}

/**
 * Re-reads `config.toml`. The port can't change live: the result keeps serving on `previous.port`
 * and sets `restartNeeded`, while every other field reloads from the file. Throws on a parse error
 * or an invalid value — callers keep `previous` rather than apply partial garbage.
 */
export function reloadConfig(path: string, previous: HubConfig): ConfigReload {
  const { config } = loadConfigDetailed(path);
  if (config.port !== previous.port) return { config: { ...config, port: previous.port }, restartNeeded: true };
  return { config, restartNeeded: false };
}

/**
 * Watches `config.toml`'s directory (robust to editors that replace the file by rename) and calls
 * `onChange` after every successful reload, or `onError` — without touching the current config —
 * when the file fails to parse or validate. Returns a stop function.
 */
export function watchConfig(
  path: string,
  getCurrent: () => HubConfig,
  onChange: (reload: ConfigReload) => void,
  onError: (err: Error) => void,
): () => void {
  const name = basename(path);
  let settle: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(dirname(path), { persistent: false }, (_event, filename) => {
    if (filename !== null && filename !== name) return;
    clearTimeout(settle);
    // Editors often do a write+rename for one save; settle briefly before reloading.
    settle = setTimeout(() => {
      try {
        onChange(reloadConfig(path, getCurrent()));
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }, 50);
  });
  watcher.on("error", () => {}); // e.g. HERMES_HOME removed from under us; nothing useful to do
  return () => {
    clearTimeout(settle);
    watcher.close();
  };
}
