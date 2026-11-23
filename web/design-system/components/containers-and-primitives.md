# Containers and Primitive Components

Component docs capture parts, states, behaviour and accessibility, the dimensions Open UI and the WAI-ARIA Authoring Practices use for UI controls ([mature-design-system-references.md §5](../research/mature-design-system-references.md#5-component-anatomy-and-behavior)). Every class here is styled in `preview/hermes-components.css` and rendered at `/design`.

Conventions for every Hermes component:

- Class `.hh-<component>`; parts `.hh-<component>-<part>`.
- Variants on `data-variant`, sizes on `data-size`, state on ARIA attributes (`aria-pressed`, `aria-selected`, `aria-invalid`, `aria-busy`, `aria-disabled`) or `data-state` when ARIA has no fit.
- Colours come from semantic roles only (`--hh-<role>`), sizes from component tokens, spacing from `--hh-space-*` and `--hh-density-*`, stacking from `--hh-layer-*`.

## Containers

### Card — `.hh-card`

One self-contained object: an Agent, an attachment, a settings item.

- Anatomy: a heading row (title, optional callsign or badge in a `.hh-row`), content, optional actions row. Domain cards add named parts (`.hh-agent-card-head`, `.hh-attachment-head`).
- Tokens: `--hh-surface-card` / `--hh-surface-card-foreground`, `--hh-border`, `--hh-radius-md`, `--hh-elevation-raised`, `--hh-density-inset`.
- States: default; focus ring on the card's single link when the whole card is a link target; disabled shows reason text.
- Don't nest cards more than one level. Don't put a holder on a card: holders belong to strips.

### Panel — `.hh-panel`

A major workspace: the open Round, Agent detail, a settings section.

- Anatomy: heading, optional description and toolbar, content, optional footer.
- Tokens: `--hh-surface-panel` / `--hh-surface-panel-foreground`, `--hh-border`, `--hh-radius-md`, `--hh-density-inset`.
- A panel is a labelled region: `<section aria-labelledby>` with its heading.

### Shelf — `.hh-shelf`

A labelled collection: the roster, a group in the answered log, the attachments of one Question.

- Anatomy: heading with label and count, optional filter, the items, `.hh-empty-state` when empty.
- Tokens: `--hh-surface-shelf` / `--hh-surface-shelf-foreground`, a dashed `--hh-border` on every side (a shelf groups, it is not an object), `--hh-density-inset`.
- The count is a mono numeral in the header: "Agents · 4".

### Tray — `.hh-tray`

Temporary actions or tools: filters, the keyboard hint tray. The Answer bar is a specialised tray ([round-widgets.md](round-widgets.md#answer-bar--hh-answer-bar)).

- Anatomy: label, action group, optional dismiss.
- Tokens: `--hh-surface-tray` / `--hh-surface-tray-foreground`, `--hh-border` on the top and bottom edges across the full width, no radius, `--hh-layer-raised` when sticky.

## Primitive components

| Component | Class | Required states | Notes |
|---|---|---|---|
| Button | `.hh-button` | default, hover, focus, pressed, disabled, busy | Variants below. `min-height: var(--hh-button-min-target)`. Busy: `aria-busy="true"` + visible "Sending…" |
| Icon button | `.hh-icon-button` | default, hover, focus, pressed, disabled | Square at the size step; `aria-label` required; paired `.hh-tooltip` repeats the label; same `data-variant` and `data-size` as the button |
| Badge | `.hh-badge` | neutral, pending, answered, expired, success, warning, info, destructive | `data-tone` names the role; text plus icon; never colour alone |
| Kbd | `.hh-kbd` | default | `<kbd>` element, at least `--hh-kbd-size` square, mono face, heavier bottom edge like a key cap |
| Avatar | `.hh-avatar` | default | `data-size="sm"` → `--hh-avatar-size-sm`, default `--hh-avatar-size-md`; decorative beside a callsign |
| Divider | `.hh-divider` | — | `<hr>`, a full-width `--hh-border` rule. Never on one edge of a card as an accent |
| Spinner | `.hh-spinner` | running | Ring that rotates on `--hh-motion-pulse` and `--hh-easing-linear` beside visible words; the only looping animation, and it stops under reduced motion |
| Skeleton | `.hh-skeleton` | loading | Final shape, `--hh-muted` fill, fades three times then holds; the region has `aria-busy="true"` and a text label |
| Empty state | `.hh-empty-state` | bay, log, roster, search | Thick dashed `--hh-border`; says what is missing and the next action |
| Description list | `.hh-dl` | — | Two-column `dt`/`dd` grid for detection details and session data; `dt` in `--hh-muted-foreground` |

The token pairs behind these states are measured in every theme and world colour option by `validation/validate-design-system.mjs` (SC 1.4.3 text 4.5:1, SC 1.4.11 non-text 3:1). Status never relies on colour alone (SC 1.4.1).

## Button — `.hh-button`

Variants through `data-variant` (the default, with no attribute, is the secondary style on `--hh-secondary`):

- **primary**: the one main action in a region. "Submit Answer", "Approve". `--hh-primary` / `--hh-primary-foreground`.
- **default** (no attribute): the alternative beside it. "Close Round", "Copy id".
- **destructive**: rejects, cancels or removes. Names the object: "Reject deploy", "Cancel Round", "Revoke token". `--hh-destructive` / `--hh-destructive-foreground` and the cross icon.
- **ghost**: no fill until hover. Toolbars, row actions, Close buttons.

For navigation use `.hh-link`, not a button.

Sizes through `data-size`: `sm` → `--hh-control-size-sm` (compact rows), default → `--hh-button-min-target`, `lg` → `--hh-control-size-lg` (glance approve/reject). In compact density, `sm` is still ≥ 24 CSS px.

Toggles set `aria-pressed` and keep one fixed label ("Show resolved"). A toggle never both changes its label and carries `aria-pressed`.

Keyboard hints: a button with a shortcut shows a trailing `.hh-kbd` ("Submit Answer ⌘↵") and declares `aria-keyshortcuts="Meta+Enter Control+Enter"`.

Press motion: scale to `--hh-press-scale` on `--hh-motion-fast`.

Copy: verb first, names the result. Never "OK", "Yes", "Go".

## Badge — `.hh-badge`

A small uppercase status label: "Pending", "Answered", "Expired", "Cancelled", "Live", "Policy". `data-tone` takes `pending`, `answered`, `expired`, `success`, `warning`, `info` or `destructive` and fills the badge with `--hh-<tone>` / `--hh-<tone>-foreground`; with no tone it uses `--hh-secondary`. Status badges use the same words as the holder and carry an icon beside the word.

## Kbd — `.hh-kbd`

`<kbd class="hh-kbd">j</kbd>`: a key cap on `--hh-surface-shelf` with `--hh-border`, a thicker bottom edge, `--hh-radius-sm` and `mono-sm` type, at least `--hh-kbd-size` square. Combos are separate `.hh-kbd` elements side by side (`⌘` `↵`), with a word alternative ("Command Enter") in `.hh-visually-hidden`. Hints are text; never icon images.

## Layout primitives

| Primitive | Class | Use |
|---|---|---|
| Stack | `.hh-stack` | Vertical flow with the `--hh-density-gap` gap |
| Cluster | `.hh-row` | Wrapping row of buttons, chips, badges, gap `--hh-space-2` |
| Grid | `.hh-grid` | Auto-fill grid of equal items (Agent cards, settings tiles), minimum column `--hh-overlay-popover-width` |
| Measure | `.hh-measure` | Caps reading width at `--hh-layout-measure` |

Typography helpers set a type role on any element: `.hh-display`, `.hh-heading-lg`, `.hh-heading-md`, `.hh-strip-header`, `.hh-body-lg`, `.hh-body`, `.hh-body-sm`, `.hh-label`, `.hh-mono`, `.hh-mono-sm`; `.hh-caps` for uppercase with tracking; `.hh-muted` for secondary text.

Children carry no margins; the parent owns spacing. DOM order is reading order.

## Visually hidden text

`.hh-visually-hidden` keeps text in the accessibility tree without showing it: "Open" + " Round from CLAUDE·api-refactor", count words, key-combo words, table captions. Never hide information sighted people also need.

## Anatomy template

Each component doc in this folder covers:

1. Purpose and when not to use.
2. Anatomy: classes for root and parts.
3. Variants, sizes and states, with the attribute that sets each.
4. Token bindings.
5. Keyboard and ARIA, citing the APG pattern.
6. Copy rules.
7. Density behaviour (compact, glance).
