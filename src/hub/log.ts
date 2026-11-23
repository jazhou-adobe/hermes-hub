import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { LogLevel } from "../config.ts";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_BYTES = 10 * 1024 * 1024;
const KEEP = 5;

export type LogFields = Record<string, unknown>;

/**
 * JSON lines to a rotating file, human-readable to the terminal (logs spec). Never pass Round
 * content (titles, Questions, values, notes, Attachments) in `fields` — only ids, event names,
 * callsigns, timings and errors.
 */
export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
  setLevel(level: LogLevel): void;
}

class ConsoleLogger implements Logger {
  protected level: LogLevel;

  constructor(level: LogLevel = "info") {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  log(level: LogLevel, event: string, fields: LogFields = {}): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;
    this.print(level, event, fields);
  }

  protected print(level: LogLevel, event: string, fields: LogFields): void {
    const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${event}${extra}`;
    (level === "error" || level === "warn" ? console.error : console.log)(line);
  }
}

class FileLogger extends ConsoleLogger {
  constructor(
    private readonly path: string,
    level: LogLevel = "info",
  ) {
    super(level);
    mkdirSync(dirname(path), { recursive: true });
  }

  override log(level: LogLevel, event: string, fields: LogFields = {}): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;
    this.print(level, event, fields);
    this.rotateIfNeeded();
    const row = { time: new Date().toISOString(), level, event, ...fields };
    appendFileSync(this.path, `${JSON.stringify(row)}\n`);
  }

  private rotateIfNeeded(): void {
    let size: number;
    try {
      size = statSync(this.path).size;
    } catch {
      return; // no file yet
    }
    if (size < MAX_BYTES) return;
    rmSync(`${this.path}.${KEEP}`, { force: true });
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = i === 1 ? this.path : `${this.path}.${i}`;
      const to = `${this.path}.${i + 1}`;
      if (existsSync(from)) renameSync(from, to);
    }
  }
}

/** A console-only logger, quiet by default: for tests and anywhere no file path is wired up. */
export const noopLogger: Logger = new ConsoleLogger("warn");

/** The real Hub logger: JSON lines to `path` (rotated at 10MB, 5 kept), human lines to the terminal. */
export function createLogger(path: string, level: LogLevel = "info"): Logger {
  return new FileLogger(path, level);
}
