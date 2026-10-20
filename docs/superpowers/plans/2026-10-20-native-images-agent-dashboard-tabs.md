# Native images, agent dashboard, and tab actions

**Goal:** implement the authorized v2 image subset, v3 dashboard and explicit terminal tab actions.
**Why planning is required:** new mutation contracts and native-content authorization cross the
browser/cmux trust boundary; the working tree also contains unrelated Cloudflare Access work.
**Governing spec:** [2026-10-20 design](../specs/2026-10-20-native-images-agent-dashboard-tabs.md).

## Outcome 1: bounded native image previews

Extend the existing provider, reuse the protected endpoint and image viewer, verify exact inventory
ownership/path before and after reading, normalize JPEG thumbnails, retain unsupported Markdown.
Update complete real-contract fixtures and focused server/E2E tests.

## Outcome 2: conservative live dashboard

Normalize structured mobile metadata onto the authoritative tree; render agent states, notification
summary, activity and counts. Reuse existing refresh scheduling, bound metadata work and strings,
and invalidate old/disconnected evidence without disrupting terminal access.

## Outcome 3: explicit create/close controls

Extend the strict RPC whitelist only for terminal creation and confirmed surface close. Validate
live workspace/pane/surface association, keep upstream options server-owned, serialize with input,
and avoid automatic replay. Add accessible mobile controls and post-action topology refresh.

## Outcome 4: verification and delivery

Keep measured red/green evidence for focused boundary tests. Run `devenv shell -- check`, including
Chromium and iPhone WebKit, inspect mobile/desktop UI, review security contracts and the final diff,
and update README/roadmap without inventing merge or hardware acceptance. Work in the current
checkout with targeted edits; a temporary baseline snapshot preserves attribution of existing work.
No service restart, deployment, commit or merge is included in this request.

## Implementation and validation — 2026-10-20

All four outcomes are implemented locally. Native images reuse the existing protected preview
route/viewer and return validated JPEG thumbnails; Markdown/original reads remain unavailable.
The dashboard normalizes structured metadata on a separate one-second socket and shows unknown
after failure, ambiguity, disconnection or 45 seconds without fresh evidence. Tab actions require
exact live membership, fixed creation options, explicit close confirmation and no replay.

Focused tests reproduced missing native capture, missing dashboard normalization, missing action
whitelisting, path-bearing agent identity leakage and out-of-order topology overwrite before their
fixes. The final `devenv shell -- check` passed: lint (99 files; three pre-existing informational
template-literal suggestions), 80 client tests, 83 server tests, 21 setup tests, 3 LaunchAgent tests,
both typechecks and production builds, and 41 Chromium/iPhone WebKit E2E passes with one intentional
Chromium skip of the phone-only pairing test. Vite retains its pre-existing large-bundle warning.
The full log was inspected for failures and TypeScript errors; `git diff --check` and documentation
links passed. The UI detector returned no findings; desktop/mobile dashboard and mobile image
captures were inspected.

A disposable real-cmux probe confirmed `surface.create`/`surface.close` response identities and
last-surface `invalid_state`. A second probe ran the implemented preview provider against a saved
public native image and returned the expected 96×48 JPEG without a filesystem path. Both disposable
workspaces were removed. No valuable shell received input or browser content was captured.

Pre-existing Cloudflare Access implementation/tests remain byte-identical to the saved baseline;
the shared README, AGENTS and roadmap retain those additions alongside this change. No dependency
was added. No commit, merge or service restart occurred. Developed/Live dates remain unverified;
target iPhone hardware acceptance remains outstanding.

## Follow-up: create icon and live-service mismatch

The user requested a circled-plus create button and reported an unconfirmed creation notice that
could not be dismissed. Inspection found that the listening bridge process started at 12:51,
before the 21:33/21:41 RPC/handler changes; its production command does not watch source changes.
The frontend build was newer than the running server. The error path also collapsed unsupported
methods into an ambiguous acknowledgement and rendered a notice without a dismissal action.

Replace the workspace/header create affordance with an accessible circled-plus icon, make action
notices dismissible and clear them on navigation, and distinguish unsupported bridge methods from
ambiguous input acknowledgements. Keep explicit retry and all mutation safeguards. Add focused
client regressions and desktop/iPhone WebKit E2E for the failed-create/dismiss/navigation flows.
After `devenv shell -- check`, restart the existing `dev.cmux-remote.bridge` LaunchAgent using the
repository command, preserving its ignored configuration and paired-session secret. Verify a new
listening process and bridge availability; retain original configuration and a recovery source
snapshot if startup fails. No valuable terminal receives smoke-test input, and no commit/merge or
network-policy change is part of this repair. This supersedes the earlier no-restart scope for this
user-authorized runtime fix; target iPhone acceptance still requires the user's device.

The focused red run reproduced all three regressions before implementation; the green run passed
11 client tests and four Chromium/iPhone WebKit E2E cases. The final full check passed lint,
82 client tests, 83 server tests, 21 setup tests, 3 LaunchAgent tests, both typechecks/builds and
43 E2E cases, with the existing intentional Chromium pairing skip. Existing lint infos and the
Vite bundle-size warning remain. Desktop/iPhone notice captures and the final diff were inspected.

`devenv shell -- service-restart` succeeded. The sole loopback listener changed from PID 10682
to 50790, started at 22:03 on 2026-10-20; launchd reports running. Configuration and LaunchAgent
hashes are unchanged. An unauthenticated local health request correctly returns Access's 403;
this verifies availability and the authentication gate, not an authenticated phone session.
A restricted temporary recovery snapshot was saved before restart. Existing Cloudflare Access
implementation/tests remain byte-identical to the original baseline. No commit or merge occurred;
physical iPhone acceptance remains unverified.

## Follow-up: direct entry, notification bells and inactive tabs

The user requested direct mobile entry after creation, a yellow bell on the notification's exact
terminal instead of workspace preview text, and an expandable `Inactive tabs (X)` group above two
inactive tabs. This changes dashboard data across the socket boundary, so record the contract here
before implementation. Real read-only probes confirm `notification.list` returns `workspace_id`,
`surface_id` and `is_read`; mobile workspace previews alone do not identify their source terminal.
A disposable create probe found the new terminal in the first three topology responses.

Keep the existing exact-ID create/navigation flow and verify it explicitly through App and E2E.
Join unread notifications only to a unique live terminal in their stated workspace, export only a
boolean, remove workspace message previews, and retain the isolated metadata socket's total deadline.
Show a yellow bell for unread notifications or structured needs-attention state; opening its row
enters that terminal locally without focusing the Mac or acknowledging notifications globally.
Collapse more than two unselected surfaces without working/attention evidence; selected, working
and bell-bearing surfaces stay visible and promotion out of the group happens on refresh.

Acceptance: focused failing tests for association/privacy, expiry/disconnect, grouping thresholds,
expansion and newly attentive tabs; App direct-entry coverage and desktop/iPhone WebKit E2E; full
`devenv shell -- check`, batched visual inspection and final diff review. Update the governing spec
and README. Apply the tested checkout to the same local LaunchAgent, preserving configuration and
keeping a restricted recovery snapshot; verify a fresh sole loopback listener and the auth gate.
Stop and restore service if startup fails. No merge, commit, valuable-shell input or policy changes.

Validation completed: focused red tests reproduced missing unread association, missing bells/grouping
and retained unread evidence after disconnect. The stateful App regression confirms the existing
direct-entry flow already works after creation/discovery; no speculative navigation rewrite was
needed. Focused Chromium/iPhone WebKit cases passed for creation, grouping, keyboard expansion,
promotion of an unread tab and exact-terminal entry from its bell. The full suite exposed a test
helper using indices from a shrinking set of closed groups; it now targets stable group elements.
The final `devenv shell -- check` passed lint (three existing infos), 86 client tests, 89 server tests,
21 setup tests, 3 LaunchAgent tests, both typechecks/builds and 45 E2E cases, with the existing
intentional Chromium pairing skip. Vite's existing bundle-size warning remains. Both desktop and
iPhone captures were inspected; icon spacing was corrected and verified in the second/final pass.

A read-only real-contract smoke normalized three workspaces and 22 surfaces, including one unread
terminal, without exporting notification messages or native paths. The disposable creation workspace
was removed and no input was sent. Existing Cloudflare Access files remain unchanged from baseline;
documentation links and `git diff --check` pass.

The existing LaunchAgent was restarted successfully at 22:23 on 2026-10-20. Its sole loopback listener
changed from PID 50790 to 95549; configuration/session-secret and LaunchAgent hashes are unchanged.
The local unauthenticated endpoint still returns the expected Access 403. Restricted previous/target
runtime snapshots are available for recovery. Authenticated acceptance on the physical iPhone remains
unverified; no lifecycle dates, merge or commit were asserted.

## Follow-up: compact terminal and installed-PWA height

The user approved the dashboard and requested lighter terminal controls, a slightly smaller font,
and removal of the bottom gap on their iPhone running iOS 26.6.2. Reduce the default font from 13
to 12 px while preserving saved preferences; use compact SVG attachment/send actions and quieter
12 px shortcut labels, retaining 44 px touch areas and a 16 px input to avoid focus zoom.
Keep the existing two-row controls and all input/attachment/scroll behavior.

The screenshot's bottom gap is compatible with installed-PWA viewport sizing bugs. WebKit
[254868](https://bugs.webkit.org/show_bug.cgi?id=254868) documents the standalone `100vh` workaround;
[301994](https://bugs.webkit.org/show_bug.cgi?id=301994) also records system-owned gaps that DOM
layout cannot reclaim. Use dynamic height in browser tabs and a standalone-only full-height fallback
through the root containers; preserve safe areas. Do not claim the user's hardware gap fixed without
device confirmation or replace keyboard sizing with speculative JavaScript.

Acceptance: focused red/green preference/icon tests, compact/touchable controls and viewport bounds
in Chromium/iPhone WebKit (including shorter and landscape views), existing input/reconnect/scroll
coverage, full check and at most two visual passes. Update README and governing mobile-usability
spec. Snapshot current static assets before publishing the tested build; restore them if validation
fails. The frontend is served from disk, so no backend restart/configuration change is needed.
Preserve existing work, saved commands/favorites, authentication/session secrets and lifecycle dates.

Validation completed: four focused unit regressions failed before the change for the old font/default
increments and text/emoji composer actions; the new layout E2E failed on the old 13 px default in
both engines. The green focused run passed 18 client tests and six Chromium/iPhone WebKit cases.
Final `devenv shell -- check` passed lint (three existing infos), 87 client tests, 89 server tests,
21 setup tests, 3 LaunchAgent tests, both typechecks/builds and 47 E2E cases with the existing
intentional Chromium pairing skip. Vite's existing bundle-size warning remains. E2E measures 93 px
controls, 44×44 action targets, 16 px input and 12 px output/shortcut labels; footer/overflow bounds
pass at 393×852, 393×600 and 852×393. Saved 13 px and customized sizes remain valid.

Desktop/mobile captures were inspected in one combined pass. No new dependency, input behavior or
Mac viewport override was introduced. The standalone workaround is limited to iPhone WebKit feature
support; Chromium's display-mode override probe did not emulate standalone, and desktop WebKit
does not reproduce an installed iOS PWA. The user's iOS 26.6.2 bottom gap therefore remains pending
physical confirmation; an optional reopen/verify question was sent after the build was ready.

The new hashed JS/CSS assets are present in the served directory. Bridge PID 95549 stayed running,
configuration/LaunchAgent hashes are unchanged, and unauthenticated health still returns Access 403.
The prior UI bundle has a restricted temporary recovery snapshot. Existing Access implementation
files remain unchanged from baseline; documentation links and `git diff --check` pass. No restart,
commit, merge or new lifecycle date was necessary.

The user subsequently confirmed on their physical iPhone (iOS 26.6.2) that closing/reopening the
updated PWA makes it reach the bottom. They requested removal of the duplicated connection label
beside Surfaces and horizontal centering of the footer indicator. Remove that label and its unused
styles, center the existing footer, and extend the existing Dashboard/layout regressions; keep every
connection state and authentication behavior unchanged. Focused client and both-engine E2E checks
first reproduced the old duplicated label before this adjustment.

The final adjustment passed the focused Dashboard regression and a fresh full check with the same
87 client / 89 server / 21 setup / 3 LaunchAgent / 47 E2E passes and one intentional pairing skip.
Desktop/iPhone dashboard and terminal captures confirm the top duplicate is gone and the footer
indicator is centered (second/final visual pass). The built UI is available from the existing bridge;
saved font choices remain untouched. Physical keyboard-open behavior remains unverified, while the
user's reopened PWA bottom-edge acceptance is confirmed. No feature-wide Live date was inferred.

## Follow-up: vertical footer centering

The user requested vertical as well as horizontal centering. The bottom safe-area padding pushed
the status group 16.5 px above the footer center with a 34 px inset. A focused E2E reproduced this
using Chromium's real safe-area environment override; ordinary WebKit still covers zero-inset layout.
Include the safe area in the footer's minimum height instead of bottom padding, preserving the
space beneath terminal controls. Verify the label center against the footer bounds, run the full
check and inspect desktop/mobile captures. Prior static assets have a restricted recovery snapshot;
this UI-only change needs no backend restart, configuration change or lifecycle date.

Final full check passed: 87 client, 89 server, 21 setup, 3 LaunchAgent and 47 E2E cases with the
existing intentional Chromium pairing skip; lint/typechecks/builds and `git diff --check` pass.
The shipped layout is within one pixel of vertical center with the simulated 34 px inset and
without an inset. Desktop/mobile captures were inspected together; no further visual changes were
needed. The exact physical iPhone placement after this final adjustment remains unverified.

## Follow-up: contextual quick keys, focus and terminal spacing

The user requested immediate right-side question keys below Send: Codex uses Shift+Left/Enter/Esc;
they confirmed Up/Down/Enter/Esc for Claude Code. Runtime metadata exposes the exact sources `codex`
and `claude_code`. This explicitly authorizes those two presentation profiles, using only structured
source identity; unavailable/unknown identity retains saved favorites without parsing titles/output.
Pass the selected source through App → Terminal → Toolbar. Keep contextual keys fixed at the right,
the menu opener at the left, and remaining favorites horizontally scrollable without duplicates.
Show contextual keys as always visible in the sheet, preserving the stored favorite document.

The keyboard bug is traced to Terminal's shortcut handler unconditionally calling xterm.focus().
Remove that call; explicit tapping/typing in the terminal or composer keeps its normal input behavior.
Keep exact-surface dispatch, confirmation/no-replay rules and all disconnect/busy guards intact.
Polish the existing Shortcuts sheet with the established flat dark palette, SVG actions, keyboard
focus trap and mobile touch areas. Add a small responsive gutter to terminal output/controls and
keep xterm fitting and local scrolling reliable. Preserve the dashboard and PWA full-height fix.

Acceptance: red/green focus and contextual-key tests, E2E for both agents' fixed keys and exact input
with no editable-element focus after shortcut taps, responsive gutter and sheet controls, existing
favorites/commands/font persistence, full check and at most two batched desktop/mobile visual passes.
Update README, the mobile-usability spec and the narrow approved-profile exception in AGENTS.
Save prior static assets for recovery; UI-only delivery needs no bridge restart or secret changes.

Completed locally: canonical source profiles select fixed question keys; remaining favorites scroll
without changing stored preferences. A semantic fieldset groups the fixed controls. Shortcut actions
no longer focus xterm's editable input. The inset sheet retains command editing, font controls,
focus trapping and offline behavior; the terminal and composer share a safe-area-aware side gutter.

Fresh final `devenv shell -- check` evidence: 91 client, 89 server, 21 setup and 3 LaunchAgent tests
passed, plus 51 Chromium/iPhone WebKit E2E passes and the existing intentional Chromium pairing skip.
Lint has only the three pre-existing attachment-test style infos; typechecks and production builds
pass. The existing Vite chunk-size warning remains. Both agent profiles were checked at 320/393 px,
including exact surface/key dispatch and no editable focus from real touch events. Two batched
desktop/mobile visual passes confirm terminal gutters and sheet layout. Local documentation links
and `git diff --check` pass. Original Cloudflare implementation/tests and runtime configuration are
unchanged; prior static assets are saved for recovery and updated assets are built in place.
The unauthenticated loopback root correctly remains protected (403); no authenticated production
smoke or physical iPhone keyboard check is claimed. No commit, restart or lifecycle date was added.

## Follow-up: close inactive tabs and preserve terminal colors

User-authorized scope: an upper-right “Chiudi tutte” action appears only when an inactive group is
expanded. Confirm once with the count/workspace and existing process/unsaved-work warning. Capture
the displayed IDs, serialize existing exact-surface closes, recheck current topology before each,
skip tabs that became selected/working/attentive, and stop on error, disconnect or navigation.
Never include newly appeared tabs or replay uncertain closes; preserve cmux last-tab protection.

The installed 0.65.2 socket returns plain text from `surface.read_text` and full styled spans from
`terminal.replay` (`cmux.render-grid.v1`, screen anchor, up to 2,000 scrollback rows). Keep the public
RPC whitelist unchanged. The bridge may read replay only for the requested terminal and convert
bounded, identity-checked full-grid spans into text plus generated SGR color/attribute codes. Reject
controls and malformed/overlapping geometry; never forward raw VT/OSC, theme metadata or arbitrary
upstream fields. Use existing app defaults for default colors and preserve explicit foreground,
background and emphasis. Unsupported/invalid capture falls back to the current plain-text read.
Keep local fit, polling, scrolling, no-input-from-output and no-replay behavior unchanged.

Acceptance: red/green tests for the bulk action and cancellation/partial failure/revalidation, strict
styled-snapshot decoding and safe fallback; Chromium/iPhone WebKit confirmation, current-only bulk
closure and real colored xterm cells. Verify the real installed grid without printing terminal text,
run the complete check, inspect the scoped diff and at most two desktop/mobile visual batches.
Save current source/static assets before publishing. The color bridge change requires restarting the
existing target bridge after validation, preserving configuration and verifying health/protection;
restore saved source/assets and restart if rollout fails. No lifecycle date without merge/device QA.

Final evidence: focused failures reproduced the missing bulk action, loss of colors, stalled color
capture and accidental replay attachment to stopped terminals. The bridge now completes its plain
read first, then bounds color capture to 500 ms; malformed, unsupported or slow captures retain that
plain result. The installed socket accepted the decoder, including explicit red/green foreground
and background values from a disposable unfocused workspace, closed after capture. No valuable
terminal received test input. A scoped read-only diff review checked exact targets, lifecycle guards,
SGR generation, bounds and fallback; existing authentication/RPC validation remains intact.

Fresh full check passed: 94 client, 113 server, 21 setup, 3 LaunchAgent tests, and 55 E2E passes plus
the existing intentional Chromium pairing skip. Lint has only the three existing attachment-test
infos; typechecks/builds pass, retaining the existing Vite chunk warning. The bulk action appears
only when expanded, aligns upper right, confirms once, preserves visible active tabs and closes
only captured inactive IDs. Desktop/iPhone WebKit captures confirm colored text/background/emphasis,
Unicode and button placement (one batched visual pass).

Saved source/static assets remain available for rollback. The existing LaunchAgent was restarted;
its new Bun listener belongs to this repository and remains on loopback. Uncredentialed `/health`
still returns 403, and configuration/LaunchAgent files match their protected hashes. Full authenticated
production/iPhone visual acceptance is not claimed. No commit, merge or lifecycle date was added.

## Follow-up: local prompt drafting

The user reported visible typing latency and explicitly chose local prompt drafting followed by
Return. Direct xterm input waits for the Mac round trip and a polled snapshot; the existing composer
already keeps drafts local. A new two-browser regression passes on Chromium and iPhone WebKit:
remote output does not steal composer focus, keystrokes emit no input RPC and Return sends one
whole text then Enter. Make output read-only, mark xterm's helper textarea read-only/inputmode none
to avoid opening the phone keyboard on output taps, and remove the unused direct-input listener,
composition/paste plumbing and decoder. Keep output selection/copy/scroll, immediate shortcut keys,
IME-safe composer submission and existing confirmation/no-replay guards. Update the former direct
typing E2E to assert output cannot send text. Save current static assets; this client-only change
requires no bridge restart. Verify focused red/green coverage and the full repository check.

Completed locally: the focused regression reproduced writable xterm input before the change and
passes with read-only output/helper input. Removed the unused raw-input path and decoder; composer
drafting, submission/IME guards and immediate shortcuts remain. Fresh full check passed: 94 client,
113 server, 21 setup, 3 LaunchAgent and 57 E2E cases, plus the existing intentional Chromium pairing
skip. Both engines verify no RPC during local typing or attempted output typing, one whole prompt
then Enter, and stable focus/draft while a second viewer produces output. Scrolling, colors and
reconnect coverage still pass. Lint/typechecks/builds, local documentation links and diff checks pass;
only existing lint infos/chunk warnings remain. Updated assets are built in place, with previous
assets saved for recovery and runtime configuration unchanged. No backend restart, commit or new
lifecycle date. Physical iPhone keyboard behavior and perceived latency still need user acceptance.

## Follow-up: three-line composer and focused writing layout

The user's 2026-10-20 iPhone capture requests three visible draft lines and removal of shortcut/footer
chrome while typing. Use a native three-row textarea with internal scrolling, Shift+Return newline
and existing Return/Send semantics. CSS derived solely from composer focus hides the shortcut strip
and footer and restores them on blur, retaining safe-area padding and visible errors. Keep the
dashboard and root PWA height rules unchanged. Current-only local drafts, uploads, IME and ambiguous
submission guards remain intact. Focused unit/E2E regressions reproduced the one-line field and
visible chrome before the change. A restricted static/source recovery snapshot precedes builds.
Validate multiline dispatch, focus/blur restoration, actual freed terminal height, 34 px simulated
safe area and responsive layouts, then complete the full check and batched visual QA. UI-only delivery
needs no bridge restart and no new lifecycle date; physical keyboard geometry remains a device check.

The 2026-10-21 follow-up also requests native suggestions and correction. The prompt explicitly
disabled autocorrection/spellchecking; a focused test reproduced that configuration. Enable both
native features in the same textarea, respecting system keyboard settings and leaving saved-command
editing unchanged. Browser form-history autofill stays disabled; it is separate from predictions.
Preserve composer focus on mouse-down for attachment/Send without cancelling native touch gestures;
iPhone WebKit coverage uses real taps for file selection and Send.

The first complete check exposed three older WebKit flows that accessed shortcuts/footer while
the composer could still retain focus after submission. Their traces show successful input followed
by intentionally hidden controls. Those flows now leave editing before invoking shortcuts or
checking the footer; all eight affected Chromium/WebKit cases pass. Do not force keyboard dismissal
after every Send or rely on incidental blur from the submitting state.

Completed locally: fresh `devenv shell -- check` passed 96 client, 113 server, 21 setup, 3 LaunchAgent
and 59 E2E tests, with the existing intentional Chromium pairing skip. Lint/typechecks/builds pass;
only the three existing attachment-test infos and existing Vite chunk warning remain. Both engines
verify three visible lines, exact multiline dispatch, native correction attributes, focus/blur chrome
restoration, attachment/Send activation, freed output space and responsive layouts. Final batched
visual QA confirms focused/idle iPhone layout and focused desktop layout, preserving padding and
44 px actions. Scoped source diff, local documentation links, protected configuration hashes and
`git diff --check` pass. Updated static assets are built in place; no bridge restart, commit or
lifecycle date was added. Physical iPhone keyboard geometry, predictive suggestions and correction
acceptance remain unverified and depend on system keyboard settings.

## Follow-up: compact colored terminal padding

The user's 2026-10-21 screenshot shows the remote agent's three-row prompt expanding into a large
gray block above the local composer. An exact-target, read-only installed-socket probe found three
181-cell rows: two contain only spaces and the middle contains 25 nonblank characters. Generated
SGR makes the existing client `trimEnd()` ineffective, so desktop padding wraps repeatedly on mobile.
Remove trailing blank cells during validated color serialization, retaining row separators, leading
and interior spacing, text, styling, menus and all span validation. No agent-brand/output parser,
hidden content, remote resizing, configuration change or new dependency is needed.

This record is required because the fix changes bridge output and needs a live bridge restart.
Acceptance: a representative wide colored-prompt regression fails before the fix; focused Bun and
Chromium/iPhone WebKit tests then prove compact rows, preserved colors/Unicode and menu text. Run the
full check and inspect the scoped diff, with at most two desktop/mobile visual batches. Source and
static assets are saved for recovery. After validation, restart only this repository's existing
loopback LaunchAgent, verify process/health/auth protection and unchanged protected configuration;
restore source/assets and restart if rollout fails. No lifecycle date without merge/device acceptance.

Completed: unit and both-engine E2E regressions reproduced padded rows; after the fix, the prompt-to-
status distance falls from eight mobile rows to two. A read-only capture of the user's exact terminal
passed the new decoder and retained identical text/row separators after trailing-space normalization,
removing 519 fill characters. Even discarded blank spans still reject overlap. The fresh full check
passed 96 client, 114 server, 21 setup, 3 LaunchAgent and 61 E2E tests plus the intentional pairing
skip, with only existing lint infos/chunk warnings. One desktop/iPhone visual batch confirms compact
styled text, Unicode and choices. The existing bridge was restarted after validation; its replacement
listener belongs to this repository's server directory, binds only to loopback, and rejects an
uncredentialed health request with 403. Protected configuration hashes match. Recovery source/assets
remain saved; no commit or lifecycle date was added. Authenticated production rendering and physical
iPhone acceptance are not claimed.

## Follow-up: fit horizontal separators locally

The next iPhone capture shows Claude Code's two prompt separators wrapping into eight physical rows.
An exact-target, read-only replay probe confirms two 181-character U+2500 rules. Normalize standalone
repeated horizontal rules to the current local column count, retaining SGR, text, indentation and
choices. Existing fit handling reapplies the raw snapshot so rules expand or contract on resize/font
changes; ordinary output and table borders remain literal. No brand parser or Mac resizing is needed.
Focused helper and Chromium/iPhone WebKit regressions reproduce the missing width normalization.
Verify both color/plain paths, rotation, font changes, existing scrolling/selection behavior and the
full check; inspect the scoped diff and a bounded desktop/mobile visual batch. Current source/static
assets are saved for recovery. This client-only change needs no bridge restart or lifecycle update.

Completed locally: seven helper regressions and both browser engines reproduced the long rules;
the focused cases now retain exactly two separator rows, their colors and surrounding text across
phone/desktop/narrow widths, font changes and plain fallback. The fresh full check passes 103 client,
114 server, 21 setup, 3 LaunchAgent and 63 E2E tests plus the existing intentional pairing skip.
Lint/typechecks/builds pass with only the existing attachment-test infos and Vite chunk warning.
One batched desktop/iPhone visual inspection confirms single-row separators and intact choices.
Scoped source diff, protected configuration hashes, documentation links and diff checks pass.
Current assets are built in place; no server restart, commit or lifecycle date was added. Physical
iPhone acceptance remains unverified.

## Delivery — 2026-10-21

The user authorized a repository push and README/changelog update, explicitly excluding the separate
Cloudflare Access work. Commit `3d2d123` integrates the implemented features into `master`. The exact
delivery content passed `devenv shell -- check` in an isolated checkout without Access changes:
103 client, 111 server, 21 setup, 3 LaunchAgent and 63 E2E tests, plus the intentional Chromium pairing
skip. Only the existing lint infos and Vite chunk warning remain. README and CHANGELOG describe the
current product; the roadmap now records Developed for the three newly integrated feature rows.
Live dates remain pending complete physical-device acceptance. Cloudflare source/tests/specification
and its documentation hunks are preserved locally, with no secrets or generated assets staged.
