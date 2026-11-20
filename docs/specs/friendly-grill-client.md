# friendly-grill as a thin client of the Hub (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [How does friendly-grill become a thin client of the Hub?](https://github.com/jazhou-adobe/hermes-hub/issues/17).

- **Builds on:** the [schema](round-schema.md), [transports](transports.md) and [Hub Skill](hub-skill.md) specs.
- **Where the code lives:** friendly-grill lives in `cyber-avatar/.agents/skills/workflow/friendly-grill`, so the implementation lands in **that** repo, not in hermes-hub.

## What changes for callers: nothing

Agents keep writing **friendly-grill round files** and reading **friendly-grill answers**. The skill keeps its name, its trigger description, its round format and its stdout markers. Only the command in step 2 of its procedure changes:

```bash
node <skill-dir>/scripts/ask.mjs /tmp/<topic>-grill/round1.json --out /tmp/<topic>-grill/round1.answers.json
```

The command still runs **as a background job**, and the agent waits for it **without polling**, exactly as today.

## `scripts/ask.mjs`

1. **Hub check:** if `hermes` is on PATH and `GET /v1/hub` answers (discovery per the [identity spec](agent-identity.md)), it continues with the Hub path below.
2. **Fallback:** otherwise it execs the **unchanged** `form-server.mjs` with the same arguments, so behaviour is exactly today's.
3. **Hub path:**
   - converts the round to a Hermes Round (mapping below);
   - runs `hermes ask <round> --out <tmp>` and waits for it;
   - converts the Hermes Answer back to the friendly-grill answer shape;
   - writes it to `--out`;
   - prints the same markers: `READY <Command Center URL for the Round>`, `ANSWERS_FILE <path>`, and `ANSWERS` followed by the JSON.

The converter lives **only in friendly-grill**. Hermes never learns the friendly-grill format.

### Round mapping (friendly-grill → Hermes)

| friendly-grill | Hermes Round |
|---|---|
| `title` | `title` (truncated to 120 characters) |
| `lead`, `factsTitle`, `facts[]` | `context`: the lead, then `### <factsTitle>` and a bullet per fact, converted from HTML to Markdown |
| question `id` | Question `id`, lower-cased and sanitised to `^[a-z0-9][a-z0-9_-]{0,63}$`, with the original id kept for the way back |
| `type: single` / `multi` / `text` | `kind: single` / `multi` / `text` |
| `title` / `body` | `prompt` (plain text) / `detail` (Markdown) |
| `options[].label` / `desc` | option `id` (`o0`, `o1`, …), `label`, `detail` (Markdown) |
| `recommended` (index or indexes) | `recommended` (option id or ids), **marked, never preselected** |
| `other` (default true) | `allow_other` (default **true** here; `false` only when the round says `other: false`) |
| (none) | `policy: {on_timeout: "wait"}`; `required: true` |

- **HTML to Markdown:** `<b>`/`<strong>` → `**`, `<i>`/`<em>` → `_`, `<code>` → backticks, `<a href>` → `[text](url)`, `<br>` and `<p>` → line breaks, `<ul>`/`<li>` → bullets.
- **Other tags are stripped and their text kept.** Inline SVG and the like don't survive the Hub path; the local fallback still renders them.

### Answer mapping (Hermes → friendly-grill)

| Hermes Answer | friendly-grill answer |
|---|---|
| `single` `{selected: "o2"}` | `"<label of o2>"` |
| `single` `{other: "text"}` | `"__other"` and `<id>__notes: "text"` |
| `multi` `{selected: [...], other?}` | `["<label>", …]`, plus `"__other"` and the notes text when Other is present |
| `text` `{text}` | `"text"` |
| per-Question `note` | `<id>__notes` (appended after any Other text) |
| Round `note` | `__general` |
| `outcome` | **new key `__outcome`**: `answered`, `dismissed`, `redirected`, `expired` or `cancelled` |
| `message` (redirected) | `__general` (prefixed `Redirected: `) |

- **Questions without a value** (`null`) come back as `""` (single or text) or `[]` (multi).
- **`__outcome` is additive.** friendly-grill forbids ids starting with `__`, so it can't collide with a question. Existing callers that ignore it still work. The SKILL.md tells agents: **if `__outcome` isn't `answered`, read `__general` and don't treat the answers as decided.**

## Behaviour changes on the Hub path (accepted)

- **The recommended option is marked, not preselected.** This matches the Command Center rule.
- **HTML becomes Markdown**, with unsupported tags stripped.
- **"Other" stays on by default.**
- **Advisors, Locks and supersede don't apply** in practice: every friendly-grill round uses the `wait` policy and is never superseded. An Advisor can still be asked from the Command Center.
- **The round appears in the Command Center Feed** under the calling Agent's callsign, which is detected as usual, and stays in history.

## SKILL.md updates

- **Step 2** runs `scripts/ask.mjs` instead of `form-server.mjs`.
- **New note:** "When the Hermes Hub is running, the round opens in its Command Center instead of a separate page. Otherwise it opens the local form as before."
- **The answer format section** documents `__outcome`.

## Not in Phase 1

- Changing the friendly-grill round format.
- Moving friendly-grill into hermes-hub.
- Retiring the local form server.
