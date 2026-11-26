import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAnswer } from "../src/schema/validate.ts";

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
  const home = mkdtempSync(join(tmpdir(), "hermes-test-"));
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
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

async function startHub(box: Sandbox): Promise<void> {
  const hub = Bun.spawn(["bun", MAIN, "hub"], { env: box.env, stdout: "pipe", stderr: "inherit" });
  cleanups.push(() => hub.kill());
  await readUntil(hub.stdout.getReader(), / on http:\/\/127\.0\.0\.1:\d+/);
}

const ROUND = {
  schema: "hermes.round/v1",
  title: "Pick a colour",
  questions: [
    {
      id: "colour",
      kind: "single",
      prompt: "Which colour?",
      options: [
        { id: "red", label: "Red" },
        { id: "blue", label: "Blue" },
      ],
      recommended: "blue",
    },
  ],
};

describe("walking skeleton", () => {
  test("hub refuses to start until hermes-hub migrate has run", async () => {
    const box = sandbox();
    cleanups.push(() => rmSync(box.home, { recursive: true, force: true }));
    const hub = await run(box.env, "hub");
    expect(hub.code).toBe(1);
    expect(hub.stderr).toContain("run hermes-hub migrate");
  });

  test("a script asks one single-choice Round, the Human answers, the script prints ANSWER and exits 0", async () => {
    const box = sandbox();
    cleanups.push(() => rmSync(box.home, { recursive: true, force: true }));
    expect((await run(box.env, "migrate")).code).toBe(0);
    await startHub(box);

    const hubJson = JSON.parse(readFileSync(join(box.home, "hub.json"), "utf8"));
    expect(hubJson.url).toBe(box.url);

    const roundFile = join(box.home, "round.json");
    const outFile = join(box.home, "a.json");
    writeFileSync(roundFile, JSON.stringify(ROUND));
    // No HERMES_HUB_URL: the CLI must discover the Hub through hub.json.
    const ask = Bun.spawn(["bun", MAIN, "ask", roundFile, "--out", outFile], {
      env: box.env,
      stdout: "pipe",
      stderr: "inherit",
    });
    cleanups.push(() => ask.kill());
    const stdout = ask.stdout.getReader();
    let printed = await readUntil(stdout, /^ROUND .+\n/m);
    const [, roundId, roundUrl] = /^ROUND (r_\w+) (\S+)$/m.exec(printed) ?? [];
    expect(roundUrl).toBe(`${box.url}/rounds/${roundId}`);

    // The Command Center sees the Round, then the Human sends.
    const pending = await (await fetch(`${box.url}/cc/rounds`)).json();
    expect(pending.rounds.map((r: { id: string }) => r.id)).toEqual([roundId]);
    expect(pending.rounds[0].session.callsign).toStartWith("SCRIPT·");
    const send = await fetch(`${box.url}/cc/rounds/${roundId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: { colour: { value: { selected: "red" } } } }),
    });
    expect(send.status).toBe(200);

    printed = await readUntil(stdout, /^ANSWER .+\n/m, printed);
    expect(await ask.exited).toBe(0);
    const answerLine = /^ANSWER (.+)$/m.exec(printed)?.[1];
    const answer = JSON.parse(answerLine!);
    expect(validateAnswer(answer)).toEqual([]);
    expect(answer).toMatchObject({
      round_id: roundId,
      outcome: "answered",
      questions: { colour: { value: { selected: "red" }, set_by: "human" } },
    });
    expect(JSON.parse(readFileSync(outFile, "utf8"))).toEqual(answer);
  });

  test("an invalid Round (e.g. a single Question with only one option) is rejected with exit 4", async () => {
    const box = sandbox();
    cleanups.push(() => rmSync(box.home, { recursive: true, force: true }));
    await run(box.env, "migrate");
    await startHub(box);
    const roundFile = join(box.home, "round.json");
    writeFileSync(
      roundFile,
      JSON.stringify({ ...ROUND, questions: [{ id: "q", kind: "single", prompt: "?", options: [{ id: "a", label: "A" }] }] }),
    );
    const ask = await run(box.env, "ask", roundFile);
    expect(ask.code).toBe(4);
    expect(ask.stdout).toStartWith("ERROR invalid_round ");
  });
});
