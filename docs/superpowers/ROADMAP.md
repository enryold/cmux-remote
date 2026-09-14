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
| Milestone 2 — Agent dashboard | Enrich live surfaces with activity, previews, notifications, and conservative Codex/Claude lifecycle state. | [Spec](specs/2026-09-13-cmux-remote-command-center-design.md) | 2026-09-13 | — | — | — |
| Milestone 3 — Browser awareness | Identify browser surfaces and show their title and URL without turning the PWA into a remote browser. | [Spec](specs/2026-09-13-cmux-remote-command-center-design.md) | 2026-09-13 | — | — | — |
