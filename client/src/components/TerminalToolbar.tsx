import { useRef, useState } from "react";
import type { useTerminalPreferences } from "../hooks/useTerminalPreferences";
import type { AllowedKey } from "../lib/cmux-rpc";
import type { SubmitResult } from "../lib/terminal-input";
import { KEY_SHORTCUTS, shortcutId, type ShortcutRef } from "../lib/terminal-preferences";
import { ShortcutMenu } from "./ShortcutMenu";

interface TerminalToolbarProps {
  connected: boolean;
  settings: ReturnType<typeof useTerminalPreferences>;
  onKey(key: AllowedKey): void;
  onSubmit(text: string): Promise<SubmitResult>;
  onLatest?(): void;
}
export function TerminalToolbar({ connected, settings, onKey, onSubmit, onLatest }: TerminalToolbarProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const submit = async () => {
    if (!connected || composing.current || inFlight.current) return;
    inFlight.current = true; setSubmitting(true);
    try { if (await onSubmit(text) === "accepted") setText(""); }
    finally { inFlight.current = false; setSubmitting(false); }
  };
  const invoke = async (shortcut: ShortcutRef) => {
    if (!connected || inFlight.current) return;
    if (shortcut.kind === "key") { onKey(shortcut.key); setMenuOpen(false); return; }
    const command = settings.preferences.commands.find((item) => item.id === shortcut.commandId);
    if (!command) return;
    inFlight.current = true; setSubmitting(true);
    try { if (await onSubmit(command.text) === "accepted") setMenuOpen(false); }
    finally { inFlight.current = false; setSubmitting(false); }
  };
  return (
    <div className="terminal-controls">
      <form className="terminal-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <input aria-label="Prompt or command" autoCapitalize="none" autoComplete="off" autoCorrect="off"
          disabled={submitting} enterKeyHint="send" maxLength={4096}
          onChange={(event) => setText(event.target.value)}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
            event.preventDefault(); void submit();
          }} placeholder="Prompt or command" spellCheck={false} type="text" value={text} />
        <button disabled={!connected || submitting} type="submit">Send</button>
      </form>
      <nav aria-label="Terminal shortcuts" className="terminal-toolbar">
        <button ref={menuButton} type="button" onClick={() => setMenuOpen(true)}>Shortcuts</button>
        <button type="button" onClick={onLatest}>Latest</button>
        {settings.preferences.favorites.map((shortcut) => {
          const label = shortcut.kind === "key" ? KEY_SHORTCUTS.find((item) => item.key === shortcut.key)?.label : settings.preferences.commands.find((item) => item.id === shortcut.commandId)?.label;
          return label ? <button type="button" key={shortcutId(shortcut)} disabled={!connected || submitting} aria-label={label} onClick={() => void invoke(shortcut)}>{label}</button> : null;
        })}
      </nav>
      {menuOpen ? <ShortcutMenu settings={settings} connected={connected} busy={submitting} returnFocus={menuButton.current} onInvoke={(shortcut) => void invoke(shortcut)} onClose={() => setMenuOpen(false)} /> : null}
    </div>
  );
}
