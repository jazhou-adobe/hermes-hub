import { existsSync, readFileSync } from "node:fs";
import { configPath } from "./paths.ts";

export interface HubConfig {
  port: number;
}

export const DEFAULT_PORT = 4747;

/** Reads `config.toml`. Hot reload and the other settings arrive with hub operations (S10). */
export function loadConfig(): HubConfig {
  const path = configPath();
  if (!existsSync(path)) return { port: DEFAULT_PORT };
  const raw: unknown = Bun.TOML.parse(readFileSync(path, "utf8"));
  const port = raw && typeof raw === "object" && "port" in raw ? raw.port : DEFAULT_PORT;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${path}: port must be an integer from 1 to 65535`);
  }
  return { port };
}
