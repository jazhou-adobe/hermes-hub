import { describe, expect, test } from "bun:test";
import { detectIdentity, type IdentityFlags } from "../src/cli/identity.ts";
import type { ProcEntry } from "../src/cli/ancestry.ts";

const NO_FLAGS: IdentityFlags = {};

/** A synthetic ancestry chain, nearest first, by process name (and optional pid). */
function chain(...names: (string | [string, number])[]): ProcEntry[] {
  return names.map((n, i) => {
    const [name, pid] = Array.isArray(n) ? n : [n, 1000 + i];
    return { pid, ppid: pid + 1, comm: name };
  });
}

describe("detection matrix: a shell command the Agent runs", () => {
  test("Claude Code: CLAUDE_CODE_SESSION_ID, documented, step 3", () => {
    const r = detectIdentity(NO_FLAGS, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "c1" }, chain("claude", "zsh"));
    expect(r).toMatchObject({ kind: "claude-code", session_id: "c1", step: 3, documented: true });
  });

  test("Codex CLI: CODEX_THREAD_ID, undocumented, step 3", () => {
    const r = detectIdentity(NO_FLAGS, { CODEX_THREAD_ID: "t1", CODEX_SESSION_ID: "s1" }, chain("codex", "zsh"));
    expect(r).toMatchObject({ kind: "codex", session_id: "t1", step: 3, documented: false });
  });

  test("Cursor CLI: CURSOR_AGENT + ancestry names cursor-agent -> cursor-cli", () => {
    const r = detectIdentity(NO_FLAGS, { CURSOR_AGENT: "1", CURSOR_CONVERSATION_ID: "conv1" }, chain("cursor-agent", "zsh"));
    expect(r).toMatchObject({ kind: "cursor-cli", session_id: "conv1" });
  });

  test("Cursor IDE: CURSOR_AGENT without a cursor-agent ancestor -> cursor-ide", () => {
    const r = detectIdentity(NO_FLAGS, { CURSOR_AGENT: "1" }, chain("Cursor Helper (Renderer)", "launchd"));
    expect(r.kind).toBe("cursor-ide");
  });

  test("VS Code Copilot: COPILOT_AGENT, no session id", () => {
    const r = detectIdentity(NO_FLAGS, { COPILOT_AGENT: "1", AI_AGENT: "github_copilot_vscode_agent" }, chain("Code Helper", "zsh"));
    expect(r).toMatchObject({ kind: "vscode-copilot", session_id: undefined });
  });

  test("omp: PI_SESSION_ID also sets CLAUDECODE=1, but omp wins (collision-safe order)", () => {
    const r = detectIdentity(NO_FLAGS, { OMPCODE: "1", CLAUDECODE: "1", AGENT: "1", PI_SESSION_ID: "p1" }, chain("omp", "zsh"));
    expect(r).toMatchObject({ kind: "omp", session_id: "p1" });
  });

  test("omp's CLAUDECODE=1 is never classified as Claude Code even without PI_SESSION_ID", () => {
    const r = detectIdentity(NO_FLAGS, { OMPCODE: "1", CLAUDECODE: "1" }, chain("omp", "zsh"));
    expect(r.kind).not.toBe("claude-code");
    expect(r.kind).toBe("omp");
  });

  test("a plain script: nothing matches -> script, step 6", () => {
    const r = detectIdentity(NO_FLAGS, {}, chain("zsh"));
    expect(r).toMatchObject({ kind: "script", step: 6, session_id: undefined });
  });

  test("CLAUDECODE=1 alone (no session id): an IDE terminal or omp, not claimed as Claude Code", () => {
    const r = detectIdentity(NO_FLAGS, { CLAUDECODE: "1" }, chain("Code Helper", "zsh"));
    expect(r.kind).toBe("unknown");
  });
});

describe("ancestor tie-break (nested agents)", () => {
  test("both CLAUDE_PID and PI_TERMINAL_OWNER_PID match: the nearer process wins", () => {
    // omp is the direct parent (nearer); Claude Code is an outer ancestor (farther).
    const c = chain(["omp", 10], ["claude", 20], "zsh");
    const env = { OMPCODE: "1", PI_SESSION_ID: "p1", PI_TERMINAL_OWNER_PID: "10", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "c1", CLAUDE_PID: "20" };
    expect(detectIdentity(NO_FLAGS, env, c).kind).toBe("omp");
  });

  test("reversed nesting: Claude Code nearer than omp", () => {
    const c = chain(["claude", 10], ["omp", 20], "zsh");
    const env = { OMPCODE: "1", PI_SESSION_ID: "p1", PI_TERMINAL_OWNER_PID: "20", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "c1", CLAUDE_PID: "10" };
    expect(detectIdentity(NO_FLAGS, env, c).kind).toBe("claude-code");
  });
});

describe("precedence overrides", () => {
  test("--kind and --session beat every env var", () => {
    const r = detectIdentity({ kind: "unknown", session: "manual-1" }, { CLAUDE_CODE_SESSION_ID: "c1" }, chain("claude", "zsh"));
    expect(r).toMatchObject({ kind: "unknown", session_id: "manual-1", step: 1, documented: true });
  });

  test("HERMES_AGENT_KIND and HERMES_SESSION_ID env vars also beat client vars", () => {
    const r = detectIdentity(NO_FLAGS, { HERMES_AGENT_KIND: "script", HERMES_SESSION_ID: "manual-2", CLAUDE_CODE_SESSION_ID: "c1" }, chain("claude"));
    expect(r).toMatchObject({ kind: "script", session_id: "manual-2" });
  });

  test("an explicit --session without --kind still auto-detects the kind", () => {
    const r = detectIdentity({ session: "manual-3" }, { CLAUDE_CODE_SESSION_ID: "c1" }, chain("claude", "zsh"));
    expect(r).toMatchObject({ kind: "claude-code", session_id: "manual-3" });
  });
});

describe("MCP per-call metadata (shim only)", () => {
  test("_meta.threadId -> codex, step 2", () => {
    const r = detectIdentity(NO_FLAGS, {}, [], { meta: { threadId: "th1" } });
    expect(r).toMatchObject({ kind: "codex", session_id: "th1", step: 2 });
  });

  test("_meta['vscode.conversationId'] -> vscode-copilot, step 2", () => {
    const r = detectIdentity(NO_FLAGS, {}, [], { meta: { "vscode.conversationId": "v1" } });
    expect(r).toMatchObject({ kind: "vscode-copilot", session_id: "v1", step: 2 });
  });

  test("env vars still beat clientInfo (step 3 before step 4)", () => {
    const r = detectIdentity(NO_FLAGS, { CLAUDE_CODE_SESSION_ID: "c1" }, chain("claude"), { clientInfo: { name: "codex-mcp-client" } });
    expect(r.kind).toBe("claude-code");
  });

  test("clientInfo.name used only when no env var matched (step 4)", () => {
    const r = detectIdentity(NO_FLAGS, {}, [], { clientInfo: { name: "omp-coding-agent" } });
    expect(r.kind).toBe("omp");
  });
});
