# Accessibility Foundation

Accessibility is a gate, not a cleanup pass. WCAG 2.2 is the baseline and the WAI-ARIA Authoring Practices Guide (APG) is the widget-behaviour reference ([mature-design-system-references.md §7](../research/mature-design-system-references.md#7-accessibility-baseline)). The success criteria and their token implications are in [theme-token-architecture-sources.md](../research/theme-token-architecture-sources.md).

The Human is one developer triaging beside terminals, often keyboard-only, sometimes on a phone. Hermes is built for that person first and for every person who might take their seat.

## Contrast

Gates, measured by `validation/validate-design-system.mjs` in every theme and every world colour option. Ratios are truncated, never rounded up (SC 1.4.3, SC 1.4.11):

- Every `<role>` / `<role>-foreground` pair ≥ 4.5:1, including `strip`/`strip-foreground`, `pending`/`pending-foreground`, `code`/`code-foreground`.
- `code-foreground` on `diff-add` and on `diff-remove` ≥ 4.5:1, so diff lines stay readable without their colour.
- `muted-foreground` on `background`, every surface and `muted` ≥ 4.5:1. Strips never use `muted-foreground`; they use `strip-foreground`.
- `border` and `ring` against every surface, `strip` and `input` ≥ 3:1.
- `pending`, `answered`, `expired` and `recommended` as holder boundaries against `strip` and `background` ≥ 3:1.
- `agent-1` … `agent-6` and `chart-1` … `chart-5` against `surface-card`, `surface-panel` and `background` ≥ 3:1.

Reading planes (Question text, attachments, free-text answers) are opaque. Text never sits on a texture, glow or translucent layer.

## Non-colour status

Colour is backup, never the only signal (SC 1.4.1 Use of Color). Each state has a word and a shape.

| State | Required cue besides colour |
|---|---|
| Pending | Status word "Pending" in the holder's tab, first in the strip; policy sentence; timer fill |
| Answered | "Answered" + check icon in the tab; Answer summary line |
| Expired | "Expired" in the tab; sentence naming what the policy did |
| Cancelled | "Cancelled" in the tab; who cancelled and when |
| Recommended option | "Recommended" tab on the option; never a green tint alone |
| Callsign | The callsign text; colour only separates Agents |
| Diff add / remove | `+` / `−` gutter sign and "Added"/"Removed" in the line's accessible name |
| Connection | Word "Live", "Reconnecting" or "Offline" beside the lamp |
| Destructive (Reject, Cancel Round) | Destructive verb and icon |

## Keyboard-first triage

Triage must be fully operable from the keyboard, with every shortcut shown on screen.

### Focus model

- **Strip bay**: one Tab stop on desktop. Inside it, a roving `tabindex` moves focus between strips ([APG keyboard interface, roving tabindex](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)). The bay is a `role="listbox"` of strips when strips are single, selectable items, or a `role="grid"` when each strip has inner controls (see [round-widgets.md](../components/round-widgets.md#strip-bay--hh-strip-bay)). On phone (the stacked, narrow-container flow) it is a plain list whose strip heads are native buttons, so Tab and screen-reader swipe reach every strip without roving focus. Only actionable (pending) strips are in the bay; expired and cancelled Rounds move to the answered log. Live arrival uses the [APG feed](https://www.w3.org/WAI/ARIA/apg/patterns/feed/) only for the answered log, which loads more as the Human reads.
- **Open Round**: one Tab stop per Question group, then the Answer bar. Single choice is an [APG radio group](https://www.w3.org/WAI/ARIA/apg/patterns/radio/) (arrows move and select); multiple choice is a group of [APG checkboxes](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/); approve/reject is a two-option radio group with text labels.
- Focus order follows the Round: Questions top to bottom, notes, then Submit.
- New Rounds never steal focus. They join the bay and are announced ([live regions](#live-regions)).
- After Submit, focus moves to the next pending strip in the bay, or to the empty-bay heading if none remain.
- Focus is never hidden under the sticky Answer bar or app bar (SC 2.4.11 Focus Not Obscured).

### Shortcut map

| Keys | Action | Where active |
|---|---|---|
| `j` / `k` (and ↓ / ↑) | Next / previous strip | Strip bay has focus |
| `Enter` | Open the focused strip | Strip bay |
| `1`–`9` | Choose option 1–9 in the focused Question | Open Round, focus not in a text field |
| `a` / `r` | Approve / Reject the focused approve/reject Question | Open Round, focus not in a text field |
| `n` | Move to the notes field | Open Round |
| `⌘↵` / `Ctrl+Enter` | Submit Answer for the whole Round | Anywhere in the open Round, including text fields |
| `Esc` | Close the open Round and return focus to its strip | Open Round, overlays |
| `?` | Show the keyboard hints panel | Command Center |

Rules:

- **Single-character shortcuts are scoped** (SC 2.1.4 Character Key Shortcuts): letter and digit keys act only while focus is inside the strip bay or the open Round, never page-wide, and never while focus is in a text field. Settings → Notifications and keys has a switch to turn single-key shortcuts off.
- **Don't collide with screen readers.** In browse mode, screen readers use single letters for quick navigation. Hermes never listens for letters on the document; they reach the page only when a composite widget (listbox, grid, radio group) has focus. Modifier shortcuts avoid browser and screen-reader chords.
- **Visible hints.** Every shortcut is shown as a `.hh-kbd` hint beside its control and in `.hh-kbd-hints`, and declared on the control with `aria-keyshortcuts` ([WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/#aria-keyshortcuts)). Hints are `<kbd>` text, not icons.
- **Pointer parity.** Every keyboard action has a visible control, and every control has a keyboard path.

## Live regions

Announcements follow SC 4.1.3 Status Messages: they are read without moving focus.

| Event | Region | Politeness | Copy |
|---|---|---|---|
| New Round arrives | Bay status region | `polite` | "New Round · CLAUDE·api-refactor · 2 Questions · Pending" |
| Several arrive within a few seconds | Same | `polite`, batched | "3 new Rounds · 5 pending" |
| Policy timer crosses a threshold (5 min, 1 min) on any strip | Bay status region | `polite` | "CODEX·billing-ui · 1 min left · then applies recommended" |
| Final minute of the **open** Round's timer | Open Round status | `assertive`, once | "1 min left on this Round · then cancels" |
| Policy fires | Bay status region | `polite` | "Expired · policy applied recommended · CURSOR·docs" |
| Agent cancels the open Round | Open Round | `assertive`, once | "Cancelled by CLAUDE·api-refactor · your draft is kept below" |
| Connection changes | Connection region | `polite` | "Reconnecting · retry in 4 s" / "Live" |
| Submit fails | Answer bar | `role="alert"` | "Not sent · Hub unreachable · Answer kept · Retry" |
| Submit succeeds | Bay status region | `polite` | "Answered · CLAUDE·api-refactor" |
| A Round's next Lock is under 60 s (Lock soon) | Feed status region | `polite`, once | "CLAUDE·api-refactor · Lock soon · Q1 locks in 60 s, then applies recommended" |
| A Question locks, the Round stays pending | Feed status region | `polite` | "CLAUDE·api-refactor · Q4 locked · policy applied recommended · Round stays pending" |
| A Round ends in place (expired, superseded, cancelled) | Feed status region | `polite` | "r_5b2f90cd cancelled · replaced by r_7f3a91c0" |
| Advisor run starts, finishes or is cancelled | Feed status region | `polite` | "Suggestion ready · codex-review · 2 Questions filled" |
| Dismiss or Redirect succeeds | Feed status region | `polite` | "Dismissed · CLAUDE·api-refactor" / "Redirected · CLAUDE·api-refactor" |
| Redirect sent without a message | The field's error | `role="alert"` | "Write what CLAUDE·api-refactor should do instead." |
| Reconnected after a gap | Feed status region | `polite`, once | "Live · 2 new Rounds · 1 expired while offline" |

- Live regions exist and are empty at first paint, so their first update is announced. They never hold placeholder copy ("No Answer sent yet") and take no room while empty.
- The surface's one connection readout (`.hh-connection` in the app bar, or in the bay head where there is no app bar) is the polite connection region; static examples of the widget are not live regions.
- Timers never announce every second. The timer rail is decorative; the strip's policy text ("09:58 · then applies recommended") is the accessible source and reads the remaining time when focused.
- `role="alert"` is only for failures the Human must act on.

## Timers and the Unanswered Policy

The policy timer is a real-time constraint the Agent declares, not one the Hub chooses (WCAG treats real-time events as an exception to SC 2.2.1 Timing Adjustable). Hermes compensates:

- **Policy first, timer second.** A timer is never shown without its policy sentence: "waits 10 min, then applies recommended" or "then cancels". "Keep waiting" Rounds show the Round's age instead of a countdown.
- **The Hub never submits the Human's partial Answer.** When the policy fires, it applies the Agent's declared outcome only. The Human's draft stays on screen, marked "Not sent", and is kept in the answered log.
- **No silent apply.** If the policy is "apply recommended", the recommended option is visibly marked in every Question before the timer can fire.
- **Warn early.** Thresholds at 5 min and 1 min are announced politely; the open Round's final minute once, assertively.
- **Nothing else leaves on a timer.** Toasts and status messages stay until dismissed or replaced.

## Targets and density

- WCAG 2.2 minimum target: 24 × 24 CSS px (SC 2.5.8).
- Default controls use `--hh-button-min-target`.
- `data-density="compact"` lowers targets for desktop triage but keeps `button-min-target` ≥ 24 CSS px (validated).
- `data-density="glance"` raises `button-min-target` to ≥ 3rem and `option-row-min-height` so approve/reject is easy at arm's length. Approve and Reject sit apart, with a gap of at least `--hh-density-gap`, so a thumb cannot hit both.
- Whole option rows are the target, not just the radio dot.

## Focus appearance

- Every interactive element has a visible focus ring: `--hh-ring` at `--hh-focus-ring-width` with `--hh-focus-ring-offset`, at least 3:1 against every surface it sits on (validated), above the 2 CSS px perimeter guidance in SC 2.4.13.
- The selected strip (the Round open beside the bay) also gets an outer `--hh-ring` outline (`data-selected="true"`). Focus is never shown by glow.
- **Focus on a filled checked control.** Where a world fills a chosen control (Flight Director's called GO / NO-GO keys), the shared ring would sit on the fill. The control then draws a two-colour perimeter: the ring inside the key takes the key's own ink (`success-foreground` on `success`, `destructive-foreground` on `destructive`, at least 4.5:1), and the key gains an outer `--hh-ring` outline against its module. The validator measures the ring of every world rule that fills `[data-checked='true']` against that fill, in every colour option (at least 3:1).

## Motion

- Respect `prefers-reduced-motion: reduce` (Media Queries Level 5). Every `--hh-motion-*` duration collapses to 1ms (validated).
- Strips that arrive or leave never slide across the bay under reduced motion; they appear or disappear in place, and the status word changes.
- Nothing flashes more than three times a second (SC 2.3.1). Holders never blink; the reconnecting lamp fades four times on `--hh-motion-pulse` and then holds.
- World signatures run once and never carry meaning ([motion.md](motion.md)).

## Cognitive load

- One open Round at a time. The bay shows the rest.
- Each Question states its kind in words: "Choose one", "Choose any", "Free text", "Approve or reject".
- One primary action per region: Submit Answer.
- Destructive actions name their object: "Reject deploy to prod", "Cancel Round r_7f3a91c0".
- Icons come from the preview icon set, are `aria-hidden`, and sit beside words. Unicode glyphs and emoji never stand in for icons; the only Unicode mark in copy is the middle dot separator.

## Content in attachments

- Diffs: each line has its sign in the gutter as text, and the hunk has a summary ("+12 −3 in src/api/client.ts").
- Code blocks are focusable when they scroll, with an accessible name ("Attachment: client.ts, lines 1–40").
- Links state their destination host.
- Images attached by Agents need the Agent's alt text; when none is given, the attachment card says "No description from the Agent".

## Preview requirements

The preview shows:

- Focus styles on every control, including the roving focus in the bay.
- Both core themes and every world colour option.
- Compact and glance density side by side.
- Every holder status with its word.
- The keyboard hints panel and `aria-keyshortcuts` on controls.
- Live-region copy for each event in the table above.
- Reduced-motion behaviour.
