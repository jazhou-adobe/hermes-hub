# Running the Hub on the Mac (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [How is the Hub run and maintained on the Mac?](https://github.com/jazhou-adobe/hermes-hub/issues/19). **Amended by the Human on 2026-11-26:** the data folder is `HERMES_HUB_HOME` or the folder the Hub is started in (no `<clone>/.hermes/`), and Agent-side commands never read the current folder for it. The command is `hermes-hub`, run only through `<clone>/bin/hermes-hub` by its path (no global install, no `bun link`), with `start`/`stop` for a background Hub; Agents and MCP clients get the wrapper's absolute path.

- **Builds on:** the [identity](agent-identity.md) spec (discovery), [Hub Skill](hub-skill.md), [front-end stack](frontend-stack.md), [answered log](answered-log.md) and [Command Center](command-center.md).

## Install and upgrade: from a clone

```bash
git clone https://github.com/jazhou-adobe/hermes-hub && cd hermes-hub
bun install
cd <data folder>
<clone>/bin/hermes-hub migrate   # creates the database
<clone>/bin/hermes-hub start     # starts the Hub in the background
<clone>/bin/hermes-hub stop      # stops it
<clone>/bin/hermes-hub hub       # or: the Hub in the foreground (Ctrl-C), for a terminal or launchd
```

- **One entry point:** the wrapper `bin/hermes-hub` (`exec bun <clone>/src/cli/main.ts "$@"`), run by its path. There is no `bin` entry in `package.json` and no global install. Below, `hermes-hub <cmd>` means that wrapper.
- **`hermes-hub start`** runs the Hub detached in the data folder, waits until it is serving (`hub.json` written) and prints `Hermes Hub on <url> (pid N); data in <folder>; output in <folder>/logs/hub.out`. It exits 1 with the Hub's output if the Hub exits early (for example `migrations are pending; run hermes-hub migrate`), or if a Hub already runs on that folder.
- **`hermes-hub stop`** sends SIGTERM to the Hub holding this data folder's `hub.lock`, waits up to 15 s for it to exit, and exits 1 if none is running.
- **Upgrading:** `hermes-hub stop`, `git pull`, `bun install`, `hermes-hub migrate`, `hermes-hub start`.
- **No packaging:** there is no compiled binary, Homebrew tap or published package in Phase 1.
- **The Command Center** is served from source by Bun's HTML import. Bun builds it on the fly, with hot reload when `NODE_ENV` is development. Nothing is embedded.
- **Bun must be on PATH** in every agent shell: the wrapper execs `bun`. `hermes-hub` itself is never on PATH; Agents get its absolute path from their Skill copy and MCP registration ([Hub Skill](hub-skill.md)). `hermes-hub doctor` reports any client whose shell can't run it.
- **`HERMES_HUB_APP`** names the wrapper's folder (`<clone>/bin`), for callers outside this repo that need the command without a path written into them: friendly-grill and your own scripts run `"$HERMES_HUB_APP/hermes-hub" …`. Set it once in your shell profile (`export HERMES_HUB_APP=<clone>/bin`). The wrapper never sets it, and Agents and MCP clients don't need it (they get the absolute path). `hermes-hub doctor` reports whether it is set, and whether it points at this clone.

## Files: the Hub's data folder

The data folder is **`HERMES_HUB_HOME`** when set (a relative value counts from the folder the command starts in), otherwise **the folder where you run** `hermes-hub migrate`, `start`, `stop`, `hub`, `config`, `backup` or `restore`. Files sit directly in it; nothing goes to the clone or to `~`.

```
<data folder>/
├── hub.db           SQLite (WAL mode)
├── config.toml      Hub-level settings (below)
├── hub.json         written at start: {url, version, pid, started_at}
├── hub.lock         held while a Hub runs on this folder
├── projects.json    projects the Hub Skill was installed into
├── logs/hub.log     JSON lines, rotated
├── logs/hub.out     the Hub's terminal output under `hermes-hub start`
└── backups/         SQLite snapshots
```

Run every Hub-side command in the same folder, or set `HERMES_HUB_HOME` the same for all of them: `hermes-hub migrate` in one folder and `hermes-hub start` in another are two different Hubs.

**Discovery.** The CLI and the shim run in the Agent's project, not in the data folder, so they never look in the current folder. They resolve the Hub URL in this order:

1. `HERMES_HUB_URL`
2. `$HERMES_HUB_HOME/hub.json`, when `HERMES_HUB_HOME` is set. The file is ignored if its pid is not running.
3. `http://127.0.0.1:4747`

A Hub on another port therefore needs `HERMES_HUB_URL` or `HERMES_HUB_HOME` in the Agent's environment.

**`projects.json` from Agent-side commands.** `hermes-hub skill install|update` and `hermes-hub doctor` read `$HERMES_HUB_HOME/projects.json` directly when the variable is set. Otherwise they ask the running Hub, which keeps the file in its own folder (`GET /v1/projects`, `POST /v1/projects`, `POST /v1/projects/forget`; [transports](transports.md)). Without a reachable Hub, `hermes-hub skill install` fails before touching the project, and `hermes-hub doctor` falls back to what git says.

## Settings: `config.toml` vs the Command Center

| In `config.toml`: edited as text, reloaded when the file changes, shown read-only in Settings | Live in the Command Center: stored in the database |
|---|---|
| `port` (4747), `log_level`, limits (attachment and Round caps, flood cap, Live/Idle thresholds), backups (`keep = 7`), **Advisors** (`[[advisor]] name, command = [...], timeout_seconds`), **Auto-ask rules** (`[[auto_ask]] kind, project, label?, advisor, brief?`) | Notifications on or off, in-page toasts on or off, **quiet hours**, **sound**, appearance (theme, colour option), single-key shortcuts, **Forget Agent** |

- **Reloading:** the Hub watches `config.toml` and applies changes without a restart. Port and data-folder changes are the exception: they print "restart needed". An invalid file keeps the previous config and shows an error in Settings and in the log.
- **`hermes-hub config`** prints the effective settings, with the source of each.

## Database upgrades: manual

- **Migrations** are numbered and live in the clone.
- **The Hub refuses to start** (`hermes-hub hub` or `start`) while migrations are pending, and prints `run hermes-hub migrate`.
- **`hermes-hub migrate`** first takes a backup, then applies the pending migrations in a transaction.
- **Downgrades are refused:** an older checkout won't open a newer database, and the message names the backup taken before the migration.
- **Pending Rounds** survive restarts and upgrades. Deadlines are absolute, and overdue Locks fire at start (lifecycle).

## Backups

- **Daily:** an automatic `VACUUM INTO backups/hub-YYYY-MM-DD.db` while the Hub runs. It keeps the last **7**, set by `keep` in config.
- **Also taken** before every `hermes-hub migrate`, and on demand with `hermes-hub backup [path]`.
- **Restore:** stop the Hub (`hermes-hub stop`), then `hermes-hub restore <backup>`, which keeps a copy of the current database first.
- **Why it matters:** history is never deleted (answered log), so backups matter.

## Two Hubs

- **A second Hub on the same data folder** finds `hub.lock` held and refuses: `hermes-hub hub` prints the running Hub's URL and pid, then exits with code 1; `hermes-hub start` exits 1 too.
- **With a different data folder** (another folder, or another `HERMES_HUB_HOME`), the second Hub starts on the **next free port** from 4747. It writes its own `hub.json` in its own folder. Agents reach it through `HERMES_HUB_URL`, or `HERMES_HUB_HOME` pointing at that folder.

## Logs

- **Terminal:** human-readable lines.
- **File:** JSON lines to `logs/hub.log` in the data folder, rotated at 10 MB with 5 files kept. The level is `info`, and `log_level` in config changes it.
- **Never logged:** Round content (titles, Questions, values, notes, Attachments). Only ids, events, callsigns, timings and errors are logged.

## Notifications (completing the Command Center spec)

- **macOS fallback:** when no Command Center tab is open, or the browser denied notifications, the Hub posts a macOS notification with `osascript` (title and callsign). Clicking it is not wired in Phase 1.
- **Quiet hours:** set in Settings, for example 19:00–08:00. They suppress all notifications, in the browser and on macOS. Rounds still arrive and show in the Feed.
- **Sound:** optional, played in the Command Center tab on a new Round. **Off** by default.

## Changes to other specs

- **Identity:** discovery uses `$HERMES_HUB_HOME/hub.json` (when set) instead of `~/.hermes/hub.json`.
- **Hub Skill:** `projects.json` lives in the Hub's data folder; Agent-side commands reach it through `HERMES_HUB_HOME` or the running Hub. The Skill ships inside the clone.
- **Front-end stack:** the Command Center is served from source by Bun. There are no embedded release assets in Phase 1.
- **Delegation and Command Center:** Advisors and Auto-ask rules are defined in `config.toml` and shown read-only in Settings.

## Not in Phase 1

- A compiled binary, a Homebrew tap, or a published package.
- `~/.hermes`.
- Automatic migrations.
- launchd start.
- Clicking through from macOS notifications.
