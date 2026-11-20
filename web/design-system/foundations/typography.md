# Typography

Hermes typography does three jobs: reading Question text and attachments, scanning strips fast, and reading live numbers that change while the Human looks at them. Material, GOV.UK and Atlassian treat typography as a foundation with its own tokens for family, size, weight and line height, not a component detail ([mature-design-system-references.md §4](../research/mature-design-system-references.md#4-typography)).

## Families

Three families, each with one job. Faces are self-hosted through `next/font` in `app/fonts.ts` and exposed as `--font-<family>` variables on `<html>`; the tokens never depend on a locally installed face.

| Role | Token | Character | Use |
|---|---|---|---|
| Reading | `--hh-font-sans` | Schibsted Grotesk (variable): a plain grotesque with open apertures | Question text, option labels, notes, body, controls, settings |
| Machine | `--hh-font-mono` | Spline Sans Mono (variable), always with tabular numerals | Callsigns, Round ids, session ids, cwd and git refs, timers, counts, code and diffs |
| Strip header | `--hh-font-condensed` | Big Shoulders (variable, condensed) | Strip headers, holder status words, display, bay and section labels |

All three load as variable files through `next/font/google` in `app/fonts.ts`, so every weight the tokens name (`font-weight-regular`, `-semibold`, `-bold`, `-heavy`) is a real cut, never synthesised. Only the reading face is preloaded; the mono and condensed faces load when first used. The token values are in `tokens/tokens.json`.

Worlds may override `font-sans`, `font-mono`, `font-condensed`, `font-weight-*` and `type-*-family|size|line-height|weight` (type is one of the three world override groups). A world that does not override a family inherits the core one.

## Type scale

Each row is a DTCG `typography` token in `tokens.json` → `typography`, exported as `--hh-type-<name>-size`, `-line-height`, `-weight` and `-family`, and as a Tailwind `text-<name>` utility. Values live in `tokens.json`; this table gives the job.

| Token | Family | Use |
|---|---|---|
| `display` | condensed | Preview headers and the empty-bay headline only |
| `heading-lg` | condensed | Page titles: "Triage", "Answered log", "Agents" |
| `heading-md` | sans | Panel and section headings, the open Round's title |
| `strip-header` | condensed | Strip header line: status word, Round title, Question count |
| `body-lg` | sans | Question text in the open Round |
| `body` | sans | General UI text. Glance density raises `type-body-size` |
| `body-sm` | sans | Supporting text, hints, timestamps in words |
| `label` | sans | Form labels, field names, chip text that is not mono |
| `mono` | mono | Callsigns, ids, timers, counts, code blocks, diffs |
| `mono-sm` | mono | Dense metadata: session ids, cwd, git branch, log timestamps |

## Live numerals

Every value that changes while visible (policy timers, pending counts, reconnect countdowns, connection age) uses the mono face with `font-variant-numeric: tabular-nums`, so digits do not shift as they change.

- Timers read `mm:ss` under an hour and `h:mm:ss` above, never "a few minutes".
- Counts are numerals, not words: "3 Questions".
- Times of day use 24-hour `HH:MM` in the answered log and `HH:MM:SS` in detail views.
- A live number never animates its digits (no odometer roll). It changes in place ([motion.md](motion.md#what-never-moves)).

## Callsigns and ids

- Callsigns are `CLIENT·label`: client kind in uppercase, a middle dot (U+00B7), then the Agent's label as declared. Set in `mono`; truncate the label, never the client kind, with the full callsign in the accessible name.
- Round ids and session ids are mono and selectable. Show the first 8 characters in strips and the full id in detail views, with a copy button.
- File paths and git refs are mono and break on `/`, never mid-word.

## Reading rules

- Question text is set in `body-lg` on an opaque reading plane at `--hh-strip-foreground` or the panel foreground, with a measure capped at `--hh-layout-measure`.
- Status words come first and are set in `strip-header` (uppercase is styling, not content: the DOM text is "Pending", so screen readers do not spell it out).
- Never set reading text in the condensed face. Condensed is for one-line headers.
- Never set reading text in mono, except code, diffs and logs.
- Attachments keep the author's line breaks. Code blocks scroll horizontally inside `--hh-code-max-height`; they never wrap code silently.

## Glyph test

At `/design`, the glyph test sets one string in the sans, mono and condensed roles: `1 l I | 0 O o | rn m | 5 S | 8 B | 2 Z | ·` plus a sample callsign `CLAUDE·api-refactor`, a Round id `r_7f3a91c0`, a timer `09:58` and a diff line. Run it whenever a family or weight changes. A face fails when:

- `1`, `l` and `I`, or `0` and `O`, render alike in the mono role (ids and session ids become ambiguous);
- digits are not tabular in the mono role;
- the middle dot is missing or falls back to another face;
- the condensed face is so narrow at `strip-header` size that status words lose legibility at arm's length.

## Density

| Density | Treatment | Tokens |
|---|---|---|
| Default | Calm reading for settings and detail | `:root` values |
| Compact | Smaller body and row height for desktop triage | `[data-density="compact"]` lowers `type-body-size`, `density-*` |
| Glance | Larger body for phone use at arm's length | `[data-density="glance"]` raises `type-body-size` |

Compact never shrinks Question text below `body`; the triage list gets smaller, the open Round does not.

## Focus

- The focus ring uses `--hh-ring` at `--hh-focus-ring-width` with `--hh-focus-ring-offset`, above the 2 CSS px perimeter guidance of WCAG 2.2 SC 2.4.13 ([theme-token-architecture-sources.md](../research/theme-token-architecture-sources.md)).
- Focus never changes font weight, so text does not reflow when the roving focus moves down the bay.
