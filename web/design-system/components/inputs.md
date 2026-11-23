# Inputs

Form controls in Hermes answer Questions, write notes and change settings. The Question widgets in [round-widgets.md](round-widgets.md) build on these primitives: a single-choice Question is a radio group of `.hh-option` rows, a free-text Question is a `.hh-field` with a `.hh-textarea`.

## Which one to use

| The Human needs to… | Use |
|---|---|
| Type a short value (token name, Hub name, filter text) | Input |
| Write a free-text answer or a note | Textarea |
| Pick one value from a long list in settings | Select |
| Turn a setting on or off, effective at once | Switch |
| Choose one of a few options shown together | Radio group |
| Choose any of a few options | Checkbox group |
| Filter the bay or the log (by Agent, by status) | Chip |
| Label any control with hint and error | Field |

## Field — `.hh-field`

The wrapper for every control: label, optional hint, control, error.

- Anatomy: `label.hh-label`, optional `p.hh-hint` (linked by `aria-describedby`), the control, `p.hh-error` (linked by `aria-describedby`, shown only when invalid, with an icon before the text).
- Invalid: the control has `aria-invalid="true"` and a `--hh-destructive` border; the error names the fix ("Name the token, for example laptop-cli").
- Required: the label says "(required)" in words; no asterisk-only marking.
- Tokens: `--hh-type-label-*`, `--hh-muted-foreground` and `--hh-type-body-sm-*` for hints, `--hh-destructive` for the invalid border, `--hh-space-1` gap.

## Input — `.hh-input`

- Height `--hh-button-min-target`, `--hh-input` background, `--hh-foreground` text, `--hh-border` boundary (3:1 against `input` and every surface). Input, select and textarea share one style.
- States: empty, focus (ring), filled, invalid, disabled (reason linked with `aria-describedby`), read-only (ids shown for copying, in mono).
- Secrets (tokens) are shown once at creation in a read-only mono input with a Copy button, then never again.

## Textarea — `.hh-textarea`

- Free-text answers and notes. Grows with content up to a max, then scrolls.
- A character count, when the Agent declares a limit, is polite and announced only at 80% and at the limit.
- `⌘↵` / `Ctrl+Enter` submits the whole Round from inside a textarea; plain Enter adds a line. The hint under the field says so.
- Letter and digit triage shortcuts are off while a textarea has focus.

## Select — `.hh-select`

Native `<select>` styled with tokens, for settings only (notification sound, theme, world). Never used for a Question's options: the Human must see every option at once.

## Radio group — `.hh-radio`

[APG radio group](https://www.w3.org/WAI/ARIA/apg/patterns/radio/): one Tab stop; arrow keys move and select; Space selects.

- `label.hh-radio` wraps a native `<input type="radio">` and its text, at least `--hh-button-min-target` tall; the group is a `<fieldset>` with a `<legend>`.
- The native control takes `accent-color: --hh-accent` at `--hh-icon-size`; checked is the native filled dot, which is a shape cue, not colour alone.
- Question options use the larger `.hh-option` row instead ([round-widgets.md](round-widgets.md#option--hh-option)).

## Checkbox — `.hh-checkbox`

[APG checkbox](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/): Space toggles; each checkbox is a Tab stop inside its `<fieldset>`.

- `label.hh-checkbox` wraps a native `<input type="checkbox">`, same sizing as the radio.
- Checked shows the native check mark; mixed (for "Select all" in the log) uses the native `indeterminate` state.

## Switch — `.hh-switch`

[APG switch](https://www.w3.org/WAI/ARIA/apg/patterns/switch/): `button.hh-switch[role="switch"]` with `aria-checked`, containing `.hh-switch-track` > `.hh-switch-thumb` and a fixed label ("Single-key shortcuts"). On: track fills with `--hh-accent` and the thumb moves to the end in `--hh-accent-foreground`; the state word "On"/"Off" sits beside the track, so position and word carry the state, not colour. Takes effect at once and confirms with a status message. Target height `--hh-button-min-target`; the track is sized from `--hh-callsign-chip-height`.

## Chip — `.hh-chip`

Filter chips for the bay and the log: "Pending", "Expired", each callsign.

- A chip is a `<button>` toggle with `aria-pressed`, height `--hh-control-size-sm`, `--hh-border` boundary. Pressed: filled with `--hh-accent` / `--hh-accent-foreground` plus a leading check icon, so the state is not colour alone.
- A group of chips sits in `role="group"` with a label ("Filter by status").
- Callsign chips used as filters reuse `.hh-callsign` inside `.hh-chip` ([agent-widgets.md](agent-widgets.md#callsign-chip--hh-callsign)).
- Removable chips have a separate Remove icon button with `aria-label="Remove filter CLAUDE·api-refactor"`.

## Density

- Compact: smaller padding, `control-size-sm` heights in toolbars; never below 24 CSS px.
- Glance: `button-min-target` ≥ 3rem, larger `type-body-size`, roomier rows.

## Agent recipe

- Every control sits in a `.hh-field` with a visible label.
- Errors say what to do, in Dispatcher voice, with the fix.
- Tokens: `input`, `foreground`, `border`, `ring`, `destructive`, `muted-foreground`, `accent`, `button-min-target`, `option-row-min-height`, `control-size-sm|lg`, `icon-size`.
