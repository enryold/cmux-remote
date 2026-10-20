import { useEffect, useRef } from "react";
import type { useTerminalPreferences } from "../hooks/useTerminalPreferences";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { AllowedKey } from "../lib/cmux-rpc";
import type { SubmitResult } from "../lib/terminal-input";
import {
  cleanTerminalSnapshot,
  snapshotUpdate,
} from "../lib/terminal";
import { TerminalToolbar } from "./TerminalToolbar";

interface TerminalProps {
  surfaceId: string;
  content: string;
  stale: boolean;
  viewportEnabled: boolean;
  connected: boolean;
  agentSource?: string | null;
  settings: ReturnType<typeof useTerminalPreferences>;
  onKey(key: AllowedKey): void;
  onSubmit(text: string): Promise<SubmitResult>;
  connectionGeneration?: number;
  onUpload?(file: File, signal: AbortSignal): Promise<string>;
  onViewport(columns: number, rows: number, generation: number): void;
  onViewportClear(generation: number): void;
}

export function Terminal(props: TerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const applySnapshotRef = useRef<(content: string) => void>(() => undefined);
  const refitRef = useRef<() => void>(() => undefined);
  const callbacksRef = useRef(props);
  callbacksRef.current = props;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      disableStdin: true,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: callbacksRef.current.settings.preferences.fontSize,
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
    let writing = false;
    let disposed = false;
    let touching = false;
    let gestureRevision = 0;
    let fitFrame: number | null = null;
    let fitRequested = false;
    const scheduleFit = () => {
      fitRequested = true;
      if (fitFrame !== null || writing || touching || disposed) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = null;
        if (writing || touching || disposed) return;
        fitRequested = false;
        const buffer = term.buffer.active;
        const bottom = buffer.viewportY === buffer.baseY;
        let firstLine = buffer.viewportY;
        while (firstLine > 0 && buffer.getLine(firstLine)?.isWrapped) firstLine--;
        const anchor = buffer.getLine(firstLine)?.translateToString(true) ?? "";
        const offset = (buffer.viewportY - firstLine) * term.cols;
        fit.fit();
        if (bottom) term.scrollToBottom();
        else {
          const active = term.buffer.active;
          let found = -1;
          const prefix = anchor.slice(0, Math.min(20, term.cols));
          for (let i = 0; prefix && i < active.length; i++) {
            if (!active.getLine(i)?.isWrapped && active.getLine(i)?.translateToString(true).startsWith(prefix)) { found = i; break; }
          }
          term.scrollToLine(found < 0 ? 0 : found + Math.floor(offset / term.cols));
        }
        applySnapshot(callbacksRef.current.content);
      });
    };
    refitRef.current = scheduleFit;
    const applySnapshot = (raw: string) => {
      const next = cleanTerminalSnapshot(raw, term.cols);
      pending = next;
      flushSnapshot();
    };
    const flushSnapshot = () => {
      if (disposed || writing || touching || term.hasSelection() || pending === null) return;
      const next = pending;
      pending = null;
      const update = snapshotUpdate(applied, next);
      if (update.kind === "unchanged") return;

      const buffer = term.buffer.active;
      const atBottom = buffer.viewportY === buffer.baseY;
      const previousLine = buffer.viewportY;
      const anchor = buffer.getLine(previousLine)?.translateToString(true) ?? "";
      const revision = gestureRevision;
      writing = true;
      if (update.kind === "replace") term.reset();
      term.write(update.text, () => {
        if (disposed) return;
        writing = false;
        applied = next;
        if (!touching && revision === gestureRevision) {
          if (atBottom) term.scrollToBottom();
          else {
            const active = term.buffer.active;
            let line = -1;
            if (anchor) {
              for (let i = 0; i < active.length; i++) {
                if (active.getLine(i)?.translateToString(true) === anchor && (line < 0 || Math.abs(i - previousLine) < Math.abs(line - previousLine))) line = i;
              }
            }
            term.scrollToLine(line >= 0 ? line : 0);
          }
        }
        flushSnapshot();
        if (fitRequested) scheduleFit();
      });
    };
    const startTouch = () => { touching = true; gestureRevision++; };
    const endTouch = () => { touching = false; flushSnapshot(); if (fitRequested) scheduleFit(); };
    const onWheel = () => { gestureRevision++; };
    container.addEventListener("touchstart", startTouch, { passive: true });
    container.addEventListener("touchend", endTouch, { passive: true });
    container.addEventListener("touchcancel", endTouch, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    applySnapshotRef.current = applySnapshot;

    term.onSelectionChange(() => {
      if (!term.hasSelection()) flushSnapshot();
    });
    term.onResize(({ cols, rows }) => {
      if (!callbacksRef.current.viewportEnabled) return;
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        generation += 1;
        if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || cols > 300 || rows < 5 || rows > 120) {
          callbacksRef.current.onViewportClear(generation);
        } else callbacksRef.current.onViewport(cols, rows, generation);
      }, 100);
    });

    term.open(container);
    if (term.textarea) {
      term.textarea.readOnly = true;
      term.textarea.inputMode = "none";
      term.textarea.tabIndex = -1;
    }
    fit.fit();
    termRef.current = term;
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
      container.removeEventListener("touchstart", startTouch);
      container.removeEventListener("touchend", endTouch);
      container.removeEventListener("touchcancel", endTouch);
      container.removeEventListener("wheel", onWheel);
      resizeObserver.disconnect();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      if (callbacksRef.current.viewportEnabled) {
        generation += 1;
        callbacksRef.current.onViewportClear(generation);
      }
      applySnapshotRef.current = () => undefined;
      refitRef.current = () => undefined;
      termRef.current = null;
      term.dispose();
    };
  }, []);

  useEffect(() => applySnapshotRef.current(props.content), [props.content]);
  const fontSize = props.settings.preferences.fontSize;
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    refitRef.current();
  }, [fontSize]);

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
        connected={props.connected}
        agentSource={props.agentSource}
        settings={props.settings}
        onKey={props.onKey}
        onSubmit={props.onSubmit}
        connectionGeneration={props.connectionGeneration}
        onUpload={props.onUpload}
        onLatest={() => termRef.current?.scrollToBottom()}
      />
    </main>
  );
}
