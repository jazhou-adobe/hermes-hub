# Design Reviews: framing and proxying a dev-server URL, with HMR and iPad access

Research date: 2026-11-28. Ticket: [#49](https://github.com/jazhou-adobe/hermes-hub/issues/49), on the map
[Wayfinder map: HTML Design Reviews in Hermes Hub](https://github.com/jazhou-adobe/hermes-hub/issues/46).
Scope: what it takes to show a **Revision** whose source is a running dev server (for example training-track's
Next.js on `127.0.0.1:3310`) in the Command Center viewer. The note covers framing headers, a Bun reverse proxy
in the Hub, HMR websockets, reach from the iPad, injecting the pin overlay, isolation from the Hub origin, and
whether to snapshot the page when the Human sends. It is a planning note and builds nothing on main. It ends
with one recommended approach. The choices belong to the grilling tickets
([#51](https://github.com/jazhou-adobe/hermes-hub/issues/51) Revision contents and
[#52](https://github.com/jazhou-adobe/hermes-hub/issues/52) comments) and to the isolation research
([#47](https://github.com/jazhou-adobe/hermes-hub/issues/47)).

Constraints taken from the repo: the Command Center CSP is `default-src 'self'; img-src 'self' data:;
font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'`, and the browser guard checks the Host allowlist,
`Origin == http://<Host>`, rejects `Sec-Fetch-Site: cross-site`, and requires JSON for state changes
(`src/hub/server.ts`, `docs/specs/security.md`). Remote devices use Basic auth over plain HTTP. A second Hub
takes "the next free port from 4747" (`docs/specs/hub-operations.md`).

Citation convention: `[Sn]` points to the numbered entry in [Sources](#sources). **[OBSERVED]** marks the
result of a local experiment for this note. Setup: macOS arm64, Bun 1.3.14, Next.js 16.4.6 (Turbopack),
Vite 8.4.0, Astro 7.4.13, Playwright 1.65 with Chromium and WebKit, LAN address `192.168.1.231`. The
throwaway prototype is described in [Experiment](#experiment). It is evidence for that setup only.
**[INFERENCE]** marks reasoning that no source or test confirmed. **[UNVERIFIED]** marks a claim that needs a
real device, in practice an iPad.

---

## TL;DR

1. **None of the three dev servers sends a framing header by default.** Next.js 16.4.6, Vite 8.4.0 and
   Astro 7.4.13 send no `X-Frame-Options` and no `frame-ancestors` [OBSERVED][S1][S6][S10]. Framing is
   blocked only when the app sets these headers itself (Next `headers()` [S2], Vite `server.headers` [S7]). A
   proxy can strip them.
2. **Origin and Host checks are the real obstacles.** Next 16 blocks `/_next/*` dev resources and the HMR
   websocket for any `Origin` whose hostname is not `localhost`, `*.localhost` or the `--hostname` it was
   started with. That includes LAN IPs, `127.0.0.1` when Next is bound to `*`, and `Origin: null` from
   opaque sandboxes [OBSERVED][S3][S4]. Vite refuses unknown `Host` names (`allowedHosts`). It sends CORS
   headers only to localhost origins, and it needs a token on websocket upgrades that carry an `Origin`
   [OBSERVED][S8][S9]. Astro runs Vite underneath, so Vite's checks apply [S10]. The proxy therefore rewrites
   `Host`, `Origin` and `Referer` to the upstream's own `localhost` values. Because that switches off the dev
   servers' own DNS-rebinding and cross-site-websocket (CSWSH) defences, the proxy must run the Hub's Host
   and Origin guard itself.
3. **Use one port per dev server, not a path.** A path prefix such as `/preview/<id>/` on the Hub origin
   would be the Hub's own origin, which breaks isolation. It would also need rewriting of every root-relative
   URL in HTML, CSS, JS, dynamic imports and HMR paths. A separate listener that mounts the dev server at its
   root needs no URL rewriting. Next's and Vite's HMR clients build the socket URL from `location` or
   `import.meta.url` [S5][S9], so they connect back through the proxy [OBSERVED]. Routing by subdomain is ruled
   out because the iPad reaches the Hub by IP literal.
4. **The proxy worked end to end in Chromium and WebKit over the LAN address** [OBSERVED]:
   - training-track rendered with its fonts and CSS.
   - Next Fast Refresh updated the text without a reload.
   - Vite updated CSS in place.
   - Astro did a full reload, and the overlay was injected again after it.
   - The dev servers stayed bound to `127.0.0.1`.
5. **The iPad signs in to the preview port once, through a cookie that the Hub hands over.** Basic auth
   credentials apply per origin [S16], so every preview port would prompt again, and the prompt would come
   from inside an iframe. Instead the Hub mints a one-time token. The iframe loads
   `/__hermes/enter?t=…`, and the preview port exchanges the token for an `HttpOnly; SameSite=Strict` cookie
   and redirects to the page. This worked in Chromium and WebKit over the LAN IP [OBSERVED]. It still needs a
   check on a real iPad [UNVERIFIED].
6. **Inject the overlay with `HTMLRewriter`.** It prepends a same-origin `<script src="/__hermes/overlay.js">`
   to `<head>`, and only HTML documents are touched. There is a Bun 1.3.14 problem: transforming Next's
   streamed HTML body inside `Bun.serve` stalled forever. Vite and Astro HTML streamed fine. Buffering the
   HTML document first fixed it [OBSERVED].
7. **The preview origin is isolated by its port.** From the framed page, reading `parent.document` threw
   `SecurityError`, CORS blocked reads of the Hub's `/cc/*`, the preflight blocked JSON POSTs, and a `no-cors`
   POST got a 403 from the guard. Results were the same in both engines [OBSERVED]. The iframe needs
   `sandbox="allow-scripts allow-same-origin …"`. Without `allow-same-origin`, Next served nothing
   (403 on chunks, failed fonts, no CSS) [OBSERVED]. The Command Center CSP must add a `frame-src` entry for
   the preview origins, because `'self'` does not match another port [S13].
8. **Do not snapshot the render when the Human sends.** Tie feedback to what was seen in three ways: anchor
   context per comment, from the overlay (ticket #48); an HMR generation counter, which the proxy sees for
   free [OBSERVED]; and an optional source ref from the Agent. A headless snapshot is cheap (≈0.8 s and
   66–545 KiB per page [OBSERVED]). But it renders a different session than the Human's, adds a Chromium
   dependency, and the map rules out ever showing older renders.

**Recommendation:** a **port-based preview proxy inside the Hub process**. It uses one OS-assigned port per
upstream dev-server origin, opened on demand. It rewrites only headers, bridges HMR websockets, injects the
overlay into HTML documents, runs its own guard, and authenticates the Human with a cookie the Hub hands over.
Targets are limited to loopback `http://` URLs. No render snapshot is taken. Details are in
[Recommendation](#recommendation).

---

## 1. Framing headers sent by default

| Dev server | `X-Frame-Options` | CSP `frame-ancestors` | Other checks that break framing or proxying |
|---|---|---|---|
| Next.js 16.4.6 `next dev` (Turbopack) | none [OBSERVED][S1] | none [OBSERVED][S1] | `blockCrossSiteDEV`: `/_next/*` and `/__nextjs*` requests, and the HMR websocket upgrade, return 403 (or drop the socket) when `Origin` is set and its hostname is outside `localhost`, `**.localhost`, `allowedDevOrigins` and the `--hostname` value. `no-cors` requests with `Sec-Fetch-Site: cross-site` also need an allowed `Referer`. `Origin: null` is always blocked [S3][S4] |
| Vite 8.4.0 `vite` | none [OBSERVED][S6] | none [OBSERVED][S6] | `server.allowedHosts`: unknown `Host` names return 403, while IP literals and `localhost` pass [S8]. `server.cors` default reflects only `localhost`, `127.0.0.1` and `[::1]` origins [S8]. A websocket upgrade that carries an `Origin` needs `?token=` (CVE-2025-24010 fix) [S9][S12]. The HMR subprotocol is `vite-hmr` |
| Astro 7.4.13 `astro dev` | none [OBSERVED][S10] | none [OBSERVED][S10] | Vite's dev server underneath, so Vite's checks apply. Astro's CSP feature emits a `<meta http-equiv>` with `script-src`/`style-src` only, and `frame-ancestors` is not valid in a meta tag [S10][S14] |

What the experiments showed:

- **Next, framing.** `curl -I http://127.0.0.1:3310/` against training-track returned `Vary`, `Link`,
  `Cache-Control: no-store`, `X-Powered-By`, `Content-Type` and nothing about framing. A grep of
  `node_modules/next/dist` found no `X-Frame-Options` or `frame-ancestors` outside docs and the edge-runtime
  polyfills [OBSERVED].
- **Next, the Origin check.** Against `127.0.0.1:3310` (training-track, bound to `*`), a `/_next/static/...`
  request returned 403 with `Origin: http://192.168.1.231:4790`, `Origin: null`, and even
  `Origin: http://127.0.0.1:3310`. It returned 404 (that is, allowed) with no Origin or with
  `Origin: http://localhost:<any port>` [OBSERVED].
- **Next, the HMR websocket.** Upgrades with a LAN or `127.0.0.1` origin were dropped. A `localhost` origin got
  `101`. A probe app started with `--hostname 127.0.0.1` also accepted `Origin: http://127.0.0.1:5399`
  [OBSERVED]. Next ignores the `Host` header: a foreign `Host` still got 200 [OBSERVED].
- **Next, opening the dev server by LAN IP.** Opening `http://<LAN IP>:3310` straight from an iPad would render
  the HTML, but chunks and HMR would be blocked unless the project adds `allowedDevOrigins` [S4]. The map rules
  out changing training-track. A proxy that rewrites `Origin` needs no project change.
- **Vite.** A foreign `Host: mymac.local:4832` got 403. `Origin: http://localhost:5199` got
  `Access-Control-Allow-Origin`, and a LAN origin got none. A websocket upgrade with an `Origin` and no token
  got 400 [OBSERVED].

**Implication.** Framing headers are not the blocker. The proxy should still drop `X-Frame-Options` and the
`frame-ancestors` directive from upstream responses, because apps may set them for production parity [S2].
The blocker is the dev servers' anti-CSRF and anti-rebinding checks, which a header-rewriting proxy satisfies.

## 2. A Bun reverse proxy: path versus port

### Path-based (`http://<hub>/preview/<rev>/…`)

- **Isolation fails.** Same scheme, host and port means the same origin [S15]. The design's JS could call
  `/cc/*` with the guard's blessing. The map rules this out.
- **Rewriting everywhere.** Dev servers emit root-relative URLs: `/_next/static/...`, `/@vite/client`,
  `/@id/...`, `/_next/hmr`, and Next router fetches. A prefix would need rewriting in HTML, CSS `url()`, JS
  imports, runtime `fetch` calls and the HMR client. Or it would need the project to set `basePath`/`assetPrefix`
  (Next) or `base` (Vite). That is fragile, and it changes the Agent's project.
- A path on a **separate** port has the same rewriting problem without gaining anything.

### Port-based (`http://<hub host>:<preview port>/…` → `http://127.0.0.1:3310/…`)

- The dev server sits at the root of its own origin, so root-relative URLs work unchanged. The proxied HTML of
  training-track contained **no** absolute `localhost:3310`/`127.0.0.1:3310` URLs [OBSERVED].
- **HMR connects back through the proxy.** Vite's client builds `ws://${importMetaUrl.hostname}:${importMetaUrl.port}`
  unless `server.hmr.host` or `clientPort` is set [S9]. Next's client connects to `/_next/hmr` on the page's own
  origin [S5]. In the tests, every HMR socket went to the preview port: `ws://192.168.1.231:4830/_next/hmr?id=…`
  and `ws://192.168.1.231:4832/?token=…` [OBSERVED]. A project that pins `server.hmr.clientPort` or `host`
  would bypass the proxy [INFERENCE].
- **Subdomain routing is out.** Routing one port by subdomain (`<rev>.localhost`) would work on this Mac, but
  the iPad reaches the Hub by IP literal and the Host allowlist refuses other names (security spec). So routing
  goes by port.
- **One port per upstream origin.** Two Agents with two dev servers, or variants served by two servers side by
  side, need two origins at once. A cookie or "current target" switch on one shared port cannot serve both.
  Separate ports also isolate the two dev apps from each other.
- **Port choice.** Hub port + 1 is not safe, because a second Hub takes the next free port from 4747
  (hub-operations spec). OS-assigned ports (`Bun.serve({ port: 0 })`) avoid the clash. The Hub already builds
  its CSP per response, so listing the current preview origins in `frame-src` is cheap [INFERENCE].

### What the proxy rewrites

| Direction | Change | Why |
|---|---|---|
| Request | `Host` → upstream `host:port` | Vite `allowedHosts` [S8] |
| Request | `Origin` → `http://localhost:<upstream port>`, and `Referer` re-based the same way | Next `blockCrossSiteDEV` [S3], Vite CORS and websocket checks [S8][S9] |
| Request | drop `Authorization`, the preview cookie, hop-by-hop headers (`Connection`, `Keep-Alive`, `TE`, `Upgrade`) | The dev server never sees Hub credentials; RFC 9110 §7.6.1 [S17] |
| Request | `Accept-Encoding: identity` (or drop it) | `HTMLRewriter` needs plain bytes |
| Response | drop `X-Frame-Options` and the CSP `frame-ancestors` directive | Framing |
| Response | drop `Transfer-Encoding`, `Connection`, `Keep-Alive`. On rewritten HTML, also drop `Content-Length` | Hop-by-hop. Leaving `Transfer-Encoding` in caused a hang [OBSERVED] |
| Response | `Location: http://localhost:3310/x` → `/x` | Redirects stay on the preview origin |
| Response | upstream `Set-Cookie` that uses the preview cookie's name: drop it | The design cannot clobber the session [INFERENCE] |

### HMR websockets in Bun

- In `fetch`, `server.upgrade(req, { data, headers: { "Sec-WebSocket-Protocol": <first offered> } })` accepts
  the browser socket, and Bun lets the 101 response carry extra headers [S18].
- In `open`, a client `new WebSocket("ws://127.0.0.1:<port><path>", { headers: { origin, host }, protocols })`
  connects upstream. The `headers` option is a Bun extension [S18].
- Messages are piped both ways, with a queue until the upstream socket is open. Closes are mirrored.
- In the tests this carried Turbopack (`turbopack-connected`, `building`, `built`, `sync`, `turbopack-message`,
  `isrManifest`), Vite (`connected`, `update`) and Astro (`connected`, `full-reload`) traffic [OBSERVED].
- Echoing the subprotocol matters for Vite, whose upgrade handler only accepts `vite-hmr`/`vite-ping` [S9].

### Bun details found by testing

- **The idle timeout.** Next's first compile of a route took more than 10 s. `Bun.serve`'s default
  `idleTimeout` (10 s) then killed the request. The preview listener needs `idleTimeout: 255` or `0`
  [OBSERVED][S19].
- **`HTMLRewriter` stalls on Next's streamed HTML.** It stalled on `http://127.0.0.1:3310/` (117 KB) and on the
  probe Next app. It worked on Vite and Astro HTML, and it worked when the same Next body was buffered with
  `await res.arrayBuffer()` first [OBSERVED].
  - Reproduction: a `Bun.serve` handler returns `new HTMLRewriter().on("head", …).transform(new Response(upstream.body))`.
    The client never gets the body.
  - Buffering only the HTML document gives up progressive Suspense streaming on the first load. That is
    acceptable for review. Flight (`text/x-component`) and asset responses still stream through untouched.
- **An intermittent hang.** The first two of four Chromium runs against the probe Next app timed out after
  30 s, because the parent page's `load` never fired (the framed HTML was served). The next two runs, one with
  request tracing, were clean. WebKit runs never hung, and the cause was not isolated [OBSERVED]. Treat it as
  a build-time test item.

## 3. Reaching a localhost-only dev server from the iPad

- **The dev server can stay on loopback.** The Vite, Astro and Next probes ran bound to `127.0.0.1`. The iPad
  path ran from `192.168.1.231` through the preview port and worked [OBSERVED]. The preview listener binds the
  same `host` as the Hub (`0.0.0.0`, or `127.0.0.1` when the Hub is local only), so `host = "127.0.0.1"` also
  keeps previews on this Mac.
- **Auth applies the same way as on the Hub.** Requests from loopback pass, and remote ones must authenticate
  (security spec).
- **Basic auth on the preview port has drawbacks.** Basic credentials are scoped to a protection space: the
  canonical root URI (scheme + host + port) plus the realm [S16]. So the iPad would prompt again for each
  preview port, and the prompt would come from a subresource inside the viewer's iframe. Whether iPad Safari
  shows an auth sheet for a cross-origin iframe is **[UNVERIFIED]**. Chrome blocks cross-origin auth prompts
  for some subresources [S22].
- **The recommended path: a Human session handed over by the Hub.**
  1. The Command Center asks the Hub (an authenticated `/cc/*` call) for a one-time token with a short TTL.
  2. It sets the iframe to `http://<same host>:<preview port>/__hermes/enter?t=<token>&next=<path>`.
  3. The preview port consumes the token and sets `hh_preview=<random>; HttpOnly; SameSite=Strict; Path=/`,
     then sends a 302 to `next`.
  4. Every later request carries the cookie.

  Results [OBSERVED]:
  - The flow worked in Chromium and WebKit loaded over `192.168.1.231`.
  - Without the cookie, LAN requests got 401.
  - From an opaque (sandboxed, no `allow-same-origin`) frame the cookie was not sent, and everything got 401.
- **Why the cookie works across ports.**
  - Cookies ignore ports [S20], so one cookie value can be valid on every preview port at once.
  - The Hub port receives the cookie too and ignores it. The Hub must keep never using cookies for auth
    [INFERENCE].
  - `SameSite=Strict` still sends the cookie, because a frame on another port of the same IP is same-site
    [S21].
  - `HttpOnly` keeps it away from the design's JS.
- **Safari's third-party-cookie blocking should not apply, since the context is same-site** [INFERENCE]. This
  needs a real iPad [UNVERIFIED].
- **Basic auth on the preview port stays as a fallback**, for opening a preview in its own tab.
- **On a remote device, the guard has to rely on `Origin`.** Over `http://192.168.x.y`, browsers send no
  `Sec-Fetch-*` headers: the URL is not potentially trustworthy [S23], and the Hub saw `Sec-Fetch-Site: null`
  [OBSERVED]. On loopback the browser does send them.

## 4. Injecting the pin overlay

- **Mechanism.** `new HTMLRewriter().on("head", { element: el => el.prepend('<script src="/__hermes/overlay.js"></script>', { html: true }) })`
  [S24]. The proxy serves `/__hermes/*` itself and never forwards it, so the path prefix is reserved. The test
  showed the tag as the first child of `<head>` in Next, Vite and Astro pages [OBSERVED].
- **When it runs.**
  - Only `text/html` responses are rewritten, so flight, JS, CSS and font responses pass through.
  - Client-side navigations (Next router, Astro view transitions) keep the injected script alive.
  - A full reload re-injects it: Astro's `full-reload` produced a second `loaded` report [OBSERVED].
  - The overlay needs to watch for DOM swaps after HMR. That belongs to ticket #48.
- **CSP of the proxied page.** A same-origin `src` script passes `script-src 'self'`. A nonce-based or
  `'strict-dynamic'` CSP set by the app would block it [S14]. The dev servers set no CSP by default
  [OBSERVED]. Options for such apps: re-use the page's nonce (the rewriter can read it from an existing
  `<script nonce>`), or drop the upstream CSP during review. Rare in dev [INFERENCE].
- **Channel to the Hub.** The overlay calls `parent.postMessage(msg, "<Hub origin>")` with an explicit target
  origin, and the Command Center checks `event.origin` against the preview origins [S25]. The proxy knows the
  Hub origin from the request's `Host` hostname and the Hub port, and can bake it into the overlay. The test
  overlay reported clicks and probes this way [OBSERVED].

## 5. Keeping the proxied origin isolated from the Hub

**What the framed page could not do** (test overlay, Chromium and WebKit, both over loopback and over LAN)
[OBSERVED]:

| Probe from the preview origin | Result |
|---|---|
| `parent.document.title` | `SecurityError` |
| `fetch(hub + "/cc/secret")` (CORS GET) | blocked by CORS. The Hub saw it and the guard refused the foreign `Origin` |
| `fetch(hub + "/cc/answer", {method:"POST", content-type JSON})` | preflight `OPTIONS` refused, so the POST never sent |
| `fetch(hub + "/cc/answer", {method:"POST", mode:"no-cors"})` | sent with `Origin: http://…:4830`. The guard returned 403, and the page saw an opaque response |
| `localStorage` | works, scoped to the preview origin |

- **`allow-same-origin` is safe here and required.** The iframe needs
  `sandbox="allow-scripts allow-same-origin allow-forms"`, and `allow-popups` only if designs open windows.
  It must never have `allow-top-navigation`. `allow-same-origin` keeps the frame's **own** origin, which is
  different from the Hub's [S26].
- **Without it, dev servers break.** With an opaque origin, Next returned 403 for every chunk (no-cors +
  cross-site), CORS-mode font preloads failed, `document.styleSheets.length` was 0, and no HMR socket opened
  [OBSERVED]. The CSP sandbox and opaque-origin route that suits stored HTML (ticket #47) does not fit dev
  servers.
- **The Command Center CSP needs a `frame-src` entry.** `default-src 'self'` covers frames, and `'self'` does
  not match another port [S13]. The stand-in Hub framed the preview only after
  `frame-src http://<host>:<preview port>` was added [OBSERVED].
- **Same-site is not same-origin.** The preview port is same-site with the Hub [S21]. On loopback the browser
  sent `Sec-Fetch-Site: same-site`, which the guard's `cross-site` rule does not catch. The `Origin` check
  caught every case [OBSERVED].
  - Remaining gap: GET requests without `Origin` (`<img>`, `<script>`, `<link>` in no-cors mode) reach the Hub.
    On the iPad they probably carry the cached Basic credentials [INFERENCE]. Responses are opaque, and ORB
    blocks JSON in no-cors contexts [S27]. So this is harmless while GETs have no side effects.
  - Hardening option for ticket #47: refuse `Sec-Fetch-Site: same-site` on `/cc/*`. That helps on loopback
    only, because remote plain HTTP sends no Fetch Metadata.
- **The proxy replaces the dev servers' own defences, so it must carry them.** Rewriting `Host` and `Origin`
  switches off Vite's DNS-rebinding check and the CSWSH checks in Next and Vite, which exist because of real
  advisories [S12][S4]. The preview listener therefore runs the same Host allowlist and
  `Origin == http://<Host>` check as the Hub, websocket upgrades included, before it rewrites anything.
  Without that, any web page in the Human's browser could read the dev server's source through the Hub
  [INFERENCE].
- **Restrict targets.** Accept only `http://localhost|127.0.0.1|[::1]:<port>` targets. Otherwise an Agent-given
  URL turns the Hub into an open proxy that the iPad can reach. Remote preview URLs, such as deployed previews,
  are a separate source [INFERENCE].
- **Cookies.** Cookies set by the dev app on the preview origin are also sent to the Hub port [S20]. The Hub
  ignores cookies, so they are harmless. The proxy strips its own `hh_preview` cookie before forwarding.
- **WKWebView (Hermes Hub.app).** It loads the Hub from `127.0.0.1`, so loopback rules apply and no cookie is
  needed. Cross-origin iframes behave as in WebKit [INFERENCE]. Engine-level checks belong to ticket #47.

## 6. Snapshot the URL when the Human sends?

The question is how to keep feedback tied to what was seen, given that the map says older Revisions show
feedback only and never their renders, and that there is no visual diff.

| Option | Cost (measured where possible) | What it captures | Verdict |
|---|---|---|---|
| A. Headless Chromium at Send (screenshot and/or MHTML via CDP `Page.captureSnapshot` [S28]) | Launch ≈ 0.1 s, load ≈ 0.7–0.8 s, full-page PNG at 1440 px = 66–545 KiB, MHTML = 149–179 KiB per page, on three training-track pages [OBSERVED]. Needs a Chromium install (Playwright's headless shell is 207 MB on disk, full Chromium 377 MB [OBSERVED]) and a page × state × viewport × theme loop | A **fresh** render, not the Human's session: React state, scroll, theme toggle, form input and HMR timing all differ [INFERENCE] | No. It is a heavy dependency, shows the wrong session, and nobody may view it |
| B. Save-page from the overlay (serialise `document.documentElement.outerHTML` and inline the CSS) | DOM 31–121 KiB per page before inlining [OBSERVED]. Inlining fonts, images and CSS (SingleFile-style) multiplies that | What the Human saw, but replay depends on assets that keep changing | No. Only the Agent would read it, and the Agent has the code |
| C. **No render snapshot; stamp the feedback** | Negligible | (1) Per comment: the overlay's anchor context — selector, text excerpt, rect, viewport, theme (ticket #48). (2) Per comment and per verdict: an **HMR generation** that the proxy counts from upstream messages (`update`/`full-reload`, Turbopack `built`) [OBSERVED]. (3) Optional `source_ref` from the Agent (for example commit + dirty flag) | **Yes** |

- **Why C is enough.** The Agent normally waits for the Answer, so its code is still while the Human reviews.
  If it edits anyway, the generation counter shows the change. The viewer can say "the design changed since
  this comment" and the Answer can carry it [INFERENCE].
- **Frozen copies.** An Agent that wants a frozen copy should submit a bundle or screenshots Revision (ticket
  #51).
- **Thumbnails.** Hub-rendered thumbnails for the Feed stay a separate open item on the map. Option A's numbers
  are the input for that decision.

---

## Recommendation

**A port-based preview proxy inside the Hub process.**

1. **Source shape.** The Revision source is `{ kind: "url", url: "http://127.0.0.1:3310/pages/home" }`, plus
   page × state paths. The Hub refuses anything but loopback `http://` targets.
2. **Listener.** There is one preview listener per upstream origin (scheme + host + port). It gets an
   OS-assigned port (`Bun.serve({ port: 0, idleTimeout: 0 })`) and binds the Hub's `host`. It opens on demand
   and closes when no open Revision points at that origin. It serves nothing of the Hub: no `/cc/*`, `/v1/*` or
   `/mcp`.
3. **Guard.** It runs the Hub's Host allowlist and `Origin == http://<Host>` check on every request and
   upgrade. Remote requests need the `hh_preview` cookie or Basic auth. Loopback requests pass.
4. **Rewrites.** Requests get `Host`, `Origin` and `Referer` set to the upstream's `localhost` values, lose
   `Authorization`, the preview cookie and hop-by-hop headers, and ask for identity encoding. Responses lose
   `X-Frame-Options`, CSP `frame-ancestors` and hop-by-hop headers, and get `Location` rewritten. Bodies are
   never rewritten except for HTML documents.
5. **HTML.** HTML documents are buffered, then passed through `HTMLRewriter`, which prepends
   `<script src="/__hermes/overlay.js">`. Everything else streams.
6. **HMR.** Websockets are bridged with the subprotocol echoed. The proxy counts the upstream messages that
   mean "changed" and keeps one generation number per listener. The overlay reports it with every comment.
7. **Viewer.** The Command Center frames
   `http://<same host>:<preview port>/__hermes/enter?t=<one-time token>&next=<path>` with
   `sandbox="allow-scripts allow-same-origin allow-forms"`. It adds the live preview origins to `frame-src` in
   its CSP, and accepts `postMessage` only from those origins. The viewport presets (1440/834/390) are iframe
   widths. Variants side by side are iframes on the same or different preview ports.
8. **Snapshots.** No snapshot is taken at Send. Feedback carries the anchor context, the HMR generation and an
   optional Agent `source_ref`.

---

## Open questions for the map

1. **Terminology.** "Live" already means Agent liveness (`Live / Idle / Gone` in `GLOSSARY.md`). Call this
   source a *dev-server* or *URL* source, not a "live URL". This is for the domain-modeling session.
2. **Testing on an iPad** is needed for two things: whether iPad Safari keeps the `SameSite=Strict` preview
   cookie set inside an iframe on another port, and whether it shows Basic auth sheets for cross-origin iframe
   loads. Playwright WebKit is not iPad Safari.
3. **Nonce-CSP apps:** re-use the page's nonce, or drop the upstream CSP during review?
4. **Guard hardening (ticket #47):** refuse `Sec-Fetch-Site: same-site` on `/cc/*`?
5. **Dev server down or restarting:** what the viewer shows (proxy 502 page versus a Command Center state), and
   whether the Agent is told.
6. **Remote preview URLs** (deployed previews on https): frame them directly when their headers allow, proxy
   them, or refuse them?
7. **The Bun `HTMLRewriter` stall** on streamed Next HTML. Worth a minimal upstream repro and a Bun issue
   before the build relies on buffering.
8. **Projects that pin the HMR host** (`server.hmr.clientPort`/`host`, or a custom `assetPrefix` with an
   absolute URL) bypass the proxy. Should the Hub Skill tell Agents not to set them, or should the proxy
   rewrite those few strings?

---

## Experiment

Throwaway files under `/tmp/ldp-*`, none in the repo:

- **`proxy.ts`** (≈ 180 lines of Bun) runs two listeners.
  - A *preview* listener that does everything in the Recommendation except the guard and port allocation. Its
    port is fixed per run: 4830/4832/4834/4836.
  - A *stand-in Hub* that serves a parent page with the Command Center CSP plus `frame-src`, mints bootstrap
    tokens, and exposes `/cc/secret` and `/cc/answer` behind a copy of `guard()`.
- **Upstreams.**
  - training-track's running `next dev` on `*:3310`, used read-only.
  - A probe Next 16.4.6 app on `127.0.0.1:5399`.
  - A Vite 8.4.0 app on `127.0.0.1:5199`.
  - An Astro 7.4.13 app on `127.0.0.1:5299`, run under `bun --bun` because Astro 7 requires Node ≥ 22.23.4.
- **Drivers.** Playwright scripts load the stand-in Hub at `http://192.168.1.231:<hub port>/` (and at
  `127.0.0.1`), read the overlay's `postMessage` reports, list websockets and failures, and then:
  - edit a `/tmp` source file (Next `page.jsx` text, Vite `style.css` colour, Astro `index.astro` text) to
    check HMR;
  - take screenshots and MHTML for the snapshot costs.

HMR results [OBSERVED]:

| Upstream | Chromium | WebKit |
|---|---|---|
| Next (probe app) | text `next v1` → `next v2`, 0 frame reloads, `data-loaded` unchanged | same |
| Vite | `rgb(255,0,0)` → `rgb(0,0,255)`, 0 reloads | same |
| Astro | `astro v1` → `astro v2` through a full reload; overlay re-injected | same |

## Sources

- [S1] Next.js 16.4.6 `next dev` response headers and `dist/` contents, observed locally; header config reference: https://nextjs.org/docs/app/api-reference/config/next-config-js/headers
- [S2] Next.js, "Content Security Policy" guide (app-set CSP, `frame-ancestors`): https://nextjs.org/docs/app/guides/content-security-policy
- [S3] Next.js source, `block-cross-site-dev.ts` (v16.4.3; identical logic in the installed 16.4.6 `dist`): https://github.com/vercel/next.js/blob/v16.4.3/packages/next/src/server/lib/router-utils/block-cross-site-dev.ts
- [S4] Next.js docs, `allowedDevOrigins`: https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins
- [S5] Next.js 16.4.6 dev HTML: the HMR client chunk `[turbopack]_browser_dev_hmr-client` opens `/_next/hmr` on the page origin (observed in the proxied page's websocket URL)
- [S6] Vite 8.4.0 package `dist/node/chunks/node.js`, no framing headers (grep); server options: https://vite.dev/config/server-options
- [S7] Vite, `server.headers`: https://vite.dev/config/server-options#server-headers
- [S8] Vite, `server.allowedHosts` and `server.cors` (`defaultAllowedOrigins` regex in `dist/node/chunks/node.js`): https://vite.dev/config/server-options#server-allowedhosts
- [S9] Vite 8.4.0 `dist/client/client.mjs` (socket host from `import.meta.url`, `?token=`) and `createWebSocketServer` in `dist/node/chunks/node.js`; HMR options: https://vite.dev/config/server-options#server-hmr
- [S10] Astro 7.4.13 package `dist/` (no framing headers; CSP via `<meta http-equiv>`); Astro config reference, `security.csp`: https://docs.astro.build/en/reference/configuration-reference/
- [S12] Vite advisory GHSA-vg6x-rcgg-rjx6 / CVE-2025-24010 (cross-site websocket and CORS): https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6
- [S13] W3C, Content Security Policy Level 3: `frame-src` fallback to `default-src`, `'self'` matches same origin only: https://www.w3.org/TR/CSP3/#directive-frame-src and https://www.w3.org/TR/CSP3/#match-url-to-source-expression
- [S14] W3C CSP3: `frame-ancestors` is ignored in `<meta>`; nonces and `'strict-dynamic'`: https://www.w3.org/TR/CSP3/#directive-frame-ancestors
- [S15] RFC 6454, The Web Origin Concept (origin = scheme, host, port): https://www.rfc-editor.org/rfc/rfc6454
- [S16] RFC 9110 §11.5, Establishing a Protection Space (realm + canonical root URI): https://www.rfc-editor.org/rfc/rfc9110#section-11.5; RFC 7617 Basic: https://www.rfc-editor.org/rfc/rfc7617
- [S17] RFC 9110 §7.6.1, Connection (hop-by-hop fields): https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1
- [S18] Bun docs, WebSockets (`server.upgrade` headers, client `headers` and `protocols`): https://bun.com/docs/runtime/http/websockets
- [S19] Bun docs, `Bun.serve` `idleTimeout`: https://bun.com/docs/runtime/http/server
- [S20] RFC 6265 §8.5, "Cookies do not provide isolation by port": https://www.rfc-editor.org/rfc/rfc6265#section-8.5
- [S21] WHATWG HTML, "same site" (port ignored for sites): https://html.spec.whatwg.org/multipage/browsers.html#same-site
- [S22] Chromium, cross-origin auth prompts for subresources are blocked (policy `AllowCrossOriginAuthPrompt`): https://chromeenterprise.google/policies/#AllowCrossOriginAuthPrompt
- [S23] W3C, Fetch Metadata Request Headers (only for potentially trustworthy URLs): https://w3c.github.io/webappsec-fetch-metadata/
- [S24] Bun docs, HTMLRewriter: https://bun.com/docs/runtime/html-rewriter
- [S25] MDN, `Window.postMessage()` (target origin, checking `event.origin`): https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- [S26] WHATWG HTML, the `iframe` `sandbox` attribute (`allow-same-origin` keeps the content's own origin): https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox
- [S27] Opaque Response Blocking (ORB) explainer, the successor to CORB for `no-cors` responses: https://github.com/annevk/orb
- [S28] Chrome DevTools Protocol, `Page.captureSnapshot`: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureSnapshot
