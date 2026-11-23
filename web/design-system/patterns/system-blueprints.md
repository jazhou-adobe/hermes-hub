# System blueprints

Pages and full-region states outside normal work in the Feed: sign-in, not reachable, reconnecting, empty and error. Each uses the same tokens, chrome and Dispatcher voice: status word, cause, next step.

**Hub Phase 1:** the Hub is local only and has no sign-in, so the Sign-in blueprint is a reference for a later exposure mode, not part of the Hub's Command Center. Not reachable, Reconnecting, Offline, Empty and Error apply to the Feed and every page.

## Sign-in

Purpose: the Human proves who they are before the Command Center opens on a non-local address.

Regions: centred `.hh-panel` at `--hh-layout-measure`: Hub name and host in mono, heading "Sign in to Hub · studio-mac", method area, help text.

Methods:

| Method | Flow | Notes |
|---|---|---|
| One-time link | The Hub issues a single-use link on the machine it runs on (the page shows where to find it, in mono with Copy for any command the Hub documents); opening it signs this browser in with a session cookie | The link is single-use and expires; the page says how long it lasts |
| Passkey | "Sign in with passkey" button | Passkeys work only on `https` or `http://localhost` ([W3C WebAuthn](https://www.w3.org/TR/webauthn-3/#rp-id)); on an insecure address the button is replaced by the sentence "Passkeys need HTTPS. Use a one-time link, or open the Hub over HTTPS." |

States: ready, waiting for link ("Waiting · open the one-time link on this device"), link expired ("Link expired · request a new one on the Hub machine"), link already used, passkey cancelled (status, no error tone), passkey failed (alert with the reason and the one-time link as fallback), signed in (redirect to Triage).

Keyboard: focus starts on the heading; the primary method button is the first control.

## Not reachable

Purpose: the browser cannot reach the Hub at all (first load or after a long outage).

Regions: centred panel, status word heading "Not reachable", the URL tried in mono, the last successful contact if known, checks as a list:

- "Is the Hub running on studio-mac? Start it there, then try again."
- "On the tailnet? Check this device is connected."
- "Using a LAN address? The Hub may be bound to localhost only."

Actions: "Try again" (primary), "Open settings on the Hub machine" (link text only).

States: checking ("Checking · attempt 3"), not reachable, reachable (redirects).

## Reconnecting

Region state, not a page: the SSE stream dropped and the Command Center is retrying.

- `.hh-connection` shows "Reconnecting · retry in N s".
- A warning `.hh-alert` sits above the main region: "Reconnecting · the bay may be out of date · retry in 4 s · Reconnect now".
- Strips and the open Round stay usable; Submit is attempted normally and fails into the Answer bar alert if the Hub does not respond.
- On reconnect, the bay refreshes in place; changes are announced once ("Live · 2 new Rounds · 1 expired while offline").

## Offline

Region state after retries give up or the network is gone.

- `.hh-connection` "Offline · last update HH:MM".
- A destructive `.hh-alert` with `role="alert"`: "Offline · answers cannot be sent · drafts stay on this page".
- Strips get "Stale" in their meta line; timers keep counting locally but say "estimated".
- Submit is `aria-disabled` with the reason.

## Empty

| Where | Copy |
|---|---|
| Bay | "No pending Rounds." · "Agents ask through the Hub Skill." · Open answered log |
| Answered log | "No answered Rounds yet." |
| Roster | "No Agents have connected." · "Give an Agent the Hub Skill to start." · Copy Hub URL |
| Filters | "No Rounds match · Clear filters" |

Empty states are calm: no illustration beyond the world's bay-floor texture, no exclamation marks.

## Error

| Error | Treatment |
|---|---|
| Round not found | Page: "No Round r_xxxx on this Hub" · Open answered log |
| Agent not found | Page: "No Agent CALLSIGN on this Hub" · Open Agents |
| Session expired | Sign-in page with status "Signed out · session ended at HH:MM" |
| Forbidden (wrong origin or host) | Page: "Blocked · this address is not allowed by the Hub" · what to change in Settings → Exposure |
| Unexpected Hub error | Inline alert where it happened: "Hub error · HTTP 500 · Retry", with the request id in mono for logs |

Errors never blame the Human and never use "Oops".

## Expired and cancelled

Covered on each Round surface ([command-center-blueprints.md](command-center-blueprints.md), Feed and Round detail; [phone-blueprints.md](phone-blueprints.md#single-round-approvereject)): grey hatched holder, "Expired" or "Cancelled", the outcome sentence, and any unsent draft marked "Not sent". In the Feed they end in place until the Human removes them.
