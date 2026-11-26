---
name: hermes-hub
description: Ask the Human a decision through Hermes Hub and get their Answer back. Use when you reach a decision you cannot or should not make alone (a trade-off the Human owns, an approval before a risky or visible action, an ambiguous requirement), after resuming a session that may have Answers waiting, or when a hermes-hub command fails.
metadata:
  version: 0.2.0
---

# Hermes Hub: ask the Human, get the Answer

The Human answers every Agent's questions from one Command Center in the browser. You send a
**Round** (one or more Questions) with the `{{hermes-hub}}` CLI, and get back one **Answer**
for the whole Round. Always run it by that full path. It finds the Hub by itself; never
hard-code the Hub's address or port.

## 1. When to ask

- Ask for a **decision** you cannot or should not make alone: a trade-off the Human owns, an
  approval before an irreversible, costly or externally visible action, a requirement that
  reads two ways.
- Look **facts** up yourself (code, docs, config, `--help`), then put them in `context`, so
  the Human sees what is settled and what the Questions rest on.
- **Batch:** put every decision that can be made now into one Round. Leave out a Question
  whose answer depends on another Question in the same Round; ask it in the next Round.

## 2. Writing a Round

Write the Round to a scratch file, e.g. `/tmp/hermes-<topic>/round1.json`:

```json
{
  "schema": "hermes.round/v1",
  "title": "Pick the cache for the billing service",
  "context": "Billing reads `prices` on every request. Redis already runs in staging; nothing else does.",
  "questions": [
    {
      "id": "cache",
      "kind": "single",
      "prompt": "Which cache?",
      "options": [
        { "id": "redis", "label": "Redis", "detail": "Already deployed; one more client library." },
        { "id": "memory", "label": "In-process LRU", "detail": "No new service; each replica warms its own copy." }
      ],
      "recommended": "redis"
    }
  ]
}
```

- **Fields:** `schema` (always `hermes.round/v1`), `title` (plain text, at most 120
  characters), `context` (Markdown: why you ask, and the facts you found), `questions` (1–20).
  Optional: `policy`, `links` (`{url, label?}` back to a PR or issue), `attachments`,
  `idempotency_key`.
- **Question kinds:** `single` (one option), `multi` (several), `text` (free text) and
  `approve` (approve or reject a Proposal). Each has an `id`, a `kind` and a plain-text
  `prompt`; `detail` (Markdown) and `required` (default `true`) are optional.
- **Stable ids:** Question and option ids match `^[a-z0-9][a-z0-9_-]{0,63}$` and are unique
  within the Round. The Answer refers to ids, never labels. Keep the same ids when you replace
  a Round, so the Human's unsent draft carries over.
- **Always recommend:** give every Question a `recommended` (an option id, a list of ids for
  `multi`, suggested text for `text`, `approve` or `reject`). It is shown as a marker, never
  preselected. Each option's `detail` states its consequence, not its label again.
- **Unanswered Policy** (`policy` on the Round, overridable per Question):
  - `{"on_timeout": "wait"}`, the default: only the Human may decide, and the Round never
    expires by itself. Use it for anything irreversible, costly, or about the Human's taste.
  - `{"on_timeout": "apply_recommended", "after_seconds": 600}`: going ahead with your
    Recommended option is safe if the Human is busy. The Question needs a `recommended`.
  - `{"on_timeout": "cancel", "after_seconds": 600}`: doing nothing is safe; the Question
    comes back `null`.
  - `after_seconds` is at least 10, counted from when the Hub received the Round.
- **Proposals:** an `approve` Question carries `proposal: {format, value, editable}`, with
  `format` `text`, `command` or `json`. Set `editable: true` when the Human may adjust it before
  approving (for `json`, add `json_schema` to constrain the edit).
- **Attachments** are inline: `markdown`, `diff`, `code`, `image`, `file` or `link`, on the
  Round or on one Question. Send the excerpt the Human needs, not whole files. The Hub's caps
  are in `limits` of its `GET /v1/hub`; a Round over one fails with `too_large`, naming the
  `limit` and the `pointer` of the attachment.

Every kind's fields, every Attachment kind, and every Answer value shape:
[references/round-format.md](references/round-format.md). Read it before writing a `multi`,
`text` or `approve` Question or an Attachment.

## 3. Asking and waiting

**Default:** submit and wait in one command, run as a **background job** (recipes in §4):

```bash
{{hermes-hub}} ask /tmp/hermes-<topic>/round1.json --label <label> --out /tmp/hermes-<topic>/answer1.json
```

- It prints `ROUND <round-id> <url>` at once; give the Human the url. When the Round ends it
  prints `ANSWER {…}` on one line and writes the same JSON to `--out`. Read the Answer from the
  `--out` file: a long line in tool output can get cut off, the file never is.
- Until that job finishes, do nothing else on that decision, and **never poll**: no
  `{{hermes-hub}} wait` or `{{hermes-hub}} inbox` in a loop, no `sleep`, no re-reading the file on a
  timer. The job ending is the signal. The wait costs nothing; the command holds the line to the Hub and
  rides out Hub restarts.
- Do unrelated work meanwhile if there is any. Otherwise wait for the job the way your client
  waits for background jobs.

**Async, only when you have independent work that outlasts the decision:**
`{{hermes-hub}} ask round.json --label <label> --no-wait` prints only the `ROUND` line. Keep the
round id. Later, run `{{hermes-hub}} wait <round-id> --label <label> --out answer.json` (as a
background job too), or `{{hermes-hub}} inbox` once.

**Changing a Round:** write the new Round and run
`{{hermes-hub}} ask round2.json --label <label> --supersedes <round-id> --out answer2.json`. The Hub
cancels the old Round and puts the new one in its place. Never resubmit the same decision
without `--supersedes`. If the old Round already ended, you get `round_ended` with its
`outcome`: collect that Answer with `{{hermes-hub}} wait <round-id>`.

**Dropping a Round:** `{{hermes-hub}} cancel <round-id>` when the decision no longer matters.

**After resuming a session**, or whenever unsure whether Answers arrived while you were away:
run `{{hermes-hub}} inbox --label <label>` once. It prints one `ANSWER` line per Answer you have not
picked up (`--format json` for one JSON document). The Hub keeps them until you do.

## 4. Per-client recipes

- **omp:** run `{{hermes-hub}} ask …` with the `bash` tool, `async: true` and `timeout: 0` (a Round
  can take longer than the default deadline). The result arrives by itself as a follow-up
  message. With nothing else to do, call `wait` on that job.
- **Codex:** run `{{hermes-hub}} ask …` with your shell tool. Once it outlives the yield time it keeps
  running in a background terminal: wait on that same session (`write_stdin` with empty input
  and the longest `yield_time_ms`) until it exits. Reading the job's own output is waiting, not
  polling; never start a second `{{hermes-hub}} ask` or `{{hermes-hub}} wait` for the same Round. Under the
  `workspace-write` sandbox the network is off until the Human allows it: on `hub_unavailable`,
  see §6.
- **Cursor:** run `{{hermes-hub}} ask …` as a background shell command, then wait on it with the
  await-shell tool until it exits.
- **VS Code Copilot:** run `{{hermes-hub}} ask …` in a background terminal (`isBackground: true`); VS
  Code tells you when it exits. Without that notice, run it in the foreground with no timeout.
- **Claude Code:** use the `hermes_ask`, `hermes_wait`, `hermes_cancel` and `hermes_inbox` MCP
  tools (the Human registers them with `{{hermes-hub}} setup claude`); their descriptions carry these
  rules. Without them, run `{{hermes-hub}} ask …` with Bash `run_in_background: true`.

## 5. Reading the Answer

An ended Round always exits `0`, whatever its `outcome`; read the `outcome`:

- `answered`: use each Question's `questions.<id>.value`.
- `dismissed`: the Human declined to decide. Do not ask the same thing again unchanged; take
  the least risky path or stop and report.
- `redirected`: do what `message` says instead of what you planned.
- `expired`: every Question locked by its policy before the Human sent anything.
- `cancelled`: `cancelled_by: "agent"` is you; with `superseded_by`, read the Answer of that
  newer Round instead. `cancelled_by: "human"` means the Human dropped your pending Rounds; stop
  asking about it.

Per Question, `questions.<id>` holds:

- `value`: `{selected}` or `{other}` for `single`; `{selected: [...], other?}` for `multi`;
  `{text}` for `text`; `{decision, edited, proposal?}` for `approve`. `null` when the Question
  was never set.
- `set_by`: `human`, `policy` (its Unanswered Policy locked it) or `none` (value `null`).
- `suggested_by`: present when the Human sent an Advisor's suggestion unchanged. It is still
  the Human's decision.
- `note`, and the Round-level `note`: always read them. A note often qualifies or overrides
  the value it sits beside.
- **Edited Proposals:** when `edited` is `true`, `proposal` is the Human's version. Act on that
  one, never on the value you proposed.

## 6. Errors

Failures print `ERROR <code> <message> {details}` and exit non-zero:

| Exit | `code` | Do |
|---|---|---|
| 2 | (usage) | Fix the command line. |
| 3 | `hub_unavailable` | The Hub is down, or your sandbox blocks `127.0.0.1`. Tell the Human: start it with `{{hermes-hub}} start`, and run `{{hermes-hub}} doctor` for this client's sandbox setting. Do not retry in a loop. |
| 4 | `invalid_round` | Fix the Round at each `errors[].pointer`, then ask again. |
| 4 | `too_large` | Shrink the attachment at `pointer` below `limit`. |
| 4 | `flood_cap` | Too many pending Rounds: wait for an existing Answer first (`oldest_round_id`), then ask. |
| 4 | `round_ended` | The Round you superseded or cancelled already ended: collect it with `{{hermes-hub}} wait`. |
| 4 | `idempotency_conflict` | Same `idempotency_key`, different body: use a new key. |
| 4 | `not_found`, `unsupported_schema`, `advisor_cannot_ask` | Wrong round id (or another session's Round); a schema other than `hermes.round/v1`; you are an Advisor run (see §8). |
| 5 | `unknown_session`, `forbidden` | Report it to the Human. |

A `WARN …` line on stderr (an outdated Skill copy, a Hub on another version) never fails the
command: pass it on to the Human once.

## 7. Identity

- Pass `--label <label>` on every `{{hermes-hub}}` command (or set `HERMES_LABEL`): a short name for
  your task, the same for the whole conversation. The Human sees you as `KIND·label`.
- Your kind and session are detected; pass `--kind` or `--session` only when the Human asks.
- `HERMES_HUB_URL` points `{{hermes-hub}}` at a Hub on a non-default address; set it only when the
  Human tells you to.

## 8. Rules

- When `HERMES_ADVISOR` is set you are an Advisor run: never ask; the Hub refuses it anyway.
- Reach the Hub only through the `{{hermes-hub}}` commands above (on Claude Code, the `hermes_*` MCP
  tools), plus `GET /v1/hub` for its limits. The Human alone answers Rounds, in the Command
  Center.
- One decision, one live Round: change it with `--supersedes`, collect it with `{{hermes-hub}} wait`
  or `{{hermes-hub}} inbox`, never by asking again.
