import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Server } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/db/db.ts";
import { hostAllowed, RemoteAuth, writeRemoteAuth } from "../src/hub/auth.ts";
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

describe("Agent roster endpoints", () => {
  test("GET /cc/agents lists a session that has contacted the Hub", async () => {
    const { url } = await up();
    await openSession(url);
    const res = await fetch(`${url}/cc/agents`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({ kind: "script", liveness: "live" });
  });

  test("POST /cc/agents/:id/forget hides the session and cancels its pending Rounds", async () => {
    const { url } = await up();
    const token = await openSession(url);
    const headers = { "Content-Type": "application/json", "Hermes-Session": token };
    await fetch(`${url}/v1/rounds`, { method: "POST", headers, body: JSON.stringify(ROUND) });
    const agents = await (await fetch(`${url}/cc/agents`)).json();
    const id = agents.agents[0].id;
    const forget = await fetch(`${url}/cc/agents/${id}/forget`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(forget.status).toBe(200);
    expect((await (await fetch(`${url}/cc/agents`)).json()).agents).toHaveLength(0);
    // The cancelled Round stays in the Feed, ended in place (lifecycle spec), until removed.
    const rounds = (await (await fetch(`${url}/cc/rounds`)).json()).rounds;
    expect(rounds).toMatchObject([{ status: "cancelled" }]);
  });
});

describe("remote access (security spec)", () => {
  test("the guard accepts loopback names, IP literals and this machine's name, and refuses other names", () => {
    for (const host of ["127.0.0.1:4747", "localhost:4747", "192.168.1.20:4747", "100.101.102.103:4747", "[::1]:4747"]) {
      expect(hostAllowed(host, 4747)).toBe(true);
    }
    for (const host of ["evil.example:4747", "192.168.1.20:80", "192.168.1.20", null]) expect(hostAllowed(host, 4747)).toBe(false);
  });

  // Reaching the Hub through a non-loopback address needs one on this machine; CI without a network skips.
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((a) => a && a.family === "IPv4" && !a.internal)?.address;

  test.skipIf(!lan)("another machine is refused without a password, needs Basic auth with one, and loopback never does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hh-auth-"));
    const authPath = join(dir, "remote-auth.json");
    try {
      const db = new Database(":memory:", { strict: true });
      migrate(db);
      const port = freePort();
      servers.push(await startServer(new Engine(db, `http://127.0.0.1:${port}`), port, undefined, undefined, undefined, { hostname: "0.0.0.0", auth: new RemoteAuth(authPath) }));
      const remote = `http://${lan}:${port}/v1/hub`;

      const noPassword = await fetch(remote);
      expect(noPassword.status).toBe(403);
      expect((await noPassword.json()).detail).toContain("hermes-hub password");

      await writeRemoteAuth(authPath, "hermes", "correct horse battery");
      const anonymous = await fetch(remote);
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get("www-authenticate")).toContain("Basic");
      const wrong = await fetch(remote, { headers: { Authorization: `Basic ${btoa("hermes:nope")}` } });
      expect(wrong.status).toBe(401);
      const right = await fetch(remote, { headers: { Authorization: `Basic ${btoa("hermes:correct horse battery")}` } });
      expect(right.status).toBe(200);

      expect((await fetch(`http://127.0.0.1:${port}/v1/hub`)).status).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
