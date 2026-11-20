# Answered log: retention, search, export (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [What does the answered log keep and offer?](https://github.com/jazhou-adobe/hermes-hub/issues/18).

- **Builds on:** the [Command Center](command-center.md), [lifecycle](round-lifecycle.md) and [schema](round-schema.md) specs.
- **Terms:** `GLOSSARY.md`.

## What the log shows

The log is the Command Center's record of every ended Round, newest first and grouped by day. Each entry shows:

- the Outcome in words;
- the callsign and the project;
- each Question with its value and **who set it**: You, Policy, or "suggested by ADVISOR";
- the notes;
- **Delivered** with its time, or **Not picked up**;
- "Replaced by r_…" for superseded Rounds;
- the Advisor runs;
- any Draft that was never sent, shown as "Not sent".

## Retention: everything, forever

- Rounds, Answers, Attachments, Drafts and Advisor runs are **never pruned or deleted** in Phase 1.
- **Accepted consequence:** the database grows with inline Attachments, up to 4 MiB per Round. Settings → Storage shows the database size and the share taken by Attachments. The data location and backups belong to the Hub operations ticket.

## Filters and search

- **Filter chips:** Outcome, callsign, project (git root) and date range. Chips combine (AND), and the Feed's callsign and project chips use the same model.
- **Full-text search** uses **SQLite FTS5** over Round `title` and `context`, Question `prompt` and `detail`, option labels and details, free-text answers, the Human's notes, and redirect messages.
  - **Not indexed:** Attachment contents.
  - **Results** are ranked by relevance, with the match highlighted.
  - **Search and filters combine.**
- **Empty result:** "No Rounds match · Clear filters".

## Export

- **Copy as Markdown** is a button on each log entry and on Round detail. It copies:
  - the title, callsign, project and Outcome with its time;
  - the context;
  - each Question, followed by the answer, its setter and any note;
  - the Round note, or the redirect message;
  - links;
  - Attachments as one line each (kind, title, size), without their bodies.
- **Export JSON** exports the **currently filtered** log as a JSON array of `{round, answer, meta}`:
  - `round`: the `hermes.round/v1` document;
  - `answer`: the `hermes.answer/v1` document;
  - `meta`: Hub metadata (round id, callsign, project, received_at, delivered_at, superseded_by).
  - It downloads as `hermes-log-<date>.json`.

## Not in Phase 1

- Deleting Rounds or history.
- Pruning Attachments.
- A whole-log Markdown export.
- Indexing Attachment contents.
