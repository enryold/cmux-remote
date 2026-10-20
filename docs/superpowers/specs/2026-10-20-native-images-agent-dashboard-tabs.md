# cmux 0.65.2 — native images, agent dashboard, and terminal tabs

**Date:** 2026-10-20
**Status:** authorized and implemented locally; full check passed on 2026-10-20; not yet merged,
released or verified on iPhone hardware. See the [validation record](../plans/2026-10-20-native-images-agent-dashboard-tabs.md).

This supplements the [surface previews](2026-10-04-surface-content-previews-design.md) and
[command center](2026-09-13-cmux-remote-command-center-design.md) designs. The user authorized
v2 native image previews, the reassigned v3 agent dashboard, E2E coverage, and opening/closing tabs.

## Verified compatibility and scope

The installed cmux is 0.65.2 (111), commit `9d01f956c`. Disposable native panels proved that
`mobile.workspace.list` supplies the exact `surface_id` and `file_path`, `mobile.panel.artifact.stat`
reads metadata, and `mobile.panel.artifact.thumbnail` returns a JPEG in `data_b64` with
`pixel_width`/`pixel_height`. The maximum thumbnail dimension is 1024 pixels. Native Markdown
returns `unsupported_media` for thumbnail and `method_not_found` for `mobile.panel.artifact.fetch`.
`surface.read_text` remains terminal-only. Markdown and original-resolution reads remain incomplete.

Native preview requests retain the existing path-free protected endpoint. Resolve paths exclusively
from the server-side inventory, require a unique workspace/surface association, allow only saved
PNG/JPEG/WebP source images, validate returned JPEG framing/dimensions/limits, and recheck topology
and the exact descriptor after capture. No filesystem fallback or raw path reaches the PWA.
Retain the existing deadline, concurrency limit, authentication, no-store and stale-response rules.

## Agent dashboard

Use the verified `mobile.workspace.list` snapshot instead of spawning the older design's optional
`cmux sessions` command. This is the governing source adjustment for cmux 0.65.2: structured live
metadata already supplies agent source/state, last workspace activity and unread count. Read
`notification.list` on the same isolated metadata socket within the shared one-second deadline.
Join unread notifications only to a unique live terminal in their exact workspace, exporting a
boolean rather than notification bodies, titles, identifiers or timestamps.
Missing, duplicate, invalid, unavailable or expired evidence produces unknown state. Never infer
completion, errors or agent state from terminal prose. No transcript paths, command lines,
directories, file paths or arbitrary upstream fields may leave the normalization boundary.

Display a yellow bell in place of a terminal's selection dot for an unread notification or structured
needs-attention state. Its row opens that exact terminal in the PWA; it does not focus the Mac or
acknowledge notifications globally. Do not show workspace message previews. Display activity times,
unread counts, per-terminal
working/idle/needs-attention/unknown states, and counts derived from live workspace surfaces.
Reuse topology/foreground/reconnect refresh and its visible-page safety timer. Clear trusted status
on disconnect and auth expiry; expire snapshots if refresh stops. Metadata failure must not interrupt
terminal discovery, output or input, and the dashboard must not poll unselected terminal output.

Group more than two inactive tabs under a collapsed, keyboard-operable `Inactive tabs (X)` disclosure.
Here inactive means unselected without current working/attention evidence. Selected, working and
bell-bearing tabs stay visible; an attentive tab moves out of the group on refresh. Keep smaller
lists flat and preserve expansion through ordinary metadata refreshes.

User-approved follow-up, 2026-10-20: the expanded group exposes “Chiudi tutte” at the upper right.
Confirm once with its count/workspace and the existing process/unsaved-work warning. Capture only
the displayed inactive IDs, then use existing exact-surface close requests sequentially. Before
each close refresh membership and skip missing, selected, working or attentive tabs. Never include
new tabs. Stop on uncertainty, disconnect or navigation; report partial closure without replaying it.
Keep duplicate-action guards, last-tab protection and a dismissible error. No bulk public RPC.

## Tab actions

Add an accessible circled-plus New terminal button within each explicitly identified workspace/pane
and beside the selected tab.
The browser supplies UUIDs only: no command, environment, working directory, URL, remote context,
or arbitrary surface type. The bridge checks current membership, fixes type to terminal and focus
to false, and validates the created identity. Enter the new tab directly in the PWA after discovery
publishes its exact identity, without changing Mac focus.

Closing targets one explicit current surface/workspace after user confirmation that running
processes and unsaved work can be lost. Preserve cmux's last-surface restriction. Any force flag
is server-owned and requires the explicit confirmation field. Serialize mutations with input,
bound requests, disable duplicate gestures, never retarget a replacement selection, and never
retry or replay after an ambiguous acknowledgement or reconnect. Refresh discovery after actions;
errors explain that the user should inspect the current tabs before trying again. Unsupported-method
errors instead explain that the bridge needs restarting. Action notices have a dismissal button and
clear on navigation.

## Acceptance

Focused regression tests fail before each implementation. Bun covers JPEG validation, identity and
path association, supported media, deadlines, metadata privacy/failure/staleness, and strict tab-action
schemas. Client tests cover unknown/disconnected states and controls. Chromium and iPhone WebKit
E2E cover native images and unavailable Markdown, live status/attention changes and fallback,
create/close/cancel/last-tab behavior, reconnect, and narrow-screen layout. Finish with
`devenv shell -- check`, inspect the complete output and final diff, and preserve pre-existing
Cloudflare Access changes. Developed dates require merge; Live requires target Mac/iPhone PWA checks.
