import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Server } from "bun";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport, type Transport } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { HubClient, isRecord } from "../src/cli/client.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { migrate } from "../src/db/db.ts";
import { HubError } from "../src/errors.ts";
import { Engine, type Clock } from "../src/hub/engine.ts";
import { startServer } from "../src/hub/server.ts";
import { shimFactory } from "../src/mcp/shim.ts";
import { PROGRESS_EVERY_MS, TASKS_EXTENSION, WAIT_BOUND_MS, type Timers } from "../src/mcp/tools.ts";
import type { Answer, Round } from "../src/schema/types.ts";

const MAIN = join(import.meta.dir, "../src/cli/main.ts");
const AGENT_ENV = /^(HERMES_|PI_|OMPCODE$|CODEX_|CLAUDE|CURSOR_|COPILOT_|AI_AGENT$|AGENT$)/;
/** Codex's and Cursor's default MCP tool timeout; the bounded wait must return before it. */
const CLIENT_TOOL_TIMEOUT_MS = 60_000;

/**
 * The engine's clock and the MCP doors' timers in one: nothing fires until the test advances it, so
 * the 50 s bound is exercised without sleeping.
 */
class FakeClock implements Clock, Timers {
  private ms = Date.parse("2026-11-20T00:00:00.000Z");
  private readonly timers: { at: number; ms: number; fn: () => void; live: boolean }[] = [];
  private readonly armedWaiters: { ms: number; resolve: () => void }[] = [];

  now(): number {
    return this.ms;
  }

  after(ms: number, fn: () => void): () => void {
    const timer = { at: this.ms + ms, ms, fn, live: true };
    this.timers.push(timer);
    for (const w of this.armedWaiters.filter((w) => w.ms === ms)) {
      this.armedWaiters.splice(this.armedWaiters.indexOf(w), 1);
      w.resolve();
    }
    return () => {
      timer.live = false;
    };
  }

  /** Resolves once a live timer of `ms` exists: a door has started a bounded wait. */
  armed(ms: number): Promise<void> {
    if (this.timers.some((t) => t.live && t.ms === ms)) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.armedWaiters.push({ ms, resolve });
    return promise;
  }

  /** Moves time on and fires every due timer, in order. */
  advance(ms: number): void {
    this.ms += ms;
    for (;;) {
      const due = this.timers.filter((t) => t.live && t.at <= this.ms).sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      due.live = false;
      due.fn();
    }
  }
}

function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
}

const servers: Server<undefined>[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => {});
  for (const server of servers.splice(0)) server.stop(true);
});

interface Hub {
  url: string;
  engine: Engine;
  clock: FakeClock;
}

async function up(pendingPerSession = DEFAULT_CONFIG.limits.pending_per_session): Promise<Hub> {
  const db = new Database(":memory:", { strict: true });
  migrate(db);
  const clock = new FakeClock();
  const port = freePort();
  const url = `http://127.0.0.1:${port}`;
  const config = { ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits, pending_per_session: pendingPerSession } };
  const engine = new Engine(db, url, clock, config);
  servers.push(await startServer(engine, port, undefined, undefined, clock));
  return { url, engine, clock };
}

const ROUND: Round = {
  schema: "hermes.round/v1",
  title: "Pick one",
  questions: [{ id: "q", kind: "single", prompt: "Which?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], recommended: "a" }],
};
const SEND = { questions: { q: { value: { selected: "a" } } } };

/** The next Round the engine accepts. */
function nextRound(engine: Engine): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  const off = engine.subscribe((e) => {
    if (e.type !== "round.created") return;
    off();
    resolve(e.view.id);
  });
  return promise;
}

/** Every door's result, normalized so one scenario reads the same through all of them. */
type Result =
  | { answer: Answer }
  | { pending: { round_id: string; next_deadline: string | null } }
  | { answers: Answer[] }
  | { error: { code: string } & Record<string, unknown> };

interface Door {
  ask(round: unknown): Promise<Result>;
  wait(id: string): Promise<Result>;
  cancel(id: string): Promise<Result>;
  inbox(): Promise<Result>;
  /** Closes the wait window that the latest ask or wait opened, as 50 s passing would. */
  expire(): Promise<void>;
}

/** HTTP, the reference: submit, then a long-poll that `expire` ends the way a closing window does. */
async function httpDoor({ url }: Hub): Promise<Door> {
  const client = new HubClient(url);
  await client.openSession({ kind: "script", session_key: crypto.randomUUID() });
  /** The open long-poll, if any; `expire` aborts it. */
  let window = Promise.withResolvers<AbortController>();
  const caught = async (fn: () => Promise<Result>): Promise<Result> => {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof HubError)) throw err;
      return { error: { code: err.code, ...err.extra } };
    }
  };
  const wait = async (id: string): Promise<Result> => {
    const controller = new AbortController();
    window.resolve(controller);
    let state;
    try {
      state = await client.round(id, 55, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) throw err;
      state = await client.round(id);
    } finally {
      window = Promise.withResolvers();
    }
    return "status" in state ? { pending: { round_id: id, next_deadline: state.next_deadline } } : { answer: state };
  };
  return {
    ask: (round) => caught(async () => wait((await client.submit(round)).round_id)),
    wait: (id) => caught(() => wait(id)),
    cancel: (id) => caught(async () => ({ answer: await client.cancel(id) })),
    inbox: () => caught(async () => ({ answers: await client.inbox() })),
    async expire() {
      (await window.promise).abort();
    },
  };
}

/** Reads a CallToolResult's structuredContent, the machine-readable half every tool result carries. */
function fromTool(res: Record<string, unknown>): Result {
  const s = res.structuredContent as Record<string, unknown>; // every Hermes tool result sets it
  if (res.isError) return { error: { ...s, code: String(s.code) } };
  if (s.status === "pending") return { pending: { round_id: String(s.round_id), next_deadline: typeof s.next_deadline === "string" ? s.next_deadline : null } };
  if (Array.isArray(s.answers)) return { answers: s.answers };
  return { answer: s as unknown as Answer };
}

function pendingId(result: Result): string {
  if (!("pending" in result)) throw new Error(`expected pending, got ${JSON.stringify(result)}`);
  return result.pending.round_id;
}

type Era = "legacy" | "modern";
const negotiation = (era: Era) => ({ mode: era === "legacy" ? ("legacy" as const) : { pin: "2026-07-28" } });

function mcpDoor(client: Client, clock: FakeClock): Door {
  const call = async (name: string, args: Record<string, unknown>) => fromTool(await client.callTool({ name, arguments: args }));
  return {
    ask: (round) => call("hermes_ask", { round }),
    wait: (id) => call("hermes_wait", { round_id: id }),
    cancel: (id) => call("hermes_cancel", { round_id: id }),
    inbox: () => call("hermes_inbox", {}),
    async expire() {
      await clock.armed(WAIT_BOUND_MS);
      clock.advance(WAIT_BOUND_MS);
    },
  };
}

/** A client of the shim's own code, in process (the factory `hermes-hub mcp` serves), over a linked pair. */
function shimTransport({ url, clock }: Hub): Transport {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(shimFactory(url, { kind: "script", session: crypto.randomUUID() }, clock), { transport: serverSide });
  closers.push(() => handle.close());
  return clientSide;
}

async function shimClient(hub: Hub, era: Era): Promise<Client> {
  const client = new Client({ name: "conformance", version: "1.0.0" }, { versionNegotiation: negotiation(era) });
  await client.connect(shimTransport(hub));
  closers.push(() => client.close());
  return client;
}

/** A client of the Hub's `/mcp`. */
async function hubClient({ url }: Hub, era: Era, name = "conformance"): Promise<Client> {
  const client = new Client({ name, version: "1.0.0" }, { versionNegotiation: negotiation(era) });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  closers.push(() => client.close());
  return client;
}

const DOORS: [string, (hub: Hub) => Promise<Door>][] = [
  ["HTTP /v1", httpDoor],
  ["stdio shim, 2025 handshake", async (hub) => mcpDoor(await shimClient(hub, "legacy"), hub.clock)],
  ["stdio shim, 2026-07-28", async (hub) => mcpDoor(await shimClient(hub, "modern"), hub.clock)],
  ["/mcp, legacy-stateless", async (hub) => mcpDoor(await hubClient(hub, "legacy"), hub.clock)],
  ["/mcp, 2026-07-28", async (hub) => mcpDoor(await hubClient(hub, "modern"), hub.clock)],
];

describe.each(DOORS)("conformance through %s", (_name, open) => {
  test("ask → the Human answers → the Answer", async () => {
    const hub = await up();
    const door = await open(hub);
    const created = nextRound(hub.engine);
    const asked = door.ask(ROUND);
    hub.engine.send(await created, SEND);
    expect(await asked).toMatchObject({ answer: { outcome: "answered", questions: { q: { value: { selected: "a" }, set_by: "human" } } } });
    expect(await door.inbox()).toEqual({ answers: [] }); // already delivered
  });

  test("ask → pending once the window closes → wait → the Answer", async () => {
    const hub = await up();
    const door = await open(hub);
    const asked = door.ask(ROUND);
    await door.expire();
    const pending = await asked;
    const id = pendingId(pending);
    expect(pending).toEqual({ pending: { round_id: id, next_deadline: null } });
    expect(id).toMatch(/^r_/);

    const waited = door.wait(id);
    hub.engine.send(id, SEND);
    expect(await waited).toMatchObject({ answer: { round_id: id, outcome: "answered" } });
  });

  test("cancel, then cancelling again is round_ended with the Outcome", async () => {
    const hub = await up();
    const door = await open(hub);
    const asked = door.ask(ROUND);
    await door.expire();
    const id = pendingId(await asked);
    expect(await door.cancel(id)).toMatchObject({ answer: { round_id: id, outcome: "cancelled", cancelled_by: "agent" } });
    expect(await door.cancel(id)).toEqual({ error: expect.objectContaining({ code: "round_ended", round_id: id, outcome: "cancelled" }) });
  });

  test("inbox returns an undelivered Answer once", async () => {
    const hub = await up();
    const door = await open(hub);
    const asked = door.ask(ROUND);
    await door.expire();
    const id = pendingId(await asked);
    hub.engine.dismiss(id, { note: "not now" });
    expect(await door.inbox()).toMatchObject({ answers: [{ round_id: id, outcome: "dismissed", note: "not now" }] });
    expect(await door.inbox()).toEqual({ answers: [] });
  });

  test("error codes: invalid_round, not_found, flood_cap", async () => {
    const hub = await up(1);
    const door = await open(hub);
    expect(await door.ask({ schema: "hermes.round/v1", title: "", questions: [] })).toEqual({
      error: expect.objectContaining({ code: "invalid_round", errors: expect.any(Array) }),
    });
    expect(await door.wait("r_nope")).toEqual({ error: expect.objectContaining({ code: "not_found" }) });

    const asked = door.ask(ROUND);
    await door.expire();
    const id = pendingId(await asked);
    expect(await door.ask(ROUND)).toEqual({ error: expect.objectContaining({ code: "flood_cap", limit: 1, oldest_round_id: id }) });
  });
});

describe("the bounded wait (clients without Tasks)", () => {
  test.each([
    ["stdio shim", shimClient],
    ["/mcp", hubClient],
  ] as const)("%s: progress every 10 s, then pending at 50 s, before a 60 s tool timeout", async (_name, connect) => {
    expect(WAIT_BOUND_MS).toBeLessThan(CLIENT_TOOL_TIMEOUT_MS);
    const hub = await up();
    const client = await connect(hub, "legacy");
    const progress: number[] = [];
    const asked = client.callTool(
      { name: "hermes_ask", arguments: { round: ROUND } },
      { onprogress: (p: { progress: number }) => progress.push(p.progress) } as never,
    );
    const startedAt = hub.clock.now();
    await hub.clock.armed(WAIT_BOUND_MS);
    // Each tick arms the next one synchronously, so stepping the clock is enough.
    for (let t = 0; t < WAIT_BOUND_MS; t += PROGRESS_EVERY_MS) hub.clock.advance(PROGRESS_EVERY_MS);
    const res = (await asked) as Record<string, unknown>;
    expect(hub.clock.now() - startedAt).toBe(WAIT_BOUND_MS);
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ status: "pending", round_id: expect.stringMatching(/^r_/), next_deadline: null });
    expect((res.content as { text: string }[])[0]!.text).toContain("Call hermes_wait");
    // Notifications are delivered asynchronously; the four ticks all precede the result on the wire.
    expect(progress).toEqual([10, 20, 30, 40]);
  });
});

/** One JSON-RPC exchange; the SDK client refuses `resultType: "task"`, so the Tasks tests speak the wire. */
type Rpc = (method: string, params: Record<string, unknown>) => Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string; data?: unknown } }>;

/**
 * `tasks` and `modern` speak 2026-07-28 (a per-request envelope, with or without the Tasks
 * extension); `legacy` speaks Codex 0.133's wire: 2025-06-18, no envelope, `initialize` first.
 */
type Wire = "tasks" | "modern" | "legacy";
const LEGACY_VERSION = "2025-06-18";

/** The 2026-07-28 per-request envelope, as Claude Code ≥ 2.1.304 sends it when Tasks are on. */
function withMeta(params: Record<string, unknown>, wire: Wire): Record<string, unknown> {
  if (wire === "legacy") return params;
  const _meta = {
    ...(isRecord(params._meta) ? params._meta : {}),
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "claude-code", version: "2.1.304" },
    "io.modelcontextprotocol/clientCapabilities": wire === "tasks" ? { extensions: { [TASKS_EXTENSION]: {} } } : {},
  };
  return { ...params, _meta };
}

/** JSON-RPC over a connected SDK transport (stdio process or in-memory pair). */
async function transportRpc(transport: Transport, wire: Wire): Promise<Rpc> {
  const replies = new Map<number, (msg: never) => void>();
  transport.onmessage = (msg) => {
    if ("id" in msg && typeof msg.id === "number" && !("method" in msg)) replies.get(msg.id)?.(msg as never);
  };
  await transport.start();
  closers.push(() => transport.close());
  let next = 0;
  return (method, params) => {
    const id = ++next;
    const { promise, resolve } = Promise.withResolvers<never>();
    replies.set(id, resolve);
    void transport.send({ jsonrpc: "2.0", id, method, params: withMeta(params, wire) });
    return promise;
  };
}

/** JSON-RPC over Streamable HTTP, with the headers each revision requires. */
function httpRpc(url: string, wire: Wire): Rpc {
  let next = 0;
  return async (method, params) => {
    const name = method === "tools/call" ? params.name : params.taskId;
    const headers: Record<string, string> =
      wire === "legacy"
        ? method === "initialize" ? {} : { "MCP-Protocol-Version": LEGACY_VERSION }
        : { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method, "Mcp-Name": String(name) };
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++next, method, params: withMeta(params, wire) }),
    });
    const body = await res.text();
    if (!res.headers.get("content-type")?.startsWith("text/event-stream")) return JSON.parse(body);
    return JSON.parse(body.split("\n").filter((l) => l.startsWith("data:")).pop()!.slice(5)); // the response is the last event
  };
}

const RPCS: [string, (hub: Hub, wire: Wire) => Promise<Rpc>][] = [
  ["stdio shim", (hub, wire) => transportRpc(shimTransport(hub), wire)],
  ["/mcp", async (hub, wire) => httpRpc(hub.url, wire)],
];

const ask = (rpc: Rpc) => rpc("tools/call", { name: "hermes_ask", arguments: { round: ROUND } });

describe.each(RPCS)("Tasks through %s (a client that declares the extension)", (_name, connect) => {
  test("hermes_ask returns a task; tasks/get is working, then completed with the Answer, which counts as delivered", async () => {
    const hub = await up();
    const rpc = await connect(hub, "tasks");
    const { result: created } = await ask(rpc);
    const id = String(created!.taskId); // read first: bun's toMatchObject writes matched asymmetric matchers back into `created`
    expect(id).toMatch(/^r_/);
    expect(created).toMatchObject({ resultType: "task", taskId: id, status: "working", ttlMs: null, pollIntervalMs: 5000 });
    expect((await rpc("tasks/get", { taskId: id })).result).toMatchObject({ taskId: id, status: "working" });

    hub.engine.send(id, SEND);
    expect((await rpc("tasks/get", { taskId: id })).result).toMatchObject({
      taskId: id,
      status: "completed",
      result: { structuredContent: { round_id: id, outcome: "answered" } },
    });
    expect(hub.engine.log()[0]).toMatchObject({ meta: { round_id: id, delivered_at: expect.any(String) } });
    expect(fromTool((await rpc("tools/call", { name: "hermes_inbox", arguments: {} })).result!)).toEqual({ answers: [] });
  });

  test("tasks/cancel cancels the Round; a second cancel is still acknowledged", async () => {
    const hub = await up();
    const rpc = await connect(hub, "tasks");
    const id = String((await ask(rpc)).result!.taskId);
    expect(await rpc("tasks/cancel", { taskId: id })).toMatchObject({ result: {} });
    expect((await rpc("tasks/get", { taskId: id })).result).toMatchObject({ taskId: id, status: "cancelled" });
    expect(hub.engine.log()[0]).toMatchObject({ answer: { round_id: id, outcome: "cancelled", cancelled_by: "agent" } });
    expect(await rpc("tasks/cancel", { taskId: id })).toMatchObject({ result: {} });
  });

  test("an unknown task is -32602; without the extension, tasks/* are -32021 and hermes_ask blocks", async () => {
    const hub = await up();
    const rpc = await connect(hub, "tasks");
    expect((await rpc("tasks/get", { taskId: "r_nope" })).error).toMatchObject({ code: -32602 });

    const plain = await connect(hub, "modern");
    expect((await plain("tasks/get", { taskId: "r_nope" })).error).toMatchObject({ code: -32021 });
    const created = nextRound(hub.engine);
    const asked = ask(plain);
    hub.engine.send(await created, SEND);
    const { result } = await asked;
    expect(result!.resultType).not.toBe("task");
    expect(fromTool(result!)).toMatchObject({ answer: { outcome: "answered" } });
  });
});

describe.each(RPCS)("Codex 0.133's 2025-06-18 handshake through %s", (_name, connect) => {
  test("initialize negotiates 2025-06-18, and tools/call with _meta.threadId works on it", async () => {
    const hub = await up();
    const rpc = await connect(hub, "legacy");
    // Verbatim from Codex 0.133.0's first message to `hermes mcp` (captured 2026-11-23, before the rename).
    const init = await rpc("initialize", {
      protocolVersion: LEGACY_VERSION,
      capabilities: { elicitation: {} },
      clientInfo: { name: "codex-mcp-client", title: "Codex", version: "0.133.0" },
    });
    expect(init.result).toMatchObject({ protocolVersion: LEGACY_VERSION, serverInfo: { name: "hermes-hub" }, capabilities: { tools: {} } });
    const res = await rpc("tools/call", { name: "hermes_inbox", arguments: {}, _meta: { progressToken: 1, threadId: "th_codex" } });
    expect(res.result).toMatchObject({ structuredContent: { answers: [] } });
    const tasks = await rpc("tasks/get", { taskId: "r_nope" });
    expect(tasks.error).toMatchObject({ code: -32021 }); // no Tasks on a 2025-era connection
  });
});

describe("hermes-hub mcp (the real stdio process)", () => {
  function shimEnv(url: string, sessionId: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !AGENT_ENV.test(k)) env[k] = v;
    return { ...env, HERMES_HUB_URL: url, HERMES_AGENT_KIND: "claude-code", HERMES_SESSION_ID: sessionId };
  }
  const spawnShim = (url: string, sessionId: string) =>
    new StdioClientTransport({ command: "bun", args: [MAIN, "mcp"], env: shimEnv(url, sessionId), stderr: "inherit" });

  test("ask through Tasks, exit, the Human answers, a resumed shim's tasks/get delivers the Answer", async () => {
    const hub = await up();
    const sessionId = crypto.randomUUID();
    const first = spawnShim(hub.url, sessionId);
    const rpc = await transportRpc(first, "tasks");
    expect((await rpc("tools/list", {})).result!.tools).toMatchObject([
      { name: "hermes_ask" },
      { name: "hermes_wait" },
      { name: "hermes_cancel" },
      { name: "hermes_inbox" },
    ]);
    const id = String((await ask(rpc)).result!.taskId);
    expect(id).toMatch(/^r_/);
    await first.close(); // the Agent exits: the shim's stdin closes and it exits too

    hub.engine.send(id, SEND);
    const resumed = await transportRpc(spawnShim(hub.url, sessionId), "tasks");
    expect((await resumed("tasks/get", { taskId: id })).result).toMatchObject({
      status: "completed",
      result: { structuredContent: { round_id: id, outcome: "answered" } },
    });
    expect(hub.engine.roster()).toMatchObject([{ kind: "claude-code", session_key: sessionId }]);
  });

  test("tool errors carry the shared code", async () => {
    const hub = await up();
    const client = new Client({ name: "codex-mcp-client", version: "0.133.0" });
    await client.connect(spawnShim(hub.url, crypto.randomUUID()));
    closers.push(() => client.close());
    const invalid = await client.callTool({ name: "hermes_ask", arguments: { round: { schema: "hermes.round/v1", title: "", questions: [] } } });
    expect(invalid).toMatchObject({ isError: true, structuredContent: { code: "invalid_round" } });
    expect(invalid.content).toMatchObject([{ type: "text", text: expect.stringMatching(/^ERROR invalid_round /) }]);
    expect(await client.callTool({ name: "hermes_cancel", arguments: { round_id: "r_nope" } })).toMatchObject({
      isError: true,
      structuredContent: { code: "not_found" },
    });
  });

  test("an unreachable Hub is hub_unavailable", async () => {
    const client = new Client({ name: "codex-mcp-client", version: "0.133.0" });
    await client.connect(spawnShim(`http://127.0.0.1:${freePort()}`, crypto.randomUUID()));
    closers.push(() => client.close());
    expect(await client.callTool({ name: "hermes_inbox", arguments: {} })).toMatchObject({ isError: true, structuredContent: { code: "hub_unavailable" } });
  });
});

describe("/mcp identity and guard", () => {
  test("a client is grouped by its clientInfo into one coarse session, CLAUDE·mcp", async () => {
    const hub = await up();
    const client = await hubClient(hub, "modern", "claude-code");
    await client.callTool({ name: "hermes_inbox", arguments: {} });
    expect(hub.engine.roster()).toMatchObject([{ kind: "claude-code", session_key: "mcp", callsign: "CLAUDE·mcp" }]);
  });

  test("per-call _meta.threadId picks the Codex thread as the session", async () => {
    const hub = await up();
    const client = await hubClient(hub, "legacy", "codex-mcp-client");
    await client.callTool({ name: "hermes_inbox", arguments: {}, _meta: { threadId: "th_123" } });
    expect(hub.engine.roster()).toMatchObject([{ kind: "codex", session_key: "th_123" }]);
  });

  test("a cross-site Origin is forbidden", async () => {
    const { url } = await up();
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Origin: "https://evil.example" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
  });
});
