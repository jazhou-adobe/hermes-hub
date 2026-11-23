# Feed widgets

The parts of the Command Center **Feed**: the page shell, the Feed layout, the Feed index, Lock soon, the action bar's inline panels (Dismiss, Redirect, Ask advisor), the Advisor states, and the Settings parts. The Feed replaced the strip bay as the triage surface ([command-center-blueprints.md](../patterns/command-center-blueprints.md), Feed blueprint). The Round's own parts (page-scroll Round, Proposal, Locked Question, Supersede, markdown and image Attachments, diff folds, free-text Recommended) are in [round-widgets.md](round-widgets.md); delivery and the log columns in [status-widgets.md](status-widgets.md); Detection, Forget and Lanes in [agent-widgets.md](agent-widgets.md); toasts in [overlays.md](overlays.md). Every class is styled in `preview/hermes-components.css`. Source: [briefs/command-center-additions.md](../briefs/command-center-additions.md) and the hermes-hub spec `docs/specs/command-center.md`.

**Full width.** The shell, the Feed column and tables span the viewport beside the side nav and the Feed index. There is no content max-width; only `--hh-layout-measure` caps line length (Question prompts, prose, the search field).

## App shell — `.hh-app-shell`

```
.hh-skip-link
header.hh-app-bar                    sticky; Hub name, "Pending · N" (.hh-live-value), .hh-connection
.hh-toast-region[data-placement="top"]  fixed under the app bar (overlays.md)
.hh-app-shell
├── nav.hh-side-nav.hh-app-shell-nav   Feed, Answered log, Agents, Settings (+ .hh-side-nav-count)
└── main.hh-app-shell-main[tabindex="-1"]
    └── .hh-page
        ├── .hh-page-head            h1 (tabindex="-1", focused after navigation) + counts in mono
        └── the page's regions
```

- Below 64rem the side nav is a wrapping row above the page; from 64rem it is a `max-content` column, sticky at `--hh-layout-sticky-top`.
- `--hh-layout-sticky-top` is the offset below the sticky app bar. Sticky columns (side nav, Feed index, Lanes drawer, settings nav), the scroll margin of a Round reached by `j`/`k` or a link (`.hh-feed-item`), and the top toast region all use it.
- A page with a sticky Answer bar sets `scroll-padding-block` on the root: `--hh-layout-sticky-top` at the start and two bar rows at the end (the bar's actions wrap in narrow columns), so a focused control is never hidden under the app bar or the bar (SC 2.4.11). The rule is in the stylesheet (`html:has(.hh-answer-bar[data-sticky="true"])`).
- A heading focused by script (`tabindex="-1"` in `.hh-page-head`, `.hh-round-head`, `.hh-strip-bay-head`) shows the focus ring after a keyboard move (`:focus-visible`: `j`/`k`, Send, the index by keyboard) and none after a pointer action.

## The Feed — `.hh-feed`

```
.hh-feed
├── nav.hh-feed-index                 slim sticky index (below)
└── .hh-feed-column
    ├── .hh-bay-status[role="status"]  polite region: new Rounds, policy fired, reconnect summary
    ├── .hh-alert                      reconnecting / offline, above the list
    └── ol.hh-feed-list[aria-label="Pending Rounds"]
        └── li.hh-strip.hh-feed-item[data-status]   the holder; .hh-strip-paper > form.hh-round[data-layout="page"]
```

- **One scrolling column** of every Pending Round, fully expanded, in **arrival order**. A Superseding Round takes its predecessor's position. New Rounds append at the end; focus and scroll never move, and the bay status region announces them.
- From 64rem the index is a `--hh-layout-sidebar-width` column beside the Feed, sticky at `--hh-layout-sticky-top` with its own scroll. Below 64rem it sits above the Feed and its list scrolls inside itself (at most three strip heights), so a new entry never pushes the Rounds down.
- Each Round is a holder (`li.hh-strip`, status word in `.hh-strip-tab`, policy timer on the bottom edge) around a **page-scroll Round** ([round-widgets.md](round-widgets.md), Page-scroll Round): head, every Question with full-height Attachments, notes, its own action bar.
- **Only the action bar of the Round in view sticks** to the bottom of the viewport (`.hh-answer-bar[data-sticky="true"]`). A sticky element only holds while its own Round spans the viewport's bottom edge, so exactly one bar sticks, with no script.
- **Leaving the Feed.** After Send, Dismiss or Redirect the Round leaves for the answered log, the Feed scrolls to the next Pending Round and focuses its title. Expired, superseded and cancelled Rounds **end in place** (`form.hh-round[data-state="ended"]`): read-only, Outcome sentence, Draft as "Not sent" with **Copy draft**, and **Remove from feed**.
- States: Pending Rounds; empty ("No pending Rounds." · "Agents ask through the Hub Skill." · link to the answered log, the empty state from the system blueprints); loading (`.hh-skeleton[data-shape="strip"]` × 3, `aria-busy`); reconnecting (warning alert, Rounds stay, Send still tries); offline (destructive alert with `role="alert"`, Send `aria-disabled` with the reason); filtered ("Showing 2 of 4 · Clear filters").
- Tokens: `background`, `strip`, `strip-foreground`, `pending`, `expired`, `surface-tray`, `border`, `layout-sidebar-width`, `layout-sticky-top`, `layout-measure`, `strip-min-height`, `space-6`, `space-8`.

### Keyboard map

Single-key shortcuts are scoped to the Feed and never fire in a text field (except `⌘↵`); Settings can switch them off.

| Key | Action |
|---|---|
| `j` / `k` | Next / previous Round; scrolls it to `--hh-layout-sticky-top` and focuses its title |
| `1`–`9` | Choose an option in the current Question |
| `a` / `r` | Approve / reject the current approve/reject Question |
| `n` | Notes for the Round in view |
| `d` | Dismiss panel |
| `e` | Redirect panel |
| `v` | Ask advisor panel |
| `⌘↵` / `Ctrl↵` | Send the Round in view |
| `?` | Key map |

The **current Question** is the focused one, otherwise the first open, unanswered Question of the Round in view. Choosing a value moves on to the next unanswered Question. Buttons carry `aria-keyshortcuts` and a trailing `.hh-kbd`.

### Live regions

| Event | Polite announcement (`.hh-bay-status`) |
|---|---|
| New Round | "New Round · CODEX·billing-migration · 1 Question · Pending" |
| Lock soon (once, at 60 s) | "CLAUDE·api-refactor · Lock soon · Q1 locks in 60 s, then applies recommended" |
| Question locked | "CLAUDE·api-refactor · Q4 locked · policy applied recommended · Round stays pending" |
| Ended in place | "r_c90d4417 expired · CURSOR·web-shell · Draft kept, not sent" / "r_5b2f90cd cancelled · replaced by r_7f3a91c0" |
| Sent / Dismissed / Redirected | "Answered · CLAUDE·api-refactor" / "Dismissed · …" / "Redirected · …"; then focus moves |
| Reconnected | "Live · 2 new Rounds · 1 expired while offline" (once) |

## Feed index — `.hh-feed-index`

```
nav.hh-feed-index[aria-labelledby][data-density="compact"]
├── .hh-feed-index-head            heading "Feed", .hh-live-value "Pending · N"
├── fieldset.hh-feed-index-filters  legend (visually hidden) "Filter by callsign": .hh-chip[aria-pressed] > .hh-callsign
├── fieldset.hh-feed-index-filters  "Filter by project": .hh-chip[aria-pressed] > mono project name
├── p "Showing 2 of 4 · Clear filters"   only while a filter is on
└── ol.hh-feed-index-list
    └── li.hh-feed-index-item > a.hh-feed-index-link[href="#<round>"][aria-current="location"?][data-lock-soon?]
        ├── .hh-feed-index-meta   .hh-callsign, "Lock in 00:47" (mono) or the Outcome badge (Cancelled, Expired)
        ├── .hh-feed-index-title  the Round title
        └── .hh-feed-index-meta   Lock soon badge, .hh-feed-index-inview (chevron-right icon + "In view")
```

- Clicking an entry scrolls to that Round and focuses its title.
- **In view** (`aria-current="location"` on the entry of the Round at the top of the viewport): `--hh-accent` / `--hh-accent-foreground` fill, a `--hh-border-width-thick` boundary in `--hh-foreground` (padding absorbs the extra width, so nothing shifts), and the words "In view" after the `chevron-right` icon. Never colour alone, and never a triangle glyph: the contract bans glyph icons, so the brief's "In view" cue is the SVG chevron plus words.
- Filters: chips AND across the two kinds, OR inside one. "Showing N of M · Clear filters" while any chip is pressed; "No Rounds match these filters." when none match. Filters never hide a Round from `j`/`k` silently: `j`/`k` move through the shown Rounds only, and the count says how many are hidden.
- Ended Rounds keep their entry with the Outcome word until removed from the Feed.
- Tokens: `surface-card`, `surface-card-foreground`, `accent`, `accent-foreground`, `foreground`, `border`, `border-width-thin`, `border-width-thick`, `warning`, `warning-foreground`, `type-body-sm-*`, `type-mono-sm-*`, `strip-min-height`.

## Lock soon

The cue that a Round's **next Lock** (the next Question deadline) is under **60 s**.

- Shown on the index entry ("Lock soon") and on the Round head ("Lock soon · 00:47 to next Lock"): `.hh-badge[data-tone="warning"]` with the `clock` icon and the words. The words and the icon are the cue; the warning tone only reinforces them.
- The threshold is the Lock, not the Round: the earliest deadline among open Questions, including a per-Question policy ([status-widgets.md](status-widgets.md), Per-Question policy).
- Announced once when it starts (live regions above). It does not repeat every second. At 15 s the browser notification and toast "Lock in 15 s" fire ([overlays.md](overlays.md), Toast variants).
- The 5 min and 1 min policy-text thresholds on the strip still apply; Lock soon adds the index and head cue.

## Inline panel — `.hh-inline-panel`

An **in-flow, non-modal** panel inside the Round, above its action bar. The design's dialogs and sheets are modal; an inline panel keeps the Round readable while the Human writes.

- Anatomy: `section.hh-panel.hh-inline-panel.hh-stack[aria-labelledby]` > `h3` + one sentence of consequence + `.hh-field` + a `.hh-row` of actions. Opened by an `aria-expanded` / `aria-controls` button in the action bar; **one panel open at a time**; closing returns focus to its button.
- `.hh-round-error` places a Round-level `.hh-error` or `.hh-alert` in the same slot ("Not sent · Hub unreachable · your Answer is kept on this page · Retry").

| Panel | Button (key) | Field | Primary action | Outcome word (log and announcement) |
|---|---|---|---|---|
| Dismiss | **Dismiss** `d` (destructive variant) | "Note for CALLSIGN (optional)" | **Dismiss Round** (destructive) | dismissed |
| Redirect | **Redirect** `e` | "Do this instead (required)"; empty on send → `aria-invalid` + `.hh-error[role="alert"]` "Write what CALLSIGN should do instead." | **Send redirect** (primary) | redirected |
| Ask advisor | **Ask advisor** `v` | `.hh-advisor-picker` radios (name · timeout) + "Brief (optional)" | **Start advisor run** | (none; the Round stays) |

- Copy: Dismiss "CALLSIGN gets Outcome dismissed, with your note if you add one. Nothing else is sent." Redirect "CALLSIGN gets Outcome redirected and your message instead of Answers." Secondary action "Keep answering".
- After Dismiss or Redirect the Round leaves the Feed exactly as after Send.

## Advisor — `.hh-advisor-*`

An **Advisor** reads a Round and returns a **Suggestion**. It never sends: the Human does. Deadlines keep running while it works.

| Class | Where | Content |
|---|---|---|
| `.hh-advisor-picker` | Ask advisor panel | `fieldset` of `.hh-radio` rows: mono Advisor name · "120 s timeout"; no Advisors configured: "No Advisors are configured. Add an [[advisor]] table to config.toml; Settings shows what is loaded." |
| `li.hh-advisor-row` | first item of `ol.hh-round-questions` | holds one `.hh-alert.hh-advisor-status` |
| `.hh-advisor-status[data-state]` | in the row | run state, table below |
| `.hh-advisor-suggestion` | in a Question it filled | badge "Suggested by ADVISOR" (info) + `.hh-advisor-rationale` "Rationale: …" |
| `.hh-advisor-offer` | in a Question the Human had already set | "ADVISOR suggests Reject · reason" + **Accept** |
| `.hh-advisor-changed` | in a filled Question the Human changed | badge "Changed from ADVISOR's suggestion" + **Restore suggestion** |
| `.hh-advisor-briefing` | in an unparsed status alert | `figure.hh-attachment` with the raw output on the code plane |

| `data-state` | Tone | Badge | Title | Live region |
|---|---|---|---|---|
| `running` | info | Advisor | `.hh-spinner` + "Advisor working · m:ss" (mono), **Cancel run** | "codex-review started · CLAUDE·api-refactor" |
| `succeeded` | info | Suggestion | "Suggestion ready · ADVISOR · 38 s" + summary | "Suggestion ready · codex-review · 2 Questions filled" |
| `unparsed` | warning | Unparsed (alert icon) | "Advisor reply could not be read · ADVISOR" + briefing | "codex-review reply could not be read · shown as a briefing" |
| `timed-out` | warning | Timed out (clock icon) | "ADVISOR timed out after 120 s" | "codex-review timed out" |
| `cancelled` | none | Cancelled (x icon) | "Advisor run cancelled · ADVISOR · HH:MM:SS" | "codex-review run cancelled" |

- The spinner is the one permitted loop and always sits beside "Advisor working"; under reduced motion it stops and the elapsed time still counts.
- A Suggestion fills only **empty, open** Questions; it never touches a locked Question or one the Human set (those get the offer row).
- Round detail lists every run in a compact `.hh-table` (Started, Advisor, Asked by "You" / "Auto-ask rule", Status badge with the word, Took). Success tone for Succeeded, warning for Unparsed and Timed out, none for Cancelled.
- Tokens: `info`, `warning`, `surface-card`, `code`, `code-foreground`, `layout-measure`, `density-inset`.

## Settings parts

- `.hh-settings`: the settings sections nav (`.hh-side-nav.hh-panel`, sticky from 64rem) beside `.hh-settings-panels` (one `.hh-card` per section).
- `.hh-config-source`: the read-only treatment for views of `config.toml`: badge "Read-only · config.toml" (lock icon), the file path in mono with **Copy path**, and "reloaded HH:MM". On a config error the line reads "last good load HH:MM" and a `.hh-alert[data-tone="destructive"][role="alert"]` names the line and the problem ("config.toml line 14 · auto_ask.advisor names "codex-reviw", which is not an Advisor") and the fix ("Fix the file; it reloads on save").
- `.hh-field-pair`: two fields side by side that wrap on narrow screens, such as quiet hours (Quiet from / Quiet until, `input[type="time"]`).
- The switch's state word is `.hh-switch-state` ([inputs.md](inputs.md)).

## Agent recipe

- Feed page: skip link → app bar → `.hh-app-shell` (side nav, main) → `.hh-feed` (`.hh-feed-index` compact, `.hh-feed-column` with the status region and `ol.hh-feed-list` of holders around `form.hh-round[data-layout="page"]`, each ending with `.hh-answer-bar[data-sticky="true"]`).
- Toasts in `.hh-toast-region[data-placement="top"]`; inline panels inside the Round; Advisor rows first in the Questions list.
- Tokens: `layout-sticky-top`, `layout-sidebar-width`, `layout-measure`, `accent`, `warning`, `info`, `strip`, `surface-tray`, `border`, `ring`.
