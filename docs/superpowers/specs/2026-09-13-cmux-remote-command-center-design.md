# cmux Remote Command Center

**Date:** 2026-09-13

**Status:** approved after architecture assessment with Enrico

## Objective

Evolve `hummer98/cmux-remote` into a secure, mobile-first WebApp/PWA for monitoring and controlling
cmux sessions from an iPhone, primarily over Tailscale.

cmux remains the working environment and source of truth. The PWA is a remote command center, not an
IDE, terminal multiplexer, generic SSH client, file manager, Git client, or remote browser.

The first deliverable is deliberately narrow: reliably open any live terminal, read recent output,
send input, switch terminals, and recover after an iPhone background or network transition.

## Product boundaries

### In scope

- Dynamic workspace, pane, and surface discovery from cmux.
- A dense mobile dashboard listing live terminal surfaces.
- Bidirectional terminal use through xterm.js.
- Mobile keys for Esc, Tab, Ctrl, Ctrl-C, Ctrl-D, arrows, and Enter.
- PWA installation, safe-area handling, portrait layout, dark mode, and explicit disconnected state.
- Private tailnet deployment with an additional application authentication layer.
- Conservative agent-status enrichment after the terminal workflow is reliable.
- Browser surface identification in the third milestone.

### Out of scope

- Code editor, filesystem browser, Git or pull-request management.
- Generic SSH access or arbitrary command execution outside a selected cmux terminal.
- Multi-user collaboration, public ingress, cloud relay, or mandatory cloud services.
- Native iOS or Android applications.
- Full remote control of browser surfaces.
- Parsing Codex or Claude prose to infer semantic task completion.

## Upstream assessment

The upstream project is a compact React 19/Vite/xterm.js client with a Bun/Hono bridge. It already
has a PWA shell, workspace drawer, terminal renderer, WebSocket reconnect loop, navigation gestures,
health endpoint, and a Unix-socket bridge to cmux.

The current implementation is not yet a remote command center:

- The client discovers workspaces and panes but only follows each pane's selected surface.
- Terminal output is a full text snapshot polled every second.
- xterm is initialized with stdin disabled; the existing send-text wrapper is not wired to the UI.
- Every terminal refresh clears and rewrites xterm, disrupting selection and scroll position.
- WebSocket reconnect stops permanently after ten failed attempts and has no foreground/network
  recovery hooks.
- The server launches the cmux CLI for terminal reads and writes, while transparently forwarding all
  other methods to the socket.
- The server has no application authentication, Origin validation, RPC whitelist, or strict request
  schema, and Bun's default bind exposes it on every interface.
- The default socket path is obsolete for the installed cmux version.
- The PWA manifest references missing icons and the service worker caches too broadly.
- Client and server tests pass, but coverage is minimal and there is no lint configuration.

The fork keeps the useful upstream structure and replaces only the unsafe or unreliable paths.

## Verified cmux contract

Assessment target: cmux `0.64.22 (102)`, build `ddd4a01bc`.

The active control socket is `~/.local/state/cmux/cmux.sock`, protocol `cmux-socket` v2. Socket
password mode uses `auth.login` before other methods.

### Public operations used by the design

| Purpose | cmux method |
|---------|-------------|
| Capability detection | `system.capabilities` |
| Complete live topology | `system.tree` with `all: true` |
| Terminal snapshot | `surface.read_text` |
| Text input | `surface.send_text` |
| Named key input | `surface.send_key` |
| Optional terminal sizing | `terminal.viewport` when `terminal.viewport.v1` is advertised |
| Reconnectable lifecycle stream | `events.stream` on a dedicated socket |

`system.tree` returns windows, workspaces, panes, and all surfaces, including terminal/browser type,
title, URL, IDs, refs, selected state, and pane ownership. No fixed workspace or pane count is
assumed.

`events.stream` supplies reconnectable workspace/pane/surface lifecycle events with sequence,
`boot_id`, replay, heartbeat, and gap detection. It does not carry terminal output bytes and takes
over its socket connection.

Although cmux advertises `terminal.bytes.v1`, byte subscriptions are part of the authenticated Mobile
Host transport. `mobile.events.subscribe` is unavailable on the normal local control socket. The fork
will not reproduce the Mobile Host protocol or its render-grid client in V1.

Every mutating call uses an exact UUID and exact snake_case parameters. Missing targets, refs that
could fall back to the focused surface, camelCase aliases, and unknown fields are rejected before
they reach cmux.

## Architecture

```text
iPhone Safari / installed PWA
        |
        | private Tailscale path + authenticated HTTP/WebSocket
        v
Bun/Hono bridge on the Mac
        |-- validated, whitelisted JSON-RPC requests
        |-- persistent control-socket connection
        |-- dedicated events.stream connection
        `-- fixed cmux sessions --json enrichment (Milestone 2 only)
        v
cmux Unix socket and supported cmux CLI
```

The browser never receives a transparent cmux proxy. Client/server messages retain the existing
request ID and method envelope, but the server accepts only the explicitly implemented methods and
returns normalized responses.

There is no database. Live cmux state is rediscovered after reconnect; browser-local state is limited
to non-sensitive presentation preferences and the selected surface ID.

## Server design

### Network boundary

- Default bind: `127.0.0.1`.
- Remote access: Tailscale Serve over localhost, or an explicitly configured Tailscale IP.
- Binding `0.0.0.0` requires an explicit configuration value and is documented as unsafe.
- No Cloudflare Tunnel or public exposure is assumed.

### Application authentication

- `CMUX_REMOTE_TOKEN` is required at startup and must be a high-entropy secret.
- A login POST compares the token in constant time and sets an `HttpOnly`, `SameSite=Strict` session
  cookie. The cookie is also `Secure` under HTTPS.
- Session validity is derived with standard-library cryptography; there is no credential database.
- WebSocket upgrade requires the valid cookie and an allowed same-origin `Origin` header.
- Tokens never appear in URLs, browser storage, terminal logs, analytics, or server logs.
- Logout clears the cookie. Changing the configured token invalidates existing sessions.

### cmux connection

- Prefer `CMUX_SOCKET_PATH` when set.
- Otherwise use cmux's current state socket or recorded last-socket path; retain the legacy path only
  as an existence-checked fallback.
- If `CMUX_SOCKET_PASSWORD` is configured, authenticate each control/event connection with
  `auth.login` before use.
- The normal RPC connection is persistent and correlates response IDs.
- `events.stream` owns a second persistent connection.
- Socket failure rejects pending requests, closes or marks the client disconnected, and reconnects
  without retaining unbounded buffers.

### Whitelist and validation

Milestone 1 exposes only normalized equivalents of:

- `system.capabilities`;
- `system.tree`;
- `surface.read_text`;
- `surface.send_text`;
- `surface.send_key`;
- capability-gated `terminal.viewport`.

Validation includes:

- exact object schemas with unknown keys rejected;
- canonical UUID surface IDs;
- bounded terminal scrollback line count;
- bounded text and WebSocket message sizes;
- a fixed key-name whitelist;
- no missing or implicit focused target;
- one bounded queue while cmux reconnects;
- no methods for workspace creation, shell spawning, filesystem access, browser control, or arbitrary
  RPC forwarding.

Health output reveals only bridge/cmux availability and never paths, credentials, process arguments,
or terminal content.

## Discovery and topology updates

On authenticated connection the client requests a fresh `system.tree` snapshot and normalizes it to:

```text
workspace
  -> pane
      -> surface
```

The server subscribes to window/workspace/pane/surface event categories. Relevant lifecycle events
cause the client to request a new snapshot; bursts are coalesced. A stream gap, cmux restart, or
WebSocket reconnect always causes a full snapshot rather than attempting to reconstruct missing
state.

When the event stream is unavailable, a slow visible-page topology timer is the fallback. It stops
while the page is hidden and refreshes immediately on foreground.

Closing the selected surface returns the user to the dashboard with a short explanation. Creating or
closing other surfaces updates the dashboard without a full page reload.

## Milestone 1 — Reliable mobile terminal

### Dashboard

The first dashboard is an intentionally simple, dense list grouped by workspace. It shows every live
terminal surface with title, surface type, selected state, and connection state. It does not calculate
agent status or poll output for all terminals.

Tapping a row opens its terminal. Browser and other non-terminal surfaces are tolerated by discovery
but are not rendered as controllable rows during this milestone.

History API and `popstate` provide browser/PWA back navigation without adding a routing dependency.

### Terminal output

The public cmux socket has no stable terminal-byte stream, so `surface.read_text` is used through the
persistent RPC connection.

Polling uses one `setTimeout` loop with at most one request in flight:

- start around 250 ms while output changes;
- progressively back off through approximately 500 ms, 1 s, 2 s, then 5 s while idle;
- stop completely when the document is hidden;
- resume immediately on foreground, online, reconnect, or surface selection;
- reset to the fast interval whenever output changes.

The scrollback request is bounded. Identical snapshots do not touch xterm. When content changes, the
renderer preserves whether the user was at the bottom and restores a non-bottom viewport where
possible. Updates wait while text is selected so copying is not destroyed.

This is the supported V1 fallback. True terminal-byte streaming can replace it only if cmux exposes a
stable public subscription on the normal authenticated control surface.

### Terminal input and mobile keyboard

xterm stdin is enabled. Plain keyboard input sends bounded text to the exact selected surface. Named
mobile-toolbar actions use the key RPC where supported.

The toolbar provides:

- Esc;
- Tab;
- a one-shot Ctrl modifier;
- Ctrl-C and Ctrl-D;
- Arrow Up and Arrow Down;
- Enter.

The layout respects iPhone safe areas and the visual viewport while the software keyboard is open.
Copy and selection remain native. Paste uses the active terminal textarea/browser paste flow and is
subject to the same server-side input bound.

`FitAddon` recomputes xterm columns and rows after layout/viewport changes. If
`terminal.viewport.v1` is present, the server reports the selected terminal's viewport through a
small capability-gated adapter; otherwise the display remains functional without mutating cmux size.

### Reconnect and foreground recovery

Reconnect has capped exponential backoff with jitter but no terminal retry count. The client also
attempts an immediate connection on:

- `visibilitychange` to visible;
- `online`;
- `pageshow`;
- PWA return from background.

Closing a WebSocket rejects all pending client RPCs. After reconnect the client refreshes
capabilities and topology, verifies that the selected surface still exists, reapplies viewport state,
and reads terminal output immediately.

### PWA behavior

- Correct iPhone viewport and safe-area CSS.
- Dark theme and clear connecting/disconnected/auth-required states.
- Complete manifest with existing icons committed to the repository.
- Service worker caches only versioned static GET assets.
- Auth routes, health, WebSocket traffic, and terminal data are never cached.
- Offline mode explains that terminal access requires the Mac and tailnet; it does not display stale
  terminal output as live data.

## Milestone 2 — Agent dashboard

Milestone 2 begins only after Milestone 1 passes its real-device checks.

The dashboard adds activity time, a short sanitized preview, conservative status, and workspace
counts. Source priority is:

1. cmux lifecycle/notification events;
2. a reconciled `cmux sessions --json` record;
3. live surface/session metadata;
4. last output activity time;
5. small generic terminal-output heuristics.

No Codex/Claude prose parser is introduced.

### `cmux sessions --json` enrichment

The command is recent and is not advertised as a socket capability. The server feature-detects the
fixed command and validates its JSON shape. Absence, timeout, malformed output, or schema drift
disables this enrichment without affecting terminal access.

The command runs with fixed server-owned arguments; the browser cannot supply agent, session, path,
home, or state-directory flags. Records are joined to the current `system.tree` by canonical
`surface_id` and checked against `workspace_id`.

Raw output never leaves the server because it contains transcript paths, home directories, launch
arguments, stored process arguments, and other local metadata. The normalized client shape contains
only surface ID, agent kind/display name, lifecycle, update time, and confidence.

Multiple or stale records fail closed. `active_for_surface` plus membership in the current tree is
high confidence; ambiguous historical records may identify a candidate agent but yield `unknown`
status.

Lifecycle maps conservatively:

| cmux agent lifecycle | Dashboard state |
|----------------------|-----------------|
| `running` | `working` |
| `needsInput` | `needs_attention` |
| `idle` | `idle` |
| missing/ambiguous/`unknown` | `unknown` |

`idle` never implies `done`. Process lifecycle does not prove objective completion, and stale
`needsInput` records are possible. `done` and `error` require an authoritative notification/event or
remain `unknown`.

Agent hook events, surface changes, reconnect, and foreground transitions trigger a coalesced refresh;
a slow safety timer is sufficient because this is dashboard metadata, not terminal output.

The first implementation is one small reconciliation function, not a plugin framework. An adapter
interface is introduced only when a second provider contract actually requires it.

## Milestone 3 — Browser awareness

Browser surfaces already appear in `system.tree`. This milestone renders them as non-terminal rows
with workspace, title, URL, type, and connection state.

No browser RPC is exposed. Screenshot, refresh, navigation, snapshot, click, and type remain future
enhancements and require a separate security/design review.

## Error handling

- cmux unavailable: keep the authenticated app open, show disconnected state, and retry.
- Socket authentication failure: stop RPC retries until configuration changes; do not log the
  password.
- Invalid client input: reject before cmux with a generic typed error.
- Selected surface gone: cancel polling/input and return to the dashboard.
- Event replay gap: discard incremental assumptions and request a full tree snapshot.
- Backgrounded page: cancel timers; foreground performs discovery before resuming input.
- Slow terminal read: do not overlap requests; back off and retain the last visibly marked snapshot.
- Auth expiration: close WebSocket, clear live terminal data, and return to login.

## Security invariants

- No public bind or public tunnel by default.
- Tailscale is the network boundary; application authentication remains mandatory.
- No hardcoded credentials and no secret in URLs or browser storage.
- No arbitrary cmux RPC or CLI invocation from browser input.
- No implicit focused-target behavior.
- No terminal input/output, transcript paths, session arguments, or tokens in logs or caches.
- Request sizes, queue lengths, scrollback, polling, and reconnect work are bounded.
- Service worker cannot replay or cache authenticated commands.
- Browser surfaces are read-only metadata until separately designed.

## Development environment and dependencies

The committed devenv supplies Bun, Node.js, Git, and jq. `devenv up` runs client and server; named
scripts install dependencies and run tests, typecheck, build, and the combined check.

Dependency locks are committed. The implementation adds only the minimum missing development tools:

- one lightweight TypeScript/React linter because upstream has none;
- Playwright for deterministic browser E2E tests, including WebKit/iPhone emulation.

No application runtime dependency is added when the Web, Bun, React, or Node standard libraries cover
the requirement.

## Test strategy

### Unit and integration

- Auth token comparison, cookie validity/expiry, logout, and Origin enforcement.
- Unauthorized HTTP and WebSocket rejection.
- Exact RPC whitelist and rejection of missing targets, camelCase, unknown keys, invalid UUIDs,
  oversized text, invalid keys, and oversized messages.
- Unix-socket framing, password login, response correlation, queue bounds, failure, and reconnect
  against a fake socket server.
- Tree normalization across arbitrary workspace/pane/surface counts and surface types.
- Event replay, deduplication, burst coalescing, and gap-triggered snapshot.
- Adaptive terminal polling, one in-flight request, idle backoff, hidden-page stop, and immediate
  resume.
- Infinite WebSocket reconnect and foreground/network triggers.
- Terminal input and toolbar key mapping.
- Scroll/selection preservation around snapshot updates.
- Session-record sanitization, current-tree reconciliation, ambiguity, stale records, and unsupported
  command fallback before Milestone 2 ships.

### Browser E2E

Playwright drives the built PWA against a deterministic fake cmux Unix socket. Projects cover desktop
Chromium and an iPhone/WebKit profile.

Milestone 1 scenarios:

1. Login is required and an invalid token is rejected.
2. Arbitrary workspace and terminal surfaces appear without reload.
3. Opening a terminal renders scrollback and new output.
4. Typing, Enter, Ctrl-C, Ctrl-D, and arrows reach only the selected surface.
5. Back navigation returns to the dashboard and another terminal can be opened.
6. Closing the selected surface returns safely to the dashboard.
7. Offline/online and page hide/show reconnect, rediscover, and resume output.
8. Service-worker offline mode never represents cached terminal output as live.
9. Viewport and toolbar remain usable with an iPhone-sized visual viewport and software-keyboard
   resize simulation.

These E2E tests are part of the normal verification command once their fixture exists, not an
optional manual smoke suite.

### Real cmux and device validation

- Disposable test workspace with at least eight terminal surfaces.
- Rapid bounded output, idle shells, terminal switching, and dynamic create/close.
- Real input including Enter and Ctrl-C, with no command sent to the wrong surface.
- Safari and installed PWA on iPhone over the private tailnet.
- Background for at least ten minutes, then foreground.
- Network/Tailscale disconnect and reconnect.
- Negative requests without authentication and attempts to call non-whitelisted methods.

Real tests use disposable surfaces and never inject probes into existing work terminals.

## Milestone acceptance criteria

### Milestone 1

- All live terminal surfaces are discoverable with arbitrary workspace names/counts.
- A terminal can be opened, read, scrolled, selected, copied, pasted, and typed into from iPhone.
- Enter, Ctrl-C, Ctrl-D, Esc, Tab, and arrows target the exact selected surface.
- Back/switch flows work without losing the WebSocket session.
- Background/foreground and network loss recover without manual reload.
- No protected endpoint or WebSocket is usable without authentication.
- No non-whitelisted cmux method reaches the socket.
- Unit/integration tests, browser E2E, lint, typecheck, and builds pass.
- Eight-surface, rapid-output, idle, reconnect, and real-iPhone checks pass.

### Milestone 2

- Activity, preview, conservative lifecycle state, attention, and workspace counts are visible.
- Missing/stale/ambiguous agent evidence produces `unknown`, never a confident false state.
- `cmux sessions` absence or schema drift does not affect terminal control.
- No sensitive session JSON field reaches the browser or logs.

### Milestone 3

- Browser surfaces are clearly distinguishable with title and URL.
- Browser-control RPCs remain unavailable.

## Incremental implementation sequence

1. Establish reproducible checks, focused regression tests, and deterministic fake-cmux fixtures.
2. Secure bind, login/session cookie, WebSocket authentication, and Origin validation.
3. Replace the transparent relay with validated RPC schemas and a persistent cmux client.
4. Implement full tree discovery and lifecycle event refresh.
5. Build the dense terminal dashboard and navigation.
6. Enable terminal input, mobile toolbar, resize, scrollback, and adaptive polling.
7. Add foreground/network reconnect and correct PWA caching.
8. Add Playwright iPhone/WebKit E2E and perform real eight-terminal/iPhone verification.
9. Only then implement Milestone 2 session enrichment and dashboard states.
10. Add read-only browser awareness as Milestone 3.

Each step leaves the repository passing its relevant test, lint, typecheck, build, and E2E gates.

## Expected files for Milestone 1

Server changes stay primarily in:

- `server/src/index.ts`;
- `server/src/ws.ts`;
- `server/src/cmux-client.ts`;
- focused server tests, with a small auth module only when extraction improves direct testing.

Client changes stay primarily in:

- `client/src/App.tsx`;
- `client/src/components/Terminal.tsx`;
- a dense dashboard and mobile toolbar component;
- `client/src/hooks/useCmux.ts`;
- `client/src/hooks/useWebSocket.ts`;
- `client/src/lib/cmux-rpc.ts`;
- `client/src/global.css`;
- manifest, service worker, HTML, and committed PWA icons;
- focused unit/component tests and Playwright fixtures/specs.

README documents local development, Tailscale-only deployment, token generation, socket password,
threat model, and recovery behavior. The original MIT license and copyright remain intact.

## References

- [cmux CLI and socket API](https://cmux.com/docs/api)
- [cmux CLI contract](https://github.com/manaflow-ai/cmux/blob/main/docs/cli-contract.md)
- [cmux event stream](https://github.com/manaflow-ai/cmux/blob/main/docs/events.md)
- [cmux agent hooks](https://github.com/manaflow-ai/cmux/blob/main/docs/agent-hooks.md)
- [Agent lifecycle event proposal](https://github.com/manaflow-ai/cmux/issues/8951)
- [Stale attention-state report](https://github.com/manaflow-ai/cmux/issues/9863)
- [Process lifecycle versus objective lifecycle](https://github.com/manaflow-ai/cmux/issues/10942)
- [Unsafe target fallback report](https://github.com/manaflow-ai/cmux/issues/10910)
- [Upstream cmux-remote](https://github.com/hummer98/cmux-remote)
