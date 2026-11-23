# Phase 1 specs

These are the confirmed specs for Hermes Hub Phase 1. Each was decided with the Human in one ticket on the [Wayfinder map](https://github.com/jazhou-adobe/hermes-hub/issues/1) and confirmed on 2026-11-20. Terms follow [`GLOSSARY.md`](../../GLOSSARY.md).

| Spec | Covers | Ticket |
|---|---|---|
| [round-schema.md](round-schema.md) (+ [`round.schema.json`](round.schema.json), [`examples/`](examples/)) | What an Agent sends (Round, Question kinds, Attachments, Unanswered Policy) and gets back (Answer, Outcome, `set_by`, `suggested_by`) | [#6](https://github.com/jazhou-adobe/hermes-hub/issues/6) |
| [round-lifecycle.md](round-lifecycle.md) | States, per-Question Lock, strict deadlines, Drafts, supersede, delivery, liveness, idempotency, flood cap | [#7](https://github.com/jazhou-adobe/hermes-hub/issues/7) |
| [transports.md](transports.md) | One Round engine; HTTP API, MCP (shim and `/mcp`, Tasks), CLI, errors and exit codes | [#8](https://github.com/jazhou-adobe/hermes-hub/issues/8) |
| [security.md](security.md) | Local only, session tokens as identity, browser guard, accepted limits | [#9](https://github.com/jazhou-adobe/hermes-hub/issues/9) |
| [agent-identity.md](agent-identity.md) | Agent session, detection precedence, callsigns, `POST /v1/sessions`, discovery | [#10](https://github.com/jazhou-adobe/hermes-hub/issues/10) |
| [delegation.md](delegation.md) | Advisors, Suggestions, auto-ask rules | [#11](https://github.com/jazhou-adobe/hermes-hub/issues/11) |
| [command-center.md](command-center.md) | The Feed, answering, keys, notifications, live updates | [#12](https://github.com/jazhou-adobe/hermes-hub/issues/12) |
| [hub-skill.md](hub-skill.md) | Hub Skill content and distribution, `doctor`, `setup claude`, the resume rule | [#13](https://github.com/jazhou-adobe/hermes-hub/issues/13) |
| [frontend-stack.md](frontend-stack.md) | React 19 single-page app served by the Hub, design-system copy, SSE store | [#15](https://github.com/jazhou-adobe/hermes-hub/issues/15) |
| [friendly-grill-client.md](friendly-grill-client.md) | friendly-grill as a thin client (cyber-avatar repo) | [#17](https://github.com/jazhou-adobe/hermes-hub/issues/17) |
| [answered-log.md](answered-log.md) | Retention (forever), filters, FTS search, export | [#18](https://github.com/jazhou-adobe/hermes-hub/issues/18) |
| [hub-operations.md](hub-operations.md) | Run from a clone, `<clone>/.hermes/`, `config.toml`, migrations, backups, logs, notifications | [#19](https://github.com/jazhou-adobe/hermes-hub/issues/19) |

**Where the specs disagree, the later ticket wins.** Each spec's "Changes to other specs" section records what it amended. The table is in decision order.

**Primary sources:**
- [Research notes](../research/README.md).
- The throwaway Command Center prototype on branch [`prototype/command-center`](https://github.com/jazhou-adobe/hermes-hub/tree/prototype/command-center/prototype/command-center).
- The Flight Director design in [`jazhou-adobe/apollo-tokens`, `brands/hermes/design`](https://github.com/jazhou-adobe/apollo-tokens/tree/1d03cf95ad82e400e88e346ff0cb8cb683ee58da/brands/hermes/design) @ `1d03cf9`, together with its [additions brief](https://github.com/jazhou-adobe/apollo-tokens/blob/1d03cf95ad82e400e88e346ff0cb8cb683ee58da/brands/hermes/design/briefs/command-center-additions.md).
