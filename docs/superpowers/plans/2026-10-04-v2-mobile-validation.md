# Milestone 2 execution and validation — 2026-10-04

Execution was authorized by the user on 2026-10-04. Work is isolated on
`feat/v2-mobile-controls`; no merge, push, production launch, or Live event has occurred.

## Delivered scope

- One configurable Shortcuts menu combines finite named keys, saved commands, and toolbar favorites.
  Ctrl-C/Ctrl-D are optional entries with descriptions; Shift+Left/Shift+Tab are supported.
- Ordered exact-terminal submissions send text followed by a named Enter, cancel on target/connection
  changes, and never retry or replay automatically. Empty composer Enter and IME guards are covered.
- Snapshots coalesce through writes, touch gestures, and selection; Latest is local. Font settings
  persist locally at 10–24 px and refit the existing terminal. Invalid fitted viewport geometry clears
  the prior Mac override instead of leaving a rejected resize active.
- Typed discovery includes browser/native/unknown panels. Browser previews capture only the exact
  current panel, with Refresh and local 25%–300% zoom/pan. Bytes stay in memory; disconnect, type
  changes, removal, and auth expiry invalidate them. No browser control or file access was added.

## Verification

`devenv shell -- check` passed on the final functional tree:

- lint: 85 files, no errors;
- client: 72 tests in 20 files;
- server: 56 tests in 12 files;
- setup: 21 tests; LaunchAgent: 3 tests;
- client/server typechecks and production build;
- Chromium and iPhone WebKit: 23 E2E passed, 1 intentional Chromium skip of the iPhone pairing test.

The production bundle retains Vite's existing large-chunk warning; it does not fail the build.
The complete output was inspected, including each typecheck, rather than relying only on the
aggregate shell exit code. `git diff --check` also passed.

A fresh whole-branch review by `gpt-5.6-sol` with `xhigh` reasoning found no Critical or Minor issues
and four Important issues. All four were reproduced with focused failing tests, fixed, and verified
with the full suite: stale connection effect, same-UUID preview type transition, invalid fitted
viewport dimensions, and hidden partial-acknowledgement warnings in the shortcuts sheet. The review
was read-only; fixes were verified by tests without a second reviewer.

Real cmux `0.64.25 (106)` (`b685a275c`) was exercised only with disposable public content and a raw
input probe. The integrated browser remained hidden, so the UI smoke used Playwright at 393×852
against the actual local bridge/cmux socket. Screenshot decoding, local zoom, Refresh, Back, font
change, Shift+Left (`ESC[1;2D`), and composer text followed by Enter (`0D`) passed. All viewport
emulation was reset and temporary servers/panels were removed. No private browser was captured,
no launcher was run in a valuable shell, and no real credentials were used in the smoke bridge.

## Remaining acceptance and dependency

Native Markdown/image content reads remain blocked. A fresh probe with nonexistent IDs returns
`internal_error: v2 worker method 'mobile.panel.artifact.stat' has no worker handler`, despite the
advertised capability. `system.tree` supplies no authorized native content descriptor. Preview
Task 4 remains unchecked; no filesystem fallback or cmux fork was introduced. The complete native
Markdown/image/browser viewing request is therefore not complete.

The target iPhone PWA still needs the governing specs' real-device checklist, including the user's
actual Codex/Claude menus, software Return/IME/paste, touch scrolling, font/keyboard layout, long
backgrounding, and Tailscale reconnect. Automated iPhone WebKit is not hardware acceptance.
Developed/Live dates remain `—` until merge and the applicable target-device checks.

## Execution decisions

- Execute inline with one fresh final reviewer: matches the authorized saved plans. Cost if wrong:
  fewer independent review passes during implementation.
- Keep hardware acceptance pending and use WebKit plus a disposable actual-cmux smoke: evidence is
  reproducible without claiming access to the phone. Cost if wrong: phone-specific defects may remain.
- Read font size through the existing settings prop: avoids a second source of truth. Cost if wrong:
  a future independent font API requires a small interface change.
- Keep the sheet open for an unconfirmed command and show a sticky warning inside it: preserves the
  explicit retry decision while making ambiguity visible. Cost if wrong: one extra Close action.

No minor findings were deferred and no review findings were declined.
