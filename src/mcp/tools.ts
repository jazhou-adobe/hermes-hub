import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  ProtocolError,
  ProtocolErrorCode,
  Server,
  type CallToolResult,
  type McpServerFactory,
  type ServerContext,
  type Tool,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import roundSchema from "../../docs/specs/round.schema.json" with { type: "json" };
import { isRecord } from "../cli/client.ts";
import type { McpClientInfo, McpMeta } from "../cli/identity.ts";
import { HubError } from "../errors.ts";
import type { Answer, PendingStatus } from "../schema/types.ts";
import { VERSION } from "../version.ts";

/** How long `hermes_ask` and `hermes_wait` block without Tasks: under Codex's and Cursor's 60 s tool timeout. */
export const WAIT_BOUND_MS = 50_000;
/** A progress notification this often while blocking, for clients that sent a `progressToken`. */
export const PROGRESS_EVERY_MS = 10_000;
/** The Hub's longest wait window (transports spec); the bound above always ends a wait first. */
export const HUB_WAIT_SECONDS = 55;
/** Suggested `tasks/get` interval. Humans answer in minutes, so a few seconds of latency is free. */
export const POLL_INTERVAL_MS = 5_000;
export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";

/** One-shot timers, injectable so tests drive the 50 s bound without sleeping. */
export interface Timers {
  /** Runs `fn` after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export const realTimers: Timers = {
  after(ms, fn) {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

/** The caller's Round operations for one MCP request; every door maps onto the engine's five. */
export interface McpDoor {
  /** submit; returns the Round id. */
  submit(round: Record<string, unknown>): Promise<string>;
  get(id: string): Promise<Answer | PendingStatus>;
  /** Holds until the Round ends or `signal` aborts, then returns what get returns. */
  wait(id: string, signal: AbortSignal): Promise<Answer | PendingStatus>;
  cancel(id: string): Promise<Answer>;
  inbox(): Promise<Answer[]>;
}

/** The identity signals of one MCP request (agent-identity spec, steps 2 and 4). */
export interface McpCaller {
  meta?: McpMeta;
  clientInfo?: McpClientInfo;
  /** The HTTP request, on `/mcp` only. */
  request?: Request;
}

/** Resolves the caller's door; called on every request, so identity is re-detected per call. */
export type OpenDoor = (caller: McpCaller) => Promise<McpDoor>;

/** `hermes_ask`'s input: the Round schema's `$defs` reachable from `Round`, so `$ref`s resolve from the root. */
function askInputSchema(): Tool["inputSchema"] {
  const defs: Record<string, unknown> = roundSchema.$defs;
  const keep = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (isRecord(node)) {
      for (const [key, value] of Object.entries(node)) {
        if (key === "$ref" && typeof value === "string" && value.startsWith("#/$defs/")) {
          const name = value.slice("#/$defs/".length);
          if (!keep.has(name)) {
            keep.add(name);
            visit(defs[name]);
          }
        } else visit(value);
      }
    }
  };
  visit({ $ref: "#/$defs/Round" });
  return {
    type: "object",
    properties: { round: { $ref: "#/$defs/Round", description: "A hermes.round/v1 document." } },
    required: ["round"],
    additionalProperties: false,
    $defs: Object.fromEntries([...keep].sort().map((name) => [name, defs[name]])),
  };
}

const roundIdInput: Tool["inputSchema"] = {
  type: "object",
  properties: { round_id: { type: "string", description: "The Round id hermes_ask returned (r_…)." } },
  required: ["round_id"],
  additionalProperties: false,
};

/**
 * The Hub Skill (`skill/hermes-hub/SKILL.md`) condensed for Claude Code, which learns Hermes only
 * from these (hub-skill spec). Each text stays under the 2 KiB Claude Code shows of a description.
 */
export const INSTRUCTIONS = `Hermes Hub lets you ask the Human a decision and get their Answer back; the Human answers every Agent from one Command Center.
- When: a decision you cannot or should not make alone (a trade-off the Human owns, an approval before an irreversible or visible action, an ambiguous requirement). Look facts up yourself and put them in the Round's context. Batch every decision that can be made now into one Round. Never ask when HERMES_ADVISOR is set.
- Waiting: hermes_ask waits for the Answer. Do nothing else on that decision until it returns, and never poll. If it returns status "pending", call hermes_wait with the round_id; it blocks again. Never resubmit: to change a pending Round, call hermes_ask with "supersedes": "<round_id>" in the Round. hermes_cancel drops a Round that no longer matters.
- After resuming a session, or when unsure whether Answers arrived while you were away, call hermes_inbox once.
- Reading the Answer: outcome answered (use questions.<id>.value), dismissed (the Human declined; do not ask the same again unchanged), redirected (do what message says instead), expired (policies locked every Question), cancelled (cancelled_by "agent" is you, and superseded_by names your newer Round; "human" means stop asking about it). set_by is human, policy or none (value null). suggested_by marks an Advisor's suggestion the Human sent unchanged; it is still the Human's decision. Always read the notes: they qualify or override values. For an approve Question with edited true, act on the returned proposal, not yours.`;

export const TOOLS: Tool[] = [
  {
    name: "hermes_ask",
    description: `Ask the Human a Round of Questions through Hermes Hub and wait for the Answer.
Round (hermes.round/v1): title (plain, at most 120 characters), context (Markdown: why you ask and the facts you found), 1-20 questions. Kinds: single and multi (options, each with a stable id and a detail stating its consequence), text, approve (a proposal {format: text|command|json, value, editable}). Ids match ^[a-z0-9][a-z0-9_-]{0,63}$, are unique, and stay the same when you supersede. Always set recommended: a marker, never preselected. Unanswered Policy, on the Round or per Question: {"on_timeout":"wait"} (default) when only the Human may decide; {"on_timeout":"apply_recommended","after_seconds":N} when going ahead with the recommendation is safe; {"on_timeout":"cancel","after_seconds":N} when doing nothing is safe (N >= 10). Attachments are inline (markdown, diff, code, image, file, link): send excerpts, not whole files.
Returns the Answer once the Human sends, dismisses or redirects the Round, or its policies end it. With MCP Tasks it returns a task that completes with the Answer: just wait for it. Otherwise it waits up to 50 s and may return {"status":"pending","round_id"}: then call hermes_wait with that round_id.
Errors carry a code: invalid_round (fix the Round at each errors[].pointer), too_large (shrink the attachment at pointer below limit), flood_cap (wait for an existing Answer first), round_ended (the superseded Round already ended: collect it with hermes_wait), hub_unavailable (tell the Human to run hermes-hub start and hermes-hub doctor), advisor_cannot_ask (you are an Advisor run: never ask).`,
    inputSchema: askInputSchema(),
  },
  {
    name: "hermes_wait",
    description:
      'Wait up to 50 s for the Answer to a Round you asked. Returns the Answer, or {"status":"pending","round_id","next_deadline"}: call hermes_wait again, with nothing else in between on that decision. Never resubmit the Round instead. Also collects a Round that ended while you were away.',
    inputSchema: roundIdInput,
  },
  {
    name: "hermes_cancel",
    description:
      "Cancel one of your pending Rounds when its decision no longer matters; returns its Answer with outcome cancelled. To change a Round instead, hermes_ask with supersedes. Fails with round_ended (and the Outcome) if it already ended.",
    inputSchema: roundIdInput,
  },
  {
    name: "hermes_inbox",
    description:
      "List the Answers that arrived for you but were never picked up, oldest first; each counts as delivered once listed. Call it once after resuming a session, or when unsure whether Answers arrived while you were away. Never call it in a loop.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const text = (s: string) => [{ type: "text" as const, text: s }];

function answerResult(answer: Answer): CallToolResult {
  return { content: text(JSON.stringify(answer)), structuredContent: { ...answer } };
}

function waitResult(id: string, state: Answer | PendingStatus): CallToolResult {
  if (!("status" in state)) return answerResult(state);
  const deadline = state.next_deadline ? ` (next deadline ${state.next_deadline})` : "";
  return {
    content: text(
      `Round ${id} is still pending${deadline}: the Human has not answered yet. Call hermes_wait with {"round_id":"${id}"} to keep waiting; do not resubmit the Round.`,
    ),
    structuredContent: { status: "pending", round_id: id, next_deadline: state.next_deadline },
  };
}

/** A tool error carries the shared code (transports spec, "Errors (every door)"). */
function toolError(err: HubError): CallToolResult {
  const details = Object.keys(err.extra).length ? ` ${JSON.stringify(err.extra)}` : "";
  return {
    isError: true,
    content: text(`ERROR ${err.code} ${err.message}${details}`),
    structuredContent: { code: err.code, message: err.message, ...err.extra },
  };
}

/** The Tasks extension counts only when declared on this very request (Tasks spec, Capability Negotiation). */
function declaresTasks(ctx: ServerContext): boolean {
  // The SDK types the 2026-07-28 envelope as `{}`; its keys are the exported *_META_KEY constants.
  const caps = (ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[CLIENT_CAPABILITIES_META_KEY];
  return isRecord(caps) && isRecord(caps.extensions) && TASKS_EXTENSION in caps.extensions;
}

function callerOf(ctx: ServerContext, server: Server, request: Request | undefined): McpCaller {
  const raw = ctx.mcpReq._meta ?? {};
  const meta: McpMeta = {};
  for (const key of ["threadId", "sessionId", "vscode.conversationId"] as const) {
    const value = raw[key];
    if (typeof value === "string") meta[key] = value;
  }
  // 2026-07-28 carries clientInfo on every request; 2025-era clients sent it once, in initialize.
  const info = (ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[CLIENT_INFO_META_KEY] ?? server.getClientVersion();
  const clientInfo =
    isRecord(info) && typeof info.name === "string" ? { name: info.name, ...(typeof info.version === "string" ? { version: info.version } : {}) } : undefined;
  return { meta: Object.keys(meta).length ? meta : undefined, clientInfo, request };
}

function roundIdArg(args: Record<string, unknown>): string {
  const id = args.round_id;
  if (typeof id !== "string" || id === "") throw new HubError("not_found", "round_id is required: pass the id hermes_ask returned");
  return id;
}

const TaskParams = z.looseObject({ taskId: z.string() });
const AnyResult = z.looseObject({});

/**
 * The MCP tool set, shared by the stdio shim and the Hub's `/mcp` (transports spec, MCP). `openDoor`
 * supplies the caller's Round operations; task timestamps live here, outside the per-request
 * `Server` instances, so they survive across requests.
 */
export function createMcpFactory(openDoor: OpenDoor, timers: Timers = realTimers): McpServerFactory {
  /** When each task was first seen, for `createdAt`; dropped once it is terminal. */
  const created = new Map<string, string>();
  const createdAt = (id: string) => {
    let at = created.get(id);
    if (!at) created.set(id, (at = new Date().toISOString()));
    return at;
  };

  function task(id: string, state: Answer | PendingStatus): Record<string, unknown> {
    const base = { taskId: id, createdAt: createdAt(id), ttlMs: null, pollIntervalMs: POLL_INTERVAL_MS };
    if ("status" in state) return { ...base, status: "working", statusMessage: "Waiting for the Human", lastUpdatedAt: base.createdAt };
    created.delete(id);
    if (state.outcome === "cancelled" && state.cancelled_by === "agent" && !state.superseded_by) {
      return { ...base, status: "cancelled", statusMessage: "Cancelled by the Agent", lastUpdatedAt: state.decided_at };
    }
    return { ...base, status: "completed", lastUpdatedAt: state.decided_at, result: answerResult(state) };
  }

  /** Waits at most WAIT_BOUND_MS, with a progress notification every PROGRESS_EVERY_MS when asked for. */
  async function boundedWait(door: McpDoor, id: string, ctx: ServerContext): Promise<CallToolResult> {
    const stop = new AbortController();
    const abort = () => stop.abort();
    ctx.mcpReq.signal.addEventListener("abort", abort);
    const cancelBound = timers.after(WAIT_BOUND_MS, abort);
    let cancelTick = () => {};
    const progressToken = ctx.mcpReq._meta?.progressToken;
    if (progressToken !== undefined) {
      let elapsed = 0;
      const tick = () => {
        elapsed += PROGRESS_EVERY_MS;
        ctx.mcpReq
          .notify({
            method: "notifications/progress",
            params: { progressToken, progress: elapsed / 1000, total: WAIT_BOUND_MS / 1000, message: `Waiting for the Human to answer Round ${id}` },
          })
          .catch(() => {}); // the client may have gone; the wait still ends on its bound
        if (elapsed + PROGRESS_EVERY_MS < WAIT_BOUND_MS) cancelTick = timers.after(PROGRESS_EVERY_MS, tick);
      };
      cancelTick = timers.after(PROGRESS_EVERY_MS, tick);
    }
    try {
      return waitResult(id, await door.wait(id, stop.signal));
    } finally {
      cancelBound();
      cancelTick();
      ctx.mcpReq.signal.removeEventListener("abort", abort);
    }
  }

  return ({ requestInfo }) => {
    const server = new Server(
      { name: "hermes-hub", title: "Hermes Hub", version: VERSION },
      // `extensions` is on the 2026-07-28 capability shape; the SDK's 2.4 type predates it.
      { capabilities: { tools: {}, extensions: { [TASKS_EXTENSION]: {} } } as never, instructions: INSTRUCTIONS },
    );
    const door = (ctx: ServerContext) => openDoor(callerOf(ctx, server, requestInfo));

    server.setRequestHandler("tools/list", async () => ({ tools: TOOLS }));

    server.setRequestHandler("tools/call", async (req, ctx) => {
      const args = isRecord(req.params.arguments) ? req.params.arguments : {};
      const name = req.params.name;
      if (!TOOLS.some((t) => t.name === name)) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${name}`);
      try {
        const d = await door(ctx);
        switch (name) {
          case "hermes_ask": {
            if (!isRecord(args.round)) {
              throw new HubError("invalid_round", "round must be a hermes.round/v1 object", {
                errors: [{ pointer: "", message: "round is required and must be an object" }],
              });
            }
            const id = await d.submit(args.round);
            // Tasks: the Round id is the task id, and the Round is already durable (Tasks spec, Task Creation).
            if (declaresTasks(ctx)) return { resultType: "task", ...task(id, { status: "pending", next_deadline: null }) } as never;
            return await boundedWait(d, id, ctx);
          }
          case "hermes_wait":
            return await boundedWait(d, roundIdArg(args), ctx);
          case "hermes_cancel":
            return answerResult(await d.cancel(roundIdArg(args)));
          default: {
            const answers = await d.inbox();
            return { content: text(JSON.stringify({ answers })), structuredContent: { answers } };
          }
        }
      } catch (err) {
        if (err instanceof HubError) return toolError(err);
        throw err;
      }
    });

    /** Tasks requests from a client that did not declare the extension get -32021 (Tasks spec, Protocol Errors). */
    const requireTasks = (ctx: ServerContext) => {
      if (!declaresTasks(ctx)) {
        throw new ProtocolError(ProtocolErrorCode.MissingRequiredClientCapability, "Missing required client capability", {
          requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } },
        });
      }
    };
    /** HubErrors become JSON-RPC errors here: not_found is the Tasks spec's -32602, the rest keep their code in `data`. */
    const protocolError = (err: unknown): never => {
      if (!(err instanceof HubError)) throw err;
      if (err.code === "not_found") throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Failed to retrieve task: Task not found", { code: err.code });
      throw new ProtocolError(ProtocolErrorCode.InternalError, err.message, { code: err.code, ...err.extra });
    };

    // A completed task delivers the Answer: engine.get marks the first return of an ended Round.
    server.setRequestHandler("tasks/get", { params: TaskParams, result: AnyResult }, async ({ taskId }, ctx) => {
      requireTasks(ctx);
      try {
        return task(taskId, await (await door(ctx)).get(taskId));
      } catch (err) {
        return protocolError(err);
      }
    });

    // Cancellation is cooperative: a Round that already ended is acknowledged too (Tasks spec, Task Cancellation).
    server.setRequestHandler("tasks/cancel", { params: TaskParams, result: AnyResult }, async ({ taskId }, ctx) => {
      requireTasks(ctx);
      try {
        await (await door(ctx)).cancel(taskId);
      } catch (err) {
        if (!(err instanceof HubError && err.code === "round_ended")) protocolError(err);
      }
      return {};
    });

    return server;
  };
}
