import { join, resolve } from "node:path";

/** The clone `hermes` runs from (`bun link` points at it). */
export const CLONE_ROOT = resolve(import.meta.dir, "..");

/** `<clone>/.hermes/`, or `HERMES_HOME` when set. */
export function hermesHome(): string {
  const override = process.env.HERMES_HOME;
  return override ? resolve(override) : join(CLONE_ROOT, ".hermes");
}

export const dbPath = () => join(hermesHome(), "hub.db");
export const hubJsonPath = () => join(hermesHome(), "hub.json");
export const hubLockPath = () => join(hermesHome(), "hub.lock");
export const configPath = () => join(hermesHome(), "config.toml");
export const logPath = () => join(hermesHome(), "logs", "hub.log");
export const backupsDir = () => join(hermesHome(), "backups");
