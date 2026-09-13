# Device-bound Tailscale pairing design

**Date:** 2026-09-14

**Status:** Approved

## Objective

Allow one explicitly authorized iPhone to open the cmux Remote PWA without entering a long random
token on every visit. Access remains private to Tailscale and keeps an application-level pairing
check because controlling cmux can be equivalent to controlling the Mac user's shell.

This design extends the Milestone 1 authentication section in
`2026-09-13-cmux-remote-command-center-design.md`. All existing Origin, cookie, WebSocket, RPC
whitelist, input-validation, and loopback-bind requirements remain in force.

## Decisions

- The canonical deployment URL is the HTTPS URL issued by Tailscale Serve. For the target Mac it
  will be `https://cmux.<tailnet>.ts.net` after the Tailscale node is renamed to `cmux`.
- `.local` is not used. It is an mDNS namespace, is not a dependable tailnet name away from the LAN,
  and cannot receive the publicly trusted certificate required by an installed PWA.
- Exact-device authorization is expressed by a Tailscale grant whose source is the iPhone and whose
  destination is the Mac. The grant includes a custom app capability.
- Tailscale Serve forwards only that capability to the loopback-bound bridge. The bridge rejects
  pairing, authenticated HTTP state, and WebSocket upgrades when the configured capability is
  absent or malformed.
- The human enters a six-digit, single-use pairing code once. Successful pairing creates the
  existing `HttpOnly`, `Secure`, `SameSite=Strict` session cookie; the raw signing secret never
  reaches the browser.
- Token login remains available when device-bound pairing is not configured, preserving a simple
  upstream-compatible fallback.

Tailscale Serve app-capability forwarding is used instead of trusting user-supplied device names,
client headers, or undocumented proxy behavior. Serve strips a client-supplied
`Tailscale-App-Capabilities` header before adding its own value, and the bridge continues to listen
only on `127.0.0.1`.

References:

- <https://tailscale.com/docs/features/tailscale-serve>
- <https://tailscale.com/docs/features/access-control/grants/grants-app-capabilities>
- <https://tailscale.com/docs/reference/syntax/grants>

## Deployment contract

Device-bound pairing is enabled only when all of the following are configured:

- `HOST=127.0.0.1` (the default);
- an exact HTTPS `CMUX_REMOTE_ORIGIN`;
- a high-entropy `CMUX_REMOTE_TOKEN` used only to sign browser sessions;
- `CMUX_REMOTE_TAILSCALE_CAPABILITY`, using the Tailscale `{domain}/{path}` format;
- Tailscale Serve started with the same capability in `--accept-app-caps`.

The server fails closed at startup if pairing mode is combined with a non-loopback bind, a missing
or non-HTTPS public origin, an invalid capability identifier, or an invalid configured test pairing
code.

A deployment adds a narrow tailnet policy rule similar to:

```jsonc
{
  "hosts": {
    "cmux-phone": "<iphone-tailscale-ip>",
    "cmux-mac": "<mac-tailscale-ip>"
  },
  "grants": [
    {
      "src": ["cmux-phone"],
      "dst": ["cmux-mac"],
      "ip": ["tcp:443"],
      "app": {
        "example.com/cap/cmux-remote": [{ "access": true }]
      }
    }
  ]
}
```

The capability name is deployment-owned and is never hardcoded by the project. Existing broader
tailnet grants must be reviewed separately: grants are additive, so this rule cannot revoke access
that another rule already permits. The application capability is still required by the bridge even
if a broader network rule exists.

Serve is configured with:

```sh
tailscale serve --bg \
  --accept-app-caps=example.com/cap/cmux-remote \
  http://127.0.0.1:3456
```

Funnel is never enabled.

## Pairing and session lifecycle

At startup in pairing mode, the bridge generates a cryptographically random six-digit code. A
fixed code may be supplied only through `CMUX_REMOTE_PAIRING_CODE` for deterministic automation or
an explicitly supervised deployment. The code:

- contains exactly six decimal digits;
- expires after ten minutes;
- is consumed after one successful pairing;
- permits at most five failed attempts before it is disabled;
- is printed once without printing the session-signing secret.

The pairing route first requires the configured Tailscale capability, then applies the existing
body-size and exact-shape validation, and finally compares the code without an early-exit string
comparison. Failure responses do not reveal whether the code expired, was consumed, or was wrong.

Successful pairing issues a session valid for 365 days. This is deliberately longer than token-mode
sessions because the Tailscale device capability is rechecked on every protected request and every
WebSocket upgrade. Changing `CMUX_REMOTE_TOKEN`, removing the iPhone grant, or removing the
capability immediately invalidates one of the two required layers. Logout clears the local cookie.

A server restart generates a fresh pairing code but does not invalidate an existing cookie when the
signing secret is unchanged. If Safari removes the cookie, restarting the bridge produces a new
short-lived code for recovery.

## HTTP and WebSocket behavior

`GET /auth/status` returns the authentication mode so the client can render either the existing
token form or the pairing form. In pairing mode it also reports whether the request carries the
required device capability, without exposing capability contents.

`POST /auth/login` accepts exactly one field:

- token mode: `{ "token": "..." }`;
- pairing mode: `{ "pairingCode": "123456" }`.

In pairing mode, a missing device capability fails before the pairing code is examined. Protected
WebSocket upgrades require all three checks:

1. exact allowed Origin;
2. configured Tailscale device capability;
3. valid signed session cookie.

The topology and terminal RPC whitelist is unchanged.

## Client behavior

The login screen derives its mode from `/auth/status`:

- token mode keeps the current password input;
- pairing mode shows a six-digit numeric input with `inputmode="numeric"` and
  `autocomplete="one-time-code"`;
- a request without the required capability shows a non-interactive “device not authorized” state
  and never submits a code.

The input is cleared after every submission. Error copy remains generic. After pairing, reload,
standalone PWA launch, background/foreground, and network reconnect reuse the cookie and follow the
existing reconnect flow.

## Test strategy

Server tests cover:

- fail-closed pairing configuration;
- capability-header parsing, including missing, malformed, oversized, and wrong capabilities;
- pairing expiry, single use, failed-attempt limit, and constant-work comparison path;
- secure cookie creation and preservation of token mode;
- Origin, capability, and cookie enforcement on WebSocket upgrades.

Client tests cover mode selection, six-digit validation, unauthorized-device rendering, input
clearing, and the existing token fallback.

Playwright runs in Chromium and iPhone WebKit with the capability header injected at the browser
context boundary. E2E covers wrong code, successful one-time pairing, reload persistence, dynamic
terminal discovery, terminal output/input, toolbar keys, back navigation, reconnect, and the static
service-worker cache boundary.

The live gate uses Tailscale Serve rather than Funnel, the real cmux socket, the authorized iPhone,
and a disposable terminal. It verifies pairing, PWA installation, terminal input, Ctrl-C,
background/foreground, and network reconnect. The disposable terminal and diagnostic Serve routes
are removed afterwards.

## Non-goals

- Multi-user or multi-device pairing.
- A general identity provider or OAuth/OIDC flow.
- Client certificates, custom certificate authorities, or mTLS.
- A custom public DNS domain or `.local` hostname.
- Automatic editing of a user's tailnet policy.
- Replacing Tailscale grants with application code.
