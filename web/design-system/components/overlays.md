# Overlays

Overlays sit above the board: a **dialog** that takes over until the Human decides, a **sheet** docked to an edge, a **menu** of actions, a **popover** that explains, a **tooltip** that names an icon, and a **toast** that confirms. They share one rule set: open only on the Human's action, close the way people expect (Escape, Close, click outside for non-modal ones), never leave on a timer, and return focus to their trigger.

New Rounds never open an overlay. They join the bay.

## Choosing an overlay

| The Human needs to… | Use | Not |
|---|---|---|
| Confirm something that cannot be undone (reject with no note, revoke a token, cancel a Round) | Alert dialog | `window.confirm` |
| See an attachment full size, or edit a long note | Dialog | A new page |
| Reach navigation on a narrow screen, or open a Round from the phone list | Sheet | A dialog for content compared with the page |
| Pick an action on a strip or an Agent (Copy id, Open in log, Forget Agent) | Menu | A menu to choose a form value |
| Read why a policy or detection value is what it is | Popover | A tooltip, which keyboard and touch input may never reveal |
| Learn what an icon-only button does | Tooltip | A tooltip holding links or the only copy of a status |
| Know that an Answer was delivered (Answers are final once sent) | Toast | A toast for a failure (use `role="alert"` in the Answer bar) |

## Dialog — `.hh-dialog`

Native `<dialog>` opened with `showModal()` ([APG dialog (modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)). The page behind becomes inert; `--hh-scrim` covers it with a solid translucent tint, no blur.

- Anatomy: `.hh-overlay-head` (`h2` title and a ghost `.hh-icon-button` Close with `aria-label="Close"`), `.hh-overlay-body`, `.hh-overlay-foot` (actions, end-aligned). The same three parts serve the sheet.
- Width `min(viewport − margin, --hh-overlay-dialog-width)`.
- Tokens: `--hh-surface-panel` / `--hh-surface-panel-foreground`, `--hh-border`, `--hh-radius-lg`, `--hh-elevation-overlay`, `--hh-scrim` on `::backdrop`. Native modal dialogs render in the browser's top layer above every `--hh-layer-*`.
- Focus starts on the first field, or on the safest button in a confirmation. Escape closes and focus returns to the trigger.

**Alert dialog** ([APG alertdialog](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)), `role="alertdialog"`:

- Title names the object: "Reject without a note?", "Revoke token laptop-cli?".
- Description (`aria-describedby`) names the consequence: "CLAUDE·api-refactor gets Reject with no reason."
- Focus starts on the safe action ("Add a note"); the destructive button names the result ("Reject without note").
- States: `open`, `working` (button reads "Revoking…" with `aria-busy`; Escape ignored), `failed` (alert inside: "Not revoked · Hub unreachable").

If a Round expires or is cancelled while a dialog about it is open, the dialog says so in an inline alert and its destructive action becomes unavailable with the reason.

## Sheet — `.hh-sheet`

A modal `<dialog class="hh-sheet">` docked to the inline-end edge at full height, with the same parts, focus rules and controller as the dialog. Width `min(100vw, --hh-overlay-drawer-width)`, so on a phone it fills the screen. Slides in on `--hh-motion-panel` with `--hh-easing-drawer`.

- Side navigation below 64rem. Close reads "Close menu".
- Agent detail opened from the roster on a narrow desktop.
- The open Round on phone (glance): the Answer bar is the sheet's sticky footer. Close reads "Back to pending".

## Menu — `.hh-menu`

[APG menu button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/): a button with `aria-haspopup="menu"` and `aria-expanded` opens `role="menu"` with `role="menuitem"` items. Arrow keys move, Enter activates, Escape closes and returns focus, typing a letter jumps to the item.

- `.hh-menu-anchor` wraps the button and the `.hh-menu`; min width `--hh-overlay-menu-width`; `--hh-layer-dropdown`; `--hh-surface-card` with `--hh-elevation-overlay`. Items are at least `--hh-button-min-target` tall; hover and focus fill them with `--hh-accent` / `--hh-accent-foreground`.
- Strip menu: Copy Round id, Copy callsign, Open Agent, Cancel Round (destructive, last, separated).
- Destructive items open an alert dialog; they never act directly.

## Popover — `.hh-popover`

A toggletip: a button with `aria-expanded` opens a non-modal `.hh-popover` with explanation text, width `--hh-overlay-popover-width`, `--hh-surface-card`, `--hh-elevation-overlay`, `--hh-layer-popover`. Used for "Why CLAUDE?" next to detection data and "What happens at zero?" next to a policy badge. Escape closes; focus returns to the button.

## Tooltip — `.hh-tooltip`

[APG tooltip](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/): `.hh-tooltip-anchor` wraps an icon-only button and its `.hh-tooltip` (`role="tooltip"`, linked by `aria-describedby`), shown on hover and focus-within, dismissible with Escape, hoverable (SC 1.4.13). Inverted colours (`--hh-foreground` on `--hh-background`), max width `--hh-overlay-tooltip-width`, `--hh-layer-tooltip`. A tooltip may also show the shortcut (`Copy id · c`). It is never the only name of a control and never holds status.

## Toast — `.hh-toast`

Confirms an action the Human took: "Answered · CLAUDE·api-refactor", with "Open in log". Stays until dismissed or replaced, never leaves on a timer. Toasts stack in `.hh-toast-region` (fixed at the inline-end bottom corner, `role="status"`, `--hh-layer-toast`); `data-placement="inline"` renders one in flow for specimens. `--hh-surface-tray` with `--hh-elevation-overlay`. Failures never go in a toast; they go in the Answer bar as `role="alert"`.

## Motion

Dialogs pop from `--hh-enter-scale` with opacity 0 on `--hh-motion-panel` and `--hh-easing-enter`; sheets slide in from the end edge on `--hh-easing-drawer`; toasts rise by `--hh-enter-offset`; tooltips fade on `--hh-motion-fast`. Exits are faster than entries. Under reduced motion they appear and disappear at once.

## Accessibility summary

| Overlay | Role | Focus on open | Focus on close |
|---|---|---|---|
| Dialog | `dialog` (native, modal) | First field | Trigger |
| Alert dialog | `alertdialog` | Safe action | Trigger |
| Sheet | `dialog` (native, modal) | First interactive item | Trigger |
| Menu | `menu` | First item | Menu button |
| Popover | `group` with label | Stays on button | Button |
| Tooltip | `tooltip` | No change | No change |
| Toast | inside `status` region | No change | No change |

## Agent recipe

- Confirmation: alert dialog, title names the object, description names the consequence, safe action focused.
- Phone Round: full-screen sheet with the Answer bar as footer.
- Tokens: `surface-panel`, `scrim`, `border`, `ring`, `destructive`, `layer-overlay`, `layer-dropdown`, `layer-popover`, `layer-toast`, `layer-tooltip`, `overlay-*-width`, `motion-*`, `easing-*`, `enter-scale`.
