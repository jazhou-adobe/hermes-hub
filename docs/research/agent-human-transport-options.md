# Hermes Hub: agent ↔ hub ↔ human transport options

Research date: 2026-11-19. Scope: how separate agent processes (Claude Code, Codex CLI, Cursor,
VS Code Copilot, omp, custom agents) can send questions to a central local hub and get the
human's answers back, both synchronously and asynchronously. This is a planning note. Nothing
here has been built.

Citation convention: `[Sn]` points to the numbered entry in [Sources](#sources). Every statement
of fact about a spec, product or default carries one. Text marked **[UNVERIFIED]** could not be
confirmed from a primary source. Text under "Design sketch", "Failure modes", "Assessment" or
"Recommendation" is the researcher's analysis, not a sourced fact.

---

## TL;DR

1. **The only integration every target agent shares is a shell command.** All of them can run a
   CLI from a SKILL.md (Agent Skills allow a `scripts/` dir [S77]). MCP support differs a lot by
   client and by protocol revision. Make the CLI the base contract, and add MCP later as an
   optional adapter.
2. **MCP changed underneath us.** The current revision is **2026-07-28** [S1]. It removed
   sessions, the `initialize` handshake, SSE resumability (`Last-Event-ID`) and server-initiated
   requests. Elicitation now uses the **Multi Round-Trip Request** pattern (`InputRequiredResult`
   → client retries with `inputResponses`) [S2][S3].
3. **MCP elicitation puts the question in the wrong place for Hermes.** It renders the question
   inside each agent's own client UI (a terminal dialog, an editor panel), not in a central inbox
   [S4][S20]. VS Code declines elicitations when no turn is active [S45]. Claude Code cancels them
   in non-interactive runs [S20]. The useful exception is **URL-mode** elicitation: it can send the
   user to the hub's page for that question.
4. **MCP Tasks** (now the extension `io.modelcontextprotocol/tasks`) fits async human approvals
   well: the server returns a durable `taskId` and the client polls `tasks/get` [S6]. Claude Code
   supports it (public beta, CLI only, v2.1.304+, 2026-07-28 connections), and Claude Code keeps
   following a remote server's task after `claude --resume` [S20]. Most other clients don't support
   it yet [S8].
5. **Blocking MCP tool calls run into client timeouts.** Codex defaults `tool_timeout_sec` to 60 s
   [S30]. Claude Code has a 60 s time-to-first-byte timer for HTTP servers and a 5 min (HTTP) or
   30 min (stdio) idle timeout that progress notifications reset. It also moves calls longer than
   2 min to the background [S20][S22].
6. **Blocking shell commands work better than expected.** Claude Code moves a Bash command that
   hits its 2 min default timeout to the background instead of killing it, and interactive
   sessions put no time limit on background commands [S21][S25]. Codex's unified exec returns
   control after ≤30 s and keeps the process alive as a background terminal that the model polls
   [S33].
7. **Async resumption has to be keyed by a hub ticket ID.** Per-agent push channels exist and are
   worth wiring later: Claude Code hooks (`SessionStart`, `UserPromptSubmit` `additionalContext`,
   `asyncRewake`, `Stop` block, `FileChanged`), the `Monitor` tool, `claude -p --resume`,
   `codex exec resume`, and the Codex and Cursor stop hooks [S21][S23][S24][S35][S36][S41].
8. **The A2A task model matches the async story.** A task can sit in `TASK_STATE_INPUT_REQUIRED`
   (an interrupted, non-terminal state). Callers poll `GetTask`, stream with `SubscribeToTask`, or
   receive webhook push notifications [S50]. Reuse the vocabulary. The full protocol is too much
   for coding agents.
9. **Prior art:** HumanLayer's original SDK did exactly this (`require_approval`,
   `human_as_tool`) by polling a hosted API every 3 s, but the repo has since pivoted to a
   coding-agent control plane [S60][S61]. LangChain's Agent Inbox is archived [S64]. Its
   accept/edit/respond/ignore response schema is still worth borrowing.
10. **Researcher's recommendation:** use a durable HTTP+JSON hub (SQLite) with a long-poll `wait`
    endpoint, wrapped by a `hermes` CLI (`ask`, `wait`, `answer`, `inbox`) that the SKILL.md
    calls. The browser UI gets SSE. Add an MCP stdio shim (with Tasks) as phase 2. Treat file
    mailboxes and webhooks as niche add-ons. See [Recommendation](#recommendation-researchers-not-a-decision).

---

## 1. Findings by question

### 1.1 MCP status (current revision 2026-07-28)

**Revision status.** 2026-07-28 is the current version. Each request carries its protocol
version in `_meta`. Older servers and clients (2025-11-25 and earlier) use the handshake
protocol, and the spec has a backward-compatibility section for them [S1].

**Breaking changes that matter to Hermes** [S2]:
- Protocol sessions and the `Mcp-Session-Id` header are gone. Servers that need cross-call state
  mint explicit handles and receive them as tool arguments.
- The `initialize` handshake is gone. Capabilities ride on every request's `_meta`.
- Server→client requests (`elicitation/create`, `sampling/createMessage`, `roots/list`) now use
  **MRTR**. The server returns `resultType: "input_required"` with `inputRequests` and an opaque
  `requestState`. The client gathers the input and retries the original call with a new JSON-RPC
  id plus `inputResponses` [S3]. MRTR is allowed only on `tools/call`, `prompts/get` and
  `resources/read` [S3].
- SSE stream resumability and redelivery (`Last-Event-ID`) were **removed**. A broken stream
  loses the in-flight request, and the client must re-issue it [S2][S10]. In 2025-11-25,
  resumability was a GET with `Last-Event-ID` plus `MCP-Session-Id` [S11].
- `subscriptions/listen` replaces the GET notification stream. Request-scoped
  `notifications/progress` still flow on that request's response stream [S2].
- Tasks moved out of core into the `io.modelcontextprotocol/tasks` extension, which polls with
  `tasks/get` and accepts input with `tasks/update` [S2][S6].
- Sampling, Roots and Logging are deprecated [S2].

**Elicitation** [S4][S5]:
- There are two modes. `form` collects data in-band and the client sees it. `url` is an
  out-of-band browser flow, and the client sees nothing except the URL.
- Form-mode schemas are a restricted subset of JSON Schema: a **flat object of primitives**
  (string with `email`/`uri`/`date`/`date-time` formats, number/integer, boolean, single-select
  enum, multi-select enum array). Nested objects and arrays of objects are deliberately
  unsupported [S4].
- Servers must not use form mode for secrets [S4]. Clients must show which server is asking and
  offer decline and cancel [S4].
- 2026-07-28 removed `notifications/elicitation/complete` and the URL-mode `elicitationId`. The
  client learns the outcome of a URL flow by **retrying** the original request [S2].

**Mapping friendly-grill rounds onto elicitation (assessment).** `single` → enum, `multi` → enum
array and `text` → string all fit. Per-question `notes` fields would need one extra string property
per question. HTML `facts`/`desc` cannot be rendered because the schema only has
`title`/`description` strings. Recommended-option preselection maps to `default`.

**Progress.** The client opts in with `_meta.progressToken`. The server may send progress
notifications with `progress`, an optional `total` and an optional `message` [S12]. In Claude Code,
progress resets the idle timer but **does not** extend the wall-clock `timeout` [S20].

**Tool-call timeouts and long-running behaviour in clients**

| Client | Default tool-call limit | Other relevant behaviour | Source |
|---|---|---|---|
| Claude Code | `MCP_TOOL_TIMEOUT` ≈ 28 h wall-clock. Per-server `timeout` in `.mcp.json` overrides it | HTTP/SSE/connector requests have a per-request time-to-first-byte timer of max(60 s, tool timeout, `MCP_TIMEOUT`). Stdio and WS have no per-request timer. The idle timeout (no response and no progress) is 5 min for network servers and 30 min for stdio, configurable with `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`. Main-conversation calls longer than 2 min auto-background (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`). Calls are not backgrounded while an elicitation dialog is open | [S20][S22] |
| Codex CLI | `tool_timeout_sec` default **60 s** per server. `startup_timeout_sec` default 10 s | Elicitation surfaces only if the approval policy allows it (`approval_policy.granular.mcp_elicitations`); otherwise it is auto-rejected | [S30][S31][S34] |
| Cursor | **[UNVERIFIED]**: no tool-timeout value is documented | Supports stdio, SSE and Streamable HTTP. Supports Tools, Prompts, Resources, Roots, **Elicitation** and MCP Apps | [S40] |
| VS Code Copilot | **[UNVERIFIED]**: no tool-timeout value found | Form and URL elicitation are supported "during an active turn". They are cancelled in Autopilot and declined when no turn is active. VS Code 1.107 added 2025-11-25 support, including URL elicitation and the **experimental Tasks** | [S45][S46] |

**Which clients support elicitation today (documented):**
- **Claude Code**: form and URL. It declares `{form:{}, url:{}}` on 2026-07-28 connections and,
  from v2.1.287, on user-configured stdio/sse/http/ws servers on older revisions. The CLI shows a
  terminal dialog. Cloud sessions show a card. The `Elicitation` and `ElicitationResult` hooks can
  auto-answer. URL mode opens the browser via the OS URL handler, with a ~8,000-character URL
  cap [S20][S23].
- **Codex CLI**: implemented in its rmcp client [S34], gated by the approval policy [S31].
- **Cursor**: listed as "Supported" [S40].
- **VS Code Copilot**: form and URL, active-turn only [S45].

**MCP Tasks support.** The community extension matrix lists Tasks for Claude (web), **Claude
Code**, MCPJam and Glean. It lists none for Cursor, VS Code or ChatGPT [S8]. Separately, VS Code
supports the older *experimental* 2025-11-25 tasks utility [S46][S9]. Claude Code specifics [S20]:
- Public beta. Needs v2.1.304+, a 2026-07-28 connection, feature-flag fetching enabled, terminal
  CLI or Agent SDK, and a call from the main conversation (not a subagent).
- Shape: `resultType:"task"` + `taskId` (≤128 printable ASCII) + `status`. Claude Code then polls
  `tasks/get` every `pollIntervalMs` (default 2000, clamped to 250–30000).
- `input_required` + `inputRequests` is answered via `tasks/update`. Elicitation inside a task
  works only in interactive terminal sessions.
- A *remote* (HTTP) server's task survives exiting Claude Code. `claude --resume` of the same
  session resumes following it. A *stdio* server's process dies when Claude Code exits.
- Claude Code does not use `notifications/tasks`, `tasks/result` or `tasks/list`.

**Can a stdio MCP server proxy to a central HTTP hub?** Yes. Under stdio the client spawns the
server as a subprocess and talks over stdin/stdout. The spec itself notes that client and stdio
server share one trust boundary [S13]. Nothing stops that subprocess from making outbound HTTP
calls. The established example is `mcp-remote`, an MIT-licensed bridge that connects
stdio-only clients to remote MCP servers [S14]. Claude Code gives a stdio server the
`CLAUDE_CODE_SESSION_ID` env var, so the shim can tag questions with the originating session
[S22]. For Claude Code, stdio also avoids the 60 s per-request first-byte timer, which applies
only to HTTP, SSE and connector servers [S20].

**Streamable HTTP for a local hub.** Servers MUST validate `Origin`. Local servers SHOULD bind to
127.0.0.1 and SHOULD authenticate connections [S10]. MCP's local-security guide states that
"binding to 127.0.0.1 is not an authentication boundary", because other local processes and
browser pages can reach the port [S13]. Since 2026-07-28 there is no session resumability, so a
long-blocking `tools/call` that drops is lost and must be re-issued [S2]. A durable hub ticket
(or an MCP Task) is therefore required for anything that waits on a human.

### 1.2 Plain HTTP from a skill: shell timeouts and waiting

**Agent shell limits**

| Agent | Foreground limit | What happens at the limit | Background or async mechanism | Source |
|---|---|---|---|---|
| Claude Code (Bash) | `BASH_DEFAULT_TIMEOUT_MS` 120 s. Model may request up to `BASH_MAX_TIMEOUT_MS` 600 s | The command is **moved to the background**, not killed (unless it starts with `sleep` or background tasks are disabled) | `run_in_background: true`. No time limit in local interactive sessions. Unattended (`-p`, SDK, CI) runs default to 30 min, max 2 h. Output goes to a file the model reads | [S21][S22][S25] |
| Claude Code (Monitor) | Each watch has a deadline: 5 min default, max 30 min (10 min in `-p`) | One notice at the deadline. The model may re-arm | Every stdout line from a command (or WebSocket message) is delivered to the model mid-conversation | [S21] |
| Codex CLI (unified exec) | Initial yield ≤ 30 s (`MAX_YIELD_TIME_MS`). Empty `write_stdin` polls up to `background_terminal_max_timeout`, default 300 s. Legacy exec default timeout 10 s | The process keeps running as a background terminal (max 64). The model polls it | `write_stdin` polling | [S31][S32][S33] |
| Cursor | **[UNVERIFIED]**: terminal timeout not documented | — | — | [S40] |
| omp | **[UNVERIFIED]**: observed in this researcher's own tool schema, no public doc: `bash` has `timeout` (default 300 s, max 3600 s), `async` and `notify` (regex → follow-up message) | — | — | — |

**HTTP waiting styles**
- **Long polling**: the server holds a request open until data is available or a timeout fires,
  then the client re-requests. RFC 6202 describes it and its caveats (intermediary timeouts,
  connection limits) [S75]. Keep each poll window (e.g. 25 s) under the shortest tool yield or
  timeout and loop inside the CLI.
- **SSE**: one-way `text/event-stream` over HTTP. Built-in reconnect with `retry:` and
  `Last-Event-ID` [S74]. Ideal for the browser UI. Awkward for a blocking shell command, because
  `curl -N` never exits by itself. It works with event-line consumers (Claude Code Monitor, omp
  `notify`).
- **WebSocket**: bidirectional, RFC 6455 [S76]. Claude Code Monitor can consume a WebSocket
  directly [S21]. Adds no value over SSE plus POST for a question/answer hub.
- **Webhooks/callbacks**: the hub POSTs to a URL the agent gave it. Coding-agent CLIs don't expose
  an inbound HTTP listener [UNVERIFIED: no client documents one], so this only suits custom
  agent services. A2A standardises it as push notifications [S50].

### 1.3 Async resumption patterns

| Pattern | Mechanism | Works for | Source |
|---|---|---|---|
| Poll by ticket id | Agent stores `question_id` and later runs `hermes wait <id>` or `GET /questions/<id>` | Every agent | (design) |
| Claude Code `SessionStart` / `UserPromptSubmit` hook | Hook returns `additionalContext`, which is injected as a system reminder. `SessionStart` matcher values include `resume` | Claude Code | [S23] |
| Claude Code `asyncRewake` hook | Background hook. Exit code 2 **wakes Claude immediately even when idle** and passes stderr as a system reminder | Claude Code | [S23] |
| Claude Code `Stop` hook block | `decision:"block"` keeps the turn going. Capped at 8 consecutive continuations (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) | Claude Code | [S23] |
| Claude Code `FileChanged` hook | Filesystem watcher on **literal filenames in the working directory** | Claude Code + file mailbox | [S23] |
| Claude Code headless resume | `claude -p "<answer>" --resume <session_id>`. The session id comes from `--output-format json` or `CLAUDE_CODE_SESSION_ID` | Claude Code | [S22][S24] |
| Claude Code MCP Task | Remote server task survives exit. `claude --resume` resumes following it | Claude Code CLI | [S20] |
| Codex `Stop` hook | `decision:"block"` + `reason` creates a continuation prompt | Codex | [S35] |
| Codex resume | `codex exec resume <SESSION_ID>` or `--last` | Codex | [S36] |
| Cursor `stop` hook | `followup_message` auto-continues, subject to `loop_limit` (default 5) | Cursor | [S41] |
| A2A | Task in `TASK_STATE_INPUT_REQUIRED` | A2A-speaking custom agents | [S50] |

**How the A2A task lifecycle handles human input** [S50]:
- **Task states:** `SUBMITTED`, `WORKING`, `INPUT_REQUIRED`, `AUTH_REQUIRED`, `COMPLETED`,
  `FAILED`, `CANCELED`, `REJECTED`.
  - `INPUT_REQUIRED` and `AUTH_REQUIRED` are *interrupted* states.
  - `COMPLETED`, `FAILED`, `CANCELED` and `REJECTED` are terminal.
- **Waiting:** by default `SendMessage` blocks until a terminal *or interrupted* state.
  `return_immediately: true` returns at once, and the caller then picks one of three update
  mechanisms: `GetTask` (poll), `SubscribeToTask` (stream) or push notifications.
- **Push notifications:** the agent sends webhook POSTs carrying the same `StreamResponse`
  payload as the stream. The spec includes guidance on webhook auth and security.
- **Supplying the input:** the client sends a new message with the same `taskId`/`contextId`.
- **Version and governance:** spec v1.0.0, versioned by the `A2A-Version` header. The site is
  © The Linux Foundation, Apache-2.0.

*Assessment.* In A2A, the *remote agent* asks the *client* for input. If Hermes Hub acted as an
A2A server, a coding agent would `SendMessage` a question, the task would stay `WORKING` until the
human answered, and it would then reach `COMPLETED` with the answer as an artifact. The vocabulary
(ticket = task, poll / stream / push) maps cleanly. Coding agents have no built-in A2A client
[UNVERIFIED], so this is only an option for custom agents.

### 1.4 Local-machine concerns

- **Discovery.** Jupyter is a precedent: its server writes per-instance runtime files in a
  runtime directory, and `jupyter server list` shows URLs and tokens for running servers [S70].
  Hermes equivalent (design): `HERMES_HUB_URL` env var takes priority, then
  `~/.hermes/hub.json` (`{url, token, pid, version}`, mode 0600), then the default
  `http://127.0.0.1:<fixed-port>`. Claude Code can inject env into every Bash command through
  `CLAUDE_ENV_FILE`, which a `SessionStart` hook can populate [S22].
- **Auth.** Binding to 127.0.0.1 is not an auth boundary [S13]. MCP HTTP servers must check
  `Origin` to block DNS rebinding [S10]. Jupyter's default is a random token in the URL or
  `Authorization: token` header [S70]. Design: a bearer token read from `hub.json`, `Origin`
  checks on all non-GET routes, and the UI served from the same origin.
- **Notifications.** The browser Notifications API is secure-context only and needs user
  permission [S71]. `http://localhost` and `127.0.0.0/8` count as potentially trustworthy, so
  they qualify as secure contexts [S72]. As an OS-level fallback on macOS, AppleScript
  `display notification` (via `osascript`) works without a browser tab [S73].
- **Agent-side notification hooks.** Claude Code emits `Notification` events, including
  `elicitation_dialog` and `agent_needs_input` [S23]. Codex `notify` runs a program on
  `agent-turn-complete` [S31]. **[UNVERIFIED]**: neither has been tested for forwarding to the hub.

---

## 2. Option catalogue

Shared assumption for every option (design): the hub owns a durable **question store** (e.g.
SQLite). It holds one row per question or round, with `id`, `agent` (client, session id, cwd,
label), `payload` (the friendly-grill round JSON), `status`
(`pending|answered|cancelled|expired`), `answer`, `created_at`, `expires_at` and `default_answer`.
Answers are immutable once set. Every option below is a different **transport** onto this store.

### Option A: REST + long-poll, wrapped by a `hermes` CLI

**Design sketch**
```
POST /v1/questions            → 201 {id, url}               (idempotency-key header)
GET  /v1/questions/{id}?wait=25 → 200 {status:"answered", answer} | 200 {status:"pending"} after 25 s
GET  /v1/inbox?agent=<sid>&status=answered&since=<cursor>   (for async pickup)
POST /v1/questions/{id}/cancel
```
CLI: `hermes ask round.json [--wait|--no-wait] [--timeout 0] [--out answers.json]`,
`hermes wait <id>`, `hermes inbox [--session $CLAUDE_CODE_SESSION_ID]`. The stdout protocol is
kept from friendly-grill: `QUESTION <id> <url>`, then `ANSWERS` + JSON, written to `--out`.

- **Sync:** `hermes ask --wait` loops 25 s long-polls until the question is answered.
  - Claude Code: run with `run_in_background: true` (or let the 120 s timeout move it to the
    background) and read the `--out` file when it finishes [S21][S25]. Alternatively, run
    `hermes wait <id>` under **Monitor**, which pushes the `ANSWERS` line into the conversation.
    Monitor's 5–30 min deadline means re-arming [S21].
  - Codex: the command keeps running as a background terminal and the model polls it with
    `write_stdin` [S33].
- **Async:** `hermes ask --no-wait` prints the id and the agent continues or exits.
  - Later, `hermes wait <id>` or `hermes inbox` picks up the answer.
  - Optional per-client push: a Claude Code `SessionStart(resume)` or `UserPromptSubmit` hook
    runs `hermes inbox --format=context` and returns `additionalContext` [S23].
  - For headless agents, the hub can run `claude -p … --resume <sid>` or
    `codex exec resume <sid>` when the answer lands [S24][S36].
- **SKILL.md tells the agent:** write the round JSON → `hermes ask <file> --out <file>` in the
  background → wait for the job (don't poll) → read the answers. Include a `curl` fallback for
  machines without the CLI.
- **Compatibility:** every agent with a shell. No client config needed beyond the skill (and
  `hub.json`).
- **Failure modes:**
  - *Tool timeout:* harmless, because the wait is re-entrant by id and the question persists.
  - *Hub restart:* the CLI retries with backoff, and rows survive in SQLite.
  - *User never answers:* `expires_at` → `status:"expired"` (+ `default_answer`), the CLI exits
    with a distinct code, and the agent decides.
  - *Agent dies:* the question stays answerable. The hub shows "agent gone" if a heartbeat lapses.
- **Complexity:** low. A small HTTP server, a CLI, and SQLite.

### Option B: hub is a Streamable HTTP MCP server

Three variants:
- **B1, blocking `ask` tool.** The response does not complete until the human answers.
  - Claude Code: needs a per-server `timeout` > 60 s, otherwise the first-byte timer fails the
    call. Respond with an SSE response stream and send progress every < 5 min so the idle
    timeout doesn't fire. Calls longer than 2 min auto-background [S20].
  - Codex: `tool_timeout_sec` must be raised from 60 s [S30].
  - Any client: if the connection drops, the answer is lost to that call, because 2026-07-28
    has no resumability [S2].
- **B2, MCP Tasks.** The `ask` tool returns `resultType:"task"` with `taskId` = hub question
  id. `tasks/get` reports `working` until the question is answered, then `completed` with the
  answer. This is the cleanest async path for Claude Code CLI: it survives exit and resumes with
  `claude --resume` [S20]. Most other clients don't support the extension [S8], and Claude Code
  only supports it in the CLI (not the VS Code extension or desktop app) [S20].
- **B3, URL-mode elicitation.** `ask` returns `InputRequiredResult` with a URL-mode elicitation
  pointing at `http://127.0.0.1:<port>/q/<id>`. The user answers in the hub, then confirms in the
  client, which retries the call with `requestState` [S3][S4]. This puts a dialog in every client.
  VS Code declines it when no turn is active and Claude Code cancels it in headless runs
  [S20][S45]. Form-mode elicitation would bypass the hub UI entirely.

**Assessment**
- **SKILL.md tells the agent:** "call the `hermes.ask` tool". The MCP server still has to be
  configured per client in `.mcp.json`, `config.toml`, `mcp.json` and so on. A skill can't do that
  by itself.
- **Compatibility:** B1 works anywhere once timeouts are configured. B2 is effectively Claude Code
  CLI only today. B3 needs per-client elicitation support.
- **Failure modes:**
  - *Tool timeout* is a real risk for B1.
  - *Hub restart* kills in-flight B1 calls. B2 recovers through `tasks/get` by id.
  - *User never answers:* B1 hits the timeout. B2 can stay `working` indefinitely (Claude Code
    enforces no background task limit [S20]).
- **Complexity:** medium. Requires MCP SDK work on 2026-07-28, with a fallback for clients still
  on 2025-11-25 [S1].

### Option C: MCP stdio shim → HTTP hub

`hermes mcp` runs as a stdio MCP server spawned by each client. It translates `ask`, `wait` and
`inbox` tool calls into Option A's REST calls.

- **Sync:** the shim long-polls the hub and emits progress notifications to keep Claude Code's
  stdio idle timer (30 min) alive. Stdio has no first-byte timer [S20].
- **Async:** the shim implements Tasks with `taskId` = hub id. The task id stays answerable
  across connections, as Claude Code requires on resume, because the *hub* persists it rather
  than the shim process [S20].
- **Identity:** the shim inherits `CLAUDE_CODE_SESSION_ID` [S22].
- **SKILL.md tells the agent:** prefer the `hermes_ask` tool if it is listed, otherwise run the
  CLI. This gives one skill with two paths.
- **Compatibility:** all four named clients support stdio [S20][S30][S40]. Codex still needs
  `tool_timeout_sec` raised for sync calls [S30].
- **Failure modes:**
  - *Shim dies with the client:* harmless, because state lives in the hub.
  - *Hub restart:* the shim retries.
  - Long-poll and timeout handling is the same as Option A.
- **Complexity:** medium. It reuses the Option A backend and only adds an MCP adapter, the same
  bridge pattern as `mcp-remote` [S14].

### Option D: SSE / WebSocket subscription

The agent subscribes to `GET /v1/agents/<sid>/events` (SSE) and receives `answered` events.

- **Sync:**
  - Claude Code: `Monitor` running `curl -N …/events`, or Monitor's native WebSocket source
    [S21]. Each answer arrives as an event while the agent keeps working.
  - omp: `notify` on the same stream [UNVERIFIED, see §1.2].
  - Plain shells: the stream never ends, so a blocking `curl` is unusable without a
    `--max-time` loop.
- **Async:** not on its own. A missed event needs a catch-up GET (`since` cursor). SSE
  `Last-Event-ID` supports this at the HTTP level [S74].
- **SKILL.md tells the agent:** client-specific instructions ("if you have Monitor…").
- **Compatibility:** Claude Code (Monitor), omp, custom agents, and **the hub's own browser UI**,
  which is SSE's natural home.
- **Failure modes:** Monitor deadlines (≤30 min) need re-arming [S21]. Proxies can buffer the
  stream. A hub restart drops all streams, and clients must reconnect and catch up.
- **Complexity:** low on the hub, high on per-client instructions.

### Option E: webhook / command callback

At ask time the agent registers `callback: {url}` or `callback: {command}`. When the question is
answered, the hub POSTs to the URL or runs the command.

- **Sync:** n/a.
- **Async:** this is the strongest option for agents that **exited**. A command callback such
  as `claude -p "<answer JSON>" --resume <sid>` [S24] or `codex exec resume <sid> "<answer>"`
  [S36] re-launches the session with the answer as the next prompt. URL callbacks suit custom
  agent services and A2A push notifications [S50]. CrewAI Enterprise and A2A both use webhook
  shapes [S50][S67].
- **SKILL.md tells the agent:** pass `--resume-cmd` or `--callback-url` to `hermes ask`.
- **Compatibility:**
  - URL: custom agents only, since coding agents have no listener [UNVERIFIED].
  - Command: Claude Code and Codex headless.
- **Failure modes:**
  - *Command injection risk:* the hub executes commands. Allow-list templates and never
    interpolate answer text into a shell string.
  - *Resuming an interactive session that is still open:* risk of a fork or conflict
    [UNVERIFIED].
  - *Delivery failures:* need retries.
  - *Hub restart:* a durable outbox is needed.
- **Complexity:** medium, and security-sensitive.

### Option F: file mailbox

Questions are written to `~/.hermes/inbox/<id>.json` and answers appear in `…/answers/<id>.json`.
The hub watches the directory.

- **Sync:** `hermes wait` (or a shell loop) watches for the answer file.
- **Async:** the answer file waits until the agent next looks. Claude Code's `FileChanged` hook
  can watch **only literal filenames in the working directory** [S23], so a per-project
  `.hermes-answers.json` could push answers in.
- **SKILL.md tells the agent:** write a JSON file, then wait for or read another.
- **Compatibility:** any agent with filesystem access to `~/.hermes`. Sandboxed agents may be
  barred from writing outside the workspace [UNVERIFIED].
- **Failure modes:**
  - Works while the hub is down: questions queue and the hub ingests them on start.
  - Breaks for a *shared* (non-local) hub.
  - Needs atomic rename for writes and a lockfile or lease for multiple hub instances.
- **Complexity:** low, but it's a second protocol to maintain alongside HTTP.

### Comparison

| | A REST+long-poll CLI | B1 MCP blocking | B2 MCP Tasks | B3 URL elicitation | C stdio shim | D SSE/WS | E callback | F file mailbox |
|---|---|---|---|---|---|---|---|---|
| Skill-only install (no client config) | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Claude Code | ✅ bg/Monitor | ⚠️ timeouts | ✅ CLI beta | ✅ | ✅ | ✅ Monitor | ✅ `--resume` | ✅ |
| Codex CLI | ✅ bg terminal | ⚠️ 60 s default | ❌ [S8] | ⚠️ policy-gated | ⚠️ raise timeout | ⚠️ | ✅ `exec resume` | ✅ |
| Cursor | ✅ [UNVERIFIED timeout] | ⚠️ [UNVERIFIED] | ❌ [S8] | ✅ | ✅ | ⚠️ | ❓ | ✅ |
| VS Code Copilot | ✅ [UNVERIFIED timeout] | ⚠️ [UNVERIFIED] | ⚠️ 2025-11-25 only | ⚠️ active turn only | ✅ | ⚠️ | ❓ | ✅ |
| Custom agents | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sync | ✅ | ✅ | ✅ (wait mode) | ✅ | ✅ | ✅ (event) | ❌ | ✅ |
| Async / exited agent | ✅ ticket | ❌ | ✅ | ❌ | ✅ | ❌ | ✅✅ | ✅ |
| Survives hub restart | ✅ | ❌ | ✅ | ✅ (retry) | ✅ | ⚠️ reconnect | ⚠️ outbox | ✅ |
| Answer UI in hub | ✅ | ✅ | ✅ | ✅ (via URL) | ✅ | ✅ | ✅ | ✅ |
| Complexity | Low | Med | Med | Med | Med | Low hub / high docs | Med + security | Low |

Legend: ✅ works, ⚠️ works with configuration or caveats, ❌ no, ❓ unknown. Each cell is an
assessment built from the sourced facts in §1.

### Recommendation (researcher's, not a decision)

The decision belongs to the user. Suggested layering:

1. **Core (v1):** Option A.
   - The durable SQLite question store is the single source of truth.
   - HTTP+JSON API with a 25 s long-poll `wait`, plus a `hermes` CLI whose stdout and answer
     format extend friendly-grill's (`READY`/`ANSWERS`, `__notes`, `__general`), so existing
     grilling skills port with a path change.
   - One SKILL.md covers sync (run `hermes ask --wait` in the background and wait for the job)
     and async (`--no-wait`, keep the id, `hermes inbox` on resume).
2. **Hub UI:** a browser page fed by **SSE** (Option D used internally, not by agents), with a
   Notifications API toast and an `osascript` fallback [S71][S73].
3. **Discovery and auth:** `HERMES_HUB_URL` → `~/.hermes/hub.json` (0600, with a random token)
   → default port. Use `Origin` checks and bind to 127.0.0.1 by default [S10][S13].
4. **v2 adapters, in order:**
   - (a) Option C, a stdio MCP shim with Tasks for Claude Code CLI.
   - (b) Claude Code hooks: `SessionStart`/`UserPromptSubmit` inject answered tickets, and an
     optional `asyncRewake` waiter.
   - (c) Option E command callbacks (`--resume`) for headless runs.
   - (d) A2A server facade only if custom agents need it.
5. **Defer or avoid:**
   - Form-mode elicitation as the primary channel, because it bypasses the hub UI.
   - B1 blocking HTTP MCP, because of timeout fragility.
   - File mailbox, unless offline queuing becomes a requirement.

---

## 3. Prior art

| Product | What it does | Transport | Sync/async model | Reusable for Hermes | Licence |
|---|---|---|---|---|---|
| **HumanLayer** (SDK ≤ v0.7.9) | `require_approval()` decorator and `human_as_tool()`. Approvals and questions go through a hosted API to Slack, email and other channels | HTTPS to a hosted API. The SDK **polls every 3 s** (`fetch_approval` / `fetch_human_response` → `sleep(3)`) | Sync by blocking poll. Async via create-then-fetch calls | API shape: separate `function_call` (approval) from `human_contact` (free question); per-channel routing | Apache-2.0 [S60][S61] |
| **HumanLayer** (current repo) | Has pivoted to running coding agents (Claude Code, Codex, OpenCode, Pi) with a desktop/web app plus a per-host daemon. Mirrors sessions through plugins | oRPC/Hono API, Electric sync | — | Per-host daemon + plugins for Claude Code/OpenCode/Pi is close to Hermes' multi-agent shape | Apache-2.0 [S60] |
| **LangGraph `interrupt()`** | `interrupt(payload)` pauses a graph node. State is checkpointed per `thread_id`. Resume with `Command(resume=value)`, which becomes `interrupt()`'s return value. Waits indefinitely | In-process/library. Payload surfaced as `__interrupt__` or `stream.interrupts` | Async by design (checkpoint + resume) | The "persistent cursor" idea: Hermes ticket id ≈ `thread_id` + interrupt id | MIT [S63] |
| **LangChain Agent Inbox** | Inbox UI for LangGraph interrupts. `HumanInterrupt{action_request, config{allow_accept, allow_edit, allow_respond, allow_ignore}}` → `HumanResponse{type: accept\|edit\|response\|ignore}` | Talks to the LangGraph server | Async inbox | Response-type vocabulary for approval-style questions. **Repo is archived** | MIT [S64] |
| **Temporal** | Durable workflows. **Signals** are async writes with no awaitable response. **Updates** are sync, tracked writes the sender can wait on. **Queries** are reads | gRPC to the Temporal service | Both | Signal (fire-and-forget answer) vs Update (wait for ack) semantics. Heavy to run locally for this use | MIT [S65] |
| **CrewAI** | `human_input=True` on a Task prompts on the console before the final answer. Flows have a `@human_feedback` decorator (1.8.0+). Enterprise HITL: `humanInputWebhook` at kickoff → "Pending Human Input" state → `POST /resume` | Console, or HTTP webhooks + resume endpoint | Sync (console) / async (webhook) | The kickoff→pending→resume lifecycle with webhook URLs passed explicitly on resume | MIT [S66][S67] |
| **OpenAI Agents SDK** | Tools declare `needs_approval` / `needsApproval` (bool or async predicate). The run pauses with `interruptions`. `RunState` serialises with `toString()`/`fromString()` and resumes after `approve`/`reject`. Sticky `alwaysApprove`/`alwaysReject` decisions | In-process. The developer persists state | Async (serialise and resume later) | Sticky "always allow" decisions, and serialisable pending state | MIT [S68] |
| **AG-UI** | Agent↔frontend event protocol. A run that needs input **ends** with `RUN_FINISHED` + interrupt outcome (`id`, `reason`, `message`, `toolCallId`, `responseSchema`). The next run carries `resume[]` entries (`interruptId`, `status`, `payload`) | HTTP POST + SSE (default binding) or protobuf | Async (interrupt = closed run) | `responseSchema` carried opaquely for form building. Explicit answered/abandoned status | MIT [S69] |
| **A2A** | Agent↔agent tasks with `INPUT_REQUIRED`. Poll, stream or push webhooks | JSON-RPC / gRPC / HTTP+JSON | Both | Task state names and the poll/stream/push trio (see §1.3) | Apache-2.0 [S50] |
| **MCP Tasks ext.** | Durable `taskId`, `tasks/get` polling, `input_required` + `tasks/update` | MCP | Async | Directly usable as Option B2/C | Apache-2.0 [S6][S7] |
| **friendly-grill** (in-house) | One round, one agent. A local HTML form server prints `READY <url>`, blocks until submit, then prints `ANSWERS` JSON and writes `--out` | Local HTTP on 127.0.0.1, random port | Sync only | Round/answer JSON format, stdout markers, "background job + don't poll" instruction | in-house [S78] |

---

## Sources

MCP
- [S1] MCP Versioning (current = 2026-07-28): https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning
- [S2] MCP 2026-07-28 Key Changes: https://modelcontextprotocol.io/specification/2026-07-28/changelog
- [S3] MCP Multi Round-Trip Requests: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
- [S4] MCP Elicitation (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
- [S5] MCP Elicitation (2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
- [S6] MCP Tasks extension overview: https://modelcontextprotocol.io/extensions/tasks/overview
- [S7] ext-tasks repository (Apache-2.0): https://github.com/modelcontextprotocol/ext-tasks
- [S8] MCP Extension Support Matrix (source): https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/extensions/client-matrix.mdx (rendered: https://modelcontextprotocol.io/extensions/client-matrix)
- [S9] MCP Tasks utility, 2025-11-25 (experimental): https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
- [S10] MCP Streamable HTTP (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- [S11] MCP Transports (2025-11-25, resumability): https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- [S12] MCP Progress (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress
- [S13] MCP Local Server Security: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/local-server-security
- [S14] mcp-remote (stdio→remote bridge, MIT): https://github.com/geelen/mcp-remote

Claude Code
- [S20] Claude Code MCP (timeouts, auto-background, MCP tasks, elicitation): https://code.claude.com/docs/en/mcp
- [S21] Claude Code tools reference (Bash timeouts, background, Monitor, AskUserQuestion): https://code.claude.com/docs/en/tools-reference
- [S22] Claude Code environment variables: https://code.claude.com/docs/en/env-vars
- [S23] Claude Code hooks: https://code.claude.com/docs/en/hooks
- [S24] Claude Code headless / `-p` / `--resume`: https://code.claude.com/docs/en/headless
- [S25] Claude Code interactive mode (how backgrounding works): https://code.claude.com/docs/en/interactive-mode

Codex CLI
- [S30] Codex MCP: https://learn.chatgpt.com/docs/extend/mcp?surface=cli (redirect target of https://developers.openai.com/codex/mcp)
- [S31] Codex configuration reference: https://learn.chatgpt.com/docs/config-file/config-reference (redirect target of https://developers.openai.com/codex/config-reference)
- [S32] Codex `exec.rs` (`DEFAULT_EXEC_COMMAND_TIMEOUT_MS = 10_000`): https://github.com/openai/codex/blob/14302d5de9ec4183fd2b53ad2a0ae7bdf80340d5/codex-rs/core/src/exec.rs#L67
- [S33] Codex `unified_exec/mod.rs` (yield and background constants): https://github.com/openai/codex/blob/14302d5de9ec4183fd2b53ad2a0ae7bdf80340d5/codex-rs/core/src/unified_exec/mod.rs#L68-L77
- [S34] Codex MCP elicitation handling: https://github.com/openai/codex/blob/14302d5de9ec4183fd2b53ad2a0ae7bdf80340d5/codex-rs/codex-mcp/src/elicitation.rs
- [S35] Codex hooks: https://learn.chatgpt.com/docs/hooks
- [S36] Codex non-interactive mode (`codex exec resume`): https://learn.chatgpt.com/docs/non-interactive-mode

Cursor / VS Code
- [S40] Cursor MCP: https://cursor.com/docs/mcp
- [S41] Cursor hooks: https://cursor.com/docs/hooks
- [S45] VS Code MCP developer guide (elicitation): https://code.visualstudio.com/api/extension-guides/ai/mcp
- [S46] VS Code 1.107 release notes (MCP 2025-11-25, URL elicitation, Tasks): https://code.visualstudio.com/updates/v1_107

A2A
- [S50] A2A Protocol Specification v1.0 (Linux Foundation, Apache-2.0): https://a2a-protocol.org/latest/specification/

Prior art
- [S60] HumanLayer repository (Apache-2.0): https://github.com/humanlayer/humanlayer
- [S61] HumanLayer SDK v0.7.9 `approval.py` (`require_approval`, `human_as_tool`, 3 s polling): https://github.com/humanlayer/humanlayer/blob/v0.7.9/humanlayer/core/approval.py (last PyPI release 0.7.9, 2025-06-03: https://pypi.org/project/humanlayer/)
- [S63] LangGraph interrupts: https://docs.langchain.com/oss/python/langgraph/interrupts (LangGraph MIT: https://github.com/langchain-ai/langgraph)
- [S64] LangChain Agent Inbox (archived, MIT): https://github.com/langchain-ai/agent-inbox
- [S65] Temporal message passing: https://docs.temporal.io/encyclopedia/workflow-message-passing (Temporal MIT: https://github.com/temporalio/temporal)
- [S66] CrewAI human input on execution: https://docs.crewai.com/en/learn/human-input-on-execution (CrewAI MIT: https://github.com/crewAIInc/crewAI)
- [S67] CrewAI HITL workflows (webhook + resume): https://docs.crewai.com/en/learn/human-in-the-loop
- [S68] OpenAI Agents SDK HITL: https://openai.github.io/openai-agents-python/human_in_the_loop/ and https://openai.github.io/openai-agents-js/guides/human-in-the-loop/ (MIT: https://github.com/openai/openai-agents-python)
- [S69] AG-UI Interrupts and Resume: https://docs.ag-ui.com/spec/1.0/basic/patterns/interrupt-resume ; HTTP+SSE binding: https://docs.ag-ui.com/spec/1.0/basic/transports/http-sse (MIT: https://github.com/ag-ui-protocol/ag-ui)

Local machine / web platform
- [S70] Jupyter Server security (tokens, runtime files, `jupyter server list`): https://jupyter-server.readthedocs.io/en/latest/operators/security.html
- [S71] MDN Notifications API: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API
- [S72] MDN Secure contexts (localhost / 127.0.0.0/8 trustworthy): https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts
- [S73] Apple Mac Automation Scripting Guide, Displaying Notifications: https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/DisplayNotifications.html
- [S74] WHATWG HTML, Server-sent events: https://html.spec.whatwg.org/multipage/server-sent-events.html
- [S75] RFC 6202, Long Polling and HTTP Streaming: https://www.rfc-editor.org/rfc/rfc6202
- [S76] RFC 6455, The WebSocket Protocol: https://www.rfc-editor.org/rfc/rfc6455
- [S77] Agent Skills specification: https://agentskills.io/specification
- [S78] friendly-grill (in-house): `/Users/jazhou/Git/AI/cyber-avatar/.agents/skills/workflow/friendly-grill/SKILL.md` and `scripts/form-server.mjs`
