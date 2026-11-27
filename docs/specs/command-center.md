# Command Center behaviour (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [How should the Command Center flow work? Rough clickable prototype](https://github.com/jazhou-adobe/hermes-hub/issues/12).

- **Evidence:** the throwaway prototype on branch [`prototype/command-center`](https://github.com/jazhou-adobe/hermes-hub/tree/prototype/command-center/prototype/command-center). It has five variants; the Human chose **feed**.
- **Visual source:** the Flight Director 2169 design in [`jazhou-adobe/apollo-tokens`, `brands/hermes/design`](https://github.com/jazhou-adobe/apollo-tokens/tree/0b316ce29a5f18e14ddae1cfc4b2639a466ca9a1/brands/hermes/design) @ `0b316ce`, which includes the Command Center additions from the [additions brief](https://github.com/jazhou-adobe/apollo-tokens/blob/0b316ce29a5f18e14ddae1cfc4b2639a466ca9a1/brands/hermes/design/briefs/command-center-additions.md) (status: [command-center-additions-status.md](https://github.com/jazhou-adobe/apollo-tokens/blob/0b316ce29a5f18e14ddae1cfc4b2639a466ca9a1/brands/hermes/design/briefs/command-center-additions-status.md)). The gaps the build found and contributed are listed in [`web/preview/GAPS.md`](../../web/preview/GAPS.md).
- **Builds on:** every other spec in [`docs/specs/`](README.md).
- **Terms:** `GLOSSARY.md`.

This spec covers **behaviour only**: states, actions, order and keys. Visuals come from the design system.

## Surfaces

| Surface | Purpose |
|---|---|
| **Triage (Feed)** | Every Pending Round, fully expanded and answerable in place. This is the home page. |
| **Round detail** `/rounds/<id>` | One Round at its own URL, opened from a notification, the log or a terminal link. |
| **Answered log** | Ended Rounds: Outcome, who set each value, `suggested_by`, Delivered or "Not picked up", "Replaced by". |
| **Agents** | The session roster (callsign, Live/Idle/Gone, pending count, Detection, resume handle, Forget), plus a **Lanes** view: one lane per Agent session with its Pending Rounds. |
| **Settings** | **Live:** notifications, quiet hours, sound, appearance, single-key shortcuts. **Read-only, from `config.toml`:** port, limits, Advisors, Auto-ask rules ([operations](hub-operations.md)). Storage size. There is no sign-in, no tokens and no exposure (security spec). |

## Triage: the Feed

- **One scrolling column** of every Pending Round in **arrival order**. A Superseding Round takes its predecessor's position.
- **Each Round is fully expanded:**
  - the head (status word, callsign, title, policy sentence and next-deadline timer, links, context);
  - every Question with its Attachments at full height, where diffs fold only runs of 8 or more unchanged lines;
  - notes;
  - its own **action bar**: Send Answer, Dismiss, Redirect, Ask advisor.
  - Only the action bar of the Round **in view** sticks to the bottom of the viewport.
- **The Feed index** is a slim sticky list on the left. Each entry shows the callsign, title, time to the next Lock, **Lock soon**, and **▸ In view**. Clicking an entry scrolls to that Round. Filter chips narrow the Feed by callsign and by project.
- **Lock soon:** when a Round's next deadline is under 60 s, it is marked "Lock soon" in words plus a visual cue, on both its index entry and its head.
- **After Send, Dismiss or Redirect** the Round leaves the Feed for the log, and the Feed **scrolls to the next Pending Round** and focuses it.
- **Rounds that end in place** stay where they are, read-only, until the Human removes them:
  - **expired** (the last Question locked), **superseded** (with "Replaced by r_… · Open"), and **cancelled** by the Agent or by Forget;
  - each shows its Outcome sentence, the Draft as "Not sent" with **Copy draft**, and **Remove from feed**.
- **New Rounds** append at the end. Focus and scroll position never move, and a polite live-region announcement plays.
- **Empty, loading, reconnecting and offline** states follow the design's system blueprints.
- **Standby:** with no Pending Round, the Feed shows a tracking scope with the session's live and idle Agents in orbit, how long the Feed has been quiet, the Agent count, and rotating loop chatter. An empty Feed shows it as a full-viewport cinematic backdrop behind the shell (title card, letterbox, opening sequence); above Rounds that ended in place it sits compact. Reduced motion stills it.
- **The side nav** hides and shows from the app-bar toggle or `[`. The choice is kept per browser. Hidden, the page takes the full width.

## Answering a Round

- **Question kinds** follow the schema.
  - The **Recommended option** is marked and **never preselected**.
  - Free-text Recommended text is shown with "Use it" and is never prefilled.
- **Locked Questions** (their policy fired) go read-only and show "Policy applied recommended · HH:MM" or "Policy cancelled · HH:MM". Their Draft value is kept as "Not sent". The Round stays Pending until no open Question is left (lifecycle).
- **Drafts are saved to the Hub** as the Human types (debounced). They survive a reload, are carried over on Supersede, and are recorded as "Not sent" when a Lock or Outcome overtakes them. A policy never sends a Draft.
- **Send Answer** needs every required open Question answered. It is immediate and immutable.
- **Dismiss** takes an optional note.
- **Redirect** needs a "do this instead" message.
- **Edit-then-approve:** on approve/reject Questions with an editable Proposal, the Human edits the Proposal, then approves. The Question is marked "Edited", and Reset restores the Agent's version.
- **Ask advisor** (delegation spec):
  - a picker of the configured Advisors plus an optional brief;
  - "Advisor working · m:ss" with Cancel;
  - on return, a Suggestion fills empty open Questions marked "Suggested by ADVISOR" with the rationale; set Questions get "ADVISOR suggests … · Accept"; an unparseable reply is shown as a plain briefing.
  - Auto-ask rules start the Advisor when the Round arrives.

## Keys (single-key shortcuts can be switched off in Settings)

| Key | Action |
|---|---|
| `j` / `k` | Next / previous Round in the Feed |
| `1`–`9` | Choose an option in the current Question |
| `a` / `r` | Approve / reject the current approve/reject Question |
| `Tab` / `Shift+Tab` | Move between Questions and controls |
| `n` | Notes for the Round in view |
| `⌘↵` / `Ctrl↵` | Send the Round in view |
| `d` | Dismiss |
| `e` | Redirect |
| `v` | Ask advisor |
| `[` | Show / hide the side nav |
| `?` | Key map |

- **The current Question** is the focused Question. Otherwise it is the first open, unanswered Question of the Round in view.
- **Choosing a value** moves on to the next unanswered Question.
- **Keys never fire** while focus is in a text field, except `⌘↵`.

## Notifications (browser notification, plus an in-page toast with Open)

| Event | Notifies |
|---|---|
| A new Round arrives | Yes: callsign, title |
| A Round's next Lock is 15 s away | Yes: callsign, the Question, and what the policy will do |
| An Advisor Suggestion is ready | Yes: callsign, Advisor |
| Agent gone, Round ended by a policy | No: shown in the Feed and the log only |

Notifications are suppressed while the Command Center tab is visible and focused; the in-page toast still shows. Settings → Notifications holds the permission state, a mute switch (browser and macOS notifications) and a separate **In-page toasts** switch. Toasts off: no toast; the Feed and the live-region announcement still update. Changed 2026-11-27: the mute switch used to leave toasts with no way to hide them.

## Live updates

The Command Center uses its own Human-scoped SSE stream (transports spec). On reconnect it refreshes in place and announces once ("Live · 2 new Rounds · 1 expired while offline").

## Not in Phase 1

- The phone (glance) surface.
- The strip-bay triage with a single open Round, kept as the design's reference only.
- Focus Queue.
- Lanes as the triage view: they live on the Agents page instead.
- Deadline-first ordering.
