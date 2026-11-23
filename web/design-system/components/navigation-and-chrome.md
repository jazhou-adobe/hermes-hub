# Navigation and Chrome

The Command Center has little chrome: an app bar with the connection state, a side navigation on desktop, a bottom navigation on phone, and tabs inside detail views. Chrome stays quiet so strips carry the attention.

## Page chrome at a glance

| Region | Desktop (≥ 64rem) | Phone (glance) |
|---|---|---|
| Skip link | `.hh-skip-link` → the Feed (or strip bay) or main | Same |
| App bar | `.hh-app-bar`: Hub name, pending count, `.hh-connection`, keyboard hints button, settings | Same, condensed: pending count and connection only |
| Navigation | `.hh-side-nav` in `.hh-app-shell`: Feed, Answered log, Agents, Settings | `.hh-bottom-nav`: Pending, Log, Agents (reference; the Hub's Phase 1 has no phone surface) |
| Wayfinding | `.hh-breadcrumbs` in Agent detail and settings sub-pages | Back link |

## App bar — `.hh-app-bar`

- Anatomy: `.hh-app-bar-brand` (Hub name in the strip-header face, set by the Human, e.g. "Hub · studio-mac"), the pending count as a `.hh-live-value` ("Pending · 3"), `.hh-app-bar-spacer`, `.hh-connection` ([status-widgets.md](status-widgets.md#connection--hh-connection)), actions (keyboard hints `?`, settings).
- Sticky at the top on `--hh-layer-sticky`. Tokens: `--hh-surface-tray` / `--hh-surface-tray-foreground`, `--hh-border` on the bottom edge across the full width, `--hh-density-gap`.
- The pending count is part of the page title too ("(3) Feed · Hermes Hub") so it shows in the browser tab.
- Landmark: `<header>`. The count is not a live region; the bay status region announces changes ([accessibility.md](../foundations/accessibility.md#live-regions)).

## Side navigation — `.hh-side-nav`

- `<nav aria-label="Command Center">` with links at least `--hh-button-min-target` tall. The current page has `aria-current="page"` and an `--hh-accent` / `--hh-accent-foreground` fill across the whole item, never a side bar; add a leading icon or heavier weight so the current item is not marked by fill colour alone.
- Each item may end with a `.hh-side-nav-count` (mono, tabular): "Feed 3". Counts are in the accessible name ("Feed, 3 pending").
- In the Command Center shell (`.hh-app-shell`, [feed-widgets.md](feed-widgets.md)) the side nav is a wrapping row above the page below 64rem and a sticky column from 64rem. Elsewhere, below 64rem, it may move into a sheet opened from the app bar ([overlays.md](overlays.md#sheet--hh-sheet)).

## Bottom navigation — `.hh-bottom-nav`

- Phone only, in glance density. Three items: Pending, Log, Agents, in equal columns on `--hh-surface-tray` with a full-width top border. Each is an icon above a word, target ≥ `--hh-button-min-target`; the current item uses the same accent fill as the side nav.
- `<nav aria-label="Primary">`, `aria-current="page"` on the active item.
- Sits above the Answer bar's layer only when no Round is open; inside an open Round, the Answer bar replaces it.

## Breadcrumbs — `.hh-breadcrumbs`

[APG breadcrumb](https://www.w3.org/WAI/ARIA/apg/patterns/breadcrumb/): `<nav aria-label="Breadcrumb">` with an ordered list; the last item has `aria-current="page"`. Used in Agent detail ("Agents / CLAUDE·api-refactor") and settings sub-pages ("Settings / Exposure").

## Link — `.hh-link`

- Underlined by default, `--hh-primary` on surfaces where it passes 4.5:1, otherwise the surface foreground with underline.
- External links (Agent attachments) show the host after the text: "Pull request (github.com)".
- Links to a Round use its title and callsign, never "click here" or a bare id.

## Skip link — `.hh-skip-link`

First focusable element: "Skip to strip bay" on triage, "Skip to content" elsewhere. Hidden until focused, then shown above everything on `--hh-layer-skip-link`.

## Tabs — `.hh-tabs`

[APG tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) with automatic activation: Left/Right move and select, Home/End go to the ends, disabled tabs are skipped.

- Anatomy: `.hh-tabs` (`role="tablist"`), `.hh-tab` (`role="tab"`, `aria-selected`, `aria-controls`), `.hh-tab-panel` (`role="tabpanel"`).
- Used in Agent detail (Rounds · Detection · Session) and settings (Tokens · Exposure · Notifications and keys · Appearance).
- Selected: `--hh-foreground` text (others `--hh-muted-foreground`) and a heavy underline in `--hh-accent` across the tab; the underline is the shape cue, so selection never depends on text colour alone.
- Tabs never hold the strip bay's filters; those are chips ([inputs.md](inputs.md#chip--hh-chip)).

## Icons — `.hh-icon`

Line icons on a 24-unit grid, drawn in `currentColor`. The path data is `preview/hermes-icons.json` (icon name → SVG path), the file apps copy; the preview's `Icon` component and any app sprite read it. The stroke lives in `.hh-icon` (`fill: none`, `stroke: currentColor`, `stroke-width: var(--hh-border-width-thick)`, round caps and joins), so an inline `<svg class="hh-icon" viewBox="0 0 24 24"><path d="…"/></svg>` needs no presentation attributes; size `--hh-icon-size`.

- Set: `check`, `x`, `clock`, `chevron-down`, `chevron-right`, `link`, `file`, `code`, `diff`, `markdown`, `image`, `keyboard`, `signal`, `alert`, `user`, `menu`, `more`, `settings`, `send`, `lock`, `lock-open`, `copy`, `trash`, `refresh`, `bay`, `arrow-right`, `arrow-left`.
- Decorative by default (`aria-hidden="true"`, `focusable="false"`) beside words; an icon that names a control alone takes `role="img"` and `aria-label`, and the control a tooltip.
- Never a Unicode glyph or emoji in place of an icon (triangles, check marks, warning signs); the validator fails them in code and styles. The Feed index's In view cue is `chevron-right` plus the words.

## Accessibility behaviour

- Landmarks: `header`, `nav`, `main`, and `aside` for the open Round beside the bay or the Round drawer beside the lanes.
- Page titles name the view and the pending count.
- Focus moves to the main heading after navigation; the skip link stays first.
- The app bar never hides the focused strip or Round (SC 2.4.11): sticky regions sit at `--hh-layout-sticky-top`, and a page with a sticky Answer bar sets `scroll-padding-block` for both edges.

## Agent recipe

- Desktop page: skip link → app bar (title, pending count, connection, hints, settings) → side nav → main.
- Phone page: skip link → app bar (pending count, connection) → main → bottom nav, `data-density="glance"`.
- Tokens: `surface-tray`, `border`, `ring`, `accent`, `primary`, `layer-sticky`, `layer-skip-link`, `button-min-target`.
