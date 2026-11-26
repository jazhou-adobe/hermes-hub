# hermes.round/v1 and hermes.answer/v1, field by field

The Hub validates every Round and answers `invalid_round` with `errors[]` (a JSON pointer and a
message each) when one is off. Unknown fields are ignored. Text fields marked *plain* take no
Markdown or HTML; *Markdown* fields are CommonMark with raw HTML stripped.

## Round

| Field | Required | Notes |
|---|---|---|
| `schema` | yes | `"hermes.round/v1"` |
| `title` | yes | plain, at most 120 characters |
| `context` | | Markdown, at most 16 KiB |
| `questions` | yes | 1–20 Questions |
| `policy` | | the default Unanswered Policy for every Question; absent means `wait` |
| `links` | | at most 10 `{url, label?}` |
| `attachments` | | at most 20, shared by all Questions |
| `idempotency_key` | | same key and same body returns the Round already submitted; same key with another body is `idempotency_conflict` |
| `supersedes` | | set by `{{hermes-hub}} ask --supersedes <round-id>`; leave it out of the file |

## Question, common fields

`id`, `kind`, `prompt` (plain, at most 500 characters), `detail` (Markdown), `required`
(default `true`), `policy` (overrides the Round's), `attachments` (at most 10).

| Kind | Extra fields | `recommended` |
|---|---|---|
| `single` | `options` (2–50 `{id, label, detail?}`), `allow_other` (default `false`) | an option id |
| `multi` | `options`, `allow_other`, `min_selected`, `max_selected` | a list of option ids |
| `text` | `placeholder`, `multiline` (default `true`), `max_length` (at most 10 000) | suggested text, shown but never prefilled |
| `approve` | `proposal`, `approve_label`, `reject_label` | `"approve"` or `"reject"` |

**Proposal:** `{format: "text" | "command" | "json", value, editable (default false), json_schema?}`.
With `editable: true` the Human may change `value` before approving; for `json`, the edit must
validate against `json_schema` when you give one.

**Unanswered Policy:** `{on_timeout: "wait"}`, or
`{on_timeout: "apply_recommended" | "cancel", after_seconds: 10 or more}`. `apply_recommended`
on a Question without `recommended` is rejected. When a Question's policy fires, that Question
locks and the rest of the Round stays open; the Round expires once no open Question is left.

## Attachments

On the Round or on a Question, always inline. The size caps are the Hub's: `limits` in
`GET /v1/hub`.

| `kind` | Fields |
|---|---|
| `markdown` | `content`, `title?` |
| `diff` | `content` (a unified diff), `path?`, `title?` |
| `code` | `content`, `language?`, `path?`, `start_line?`, `title?` |
| `image` | `media_type` (`image/png`, `image/jpeg`, `image/webp` or `image/gif`), `data` (base64), `alt` (required), `title?` |
| `file` | `path` (a display label only; the Hub never reads it), `content`, `title?` |
| `link` | `url` (http or https), `title?`, `description?` |

## A complete Round

```json
{
  "schema": "hermes.round/v1",
  "title": "Choose a migration strategy",
  "context": "Moving `orders` to the new **billing** schema. Both paths keep the API up.",
  "idempotency_key": "orders-migration-001",
  "links": [{ "label": "PR #412", "url": "https://github.com/example/api/pull/412" }],
  "policy": { "on_timeout": "apply_recommended", "after_seconds": 600 },
  "attachments": [
    {
      "kind": "diff",
      "title": "Route change",
      "path": "src/routes/orders.ts",
      "content": "--- a/src/routes/orders.ts\n+++ b/src/routes/orders.ts\n@@ -1 +1 @@\n-import { db } from './db';\n+import { billingDb as db } from './billing-db';\n"
    }
  ],
  "questions": [
    {
      "id": "strategy",
      "kind": "single",
      "prompt": "Which migration strategy?",
      "options": [
        { "id": "blue_green", "label": "Blue/green", "detail": "Two schemas live; switch at the router." },
        { "id": "in_place", "label": "In place", "detail": "One `ALTER` per table; short lock." }
      ],
      "recommended": "blue_green"
    },
    {
      "id": "checks",
      "kind": "multi",
      "prompt": "Which checks gate the switch?",
      "options": [
        { "id": "row_counts", "label": "Row counts match" },
        { "id": "replay", "label": "Replay one hour of traffic" },
        { "id": "canary", "label": "1% canary for a day" }
      ],
      "min_selected": 1,
      "recommended": ["row_counts", "replay"]
    },
    {
      "id": "run_migration",
      "kind": "approve",
      "prompt": "Run the migration on staging now?",
      "policy": { "on_timeout": "cancel", "after_seconds": 300 },
      "proposal": { "format": "command", "value": "bun run migrate --env staging", "editable": true },
      "approve_label": "Run on staging",
      "recommended": "approve"
    },
    {
      "id": "reviewer_notes",
      "kind": "text",
      "prompt": "Anything the reviewer should check?",
      "required": false,
      "placeholder": "Optional",
      "recommended": "The rollback path for in-flight orders."
    }
  ]
}
```

## Answer

| Field | Notes |
|---|---|
| `schema` | `"hermes.answer/v1"` |
| `round_id` | the Round's id (`r_…`) |
| `outcome` | `answered`, `dismissed`, `redirected`, `expired` or `cancelled` |
| `message` | with `redirected`: what to do instead |
| `note` | the Human's note on the whole Round |
| `questions` | keyed by Question id: `{value, note?, set_by, suggested_by?}` |
| `decided_at` | when the Round ended |
| `cancelled_by` | with `cancelled`: `agent` or `human` |
| `superseded_by` | with a superseded Round: the id of the Round that replaced it |

| Kind | `value` |
|---|---|
| `single` | `{"selected": "<option id>"}`, or `{"other": "<text>"}` when `allow_other` let the Human write one |
| `multi` | `{"selected": ["<id>", …], "other"?: "<text>"}` |
| `text` | `{"text": "<text>"}` |
| `approve` | `{"decision": "approve" \| "reject", "edited": true \| false, "proposal"?: <the edited value>}` |

`value` is `null` with `set_by: "none"` when the Question was never set: an optional Question
the Human skipped, or a Question still open when the Round was dismissed, redirected or
cancelled. Values a policy locked keep `set_by: "policy"` whatever the outcome.

```json
{
  "schema": "hermes.answer/v1",
  "round_id": "r_01jd3k8w2m",
  "outcome": "answered",
  "note": "Keep the old schema for a week.",
  "questions": {
    "strategy": { "value": { "selected": "blue_green" }, "set_by": "human" },
    "checks": { "value": { "selected": ["row_counts"] }, "set_by": "human", "suggested_by": "reviewer" },
    "run_migration": {
      "value": { "decision": "approve", "edited": true, "proposal": "bun run migrate --env staging --dry-run" },
      "note": "Dry run first.",
      "set_by": "human"
    },
    "reviewer_notes": { "value": null, "set_by": "none" }
  },
  "decided_at": "2026-11-20T14:06:00Z"
}
```
