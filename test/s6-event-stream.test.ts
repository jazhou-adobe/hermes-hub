import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import type { Server } from "bun";
import { migrate } from "../src/db/db.ts";
import { Engine, type Clock, type SessionRow } from "../src/hub/engine.ts";
import { sse, startServer } from "../src/hub/server.ts";
import { HubClient } from "../src/cli/client.ts";
import type { Answer, Round } from "../src/schema/types.ts";

// ── Engine-level fixtures (mirrors test/engine.test.ts) ────────────────────

class FakeClock implements Clock {
  private ms = Date.parse("2026-11-20T00:00:00.000Z");
  now(): number {
    return this.ms;
  }
  advance(seconds: number): void {
    this.ms += seconds * 1000;
  }
}

function newEngine(): { engine: Engine; clock: FakeClock; db: Database } {
  const db = new Database(":memory:", { strict: true });
  migrate(db);
  const clock = new FakeClock();
  const engine = new Engine(db, "http://127.0.0.1:4747", clock);
  return { engine, clock, db };
}

function session(engine: Engine, label: string): SessionRow {
  const res = engine.upsertSession({ kind: "script", session_key: label, label });
  return engine.sessionFor(res.token);
}

function singleRound(overrides: Partial<Round> = {}): Round {
  return {
    schema: "hermes.round/v1",
    title: "Pick one",
    questions: [{ id: "q1", kind: "single", prompt: "Which?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], recommended: "a" }],
    ...overrides,
  };
}

function submit(engine: Engine, s: SessionRow, round: Round) {
  const res = engine.submit(s, round, Buffer.byteLength(JSON.stringify(round)));
  engine.stop();
  return res;
}

describe("events (Engine)", () => {
  test("a fresh connection (no cursor) does not replay history", () => {
    const { engine } = newEngine();
    const s = session(engine, "ev1");
    const { round_id } = submit(engine, s, singleRound());
    engine.cancel(s, round_id);

    expect(engine.eventsSince(s, null)).toEqual([]);
  });

  test("eventsSince returns only endings after the cursor, oldest first, and does not replay or duplicate", () => {
    const { engine } = newEngine();
    const s = session(engine, "ev2");
    const { round_id: r1 } = submit(engine, s, singleRound({ title: "r1" }));
    engine.cancel(s, r1);
    const cursor = engine.eventCursor(r1);

    const { round_id: r2 } = submit(engine, s, singleRound({ title: "r2" }));
    engine.cancel(s, r2);
    const { round_id: r3 } = submit(engine, s, singleRound({ title: "r3" }));
    engine.cancel(s, r3);

    const events = engine.eventsSince(s, cursor);
    expect(events.map((e) => e.answer.round_id)).toEqual([r2, r3]);
    expect(events[0]!.id).toBeLessThan(events[1]!.id);
    expect(engine.eventsSince(s, cursor)).not.toContainEqual(expect.objectContaining({ answer: expect.objectContaining({ round_id: r1 }) }));

    // Catching up again from the new cursor sees nothing more: no duplicates.
    expect(engine.eventsSince(s, events.at(-1)!.id)).toEqual([]);
  });

  test("delivering an ended Round through events sets delivered_at once; a later get() does not re-set it", () => {
    const { engine, clock, db } = newEngine();
    const s = session(engine, "ev3");
    const { round_id } = submit(engine, s, singleRound());
    engine.send(round_id, { questions: { q1: { value: { selected: "a" } } } }); // ends it, undelivered so far

    const cursor = engine.eventCursor(round_id) - 1;
    const [delivered] = engine.eventsSince(s, cursor);
    expect(delivered!.answer).toMatchObject({ round_id, outcome: "answered" });

    const deliveredAtRow = () => db.query<{ delivered_at: string | null }, [string]>("SELECT delivered_at FROM rounds WHERE id = ?").get(round_id);
    const firstDeliveredAt = deliveredAtRow()!.delivered_at;
    expect(firstDeliveredAt).toBeTruthy();

    clock.advance(60);
    const answer = engine.get(s, round_id) as Answer;
    expect(answer).toMatchObject({ round_id, outcome: "answered" });
    expect(deliveredAtRow()!.delivered_at).toBe(firstDeliveredAt); // not updated to the later time
  });
});

// ── sse() heartbeat, tested directly (no real 15 s wait) ───────────────────

describe("sse() heartbeat", () => {
  test("sends a comment heartbeat on the given interval", async () => {
    const controller = new AbortController();
    const req = new Request("http://127.0.0.1/", { signal: controller.signal });
    const fakeServer = { timeout: () => {} } as unknown as Server<undefined>;
    const res = sse(req, fakeServer, () => () => {}, 5);
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes(": heartbeat\n\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before any heartbeat");
      text += value; // sse()'s ReadableStream enqueues string chunks directly, read back as-is here
    }
    expect(text).toContain(": heartbeat\n\n");
    controller.abort();
  });
});

// ── HTTP-level: GET /v1/events (transports spec) ───────────────────────────

function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
}

const servers: Server<undefined>[] = [];

async function up(): Promise<{ url: string }> {
  const db = new Database(":memory:", { strict: true });
  migrate(db);
  const port = freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(new Engine(db, url), port);
  servers.push(server);
  return { url };
}

async function openSession(url: string): Promise<string> {
  const res = await fetch(`${url}/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "script", session_key: crypto.randomUUID() }),
  });
  const body = await res.json();
  return body.token;
}

const ROUND = {
  schema: "hermes.round/v1",
  title: "T",
  questions: [{ id: "q", kind: "single", prompt: "?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }],
};

async function submitRound(url: string, token: string): Promise<string> {
  const res = await fetch(`${url}/v1/rounds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Hermes-Session": token },
    body: JSON.stringify(ROUND),
  });
  const body = await res.json();
  return body.round_id;
}

async function cancelRound(url: string, token: string, id: string): Promise<void> {
  await fetch(`${url}/v1/rounds/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Hermes-Session": token },
    body: "{}",
  });
}

interface SseLine {
  event?: string;
  data?: string;
  id?: string;
}

function parseSseBlock(block: string): SseLine {
  const line: SseLine = {};
  for (const part of block.split("\n")) {
    if (part.startsWith("event:")) line.event = part.slice(6).trim();
    else if (part.startsWith("data:")) line.data = part.slice(5).trim();
    else if (part.startsWith("id:")) line.id = part.slice(3).trim();
  }
  return line;
}

/**
 * A real `curl` process reading `/v1/events`, writing straight to a file. Bun's own async readers
 * (`fetch()`, or `Bun.spawn(...).stdout` piped back into this same process) can stall indefinitely
 * when draining a streaming (never-closing) response that is written to from a *different* request's
 * handler, in this same `Bun.serve` process — a loopback scheduling quirk unrelated to this route.
 * Writing to a file sidesteps it: nothing here needs the event loop to drain the data.
 */
async function curlEvents(url: string, token: string, lastEventId?: string) {
  const outPath = `/tmp/hermes-events-${crypto.randomUUID()}.txt`;
  await Bun.write(outPath, "");
  const args = ["curl", "-sS", "-N", `${url}/v1/events`, "-H", `Hermes-Session: ${token}`];
  if (lastEventId !== undefined) args.push("-H", `Last-Event-ID: ${lastEventId}`);
  const proc = Bun.spawn(args, { stdout: Bun.file(outPath), stderr: "pipe" });
  let cursor = 0;
  function nextBlock(): SseLine | null {
    const text = readFileSync(outPath, "utf8").slice(cursor);
    const idx = text.indexOf("\n\n");
    if (idx === -1) return null;
    cursor += idx + 2;
    const block = text.slice(0, idx);
    if (block.startsWith(":")) return null; // heartbeat comment
    const parsed = parseSseBlock(block);
    return parsed.event ? parsed : null;
  }
  async function readEvent(): Promise<SseLine> {
    for (;;) {
      const block = nextBlock();
      if (block) return block;
      await Bun.sleep(15); // polling a local file, not the Hub; cheap and bounded by the test's own timeout
    }
  }
  if (lastEventId === undefined) {
    // A fresh connection has no catch-up to prove it is live, and curl's own process/TCP startup is a
    // real race with no deterministic signal available (see the comment above). Nudge with a
    // disposable Round, consuming its own ending here, until one is actually observed.
    for (;;) {
      const nudgeId = await submitRound(url, token);
      await cancelRound(url, token, nudgeId);
      const seen = await Promise.race([readEvent().then(() => true), Bun.sleep(150).then(() => false)]);
      if (seen) break;
    }
  }
  return { readEvent, stop: () => proc.kill() };
}

describe("GET /v1/events (transports spec)", () => {
  test("delivers round.ended live, with an id: cursor line", async () => {
    const { url } = await up();
    const token = await openSession(url);
    const stream = await curlEvents(url, token);

    const roundId = await submitRound(url, token);
    await cancelRound(url, token, roundId);

    const first = await stream.readEvent();
    expect(first.event).toBe("round.ended");
    expect(JSON.parse(first.data!)).toMatchObject({ round_id: roundId, outcome: "cancelled" });
    expect(first.id).toMatch(/^\d+$/);
    stream.stop();
  });

  test("reconnecting with Last-Event-ID catches up only the missed endings, not the full history or duplicates", async () => {
    const { url } = await up();
    const token = await openSession(url);

    // r0 ends before any stream connects; a fresh connection must not replay it.
    const r0 = await submitRound(url, token);
    await cancelRound(url, token, r0);

    const stream1 = await curlEvents(url, token);
    const r1 = await submitRound(url, token);
    await cancelRound(url, token, r1);
    const e1 = await stream1.readEvent();
    expect(JSON.parse(e1.data!).round_id).toBe(r1); // never r0, the pre-existing history
    const cursor1 = e1.id!;
    stream1.stop(); // disconnect before r2 ends

    // r2 ends while nobody is listening: this is what the reconnect must catch up on.
    const r2 = await submitRound(url, token);
    await cancelRound(url, token, r2);

    const stream2 = await curlEvents(url, token, cursor1);
    const e2 = await stream2.readEvent();
    expect(JSON.parse(e2.data!).round_id).toBe(r2); // only the missed one, never r0 or r1 again
    stream2.stop();
    // "No duplicate on a later reconnect from this new cursor" is covered deterministically above,
    // in the Engine-level "eventsSince returns only endings after the cursor" test.
  });

  test("unknown_session is refused before the stream opens", async () => {
    const { url } = await up();
    const res = await fetch(`${url}/v1/events`, { headers: { "Hermes-Session": "hhs_nope" } });
    expect(res.status).toBe(401);
  });
});

// ── CLI: HubClient.watch(), the mechanism behind `hermes watch` ────────────

describe("HubClient.watch()", () => {
  test("streams round.ended Answers live, in order, as the Hub ends them", async () => {
    const { url } = await up();
    const client = new HubClient(url);
    await client.openSession({ kind: "script", session: crypto.randomUUID() });
    const received: Answer[] = [];
    const controller = new AbortController();
    void client.watch((answer) => received.push(answer), controller.signal).catch(() => {});

    // This is a real TCP connection to a real server; `watch()` exposes no signal for "the SSE
    // subscription is now active" short of its `fetch()` resolving, which we cannot observe from
    // here. So: retry a freshly cancelled Round, with a short bounded real backoff between attempts,
    // until watch has caught one, in case the very first one raced ahead of the subscription.
    let roundId = "";
    for (let attempt = 0; attempt < 20 && received.length === 0; attempt++) {
      ({ round_id: roundId } = await client.submit(singleRound()));
      await client.cancel(roundId);
      if (received.length === 0) await Bun.sleep(25);
    }
    controller.abort();

    expect(received.length).toBeGreaterThan(0);
    expect(received.at(-1)).toMatchObject({ round_id: roundId, outcome: "cancelled" });
  });
});
