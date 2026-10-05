import { useEffect, useRef, useState } from "react";
import type { useTerminalPreferences } from "../hooks/useTerminalPreferences";
import type { AllowedKey } from "../lib/cmux-rpc";
import { submissionError, type SubmitResult } from "../lib/terminal-input";
import { KEY_SHORTCUTS, shortcutId, type ShortcutRef } from "../lib/terminal-preferences";
import { ShortcutMenu } from "./ShortcutMenu";
import { validateAttachment } from "../lib/attachments";

interface TerminalToolbarProps {
  connected: boolean;
  settings: ReturnType<typeof useTerminalPreferences>;
  onKey(key: AllowedKey): void;
  onSubmit(text: string): Promise<SubmitResult>;
  onLatest?(): void;
  connectionGeneration?: number;
  onUpload?(file: File, signal: AbortSignal): Promise<string>;
}
export function TerminalToolbar({ connected, settings, onKey, onSubmit, onLatest, connectionGeneration = 0, onUpload }: TerminalToolbarProps) {
  const [text, setText] = useState("");
  const textRef = useRef("");
  const changeText = (value: string) => { textRef.current = value; setText(value); };
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const activeUpload = useRef<AbortController | null>(null);
  const busy = submitting || uploading;
  const [menuOpen, setMenuOpen] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Connection changes must cancel the previous transfer.
  useEffect(() => {
    const cancel = () => {
      if (!activeUpload.current) return;
      activeUpload.current.abort(); activeUpload.current = null;
      setUploading(false); setUploadNotice(null);
      setUploadError("Upload interrupted. Your prompt was kept; attach the files again.");
    };
    const visibility = () => { if (document.visibilityState === "hidden") cancel(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { cancel(); document.removeEventListener("visibilitychange", visibility); };
  }, [connected, connectionGeneration]);
  const attach = async (files: File[]) => {
    if (!connected || !onUpload || inFlight.current || activeUpload.current || !files.length) return;
    setUploadError(null); setUploadNotice(null);
    try {
      if (files.length > 4) throw new Error("Choose up to four files at a time.");
      files.forEach(validateAttachment);
    } catch (error) { setUploadError((error as Error).message); return; }
    const controller = new AbortController();
    activeUpload.current = controller; setUploading(true);
    try {
      for (const [index, file] of files.entries()) {
        setUploadNotice(`Uploading ${index + 1}/${files.length}: ${file.name}`);
        const path = await onUpload(file, controller.signal);
        if (controller.signal.aborted || activeUpload.current !== controller) return;
        const next = `${textRef.current + (textRef.current ? " " : "")}'${path.replace(/'/g, "'\\''")}'`;
        if (next.length > 4096) throw new Error("The prompt is full. Shorten it before attaching another file.");
        changeText(next);
      }
      setUploadNotice(`Attached ${files.map((file) => file.name).join(", ")}. Review the prompt, then press Send.`);
    } catch (error) {
      if (!controller.signal.aborted) {
        setUploadNotice(null);
        setUploadError(error instanceof Error ? error.message : "Upload failed. Your prompt was kept.");
      }
    } finally {
      if (activeUpload.current === controller) { activeUpload.current = null; setUploading(false); }
    }
  };
  const submit = async () => {
    if (!connected || composing.current || inFlight.current || activeUpload.current) return;
    inFlight.current = true; setSubmitting(true);
    try { if (await onSubmit(text) === "accepted") { changeText(""); setUploadNotice(null); setUploadError(null); } }
    finally { inFlight.current = false; setSubmitting(false); }
  };
  const invoke = async (shortcut: ShortcutRef) => {
    if (!connected || inFlight.current || activeUpload.current) return;
    if (shortcut.kind === "key") { onKey(shortcut.key); setMenuOpen(false); return; }
    const command = settings.preferences.commands.find((item) => item.id === shortcut.commandId);
    if (!command) return;
    inFlight.current = true; setSubmitting(true); setCommandError(null);
    try {
      const result = await onSubmit(command.text);
      setCommandError(submissionError(result, command.text));
      if (result === "accepted") setMenuOpen(false);
    }
    finally { inFlight.current = false; setSubmitting(false); }
  };
  return (
    <div className="terminal-controls">
      <form className="terminal-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {onUpload ? <>
          <input ref={picker} aria-label="Files and images" type="file" multiple hidden
            onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void attach(files); }} />
          <button aria-label="Attach files or images" disabled={!connected || busy} type="button" onClick={() => picker.current?.click()}>📎</button>
        </> : null}
        <input aria-label="Prompt or command" autoCapitalize="none" autoComplete="off" autoCorrect="off"
          disabled={submitting} enterKeyHint="send" maxLength={4096}
          onChange={(event) => changeText(event.target.value)}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
            event.preventDefault(); void submit();
          }} placeholder="Prompt or command" spellCheck={false} type="text" value={text} />
        <button disabled={!connected || busy} type="submit">Send</button>
      </form>
      <nav aria-label="Terminal shortcuts" className="terminal-toolbar">
        <button ref={menuButton} type="button" onClick={() => setMenuOpen(true)}>Shortcuts</button>
        <button type="button" onClick={onLatest}>Latest</button>
        {settings.preferences.favorites.map((shortcut) => {
          const label = shortcut.kind === "key" ? KEY_SHORTCUTS.find((item) => item.key === shortcut.key)?.label : settings.preferences.commands.find((item) => item.id === shortcut.commandId)?.label;
          return label ? <button type="button" key={shortcutId(shortcut)} disabled={!connected || busy} aria-label={label} onClick={() => void invoke(shortcut)}>{label}</button> : null;
        })}
      </nav>
      {uploadNotice ? <p className="attachment-notice" role="status">{uploadNotice}</p> : null}
      {uploadError ? <p className="input-error" role="alert">{uploadError}</p> : null}
      {menuOpen ? <ShortcutMenu settings={settings} connected={connected} busy={busy} submissionWarning={commandError} returnFocus={menuButton.current} onInvoke={(shortcut) => void invoke(shortcut)} onClose={() => setMenuOpen(false)} /> : null}
    </div>
  );
}
