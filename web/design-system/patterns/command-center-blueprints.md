# Command Center blueprints

Desktop-first page recipes for the Command Center. Each blueprint lists its purpose, regions, density, states and keyboard path. Separating components from task-level patterns follows GOV.UK and Carbon ([mature-design-system-references.md §6](../research/mature-design-system-references.md#6-patterns-and-page-templates)). Phone blueprints are in [phone-blueprints.md](phone-blueprints.md); sign-in and system states in [system-blueprints.md](system-blueprints.md).

Shared chrome on every page: skip link → `.hh-app-bar` (Hub name, "Pending · N", `.hh-connection`, `?` hints, settings) → `.hh-side-nav` (Triage, Answered log, Agents, Settings) → `main` ([navigation-and-chrome.md](../components/navigation-and-chrome.md)).

## Triage

Purpose: the Human clears pending Rounds from the keyboard, beside terminals.

Regions:

| Region | Component | Notes |
|---|---|---|
| Bay header | `.hh-strip-bay-head` | "Pending" with a `.hh-live-value` count, filter chips (status, callsigns), sort fixed to arrival order |
| Strip bay | `.hh-strip-bay` (listbox) | `data-density="compact"`; one Tab stop; `j`/`k`; pending strips only (expired and cancelled Rounds move to the answered log) |
| Bay status | `role="status"` region | New Rounds, thresholds, policy fired |
| Open Round | `form.hh-round` | The Round opened with Enter: `.hh-round-head` (status badge, title, callsign, id, `.hh-policy-badge`), `.hh-round-body` with the `.hh-question` blocks (the only scrolling part), `.hh-answer-bar`. Sized to the viewport space below its top offset so Send shows on entry |
| Key tray | `.hh-kbd-hints` | Context keys at the foot of the bay |

Layout: from 64rem the bay and the open Round sit side by side (bay at `--hh-layout-sidebar-width` or wider, Round fills the rest). Below 64rem the Round opens in an end-side sheet.

States:

| State | Treatment |
|---|---|
| Pending Rounds | Bay with strips, the oldest open by default when the page loads, focus on the bay |
| Empty bay | Empty state in the bay ("No pending Rounds. Agents ask through the Hub Skill."); open-Round region shows the last answered Round summary or nothing |
| New Round while answering | Joins the bay, polite announcement, focus stays |
| Open Round expires | Round stays open, read-only, badge "Expired"; Answer bar alert "Not sent · Expired HH:MM · policy applied …"; draft kept here and in the log; Copy draft and Back to pending (returns to the first pending strip) |
| Open Round cancelled by Agent | Same, "Cancelled by CALLSIGN at HH:MM" |
| Reconnecting | Warning alert above the bay; strips stay; Submit still possible if the Hub answers the POST |
| Offline | Destructive alert, strips marked "Stale", Submit `aria-disabled` with reason |
| Loading | Skeleton strips and skeleton Questions |

Keyboard path: skip link → bay (`j`/`k`, Enter) → open Round (Questions in order, `1`–`9`, `a`/`r`, `n` notes) → `⌘↵` submit → focus to next pending strip.

Tokens: `background`, `strip`, `strip-foreground`, `pending`, `answered`, `expired`, `recommended`, `surface-panel`, `surface-tray`, `ring`, `strip-min-height`, `strip-holder-width`, `timer-track-height`, `option-row-min-height`, `kbd-size`.

## Round detail

Purpose: read one Round in full, at its own URL (`/rounds/<id>`), from a link in a notification, the log or a terminal.

Regions: page header (status word, title, callsign link, Round id with Copy, created time, policy badge and timer), Questions panel (`.hh-question` blocks with attachments), Answer bar (pending only), history shelf (created, threshold warnings, answered/expired/cancelled with times).

States: pending (answerable), answered (read-only values and who set each, notes), expired (outcome sentence, any unsent draft), cancelled, not found ("No Round r_xxxx on this Hub" + link to the log), Agent gone (banner: "CALLSIGN is gone · Answer is kept for its next poll").

Density: default; Questions never compact.

## Answered log

Purpose: check what was decided, by whom (the Human or a policy), and when.

Regions: header ("Answered log", count), filter tray (status chips, callsign chips, search), `.hh-answered-log` table grouped by day, Round detail opens in an end sheet or navigates to Round detail.

States: has entries, filtered empty ("No Rounds match · Clear filters"), empty ("No answered Rounds yet."), loading more (`aria-busy`), offline (stale banner).

Density: compact.

## Agent roster

Purpose: see which Agents are connected, idle or gone, and how many Rounds each has pending.

Regions: header ("Agents · N"), `.hh-agent-roster` table, empty state with Copy Hub URL and a link to the Hub Skill.

States: Agents present, none yet, Agent gone, offline (stale).

Density: compact.

## Agent detail

Purpose: understand one Agent: identity, where it runs, its Rounds.

Regions: breadcrumbs ("Agents / CALLSIGN"), header (callsign, status word, client in words, last seen), tabs ([APG tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)): **Rounds** (pending strips then log entries for this Agent), **Detection** (the detection `<dl>` from [agent-widgets.md](../components/agent-widgets.md#detection-details-agent-detail--detection-tab)), **Session** (session id, resume handle, cwd, git, host).

Actions: Forget Agent (destructive, alert dialog: "Forget CALLSIGN? Its pending Rounds stay in the log as cancelled.").

States: live, idle, gone, not found.

## Settings

Purpose: manage the Hub's tokens, exposure and notifications, and the Command Center's appearance and keys.

Regions: tabs **Tokens**, **Exposure**, **Notifications and keys**, **Appearance**; each tab is a `.hh-panel` with fields and a save tray when changes need confirming.

| Tab | Content |
|---|---|
| Tokens | Agent tokens table (name, created, last used, prefix in mono), "Create token" dialog that shows the secret once with Copy, Revoke (alert dialog) |
| Exposure | Where the Hub listens: local only, tailnet, LAN. Each option says what it exposes and what the Human must do; current URL(s) in mono with Copy; warnings in words when an option serves plain HTTP outside localhost ("Browsers treat this address as insecure: passkeys and notifications are unavailable") |
| Notifications and keys | Browser notifications (permission state in words, "Ask permission"), OS notification fallback, sound; "Single-key shortcuts" switch; the full key map |
| Appearance | Theme (`hermes-dark`, `hermes-light`, worlds), world colour option, density override for the bay |

States: saved ("Saved · HH:MM" status), unsaved changes (save tray "2 changes · Save · Discard"), failed ("Not saved · Hub unreachable"), permission denied (notifications: what to change in the browser).

Density: default.
