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
| Milestone 3 — Agent dashboard | Enrich live surfaces with activity, previews, notifications, and conservative Codex/Claude lifecycle state. Reassigned from Milestone 2 on 2026-10-04. | [Spec](specs/2026-09-13-cmux-remote-command-center-design.md) | 2026-09-13 | — | — | — |
| Browser awareness — original Milestone 3 scope | Historical metadata-only direction; the user-confirmed Milestone 2 preview direction now includes browser discovery. | [Spec](specs/2026-09-13-cmux-remote-command-center-design.md) | 2026-09-13 | — | — | — |

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

The written artifacts below are prepared for review. Add their lifecycle rows when the written
specifications are approved; no new Developed or Live event has occurred:

- Terminal usability: [design](specs/2026-10-04-mobile-terminal-usability-design.md) and
  [implementation plan](plans/2026-10-04-mobile-terminal-usability.md).
- Content previews: [design](specs/2026-10-04-surface-content-previews-design.md) and
  [implementation plan](plans/2026-10-04-surface-content-previews.md).
