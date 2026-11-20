# Round and Answer schema (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [What is the Round and Answer schema?](https://github.com/jazhou-adobe/hermes-hub/issues/6). Terms follow `GLOSSARY.md`.

Machine-readable: [`round.schema.json`](round.schema.json) (JSON Schema 2020-12). Examples: [`examples/`](examples/). All three examples validate, and the schema rejects an Answer with outcome `redirected` but no `message`, and a `cancel` policy with no `after_seconds`.

## Principles

- **One document over every transport.** A Round (or Answer) is the same JSON over HTTP and MCP. No field depends on the transport.
- **Ids, not labels.** Options and Questions have stable Agent-chosen ids (`^[a-z0-9][a-z0-9_-]{0,63}$`, unique within the Round). Answers return ids, so labels can be reworded.
- **No HTML.** `prompt`, `title` and labels are plain text. `context`, `detail` and markdown attachments are CommonMark with raw HTML stripped.
- **The recommendation is a marker, never a preselection.** The Command Center shows it; the Human chooses.
- **Versioned.** `schema: "hermes.round/v1"` / `"hermes.answer/v1"`. Additive changes stay v1, and unknown fields are ignored. The Hub rejects an unknown major version with a clear error. The Hub Skill pins the version.

## Round (Agent → Hub)

| Field | Req | Notes |
|---|---|---|
| `schema` | ✓ | `"hermes.round/v1"` |
| `title` | ✓ | Plain text, ≤ 120. The strip title. |
| `context` | | Markdown, ≤ 16 KiB. Why the Agent is asking. |
| `idempotency_key` | | Scoped to the Agent session (session token), kept forever. Same key and same body returns the existing Round; same key with a different body is a conflict. |
| `supersedes` | | Id of a still-pending Round from the same Agent session that this Round replaces ([lifecycle](round-lifecycle.md)). |
| `links` | | ≤ 10 `{url, label?}` back to the Agent's work (PR, issue, run). |
| `policy` | | Default Unanswered Policy for every Question; absent means `wait`. |
| `attachments` | | ≤ 20 Round-level attachments (shared context). |
| `questions` | ✓ | 1–20 Questions. |

The Hub assigns the Round id (`r_…`), the received time and the status. These fields are not part of the submitted document.

### Unanswered Policy

`{on_timeout: "wait"}`, or `{on_timeout: "apply_recommended" | "cancel", after_seconds: ≥ 10}`. Set on the Round as the default; a Question's own `policy` overrides it. `apply_recommended` on a Question with no `recommended` is a validation error (Hub check). What happens when one Question's policy fires while others are still pending is decided by the **lifecycle ticket**.

### Question (common)

`id`, `kind`, `prompt` (plain, ≤ 500), `detail` (markdown), `required` (default `true`), `policy` (override), `attachments` (≤ 10).

| Kind | Extra fields | `recommended` |
|---|---|---|
| `single` | `options` (2–50 `{id, label, detail?}`), `allow_other` (default `false`) | option id |
| `multi` | `options`, `allow_other`, `min_selected`, `max_selected` | option ids |
| `text` | `placeholder`, `multiline` (default `true`), `max_length` (≤ 10 000) | suggested text, shown and never prefilled |
| `approve` | `proposal`, `approve_label`, `reject_label` | `approve` or `reject` |

**Proposal** (approve/reject): `{format: "text" | "command" | "json", value, editable (default false), json_schema?}`. If `editable` is true, the Human may change `value` before approving. For `json`, edits must validate against `json_schema` when it is given.

### Attachments

Allowed on the Round and on each Question. Always **inline**. Caps: **256 KiB per attachment** (measured after base64 for images) and **4 MiB per Round**. A Round over a cap is rejected with an error that names the attachment.

| Kind | Fields |
|---|---|
| `markdown` | `content`, `title?` |
| `diff` | `content` (unified diff), `path?`, `title?` |
| `code` | `content`, `language?`, `path?`, `start_line?`, `title?` |
| `image` | `media_type` (png, jpeg, webp, gif), `data` (base64), `alt` (required), `title?` |
| `file` | `path` (display label only; the Hub never reads it), `content`, `title?` |
| `link` | `url` (http/https), `title?`, `description?` |

## Answer (Hub → Agent)

| Field | Notes |
|---|---|
| `schema` | `"hermes.answer/v1"` |
| `round_id` | The Hub's Round id. |
| `outcome` | `answered`, `dismissed`, `redirected`, `expired` or `cancelled`. |
| `message` | Required when the outcome is `redirected`: what to do instead. |
| `note` | The Human's Round note. |
| `questions` | Keyed by Question id: `{value, note?, set_by}`. |
| `decided_at` | When the outcome was reached. |
| `cancelled_by` | `agent` or `human`; present only when the outcome is `cancelled`. |
| `superseded_by` | Id of the replacing Round; present only when it was superseded. |

`set_by` is `human`, `policy` or `none`. `value` is `null` (with `set_by: none`) when the Question was never set: an optional Question was skipped, or the Question was still open when the Round was dismissed, redirected or cancelled. Values a policy already locked are kept whatever the outcome (see the lifecycle spec). `suggested_by` (an Advisor's name) appears only when the Human sent that Advisor's suggested value unchanged; `set_by` stays `human`.

| Kind | `value` |
|---|---|
| `single` | `{selected: "<option id>"}` or `{other: "<text>"}` |
| `multi` | `{selected: ["<id>", …], other?: "<text>"}` |
| `text` | `{text: "<text>"}` |
| `approve` | `{decision: "approve" \| "reject", edited: bool, proposal?: <edited value>}` |

Edit-then-approve is a Question-level value (`edited: true`), not a Round outcome.

## Left to other tickets

- **Lifecycle:** settled in [round-lifecycle.md](round-lifecycle.md), which added `supersedes`, `cancelled_by` and `superseded_by`.
- **Agent identity:** settled in [agent-identity.md](agent-identity.md). Identity lives on the Agent session, so the Round has no `agent` block.
- **Delegation:** settled in [delegation.md](delegation.md), which added `suggested_by`; `set_by` is unchanged.
- **Transport:** settled in [transports.md](transports.md): the submit response, the shared error codes, and idempotency (the same on every door).
