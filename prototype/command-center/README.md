# PROTOTYPE · Command Center flow (throwaway)

Answers [hermes-hub#12 "How should the Command Center flow work?"](https://github.com/jazhou-adobe/hermes-hub/issues/12): how does one Human move through Rounds arriving from many Agents?

**Plan:** three variants of the Command Center triage flow (`bay` | `focus` | `lanes`), switchable via `?variant=`, on one page, over one shared in-memory live engine. Throwaway: no tests, no persistence, not for main.

## Run

From the worktree root:

```sh
bun prototype/command-center/index.html
```

Open <http://localhost:3000/?variant=bay> (Bun's HTML dev server; `PORT=3417 bun …` picks another port). Plain HTML, ES modules and CSS copied from `hermes-master/design` (tokens, Flight Director 2169 world, component CSS); fonts load from Google Fonts.

## Variants

Switch with the floating bottom bar or `←` / `→` (ignored while an input has focus). Switching keeps all state; the open Round stays open.

| Key | Name | Structure |
|---|---|---|
| `bay` (default) | Strip Bay | The design's blueprint: pending strips in arrival order on the left (listbox: `j`/`k`, `Enter`), the open Round on the right. `Esc` back to the bay; after any terminal action focus moves to the next strip. |
| `focus` | Focus Queue | One Round at a time, full width, with a thin queue header (count, position, next callsigns + their next deadline). Global keys: `1`–`9`, `a`/`r` (auto-advance to the next unanswered Question), `j`/`k` Question, `⌘↵` send + next Round, `s` skip, `d` dismiss, `e` redirect. |
| `lanes` | Agent Lanes | One lane per Agent session (callsign, Live/Idle/Gone, pending count, last seen, branch), its pending Rounds stacked inside. A Round opens in an end-side drawer; the lanes stay visible beside it. |

Shared in every variant: side nav to **Answered log**, **Agents** (roster, Detection details, Forget Agent) and **Settings** (Advisors, Auto-ask rules, notification toggle). `?view=log|agents|settings` deep-links.

## The simulated Hub (src/engine.js)

- 7 Agent sessions, incl. two clashing `CLAUDE·api` sessions shown as `CLAUDE·api·3f9a` / `CLAUDE·api·c210`; one Idle (Cursor), one Gone (Copilot).
- 7 pending Rounds: single choice with Recommended option (never preselected), multi choice, free text, approve/reject with editable `command` Proposal, diff, markdown and image Attachments, Round policy + per-Question override.
- Per-Question **Lock** (lifecycle spec): the Question goes read-only ("Policy applied recommended · HH:MM" / "Policy cancelled"), a Draft for it is kept as **Not sent** with Copy draft; the Round expires only when no open Question is left. Strip timers show the next deadline.
- A new Round every ~40 s (polite announcement, focus never moves). `CODEX·billing-ui` has an **Auto-ask rule**, so its Rounds start the Advisor on arrival.
- **Supersede** at ~60 s: `OMP·hermes-hub` replaces its release-notes Round; the new one takes the old position, Draft values carry over for matching Question ids, the log shows "Replaced by r_…".
- **Ask advisor** (Claude / Codex, optional brief) → "Advisor working · m:ss" with Cancel → Suggestion after ~6 s: fills empty open Questions ("Suggested by …" + rationale), offers "… suggests X · Accept" on ones already set, ignores locked ones. The Copilot illustration Round's first run returns unparseable output, shown as a plain briefing.
- Delivery: Live sessions pick Answers up ~2 s after the Outcome; Idle/Gone ones stay **Not picked up**.
- Toasts marked **(would notify)** where a desktop notification would fire: new Round, Lock in 15 s, Suggestion ready.
- **Prototype state** panel (top right, dashed, not the design): sim clock, Pause, ×1/×5, +15 s jump, last event, event list, JSON of rounds/sessions, and "Outline design additions" (dashed outline on every `.x-add` element).

## Design additions needed

UI the Flight Director design system does not specify yet (all marked `.x-add`):

1. **Dismiss** (optional note) and **Redirect** (required "do X instead") controls and their inline panels in the Answer bar; Outcome words for dismissed / redirected.
2. **Edit-then-approve**: Proposal block (format, editable flag), edit mode, "Edited" badge, "Approve (edited)" label, Reset to Agent's.
3. **Advisor states** in the open Round: Ask advisor picker (Advisor list + brief), "Advisor working · m:ss" with Cancel, Suggestion summary, per-Question "Suggested by ADVISOR" marker with rationale, "ADVISOR suggests … · Accept" offer, "Changed from …'s suggestion", unparsed briefing, run stopped/cancelled.
4. **Locked Question** state (per-Question Lock while the Round stays pending): Locked badge + policy sentence + time, read-only response, per-Question "Not sent" draft with Copy draft; Round head "n of m locked, Round stays pending"; strip "· n locked".
5. **Per-Question policy override** badge ("Own policy … · m:ss left") in the Question meta.
6. **Supersede**: "Replaces r_…" on the new Round/strip, ended "Cancelled · Replaced by r_…" with "Open r_…", log entry wording.
7. **Markdown** and **image** Attachments (reading-plane markdown, image with alt text); only diff/code/file/link exist today.
8. **Not picked up** delivery state in the answered log (and Delivered time).
9. **Forget Agent** confirm (alertdialog wording) and forgotten-sessions note in the roster; Detection details for Documented/Undocumented signal and clash-suffix explanation.
10. **Settings → Advisors** and **Settings → Auto-ask rules** (kind + project + optional label → Advisor, standing brief).
11. **Focus Queue header** (`focus`): count, position, next callsigns with next deadline, Skip.
12. **Agent lane** (`lanes`): lane head (callsign, state, pending, last seen, branch), empty-lane slot, Round drawer beside lanes.
13. Notification toast for "would notify" events (Lock in 15 s, Suggestion ready, new Round) with Open.
14. Free-text **Recommended** text shown with "Use it" (never prefilled).

Note: the image Attachments here are SVG data URIs for size; the schema allows png, jpeg, webp, gif only.

## Files

- `index.html` – entry; `src/app.js` – shell, variants, views, keys, switcher, state panel; `src/widgets.js` – shared strip / Round / Question / Attachment markup; `src/engine.js` – live engine; `src/data.js` – mock data; `src/morph.js` – tiny DOM morph so per-tick re-render keeps focus and typing.
- `styles/themes.css`, `styles/flight-director.css`, `styles/hermes-components.css` – copied from `hermes-master/design`; `styles/proto.css` – page base, variant layouts, prototype chrome.
- `screenshots/{bay,focus,lanes}.png` – 1440×900.
