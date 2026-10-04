import { useRef, useState } from "react";
import type { AllowedKey } from "../lib/cmux-rpc";
import type { SubmitResult } from "../lib/terminal-input";

interface TerminalToolbarProps {
  onKey(key: AllowedKey): void;
  onSubmit(text: string): Promise<SubmitResult>;
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
  onSubmit,
  onCtrl = () => undefined,
  ctrlActive = false,
}: TerminalToolbarProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const composing = useRef(false);

  const submit = async () => {
    if (composing.current || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try { if (await onSubmit(text) === "accepted") setText(""); }
    finally { inFlight.current = false; setSubmitting(false); }
  };

  return (
    <div className="terminal-controls">
      <form className="terminal-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <input
          aria-label="Prompt or command"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          disabled={submitting}
          enterKeyHint="send"
          maxLength={4_096}
          onChange={(event) => setText(event.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
            event.preventDefault();
            void submit();
          }}
          placeholder="Prompt or command"
          spellCheck={false}
          type="text"
          value={text}
        />
        <button
          disabled={submitting}
          type="submit"
        >
          Send
        </button>
      </form>
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
    </div>
  );
}
