import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Server } from "bun";
import { migrate } from "../src/db/db.ts";
import { Engine, type SessionRow } from "../src/hub/engine.ts";
import { startServer } from "../src/hub/server.ts";
import { validateAnswer, validateRound } from "../src/schema/validate.ts";
import type { Round } from "../src/schema/types.ts";

function newEngine(): Engine {
  const db = new Database(":memory:", { strict: true });
  migrate(db);
  return new Engine(db, "http://127.0.0.1:4747");
}

function session(engine: Engine, label: string, cwd?: string): SessionRow {
  const res = engine.upsertSession({ kind: "script", session_key: label, label, cwd });
  return engine.sessionFor(res.token);
}

/** Submits, then cancels Engine's real scheduling timer so the test drives time itself. */
function submit(engine: Engine, s: SessionRow, round: Round) {
  const res = engine.submit(s, round, Buffer.byteLength(JSON.stringify(round)));
  engine.stop();
  return res;
}

const ROUND_WITH_ATTACHMENT: Round = {
  schema: "hermes.round/v1",
  title: "Deploy the frobnicator",
  context: "about to ship a widget",
  questions: [
    {
      id: "q1",
      kind: "text",
      prompt: "Any concerns about the rollback plan?",
      detail: "think about kittens before merging",
      attachments: [{ kind: "markdown", title: "diff", content: "the secret word is wizardquokka" }],
    },
  ],
};

describe("answered log: free-text search", () => {
  test("a word from the prompt, detail or note matches; a word only in an Attachment does not", () => {
    const engine = newEngine();
    const s = session(engine, "a1");
    const { round_id } = submit(engine, s, ROUND_WITH_ATTACHMENT);
    engine.send(round_id, { questions: { q1: { value: { text: "none, ship it" } } }, note: "ship on friday afternoon" });

    expect(engine.log({ q: "rollback" }).map((e) => e.meta.round_id)).toEqual([round_id]);
    expect(engine.log({ q: "kittens" }).map((e) => e.meta.round_id)).toEqual([round_id]);
    expect(engine.log({ q: "friday" }).map((e) => e.meta.round_id)).toEqual([round_id]);
    expect(engine.log({ q: "wizardquokka" })).toEqual([]);
  });

  test("the matched snippet is returned with <mark> highlights", () => {
    const engine = newEngine();
    const s = session(engine, "a1");
    const { round_id } = submit(engine, s, ROUND_WITH_ATTACHMENT);
    engine.dismiss(round_id, {});

    const [entry] = engine.log({ q: "rollback" });
    expect(entry?.snippet).toContain("<mark>rollback</mark>");
  });
});

describe("answered log: export round-trips against the schema", () => {
  test("every exported round and answer validates", () => {
    const engine = newEngine();
    const s = session(engine, "a1");

    const sent = submit(engine, s, ROUND_WITH_ATTACHMENT);
    engine.send(sent.round_id, { questions: { q1: { value: { text: "looks fine" } } } });

    const dismissed = submit(engine, s, { ...ROUND_WITH_ATTACHMENT, title: "Unrelated" });
    engine.dismiss(dismissed.round_id, { note: "not needed" });

    const redirected = submit(engine, s, { ...ROUND_WITH_ATTACHMENT, title: "Redirect me" });
    engine.redirect(redirected.round_id, { message: "ask the on-call instead" });

    const exported = engine.exportLog({});
    expect(exported.length).toBe(3);
    for (const { round, answer } of exported) {
      expect(validateRound(round)).toEqual([]);
      expect(validateAnswer(answer)).toEqual([]);
    }
  });
});

describe("answered log: filters combine (AND)", () => {
  test("outcome and callsign narrow together", () => {
    const engine = newEngine();
    const a = session(engine, "alpha");
    const b = session(engine, "bravo");

    const r1 = submit(engine, a, { ...ROUND_WITH_ATTACHMENT, title: "alpha dismissed" });
    engine.dismiss(r1.round_id, {});
    const r2 = submit(engine, b, { ...ROUND_WITH_ATTACHMENT, title: "bravo dismissed" });
    engine.dismiss(r2.round_id, {});
    const r3 = submit(engine, a, { ...ROUND_WITH_ATTACHMENT, title: "alpha answered" });
    engine.send(r3.round_id, { questions: { q1: { value: { text: "ok" } } } });

    const alphaCallsign = engine.log({ session_id: a.id })[0]!.meta.callsign;
    expect(engine.log({ outcome: "dismissed" }).length).toBe(2);
    expect(engine.log({ callsign: alphaCallsign }).length).toBe(2);
    const narrowed = engine.log({ outcome: "dismissed", callsign: alphaCallsign });
    expect(narrowed.map((e) => e.round.title)).toEqual(["alpha dismissed"]);
  });

  test("project (git root, else cwd) narrows alongside outcome", () => {
    const engine = newEngine();
    const s = session(engine, "a1", "/Users/jazhou/proj-a");
    const { round_id } = submit(engine, s, { ...ROUND_WITH_ATTACHMENT, title: "in proj-a" });
    engine.dismiss(round_id, {});

    expect(engine.log({ project: "/Users/jazhou/proj-a" }).length).toBe(1);
    expect(engine.log({ project: "/Users/jazhou/proj-a", outcome: "answered" }).length).toBe(0);
    expect(engine.log({ project: "/elsewhere" }).length).toBe(0);
  });
});

describe("answered log: a Draft that was never sent", () => {
  test("shows as Not sent with its content retrievable", () => {
    const engine = newEngine();
    const s = session(engine, "a1");
    const { round_id } = submit(engine, s, ROUND_WITH_ATTACHMENT);
    engine.saveDraft(round_id, { questions: { q1: { value: { text: "half-written thought" } } } });
    engine.dismiss(round_id, {});

    const [entry] = engine.log({});
    expect(entry?.draft?.questions?.q1?.value).toEqual({ text: "half-written thought" });
  });

  test("Send clears the Draft, so a sent Round shows none", () => {
    const engine = newEngine();
    const s = session(engine, "a1");
    const { round_id } = submit(engine, s, ROUND_WITH_ATTACHMENT);
    engine.saveDraft(round_id, { questions: { q1: { value: { text: "draft text" } } } });
    engine.send(round_id, { questions: { q1: { value: { text: "final text" } } } });

    const [entry] = engine.log({});
    expect(entry?.draft).toBeNull();
  });
});

describe("answered log: database size", () => {
  test("dbSizeBytes is 0 for an in-memory database and never throws", () => {
    const engine = newEngine();
    expect(engine.dbSizeBytes()).toBe(0);
  });
});

function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
}

const servers: Server<undefined>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

async function up(): Promise<{ url: string; engine: Engine }> {
  const db = new Database(":memory:", { strict: true });
  migrate(db);
  const port = freePort();
  const url = `http://127.0.0.1:${port}`;
  const engine = new Engine(db, url);
  const server = await startServer(engine, port);
  servers.push(server);
  return { url, engine };
}

async function openSession(url: string): Promise<string> {
  const res = await fetch(`${url}/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "script", session_key: "a1", label: "a1" }),
  });
  const body = await res.json();
  return body.token;
}

describe("GET /cc/log and /cc/log/export over HTTP", () => {
  test("/cc/log applies query filters and reports the database size", async () => {
    const { url, engine } = await up();
    const token = await openSession(url);
    const submitRes = await fetch(`${url}/v1/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Hermes-Session": token },
      body: JSON.stringify(ROUND_WITH_ATTACHMENT),
    });
    const { round_id } = await submitRes.json();
    engine.dismiss(round_id, { note: "closing it" });

    const res = await fetch(`${url}/cc/log?outcome=dismissed&q=rollback`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.map((e: { meta: { round_id: string } }) => e.meta.round_id)).toEqual([round_id]);
    expect(typeof body.db_size_bytes).toBe("number");

    const miss = await fetch(`${url}/cc/log?outcome=answered`);
    expect((await miss.json()).entries).toEqual([]);
  });

  test("/cc/log/export downloads the filtered array with a Content-Disposition header", async () => {
    const { url, engine } = await up();
    const token = await openSession(url);
    const submitRes = await fetch(`${url}/v1/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Hermes-Session": token },
      body: JSON.stringify(ROUND_WITH_ATTACHMENT),
    });
    const { round_id } = await submitRes.json();
    engine.send(round_id, { questions: { q1: { value: { text: "fine" } } } });

    const res = await fetch(`${url}/cc/log/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="hermes-log-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].meta.round_id).toBe(round_id);
    expect(validateRound(body[0].round)).toEqual([]);
    expect(validateAnswer(body[0].answer)).toEqual([]);
  });
});
