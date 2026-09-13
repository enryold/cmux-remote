import type { AllowedKey } from "../lib/cmux-rpc";

interface TerminalToolbarProps {
  onKey(key: AllowedKey): void;
  onCtrl?(): void;
  ctrlActive?: boolean;
}

const KEYS: Array<{ label: string; text: string; key: AllowedKey }> = [
  { label: "Esc", text: "Esc", key: "escape" },
  { label: "Tab", text: "Tab", key: "tab" },
  { label: "Ctrl-C", text: "⌃C", key: "ctrl+c" },
  { label: "Ctrl-D", text: "⌃D", key: "ctrl+d" },
  { label: "Up", text: "↑", key: "up" },
  { label: "Down", text: "↓", key: "down" },
  { label: "Enter", text: "↵", key: "enter" },
];

export function TerminalToolbar({
  onKey,
  onCtrl = () => undefined,
  ctrlActive = false,
}: TerminalToolbarProps) {
  return (
    <nav aria-label="Terminal keys" className="terminal-toolbar">
      {KEYS.slice(0, 2).map((item) => (
        <button
          aria-label={item.label}
          key={item.key}
          onClick={() => onKey(item.key)}
          type="button"
        >
          {item.text}
        </button>
      ))}
      <button
        aria-label="Ctrl"
        aria-pressed={ctrlActive}
        className={ctrlActive ? "active" : undefined}
        onClick={onCtrl}
        type="button"
      >
        Ctrl
      </button>
      {KEYS.slice(2).map((item) => (
        <button
          aria-label={item.label}
          key={item.key}
          onClick={() => onKey(item.key)}
          type="button"
        >
          {item.text}
        </button>
      ))}
    </nav>
  );
}
