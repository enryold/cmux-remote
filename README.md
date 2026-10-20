# cmux-remote

**Your cmux terminals, from your iPhone.**

Leave a command, build, or coding assistant running in [cmux](https://cmux.dev) on your Mac.
Open cmux-remote on your iPhone to see its output, switch between terminals, and reply when
something needs your attention. You can type a prompt, press a shortcut, or attach a photo or
document, while your work keeps running on the Mac.

Use it in Safari or add it to your Home Screen like an app. Your phone connects privately to
your Mac through Tailscale; no cloud relay is required. The Mac must stay awake with cmux and
the bridge running.

## What this fork improves

This fork builds on [hummer98/cmux-remote](https://github.com/hummer98/cmux-remote), the original
lightweight mobile terminal viewer. It adds practical controls, connection recovery, and a guided
private setup:

- **Find what needs attention.** See live agent states, workspace activity and notification bells.
  Open the exact terminal from its row; expand inactive tabs when you need them.
- **Manage terminal tabs.** The circled plus creates a terminal and opens it on your phone.
  Confirm individual closes or close the expanded inactive group with **Chiudi tutte**.
- **Draft on your phone.** Write locally in a three-line prompt with native keyboard suggestions
  and correction. Return sends it; Shift+Return adds a line. Shortcuts and the footer hide while
  editing, leaving more room for output.
- **Keep useful keys close.** Use contextual question controls, saved commands and toolbar favorites
  without opening the phone keyboard when navigating choices.
- **Read on a small screen.** Keep terminal colors and compact prompt borders, scroll through output,
  select and copy text, and adjust the font without resizing the terminal on your Mac.
- **Attach files and photos.** Upload them to the Mac, review their references in your prompt,
  and send when ready. Attaching a file alone never submits a command.
- **Check browser and image panels.** View browser screenshots and native image thumbnails,
  refresh them, and zoom or pan on your phone.
- **Recover after interruptions.** Connections recover automatically and output refreshes when
  you return to the app. Terminal input is never automatically replayed after reconnecting.
- **Set up private access.** The setup wizard walks you through authorizing one iPhone and
  pairing with a six-digit code. You can also configure the bridge to start when you log in
  to your Mac.

Browser and native image previews are read-only. Native Markdown and original-resolution image
reads remain unavailable on the verified cmux 0.65.2 socket. The complete real-device release
checklist still needs acceptance on a physical iPhone.

See the [changelog](CHANGELOG.md) for the latest changes.

## Getting started

The recommended setup authorizes one iPhone through Tailscale. The only credential you enter on the
iPhone is a six-digit pairing code printed when the bridge starts.

Prerequisites:

- macOS with cmux running;
- Tailscale connected to the same tailnet on the Mac and iPhone, with the `tailscale` CLI
  available on the Mac.

Clone the repository and open its folder:

```bash
git clone https://github.com/enryold/cmux-remote.git
cd cmux-remote
```

Choose either setup method below. Both use the same guided wizard.

### Install without devenv

Install [Bun](https://bun.sh/docs/installation) and [Node.js 22](https://nodejs.org/en/download),
and make sure `bun` and `node` are available in your terminal. The project is tested with
Bun 1.3.13 and Node.js 22.

From the repository root, install the locked dependencies and start setup:

```bash
bun install --frozen-lockfile
bun install --cwd client --frozen-lockfile
bun install --cwd server --frozen-lockfile
bun setup.js
```

### Install with devenv

If you use [devenv](https://devenv.sh/), it provides Bun and Node.js for you:

```bash
devenv shell -- deps
devenv shell -- setup
```

### Pair your iPhone

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

### Later launches

With Bun, run these commands from the repository root to rebuild the PWA and start the bridge.
Bun [automatically loads](https://bun.sh/docs/runtime/environment-variables) the `.env` saved
by the wizard. Keep this terminal running; Ctrl-C stops the bridge.

```bash
bun run --cwd client build
bun run server/src/index.ts
```

With devenv, the equivalent command is:

```bash
devenv shell -- start
```

### Start automatically on this Mac (requires devenv)

The bundled LaunchAgent installer currently uses devenv. On macOS, build once and install
a per-user LaunchAgent. It starts after login, when cmux and Tailscale can run in the user session.
The installer requires an existing private `.env` and never
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

The current build provides Milestone 2 terminal controls and image previews, the Milestone 3 agent
dashboard, and explicit tab actions alongside the reliable terminal:

- dynamic workspace, pane, and typed-surface discovery without fixed names or counts;
- a dense mobile dashboard with exact-surface navigation and browser back support;
- structured agent states, activity, notification summaries/unread counts and workspace totals;
- new terminals in an explicit workspace/pane and confirmed closing of the selected tab;
- read-only xterm.js output with scrollback, selection, copy, and scroll-position preservation;
  touch gestures scroll terminal history while the header and bottom controls stay in place;
- a local prompt composer that sends the complete text followed by a real Enter key;
- file and image uploads from the composer, with editable references and explicit Send;
- a configurable Shortcuts menu for named keys (including Shift+Left and Shift+Tab), saved commands,
  toolbar favorites, and locally persisted terminal font size;
- read-only browser screenshots with manual Refresh and local zoom/pan;
- native PNG/JPEG/WebP panel thumbnails, up to 1024 px, using cmux 0.65.2's authorized descriptors;
- adaptive output polling, topology event subscriptions, foreground refresh, and automatic reconnect;
- local terminal sizing and font changes that preserve the Mac terminal's dimensions;
- an installable dark-mode PWA with iPhone safe-area and software-keyboard handling;
- localhost-only serving, exact-origin checks, a constrained RPC whitelist, and optional one-device
  Tailscale pairing.

The Milestone 1 flow was exercised from iPhone Safari over Tailscale for pairing, terminal switching,
output, prompt submission, special keys, keyboard layout, and viewport cleanup. The new Milestone 2/3
and tab-action flows have automated Chromium and iPhone WebKit coverage; hardware iPhone acceptance
is pending. The deterministic
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
- checks the exact request Origin for login, logout, previews, uploads, and WebSocket upgrades;
- accepts only topology, bounded terminal read/input, named-key, and viewport RPCs;
- accepts one protected preview POST for an exact current browser surface, with fixed server-owned
  screenshot reads, fresh ownership checks, a 10-second deadline, and one capture in flight;
- accepts a protected attachment POST for an exact live terminal, limited to 10 MiB per file,
  one upload in flight and a 120-second deadline; cmux owns storage and destination names;
- never exposes arbitrary cmux RPC, browser input/navigation, workspace creation, or configurable
  shell spawning; new terminals use fixed type/focus options in a verified existing workspace/pane;
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

From the repository root, build the PWA, forward the capability through Serve, then start the bridge:

```bash
bun run --cwd client build
tailscale serve --bg \
  --accept-app-caps=example.com/cap/cmux-remote \
  http://127.0.0.1:3456
bun run server/src/index.ts
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
bun run server/src/index.ts
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

## How it works

```text
iPhone Safari / PWA
        | Tailscale device capability + paired session
        v
Bun/Hono bridge on the Mac
        | validated RPC whitelist over a Unix socket
        v
cmux
```

cmux remains the primary workspace. The bridge provides focused access to its existing panels;
it is not a web IDE, generic SSH endpoint, file manager, Git client, or remote browser.

## Runtime behavior

### Files and images

Open a terminal and tap **📎** beside the prompt to choose photos or files using the phone's
native picker. Select up to four files at a time, each at most 10 MiB. Uploads run sequentially,
then quoted Mac file paths appear in the editable prompt. Review them, add your instructions,
and press **Send**. Uploading alone never types into the terminal or presses Enter.

The running program must support reading local documents/images from those paths. Files stay
on this Mac; uploading does not transfer them to a program running on another machine.
Filenames are limited to 180 UTF-8 bytes, without slashes or control characters; leading dots
are removed. The installed cmux upload contract was verified on 0.64.25 (106). Versions without
that API show an error instead of falling back to shell commands.

Leaving the terminal, losing the connection, or hiding the app cancels active uploads.
While the terminal stays open, failures retain the typed prompt and references already added;
choose the file again to retry.
cmux stores files under `~/.cache/cmux/task-attachments` and prunes operation directories older
than seven days during later uploads. Removing a reference or canceling an upload does not
delete an already stored file. Files and paths are never saved in browser storage or PWA caches.

### Discovery and terminal input

The client loads the complete cmux workspace → pane → surface tree and lists typed surfaces.
Lifecycle events trigger live rediscovery, with a slow visible-page refresh as fallback. Only the
open terminal is read; polling adapts from 250 ms during activity to 5 seconds while idle and stops
while the PWA is hidden.

Input is sent to an exact surface UUID and is never replayed after disconnect. Open **Shortcuts** to
add, edit, or delete up to 20 single-line commands and choose up to 12 favorites for the toolbar.
Preferences stay on this device. Saved commands send text followed by a real Enter to the open
terminal. Ctrl-C interrupts a process; Ctrl-D ends input and may close a shell. Both are optional
catalogue entries.

Write or paste into **Prompt or command**: typing stays on the phone, so characters appear without
waiting for the Mac's echo. The field displays three lines and scrolls longer drafts; Shift+Return
inserts a line break. Native keyboard suggestions, autocorrection and spellchecking are enabled,
subject to your device's keyboard settings. Return or Send transmits the whole prompt followed by
Enter. While the composer has focus, the shortcut bar and connection footer hide to leave more space
for terminal output; they return when editing ends. Device safe-area spacing remains. The output
area is read-only and does not open the phone keyboard; selection, copy and scrolling still work.
Shortcut buttons continue to send their keys immediately when the bar is visible, including Enter
with an empty draft.

When cmux identifies the current agent, question keys stay visible on the right below Send:
**Shift+←, Enter, Esc** for Codex; **↑, ↓, Enter, Esc** for Claude Code. Other favorites scroll
between Shortcuts and those keys, without duplicates. The sheet marks fixed keys as always visible;
your saved favorites stay unchanged. Unknown agents use the saved toolbar. All catalogue keys remain
available to every terminal. Shortcut taps send the key without focusing the terminal's typing input,
so navigating choices does not request the phone keyboard.

Terminal snapshots are coalesced while a write, touch gesture, or selection is active. Appended
output keeps the same xterm buffer; changed prompts retain the visible history where it remains
available. **Latest** returns to the bottom without sending input to cmux.
The terminal defaults to 12 px; the **A− / A+** controls in Shortcuts set it from 10 to 24 px and
persist on this device. Existing saved sizes are preserved. The terminal refits without being
recreated or changing the Mac's global font settings. Attachment and Send use compact icons, and
the shortcut strip uses quieter 12 px labels while retaining 44 px touch targets. The prompt input
stays at 16 px to avoid iPhone focus zoom.
The terminal and controls have a 12 px side gutter (or the larger device safe area). Shortcuts opens
in an inset sheet with compact key rows, star favorites, and the same quiet dark styling.

Terminal snapshots preserve explicit foreground/background colors and emphasis, including colored
diffs, when cmux supplies a full styled capture. The bridge first reads the selected running terminal,
then converts its bounded render grid into generated color codes; unsupported, invalid or slow
captures retain plain text. Default colors keep the web app's theme. This does not resize the Mac
terminal or add a raw terminal-byte stream. Trailing desktop fill cells are omitted so colored
prompts stay compact on the phone; prompt text, menu choices, indentation and line breaks remain visible.
Standalone horizontal separator lines fit the local terminal width instead of wrapping, including
after rotation or font changes. Text, code and table borders retain their content.

Installed iPhone PWAs use a standalone height fallback that includes safe areas; browser tabs retain
dynamic viewport height. Some iOS versions also have system-owned viewport gaps
([WebKit report](https://bugs.webkit.org/show_bug.cgi?id=301994)); physical-device confirmation is
needed if a strip remains after closing and reopening the PWA.
Connection status appears once, centered horizontally and vertically in the footer on both dashboard
and terminal views.

The workspace dashboard uses structured `mobile.workspace.list` metadata for **Working**, **Idle**,
**Needs attention**, or **Unknown**. A yellow bell replaces the selection dot on terminals with an
unread notification or a structured request for attention. Click the bell or its row to enter that
exact terminal on the phone. Notification ownership comes from `notification.list`; only a boolean
reaches the PWA, and message previews are not displayed. Opening locally does not mark notifications
read on the Mac. Missing,
ambiguous or unavailable metadata shows Unknown; disconnect clears trusted evidence and snapshots
expire after 45 seconds without refresh. Idle does not mean a task is complete. Metadata uses a
separate socket with a one-second total wait, so its failure does not interrupt terminal access. The
dashboard does not read output from unselected terminals or parse agent prose.

When a workspace has more than two inactive tabs, they appear under **Inactive tabs (X)**. Expand
the group to browse them or use **Chiudi tutte** at its upper right. One confirmation closes the
captured inactive tabs in that workspace; running processes and unsaved work may be lost. Tabs that
become selected, working or attentive are skipped, and closure stops on an error or lost connection.
Newly appeared tabs are not included; cmux keeps its last tab open. Inactive means unselected without current working/attention evidence;
selected tabs, working terminals and terminals with a bell stay visible. A new notification promotes
its terminal out of the collapsed group on refresh.

Choose the **circled plus** in a workspace or the selected tab's header to create
a terminal in that exact pane and enter it directly on the phone without changing focus on the Mac.
The close button asks for
confirmation before stopping processes or losing unsaved changes. cmux refuses to close the last
surface in a workspace. Creation and close are sent once; if acknowledgement is lost, inspect the
tabs before trying again. These controls are disabled while disconnected or another action is pending.
Action notices can be dismissed with their close button and clear when navigating to another tab.
If creation reports an outdated bridge, run `devenv shell -- service-restart` and reload the app.

Browser rows open a read-only capture of that exact panel without changing focus on the Mac.
Only the HTTP(S) origin is shown as a URL label; credentials, path, query, and fragment are removed.
Capture happens on opening, **Refresh**, or returning to the foreground, with no periodic screenshots.
Zoom (25%–300%) and pan are local. A failed refresh marks the previous capture stale; disconnect,
auth expiry, panel removal, or leaving the view clears its bytes. Previews are held only in memory.
The bridge validates PNG bytes up to 2 MiB, axes up to 4,096 px, and area up to 8,388,608 px, within
a 3 MiB JSON response budget. Oversized captures fail without changing the socket frame limit.

On cmux 0.65.2 (111), saved PNG/JPEG/WebP panels open read-only **JPEG thumbnails up to 1024 px**.
The bridge resolves the exact panel's descriptor server-side, checks allowed media, validates JPEG
bytes/dimensions and rechecks file association after capture. The PWA never supplies or receives a
native file path. Native images share the existing 2 MiB image/3 MiB JSON budgets and local zoom.
Markdown and original-resolution reads remain unavailable: `mobile.panel.artifact.fetch` is not
exposed on the local control socket, and `surface.read_text` only accepts terminals. There is no
filesystem fallback. Older cmux versions can show Preview unavailable for native images.

## Real-device release checklist

Before marking a release live, use eight disposable terminal surfaces and verify:

- complete discovery and terminal switching;
- rapid bounded output and idle output;
- local drafting, paste, physical/iPhone/composer Enter, read-only output, selection, copy, and scroll preservation;
- Shortcuts CRUD, favorites, optional Ctrl-C/Ctrl-D, and disposable Codex/Claude question menus
  using Shift+Left, Shift+Tab, arrows, Escape, and empty Enter;
- saved launcher commands run once and never replay on reload/reconnect;
- native photo/file selection, upload progress/failure/cancellation, editable references,
  and explicit Send to the original terminal;
- 10–24 px font persistence and history position during output, touch, selection, and font changes;
- read-only browser capture, Refresh, local zoom/pan, stale failures, closure, and auth expiry;
- native image thumbnails, Refresh/local zoom, and truthful unavailable Markdown;
- live agent states, notification summaries/counts, and Unknown after metadata failure/disconnect;
- exact-pane terminal creation, close cancellation/confirmation, last-tab protection, and no replay
  after reconnect;
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
- [cmux 0.65.2 native images, agent dashboard and tabs](docs/superpowers/specs/2026-10-20-native-images-agent-dashboard-tabs.md)
- [Native images, dashboard and tabs implementation](docs/superpowers/plans/2026-10-20-native-images-agent-dashboard-tabs.md)
- [Terminal attachments design](docs/superpowers/specs/2026-10-05-terminal-attachments-design.md)
- [Terminal attachments implementation plan](docs/superpowers/plans/2026-10-05-terminal-attachments.md)
- [Roadmap](docs/superpowers/ROADMAP.md)
- [Engineering guide for Codex and other coding agents](AGENTS.md)
- [Claude Code entry point](CLAUDE.md)

The older files under `docs/` and `README.ja.md` describe the upstream prototype and are retained
for history; they are not current deployment or security instructions.

## License

MIT. The original upstream copyright notice and license are preserved in [LICENSE](LICENSE).
