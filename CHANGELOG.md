# Changelog

Changes to this fork of [hummer98/cmux-remote](https://github.com/hummer98/cmux-remote).

## 2026-10-21

### Added

- Agent dashboard with structured Working, Idle, Needs attention and Unknown states, workspace
  activity and counts. Unread notifications appear as yellow bells on their exact terminals.
- Collapsible **Inactive tabs (X)** groups and a confirmed **Chiudi tutte** action that skips tabs
  which become selected, working or attentive.
- Circled-plus terminal creation with direct navigation on the phone, confirmed tab closure,
  last-tab protection and no automatic replay after uncertain acknowledgements.
- Native PNG/JPEG/WebP panel previews through validated JPEG thumbnails up to 1024 px.
- Contextual question keys: **Shift+←, Enter, Esc** for Codex and **↑, ↓, Enter, Esc** for Claude Code.
- Terminal foreground/background colors and emphasis, with plain-text fallback for unsupported,
  invalid or slow styled captures.

### Changed

- Prompt drafting stays local until Return or Send. The three-line field supports Shift+Return
  for newlines and enables native keyboard correction, spelling and suggestions.
- Shortcut and connection bars hide while editing and return when leaving the composer.
- Compact attachment/Send icons, a polished Shortcuts sheet, terminal side padding and a 12 px
  default output font; saved font preferences remain intact and touch targets stay at least 44 px.
- Connection status appears once, centered in the footer. Installed iPhone PWAs use the available
  height and preserve safe-area spacing.

### Fixed

- Arrow and shortcut taps no longer request the phone keyboard; terminal output is read-only while
  retaining selection, copy, touch scrolling and live updates.
- Desktop-colored prompt padding and long horizontal separators no longer expand into large blocks
  on the phone. Separators adapt to local width, rotation and font changes without shortening text
  or table borders.
- Terminal creation errors can be dismissed and clear on navigation.
- Missing or stalled dashboard metadata cannot block terminal reads; disconnect or stale evidence
  clears trusted agent state.

### Compatibility and validation

- Verified against the installed cmux 0.65.2 socket. Native Markdown and original-resolution image
  reads remain unavailable; there is no arbitrary filesystem fallback or browser control.
- Automated client/server tests and Chromium/iPhone WebKit flows cover input, reconnection, tab
  actions, previews, colors and mobile layouts. Full physical-iPhone release acceptance remains pending.
