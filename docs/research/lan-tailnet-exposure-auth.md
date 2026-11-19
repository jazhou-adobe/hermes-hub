# Hermes Hub: exposing a single-user Bun Hub safely on LAN and tailnet

Research date: 2026-11-19. Ticket: [#4](https://github.com/jazhou-adobe/hermes-hub/issues/4).
Scope: how the **Hub** (Bun + SQLite, one **Human**) can listen beyond loopback, on a LAN and on
a Tailscale tailnet, and be reached by **Agents** on other machines or in cloud sandboxes. The note
covers TLS, Agent auth, Human browser auth, cloud-sandbox reachability and Bun specifics. This is a
planning note. Nothing here has been built, and no option is chosen here; the choices belong to the
later grilling tickets.

Builds on the prior transport research
([agent-human-transport-options.md](https://github.com/jazhou-adobe/hermes-hub/blob/research/agent-human-transport-options/docs/research/agent-human-transport-options.md)),
which already settled: the bearer token in `~/.hermes/hub.json` (0600), `Origin` checks, and "binding
to 127.0.0.1 is not an auth boundary". This note does not repeat that material; it extends it to
non-loopback exposure.

Citation convention: `[Sn]` points to the numbered entry in [Sources](#sources). Every statement of
fact about a product, spec or default carries one. **[OBSERVED]** marks a result of a local experiment
run for this note (macOS arm64, Bun 1.3.14 and 1.4.4; scripts described inline); it is evidence for
that setup only. **[UNVERIFIED]** marks a claim no primary source confirmed. Text under "Analysis" or
"Implication" is the researcher's reasoning, not a sourced fact.

---

## TL;DR

1. **Tailscale Serve is the lowest-effort TLS path for the tailnet.** It gives a Let's Encrypt cert
   for `machine.tailnet.ts.net`, proxies to `http://127.0.0.1:<port>`, and injects
   `Tailscale-User-Login` identity headers that it strips from inbound requests [S1][S2][S16]. Its
   catches: machine names land in public Certificate Transparency logs [S3], identity headers are
   absent for tagged devices and Funnel traffic [S1][S16], and every proxied request reaches the Hub
   from `127.0.0.1`, which removes "loopback means trusted" as an auth signal.
2. **Certificate lifetimes are shrinking.** Let's Encrypt moves to 64-day certs on 2027-02-10 and
   45-day certs in 2028 [S20][S21]. `tailscale cert` files are not auto-renewed [S3][S4], and
   `Bun.serve`'s `server.reload()` cannot swap TLS options [S31]. So a Hub that terminates TLS itself
   must restart, or own a renewal loop.
3. **Plain HTTP on a tailnet IP is encrypted on the wire, but browsers treat it as insecure.** WireGuard
   encrypts tailnet traffic [S3]. Browsers, though, only treat `https`, `127.0.0.0/8`, `::1` and
   `localhost` as potentially trustworthy [S53]. On `http://100.x.y.z` or `http://192.168.x.y` this
   rules out `Secure`/`__Host-` cookies [S52], WebAuthn [S54], Fetch Metadata headers [S50] and
   Notifications (prior note). On the LAN, plain HTTP is also readable by anyone on the network.
4. **Agent tokens: precedent favours per-principal, revocable, hashed-at-rest tokens.** MCP's local
   security guide recommends one narrowly scoped token per server [S41]. OWASP recommends at least 128
   bits from a CSPRNG and storing a one-way verifier instead of the token [S51]. RFC 6750 says bearer
   tokens SHOULD NOT go in URLs [S59]. GitHub's prefix + checksum format makes leaked tokens easy to
   scan for [S60]. For CLI storage, `Bun.secrets` wraps Keychain, libsecret and Credential Manager
   (experimental) [S36]. `gh` uses the OS store and falls back to a plaintext file [S61].
5. **Human browser auth needs three separate defences.** (a) Something to authenticate the Human:
   Tailscale identity headers, a one-time login link that becomes a session cookie, or a passkey.
   Passkeys only work on `https` or `http://localhost` [S54]. (b) CSRF defence: Fetch Metadata
   `Sec-Fetch-Site`, with an `Origin`/`Referer` fallback, per OWASP [S50]. (c) A `Host` allowlist
   against DNS rebinding, as Jupyter and Vite do [S57][S58]. MCP also requires `Origin` validation
   [S40].
6. **Chrome now gates public→local requests behind a permission prompt.** Local Network Access
   (Chrome 142) classes `100.64.0.0/10`, the tailnet range, as *local* [S55][S56][S15]. This is
   defence in depth against drive-by CSRF from internet sites. It does not replace server-side checks:
   WebSockets were not yet gated at launch, and other browsers differ [S55].
7. **Two documented ways in from cloud sandboxes.** (a) Join the tailnet as an **ephemeral, tagged**
   node via an auth key, an OAuth client, or workload identity federation (OIDC). Codex cloud has
   first-class Tailscale VPN settings and asks for a *reusable + ephemeral* key [S71][S6][S7][S9][S10].
   (b) Expose the Hub publicly with **Funnel**: ports 443/8443/10000 only, no identity headers, a
   `Tailscale-Funnel-Request: ?1` marker [S5][S16]. Both Claude Code's and Codex's cloud environments
   can inject a bearer token at their egress proxy, so the raw token never enters the VM [S70][S71].
   Claude Code's cloud docs do not mention Tailscale.
8. **The default Tailscale policy allows every device to reach every other** [S14]. An ephemeral
   sandbox node therefore reaches the Human's laptop on all ports unless a grant narrows it, for
   example `tag:hermes-agent → tag:hermes-hub: tcp:443` [S12][S11].
9. **Bun binding facts.** `hostname` defaults to `0.0.0.0` (all interfaces) [S31][S32]. Each
   `Bun.serve` takes one `hostname`, so several specific interfaces need several servers on the same
   port; this works **[OBSERVED]**. `hostname: "localhost"` bound only `::1` on macOS, so
   `tailscale serve <port>`, which proxies to `127.0.0.1` [S2], would get connection refused
   **[OBSERVED]**. `hostname: "::"` accepted IPv4 as mapped addresses **[OBSERVED]**.
10. **Self-signed + pinning works in Bun via `tls.ca`.** Passing the self-signed cert as the
   only trust anchor in `fetch(..., { tls: { ca } })` works **[OBSERVED]**. Do not combine
   `rejectUnauthorized: false` with `checkServerIdentity`: Bun ignores the callback's return value
   [S33] and the request succeeded **[OBSERVED]**. Bun 1.3.14 also skipped `checkServerIdentity` on a
   reused keep-alive connection. 1.4.4 did not **[OBSERVED]**, which matches the current docs [S33].

---

## 0. Exposure topologies and threat model

The Hub may be reached through four network paths. The design may choose to support any subset:

| Path | Who can reach the port | Transport encryption without app TLS |
| - | - | - |
| Loopback (`127.0.0.1`/`::1`) | Every local process; any web page via the Human's browser (CSRF, DNS rebinding) [S41][S40] | n/a (no wire) |
| LAN (`192.168.x.y` etc.) | Every device on the LAN segment, plus web pages via the browser | **None** |
| Tailnet (`100.64.0.0/10`, MagicDNS name) | Devices the tailnet policy allows; by default all of them [S14][S15] | WireGuard, end to end [S3] |
| Public (Funnel) | Anyone on the internet [S5] | TLS terminated by `tailscaled` on the Hub machine [S5] |

Attackers worth modelling (analysis):

- **A web page open in the Human's browser.** It can CSRF the Command Center and use DNS rebinding to
  bypass the same-origin policy [S40][S57]. MCP lists DNS rebinding of local servers as a known
  attack [S42].
- **Another device on the LAN or tailnet.** It can call Hub endpoints directly. It can also spoof
  `Tailscale-User-*` headers if the Hub listens on a non-loopback interface while trusting them [S1].
- **A leaked Agent token.** Agent transcripts, logs and cloud VMs are leak-prone; MCP's guidance is to
  scope and isolate per-server credentials [S41].
- **Another local process.** It can reach any loopback port [S41]. Tokens in 0600 files only stop
  other OS users.

---

## 1. TLS options

### 1.1 Tailscale Serve (tailnet only)

- **What it does.** `tailscale serve 3000` proxies `https://<machine>.<tailnet>.ts.net` to
  `http://127.0.0.1:3000`. Serve requires HTTPS to be enabled for the tailnet, and the CLI offers to
  enable it [S1]. "Only `http://127.0.0.1` is supported for proxies" [S2]. `--bg` runs it in the
  background. `--https=<port>` and `--http=<port>` pick the listen port, and `--set-path` mounts under
  a path [S2]. The `https+insecure://` target lets Serve front a backend with a self-signed cert [S2].
- **Headers it adds** (source, pinned commit) [S16]:
  - `Host` passes through unchanged.
  - `X-Forwarded-Host`, `X-Forwarded-Proto: https`, and `X-Forwarded-For: <tailnet source IP>`.
  - For tailnet *user* devices: `Tailscale-User-Login`, `Tailscale-User-Name`,
    `Tailscale-User-Profile-Pic`, `Tailscale-Headers-Info`.
  - For Funnel traffic: `Tailscale-Funnel-Request: ?1` and no identity headers.
  - For tagged nodes: no identity headers.
  - Inbound copies of these headers, including case variants, are deleted first [S16][S1].
- **App capabilities.** Since v1.92, `--accept-app-caps` forwards selected grant capabilities in a
  `Tailscale-App-Capabilities` JSON header. Unlike identity headers, this also works for **tagged**
  nodes [S1][S13].
- **Trust requirement.** Tailscale's own advice: when the backend trusts identity or capability
  headers, it should listen only on localhost. Otherwise any tailnet or LAN peer can send forged
  headers directly [S1].
- **Cert lifecycle.** Serve-managed certs renew automatically. Only file-based `tailscale cert`
  output is the user's job to renew [S3].
- **Limits.** DNS names are restricted to `*.ts.net` [S1]. The same port cannot be Serve-private and
  Funnel-public at once; the most recent command wins [S1]. On macOS, serving files or directories
  needs the open-source client variant, but port forwarding does not [S1].
- **Public ledger.** Enabling HTTPS publishes machine names to Certificate Transparency logs. Tailscale
  warns not to enable it if machine names are sensitive [S3].

Implication (analysis): behind Serve, the Hub sees every tailnet request as coming from loopback. So
"from 127.0.0.1" cannot mean "the Human at the keyboard". The Hub has two ways to tell traffic apart:

- the presence of `X-Forwarded-For` or `Tailscale-*` headers, which is trustworthy only if the Hub
  binds loopback only;
- the `Host` header (`*.ts.net` vs `localhost`).

### 1.2 `tailscale cert` + TLS in `Bun.serve` (tailnet name, Hub terminates TLS)

- `tailscale cert --cert-file --key-file <name>.ts.net` writes a Let's Encrypt cert, obtained through a
  DNS-01 challenge that Tailscale fulfils [S4][S3]. The private key and ACME account key are
  generated locally and never seen by Tailscale [S3].
- The user must renew file-based certs [S3][S4]. `--min-validity=<duration>` makes the command return
  a cert with at least that much validity left [S4]. Requesting too often can hit Let's Encrypt rate
  limits, with up to a 34-hour wait [S3].
- Lifetimes: currently 90 days [S3]; **64 days from 2027-02-10, 45 days in 2028**. Let's Encrypt
  advises renewing at about ⅔ of the lifetime [S20][S21].
- Serving it: `Bun.serve({ tls: { cert, key } })` takes PEM *contents* (string, `BunFile`, Buffer),
  not paths [S30]. `server.reload()` can update only `fetch`, `error`, `routes` and `websocket` [S31],
  so swapping certs means a restart or a new `Bun.serve` (analysis).
- Disabling HTTPS for the tailnet does not revoke issued certs, and a single machine's cert cannot be
  invalidated [S3].

When this fits (analysis): the Hub needs to listen on the tailnet IP directly, for example to see the
real peer IP via `server.requestIP()` [S31] and call `tailscale whois` [S4], rather than sitting
behind Serve.

### 1.3 mkcert (private CA, LAN or tailnet IPs)

- mkcert creates a local CA, installs it into the system, Firefox and Java trust stores
  (`mkcert -install`), and issues certs for any names or IPs [S22].
- Every other device must trust the CA: iOS needs a profile install plus "full trust", and Android
  needs user-root opt-in [S22]. Node ignores the system store and needs `NODE_EXTRA_CA_CERTS` [S22].
- Bun reads `NODE_EXTRA_CA_CERTS` [S35] and `SSL_CERT_FILE`/`SSL_CERT_DIR` [S34], and can trust the
  system store with `NODE_USE_SYSTEM_CA=1` or `--use-system-ca` [S34]. A Bun-based `hermes` CLI could
  therefore trust an mkcert CA without code changes (analysis).
- Risk: `rootCA-key.pem` "gives complete power to intercept secure requests from your machine". mkcert
  "is meant for development purposes, not production" [S22].
- Maintenance: the latest release is v1.4.4 (2022-04-26) and the repo's last push was 2024-08-13 [S22]
  (GitHub API, retrieved for this note).
- Lifetimes: leaf certs are issued for 2 years 3 months ("825 days, the limit that macOS/iOS apply to
  all certificates"), and the CA for 10 years [S24].

### 1.4 Self-signed + pinning

- The Hub generates its own cert. Clients pin either the cert or its public key, so no CA is involved
  (analysis).
- curl: `--pinnedpubkey sha256//<base64>` aborts on mismatch, even together with `--insecure` [S23].
  **[OBSERVED]** with a matching pin the request succeeded; a wrong pin gave exit code 90.
- Bun `fetch`:
  - `tls.ca` replaces the trusted roots [S33].
  - `checkServerIdentity` runs *after the chain verifies*. With `rejectUnauthorized: false` Bun still
    calls it **but ignores what it returns** [S33].
  - **[OBSERVED]** (self-signed P-256 cert with SAN `127.0.0.1`):
    - no `ca` → `DEPTH_ZERO_SELF_SIGNED_CERT`;
    - `tls: { ca: selfSignedPem }` → success;
    - `rejectUnauthorized: false` + a `checkServerIdentity` that returns an Error → **success** (the
      pin was ignored).
  - So the sound pin in Bun is "the self-signed cert is the only `ca`".
  - **[OBSERVED]** Bun 1.3.14 reused a pooled connection and skipped a later request's
    `checkServerIdentity`; Bun 1.4.4 rejected it. Current docs say each request with its own
    `checkServerIdentity` opens its own connection, and offer `Bun.FetchSession` for per-connection
    verification [S33].
- Browsers: a self-signed cert gives a full-page warning. No browser primary source documents
  pinning for user-added exceptions [UNVERIFIED]. The Human would click through once per browser and
  device (analysis).

### 1.5 Plain HTTP inside the tailnet (and on the LAN)

- **Tailnet:** "Connections between Tailscale nodes are secured with end-to-end encryption", but
  "browsers, web APIs, and products like Visual Studio Code are not aware of that" and "can warn users
  or disable features" [S3]. MagicDNS also gives `http://<machine>` without TLS [S3].
- **LAN:** plain HTTP has no encryption, so bearer tokens and session cookies cross the network in
  clear text (analysis).
- **What a non-trustworthy origin loses** (`http://` to a non-loopback IP or name) [S53]:
  - **`Secure` cookies:** "Insecure sites (`http:`) cannot set cookies with the `Secure` attribute";
    the exception is localhost [S52]. `__Host-`/`__Secure-` prefixes require `Secure` from HTTPS
    [S52].
  - **Fetch Metadata:** browsers send these headers only to potentially trustworthy URLs, so a
    Fetch-Metadata CSRF policy silently does nothing [S50].
  - **WebAuthn/passkeys:** need an `https` origin or `http://localhost`, and an RP ID that is a valid
    *domain*; IP-literal origins fail [S54].
  - **Notifications API and service workers:** secure-context only (prior note).
  - **Chrome LNA prompt:** the ability to request it is restricted to secure contexts [S55]. This
    matters only for cross-site callers.

---

## 2. Agent auth

### 2.1 Shared bearer token vs per-Agent tokens

| Aspect | One shared token (prior-note baseline) | Per-Agent (or per-host / per-sandbox) tokens |
| - | - | - |
| Issuance | Hub generates once and writes `~/.hermes/hub.json` 0600 (prior note) | Hub mints on demand. Analysis: a "pair" flow where `hermes login <hub-url>` shows a short code and the Human approves it in the Command Center (pattern used by device-code style logins; no single primary standard is cited here) |
| Revocation | Rotate the one secret and re-distribute it to every Agent | Delete one row; only that Agent is affected |
| Rotation | All-or-nothing | Per token; overlap by allowing two valid tokens briefly (analysis) |
| Attribution | Agent identity is self-declared in the Round | Hub knows which token sent a Round; MCP says possession of a state handle MUST NOT count as authentication, and handles SHOULD be bound to the authenticated principal [S42] |
| Blast radius | Every machine and sandbox holding it can impersonate all Agents and read all Rounds | Limited to that token's scope (analysis) |
| MCP guidance | n/a | "Issue each server its own token with the smallest scope that works … so a leak is contained and revocable" [S41] |

Token mechanics with primary sources:

- **Entropy and storage.** At least 128 bits from a CSPRNG (prefer 160+). If disclosure of the store
  is in scope, store a one-way verifier (hash), not the token [S51].
- **Format.** An identifiable prefix plus a checksum (GitHub `ghp_…` + CRC32) makes tokens greppable
  and cheap to validate offline, and lets secret scanners find leaks [S60].
- **Transport.** Send tokens in `Authorization: Bearer`. "Bearer tokens SHOULD NOT be passed in page
  URLs" [S59]. MCP clients can attach static headers: Claude Code via `--header "Authorization:
  Bearer …"` [S44], Codex via `bearer_token_env_var` / `env_http_headers` [S45]. MCP's OAuth
  authorization is OPTIONAL. stdio implementations SHOULD take credentials from the environment
  instead [S43].
- **Comparison.** `crypto.timingSafeEqual` (Node API) is the usual primitive. **[OBSERVED]** In Bun
  1.3.14 it returns `true` for equal buffers and throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` when the
  lengths differ. Comparing hashes of high-entropy tokens through an indexed lookup sidesteps the
  timing question (analysis).

### 2.2 Where the CLI keeps tokens

| Store | Notes |
| - | - |
| `~/.hermes/hub.json` mode 0600 | Prior-note baseline. Readable by any process running as the same user [S41] |
| OS keychain via `Bun.secrets` | Uses macOS Keychain Services, Linux libsecret (needs a running Secret Service daemon) and Windows Credential Manager. Marked "new and experimental". Keychain may prompt on first use [S36]. Unusable in headless Linux sandboxes without a keyring daemon (analysis from [S36] requirements) |
| Keychain with file fallback | `gh` stores tokens "in the system credential store" and "if a credential store is not found … gh will fallback to writing the token to a plain text file" [S61] |
| Env var (`HERMES_TOKEN`) | Simplest for sandboxes. MCP warns against exporting secrets globally in shell profiles; pass them per server instead [S41] |
| Cloud egress-proxy secret | Claude Code "network secrets": the agent proxy adds the header for listed hosts "so the key itself stays outside the VM". Needs an Anthropic-hosted environment and an API reachable from the internet [S70]. Codex "network secrets": programs see a placeholder and the proxy substitutes the value for allowed domains, HTTPS on port 443 only [S71] |

### 2.3 Tailscale identity as Agent auth (alternative or extra factor)

- `tailscale whois ip[:port]` returns the machine, plus the user for user devices, plus capabilities;
  tagged devices have no user [S4]. Capabilities can be read via `whois`, LocalAPI, Serve's
  app-capabilities header, or `tsnet` [S13].
- Tags replace user identity on a device and are meant for service roles. Key expiry is disabled by
  default for tagged devices [S11][S6].
- Analysis: a grant such as `{"src":["tag:hermes-agent"],"dst":["tag:hermes-hub"],"ip":["tcp:443"],
  "app":{"<domain>/cap/hermes":[{"role":"agent"}]}}` would let the Hub authorise tailnet Agents
  without a bearer token, via `Tailscale-App-Capabilities` [S1][S12][S13]. This does not cover LAN or
  Funnel Agents, so a bearer token is still needed on those paths.

---

## 3. Human browser auth (Command Center)

### 3.1 Loopback trust vs explicit login

- MCP: "Binding to 127.0.0.1 is not an authentication boundary … such components need real
  authentication and origin validation" [S41].
- Under Tailscale Serve, *all* tailnet traffic arrives from `127.0.0.1` (§1.1), so loopback trust
  would admit every tailnet peer the policy allows (analysis).
- Candidate Human authenticators (sourced facts; choice deferred):

| Option | Facts |
| - | - |
| Tailscale identity headers | `Tailscale-User-Login` is set by Serve for user devices and stripped from inbound requests. Not set for tagged nodes or Funnel. Trustworthy only if the Hub listens on localhost [S1][S16]. Also set for users the device is *shared* with [S1], so the Hub must compare against the Human's login |
| One-time token link → session cookie | Jupyter precedent: a random token in the URL or `Authorization: token` header (prior note). RFC 6750 discourages tokens in URLs [S59], so exchange it immediately for a cookie and regenerate the session ID on login [S51] |
| Passkey (WebAuthn) | Needs `https` or `http://localhost`, and an RP ID that is a valid domain [S54]. Works on `*.ts.net` via Serve or `tailscale cert`; not on raw LAN or tailnet IPs |
| Password | Not researched further; adds a credential store to a single-user tool (analysis) |

### 3.2 Session cookies

- OWASP's recommended shape is `Set-Cookie: __Host-SessionID=<v>; Secure; HttpOnly; SameSite=Strict;
  Path=/`, with session IDs of at least 64 bits of entropy (128 bits if self-generated) [S51].
- Do not put session tokens in `localStorage` or `sessionStorage` [S51]. Pick idle and absolute
  timeouts to match risk [S51].
- `__Host-` requires `Secure`, no `Domain` and `Path=/`, set from HTTPS [S52]. Browsers relax `Secure`
  for localhost [S52]. Whether `__Host-` is accepted on `http://localhost` was not verified
  [UNVERIFIED].
- SameSite is scoped to the *registrable domain* [S50]. `ts.net` is on the Public Suffix List
  (submitted by Tailscale) [S62], so each tailnet's `tailXXXX.ts.net` is its own registrable domain.
  Two *different* tailnets are therefore cross-site. Every machine *within* the Human's tailnet is
  same-site with the Hub (analysis). OWASP warns that SameSite alone fails when the registrable domain
  is shared with hosts you do not fully control [S50].

### 3.3 CSRF

OWASP CSRF cheat sheet [S50]:

- **Fetch Metadata.** Reject non-safe methods when `Sec-Fetch-Site: cross-site`. A fallback to
  `Origin`/`Referer` verification "is a mandatory requirement". The headers are sent only to
  potentially trustworthy URLs (HTTPS or localhost).
- **Origin verification.**
  - Match the full origin, so that `example.org.attacker.com` fails.
  - Never allowlist `Origin: null`.
  - Behind a proxy, configure the target origin in the app, or trust `X-Forwarded-Host` only from a
    known proxy that overwrites it.
- **Custom request header and JSON-only APIs.** Requests with custom headers are preflighted. Reject
  simple content types (`text/plain`, form encodings).
- **Safe methods.** Never change state on GET.
- **XSS** defeats every CSRF defence. MCP likewise recommends CSP `script-src 'self'` for web-based
  clients and `frame-ancestors` / `X-Frame-Options: DENY` against clickjacking on consent pages [S42].

### 3.4 DNS rebinding and Host checks

- MCP Streamable HTTP: servers **MUST** validate `Origin` on all incoming connections, return 403 if
  present and invalid, SHOULD bind localhost when local, and SHOULD authenticate [S40].
- Jupyter rejects requests whose `Host` header is not local with 403, unless `allow_remote_access` is
  set. Its docstring explains this "protects against 'DNS rebinding' attacks" [S57].
- Vite's `server.allowedHosts`: setting it to `true` "allows any website to send requests to your dev
  server through DNS rebinding attacks" (GHSA-vg6x-rcgg-rjx6). Only add hosts whose DNS you control
  [S58].
- Analysis: a Hub reachable on several names (`localhost`, `127.0.0.1`, `<machine>.<tailnet>.ts.net`,
  a LAN IP) needs an explicit allowlist of exactly those `Host` values. Combined with an `Origin`
  allowlist of the same set, this closes rebinding even before auth runs. Note that `*.ts.net` names
  are publicly resolvable to tailnet IPs only through MagicDNS; that was not verified for public DNS
  [UNVERIFIED].
- Browser-side: Chrome's Local Network Access (shipping in Chrome 142) prompts before a *public*
  site can send requests to local or loopback addresses [S55]. The LNA spec classes `100.64.0.0/10`
  as `local` [S56], which covers Tailscale IPs [S15]. At launch, WebSockets, WebTransport and WebRTC
  were not yet gated [S55].

### 3.5 Streaming to the browser

- Analysis: browser `EventSource` cannot set an `Authorization` header, so Command Center SSE would
  ride on the session cookie, while Agents use `fetch` with a bearer header.
- Bun closes idle connections after 10 s by default; disable this per request with
  `server.timeout(req, 0)` for long-lived streams [S31].

---

## 4. Reaching the Hub from cloud sandboxes

### 4.1 Join the tailnet as an ephemeral, tagged node

- **Auth keys** can be one-off or reusable, expire after 1–90 days, and can be *ephemeral*,
  *pre-approved* and *tagged*. Revoking a key does not de-authorise nodes already joined with it; to
  do that, delete the device [S6].
- **Ephemeral nodes** are removed 30–60 minutes after their last activity, or immediately on
  `tailscale logout`. `tailscaled --state=mem:` registers an ephemeral node and logs it out on exit
  [S7].
- **Userspace networking.** Where `/dev/net/tun` is unavailable, `tailscaled
  --tun=userspace-networking` runs a SOCKS5 and/or HTTP proxy, and apps use
  `ALL_PROXY`/`HTTP_PROXY` [S8]. Bun `fetch` has a `proxy` option [S33].
- **Minting keys without long-lived secrets.**
  - An OAuth client with `auth_keys` scope can mint tagged keys via the API. Its secret can also be
    passed straight to `tailscale up --auth-key='<secret>?ephemeral=true'
    --advertise-tags=tag:…` [S9].
  - Workload identity federation lets GitHub Actions, AWS, GCP and Azure workloads use their OIDC
    token: `tailscale up --client-id … --id-token …` (v1.90.1+), or `tailscale/github-action@v4`
    with `id-token: write` [S10].
- **Codex cloud** has a Tailscale VPN setting per environment. It says to "enable both **Reusable**
  and **Ephemeral**" on the auth key. Tailscale traffic is independent of the public-internet
  allowlist. Non-HTTP TCP goes via `proxy:8088` CONNECT. Detaching the VPN from a draft "doesn't
  revoke existing connections" [S71].
- **Claude Code on the web.** Anthropic-hosted environments egress through an HTTP/HTTPS security
  proxy with None/Limited/Full access levels and a domain allowlist [S70]. The cloud-environments doc
  does not mention Tailscale or VPNs. Whether `tailscaled` in userspace mode could reach Tailscale's
  control plane and DERP through that proxy is [UNVERIFIED].
- **Default reachability.** The default policy allows all connections between devices [S14]. Access
  is otherwise deny-by-default [S17]. Grants restrict by `src`/`dst`/`ip` port [S12].
- Ephemeral usage counts against a monthly minutes allowance. A node present for 4 h or more counts
  as a regular tagged device instead [S7].

### 4.2 Tailscale Funnel (public internet)

- Funnel requires MagicDNS, HTTPS, and a `funnel` node attribute (the CLI adds `autogroup:member` by
  default). It listens only on 443, 8443 or 10000, TLS only, with non-configurable bandwidth limits
  [S5].
- Funnel relays do not decrypt; `tailscaled` on the device terminates TLS [S5]. Public DNS can take
  up to 10 minutes to propagate [S5].
- Funnel requests carry no identity headers and get `Tailscale-Funnel-Request: ?1` [S1][S16]. The Hub
  therefore relies entirely on its own auth for Funnel traffic.
- The macOS client-variant requirements in the Funnel doc are internally inconsistent: one bullet
  requires the open-source variant, while a later warning says port sharing works with the App Store
  or Standalone variant [S5].
- Pairing with cloud egress secrets: a Funnel URL is an internet-reachable HTTPS host on port 443, the
  condition both Claude Code network secrets [S70] and Codex network secrets [S71] need. The Agent's
  bearer token could therefore live in the platform's proxy rather than in the VM (analysis).

### 4.3 Comparison (analysis over the facts above)

- **Tailnet join.** The Hub stays private. It needs an auth-key, OAuth or OIDC setup and a policy
  edit. It works where the platform supports Tailscale (Codex cloud documented, GitHub Actions
  documented).
- **Funnel.** Zero sandbox-side setup. It works on any platform that allows the domain. The Hub's
  Command Center and API are then on the public internet, gated only by app auth. One mitigation is
  to mount only the Agent API path on the Funnel port: Serve and Funnel mount points accept
  `--set-path` [S2].

---

## 5. Bun specifics

| Topic | Facts |
| - | - |
| TLS | `tls: { key, cert, passphrase?, ca?, requestCert?, crl?, dhParamsFile? }` takes contents, not paths. An array of `tls` objects with `serverName` gives SNI; `*` matches one label [S30]. mTLS: `requestCert: true` plus `ca` [S30] |
| Protocols | HTTP/2 (`http2: true`) and HTTP/3 (`http3: true`, needs TLS) are experimental. `server.upgrade()` (WebSockets) is HTTP/1.1 only [S31] |
| Bind address | `hostname` defaults to `"0.0.0.0"`, all interfaces [S31][S32]. `reusePort` and `ipv6Only` options exist [S32]. `unix:` socket path is supported [S31] |
| Multiple interfaces | One `hostname` per `Bun.serve`. **[OBSERVED]** two servers on the same port, bound to `127.0.0.1` and the LAN IP, both served correctly |
| `localhost` | **[OBSERVED]** `hostname: "localhost"` bound only `::1` on macOS (Bun 1.3.14 and 1.4.4); `127.0.0.1` gave connection refused. Tailscale Serve proxies to `http://127.0.0.1` [S2], so bind `127.0.0.1` explicitly when fronted by Serve |
| Dual-stack | **[OBSERVED]** `hostname: "::"` accepted an IPv4 client, reported as `::ffff:127.0.0.1` |
| Peer address | `server.requestIP(req)` gives the address, or `null` for unix sockets [S31]. Behind Serve this is loopback; the tailnet peer is in `X-Forwarded-For` [S16] |
| Cert rotation | `server.reload()` updates only `fetch`/`error`/`routes`/`websocket` [S31]. `server.stop()` drains in-flight requests [S31] |
| Idle timeout | 10 s default, max 255, `0` disables; use `server.timeout(req, 0)` for SSE [S31] |
| Client TLS (CLI) | `fetch` `tls.ca`, `checkServerIdentity` (ignored with `rejectUnauthorized:false`), and `Bun.FetchSession` for per-connection verification [S33]. Env vars: `NODE_EXTRA_CA_CERTS` [S35], `SSL_CERT_FILE`/`SSL_CERT_DIR`, `NODE_USE_SYSTEM_CA` [S34] |
| Secrets | `Bun.secrets.get/set/delete({ service, name })` on the OS store; experimental [S36] |
| Versions | Latest release at time of writing: Bun v1.4.4 (2026-10-22), per the GitHub releases API. Local experiments also ran on 1.3.14 |

---

## 6. Options comparison

Each cell is a sourced fact or an analysis drawn from the sections above. "Browser secure context"
means the Human's Command Center gets `Secure` cookies, Fetch Metadata, WebAuthn and Notifications.

### 6.1 TLS / exposure

| Option | Reach | Browser secure context | Cert trust on other devices | Renewal burden | Human identity for free | Main risks |
| - | - | - | - | - | - | - |
| **Loopback only (`http://127.0.0.1`)** | Local processes only | Yes (loopback is trustworthy) [S53] | n/a | none | No | Not an auth boundary [S41]; no remote Agents |
| **Plain HTTP on tailnet IP/MagicDNS** | Tailnet peers per policy | **No** [S53] | n/a | none | No (Hub must call `whois`) [S4] | Loses cookie/CSRF/WebAuthn features; default policy lets all peers in [S14] |
| **Plain HTTP on LAN** | Whole LAN | **No** | n/a | none | No | Tokens and cookies in clear text on the LAN (analysis) |
| **Tailscale Serve → 127.0.0.1** | Tailnet peers per policy | Yes (`https://*.ts.net`) | Public CA, nothing to install [S3] | none, auto [S3] | **Yes**, `Tailscale-User-Login` for user devices [S1] | CT-log name disclosure [S3]; all traffic appears as loopback; not for LAN-only devices |
| **`tailscale cert` + `Bun.serve` TLS** | Tailnet (and LAN, if the LAN resolves the name; analysis) | Yes | Public CA | **Manual**, 90→64→45 days [S3][S20][S21]; restart per rotation [S31] | No (Hub can use `whois`) [S4] | Renewal failures; rate limits [S3] |
| **mkcert CA** | LAN + tailnet, any name or IP | Yes, where the CA is installed | Install the CA on every device; CLI via `NODE_EXTRA_CA_CERTS` [S22][S35] | Leaf certs last 2 y 3 m; CA 10 y [S24] | No | Root key can intercept all TLS on the machine [S22]; dev-only tool, last release 2022 [S22] |
| **Self-signed + pinning** | LAN + tailnet | Only after the Human clicks through a warning | CLI pins via `tls.ca` / `--pinnedpubkey` [S33][S23] | Hub-chosen | No | Browser warning fatigue; Bun pin pitfalls (§1.4) **[OBSERVED]** |
| **Tailscale Funnel** | Public internet (443/8443/10000) [S5] | Yes | Public CA | none | **No**, only a Funnel marker [S16] | Hub on the public internet; bandwidth limits [S5] |

### 6.2 Agent auth

| Option | Issue | Revoke | Rotate | Works over | Storage on Agent side |
| - | - | - | - | - | - |
| **Shared bearer token** | Hub writes `hub.json` | Rotate for everyone | All at once | Any path | File 0600 / env / cloud network secret [S70][S71] |
| **Per-Agent bearer tokens** (prefixed, hashed at rest) [S51][S60] | Pairing approved in Command Center (analysis) | Per token | Per token | Any path | Same options + `Bun.secrets` [S36] |
| **Tailscale identity (`whois` / app-caps header)** | Tailnet policy grants and tags [S12][S13] | Remove the device or the grant [S6] | Tailscale node keys (180-day default; tagged: no expiry) [S6][S11] | Tailnet only | `tailscaled` state; ephemeral `mem:` [S7] |
| **mTLS client certs** | Hub CA issues certs; `requestCert` + `ca` [S30] | `crl` [S30] | Re-issue | Any path where the Hub terminates TLS (not behind Serve, which terminates TLS itself; analysis) | Key file per Agent |

### 6.3 Human browser auth

| Option | Needs HTTPS / secure context | Works on LAN IP | Works via Serve | Works via Funnel | Notes |
| - | - | - | - | - | - |
| **Loopback trust** | No | No | **Unsafe**: all traffic is loopback | Unsafe | MCP: not an auth boundary [S41] |
| **Tailscale identity headers** | Served over HTTPS by Serve | No | Yes | **No** headers [S16] | Hub must bind localhost only [S1] |
| **One-time link → `__Host-` session cookie** | Yes for `__Host-`/`Secure` [S52] | Only with TLS (mkcert/self-signed) | Yes | Yes | Regenerate the session on login; no tokens in URLs long-term [S51][S59] |
| **Passkey (WebAuthn)** | Yes, or `http://localhost` [S54] | **No** (IP is not a valid RP ID) [S54] | Yes (`*.ts.net`) | Yes (`*.ts.net`) | Strongest phishing resistance; most UI work (analysis) |
| **Required on every path** | — | — | — | — | `Host` allowlist [S57][S58] + `Origin`/Fetch Metadata CSRF checks [S40][S50] + CSP [S42] |

---

## Sources

Tailscale
- [S1] Tailscale Serve (identity headers, app capabilities, limitations): https://tailscale.com/docs/features/tailscale-serve
- [S2] `tailscale serve` CLI reference: https://tailscale.com/docs/reference/tailscale-cli/serve
- [S3] Enabling HTTPS (CT ledger, `tailscale cert`, renewal, rate limits): https://tailscale.com/docs/how-to/set-up-https-certificates
- [S4] Tailscale CLI reference (`cert`, `whois`): https://tailscale.com/docs/reference/tailscale-cli
- [S5] Tailscale Funnel: https://tailscale.com/docs/features/tailscale-funnel
- [S6] Auth keys: https://tailscale.com/docs/features/access-control/auth-keys
- [S7] Ephemeral nodes: https://tailscale.com/docs/features/ephemeral-nodes
- [S8] Userspace networking mode: https://tailscale.com/docs/concepts/userspace-networking
- [S9] OAuth clients (`auth_keys` scope, OAuth secret as auth key): https://tailscale.com/docs/features/oauth-clients
- [S10] Workload identity federation: https://tailscale.com/docs/features/workload-identity-federation
- [S11] Tags: https://tailscale.com/docs/features/tags
- [S12] Grants: https://tailscale.com/docs/features/access-control/grants
- [S13] Grants app capabilities: https://tailscale.com/docs/features/access-control/grants/grants-app-capabilities
- [S14] Connect to devices (default policy allows all): https://tailscale.com/docs/how-to/connect-to-devices
- [S15] Tailscale IP addresses (100.64.0.0/10): https://tailscale.com/docs/concepts/tailscale-ip-addresses
- [S16] Tailscale source, `ipn/ipnlocal/serve.go` (forwarded and identity headers), commit c4d689ce: https://github.com/tailscale/tailscale/blob/c4d689ce42ac11ca70a546c6ed8958e88d05a573/ipn/ipnlocal/serve.go#L1149-L1190
- [S17] Tailscale access control overview (deny by default): https://tailscale.com/docs/features/access-control

Certificates
- [S20] Let's Encrypt, 64-day certificate lifetimes coming Feb 2027: https://letsencrypt.org/2026/10/07/64-day-certs
- [S21] Let's Encrypt, decreasing certificate lifetimes to 45 days: https://letsencrypt.org/2025/12/02/from-90-to-45
- [S22] mkcert README (and releases): https://github.com/FiloSottile/mkcert ; https://github.com/FiloSottile/mkcert/releases/tag/v1.4.4
- [S23] curl manpage, `--pinnedpubkey`: https://curl.se/docs/manpage.html#--pinnedpubkey
- [S24] mkcert source `cert.go` (leaf and CA validity), commit 1c1dc4e: https://github.com/FiloSottile/mkcert/blob/1c1dc4ed27ed5936046b6398d39cab4d657a2d8e/cert.go#L60-L62

Bun
- [S30] Bun TLS: https://bun.com/docs/runtime/http/tls
- [S31] Bun server (`hostname`, `reload`, `requestIP`, `idleTimeout`, unix sockets): https://bun.com/docs/runtime/http/server
- [S32] bun-types `serve.d.ts` (`hostname` default, `reusePort`, `ipv6Only`), commit 8206e7e: https://github.com/oven-sh/bun/blob/8206e7e27918ba10b8819ea3c13ecea32606abb6/packages/bun-types/serve.d.ts#L885-L926
- [S33] Bun fetch (TLS options, `checkServerIdentity`, `FetchSession`, proxy): https://bun.com/docs/runtime/networking/fetch
- [S34] Bun environment variables (`SSL_CERT_FILE`, `NODE_USE_SYSTEM_CA`): https://bun.com/docs/runtime/environment-variables
- [S35] Bun source, `NODE_EXTRA_CA_CERTS` handling, commit 8206e7e: https://github.com/oven-sh/bun/blob/8206e7e27918ba10b8819ea3c13ecea32606abb6/src/runtime/socket/cert_files.rs
- [S36] Bun Secrets API: https://bun.com/docs/runtime/secrets

MCP and agent clients
- [S40] MCP Streamable HTTP 2026-07-28, Security & Endpoint: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- [S41] MCP Local Server Security: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/local-server-security
- [S42] MCP Security Best Practices: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices
- [S43] MCP Authorization 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- [S44] Claude Code MCP (`--header`): https://code.claude.com/docs/en/mcp
- [S45] Codex MCP config (`bearer_token_env_var`, `env_http_headers`): https://learn.chatgpt.com/docs/extend/mcp

Web security
- [S50] OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- [S51] OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- [S52] MDN `Set-Cookie` (Secure, cookie prefixes, localhost exception): https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
- [S53] W3C Secure Contexts, "Is origin potentially trustworthy?": https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy
- [S54] W3C WebAuthn Level 3 (RP ID, origin requirements): https://www.w3.org/TR/webauthn-3/#rp-id
- [S55] Chrome, Local Network Access permission prompt: https://developer.chrome.com/blog/local-network-access
- [S56] WICG Local Network Access spec, non-public IP address blocks: https://wicg.github.io/local-network-access/#non-public-ip-address-blocks
- [S57] Jupyter Server `allow_remote_access` (Host check vs DNS rebinding), commit c4c5a51: https://github.com/jupyter-server/jupyter_server/blob/c4c5a51d2cf77d31a266376582ee05c4d661ad4b/jupyter_server/serverapp.py#L1352-L1367
- [S58] Vite `server.allowedHosts`: https://vite.dev/config/server-options#server-allowedhosts (source: https://github.com/vitejs/vite/blob/ef295d54d56478437112acd7deeb9821d755b90f/docs/config/server-options.md)
- [S59] RFC 6750 §5.3 (don't pass bearer tokens in page URLs): https://www.rfc-editor.org/rfc/rfc6750#section-5.3
- [S60] GitHub, "Behind GitHub's new authentication token formats": https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/
- [S61] GitHub CLI `gh auth login` (credential store, plaintext fallback): https://cli.github.com/manual/gh_auth_login
- [S62] Public Suffix List (`ts.net` entry, submitted by Tailscale): https://publicsuffix.org/list/public_suffix_list.dat

Cloud sandboxes
- [S70] Claude Code cloud environments (network access levels, network secrets, security proxy): https://code.claude.com/docs/en/cloud-environments
- [S71] Codex cloud environments (network secrets, Tailscale VPN): https://learn.chatgpt.com/docs/environments/cloud-environments
