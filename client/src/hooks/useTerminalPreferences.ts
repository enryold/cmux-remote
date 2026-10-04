import { useRef, useState } from "react";
import { defaultTerminalPreferences, parseTerminalPreferences, PREFERENCES_STORAGE_KEY, shortcutId, validPreferences, type ShortcutRef, type TerminalPreferences } from "../lib/terminal-preferences";

export function useTerminalPreferences() {
  const [initial] = useState(() => {
    try { return { preferences: parseTerminalPreferences(localStorage.getItem(PREFERENCES_STORAGE_KEY)), error: null as string | null }; }
    catch { return { preferences: defaultTerminalPreferences(), error: "Preferences could not be saved on this device." }; }
  });
  const [preferences, setPreferences] = useState(initial.preferences);
  const [persistenceError, setPersistenceError] = useState(initial.error);
  const current = useRef(preferences);
  function commit(next: TerminalPreferences): boolean {
    if (!validPreferences(next)) return false;
    current.current = next;
    setPreferences(next);
    try { localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next)); setPersistenceError(null); }
    catch { setPersistenceError("Preferences could not be saved on this device. Changes will last for this session."); }
    return true;
  }
  return {
    preferences, persistenceError,
    saveCommand(command: { id?: string; label: string; text: string }): boolean {
      const previous = current.current;
      if (command.id && !previous.commands.some((item) => item.id === command.id)) return false;
      const item = { id: command.id ?? crypto.randomUUID(), label: command.label.trim(), text: command.text };
      const commands = command.id ? previous.commands.map((old) => old.id === command.id ? item : old) : [...previous.commands, item];
      return commit({ ...previous, commands });
    },
    deleteCommand(id: string) {
      const previous = current.current;
      commit({ ...previous, commands: previous.commands.filter((item) => item.id !== id), favorites: previous.favorites.filter((item) => item.kind !== "command" || item.commandId !== id) });
    },
    toggleFavorite(shortcut: ShortcutRef): boolean {
      const previous = current.current;
      const found = previous.favorites.some((item) => shortcutId(item) === shortcutId(shortcut));
      return commit({ ...previous, favorites: found ? previous.favorites.filter((item) => shortcutId(item) !== shortcutId(shortcut)) : [...previous.favorites, shortcut] });
    },
    setFontSize(size: number) { commit({ ...current.current, fontSize: size }); },
  };
}
