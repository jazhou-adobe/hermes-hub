# Agent Screen-Generation Contract

This contract is mandatory for any agent building a Hermes Hub screen. It is short on purpose: follow it in order, and cite the sources in your handoff.

## Required flow

1. **Name the screen goal and the device.** Desktop triage beside terminals, desktop detail or settings, or phone glance. One goal per screen.
2. **Choose one blueprint** from [command-center-blueprints.md](../patterns/command-center-blueprints.md), [phone-blueprints.md](../patterns/phone-blueprints.md) or [system-blueprints.md](../patterns/system-blueprints.md). Copy its regions in order. If no blueprint fits, stop and propose one through [governance.md](../governance.md); never invent a layout inside a screen.
3. **Set theme and density on purpose.** `html[data-theme="hermes-dark"]` (default) or `hermes-light`, or the world `hermes-<slug>` with `data-palette` that the Human chose. `data-density="compact"` on dense desktop regions (bay, log, roster); `data-density="glance"` on phone `main`. Never invent a theme or world in a screen.
4. **Lay out with containers and layout primitives.** Strips for Rounds, cards for objects, panels for workspaces, shelves for collections, trays for temporary actions; `.hh-stack`, `.hh-row`, `.hh-grid`, `.hh-measure` for structure.
5. **Use only documented components** and their classes: `.hh-<component>`, variants on `data-variant`, sizes on `data-size`, tone on `data-tone` (badges, alerts), Round status on `data-status` (strips), other state on ARIA or `data-state` ([components/](../components/)). Never hand-roll a strip, holder, timer, option row or overlay.
6. **Give every Round its full status.** Holder with status word, callsign chip with text, Round id in mono, the Unanswered Policy sentence, and the timer only when the policy has a deadline.
7. **Wire the keyboard map.** Roving focus in the desktop bay (listbox or grid per [round-widgets.md](../components/round-widgets.md#strip-bay--hh-strip-bay)); on phone a plain list of strip buttons. APG radio/checkbox for Questions; `a`/`r` only on the focused approve/reject Question; `⌘↵` submit, visible `.hh-kbd` hints and `aria-keyshortcuts`. Single-key shortcuts only inside the bay or the open Round, never in text fields.
8. **Add live regions.** Bay status (`polite`) for new Rounds, thresholds and policy firing; `assertive` once for the open Round's final minute or cancellation; `role="alert"` only for failed submits and offline.
9. **Use semantic tokens only.** No raw hex, no colour functions, no arbitrary spacing, no Tailwind palette or arbitrary values, no raw z-index, no literal durations. The validator rejects them outside `tokens/`.
10. **Write Dispatcher copy.** Status word first, then count, then consequence. Callsign as subject. No chatter, emoji, exclamation marks or "Oops".
11. **Include non-happy states.** Empty bay, loading, reconnecting, offline, expired, cancelled, Agent gone, submit failed, not found.
12. **Check accessibility.** Contrast in both core themes, focus visible and not obscured, targets (≥ 24 CSS px compact, ≥ 3rem glance), non-colour status, reduced motion, keyboard path end to end.
13. **Hand off with citations**: blueprint, density, theme, components and attributes, tokens, states, keyboard path, live-region copy, checks run.

## Allowed tokens

| Group | Tokens |
|---|---|
| Surfaces | `background`, `surface-card`, `surface-panel`, `surface-shelf`, `surface-tray`, `strip`, `muted` and their `-foreground` pairs, `foreground` |
| Actions | `primary`, `secondary`, `accent`, `destructive` and `-foreground` pairs |
| Feedback | `success`, `warning`, `info` and `-foreground` pairs |
| Round status | `pending`, `answered`, `expired`, `recommended` and `-foreground` pairs; `live` and `live-foreground` for connection and running timers only |
| Content | `code`, `code-foreground`, `diff-add`, `diff-remove` |
| Identity | `agent-1` … `agent-6` (always with callsign text) |
| System | `border`, `input`, `ring`, `scrim`, `shadow` |
| Data | `chart-1` … `chart-5` (with direct labels and a data table) |
| Components | `button-min-target`, `control-size-sm`, `control-size-lg`, `focus-ring-width`, `focus-ring-offset`, `strip-min-height`, `strip-holder-width`, `timer-track-height`, `callsign-chip-height`, `option-row-min-height`, `kbd-size`, `icon-size`, `avatar-size-sm`, `avatar-size-md`, `overlay-dialog-width`, `overlay-drawer-width`, `overlay-popover-width`, `overlay-tooltip-width`, `overlay-menu-width`, `code-max-height`, `progress-track-height` |
| Motion | `motion-*` durations, `easing-*` curves, `press-scale`, `enter-scale`, `enter-offset` |
| Rails | `space-*`, `radius-*`, `border-width-*`, `density-*`, `layout-*`, `layer-*`, `elevation-raised`, `elevation-overlay`, `elevation-live` (live state only), `type-<name>-*`, `font-*` |

All are `--hh-<name>` CSS variables or the Tailwind utilities that map to them.

## Forbidden patterns

- Raw hex, colour functions, arbitrary values, palette utilities, raw z-index, literal durations or curves outside `tokens/`.
- **Side-stripe accents**: a coloured bar or border on one edge of a card, alert, strip or callout as a status or accent cue. Status lives in the holder that frames the whole strip, with its word; alerts carry tone on every edge.
- Status by colour alone: a holder without its word, a coloured dot for an Agent without its callsign, a recommended tint without "Recommended".
- A policy timer without its policy sentence, or any countdown on a "keep waiting" Round.
- Auto-submitting the Human's Answer, or sending a draft when a policy fires.
- New Rounds that steal focus or open overlays.
- Single-key shortcuts listening on the whole document or inside text fields.
- Gradient text, glass or `backdrop-filter`, glow outside live state, scanlines, noise or grain, neon text on near-black reading planes, textures behind text.
- Blinking or flashing lamps; infinite animations (the spinner beside its words is the one loop); motion that carries meaning without a word.
- `window.confirm`, `window.alert`, blocking prompts. Use the alert dialog.
- Toasts that leave on a timer, or failures in a toast.
- Unicode glyphs or emoji as icons (the middle dot separator in copy is fine).
- Vendor logos for Agent clients.
- Glossary violations: "ticket", "request", "inbox", "dashboard", "user", "operator", "bot", "assistant" for Hermes concepts.
- Revealing any private seed or internal brainstorm string in UI or docs.

## Handoff checklist

- Which blueprint, device and density?
- Which theme and world colour option did I check?
- Which tokens appear, and are all semantic?
- Where does each Round show its status word, callsign and policy?
- What is the keyboard path, and where are the hints?
- What do the live regions say?
- Which non-happy states are included?
- What happens under reduced motion?

## Worked example: triage screen

Goal: the Human clears pending Rounds from the keyboard on a desktop.

1. **Blueprint**: Triage ([command-center-blueprints.md](../patterns/command-center-blueprints.md#triage)).
2. **Theme and density**: `html[data-theme="hermes-dark"]`; `data-density="compact"` on the bay region.
3. **Structure**:

```html
<a class="hh-skip-link" href="#bay">Skip to strip bay</a>
<header class="hh-app-bar">
  <span class="hh-app-bar-brand">Hub · studio-mac</span>
  <span class="hh-live-value" data-live="true">Pending · 3</span>
  <span class="hh-app-bar-spacer"></span>
  <span class="hh-connection" data-state="live"><span class="hh-connection-lamp" aria-hidden="true"></span>Live <span class="hh-connection-detail">since 13:58</span></span>
</header>
<nav class="hh-side-nav" aria-label="Command Center">…</nav>
<main>
  <section class="hh-strip-bay" aria-labelledby="bay-h" data-density="compact">
    <div class="hh-strip-bay-head">
      <h1 id="bay-h" class="hh-heading-lg">Triage</h1>
      <div role="group" aria-label="Filter by status">…<button class="hh-chip" aria-pressed="false">Pending</button>…</div>
    </div>
    <ul id="bay" class="hh-strip-bay-list" role="listbox" aria-label="Pending Rounds">
      <li class="hh-strip" role="option" aria-selected="true" tabindex="0" data-status="pending" data-selected="true">
        <div class="hh-strip-tab">Pending <span class="hh-mono-sm">r_7f3a91c0</span></div>
        <div class="hh-strip-paper">
          <div class="hh-strip-head">
            <span class="hh-strip-cell" data-cell="callsign"><span class="hh-callsign" data-agent="1"><span class="hh-callsign-mark" aria-hidden="true"></span><span class="hh-callsign-text">CLAUDE·api-refactor</span></span></span>
            <span class="hh-strip-cell" data-cell="title"><span class="hh-strip-title hh-strip-header">Choose a migration strategy</span><span class="hh-strip-policy">09:58 · then applies recommended</span></span>
            <span class="hh-strip-cell" data-cell="meta"><span class="hh-mono-sm">2 Questions · 3m ago</span></span>
          </div>
        </div>
        <span class="hh-policy-timer" aria-hidden="true"><span class="hh-policy-timer-fill" style="--timer-fraction: 0.97"></span></span>
      </li>
      …
    </ul>
    <div role="status" class="hh-visually-hidden" id="bay-status"></div>
    <ul class="hh-kbd-hints">…<li><kbd class="hh-kbd">j</kbd><kbd class="hh-kbd">k</kbd> move</li>…</ul>
  </section>
  <section class="hh-round" aria-labelledby="round-h">
    <div class="hh-round-head">
      <span class="hh-badge" data-tone="pending">Pending</span>
      <h2 id="round-h" class="hh-heading-md">Choose a migration strategy</h2>
      <div class="hh-policy-badge"><span class="hh-badge">Policy</span> apply recommended <span class="hh-mono-sm">at 14:10</span></div>
    </div>
    <ol class="hh-round-questions">
      <li class="hh-question" data-current="true">
        <div class="hh-question-call">
          <div class="hh-question-meta"><span class="hh-mono-sm">Q1 of 2</span> Choose one</div>
          <p class="hh-question-prompt" id="q1">Which migration path?</p>
        </div>
        <fieldset class="hh-question-response" aria-labelledby="q1">
          <label class="hh-option" data-recommended="true"><kbd class="hh-kbd">1</kbd><input type="radio" name="q1">
            <span class="hh-option-text">Expand and contract<span class="hh-option-detail">Two deploys, no downtime</span></span>
            <span class="hh-recommended">Recommended · applied if unanswered</span></label>
          …
        </fieldset>
      </li>
      <li class="hh-question">… approve/reject: <div class="hh-approve-pair">…two .hh-option rows…</div></li>
    </ol>
    <div class="hh-answer-bar">
      <div class="hh-answer-bar-row">….hh-progress "1 of 2 Questions answered"…</div>
      <textarea class="hh-textarea" aria-label="Note for the Agent (optional)"></textarea>
      <div class="hh-answer-bar-row"><button class="hh-button" data-variant="primary" aria-keyshortcuts="Meta+Enter Control+Enter">Submit Answer <kbd class="hh-kbd">⌘↵</kbd></button></div>
    </div>
  </section>
</main>
```

The listbox option holds no inner buttons; where a strip stands alone (the phone pending list), `.hh-strip-head` is a `<button>`.

4. **Components**: `hh-app-bar`, `hh-live-value`, `hh-connection`, `hh-side-nav`, `hh-chip`, `hh-strip-bay`, `hh-strip`, `hh-callsign`, `hh-policy-timer`, `hh-kbd-hints`, `hh-round`, `hh-badge`, `hh-policy-badge`, `hh-question`, `hh-option`, `hh-recommended`, `hh-approve-pair`, `hh-attachment`/`hh-diff` when attached, `hh-progress`, `hh-answer-bar`.
5. **Tokens**: `background`, `surface-panel`, `strip`, `strip-foreground`, `pending`, `recommended`, `agent-1`, `live`, `surface-tray`, `ring`, `strip-min-height`, `strip-holder-width`, `timer-track-height`, `option-row-min-height`, `kbd-size`, `button-min-target`.
6. **States**: pending, empty bay, new Round while answering, expired while drafting, cancelled, reconnecting, offline, submit failed.
7. **Keyboard**: skip link → bay (`j`/`k`, Enter) → Q1 (`1`–`9`) → Q2 (`a`/`r`) → `n` notes → `⌘↵` → next strip.
8. **Live regions**: "New Round · CODEX·billing-ui · 1 Question · Pending"; "CLAUDE·api-refactor · 1 min left · then applies recommended"; "Answered · CLAUDE·api-refactor".
9. **Checks**: validator passes; both themes; focus not obscured by the Answer bar; reduced motion shows strips appearing in place.
