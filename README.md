# Hermes Hub

A local human-in-the-loop Command Center. AI Agents on your Mac (Claude Code, Codex, Cursor, VS Code Copilot, omp, scripts) send **Rounds** of **Questions** to the **Hub**. One **Human** answers them all from a single **Command Center** in the browser, and each Answer flows back to the Agent that asked.

**Status: Phase 1 in progress.** All Question kinds, Locks, Drafts, dismiss/redirect, supersede, cancel, inbox, the live `events` stream (`hermes watch`), the browser guard, full Agent identity (detection, callsigns, roster, Lanes, Forget), Advisors (Ask advisor, auto-ask, Suggestions), the MCP tools (the `hermes mcp` stdio shim and the Hub's `/mcp`, with MCP Tasks and a bounded 50 s wait for clients without them), the Hub Skill with its project install and update (`hermes skill`), `hermes doctor` and `hermes setup claude`, and the designed Command Center now work: the Feed (index with filters and Lock soon, keys, auto-advance, ended-in-place Rounds, toasts and browser notifications), Round detail, the answered log (full-text search, filters, Copy as Markdown and Export JSON), Agents with Lanes, and Settings (notifications, quiet hours, sound, appearance, shortcuts, read-only config.toml, storage), on the Flight Director 2169 design. With no Command Center tab open the Hub posts macOS notifications through `osascript`. The Hub also hot-reloads `config.toml`, refuses a second instance on the same data folder (`hub.lock`), takes automatic and on-demand backups (`hermes backup`/`hermes restore`), and writes rotating, Round-content-free JSON logs to `.hermes/logs/hub.log`.

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

## Teach your Agents: the Hub Skill, doctor and setup

Agents learn Hermes from the **Hub Skill** ([`skill/hermes-hub/`](skill/hermes-hub/SKILL.md)), copied into each project. Codex, Cursor, VS Code Copilot and omp read it from `.agents/skills/`. Claude Code does not: it learns Hermes from the MCP tool descriptions, once `hermes setup claude` has registered the shim.

```bash
hermes skill install [dir]          # copy it to <git root>/.agents/skills/hermes-hub, kept out of git by .git/info/exclude
hermes skill install [dir] --commit # the same, without the exclude line, for committing it with the project
hermes skill install --all ~/Git    # every git repository under ~/Git (it never descends into a repository)
hermes skill update [--all]         # refresh this project's copy, or every recorded copy
hermes setup claude                 # register `hermes mcp` in Claude Code's user config, after asking you
hermes doctor                       # Hub reachable? Skill installed? Shim registered? Each client's sandbox setting
```

Installed projects are recorded in `.hermes/projects.json`. When `hermes hub` starts, it refreshes every recorded **uncommitted** copy whose version differs; committed copies only get a warning, so the Hub never makes a surprise diff. `hermes ask` and the other Agent commands print one `WARN` line on stderr when the project's copy is older than `hermes` (`run hermes skill update`) or the Hub runs another version; the command still succeeds.

A sandboxed Agent needs your one-time permission to reach `127.0.0.1:<port>`. `hermes doctor` prints the exact setting for each client it finds (Claude Code, Codex, Cursor, VS Code, omp) and never edits them. Codex's `workspace-write` sandbox, for example:

```toml
# ~/.codex/config.toml
[sandbox_workspace_write]
network_access = true
```

`scripts/live-skill.sh codex|claude|omp` has a real Agent complete a Round knowing Hermes only from the Skill (Claude Code: only from the tool descriptions) against a throwaway Hub, plays the Human, and lists every `hermes` command or tool call the Agent made. It needs the client logged in and is not part of `bun test`.

## MCP setup

`hermes mcp` is a stdio MCP server with four tools: `hermes_ask` (submit a Round and wait for its Answer), `hermes_wait`, `hermes_cancel` and `hermes_inbox`. It proxies to the running Hub (found the same way as the CLI) and re-detects the calling Agent session on every call. Clients that declare the MCP Tasks extension get a task per Round, so a wait survives exit and resume; others wait up to 50 s per call, get `{"status":"pending","round_id":…}`, and call `hermes_wait` again. Tool errors carry the shared `code` in `structuredContent`.

Claude Code (`hermes setup claude` runs this after asking; `--scope local` for one project):

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
