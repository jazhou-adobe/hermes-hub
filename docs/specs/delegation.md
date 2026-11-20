# Delegation: Advisors (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [How does the Human ask another Agent to answer a Round first?](https://github.com/jazhou-adobe/hermes-hub/issues/11). It builds on the [schema](round-schema.md), the [lifecycle](round-lifecycle.md), the [transports](transports.md) and [security](security.md) specs. Terms follow `GLOSSARY.md`.

## What it is

An **Advisor** is a one-off run of an AI agent CLI that the Hub starts to suggest an Answer for a pending Round.

- It is **optional**. It is started either by the Human (**Ask advisor**) or by an **auto-ask rule** in the Command Center.
- It only ever produces a **Suggestion**. The Human always sends.

```mermaid
sequenceDiagram
  participant AG as Agent (asking)
  participant H as Hub
  participant HU as Human
  participant AD as Advisor (one-off, read-only)
  AG->>H: submit Round
  alt auto-ask rule matches the Agent
    H->>AD: start
  else Human presses Ask advisor (optional brief)
    HU->>H: ask advisor
    H->>AD: start
  end
  Note over H,AD: prompt on stdin = Round + Attachments + brief + output format
  AD-->>H: prints Suggestion (value + rationale per Question), exits
  H->>HU: fills empty Questions, "Suggested by ADVISOR"; others offered inline
  HU->>H: edits if wanted, Send
  H->>AG: Answer (set_by human, suggested_by on unchanged values)
```

## Advisors (`config.toml` `[[advisor]]`, shown read-only in Settings → Advisors)

- **Custom entries only.** Each entry has:
  - `name`
  - `command`: an **argument list**, never a shell string, executed directly
  - `timeout_seconds` (default 300)
- **The Human configures read-only operation** through the CLI's own flags. The Hub cannot enforce it.
- **Run environment:**
  - **Working directory:** the originating Agent session's working directory, when known and it exists; otherwise a fresh empty temp folder.
  - **Prompt:** written to **stdin**.
  - **Environment:** `HERMES_ADVISOR=<run id>` is set, and no Hermes session token is given.
- **No loops.** Any `POST /v1/sessions` or submit from a process with `HERMES_ADVISOR` set is rejected with `advisor_cannot_ask` (403). The CLI and the shim forward the variable as a header.

## Starting a run

| Trigger | How | Brief |
|---|---|---|
| **Ask advisor** | Human action on a pending Round: pick an Advisor, add an optional brief | Optional free text; never sent to the originating Agent |
| **Auto-ask rule** | `config.toml` `[[auto_ask]]`: `{kind, project, label?, advisor, brief?}` (keyed per the identity spec), shown read-only in Settings. **None by default.** Runs as soon as a matching Round arrives | The rule's standing brief, if any |

- **One run per Round at a time.** A new request cancels the running one (SIGTERM, then SIGKILL after 5 s). The Human can **Cancel** a run.
- **A run ends** when the process exits, at its timeout, or when the Round ends (answered, dismissed, redirected, expired or cancelled).

## Prompt and Suggestion format

The Hub builds the prompt from:

- instructions;
- the Round JSON: Questions, Recommended options, Proposals, context, links;
- text Attachments; image Attachments become a line with their `alt` text;
- the brief;
- the required output format.

The Advisor must print one JSON object, which the Hub takes from the **last JSON object in stdout**:

```json
{
  "schema": "hermes.suggestion/v1",
  "summary": "Blue/green: the diff touches the orders table; in-place would lock it.",
  "questions": {
    "strategy": { "value": { "selected": "blue_green" }, "rationale": "Avoids a long lock on orders." },
    "run_migration": { "value": { "decision": "approve", "edited": false }, "rationale": "Staging only; reversible." }
  }
}
```

- **Values** use the same shapes as Answer values in the schema.
- **Validation:** the Hub validates the Suggestion against the Round (option ids exist, required kinds match).
  - **Invalid or missing:** the raw output, capped at 256 KiB, is shown as an **unparsed briefing**, and no values are filled.
  - **Partly valid:** valid Questions are used, and the rest are listed as skipped.

## Merging into the Draft

- **Empty, open Questions** are **filled** with the suggested value and marked "Suggested by ADVISOR", with the rationale shown.
- **Questions the Human already set** show an inline "ADVISOR suggests … · Accept" and are never overwritten.
- **Locked Questions** (a policy fired) ignore the suggestion; it stays in the Round history.
- **Deadlines keep running** during a run (lifecycle rule 2). The Round shows "Advisor working · m:ss".

## Attribution in the Answer (schema addition, stays v1)

`QuestionAnswer.suggested_by` (string, the Advisor's name):

- present only when the Human sent a value **identical** to that Advisor's Suggestion;
- `set_by` stays `human`, because the Human decided;
- an edited value carries no `suggested_by`.

## History

Each run is recorded in the Round's history and shown in Round detail:

- the Advisor and its trigger (manual or rule);
- the brief;
- start and end times;
- the status (`succeeded`, `failed`, `timed_out`, `cancelled`);
- the raw output (capped) and the parsed Suggestion.

## Changes to other specs

- **Schema:** `suggested_by` on `QuestionAnswer`. `set_by` is unchanged.
- **Transports:** a new error code, `advisor_cannot_ask` (403), which maps to CLI exit code 4.
- **Lifecycle:** delegation adds no states. Runs never pause deadlines, and the Round ending stops the run.

## Not in Phase 1

- **Auto-answer** (an Advisor's Suggestion sent without the Human). The Human chose auto-ask only.
- Advisor presets.
- Several Advisors in parallel on one Round.
- Forwarding a Round to an already-running Agent session.
