# Hermes Hub

A local human-in-the-loop Command Center. AI Agents on your Mac (Claude Code, Codex, Cursor, VS Code Copilot, omp, scripts) send **Rounds** of **Questions** to the **Hub**. One **Human** answers them all from a single **Command Center** in the browser, and each Answer flows back to the Agent that asked.

**Status: Phase 1 in progress.** All Question kinds, Locks, Drafts, dismiss/redirect, supersede, cancel, inbox, the live `events` stream (`hermes-hub watch`), the browser guard, full Agent identity (detection, callsigns, roster, Lanes, Forget), Advisors (Ask advisor, auto-ask, Suggestions), the MCP tools (the `hermes-hub mcp` stdio shim and the Hub's `/mcp`, with MCP Tasks and a bounded 50 s wait for clients without them), the Hub Skill with its project install and update (`hermes-hub skill`), `hermes-hub doctor` and `hermes-hub setup claude`, and the designed Command Center now work: the Feed (index with filters and Lock soon, keys, auto-advance, ended-in-place Rounds, toasts and browser notifications), Round detail, the answered log (full-text search, filters, Copy as Markdown and Export JSON), Agents with Lanes, and Settings (notifications, quiet hours, sound, appearance, shortcuts, read-only config.toml, storage), on the Flight Director 2169 design. With no Command Center tab open the Hub posts macOS notifications through `osascript`. The Hub also hot-reloads `config.toml`, refuses a second instance on the same data folder (`hub.lock`), takes automatic and on-demand backups (`hermes-hub backup`/`hermes-hub restore`), and writes rotating, Round-content-free JSON logs to `logs/hub.log` in its data folder.

## Run it

Needs [Bun](https://bun.sh) on PATH. The only entry point is the wrapper `bin/hermes-hub` in the clone (it runs `exec bun <clone>/src/cli/main.ts "$@"`); run it by its path. There is no global install. Below, `hermes-hub` stands for `/path/to/hermes-hub/bin/hermes-hub`.

```bash
git clone https://github.com/jazhou-adobe/hermes-hub && cd hermes-hub
bun install
```

**Shell setup (once).** Add both variables to `~/.zshenv`, which every zsh reads, including the non-interactive shells Agents and scripts start (`~/.zshrc` covers only interactive terminals):

```zsh
# ~/.zshenv
export HERMES_HUB_APP="/path/to/hermes-hub/bin"            # the wrapper's folder: friendly-grill and scripts run "$HERMES_HUB_APP/hermes-hub"
export HERMES_HUB_HOME="/path/to/hermes-hub/hermes-data"   # the Hub's data folder (git-ignored when inside the clone)
```

Then `source ~/.zshenv` in open terminals, and restart Agent sessions that were already running. With `HERMES_HUB_HOME` set, the Hub-side commands work from any folder, and Agents find the Hub's real URL in `$HERMES_HUB_HOME/hub.json` even when it had to take a port other than 4747. `hermes-hub doctor` checks `HERMES_HUB_APP`.

**Start it:**

```zsh
mkdir -p "$HERMES_HUB_HOME"
"$HERMES_HUB_APP/hermes-hub" migrate   # first time, and after each upgrade: creates hub.db
"$HERMES_HUB_APP/hermes-hub" start     # the Hub in the background: http://127.0.0.1:4747 (port: `port = …` in config.toml)
open http://127.0.0.1:4747             # the Command Center
"$HERMES_HUB_APP/hermes-hub" stop      # stops it
"$HERMES_HUB_APP/hermes-hub" hub       # or: the Hub in the foreground (Ctrl-C), for a terminal or launchd
tail -f "$HERMES_HUB_HOME/logs/hub.out"   # the background Hub's output
```

Agents and MCP clients don't need either variable to find the command: they get the wrapper's absolute path from their Skill copy or MCP registration.

`hermes-hub start` runs the Hub detached in the data folder, waits until it is serving (`hub.json` written) and prints `Hermes Hub on <url> (pid N); data in <folder>; output in <folder>/logs/hub.out`. It exits 1 with the Hub's output if the Hub exits early (for example `migrations are pending; run hermes-hub migrate`), or if a Hub already runs on that folder. `hermes-hub stop` sends SIGTERM to the Hub holding this folder's `hub.lock`, waits up to 15 s for it to exit, and exits 1 if none is running. `hermes-hub restart` stops the Hub if one runs, then starts it again.

Upgrading: `hermes-hub stop`, `git pull`, `bun install`, `hermes-hub migrate`, `hermes-hub start`.

The Hub keeps its files (`hub.db`, `config.toml`, `hub.json`, `hub.lock`, `projects.json`, `logs/`, `backups/`) directly in `$HERMES_HUB_HOME`, or in the folder where you run `hermes-hub migrate`, `start`, `stop`, `hub`, `config`, `backup` and `restore`. Run them all in the same folder, or set `HERMES_HUB_HOME` for all of them.

Agents never look in their current folder for the Hub. They use `HERMES_HUB_URL`, then `$HERMES_HUB_HOME/hub.json`, then `http://127.0.0.1:4747`, so a Hub that had to take another port needs one of those variables in the Agent's environment.

Ask from any shell; the Answer prints as one `ANSWER {…}` line when the Human sends, dismisses or redirects it:

```bash
hermes-hub ask round.json --out answer.json --supersedes <round-id>   # round.json: a hermes.round/v1 document
hermes-hub wait <round-id>
hermes-hub cancel <round-id>
hermes-hub inbox --format json
hermes-hub watch                                                      # one ANSWER line per ended Round, live
```

The Command Center lives at the Hub's URL: the Feed (`/`), Round detail (`/rounds/<id>`), the answered log (`/log`), Agents with Lanes (`/agents`) and Settings (`/settings`). Press `?` there for the key map.

### Other devices (iPad, another computer)

The Hub listens on the network (`host = "0.0.0.0"`, the default) but refuses every other device until you set a password. This Mac never needs it, so the CLI, Agents and the macOS app are unaffected.

```bash
cd <data folder>                       # or set HERMES_HUB_HOME
<clone>/bin/hermes-hub password        # asks twice; user "hermes" (or --user <name>); 12+ characters
<clone>/bin/hermes-hub restart         # prints "other devices: http://192.168.1.20:4747/, …"
```

On the iPad, open one of those addresses in Safari, sign in with the user and password, then **Share → Add to Home Screen** for a full-screen icon. The password takes effect without a restart; `hermes-hub password --remove` turns remote access off, and `host = "127.0.0.1"` in `config.toml` (then a restart) stops listening on the network. It is plain HTTP: on a shared Wi-Fi anyone watching can read the traffic, so prefer Tailscale (use the Mac's `100.x` address; MagicDNS names are refused). Details: [security spec](docs/specs/security.md).

### The macOS app (optional)

`Hermes Hub.app` is a native window around the Command Center ([spec](docs/specs/macos-app.md)). It doesn't start or stop the Hub: keep using `hermes-hub start`/`stop`/`restart`. Build it with the Xcode command line tools, then drag it to `/Applications` if you like:

```bash
macos/build.sh                        # → macos/build/Hermes Hub.app
open "macos/build/Hermes Hub.app"
```

**Hermes Hub → Hub URL… (⌘,)** sets the address (default `http://127.0.0.1:4747/`). Links to other sites open in your browser; **View → Open in Browser (⇧⌘O)** opens the current page there.

## Teach your Agents: the Hub Skill, doctor and setup

Agents learn Hermes from the **Hub Skill** ([`skill/hermes-hub/`](skill/hermes-hub/SKILL.md)), copied into each project. Codex, Cursor, VS Code Copilot and omp read it from `.agents/skills/`. Claude Code does not: it learns Hermes from the MCP tool descriptions, once `hermes-hub setup claude` has registered the shim. The installed copy names the wrapper by its absolute path (`hermes-hub skill install` fills it in), so Agents never need `hermes-hub` on PATH; if the clone moves, run `hermes-hub skill update --all`.

```bash
hermes-hub skill install [dir]          # copy it to <git root>/.agents/skills/hermes-hub, kept out of git by .git/info/exclude
hermes-hub skill install [dir] --commit # the same, without the exclude line, for committing it with the project
hermes-hub skill install --all ~/Git    # every git repository under ~/Git (it never descends into a repository)
hermes-hub skill update [--all]         # refresh this project's copy, or every recorded copy
hermes-hub setup claude                 # register `<clone>/bin/hermes-hub mcp` in Claude Code's user config, after asking you
hermes-hub doctor                       # Hub reachable? Skill installed? Shim registered? Each client's sandbox setting
```

Installed projects are recorded in the Hub's `projects.json`: directly in `$HERMES_HUB_HOME` when it is set, otherwise through the running Hub, so `hermes-hub skill install` needs either one. When the Hub starts, it refreshes every recorded **uncommitted** copy whose version differs; committed copies only get a warning, so the Hub never makes a surprise diff. `hermes-hub ask` and the other Agent commands print one `WARN` line on stderr when the project's copy is older than `hermes-hub` (`run hermes-hub skill update`) or the Hub runs another version; the command still succeeds.

A sandboxed Agent needs your one-time permission to reach `127.0.0.1:<port>`. `hermes-hub doctor` prints the exact setting for each client it finds (Claude Code, Codex, Cursor, VS Code, omp) and never edits them. Codex's `workspace-write` sandbox, for example:

```toml
# ~/.codex/config.toml
[sandbox_workspace_write]
network_access = true
```

`scripts/live-skill.sh codex|claude|omp` has a real Agent complete a Round knowing Hermes only from the Skill (Claude Code: only from the tool descriptions) against a throwaway Hub, plays the Human, and lists every `hermes-hub` command or tool call the Agent made. It needs the client logged in and is not part of `bun test`.

## MCP setup

`hermes-hub mcp` is a stdio MCP server with four tools: `hermes_ask` (submit a Round and wait for its Answer), `hermes_wait`, `hermes_cancel` and `hermes_inbox`. It proxies to the running Hub (found the same way as the CLI) and re-detects the calling Agent session on every call. Clients that declare the MCP Tasks extension get a task per Round, so a wait survives exit and resume; others wait up to 50 s per call, get `{"status":"pending","round_id":…}`, and call `hermes_wait` again. Tool errors carry the shared `code` in `structuredContent`.

Claude Code (`hermes-hub setup claude` runs this with the real path after asking; `--scope local` for one project). The tools then appear as `mcp__hermes-hub__hermes_ask` and so on. A server registered under the old name `hermes` stays until you run `claude mcp remove hermes`.

```bash
claude mcp add --scope user hermes-hub -- /path/to/hermes-hub/bin/hermes-hub mcp
```

Codex (`~/.codex/config.toml`; the default 60 s `tool_timeout_sec` is enough):

```toml
[mcp_servers.hermes-hub]
command = "/path/to/hermes-hub/bin/hermes-hub"
args = ["mcp"]
# env = { HERMES_HUB_URL = "http://127.0.0.1:4747" }   # only for a Hub on another port: Codex passes no other env
```

Clients that prefer a URL can use the Hub's Streamable HTTP endpoint, `http://127.0.0.1:4747/mcp` (loopback only). There, identity comes from `clientInfo` and per-call `_meta` alone, so all sessions of one client kind without a per-call session id share one session (`CLAUDE·mcp`); prefer the stdio shim.

`scripts/live-mcp.sh claude|codex|replay` runs a real client against a throwaway Hub in real time (Claude Code ask → exit → resume; Codex's 50 s pending and `hermes_wait`; or a replay of Codex's captured wire that needs no login). It is not part of `bun test`.

`bun test` runs the lifecycle, HTTP/guard and end-to-end checks. `bun run test:browser` drives the installed Chrome (puppeteer-core; `CHROME_PATH` overrides the macOS default) against a real Hub: focus and scroll safety, keys, reduced motion and axe-core WCAG 2.2 AA checks.

## Project

- **Architecture:** how the pieces fit, with diagrams and a worked Advisor run, in [`docs/architecture.md`](docs/architecture.md).
- **Specs:** every spec is confirmed, in [`docs/specs/`](docs/specs/README.md).
- **Vocabulary:** [`GLOSSARY.md`](GLOSSARY.md).
- **Planning record:** the [Wayfinder map](https://github.com/jazhou-adobe/hermes-hub/issues/1).
- **Build:** tracked in the milestone **Phase 1 build**.
