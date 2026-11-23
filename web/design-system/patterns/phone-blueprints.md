# Phone blueprints (glance)

**Reference only.** The Hub's Phase 1 has no phone surface (it is local only); these blueprints stay as the reference for glance density and a later tailnet mode.

The phone is the second screen: quick approve/reject over the tailnet when the Human is away from the desk. Every phone page sets `data-density="glance"` on `<main>`: `button-min-target` ≥ 3rem, taller `option-row-min-height`, roomier `density-*`, larger `type-body-size`. No keyboard hints are shown. In the preview, the strip bay applies glance itself whenever it stacks into the phone flow, unless the page has set a density explicitly (a `?density=` override wins).

Shared chrome: skip link → compact `.hh-app-bar` ("Pending · N" and `.hh-connection` word) → `main` → `.hh-bottom-nav` (Pending, Log, Agents) ([navigation-and-chrome.md](../components/navigation-and-chrome.md#bottom-navigation--hh-bottom-nav)).

## Pending list

Purpose: see what is waiting and pick one Round.

Regions:

| Region | Component | Notes |
|---|---|---|
| Header | `h1` "Pending · 3" | |
| List | `<ul>` of collapsed `.hh-strip`s, each a full-width button that opens the Round | Status word first, title, callsign, policy sentence, timer |
| Status | `role="status"` region | New Rounds, thresholds |

- Strips keep their holders, status words and timers at glance size. The whole strip is the target.
- The list is a plain list of buttons, not a listbox: touch and screen-reader swipe navigation work without roving focus.
- Approve/reject Rounds with one Question show inline Approve and Reject buttons on the strip only when the strip has room for both at full target size with a gap between them; otherwise the Human opens the Round.

States:

| State | Treatment |
|---|---|
| Pending | List, oldest first |
| Empty | "No pending Rounds." and "Open answered log" |
| Reconnecting | Warning alert under the app bar: "Reconnecting · retry in 4 s" |
| Offline | Destructive alert: "Offline · last update HH:MM · answers cannot be sent"; strips marked "Stale" |
| Not reachable on first load | System blueprint "Not reachable" ([system-blueprints.md](system-blueprints.md#not-reachable)) |

## Single-Round approve/reject

Purpose: decide one Round with a thumb.

Presentation: a `.hh-sheet` over the pending list (full screen at phone width), or a page at `/rounds/<id>` when opened from a notification, with Close "Back to pending".

Regions:

1. Header: status word, title, callsign, policy sentence and timer.
2. Questions: `.hh-question` blocks; Question text at `body-lg`; attachments collapsed to one line each with "Show" (diffs open in a full-screen dialog).
3. Approve/reject Questions: two `.hh-option` rows, Approve and Reject, full width, `--hh-option-row-min-height`, separated by at least `--hh-density-gap`, Reject with the cross icon and destructive boundary when checked. The recommended marker shows its word.
4. Notes: textarea always open ("Note for the Agent (optional)").
5. Answer bar: sticky footer of the sheet, "Submit Answer", full width at `--hh-control-size-lg`.

Rules:

- Approve or Reject alone never submits; Submit Answer does. One tap never sends an irreversible decision.
- A Round that needs free text or many options is fully answerable on the phone, but long attachments show a hint: "Long diff · easier on desktop".
- If the Round expires or is cancelled while open, the sheet stays: badge "Expired" or "Cancelled", Answers and notes read-only and marked "Not sent", and the Answer bar offers Copy draft and Back to pending, as on desktop. Its strip has left the pending list for the log.

States: pending, sending ("Sending…"), sent (sheet closes, toast "Answered · CALLSIGN", next pending strip focused), failed (alert with Retry, draft kept), expired, cancelled, offline (Submit `aria-disabled` with reason).

Tokens: `strip`, `strip-foreground`, `pending`, `recommended`, `destructive`, `surface-tray`, `button-min-target`, `option-row-min-height`, `control-size-lg`, `density-gap`, `overlay-drawer-width` (sheet max width on tablets), `easing-drawer`, `motion-panel`.

## Phone log and Agents

Glance versions of the desktop pages: the answered log as an [APG feed](https://www.w3.org/WAI/ARIA/apg/patterns/feed/) of article cards, and the roster as list rows with callsign, status word and pending count. Detail opens in a bottom sheet.
