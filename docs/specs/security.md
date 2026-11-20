# Security and exposure (v1)

Status: **confirmed by the Human on 2026-11-20**, ticket [How is the Hub secured on LAN and tailnet?](https://github.com/jazhou-adobe/hermes-hub/issues/9). It builds on the [transports](transports.md) spec. Terms follow `GLOSSARY.md`.

**Phase 1 is local only, without authentication.** This reverses the charting baseline ("LAN/tailnet with auth from day one"). Remote machines, cloud sandboxes, the tailnet, the LAN and the phone surface are out of scope.

## Exposure

- The Hub binds **`127.0.0.1` only**, on one port (a Hub setting; discovery belongs to the Agent identity ticket).
- There is no bind-address setting, no TLS, no Tailscale Serve or Funnel, and no LAN mode.
- The Command Center is served from the same origin at `http://127.0.0.1:<port>/`. Loopback counts as a secure context, so browser notifications work.

## Agents: session tokens are identity, not authentication

- An Agent session asks for its own **session token**: `POST /v1/sessions`, with the detected identity in the body (contents per the Agent identity ticket), returns `{session_id, token}`.
- The token is random (≥ 128 bits, prefix `hhs_`). The CLI and the MCP shim cache it per session (identity ticket) and send it on every call as the header **`Hermes-Session: hhs_…`**.
- **What it is for:** telling sessions apart in the Command Center, and scoping a session to its own Rounds. Get, wait, cancel and supersede only work on the session's own Rounds; inbox, events, liveness and the flood cap are per session.
- **What it is not:** a password. Any program on the Mac can request a token. It is not a security boundary.
- **Errors:** a missing or unknown token on an endpoint that needs a session returns `unknown_session` (401). This replaces `unauthorized`.
- **Settings:** the Command Center lists sessions (Agents) and lets the Human forget one. There is no token management screen.

## The Human

- **No sign-in.** Whoever can open `http://127.0.0.1:<port>/` on the Mac is the Human.

## Browser guard (always on, invisible)

Any web page open in the Human's browser can send requests to `localhost`, through CSRF or DNS rebinding. The Hub refuses them:

1. **Host allowlist.** The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`; otherwise the request gets `forbidden` (403). This stops DNS rebinding.
2. **Origin check.**
   - A request that carries an `Origin` header must come from the Hub's own origin.
   - A request with `Sec-Fetch-Site: cross-site` is refused.
   - Requests without an `Origin` (the CLI, the shim, `curl`) pass.
   - This covers every door: `/v1/*`, `/mcp` (the MCP spec requires Origin validation), the Command Center's endpoints, and the SSE streams.
3. **No CORS.** The Hub never sends `Access-Control-Allow-*` headers.
4. **State changes take JSON.** Every state-changing endpoint requires `Content-Type: application/json`, which a cross-site HTML form cannot send without a preflight.
5. **Command Center headers:** `Content-Security-Policy: default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'` (image Attachments arrive as base64), plus `X-Content-Type-Options: nosniff`.

## Known limits (accepted for Phase 1)

- **A local program can act as the Human.** Agents run as the Human's OS user, so any of them could call the Command Center's endpoints and answer its own Round. The Hub Skill never documents those endpoints. Revisit if the Hub ever leaves the Mac.
- **Other local programs** can read and submit Rounds, and request session tokens for any identity.

## Changes to other specs

- **Transports:**
  - `unauthorized` becomes `unknown_session` (401), and `forbidden` (403) means Host or Origin was refused. CLI exit code 5 covers both.
  - The example URL becomes `http://127.0.0.1:<port>/rounds/<id>`.
  - The Hub's `/mcp` stays, for clients that prefer a URL, on loopback only.
- **Lifecycle:** "Agent token" means the session token, so idempotency and supersede are scoped per session.

## Out of scope (Phase 1)

Remote Agents and cloud sandboxes; tailnet, LAN and public exposure; TLS; Agent authentication; Human sign-in (passkey, one-time link); the phone (glance) surface; the design's sign-in page and its Settings → Tokens and Settings → Exposure tabs.
