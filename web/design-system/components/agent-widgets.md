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

A `dl.hh-dl` of what the Hub detected and how, so the Human can trust or question the callsign. On a roster card it folds into `details.hh-detection` (top `--hh-border` rule) > `summary.hh-detection-summary` ("Detection details", chevron icon, at least `--hh-button-min-target` tall) > the `dl`; on Agent detail it is the Detection tab.

- **Label**: as declared by the Agent. "Declared by the Agent".
- **Client kind**: the detected kind and the signal it came from, e.g. "Claude Code · from CLAUDE_CODE_SESSION_ID". Signals are mono.
- **Session id**: full id in mono, **Copy** (copy icon, ghost, small).
- **Resume handle**: when the client has one, shown as a mono command with **Copy**, e.g. `claude --resume <id>`; "none documented" otherwise.
- **Callsign and clash suffix**: when two sessions would get the same callsign, the Hub appends the first 4 of the session id (`CLAUDE·api·3f9a`) and says why: "suffix 3f9a added because CLAUDE·api-refactor is already on this Hub; it is the first 4 of the session id".
- **Working directory and git**: cwd, repository, branch, commit (first 8).
- **Host**: local, or the tailnet machine name.
- **Confidence**: `.hh-badge[data-tone="success"]` "Documented signal", or `.hh-badge[data-tone="warning"]` "Undocumented signal" (alert icon) when detection relied on a marker the client does not document, with the toggletip "Why may this be wrong?" (`.hh-popover-anchor` > button + `.hh-popover`, [overlays.md](overlays.md)) explaining why the kind may be wrong. Detection markers can collide (for example, more than one client sets the same marker), which is why the source is shown.

The declared label is display text and never replaces the detected kind or session id; both are shown.

### States

| State | Shows |
|---|---|
| Agents present | Cards sorted by pending count, then last seen |
| No Agents yet | `.hh-empty-state`: "No Agents have connected." + "Give an Agent the Hub Skill to start." + Copy Hub URL |
| Agent gone | State "Gone" with icon, callsign text "· gone"; pending Rounds stay answerable: "Answer is kept for its next poll" |
| Idle | State "Idle" with the clock icon and "last seen 13:12"; no glow |
| Forgotten | After Forget: `.hh-alert[data-tone="info"][role="status"]` with badge "Forgotten": "CURSOR·web-shell is forgotten · 14:06" · "Its pending Rounds were cancelled and stay in the log. If the session sends again, it returns as a new Agent with a new callsign." |
| Loading | Skeleton cards, `aria-busy="true"` |
| Offline | Cards stay with "Stale" beside last seen and an offline alert above |

### Keyboard and ARIA

- The roster is a list (`ul`) with an `aria-label` ("Agents · 4"); each card's callsign is a link to Agent detail, and card actions are buttons.
- In the table variant: a static table with a caption, not a grid; sortable headers are buttons with `aria-sort` on the `th`.
- State words are text, never a coloured dot alone.

### Forget Agent

A destructive action on a roster card and Agent detail: `.hh-button[data-variant="destructive"]` "Forget CALLSIGN…" (trash icon) opens an **alert dialog** ([overlays.md](overlays.md)):

- Title "Forget CURSOR·web-shell?"; description "Its pending Rounds are cancelled and stay in the log as cancelled. Its detection details and resume handle are removed from this Hub."
- Focus starts on the safe action **Keep CURSOR·web-shell**; the destructive button reads **Forget Agent**.
- After it: the forgotten note (States), its Rounds end in place in the Feed as "Cancelled by Forget", and the live region says "CURSOR·web-shell forgotten · 1 Round cancelled".

## Lanes — `.hh-lanes`

A view on the **Agents** page: one lane per Agent session with its Pending Rounds. Lanes are not the triage surface; the Feed is.

```
.hh-lanes-layout                     lanes beside the drawer from 64rem (drawer at min(--hh-overlay-drawer-width, 40%))
├── ul.hh-lanes[aria-label="Lanes · N Agent sessions"]   auto-fill grid, columns at least --hh-overlay-popover-width
│   └── li.hh-shelf.hh-lane
│       ├── .hh-lane-head            .hh-callsign, .hh-agent-state (Live / Idle / Gone with icon), mono "1 pending · last seen 2 s ago · feat/v2-routes"
│       └── ul.hh-strip-bay-list.hh-lane-list
│           ├── li.hh-strip[data-mode="button"][data-selected?]   the strip with a button head (aria-expanded, aria-controls the drawer)
│           └── li.hh-strip-bay-slot.hh-lane-slot               empty lane: "No pending Rounds · idle since 13:12"
└── aside.hh-drawer[aria-labelledby]   the selected Round
    ├── .hh-overlay-head             title, Close (ghost icon button, aria-label "Close Round drawer")
    ├── .hh-overlay-body             status badge, callsign, id, policy sentence, the Questions
    └── .hh-overlay-foot             Open in Feed, Open Round detail
```

- **Selected strip**: `data-selected="true"` (the ring outline) and "Open" in its meta cell.
- **Non-modal drawer** (`.hh-drawer`): the lanes stay usable beside it; it is an `aside` landmark, not a dialog, so focus is not trapped. Opening moves nothing; Close or Escape closes it and returns focus to the strip that opened it. Below 64rem it stacks after the lanes. Modal work (navigation on a narrow screen) still uses `.hh-sheet`.
- Tokens: `surface-shelf`, `surface-panel`, `border`, `ring`, `overlay-drawer-width`, `overlay-popover-width`, `layout-sticky-top`, `strip-min-height`.

## Agent avatar

`.hh-avatar` (`data-size="sm"` → `--hh-avatar-size-sm`, default `--hh-avatar-size-md`) shows the client kind's first letter in mono on `--hh-secondary`, decorative (`aria-hidden`) beside the callsign. Never a vendor logo.

## Copy

- Use the callsign as the subject: "CLAUDE·api-refactor sent a Round", "CODEX·billing-ui is gone".
- Client names in words in detail views: "Claude Code", not "claude-code".
- Never "bot", "assistant", "AI".

## Tokens

`--hh-agent-1` … `--hh-agent-6`, `--hh-callsign-chip-height`, `--hh-avatar-size-sm`, `--hh-avatar-size-md`, `--hh-type-mono-*`, `--hh-surface-card`, `--hh-surface-panel`, `--hh-border`, `--hh-live` (status "Live" icon), `--hh-density-row-height`.
