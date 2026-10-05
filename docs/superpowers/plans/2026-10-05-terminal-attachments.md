# Terminal attachments implementation

**Goal:** Upload files/images from the mobile composer and review their references before Send.
**Why planning is required:** New authenticated upload boundary writes files on the Mac through cmux.
**Acceptance:** No terminal input during upload; exact live terminal checks; bounded authorized
transfers; prompt preservation and cancellation; regression tests and the full repository check.

### Outcome 1: Installed cmux contract and protected transfer
- Work: Verify the installed native upload API with disposable data. Add one bounded attachment
  POST and wire it into server lifecycle, reusing session/Origin/capability and cmux socket helpers.
  Validate completed paths under cmux's server-owned cache and normalize failures.
- Risks/open questions: Capability advertisement alone is insufficient. Stop native integration
  if a real disposable upload cannot complete; reassess the narrow storage design.
- Verify: Native disposable byte round-trip; focused Bun upload-route tests.

### Outcome 2: Composer attachments with explicit Send
- Work: Add the native picker, sequential uploads, quoted prompt references, bounded selection,
  feedback and abort handling in the existing terminal/composer flow. Retain text on failures.
- Verify: Focused Vitest composer tests and Chromium/iPhone WebKit attachment flows.

### Outcome 3: Documentation and completion evidence
- Work: Update README and roadmap, inspect security-sensitive callers and final diff, leave
  lifecycle Developed/Live unverified until merge and actual hardware acceptance.
- Verify: `devenv shell -- check`; `git diff --check`.

## Verification — 2026-10-05

- Installed cmux 0.64.25 (106): disposable native upload and full authenticated HTTP uploads
  of a binary document spanning chunks and a PNG matched exact stored bytes. Upload alone
  left terminal text unchanged.
- `devenv shell -- check` passed: lint, 87 Bun tests, 77 Vitest tests, client/server typechecks,
  production build, and 31 Chromium/iPhone WebKit E2E tests. One existing Chromium test is
  intentionally skipped because its pairing flow runs on the iPhone WebKit project.
- The cmux integrated browser at 393 × 852 exercised the real composer with a disposable PNG.
  Its quoted reference appeared before Send, bytes matched, and browser errors were empty.
  The viewport was reset, disposable workspace/bridge closed, and generated native uploads removed.
- Reviewed the protected route, socket calls, prompt submission and cancellation flow, final diff,
  and documentation links. No generic RPC, arbitrary destination, shell fallback, or new dependency.
- Hardware iPhone photo/file-picker acceptance remains pending. At this verification, Developed/Live
  dates were unset because the change was not yet integrated or verified on the physical phone.

## Authorized service restart — 2026-10-05

The user explicitly requested restarting the bridge. Target: the existing per-user
`dev.cmux-remote.bridge` LaunchAgent on this Mac, using this repository's verified working-tree
implementation. Its `start` command rebuilds the PWA before launching Bun.

Run `devenv shell -- service-restart`, then verify a new listening bridge process on
`127.0.0.1:3456`, healthy cmux connectivity, and served production assets matching the build.
Probe the attachment route without credentials/data to verify its authorization boundary.
If startup or health fails, inspect only nonsecret service/process state and resolve startup
before claiming success; do not modify pairing secrets, tailnet policy, or discard source changes.
At restart, hardware iPhone acceptance and merge lifecycle dates remained pending.

Restart completed successfully with `devenv shell -- service-restart` from baseline `a969688`
plus the verified attachment working-tree changes. The new Bun listener serves on
`127.0.0.1:3456`, `/health` reports cmux connected, served HTML/JavaScript bytes match the
new production build, and a credential-free attachment POST returns `401 unauthorized`.

## Authorized GitHub publication — 2026-10-05

The user requested publishing the current work and a friendlier README explaining the fork's
improvements. Commit the verified attachments and documentation on the primary branch `master`,
then push to `origin` (`enryold/cmux-remote`) with a normal fast-forward push. A rejected push
must preserve the local commits; do not merge, rebase, or force-push to resolve it.

The full `devenv shell -- check` passed again before publication: 87 Bun tests, 77 Vitest tests,
and 31 Chromium/iPhone WebKit E2E tests, with the existing Chromium pairing test skipped.
Documentation link checks and `git diff --check` also passed. Hardware iPhone acceptance
remains pending; a Git push does not establish the Live lifecycle date.

The implementation and README improvements were integrated into `master` in commit `3edef8a`.
The roadmap now records Developed on 2026-10-05 and keeps Live unverified.
