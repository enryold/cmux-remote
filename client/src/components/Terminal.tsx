import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { AllowedKey } from "../lib/cmux-rpc";
import {
  cleanTerminalSnapshot,
  controlText,
  restoredViewportLine,
} from "../lib/terminal";
import { TerminalToolbar } from "./TerminalToolbar";

interface TerminalProps {
  surfaceId: string;
  content: string;
  stale: boolean;
  viewportEnabled: boolean;
  onInput(text: string): void;
  onKey(key: AllowedKey): void;
  onViewport(columns: number, rows: number, generation: number): void;
  onViewportClear(generation: number): void;
}

export function Terminal(props: TerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const applySnapshotRef = useRef<(content: string) => void>(() => undefined);
  const callbacksRef = useRef(props);
  const ctrlRef = useRef(false);
  const [ctrlActive, setCtrlActive] = useState(false);
  callbacksRef.current = props;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      disableStdin: false,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      screenReaderMode: true,
      scrollback: 2_000,
      theme: {
        background: "#10131a",
        cursor: "#f4f4f5",
        foreground: "#e5e7eb",
        selectionBackground: "#3b506f",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    let generation = 0;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let applied: string | null = null;
    let pending: string | null = null;

    const applySnapshot = (raw: string) => {
      const next = cleanTerminalSnapshot(raw);
      if (next === applied) return;
      if (term.hasSelection()) {
        pending = next;
        return;
      }

      const buffer = term.buffer.active;
      const atBottom = buffer.viewportY === buffer.baseY;
      const distanceFromBottom = buffer.baseY - buffer.viewportY;
      applied = next;
      pending = null;
      term.reset();
      term.write(next, () => {
        if (atBottom) term.scrollToBottom();
        else {
          term.scrollToLine(
            restoredViewportLine(term.buffer.active.baseY, distanceFromBottom),
          );
        }
      });
    };
    applySnapshotRef.current = applySnapshot;

    term.onData((data) => {
      if (ctrlRef.current && data.length === 1) {
        const controlled = controlText(data);
        if (controlled !== null) {
          ctrlRef.current = false;
          setCtrlActive(false);
          callbacksRef.current.onInput(controlled);
          return;
        }
      }
      callbacksRef.current.onInput(data);
    });
    term.onSelectionChange(() => {
      if (!term.hasSelection() && pending !== null) applySnapshot(pending);
    });
    term.onResize(({ cols, rows }) => {
      if (!callbacksRef.current.viewportEnabled) return;
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        generation += 1;
        callbacksRef.current.onViewport(cols, rows, generation);
      }, 100);
    });

    term.open(container);
    fit.fit();
    termRef.current = term;
    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      if (callbacksRef.current.viewportEnabled) {
        generation += 1;
        callbacksRef.current.onViewportClear(generation);
      }
      applySnapshotRef.current = () => undefined;
      termRef.current = null;
      term.dispose();
    };
  }, []);

  useEffect(() => applySnapshotRef.current(props.content), [props.content]);

  const focus = () => termRef.current?.focus();
  const sendKey = (key: AllowedKey) => {
    callbacksRef.current.onKey(key);
    focus();
  };

  return (
    <main className="terminal-page">
      {props.stale ? (
        <p className="terminal-stale" role="status">
          Output may be stale
        </p>
      ) : null}
      <section
        aria-label="Terminal"
        className="terminal-container"
        ref={containerRef}
      />
      <TerminalToolbar
        ctrlActive={ctrlActive}
        onCtrl={() => {
          ctrlRef.current = !ctrlRef.current;
          setCtrlActive(ctrlRef.current);
          focus();
        }}
        onKey={sendKey}
      />
    </main>
  );
}
