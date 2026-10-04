import type { AllowedKey } from "./cmux-rpc";

export const KEY_SHORTCUTS: ReadonlyArray<{ key: AllowedKey; label: string; description: string }> = [
  { key: "escape", label: "Esc", description: "Close or cancel a menu" },
  { key: "tab", label: "Tab", description: "Next choice" },
  { key: "shift+tab", label: "Shift+Tab", description: "Previous choice" },
  { key: "enter", label: "Enter", description: "Confirm the current choice" },
  { key: "left", label: "←", description: "Left" },
  { key: "right", label: "→", description: "Right" },
  { key: "up", label: "↑", description: "Up" },
  { key: "down", label: "↓", description: "Down" },
  { key: "shift+left", label: "Shift+←", description: "Shift and Left" },
  { key: "shift+right", label: "Shift+→", description: "Shift and Right" },
  { key: "shift+up", label: "Shift+↑", description: "Shift and Up" },
  { key: "shift+down", label: "Shift+↓", description: "Shift and Down" },
  { key: "ctrl+c", label: "Ctrl-C", description: "Interrupt the current process" },
  { key: "ctrl+d", label: "Ctrl-D", description: "End input; may close a shell" },
];
export type ShortcutRef = { kind: "key"; key: AllowedKey } | { kind: "command"; commandId: string };
export interface TerminalPreferences {
  version: 1;
  fontSize: number;
  commands: Array<{ id: string; label: string; text: string }>;
  favorites: ShortcutRef[];
}
export const PREFERENCES_STORAGE_KEY = "cmux-remote.preferences.v2";
const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function defaultTerminalPreferences(): TerminalPreferences {
  return { version: 1, fontSize: 13, commands: [], favorites: (["escape", "tab", "left", "right", "up", "down", "shift+left", "enter"] as AllowedKey[]).map((key) => ({ kind: "key", key })) };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
export function validCommand(value: unknown): value is TerminalPreferences["commands"][number] {
  return record(value) && exact(value, ["id", "label", "text"]) && typeof value.id === "string" && uuid.test(value.id)
    && typeof value.label === "string" && value.label.trim().length > 0 && [...value.label].length <= 40 && !hasControl(value.label)
    && typeof value.text === "string" && value.text.trim().length > 0 && encoder.encode(value.text).length <= 4096 && !hasControl(value.text) && !/[\u2028\u2029]/.test(value.text);
}
function hasControl(text: string): boolean {
  return [...text].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
export function shortcutId(shortcut: ShortcutRef): string {
  return shortcut.kind === "key" ? `key:${shortcut.key}` : `command:${shortcut.commandId}`;
}
export function validPreferences(value: unknown): value is TerminalPreferences {
  if (!record(value) || !exact(value, ["version", "fontSize", "commands", "favorites"]) || value.version !== 1
    || !Number.isInteger(value.fontSize) || (value.fontSize as number) < 10 || (value.fontSize as number) > 24
    || !Array.isArray(value.commands) || value.commands.length > 20 || !value.commands.every(validCommand)
    || new Set(value.commands.map((command) => command.id.toLowerCase())).size !== value.commands.length
    || !Array.isArray(value.favorites) || value.favorites.length > 12) return false;
  const ids = new Set<string>();
  for (const favorite of value.favorites) {
    if (!record(favorite)) return false;
    if (favorite.kind === "key") {
      if (!exact(favorite, ["kind", "key"]) || !KEY_SHORTCUTS.some((item) => item.key === favorite.key)) return false;
    } else if (favorite.kind === "command") {
      if (!exact(favorite, ["kind", "commandId"]) || !value.commands.some((command) => command.id === favorite.commandId)) return false;
    } else return false;
    const id = shortcutId(favorite as ShortcutRef);
    if (ids.has(id)) return false;
    ids.add(id);
  }
  return encoder.encode(JSON.stringify(value)).length <= 131072;
}
export function parseTerminalPreferences(raw: string | null): TerminalPreferences {
  if (raw === null || encoder.encode(raw).length > 131072) return defaultTerminalPreferences();
  try { const value: unknown = JSON.parse(raw); return validPreferences(value) ? value : defaultTerminalPreferences(); }
  catch { return defaultTerminalPreferences(); }
}
