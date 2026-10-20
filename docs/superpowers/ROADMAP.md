# Product and Engineering Roadmap

This is the committed lifecycle ledger for cmux-remote. Code, tests, and runtime configuration are
authoritative for current behavior; dated specs record design decisions, and this table records
lifecycle dates.

Read this file and the linked governing spec before planning, implementing, reviewing, or shipping a
tracked feature.

- `Created`: the specification or tracked direction was created.
- `Developed`: implementation is complete and merged into the main branch.
- `Live`: the feature was verified on the target Mac and iPhone PWA.
- `Removed`: the feature was removed from the project.
- `—`: the event has not happened or its date cannot be verified. Never use a forecast here.

Rows are historical and are never deleted when work ships or is removed.

| Feature | Brief description | Spec file | Created | Developed | Live | Removed |
|---------|-------------------|-----------|---------|-----------|------|---------|
| Milestone 1 — Reliable mobile terminal | Securely discover every live terminal, open it from an iPhone PWA, read and send input, and recover after background or network changes. | [Spec](specs/2026-09-13-cmux-remote-command-center-design.md) | 2026-09-13 | 2026-09-14 | — | — |
| Device-bound Tailscale pairing | Allow one Tailscale-authorized iPhone to pair once with a short code while preserving the application session boundary. | [Spec](specs/2026-09-14-device-bound-pairing-design.md) | 2026-09-14 | 2026-09-14 | 2026-09-14 | — |
| Guided first-run setup | Select one iPhone, generate local pairing configuration and a narrow Tailscale grant, configure Serve safely, and start the bridge without exposing its signing key. | [Spec](specs/2026-09-14-guided-first-run-setup-design.md) | 2026-09-14 | 2026-09-14 | — | — |
| Login startup and bounded process retries | Start the bridge in the Mac user session and retry up to three failed exits. | [Spec](specs/2026-09-16-login-autostart-design.md) | 2026-09-16 | — | — | — |
| Milestone 3 — Agent dashboard | Structured agent state, workspace activity, notification bells, counts and inactive-tab grouping; reassigned from Milestone 2 on 2026-10-04. | [Spec](specs/2026-09-13-cmux-remote-command-center-design.md), [0.65.2 update](specs/2026-10-20-native-images-agent-dashboard-tabs.md) | 2026-09-13 | — | — | — |
| Browser awareness — original Milestone 3 scope | Historical metadata-only direction; the user-confirmed Milestone 2 preview direction now includes browser discovery. | [Spec](specs/2026-09-13-cmux-remote-command-center-design.md) | 2026-09-13 | — | — | — |
| Milestone 2 — Mobile terminal usability | Configurable keys and saved commands, toolbar favorites, reliable Enter/scrolling, and local font size. | [Spec](specs/2026-10-04-mobile-terminal-usability-design.md) | 2026-10-04 | 2026-10-04 | — | — |
| Milestone 2 — Browser screenshots | Read-only exact-panel captures with Refresh and local zoom/pan. | [Spec](specs/2026-10-04-surface-content-previews-design.md) | 2026-10-04 | 2026-10-04 | — | — |
| Milestone 2 — Native Markdown/image previews | Original content reads remain blocked on cmux 0.65.2; image thumbnails are tracked separately below. | [Spec](specs/2026-10-04-surface-content-previews-design.md) | 2026-10-04 | — | — | — |
| Milestone 2 — Native image thumbnails | Exact-panel PNG/JPEG/WebP previews as validated JPEG thumbnails up to 1024 px. | [Spec](specs/2026-10-20-native-images-agent-dashboard-tabs.md) | 2026-10-20 | — | — | — |
| Terminal tab creation and confirmed close | Create a terminal in an explicit existing pane; confirm individual or inactive-group closure and preserve last-tab protection. | [Spec](specs/2026-10-20-native-images-agent-dashboard-tabs.md) | 2026-10-20 | — | — | — |
| Terminal file/image attachments | Upload phone files and photos to the Mac and review their references in the selected terminal composer before Send. | [Spec](specs/2026-10-05-terminal-attachments-design.md) | 2026-10-05 | 2026-10-05 | — | — |

## Version reassignment — 2026-10-04

All previously planned Milestone 2 agent-dashboard features move to Milestone 3: activity time,
sanitized output previews, notifications and attention signals, conservative agent lifecycle state,
and workspace counts. Their original specification and creation date remain historical records.

The user-confirmed Milestone 2 direction is mobile terminal usability and simple read-only content
viewing. One configurable shortcuts menu contains named-key combinations, including Shift+Left,
and user-created commands. Users choose toolbar favorites; Ctrl-C and Ctrl-D become catalogue
choices. Reliable iPhone Enter and scrolling, plus adjustable terminal font size, are also included.

Content viewing is limited to surfaces already open in cmux: browser screenshots and native local
Markdown/image panels. No browser interaction, arbitrary file-path input, or directory browsing is
included. Browser discovery moves into this direction; the original metadata-only row remains
historical. Native Markdown/image reads currently have a verified installed-socket blocker and must
not be marked developed or live based on capability advertisement alone.

Execution was approved on 2026-10-04. Terminal usability and browser screenshots were merged into
`master` on 2026-10-04 and passed the full check there. Native content reads remain blocked. Live
dates remain unverified until target Mac/iPhone PWA acceptance. Governing artifacts:

- Terminal usability: [design](specs/2026-10-04-mobile-terminal-usability-design.md) and
  [implementation plan](plans/2026-10-04-mobile-terminal-usability.md).
- Content previews: [design](specs/2026-10-04-surface-content-previews-design.md) and
  [implementation plan](plans/2026-10-04-surface-content-previews.md).

## cmux 0.65.2 follow-up — 2026-10-20

The user authorized native image thumbnails, the agent dashboard, create/close controls and E2E
tests. Disposable-panel probes verified callable native stat/thumbnail, `mobile.workspace.list`
descriptors, exact-pane terminal creation, confirmed close and last-surface protection. The local
socket still rejects native fetch and mobile event subscriptions. The follow-up uses structured
mobile metadata rather than the historical CLI session enrichment. Markdown and full-resolution
native content remain blocked. See the [governing update](specs/2026-10-20-native-images-agent-dashboard-tabs.md)
and [implementation record](plans/2026-10-20-native-images-agent-dashboard-tabs.md).
The new work is local and has no verified merge or target-iPhone acceptance date.
