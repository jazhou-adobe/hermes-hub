import { readFileSync } from "node:fs";
import { DEFAULT_PORT } from "../config.ts";
import { hubJsonPath } from "../paths.ts";

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
}

/** HERMES_HUB_URL → `<clone>/.hermes/hub.json` (if its pid runs) → the default port. */
export function hubUrl(): string {
  const explicit = process.env.HERMES_HUB_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  try {
    const info: unknown = JSON.parse(readFileSync(hubJsonPath(), "utf8"));
    if (
      info &&
      typeof info === "object" &&
      "url" in info &&
      typeof info.url === "string" &&
      "pid" in info &&
      typeof info.pid === "number" &&
      pidAlive(info.pid)
    ) {
      return info.url;
    }
  } catch {
    // no hub.json, or unreadable (sandbox): fall through to the default
  }
  return `http://127.0.0.1:${DEFAULT_PORT}`;
}
