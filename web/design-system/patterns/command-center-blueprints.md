# Command Center blueprints

Desktop-first page recipes for the Command Center. Each blueprint lists its purpose, regions, density, states and keyboard path. Separating components from task-level patterns follows GOV.UK and Carbon ([mature-design-system-references.md §6](../research/mature-design-system-references.md#6-patterns-and-page-templates)). Phone blueprints are in [phone-blueprints.md](phone-blueprints.md) and system states in [system-blueprints.md](system-blueprints.md); the Hub's Phase 1 uses neither the phone blueprints nor sign-in (it is local only), and they stay as references.

Shared chrome on every page: skip link → `.hh-app-bar` (Hub name, "Pending · N", `.hh-connection`, `?` hints, settings) → `.hh-app-shell` with `.hh-side-nav` (Feed, Answered log, Agents, Settings) beside `main` ([navigation-and-chrome.md](../components/navigation-and-chrome.md), [feed-widgets.md](../components/feed-widgets.md)). Toasts stack in `.hh-toast-region[data-placement="top"]` under the app bar.

**Full width.** Pages span the viewport beside the side nav (and, on the Feed, the Feed index). There is no content max-width; only `--hh-layout-measure` caps line length (prose, Question text, the search field). Sticky regions sit at `--hh-layout-sticky-top` below the app bar.

## Feed

Purpose: the Human answers every Pending Round in place, from the keyboard, beside terminals. The home page. It replaced the strip-bay triage (below, kept as a reference) on 2026-11-20 ([briefs/command-center-additions.md](../briefs/command-center-additions.md)).

Regions:

| Region | Component | Notes |
|---|---|---|
| Feed index | `nav.hh-feed-index` | `data-density="compact"`; sticky column at `--hh-layout-sidebar-width` from 64rem, above the Feed below it; filter chips by callsign and project; one entry per Round with callsign, title, time to the next Lock, Lock soon, In view |
| Feed status | `.hh-bay-status[role="status"]` | Polite: new Rounds, Lock soon, Locks, ended Rounds, reconnect summary |
| Connection alerts | `.hh-alert` | Reconnecting (warning) or offline (destructive, `role="alert"`), above the list |
| Feed | `ol.hh-feed-list` of `li.hh-strip.hh-feed-item` | Every Pending Round in arrival order, each a holder around a page-scroll `form.hh-round[data-layout="page"]`: head, every Question with full-height Attachments (diffs fold runs of 8 or more unchanged lines), notes, inline panels, and its own action bar `.hh-answer-bar[data-sticky="true"]` |

Layout: from 64rem the index and the Feed sit side by side (index at `--hh-layout-sidebar-width`, Feed fills the rest). Below 64rem the index sits above the Feed and its list scrolls inside itself. **Only the action bar of the Round in view sticks** to the bottom of the viewport.

States:

| State | Treatment |
|---|---|
| Pending Rounds | Index and Feed; the first Round in view; focus on the page heading after load |
| New Round | Appended at the end and in the index; focus and scroll never move; polite announcement and a "New Round" toast with Open |
| Lock soon | Under 60 s to a Round's next Lock: "Lock soon" on its index entry and "Lock soon · 00:47 to next Lock" on its head (words, clock icon, warning tone); one announcement |
| Question locked | Locked Question read-only with "Policy applied recommended · HH:MM" or "Policy cancelled · HH:MM" and its Draft as Not sent; head "n of m locked · Round stays pending" |
| Sent, dismissed, redirected | The Round leaves the Feed for the log; the Feed scrolls to the next Pending Round and focuses its title; toast with the Outcome word and Open in log |
| Expired, superseded, cancelled | The Round ends in place, read-only: Outcome sentence, Draft as Not sent with Copy draft, Remove from feed; superseded adds "Replaced by r_… · Open r_…" |
| Advisor run | Advisor row first in the Round: working with Cancel, Suggestion ready, unparsed briefing, timed out, cancelled ([feed-widgets.md](../components/feed-widgets.md)) |
| Filtered | "Showing 2 of 4 · Clear filters" in the index; `j`/`k` move through the shown Rounds |
| Empty | Empty state: "No pending Rounds." · "Agents ask through the Hub Skill." · link to the answered log |
| Reconnecting | Warning alert above the Feed; Rounds stay; Send still tries |
| Offline | Destructive alert with `role="alert"`; Send `aria-disabled` with the reason; Drafts kept |
| Loading | Three `.hh-skeleton[data-shape="strip"]`, `aria-busy="true"` |

Keyboard path: skip link → Feed index (Tab through entries, Enter scrolls to and focuses a Round) → the Round in view (`j`/`k` between Rounds, Questions in order, `1`–`9`, `a`/`r`, `n` notes, `d` Dismiss, `e` Redirect, `v` Ask advisor) → `⌘↵` send → focus to the next Round's title. Single keys never fire in text fields; Settings can switch them off. Full map in [feed-widgets.md](../components/feed-widgets.md).

Live regions: see [feed-widgets.md](../components/feed-widgets.md) (Live regions). Toasts are not the announcement.

Tokens: `background`, `strip`, `strip-foreground`, `pending`, `expired`, `recommended`, `accent`, `warning`, `info`, `surface-card`, `surface-tray`, `ring`, `layout-sidebar-width`, `layout-sticky-top`, `layout-measure`, `strip-min-height`, `strip-holder-width`, `timer-track-height`, `option-row-min-height`, `kbd-size`, `code-max-height`.

Density: the index compact; Rounds default (Questions never compact).

## Round detail

Purpose: read and answer one Round in full, at its own URL (`/rounds/<id>`), from a notification, the log or a terminal link.

Regions: breadcrumbs ("Feed / r_…"), the Round as a page-scroll Round in its holder (status word, callsign, title, Round id with Copy, received time, policy badge and timer, Questions with Attachments, action bar when pending), Advisor runs (`.hh-table`: Started, Advisor, Asked by, Status, Took), history shelf (received, Lock soon, Locks, answered/ended with times, delivery).

States: pending (answerable), answered (read-only values and who set each, notes, delivery), dismissed or redirected (the note or message), expired or cancelled (Outcome sentence, any unsent Draft), superseded ("Replaced by r_… · Open r_…"), not found ("No Round r_xxxx on this Hub" + link to the log), Agent gone (banner: "CALLSIGN is gone · Answer is kept for its next poll").

Density: default; Questions never compact.

## Answered log

Purpose: check what was decided, by whom (the Human, a policy or an Advisor's suggestion), and whether the Agent picked it up.

Regions: page head ("Answered log", count), filter tray (`.hh-filter-tray`: search over titles and values, Outcome chips, callsign, project and date chips; Copy as Markdown, Export JSON, the count), `.hh-answered-log` table grouped by day (Outcome, Round, Values and who set them, Delivery, Ended); a row opens Round detail.

States: has entries; search matches marked (`mark.hh-match`); filtered empty ("No Rounds match · Clear filters"); empty ("No answered Rounds yet."); delivery per row (Delivered HH:MM:SS, Waiting for pickup, Not picked up · Agent gone, Replaced by r_…); loading more (`aria-busy`); offline (stale banner).

Density: compact.

## Agents

Purpose: see which Agent sessions are live, idle or gone, how they were identified, and their Pending Rounds side by side.

Regions: page head ("Agents · N"), the roster (`.hh-agent-roster` cards: callsign, state word, Client, Pending, Session with Copy, Where, Last seen, folded Detection details, Forget), then the **Lanes** view ([agent-widgets.md](../components/agent-widgets.md)): one `.hh-lane` per session (lane head: callsign, state, pending count, last seen, branch), its strips, an empty-lane slot with text, and the Round in a **non-modal drawer** beside the lanes.

States: Agents present; none yet (empty state with Copy Hub URL and a link to the Hub Skill); Agent idle; Agent gone; forgotten (info note); a lane with no Rounds ("No pending Rounds · idle since 13:12"); a strip selected (drawer open); offline (stale).

Keyboard path: roster cards in order (callsign link, Copy, Forget) → lanes → a strip's button opens the drawer → Close or Escape returns focus to the strip.

Density: compact for the roster; lanes default.

## Agent detail

Purpose: understand one Agent: identity, where it runs, its Rounds.

Regions: breadcrumbs ("Agents / CALLSIGN"), header (callsign, status word, client in words, last seen), tabs ([APG tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)): **Rounds** (its Pending Rounds as Feed entries, then log entries), **Detection** (the detection `<dl>` with signal, documented / undocumented badge and "Why may this be wrong?", the clash suffix reason, from [agent-widgets.md](../components/agent-widgets.md#detection-details-agent-detail--detection-tab)), **Session** (session id and resume handle with Copy, cwd, git, host).

Actions: Forget Agent (destructive, alert dialog: "Forget CALLSIGN?" · "Its pending Rounds are cancelled and stay in the log as cancelled. Its detection details and resume handle are removed from this Hub."; safe action "Keep CALLSIGN" focused).

States: live, idle, gone, forgotten (note), not found.

## Settings

Purpose: the Command Center's live preferences, and read-only views of what `config.toml` loaded. Settings → Tokens and Settings → Exposure are gone: the Hub is local only and has no sign-in.

Regions: `.hh-settings`: a sections nav (`.hh-side-nav.hh-panel`, sticky from 64rem) beside one `.hh-card` per section.

| Section | Kind | Content |
|---|---|---|
| Notifications | Live | Browser permission in words ("Allowed", "Blocked: allow notifications for this site in the browser's site settings", "Not asked" + **Ask permission**); one switch for notifications (new Round, Lock in 15 s, Suggestion ready); **Quiet hours** switch with a `.hh-field-pair` (Quiet from / Quiet until); **Sound** switch, **off by default**; the note that notifications are suppressed while this tab is visible and focused |
| Appearance | Live | Theme (Flight Director 2169, Dark, Light) and world colour option selects; applies at once |
| Keys | Live | "Single-key shortcuts" switch and the key map |
| Advisors | Read-only | `.hh-config-source` (badge "Read-only · config.toml", path with Copy path, "reloaded HH:MM"), table: Name, Command (mono), Timeout |
| Auto-ask rules | Read-only | `.hh-config-source`, table: When (client kind + project + optional label), Advisor, Standing brief |
| Storage | Live readout | `.hh-progress` of the database size against its limit, the share of Attachments, the pruning rule from `config.toml` |

States: saved at once ("Saved · HH:MM" status for each live control); config error (destructive alert naming the line and the problem; "last good load HH:MM"; the tables show the last good config); permission denied (notifications: what to change in the browser); Storage near its limit (warning alert with the size in words).

Density: default.

## Strip-bay triage (reference)

Not the Hub's Phase 1 triage, which is the Feed. Kept as the design's reference for a strip bay beside a single open Round ([round-widgets.md](../components/round-widgets.md)); Lanes reuse its strip.

Regions:

| Region | Component | Notes |
|---|---|---|
| Bay header | `.hh-strip-bay-head` | "Pending" with a `.hh-live-value` count, filter chips (status, callsigns), sort fixed to arrival order |
| Strip bay | `.hh-strip-bay` (listbox) | `data-density="compact"`; one Tab stop; `j`/`k`; pending strips only (expired and cancelled Rounds move to the answered log) |
| Bay status | `.hh-bay-status[role="status"]` | New Rounds, thresholds, policy fired |
| Open Round | `form.hh-round` | The Round opened with Enter: `.hh-round-head` (status badge, title, callsign, id, `.hh-policy-badge`), `.hh-round-body` with the `.hh-question` blocks (the only scrolling part), `.hh-answer-bar`. Sized to the viewport space below its top offset so Send shows on entry |
| Key tray | `.hh-kbd-hints` | Context keys at the foot of the bay |

Layout: from 64rem the bay and the open Round sit side by side (bay at `--hh-layout-bay-width` or narrower, Round fills the rest). Below 64rem the Round opens in an end-side sheet.

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

Tokens: `background`, `strip`, `strip-foreground`, `pending`, `answered`, `expired`, `recommended`, `surface-panel`, `surface-tray`, `ring`, `strip-min-height`, `strip-holder-width`, `timer-track-height`, `option-row-min-height`, `kbd-size`, `layout-bay-width`.
