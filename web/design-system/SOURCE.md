# Design system source

Copied from the Apollo design master. **Files in this folder are read-only here**: change them in the master first, then re-copy and update this file.

| | |
|---|---|
| Brand | `hermes` (Hermes Hub, token prefix `--hh-*`) |
| Master repo | `jazhou-adobe/apollo-tokens`, path `brands/hermes/design` |
| Master commit | `1d03cf95ad82e400e88e346ff0cb8cb683ee58da` |
| Theme | `hermes-flight-director` (Flight Director 2169), `data-theme` on `<html>` |
| Colour option | default, **Console slate** (no `data-palette`) |
| Density | `compact` on the Feed index region (`data-density="compact"`); the Rounds and every other surface use the default density. `glance` is not used (the phone surface is out of scope). |
| Resolved by | `node .skills/apply-apollo-theme/scripts/theme-manifest.mjs hermes flight-director` in the master repo |

## What was copied

The manifest `copy` list, with the relative layout kept:

- `tokens/themes.css`, `tokens/tailwind-theme.css`, `tokens/tokens.json`
- `tokens/worlds/flight-director.css`, `tokens/worlds/flight-director.json`
- `preview/hermes-components.css` (the components stylesheet; its path in the master is `preview/`)
- `agent-contract/screen-generation-rules.md`, `foundations/`, `components/`, `patterns/`
- `fonts/BigShoulders-latin-variable.woff2` (from the master's `app/fonts/`)

Not copied: `preview/*-preview.css`, `app/` (except that woff2), `research/`, `archive/`, `validation/`, `.next/`.

Two files in this folder are **not** in the manifest and are written here:

- `base.css`: the `@layer base` block of the master's `app/globals.css`, verbatim, so a plain-CSS entry can import it (the adoption skill says to copy those rules).
- `fonts.css` and the other files in `fonts/`: see Fonts.

## Recorded deviations

1. **Bun HTML import instead of Next.js.** The Command Center is a Bun-bundled React SPA (`docs/specs/frontend-stack.md`), so there is no `app/layout.tsx`, `app/fonts.ts` or `next build`. The theme attribute goes straight on `<html>`.
2. **Self-hosted fonts with recorded sources instead of `next/font`.** `fonts.css` declares the `@font-face` rules and sets the six `--font-*` variables the tokens reference, to the family names. Sources below.
3. **No Tailwind.** `tokens/tailwind-theme.css` is copied but imported by neither `web/preview/` nor the app; layout glue is plain CSS on `--hh-*` tokens (`web/preview/preview.css`, ported to `web/src/app.css`).
4. **No world CSS inlining.** The world stylesheet is imported unlayered, as the adoption skill describes (the master inlines it from `app/layout.tsx` only for `next dev`).

## CSS import order

1. `tokens/themes.css`
2. `preview/hermes-components.css` in `layer(components)`
3. `tokens/worlds/flight-director.css`, unlayered
4. `base.css` (the base layer)
5. `fonts.css`

The app (`web/src/app.css`) keeps this cascade but declares `@layer components, base;` first and imports `base.css` and `fonts.css` before the rest, because Bun's test-time bundler fails to resolve a top-level `design-system/` file imported after one from a subfolder. The layer statement keeps the order identical. Bun inlines the woff2 files as data: URLs, so the Hub's CSP allows `font-src data:`.

## Fonts

Latin subset woff2, all **SIL Open Font License 1.1**. Each face's licence text sits next to it as `fonts/OFL-<Family>.txt` (copied from the npm package's `LICENSE`).

| Family | Variable | File(s) in `fonts/` | Source |
|---|---|---|---|
| Schibsted Grotesk (400-900) | `--font-schibsted-grotesk` | `SchibstedGrotesk-latin-variable.woff2` | `@fontsource-variable/schibsted-grotesk@5.3.0`, `files/schibsted-grotesk-latin-wght-normal.woff2` |
| Spline Sans Mono (300-700) | `--font-spline-sans-mono` | `SplineSansMono-latin-variable.woff2` | `@fontsource-variable/spline-sans-mono@5.3.0`, `files/spline-sans-mono-latin-wght-normal.woff2` |
| Big Shoulders (100-900) | `--font-big-shoulders` | `BigShoulders-latin-variable.woff2` | The design master's `app/fonts/BigShoulders-latin-variable.woff2` (licence text from `@fontsource-variable/big-shoulders@5.3.0`) |
| Archivo (100-900) | `--font-archivo` | `Archivo-latin-variable.woff2` | `@fontsource-variable/archivo@5.3.0`, `files/archivo-latin-wght-normal.woff2` (wght axis only, like `next/font` with no `axes`) |
| IBM Plex Mono (400, 500, 600, 700) | `--font-ibm-plex-mono` | `IBMPlexMono-latin-{400,500,600,700}.woff2` | `@fontsource/ibm-plex-mono@5.3.0`, `files/ibm-plex-mono-latin-<weight>-normal.woff2` |
| Michroma (400) | `--font-michroma` | `Michroma-latin-400.woff2` | `@fontsource/michroma@5.3.0`, `files/michroma-latin-400-normal.woff2` |

The flight-director world sets sans to Archivo, mono to IBM Plex Mono and the condensed role to Michroma; the other three faces serve the core themes (`hermes-dark`, `hermes-light`), which the Appearance setting can switch to.
