import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pidAlive, runningHub } from "../src/hub/lock.ts";
import { WRAPPER } from "../src/paths.ts";

const MAIN = join(import.meta.dir, "../src/cli/main.ts");
const AGENT_ENV = /^(HERMES_|PI_|OMPCODE$|CODEX_|CLAUDE|CURSOR_|COPILOT_|AI_AGENT$|AGENT$)/;

function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
}

interface Sandbox {
  home: string;
  url: string;
  env: Record<string, string>;
}

/** A fresh HERMES_HUB_HOME with a config.toml port, and an env free of the caller's own agent signals. */
function sandbox(): Sandbox {
  const home = mkdtempSync(join(tmpdir(), "hermes-ops-test-"));
  const port = freePort();
  writeFileSync(join(home, "config.toml"), `port = ${port}\n`);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !AGENT_ENV.test(k)) env[k] = v;
  env.HERMES_HUB_HOME = home;
  return { home, url: `http://127.0.0.1:${port}`, env };
}

/** Reads a child's stdout until `pattern` matches everything read so far. */
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, pattern: RegExp, text = ""): Promise<string> {
  const decoder = new TextDecoder();
  while (!pattern.test(text)) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`stdout ended before ${pattern}: ${text}`);
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function run(env: Record<string, string>, ...args: string[]) {
  const proc = Bun.spawn(["bun", MAIN, ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

/** Starts `hermes-hub hub` in the background; returns the child so the test can stop it cleanly. */
async function startHub(box: Sandbox) {
  const hub = Bun.spawn(["bun", MAIN, "hub"], { env: box.env, stdout: "pipe", stderr: "inherit" });
  cleanups.push(() => hub.kill());
  await readUntil(hub.stdout.getReader(), / on http:\/\/127\.0\.0\.1:\d+/);
  return hub;
}

/** SIGTERM and wait for exit, so the Hub's own handler releases `hub.lock` and `hub.json`. */
async function stopHubCleanly(hub: Bun.Subprocess): Promise<void> {
  hub.kill("SIGTERM");
  await hub.exited;
}

interface RoundDoc {
  schema: string;
  title: string;
  questions: [{ id: "colour"; kind: "single"; prompt: string; options: [{ id: "red"; label: string }, { id: "blue"; label: string }] }];
}

function round(title: string, prompt: string, redLabel: string, blueLabel: string): RoundDoc {
  return {
    schema: "hermes.round/v1",
    title,
    questions: [
      {
        id: "colour",
        kind: "single",
        prompt,
        options: [
          { id: "red", label: redLabel },
          { id: "blue", label: blueLabel },
        ],
      },
    ],
  };
}

/** Asks one Round through the CLI, sends an Answer through the Command Center, waits for the CLI to exit. */
async function askAndAnswer(box: Sandbox, roundFile: string, doc: RoundDoc, selected: "red" | "blue", note?: string): Promise<string> {
  writeFileSync(roundFile, JSON.stringify(doc));
  const ask = Bun.spawn(["bun", MAIN, "ask", roundFile], { env: box.env, stdout: "pipe", stderr: "inherit" });
  const printed = await readUntil(ask.stdout.getReader(), /^ROUND .+\n/m);
  const roundId = /^ROUND (r_\w+) /m.exec(printed)?.[1];
  if (!roundId) throw new Error(`no ROUND line in: ${printed}`);
  const body: Record<string, unknown> = { questions: { colour: { value: { selected } } } };
  if (note) body.note = note;
  const send = await fetch(`${box.url}/cc/rounds/${roundId}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (send.status !== 200) throw new Error(`send failed: ${send.status} ${await send.text()}`);
  await ask.exited;
  return roundId;
}

function roundIds(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .query<{ id: string }, []>("SELECT id FROM rounds ORDER BY id")
      .all()
      .map((r) => r.id);
  } finally {
    db.close();
  }
}

describe("hub operations: hub.lock refuses a second Hub", () => {
  test("a second `hermes-hub hub` on the same data folder exits 1 and prints the first Hub's url and pid", async () => {
    const box = sandbox();
    cleanups.push(() => rmSync(box.home, { recursive: true, force: true }));
    await run(box.env, "migrate");
    const hub = await startHub(box);

    const second = await run(box.env, "hub");
    expect(second.code).toBe(1);
    expect(second.stderr).toContain(box.url);
    expect(second.stderr).toContain(String(hub.pid));
  });
});

describe("hub operations: logs never carry Round content", () => {
  test("hub.log has event names, ids and callsigns, but never prompts, option labels, notes or values", async () => {
    const box = sandbox();
    cleanups.push(() => rmSync(box.home, { recursive: true, force: true }));
    await run(box.env, "migrate");
    await startHub(box);

    const SECRET_TITLE = "ZZZSECRETTITLEZZZ";
    const SECRET_PROMPT = "ZZZSECRETPROMPTZZZ";
    const SECRET_RED = "ZZZSECRETOPTIONREDZZZ";
    const SECRET_BLUE = "ZZZSECRETOPTIONBLUEZZZ";
    const SECRET_NOTE = "ZZZSECRETNOTEZZZ";
    const roundId = await askAndAnswer(
      box,
      join(box.home, "round.json"),
      round(SECRET_TITLE, SECRET_PROMPT, SECRET_RED, SECRET_BLUE),
      "red",
      SECRET_NOTE,
    );

    const log = readFileSync(join(box.home, "logs", "hub.log"), "utf8");
    expect(log).toContain(roundId);
    expect(log).toContain("round.created");
    expect(log).toContain("round.ended");
    for (const secret of [SECRET_TITLE, SECRET_PROMPT, SECRET_RED, SECRET_BLUE, SECRET_NOTE]) {
      expect(log).not.toContain(secret);
    }
  });
});

describe("hub operations: backup and restore", () => {
  test("hermes-hub backup, more Rounds, hermes-hub restore: the post-restore Rounds match the pre-addition set", async () => {
    const box = sandbox();
    cleanups.push(() => rmSync(box.home, { recursive: true, force: true }));
    await run(box.env, "migrate");
    const hub = await startHub(box);
    const dbPath = join(box.home, "hub.db");
    const roundFile = join(box.home, "round.json");

    await askAndAnswer(box, roundFile, round("A", "pick one", "Red", "Blue"), "red");
    const before = roundIds(dbPath);
    expect(before.length).toBe(1);

    const backupPath = join(box.home, "my-backup.db");
    const backup = await run(box.env, "backup", backupPath);
    expect(backup.code).toBe(0);
    expect(existsSync(backupPath)).toBe(true);

    await askAndAnswer(box, roundFile, round("B", "pick one", "Red", "Blue"), "blue");
    await askAndAnswer(box, roundFile, round("C", "pick one", "Red", "Blue"), "blue");
    expect(roundIds(dbPath).length).toBe(3);

    // restore refuses while the Hub is running
    const refused = await run(box.env, "restore", backupPath);
    expect(refused.code).toBe(1);
    expect(roundIds(dbPath).length).toBe(3); // untouched

    await stopHubCleanly(hub);
    const restore = await run(box.env, "restore", backupPath);
    expect(restore.code).toBe(0);

    expect(roundIds(dbPath)).toEqual(before);
    const asideFiles = readdirSync(box.home).filter((f) => f.startsWith("hub.db.before-restore-"));
    expect(asideFiles.length).toBe(1);
  });

  test("hermes backup without a path defaults under backups/ in the Hub's folder", async () => {
    const box = sandbox();
    cleanups.push(() => rmSync(box.home, { recursive: true, force: true }));
    await run(box.env, "migrate");
    const backup = await run(box.env, "backup");
    expect(backup.code).toBe(0);
    const files = readdirSync(join(box.home, "backups"));
    expect(files.some((f) => f.startsWith("hub-manual-"))).toBe(true);
  });
});

describe("hub operations: the data folder", () => {
  test("without HERMES_HUB_HOME, migrate and hub keep every file directly in the folder they run in", async () => {
    const box = sandbox();
    cleanups.push(() => rmSync(box.home, { recursive: true, force: true }));
    const { HERMES_HUB_HOME: _unset, ...env } = box.env;
    const inHome = { cwd: box.home, env, stdout: "pipe", stderr: "inherit" } as const;
    expect(await Bun.spawn(["bun", MAIN, "migrate"], inHome).exited).toBe(0);
    const hub = Bun.spawn(["bun", MAIN, "hub"], inHome);
    cleanups.push(() => hub.kill());
    await readUntil(hub.stdout.getReader(), new RegExp(` on ${box.url}`));
    for (const file of ["hub.db", "hub.json", "hub.lock", "config.toml"]) {
      expect({ file, exists: existsSync(join(box.home, file)) }).toEqual({ file, exists: true });
    }
    expect(existsSync(join(box.home, ".hermes"))).toBe(false);
    await stopHubCleanly(hub);
  });

  test("bin/hermes-hub start runs the Hub detached in the current folder; stop ends it; both refuse the wrong state", async () => {
    const box = sandbox();
    const { HERMES_HUB_HOME: _unset, ...env } = box.env;
    const wrapper = async (cmd: string) => {
      const proc = Bun.spawn([WRAPPER, cmd], { cwd: box.home, env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      return { stdout, stderr, code };
    };
    cleanups.push(() => {
      const holder = runningHub(join(box.home, "hub.lock"));
      if (holder) process.kill(holder.pid, "SIGKILL");
      rmSync(box.home, { recursive: true, force: true });
    });

    const early = await wrapper("start");
    expect(early.code).toBe(1);
    expect(early.stderr).toContain("run hermes-hub migrate");

    expect((await wrapper("migrate")).code).toBe(0);
    const started = await wrapper("start");
    expect(started.code).toBe(0);
    const pid = Number(/\(pid (\d+)\)/.exec(started.stdout)?.[1]);
    expect(started.stdout).toContain(`Hermes Hub on ${box.url} (pid ${pid})`);
    expect(JSON.parse(readFileSync(join(box.home, "hub.json"), "utf8")).pid).toBe(pid);
    expect((await fetch(`${box.url}/v1/hub`)).status).toBe(200);
    expect((await wrapper("start")).stderr).toContain(`already running at ${box.url} (pid ${pid})`);

    const stopped = await wrapper("stop");
    expect(stopped.code).toBe(0);
    expect(stopped.stdout).toContain(`stopped Hermes Hub at ${box.url} (pid ${pid})`);
    expect(pidAlive(pid)).toBe(false);
    expect(existsSync(join(box.home, "hub.lock"))).toBe(false);
    expect((await wrapper("stop")).code).toBe(1);
  });
});
