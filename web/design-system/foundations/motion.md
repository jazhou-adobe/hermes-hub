# Motion and interaction

How Hermes elements answer a key or a tap, arrive and leave, and mark a Round outcome. Colour, type and shape say what something is; motion says what just happened. The Human triages many Rounds a day, so almost nothing moves.

## Decide first, then design

1. **How often does it happen?**
   - **Constant** (moving focus with `j`/`k`, choosing options with digits, typing notes) never animates beyond an instant state change.
   - **Frequent** (pressing a button, opening a strip, a new Round arriving) gets near-invisible feedback: `--hh-motion-fast`, transform or colour only, little or no travel.
   - **Occasional** (dialogs, sheets, menus, the connection state changing) enters and exits on `--hh-motion-fast` to `--hh-motion-panel`.
   - **Rare** (a world signature when a Round is answered) may spend up to `--hh-motion-signature` and plays once.
2. **What is its job?** Feedback, spatial, state, or continuity. Delight is allowed only as a world signature, only in the rare tier. If no job fits, nothing moves.
3. **Which tokens?** Use the existing durations, curves and distances. Don't invent new ones.

## Tokens

- Durations: `--hh-motion-fast`, `--hh-motion-standard`, `--hh-motion-panel`, `--hh-motion-signature`, `--hh-motion-pulse` and `--hh-motion-stagger`.
- Curves: `--hh-easing-standard`, `--hh-easing-enter`, `--hh-easing-exit`, `--hh-easing-linear` (timers, spinners) and `--hh-easing-drawer` (edge sheets). There is no overshoot curve: nothing on the board bounces.
- Travel and scale: `--hh-enter-offset`, `--hh-enter-scale` and `--hh-press-scale`.
- The validator rejects literal durations and curves outside `tokens/`.

## Rules

- **Transform and opacity.** Animate translate, scale, opacity, clip-path and colour. Unfold height with `grid-template-rows` from `0fr` to `1fr`. Never animate width, height, top or left.
- **Strips slot in, they don't fly.** A new strip enters at its place in the bay with a short `--hh-enter-offset` drop and opacity, on `--hh-motion-fast`. Strips below it shift with a transition, never a stagger cascade across the bay.
- **Leave faster, the same way.** An answered strip leaves the bay on `--hh-motion-fast` along the way it came; the next strip takes focus at once, without waiting for the exit.
- **Interruptible.** Anything that can happen twice in a second (focus moves, option toggles, a strip opening) runs on CSS transitions that retarget. Keyframes are only for one-shot entries (`hh-enter`, `hh-pop`, `hh-slide`), bounded fades (`hh-fade`, a fixed iteration count), the spinner (`hh-spin`, the one loop, beside words) and world signatures.
- **Live state is held, not blinked.** Holders are steady. The reconnecting lamp fades four times on `--hh-motion-pulse`, then holds. The policy timer's fill shrinks on `--hh-easing-linear`. Nothing flashes (WCAG 2.2 SC 2.3.1).
- **Glow only on live state.** `--hh-elevation-live` sits on the connection lamp while streaming and on a live value while it updates. It never pulses and never sits on strips or reading planes.
- **Hover is a bonus.** Hover motion sits inside `@media (hover: hover) and (pointer: fine)`. Keyboard focus gets the same affordance through `:focus-visible`.
- **Meaning never rides on motion.** Every outcome has a status word; motion only draws the eye to it.

## Reduced motion

`prefers-reduced-motion: reduce` collapses every `--hh-motion-*` duration to 1ms in [`themes.css`](../tokens/themes.css), so CSS motion jumps to its end state (WCAG 2.2 SC 2.3.3 Animation from Interactions). Script-driven motion reads the same tokens, so it collapses too.

- Strips appear and disappear in place.
- The policy timer track updates in steps (once per second) instead of draining smoothly.
- World signatures do not run; the status word and the strip's move to the answered log carry the outcome.

## What never moves

- Focus moving between strips, and option selection by digit keys.
- Typing in notes or free-text answers.
- Live numerals: timer digits, counts, connection countdowns (no odometer roll).
- Question text and attachments once shown.
- Blocking alerts (submit failed).
- A control changing between disabled and enabled.

## World signatures

Each world has one signature tied to a Round outcome, on these same tokens, run once, collapsed under reduced motion:

| World | Signature |
|---|---|
| `flight-director` | GO / NO-GO polling for approve/reject Rounds, with text labels |

Archived worlds are listed in [`archive/README.md`](../archive/README.md); their signatures are described in each archived JSON's `signature` field.

Worlds may not override motion tokens. Keyframe names start with `<slug>-`, `infinite` is rejected, and every animation uses `--hh-motion-*` durations or sits inside `@media (prefers-reduced-motion: no-preference)`.
