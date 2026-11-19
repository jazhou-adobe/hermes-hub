# Can a Bun hub serve MCP (Streamable HTTP + Tasks) on the current TypeScript SDK?

Research date: 2026-11-19. Ticket: [#3](https://github.com/jazhou-adobe/hermes-hub/issues/3).
This note follows the [transport research](https://github.com/jazhou-adobe/hermes-hub/blob/research/agent-human-transport-options/docs/research/agent-human-transport-options.md)
(§1.1, Options B/C) and does not repeat it. Nothing here has been built in the Hub. A
throwaway spike was run under Bun 1.3.14 on macOS arm64 (see [§6](#6-spike-what-was-actually-run)).

Citation convention: `[Sn]` points to [Sources](#sources). **[SPIKE]** means "observed by running
the spike in §6". **[UNVERIFIED]** means no primary source confirmed it. "Implication" lines are
analysis, not sourced facts.

---

## TL;DR

1. **Yes, both transports work under Bun on the released SDK.** `@modelcontextprotocol/server`
   **2.4.0** (2026-10-23) implements 2026-07-28 [S1][S2]. It says it runs on Node, Bun and Deno
   [S1], and CI runs a Bun integration test on Bun 1.x [S3][S4]. `createMcpHandler()` returns a
   web-standard `{ fetch }` that `Bun.serve` mounts directly, so no `node:http` adapter is needed
   [S5][S6]. `serveStdio(factory)` serves stdio [S7]. Both ran under Bun 1.3.14 [SPIKE].
2. **The released SDK has no Tasks helper. You implement the Tasks wire yourself, and that works
   on 2.4.0** [SPIKE]. Since 2.3.0, `setRequestHandler('tasks/get' | 'tasks/cancel', {params,result}, h)`
   is served on 2026-07-28 connections [S8][S9]. `tasks/update` registers as a custom method. A
   tool handler that returns `{resultType:"task", taskId, status, ...}` goes out with
   `resultType:"task"` intact. The SDK also adds `content: []` [SPIKE][S12].
3. **The first-party Tasks server API is not released yet.** PR #2782 adds
   `@modelcontextprotocol/server/ext/tasks` (`TasksExtension`, `TaskStore`, `InMemoryTaskStore`).
   It is open, needs review, and is marked `@experimental` [S10][S12]. It depends on the
   extensions API (#2820). That API merged on 2026-11-18 but is unreleased: there is a pending
   changeset, and the latest release is 2.4.0 [S11][S2]. The companion package
   `@modelcontextprotocol/ext-tasks` 0.2.3 covers the **requester** (client) side and the
   2025-11-25 receiver only. It has no 2026-07-28 server-side tool-task API [S13].
4. **Bun incompatibility that matters for the Hub: `Bun.serve` closes idle connections after
   10 s by default**, including a request whose handler hasn't written bytes yet and an SSE
   stream that has gone quiet [S6]. A blocking `tools/call` (Option B1) is cut at about 10–12 s
   unless the handler calls `server.timeout(req, 0)` or sets `idleTimeout` (maximum 255 s)
   [S6][SPIKE]. Tasks avoid this, because `tools/call` returns at once and each `tasks/get` is
   short.
5. **2025-11-25 clients:** `createMcpHandler` serves 2025-era clients by default
   (`legacy: 'stateless'`), one fresh server instance per request, with no sessions. Legacy
   `GET`/`DELETE` return `405` [S14]. `serveStdio` serves both eras per connection (default
   `'serve'`) [S14]. The SDK v2 server **cannot** serve the *experimental 2025-11-25 tasks*
   that VS Code uses through `McpServer`. `execution.taskSupport` is dropped from `tools/list`,
   and a `{task:{...}}` tool result is rejected with `-32602` [SPIKE][S15]. That path is only
   in SDK v1.x (`@modelcontextprotocol/sdk` 1.32.x), which will not add 2026-07-28 [S16].
6. **Per-client Tasks today:**
   - **Claude Code**: 2026-07-28 Tasks, public beta. Needs v2.1.304+, the terminal CLI, the
     Agent SDK or GitHub Actions, the main conversation, and feature-flag fetching. Works for
     HTTP and stdio servers [S17].
   - **Codex CLI**: no Tasks. 2026-07-28 is behind the `mcp_2026_07_28` feature flag, which is
     off by default and "under development". The legacy handshake is `2025-06-18`. The
     client-extension allowlist has no tasks id [S18][S19][S20].
   - **VS Code Copilot**: latest protocol is `2025-11-25`. It speaks only the *experimental
     2025-11-25 client-directed* tasks (`params.task`, `tasks/result`), and only when the
     server advertises `capabilities.tasks.requests.tools.call` and the tool declares
     `execution.taskSupport` [S21][S22].
   - **Cursor**: documents no Tasks and no protocol revision. Not in the Tasks column of the
     extension matrix [S23][S24].

---

## 1. SDK versions and what each one gives you

| Package / version | Date | 2026-07-28 | Tasks (server side) | Source |
|---|---|---|---|---|
| `@modelcontextprotocol/sdk` 1.32.2 (v1.x line) | 2026-10-23 | **No**, and not planned | 2025-11-25 *experimental* tasks (`registerToolTask`, task store) | [S16][S2] |
| `@modelcontextprotocol/server` 2.0.0 | 2026-07-27 | Yes | Experimental 2025 task layer **removed**. Task wire types kept only as deprecated vocabulary | [S2][S15] |
| `@modelcontextprotocol/server` 2.1.0 | 2026-09-23 | Yes | `createMcpHandler` validates `Mcp-Name` = `params.taskId` on modern `tasks/get` / `tasks/update` / `tasks/cancel` (else `400` / `-32020`) | [S9] |
| `@modelcontextprotocol/server` 2.3.0 | 2026-10-02 | Yes | `tasks/get` and `tasks/cancel` servable on 2026-07-28 with an explicit-schema handler | [S8][S9] |
| `@modelcontextprotocol/server` **2.4.0** (latest) | 2026-10-23 | Yes | Same as 2.3.0. No `extensions` option, no `ext/tasks` subpath (only `ext/skills`) | [S2][SPIKE] |
| `main` (unreleased) | 2026-11-18 | Yes | `extensions: [{id, setup(ctx)}]`, `ctx.use('tools/call', mw)`, `ctx.capability()`. All `@experimental` | [S11] |
| PR #2782 (open) | — | Yes | `@modelcontextprotocol/server/ext/tasks`: `TasksExtension(store)`, `tasks.create(ctx)`, `TaskStore` (create/get/update/cancel), `InMemoryTaskStore.handle()`. Served on 2026-07-28 only. No `notifications/tasks` (poll only) | [S10][S12] |
| `@modelcontextprotocol/ext-tasks` 0.2.3 | 2026-11-04 | Requester only | `/client` requester lifecycle, `/receiver` for **2025-11-25** sampling/elicitation tasks, `/core/v2` wire schemas. Peer dep `@modelcontextprotocol/client ^2.2.0` | [S13] |

Notes:
- Extensions on `main` live in `McpServerOptions.extensions`. The low-level `Server` doesn't
  take them [S11].
- On 2.4.0, `server.server.registerCapabilities({ extensions: { "io.modelcontextprotocol/tasks": {} } })`
  is accepted. The capability shows in `server/discover`, and also in the legacy `initialize`
  result [SPIKE].
- A 2026-era connection refuses `tasks/result` and `tasks/list` even if a handler exists. Only
  `tasks/get` and `tasks/cancel`, the two names the extension keeps, pass through [S15].
- The stdio entry has an open bug, #3179. Once a connection is pinned to 2026-07-28, later
  requests that name an unsupported version are still served. It reproduces on Bun 1.4.4 too
  [S25].

## 2. Server APIs: Streamable HTTP and stdio

**HTTP.** `createMcpHandler(factory, { legacy })` is the 2026-era HTTP entry. It builds a fresh
`McpServer` per request and passes the factory `{ era }` [S14][S5]. It returns `{ fetch }`:
"`deno serve server.ts` and `bun run server.ts` serve the same `{ fetch }` shape" [S5]. On Bun,
mount it with `Bun.serve({ fetch: req => handler.fetch(req) })`. The SDK's own Bun test does the
same with the lower-level `WebStandardStreamableHTTPServerTransport` [S4].
- **Bun.serve vs node:http.** The Node adapter (`@modelcontextprotocol/node`, `toNodeHandler`,
  `localhostHostValidation`) exists for `IncomingMessage`/`ServerResponse` hosts [S1][S26]. On
  Bun it is unnecessary because the handler is fetch-native. It was not tested under Bun's
  `node:http` shim **[UNVERIFIED]**.
- **Security posture.** `createMcpHandler` does no Host/Origin or token checks itself. For bare
  fetch mounts the docs tell you to put `hostHeaderValidationResponse` /
  `originValidationResponse` in front [S26][S27]. On fetch hosts, including Bun, the bearer
  gate is `requireBearerAuth` from `@modelcontextprotocol/server` [S28]. Issue #2844 (open)
  flags the missing default guards as a footgun [S27].
- **Per-request factory.** Task state must live outside the `McpServer` instance, in a
  process-level store. The PR #2782 example says the same: "tasks outlive the request (and,
  under `createMcpHandler`, the McpServer instance) that created them" [S12].

**stdio.** `serveStdio(factory, { legacy })` from `@modelcontextprotocol/server/stdio`. The
opening exchange pins the era per connection. Log to stderr only. Stdin EOF tears the
connection down [S7][S14]. Older Bun problems with the v1 stdio transport (#91, #709, #1564
EPIPE) are closed [S29].

## 3. Minimal API for a long-running `ask` that returns a task id

### 3a. On released 2.4.0, hand-rolled (verified under Bun [SPIKE])

1. Advertise the extension: `server.server.registerCapabilities({ extensions: { "io.modelcontextprotocol/tasks": {} } })`.
2. In the `ask` tool handler, read `ctx.mcpReq.envelope["io.modelcontextprotocol/clientCapabilities"].extensions`.
   Return a task only if `era === "modern"` and the tasks id is present. The spec says a server
   "MUST NOT return `CreateTaskResult` to a client that did not include the extension
   capability on its request" [S30]. Otherwise block, or return `-32021` if the tool can't
   block [S30].
3. Persist the question first, then return
   `{ resultType: "task", taskId, status: "working", createdAt, lastUpdatedAt, ttlMs: null, pollIntervalMs }`.
   The spec says a server "MUST NOT return `CreateTaskResult` until the task is durably created"
   [S30].
4. Register `tasks/get`, `tasks/cancel` and `tasks/update` with
   `server.server.setRequestHandler(method, { params, result }, handler)`.
   - `tasks/get` returns the `DetailedTask`. The SDK stamps `resultType: "complete"`
     [SPIKE][S30].
   - An unknown id MUST be `-32602` [S30].
   - Non-declaring callers MUST get `-32021` [S30].
   - `taskId` must be unguessable, and every task request must be auth-checked [S30].
5. Over HTTP, clients must send `Mcp-Name: <taskId>` on task requests. The SDK enforces it from
   2.1.0 [S9][S30].

Observed wire output [SPIKE]: the `tools/call` response was
`{"content":[],"resultType":"task","taskId":"…","status":"working",…}` and the follow-up
`tasks/get` returned the `completed` task with `result`. PR #2782 documents the same added
`content: []` as intended behaviour [S12]. Claude Code says the task object "needs no `content`
array" [S17]. Whether it tolerates the extra field was not tested against a live Claude Code
**[UNVERIFIED]**.

Known 2.4.0 gaps (each verified only by reading the source/docs):
- No `tools/call` middleware is released, so the `-32021` gate has to sit inside each tool
  handler [S11].
- `tasks/get` handlers registered this way also answer 2025-era requests. Register them only
  when `era === 'modern'` if that isn't wanted [S15][SPIKE].
- `notifications/tasks` / `subscriptions/listen` delivery isn't implemented. Polling only
  [S12].

### 3b. Once PR #2782 ships (API as proposed, may change)

```ts
const store = /* Hub-backed TaskStore: create/get/update/cancel */;
const tasks = new TasksExtension(store, { principal: ctx => /* hub user/agent id */ });
const handler = createMcpHandler(() => {
  const server = new McpServer(info, { extensions: [tasks] });
  server.registerTool('ask', { inputSchema }, async (args, ctx) => tasks.create(ctx, { ttlMs: null }));
  return server;
});
```

Source: [S12]. Features:
- `TasksExtension` advertises the capability, serves `tasks/get|update|cancel`, refuses
  non-declaring requests with `-32021`, and binds tasks to a principal.
- `requireInput()` drives `input_required` → `tasks/update`.
- On 2025-11-25 requests, `tasks/*` answer `-32601` and `tasks.create` throws [S12].

## 4. Back-compat with 2025-11-25 clients

- **Plain tools work.** The default `legacy: 'stateless'` answers `initialize` and `tools/call`
  from the same factory, one request at a time [S14][SPIKE]. A legacy client gets no sessions:
  no standalone GET SSE stream and no `DELETE` [S14].
- **Blocking is the only async story for them on SDK v2.** 2026-07-28 Tasks are invisible to
  2025 clients. The spec says "MUST NOT return `CreateTaskResult` to a client that did not
  include the extension" [S30].
- **The 2025 experimental tasks can't be served** through `McpServer` v2:
  - `registerTool({ execution: { taskSupport } })` is not emitted in `tools/list`.
  - Returning `{ task: {...} }` gives `-32602 "content is required when the body carries 'task'"`
    [SPIKE].
  - The v2 docs call the task wire "importable wire vocabulary only" and say the "experimental
    tasks interception layer is removed entirely" [S15].
- Implication (analysis): serving VS Code's 2025 task flow would need SDK v1.x, or a hand-written
  JSON-RPC layer for `tools/call` + `tasks/get|result|list|cancel` on the legacy era.
- **Bun idle timeout applies to legacy blocking calls.** A 13 s blocking `tools/call` returned
  HTTP 200 with an empty SSE body after ~12 s under default `Bun.serve`. With
  `server.timeout(req, 0)` it delivered the result after ~13 s [SPIKE][S6].

## 5. Per-client Tasks negotiation today

| Client | Protocol revision it speaks to a server | How Tasks is negotiated | Tasks for Hermes `ask` | Source |
|---|---|---|---|---|
| **Claude Code** (CLI ≥ v2.1.304) | v2 runtime (TS SDK 2.0) probes HTTP/stdio servers for 2026-07-28. It falls back to the earlier handshake. `MCP_SDK_GENERATION` / `MCP_PROTOCOL_NEGOTIATION` override this. It may skip probing a stdio server for 7 days after a failed probe | Per request: `params._meta["io.modelcontextprotocol/clientCapabilities"].extensions["io.modelcontextprotocol/tasks"] = {}`. Omitted on calls that can't become tasks (subagents; VS Code extension / desktop app; `claude -p`; flags off) | **Yes** (public beta). Polls `tasks/get` at `pollIntervalMs` (2000 default, clamped 250–30000). Answers `inputRequests` via `tasks/update`, up to 16 keys. Elicitation inside tasks only in interactive terminal sessions. Sends `tasks/cancel` on stop, not on exit. A remote task resumes after `claude --resume`. Claude Code re-asks on a new connection, so ids must stay answerable across connections. A stdio server's process dies on exit | [S17] |
| **Codex CLI** | Default `Legacy`: `initialize` with `2025-06-18`. The `mcp_2026_07_28` feature (UnderDevelopment, `default_enabled: false`) switches to 2026-07-28 discovery with legacy fallback. Stdio servers can be pinned via `CODEX_MCP_PROTOCOL_VERSION=2026-07-28` | The client extension allowlist is OpenAI form/elicitation, standard-form-input and MCP Apps UI. No `io.modelcontextprotocol/tasks` | **No** | [S18][S19][S20] |
| **VS Code Copilot** | `LATEST_PROTOCOL_VERSION = "2025-11-25"` (`initialize` only) | 2025 experimental. Client advertises `tasks: {list, cancel, requests:{sampling, elicitation}}`. It sends `params.task: {}` only if the server has `capabilities.tasks.requests.tools.call` **and** the tool's `execution.taskSupport` is `required`/`optional`. Polls `tasks/get` (default 2000 ms) and uses `tasks/result` on `input_required` | **Not via SDK v2** (see §4). Claude Code's VS Code *extension* is also excluded from Claude's MCP tasks | [S21][S22][S17] |
| **Cursor** | Not documented **[UNVERIFIED]** | No Tasks listed in its protocol/extension table (Tools, Prompts, Resources, Roots, Elicitation, Apps) | **No (documented)** | [S23][S24] |

The community extension matrix lists Tasks only for Claude (web), Claude Code, MCPJam and Glean
[S24]. One related number: Cursor self-hosted workers run stdio MCP tool calls with a "fixed 60
seconds" default. From v2026.10.15 a `--mcp-tool-timeout` option changes it [S31].

## 6. Spike: what was actually run

Bun 1.3.14 (macOS arm64), `@modelcontextprotocol/server@2.4.0`, `@modelcontextprotocol/client@2.4.0`,
zod 4.6.7. The code is throwaway and not committed. The essentials:

```ts
import { createMcpHandler, McpServer, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
const TASKS = 'io.modelcontextprotocol/tasks';
const handler = createMcpHandler(({ era }) => {
  const server = new McpServer({ name: 'hermes-spike', version: '0.0.0' });
  server.server.registerCapabilities({ extensions: { [TASKS]: {} } } as never);
  server.registerTool('ask', { inputSchema: z.object({ question: z.string() }) }, async ({ question }, ctx) => {
    const declared = ctx.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY]?.extensions ?? {};
    if (era === 'modern' && TASKS in declared) { /* store; */ return { resultType: 'task', ...rec } as never; }
    return { content: [{ type: 'text', text: '…blocking answer…' }] };
  });
  for (const m of ['tasks/get', 'tasks/cancel', 'tasks/update'])
    server.server.setRequestHandler(m, { params: z.looseObject({ taskId: z.string() }), result: z.looseObject({}) }, /* … */);
  return server;
});
Bun.serve({ hostname: '127.0.0.1', port, fetch: req => handler.fetch(req) });
// stdio variant: serveStdio(factory) from '@modelcontextprotocol/server/stdio'
```

Observed with raw `curl` JSON-RPC (2026-07-28 envelope + `MCP-Protocol-Version`, `Mcp-Method`,
`Mcp-Name` headers):

| Step | Result |
|---|---|
| `server/discover` | `capabilities.extensions["io.modelcontextprotocol/tasks"]: {}` |
| `tools/call ask`, tasks declared | `{"content":[],"resultType":"task","taskId":"…","status":"working",…}` |
| `tools/call ask`, tasks **not** declared | Normal `CallToolResult`, `resultType:"complete"` |
| `tasks/get` ×2 | `working`, then `completed` with `result.content` |
| `tasks/update` | `{"resultType":"complete"}` |
| Legacy `initialize` + `tools/call` (2025-11-25) | Served (SSE response), blocking answer |
| Same over stdio (`serveStdio`) | Same discover and task results |
| 2025 experimental tasks (`params.task`, `execution.taskSupport`) | `execution` missing from `tools/list`. `{task}` result → `-32602` |
| 13 s blocking call, default `Bun.serve` | 200 + empty body at ~12 s (connection closed) |
| Same with `server.timeout(req, 0)` | Result delivered at ~13 s |

One more observation: `@modelcontextprotocol/ext-tasks` 0.2.3's `createTaskSessionFromClient`
threw on a 2026-07-28 connection without host-supplied `rawDispatch` and `v2RequestFraming`
options [SPIKE][S32]. This only matters for a Hermes-side MCP *client*.

---

## Sources

- [S1] TypeScript SDK README (`main`, v2; runs on Node.js, Bun and Deno; middleware packages): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md
- [S2] TypeScript SDK releases (server 2.4.0 / 1.32.2 on 2026-10-23): https://github.com/modelcontextprotocol/typescript-sdk/releases ; npm: https://www.npmjs.com/package/@modelcontextprotocol/server
- [S3] SDK CI `test-runtimes` matrix (Bun 1.x, Deno 2.x): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/.github/workflows/main.yml
- [S4] SDK Bun integration test (`Bun.serve` + `WebStandardStreamableHTTPServerTransport`): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/test/integration/test/server/bun.test.ts
- [S5] SDK docs, Serve with a web-standard handler: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/web-standard.md
- [S6] Bun docs, HTTP server `idleTimeout` (default 10 s, max 255) and `server.timeout(req, s)`: https://bun.com/docs/runtime/http/server
- [S7] SDK docs, Serve over stdio (`serveStdio`): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md
- [S8] PR #2599, serve `tasks/get` / `tasks/cancel` on 2026-07-28 with explicit schema (merged; in 2.3.0): https://github.com/modelcontextprotocol/typescript-sdk/pull/2599
- [S9] `@modelcontextprotocol/server` CHANGELOG (2.1.0 #2613 `Mcp-Name`; 2.3.0 #2599): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/CHANGELOG.md
- [S10] PR #2782, "feat: Tasks extension for server and client (ext/tasks subpaths)" (open, review required): https://github.com/modelcontextprotocol/typescript-sdk/pull/2782
- [S11] PR #2820, server/client extensions + middleware (merged 2026-11-18), docs: https://github.com/modelcontextprotocol/typescript-sdk/pull/2820 ; https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/advanced/extensions.md ; pending changeset: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/.changeset/server-extensions.md
- [S12] PR #2782 docs `docs/servers/tasks.md` and `examples/ext-tasks/server.ts` (at head `fb0d953`): https://github.com/modelcontextprotocol/typescript-sdk/blob/fb0d953ec7bcc30e141b70d8eaf3d52e60dfc166/docs/servers/tasks.md ; https://github.com/modelcontextprotocol/typescript-sdk/blob/fb0d953ec7bcc30e141b70d8eaf3d52e60dfc166/examples/ext-tasks/server.ts
- [S13] ext-tasks repo and TypeScript guide (`@modelcontextprotocol/ext-tasks`; requester + 2025-11-25 receiver): https://github.com/modelcontextprotocol/ext-tasks ; https://github.com/modelcontextprotocol/ext-tasks/blob/main/typescript/index.md ; npm: https://www.npmjs.com/package/@modelcontextprotocol/ext-tasks
- [S14] SDK docs, Protocol versions and Support legacy clients: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md ; https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md
- [S15] SDK docs, Supporting 2026-07-28 ("Tasks: deprecated wire vocabulary"): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md
- [S16] SDK v1.x README (2026-07-28 not planned for v1.x; experimental tasks): https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md
- [S17] Claude Code docs, MCP (client runtimes; MCP tasks; tasks for server authors): https://code.claude.com/docs/en/mcp
- [S18] Codex `rmcp-client/src/protocol_mode.rs` (Legacy = 2025-06-18; V20260728; `CODEX_MCP_PROTOCOL_VERSION`): https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/protocol_mode.rs
- [S19] Codex features (`mcp_2026_07_28`, `Stage::UnderDevelopment`, `default_enabled: false`) and config: https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs ; https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs
- [S20] Codex `codex-mcp/src/client_capabilities.rs` (client extension allowlist): https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/client_capabilities.rs
- [S21] VS Code `mcpServerRequestHandler.ts` (initialize with `LATEST_PROTOCOL_VERSION`, tasks capability, `tasks/get`/`tasks/result` polling): https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpServerRequestHandler.ts ; https://github.com/microsoft/vscode/blob/main/src/vs/platform/mcp/common/modelContextProtocol.ts
- [S22] VS Code `mcpServer.ts` (`execution.taskSupport` + `capabilities.tasks.requests.tools.call` gate): https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpServer.ts
- [S23] Cursor docs, MCP ("Protocol and extension support"): https://cursor.com/docs/mcp
- [S24] MCP Extension Support Matrix: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/extensions/client-matrix.mdx
- [S25] typescript-sdk issue #3179 (serveStdio stops checking protocol version once pinned; Bun 1.4.4 same): https://github.com/modelcontextprotocol/typescript-sdk/issues/3179
- [S26] SDK docs, Serve over HTTP: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md
- [S27] typescript-sdk issue #2844 (`createMcpHandler` is validation-free): https://github.com/modelcontextprotocol/typescript-sdk/issues/2844
- [S28] SDK docs, Authorization (`requireBearerAuth` on fetch hosts incl. Bun): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/authorization.md
- [S29] typescript-sdk closed Bun issues: https://github.com/modelcontextprotocol/typescript-sdk/issues/91 ; https://github.com/modelcontextprotocol/typescript-sdk/issues/709 ; https://github.com/modelcontextprotocol/typescript-sdk/issues/1564
- [S30] MCP Tasks extension spec, 2026-07-28: https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/2026-07-28/tasks.md (rendered: https://tasks.extensions.modelcontextprotocol.io/specification/2026-07-28/tasks)
- [S31] Cursor CLI changelog (v2026.10.15, `--mcp-tool-timeout`, "fixed 60 seconds"): https://cursor.com/docs/cli/changelog
- [S32] ext-tasks adapters guide (`rawDispatch`, `v2RequestFraming`): https://github.com/modelcontextprotocol/ext-tasks/blob/main/typescript/adapters-and-schemas.md
