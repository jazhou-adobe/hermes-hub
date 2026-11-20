import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Server } from "bun";
import { migrate } from "../src/db/db.ts";
import { Engine } from "../src/hub/engine.ts";
import { startServer } from "../src/hub/server.ts";

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

describe("error codes over HTTP", () => {
  test("invalid_round: 422", async () => {
    const { url } = await up();
    const token = await openSession(url);
    const res = await fetch(`${url}/v1/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Hermes-Session": token },
      body: JSON.stringify({ schema: "hermes.round/v1", title: "", questions: [] }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("invalid_round");
  });

  test("too_large: 413", async () => {
    const { url } = await up();
    const token = await openSession(url);
    const res = await fetch(`${url}/v1/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Hermes-Session": token },
      body: JSON.stringify({ ...ROUND, context: "x".repeat(5 * 1024 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("too_large");
  });

  test("unsupported_schema: 422", async () => {
    const { url } = await up();
    const token = await openSession(url);
    const res = await fetch(`${url}/v1/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Hermes-Session": token },
      body: JSON.stringify({ ...ROUND, schema: "hermes.round/v2" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("unsupported_schema");
  });

  test("idempotency_conflict: 409", async () => {
    const { url } = await up();
    const token = await openSession(url);
    const headers = { "Content-Type": "application/json", "Hermes-Session": token };
    await fetch(`${url}/v1/rounds`, { method: "POST", headers, body: JSON.stringify({ ...ROUND, idempotency_key: "k" }) });
    const res = await fetch(`${url}/v1/rounds`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...ROUND, title: "different", idempotency_key: "k" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("idempotency_conflict");
  });

  test("round_ended: 409", async () => {
    const { url } = await up();
    const token = await openSession(url);
    const headers = { "Content-Type": "application/json", "Hermes-Session": token };
    const created = await (await fetch(`${url}/v1/rounds`, { method: "POST", headers, body: JSON.stringify(ROUND) })).json();
    await fetch(`${url}/v1/rounds/${created.round_id}/cancel`, { method: "POST", headers, body: "{}" });
    const res = await fetch(`${url}/v1/rounds/${created.round_id}/cancel`, { method: "POST", headers, body: "{}" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("round_ended");
  });

  test("not_found: 404", async () => {
    const { url } = await up();
    const token = await openSession(url);
    const res = await fetch(`${url}/v1/rounds/r_missing`, { headers: { "Hermes-Session": token } });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
  });

  test("flood_cap: 429", async () => {
    const { url } = await up();
    const token = await openSession(url);
    const headers = { "Content-Type": "application/json", "Hermes-Session": token };
    for (let i = 0; i < 10; i++) await fetch(`${url}/v1/rounds`, { method: "POST", headers, body: JSON.stringify({ ...ROUND, title: `r${i}` }) });
    const res = await fetch(`${url}/v1/rounds`, { method: "POST", headers, body: JSON.stringify({ ...ROUND, title: "r10" }) });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("flood_cap");
  });

  test("unknown_session: 401", async () => {
    const { url } = await up();
    const res = await fetch(`${url}/v1/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Hermes-Session": "hhs_bogus" },
      body: JSON.stringify(ROUND),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("unknown_session");
  });

  test("advisor_cannot_ask: 403", async () => {
    const { url } = await up();
    const res = await fetch(`${url}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Hermes-Advisor": "run1" },
      body: JSON.stringify({ kind: "script", session_key: "x" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("advisor_cannot_ask");
  });
});

describe("browser guard (security spec)", () => {
  test("a cross-site Origin is refused with 403", async () => {
    const { url } = await up();
    const res = await fetch(`${url}/v1/hub`, { headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" } });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
  });

  test("an Origin matching the Hub's own passes", async () => {
    const { url } = await up();
    const res = await fetch(`${url}/v1/hub`, { headers: { Origin: url } });
    expect(res.status).toBe(200);
  });

  test("no Origin header (CLI, curl) passes", async () => {
    const { url } = await up();
    const res = await fetch(`${url}/v1/hub`);
    expect(res.status).toBe(200);
  });

  test("a state-changing request without JSON Content-Type is refused", async () => {
    const { url } = await up();
    const token = await openSession(url);
    const res = await fetch(`${url}/v1/rounds`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "Hermes-Session": token },
      body: "not json",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
  });

  test("no Access-Control-Allow-* headers are ever sent", async () => {
    const { url } = await up();
    const res = await fetch(`${url}/v1/hub`, { headers: { Origin: url } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
