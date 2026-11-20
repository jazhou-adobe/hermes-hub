#!/usr/bin/env bun
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { DowngradeError, migrate, openDb } from "../db/db.ts";
import { exitCodeFor, HubError } from "../errors.ts";
import { runHub } from "../hub/run.ts";
import { dbPath } from "../paths.ts";
import type { Answer } from "../schema/types.ts";
import { HubClient } from "./client.ts";
import { hubUrl } from "./discovery.ts";

const USAGE = `usage:
  hermes migrate                 create or upgrade the database
  hermes hub                     start the Hub
  hermes ask <file|-> [--no-wait] [--out <file>] [--supersedes <round-id>] [identity]
  hermes wait <round-id> [--out <file>] [identity]
  hermes cancel <round-id> [identity]
  hermes inbox [--format lines|json] [identity]
  hermes watch [identity]
identity: [--label <label>] [--kind <kind>] [--session <id>]`;

class UsageError extends Error {}

const identityOptions = {
  label: { type: "string" },
  kind: { type: "string" },
  session: { type: "string" },
} as const;

async function connect(values: { label?: string; kind?: string; session?: string }): Promise<HubClient> {
  const client = new HubClient(hubUrl());
  await client.openSession(values);
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
    console.error(`hermes migrate: ${err.message}`);
    return 1;
  } finally {
    db.close();
  }
}

async function main(argv: string[]): Promise<number | undefined> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "migrate":
        return runMigrate();
      case "hub":
        return await runHub();
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
      default:
        throw new UsageError(command ? `unknown command ${command}` : "missing command");
    }
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`hermes: ${err.message}\n${USAGE}`);
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
