import { hostname } from "node:os";
import type { SessionRequest } from "../schema/validate.ts";
import { ancestryChain, depthOf, nonShellAnchor, processTable, startTime, type ProcEntry } from "./ancestry.ts";

export interface IdentityFlags {
  label?: string;
  kind?: string;
  session?: string;
}

/** Per-call MCP session metadata (the stdio shim re-detects on every call; agent-identity spec). */
export interface McpMeta {
  threadId?: string;
  sessionId?: string;
  "vscode.conversationId"?: string;
}

/** MCP `clientInfo.name` (shim and `/mcp`); self-reported, so it is checked after the env vars. */
export type McpClientInfo = { name: string } | undefined;

export type AgentKind = "claude-code" | "codex" | "cursor-cli" | "cursor-ide" | "vscode-copilot" | "omp" | "script" | "unknown";

interface Detected {
  kind: AgentKind;
  session_id?: string;
  step: number;
  source: string;
  documented: boolean;
}

const CLIENT_INFO_KIND: Record<string, AgentKind> = {
  "claude-code": "claude-code",
  "codex-mcp-client": "codex",
  Cursor: "cursor-cli",
  "cursor-vscode": "cursor-ide",
  "Visual Studio Code": "vscode-copilot",
  "omp-coding-agent": "omp",
};

/** Anchor pid env vars that identify a vendor's own process without name matching (step 3's tie-break). */
const VENDOR_ANCHOR: Partial<Record<AgentKind, string>> = { "claude-code": "CLAUDE_PID", omp: "PI_TERMINAL_OWNER_PID" };

/**
 * Step 3: client-specific session variables, in the collision-safe order the spec lists (omp first,
 * since omp also sets CLAUDECODE). When several match, the vendor anchored nearest in `chain` wins.
 */
function detectFromClientVars(env: Record<string, string | undefined>, chain: ProcEntry[]): Detected | undefined {
  const candidates: Detected[] = [];
  if (env.PI_SESSION_ID || env.OMPCODE) {
    candidates.push({ kind: "omp", session_id: env.PI_SESSION_ID, step: 3, source: env.PI_SESSION_ID ? "PI_SESSION_ID" : "OMPCODE", documented: !!env.PI_SESSION_ID });
  }
  if (env.CODEX_THREAD_ID) candidates.push({ kind: "codex", session_id: env.CODEX_THREAD_ID, step: 3, source: "CODEX_THREAD_ID", documented: false });
  if (env.CURSOR_CONVERSATION_ID || env.CURSOR_AGENT) {
    const cli = chain.some((p) => baseNameOf(p.comm) === "cursor-agent");
    candidates.push({
      kind: cli ? "cursor-cli" : "cursor-ide",
      session_id: env.CURSOR_CONVERSATION_ID,
      step: 3,
      source: env.CURSOR_CONVERSATION_ID ? "CURSOR_CONVERSATION_ID" : "CURSOR_AGENT",
      documented: !env.CURSOR_CONVERSATION_ID,
    });
  }
  if (env.CLAUDE_CODE_SESSION_ID) candidates.push({ kind: "claude-code", session_id: env.CLAUDE_CODE_SESSION_ID, step: 3, source: "CLAUDE_CODE_SESSION_ID", documented: true });
  if (env.COPILOT_AGENT || env.AI_AGENT === "github_copilot_vscode_agent") {
    candidates.push({ kind: "vscode-copilot", step: 3, source: env.COPILOT_AGENT ? "COPILOT_AGENT" : "AI_AGENT", documented: false });
  }
  if (candidates.length <= 1) return candidates[0];

  // Several matched: the vendor whose process is the nearest ancestor wins, where that is known.
  let best = candidates[0]!;
  let bestDepth = depthOf(chain, anchorPid(env, best.kind));
  for (const c of candidates.slice(1)) {
    const depth = depthOf(chain, anchorPid(env, c.kind));
    if (depth !== -1 && (bestDepth === -1 || depth < bestDepth)) {
      best = c;
      bestDepth = depth;
    }
  }
  return best;
}

function anchorPid(env: Record<string, string | undefined>, kind: AgentKind): number | undefined {
  const name = VENDOR_ANCHOR[kind];
  const value = name ? env[name] : undefined;
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

function baseNameOf(comm: string): string {
  return comm.split("/").pop() ?? comm;
}

/** Step 5: generic markers, when nothing more specific matched. */
function detectGeneric(env: Record<string, string | undefined>): Detected {
  if (env.AI_AGENT?.startsWith("claude-code_")) return { kind: "claude-code", step: 5, source: "AI_AGENT", documented: false };
  if (env.CLAUDECODE === "1") return { kind: "unknown", step: 5, source: "CLAUDECODE", documented: false };
  if (env.AI_AGENT || env.AGENT === "1") return { kind: "unknown", step: 5, source: env.AI_AGENT ? "AI_AGENT" : "AGENT", documented: false };
  return { kind: "script", step: 6, source: "none", documented: true };
}

/**
 * `kind` and `session_id` are resolved independently, first hit wins per field (steps 1–6). The
 * reported `detection` describes the first step that fired at all, since that is the dominant,
 * most auditable signal (matches the example payload in the spec).
 */
export function detectIdentity(
  flags: IdentityFlags,
  env: Record<string, string | undefined>,
  chain: ProcEntry[],
  mcp?: { meta?: McpMeta; clientInfo?: McpClientInfo },
): Detected {
  const fromVars = detectFromClientVars(env, chain);
  const clientInfoKind = mcp?.clientInfo && CLIENT_INFO_KIND[mcp.clientInfo.name];

  const candidates: (Partial<Detected> & Pick<Detected, "step" | "source" | "documented">)[] = [
    ...(flags.kind ? [{ kind: flags.kind as AgentKind, step: 1, source: "--kind", documented: true }] : []),
    ...(!flags.kind && env.HERMES_AGENT_KIND ? [{ kind: env.HERMES_AGENT_KIND as AgentKind, step: 1, source: "HERMES_AGENT_KIND", documented: true }] : []),
    ...(flags.session ? [{ session_id: flags.session, step: 1, source: "--session", documented: true }] : []),
    ...(!flags.session && env.HERMES_SESSION_ID ? [{ session_id: env.HERMES_SESSION_ID, step: 1, source: "HERMES_SESSION_ID", documented: true }] : []),
    ...(mcp?.meta?.threadId !== undefined
      ? [{ kind: "codex" as const, session_id: mcp.meta.threadId, step: 2, source: "_meta.threadId", documented: false }]
      : []),
    ...(mcp?.meta?.sessionId !== undefined && mcp?.meta?.threadId === undefined
      ? [{ kind: "codex" as const, session_id: mcp.meta.sessionId, step: 2, source: "_meta.sessionId", documented: false }]
      : []),
    ...(mcp?.meta?.["vscode.conversationId"] !== undefined
      ? [{ kind: "vscode-copilot" as const, session_id: mcp.meta["vscode.conversationId"], step: 2, source: "_meta['vscode.conversationId']", documented: false }]
      : []),
    ...(fromVars ? [fromVars] : []),
    ...(clientInfoKind ? [{ kind: clientInfoKind, step: 4, source: "clientInfo.name", documented: false }] : []),
    detectGeneric(env),
  ];

  const kind = candidates.find((c) => c.kind !== undefined)!.kind!;
  const session_id = candidates.find((c) => c.session_id !== undefined)?.session_id;
  const report = candidates[0]!;
  return { kind, session_id, step: report.step, source: report.source, documented: report.documented };
}

const SIGNAL_ENV = /^(HERMES_|PI_SESSION_ID$|PI_TERMINAL_OWNER_PID$|OMPCODE$|CODEX_THREAD_ID$|CURSOR_CONVERSATION_ID$|CURSOR_AGENT$|CLAUDE_CODE_SESSION_ID$|CLAUDE_PID$|COPILOT_AGENT$|CLAUDECODE$|AI_AGENT$|AGENT$)/;

function gitContext(cwd: string): SessionRequest["git"] {
  const rev = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD", "HEAD"], { stderr: "ignore" });
  if (rev.exitCode !== 0) return null;
  const [root, branch, head] = rev.stdout.toString().trim().split("\n");
  const remote = Bun.spawnSync(["git", "-C", cwd, "config", "--get", "remote.origin.url"], { stderr: "ignore" });
  return { root, branch, head, ...(remote.exitCode === 0 ? { remote: remote.stdout.toString().trim() } : {}) };
}

/** Builds the `POST /v1/sessions` body. `mcp` is supplied by the stdio shim and `/mcp` (S7); the CLI omits it. */
export function detectSession(
  flags: IdentityFlags,
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
  mcp?: { meta?: McpMeta; clientInfo?: McpClientInfo },
): SessionRequest {
  const chain = ancestryChain(process.ppid, processTable());
  const detected = detectIdentity(flags, env, chain, mcp);

  // Fallback key: the nearest non-shell ancestor's pid + start time (a reused pid is a different
  // session) + cwd, so unrelated scripts in the same shell get distinct sessions.
  const anchor = nonShellAnchor(chain);
  const session_key =
    detected.session_id ??
    new Bun.CryptoHasher("sha256").update(`${anchor?.pid ?? process.ppid}:${anchor ? startTime(anchor.pid) : ""}:${cwd}`).digest("hex").slice(0, 32);

  return {
    kind: detected.kind,
    session_key,
    label: flags.label ?? env.HERMES_LABEL ?? null,
    cwd,
    git: gitContext(cwd),
    host: hostname(),
    client_version: null,
    detection: { step: detected.step, source: detected.source, documented: detected.documented },
    signals: {
      env: Object.fromEntries(Object.entries(env).filter(([k, v]) => v !== undefined && SIGNAL_ENV.test(k))),
      ancestry: chain.map((p) => `${baseNameOf(p.comm)}(${p.pid})`),
      client_info: mcp?.clientInfo?.name ?? null,
      meta_keys: mcp?.meta ? Object.keys(mcp.meta) : [],
    },
  };
}
