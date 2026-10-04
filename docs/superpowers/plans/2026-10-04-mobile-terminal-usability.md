# Mobile Terminal Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make existing cmux terminals practical to operate from an iPhone using configurable
key/command shortcuts, genuine Return input, reliable scrolling, and adjustable text size.

**Architecture:** Keep the existing validated terminal RPCs. Add local preferences and a shared,
bounded input dispatcher, with one shortcuts sheet for keys and saved commands. Reuse the xterm
instance, polling, and terminal viewport protocol for rendering and font changes.

**Tech Stack:** Existing React 19, TypeScript, xterm.js, Bun/Hono, Vitest, Bun tests, Playwright,
repository devenv. No new runtime dependency.

**Spec:** [Mobile terminal usability](../specs/2026-10-04-mobile-terminal-usability-design.md)

**Status:** execution authorized on 2026-10-04; Tasks 1–6 implemented on the feature branch. Final review and acceptance are recorded below; merge/hardware iPhone checks remain pending.

## Global Constraints

- Preserve localhost binding, exact-Origin validation, paired sessions, and device capability checks.
- Keys use the spec's finite 14-entry catalogue; verify installed modified-key behavior first.
- 20 commands; 12 favorites; labels at most 40 Unicode code points; commands at most 4,096 UTF-8 bytes.
- Commands are nonempty, single-line literal terminal input with no C0 or DEL control characters.
- Preferences: `cmux-remote.preferences.v2`, schema version 1, serialized limit 131,072 UTF-8 bytes.
- Font size: integer 10–24 px; default 13; step 1. Touch targets: at least 44×44 CSS pixels.
- Keep terminal text at most 16,384 bytes, client WS frames at most 65,536 bytes, and reads at 2,000 lines.
- Bound client input actions to 64; never retarget, replay, or automatically retry terminal input.
- Default favorites: Esc, Tab, Left, Right, Up, Down, Shift+Left, Enter. No fixed Ctrl-C/Ctrl-D controls.
- Agent launchers are user-created commands; do not add agent-brand defaults or output parsers.
- Use `devenv shell --` for builds/tests/tools and disposable surfaces for real input checks.

## Review Focus

1. Text accepted but Enter fails, or a surface switches mid-submit: no duplicate command or retarget (Task 3).
2. Mobile Return during composition, or paste containing newlines: no early/double submission (Task 3).
3. Stored commands/favorites are corrupt or storage rejects writes: usable defaults/in-memory editing (Task 2).
4. Output arrives during a touch gesture or selection: stable reading and bounded deferred work (Task 5).
5. Font/keyboard reflow and foreground recovery: readable terminal and correct viewport cleanup (Task 6).

## File Ownership

- `server/src/rpc.ts`, `client/src/lib/cmux-rpc.ts`: public named-key catalogue and server mapping.
- New `client/src/lib/terminal-preferences.ts`: preference types, defaults, strict parsing, limits.
- New `client/src/hooks/useTerminalPreferences.ts`: storage/in-memory editing and persistence errors.
- New `client/src/lib/terminal-input.ts`: key/text normalization and serialized input submissions.
- New `client/src/components/ShortcutMenu.tsx`: key selection, command editing, favorites, font controls.
- Existing `TerminalToolbar.tsx`: composer, Shortcuts button, selected favorites.
- Existing `Terminal.tsx`, `lib/terminal.ts`, `styles/global.css`: xterm rendering, scrolling, font fitting.
- Existing `App.tsx`, `useCmux.ts`: target/connection lifecycle and action integration.
- Tests live beside these units; complete user flows live in `e2e/terminal.spec.ts` and `e2e/fake-cmux.ts`.

## Task 1: Verify and expose the bounded key catalogue

**Files:** modify `server/src/rpc.ts`, `client/src/lib/cmux-rpc.ts`; test
`server/src/__tests__/rpc.test.ts`, `client/src/lib/__tests__/cmux-rpc.test.ts`;
record compatibility evidence in the governing spec.

**Interfaces:** retain `parseAllowedRequest(raw: string): AllowedRequest` and
`toCmuxCall(request: AllowedRequest, clientId: string)`; extend both `AllowedKey` unions with the
spec's catalogue. Backend aliases, if necessary, belong in `toCmuxCall`.

- [x] Read the spec and fresh installed `cmux version` / `cmux capabilities --json` evidence.
- [x] In a disposable key-capture terminal, verify Shift+Left, Shift+Tab, and modified arrows send
  the expected gestures. Record exact accepted spellings and complete responses without user output.
  Stop this task if Shift+Left cannot be delivered; do not test against a valuable shell.
- [x] Add regression assertions that the canonical key request is accepted and mapped exactly:

  ```ts
  expect(parseAllowedRequest(JSON.stringify({
    id: "1", method: "surface.send_key",
    params: { surface_id: surfaceId, key: "shift+left" },
  }))).toMatchObject({ params: { key: "shift+left" } });
  ```

  Cover all catalogue members; reject `cmd+q`, unknown combinations, missing UUIDs, extra fields,
  implicit targets, and unchanged text/frame bounds.
- [x] Run `devenv shell -- bun --cwd server test src/__tests__/rpc.test.ts`; confirm the new key
  assertion fails under the old whitelist.
- [x] Extend the unions, whitelist, and any verified backend alias mapping; keep unrelated RPCs denied.
- [x] Repeat the focused server test and run
  `devenv shell -- bun run --cwd client test src/lib/__tests__/cmux-rpc.test.ts`; require all tests pass.
- [x] Inspect the scoped diff and commit the tested catalogue/compatibility evidence.

## Task 2: Implement device-local shortcut and font preferences

**Files:** create `client/src/lib/terminal-preferences.ts`,
`client/src/hooks/useTerminalPreferences.ts`, and their focused `__tests__` files.

**Interfaces:** export `TerminalPreferences` and `ShortcutRef` matching the spec;
`defaultTerminalPreferences(): TerminalPreferences`;
`parseTerminalPreferences(raw: string | null): TerminalPreferences` returns defaults on invalid input;
`useTerminalPreferences()` exposes `preferences`, `persistenceError`,
`saveCommand(command: {id?: string; label: string; text: string}): boolean`,
`deleteCommand(id: string): void`, `toggleFavorite(shortcut: ShortcutRef): boolean`, and
`setFontSize(size: number): void`. Invalid user edits return false and remain unsaved.

- [x] Write tests for empty/default storage, round-trip saved commands, preference limits, UTF-8
  command length, unsupported versions, duplicate IDs/favorites, unknown keys, and orphaned references.
  Pin default font 13, range 10–24, command limit 20, favorite limit 12, and serialized limit 131,072.
- [x] Add storage-denial coverage: edits remain in memory, the persistence error appears, and a reload
  falls back to the last valid stored state. Deleting a command removes its favorite.
- [x] Run `devenv shell -- bun run --cwd client test src/lib/__tests__/terminal-preferences.test.ts src/hooks/__tests__/useTerminalPreferences.test.ts`;
  require the new tests fail before the module/hook exists.
- [x] Implement strict parsing, safe defaults, bounded edits, UUID creation, and best-effort storage.
  Store no output, session data, or invocation history. Do not add synchronization or migration frameworks.
- [x] Repeat the focused command; require all tests pass. Inspect and commit the tested preference unit.

## Task 3: Unify genuine keys, composer submission, and saved-command input

**Files:** create `client/src/lib/terminal-input.ts` and
`client/src/lib/__tests__/terminal-input.test.ts`; modify `client/src/App.tsx`,
`client/src/hooks/useCmux.ts`, `client/src/components/Terminal.tsx`, and
`client/src/components/TerminalToolbar.tsx`; extend their existing tests.

**Interfaces:**

```ts
type TerminalInput = {kind: "text"; text: string} | {kind: "key"; key: AllowedKey};
type SubmitResult = "accepted" | "text_unconfirmed" | "enter_unconfirmed";
normalizeTerminalInput(data: string, context: {composing: boolean; paste: boolean}): TerminalInput;
createTerminalInputDispatcher(deps: {
  sendText(surfaceId: string, text: string): Promise<void>;
  sendKey(surfaceId: string, key: AllowedKey): Promise<void>;
  isCurrent(surfaceId: string, connectionGeneration: number): boolean;
}): {
  send(surfaceId: string, generation: number, input: TerminalInput): Promise<void>;
  submit(surfaceId: string, generation: number, text: string): Promise<SubmitResult>;
};
```

`CmuxApi` exposes `connectionGeneration: number`; invalidate it when the bridge/cmux connection
leaves the usable state. `submit` treats empty text as a single Enter. Existing component
`onSubmit(text)` consumes the typed result instead of a Boolean; direct input uses `send`.

- [x] Write focused normalization tests: standalone committed Return produces `enter`, Shift+Left
  produces its named key, composing/paste payloads remain text, and unknown data is preserved.
- [x] Add deferred-transport tests for ordered text→Enter, partial acknowledgement, connection
  generation change, selected-surface change, queue exhaustion at 64, and no replay after reconnect.
  Assert a failed text acknowledgement sends no Enter, and an Enter failure sends no second text.
  Assert empty-composer Enter failures use the Enter-only message, without claiming text was sent.
- [x] Add composer tests for hardware Return, form submission, empty Return, composition-end ordering,
  and one invocation when keydown and submit could both fire. Preserve the draft on unconfirmed input.
- [x] Run `devenv shell -- bun run --cwd client test src/lib/__tests__/terminal-input.test.ts src/components/__tests__/TerminalToolbar.test.tsx src/__tests__/App.test.tsx`;
  require the new regressions fail against the current split input paths.
- [x] Implement the dispatcher and lifecycle generation, then route all terminal input through it.
  Track paste/composition context without agent parsing. Gate late Enter on the captured original
  target/generation, and show the spec's precise partial-submission message.
- [x] Repeat focused tests and extend/run `src/hooks/__tests__/useCmux.test.tsx` for generation changes.
  Require all pass, inspect the diff, and commit the input change.

## Task 4: Build one configurable shortcuts menu

**Files:** create `client/src/components/ShortcutMenu.tsx` and
`client/src/components/__tests__/ShortcutMenu.test.tsx`; modify `TerminalToolbar.tsx`,
`Terminal.tsx`, `App.tsx`, `styles/global.css`, and `README.md` with the resulting behavior.

**Interfaces:** `ShortcutMenu` consumes preferences and the editing methods from Task 2,
`onInvoke(shortcut: ShortcutRef): void`, and `onClose(): void`. `TerminalToolbar` consumes favorite
entries plus `onOpenShortcuts(): void`. Resolve command IDs from current preferences before
invocation; command actions use Task 3's `submit`, and named keys use `send`.

- [x] Write UI tests for opening/closing the accessible sheet, adding/editing/deleting a command,
  toggling a key/command favorite, and rendering exactly the user's selected favorites.
  Assert no Ctrl-C/Ctrl-D dedicated button is present by default; both are available in the catalogue
  with the specified descriptions. Editing/toggling preferences sends no terminal input.
- [x] Add validation assertions for command controls/newlines, empty input, Unicode byte limits,
  stale command IDs, and invoking a command once on the captured terminal. Rejected edits keep the sheet open.
- [x] Run `devenv shell -- bun run --cwd client test src/components/__tests__/ShortcutMenu.test.tsx src/components/__tests__/TerminalToolbar.test.tsx`;
  confirm the new behavior fails before integration.
- [x] Implement the single sheet, key catalogue, user command editor, favorites, and accessible
  focus return. Remove fixed Ctrl-C/Ctrl-D and the separate UI Ctrl toggle. Preserve physical Ctrl
  input. Keep the Shortcuts button reachable with zero favorites and while disconnected.
- [x] Repeat the focused command; require all pass. Update README after behavior exists, inspect,
  and commit the independently usable menu.

## Task 5: Reproduce and repair mobile scroll during output

**Files:** modify `client/src/components/Terminal.tsx`, `client/src/lib/terminal.ts`,
`client/src/styles/global.css`, `e2e/fake-cmux.ts`, `e2e/terminal.spec.ts`,
`client/src/lib/__tests__/terminal.test.ts`, and `README.md` where behavior changes.

**Interfaces:** export
`snapshotUpdate(previous: string | null, next: string): {kind: "unchanged" | "append" | "replace"; text: string}`
from `lib/terminal.ts`. Terminal owns one in-flight xterm write and one latest pending snapshot,
with explicit touch/selection state. The Latest control calls `term.scrollToBottom()` locally.

- [x] Reproduce and record the reported scroll symptom on disposable terminals with keyboard
  open/closed, polling active/idle, and background/resume. Do not claim a specific root cause before evidence.
- [x] Extend the fake cmux fixture with deterministic 2,000-line output, append activity, and an
  overwritten prompt. Add a regression preserving visible historical text while output changes,
  and returning to bottom only when Latest is chosen. Add touch/selection deferral assertions.
- [x] Run `devenv shell -- bun run e2e -- e2e/terminal.spec.ts`; confirm the targeted current behavior
  fails. Automated touch coverage supplements, rather than certifies, the real iPhone reproduction.
- [x] Implement unchanged/append/replace updates and coalesced writes. Freeze application during
  active gestures/selection, retain the last pending snapshot, and preserve the reading anchor.
  Add native touch handling only if the reproduction establishes the missing behavior. Do not change
  global gesture behavior or replace xterm/polling.
- [x] Run `devenv shell -- bun run --cwd client test src/lib/__tests__/terminal.test.ts` and repeat
  terminal E2E in both configured projects. Repeat the original real-phone reproduction.
- [x] Inspect the scoped diff and commit the verified scroll behavior with accurate README wording.

## Task 6: Add font controls and complete terminal acceptance

**Files:** modify `Terminal.tsx`, `ShortcutMenu.tsx`, existing component/helper tests,
`e2e/terminal.spec.ts`, `e2e/reconnect.spec.ts`, and `README.md`. Update roadmap lifecycle only
after its actual merge/live conditions are met.

**Interfaces:** pass `fontSize: number` into the existing Terminal component. Sheet A−/A+ call
`setFontSize`; Terminal updates `term.options.fontSize`, refits, and retains current generation-based
`onViewport` / `onViewportClear` semantics. Do not remount Terminal for a font change.

- [ ] Write tests for 10/13/24 px, integer steps, persisted settings after reload/terminal switching,
  stable xterm instance, selection/scroll anchoring, and valid viewport dimensions after reflow.
- [ ] Add E2E flows that create a launcher shortcut, choose Shift+Left, operate an inert menu fixture,
  use Return, change font, background/reconnect, and observe no repeated input. Include viewport cleanup.
- [ ] Run focused client tests and `devenv shell -- bun run e2e -- e2e/terminal.spec.ts e2e/reconnect.spec.ts`;
  confirm new font behavior fails before implementing the controls.
- [ ] Implement A−/size/A+, preference wiring, fit scheduling, and cleanup without global Mac font changes.
- [ ] Repeat focused checks, then run `devenv shell -- check` once; require lint, tests, typechecks,
  build, Chromium E2E, and iPhone WebKit E2E pass. Inspect the entire implementation diff.
- [ ] Run the spec's real-device checklist, including the actual Codex Shift+Left question menu and
  Claude Code prompts. Record verified outcomes and remaining failures; no automated test proves Live.
- [ ] Commit the tested terminal deliverable. Leave native content dependencies to the separate
  [preview plan](2026-10-04-surface-content-previews.md).

## Handoff

Review this plan together with its spec before execution. Native execution is the recommended first
method because the input, menu, and xterm changes share interfaces and need a coherent mobile check;
request a fresh whole-branch review of input ordering and boundary changes before integration.
If subagent execution is selected, use the repository's explicit model/effort routing and verify
the current available model names before dispatch. Do not interpret this plan as an instruction to
start implementation or to deploy the bridge.
