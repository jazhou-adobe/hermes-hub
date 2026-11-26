# Agent identity and Hub discovery (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [How are Agents identified, labelled and grouped, and how do they find the Hub?](https://github.com/jazhou-adobe/hermes-hub/issues/10).

- **Builds on:** the [transports](transports.md), [security](security.md), [lifecycle](round-lifecycle.md) and [delegation](delegation.md) specs.
- **Evidence:** [agent-detection-signals.md](https://github.com/jazhou-adobe/hermes-hub/blob/research/agent-detection-signals/docs/research/agent-detection-signals.md).
- **Terms:** `GLOSSARY.md`.

Nothing here is a security control. Identity is for grouping and display only.

## Agent session

An **Agent session** is one conversation of one Agent, keyed by **(kind, session key)**.

- **The session key** is the client's own session id when one is detected.
- **Otherwise it is a fallback key:**
  - **Anchor:** the nearest long-lived ancestor process, found by walking the parent chain and skipping shells (`sh`, `bash`, `zsh`, `fish`, `dash`).
  - **Key:** a hash of the anchor's pid, the anchor's start time (so a reused pid is a different session) and the cwd.
  - **Lifetime:** it lasts as long as that anchor process.
  - **Override:** `--session` or `HERMES_SESSION_ID` replaces it.
- **Per-session scope:** Live / Idle / Gone, the 10-pending flood cap, the Inbox, the events stream, `idempotency_key` and `supersedes` (lifecycle, transports).
- **Resume keeps the session.** The same (kind, session key) always maps to the **same** Hub session and session token, so a resumed process (for example `claude --resume <id>`) sees its earlier Answers in its Inbox.

## Detection (first hit wins, per field)

| Step | Source | Gives |
|---|---|---|
| 1 | Explicit: `--label`, `--kind`, `--session` flags, then `HERMES_LABEL`, `HERMES_AGENT_KIND`, `HERMES_SESSION_ID` | any field |
| 2 | Per-call MCP `_meta` (shim only): `threadId` / `sessionId` → `codex`; `vscode.conversationId` → `vscode-copilot` | kind, session id |
| 3 | Client variables, collision-safe order: **omp** (`PI_SESSION_ID`, `OMPCODE`) → **Codex** (`CODEX_THREAD_ID`) → **Cursor** (`CURSOR_CONVERSATION_ID`, `CURSOR_AGENT`; CLI vs IDE by ancestry) → **Claude Code** (`CLAUDE_CODE_SESSION_ID`) → **VS Code Copilot** (`COPILOT_AGENT`, `AI_AGENT=github_copilot_vscode_agent`; no session id). If several match, the vendor whose process is the **nearest ancestor** wins (`CLAUDE_PID` and `PI_TERMINAL_OWNER_PID` are anchors). | kind, session id |
| 4 | MCP `clientInfo.name` (shim and `/mcp`): `claude-code`, `codex-mcp-client`, `Cursor`, `cursor-vscode`, `Visual Studio Code`, `omp-coding-agent` | kind |
| 5 | Generic markers: `AI_AGENT` prefix, `CLAUDECODE=1` without a session id, `AGENT=1` | kind, or `unknown` |
| 6 | Nothing matched | kind `script` |

- **Kinds:** `claude-code`, `codex`, `cursor-cli`, `cursor-ide`, `vscode-copilot`, `omp`, `script`, `unknown`.
- **Working directory and git** are always auto-detected: the cwd, the git root, branch, HEAD and the `origin` remote.
- **The stdio shim** re-detects on **every tool call**:
  - Codex and VS Code: from the call's `_meta`.
  - Claude Code: from its environment. The id is fixed when the shim starts, so a `/clear` keeps the old session; this is accepted.
- **The Hub's own `/mcp`:** identity comes only from `clientInfo` and `_meta`. Without per-call session metadata, every client of that kind on `/mcp` shares one session (for example `CLAUDE·mcp`). The Hub Skill recommends the stdio shim.
- **Advisor runs:** when `HERMES_ADVISOR` is set, `POST /v1/sessions` is refused with `advisor_cannot_ask`.

## `POST /v1/sessions`

The CLI calls it **on every run**; it is idempotent on (kind, session key). There is **no token cache on disk**. The shim and `hermes-hub watch` keep the token in memory.

```json
{
  "kind": "claude-code",
  "session_key": "6f1c2e0a-…",
  "label": "api-refactor",
  "cwd": "/Users/jazhou/Git/api",
  "git": { "root": "/Users/jazhou/Git/api", "branch": "feat/billing", "head": "a1b2c3d4", "remote": "git@github.com:example/api.git" },
  "host": "studio-mac",
  "client_version": "2.1.231",
  "detection": { "step": 3, "source": "CLAUDE_CODE_SESSION_ID", "documented": true },
  "signals": { "env": { "CLAUDECODE": "1", "CLAUDE_CODE_SESSION_ID": "6f1c…" }, "ancestry": ["claude(4121)", "zsh(5210)"], "client_info": null, "meta_keys": [] }
}
```

- **Response:** `{session_id: "s_…", token: "hhs_…", callsign: "CLAUDE·api-refactor"}`.
- **Re-posting** updates `last_seen`, and the label, cwd and git (latest wins).
- **`signals` are stored raw**, so detection rules can be re-run when vendors change their variables.
- **Resume handle**, derived from the kind and session id:
  - Claude Code: `claude --resume <id>`
  - Codex: `codex resume <id>`
  - Cursor CLI: `cursor-agent --resume <id>`
  - omp: `omp --resume <id>`
  - Other kinds have none.

## Callsign

The callsign is **`KIND·label`**, where KIND is `CLAUDE`, `CODEX`, `CURSOR`, `COPILOT`, `OMP`, `SCRIPT` or `AGENT` (for unknown).

- **The label** is, in order of preference:
  1. the declared label;
  2. the last segment of the cwd;
  3. the first 6 characters of the session key.
- **Clashes:** if two Live or Idle sessions would show the same callsign, each gets a 4-character session suffix (`CLAUDE·api·3f9a`), and only then.
- **Colour:** `agent-1…6` is picked by a stable hash of the Hub session id. The callsign text is always shown, never colour alone.
- **Declared vs detected:** the declared label is display text only. The detected kind and session are shown beside it in the Detection tab, which also shows the source signal and whether it is documented. A disagreement between a declared `--kind` and the detected signals is flagged there.

## Grouping in the Command Center

- **The triage bay** stays in arrival order, with filter chips by callsign and by project (git root).
- **The Agent roster** lists sessions. **Forget** hides a session until it next calls `POST /v1/sessions`.

## Auto-ask rule key (delegation)

A rule matches on **kind + project**, where the project is the git root, or the cwd when there is no git. A **label** can optionally narrow the match. Rules therefore survive new sessions and label changes. Advisors run in the session's latest cwd.

## Hub discovery (local only)

The CLI and the shim resolve the Hub URL in this order:

1. `HERMES_HUB_URL`
2. `$HERMES_HUB_HOME/hub.json`, when `HERMES_HUB_HOME` is set; the Hub (`hermes-hub hub` or `start`) writes it at start as `{url, version, pid, started_at}`. The file is ignored if that pid is no longer running. The current folder is never consulted: Agents run in their own projects ([operations](hub-operations.md); there is no `~/.hermes`).
3. The default, `http://127.0.0.1:4747`. The port is set in `config.toml`.

Where a sandbox blocks reading `HERMES_HUB_HOME`, `HERMES_HUB_URL` or the default applies.

## Changes to other specs

- **Schema:** the optional `agent` block is **removed** from the Round. Identity lives on the session only.
- **Transports:** the session header and discovery are settled here.
- **Lifecycle:** "Agent session" is defined here.
