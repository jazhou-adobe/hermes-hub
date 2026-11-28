import { join, resolve } from "node:path";

/** The clone `hermes-hub` runs from: the Command Center source and the shipped Skill live here, never data. */
export const CLONE_ROOT = resolve(import.meta.dir, "..");
/**
 * The folder holding the CLI wrapper, the only supported way to run Hermes Hub. Callers outside
 * this repo (friendly-grill, scripts) find it through `HERMES_HUB_APP`; Agents and MCP clients get
 * the wrapper's absolute path written into their Skill copy or registration.
 */
export const APP_DIR = join(CLONE_ROOT, "bin");
export const WRAPPER = join(APP_DIR, "hermes-hub");
export const CLI_MAIN = join(CLONE_ROOT, "src", "cli", "main.ts");

/** The folder this process was started in, captured before the development server may chdir. */
const LAUNCH_DIR = process.cwd();

/** The Hub's data folder: `HERMES_HUB_HOME` (relative to the launch folder), or the launch folder itself. */
export function hubHome(): string {
  return resolve(LAUNCH_DIR, process.env.HERMES_HUB_HOME ?? "");
}

export const dbPath = () => join(hubHome(), "hub.db");
export const hubJsonPath = () => join(hubHome(), "hub.json");
export const hubLockPath = () => join(hubHome(), "hub.lock");
export const configPath = () => join(hubHome(), "config.toml");
export const logPath = () => join(hubHome(), "logs", "hub.log");
export const backupsDir = () => join(hubHome(), "backups");
export const projectsPath = () => join(hubHome(), "projects.json");
/** Remote access credentials (security spec), written by `hermes-hub password`. */
export const remoteAuthPath = () => join(hubHome(), "remote-auth.json");
/** The Hub Skill as shipped in this clone (hub-skill spec, Packaging). */
export const SKILL_SOURCE = join(CLONE_ROOT, "skill", "hermes-hub");
