# Agent widgets

How the Command Center identifies **Agents**: the callsign chip on every strip, and the roster with each Agent's detection details. The data behind them comes from the Hub's Agent detection (client kind, session id, working directory and git context, self-declared label), researched on the hermes-hub `research/agent-detection-signals` branch and summarised in [ops-room-and-strip-references.md](../research/ops-room-and-strip-references.md#agent-identity-and-callsigns).

## Callsign chip — `.hh-callsign`

The Agent's name on the board, like an aircraft's callsign on a flight strip.

### Anatomy

```
.hh-callsign [data-agent="1..6"]
├── .hh-callsign-mark   small square in the Agent colour (decorative, aria-hidden)
└── .hh-callsign-text   CLIENT·label, e.g. CLAUDE·api-refactor
```

- `.hh-callsign-text` holds the client kind in uppercase (CLAUDE, CODEX, CURSOR, COPILOT, OMP, SCRIPT), a middle dot, then the Agent's declared label.
- Chip: `--hh-surface-card` / `--hh-surface-card-foreground`, `--hh-border` boundary on every side, `--hh-radius-sm`, height `--hh-callsign-chip-height`, `mono-sm` type.
- Colour: `data-agent` picks `--hh-agent-1` … `--hh-agent-6` (through `--agent-colour`) for the mark only, assigned by a stable hash of the session id. The text uses the surface foreground, so its contrast never depends on the Agent colour. Each `agent-*` role passes 3:1 against `surface-card`, `surface-panel` and `background` (validated).
- The colour separates Agents; the text identifies them. A callsign is never shown as colour alone.
- Truncation: the text truncates with an ellipsis at the end, so the client kind stays visible. The accessible name is the full callsign (`title` and the element text).
- When no label is declared, the label is the last segment of the working directory (`CODEX·billing-ui`). When nothing is known, `SCRIPT·<first 6 of session id>`.

### Variants

- Default: inline chip in a strip cell, a card head or a table cell.
- As a filter: inside `.hh-chip` with `aria-pressed` ([inputs.md](inputs.md#chip--hh-chip)).
- As a link: inside `.hh-link` to Agent detail; focus ring on the link.
- Gone: when the Agent stopped heartbeating, the text adds "· gone" in words.

## Agent roster — `.hh-agent-roster`

The Agents the Hub has seen, with what it knows about each.

### Anatomy

`ul.hh-agent-roster` is an auto-fill grid of `li > .hh-agent-card` (one column on phone):

```
.hh-agent-card
├── .hh-agent-card-head   .hh-callsign, .hh-agent-state ("Live" / "Idle" / "Gone" with icon)
└── dl.hh-dl              Client, Pending, Session, Where, Last seen
```

| Field | Content | Type |
|---|---|---|
| Client | Detected client kind in words: "Claude Code", "Codex CLI", "Cursor", "VS Code Copilot", "omp", "Script" | body |
| Pending | Count of pending Rounds, linking to the filtered bay | mono numeral |
| Session | First 8 of the session id, Copy button | mono-sm |
| Where | Host (local or tailnet name) · cwd · git branch | mono-sm |
| Last seen | "12 s ago" / HH:MM | mono-sm |

A dense desktop variant may render the same fields as a `.hh-table` in compact density.

### Detection details (Agent detail → Detection tab)

A `dl.hh-dl` of what the Hub detected and how, so the Human can trust or question the callsign:

- **Label**: as declared by the Agent. "Declared by the Agent".
- **Client kind**: the detected kind and the signal it came from, e.g. "Claude Code · from CLAUDE_CODE_SESSION_ID". Signals are mono.
- **Session id**: full id, Copy.
- **Resume handle**: when the client has one, shown as a mono command the Human can copy, e.g. `claude --resume <id>`.
- **Working directory and git**: cwd, repository, branch, commit (first 8).
- **Host**: local, or the tailnet machine name.
- **Confidence**: "Documented signal" or "Undocumented signal" in words when detection relied on a marker the client does not document, with a popover explaining why the kind may be wrong. Detection markers can collide (for example, more than one client sets the same marker), which is why the source is shown.

The declared label is display text and never replaces the detected kind or session id; both are shown.

### States

| State | Shows |
|---|---|
| Agents present | Cards sorted by pending count, then last seen |
| No Agents yet | `.hh-empty-state`: "No Agents have connected." + "Give an Agent the Hub Skill to start." + Copy Hub URL |
| Agent gone | State "Gone" with icon, callsign text "· gone"; pending Rounds stay answerable: "Answer is kept for its next poll" |
| Loading | Skeleton cards, `aria-busy="true"` |
| Offline | Cards stay with "Stale" beside last seen and an offline alert above |

### Keyboard and ARIA

- The roster is a list (`ul`) with an `aria-label` ("Agents · 4"); each card's callsign is a link to Agent detail, and card actions are buttons.
- In the table variant: a static table with a caption, not a grid; sortable headers are buttons with `aria-sort` on the `th`.
- State words are text, never a coloured dot alone.

## Agent avatar

`.hh-avatar` (`data-size="sm"` → `--hh-avatar-size-sm`, default `--hh-avatar-size-md`) shows the client kind's first letter in mono on `--hh-secondary`, decorative (`aria-hidden`) beside the callsign. Never a vendor logo.

## Copy

- Use the callsign as the subject: "CLAUDE·api-refactor sent a Round", "CODEX·billing-ui is gone".
- Client names in words in detail views: "Claude Code", not "claude-code".
- Never "bot", "assistant", "AI".

## Tokens

`--hh-agent-1` … `--hh-agent-6`, `--hh-callsign-chip-height`, `--hh-avatar-size-sm`, `--hh-avatar-size-md`, `--hh-type-mono-*`, `--hh-surface-card`, `--hh-surface-panel`, `--hh-border`, `--hh-live` (status "Live" icon), `--hh-density-row-height`.
