# Milestone 2 — Mobile terminal usability

**Date:** 2026-10-04

**Status:** approved for execution on 2026-10-04; implemented and merged into `master` on 2026-10-04; full check passed; hardware iPhone acceptance remains pending.

## Intent and acceptance

Enrico wants to operate existing cmux terminals from an iPhone without repeatedly typing launch
commands or reaching for the Mac keyboard. Success means answering interactive question menus,
including a reported Shift+Left gesture, launching saved commands, using the iPhone Return key,
scrolling during output, and changing the terminal font size.

One configurable shortcuts menu owns both named-key combinations and user-authored commands.
Ctrl-C and Ctrl-D must be choices in that menu, rather than mandatory dedicated toolbar buttons.
The old agent dashboard moves to Milestone 3. Content previews have a separate
[design](2026-10-04-surface-content-previews-design.md) and implementation gate.

## Evidence from the current implementation

- `TerminalToolbar.tsx` hardcodes Esc, Tab, Ctrl-C, Ctrl-D, Up, Down, and Enter, plus a Ctrl toggle.
- Both client and server `AllowedKey` types exclude Left, Right, Shift+Left, and Shift+Tab.
- `Terminal.tsx` sends every xterm `onData` event through `surface.send_text`. The composer instead
  sends text and then `surface.send_key("enter")`. These different paths are a candidate explanation
  for the reported iPhone Return issue, not a reproduced diagnosis.
- Output changes call `term.reset()` and repaint the entire snapshot. Scroll position is restored
  using distance from the bottom. The touch-scroll failure still needs reproduction.
- xterm font size is fixed at 13 px. Terminal reads remain bounded to 2,000 lines.
- Installed cmux is `0.64.25 (106)`, commit `b685a275c`. `surface.send_key` is available; modified
  key spellings and behavior must be verified with a disposable terminal before extending the API.

## Shortcuts menu

The terminal controls retain the prompt composer and expose one **Shortcuts** button. It opens an
accessible sheet with two kinds of entries: **Key combination** and **Command**. The same sheet
allows invocation, choosing toolbar favorites, adding a command, editing its name/text, and deleting
it. Invoking a shortcut targets the terminal that was selected at invocation and closes the sheet
after success. An unconfirmed command keeps the sheet open with a visible warning inside it,
so the user can inspect the terminal before choosing whether to retry.
Editing preferences never sends terminal input. Invocation is disabled while disconnected, but
the menu and preference editing remain usable.

Key combinations come from an explicit catalogue. The initial catalogue is:

`escape`, `tab`, `shift+tab`, `enter`, `left`, `right`, `up`, `down`, `shift+left`, `shift+right`,
`shift+up`, `shift+down`, `ctrl+c`, `ctrl+d`.

Labels use familiar notation such as **Shift+←** and **Ctrl-C**. Ctrl-C has the description
"Interrupt the current process"; Ctrl-D has "Send end of input; may close a shell". No agent-name
or output parser determines when a shortcut is available. A shortcut expresses a key gesture,
not a promise that an agent will open a specific menu.

First-run favorites are Esc, Tab, Left, Right, Up, Down, Shift+Left, and Enter. Ctrl-C, Ctrl-D, and
the generic Ctrl modifier are not fixed toolbar controls. The existing physical-keyboard Ctrl
behavior is preserved; the UI uses the catalogue instead of a separate modifier toggle.
Favorites can be removed or restored. Toolbar entries have at least 44×44 CSS-pixel touch targets
and remain reachable through horizontal scrolling. The Shortcuts button remains available when no
favorite is selected. Do not add drag-and-drop or an arbitrary keyboard-macro builder.

A command consists of an ID, a label, and one line of literal shell input. Examples in documentation
may use `codex-dsp` and `claude-dsp`; product defaults contain no agent-specific commands. The user
adds them through **Add command**. A command action sends that text and a genuine named Enter to
the selected terminal using the existing bridge. It does not create a terminal, terminate an agent,
clear the current prompt, change the working directory, or spawn a server process. The menu explains
once that commands are sent to the current terminal; the user chooses a shell when launching tools.

Commands allow ordinary quotes, pipes, and shell operators as literal terminal input. Reject empty
commands and embedded control characters, including CR, LF, NUL, and DEL. Preserve meaningful spaces.
There is no server command registry or server shell evaluator.

## Preference contract

Store one versioned document under `cmux-remote.preferences.v2` in origin-local browser storage:

```ts
interface TerminalPreferences {
  version: 1;
  fontSize: number;
  commands: Array<{ id: string; label: string; text: string }>;
  favorites: Array<
    | { kind: "key"; key: AllowedKey }
    | { kind: "command"; commandId: string }
  >;
}
```

Limits: 20 commands, 12 favorites, 40 Unicode code points per label, 4,096 UTF-8 bytes per command,
and 131,072 UTF-8 bytes for the serialized preference document. IDs are UUIDs. Duplicate favorites,
duplicate IDs, unknown keys, and dangling command references are invalid. Deleting a command also
removes its favorite. Fonts are integer pixels from 10 through 24, default 13, step 1.

Use defaults when the stored document is malformed or belongs to an unsupported version. A denied
or exhausted storage backend leaves editing usable in memory and shows "Preferences could not be
saved on this device". Preferences are per browser/PWA storage context; no sync or account system
is introduced. Do not store sessions, pairing data, output, or invocation history in this document.

## Input and Return semantics

Maintain a single client input dispatcher shared by direct typing, the composer, menu entries, and
favorites. It captures the surface UUID and the current connection generation before sending.
It serializes whole composer/command submissions with other local input, so text and its Enter
cannot be interleaved by another gesture in the same PWA. Bound queued actions to 64.

Submission outcomes distinguish success, failure before text acknowledgement, and failure after
text acknowledgement but before Enter acknowledgement. In the last case show
"Text sent; Enter was not confirmed. Check the terminal before trying again." Never automatically
resend either stage. Disconnection, surface removal, or leaving the selected surface invalidates
not-yet-sent input. Never retarget the newly selected terminal or replay input after reconnect.
All failures, including an ambiguous text timeout, leave the command available for an explicit
user decision; a failed acknowledgement does not prove that nothing reached the terminal.
For an unconfirmed text stage, show "Input was not confirmed. Check the terminal before trying
again." For an empty-composer Enter failure, show "Enter was not confirmed. Check the terminal
before trying again." Do not claim text was sent when the action contained no text.

Normalize complete xterm key events to named keys. A committed Return sends `enter`, not a carriage
return embedded in `surface.send_text`. Exact supported arrow/modifier sequences can map to catalogue
keys. Pasted text and IME composition must remain text; do not split multi-line paste into submit
actions or parse agent prose. Unrecognized data keeps the current bounded text-input behavior.

The composer handles iPhone Return, hardware Return, and the Send button through the same submission
function. While composing, Return commits composition without submitting. Guard against duplicate
`keydown`/`submit` handling. With an empty composer, a committed Return sends one named Enter to
support interactive menus. Disable duplicate submission while an action is in flight.

Verify exact modified-key support on the installed cmux contract before implementation. The public
application catalogue uses the canonical strings above; any required upstream aliases are mapped
inside the server. If Shift+Left is unavailable, this outcome remains incomplete: do not substitute
an unrelated gesture or claim the menu problem fixed.

Execution verification (2026-10-04): cmux 0.64.25 (106), commit `b685a275c`, accepts the canonical
spellings directly. A disposable raw-input terminal received `ESC[1;2D` for `shift+left`, `ESC[Z`
for `shift+tab`, and `ESC[1;2C`, `ESC[1;2A`, `ESC[1;2B` for Shift+Right/Up/Down. No backend aliases
are required. This verifies key transport; testing the user's agent menus on their iPhone remains
part of hardware acceptance.

## Scrolling and font controls

Reproduce the scroll failure using disposable high-output and idle terminals, with the keyboard
open/closed and before/after backgrounding. Preserve native xterm touch scrolling where it works;
change event handling only when the reproduction proves it necessary.

Output refresh must not interrupt a touch gesture or text selection. Coalesce deferred snapshots
to the latest one; keep at most one pending snapshot and one xterm write in flight. Identical
snapshots do nothing. Append-only updates may write only the suffix. Repaint overwritten content
without recreating the xterm instance. When reading history, preserve the visible text where it
remains within the bounded snapshot. If that history expires, clamp to the oldest available content
without snapping to the newest output. Follow live output only when the reader was already at the
bottom or explicitly chooses **Latest**. A Latest button remains reachable while browsing history.

Expose A−, the current size, and A+ in the Shortcuts sheet, separate from actions that send input.
Changing font size updates the existing xterm instance, refits the local grid, and uses the existing
debounced `terminal.viewport` contract when supported. Preserve the reading anchor and selection as
far as xterm reflow permits. Do not send invalid grid dimensions or leave a viewport override on
surface exit, logout, or disconnect. Changing font must not change the font on the Mac globally.

## Boundaries and verification

Retain localhost binding, exact-Origin checks, paired-session/capability enforcement, explicit RPC
validation, 16,384-byte terminal text input, 65,536-byte client WebSocket frames, and the existing
2,000-line output bound. Preferences do not weaken those boundaries. No new runtime dependency is
needed for the menu, settings, font controls, or bounded input dispatcher.

Every behavior change starts with a focused failing regression. Cover preferences and input
normalization in Vitest; named-key validation and ordered input in Bun tests; user flows in Chromium
and iPhone WebKit E2E. Fake cmux responses must represent the real modified-key contract. Complete
functional work with `devenv shell -- check`, then inspect the diff.

Real-device acceptance requires all of the following on disposable surfaces:

- Shift+Left reaches the selected terminal, and the user's Codex question menu can be operated.
- Arrow/Tab/Shift+Tab/Enter/Esc navigation works with both reported agent workflows.
- Add, edit, delete, select, and invoke command/key shortcuts without unintended terminal input.
- A saved launcher runs once in a shell; reconnect never launches it again.
- iPhone Return produces one genuine Enter, with and without composer text; IME and paste remain usable.
- Scroll through output while polling, select/copy, return to Latest, background, and resume.
- Font changes survive reload and terminal switching and preserve viewport cleanup.

Do not mark Developed before merge into the repository's primary branch, or Live before Mac and
iPhone PWA verification. Planning itself proves none of these runtime outcomes.
