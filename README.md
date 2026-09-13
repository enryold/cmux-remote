# cmux-remote

An open-source, mobile-first command center for terminal surfaces running in
[cmux](https://cmux.dev). It keeps cmux as the primary workspace and gives an iPhone a focused way
to discover terminals, read recent output, type, and recover after network or background changes.

```text
iPhone Safari / PWA
        | Tailscale device capability + paired session
        v
Bun/Hono bridge on the Mac
        | validated RPC whitelist over a Unix socket
        v
cmux
```

There is no required cloud service. This is not a web IDE, generic SSH endpoint, file manager, Git
client, or remote browser.

## Security model

Controlling this app can be equivalent to controlling your Mac shell. The bridge therefore:

- binds to `127.0.0.1:3456` by default;
- refuses to start without a `CMUX_REMOTE_TOKEN` of at least 32 UTF-8 bytes;
- can require a Tailscale app capability granted to one exact device;
- supports a single-use six-digit pairing code without sending the signing secret to the browser;
- uses an HttpOnly, SameSite session cookie after login;
- checks the exact request Origin for login, logout, and WebSocket upgrades;
- accepts only topology, bounded terminal read/input, named-key, and viewport RPCs;
- never exposes arbitrary cmux RPC, browser control, workspace creation, or shell spawning;
- never caches authentication, API, WebSocket, or terminal responses in the service worker.

Do not bind to `0.0.0.0` or publish the bridge through a public tunnel. Device pairing is a second
layer, not a replacement for a private tailnet policy.

## Requirements

- macOS with cmux running;
- [devenv](https://devenv.sh/) and direnv, or the Bun/Node versions described by `devenv.nix`;
- Tailscale for remote access;
- Safari on iPhone for Add to Home Screen.

## Setup

Install the locked dependencies and build the PWA:

```bash
devenv shell -- deps
devenv shell -- build-all
```

Generate a high-entropy session-signing secret and keep it in a password manager or a gitignored
`.env`:

```bash
openssl rand -hex 32
```

For local token mode, start the production bridge from the repository root:

```bash
CMUX_REMOTE_TOKEN='<generated token>' devenv shell -- bun run --cwd server start
```

It serves the built client at `http://127.0.0.1:3456`.

### Pair one iPhone with Tailscale

The preferred mode gives one iPhone a custom Tailscale app capability and requires a six-digit code
on first use. The bridge still binds only to localhost, and Tailscale Serve strips spoofed capability
headers before forwarding its trusted value.

Choose a capability under a domain you control and add a narrow rule to the tailnet policy. Tailscale
IPs remain stable while each node remains registered.

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

Grants are additive. Review existing broader grants separately if the network layer must also reject
every other tailnet device.

Store the bridge configuration in a gitignored `.env`:

```dotenv
CMUX_REMOTE_TOKEN=<generated-64-hex-character-secret>
CMUX_REMOTE_ORIGIN=https://cmux.your-tailnet.ts.net
CMUX_REMOTE_TAILSCALE_CAPABILITY=example.com/cap/cmux-remote
```

Build and start the bridge, then forward the same capability through Serve:

```bash
devenv shell -- build-all
devenv shell -- bun run --cwd server start
tailscale serve --bg \
  --accept-app-caps=example.com/cap/cmux-remote \
  http://127.0.0.1:3456
```

The bridge prints one six-digit code valid for ten minutes. It is consumed after a successful
pairing and locks after five failed attempts. Pairing creates a 365-day `HttpOnly`, `Secure`,
`SameSite=Strict` cookie; the Tailscale capability is checked again on every protected request and
WebSocket upgrade. Restart the bridge to obtain a fresh recovery code. Rotate
`CMUX_REMOTE_TOKEN` or remove the tailnet grant to revoke access.

On iPhone, connect Tailscale, open the HTTPS URL in Safari, enter the pairing code, then use Share →
Add to Home Screen. The full `*.ts.net` URL remains stable while the Tailscale node name and tailnet
DNS suffix remain unchanged. Do not substitute a `.local` hostname: it is an mDNS name and does not
provide the trusted HTTPS origin required by the PWA.

### Token fallback

If `CMUX_REMOTE_TAILSCALE_CAPABILITY` is unset, the existing token login remains available. Tailscale
Serve is still preferred for HTTPS remote access:

```bash
CMUX_REMOTE_TOKEN='<generated token>' \
CMUX_REMOTE_ORIGIN='https://your-mac.your-tailnet.ts.net' \
devenv shell -- bun run --cwd server start
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `CMUX_REMOTE_TOKEN` | required | Session-signing secret, or login token in fallback mode; minimum 32 UTF-8 bytes |
| `CMUX_REMOTE_TAILSCALE_CAPABILITY` | unset | Enables device pairing and requires this exact Serve app capability |
| `CMUX_REMOTE_PAIRING_CODE` | generated | Optional deterministic six-digit override for supervised automation |
| `HOST` | `127.0.0.1` | Exact bridge bind address |
| `PORT` | `3456` | Bridge port |
| `CMUX_REMOTE_ORIGIN` | request origin | Exact external HTTP(S) origin, required behind an HTTPS proxy |
| `CMUX_SOCKET_PATH` | current cmux state socket | Explicit cmux Unix socket |
| `CMUX_SOCKET_PASSWORD` | unset | Password for an authenticated cmux socket |

Pairing mode requires `HOST=127.0.0.1` and an HTTPS `CMUX_REMOTE_ORIGIN`. The socket resolver checks
cmux's current `last-socket-path` and state socket before the legacy Application Support path.
Secrets must remain outside Git; `.env` files are ignored.

## Development

For the proxied Vite development server, use this gitignored `.env`:

```dotenv
CMUX_REMOTE_TOKEN=<generated token>
CMUX_REMOTE_ORIGIN=http://localhost:5173
```

Then run both processes:

```bash
devenv up
```

Open `http://localhost:5173`. Vite proxies `/auth`, `/health`, and `/ws` to the bridge.

Useful checks:

```bash
devenv shell -- lint
devenv shell -- test-all
devenv shell -- typecheck
devenv shell -- build-all
devenv shell -- e2e-deps  # once per machine
devenv shell -- e2e
devenv shell -- check
```

`check` runs lint, unit/integration tests, typechecks, the production build, and deterministic
Chromium plus iPhone WebKit E2E tests against a fake cmux socket.

## Runtime behavior

The client loads the complete cmux workspace → pane → surface tree and lists every terminal surface.
Lifecycle events trigger live rediscovery, with a slow visible-page refresh as fallback. Only the
open terminal is read; polling adapts from 250 ms during activity to 5 seconds while idle and stops
while the PWA is hidden.

Input is sent to an exact surface UUID and is never replayed after disconnect. The mobile toolbar
provides Esc, Tab, one-shot Ctrl, Ctrl-C, Ctrl-D, Up, Down, and Enter. Browser surfaces are discovered
by cmux but intentionally not exposed for control in Milestone 1.

## Real-device release checklist

Before marking a release live, use eight disposable terminal surfaces and verify:

- complete discovery and terminal switching;
- rapid bounded output and idle output;
- typing, paste, Enter, Ctrl-C, selection, copy, and scroll preservation;
- selected-surface closure returns to the dashboard;
- iPhone lock/background for ten minutes and foreground recovery;
- Tailscale disconnect/reconnect without a manual reload;
- the Mac terminal grid returns to its prior size after leaving the PWA;
- unauthenticated, wrong-Origin, oversized, and non-whitelisted requests fail.

## Design documentation

- [Architecture and milestone specification](docs/superpowers/specs/2026-09-13-cmux-remote-command-center-design.md)
- [Implementation plan](docs/superpowers/plans/2026-09-13-reliable-mobile-terminal.md)
- [Roadmap](docs/superpowers/ROADMAP.md)

The older files under `docs/` and `README.ja.md` describe the upstream prototype and are retained
for history; they are not current deployment or security instructions.

## License

MIT. The original upstream copyright notice and license are preserved in [LICENSE](LICENSE).
