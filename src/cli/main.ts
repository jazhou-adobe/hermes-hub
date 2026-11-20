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
  hermes ask <file|-> [--no-wait] [--out <file>] [--label <l>] [--kind <k>] [--session <id>]
  hermes wait <round-id> [--out <file>] [--label <l>] [--kind <k>] [--session <id>]`;

class UsageError extends Error {}

const identityOptions = {
  label: { type: "string" },
  kind: { type: "string" },
  session: { type: "string" },
  out: { type: "string" },
} as const;

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

async function finish(client: HubClient, roundId: string, out: string | undefined): Promise<number> {
  const answer: Answer = await client.waitForAnswer(roundId);
  const line = JSON.stringify(answer);
  if (out) await Bun.write(out, `${line}\n`);
  console.log(`ANSWER ${line}`);
  return 0;
}

async function ask(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { ...identityOptions, wait: { type: "boolean" }, "no-wait": { type: "boolean" } }, 1);
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
  const client = new HubClient(hubUrl());
  await client.openSession(values);
  const { round_id, url } = await client.submit(round);
  console.log(`ROUND ${round_id} ${url}`);
  return values["no-wait"] ? 0 : finish(client, round_id, values.out);
}

async function wait(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, identityOptions, 1);
  const client = new HubClient(hubUrl());
  await client.openSession(values);
  return finish(client, positionals[0]!, values.out);
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
        return runHub();
      case "ask":
        return await ask(rest);
      case "wait":
        return await wait(rest);
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
