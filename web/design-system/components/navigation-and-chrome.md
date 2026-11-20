# Navigation and Chrome

The Command Center has little chrome: an app bar with the connection state, a side navigation on desktop, a bottom navigation on phone, and tabs inside detail views. Chrome stays quiet so strips carry the attention.

## Page chrome at a glance

| Region | Desktop (≥ 64rem) | Phone (glance) |
|---|---|---|
| Skip link | `.hh-skip-link` → strip bay or main | Same |
| App bar | `.hh-app-bar`: Hub name, pending count, `.hh-connection`, keyboard hints button, settings | Same, condensed: pending count and connection only |
| Navigation | `.hh-side-nav`: Triage, Answered log, Agents, Settings | `.hh-bottom-nav`: Pending, Log, Agents |
| Wayfinding | `.hh-breadcrumbs` in Agent detail and settings sub-pages | Back link |

## App bar — `.hh-app-bar`

- Anatomy: `.hh-app-bar-brand` (Hub name in the strip-header face, set by the Human, e.g. "Hub · studio-mac"), the pending count as a `.hh-live-value` ("Pending · 3"), `.hh-app-bar-spacer`, `.hh-connection` ([status-widgets.md](status-widgets.md#connection--hh-connection)), actions (keyboard hints `?`, settings).
- Sticky at the top on `--hh-layer-sticky`. Tokens: `--hh-surface-tray` / `--hh-surface-tray-foreground`, `--hh-border` on the bottom edge across the full width, `--hh-density-gap`.
- The pending count is part of the page title too ("(3) Triage · Hermes Hub") so it shows in the browser tab.
- Landmark: `<header>`. The count is not a live region; the bay status region announces changes ([accessibility.md](../foundations/accessibility.md#live-regions)).

## Side navigation — `.hh-side-nav`

- `<nav aria-label="Command Center">` with links at least `--hh-button-min-target` tall. The current page has `aria-current="page"` and an `--hh-accent` / `--hh-accent-foreground` fill across the whole item, never a side bar; add a leading icon or heavier weight so the current item is not marked by fill colour alone.
- Each item may end with a `.hh-side-nav-count` (mono, tabular): "Triage 3". Counts are in the accessible name ("Triage, 3 pending").
- Below 64rem it moves into a sheet opened from the app bar ([overlays.md](overlays.md#sheet--hh-sheet)).

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

## Accessibility behaviour

- Landmarks: `header`, `nav`, `main`, and `aside` for the open Round beside the bay.
- Page titles name the view and the pending count.
- Focus moves to the main heading after navigation; the skip link stays first.
- The app bar never hides the focused strip (SC 2.4.11): the bay scrolls with `scroll-padding-top` equal to the app bar height.

## Agent recipe

- Desktop page: skip link → app bar (title, pending count, connection, hints, settings) → side nav → main.
- Phone page: skip link → app bar (pending count, connection) → main → bottom nav, `data-density="glance"`.
- Tokens: `surface-tray`, `border`, `ring`, `accent`, `primary`, `layer-sticky`, `layer-skip-link`, `button-min-target`.
