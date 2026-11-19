# Hermes Hub: which signals identify each Agent client and session automatically?

Research date: 2026-11-19. Ticket: [#5](https://github.com/jazhou-adobe/hermes-hub/issues/5).
Follows [agent-human-transport-options](https://github.com/jazhou-adobe/hermes-hub/blob/research/agent-human-transport-options/docs/research/agent-human-transport-options.md)
(transport choice is settled there and not repeated here).

**Question.** When the `hermes` CLI (run as a shell command by an Agent) or a stdio MCP shim
(spawned by the Agent's client) starts, what can it read, without the Agent's cooperation, to
learn:

- **client kind**: Claude Code, Codex CLI, Cursor (IDE agent or `cursor-agent` CLI), VS Code
  Copilot agent, omp, or a plain script;
- **session id**: which conversation/thread is asking;
- **resume handle**: the value you pass back to the client to continue that session;
- **cwd / git context**;
- what the client reports as MCP `clientInfo`, and any per-call session metadata it sends.

**Evidence labels used in the matrix and text**

| Label | Meaning |
|---|---|
| **D** | Documented in the vendor's official docs (or a first-party README in the vendor's repo, flagged where that is the only place) |
| **S** | Present in source code or a shipped bundle/binary, not documented. Can change without notice |
| **O** | Observed live on this machine in this session |
| **[UNVERIFIED]** | Could not be confirmed from a primary source |

Citations `[Sn]` point to [Sources](#sources). Source-code links are pinned to the commit that was
read. Text under "Assessment" and "Recommended detection precedence" is the researcher's
analysis, not sourced fact.

**What was inspected.** Codex: `openai/codex` at `c764c44` [S6–S21]. omp: `can1357/oh-my-pi` at
`57771ae` plus the running omp 19.0.0 [S38–S47]. VS Code: `microsoft/vscode` at `22d53a1` plus the
installed VS Code 1.143.1 [S28–S33][S37]. Cursor: no public source, so the shipped bundles were
inspected: `cursor-agent` 2026.11.19-f005e9d [S26] and the Cursor 3.30.14 remote-server bundle,
which carries the same extensions as the desktop app [S27]. Claude Code: no public source; the
docs are primary [S1–S4], and the locally installed 2.1.231 binary was searched with `strings`
for MCP details the docs omit [S5]. No other agent was run, so no LLM sessions or credits were used.

---

## TL;DR

1. **Every target except plain scripts marks its shell children with an env var, but only some of
   those markers are documented.** Documented: `CLAUDECODE`/`CLAUDE_CODE_SESSION_ID` (Claude Code) [S1],
   `CURSOR_AGENT` (Cursor) [S22], `PI_SESSION_ID`/`PI_SESSION_FILE` (omp) [S38]. Codex's
   `CODEX_THREAD_ID` appears only in first-party READMEs, not in its public env-var reference
   [S10][S11][S12]. `CURSOR_CONVERSATION_ID`, `COPILOT_AGENT`/`AI_AGENT` (VS Code) and `OMPCODE`
   exist only in source or bundles [S26][S28][S39].
2. **Session id availability to a shell child:** Claude Code (`CLAUDE_CODE_SESSION_ID`, D), Codex
   (`CODEX_THREAD_ID` + `CODEX_SESSION_ID`, S, with README mentions), Cursor
   (`CURSOR_CONVERSATION_ID`, S), omp (`PI_SESSION_ID`, D). **VS Code Copilot gives a terminal
   command no session id at all** [S28][S33].
3. **For a stdio MCP server, the picture is different.** Claude Code passes
   `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PROJECT_DIR`, but the id is fixed at spawn time [S1][S2].
   Codex launches stdio servers with an 11-variable whitelist (no `CODEX_*`) [S16], but sends
   `_meta.threadId` and `_meta.sessionId` **on every `tools/call`** [S18]. VS Code sends
   `_meta["vscode.conversationId"]` per call [S31]. Cursor and omp send no session id to MCP
   servers at all [S26][S27][S42].
4. **MCP `clientInfo.name` values:** `claude-code` (title "Claude Code") [S5], `codex-mcp-client`
   (title "Codex") [S17], `Cursor` for `cursor-agent` [S26], `cursor-vscode` for the Cursor IDE
   [S27], `Visual Studio Code` (`productService.nameLong`) for VS Code [S30][S37],
   `omp-coding-agent` for omp [S42]. None of these is documented by the vendor. The MCP spec
   itself says `clientInfo` is self-reported and must not drive behaviour or security [S48].
5. **Markers collide and leak.** omp sets `CLAUDECODE=1` on its shell children [S39][S47]; the
   Claude Code IDE extensions set `CLAUDECODE` in ordinary integrated terminals [S1]; `AI_AGENT` is
   shared by Claude Code and VS Code and is overwritten or inherited depending on who started
   whom [S5][S33]; nested agents inherit the parent's variables (Codex bug #15527) [S20]. A naive
   "first marker wins" check misclassifies.
6. **Resume handle = the session id for every client that has one:** `claude --resume <id>` [S4],
   `codex resume <id>` / `codex exec resume <id>` / SDK `resumeThread(CODEX_THREAD_ID)` [S11][S14],
   `cursor-agent --resume <chatId>` [S25], `omp --resume <id|path>` [S45]. VS Code Copilot has no
   documented CLI resume handle; the Copilot harness it now shares with Copilot CLI uses
   `copilot --resume=<id>` [S34][S36].
7. **cwd/git context is never sent as metadata; it is inherited.** Every client runs commands with
   a working directory that is the session's (or a model-chosen) directory, so
   `process.cwd()` + `git rev-parse` is the universal source. MCP servers get a configured `cwd` or
   a client-chosen default that is **not** reliably the project (Cursor IDE falls back to `$HOME`)
   [S27][S32], so the shim must use `CLAUDE_PROJECT_DIR`, MCP `roots/list`, or an explicit argument.
8. **Recommended precedence (researcher's):** explicit `HERMES_*`/flags → per-call MCP `_meta` →
   client-specific session variables, checked in a collision-safe order and disambiguated by
   process ancestry → generic markers (`AI_AGENT`, `CLAUDECODE`, `AGENT`) → `script`. A
   self-declared **label** is display text and always wins; it never replaces the auto-detected
   kind or session id, which are stored alongside it. See
   [Recommended detection precedence](#recommended-detection-precedence-researchers-not-a-decision).

---

## Detection matrix

### A. A shell command the Agent runs (the `hermes` CLI path)

| Client | Client-kind signal | Session id | Resume handle | cwd / git | Notes |
|---|---|---|---|---|---|
| **Claude Code** | `CLAUDECODE=1` (D) [S1]; `CLAUDE_CODE_CHILD_SESSION=1` only when Claude Code itself spawned the process (D) [S1]; `AI_AGENT=claude-code_<ver>_agent` (S) [S5]; `CLAUDE_PID` (D, v2.1.214+) [S1] | `CLAUDE_CODE_SESSION_ID` (D), equals hooks' `session_id`, updated on `/clear` [S1]. Cloud: `CLAUDE_CODE_REMOTE_SESSION_ID` (D); Remote Control: `CLAUDE_CODE_BRIDGE_SESSION_ID` (D) [S1] | Same id: `claude --resume <id>`; also accepts a transcript `.jsonl` path (D) [S4] | Inherited cwd. Hooks get `cwd` and `transcript_path` (D) [S3] | `CLAUDECODE` alone is not proof: IDE terminals also get it [S1], and omp sets it [S39] |
| **Codex CLI** | `CODEX_CI=1` on model-run commands only (S) [S8]; `CODEX_THREAD_ID` (README-documented) [S10][S11]; `CODEX_VERSION` (S) [S7]; `CODEX_SANDBOX=seatbelt` when sandboxed on macOS (S) [S21] | `CODEX_THREAD_ID` = this thread (README) [S10]; `CODEX_SESSION_ID` = shared root-session id (S) [S7]; `CODEX_TOOL_CALL_ID` (README) [S10] | `CODEX_THREAD_ID` → SDK `resumeThread()` (README) [S11]; `codex exec resume <SESSION_ID>` (D) [S14] | Inherited cwd. Hooks get `session_id` (parent's for subagents), `transcript_path`, `cwd` (D) [S13] | User `!` commands get the thread/session ids but not `CODEX_CI` (S) [S8][S9]. No config can remove `CODEX_THREAD_ID` (S) [S6] |
| **Cursor `cursor-agent` CLI** | `CURSOR_AGENT=1` (D) [S22][S26] | `CURSOR_CONVERSATION_ID` (S) [S26]; `CURSOR_REQUEST_ID` (S) [S26] | `cursor-agent --resume <chatId>` (D) [S25]. [UNVERIFIED] that chatId == `CURSOR_CONVERSATION_ID` (Cursor hooks call it `conversation_id`, and `session_id` "same as `conversation_id`") [S23] | Inherited cwd; `AGENT_TRANSCRIPTS` = transcript dir under the project dir (S) [S26]. Hooks get `CURSOR_PROJECT_DIR`, `workspace_roots`, `transcript_path` (D) [S23] | Cloud/background workers additionally set `CURSOR_BC_ID`, `CURSOR_REPO_URL`, `CURSOR_USER_ID` (S) [S26] |
| **Cursor IDE agent** | `CURSOR_AGENT=1` (D) [S22]; same agent-exec code as the CLI (S) [S27] | `CURSOR_CONVERSATION_ID`, `CURSOR_REQUEST_ID` (S) [S27] | No documented CLI resume for IDE chats [UNVERIFIED] | As CLI; `AGENT_TRANSCRIPTS` (S) [S27] | Cursor does not document whether the user's own integrated terminal also gets `CURSOR_AGENT` [S22] |
| **VS Code Copilot agent** (in-workbench terminal tool) | `AI_AGENT=github_copilot_vscode_agent` and `COPILOT_AGENT=1` (S) [S28][S29]; `TERM_PROGRAM=vscode` (also set for human terminals) | **None** in the environment [S28] | None documented for VS Code chats | Inherited cwd | VS Code now also runs a "Copilot" harness shared with Copilot CLI, plus Claude and Codex harnesses, all under an agent-host process that sets `AI_AGENT=github_copilot_vscode_agent` (S) [S33][S34] |
| **omp** | `OMPCODE=1`, **`CLAUDECODE=1`**, `AGENT=1`, `CI=true` (S; O) [S39][S40][S47]; `PI_TERMINAL_OWNER_PID` in TUI mode (D) [S38][S44] | `PI_SESSION_ID` (D; O) [S38][S41]; `PI_TOOL_CALL_ID` (D) [S38] | `omp --resume <id prefix \| path>` (D) [S45]; `PI_SESSION_FILE` = absolute JSONL path (D; O) [S38] | Inherited cwd | Values are re-read per tool call, so they follow `/fork`, `/new`, `/resume` [S38] |
| **Plain script** | Nothing; absence of all the above. `isatty(stdin)` and `TERM_PROGRAM` are hints only | None | None | `process.cwd()` | Only self-declaration identifies it |

### B. A stdio MCP server the client spawns (the shim path)

| Client | Env the server inherits | Session id in env | Per-call session metadata | Server cwd | `clientInfo` (name / version) | MCP revision used |
|---|---|---|---|---|---|---|
| **Claude Code** | Includes `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PROJECT_DIR` (D) [S1][S2]; **not** `CLAUDE_CODE_CHILD_SESSION` [S1] | `CLAUDE_CODE_SESSION_ID`, **frozen at spawn**; on `--continue`/bare `--resume` may hold the startup id (D) [S1] | `_meta["claudecode/toolUseId"]` only, no session id (S, 2.1.231) [S5] | Depends on config scope (D) [S2]; `roots/list` answered with launch dir + added dirs (D) [S2] | `claude-code`, title `Claude Code`, version = CLI version (S) [S5] | 2026-07-28 where supported, else older (D) (see prior research) |
| **Codex CLI** | Only `HOME LOGNAME PATH SHELL USER __CF_USER_TEXT_ENCODING LANG LC_ALL TERM TMPDIR TZ` plus configured `env` / `env_vars` (S; config keys D) [S15][S16] | **None**; request to add it was closed "not planned" [S19] | `_meta.threadId`, `_meta.sessionId` on `tools/call` (S) [S18] | Configured `cwd`, else the runtime cwd (S; `cwd` key D) [S15] | `codex-mcp-client`, title `Codex`, version = crate version (S) [S17] | Sends `initialize` with 2025-06-18 (S) [S17] |
| **Cursor `cursor-agent`** | MCP SDK default whitelist `HOME LOGNAME PATH SHELL TERM USER` + configured `env`/`envFile` (S; config D) [S24][S26] | None | None found (S) [S26] | Configured `cwd` [S26] | `Cursor` / `1.0.0` (S) [S26] | [UNVERIFIED] |
| **Cursor IDE** | "spawn env" + configured `env` (S) [S27]; `${workspaceFolder}` interpolation in config (D) [S24] | None | None found (S) [S27] | Configured `cwd`, else the matching workspace folder, else `$HOME` (S) [S27] | `cursor-vscode` / `1.0.0` (S) [S27] | [UNVERIFIED] |
| **VS Code Copilot** | Full extension-host `process.env` + `envFile` + configured `env` (S) [S32] | None | `_meta["vscode.conversationId"]`, `_meta["vscode.requestId"]` on `tools/call` (S) [S31] | Configured `cwd`, else workspace folder, else home (S) [S32] | `Visual Studio Code` (`productService.nameLong`) / VS Code version (S; O in 1.143.1) [S30][S37] | `MCP.LATEST_PROTOCOL_VERSION` in `initialize` (S) [S30] |
| **omp** | omp's own `process.env` + configured `env` (S) [S43]; so `PI_TERMINAL_OWNER_PID` in TUI mode, but **not** `PI_SESSION_ID`/`OMPCODE` (those are per-command) [S39][S41] | None | None (`tools/call` carries only `name`, `arguments`) (S) [S42] | Configured `cwd`, else project dir (S) [S43]; `roots/list` → project dir (S) [S42] | `omp-coding-agent` / `1.0.0` (S) [S42] | 2025-11-25 `initialize` (S) [S43] |

**MCP `clientInfo` mechanics.** Under 2025-11-25 and earlier, `clientInfo` arrives once in
`initialize.params`. Under 2026-07-28 there is no handshake; clients **SHOULD** put
`io.modelcontextprotocol/clientInfo` in every request's `_meta` [S48][S49]. The spec says both
`clientInfo` and `serverInfo` "are self-reported by the sender and are not verified", and
implementations "SHOULD NOT rely on them for security decisions" [S48]. The Claude Code and
Cursor bundles both contain the `io.modelcontextprotocol/clientInfo` key [S5][S26].

---

## Per-client findings

### Claude Code

- `CLAUDECODE=1` is set for Bash/PowerShell tool commands, tmux sessions, hooks, status line
  commands and stdio MCP servers. IDE extensions also set it in their integrated terminals [S1].
- `CLAUDE_CODE_CHILD_SESSION=1` is set for Bash, PowerShell and Monitor commands, hooks and status
  line, **not** for stdio MCP servers, and **not** by IDE extensions, so it is the documented way to
  tell "spawned by Claude Code" from "a human typing in an IDE terminal" [S1].
- `CLAUDE_CODE_SESSION_ID`: set in Bash/PowerShell tool subprocesses, hooks and stdio MCP servers.
  It matches the hooks' `session_id` and is updated on `/clear` for commands and hooks. An MCP
  server "retains the ID it was spawned with"; after `--resume <id>` it receives the resumed id,
  but after `--continue` or a bare `--resume` "it may receive the initial startup ID instead" [S1].
- Cloud sessions set `CLAUDE_CODE_REMOTE=true` and `CLAUDE_CODE_REMOTE_SESSION_ID`; Remote Control
  sets `CLAUDE_CODE_BRIDGE_SESSION_ID` in `session_` form (v2.1.199+) [S1].
- `CLAUDE_PID` is Claude Code's own pid in Bash/PowerShell tool and hook subprocesses (v2.1.214+)
  [S1]. That gives a documented ancestry anchor.
- `CLAUDE_PROJECT_DIR` is set in stdio MCP servers' environment to the project root; Claude Code
  answers `roots/list` with the launch dir plus added working dirs [S2].
- Hooks receive `session_id`, `transcript_path`, `cwd`, and `agent_id`/`agent_type` inside
  subagents [S3].
- Resume: `claude --resume <id|name>` or a transcript `.jsonl` path; `--session-id <uuid>` pins a
  new id [S4].
- Undocumented, from the 2.1.231 binary [S5]: at startup Claude Code sets
  `process.env.AI_AGENT = "claude-code_<version>_harness"` unless `AI_AGENT` is already set to a
  non-Claude value; tool commands get `AI_AGENT = "claude-code_<version>_agent"`. Its spawn-env key
  list includes `CLAUDECODE`, `AI_AGENT`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`,
  `CLAUDE_PID`. The MCP client is constructed as `{name:"claude-code", title:"Claude Code",
  version:<CLI version>}`, and `tools/call` carries `_meta["claudecode/toolUseId"]`.
  `CLAUDE_CODE_ENTRYPOINT` is read internally (values such as `sdk-ts`, `claude-vscode`,
  `local-agent`); the Agent SDK sets `sdk-ts` when unset. Whether it reaches tool children is
  [UNVERIFIED].

### Codex CLI

- `CODEX_THREAD_ID` is inserted into the shell environment **after** the user's
  `shell_environment_policy` (inherit / exclude / include_only / set), so no setting removes it
  [S6]. The exec-server README calls `CODEX_THREAD_ID` and `CODEX_TOOL_CALL_ID` "reserved labels
  [that] override inherited values, policy settings, overlays, and cached snapshots" [S10].
- `inject_session_env` adds `CODEX_SESSION_ID` ("the shared root-session identity") and
  `CODEX_VERSION` [S7]. The model's `exec_command` path adds `CODEX_THREAD_ID`,
  `CODEX_TOOL_CALL_ID`, the session env, and the fixed set `NO_COLOR=1 TERM=dumb LANG/LC_*=C.UTF-8
  COLORTERM= PAGER/GIT_PAGER/GH_PAGER=cat CODEX_CI=1` [S8]. The user `!` path adds thread id and
  session env but not `CODEX_CI` [S9].
- Thread vs session: hooks docs say "Subagent hooks use the parent session id" [S13]; the source
  calls `CODEX_SESSION_ID` the shared root-session identity [S7]. So `CODEX_THREAD_ID` identifies
  the (sub)agent thread and `CODEX_SESSION_ID` the root conversation. [INFERENCE] For a root
  thread the two are probably equal, since `SessionId` is constructible from a `ThreadId` [S7].
- The **public** Codex env-var reference lists only stable variables Codex *reads*
  (`CODEX_HOME`, `CODEX_API_KEY`, …) and none of the ones it *sets* [S12]. `CODEX_THREAD_ID` is
  documented only in the TypeScript SDK README (`codex.resumeThread(process.env.CODEX_THREAD_ID)`)
  [S11] and the exec-server README [S10].
- Nested `codex exec` from inside a Codex session inherited the parent's `CODEX_THREAD_ID` in
  0.116.0 (issue #15527, closed) [S20]. Treat nested-agent leakage as a general hazard.
- Sandbox: on macOS seatbelt, children get `CODEX_SANDBOX=seatbelt`; with network disabled,
  `CODEX_SANDBOX_NETWORK_DISABLED=1` [S21]. A sandboxed child's parent is the sandbox wrapper, not
  `codex`, so naive ppid checks need to walk further. [INFERENCE from the seatbelt wrapper.]
- Stdio MCP servers get a fixed whitelist of env vars plus configured `env` and forwarded
  `env_vars` [S15][S16]. They do **not** get `CODEX_THREAD_ID`; a feature request for that was
  auto-closed as not planned [S19]. Instead, every `tools/call` carries `_meta.threadId` and
  `_meta.sessionId` (and `windowId`/`itemId` when known) [S18]. This is the most reliable per-call
  session signal any client gives an MCP server, but it is undocumented.
- `clientInfo` = `Implementation::new("codex-mcp-client", CARGO_PKG_VERSION).with_title("Codex")`,
  protocol version 2025-06-18 in `initialize` [S17]. No `roots` capability is declared there [S17].
- Hooks: stdin JSON has `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`;
  `SessionStart.source` ∈ `startup|resume|clear|compact|fork` [S13]. `codex exec --json` emits
  `thread.started` with `thread_id`; `codex exec resume <SESSION_ID>` / `--last` resumes [S14].

### Cursor (IDE agent and `cursor-agent` CLI)

- Documented: only `CURSOR_AGENT`, suggested for skipping heavy shell prompts "when Cursor runs"
  [S22]. The bundle sets it to `"1"` in every agent shell executor [S26][S27].
- Undocumented, in both the 2026.11.19 CLI bundle and the 3.30.14 IDE extension
  `cursor-agent-exec`: when a conversation/request id is known, shell commands get
  `CURSOR_CONVERSATION_ID`, `CURSOR_REQUEST_ID`, and `AGENT_TRANSCRIPTS` (a transcript directory
  joined under the project dir). Cursor's shell-snapshot code deliberately strips
  `CURSOR_CONVERSATION_ID`/`CURSOR_REQUEST_ID` from persisted shell state so they stay
  per-request [S26][S27]. The older local `cursor-agent` 2025.11.06 set only `CURSOR_AGENT=1`
  (O), so these ids are recent.
- Cloud/background-agent workers set `CURSOR_BC_ID`, `CURSOR_USER_ID`, `CURSOR_REPO_URL`,
  `CURSOR_REPO_OWNER`, … (S) [S26].
- Hooks (D) [S23]: stdin has `conversation_id` ("stable … across many turns"), `generation_id`,
  `model`, `cursor_version`, `workspace_roots`, `user_email`, `transcript_path`; `sessionStart`
  has `session_id` "same as `conversation_id`" and `is_background_agent`, and can return `env` for
  later hooks. Hook env: `CURSOR_PROJECT_DIR`, `CURSOR_VERSION`, `CURSOR_TRANSCRIPT_PATH`,
  `CURSOR_CODE_REMOTE`, and `CLAUDE_PROJECT_DIR` as a Claude-compatible alias.
- CLI resume: `--resume [chatId]`, `--continue`, `agent ls`, `agent resume`,
  `agent create-chat` (returns an id) [S25].
- MCP (D) [S24]: stdio config has `command`, `args`, `env`, `envFile`; interpolation of
  `${env:NAME}`, `${workspaceFolder}`, `${userHome}`. Cursor lists Roots and Elicitation as
  supported.
- MCP (S): the CLI builds its SDK client as `{name:"Cursor", version:"1.0.0"}` and uses the
  SDK's default env whitelist plus configured env [S26]. The IDE's `cursor-mcp` extension builds
  `{name:"cursor-vscode", version:"1.0.0"}`; server cwd = configured `cwd`, else the workspace
  folder matching the config's project, else `os.homedir()` [S27]. No session id reaches MCP
  servers in either.

### VS Code Copilot agent

- The in-workbench terminal tool creates a hidden terminal with `AI_AGENT`, `COPILOT_AGENT=1`,
  `GIT_PAGER=cat`, `GIT_MERGE_AUTOEDIT=no`, `GIT_EDITOR=:`, `DEBIAN_FRONTEND=noninteractive` [S28].
  `AI_AGENT` = `github_copilot_vscode_agent`, described in source as a stable "wire contract" that
  "must be set for every process an agent session spawns" [S29]. Confirmed in the installed 1.143.1
  bundle [S37].
- No session or conversation id is put into the terminal environment [S28][S33].
- VS Code now offers several "Session Targets": **Copilot** (shared with the GitHub Copilot app and
  Copilot CLI), **Claude**, **Codex**, and a deprecated **Local** harness [S34]. The agent-host
  terminal manager also sets `AI_AGENT` and `TERM_PROGRAM=vscode`; the Copilot-CLI and Claude-SDK
  launch configs set `AI_AGENT=github_copilot_vscode_agent` too [S33]. So inside VS Code, a Claude
  or Codex harness session can carry VS Code's `AI_AGENT` at the top and the vendor's own markers
  in tool commands [S5][S33].
- MCP: `initialize` sends `clientInfo: {name: productService.nameLong, version: productService.version}`
  [S30]; `nameLong` is "Visual Studio Code" in stable [S37] (Insiders differs [INFERENCE]).
  `tools/call` `_meta` gets `vscode.conversationId` (from the chat session resource) and
  `vscode.requestId` [S31]. Stdio servers inherit the full extension-host `process.env`, plus
  `envFile` and configured `env`; cwd = configured, else workspace folder, else home [S32].
- Hooks (Copilot harness) receive `sessionId` and `cwd` on stdin (camelCase events) or
  `session_id` (snake_case aliases) [S35]. Copilot CLI resumes with `--resume[=id|name]` or
  `--session-id` [S36]. Copilot CLI's own child-env markers are not in its env-var reference [S36]
  and its JS is packed inside a SEA binary, so they are [UNVERIFIED].

### omp (observed in this session)

- Observed shell env of an omp 19.0.0 subagent bash call [S47]: `OMPCODE=1`, `CLAUDECODE=1`,
  `AGENT=1`, `CI=true`, `PI_SESSION_ID=01a1f250-…`, `PI_SESSION_FILE=~/.omp/agent/sessions/<cwd-slug>/<parent-session>/ResearchAgentSignals.jsonl`,
  `PI_TOOL_CALL_ID=toolu_…`, `PI_TERMINAL_OWNER_PID=19795`, `TERM=dumb`, `NO_COLOR=1`. No
  `AI_AGENT` and no `PI_CODING_AGENT` (those belong to upstream pi, not omp).
- Source: `buildSpawnEnv` sets `OMPCODE: "1"` **and** `CLAUDECODE: "1"` (plus `CI` unless
  `PI_BASH_NO_CI`) [S39]; the non-interactive env sets `AGENT: "1"` [S40]; the bash tool sets
  `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_TOOL_CALL_ID` per call [S41]. Docs: the three `PI_*`
  vars are "always set, so an empty value replaces a stale one inherited from a parent omp
  process", are re-read per call (follow `/fork`, `/new`, `/resume`), and are not given to the
  user's own `!` commands [S38].
- Subagents get their own `PI_SESSION_ID`, and their `PI_SESSION_FILE` sits inside the parent
  session's directory (O) [S47]. The parent session id is therefore recoverable from the path
  [INFERENCE; directory layout not documented].
- Ancestry (O): omp runs the bash tool in an embedded in-process shell [S46], so an external
  program's `getppid()` is the omp process itself (here pid 19795, `comm=omp`), which also equals
  `PI_TERMINAL_OWNER_PID` in the TUI [S44][S47].
- MCP: `clientInfo = {name:"omp-coding-agent", version:"1.0.0"}`, protocol 2025-11-25,
  `roots/list` answered with the project dir; stdio servers get `{...Bun.env, ...config.env}`;
  `tools/call` params are only `name` and `arguments` [S42][S43].
- Resume: `omp --resume <id prefix|path>`, `--continue`, `--restore` [S45].

### Plain scripts / custom agents

- No standard exists. The only env-var convention in the wild is `AI_AGENT` (VS Code calls it
  "cross-vendor"; GitHub's `gh` reads it for its User-Agent) [S29], but a script inherits whatever
  agent launched it, so its presence says nothing about the script itself.
- Detectable facts: cwd, git repo, hostname/user, `SSH_CONNECTION` for remote hosts, TTY presence.
  Everything else must be self-declared.

---

## Cross-cutting hazards

1. **Spoofed or shared markers.** `CLAUDECODE=1` is set by Claude Code, by Claude Code's IDE
   extensions in human terminals [S1], and by omp [S39]. `AI_AGENT` is set by Claude Code
   (keeps a non-Claude value at startup, overwrites in tool commands) [S5] and by VS Code
   [S28][S33]. `AGENT=1` is set by omp [S40] (and, per upstream sources, other harnesses).
   Kind detection must test **specific** variables before generic ones.
2. **Inheritance through nesting.** Any agent launched from another agent's shell inherits the
   outer agent's variables. Codex had exactly this bug [S20]; omp blanks its `PI_*` vars
   explicitly to avoid it [S38]; Claude Code documents `CLAUDE_CODE_CHILD_SESSION` for nested
   detection [S1]. If two vendors' session vars are present, the outer one is stale for this
   process.
3. **Long-lived MCP servers hold stale ids.** Claude Code's stdio server keeps its spawn-time
   `CLAUDE_CODE_SESSION_ID` across `/clear` [S1]; a Codex contributor discussion notes the same
   risk for env-based ids [S19]. Per-call `_meta` (Codex, VS Code) avoids it [S18][S31].
4. **Undocumented ≠ stable.** Codex, Cursor and VS Code identifiers in this doc are source-only.
   Cursor's ids appeared between 2025.11.06 and 2026.11.19 (O vs [S26]). Hermes should store raw
   signals so detection rules can be re-run when vendors change.
5. **None of this is authentication.** Codex says its labels are for correlation; the MCP spec
   says `clientInfo` must not be used for security [S10][S48]. Hub auth (separate ticket) cannot
   lean on any of these.

---

## Recommended detection precedence (researcher's, not a decision)

Separate the outputs, because they have different trust and different owners:

| Field | Purpose | Who may set it |
|---|---|---|
| `label` | Human-friendly name shown in the Command Center ("auth refactor", "nightly triage") | Agent self-declares; fallback derived from kind + repo + branch |
| `kind` | Which client (enum: `claude-code`, `codex`, `cursor-cli`, `cursor-ide`, `vscode-copilot`, `omp`, `script`, `unknown`) | Auto-detected; explicit override allowed |
| `session_id` | Group Rounds per conversation | Auto-detected; explicit override allowed |
| `resume` | Command template to reopen the session | Derived from `kind` + `session_id` |
| `cwd`, `git` | Context | Always auto (cwd, toplevel, branch, HEAD, remote) |
| `signals` | Raw evidence (matched env names and values, ppid chain, MCP `clientInfo`, `_meta` keys) | Always stored, for audit and re-classification |

**Precedence for `kind` and `session_id` (first hit wins, per field):**

1. **Explicit input**: `hermes ask --kind/--session/--label …` flags, then `HERMES_AGENT_KIND`,
   `HERMES_SESSION_ID`, `HERMES_LABEL` env vars (which a Claude Code `SessionStart` hook can write
   via `CLAUDE_ENV_FILE`, or a Cursor `sessionStart` hook can return as `env`) [S1][S23]. The
   Hub Skill should tell Agents to pass `--label`.
2. **Per-call MCP metadata** (shim only): `_meta.threadId`/`_meta.sessionId` → `codex`
   [S18]; `_meta["vscode.conversationId"]` → `vscode-copilot` [S31].
3. **Client-specific session variables**, checked in this collision-safe order:
   1. `PI_SESSION_ID` non-empty or `OMPCODE=1` → `omp` (must precede Claude: omp sets `CLAUDECODE`).
   2. `CODEX_THREAD_ID` → `codex` (session = `CODEX_THREAD_ID`; root = `CODEX_SESSION_ID`).
   3. `CURSOR_CONVERSATION_ID` or `CURSOR_AGENT` → `cursor-cli` / `cursor-ide` (split by
      ancestry, or by `TERM_PROGRAM=vscode`/`VSCODE_*` presence [UNVERIFIED that Cursor sets these]).
   4. `CLAUDE_CODE_SESSION_ID` (with `CLAUDE_CODE_CHILD_SESSION=1` for shell children) → `claude-code`.
   5. `COPILOT_AGENT=1` or `AI_AGENT=github_copilot_vscode_agent` → `vscode-copilot` (no session id).
   When **more than one** of these matches, the process is nested: walk the ppid chain and pick the
   vendor whose process is the nearest ancestor (`claude`, `codex`, `cursor-agent`, `omp`, VS Code
   or Cursor helper). Claude's `CLAUDE_PID` and omp's `PI_TERMINAL_OWNER_PID` give anchors without
   name matching [S1][S38].
4. **MCP `clientInfo.name`** (shim only): `claude-code`, `codex-mcp-client`, `Cursor`,
   `cursor-vscode`, `Visual Studio Code*`, `omp-coding-agent` [S5][S17][S26][S27][S30][S42].
   Below env vars because it is self-reported and undocumented, but useful when the shim got a
   whitelisted env (Codex, Cursor CLI).
5. **Generic markers**: `AI_AGENT` prefix (`claude-code_` → claude-code), `CLAUDECODE=1` without
   `CLAUDE_CODE_SESSION_ID` → `unknown` (could be an IDE terminal or omp), `AGENT=1`/`CI` → `unknown`.
6. **Nothing matched** → `script`; `session_id` = a Hub-minted id bound to the CLI's parent pid +
   cwd for the life of that parent (or `none`).

**Self-declared vs auto-detected (researcher's view).** Let a self-declared `label` always win,
because it is cosmetic. Let explicit `--kind/--session` override auto-detection, because custom
agents and remote sandboxes have no other channel. When both exist and disagree, keep both: show
the declared value and flag the mismatch from the stored `signals`. Never use any detected value
as an authorization input.

---

## Sources

Claude Code
- [S1] Claude Code environment variables: https://code.claude.com/docs/en/env-vars
- [S2] Claude Code MCP (stdio server env, `CLAUDE_PROJECT_DIR`, `roots/list`, working directory): https://code.claude.com/docs/en/mcp
- [S3] Claude Code hooks reference, common input fields: https://code.claude.com/docs/en/hooks
- [S4] Claude Code CLI reference (`--resume`, `--continue`, `--session-id`): https://code.claude.com/docs/en/cli-reference
- [S5] Claude Code 2.1.231 shipped binary (`~/.local/share/claude/versions/2.1.231`), searched with `strings`, 2026-11-19. Observed: MCP client `{name:"claude-code",title:"Claude Code",…}`, `_meta["claudecode/toolUseId"]`, `AI_AGENT` assignment, spawn-env key list. Undocumented; older than the current docs.

Codex (openai/codex @ `c764c44a0559b36e016efefcfeb473966162e5d5`)
- [S6] `codex-rs/protocol/src/shell_environment.rs` (constants; thread id added after policy): https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/protocol/src/shell_environment.rs#L6-L8 and https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/protocol/src/shell_environment.rs#L160-L175
- [S7] `codex-rs/core/src/exec_env.rs` (`CODEX_SESSION_ID`, `CODEX_VERSION`): https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/core/src/exec_env.rs#L11-L49 ; `SessionId` from `ThreadId`: https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/protocol/src/session_id.rs
- [S8] `codex-rs/core/src/unified_exec/process_manager.rs` (`UNIFIED_EXEC_ENV` incl. `CODEX_CI`; exec env assembly): https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/core/src/unified_exec/process_manager.rs#L90-L101 and https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/core/src/unified_exec/process_manager.rs#L1479-L1499
- [S9] `codex-rs/core/src/tasks/user_shell.rs` (`!` commands): https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/core/src/tasks/user_shell.rs#L170-L171
- [S10] exec-server README, "Command metadata": https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/exec-server/README.md#L24-L31
- [S11] TypeScript SDK README, "Resuming an existing thread": https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/sdk/typescript/README.md#L98-L105
- [S12] Codex public env-var reference (lists none of the set-by-Codex vars): https://learn.chatgpt.com/docs/config-file/environment-variables (redirect target of https://developers.openai.com/codex/environment-variables)
- [S13] Codex hooks (common input fields, `SessionStart.source`, subagent session id): https://learn.chatgpt.com/docs/hooks
- [S14] Codex non-interactive mode (`thread.started`, `codex exec resume`): https://learn.chatgpt.com/docs/non-interactive-mode
- [S15] Codex MCP config (`env`, `env_vars`, `cwd`): https://learn.chatgpt.com/docs/extend/mcp
- [S16] `codex-rs/rmcp-client/src/utils.rs` (`DEFAULT_ENV_VARS`): https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/rmcp-client/src/utils.rs#L163-L175 ; fallback cwd: https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/rmcp-client/src/stdio_server_launcher.rs#L320-L331
- [S17] `codex-rs/codex-mcp/src/rmcp_client.rs` (`clientInfo`, protocol version, capabilities): https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/codex-mcp/src/rmcp_client.rs#L1370-L1400
- [S18] `codex-rs/core/src/mcp_tool_call.rs` (`threadId`/`sessionId` request meta): https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/core/src/mcp_tool_call.rs#L667-L672 and https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/core/src/mcp_tool_call.rs#L1637-L1668
- [S19] openai/codex#19937 "Expose current thread ID to local stdio MCP servers" (closed, not planned): https://github.com/openai/codex/issues/19937
- [S20] openai/codex#15527 "Nested codex exec commands inherit parent CODEX_THREAD_ID": https://github.com/openai/codex/issues/15527
- [S21] Sandbox env: https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/core/src/spawn.rs#L20-L26 and https://github.com/openai/codex/blob/c764c44a0559b36e016efefcfeb473966162e5d5/codex-rs/core/src/sandboxing/mod.rs#L270-L280

Cursor
- [S22] Cursor terminal docs, "Disable heavy prompts for Cursor sessions" (`CURSOR_AGENT`): https://cursor.com/docs/agent/tools/terminal
- [S23] Cursor hooks (input fields, `sessionStart`, hook env vars): https://cursor.com/docs/hooks
- [S24] Cursor MCP (config fields, interpolation, supported features): https://cursor.com/docs/mcp
- [S25] Cursor CLI parameters (`--resume`, `ls`, `create-chat`): https://cursor.com/docs/cli/reference/parameters
- [S26] `cursor-agent` 2026.11.19-f005e9d shipped bundle, from the URL in https://cursor.com/install : https://downloads.cursor.com/lab/2026.11.19-f005e9d/darwin/arm64/agent-cli-package.tar.gz . Inspected 2026-11-19: shell env (`CURSOR_AGENT`, `CURSOR_CONVERSATION_ID`, `CURSOR_REQUEST_ID`, `AGENT_TRANSCRIPTS`), cloud worker env, MCP client `{name:"Cursor",version:"1.0.0"}`, SDK stdio env whitelist. Compared with locally installed 2025.11.06-8fe8a63 (only `CURSOR_AGENT`).
- [S27] Cursor 3.30.14 remote-server bundle (same built-in extensions as desktop; `product.json` `nameLong: "Cursor"`), from https://www.cursor.com/api/download?platform=darwin-arm64&releaseTrack=stable : https://downloads.cursor.com/remote-releases/5f54c8173e5552412beb40702adac16275677fa0/vscode-reh-darwin-arm64.tar.gz . Inspected `extensions/cursor-agent-exec` (shell env) and `extensions/cursor-mcp` (`{name:"cursor-vscode",version:"1.0.0"}`, stdio cwd/env).

VS Code (microsoft/vscode @ `22d53a1ff6572fcdd77a2f919fff96e1f7741e94`)
- [S28] Agent terminal env: https://github.com/microsoft/vscode/blob/22d53a1ff6572fcdd77a2f919fff96e1f7741e94/src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/toolTerminalCreator.ts#L148-L198
- [S29] `AI_AGENT` constant and value: https://github.com/microsoft/vscode/blob/22d53a1ff6572fcdd77a2f919fff96e1f7741e94/src/vs/platform/chat/common/aiAgentEnv.ts
- [S30] MCP `initialize` / `clientInfo`: https://github.com/microsoft/vscode/blob/22d53a1ff6572fcdd77a2f919fff96e1f7741e94/src/vs/workbench/contrib/mcp/common/mcpServerRequestHandler.ts#L110-L140
- [S31] `tools/call` `_meta` (`vscode.conversationId`, `vscode.requestId`): https://github.com/microsoft/vscode/blob/22d53a1ff6572fcdd77a2f919fff96e1f7741e94/src/vs/workbench/contrib/mcp/common/mcpServer.ts#L1388-L1397
- [S32] Stdio MCP launch env and cwd: https://github.com/microsoft/vscode/blob/22d53a1ff6572fcdd77a2f919fff96e1f7741e94/src/vs/workbench/api/node/extHostMcpNode.ts#L78-L122
- [S33] Agent host: https://github.com/microsoft/vscode/blob/22d53a1ff6572fcdd77a2f919fff96e1f7741e94/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L320-L340 , https://github.com/microsoft/vscode/blob/22d53a1ff6572fcdd77a2f919fff96e1f7741e94/src/vs/platform/agentHost/node/copilot/copilotCliEnvironment.ts#L60-L66 , https://github.com/microsoft/vscode/blob/22d53a1ff6572fcdd77a2f919fff96e1f7741e94/src/vs/platform/agentHost/node/claude/claudeSdkOptions.ts#L400-L405
- [S34] VS Code "Configure agent hooks" (Session Targets: Copilot/Claude/Codex/Local): https://code.visualstudio.com/docs/agent-customization/hooks
- [S35] GitHub Copilot hooks reference (`sessionId`, `cwd`): https://docs.github.com/en/copilot/reference/hooks-reference
- [S36] GitHub Copilot CLI command reference (`--resume`, `--session-id`, env vars): https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- [S37] Installed VS Code 1.143.1 (`/Applications/Visual Studio Code.app`), `workbench.desktop.main.js` and `product.json`, inspected 2026-11-19: `AI_AGENT`="github_copilot_vscode_agent", `COPILOT_AGENT:"1"`, `clientInfo:{name:l.nameLong,version:l.version}`, `nameLong: "Visual Studio Code"`.

omp (can1357/oh-my-pi @ `57771ae562b9345e0579bceb2d68d585e3e6927e`)
- [S38] `docs/environment-variables.md` ("Set by the bash tool"; `PI_TERMINAL_OWNER_PID`): https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/docs/environment-variables.md#L645-L662 and https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/docs/environment-variables.md#L550
- [S39] `packages/utils/src/procmgr.ts` (`OMPCODE`, `CLAUDECODE`): https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/packages/utils/src/procmgr.ts#L43-L55
- [S40] `packages/coding-agent/src/exec/non-interactive-env.ts` (`AGENT: "1"`): https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/packages/coding-agent/src/exec/non-interactive-env.ts#L36
- [S41] `packages/coding-agent/src/tools/bash.ts` (`PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_TOOL_CALL_ID`): https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/packages/coding-agent/src/tools/bash.ts#L947-L958
- [S42] `packages/coding-agent/src/mcp/client.ts` (`CLIENT_INFO`, `roots/list`, `tools/call`): https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/packages/coding-agent/src/mcp/client.ts#L44-L105 and https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/packages/coding-agent/src/mcp/client.ts#L266-L281
- [S43] `MCP_PROTOCOL_VERSION`: https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/packages/coding-agent/src/mcp/types.ts#L182 ; stdio env/cwd: https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/packages/coding-agent/src/mcp/transports/stdio.ts#L591-L599
- [S44] `PI_TERMINAL_OWNER_PID` claim: https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/packages/coding-agent/src/tools/browser/terminal-owner.ts#L10-L20
- [S45] `docs/cli-reference.md` (`--continue`, `--resume`, `--restore`): https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/docs/cli-reference.md#L86-L88
- [S46] `docs/bash-tool-runtime.md` (embedded in-process shell engine): https://github.com/can1357/oh-my-pi/blob/57771ae562b9345e0579bceb2d68d585e3e6927e/docs/bash-tool-runtime.md
- [S47] Observation, 2026-11-19: `env` and `getppid()` from a bash tool call of an omp 19.0.0 subagent (`ResearchAgentSignals`) on macOS arm64. Parent of external children = pid 19795 `omp` = `PI_TERMINAL_OWNER_PID`.

MCP specification (modelcontextprotocol/modelcontextprotocol @ `c5c0da721c2e08390dbe172a6ccffdb53348c2a4`)
- [S48] 2026-07-28 Basic, per-request `_meta` fields and the self-reported `clientInfo` note: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/c5c0da721c2e08390dbe172a6ccffdb53348c2a4/docs/specification/2026-07-28/basic/index.mdx#L346-L411 (rendered: https://modelcontextprotocol.io/specification/2026-07-28/basic)
- [S49] 2026-07-28 changelog item 2 (stateless MCP, `clientInfo` per request): https://github.com/modelcontextprotocol/modelcontextprotocol/blob/c5c0da721c2e08390dbe172a6ccffdb53348c2a4/docs/specification/2026-07-28/changelog.mdx#L14

Secondary (used only to find primary sources, not cited for any fact): Harness Notes,
"Environment detection": http://harnessnotes.com/environment-detection
