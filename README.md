# Hermes Hub

A local human-in-the-loop Command Center. AI Agents on your Mac (Claude Code, Codex, Cursor, VS Code Copilot, omp, scripts) send **Rounds** of **Questions** to the **Hub**. One **Human** answers them all from a single **Command Center** in the browser, and each Answer flows back to the Agent that asked.

**Status: Phase 1 in progress.** All Question kinds, Locks, Drafts, dismiss/redirect, supersede, cancel, inbox, the live `events` stream (`hermes watch`), the browser guard, full Agent identity (detection, callsigns, roster, Lanes, Forget), Advisors (Ask advisor, auto-ask, Suggestions), the MCP tools (the `hermes mcp` stdio shim and the Hub's `/mcp`, with MCP Tasks and a bounded 50 s wait for clients without them), and the designed Command Center now work: the Feed (index with filters and Lock soon, keys, auto-advance, ended-in-place Rounds, toasts and browser notifications), Round detail, the answered log (full-text search, filters, Copy as Markdown and Export JSON), Agents with Lanes, and Settings (notifications, quiet hours, sound, appearance, shortcuts, read-only config.toml, storage), on the Flight Director 2169 design. With no Command Center tab open the Hub posts macOS notifications through `osascript`. The Hub also hot-reloads `config.toml`, refuses a second instance on the same data folder (`hub.lock`), takes automatic and on-demand backups (`hermes backup`/`hermes restore`), and writes rotating, Round-content-free JSON logs to `.hermes/logs/hub.log`.

## Run it

Needs [Bun](https://bun.sh) on PATH.

```bash
bun install
bun link            # puts `hermes` in ~/.bun/bin
hermes migrate      # creates .hermes/hub.db
hermes hub          # http://127.0.0.1:4747 (port: `port = …` in .hermes/config.toml)
```

Ask from any shell; the Answer prints as one `ANSWER {…}` line when the Human sends, dismisses or redirects it:

```bash
hermes ask round.json --out answer.json --supersedes <round-id>   # round.json: a hermes.round/v1 document
hermes wait <round-id>
hermes cancel <round-id>
hermes inbox --format json
hermes watch                                                      # one ANSWER line per ended Round, live
```

The Command Center lives at the Hub's URL: the Feed (`/`), Round detail (`/rounds/<id>`), the answered log (`/log`), Agents with Lanes (`/agents`) and Settings (`/settings`). Press `?` there for the key map.

## MCP setup

`hermes mcp` is a stdio MCP server with four tools: `hermes_ask` (submit a Round and wait for its Answer), `hermes_wait`, `hermes_cancel` and `hermes_inbox`. It proxies to the running Hub (found the same way as the CLI) and re-detects the calling Agent session on every call. Clients that declare the MCP Tasks extension get a task per Round, so a wait survives exit and resume; others wait up to 50 s per call, get `{"status":"pending","round_id":…}`, and call `hermes_wait` again. Tool errors carry the shared `code` in `structuredContent`.

Claude Code (user scope; `--scope local` for one project):

```bash
claude mcp add --scope user hermes -- hermes mcp
```

Codex (`~/.codex/config.toml`; the default 60 s `tool_timeout_sec` is enough):

```toml
[mcp_servers.hermes]
command = "hermes"
args = ["mcp"]
# env = { HERMES_HUB_URL = "http://127.0.0.1:4747" }   # only for a Hub on another port: Codex passes no other env
```

Clients that prefer a URL can use the Hub's Streamable HTTP endpoint, `http://127.0.0.1:4747/mcp` (loopback only). There, identity comes from `clientInfo` and per-call `_meta` alone, so all sessions of one client kind without a per-call session id share one session (`CLAUDE·mcp`); prefer the stdio shim.

`scripts/live-mcp.sh claude|codex|replay` runs a real client against a throwaway Hub in real time (Claude Code ask → exit → resume; Codex's 50 s pending and `hermes_wait`; or a replay of Codex's captured wire that needs no login). It is not part of `bun test`.

`bun test` runs the lifecycle, HTTP/guard and end-to-end checks. `bun run test:browser` drives the installed Chrome (puppeteer-core; `CHROME_PATH` overrides the macOS default) against a real Hub: focus and scroll safety, keys, reduced motion and axe-core WCAG 2.2 AA checks.

## Project

- **Specs:** every spec is confirmed, in [`docs/specs/`](docs/specs/README.md).
- **Vocabulary:** [`GLOSSARY.md`](GLOSSARY.md).
- **Planning record:** the [Wayfinder map](https://github.com/jazhou-adobe/hermes-hub/issues/1).
- **Build:** tracked in the milestone **Phase 1 build**.
