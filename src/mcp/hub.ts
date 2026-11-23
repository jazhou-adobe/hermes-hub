import { hostname } from "node:os";
import { createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import { detectIdentity, type McpClientInfo, type McpMeta } from "../cli/identity.ts";
import { HubError } from "../errors.ts";
import type { Engine } from "../hub/engine.ts";
import type { SessionRequest } from "../schema/validate.ts";
import { createMcpFactory, HUB_WAIT_SECONDS, realTimers, type Timers } from "./tools.ts";

/** The engine's JSON-RPC body cap sits above it: the engine applies `limits.round_bytes` itself (`too_large`). */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/**
 * Coarse identity for `/mcp` (agent-identity spec): only `clientInfo` and the call's `_meta` count,
 * never the Hub's own environment. Without a per-call session id, every client of a kind shares
 * one session keyed `mcp`, shown as `CLAUDE·mcp`.
 */
function mcpSession(meta: McpMeta | undefined, clientInfo: McpClientInfo): SessionRequest {
  const detected = detectIdentity({}, {}, [], { meta, clientInfo });
  return {
    kind: detected.kind,
    session_key: detected.session_id ?? "mcp",
    label: null,
    cwd: null,
    git: null,
    host: hostname(),
    client_version: clientInfo?.version ?? null,
    detection: { step: detected.step, source: detected.source, documented: detected.documented },
    signals: { env: {}, ancestry: [], client_info: clientInfo?.name ?? null, meta_keys: meta ? Object.keys(meta) : [] },
  };
}

/**
 * The Hub's `/mcp`: Streamable HTTP on 2026-07-28, legacy-stateless for 2025-era clients. Each call
 * takes the same session path as `POST /v1/sessions` (in process), then calls the engine directly.
 */
export function hubMcpHandler(engine: Engine, timers: Timers = realTimers): McpHttpHandler {
  const factory = createMcpFactory(async ({ meta, clientInfo, request }) => {
    if (request?.headers.has("Hermes-Advisor")) throw new HubError("advisor_cannot_ask", "an Advisor run cannot ask the Human");
    const session = engine.sessionFor(engine.upsertSession(mcpSession(meta, clientInfo)).token);
    return {
      submit: async (round) => engine.submit(session, round, Buffer.byteLength(JSON.stringify(round))).round_id,
      get: async (id) => engine.get(session, id),
      wait: (id, signal) => engine.wait(session, id, HUB_WAIT_SECONDS, signal),
      cancel: async (id) => engine.cancel(session, id),
      inbox: async () => engine.inbox(session, 50),
    };
  }, timers);
  return createMcpHandler(factory, { legacy: "stateless", maxRequestBodySize: MAX_BODY_BYTES });
}
