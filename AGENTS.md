# cmux-remote Engineering Guide

**Last reviewed: 2026-09-14**

cmux-remote is a mobile command center for cmux terminal surfaces. cmux remains the primary work
environment; this repository must not grow into a web IDE, generic SSH service, file manager, Git
client, cloud relay, or full remote browser.

## Sources of truth

When references disagree, use this order:

1. Code, tests, and runtime configuration.
2. [`README.md`](README.md) and this guide.
3. [`docs/superpowers/ROADMAP.md`](docs/superpowers/ROADMAP.md) and its linked specifications.
4. Dated files under `docs/superpowers/{specs,plans}`.
5. Older files under `docs/` and `README.ja.md`, which describe the upstream prototype.

Dated plans record decisions at a point in time. Verify current behavior in code before relying on
them.

## Roadmap lifecycle

Before planning, implementing, reviewing, or shipping a tracked feature, read the roadmap and its
governing specification.

- Add an approved specification to the roadmap with its `Created` date.
- Set `Developed` only after implementation is complete and merged into `main`.
- Set `Live` only after verification on the target Mac and iPhone PWA.
- Set `Removed` without deleting the historical row or specification.
- Use ISO `YYYY-MM-DD` dates and `—` for events that are unverified or have not happened.
- Maintenance fixes need a roadmap update only when they change a tracked lifecycle state or have a
  dedicated feature specification.

## Architecture

```text
iPhone Safari / PWA
        | HTTPS, paired session, Tailscale app capability
        v
server/  Bun + Hono + WebSocket bridge on 127.0.0.1
        | validated RPC whitelist
        v
cmux Unix socket
        |
        +-- workspace -> pane -> terminal/browser surfaces
```

- `client/`: React 19, TypeScript, Vite, xterm.js, PWA assets, hooks, and unit tests.
- `server/`: configuration, authentication, Tailscale capability enforcement, cmux socket clients,
  RPC validation, WebSocket bridge, and Bun tests.
- `e2e/`: Playwright flows against a deterministic fake cmux Unix socket.
- `docs/superpowers/`: product lifecycle, approved specifications, and implementation plans.

Topology events refresh discovery. Only the selected terminal is read, using adaptive polling while
output streaming is unavailable. Browser surfaces are discovered but are not remotely controlled in
Milestone 1.

## Security invariants

Remote access can be equivalent to shell access on the Mac. Never trade away these boundaries for
convenience:

- Bind to `127.0.0.1` by default; do not introduce a public bind or tunnel default.
- Keep secrets in the ignored `.env` or a password manager. Never commit or log tokens, pairing
  cookies, socket passwords, Tailscale IPs, or private tailnet hostnames.
- Preserve exact-Origin validation and the HttpOnly, Secure, SameSite session boundary.
- In pairing mode, require the configured Tailscale app capability on every protected HTTP request
  and WebSocket upgrade.
- Keep browser-facing RPCs as an explicit, validated whitelist. Never expose an arbitrary cmux RPC,
  CLI command, shell spawn, or browser-control proxy.
- Bound all client-controlled strings, read sizes, queue sizes, and socket frames.
- Do not cache authentication, API, WebSocket, or terminal data in the service worker.
- Prefer documented cmux APIs. Verify the installed CLI/socket contract before adopting recent or
  private methods.

## Development environment

Use the repository devenv for Bun, Node, builds, tests, linters, and generators:

```bash
devenv shell -- deps
devenv up
```

The development server is available at `http://localhost:5173`; Vite proxies protected routes to the
Bun bridge. Runtime secrets belong in an ignored `.env`, as documented in `README.md`.

Useful checks:

```bash
devenv shell -- lint
devenv shell -- test-all
devenv shell -- typecheck
devenv shell -- build-all
devenv shell -- e2e-deps
devenv shell -- e2e
devenv shell -- check
```

## Testing policy

- Every behavior change needs the smallest focused regression test that fails before the fix.
- Client logic and components use Vitest; server boundaries and socket behavior use `bun test`.
- User-visible flows, reconnect behavior, and mobile layout use Playwright in both Chromium and
  iPhone WebKit.
- Complete functional work with `devenv shell -- check` and inspect the final diff.
- Documentation-only changes require link/command review and `git diff --check`; they do not require
  an application rebuild unless behavior or generated assets also changed.
- Keep the fake cmux contract representative of complete real responses rather than mocking UI
  internals.

For a real smoke test from an agent running inside cmux, use the integrated browser. Check
`cmux capabilities --json` first; if socket access is restricted, enable Automation under
**Settings → Automation → Socket control mode**.

```bash
cmux identify --json
cmux browser open http://localhost:5173 --workspace workspace:<id> --focus false
cmux browser surface:<id> wait --load-state complete --timeout-ms 15000
cmux browser surface:<id> viewport 393 852
cmux browser surface:<id> snapshot --interactive --compact
cmux browser surface:<id> errors list
cmux browser surface:<id> viewport reset
```

Never run E2E input against a valuable shell. Use disposable workspaces and surfaces, and restore
any viewport override when the check ends.

## Change discipline

- Preserve the upstream MIT license and copyright notice.
- Keep changes small and separable enough for an upstream pull request.
- Reuse existing helpers and platform behavior before adding dependencies or abstractions.
- Do not hardcode workspace names, surface counts, device IPs, origins, or agent brands.
- Do not add Codex- or Claude-specific output parsers in Milestone 1. Future status adapters must
  degrade safely to `unknown`.
- Do not begin browser-surface control until terminal discovery, output, input, and reconnect remain
  reliable.
- Preserve unrelated user changes in a dirty worktree.

## Documentation maintenance

Update authoritative documentation in the same change as observable behavior:

- product, setup, and current behavior: `README.md`;
- coding-agent rules: `AGENTS.md`;
- lifecycle status: `docs/superpowers/ROADMAP.md`;
- design decisions and implementation history: dated specifications and plans.

`CLAUDE.md` is only a compatibility entry point and must continue to delegate to this guide rather
than duplicate it.
