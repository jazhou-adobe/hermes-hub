# Round widgets

The widgets that show and answer a **Round**: the strip in its holder, the strip bay, the open Round with its Question blocks, option rows, the recommended marker, attachments and diffs, and the Answer bar. These are the heart of the Command Center. Status widgets (policy timer, connection, keyboard hints, answered log) are in [status-widgets.md](status-widgets.md); callsigns and the roster are in [agent-widgets.md](agent-widgets.md). Every class is styled in `preview/hermes-components.css`.

## Strip — `.hh-strip`

One Round on the board. The `.hh-strip` element **is the holder**: a frame in the status colour around the paper strip.

### Anatomy

```
li > .hh-strip [data-status="pending|answered|expired"] [data-selected="true"]
├── .hh-strip-tab            top tab of the holder: status word (+ Round id in .hh-mono-sm)
├── .hh-strip-paper          the paper: --hh-strip / --hh-strip-foreground
│   ├── button.hh-strip-head  opens or expands the Round; three cells
│   │   ├── .hh-strip-cell[data-cell="callsign"]  .hh-callsign
│   │   ├── .hh-strip-cell[data-cell="title"]     .hh-strip-title, .hh-strip-policy
│   │   └── .hh-strip-cell[data-cell="meta"]      Question count, age (mono)
│   └── .hh-strip-body[hidden]  expanded: .hh-strip-summary list, .hh-strip-actions
└── .hh-policy-timer         along the holder's bottom edge
```

### The holder

The holder frames the **whole** strip, like the plastic holder a paper strip slides into:

- The holder colour (`--holder`) fills the frame on every side at `--hh-strip-holder-width`, with the `.hh-strip-tab` along the top carrying the status word in `--holder-foreground`.
- The paper inside is `--hh-strip` with `--hh-strip-foreground` ink, at least `--hh-strip-min-height` tall.
- The policy timer runs inside the holder's bottom edge.

It is never a thin coloured stripe on one side of a card, and the status word is always present.

| `data-status` | `--holder` / `--holder-foreground` | Tab word | Extra cue |
|---|---|---|---|
| `pending` (default) | `--hh-pending` / `--hh-pending-foreground` | Pending | Timer fill, or the dashed "keeps waiting" rail |
| `answered` | `--hh-answered` / `--hh-answered-foreground` | Answered | Answer summary in the body; empty timer rail |
| `expired` | `--hh-expired` / `--hh-expired-foreground` | Expired or Cancelled | Outcome sentence in `.hh-strip-policy` ("Policy applied recommended at 14:10", "Cancelled by CODEX·billing-ui at 14:02") |

Worlds restyle the holder through `--holder` / `--holder-foreground`, set from these role pairs.

### States

- **Collapsed** (default in the bay): tab, head and timer. The head is a `<button>` with `aria-expanded="false"` when the strip expands in place.
- **Expanded**: `.hh-strip-body` loses `hidden`; it lists each Question with its kind and, once answered, its value (`.hh-strip-summary`), plus `.hh-strip-actions` (Open Round, Copy id).
- **Selected** (`data-selected="true"`, the Round open beside the bay): an outer outline in `--hh-ring` at `--hh-focus-ring-width` and `--hh-focus-ring-offset`, and the word "Open" in the meta cell.
- **Focus**: the global `:focus-visible` ring on `.hh-strip-head`.
- **Agent gone**: the meta cell adds "Agent gone · Answer is kept for its next poll".
- Glow never appears on a strip; it is reserved for live values and the connection lamp.

### Tokens

`--hh-strip`, `--hh-strip-foreground`, `--hh-pending`, `--hh-answered`, `--hh-expired` and their `-foreground` pairs, `--hh-strip-min-height`, `--hh-strip-holder-width`, `--hh-timer-track-height`, `--hh-type-strip-header-*`, `--hh-type-mono-sm-*`, `--hh-ring`, `--hh-focus-ring-width`, `--hh-focus-ring-offset`, `--hh-elevation-raised`, `--hh-border`.

### Copy

Tab: "Pending · r_7f3a91c0". Title cell: "Choose a migration strategy" with policy "waits 10 min, then applies recommended". Meta: "2 Questions · 3m ago".

## Strip bay — `.hh-strip-bay`

The triage queue: pending strips in arrival order, oldest first, in a single disciplined column. **Reference only for the Hub's Phase 1**, whose triage is the Feed ([feed-widgets.md](feed-widgets.md)); the strip itself is reused by the Lanes view ([agent-widgets.md](agent-widgets.md)). The bay's polite status region is `.hh-bay-status` (the Feed reuses it above its column).

### Anatomy

```
section.hh-strip-bay
├── .hh-strip-bay-head    heading "Pending", .hh-live-value count, filter chips
├── ul.hh-strip-bay-list  li > .hh-strip, li > .hh-strip-bay-slot (empty dashed slot)
└── .hh-strip-bay-empty   empty-bay message (replaces the list)
```

Tokens: `--hh-surface-panel` / `--hh-surface-panel-foreground` (bay floor), `--hh-border`, `--hh-density-inset`, `--hh-density-gap`, `--hh-strip-min-height` (slots).

### Keyboard and ARIA

On desktop the bay is one Tab stop with roving focus ([APG keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)). It lists actionable Rounds only: pending strips, plus an answered strip for the moment it departs. Expired and cancelled Rounds leave the bay for the answered log, so keyboard movement never lands on a strip that cannot open.

- **Default: listbox.** When strips have no inner controls (the Round opens beside the bay), the list is `role="listbox"` with `aria-label="Pending Rounds"` and each strip is `role="option"` with `aria-selected` ([APG listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)). Keys: ↓/`j` and ↑/`k` move, Home/End go to the ends, Enter opens the Round. Letters do not type-ahead; they are triage keys.
- **With inline actions: grid.** When strips show inline Approve/Reject (`.hh-strip-actions`, compact density only), the list is `role="grid"`, each strip a `role="row"`, and the head and each action a `role="gridcell"` ([APG grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)). ↑/↓ (`j`/`k`) move between rows, ←/→ between cells, Enter activates.
- **Phone (narrow container): list of buttons.** When the bay and the Round stack (the command container is under 48rem), the list is a plain `<ul aria-label="Pending Rounds">` and each strip's `.hh-strip-head` is a native `<button>` whose hit area covers the whole strip (`.hh-strip[data-mode="button"]`). Every strip is its own Tab and swipe stop; there is no roving focus. The same surface takes `data-density="glance"` unless the page has set a density explicitly (a `?density=` preview override or a saved choice wins).
- Each strip's accessible name starts with the status word: "Pending, Choose a migration strategy, CLAUDE·api-refactor, 2 Questions, waits 10 min then applies recommended".
- New strips join at the end without moving focus; the bay's status region announces them ([accessibility.md](../foundations/accessibility.md#live-regions)).
- When the focused strip leaves the bay (answered elsewhere, expired), focus moves to the next strip and the change is announced.
- The bay's status region (`role="status"`) is in the DOM from first paint but takes no room until a confirmation lands; it never shows placeholder copy.
- The bay head shows the connection readout only where the page has no app bar carrying it: one readout per surface.

### States

| State | What shows |
|---|---|
| Has pending | Strips; bay head "Pending · 3" |
| Empty bay | `.hh-strip-bay-empty`: "No pending Rounds." · "Agents ask through the Hub Skill." · link "Open answered log". The bay floor may show world texture here only |
| Loading (first connect) | Three `.hh-skeleton` strips, `aria-busy="true"`, "Loading Rounds…" |
| Reconnecting | Strips stay; `.hh-alert[data-tone="warning"]` above: "Reconnecting · retry in 4 s · the bay may be out of date" |
| Offline | Strips stay with "Stale" in meta; `.hh-alert[data-tone="destructive"]` with `role="alert"`: "Offline · last update 14:02 · answers cannot be sent" |
| Filtered | Chips in the head; "Showing 2 of 5 · Clear filters" |

## Open Round — `.hh-round`

The Round being answered, beside the bay on desktop or in a full-screen sheet on phone. Its Questions sit beside their Answer slots.

```
form.hh-round  (--hh-strip paper, opaque reading plane)
├── .hh-round-head        Back to pending, status badge, title, callsign, Round id, .hh-policy-badge
├── .hh-round-body        the only part that scrolls: ol.hh-round-questions li > .hh-question …, notes
└── .hh-answer-bar        footer in normal flow
```

- `.hh-round-back` is the "Back to pending" button at the start of the head; `.hh-round-policy` is the policy line in the head, hidden while the Round sits beside the bay (its strip already shows the policy and timer).
- Layout: `.hh-command` is an `inline-size` container (`hh-command`) around `.hh-command-grid`, which holds the bay and `.hh-command-panel` (the open Round). From a 48rem container the two sit side by side; below it `data-view="queue|round"` shows one at a time.

- **Fit.** The Round's height is the viewport space below its own top offset (`--round-top`, measured by the bay when the Round starts in the first half of the viewport), less `--hh-density-inset`. Head and Answer bar stay in view on entry at 1440 × 900 and 390 × 844; only `.hh-round-body` scrolls. Deeper in a long page the Round falls back to a sticky fit below the app bar.
- **Expired or cancelled while open.** The Round stays on screen (`data-state="ended"`): the badge reads Expired or Cancelled, the Answers and notes stay visible but read-only, and the Answer bar swaps Send for the "Not sent" alert, **Copy draft** and **Back to pending** (see the Answer bar states). Its strip has already left the bay for the answered log, which records the draft as "Not sent".
- Keys: `1`–`9` act on the current Question; `a`/`r` act only when the current Question is approve/reject (never on another Question in the Round); `n` opens notes; `⌘↵` sends; `Esc` goes back to pending.

## Page-scroll Round — `.hh-round[data-layout="page"]`

The Round in the Feed and on Round detail: fully expanded, and **the page scrolls, not the Round**.

```
li.hh-strip.hh-feed-item[data-status]       holder, status word in .hh-strip-tab, timer on the bottom edge
└── .hh-strip-paper
    └── form.hh-round[data-layout="page"][data-state="ended"?][aria-labelledby]
        ├── .hh-round-head                   callsign, project · branch, badges, h2/h3.hh-strip-header.hh-round-title[tabindex="-1"], context (.hh-prose), .hh-policy-badge, links, Round attachments
        ├── .hh-round-note                   ended in place: the Outcome sentence on the paper (optional)
        └── .hh-round-flow                   everything after the head; the sticky bar's containing block
            ├── ol.hh-round-questions        li.hh-advisor-row (first, when a run exists), li.hh-question …
            ├── details.hh-notes             notes (.hh-notes-summary "Add notes for CALLSIGN (optional)" + n)
            ├── .hh-inline-panel | .hh-round-error
            └── .hh-answer-bar[data-sticky="true"]   the Round's own action bar
```

- **Page-scroll vs sheet-fit.** Use `data-layout="page"` (and no `.hh-round-body`) wherever several Rounds stack in one column or the Round is the whole page: the Feed, Round detail. Use the sheet-fit Round (`.hh-round-body` inside, the only scrolling part) only beside the strip bay or in the phone sheet. A page-scroll Round has no max height, `.hh-round-body` (if present) does not scroll, and Attachments run **full height**: diffs and prose are never capped; only a code plane (`pre.hh-attachment-body`) keeps `--hh-code-max-height`, because logs can be thousands of lines.
- **Sticky action bar.** `.hh-answer-bar[data-sticky="true"]` sticks to the viewport's bottom edge while its Round spans it, so only the bar of the Round in view sticks. Its containing block is `.hh-round-flow`, which starts after `.hh-round-head`, so the bar never rises over the Round head or title: while only the head of the next Round has scrolled into view, its bar waits below the fold. It carries a full-width top border. Its actions wrap to a second row in narrow columns. The last Question stays reachable because the bar sits in the Round's flow after it, and the page sets `scroll-padding-block` (two bar rows at the end) so a focused control is never hidden under the bar (SC 2.4.11).
- **Round title.** `.hh-round-title` beside `.hh-strip-header` keeps sentence case and normal tracking in every theme, because Round titles are long; core themes would otherwise uppercase the strip-header face.
- **Head badges**, in this order after the callsign and project: the Outcome word (ended), "n of m locked · Round stays pending" (warning, lock icon), Lock soon ([feed-widgets.md](feed-widgets.md)), "Replaces r_…" (info, refresh icon) and "Draft carried over".
- **Ended in place** (`data-state="ended"`): expired (its last Question locked), superseded, or cancelled by the Agent or by Forget. Questions read-only (`fieldset[disabled]`, ink unchanged), the bar never sticks and swaps its actions for the "Not sent" alert, **Copy draft** and **Remove from feed** (ghost, trash icon, `aria-label="Remove from feed r_…"`). The strip's holder turns `expired` with the Outcome word in its tab. Removing it announces "r_… removed from the Feed · it stays in the answered log".
- Keys: as in the Feed keyboard map ([feed-widgets.md](feed-widgets.md)).

### Supersede

An Agent may send a Round that **replaces** an earlier Pending one (`supersedes: r_…`).

| Where | Shows |
|---|---|
| New Round's head | `.hh-badge[data-tone="info"]` "Replaces r_5b2f90cd" (refresh icon); "Draft carried over" when the Draft moved with it |
| New Round's position | The predecessor's position in the Feed; the predecessor stays in place, ended, directly after it |
| Old Round, ended in place | Holder `expired`, tab "Cancelled"; the locked Question meta reads "Cancelled by supersede · 14:04"; bar alert badge "Not sent": "Cancelled · Replaced by r_e41a6b02 at 14:04. Your Draft was carried over to it." with the link **Open r_e41a6b02** (`.hh-link` to the new Round's anchor) |
| Answered log | Outcome "Cancelled", Delivery column "Replaced by r_e41a6b02" |
| Live region | "r_5b2f90cd cancelled · replaced by r_e41a6b02" |

## Question — `.hh-question`

One decision inside a Round.

### Anatomy

```
.hh-question [data-current="true"]
├── .hh-question-call       the call: what is asked
│   ├── .hh-question-meta   "Q1 of 3", kind in words, .hh-policy-badge when it differs from the Round
│   ├── .hh-question-prompt the Question text (body-lg, semibold)
│   └── .hh-attachment*     context attachments
└── fieldset.hh-question-response  the response: options or a field; legend repeats the prompt for AT
```

- The kind is always in words: "Choose one", "Choose any", "Free text", "Approve or reject".
- `data-current="true"` marks the Question that keyboard shortcuts act on: a thick `--hh-ring` outline inside its edge.
- For free text, the response is a `.hh-field` with a `.hh-textarea` labelled by the prompt.
- Tokens: `--hh-strip`, `--hh-strip-foreground`, `--hh-type-body-lg-*`, `--hh-border`, `--hh-ring`, `--hh-density-inset`, `--hh-layout-measure`.

### Kinds

| Kind | Response | APG pattern | Keys |
|---|---|---|---|
| Single choice | `.hh-option` rows with radios | [Radio group](https://www.w3.org/WAI/ARIA/apg/patterns/radio/) | ↑/↓ move and select; `1`–`9` select directly |
| Multiple choice | `.hh-option` rows with checkboxes | [Checkbox](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/) | Tab between, Space toggles; `1`–`9` toggle |
| Free text | `.hh-textarea` in `.hh-field` | — | Typing; `⌘↵` submits the Round |
| Approve/reject | `.hh-approve-pair`: two `.hh-option` radios, Approve and Reject | Radio group | `a` approve, `r` reject, arrows |

States: unanswered; answered (`.hh-answer-state` in the meta reads "Answered"); invalid (Submit tried while unanswered: `.hh-error` "Choose one option"); locked (below); read-only in the log (shows the value and who set it: "You", "Policy: applied recommended").

Children that span both columns of a Question (alerts, `.hh-question-draft`, the Advisor markers) take `grid-column: 1 / -1`.

### Locked Question — `.hh-question[data-state="locked"]`

A Question whose own deadline fired while the Round stays Pending (other Questions are still open).

- Meta: `.hh-badge[data-tone="expired"]` with the `lock` icon and "Locked", then the sentence "Policy applied recommended · 13:59" or "Policy cancelled · 13:59".
- Response: the applied value, read-only (`fieldset[disabled]`). Rows keep the paper's ink at full contrast; nothing dims. The applied recommended row reads "Recommended · applied".
- Draft: if the Human had chosen something else, `.hh-alert.hh-question-draft[data-tone="warning"]` with badge "Not sent" (expired tone), "Draft kept", "You had chosen Saturday, 09:00 when the Lock fired. A policy never sends a Draft." and **Copy draft** (copy icon). The per-Question Draft copies as plain text: `r_7f3a91c0 · Q4 Roll out in which window? · Draft: Saturday, 09:00 (not sent; policy applied recommended at 13:59)`; the result is announced ("Draft copied").
- Round head: "n of m locked · Round stays pending". When the last open Question locks, the Round ends in place as expired.
- Tokens: `expired`, `expired-foreground`, `warning`, `strip-foreground`.

## Option — `.hh-option`

One choice row; the whole row is the `<label>` and the target.

- Anatomy: `.hh-kbd` digit hint (1–9, an empty slot when read-only), the native radio or checkbox, `.hh-option-text` (optional `.hh-recommended`, `.hh-option-label`, optional `.hh-option-detail`). Long labels wrap (`overflow-wrap: anywhere`) instead of widening the row.
- Min height `--hh-option-row-min-height`, which glance density raises.
- Checked: thick border in `--hh-strip-foreground` around the whole row, the native control checked. Never fill colour alone.
- Approve/Reject: the two rows sit side by side in `.hh-approve-pair`, with a gap so a thumb cannot hit both. Labels are the Agent's wording when given ("Approve deploy to prod"), otherwise "Approve" / "Reject".
- Above 9 options, rows 10+ have no digit hint.
- Read-only (locked Question, ended Round, log): the input is disabled and the cursor is the default; ink and boundaries stay as they are.
- Tokens: `--hh-option-row-min-height`, `--hh-strip`, `--hh-strip-foreground`, `--hh-border`, `--hh-border-width-thick`, `--hh-kbd-size`, `--hh-radius-md`.

## Recommended marker — `.hh-recommended`

Marks the option the Agent recommends. It is a marker, not a Round status.

- The row gets `data-recommended="true"`: a thick `--hh-recommended` border on every side of the row (3:1 against `strip` and `background`). Once the row is chosen, the chosen boundary (`--hh-strip-foreground`) replaces it; the word stays.
- Inside the row, `.hh-recommended` is a label in `--hh-recommended` / `--hh-recommended-foreground` with the `check` icon and the word "Recommended". When the Question's policy is "apply recommended", it reads "Recommended · applied if unanswered"; on a locked Question whose policy applied it, "Recommended · applied". Long markers wrap on narrow screens.
- The marker is part of the option's accessible description, so it is heard with the option.
- It never preselects the option. The Human chooses.

### Free-text Recommended — `.hh-recommended-text`

For `kind: text` Questions with a recommended answer.

- Anatomy: `.hh-recommended-text` (thick `--hh-recommended` boundary on every side) > `.hh-recommended` "Recommended", the text in quotes in `.hh-recommended-text-quote` (italic, measure-capped), and **Use it** (`.hh-button[data-size="sm"]`, `aria-describedby` the quote). Then the Question's own `.hh-field` with an empty textarea.
- **Never prefilled.** Use it copies the text into the field and moves focus there; the Human may edit it. The placeholder reads "Write your own, or use the recommended text."
- Tokens: `recommended`, `recommended-foreground`, `border-width-thick`, `layout-measure`.

## Attachment — `.hh-attachment`

Context an Agent attaches to a Question: diff, code, file or link.

- Anatomy: `.hh-attachment-head` (kind icon, `.hh-attachment-title` in mono, summary, actions: Copy, Expand, Open raw), then a body.
- Code: `pre.hh-attachment-body` on `--hh-code` / `--hh-code-foreground`, mono type, max height `--hh-code-max-height`, scrolls both ways; focusable with an accessible name when it scrolls ("Attachment: client.ts, lines 1–40").
- File or link: `.hh-attachment-row` with name, size or host, and the Agent's description. External links say they open a new tab.
- Missing: "Attachment not available · the Agent's session ended".
- Kind icons: `diff`, `code`, `file`, `link`, `markdown`, `image` from the icon set ([navigation-and-chrome.md](navigation-and-chrome.md), Icons).
- Tokens: `--hh-surface-card`, `--hh-surface-card-foreground`, `--hh-code`, `--hh-code-foreground`, `--hh-code-max-height`, `--hh-type-mono-*`, `--hh-border`.

### Markdown Attachment — `.hh-attachment-prose`

- Body: `.hh-attachment-prose.hh-prose`, the **reading plane**: `--hh-strip` / `--hh-strip-foreground`, body type, padding `--hh-space-3` `--hh-space-4`, never a texture.
- `.hh-prose` is the markdown typography, also used for a Round's context in the head: block children capped at `--hh-layout-measure`, headings at body-lg semibold, lists indented, links underlined in the surrounding ink, inline `code` and `pre` blocks on the code plane (`--hh-code` / `--hh-code-foreground`), tables with `--hh-border` rules on every cell, blockquotes indented and italic (never a side rule). First and last children have no outer margin.
- Markdown is rendered without raw HTML; links open in a new tab and say so. A `pre` block scrolls sideways, so it is focusable (`tabindex="0"`) with a name ("Code block in docs/runbooks/invoices-v2.md").

### Image Attachment — `.hh-attachment-image`

- Formats: PNG, JPEG, WebP, GIF. **Alt text is required.** Head: `image` icon badge "Image", file name in mono, "PNG · 640 × 360", **Expand** / **Fit** (`aria-pressed`).
- Body: `.hh-attachment-image` on `--hh-surface-shelf`, the image centred, at most 100% wide and `--hh-code-max-height` tall (the same cap as a code plane), `object-fit: contain`, a `--hh-border` boundary. `data-state="expanded"` removes the height cap; a dialog shows it full size.
- No alt text: the image is not rendered. `.hh-attachment-row` with the alert icon: "Image not shown · the Agent sent no alt text. Ask it to describe the image."
- Not loaded (`img` error): "Image not available · the Agent's session ended".
- A GIF never loops for the Human under reduced motion: show its first frame and **Play**.
- Tokens: `--hh-surface-shelf`, `--hh-surface-shelf-foreground`, `--hh-border`, `--hh-code-max-height`.

## Diff — `.hh-diff`

A diff attachment: `ul.hh-diff` inside `.hh-attachment-body`.

- Head: file path in mono and the summary "+12 −3".
- Lines: `li.hh-diff-line[data-kind="add|remove"]` (context lines have no `data-kind`), each with a `.hh-diff-sign` gutter (`+`, `−`, blank) as visible text and visually hidden "Added"/"Removed". Backgrounds `--hh-diff-add` / `--hh-diff-remove` with `--hh-code-foreground` text (≥ 4.5:1 on both).
- Long unchanged runs (**8 or more** context lines) fold behind a [disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/), collapsed by default: `li.hh-diff-fold` (dashed `--hh-border` above and below) > `details` > `summary.hh-diff-fold-summary` (`chevron-right` icon, turns a quarter when open, then "Show 12 unchanged lines", mono-sm, at least `--hh-control-size-sm` tall) + a nested `ol.hh-diff` with the folded lines. Runs of 7 or fewer always show.
- Expand opens the full diff in a dialog.

## Proposal — `.hh-proposal`

An approve/reject Question may carry a **Proposal**: the exact text, command or JSON the Agent will act on. With `editable: true` the Human may edit it, then approve.

```
figure.hh-attachment.hh-proposal[data-state="read|edit|edited|invalid"]
├── figcaption.hh-attachment-head   format badge (code icon: "Command" | "Text" | "JSON"), "Editable" (info) or "Read-only" (lock icon),
│                                   "Edited" (warning, check icon) once changed, title "Proposal · command", Edit / Done (aria-expanded)
├── pre.hh-attachment-body          read state: the Proposal on the code plane
├── .hh-proposal-edit               edit state: .hh-field > label "Edit the command before approving",
│                                   textarea.hh-textarea.hh-proposal-input (mono, no wrap, spellcheck off), .hh-hint, .hh-error
└── details.hh-proposal-original    edited: "CALLSIGN's version" with the original on the code plane and **Reset to CALLSIGN's version**
```

- **Edited.** Once the text differs from the Agent's version: the "Edited" badge, the Approve option label reads **"Approve (edited)"**, and approving sends the edited value with `edited: true`. Reset restores the Agent's version and removes the badge.
- **JSON.** `data-state="invalid"` while the edited JSON does not parse: `aria-invalid` on the textarea and `.hh-error[role="alert"]` "The edited JSON does not parse." Approve stays available but Send reports "Fix the JSON in Q2 to send".
- **Read-only** Proposals show only the read state with the "Read-only" badge.
- Answer bar tally: an edited approval counts as approved and is named: "Poll · 1 approved (1 edited) · 0 rejected". Log value: "Approve (edited)".
- Flight Director signature: the GO / NO-GO call is unchanged by editing; GO latches when "Approve (edited)" is chosen, and the "Edited" badge says why the label differs.
- Tokens: `code`, `code-foreground`, `info`, `warning`, `type-mono-*`, `space-3`.

## Answer bar — `.hh-answer-bar`

The footer of the open Round, in normal flow below the scrolling body, that submits the **whole** Round.

- Anatomy: `.hh-answer-bar-row` with `.hh-answer-progress` ("2 of 3 required answered" in `.hh-mono-sm`, plus, for a Round with two or more approve/reject Questions, `.hh-answer-tally` "Poll · 1 approved · 0 rejected · 1 open" as muted secondary metadata) and Submit (`.hh-button[data-variant="primary"]` "Send Answer" + `<kbd class="hh-kbd">⌘↵</kbd>`, `aria-keyshortcuts="Meta+Enter Control+Enter"`). The tally is real text derived from the Answers, in the bar's accessible subtree; a Round with a single approve/reject Question has no tally, because its own Question already states the call. Notes fold into `.hh-notes` above the bar; its toggle is `summary.hh-notes-summary` ("Add notes for CALLSIGN (optional)" with the `n` key cap).
- In the Feed the bar is the Round's **action bar**: progress, then **Dismiss** `d` (destructive), **Redirect** `e`, **Ask advisor** `v` (each `aria-expanded` for its inline panel, [feed-widgets.md](feed-widgets.md)), then **Send Answer** `⌘↵`; `data-sticky="true"` while the Round is pending.
- Tokens: `--hh-surface-tray`, `--hh-surface-tray-foreground`, `--hh-muted-foreground` (tally), `--hh-border` (top edge, full width), `--hh-layer-raised`, `--hh-density-inset`, `--hh-button-min-target`.

| State | Shows |
|---|---|
| Incomplete | Submit stays focusable with `aria-disabled="true"` and the reason "Answer Q2 to submit"; pressing it moves focus to the first unanswered Question |
| Ready | "Submit Answer · 3 of 3" |
| Sending | `aria-busy="true"`, "Sending…"; responses read-only |
| Sent | The strip leaves the bay (or the Round leaves the Feed) for the answered log; toast "Answered · CLAUDE·api-refactor"; focus to the next pending strip or Round |
| Dismissed / Redirected | As Sent, with the Outcome word: "Dismissed · CLAUDE·api-refactor", "Redirected · CLAUDE·api-refactor" |
| Failed | `.hh-alert[data-tone="destructive"]` with `role="alert"`: "Not sent · Hub unreachable · your Answer is kept on this page · Retry" |
| Expired while drafting | Alert once (`.hh-alert[data-tone="warning"]`, `role="alert"`, badge "Not sent"): "Expired 14:10 · policy applied recommended. Your draft is kept below and in the answered log." Answers and notes stay visible, read-only; the bar offers **Copy draft** (plain text: Round, each Question with its value, notes; the result is announced in a status line) and **Back to pending** (returns to the first pending strip) or, in the Feed, **Remove from feed**. Phone and desktop alike |
| Cancelled while drafting | "Cancelled 14:06 by policy" (or "by CLAUDE·api-refactor", "by Forget", "Replaced by r_…"); same draft handling |
| Offline | Before any press, Send carries `aria-disabled="true"` and `aria-describedby` pointing at the visible reason "Offline · Cannot send until the Hub is reachable. Your Answers stay here." Pressing it does nothing else; the draft is kept |

The bar never auto-submits, and a policy firing never sends the Human's draft.

## Agent recipe

- Feed (the Hub's triage): holders around page-scroll Rounds (`form.hh-round[data-layout="page"]`) with `.hh-question` blocks and a sticky `.hh-answer-bar[data-sticky="true"]` ([feed-widgets.md](feed-widgets.md)).
- Strip-bay triage (reference): `.hh-strip-bay` (listbox on desktop, list of buttons on phone) beside a sheet-fit `.hh-round` with `.hh-round-body` and the `.hh-answer-bar`.
- Every strip: holder with its status word in `.hh-strip-tab`, callsign, policy sentence, mono meta, timer when the policy has a deadline.
- Tokens: `strip`, `strip-foreground`, `pending`, `answered`, `expired`, `recommended`, `code`, `code-foreground`, `diff-add`, `diff-remove`, `ring`, `strip-min-height`, `strip-holder-width`, `timer-track-height`, `option-row-min-height`, `kbd-size`, `code-max-height`.
