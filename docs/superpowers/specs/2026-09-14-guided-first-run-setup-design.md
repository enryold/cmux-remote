# Guided first-run setup design

**Date:** 2026-09-14

**Status:** Approved

## Objective

Make the recommended one-iPhone Tailscale deployment understandable as a short first-run flow:
select the authorized iPhone, install the generated grant, enter the six-digit pairing code, and
save the PWA. The server's high-entropy cookie-signing key remains necessary, but the setup tool
generates and stores it without presenting it as a credential the human must copy or understand.

This design changes setup ergonomics only. The existing authentication, capability enforcement,
Origin checks, loopback bind, session cookie, RPC whitelist, and token-mode fallback remain
unchanged.

## Decisions

- A root `setup.js` provides the interactive first-run flow and runs under Bun.
- The implementation uses Node/Bun standard APIs and existing project code. It adds no dependency.
- `devenv shell -- setup` runs the wizard. `devenv shell -- start` builds the PWA and starts the
  production bridge from an existing configuration.
- The wizard automates only local, reviewable operations: inspecting Tailscale state, writing the
  ignored `.env`, copying a grant, building the PWA, configuring Tailscale Serve, and starting the
  bridge.
- The wizard never calls a Tailscale administration API and never edits the tailnet policy. The
  human pastes and saves the generated grant in the Tailscale administration console.
- `gibb.one/cap/cmux-remote` is the suggested project capability. It is a public identifier, not a
  secret, and the prompt permits a deployment-owned replacement validated by the server's existing
  capability-name rules.
- Existing `.env` and non-matching Tailscale Serve configurations are preserved rather than
  overwritten.

The alternative shell-only wizard was rejected because interactive parsing, JSON handling, secret
file creation, and tests would be more fragile. Direct tailnet-policy automation was rejected
because it would require administrative credentials and expand the security boundary.

## User flow

The first-run command is:

```bash
devenv shell -- setup
```

The wizard performs these steps in order:

1. Verify that it is running on macOS with Bun and the Tailscale CLI available.
2. Read `tailscale status --json`. Require a usable local MagicDNS name and IPv4 address, but do not
   rely on `Self.Online`, which is not consistently reported by the installed macOS client.
3. Normalize `.Peer` whether it is an object or absent. List peers whose OS is iOS and that have a
   Tailscale IPv4 address. Auto-select a single match only after showing it for confirmation; use a
   numbered prompt when several matches exist. Stop with instructions when none exists.
4. Propose `gibb.one/cap/cmux-remote` and accept an optional validated replacement.
5. Create or reuse the pairing-mode configuration described below.
6. Generate a grant whose source is the chosen iPhone IPv4 address, destination is the Mac
   Tailscale IPv4 address, port is `tcp:443`, and app capability is the chosen identifier with
   `{ "access": true }`.
7. Copy the grant to the macOS clipboard, print the Tailscale policy-console URL and a readable copy,
   then wait for the human to confirm that it was saved. Clipboard failure is non-fatal because the
   same grant remains visible in the terminal.
8. Build the production PWA.
9. Inspect `tailscale serve status --json`. Reuse an exact HTTPS root proxy to
   `http://127.0.0.1:3456` with the chosen capability. When no Serve configuration exists, install
   that configuration. If a different handler already owns the HTTPS endpoint, stop without calling
   `tailscale serve reset` or replacing it.
10. Start the Bun bridge in the foreground with the generated environment. Its existing startup
    message prints the six-digit, ten-minute pairing code.
11. Tell the human to open the derived MagicDNS HTTPS URL from the selected iPhone, enter the code,
    and use Safari's Add to Home Screen action.

On later launches the operator runs:

```bash
devenv shell -- start
```

Tailscale Serve remains a background configuration, so `start` rebuilds the PWA and runs only the
loopback bridge. `devenv up` remains the development workflow.

## Configuration file behavior

The wizard creates the root `.env` with mode `0600` and these values:

```dotenv
CMUX_REMOTE_TOKEN=<generated random server-only signing key>
CMUX_REMOTE_ORIGIN=https://<current-mac-magicdns-name>
CMUX_REMOTE_TAILSCALE_CAPABILITY=<selected capability>
```

The token is generated from 32 cryptographically random bytes, is written directly to the file, and
is never printed or copied to the clipboard. It is not entered on the iPhone. Persisting it keeps an
existing paired cookie valid across normal bridge restarts.

Creation opens `.env` exclusively with mode `0600`, so an existing file cannot be replaced. If
`.env` already exists, the wizard does not alter it. It may continue only when the current process
environment already contains a valid pairing configuration; otherwise it reports which required
variable names are missing or invalid without printing their values. This makes a completed
configuration reusable: a later `devenv shell -- setup` loads the preserved `.env` through devenv
and continues. If the initial write itself is interrupted, the partial file is preserved for manual
inspection rather than overwritten automatically.

Token login remains an advanced fallback when `CMUX_REMOTE_TAILSCALE_CAPABILITY` is absent. The
wizard never creates token-mode configuration.

## Components

### `setup.js`

Owns terminal prompts and orchestration. External commands are invoked with argument arrays rather
than interpolated shell strings. It exports the small pure parsing and rendering functions needed by
tests and executes the wizard only when it is the main module.

### Existing server configuration

The wizard reuses the server's capability-name and runtime-configuration validation rather than
maintaining a second permissive contract. If a small validator must become exported for reuse, its
behavior remains unchanged and keeps its existing tests.

### `devenv.nix`

Adds only the `setup` and `start` scripts and lists them in the development-shell help. The wizard
itself is responsible for subprocess exit codes and signal forwarding while the bridge is running.

### `README.md`

Moves the recommended path into an early `Getting started` section. That section presents Tailscale
device selection, the grant, the first pairing code, and PWA installation as the product setup. The
server-only signing key appears only as an automatically generated implementation detail. Detailed
security behavior, token fallback, full configuration, development, and testing follow in later
sections.

## Failure and safety behavior

- Invalid or missing Tailscale JSON, MagicDNS, IPv4 addresses, or iOS peers stops before changing
  local configuration.
- User selections accept only displayed indexes; capability names use the same bounded syntax as
  the server.
- The wizard never prints environment contents, cookie values, socket passwords, or the generated
  signing key.
- Existing `.env` content is never replaced or merged implicitly.
- Existing non-matching Serve configuration is never reset, cleared, or overwritten.
- A failed build prevents Serve changes and server startup.
- A failed Serve command prevents server startup and preserves `.env` for a later retry.
- Interrupting the foreground bridge terminates the child normally but leaves `.env` and the
  intended background Serve configuration intact.
- No rollback deletes material the wizard did not create. Diagnostics name the failed step and the
  safe command to retry.

## Test strategy

Focused Bun tests cover:

- Tailscale status with one, multiple, absent, or malformed iOS peers, including an absent `.Peer`;
- exact IPv4 selection and MagicDNS-origin derivation;
- capability defaulting and validation through the shared server contract;
- exact grant rendering with one source device, one destination device, `tcp:443`, and one app
  capability;
- `.env` creation with mode `0600`, sufficient secret entropy, and no secret in displayed output;
- refusal to overwrite an existing `.env`;
- recognition of an exact existing Serve handler and rejection of conflicting handlers;
- subprocess argument ordering and stop-on-error behavior through a fake command runner.

Tests never call the real Tailscale CLI, change the local Serve configuration, edit the clipboard,
or start the production bridge. The normal delivery gate remains `devenv shell -- check`; a manual
first-run smoke test uses a disposable `.env` location or clean checkout, the real selected iPhone,
and the existing release checklist.

## Documentation and lifecycle

The change updates `README.md`, `AGENTS.md`, `devenv.nix`, and the roadmap together. The dated
device-pairing specification remains historical; this specification clarifies how its server-only
signing key is provisioned without changing the pairing protocol.

## Non-goals

- Installing cmux, Tailscale, devenv, Bun, or Xcode tools.
- Renaming the Mac's Tailscale node or changing MagicDNS settings.
- Editing or fetching the tailnet policy through administrative APIs.
- Supporting multiple authorized phones in one setup run.
- Managing launchd, login items, background bridge processes, or automatic restarts.
- Resetting or multiplexing an unrelated Tailscale Serve configuration.
- Removing token-mode fallback or changing cookie/session semantics.
- Linux, Windows, Android, Funnel, public tunnels, or cloud relays.
