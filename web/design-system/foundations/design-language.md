# Design Language: Flight Strips, carrier ops room

## Creative spine

The **Command Center** is the strip board in the operations room of a spacecraft carrier. Every **Round** an **Agent** sends to the **Hub** is a flight-progress **strip** slid into a **holder** in the **strip bay**. The **Human** works the board like a controller: reads the strip, decides, hands it back, and moves on to the next one.

The metaphor is borrowed from two real working boards, both described in [ops-room-and-strip-references.md](../research/ops-room-and-strip-references.md):

- **Flight progress strips** in air traffic control. A strip is "a concise record of the operational information a controller needs at any particular moment", held in a strip holder and arranged in bays so that "its position [tells] a story" ([NATS, 2026](https://nats.aero/blog/2026/01/atc-explained-flight-progress-strips/)). Electronic strip systems keep the same layout: strips in **bays** with sections, and greyed "ghost" strips for traffic that is not actionable here ([EUROCONTROL ITWP HMI description §2.5–2.6](https://www.eurocontrol.int/sites/default/files/publication/files/itwp-hmi-description-v4-20012017.pdf)).
- **The carrier "Ouija board"** in Flight Deck Control: a scale plan of the flight deck where the handler moves aircraft templates and marks each one with pins and washers, so that anyone can "look at the ouija board and tell" what is happening ([Smithsonian Air & Space, 2008](https://www.smithsonianmag.com/air-space-magazine/how-things-work-the-ouija-board-10048217/)).

Hermes takes the structure of those boards (one record per item, position means something, status visible at a glance, the board survives a power cut) and pushes it forward in time. It does not copy aviation colour codes or form layouts.

Use the metaphor to name surfaces and compose screens. Never decorate with it: no aircraft clip art, radar sweeps, or fake rivets on reading surfaces.

## Style rule: used future

Hermes looks like real equipment that has been in service for years: tactile, worn-in, labelled, functional.

| Do | Don't |
|---|---|
| Opaque, paper-like strips on a slate bay | Glass panels, `backdrop-filter`, frosted cards |
| Engraved-style labels, condensed strip headers, mono ids | Gradient text, chrome lettering |
| Glow on live state only: the connection lamp while streaming, a live count | Glow on every border, neon outlines, bloom on reading text |
| Wear and texture on page edges and empty bay floor only | Scanlines, CRT noise, film grain, texture behind text |
| Physical metaphors in layout (holders, bays, rails, jacks) | Literal hardware drawings on reading planes |
| Neon-free reading planes: Question text, attachments and free-text answers are opaque and high-contrast | Light text on near-black for long reading |

The same rule applies to every world ([Worlds](#worlds)).

## Personality: Dispatcher

**Dispatcher** is the voice: terse, exact, unhurried. Every Round is a decision with stakes. The Hub reports facts and consequences, then gets out of the way.

- Status word first, then the count, then the consequence: "Pending · 2 Questions · waits 10 min, then applies recommended".
- Name the Agent by its callsign, never "the bot" or "your assistant".
- Say what happens next, in time order: "Answered. CLAUDE·api-refactor resumes on its next poll."
- No chatter, no emoji, no exclamation marks, no apologies for normal operation.
- Numbers are exact and tabular: "02:41 left", not "a couple of minutes".

### Do

- "Pending · 3 Questions · keeps waiting"
- "Expired · policy applied recommended: Merge with squash"
- "Cancelled by CODEX·billing-ui at 14:02"
- "Reconnecting · retry in 4 s · the bay may be out of date"
- "No pending Rounds. Agents ask through the Hub Skill."
- "Submit Answer · 3 of 3 Questions answered"
- "Reject — the Agent stops this step and reads your note."

### Don't

- "Oops! Something went wrong 😅"
- "Your AI assistant needs your help!"
- "Hurry, time is running out!"
- "Great job! All done!"
- "Error" with no cause or next step.
- "Ticket", "request", "inbox", "dashboard", "user", "operator" ([GLOSSARY](https://github.com/jazhou-adobe/hermes-hub/blob/main/GLOSSARY.md) lists these as words to avoid).
- Status shown by colour alone, or a status adjective before the status word ("Urgent pending Round").

## Principles

1. **The decision is the screen.** Question text, options, the recommended marker, attachments and the Unanswered Policy are the content. Everything else is chrome and stays quiet.
2. **Status in words, colour as backup.** Every holder pairs its colour with a status word. A Human with no colour vision triages as fast as anyone ([accessibility.md](accessibility.md#non-colour-status)).
3. **The policy is never a surprise.** A strip with a timer always states what happens at zero, in words, before the timer can fire.
4. **Keyboard first, pointer welcome.** Triage runs from the keyboard beside a terminal; every key has a visible hint and a pointer equivalent.
5. **Position means something.** The bay is a disciplined grid. Pending strips sit together in arrival order; answered and expired strips leave the bay for the answered log.
6. **One Human, many Agents.** Callsigns make every Agent distinct at a glance, always with text.
7. **Agents choose from rails.** Screens start from an approved blueprint and semantic tokens ([screen-generation-rules.md](../agent-contract/screen-generation-rules.md)). Carbon MCP and Figma Code Connect are the precedents for giving agents source-of-truth components ([mature-design-system-references.md §9](../research/mature-design-system-references.md#9-guidance-for-agents-generating-screens)).

## Domain vocabulary

Use the [GLOSSARY](https://github.com/jazhou-adobe/hermes-hub/blob/main/GLOSSARY.md) terms exactly, capitalised: **Hub**, **Command Center**, **Agent**, **Human**, **Hub Skill**, **Round**, **Question**, **Answer**, **Unanswered Policy**. The design layer adds these words:

| Term | Meaning | Class |
|---|---|---|
| **Strip** | One Round on the board | `.hh-strip` |
| **Holder** | The frame around a strip that carries its status colour, with a tab holding the status word | `.hh-strip` itself (`data-status`), tab `.hh-strip-tab` |
| **Strip bay** | The grid of strips; the triage queue | `.hh-strip-bay` |
| **Callsign** | An Agent's display identity: client kind plus label, e.g. `CLAUDE·api-refactor` | `.hh-callsign` |
| **Recommended marker** | Signal-green mark on the Agent's recommended option | `.hh-recommended` |
| **Policy timer** | The Unanswered Policy countdown along the strip's edge | `.hh-policy-timer` |
| **Answer bar** | The sticky bar that submits the whole Round | `.hh-answer-bar` |
| **Answered log** | The record of answered, expired and cancelled Rounds | `.hh-answered-log` |
| **Roster** | The list of Agents the Hub has seen | `.hh-agent-roster` |

## Holder status vocabulary

A holder is a **frame around the whole strip**: the status colour wraps the paper strip on every side, with a tab along the top that carries the status word, and the policy timer runs inside its bottom edge. It is never a thin coloured stripe down one side of a card; side-stripe accents are banned across the system ([screen-generation-rules.md](../agent-contract/screen-generation-rules.md#forbidden-patterns)).

| Holder colour | Role token | Status word | Meaning | Non-colour cue |
|---|---|---|---|---|
| Amber | `--hh-pending` | **Pending** | Waiting for the Human | Word "Pending" in the tab, policy sentence, timer fill |
| Cyan-steel | `--hh-answered` | **Answered** | Answered and delivered to the Agent | Word "Answered", check icon, Answer summary |
| Grey | `--hh-expired` | **Expired** or **Cancelled** | The Unanswered Policy fired, or the Agent cancelled | Word "Expired"/"Cancelled", outcome sentence ("Policy applied recommended at 14:10") |
| Signal green | `--hh-recommended` | **Recommended** | The Agent's recommended option inside a Question. A marker, never a Round status | Word "Recommended" in the marker tab |

Rules:

- The status word is the first text in the strip, in the holder's tab, before the callsign.
- Status words are fixed: Pending, Answered, Expired, Cancelled. Don't invent "Waiting", "Done", "Stale" as statuses ("Stale" is only a connection note on strips shown offline).
- `--hh-live` is for the connection and live values. It is not a Round status.
- Glow (`--hh-elevation-live`) is allowed only on live state: the connection lamp while streaming and a live value (`.hh-live-value[data-live="true"]`). Never on strips, holders or reading planes.

## Callsigns

Each Agent has a callsign chip: `CLIENT·label`, in the mono face, in uppercase client kind plus the self-declared label. Examples: `CLAUDE·api-refactor`, `CODEX·billing-ui`, `CURSOR·docs`, `COPILOT·infra`, `OMP·design`, `SCRIPT·nightly-sync`.

- The client kind comes from detection; the label is display text the Agent declares ([agent-detection-signals research](../research/ops-room-and-strip-references.md#agent-identity-and-callsigns)).
- Colour comes from `--hh-agent-1` … `--hh-agent-6`, assigned by a stable hash of the session id. Colour tells Agents apart; the text identifies them. Never show a callsign colour without its text.
- More than six live Agents reuse colours; the text keeps them distinct.

## Density modes

One system, two density knobs, set as token overrides on a region, not separate components ([Atlassian themes include density](../research/mature-design-system-references.md#3-theming-and-customization-rails)).

| Mode | Where | Attribute | Effect |
|---|---|---|---|
| Default | Settings, Agent detail, sign-in | none | Base `density-*`, `button-min-target`, `strip-min-height` |
| **Compact** | Desktop triage: strip bay, answered log, roster table | `data-density="compact"` | Lower padding, gap, row height and `strip-min-height`; `button-min-target` stays ≥ 24 CSS px |
| **Glance** | Phone: pending list, single-Round approve/reject | `data-density="glance"` | `button-min-target` ≥ 3rem, taller `option-row-min-height`, roomier `density-*`, larger `type-body-size` |

Use compact only where the Human scans many rows with a keyboard. Use glance on any surface reached from a phone over the tailnet.

## Containers

| Container | Hermes meaning | Use | Avoid |
|---|---|---|---|
| **Card** | One self-contained object | Agent card, attachment card, settings item | Nesting cards more than one level |
| **Panel** | A major workspace | The open Round, Agent detail, a settings section | A panel for a single chip |
| **Shelf** | A labelled collection | Roster, answered log group, attachments of one Question | Unlabelled rows that look like unrelated cards |
| **Tray** | Temporary actions or tools | Answer bar, filter tray, keyboard hint tray | Hiding navigation or permanent content in a tray |
| **Strip** | One Round | Strip bay, pending list | Using a strip for anything that is not a Round |

## Worlds

Flight Strips is the core direction. The chosen **world** is **Flight Director 2169** (`flight-director`), in the used-future style. It lives in `tokens/worlds/flight-director.json` and `.css`, with theme value `hermes-flight-director` and four colour options on `data-palette`. The other options explored (Deck Handling Board, Comms Deck, Starship Hermes, Telemetry Ribbon) are kept in [`archive/`](../archive/README.md). Any future world follows the same contract.

- A world changes how Hermes looks, never how it behaves: same components, copy, states, keyboard map and Dispatcher voice.
- A world may override only type, shape and depth tokens. Motion, density, spacing, layout and component sizes stay system-wide.
- A world clears every gate the core themes clear: contrast, focus, target size, non-colour status, reduced motion.
- Each world has one signature tied to a Round outcome (answered, sent back, approve/reject). It runs once on motion tokens, collapses under reduced motion, and the status word never depends on it.
- Reading planes stay opaque and quiet in every world. Textures and signature material live on page edges and the bay floor only.

## Agent rules

An agent building a Hermes screen must:

1. Pick an approved blueprint ([patterns/](../patterns/)).
2. Compose with strips, cards, panels, shelves and trays.
3. Use semantic `--hh-*` tokens only.
4. Choose density on purpose: compact for desktop triage, glance for phone.
5. Write Dispatcher copy with status words first.
6. Show the Unanswered Policy wherever a timer appears.
7. Include empty bay, reconnecting, offline and expired states wherever Rounds are shown.
