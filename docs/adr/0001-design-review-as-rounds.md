---
status: accepted
---

# Design Review Revisions are Rounds; the Design Review is a thin record beside them

The Hub already makes Rounds work end to end: waiting, Outcomes, the Feed, Drafts, the answered log, idempotency, delivery tracking and MCP Tasks, over the CLI, the stdio shim and `/mcp`. Comment threads, however, have to outlive a single immutable Answer.

We therefore submit each **Revision** as an ordinary Round carrying exactly one `design` Question (additive, so the schema stays `hermes.round/v1`). A thin **Design Review** record (`dr_…`) holds the title, the page × state list, the comment threads and the status. The first Revision creates it implicitly, and any Agent session that names its id may add a Revision.

Decided in [How does a Design Review relate to Rounds?](https://github.com/jazhou-adobe/hermes-hub/issues/50).

## Considered Options

- **A Question kind alone, with Rounds linked by an id.** Rejected because carrying threads forward, tracking status and "N of M approved" would have to be rebuilt from earlier Answers every time.
- **A first-class entity with its own lifecycle, routes and tools.** Rejected because it duplicates wait, Outcomes, the Feed, the log, MCP Tasks and idempotency, leaving two paths to keep in step.

## Consequences

- **One pending Revision per Design Review.** Changing it while it is pending is a Supersede, which carries the Draft over with pins re-matched by anchor. After Send, the next Revision is a new Round naming the same Design Review.
- **Design Questions only take `wait`.** Advisors skip them.
- **Dismiss, redirect and Agent cancel end only that Revision.** The Design Review stays Open. Only an overall approve or reject verdict, or Close by the Human or an Agent, ends it, and a later Revision reopens it.
- **The Answer carries the to-do list.** A Revision's Answer includes every comment still open, so the Agent never needs a second call to see them.
