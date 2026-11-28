#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { loadConfigDetailed } from "../config.ts";
import { DowngradeError, migrate, openDb } from "../db/db.ts";
import { exitCodeFor, HubError } from "../errors.ts";
import { backupNow, manualBackupPath, restoreBackup } from "../hub/backup.ts";
import { runHub } from "../hub/run.ts";
import { runningHub } from "../hub/lock.ts";
import { backupsDir, configPath, dbPath, hubLockPath, remoteAuthPath } from "../paths.ts";
import type { Answer } from "../schema/types.ts";
import { serveShim } from "../mcp/shim.ts";
import { VERSION } from "../version.ts";
import { HubClient } from "./client.ts";
import { hubUrl } from "./discovery.ts";
import { runDoctor } from "./doctor.ts";
import { detectSession } from "./identity.ts";
import { restartHub, startHub, stopHub } from "./service.ts";
import { runPassword } from "./password.ts";
import { readRemoteAuth } from "../hub/auth.ts";
import { setupClaude } from "./setup.ts";
import { fileProjects, findRepos, gitRoot, installSkill, staleSkillWarning, updateAllSkills, updateSkill, type ProjectStore } from "./skill.ts";

const USAGE = `usage: bin/hermes-hub <command>   (run it by path; nothing is installed globally)
  hermes-hub migrate                 create or upgrade the database
  hermes-hub start                   start the Hub in the background (output in logs/hub.out)
  hermes-hub stop                    stop the Hub running on this data folder
  hermes-hub restart                 stop the Hub on this data folder if it runs, then start it again
  hermes-hub hub                     run the Hub in the foreground (Ctrl-C stops it)
  hermes-hub config                  print the effective settings and their source
  hermes-hub password [--user <name>] [--remove]   set (or remove) the Basic auth password other devices sign in with
  hermes-hub backup [path]           take a backup now (default: backups/hub-manual-<timestamp>.db in the Hub's folder)
  hermes-hub restore <backup>        restore the database from a backup (the Hub must not be running)
  hermes-hub ask <file|-> [--no-wait] [--out <file>] [--supersedes <round-id>] [identity]
  hermes-hub wait <round-id> [--out <file>] [identity]
  hermes-hub cancel <round-id> [identity]
  hermes-hub inbox [--format lines|json] [identity]
  hermes-hub watch [identity]
  hermes-hub mcp [identity]          the stdio MCP shim (hermes_ask, hermes_wait, hermes_cancel, hermes_inbox)
  hermes-hub skill install [dir] [--commit]           copy the Hub Skill into <git root>/.agents/skills/hermes-hub
  hermes-hub skill install --all <folder> [--commit]  the same for every git repository under <folder>
  hermes-hub skill update [--all]    refresh this project's copy, or every recorded copy
  hermes-hub doctor                  check the Hub, the Skill and each client; print the sandbox settings
  hermes-hub setup claude            register the hermes-hub MCP shim in Claude Code (asks first)
identity: [--label <label>] [--kind <kind>] [--session <id>]

The Hub's files (hub.db, config.toml, logs/, backups/, …) live in $HERMES_HUB_HOME, or the folder
where you run migrate, start, stop, hub, config, password, backup or restore. Agent commands find the Hub through
HERMES_HUB_URL, then $HERMES_HUB_HOME/hub.json, then http://127.0.0.1:4747.`;

/** `projects.json`: the file when HERMES_HUB_HOME names the Hub's folder, otherwise the running Hub keeps it. */
function projectStore(): ProjectStore {
  return process.env.HERMES_HUB_HOME ? fileProjects() : new HubClient(hubUrl()).projects();
}

const NO_HUB_FOR_PROJECTS =
  "hermes-hub skill: the running Hub records projects in its own folder; start it with `hermes-hub start`, or set HERMES_HUB_HOME to the Hub's folder";

class UsageError extends Error {}

const identityOptions = {
  label: { type: "string" },
  kind: { type: "string" },
  session: { type: "string" },
} as const;

/** Opens the session and runs the version checks: one stderr line each, never failing the command. */
async function connect(values: { label?: string; kind?: string; session?: string }): Promise<HubClient> {
  const client = new HubClient(hubUrl());
  const session = detectSession(values);
  // The session's git context needs a HEAD; a repository without commits still has a root.
  const skill = staleSkillWarning(session.git?.root ?? gitRoot(process.cwd()));
  if (skill) console.error(skill);
  const hubCheck = client.hubVersion().then(
    (hub) => {
      if (hub !== VERSION) console.error(`WARN hermes-hub ${VERSION} != Hub ${hub} · restart the Hub (hermes-hub restart)`);
    },
    () => {}, // an unreachable Hub is reported by the session call itself
  );
  await Promise.all([client.openSession(session), hubCheck]);
  return client;
}

function parse<O extends ParseArgsOptionsConfig>(args: string[], options: O, positionals: number) {
  let parsed;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  if (parsed.positionals.length !== positionals) throw new UsageError(`expected ${positionals} argument(s)`);
  return parsed;
}

function printAnswer(answer: Answer): string {
  const line = JSON.stringify(answer);
  console.log(`ANSWER ${line}`);
  return line;
}

async function finish(client: HubClient, roundId: string, out: string | undefined): Promise<number> {
  const line = printAnswer(await client.waitForAnswer(roundId));
  if (out) await Bun.write(out, `${line}\n`);
  return 0;
}

async function ask(args: string[]): Promise<number> {
  const { values, positionals } = parse(
    args,
    {
      ...identityOptions,
      out: { type: "string" },
      supersedes: { type: "string" },
      wait: { type: "boolean" },
      "no-wait": { type: "boolean" },
    },
    1,
  );
  const source = positionals[0]!;
  let text: string;
  try {
    text = source === "-" ? await Bun.stdin.text() : await Bun.file(source).text();
  } catch {
    throw new UsageError(`cannot read ${source}`);
  }
  let round: unknown;
  try {
    round = JSON.parse(text);
  } catch {
    throw new HubError("invalid_round", `${source} is not JSON`);
  }
  const client = await connect(values);
  const { round_id, url } = await client.submit(round, values.supersedes);
  console.log(`ROUND ${round_id} ${url}`);
  return values["no-wait"] ? 0 : finish(client, round_id, values.out);
}

async function wait(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { ...identityOptions, out: { type: "string" } }, 1);
  return finish(await connect(values), positionals[0]!, values.out);
}

async function cancel(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, identityOptions, 1);
  printAnswer(await (await connect(values)).cancel(positionals[0]!));
  return 0;
}

async function inbox(args: string[]): Promise<number> {
  const { values } = parse(args, { ...identityOptions, format: { type: "string", default: "lines" } }, 0);
  if (values.format !== "lines" && values.format !== "json") throw new UsageError("--format must be lines or json");
  const answers = await (await connect(values)).inbox();
  if (values.format === "json") console.log(JSON.stringify({ answers }));
  else for (const answer of answers) printAnswer(answer);
  return 0;
}

async function watch(args: string[]): Promise<number> {
  const { values } = parse(args, identityOptions, 0);
  await (await connect(values)).watch((answer) => printAnswer(answer));
  return 0;
}

/** The stdio MCP shim: serves until the client closes stdin. Identity is re-detected on every call. */
function mcp(args: string[]): undefined {
  const { values } = parse(args, identityOptions, 0);
  serveShim(hubUrl(), values);
  return undefined;
}

function runMigrate(): number {
  const db = openDb(dbPath());
  try {
    const applied = migrate(db);
    console.log(
      applied.length
        ? applied.map((m) => `applied ${String(m.version).padStart(3, "0")}_${m.name}`).join("\n")
        : "database is up to date",
    );
    return 0;
  } catch (err) {
    if (!(err instanceof DowngradeError)) throw err;
    console.error(`hermes-hub migrate: ${err.message}`);
    return 1;
  } finally {
    db.close();
  }
}

/** Whether other devices can sign in (security spec); never prints the hash. */
function remotePasswordLine(): string {
  try {
    const creds = readRemoteAuth(remoteAuthPath());
    return creds ? `set for user "${creds.username}" (${remoteAuthPath()})` : "not set: other devices are refused (hermes-hub password)";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function runConfig(): number {
  let loaded;
  try {
    loaded = loadConfigDetailed(configPath());
  } catch (err) {
    console.error(`hermes-hub config: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const { config, sources } = loaded;
  console.log(
    [
      `port = ${config.port} (${sources.port})`,
      `host = ${config.host} (${sources.host})`,
      `log_level = ${config.log_level} (${sources.log_level})`,
      `limits.attachment_bytes = ${config.limits.attachment_bytes} (${sources.limits.attachment_bytes})`,
      `limits.round_bytes = ${config.limits.round_bytes} (${sources.limits.round_bytes})`,
      `limits.pending_per_session = ${config.limits.pending_per_session} (${sources.limits.pending_per_session})`,
      `limits.live_ms = ${config.limits.live_ms} (${sources.limits.live_ms})`,
      `limits.idle_ms = ${config.limits.idle_ms} (${sources.limits.idle_ms})`,
      `backups.keep = ${config.backups.keep} (${sources.backups.keep})`,
      `advisor = [${config.advisors.map((a) => a.name).join(", ")}] (${sources.advisors})`,
      `auto_ask = ${config.autoAsk.length} rule(s) (${sources.autoAsk})`,
      `remote password = ${remotePasswordLine()}`,
    ].join("\n"),
  );
  return 0;
}

function runBackup(args: string[]): number {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true, strict: true });
  if (positionals.length > 1) throw new UsageError("hermes-hub backup takes at most one path argument");
  const dest = positionals[0] ?? manualBackupPath(backupsDir());
  const db = openDb(dbPath());
  try {
    backupNow(db, dest);
  } finally {
    db.close();
  }
  console.log(`backed up to ${dest}`);
  return 0;
}

function runRestore(args: string[]): number {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true, strict: true });
  if (positionals.length !== 1) throw new UsageError("hermes-hub restore needs exactly one argument: the backup path");
  const backup = positionals[0]!;
  if (!existsSync(backup)) throw new UsageError(`no such backup: ${backup}`);
  const holder = runningHub(hubLockPath());
  if (holder) {
    console.error(`hermes-hub restore: a Hub is running at ${holder.url} (pid ${holder.pid}); stop it first with hermes-hub stop`);
    return 1;
  }
  const aside = restoreBackup(openDb, dbPath(), backup);
  console.log(`current database saved to ${aside}`);
  console.log(`restored from ${backup}`);
  return 0;
}

/** `hermes-hub skill install|update` (hub-skill spec, "Distribution: project copies"). */
async function runSkill(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: { all: { type: "boolean" }, commit: { type: "boolean" } }, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const { values, positionals } = parsed;
  if (sub === "install") {
    if (positionals.length > 1) throw new UsageError("hermes-hub skill install takes at most one folder");
    if (values.all && positionals.length !== 1) throw new UsageError("hermes-hub skill install --all needs the folder to search");
    const dirs = values.all ? findRepos(positionals[0]!) : [positionals[0] ?? process.cwd()];
    const store = projectStore();
    if (dirs.length === 0) {
      console.error(`hermes-hub skill install: no git repository under ${positionals[0]}`);
      return 1;
    }
    let code = 0;
    for (const dir of dirs) {
      const root = gitRoot(dir);
      try {
        if (!root) throw new Error(`${dir} is not in a git repository`);
        console.log(await installSkill(store, root, values.commit === true));
      } catch (err) {
        console.error(`hermes-hub skill install: ${err instanceof Error ? err.message : String(err)}`);
        code = 1;
        if (err instanceof HubError && err.code === "hub_unavailable") {
          console.error(NO_HUB_FOR_PROJECTS);
          break; // every other folder would fail the same way
        }
      }
    }
    return code;
  }
  if (sub === "update") {
    if (positionals.length > 0 || values.commit) throw new UsageError("hermes-hub skill update takes only --all");
    try {
      if (values.all) {
        const lines = await updateAllSkills(projectStore());
        console.log(lines.length ? lines.join("\n") : "no recorded hermes-hub skill copies; run hermes-hub skill install");
        return 0;
      }
      const root = gitRoot(process.cwd());
      if (!root) throw new Error(`${process.cwd()} is not in a git repository`);
      console.log(await updateSkill(projectStore(), root));
      return 0;
    } catch (err) {
      console.error(`hermes-hub skill update: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof HubError && err.code === "hub_unavailable") console.error(NO_HUB_FOR_PROJECTS);
      return 1;
    }
  }
  throw new UsageError(sub ? `unknown skill command ${sub}` : "hermes-hub skill needs install or update");
}

function runSetup(args: string[]): number {
  const { positionals } = parse(args, {}, 1);
  if (positionals[0] !== "claude") throw new UsageError("hermes-hub setup supports only claude");
  return setupClaude();
}

async function main(argv: string[]): Promise<number | undefined> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "migrate":
        return runMigrate();
      case "hub":
        return await runHub();
      case "start":
        parse(rest, {}, 0);
        return await startHub();
      case "stop":
        parse(rest, {}, 0);
        return await stopHub();
      case "restart":
        parse(rest, {}, 0);
        return await restartHub();
      case "config":
        return runConfig();
      case "password": {
        const { values } = parse(rest, { user: { type: "string" }, remove: { type: "boolean" } }, 0);
        return await runPassword(values);
      }
      case "backup":
        return runBackup(rest);
      case "restore":
        return runRestore(rest);
      case "ask":
        return await ask(rest);
      case "wait":
        return await wait(rest);
      case "cancel":
        return await cancel(rest);
      case "inbox":
        return await inbox(rest);
      case "watch":
        return await watch(rest);
      case "mcp":
        return mcp(rest);
      case "skill":
        return await runSkill(rest);
      case "doctor":
        parse(rest, {}, 0);
        return await runDoctor(hubUrl(), projectStore());
      case "setup":
        return runSetup(rest);
      default:
        throw new UsageError(command ? `unknown command ${command}` : "missing command");
    }
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`hermes-hub: ${err.message}\n${USAGE}`);
      return 2;
    }
    if (err instanceof HubError) {
      const details = Object.keys(err.extra).length ? ` ${JSON.stringify(err.extra)}` : "";
      console.log(`ERROR ${err.code} ${err.message}${details}`);
      return exitCodeFor(err.code);
    }
    throw err;
  }
}

const code = await main(Bun.argv.slice(2));
if (code !== undefined) process.exit(code);
