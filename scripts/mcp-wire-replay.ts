#!/usr/bin/env bun
/**
 * Replays Codex 0.133.0's MCP wire (captured from a real `codex exec` on 2026-11-23) through the real
 * `hermes-hub mcp` process, in real time, against the Hub at argv[2]. Each tool call gets Codex's default
 * 60 s `tool_timeout_sec` as a hard deadline. Expected: hermes_ask returns `pending` at ~50 s, then
 * hermes_wait returns the Answer once the Human (this script, via the Command Center API) sends it.
 * Run through `scripts/live-mcp.sh replay`; never part of `bun test`.
 */
import { join } from "node:path";

const hub = Bun.argv[2];
if (!hub) throw new Error("usage: mcp-wire-replay.ts <hub url>");
const TOOL_TIMEOUT_MS = 60_000;
const started = performance.now();
const t = () => `${((performance.now() - started) / 1000).toFixed(1).padStart(5)} s`;

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !/^(HERMES_|PI_|OMPCODE$|CODEX_|CLAUDE|CURSOR_|COPILOT_|AI_AGENT$|AGENT$)/.test(k)) env[k] = v;
}
const shim = Bun.spawn(["bun", join(import.meta.dir, "../src/cli/main.ts"), "mcp"], {
  env: { ...env, HERMES_HUB_URL: hub },
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});

const waiting = new Map<number, (msg: Record<string, unknown>) => void>();
void (async () => {
  let buffer = "";
  for await (const chunk of shim.stdout) {
    buffer += new TextDecoder().decode(chunk);
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const msg = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (msg.method === "notifications/progress") console.log(`${t()}  ← progress ${msg.params.progress}/${msg.params.total} ${msg.params.message}`);
      else if (typeof msg.id === "number") waiting.get(msg.id)?.(msg);
    }
  }
})();

function send(msg: Record<string, unknown>): void {
  shim.stdin.write(`${JSON.stringify(msg)}\n`);
  shim.stdin.flush();
}

async function call(id: number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
  waiting.set(id, resolve);
  send({ jsonrpc: "2.0", id, method, params });
  const timer = setTimeout(() => {
    console.log(`${t()}  ✗ ${method} id=${id} exceeded Codex's ${TOOL_TIMEOUT_MS / 1000} s tool_timeout_sec`);
    process.exit(1);
  }, TOOL_TIMEOUT_MS);
  const reply = await promise;
  clearTimeout(timer);
  return reply;
}

const threadId = crypto.randomUUID();
const meta = (progressToken: number) => ({ progressToken, threadId, sessionId: threadId });
const round = {
  schema: "hermes.round/v1",
  title: "Billing database",
  questions: [
    { id: "db", kind: "single", prompt: "Which database for billing?", options: [{ id: "postgres", label: "Postgres" }, { id: "sqlite", label: "SQLite" }], recommended: "postgres" },
  ],
};

const init = await call(0, "initialize", {
  protocolVersion: "2025-06-18",
  capabilities: { elicitation: {} },
  clientInfo: { name: "codex-mcp-client", title: "Codex", version: "0.133.0" },
});
console.log(`${t()}  → initialize 2025-06-18 ← protocolVersion ${(init.result as { protocolVersion: string }).protocolVersion}`);
send({ jsonrpc: "2.0", method: "notifications/initialized" });
const list = await call(1, "tools/list", { _meta: { progressToken: 0 } });
console.log(`${t()}  → tools/list ← ${(list.result as { tools: { name: string }[] }).tools.map((x) => x.name).join(", ")}`);

const askStart = performance.now();
console.log(`${t()}  → tools/call hermes_ask (threadId ${threadId})`);
const asked = (await call(2, "tools/call", { name: "hermes_ask", arguments: { round }, _meta: meta(2) })).result as Record<string, unknown>;
const pending = asked.structuredContent as { status?: string; round_id: string };
console.log(`${t()}  ← after ${((performance.now() - askStart) / 1000).toFixed(1)} s: ${JSON.stringify(pending)}`);
if (pending.status !== "pending") throw new Error("expected pending");

console.log(`${t()}  → tools/call hermes_wait ${pending.round_id}; the Human answers in 5 s`);
const waited = call(3, "tools/call", { name: "hermes_wait", arguments: { round_id: pending.round_id }, _meta: meta(3) });
await Bun.sleep(5_000);
const sent = await fetch(`${hub}/cc/rounds/${pending.round_id}/send`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ questions: { db: { value: { selected: "postgres" } } } }),
});
console.log(`${t()}  Human sent the Answer (HTTP ${sent.status})`);
const answer = ((await waited).result as { structuredContent: Record<string, unknown> }).structuredContent;
console.log(`${t()}  ← hermes_wait: ${JSON.stringify(answer)}`);
const agents = (await (await fetch(`${hub}/cc/agents`)).json()) as { agents: { kind: string; session_key: string; callsign: string }[] };
console.log(`${t()}  roster: ${JSON.stringify(agents.agents.map(({ kind, session_key, callsign }) => ({ kind, session_key, callsign })))}`);
shim.stdin.end();
await shim.exited;
process.exit(answer.outcome === "answered" ? 0 : 1);
