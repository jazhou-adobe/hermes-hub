# Hermes Hub: running untrusted Revision HTML isolated from the Hub origin

Research date: 2026-11-28. Ticket: [#47](https://github.com/jazhou-adobe/hermes-hub/issues/47), on the map
[Wayfinder map: HTML Design Reviews in Hermes Hub](https://github.com/jazhou-adobe/hermes-hub/issues/46).
Scope: how the Command Center can show a **Revision** of a **Design Review** (a single HTML file, a bundle with
assets, a live dev-server URL, or screenshots). The design's own JS must run, and it must be able to load
Google Fonts and CDN files, without being able to call the Hub's `/cc/*` endpoints and answer Rounds. This
covers Chrome, Safari on iPad, and the WKWebView in `Hermes Hub.app`, both on this Mac and remotely over plain
HTTP with Basic auth. This is a planning note. Nothing here is built. The recommendation is the researcher's;
the Human confirms it in the spec ticket.

Constraints come from `docs/specs/security.md` (browser guard, Basic auth, Command Center CSP),
`src/hub/server.ts` (`guard()`, `CSP`, `handle()`), `src/hub/auth.ts` (`hostAllowed`) and
`macos/HermesHub.swift` (navigation policy, Basic-auth challenge handler).

Citation convention: `[Sn]` points to the numbered entry in [Sources](#sources). **[OBSERVED]** marks a result of
the local experiment described in [Experiment](#experiment). It is evidence for that setup only: Chrome 158
headless, and WKWebView on macOS 27.0.1. **[INFERENCE]** marks the researcher's reasoning, or a claim that no
primary source or experiment confirmed. Text under "Analysis" is reasoning, not sourced fact.

---

## TL;DR

**Recommendation: opaque-origin sandboxing on the Hub's own port.** Serve every Revision file under a
per-Revision capability path, `/r/<token>/…`. Every `/r/*` response carries
`Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'`. The Command
Center frames the Revision with a matching `<iframe sandbox="allow-scripts allow-forms allow-modals" src="/r/<token>/index.html">`.

1. **Why it isolates.** The sandbox flag without `allow-same-origin` forces the document into an opaque origin
   [S1][S2]. The CSP `sandbox` header applies the same flags to the response, even when it is opened
   top-level [S11][S8]. Every CORS or non-GET request the design sends to `/cc/*` therefore carries
   `Origin: null` [S17], and the existing guard refuses it. **[OBSERVED]** In both engines, from loopback and
   from a LAN IP, `fetch('/cc/…')` (GET and JSON POST) failed.
2. **What still works.** The design's own inline and external JS, Google Fonts, and CDN scripts all work: the CDNs
   send `Access-Control-Allow-Origin: *` **[OBSERVED]**. Relative bundle URLs work too, because the document has
   a real `http://…/r/<token>/` URL.
   - Bundle files fetched in CORS mode (fonts, module scripts, `fetch()`) need `Access-Control-Allow-Origin: *`
     on `/r/*`, because the opaque origin is cross-origin even to its own host [S33].
   - postMessage works, with `event.origin === "null"`. Identify the frame by `event.source`.
3. **What breaks.** `localStorage`, `sessionStorage` and `document.cookie` throw `SecurityError` [S5][S6]
   **[OBSERVED]**. IndexedDB and service workers need a storage key, which an opaque origin cannot have [S10][S19].
   An in-memory storage shim, injected by the Hub ahead of the design's scripts, makes typical designs run.
   Root-relative URLs (`/assets/x.js`) resolve to the Hub root, not the Revision, so Agents must build bundles
   with relative URLs (Vite `base: './'`).
4. **Remote access.** `/r/*` must authorise by the unguessable token in the path, not by Basic auth.
   - A browser never sends Basic credentials on CORS requests from an opaque origin, because the credentials
     mode is `same-origin` [S15][S16].
   - Cross-origin Basic-auth prompts are blocked or unreliable [S24][S25].
   - "No password, no remote access" (403) still applies.
5. **Command Center CSP.** No change is needed for this mechanism: `frame-src` falls back to
   `default-src 'self'`, which covers `/r/*` **[OBSERVED]**. Add an explicit `frame-src 'self'` so that a later
   loosening of `default-src` cannot widen framing.
6. **Rejected candidates.**
   - **srcdoc or blob:** these inherit the Command Center's CSP [S3], so inline scripts and CDNs are blocked
     **[OBSERVED]**. Relative URLs have no usable base [S4].
   - **A second port:** feasible, but it needs a second listener, a per-request `frame-src`, its own Basic-auth
     protection space [S20] (prompts inside iframes are unreliable), and changes to the WKWebView navigation
     policy. It also shares one origin, and so one `localStorage`, across every Revision.
   - **A service worker:** it adds no isolation, and it is unavailable over plain HTTP to the iPad [S19].
   - **`*.localhost`:** it resolves to the iPad itself, Safari only resolves it from macOS 26 [S23], and the
     guard's Host allowlist refuses it.

---

## Threat model in one paragraph

Any script running in the Hub's origin (`http://<host>:<port>`) is the Command Center. It can `fetch('/cc/rounds/:id/send')`
with JSON, read `/cc/rounds`, and subscribe to `/cc/events`. The guard passes it, because `Origin` matches and
`Sec-Fetch-Site` is `same-origin` (`guard()` in `src/hub/server.ts`). A Revision's HTML is written by an Agent,
and may come from a dev server or a CDN the Agent pulled in, so it is untrusted. The requirement is that no
Revision document can ever have the Hub's origin, whether it is framed, opened in a new tab, or reached by a
link the Human clicks.

## Experiment

A Bun server reproduced the Hub's constraints. The script lived in `/tmp` and was deleted after the run.

- `/cc` served a page with the Hub's exact Command Center CSP. A `?fs=1` variant added
  `frame-src 'self' http://127.0.0.1:4791`.
- `/cc/*` applied the same Origin and `Sec-Fetch-Site` refusal as `guard()`.
- `/r/tok/*` served a probe page and `asset.json`, with `Access-Control-Allow-Origin: *` and
  `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'`.
- Port 4791 served the same probe as a "second origin".

The harness framed five candidates:

- a sandbox attribute plus the CSP header;
- the CSP header only;
- `srcdoc`;
- `blob:`;
- the second port.

Each probe reported, over postMessage:

- `self.origin`;
- `localStorage` and `document.cookie`;
- `fetch('/cc/secret')` as GET and as a JSON POST;
- a relative `fetch('asset.json')`;
- a `fonts.gstatic.com` fetch and a Google Fonts stylesheet;
- whether `navigator.serviceWorker` exists;
- access to `top.location`.

The harness ran in Chrome 158 headless and in an offscreen WKWebView (macOS 27.0.1, the engine `Hermes Hub.app`
uses), first from `127.0.0.1` and then from the Mac's LAN address `192.168.1.231`. The LAN address is not a
potentially trustworthy origin [S32], as with the iPad.

| Probe | Chrome 158 | WKWebView (macOS 27) |
|---|---|---|
| Sandbox attribute + CSP header: `self.origin` | `null` | `null` |
| CSP header only (no attribute): `self.origin` | `null` | `null` |
| `localStorage`, `document.cookie` in the opaque frame | `SecurityError` | `SecurityError` |
| `fetch('/cc/secret')` GET and JSON POST from the opaque frame | blocked (`Origin: null` → 403, no CORS) | blocked |
| Relative `fetch('asset.json')` with `ACAO: *` | 200 | 200 |
| `fonts.gstatic.com` fetch; Google Fonts stylesheet font loaded | 200; 1 face loaded | 200; 1 face loaded |
| `top.location` from the frame | `SecurityError` | `SecurityError` |
| `srcdoc` + `sandbox="allow-scripts"`: inline `<script>` | did not run (inherited CSP) | did not run |
| `srcdoc`: `<script src="/r/tok/x.js">` | fetched, `Sec-Fetch-Site: cross-site` | fetched |
| `blob:` iframe | refused: `frame-src` violation | refused: `frame-src` violation |
| Second port, CC CSP unchanged | refused: `frame-src` violation | refused |
| Second port with `frame-src` added: origin, `localStorage` | `http://127.0.0.1:4791`, works | same |
| Request headers to the Hub from the opaque frame, via loopback | `Origin: null`, `Sec-Fetch-Site: cross-site` | same |
| Same, via the LAN IP | `Origin: null`, **no `Sec-Fetch-*` headers** | same |
| `'serviceWorker' in navigator`: loopback / LAN IP | true / **false** | true / **false** |

The last two rows confirm the spec: Fetch Metadata is only sent to potentially trustworthy URLs [S18], and
service workers are `[SecureContext]` [S19]. **Over the network, the guard's `Origin` check carries the defence
on its own, and it is enough:** every CORS request and every non-GET request carries `Origin` [S17], and an
opaque origin serialises as `null`.

Not tested: a real iPad (iPadOS Safari uses WebKit, as the WKWebView run does **[INFERENCE]**), and HTTP auth
prompts. Headless Chrome and an offscreen WKWebView with no challenge delegate cannot show them.

---

## Candidate 1: a second Hub port (or origin) serving the content

Here the Hub opens a second listener, say `:4748`, that serves only Revision files. The design gets a real origin,
`http://<host>:4748`.

- **Isolation.** The design's origin differs from the Command Center's because the port differs, but the two
  are **same-site**: a site ignores the port [S7]. `Sec-Fetch-Site` from the design to `:4747` is therefore
  `same-site`, not `cross-site` **[OBSERVED]** (navigation to `:4791` reported `same-site`). The guard's
  `Sec-Fetch-Site` rule does not fire. Its `Origin` rule does (`http://host:4748 ≠ http://host:4747`), so
  `/cc/*` stays safe. Cookies are not isolated by port [S21]. The Hub sets none today, so this is harmless,
  but it is a trap for the future.
- **Chrome, Safari, WKWebView.** It works everywhere once `frame-src` allows it **[OBSERVED]**. In the app,
  `decidePolicyFor navigationAction` cancels any URL that is not same-origin with the Hub and opens it in the
  default browser (`macos/HermesHub.swift`). The iframe would open in Safari instead. The app would need to
  allow subframe navigations (`targetFrame.isMainFrame == false` [S27]) to the content origin.
- **Basic auth.** Credentials are cached per protection space, which is the canonical root URI (scheme, host,
  port) plus the realm [S20]. `:4748` is therefore a new space, and the browser would prompt again.
  - **Chrome** suppresses auth prompts for cross-origin subresources by default (policy
    `AllowCrossOriginAuthPrompt`, default false [S24]). Its behaviour for frames and for same-host cross-port
    loads has been inconsistent: one open report shows a prompt for a cross-port `<img>` [S25], and CodePen
    documented prompts that appeared, disappeared and came back in sandboxed iframes [S34].
  - **WKWebView** has no built-in auth UI. The app only answers challenges for the Hub's own protection space
    (`hubSpace`), so a `:4748` challenge goes to `.performDefaultHandling` and fails.
  - **Analysis:** the content origin would need its own non-prompting credential, such as a capability token,
    which is the same answer as for the recommended option.
- **localStorage and cookies.** They work **[OBSERVED]**, but the storage is shared by every Revision of every
  Design Review, because they all have one origin. One design can read another's keys, and stale state leaks
  across Revisions.
- **Fonts, CDN, relative URLs.** All work, and same-origin bundle fonts need no CORS headers. Root-relative
  URLs still break unless each Revision gets its own port.
- **postMessage.** It works, with a real `event.origin`, which is easier to check.
- **CC CSP.** It needs `frame-src 'self' http://<host>:4748`. `<host>` is whatever address the device used
  (`127.0.0.1`, `192.168.1.20`, the Mac's name), so the Hub must build the CSP per request from `Host`.
- **Hub cost.** A second `Bun.serve` with its own port selection (the Hub already tries up to 20 ports for one),
  `hub.json` and the start-up line, its own Host allowlist, and a firewall consideration **[INFERENCE]**:
  macOS's application firewall is per app, not per port.

## Candidate 2: `<iframe sandbox>` without `allow-same-origin`, using `srcdoc` or `blob:`

The Command Center fetches the HTML and puts it into `srcdoc`, or into a `blob:` URL.

- **Isolation.** The origin is opaque [S1][S2] **[OBSERVED]**.
- **The deal-breaker: CSP inheritance.** An `about:srcdoc` document takes a clone of its parent's policy
  container, and a local-scheme document (`blob:`, `data:`) takes its initiator's [S3]. The Command Center's
  `default-src 'self'` therefore governs the design.
  - Inline `<script>` is blocked **[OBSERVED]**.
  - Google Fonts (`font-src 'self' data:`) and CDN scripts are blocked.
  - `base-uri 'none'` blocks the `<base>` tag the design would need.
  - Loosening the Command Center's own CSP to make designs work would weaken the page that holds Rounds.
- **Relative URLs.** A srcdoc document's base URL is its parent's base URL [S4], the Command Center's, so
  `img/logo.png` resolves to `http://host:4747/img/logo.png`. A `blob:` URL has no hierarchical path, so
  relative URLs fail to resolve. **[INFERENCE]** from URL parsing of a non-special scheme.
- **`blob:`** also needs `frame-src blob:`: it is refused as is **[OBSERVED]**. The WKWebView app's navigation
  policy allows only `about`, `data` and same-origin URLs, so it would cancel the `blob:` load and open it
  externally.
- **Storage.** `about:srcdoc` is not an HTTP(S) URL, so `document.cookie` returns `""`, not an error [S6], but
  `localStorage` still throws [S5].
- **postMessage.** It works, with `event.origin === "null"`.
- **Basic auth.** It is not involved for the document itself. Subresources hit the Hub with the same
  credential problems as Candidate 4.

**Verdict:** unusable for designs that load anything.

## Candidate 3: a CSP `sandbox` directive on the content responses

The Hub serves Revision files from its own origin, with `Content-Security-Policy: sandbox …`.

- **Isolation.** Navigation unions the frame's sandbox flags with the response's CSP-derived sandbox flags
  before it computes the origin [S8]. The `sandbox` directive applies a policy "as though it had been included
  in an iframe with a sandbox property" [S11]. The document is opaque even with no `sandbox` attribute, and
  even top-level **[OBSERVED]**. Opening `/r/<token>/index.html` in a new tab therefore cannot reach `/cc/*`.
  The attribute on its own cannot guarantee this.
- **Delivery.** The directive is ignored in `<meta>` and in `Report-Only` [S12], so it must be a response
  header. The design cannot remove a header.
- **Support.** Chrome 25+ and Safari/iOS 7+ [S26].
- **Everything else** behaves as in the recommended design below, because this candidate is half of it.

## Candidate 4 (recommended): sandbox attribute + CSP `sandbox` header on a Hub-origin capability path

Candidates 2 and 3 are combined, and the content is served from a real URL, not `srcdoc`. See
[Recommended design](#recommended-design) for the full shape. Per checklist item:

- **Chrome, Safari on iPad, WKWebView.** Opaque in both engines tested **[OBSERVED]**. iPadOS Safari is
  WebKit **[INFERENCE]**. The app's navigation policy already allows same-origin URLs, so `/r/*` subframes
  load without app changes **[INFERENCE]** from `sameOrigin(url, hubURL)`.
- **Remote Basic auth.** The iframe navigation is same-origin with the Command Center, so the browser sends the
  cached Basic credentials. But requests from the opaque document are never same-origin with anything. Fonts
  (`credentials: same-origin`, CORS mode [S33]), module scripts and `fetch()` therefore go **without**
  credentials [S15], and a 401 on a CORS-tainted or credential-less request never prompts [S16].
  - Under Basic auth, bundle fonts and modules would fail on the iPad.
  - Therefore `/r/*` authorises by its 128-bit path token instead of Basic auth. No second prompt and no second
    credential.
- **localStorage and cookies.** They throw `SecurityError` [S5][S6] **[OBSERVED]**. Every Revision frame is its
  own unique opaque origin, so designs cannot see each other's state.
  - Mitigation: the Hub injects a first `<script>` that defines in-memory `localStorage` and `sessionStorage`
    on `window`, and a `document.cookie` accessor on `document`.
  - This is possible because WebIDL attribute properties are configurable unless `[LegacyUnforgeable]` [S29]
    **[INFERENCE: prototype must confirm per engine]**.
  - IndexedDB, Cache API and service workers stay unavailable [S10][S19].
- **Fonts and CDN.** Google Fonts' stylesheet (no-cors) and font files, and jsDelivr scripts, load from an
  opaque origin, because they send `ACAO: *` **[OBSERVED]**. Bundle-local fonts and module scripts need
  `Access-Control-Allow-Origin: *` on `/r/*` **[OBSERVED]**: the relative `fetch` succeeded only with it.
- **Relative URLs.** The document URL is `http://host:port/r/<token>/index.html`, so `img/a.png` and `../x.css`
  resolve inside the token directory. Root-relative `/x` escapes it (see caveats).
- **postMessage.** It works both ways **[OBSERVED]**.
  - The parent cannot use `targetOrigin "null"`, so it posts with `"*"` to the specific `contentWindow`, and
    checks `event.source === iframe.contentWindow`. Not `event.origin`, which is `"null"` for every sandboxed
    frame [S9].
  - The parent cannot touch the frame's DOM (`top.location` access threw **[OBSERVED]**). Pins, element picking
    and theme switching must therefore run in an injected in-frame overlay script that talks to the Command
    Center over a `MessageChannel`.
- **CC CSP.** No change: `'self'` covers `/r/*` **[OBSERVED]**. Add an explicit `frame-src 'self'` as
  hardening. The content responses carry their own CSP. The design's nested iframes are governed by the
  design's response, not by the Command Center's `frame-src` [S14], and inherit the sandbox flags [S1].

## Candidate 5: a service worker

- **No isolation.** A service worker runs in, and serves responses for, the origin that registered it. Content
  it serves to a Hub-origin URL is same-origin with the Command Center. A window client with an opaque origin
  is not controlled at all: its active service worker is null [S19].
- **Not available remotely.** `navigator.serviceWorker` is `[SecureContext]`, and registration rejects scripts
  that are not potentially trustworthy [S19]. `http://192.168.x.y:4747` is not potentially trustworthy [S32],
  so the iPad has no service worker at all **[OBSERVED]** in the LAN-IP run.
- **What it could do:** cache bundle files on this Mac. That is a performance detail, not isolation.

**Verdict:** rejected.

## Candidate 6: a separate subdomain (`<rev>.localhost`, or any `*.host`)

- **On this Mac.** A per-Revision subdomain would give each Revision its own real origin, with working storage
  and working root-relative URLs.
  - Chrome and Firefox hard-wire `*.localhost` to loopback [S23]; RFC 6761 permits this [S22].
  - Safari leaves it to the OS resolver. It failed until macOS 26, where it "was implemented in OS frameworks
    below WebKit" [S23]. macOS 15 and earlier need `/etc/hosts` entries [S23].
- **Remotely it cannot work.** On the iPad, `x.localhost` is the iPad. Subdomains of an IP literal do not exist.
  A wildcard name needs DNS the Hub doesn't own: a nip.io-style service, or an mDNS wildcard, which mDNS does
  not support **[INFERENCE]**.
- **The guard refuses it.** The Host allowlist (`hostAllowed`) accepts only `localhost`, IP literals and the
  Mac's own name, and that is the DNS-rebinding defence. Widening it to `*.localhost` is safe on loopback
  **[INFERENCE]**, but does nothing for remote.
- **WKWebView.** It uses the same OS resolver as Safari.

**Verdict:** rejected. It is local-only and depends on the macOS version.

---

## Comparison

| | 1. Second port | 2. srcdoc / blob | 3+4. CSP sandbox + attribute, `/r/<token>/` | 5. Service worker | 6. `*.localhost` |
|---|---|---|---|---|---|
| Isolated from `/cc/*` | yes (Origin check; same-site) | yes | yes (opaque; even top-level) | **no** | yes |
| Chrome / iPad Safari / WKWebView | yes / yes / app change needed | yes / yes / blob blocked by app | yes / yes **[INFERENCE]** / yes | n/a; not on remote HTTP | yes / macOS 26+ only / macOS 26+ |
| Remote over Basic auth | new protection space; prompts unreliable → token needed | n/a | token in path; no prompt | not available | impossible |
| Design's inline JS, CDN, Google Fonts | yes | **no** (inherits CC CSP) | yes | — | yes |
| Relative bundle URLs | yes | **no** | yes (not root-relative) | — | yes, incl. root-relative |
| localStorage / cookies | yes, shared by all Revisions | throw / `""` | throw → shim | — | yes, per Revision |
| postMessage | yes, real origin | yes, `"null"` | yes, `"null"`; check `source` | — | yes |
| CC `frame-src` change | `http://<Host>:<port2>` per request | `blob:` (and CSP loosening) | none (make `'self'` explicit) | — | `http://*.localhost:<port>` |
| New Hub moving parts | listener, port, allowlist, app policy | none | one route family, one header set | — | DNS, allowlist, macOS version gate |

---

## Recommended design

The concrete shape, for the spec ticket to confirm:

1. **URL.** `GET|HEAD /r/<token>/<path>`. `<token>` is ≥128 random bits per Revision, minted when the Revision
   is stored, and reachable only through `/cc/*` responses. `<path>` maps into the Revision's stored files. A
   single file is `index.html`; screenshots are plain files and need no isolation.
2. **Headers on every `/r/*` response, whatever its type.** SVG, or a second `.html` in a bundle, can run script
   when navigated to, so every type gets them:
   - `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'`
   - `Access-Control-Allow-Origin: *` (bundle fonts, module scripts and `fetch()` from the opaque origin)
   - `Referrer-Policy: no-referrer`. Browsers already strip cross-origin referrers to the origin by default;
     this also keeps the token out of CDN logs if a design weakens its own policy.
   - `X-Content-Type-Options: nosniff`, as everywhere today.
   - No `allow-same-origin`, ever. With same-origin content it lets the frame remove its own sandbox [S2].
   - No `allow-top-navigation`, and no `allow-popups` at first.
   - `frame-ancestors 'self'` matches the Command Center even though the content itself is opaque, because CSP
     matches `'self'` against the response URL's origin [S13] **[OBSERVED]**: the frames loaded in both engines.
3. **Guard.**
   - `/r/*` GET and HEAD skip the `Origin` and `Sec-Fetch-Site` checks, because the design's own subresource
     requests arrive as `Origin: null` / `cross-site` **[OBSERVED]**.
   - The Host allowlist still applies.
   - Every other route, `/cc/*` included, keeps the guard unchanged and **never** gains CORS headers.
   - New invariant to write into the spec: every `/cc/*` GET stays free of side effects. Over plain HTTP,
     no-cors GETs (`<img src=/cc/…>`) from the design carry neither `Origin` nor `Sec-Fetch-*` [S17][S18], and
     carry the cached Basic credentials. They cannot read the response, but they can trigger it.
4. **Auth.** On `/r/*`, a remote request with a valid token passes without Basic auth. While `remote-auth.json`
   is missing, remote `/r/*` still gets 403, as everywhere. An unknown token gets 404. The token is a bearer
   capability in a URL, which RFC 6750 advises against for bearer tokens in general [S31]. Here it grants
   read-only access to one Revision, never leaves the Hub ↔ Command Center path except as the frame URL, and
   crosses the LAN exactly like the Basic credentials do.
5. **Command Center.**
   - It frames the Revision with
     `<iframe sandbox="allow-scripts allow-forms allow-modals" src="/r/<token>/index.html">`. The attribute
     duplicates the header as defence in depth.
   - Viewport presets are the iframe's CSS width (1440/834/390), scaled with a transform when the screen is
     narrower.
   - Side-by-side variants are several iframes, each its own opaque origin.
   - The CSP gains an explicit `frame-src 'self'`.
6. **Injected in-frame script.** When serving an HTML file, the Hub inserts
   `<script src="/r/<token>/__hermes/overlay.js">` as the first child of `<head>`, with Bun's built-in
   `HTMLRewriter` [S30]. The script:
   - installs the in-memory `localStorage` and `sessionStorage` and a `document.cookie` stub, before any design
     script runs;
   - waits for a `hermes.hello` message from `parent`, and takes the transferred `MessagePort`;
   - over that port, handles theme, pin mode, element hit-testing and selector reporting. Pin anchoring is
     ticket #48.

   The design shares the realm with the overlay and can tamper with it, so the Command Center treats every
   message as untrusted data: it validates the schema and never renders a message as HTML.
7. **macOS app (small change).** Subframe navigations (`action.targetFrame?.isMainFrame == false` [S27]) that
   leave the Hub origin should be cancelled silently, not opened in the default browser. Otherwise a design
   that navigates its own frame to an external URL (a link click, `location = …`) pops open Safari. The
   sandbox does not stop a frame navigating itself.

### Caveats to carry into the spec

- **Root-relative URLs.** `/assets/app.js` resolves to the Hub root, where Command Center assets live, and 404s
  or loads the wrong file. The Hub Skill must tell Agents to build with relative URLs (Vite `base: './'`).
  Submission could warn when an `index.html` contains `src="/` or `href="/`. HTML-only rewriting cannot fix
  URLs that JS builds at runtime **[INFERENCE]**.
- **Storage.** Designs that persist state across reloads (a remembered theme, onboarding flags) see fresh state
  on every load, which suits reviewing. Designs using IndexedDB, service workers or `navigator.storage` will
  fail.
- **The light/dark toggle.** The Command Center cannot set the frame's `prefers-color-scheme` directly. The
  Media Queries 5 draft says iframes "automatically match the color scheme of the parent document" [S28];
  whether engines honour a parent's `color-scheme` for this is untested. The overlay can toggle the class or
  attribute a design uses (`.dark`, `[data-theme]`), but only by convention.
- **Chrome process isolation.** This design defends against API access, not Spectre-class side channels.
  Opaque frames, and a second port, are same-site with the Command Center [S7], so the browser may run them in
  the same process **[INFERENCE]**. Rounds hold nothing more secret than a same-process attacker could already
  see on this single-user machine.

---

## Changes this implies to other specs

- **security.md, browser guard:**
  - Add `/r/*` as the one route family exempt from the Origin and Fetch-Metadata checks.
  - Add `Access-Control-Allow-Origin: *` on `/r/*` only; "No CORS" stays true for every other route.
  - List the content headers.
  - Add the "`/cc/*` GETs are side-effect free" invariant.
  - Add an explicit `frame-src 'self'` to the Command Center CSP.
- **security.md, remote access:** `/r/*` authorises by path token; the no-password 403 still applies.
- **The Revision storage ticket (#51):** mint the per-Revision token there, and store bundle files under their
  relative paths.
- **The Hub Skill:** Revision bundles must use relative URLs; `localStorage` is memory-only.

## Questions surfaced for the map

1. **Live dev-server URL (#49).** Proxying a dev server under `/r/<token>/` inherits the root-relative problem
   in its worst form (`/@vite/client`, `/src/main.ts`, the HMR WebSocket on `/`). Is a dedicated proxy port, or
   a per-URL `base` setting, the answer there? This note's mechanism still applies to whatever origin the proxy
   serves on, via the CSP sandbox header.
2. **Theme toggle.** Does a parent's `color-scheme` on the `<iframe>` element drive `prefers-color-scheme`
   inside an opaque frame in Chrome and iPad Safari? If not, the toggle relies on overlay conventions. This
   is a small prototype question.
3. **Storage shim.** Confirm per engine that `Object.defineProperty(window, 'localStorage', …)` replaces the
   throwing getter before design scripts run. Decide whether the shim should persist per Revision through the
   Hub (postMessage → `/cc/*`) or stay in memory.
4. **Popups and links.** Should the design's `target=_blank` links and `window.open` work (`allow-popups`
   without `allow-popups-to-escape-sandbox`, plus a WKWebView `createWebViewWith` handler), or stay blocked?

---

## Sources

Specs (WHATWG, W3C, IETF)
- [S1] HTML, sandboxing flags ("sandboxed origin browsing context flag … forces content into an opaque origin … blocks access to localStorage"): https://html.spec.whatwg.org/multipage/browsers.html#sandboxing
- [S2] HTML, the `iframe` `sandbox` attribute, including the `allow-scripts` + `allow-same-origin` warning: https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox
- [S3] HTML, "determine navigation params policy container" (about:srcdoc → parent's policy container; local scheme → initiator's): https://html.spec.whatwg.org/multipage/browsers.html#determining-navigation-params-policy-container
- [S4] HTML, fallback base URL (about:srcdoc uses its about base URL, the parent's base URL): https://html.spec.whatwg.org/multipage/urls-and-fetching.html#fallback-base-url
- [S5] HTML, `localStorage` and `sessionStorage` getters ("Throws a SecurityError DOMException if the Document's origin is an opaque origin"): https://html.spec.whatwg.org/multipage/webstorage.html#dom-localstorage
- [S6] HTML, `document.cookie` (cookie-averse Documents return ""; opaque origin throws SecurityError): https://html.spec.whatwg.org/multipage/dom.html#dom-document-cookie
- [S7] HTML, sites and same site ("the port and domain components are ignored"): https://html.spec.whatwg.org/multipage/browsers.html#sites
- [S8] HTML, create navigation params by fetching ("finalSandboxFlags be the union of targetSnapshotParams's sandboxing flags and policyContainer's CSP list's CSP-derived sandboxing flags"): https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-by-fetching
- [S9] HTML, cross-document messaging (`postMessage`, `MessageEvent.origin` serialisation): https://html.spec.whatwg.org/multipage/web-messaging.html#posting-messages
- [S10] Storage Standard, obtain a storage key ("If key's origin is an opaque origin, then return failure"): https://storage.spec.whatwg.org/#obtain-a-storage-key
- [S11] CSP Level 3, `sandbox` directive: https://w3c.github.io/webappsec-csp/#directive-sandbox
- [S12] CSP Level 3, the `<meta>` element ("Neither are the report-uri, frame-ancestors, and sandbox directives" supported): https://w3c.github.io/webappsec-csp/#meta-element
- [S13] CSP Level 3, CSP list and self-origin ("self-origin is response's url's origin"): https://w3c.github.io/webappsec-csp/#csp-list
- [S14] CSP Level 3, `frame-src` and `frame-ancestors`: https://w3c.github.io/webappsec-csp/#directive-frame-src, https://w3c.github.io/webappsec-csp/#directive-frame-ancestors
- [S15] Fetch, credentials ("HTTP cookies, TLS client certificates, and authentication entries"): https://fetch.spec.whatwg.org/#credentials
- [S16] Fetch, HTTP-network-or-cache fetch (401 prompts only when "response tainting is not cors, includeCredentials is true"): https://fetch.spec.whatwg.org/#http-network-or-cache-fetch
- [S17] Fetch, append a request `Origin` header (CORS requests and non-GET/HEAD requests carry it; opaque serialises as `null`): https://fetch.spec.whatwg.org/#append-a-request-origin-header
- [S18] Fetch Metadata, `Sec-Fetch-Site` ("Assert: r's current URL is a potentially trustworthy URL"): https://w3c.github.io/webappsec-fetch-metadata/#sec-fetch-site-header
- [S19] Service Workers (`[SecureContext]` `navigator.serviceWorker`; Register rejects untrustworthy script URLs; §2.5.1 "The window client case": opaque origin → active service worker null): https://w3c.github.io/ServiceWorker/#navigator-service-worker-attribute, https://w3c.github.io/ServiceWorker/#control-and-use-window-client
- [S20] RFC 9110 §11.5, protection space (realm + canonical root URI): https://www.rfc-editor.org/rfc/rfc9110#section-11.5
- [S21] RFC 6265 §8.5, "Cookies do not provide isolation by port": https://www.rfc-editor.org/rfc/rfc6265#section-8.5
- [S22] RFC 6761 §6.3, localhost names: https://www.rfc-editor.org/rfc/rfc6761#section-6.3
- [S28] Media Queries 5, `prefers-color-scheme` and `ua-color-scheme` (iframes match the parent's color scheme): https://drafts.csswg.org/mediaqueries-5/#prefers-color-scheme
- [S29] Web IDL, attributes (`[[Configurable]]` true unless unforgeable): https://webidl.spec.whatwg.org/#es-attributes
- [S31] RFC 6750 §5.3, bearer tokens in page URLs: https://www.rfc-editor.org/rfc/rfc6750#section-5.3
- [S32] Secure Contexts, "Is origin potentially trustworthy?": https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy
- [S33] CSS Fonts 4, font fetching (destination "font", CORS mode "cors"): https://drafts.csswg.org/css-fonts-4/#font-fetching-requirements

Engines and vendors
- [S23] WebKit bug 160504, "Localhost subdomains don't work" (Safari uses the OS resolver; fixed in macOS 26, comments 16, 19 and 20): https://bugs.webkit.org/show_bug.cgi?id=160504
- [S24] Chromium enterprise policy `AllowCrossOriginAuthPrompt` (default false: "third-party images unable to show an authentication prompt"): https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/policy/resources/templates/policy_definitions/HTTPAuthentication/AllowCrossOriginAuthPrompt.yaml
- [S25] Chromium issue 457682873, Basic-auth prompt shown for a cross-origin `<img>` on the same IP and another port (Chrome 140/141), which cites issue 40080160 for iframes: https://issues.chromium.org/issues/457682873
- [S26] MDN browser-compat-data 8.1.11: CSP `sandbox` (Chrome 25, Safari and iOS 7), iframe `sandbox` and `srcdoc`, `Sec-Fetch-Site` (Chrome 76, Safari and iOS 16.4): https://github.com/mdn/browser-compat-data (data: `http.headers.Content-Security-Policy.sandbox`, `html.elements.iframe.sandbox`, `http.headers.Sec-Fetch-Site`)
- [S27] Apple, `WKNavigationAction.targetFrame` and `WKFrameInfo.isMainFrame`; `webView(_:didReceive:completionHandler:)`: https://developer.apple.com/documentation/webkit/wknavigationaction/targetframe, https://developer.apple.com/documentation/webkit/wkframeinfo/ismainframe, https://developer.apple.com/documentation/webkit/wknavigationdelegate/webview(_:didreceive:completionhandler:)
- [S30] Bun, `HTMLRewriter`: https://bun.com/docs/runtime/html-rewriter
- [S34] CodePen blog, "Chrome blocking Basic Auth popups" (2018; updated 2020: prompts back in sandboxed iframes). This is a secondary source, cited only for the observed inconsistency: https://blog.codepen.io/2018/02/08/loud-clapping-chrome-blocking-basic-auth-popups/
