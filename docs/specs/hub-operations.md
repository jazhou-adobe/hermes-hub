# Running the Hub on the Mac (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [How is the Hub run and maintained on the Mac?](https://github.com/jazhou-adobe/hermes-hub/issues/19).

- **Builds on:** the [identity](agent-identity.md) spec (discovery), [Hub Skill](hub-skill.md), [front-end stack](frontend-stack.md), [answered log](answered-log.md) and [Command Center](command-center.md).

## Install and upgrade: from a clone

```bash
git clone https://github.com/jazhou-adobe/hermes-hub && cd hermes-hub
bun install
bun link            # puts `hermes` in ~/.bun/bin
hermes migrate      # creates the database
hermes hub          # starts the Hub (manual start)
```

- **Upgrading:** `git pull`, `bun install`, `hermes migrate`, then restart `hermes hub`.
- **No packaging:** there is no compiled binary, Homebrew tap or published package in Phase 1.
- **The Command Center** is served from source by Bun's HTML import. Bun builds it on the fly, with hot reload when `NODE_ENV` is development. Nothing is embedded.
- **`hermes` needs Bun on PATH** in every agent shell, through `~/.bun/bin`. `hermes doctor` reports any client whose shell can't run `hermes`.

## Files: everything in `<clone>/.hermes/`

The folder is git-ignored. `HERMES_HOME` overrides its location.

```
<clone>/.hermes/
├── hub.db           SQLite (WAL mode)
├── config.toml      Hub-level settings (below)
├── hub.json         written at start: {url, version, pid, started_at}
├── hub.lock         held while a Hub runs on this folder
├── projects.json    projects the Hub Skill was installed into
├── logs/hub.log     JSON lines, rotated
└── backups/         SQLite snapshots
```

**Discovery.** The CLI and the shim resolve the Hub URL in this order:

1. `HERMES_HUB_URL`
2. `<hermes's own clone>/.hermes/hub.json`. The `hermes` command knows where it was linked from. This file is ignored if its pid is not running.
3. `http://127.0.0.1:4747`

Nothing lives in `~/.hermes`. An Agent whose sandbox can't read the clone falls back to `HERMES_HUB_URL` or the default port.

## Settings: `config.toml` vs the Command Center

| In `config.toml`: edited as text, reloaded when the file changes, shown read-only in Settings | Live in the Command Center: stored in the database |
|---|---|
| `port` (4747), `log_level`, limits (attachment and Round caps, flood cap, Live/Idle thresholds), backups (`keep = 7`), **Advisors** (`[[advisor]] name, command = [...], timeout_seconds`), **Auto-ask rules** (`[[auto_ask]] kind, project, label?, advisor, brief?`) | Notifications on or off, **quiet hours**, **sound**, appearance (theme, colour option), single-key shortcuts, **Forget Agent** |

- **Reloading:** the Hub watches `config.toml` and applies changes without a restart. Port and data-folder changes are the exception: they print "restart needed". An invalid file keeps the previous config and shows an error in Settings and in the log.
- **`hermes config`** prints the effective settings, with the source of each.

## Database upgrades: manual

- **Migrations** are numbered and live in the clone.
- **`hermes hub` refuses to start** while migrations are pending, and prints `run hermes migrate`.
- **`hermes migrate`** first takes a backup, then applies the pending migrations in a transaction.
- **Downgrades are refused:** an older checkout won't open a newer database, and the message names the backup taken before the migration.
- **Pending Rounds** survive restarts and upgrades. Deadlines are absolute, and overdue Locks fire at start (lifecycle).

## Backups

- **Daily:** an automatic `VACUUM INTO backups/hub-YYYY-MM-DD.db` while the Hub runs. It keeps the last **7**, set by `keep` in config.
- **Also taken** before every `hermes migrate`, and on demand with `hermes backup [path]`.
- **Restore:** stop the Hub, then `hermes restore <backup>`, which keeps a copy of the current database first.
- **Why it matters:** history is never deleted (answered log), so backups matter.

## Two Hubs

- **A second `hermes hub` on the same data folder** finds `hub.lock` held and refuses. It prints the running Hub's URL and pid, then exits with code 1.
- **With a different data folder** (another clone, or `HERMES_HOME`), the second Hub starts on the **next free port** from 4747. It writes its own `hub.json` in its own folder. Agents reach it through that clone's `hermes` or `HERMES_HUB_URL`.

## Logs

- **Terminal:** human-readable lines.
- **File:** JSON lines to `.hermes/logs/hub.log`, rotated at 10 MB with 5 files kept. The level is `info`, and `log_level` in config changes it.
- **Never logged:** Round content (titles, Questions, values, notes, Attachments). Only ids, events, callsigns, timings and errors are logged.

## Notifications (completing the Command Center spec)

- **macOS fallback:** when no Command Center tab is open, or the browser denied notifications, the Hub posts a macOS notification with `osascript` (title and callsign). Clicking it is not wired in Phase 1.
- **Quiet hours:** set in Settings, for example 19:00–08:00. They suppress all notifications, in the browser and on macOS. Rounds still arrive and show in the Feed.
- **Sound:** optional, played in the Command Center tab on a new Round. **Off** by default.

## Changes to other specs

- **Identity:** discovery now uses `<hermes's own clone>/.hermes/hub.json` instead of `~/.hermes/hub.json`.
- **Hub Skill:** `projects.json` lives in `<clone>/.hermes/`. The Skill ships inside the clone.
- **Front-end stack:** the Command Center is served from source by Bun. There are no embedded release assets in Phase 1.
- **Delegation and Command Center:** Advisors and Auto-ask rules are defined in `config.toml` and shown read-only in Settings.

## Not in Phase 1

- A compiled binary, a Homebrew tap, or a published package.
- `~/.hermes`.
- Automatic migrations.
- launchd start.
- Clicking through from macOS notifications.
