# Hermes Hub

A local human-in-the-loop Command Center. AI Agents on your Mac (Claude Code, Codex, Cursor, VS Code Copilot, omp, scripts) send **Rounds** of **Questions** to the **Hub**. One **Human** answers them all from a single **Command Center** in the browser, and each Answer flows back to the Agent that asked.

**Status: Phase 1 in progress.** The walking skeleton works: single-choice Rounds from the CLI, answered in a bare Command Center page.

## Run it

Needs [Bun](https://bun.sh) on PATH.

```bash
bun install
bun link            # puts `hermes` in ~/.bun/bin
hermes migrate      # creates .hermes/hub.db
hermes hub          # http://127.0.0.1:4747 (port: `port = …` in .hermes/config.toml)
```

Ask from any shell; the Answer prints as one `ANSWER {…}` line when the Human sends it:

```bash
hermes ask round.json --out answer.json    # round.json: a hermes.round/v1 document
```

`bun test` runs the end-to-end check.

## Project

- **Specs:** every spec is confirmed, in [`docs/specs/`](docs/specs/README.md).
- **Vocabulary:** [`GLOSSARY.md`](GLOSSARY.md).
- **Planning record:** the [Wayfinder map](https://github.com/jazhou-adobe/hermes-hub/issues/1).
- **Build:** tracked in the milestone **Phase 1 build**.
