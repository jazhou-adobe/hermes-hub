# Hermes Hub: how do pins anchor to elements inside a cross-origin sandboxed design, and survive Revisions?

Research date: 2026-11-28. Ticket: [#48](https://github.com/jazhou-adobe/hermes-hub/issues/48), on the map
[#46](https://github.com/jazhou-adobe/hermes-hub/issues/46). It feeds the feedback model
([#52](https://github.com/jazhou-adobe/hermes-hub/issues/52)) and the viewer prototype
([#54](https://github.com/jazhou-adobe/hermes-hub/issues/54)). The isolation mechanism belongs to
[#47](https://github.com/jazhou-adobe/hermes-hub/issues/47) and live-URL proxying to
[#49](https://github.com/jazhou-adobe/hermes-hub/issues/49). This note assumes only what every
candidate in #47 has in common: **the design document is cross-origin to the Command Center**,
whether it has an opaque `null` origin (a sandboxed frame) or a separate Hub port.

**Question.** The Human pins comments to elements or regions of a Revision rendered in an isolated
frame. How is an anchor captured across the frame boundary? What shape should it have? How does it
re-attach, or become orphaned, when the next Revision changes the DOM? Does it work with touch on
an iPad? How does it apply to a single file, a bundle, a live URL and a screenshot? Which anchor
model and injection approach should the Hub use?

**Evidence labels**

| Label | Meaning |
|---|---|
| **D** | Documented in a spec or in the vendor's official docs or API schema |
| **S** | Seen in source code or a shipped bundle but not documented, so it can change |
| **[UNVERIFIED]** | Could not be confirmed from a primary source |
| **[INFERENCE]** | The researcher's reasoning, not a sourced fact |

Citations `[Sn]` point to [Sources](#sources). Everything under "Recommendation" is analysis.

---

## TL;DR

1. **An overlay script must run inside the design document.** The Command Center cannot read a
   cross-origin frame's DOM, scroll offsets or hit targets, so a pin drawn over the `<iframe>` from
   outside knows nothing about what lies under it [S20][S21] [INFERENCE]. Every DOM-anchoring tool
   surveyed runs its code inside the page. BugHerd [S5], Marker.io [S8] and the Vercel Toolbar
   [S2][S3] use a script tag. Pastel [S6] and Ruttl [S9] use a proxy that injects it. Hypothesis
   injects a "guest" into each annotatable frame and connects it to its UI with a `MessageChannel`
   [S11][S13].
2. **The overlay carries no authority.** It shares a realm with the design's own JS, so the design
   can read, spoof or block anything the overlay sends [INFERENCE]. Two rules keep that harmless.
   The frame only ever reports *where*: anchors, rectangles and pin clicks. Comment text, verdicts
   and Send stay in the Command Center. And the Command Center treats every message as untrusted
   input. It checks `event.source === iframe.contentWindow` (an opaque origin arrives as the string
   `"null"`, so the origin proves nothing), validates the schema and caps sizes [S20][S13].
3. **Store several selectors per anchor and try them in order**, the way the W3C Web Annotation
   model does with multiple `selector`s and `refinedBy` [S1] and Hypothesis does with its chain of
   range, then position, then quote selectors [S11]:
   1. `data-review-id`, an Agent-authored stable id. Playwright calls the test-id equivalent "the
      most resilient" locator [S17].
   2. A generated unique CSS selector, for example `@medv/finder` [S15].
   3. A `TextQuoteSelector` (exact text with a prefix and a suffix) [S1].
   4. An element fingerprint scored by weighted similarity, as in Similo [S18].
   5. Finally the point as a fraction of the element's box, plus the page coordinates at capture
      time.
4. **Re-attach in the browser when the Human opens the next Revision**, because only the browser
   has the DOM. Each comment gets a status for that Revision:
   - `attached`: an exact match by review id or CSS selector;
   - `moved`: a fuzzy text or fingerprint match, shown with a "check placement" mark;
   - `hidden`: the element exists but is not visible at this viewport;
   - `orphaned`: no match.

   Orphans are never dropped. They are listed apart with their stored text and context, as
   Hypothesis's *Unanchored* tab [S12] and Pastel's sidebar [S7] do.
5. **Touch works**, given three things. iPadOS Safari has Pointer Events (since iPadOS 13) [S22].
   Tap selection has to be told apart from scrolling, using `pointercancel` [S23]. And the overlay
   must cancel `click` itself, because `preventDefault()` on pointer events does not stop it
   [S23]. With no hover on touch, a tap *selects* an element and the Human then confirms it or
   widens it to the parent. Region drags need a mode with `touch-action: none` [S24]. Pins
   need 44×44 pt targets [S26], scaled by the viewer's zoom.
6. **Per source:**
   - **Single files and bundles:** the Hub injects `<script src=".../overlay.js">` as it serves each
     HTML file. The page key is the file's path in the bundle.
   - **Live URLs:** the proxy from #49 injects the same script. The overlay re-anchors after HMR,
     debounced, and never while the Human is composing.
   - **Screenshots** have no DOM. A pin is a normalized point or rectangle on the image (the shape
     of a Media Fragments `xywh=percent:`) [S1][S19]. It carries over only by screenshot key and is
     always flagged "approximate" once the image changes.

---

## 1. Why the Hub constraints force an in-frame overlay

- **The Command Center locks itself down today.** Its CSP is `default-src 'self'` with
  `frame-ancestors 'none'`, and the browser guard refuses cross-site requests (`src/hub/server.ts`,
  `docs/specs/security.md`). Design HTML must never become same-origin with it, because it could
  then call `/cc/*` and answer Rounds (map #46).
- **A cross-origin parent cannot look inside the frame.** With `sandbox` and no
  `allow-same-origin`, the document gets "a special origin that always fails the same-origin
  policy" [S21]. A separate port fails the same-origin check too. Either way, the Command Center
  cannot call `contentDocument`, `elementFromPoint` or `scrollY` on the frame [INFERENCE from
  the same-origin policy].
- **A transparent layer over the iframe is not enough.** It could record a point within the
  frame's viewport. It could not know the scroll offset, the element under the point, or where that
  element moves at another viewport width [INFERENCE]. That gives coordinate-only pins with no
  scroll information, which is worse than BugHerd's coordinate fallback (below).
- **`postMessage` is the only channel, and the receiver must check the sender.** MDN: "always
  verify the sender's identity using the origin and possibly source properties … you still should
  always verify the syntax of the received message" [S20]. For an opaque origin `event.origin` is
  `"null"`, and replies need `targetOrigin: "*"`. Hypothesis's `PortProvider` maps `"null"` to `"*"`
  for that reason [S13]. So `event.source` is the only identity check, and nothing sent *to* the
  frame may be secret.

## 2. Prior art

| Tool | How its code reaches the page | What it stores as the anchor | When the page changes | Source |
|---|---|---|---|---|
| **BugHerd** | A script snippet (`sidebarv2.js`) or a browser extension | `selector_info: {path: "html>body…", html: "<img…>", version: 2}` plus `screenshot_data` (pin x,y on the screenshot) and the browser size | Pins are keyed by page URL. SPAs must set `BugHerdConfig.location` or pins from different views mix [S5] | D [S4][S5] |
| **Marker.io** | A widget script, or an extension | An annotated **screenshot** (boxes, arrows, text) plus metadata. No live DOM pin is documented | Not applicable: the feedback is the image | D [S8] |
| **Vercel Comments / Toolbar** | Injected `feedback.js` (preview deployments, or added by hand for localhost). It mounts its UI in a **closed shadow root** and talks to an iframe on `vercel.live` with `postMessage` | "Click on the page or highlight text." Comments record a page path. The anchor format is not documented | The page shows a "new deployment ready" prompt. Comments are filtered by branch and page | D [S2][S3]; S for the shadow root and iframe [S3b] |
| **Pastel** | A proxy renders the live site and layers comments on top. Browse and Comment modes | Not documented. A **screenshot is captured with every comment** | If a section is removed, its comments disappear from the page but stay in the sidebar, where clicking one shows the capture-time screenshot, browser and screen size [S7] | D [S6][S7] |
| **Ruttl** | Loads the site inside Ruttl (proxy). Comment mode: "Hover over any element and click on it" | Element-based (hover-select). **Comments are kept separately per device.** "Versions" are captures of a page you add | Versions coexist and comments stay with the version they were made on | D [S9][S10] |
| **Hypothesis** | A client injected into the host page, plus a *guest* in each frame opted in with `enable-annotation`. The sidebar UI is an iframe on another origin, wired by `MessageChannel` | W3C `RangeSelector` (XPath), `TextPositionSelector` and `TextQuoteSelector` (32 characters of context each way) | Tried in order, with a **fuzzy quote match** (edit distance, scored 50/20/20/2 for quote, prefix, suffix and position). Failures become **Unanchored** (formerly "Orphans"), shown apart with the quote struck through | S [S11][S13][S14]; D [S12] |
| **Figma comments** (the target of html.to.design imports) | Native canvas | `client_meta` = `FrameOffset {node_id, node_offset}`, a pin relative to a frame node, or a `FrameOffsetRegion` | A comment follows its node | D [S16] |

- **html.to.design** turns a web page into Figma layers [S27], so its comments are Figma comments on
  the imported frames. That is a conversion, not anchoring into live HTML. The useful lesson is
  Figma's anchor: *node id + offset within the node* [S16].
- **A commercial claim, not verified:** a competitor, Lay, describes BugHerd as "screen coordinates"
  and its own anchor as a "CSS selector path + element fingerprint + percentage coordinates"
  [S28]. BugHerd's own schema shows a CSS path and an HTML snippet *as well as* coordinates [S4],
  so treat Lay's description as marketing.

**Libraries for robust element anchoring**

| Library or method | What it gives | Status |
|---|---|---|
| `@medv/finder` | The shortest unique CSS selector. Filters for ids, classes and attributes. Falls back to `nth-child` after a timeout. 1.5 kB gzip, MIT [S15] | Maintained (JSR + npm) |
| Hypothesis `anchoring/*` + `approx-string-match` | Production quote and position anchoring with fuzzy matching [S11][S14] | BSD-2, maintained. Can be read or ported; it is not a standalone package |
| Apache Annotator (`@apache-annotator/dom`) | W3C selector matchers: CSS, TextQuote, TextPosition, Range, refinement [S29] | **Retired from the Apache Incubator on 2025-08-11. The repo is archived** [S29]. Don't depend on it |
| Similo (TOSEM 2023) | Weighted similarity over 14 element properties. The more stable ones weigh 1.5, the rest 0.5. It missed 72 of 598 elements across versions of 40 popular sites, against 146 for the best multi-locator baseline [S18] | A method, with a replication package |
| ROBULA+ (JSEP 2016) | An algorithm for robust XPath locators [S30] | A method |
| W3C Text Fragments (`#:~:text=`) | Browser-native scrolling to a text quote | Not needed: the overlay can match text itself |

## 3. Capture across the frame boundary

### 3.1 Injection

- **Bundles and single files.** The Hub serves the HTML and inserts one
  `<script src="/__hh/overlay.js" data-hh-protocol="1"></script>` as the **first child of
  `<head>`**. The script comes from the content origin, not the Command Center's. It is an external
  file rather than inline, so a `script-src 'self'` policy inside the design still allows it, and
  #47's choice of mechanism decides how it is served [INFERENCE]. If the design sets a CSP that
  blocks it, the handshake times out and the viewer says "pins unavailable for this page" rather
  than offering wrong pins.
- **Live URLs.** The #49 proxy rewrites `text/html` responses in the same way.
- **Running first matters.** Listeners on the same target and phase fire in the order they were
  added. The window's capture phase is the first stop of every dispatch, so the overlay's
  `window.addEventListener(type, h, {capture: true})` runs before any design handler on any node
  [S25]. It also lets the overlay keep references to `postMessage`, `MessageChannel` and
  `getBoundingClientRect` before the design's code can patch them. That protects against bugs, not
  against an adversary [INFERENCE].
- **The overlay's own UI sits in a closed shadow root.** Hover outlines and pin markers live there,
  isolated from the design's CSS (`all: initial` on the host). This is how Vercel mounts its
  toolbar [S3b].

### 3.2 Channel

The Hypothesis `PortFinder`/`PortProvider` pattern [S13], cut down to one frame:

1. Overlay → parent: `window.parent.postMessage({hh: 1, type: "hello", protocol: 1}, "*")`.
2. The Command Center accepts a `hello` only if `event.source === frame.contentWindow` for a frame
   it created. It then creates a `MessageChannel` and transfers `port2` in its reply to that source,
   with `targetOrigin "*"` [S13][S20].
3. All further traffic runs over the port. A frame reload sends a new `hello` and gets a new
   port. The old port is closed.

| Direction | Messages (illustrative, protocol v1) |
|---|---|
| CC → overlay | `init {revisionId, pageKey, variant, theme, scale, mode}`, `setMode(browse \| pin \| region)`, `setPins([{id, n, anchor, state}])`, `focusPin(id)`, `setScale(s)` |
| overlay → CC | `ready {url, title, docSize}`, `navigated {pageKey}`, `captured {anchor, preview: {tag, text≤120, rect}}`, `resolved [{id, status, via, score, rect}]`, `pinActivated {id}`, `domSettled` |

- **All overlay text is plain text in the Command Center.** It is rendered by React, never as
  HTML. Sizes are capped: about 120 characters of quote and about 300 characters of HTML snippet,
  following BugHerd's `html` field [S4].
- **A forged `captured` or `pinActivated` can only misplace a pin.** It cannot write a comment or
  send an Answer [INFERENCE].

### 3.3 Modes

- **Browse and Comment modes,** as in Pastel [S6] and Ruttl [S9]. In Browse mode the design works
  normally. In **Pin mode** the overlay highlights the element under the pointer and swallows
  activation: `pointerdown`, `mousedown`, `click` and `auxclick` get `preventDefault()` +
  `stopImmediatePropagation()` at the window capture phase. `click` needs its own handler because
  cancelling pointer events never stops it [S23].
- **The target** is `document.elementsFromPoint(x, y)` with the overlay's own nodes skipped [S24b],
  or the event's composed target for content inside shadow DOM.
- **Region mode** is a drag rectangle. Its anchor is the smallest element that contains the
  rectangle, refined by the rectangle as fractions of that element's box. This is the same idea as
  W3C `refinedBy` [S1] and Figma's `FrameOffsetRegion` [S16].
- **Text comments (optional).** A text selection gives a `TextQuoteSelector` refining the element
  anchor, the same capability as Vercel's "highlight text to place your comment" [S2].

## 4. Selector shapes and fallbacks

| Selector | Captured as | Survives | Breaks on | Notes |
|---|---|---|---|---|
| **Review id** | The nearest ancestor-or-self `[data-review-id]`, plus the path from it when the target sits deeper | Restyles, reorders, copy edits, viewport changes | The Agent renaming or dropping the id | Strongest: an explicit contract, like `data-testid` [S17]. Agents can grep for it. Hub Skill rule (#53) |
| **`id`** | When it is word-like (finder's `idName` filter) [S15] | Most edits | Generated ids (`:r1:`, `ember123`) | Filtered out when they look generated |
| **CSS selector** | `@medv/finder` with a class filter that drops utility and hash classes (`:`, `[`, `/`, 5+ hex characters) | Copy edits, small reorders | Restructures. Class churn: Agents restyle a lot, so utility classes are unstable | Accepted only when it matches **exactly one** element *and* the fingerprint agrees (score ≥ 0.5) |
| **Text quote** | `exact` = the element's normalized visible text (up to about 120 characters), `prefix`/`suffix` = 32 characters each [S11] | Moves, restyles, wrapper changes | Copy rewrites. Empty elements (images, icons) | Fuzzy matching as in Hypothesis [S14] |
| **Fingerprint** | tag, role/accessible name, id, classes, `href`/`src`/`alt`/`aria-label`/`name`/`type`, visible text, neighbour text, absolute nth-child path, location and size at capture (Similo's set) [S18] | Most edits, partly | Large redesigns | Scored over candidates: Similo weights 1.5 for tag, id, name, text and neighbour text; 0.5 for the rest [S18] |
| **Offset in element** | `{x, y}` ∈ [0,1] of the element's border box. A region adds `{w, h}` | Any size change of the element | Nothing; it depends on the element | Figma's `node_offset`, normalized [S16] |
| **Page point** | `{x, y}` in document CSS px + viewport width + scroll | The same viewport and an unchanged layout | Any layout change | A last resort. Shown as a ghost pin with "approximate" (BugHerd's `screenshot_pin_x/y`) [S4] |

Context stored with every anchor: `revisionId` (where it was captured), `variant`, `pageKey`,
`stateKey`, `viewport {preset, width, height}`, `theme`, and `capturedRect`.

## 5. Re-attachment and orphaning across Revisions

**When:** the Command Center sends `setPins` for the open comments that apply to the loaded page,
state and variant. The overlay resolves them after `load` and fonts, once the DOM has been quiet
for about 300 ms (a `MutationObserver` debounce). It sends `resolved` back, and the Hub stores the
result per (comment, Revision). Hypothesis warns about the two failure modes here: it orphans
everything if it anchors before a client-rendered page has loaded, and pins should not jump
between tabs while the user is interacting with them [S14b].

**Order (first hit wins):**

1. **Agent hint.** The Agent may declare, when resolving or carrying a comment in the next
   Revision, that "comment c42 now lives at review id `pricing-pro`". → `attached`, `via: agent`.
   Only the Agent knows what it changed, and #52 already has it marking comments resolved
   [INFERENCE].
2. **Review id** matches one element. → `attached`.
3. **`id`, or the CSS selector,** is unique and the fingerprint score is ≥ 0.5. → `attached`.
4. **Text quote,** exact then fuzzy. The match is then raised to its enclosing element of the stored
   tag. Accepted when the score is ≥ 0.75. → `moved`.
5. **Fingerprint.** Each visible element gets a Similo-style score. Accepted when the best score is
   ≥ 0.6 and beats the runner-up by ≥ 0.1. → `moved`. If two candidates tie: `orphaned`, with the
   best candidate offered as a suggestion.
6. **Otherwise** `orphaned`.

The thresholds are starting points to tune in the #54 prototype [INFERENCE]. Hypothesis's quote
score is the reference point [S14].

**Statuses and how they show:**

- `attached`: a normal pin.
- `moved`: a pin with a dashed ring and "re-attached, check placement". One tap on **Confirm**
  promotes it to `attached` and records a fresh anchor for this Revision.
- `hidden`: the element matched, but at this viewport it has `display:none` or a zero-size box.
  The pin is listed as "not visible at 390", not as an orphan. Ruttl avoids this case by keeping
  comments per device [S9]. This design keeps them shared and says so instead [INFERENCE].
- `orphaned`: listed in an **Unanchored** group in the thread panel, with the stored quote and HTML
  snippet, the capture viewport and the Revision it came from. Pastel shows a screenshot in the
  same place [S7]. The Hub has no screenshot (map: "older Revisions show feedback only, never
  their renders"), so it shows text context instead. The Human can **Re-pin** an orphan by tapping
  the new element, which records a new anchor. Orphans are never deleted, the lesson Hypothesis
  took from hiding them [S12b].

**Anchor history:**

- The first anchor is kept unchanged.
- Each Revision stores the anchor that was *confirmed* there: Re-pin, Confirm, or an exact match.
  The next resolution tries the latest confirmed anchor first and the original second. A fuzzy
  `moved` match is never promoted on its own, so a wrong guess cannot become the anchor
  [INFERENCE].

**What the Agent gets in the Answer.**

- For each comment: the review id, the CSS selector, the quote, the tag and the ~300-character HTML
  snippet. Also the page, state, variant and viewport, and the status at this Revision.
- That is enough to find the code without seeing a render. BugHerd's API exposes the same kind of
  fields (`selector_info.path` and `html`) [S4]. Pastel and Ruttl now expose feedback to coding
  agents over MCP [S6c]; Vercel does it through its CLI [S2b].

## 6. Touch on an iPad

- **Events.**
  - Pointer Events have been in Safari on iPadOS since 13 [S22], so one code path covers mouse,
    touch and Pencil.
  - **Tap or scroll:** the browser fires `pointercancel` when it takes over a touch to pan or
    zoom [S23]. The overlay selects on `pointerup` only if no `pointercancel` came and the pointer
    moved less than about 10 px. Native scrolling, including scrolling inside the design's own
    panels, keeps working in Pin mode [INFERENCE].
  - `click` must still be cancelled on its own [S23].
- **No hover.** On touch the first tap *selects* the element. The overlay outlines it and shows its
  tag and text. The Command Center then offers **Pin here · Parent · Child · Cancel** with 44×44 pt
  buttons [S26]. "Parent" is the remedy for a finger landing on a `<span>` inside the button the
  Human meant. Apple Pencil hover in Safari is [UNVERIFIED] and is not relied on.
- **Region drags** would otherwise scroll the page. Region mode puts a full-viewport layer in the
  shadow root with `touch-action: none` [S24], and leaving the mode removes it.
- **Long press** on links and images opens the iOS callout. In Pin mode the overlay sets the
  nonstandard `-webkit-touch-callout: none` and `user-select: none` on the document [S24c]. Text
  comments are the exception: there the Human needs native selection, so a separate "Quote" mode
  leaves it on.
- **Scale.** The viewer scales the iframe to fit (1440 on an iPad is roughly ×0.8). Coordinates
  inside the frame stay in the frame's own CSS px, so capture needs no transform maths. Pins are
  the exception: they are drawn inside the frame and shrink with the scale. The Command Center
  therefore sends `setScale`, and the overlay sizes pins at 44 / scale CSS px [S26] [INFERENCE].
- **Keep the frame alive.** Thread composition happens in the Command Center, outside the frame,
  so the on-screen keyboard never resizes or reloads the design [INFERENCE].

## 7. By source

| Source | Injection | Page key | Anchors | Re-attachment across Revisions |
|---|---|---|---|---|
| **Single HTML file** | The Hub inserts the overlay tag when it serves it | `index.html` + state | Full set (§4) | Full chain (§5) |
| **Bundle** | Inserted into every `text/html` response from the bundle. Other assets are untouched | Path within the bundle (`pricing/index.html`) + state. In-frame navigation sends `navigated` (hook `pushState`/`popstate`/`hashchange` for SPAs, the problem BugHerd solves with `BugHerdConfig.location` [S5]) | Full set | Full chain. A page missing from the new bundle orphans its comments, labelled "page removed" |
| **Live dev-server URL** | The #49 proxy rewrites HTML. HMR patches the DOM in place | URL path (+ hash for hash routers) + state | Full set | The same chain, re-run on `domSettled` after HMR. It never moves a pin while the Human has a draft open on it [S14b]. If #49 snapshots the page on Send, the snapshot is the Revision and anchors resolve against it |
| **Screenshot** | None (an `<img>` in the Command Center) | Screenshot key (page, state, viewport) as declared by the Agent | Normalized `{x, y[, w, h]}` on the image, the shape of `xywh=percent:` [S19]. Floats are stored because the spec only allows integer percents (1 % of 1440 px = 14 px) | By screenshot key only. If the image hash changed, the pin shows as `moved` ("approximate"). It goes `orphaned` if the key has disappeared |

- **Screenshots can get element anchors too.** The Agent can send an element map with each
  screenshot, `[{reviewId, x, y, w, h}]`, for example from Playwright boxes. A pin inside a box
  then gets a `ReviewIdSelector`, which re-attaches across Revisions and even from a screenshot to
  the HTML of the same design [INFERENCE].

## 8. Recommendation

**Injection.**

- One versioned script, `overlay.js` (bundled by the Hub, about 10–15 kB, no dependencies apart
  from vendored finder [S15] and an `approx-string-match`-style matcher [S14]).
- It is served from the **content origin** and injected as the first element of `<head>` by the Hub
  (single files and bundles) or by the #49 proxy (live URLs).
- It talks to the Command Center over a `MessageChannel` set up by a `hello` that is checked
  against `event.source`.
- It draws in a closed shadow root. It only reports geometry and anchors.
- Without a handshake there are no pins for that page, and never a fallback to blind coordinates.

**Anchor model** (what #52 should adopt; names follow W3C where one exists [S1]):

```jsonc
{
  "context": {
    "revision": "rev_7",                 // where it was captured
    "variant": "B", "page": "pricing/index.html", "state": "annual",
    "viewport": { "preset": 834, "width": 834, "height": 1112 }, "theme": "dark"
  },
  "selectors": [                          // tried in this order; first confident hit wins
    { "type": "ReviewIdSelector", "value": "pricing-pro", "path": "> .cta" },
    { "type": "CssSelector", "value": "#plans .card:nth-of-type(2) .cta" },
    { "type": "TextQuoteSelector", "exact": "Start free trial", "prefix": "per month, billed yearly ", "suffix": "" },
    { "type": "ElementFingerprint", "tag": "a", "role": "link", "name": "Start free trial",
      "attrs": { "href": "#signup" }, "classes": ["cta", "cta--primary"],
      "neighbours": "Pro $24 per month billed yearly", "domPath": "html>body>main>section:nth-child(3)>div>article:nth-child(2)>a",
      "rect": { "x": 412, "y": 1630, "w": 180, "h": 44 } }
  ],
  "offset": { "x": 0.31, "y": 0.55 },     // point inside the element box; region adds w, h
  "pagePoint": { "x": 468, "y": 1654 },   // last-resort ghost pin at the capture viewport
  "snippet": "<a class=\"cta cta--primary\" href=\"#signup\">Start free trial</a>"
}
```

- **Per (comment, Revision):** `{status: attached|moved|hidden|orphaned, via, score, confirmed:
  bool}`.
- **The Agent hint** goes on the next Revision: `carry: [{comment, reviewId?, resolved?, note?}]`.
- **Screenshot anchors** replace `selectors` with
  `{ "type": "ImageRegion", "image": "<key>", "x": 0.41, "y": 0.22, "w"?: …, "h"?: … }`.

**Hub Skill rule (#53):** put a stable `data-review-id` on every component the Human might comment
on (sections, cards, buttons, form fields), keep the ids across Revisions, and reuse an id for the
"same thing" after a redesign. This one convention turns most `moved` and `orphaned` cases into
`attached`.

## 9. Questions this surfaces for the map

1. **Comment scope across viewports.** Is a comment made at 1440 shown at 834 and 390 (shared, with
   a `hidden` status), or kept per viewport as Ruttl does [S9]? This matters for #52 and #54.
2. **The Agent's carry hint.** May an Agent re-point a comment in the next Revision
   (`carry[].reviewId`), and does that count as `attached` without the Human confirming it?
3. **Mandatory `data-review-id`?** Is it required in the Hub Skill, or only recommended? Should the
   Hub warn when a Revision has none?
4. **Screenshot element maps.** Should screenshot sources accept an optional box map so their pins
   become element anchors?
5. **Overlay blocked by a design CSP or a strict live-URL CSP.** Should the Hub or proxy strip or
   relax the design's CSP so the overlay can load, or simply report "pins unavailable"? This
   depends on #47 and #49.
6. **Text-quote comments in v1** (select text, then comment), or element and region pins only?

---

## Sources

- [S1] W3C, *Web Annotation Data Model* (REC 2017-02-23), §4.2 Selectors: multiple selectors,
  §4.2.1 FragmentSelector, §4.2.2 CssSelector, §4.2.4 TextQuoteSelector, §4.2.9 `refinedBy`.
  https://www.w3.org/TR/annotation-model/#selectors
- [S2] Vercel, *Comments Overview* and *Using Comments* ("click on the page or highlight text";
  the new-deployment prompt; filter by page). https://vercel.com/docs/comments ·
  https://vercel.com/docs/comments/using-comments
- [S2b] Vercel, *vercel comments* CLI (list, inspect, resolve; JSON output).
  https://vercel.com/docs/cli/comments
- [S3] Vercel, *Add the Vercel Toolbar to your local environment* (the `@vercel/toolbar` package
  or the injected `https://vercel.live/_next-live/feedback/feedback.js`).
  https://vercel.com/docs/vercel-toolbar/in-production-and-localhost/add-to-localhost
- [S3b] The shipped `feedback.js` (fetched 2026-11-28): `attachShadow({mode:"closed"})`, an iframe
  on `/_next-live/feedback/feedback.html`, `postMessage` with `init`/`preview-origin`. **S**.
  https://vercel.live/_next-live/feedback/feedback.js
- [S4] BugHerd API v2 OpenAPI, the `Task` schema: `selector_info`, `screenshot_data`,
  `requester_browser_size`. https://docs.bugherd.com/api (spec: https://docs.bugherd.com/api/openapi.yaml)
- [S5] BugHerd Help, *How do I make sure BugHerd shows pins on the correct screen in a SPA?*
  https://support.bugherd.com/en/articles/12812946
- [S6] Pastel Help, *Reviewing Websites in Pastel* (proxy; Browse and Comment modes).
  https://help.usepastel.com/en/articles/1996011-reviewing-websites-in-pastel
- [S6c] Pastel Help, *Connect your AI agent to Pastel (MCP server)*.
  https://help.usepastel.com/en/articles/16399713 · Ruttl lists MCP in its product nav:
  https://www.ruttl.com/
- [S7] Pastel Help, *What happens to comments on deleted site sections…* (sidebar; capture-time
  screenshots). https://help.usepastel.com/en/articles/5992627
- [S8] Marker.io Help, *How to Report an Issue* (screenshot + annotation).
  https://help.marker.io/en/articles/11588554-how-to-report-an-issue
- [S9] Ruttl Support, *Using Ruttl* (Comment mode, hover and click an element) and *Tools and
  Tips* ("Comments in Ruttl are kept separate for all devices"; Versions).
  https://www.ruttl.com/support/using-ruttl · https://www.ruttl.com/support/tools-and-tips
- [S10] Ruttl Support, *Get started* (Comment and Browse modes). https://www.ruttl.com/support/get-started
- [S11] Hypothesis client, `src/annotator/anchoring/html.ts` and `types.ts` (selector order;
  32-character context). https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/html.ts ·
  https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/types.ts
- [S12] Hypothesis Help, *What are Unanchored Annotations?*
  https://web.hypothes.is/help/what-are-unanchored-annotations/
- [S12b] Hypothesis blog, *Showing Orphaned Annotations* (2017; orphans used to be hidden).
  https://web.hypothes.is/blog/showing-orphaned-annotations/
- [S13] Hypothesis client, `src/shared/messaging/port-provider.ts` (`MessageChannel` between
  frames; `"null"` origin → `"*"`) and `src/annotator/frame-observer.ts` (`enable-annotation`).
  https://github.com/hypothesis/client/blob/main/src/shared/messaging/port-provider.ts ·
  https://github.com/hypothesis/client/blob/main/src/annotator/frame-observer.ts
- [S14] Hypothesis client, `src/annotator/anchoring/match-quote.ts` (`approx-string-match`;
  weights 50/20/20/2). https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/match-quote.ts
- [S14b] hypothesis/client#5238, *Annotations can fail to anchor on client-rendered pages if
  content is slow to load*. https://github.com/hypothesis/client/issues/5238
- [S15] `@medv/finder` README. https://github.com/antonmedv/finder
- [S16] Figma REST API OpenAPI spec: `Comment.client_meta` → `FrameOffset {node_id, node_offset}`,
  `FrameOffsetRegion`. https://github.com/figma/rest-api-spec/blob/main/openapi/openapi.yaml
- [S17] Playwright, *Locators* ("Testing by test ids is the most resilient way of testing") and
  *Best Practices*. https://playwright.dev/docs/locators#locate-by-test-id ·
  https://playwright.dev/docs/best-practices
- [S18] M. Nass, E. Alégroth, R. Feldt, M. Leotta, F. Ricca, *Similarity-based Web Element
  Localization for Robust Test Automation*, ACM TOSEM 32(3), 2023 (§3.1 Table 1 and Fig. 4;
  §3.2 weights). https://doi.org/10.1145/3571855 · preprint https://arxiv.org/abs/2208.00677
- [S19] W3C, *Media Fragments URI 1.0*, spatial dimension (`xywh=percent:` with integers).
  https://www.w3.org/TR/media-frags/#naming-space
- [S20] MDN, `Window.postMessage()`, Security concerns.
  https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#security_concerns
- [S21] MDN, `<iframe>` `sandbox` (`allow-same-origin`; the opaque origin).
  https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox
- [S22] WebKit blog, *New WebKit Features in Safari 13* (Pointer Events on iPadOS).
  https://webkit.org/blog/9674/new-webkit-features-in-safari-13/
- [S23] W3C, *Pointer Events Level 3*: `preventDefault` "MUST NOT have an effect on whether
  click … are fired"; `pointercancel` when the pointer is used to pan or zoom.
  https://www.w3.org/TR/pointerevents3/
- [S24] MDN, `touch-action`. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action
- [S24b] MDN, `Document.elementsFromPoint()`. https://developer.mozilla.org/en-US/docs/Web/API/Document/elementsFromPoint
- [S24c] MDN, `-webkit-touch-callout` (nonstandard).
  https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/-webkit-touch-callout
- [S25] WHATWG DOM Standard, *Dispatching events* (the event path starts at Window in the
  capture phase; listeners are invoked in order). https://dom.spec.whatwg.org/#concept-event-dispatch
- [S26] Apple HIG, *Accessibility*: iOS and iPadOS default hit target 44×44 pt, minimum 28×28 pt.
  https://developer.apple.com/design/human-interface-guidelines/accessibility
- [S27] html.to.design docs, *What is html.to.design?*
  https://html.to.design/docs/what-is-html-to-design
- [S28] Lay, *Lay vs BugHerd* (a competitor's claim, used only as a pointer).
  https://uselay.com/vs/bugherd
- [S29] Apache Incubator, *Apache Annotator Project Incubation Status* ("2025-08-11 Project retired");
  GitHub `apache/incubator-annotator` (archived).
  https://incubator.apache.org/projects/annotator.html · https://github.com/apache/incubator-annotator
- [S30] M. Leotta, A. Stocco, F. Ricca, P. Tonella, *ROBULA+: an algorithm for generating robust
  XPath locators for web testing*, J. Softw. Evol. Process 28(3), 2016.
  https://doi.org/10.1002/smr.1771
