# Hub Skill: distribution, versioning and content (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [How does the Hub Skill reach Agents and stay in step with the Hub?](https://github.com/jazhou-adobe/hermes-hub/issues/13). It builds on every other spec in [`docs/specs/`](README.md). Terms follow `GLOSSARY.md`.

**Amended by the Human on 2026-11-26:** the command is `hermes-hub`, run through the wrapper `<clone>/bin/hermes-hub` ([operations](hub-operations.md)). The Skill source writes it as the placeholder `{{hermes-hub}}`, rendered to the wrapper's absolute path at install and update; `setup claude` registers the MCP server as `hermes-hub` with the same path.

## Packaging and version

- The **Hub Skill** ships inside the clone as `skill/hermes-hub/`. The Skill, the CLI, the shim and the Hub share **one version**.
- `SKILL.md` frontmatter: `name: hermes-hub` (it must equal the folder name), a `description`, and `metadata.version: <hermes-hub version>`.
- **Runtime checks** print one stderr line each and never fail a command:
  - `hermes-hub` compares its own version with `GET /v1/hub` and warns on a mismatch.
  - `hermes-hub` reads the Skill copy at `<git root>/.agents/skills/hermes-hub/SKILL.md`, if present, and warns when it is older: `WARN hermes-hub skill 1.2.0 < 1.3.0 · run hermes-hub skill update`.
- The Skill **never hard-codes** the port or limits. It tells Agents to use `hermes-hub`, which discovers the Hub ([identity spec](agent-identity.md)), or `GET /v1/hub` for limits. The wrapper's path is not a port: it is filled in per copy (below), so the rule still holds.
- **The command by absolute path.** The Skill source (`skill/hermes-hub/*.md`) writes the command as the placeholder `{{hermes-hub}}`. `hermes-hub skill install` and `update` copy the files and replace it with the wrapper's absolute path (`<clone>/bin/hermes-hub`, shell-quoted only if it has special characters), so Agents never need `hermes-hub` on PATH. If the clone moves, run `hermes-hub skill update --all`.

## Distribution: project copies

| Command | Does |
|---|---|
| `hermes-hub skill install [dir] [--commit]` | Copies the Skill to `<git root>/.agents/skills/hermes-hub/`, rendering `{{hermes-hub}}` to the wrapper's absolute path. Unless `--commit` is given, it adds that path to `.git/info/exclude`. It records the project, and whether it is committed, in the Hub's `projects.json`: directly in `$HERMES_HUB_HOME` when set, otherwise through the running Hub, recording first so nothing lands in the project when no Hub is reachable ([operations](hub-operations.md)). |
| `hermes-hub skill install --all <folder>` | Does the same for every git repository under `<folder>`, without descending into a repository. |
| `hermes-hub skill update [--all]` | Refreshes the copy in the current project, or every recorded copy, with the current absolute path. |
| Hub start (`hermes-hub start` or `hub`) | Refreshes every recorded **uncommitted** copy whose version differs. Committed copies only get the CLI warning, so the Hub never creates surprise diffs. |

**Who reads it.** `.agents/skills/` is read by **Codex, Cursor, VS Code Copilot and omp**. **Claude Code does not read it.** Claude Code learns Hermes from the **MCP tool descriptions** of the `hermes-hub mcp` shim once `hermes-hub setup claude` has registered it. Without that registration, Claude Code Agents don't know Hermes exists.

## Setup and diagnostics

- **`hermes-hub setup claude`** registers the stdio shim in Claude Code's user-scope MCP config, after asking the Human. The exact `claude mcp add` invocation is verified at implementation.
- **`hermes-hub doctor`** prints, for each installed client it detects (`claude`, `codex`, `cursor-agent` and the Cursor app, `code`, `omp`):
  - whether the Hub is reachable from a plain shell;
  - whether the Skill is installed in the current project, and its version;
  - whether Claude Code has the shim registered;
  - the **exact sandbox snippet** needed to allow `127.0.0.1:<port>`:
    - Codex: `[sandbox_workspace_write] network_access = true`, or run `hermes-hub` outside the sandbox.
    - Cursor: `sandbox.json` `networkPolicy.allow: ["127.0.0.1/32"]`.
    - Claude Code: `sandbox.network.allowLocalBinding` or `allowedDomains: ["127.0.0.1:PORT"]`, or `excludedCommands: ["<clone>/bin/hermes-hub *"]`.
    - VS Code: `chat.agent.sandbox.network.allowLocalNetwork: true`.
- **No edits to sandbox settings,** ever. The Human applies them.
- **Pinned at implementation ([S9](https://github.com/jazhou-adobe/hermes-hub/issues/31)):**
  - `hermes-hub setup claude` checks `claude mcp get hermes-hub` first (exit 1: no such server), shows the command, asks `[y/N]` on stdin, and then runs `claude mcp add --scope user hermes-hub -- <clone>/bin/hermes-hub mcp` (first verified on Claude Code 2.1.231: it writes `mcpServers.<name>` to `~/.claude.json`). Tool ids become `mcp__hermes-hub__hermes_ask` and so on. A server registered earlier under the name `hermes` is left alone; the Human removes it with `claude mcp remove hermes`. There is no flag that skips the question.
  - Claude Code's `excludedCommands` entries are permission-rule patterns, where a bare command matches only that command with no arguments, so the snippet is `excludedCommands: ["<clone>/bin/hermes-hub *"]`, with the wrapper's absolute path. The doctor's Shell line prints `hermes-hub: <clone>/bin/hermes-hub (Agents and MCP clients run it by this path)`. The doctor also notes that the shim, an MCP server, already runs outside Claude Code's sandbox.
  - Inside Codex's sandbox (`CODEX_SANDBOX` set, `CODEX_SANDBOX_NETWORK_DISABLED=1`), the doctor says so above the Codex snippet. That sandbox also forbids spawning `ps`, so identity detection there works without the process ancestry.
  - `.git/info/exclude` gets `/.agents/skills/hermes-hub/` (resolved with `git rev-parse --git-path`, so linked worktrees share it); `--commit` removes that line again. `projects.json` is `{"projects": [{"root", "committed"}]}`; `update --all` forgets a record whose copy is gone.
  - The `hub_unavailable` message asks the Agent to have the Human run `hermes-hub start` and `hermes-hub doctor`.

## Which door the Skill teaches

- **CLI by default.** `hermes-hub ask` runs as a background job; waiting costs the Agent nothing until the job finishes.
- **Claude Code uses the MCP tools** (`hermes_ask` and friends) through the shim, with MCP Tasks, so a wait survives exit and `--resume`. Its tool descriptions carry the essentials below in condensed form.
- **MCP on other clients** is not taught: each 50 s re-call would cost a model turn.

## SKILL.md outline

1. **When to ask:** a decision the Agent cannot or should not make alone. Never for facts the Agent can look up. Batch related decisions into one Round.
2. **Writing a Round:**
   - `title`, `context`;
   - the Question kinds;
   - stable ids;
   - always give a Recommended option;
   - choosing an Unanswered Policy (when `apply_recommended` or `cancel` is safe, and when to use `wait`);
   - Proposals for approve/reject;
   - Attachments and limits (pointing to `GET /v1/hub`).
3. **Asking and waiting:**
   - **Default:** `hermes-hub ask round.json --label <label> --out answer.json` as a background job. Do nothing else on that decision until it finishes, and **never poll**.
   - **Async**, only when there is independent work: `--no-wait`, keep the Round id, then later `hermes-hub wait <id>` or `hermes-hub inbox`.
   - **Changing a Round:** `--supersedes <id>`, never resubmit.
   - **After resuming a session**, or whenever unsure whether Answers arrived while away: run `hermes-hub inbox` once (Claude Code: `hermes_inbox`). The Hub keeps undelivered Answers in the Inbox; this rule replaces Claude Code hooks, following friendly-grill's no-hooks pattern.
4. **Per-client recipes:** Codex (background terminal), Cursor, omp (async bash), VS Code. Claude Code is covered by its MCP tool descriptions.
5. **Reading the Answer:**
   - `outcome` (answered, dismissed, redirected → follow `message`, expired, cancelled → `cancelled_by` / `superseded_by`);
   - `set_by`;
   - `suggested_by`;
   - notes;
   - edited Proposals.
6. **Errors:**
   - exit codes 2–5 and their `code`s;
   - `hub_unavailable` → tell the Human to run `hermes-hub start` and `hermes-hub doctor`;
   - `flood_cap` → wait for an existing Answer first.
7. **Identity:** pass `--label` (or `HERMES_LABEL`); `HERMES_HUB_URL` for a non-default port.
8. **Rules:**
   - Never ask when `HERMES_ADVISOR` is set.
   - Use only the documented `hermes-hub` commands and MCP tools. **The Skill never mentions the Command Center's own endpoints** (the accepted limit in the [security spec](security.md)).

## Not in Phase 1

- A user-level install (`~/.agents/skills`, `~/.claude/skills`).
- Serving the Skill from the Hub.
- A project copy for Claude Code (`.claude/skills`).
- Registering the shim in clients other than Claude Code.
- Automatic sandbox edits.
- Claude Code hooks (`SessionStart`, `UserPromptSubmit`, `asyncRewake`, `Stop`). Dropped in favour of background jobs, MCP Tasks and the resume rule above. See [Which Claude Code hooks deliver answered Rounds, and how?](https://github.com/jazhou-adobe/hermes-hub/issues/16).
