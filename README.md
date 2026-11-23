# Hermes Hub

A local human-in-the-loop Command Center. AI Agents on your Mac (Claude Code, Codex, Cursor, VS Code Copilot, omp, scripts) send **Rounds** of **Questions** to the **Hub**. One **Human** answers them all from a single **Command Center** in the browser, and each Answer flows back to the Agent that asked.

**Status: Phase 1 in progress.** All Question kinds, Locks, Drafts, dismiss/redirect, supersede, cancel, inbox, the live `events` stream (`hermes watch`), the browser guard, full Agent identity (detection, callsigns, roster, Lanes, Forget), Advisors (Ask advisor, auto-ask, Suggestions), and the designed Command Center now work: the Feed (index with filters and Lock soon, keys, auto-advance, ended-in-place Rounds, toasts and browser notifications), Round detail, the answered log (full-text search, filters, Copy as Markdown and Export JSON), Agents with Lanes, and Settings (notifications, quiet hours, sound, appearance, shortcuts, read-only config.toml, storage), on the Flight Director 2169 design. With no Command Center tab open the Hub posts macOS notifications through `osascript`. The Hub also hot-reloads `config.toml`, refuses a second instance on the same data folder (`hub.lock`), takes automatic and on-demand backups (`hermes backup`/`hermes restore`), and writes rotating, Round-content-free JSON logs to `.hermes/logs/hub.log`.

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

`bun test` runs the lifecycle, HTTP/guard and end-to-end checks. `bun run test:browser` drives the installed Chrome (puppeteer-core; `CHROME_PATH` overrides the macOS default) against a real Hub: focus and scroll safety, keys, reduced motion and axe-core WCAG 2.2 AA checks.

## Project

- **Specs:** every spec is confirmed, in [`docs/specs/`](docs/specs/README.md).
- **Vocabulary:** [`GLOSSARY.md`](GLOSSARY.md).
- **Planning record:** the [Wayfinder map](https://github.com/jazhou-adobe/hermes-hub/issues/1).
- **Build:** tracked in the milestone **Phase 1 build**.
