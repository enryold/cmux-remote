import { useEffect, useRef, useState } from "react";
import type { useTerminalPreferences } from "../hooks/useTerminalPreferences";
import type { AllowedKey } from "../lib/cmux-rpc";
import { KEY_SHORTCUTS, shortcutId, type ShortcutRef } from "../lib/terminal-preferences";

interface ShortcutMenuProps {
  settings: ReturnType<typeof useTerminalPreferences>;
  connected: boolean;
  busy: boolean;
  questionKeys?: readonly AllowedKey[];
  onInvoke(shortcut: ShortcutRef): void;
  onClose(): void;
  returnFocus: HTMLElement | null;
  submissionWarning?: string | null;
}
export function ShortcutMenu({ settings, connected, busy, questionKeys = [], onInvoke, onClose, returnFocus, submissionWarning }: ShortcutMenuProps) {
  const { preferences, persistenceError } = settings;
  const [editingId, setEditingId] = useState<string | undefined>();
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = returnFocus ?? document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, [returnFocus]);
  function favoriteButton(shortcut: ShortcutRef, name: string) {
    const contextual = shortcut.kind === "key" && questionKeys.includes(shortcut.key);
    const pinned = contextual || preferences.favorites.some((item) => shortcutId(item) === shortcutId(shortcut));
    return <button className="shortcut-favorite" type="button" disabled={contextual}
      aria-label={`${contextual ? "Always visible" : pinned ? "Unpin" : "Pin"} ${name}`} aria-pressed={pinned}
      title={contextual ? "Always visible for this agent" : undefined}
      onClick={() => setError(settings.toggleFavorite(shortcut) ? null : "Choose up to 12 favorites.")}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg>
    </button>;
  }
  return (
    <div className="shortcut-overlay">
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Shortcuts" className="shortcut-sheet"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); onClose(); }
          if (event.key !== "Tab") return;
          const controls = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
          if (!controls?.length) return;
          const first = controls[0]; const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <div className="shortcut-heading"><h2>Shortcuts</h2><button type="button" aria-label="Close shortcuts" onClick={onClose}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
        {submissionWarning ? <p role="alert" className="shortcut-submission-warning">{submissionWarning}</p> : null}
        <p>{questionKeys.length ? "Question keys stay on the right. Star other shortcuts for the toolbar." : "Star shortcuts to keep them in the toolbar."} Commands run in this terminal.</p>
        <fieldset className="font-controls" aria-label="Terminal font size">
          <span>Text size</span>
          <button type="button" aria-label="Decrease font" disabled={preferences.fontSize <= 10} onClick={() => settings.setFontSize(preferences.fontSize - 1)}>A−</button>
          <span>{preferences.fontSize} px</span>
          <button type="button" aria-label="Increase font" disabled={preferences.fontSize >= 24} onClick={() => settings.setFontSize(preferences.fontSize + 1)}>A+</button>
        </fieldset>
        {persistenceError ? <p role="status">{persistenceError}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <h3>Keys</h3>
        <div className="shortcut-keys">
        {KEY_SHORTCUTS.map((item) => (
          <div className="shortcut-row" key={item.key}>
            <button type="button" aria-label={item.label} disabled={!connected || busy} onClick={() => onInvoke({ kind: "key", key: item.key })}>
              <strong>{item.label}</strong><small>{item.description}</small>
            </button>
            {favoriteButton({ kind: "key", key: item.key }, item.label)}
          </div>
        ))}
        </div>
        <h3>Commands</h3>
        {preferences.commands.length === 0 ? <p>No saved commands yet.</p> : null}
        {preferences.commands.map((command) => (
          <div className="shortcut-row" key={command.id}>
            <button type="button" aria-label={command.label} disabled={!connected || busy} onClick={() => onInvoke({ kind: "command", commandId: command.id })}>
              <strong>{command.label}</strong><small>{command.text}</small>
            </button>
            {favoriteButton({ kind: "command", commandId: command.id }, command.label)}
            <button type="button" aria-label={`Edit ${command.label}`} onClick={() => { setEditingId(command.id); setLabel(command.label); setText(command.text); setError(null); }}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5" /></svg></button>
            <button type="button" aria-label={`Delete ${command.label}`} onClick={() => { settings.deleteCommand(command.id); if (editingId === command.id) { setEditingId(undefined); setLabel(""); setText(""); } }}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7" /></svg></button>
          </div>
        ))}
        <form className="shortcut-editor" onSubmit={(event) => {
          event.preventDefault();
          if (!settings.saveCommand({ id: editingId, label, text })) {
            setError("Use a name of 1–40 characters and a single-line command of up to 4096 bytes. Save up to 20 commands."); return;
          }
          setError(null); setEditingId(undefined); setLabel(""); setText("");
        }}>
          <h3>{editingId ? "Edit command" : "Add command"}</h3>
          <label>Shortcut name<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} autoComplete="off" /></label>
          <label>Command<input value={text} onChange={(event) => setText(event.target.value)} maxLength={4096} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} /></label>
          <button type="submit">Save command</button>
          {editingId ? <button type="button" onClick={() => { setEditingId(undefined); setLabel(""); setText(""); }}>Cancel edit</button> : null}
        </form>
      </div>
    </div>
  );
}
