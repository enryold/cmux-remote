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

## Getting started

The recommended setup authorizes one iPhone through Tailscale. The only credential you enter on the
iPhone is a six-digit pairing code printed when the bridge starts.

Prerequisites:

- macOS with cmux running;
- Tailscale connected to the same tailnet on the Mac and iPhone;
- [devenv](https://devenv.sh/).

From the repository root, install the locked dependencies and run the guided setup:

```bash
devenv shell -- deps
devenv shell -- setup
```

The wizard finds the Mac and visible iPhones in the current tailnet, asks you to select or confirm
one phone, and checks that the HTTPS Serve route is safe to use. Accept the suggested capability by
pressing Enter unless your deployment already uses another valid name. It then builds the PWA,
creates a private local configuration, and copies one narrow Tailscale grant.

When prompted, open the displayed Tailscale policy-console URL, add the copied object to the
policy's `grants` array, save the policy, then return to the terminal and confirm. The wizard does
not edit the remote policy itself. It rechecks and safely creates or reuses the matching Tailscale
Serve route, then starts the bridge in the foreground.

On the selected iPhone, open the HTTPS URL printed by the wizard, enter the six-digit code printed
by the server, then use Safari's Share → Add to Home Screen. The `*.ts.net` URL remains stable while
the Mac's Tailscale node name and tailnet DNS suffix remain unchanged.

For later launches, rebuild the PWA and start the configured bridge with:

```bash
devenv shell -- start
```

### Start automatically on this Mac

On macOS, build once and install a per-user LaunchAgent. It starts after login, when cmux and
Tailscale can run in the user session. The installer requires an existing private `.env` and never
changes Tailscale Serve or tailnet policy.

```bash
devenv shell -- build-all
sh scripts/install-launch-agent.sh
```

The bridge retries three failed process exits after 2, 4, and 8 seconds, then stops until the next
login or a manual restart. A clean exit does not retry. The bridge's own cmux connection already
reconnects after sleep or network loss while the process stays alive. Control the agent with:

```bash
devenv shell -- service-start
devenv shell -- service-stop
devenv shell -- service-restart
```

The agent discards startup output because it contains a short pairing code. To pair the authorized
iPhone, run:

```bash
devenv shell -- pair
```

Enter the displayed code on the iPhone, then press Ctrl-C. The command restarts the LaunchAgent.
The paired cookie survives bridge and Mac restarts for up to 365 days while `.env` remains unchanged.
If Safari removes the cookie or the signing secret changes, pair again. To disable automatic startup,
unload the agent and remove its plist from `~/Library/LaunchAgents`.

## Current status

The current build provides Milestone 2 terminal usability and browser previews alongside the reliable terminal:

- dynamic workspace, pane, and typed-surface discovery without fixed names or counts;
- a dense mobile dashboard with exact-surface navigation and browser back support;
- xterm.js output with scrollback, selection, copy, paste, and scroll-position preservation;
  touch gestures scroll terminal history while the header and bottom controls stay in place;
- direct terminal typing plus a visible prompt composer that sends text followed by a real Enter key;
- a configurable Shortcuts menu for named keys (including Shift+Left and Shift+Tab), saved commands,
  toolbar favorites, and locally persisted terminal font size;
- read-only browser screenshots with manual Refresh and local zoom/pan;
- adaptive output polling, topology event subscriptions, foreground refresh, and automatic reconnect;
- local terminal sizing and font changes that preserve the Mac terminal's dimensions;
- an installable dark-mode PWA with iPhone safe-area and software-keyboard handling;
- localhost-only serving, exact-origin checks, a constrained RPC whitelist, and optional one-device
  Tailscale pairing.

The Milestone 1 flow was exercised from iPhone Safari over Tailscale for pairing, terminal switching,
output, prompt submission, special keys, keyboard layout, and viewport cleanup. The new Milestone 2
flows have automated Chromium and iPhone WebKit coverage; their hardware iPhone acceptance is pending. The deterministic
gate runs client and server tests plus Chromium and iPhone WebKit E2E tests against a fake cmux
socket. Repeat the real-device checklist below before tagging a release.

## Security and advanced setup

### Security model

Controlling this app can be equivalent to controlling your Mac shell. The bridge therefore:

- binds to `127.0.0.1:3456` by default;
- refuses to start without a `CMUX_REMOTE_TOKEN` of at least 32 UTF-8 bytes;
- can require a Tailscale app capability granted to one exact device;
- supports a single-use six-digit pairing code without sending the signing secret to the browser;
- uses an HttpOnly, SameSite session cookie after login;
- checks the exact request Origin for login, logout, previews, and WebSocket upgrades;
- accepts only topology, bounded terminal read/input, named-key, and viewport RPCs;
- accepts one protected preview POST for an exact current browser surface, with fixed server-owned
  screenshot reads, fresh ownership checks, a 10-second deadline, and one capture in flight;
- never exposes arbitrary cmux RPC, browser input/navigation, workspace creation, or shell spawning;
- never caches authentication, API, WebSocket, or terminal responses in the service worker.

Do not bind to `0.0.0.0` or publish the bridge through a public tunnel. Device pairing is a second
layer, not a replacement for a private tailnet policy.

### Manual one-iPhone pairing

Use this path only when you need to configure the pieces without `setup.js`. Generate a high-entropy
session-signing secret with `openssl rand -hex 32` and store it in the gitignored `.env` below. It is
a server implementation detail, not a credential entered on the iPhone.

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

Build the PWA, forward the capability through Serve, then start the bridge:

```bash
devenv shell -- build-all
tailscale serve --bg \
  --accept-app-caps=example.com/cap/cmux-remote \
  http://127.0.0.1:3456
devenv shell -- bun run --cwd server start
```

The bridge prints one six-digit code valid for ten minutes. It is consumed after a successful
pairing and locks after five failed attempts. Pairing creates a 365-day `HttpOnly`, `Secure`,
`SameSite=Strict` cookie; the Tailscale capability is checked again on every protected request and
WebSocket upgrade. Restart the bridge to obtain a fresh recovery code. Rotate
`CMUX_REMOTE_TOKEN` or remove the tailnet grant to revoke access.

Do not substitute a `.local` hostname: it is an mDNS name and does not provide the trusted HTTPS
origin required by the PWA.

### Token fallback

If `CMUX_REMOTE_TAILSCALE_CAPABILITY` is unset, the existing token login remains available. Tailscale
Serve is still preferred for HTTPS remote access:

```bash
CMUX_REMOTE_TOKEN='<generated token>' \
CMUX_REMOTE_ORIGIN='https://your-mac.your-tailnet.ts.net' \
devenv shell -- bun run --cwd server start
```

### Configuration

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

Open `http://localhost:5173`. Vite proxies `/auth`, `/health`, `/api`, and `/ws` to the bridge.

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

The client loads the complete cmux workspace → pane → surface tree and lists typed surfaces.
Lifecycle events trigger live rediscovery, with a slow visible-page refresh as fallback. Only the
open terminal is read; polling adapts from 250 ms during activity to 5 seconds while idle and stops
while the PWA is hidden.

Input is sent to an exact surface UUID and is never replayed after disconnect. Open **Shortcuts** to
add, edit, or delete up to 20 single-line commands and choose up to 12 favorites for the toolbar.
Preferences stay on this device. Saved commands send text followed by a real Enter to the open
terminal. Ctrl-C interrupts a process; Ctrl-D ends input and may close a shell. Both are optional
catalogue entries. Physical Ctrl input remains available.

Terminal snapshots are coalesced while a write, touch gesture, or selection is active. Appended
output keeps the same xterm buffer; changed prompts retain the visible history where it remains
available. **Latest** returns to the bottom without sending input to cmux.
The **A− / A+** controls in Shortcuts set the terminal font from 10 to 24 px and persist on this
device. The terminal refits without being recreated or changing the Mac's global font settings.

Browser rows open a read-only capture of that exact panel without changing focus on the Mac.
Only the HTTP(S) origin is shown as a URL label; credentials, path, query, and fragment are removed.
Capture happens on opening, **Refresh**, or returning to the foreground, with no periodic screenshots.
Zoom (25%–300%) and pan are local. A failed refresh marks the previous capture stale; disconnect,
auth expiry, panel removal, or leaving the view clears its bytes. Previews are held only in memory.
The bridge validates PNG bytes up to 2 MiB, axes up to 4,096 px, and area up to 8,388,608 px, within
a 3 MiB JSON response budget. Oversized captures fail without changing the socket frame limit.

Native Markdown/image rows currently show **Preview unavailable**. On cmux 0.64.25 (106), the
advertised `panel.artifact.v1` capability has no callable `mobile.panel.artifact.stat` worker handler,
and the tree provides no authorized content descriptor. Local-file viewing therefore remains
blocked; the bridge does not infer file paths or read arbitrary files. Browser screenshots work
independently of this missing native provider.

## Real-device release checklist

Before marking a release live, use eight disposable terminal surfaces and verify:

- complete discovery and terminal switching;
- rapid bounded output and idle output;
- typing, paste, physical/iPhone/composer Enter, selection, copy, and scroll preservation;
- Shortcuts CRUD, favorites, optional Ctrl-C/Ctrl-D, and disposable Codex/Claude question menus
  using Shift+Left, Shift+Tab, arrows, Escape, and empty Enter;
- saved launcher commands run once and never replay on reload/reconnect;
- 10–24 px font persistence and history position during output, touch, selection, and font changes;
- read-only browser capture, Refresh, local zoom/pan, stale failures, closure, and auth expiry;
- native Markdown/image rows truthfully report unavailable until the provider gate passes;
- selected-surface closure returns to the dashboard;
- iPhone lock/background for ten minutes and foreground recovery;
- Tailscale disconnect/reconnect without a manual reload;
- the Mac terminal grid returns to its prior size after leaving the PWA;
- unauthenticated, wrong-Origin, oversized, and non-whitelisted requests fail.

## Design documentation

- [Architecture and milestone specification](docs/superpowers/specs/2026-09-13-cmux-remote-command-center-design.md)
- [Implementation plan](docs/superpowers/plans/2026-09-13-reliable-mobile-terminal.md)
- [Guided first-run setup specification](docs/superpowers/specs/2026-09-14-guided-first-run-setup-design.md)
- [Guided first-run setup plan](docs/superpowers/plans/2026-09-14-guided-first-run-setup.md)
- [Milestone 2 terminal usability design](docs/superpowers/specs/2026-10-04-mobile-terminal-usability-design.md)
- [Milestone 2 terminal usability plan](docs/superpowers/plans/2026-10-04-mobile-terminal-usability.md)
- [Read-only content preview design and compatibility gate](docs/superpowers/specs/2026-10-04-surface-content-previews-design.md)
- [Read-only content preview implementation](docs/superpowers/plans/2026-10-04-surface-content-previews.md)
- [Milestone 2 validation and remaining acceptance](docs/superpowers/plans/2026-10-04-v2-mobile-validation.md)
- [Roadmap](docs/superpowers/ROADMAP.md)
- [Engineering guide for Codex and other coding agents](AGENTS.md)
- [Claude Code entry point](CLAUDE.md)

The older files under `docs/` and `README.ja.md` describe the upstream prototype and are retained
for history; they are not current deployment or security instructions.

## License

MIT. The original upstream copyright notice and license are preserved in [LICENSE](LICENSE).
