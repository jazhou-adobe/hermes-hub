# Security and exposure (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [How is the Hub secured on LAN and tailnet?](https://github.com/jazhou-adobe/hermes-hub/issues/9). **Amended by the Human on 2026-11-27:** the Hub listens on the network so an iPad (or any other device) can open the Command Center, behind HTTP Basic auth. It builds on the [transports](transports.md) spec. Terms follow `GLOSSARY.md`.

**This Mac needs no authentication; other devices sign in with one username and password.** The charting baseline ("LAN/tailnet with auth from day one") is back in a minimal form: Basic auth over plain HTTP, no TLS.

## Exposure

- The Hub binds **`0.0.0.0`** by default, on one port. `config.toml` `host = "127.0.0.1"` keeps it on this Mac only. Those are the only two values: local tools always reach the Hub at `127.0.0.1` (`hub.json`). A change needs a restart.
- At start the Hub prints the addresses other devices can use (`other devices: http://192.168.1.20:4747/, …`).
- There is no TLS and no Tailscale Serve or Funnel. On a LAN the password and every Round cross the network in clear text; over Tailscale the tunnel encrypts them.
- The Command Center is served from the same origin at `http://127.0.0.1:<port>/` on this Mac, and at `http://<address>:<port>/` elsewhere. Loopback counts as a secure context, so browser notifications work on this Mac; a remote device over plain HTTP gets no browser notifications.

## Remote access: Basic auth

- **Who needs it.** Every request whose client address is not loopback (`127.x`, `::1`) must carry `Authorization: Basic` for the configured user. Requests from this Mac never do, so the CLI, the MCP shim, Agents and the macOS app work unchanged.
- **Setting the password.** `hermes-hub password [--user <name>]` asks for it twice on a terminal (one line from stdin otherwise), requires at least 12 characters, and writes `remote-auth.json` in the data folder (mode 0600) with the username (default `hermes`) and an argon2id hash. The running Hub picks it up on the next request; no restart. `hermes-hub password --remove` deletes the file. `hermes-hub config` reports whether it is set.
- **No password, no remote access.** While `remote-auth.json` is missing, every remote request gets `forbidden` (403) naming `hermes-hub password`. Binding to the network is therefore safe by default.
- **Wrong or missing credentials** get `auth_required` (401) with `WWW-Authenticate: Basic realm="Hermes Hub"`, so browsers (iPad Safari included) show their sign-in sheet and then send the credentials on every request, streams included. A header that verified once is remembered in memory until the file changes, because argon2 is slow on purpose.
- **No lockout or rate limit.** Each wrong guess costs one argon2 verification.

## Agents: session tokens are identity, not authentication

- An Agent session asks for its own **session token**: `POST /v1/sessions`, with the detected identity in the body (contents per the Agent identity ticket), returns `{session_id, token}`.
- The token is random (≥ 128 bits, prefix `hhs_`). The CLI and the MCP shim cache it per session (identity ticket) and send it on every call as the header **`Hermes-Session: hhs_…`**.
- **What it is for:** telling sessions apart in the Command Center, and scoping a session to its own Rounds. Get, wait, cancel and supersede only work on the session's own Rounds; inbox, events, liveness and the flood cap are per session.
- **What it is not:** a password. Any program on the Mac can request a token. It is not a security boundary.
- **Errors:** a missing or unknown token on an endpoint that needs a session returns `unknown_session` (401). This replaces `unauthorized`.
- **Settings:** the Command Center lists sessions (Agents) and lets the Human forget one. There is no token management screen.

## The Human

- **No sign-in on this Mac.** Whoever can open `http://127.0.0.1:<port>/` on the Mac is the Human.
- **Elsewhere,** whoever knows the remote username and password is the Human.

## Browser guard (always on, invisible)

Any web page open in the Human's browser can send requests to `localhost`, through CSRF or DNS rebinding. The Hub refuses them:

1. **Host allowlist.** The `Host` header must name the Hub's port with `localhost`, an IP literal, or this Mac's own name (with or without `.local`); otherwise the request gets `forbidden` (403). DNS rebinding needs an attacker-controlled name, so this stops it. Other names (a Tailscale MagicDNS name, for example) are refused: use the address.
2. **Origin check.**
   - A request that carries an `Origin` header must come from the same origin it was sent to (`http://<Host>`).
   - A request with `Sec-Fetch-Site: cross-site` is refused.
   - Requests without an `Origin` (the CLI, the shim, `curl`) pass.
   - This covers every door: `/v1/*`, `/mcp` (the MCP spec requires Origin validation), the Command Center's endpoints, and the SSE streams.
3. **No CORS.** The Hub never sends `Access-Control-Allow-*` headers.
4. **State changes take JSON.** Every state-changing endpoint requires `Content-Type: application/json`, which a cross-site HTML form cannot send without a preflight.
5. **Command Center headers:** `Content-Security-Policy: default-src 'self'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'` (image Attachments arrive as base64; Bun's CSS bundler inlines the self-hosted fonts as data: URLs), plus `X-Content-Type-Options: nosniff`.

## Known limits (accepted)

- **A local program can act as the Human.** Agents run as the Human's OS user, so any of them could call the Command Center's endpoints and answer its own Round. The Hub Skill never documents those endpoints.
- **Other local programs** can read and submit Rounds, and request session tokens for any identity.
- **Anyone with the remote password is the Human,** and on a plain LAN anyone who can watch the traffic can read it. Prefer Tailscale, or `host = "127.0.0.1"` on shared networks.
- **Remote Agents** can reach `/v1/*` and `/mcp` with the same Basic auth, but the CLI and the shim don't send it: Agents stay on this Mac.

## Changes to other specs

- **Transports:**
  - `unauthorized` becomes `unknown_session` (401), and `forbidden` (403) means Host or Origin was refused. CLI exit code 5 covers both.
  - The example URL becomes `http://127.0.0.1:<port>/rounds/<id>`.
  - The Hub's `/mcp` stays, for clients that prefer a URL; from another machine it needs Basic auth like every route.
  - `auth_required` (401): a remote request without valid Basic auth. CLI exit code 5.
- **Lifecycle:** "Agent token" means the session token, so idempotency and supersede are scoped per session.

## Out of scope

TLS; Tailscale Serve or Funnel; remote Agents through the CLI or shim; per-device or per-user credentials; Human sign-in pages (passkey, one-time link); the phone (glance) surface; the design's sign-in page and its Settings → Tokens and Settings → Exposure tabs.
