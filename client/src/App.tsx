import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { Header } from "./components/Header";
import { Login } from "./components/Login";
import { StatusBar } from "./components/StatusBar";
import { Terminal } from "./components/Terminal";
import { SurfacePreview } from "./components/SurfacePreview";
import { useSurfacePreview } from "./hooks/useSurfacePreview";
import { useAuth } from "./hooks/useAuth";
import { useCmux } from "./hooks/useCmux";
import { useTerminalPolling } from "./hooks/useTerminalPolling";
import { useTerminalPreferences } from "./hooks/useTerminalPreferences";
import type { ConnectionStatus } from "./lib/cmux-rpc";
import { uploadAttachment } from "./lib/attachments";
import { createTerminalInputDispatcher, submissionError, type TerminalInput } from "./lib/terminal-input";
import {
  previewSurfaceWorkspaces,
} from "./lib/topology";

export function App() {
  const auth = useAuth();

  if (auth.status === "checking") {
    return <main className="loading-page">Connecting…</main>;
  }
  if (auth.status === "anonymous") {
    return (
      <Login
        deviceAuthorized={auth.deviceAuthorized}
        error={auth.error}
        mode={auth.mode}
        onLogin={auth.login}
      />
    );
  }
  return (
    <CommandCenter
      expire={auth.expire}
      logout={auth.logout}
    />
  );
}

function CommandCenter({
  expire,
  logout,
}: {
  expire(): void;
  logout(): Promise<void>;
}) {
  const cmux = useCmux({ onUnauthorized: expire });
  const settings = useTerminalPreferences();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tabBusy, setTabBusy] = useState(false);
  const tabBusyRef = useRef(false);
  const selectionRef = useRef({ id: selectedId, revision: 0 });
  if (selectionRef.current.id !== selectedId) selectionRef.current = { id: selectedId, revision: selectionRef.current.revision + 1 };
  const selectSurface = useCallback((id: string | null) => {
    selectionRef.current = { id, revision: selectionRef.current.revision + 1 };
    setSelectedId(id);
    setActionError(null);
  }, []);
  const apiRef = useRef(cmux);
  apiRef.current = cmux;
  const inputErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaces = useMemo(() => previewSurfaceWorkspaces(cmux.tree), [cmux.tree]);
  const selected = workspaces
    .flatMap((workspace) => workspace.surfaces)
    .find((surface) => surface.id === selectedId);
  const selectedWorkspace = workspaces.find((workspace) => workspace.surfaces.some((surface) => surface.id === selectedId));
  const selectedTypeRef = useRef(selected?.type);
  selectedTypeRef.current = selected?.type;
  const terminalConnected =
    cmux.bridgeStatus === "connected" && cmux.cmuxStatus === "connected";
  const polling = useTerminalPolling({
    enabled: terminalConnected && selected?.type === "terminal",
    surfaceId: selected?.type === "terminal" ? selectedId : null,
    readText: cmux.readText,
  });
  const preview = useSurfacePreview({ surfaceType: selected?.type ?? null, surfaceId: selected?.type !== "terminal" ? selectedId : null, enabled: terminalConnected && selected !== undefined && selected.type !== "terminal", onUnauthorized: expire, generation: cmux.connectionGeneration });

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as { surfaceId?: unknown } | null;
      selectSurface(typeof state?.surfaceId === "string" ? state.surfaceId : null);
      setInputError(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [selectSurface]);

  useEffect(() => {
    if (
      selectedId !== null &&
      selected === undefined
    ) {
      selectSurface(null);
      setNotice("Surface closed");
      if (history.state?.surfaceId) history.back();
      else history.replaceState(null, "", location.pathname);
    }
  }, [selected, selectedId, selectSurface]);

  useEffect(
    () => () => {
      if (inputErrorTimer.current !== null) {
        clearTimeout(inputErrorTimer.current);
      }
    },
    [],
  );

  const showInputError = useCallback((message = "Input was not sent") => {
    setInputError(message);
    if (inputErrorTimer.current !== null) clearTimeout(inputErrorTimer.current);
    inputErrorTimer.current = setTimeout(() => setInputError(null), 3_000);
  }, []);

  const generation = cmux.connectionGeneration;
  const dispatcher = useMemo(() => {
    const revision = selectionRef.current.revision;
    return createTerminalInputDispatcher({
      sendText: cmux.sendText, sendKey: cmux.sendKey,
      isCurrent: (id, capturedGeneration) => !tabBusyRef.current && id === selectedId && capturedGeneration === generation && selectionRef.current.id === id
        && selectionRef.current.revision === revision && selectedTypeRef.current === "terminal" && apiRef.current.isConnectionCurrent(capturedGeneration),
    });
  }, [selectedId, generation, cmux.sendText, cmux.sendKey]);
  const sendInput = async (input: TerminalInput) => {
    if (!selectedId) return;
    try {
      await dispatcher.send(selectedId, generation, input);
      setInputError(null);
      polling.refreshNow();
    } catch { showInputError(); }
  };
  const submitPrompt = async (text: string) => {
    const result = await dispatcher.submit(selectedId ?? "", generation, text);
    const error = submissionError(result, text);
    if (error) showInputError(error);
    else setInputError(null);
    polling.refreshNow();
    return result;
  };

  const connection: ConnectionStatus = terminalConnected
    ? "connected"
    : cmux.bridgeStatus === "connecting"
      ? "connecting"
      : "disconnected";

  const openTerminal = (surfaceId: string) => {
    history.pushState({ surfaceId }, "", "#terminal");
    setNotice(null);
    selectSurface(surfaceId);
  };

  const createTab = async (workspaceId: string, paneId: string) => {
    if (tabBusyRef.current || !terminalConnected) return;
    tabBusyRef.current = true; setTabBusy(true); setActionError(null);
    const revision = selectionRef.current.revision;
    try {
      const surfaceId = await cmux.createSurface(workspaceId, paneId);
      if (!apiRef.current.isConnectionCurrent(generation)) throw new Error("disconnected");
      await cmux.refreshTree();
      if (apiRef.current.isConnectionCurrent(generation) && selectionRef.current.revision === revision) openTerminal(surfaceId);
    } catch (error) {
      setActionError(error instanceof Error && error.message === "unsupported_method"
        ? "New terminals are unavailable on this bridge. Restart the bridge, then reload the app."
        : "Opening a terminal was not confirmed. Check the tabs before trying again.");
      void cmux.refreshTree().catch(() => undefined);
    } finally { tabBusyRef.current = false; setTabBusy(false); }
  };
  const closeTab = async () => {
    if (tabBusyRef.current || !terminalConnected || !selected || !selectedWorkspace) return;
    if (!window.confirm(`Close “${selected.title}”? Running processes will stop and unsaved changes may be lost.`)) return;
    tabBusyRef.current = true; setTabBusy(true); setActionError(null);
    try {
      await cmux.closeSurface(selectedWorkspace.id, selected.id);
      await cmux.refreshTree();
    } catch (error) {
      setActionError(error instanceof Error && error.message === "invalid_state"
        ? "cmux keeps the last tab open. Create another terminal first."
        : "Closing the tab was not confirmed. Check the tabs before trying again.");
      void cmux.refreshTree().catch(() => undefined);
    } finally { tabBusyRef.current = false; setTabBusy(false); }
  };
  const closeInactive = async (workspaceId: string, surfaceIds: string[]) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (tabBusyRef.current || !terminalConnected || !workspace || !surfaceIds.length) return;
    if (!window.confirm(`Close ${surfaceIds.length} inactive tabs in “${workspace.title}”? Running processes will stop and unsaved changes may be lost.`)) return;
    tabBusyRef.current = true; setTabBusy(true); setActionError(null);
    const revision = selectionRef.current.revision;
    let closed = 0;
    try {
      for (const surfaceId of surfaceIds) {
        if (!apiRef.current.isConnectionCurrent(generation) || selectionRef.current.revision !== revision) break;
        const tree = await cmux.refreshTree();
        if (!apiRef.current.isConnectionCurrent(generation) || selectionRef.current.revision !== revision) break;
        const current = previewSurfaceWorkspaces(tree).find((item) => item.id === workspaceId)?.surfaces.find((surface) => surface.id === surfaceId);
        if (!current || current.selected || current.hasUnread || current.agent?.state === "working" || current.agent?.state === "needs_attention") continue;
        await cmux.closeSurface(workspaceId, surfaceId);
        closed++;
      }
    } catch (error) {
      setActionError(error instanceof Error && error.message === "invalid_state"
        ? `cmux keeps the last tab open. ${closed} tabs were closed.`
        : `Closed ${closed} of ${surfaceIds.length} tabs. Closing stopped; check the remaining tabs before trying again.`);
    } finally {
      await cmux.refreshTree().catch(() => undefined);
      tabBusyRef.current = false; setTabBusy(false);
    }
  };

  return (
    <div className="app-shell">
      {selectedId && selected ? (
        <>
          <Header title={selected.title} onBack={() => history.back()} busy={tabBusy || !terminalConnected}
            onNew={selectedWorkspace ? () => void createTab(selectedWorkspace.id, selected.paneId) : undefined} onClose={() => void closeTab()} />
          {selected.type === "terminal" ? <Terminal
            key={selectedId}
            content={polling.content}
            connected={terminalConnected && !tabBusy}
            agentSource={selected.agent?.source}
            settings={settings}
            onKey={(key) => void sendInput({ kind: "key", key })}
            onSubmit={submitPrompt}
            connectionGeneration={generation}
            onUpload={async (file, signal) => {
              const revision = selectionRef.current.revision;
              const current = () => !signal.aborted && selectionRef.current.id === selectedId
                && selectionRef.current.revision === revision && selectedTypeRef.current === "terminal"
                && apiRef.current.isConnectionCurrent(generation);
              if (!current()) throw new Error("Upload interrupted. Your prompt was kept.");
              const path = await uploadAttachment(selectedId, file, signal, expire);
              if (!current()) throw new Error("Upload interrupted. Your prompt was kept.");
              return path;
            }}
            onViewport={(columns, rows, generation) => {
              void cmux
                .reportViewport(selectedId, columns, rows, generation)
                .catch(() => undefined);
            }}
            onViewportClear={(generation) => {
              void cmux.clearViewport(selectedId, generation).catch(() => undefined);
            }}
            stale={polling.error !== null}
            surfaceId={selectedId}
            viewportEnabled={false /* Remote sizing also resizes the Mac surface. */}
          /> : <SurfacePreview key={selectedId} {...preview} nativeImage={selected.type === "filepreview"} />}
        </>
      ) : (
        <>
          <Header title="cmux Remote" onLogout={() => void logout()} />
          {notice ? <p className="app-notice" role="status">{notice}</p> : null}
          <Dashboard
            connection={connection}
            onOpen={openTerminal}
            workspaces={workspaces}
            busy={tabBusy}
            onCreate={(workspaceId, paneId) => void createTab(workspaceId, paneId)}
            onCloseInactive={(workspaceId, surfaceIds) => void closeInactive(workspaceId, surfaceIds)}
          />
        </>
      )}
      {inputError ? <p className="input-error" role="alert">{inputError}</p> : null}
      {actionError ? <div className="input-error action-error" role="alert"><span>{actionError}</span><button type="button" aria-label="Dismiss notice" onClick={() => setActionError(null)}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m6 6 12 12M6 18 18 6" /></svg></button></div> : null}
      <StatusBar bridge={cmux.bridgeStatus} cmux={cmux.cmuxStatus} />
    </div>
  );
}
