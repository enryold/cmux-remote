import { useEffect, useRef, useState } from "react";
import type { useTerminalPreferences } from "../hooks/useTerminalPreferences";
import { KEY_SHORTCUTS, shortcutId, type ShortcutRef } from "../lib/terminal-preferences";

interface ShortcutMenuProps {
  settings: ReturnType<typeof useTerminalPreferences>;
  connected: boolean;
  busy: boolean;
  onInvoke(shortcut: ShortcutRef): void;
  onClose(): void;
  returnFocus: HTMLElement | null;
}
export function ShortcutMenu({ settings, connected, busy, onInvoke, onClose, returnFocus }: ShortcutMenuProps) {
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
    const pinned = preferences.favorites.some((item) => shortcutId(item) === shortcutId(shortcut));
    return <button type="button" aria-label={`${pinned ? "Unpin" : "Pin"} ${name}`} aria-pressed={pinned}
      onClick={() => setError(settings.toggleFavorite(shortcut) ? null : "Choose up to 12 favorites.")}>{pinned ? "★" : "☆"}</button>;
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
        <div className="shortcut-heading"><h2>Shortcuts</h2><button type="button" aria-label="Close shortcuts" onClick={onClose}>Close</button></div>
        <p>Choose ★ to show a shortcut in the toolbar. Commands run in this terminal.</p>
        {persistenceError ? <p role="status">{persistenceError}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <h3>Keys</h3>
        {KEY_SHORTCUTS.map((item) => (
          <div className="shortcut-row" key={item.key}>
            <button type="button" aria-label={item.label} disabled={!connected || busy} onClick={() => onInvoke({ kind: "key", key: item.key })}>
              <strong>{item.label}</strong><small>{item.description}</small>
            </button>
            {favoriteButton({ kind: "key", key: item.key }, item.label)}
          </div>
        ))}
        <h3>Commands</h3>
        {preferences.commands.length === 0 ? <p>No saved commands yet.</p> : null}
        {preferences.commands.map((command) => (
          <div className="shortcut-row" key={command.id}>
            <button type="button" aria-label={command.label} disabled={!connected || busy} onClick={() => onInvoke({ kind: "command", commandId: command.id })}>
              <strong>{command.label}</strong><small>{command.text}</small>
            </button>
            {favoriteButton({ kind: "command", commandId: command.id }, command.label)}
            <button type="button" aria-label={`Edit ${command.label}`} onClick={() => { setEditingId(command.id); setLabel(command.label); setText(command.text); setError(null); }}>Edit</button>
            <button type="button" aria-label={`Delete ${command.label}`} onClick={() => { settings.deleteCommand(command.id); if (editingId === command.id) { setEditingId(undefined); setLabel(""); setText(""); } }}>Delete</button>
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
