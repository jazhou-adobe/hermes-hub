# Status widgets

Live and system state: the Unanswered Policy timer and badge, the connection status, live values, keyboard hints and the answered log. Glow (`--hh-elevation-live`) appears only here, and only while the state is live: the connection lamp while streaming and a live value while it updates.

## Policy timer — `.hh-policy-timer`

The Unanswered Policy countdown along the bottom edge of a strip's holder.

### Anatomy

```
.hh-policy-timer [data-policy="wait"]   rail at --hh-timer-track-height, in the holder colour
└── .hh-policy-timer-fill               holder-foreground fill, scaleX(var(--timer-fraction))
```

- The rail takes `--holder` (falling back to `--hh-muted`) and the fill takes `--holder-foreground`, so the timer always matches its strip's status and passes the same contrast pair.
- `--timer-fraction` (0–1) is set by script from the remaining time; the fill shrinks from the end on `--hh-easing-linear`.
- **Strict Content-Security-Policy.** A page whose policy blocks `style=""` attributes in markup (no `'unsafe-inline'` for styles) has two paths. Script may set the property through the CSSOM (`element.style.setProperty('--timer-fraction', '0.42')`, or React's `style` prop in a client-rendered app), which such a policy allows. Static or server-rendered markup sets `data-fill="0…100"` in steps of 5 on `.hh-policy-timer-fill` (or `.hh-progress-fill`): the stylesheet maps each step to `--timer-fraction` and `--progress-value`. Round to the nearest step; the written time stays exact.
- `data-policy="wait"` (keep waiting) has no countdown: the fill becomes a dashed rail and the strip's policy text reads "keeps waiting · 12m".
- The time and the policy are always written out in the strip (`.hh-strip-policy`: "09:58 · then applies recommended"). The rail is never the only signal.
- Thresholds at 5 min and 1 min add the words "5 min left" / "1 min left" to the policy text. The timer does not turn red: it is not an error.
- When the policy fires, the strip's `data-status` becomes `expired`, the fill empties, and the policy text reads "Policy applied recommended at 14:10" or "Cancelled by policy at 14:10".
- Accessibility: the rail is decorative (`aria-hidden="true"`). The policy text is the accessible source and reads the remaining time when focused. Threshold announcements come from the bay status region ([accessibility.md](../foundations/accessibility.md#live-regions)); nothing announces every second.
- Reduced motion: `--timer-fraction` updates once per second and the transition collapses, so the fill steps instead of draining.

### Policy badge — `.hh-policy-badge`

A cluster in the Round head and Question meta naming the policy in words: `.hh-badge` "Policy" + "keep waiting" / "apply recommended" / "cancel", with the deadline in mono when there is one ("at 14:10"). A popover button ("What happens at zero?") explains the consequence for the Agent.

### Per-Question policy

When a Question declares its own Unanswered Policy, its meta carries a `.hh-policy-badge` with `.hh-badge[data-tone="info"]` "Own policy" (clock icon) and the consequence and time left in mono: "cancels at 14:12:07 · 05:47 left" or "applies recommended at 14:12:07 · 05:47 left". It counts toward the Round's next Lock and Lock soon ([feed-widgets.md](feed-widgets.md)). When it fires, the Question locks ([round-widgets.md](round-widgets.md), Locked Question).

### Tokens

`--hh-timer-track-height`, `--hh-strip-holder-width`, `--hh-pending`, `--hh-answered`, `--hh-expired` and `-foreground` pairs (through `--holder`), `--hh-muted`, `--hh-easing-linear`, `--hh-motion-standard`, `--hh-type-mono-*`.

## Connection — `.hh-connection`

The Command Center's link to the Hub over SSE, in the app bar.

- Anatomy: `.hh-connection-lamp` (decorative), the state word, `.hh-connection-detail` (mono, tabular: "since 13:58", "retry in 4 s", "last update 14:02").
- `data-state`:

| `data-state` | Lamp | Word | Detail |
|---|---|---|---|
| `live` | Filled `--hh-live`, with `--hh-elevation-live` glow | Live | since HH:MM |
| `reconnecting` | Filled `--hh-warning`; a bounded fade on `--hh-motion-pulse`, four iterations, then steady | Reconnecting | retry in N s |
| none (offline) | Hollow ring in `--hh-expired` | Offline | last update HH:MM |

- The word is always shown, also on phone. The lamp never loops forever and never flashes (the fade is slower than three per second).
- The surface's one operational readout is a polite `role="status"` region (`<ConnectionStatus live />` in the preview) and announces changes: "Reconnecting · retry in 4 s", "Live". Each surface shows one readout: the app bar's, or the bay head's where there is no app bar. Static specimens of the widget are not live regions.
- Activating the widget opens a popover with the Hub URL, exposure (local or tailnet) and "Reconnect now".
- Tokens: `--hh-live`, `--hh-warning`, `--hh-expired`, `--hh-elevation-live`, `--hh-motion-pulse`, `--hh-icon-size`, `--hh-control-size-sm`, `--hh-border`, `--hh-muted-foreground`, `--hh-type-label-*`, `--hh-type-mono-sm-*`.

## Live value — `.hh-live-value`

A number that is streaming now, such as the pending count in the app bar and bay head. Mono, tabular.

- `data-live="true"` while SSE is live: `--hh-live` / `--hh-live-foreground` fill with `--hh-elevation-live`. When reconnecting or offline, `data-live` is removed and the value shows plain, with the connection widget saying why.
- The digits change in place; no odometer roll.
- The value is not itself a live region; the bay status region announces meaningful changes.

## Keyboard hints — `.hh-kbd-hints`

The visible key map.

- Inline: each control with a shortcut shows a trailing `.hh-kbd` and declares `aria-keyshortcuts`.
- List: `ul.hh-kbd-hints` under the bay in compact density, one `li` per key: "`j` `k` move · `Enter` open · `1`–`9` choose · `a` approve · `r` reject · `⌘↵` submit · `?` all keys".
- Panel: `?` opens a dialog with every shortcut by context and the "Single-key shortcuts" switch.
- Hidden in glance density (no keyboard); the panel stays reachable from settings.
- Key caps are `<kbd>` text with a word alternative for screen readers ("Command Enter").
- Tokens: `--hh-kbd-size`, `--hh-surface-shelf`, `--hh-surface-shelf-foreground` (key caps), `--hh-border`, `--hh-type-body-sm-*`, `--hh-type-mono-sm-*`.

## Answered log — `.hh-answered-log`

The record of every Round that left the Feed (or the bay) or ended in it: answered, dismissed, redirected, expired, cancelled.

- Desktop: `.hh-answered-log` wraps a `.hh-table` in compact density ([data-display.md](data-display.md#table--hh-table)), newest first, grouped by day: each day opens its own `tbody` with a heading row `tr.hh-answered-log-day > th[scope="colgroup"]` ("Today · 20 Nov") on `--hh-surface-shelf`.
- Phone: entries render as articles in an [APG feed](https://www.w3.org/WAI/ARIA/apg/patterns/feed/): `role="feed"`, `role="article"` entries, `aria-busy` while loading more, Page Down / Page Up between articles.
- Columns: **Outcome** (badge with the word: Answered in the answered tone; Dismissed, Redirected, Expired, Cancelled in the expired tone), **Round** (title, callsign, id in mono), **Values and who set them** (`ul.hh-log-values`: "Q1 Approve (edited) · You", "Q2 Three retries · suggested by codex-review", "Q1 Approve · Policy: applied recommended", a Redirect message or Dismiss note; the setter in `.hh-log-setter`), **Delivery**, **Ended** (HH:MM).
- Delivery, in words: "Delivered 13:34:09" (mono) once the Agent picked the Answer up; "Waiting for pickup · since 11:02" while it has not; `.hh-badge[data-tone="warning"]` "Not picked up · Agent gone" when the session ended first; "Replaced by r_…" for a superseded Round.
- Drafts that were never sent show "Not sent" with the draft text.
- Filter tray (`.hh-filter-tray`, [data-display.md](data-display.md)): search over titles and values, Outcome chips, callsign, project and date chips; `.hh-filter-tray-actions` holds **Copy as Markdown** and **Export JSON** and the count ("Showing 5 of 41 · 1 match for "invoice""). Search matches are marked with `mark.hh-match`.
- Empty: "No answered Rounds yet." (`.hh-empty-state`). Filtered empty: "No Rounds match · Clear filters".
- Tokens: `--hh-answered`, `--hh-expired`, `--hh-warning`, `--hh-surface-card`, `--hh-surface-shelf`, `--hh-primary` (match), `--hh-border`, `--hh-density-row-height`, `--hh-type-mono-*`, `--hh-overlay-tooltip-width` (outcome column minimum).
