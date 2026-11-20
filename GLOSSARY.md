# Hermes Hub

A local human-in-the-loop command center: many AI agents, running in separate processes, send it questions, and one human answers them from a single place.

## Language

### Participants

**Hub**:
The long-running service that accepts Rounds from Agents, stores them, and returns Answers.
_Avoid_: server, broker, backend

**Command Center**:
The interactive interface of the Hub where the Human sees pending Rounds from all Agents and answers them.
_Avoid_: dashboard, inbox, UI

**Agent**:
Any separate process on the Human's Mac (a coding-agent CLI, a custom script) that asks the Human questions through the Hub.
_Avoid_: client, bot, caller

**Agent session**:
One conversation of one Agent, keyed by its kind and the client's own session id (or, when the client exposes none, its long-lived parent process and folder); a resumed conversation is the same Agent session.
_Avoid_: connection, process, run

**Callsign**:
How an Agent session is named on the board: its kind and a label, such as `CLAUDE·api-refactor`, with a short suffix only when two would look the same.
_Avoid_: agent name, handle, nickname

**Human**:
The single person who answers Rounds in the Command Center.
_Avoid_: user, operator, reviewer

**Hub Skill**:
The SKILL.md, copied into a project's `.agents/skills/`, that teaches Agents how to send Rounds to the Hub and collect Answers; Claude Code gets the same rules from the Hub's MCP tool descriptions instead.
_Avoid_: scale file, integration guide

**Session token**:
The random handle the Hub gives an Agent session on request so the Hub can tell sessions apart; it identifies, it does not authenticate.
_Avoid_: API key, password, credential

**Advisor**:
A one-off run of an AI agent CLI, configured by the Human, that the Hub starts to suggest an Answer for a Pending Round; it never sends anything itself and cannot ask Rounds of its own.
_Avoid_: delegate, assistant, reviewer

**Suggestion**:
An Advisor's proposed value and reasoning for each Question, merged into the Human's Draft without overwriting anything the Human chose.
_Avoid_: recommendation (that is the Agent's), proposal

**Auto-ask rule**:
A Command Center setting that starts a chosen Advisor as soon as a Round arrives from a matching Agent; off unless the Human adds one.
_Avoid_: auto-answer, autopilot

### Exchange

**Round**:
A batch of one or more Questions that one Agent submits at once and the Human answers together; the Round is the unit that gets an id and is persisted.
_Avoid_: ticket, request, ask, form

**Question**:
One decision inside a Round: single choice, multiple choice, free text, or approve/reject, optionally carrying context attachments and a recommended option.
_Avoid_: prompt, item

**Answer**:
What the Agent gets back for a whole Round: its Outcome, one value per Question with who set it (the Human or a policy), and the Human's notes.
_Avoid_: decision, response, reply

**Outcome**:
How a Round ended: answered, dismissed, redirected (the Human said what to do instead), expired, or cancelled.
_Avoid_: result, status, verdict

**Recommended option**:
The choice the Agent suggests for a Question; the Command Center marks it but never preselects it.
_Avoid_: default, suggestion

**Proposal**:
The concrete action an approve/reject Question asks about (text, a command, or JSON), which the Human may edit before approving when the Agent allows it.
_Avoid_: payload, request

**Attachment**:
Context an Agent sends inline with a Round or a Question: markdown, diff, code, image, file contents, or a link.
_Avoid_: artifact, upload

**Unanswered Policy**:
What the Agent declares should happen if the Human does not answer in time: keep waiting, apply the Recommended option, or cancel; set on the Round and optionally overridden per Question.
_Avoid_: fallback, default

### Lifecycle

**Pending**:
A Round that has not yet reached its Outcome; the only state in which anything about it can change.
_Avoid_: open, active, waiting

**Lock**:
What happens to one Question when its Unanswered Policy fires: its value is fixed by the policy and the Human can no longer change it, while the rest of the Round stays Pending.
_Avoid_: timeout, auto-answer

**Draft**:
The Human's unsent answers on a Pending Round; a policy never sends it, and a Draft overtaken by a Lock or an Outcome is kept as "Not sent".
_Avoid_: partial answer

**Supersede**:
An Agent replacing one of its own Pending Rounds with a new Round, which cancels the old one and takes its place in the queue.
_Avoid_: edit, amend, update

**Delivered**:
An ended Round whose Answer the Agent has picked up at least once; until then the log shows it as "Not picked up".
_Avoid_: read, acknowledged

**Inbox**:
An Agent's ended Rounds whose Answers it has not yet picked up, which it can ask the Hub for at any time.
_Avoid_: mailbox, queue, outbox

**Live / Idle / Gone**:
How recently an Agent last contacted the Hub; it never changes a Round.
_Avoid_: online, offline, connected
