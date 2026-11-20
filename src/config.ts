import { existsSync, readFileSync } from "node:fs";
import { configPath } from "./paths.ts";
import { LIMITS } from "./schema/checks.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export interface HubLimits {
  attachment_bytes: number;
  round_bytes: number;
  pending_per_session: number;
  /** A session is Live while an open `wait` is held, or it was seen within this long (round-lifecycle spec). */
  live_ms: number;
  /** A session is Idle (not Gone) while it was seen within this long. */
  idle_ms: number;
}

export interface BackupSettings {
  /** How many daily automatic backups to keep before the oldest is deleted. */
  keep: number;
}

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

/** Everything in `config.toml` (hub-operations spec). */
export interface HubConfig {
  port: number;
  log_level: LogLevel;
  limits: HubLimits;
  backups: BackupSettings;
  advisors: AdvisorConfig[];
  autoAsk: AutoAskRule[];
}

export type ConfigSource = "file" | "default";

export interface ConfigSources {
  port: ConfigSource;
  log_level: ConfigSource;
  limits: Record<keyof HubLimits, ConfigSource>;
  backups: Record<keyof BackupSettings, ConfigSource>;
  advisors: ConfigSource;
  autoAsk: ConfigSource;
}

export const DEFAULT_PORT = 4747;
const DEFAULT_LOG_LEVEL: LogLevel = "info";
const DEFAULT_LIVE_MS = 2 * 60_000;
const DEFAULT_IDLE_MS = 30 * 60_000;
const DEFAULT_BACKUPS_KEEP = 7;
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

export const DEFAULT_CONFIG: HubConfig = {
  port: DEFAULT_PORT,
  log_level: DEFAULT_LOG_LEVEL,
  limits: {
    attachment_bytes: LIMITS.attachment_bytes,
    round_bytes: LIMITS.round_bytes,
    pending_per_session: LIMITS.pending_per_session,
    live_ms: DEFAULT_LIVE_MS,
    idle_ms: DEFAULT_IDLE_MS,
  },
  backups: { keep: DEFAULT_BACKUPS_KEEP },
  advisors: [],
  autoAsk: [],
};

function defaultSources(): ConfigSources {
  return {
    port: "default",
    log_level: "default",
    limits: { attachment_bytes: "default", round_bytes: "default", pending_per_session: "default", live_ms: "default", idle_ms: "default" },
    backups: { keep: "default" },
    advisors: "default",
    autoAsk: "default",
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPosInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

interface Picked<T> {
  value: T;
  source: ConfigSource;
}

function pick<T>(
  table: Record<string, unknown> | undefined,
  key: string,
  def: T,
  valid: (v: unknown) => v is T,
  path: string,
  label: string,
): Picked<T> {
  if (!table || !(key in table)) return { value: def, source: "default" };
  const v = table[key];
  if (!valid(v)) throw new Error(`${path}: ${label}`);
  return { value: v, source: "file" };
}

export interface LoadedConfig {
  config: HubConfig;
  sources: ConfigSources;
}

/**
 * Parses `config.toml` at `path`, defaulted field by field. A missing file is every default.
 * Throws (with a `path`-prefixed message) on a parse error or an invalid value; a hot-reloading
 * caller should catch this and keep the previous config rather than crash or apply it partially.
 */
export function loadConfigDetailed(path: string): LoadedConfig {
  if (!existsSync(path)) return { config: DEFAULT_CONFIG, sources: defaultSources() };
  let raw: unknown;
  try {
    raw = Bun.TOML.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isRecord(raw)) throw new Error(`${path}: must be a TOML table`);

  const port = pick(
    raw,
    "port",
    DEFAULT_PORT,
    (v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535,
    path,
    "port must be an integer from 1 to 65535",
  );
  const log_level = pick(
    raw,
    "log_level",
    DEFAULT_LOG_LEVEL,
    (v): v is LogLevel => typeof v === "string" && (LOG_LEVELS as readonly string[]).includes(v),
    path,
    `log_level must be one of ${LOG_LEVELS.join(", ")}`,
  );

  if ("limits" in raw && !isRecord(raw.limits)) throw new Error(`${path}: limits must be a table`);
  const limitsTable = isRecord(raw.limits) ? raw.limits : undefined;
  const attachment_bytes = pick(limitsTable, "attachment_bytes", DEFAULT_CONFIG.limits.attachment_bytes, isPosInt, path, "limits.attachment_bytes must be a positive integer");
  const round_bytes = pick(limitsTable, "round_bytes", DEFAULT_CONFIG.limits.round_bytes, isPosInt, path, "limits.round_bytes must be a positive integer");
  const pending_per_session = pick(limitsTable, "pending_per_session", DEFAULT_CONFIG.limits.pending_per_session, isPosInt, path, "limits.pending_per_session must be a positive integer");
  const live_ms = pick(limitsTable, "live_ms", DEFAULT_CONFIG.limits.live_ms, isPosInt, path, "limits.live_ms must be a positive integer");
  const idle_ms = pick(limitsTable, "idle_ms", DEFAULT_CONFIG.limits.idle_ms, isPosInt, path, "limits.idle_ms must be a positive integer");

  if ("backups" in raw && !isRecord(raw.backups)) throw new Error(`${path}: backups must be a table`);
  const backupsTable = isRecord(raw.backups) ? raw.backups : undefined;
  const keep = pick(backupsTable, "keep", DEFAULT_CONFIG.backups.keep, isPosInt, path, "backups.keep must be a positive integer");

  const advisors = parseAdvisors(raw.advisor, path);
  const autoAsk = parseAutoAsk(raw.auto_ask, path, new Set(advisors.map((a) => a.name)));

  return {
    config: {
      port: port.value,
      log_level: log_level.value,
      limits: {
        attachment_bytes: attachment_bytes.value,
        round_bytes: round_bytes.value,
        pending_per_session: pending_per_session.value,
        live_ms: live_ms.value,
        idle_ms: idle_ms.value,
      },
      backups: { keep: keep.value },
      advisors,
      autoAsk,
    },
    sources: {
      port: port.source,
      log_level: log_level.source,
      limits: {
        attachment_bytes: attachment_bytes.source,
        round_bytes: round_bytes.source,
        pending_per_session: pending_per_session.source,
        live_ms: live_ms.source,
        idle_ms: idle_ms.source,
      },
      backups: { keep: keep.source },
      advisors: "advisor" in raw ? "file" : "default",
      autoAsk: "auto_ask" in raw ? "file" : "default",
    },
  };
}

/** Reads `config.toml`, defaulted. `src/hub/configWatcher.ts` reloads it live while the Hub runs. */
export function loadConfig(): HubConfig {
  return loadConfigDetailed(configPath()).config;
}
