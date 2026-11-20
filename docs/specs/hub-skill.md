# Hub Skill: distribution, versioning and content (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [How does the Hub Skill reach Agents and stay in step with the Hub?](https://github.com/jazhou-adobe/hermes-hub/issues/13). It builds on every other spec in [`docs/specs/`](README.md). Terms follow `GLOSSARY.md`.

## Packaging and version

- The **Hub Skill** ships inside the `hermes` package as `skill/hermes-hub/`. The Skill, the CLI, the shim and the Hub share **one version**.
- `SKILL.md` frontmatter: `name: hermes-hub` (it must equal the folder name), a `description`, and `metadata.version: <hermes version>`.
- **Runtime checks** print one stderr line each and never fail a command:
  - `hermes` compares its own version with `GET /v1/hub` and warns on a mismatch.
  - `hermes` reads the Skill copy at `<git root>/.agents/skills/hermes-hub/SKILL.md`, if present, and warns when it is older: `WARN hermes-hub skill 1.2.0 < 1.3.0 · run hermes skill update`.
- The Skill **never hard-codes** the port or limits. It tells Agents to use `hermes`, which discovers the Hub ([identity spec](agent-identity.md)), or `GET /v1/hub` for limits.

## Distribution: project copies

| Command | Does |
|---|---|
| `hermes skill install [dir] [--commit]` | Copies the Skill to `<git root>/.agents/skills/hermes-hub/`. Unless `--commit` is given, it adds that path to `.git/info/exclude`. It records the project, and whether it is committed, in `<clone>/.hermes/projects.json` ([operations](hub-operations.md)). |
| `hermes skill install --all <folder>` | Does the same for every git repository under `<folder>`, without descending into a repository. |
| `hermes skill update [--all]` | Refreshes the copy in the current project, or every recorded copy. |
| `hermes hub` (at start) | Refreshes every recorded **uncommitted** copy whose version differs. Committed copies only get the CLI warning, so the Hub never creates surprise diffs. |

**Who reads it.** `.agents/skills/` is read by **Codex, Cursor, VS Code Copilot and omp**. **Claude Code does not read it.** Claude Code learns Hermes from the **MCP tool descriptions** of the `hermes mcp` shim once `hermes setup claude` has registered it. Without that registration, Claude Code Agents don't know Hermes exists.

## Setup and diagnostics

- **`hermes setup claude`** registers the stdio shim in Claude Code's user-scope MCP config, after asking the Human. The exact `claude mcp add` invocation is verified at implementation.
- **`hermes doctor`** prints, for each installed client it detects (`claude`, `codex`, `cursor-agent` and the Cursor app, `code`, `omp`):
  - whether the Hub is reachable from a plain shell;
  - whether the Skill is installed in the current project, and its version;
  - whether Claude Code has the shim registered;
  - the **exact sandbox snippet** needed to allow `127.0.0.1:<port>`:
    - Codex: `[sandbox_workspace_write] network_access = true`, or run `hermes` outside the sandbox.
    - Cursor: `sandbox.json` `networkPolicy.allow: ["127.0.0.1/32"]`.
    - Claude Code: `sandbox.network.allowLocalBinding` or `allowedDomains: ["127.0.0.1:PORT"]`, or `excludedCommands: ["hermes"]`.
    - VS Code: `chat.agent.sandbox.network.allowLocalNetwork: true`.
- **No edits to sandbox settings,** ever. The Human applies them.

## Which door the Skill teaches

- **CLI by default.** `hermes ask` runs as a background job; waiting costs the Agent nothing until the job finishes.
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
   - **Default:** `hermes ask round.json --label <label> --out answer.json` as a background job. Do nothing else on that decision until it finishes, and **never poll**.
   - **Async**, only when there is independent work: `--no-wait`, keep the Round id, then later `hermes wait <id>` or `hermes inbox`.
   - **Changing a Round:** `--supersedes <id>`, never resubmit.
   - **After resuming a session**, or whenever unsure whether Answers arrived while away: run `hermes inbox` once (Claude Code: `hermes_inbox`). The Hub keeps undelivered Answers in the Inbox; this rule replaces Claude Code hooks, following friendly-grill's no-hooks pattern.
4. **Per-client recipes:** Codex (background terminal), Cursor, omp (async bash), VS Code. Claude Code is covered by its MCP tool descriptions.
5. **Reading the Answer:**
   - `outcome` (answered, dismissed, redirected → follow `message`, expired, cancelled → `cancelled_by` / `superseded_by`);
   - `set_by`;
   - `suggested_by`;
   - notes;
   - edited Proposals.
6. **Errors:**
   - exit codes 2–5 and their `code`s;
   - `hub_unavailable` → tell the Human to run `hermes doctor`;
   - `flood_cap` → wait for an existing Answer first.
7. **Identity:** pass `--label` (or `HERMES_LABEL`); `HERMES_HUB_URL` for a non-default port.
8. **Rules:**
   - Never ask when `HERMES_ADVISOR` is set.
   - Use only the documented `hermes` commands and MCP tools. **The Skill never mentions the Command Center's own endpoints** (the accepted limit in the [security spec](security.md)).

## Not in Phase 1

- A user-level install (`~/.agents/skills`, `~/.claude/skills`).
- Serving the Skill from the Hub.
- A project copy for Claude Code (`.claude/skills`).
- Registering the shim in clients other than Claude Code.
- Automatic sandbox edits.
- Claude Code hooks (`SessionStart`, `UserPromptSubmit`, `asyncRewake`, `Stop`). Dropped in favour of background jobs, MCP Tasks and the resume rule above. See [Which Claude Code hooks deliver answered Rounds, and how?](https://github.com/jazhou-adobe/hermes-hub/issues/16).
