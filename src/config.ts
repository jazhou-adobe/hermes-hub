import { existsSync, readFileSync } from "node:fs";
import { configPath } from "./paths.ts";

export interface AdvisorConfig {
  name: string;
  command: string[];
  timeout_seconds: number;
}

/** `config.toml` `[[auto_ask]]` (delegation spec): matches on kind + project, label narrows it. */
export interface AutoAskRule {
  kind: string;
  project: string;
  label?: string;
  advisor: string;
  brief?: string;
}

export interface HubConfig {
  port: number;
  advisors: AdvisorConfig[];
  autoAsk: AutoAskRule[];
}

export const DEFAULT_PORT = 4747;
const DEFAULT_ADVISOR_TIMEOUT_SECONDS = 300;

function parseAdvisors(raw: unknown, path: string): AdvisorConfig[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${path}: [[advisor]] must be an array of tables`);
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object") throw new Error(`${path}: advisor[${i}] must be a table`);
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== "string" || !e.name.trim()) throw new Error(`${path}: advisor[${i}].name must be a non-empty string`);
    if (!Array.isArray(e.command) || e.command.length === 0 || !e.command.every((c) => typeof c === "string")) {
      throw new Error(`${path}: advisor[${i}].command must be a non-empty array of strings`);
    }
    const timeout_seconds = e.timeout_seconds ?? DEFAULT_ADVISOR_TIMEOUT_SECONDS;
    if (typeof timeout_seconds !== "number" || !Number.isInteger(timeout_seconds) || timeout_seconds < 1) {
      throw new Error(`${path}: advisor[${i}].timeout_seconds must be a positive integer`);
    }
    return { name: e.name, command: e.command as string[], timeout_seconds };
  });
}

function parseAutoAsk(raw: unknown, path: string, advisorNames: Set<string>): AutoAskRule[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${path}: [[auto_ask]] must be an array of tables`);
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object") throw new Error(`${path}: auto_ask[${i}] must be a table`);
    const e = entry as Record<string, unknown>;
    if (typeof e.kind !== "string" || !e.kind.trim()) throw new Error(`${path}: auto_ask[${i}].kind must be a non-empty string`);
    if (typeof e.project !== "string" || !e.project.trim()) throw new Error(`${path}: auto_ask[${i}].project must be a non-empty string`);
    if (typeof e.advisor !== "string" || !e.advisor.trim()) throw new Error(`${path}: auto_ask[${i}].advisor must be a non-empty string`);
    if (!advisorNames.has(e.advisor)) throw new Error(`${path}: auto_ask[${i}].advisor "${e.advisor}" is not in [[advisor]]`);
    if (e.label !== undefined && typeof e.label !== "string") throw new Error(`${path}: auto_ask[${i}].label must be a string`);
    if (e.brief !== undefined && typeof e.brief !== "string") throw new Error(`${path}: auto_ask[${i}].brief must be a string`);
    return {
      kind: e.kind,
      project: e.project,
      advisor: e.advisor,
      ...(e.label !== undefined ? { label: e.label as string } : {}),
      ...(e.brief !== undefined ? { brief: e.brief as string } : {}),
    };
  });
}

/** Reads `config.toml`. Hot reload and the other settings arrive with hub operations (S10). */
export function loadConfig(): HubConfig {
  const path = configPath();
  if (!existsSync(path)) return { port: DEFAULT_PORT, advisors: [], autoAsk: [] };
  const raw: unknown = Bun.TOML.parse(readFileSync(path, "utf8"));
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const port = "port" in root ? root.port : DEFAULT_PORT;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${path}: port must be an integer from 1 to 65535`);
  }
  const advisors = parseAdvisors(root.advisor, path);
  const autoAsk = parseAutoAsk(root.auto_ask, path, new Set(advisors.map((a) => a.name)));
  return { port, advisors, autoAsk };
}
