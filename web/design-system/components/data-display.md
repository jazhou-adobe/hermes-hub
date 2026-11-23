# Data display

Tables, list rows, progress, alerts and charts. In Hermes these show the answered log, the roster, Agent detail and Hub status.

## Table — `.hh-table`

Used for the answered log (desktop), the roster table and the token list.

- Anatomy: `.hh-table-wrap` (scrolls horizontally on narrow screens; `position: relative`, so visually hidden header text is clipped by the wrap instead of widening the page) > `<table class="hh-table">` with `<caption>` (visible or `.hh-visually-hidden`), `<thead>` with `scope="col"` headers, `<tbody>` rows, an optional last cell of row actions. Buttons in cells wrap their label rather than widen the table.
- Tokens: inherits the surface it sits on; `--hh-border` rules under every row (full width, never a one-side stripe); `--hh-density-row-height`; headers in uppercase label type on `--hh-muted-foreground`; `td[data-numeric]` or `td.hh-mono` for ids, callsigns, counts and times in mono tabular numerals.
- Sortable columns use a button in the header with `aria-sort` on the `th`.
- Compact density is the default for tables in the Command Center.
- A static table is not a grid: arrow-key navigation is only for the strip bay ([round-widgets.md](round-widgets.md#strip-bay--hh-strip-bay)).

Answered log columns: Outcome (word), Round (title, callsign, id), Values and who set them, Delivery, Ended (HH:MM); see [status-widgets.md](status-widgets.md) (Answered log). The Outcome column always shows the word.

- **Search match**: `mark.hh-match` on `--hh-primary` / `--hh-primary-foreground` around each match; the count is in words beside the results ("1 match for "invoice"").
- **Filter tray**: `.hh-filter-tray` (bordered, `--hh-density-inset` padding) holds the search field (capped at `--hh-layout-measure`), chip groups (`role="group"` with a label each) and `.hh-filter-tray-actions` (export actions, the count, Clear filters).

## Description list — `.hh-dl`

Two columns: `dt` (label, body-sm, `--hh-muted-foreground`) and `dd` (value, wraps anywhere). On strip paper, muted ink never passes contrast, so inside `.hh-strip-paper` or `.hh-round`, or on `.hh-dl[data-plane="strip"]`, the `dt` takes the paper's own ink in bold instead; the same rule gives `.hh-hint`, `.hh-muted` and table headers the paper ink there.

## List row — `.hh-list-row`

`ul.hh-list` of `li.hh-list-row`: a single-line row for narrow screens and shelves: leading callsign or icon, `.hh-list-row-main` (title, grows), trailing meta (mono), optional action.

- Min height `--hh-density-row-height`, full-width `--hh-border` under each row; in glance density the whole row is a ≥ 3rem target.
- When the whole row is a link, the link covers the row and inner actions are not nested inside it.

## Progress — `.hh-progress`

`.hh-progress` > `.hh-progress-head` (label and "2 of 3" in mono) and `.hh-progress-track` (`--hh-muted` with a `--hh-border` boundary, height `--hh-progress-track-height`) > `.hh-progress-fill` (`--hh-primary`, `scaleX(var(--progress-value))`). The track is `role="progressbar"` with `aria-valuenow`, `aria-valuemax` and `aria-valuetext` in words.

- Round completeness in the Answer bar: "2 of 3 Questions answered".
- Not used for the policy timer, which is its own widget ([status-widgets.md](status-widgets.md#policy-timer--hh-policy-timer)).

## Alert — `.hh-alert`

Inline message: a `.hh-badge` with icon and status word in the first column, then a title and a sentence.

- Tones (`data-tone`): `info`, `success`, `warning`, `destructive`. The alert stays on `--hh-surface-card` and its border on every edge takes the tone role; the badge carries the matching `data-tone`, so the word, not the colour, says what kind of message it is.
- Never a side rail.
- `role="status"` for information; `role="alert"` only for blocking failures ("Not sent · Hub unreachable").
- Copy: status word, cause, next step. "Offline · the Hub stopped responding at 14:02 · Answers cannot be sent · drafts stay on this page."

## Chart

Hermes has few charts: Rounds per hour on the Hub status card, and Answer latency per Agent in Agent detail.

- Series take `--hh-chart-1` … `--hh-chart-5` (≥ 3:1 against card, panel and background), with direct labels or markers as well as colour.
- Every chart has a one-sentence summary and a data table.
- Values in mono with tabular numerals.

## Stat

A number with its label: "Pending · 3", "Median answer · 1m 12s". Number in `mono` at `heading-md` size, label in `label`. No trend arrows without words ("up 2 since 14:00").

## Agent recipe

- Log: table in compact density, status word column, callsign column, mono times.
- Phone log: list rows in glance density.
- Tokens: `surface-card`, `surface-shelf`, `border`, `muted`, `primary`, `chart-*`, `density-row-height`, `progress-track-height`, `type-mono-*`.
