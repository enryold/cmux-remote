import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { Header } from "./components/Header";
import { Login } from "./components/Login";
import { StatusBar } from "./components/StatusBar";
import { Terminal } from "./components/Terminal";
import { useAuth } from "./hooks/useAuth";
import { useCmux } from "./hooks/useCmux";
import { useTerminalPolling } from "./hooks/useTerminalPolling";
import type { ConnectionStatus } from "./lib/cmux-rpc";
import { createTerminalInputDispatcher, submissionError, type TerminalInput } from "./lib/terminal-input";
import {
  recoverSelectedSurface,
  terminalWorkspaces,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const selectionRef = useRef({ id: selectedId, revision: 0 });
  if (selectionRef.current.id !== selectedId) selectionRef.current = { id: selectedId, revision: selectionRef.current.revision + 1 };
  const selectSurface = (id: string | null) => {
    selectionRef.current = { id, revision: selectionRef.current.revision + 1 };
    setSelectedId(id);
  };
  const apiRef = useRef(cmux);
  apiRef.current = cmux;
  const inputErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaces = useMemo(() => terminalWorkspaces(cmux.tree), [cmux.tree]);
  const selected = workspaces
    .flatMap((workspace) => workspace.terminals)
    .find((surface) => surface.id === selectedId);
  const terminalConnected =
    cmux.bridgeStatus === "connected" && cmux.cmuxStatus === "connected";
  const polling = useTerminalPolling({
    enabled: terminalConnected && selected !== undefined,
    surfaceId: selectedId,
    readText: cmux.readText,
  });

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as { surfaceId?: unknown } | null;
      selectSurface(typeof state?.surfaceId === "string" ? state.surfaceId : null);
      setInputError(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (
      selectedId !== null &&
      recoverSelectedSurface(cmux.tree, selectedId) === null
    ) {
      selectSurface(null);
      setNotice("Terminal closed");
      if (history.state?.surfaceId) history.back();
      else history.replaceState(null, "", location.pathname);
    }
  }, [cmux.tree, selectedId]);

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
      isCurrent: (id, capturedGeneration) => selectionRef.current.id === id
        && selectionRef.current.revision === revision && apiRef.current.isConnectionCurrent(capturedGeneration),
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

  return (
    <div className="app-shell">
      {selectedId && selected ? (
        <>
          <Header title={selected.title} onBack={() => history.back()} />
          <Terminal
            key={selectedId}
            content={polling.content}
            onInput={(input) => void sendInput(input)}
            onKey={(key) => void sendInput({ kind: "key", key })}
            onSubmit={submitPrompt}
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
            viewportEnabled={cmux.capabilities.includes("terminal.viewport.v1")}
          />
        </>
      ) : (
        <>
          <Header title="cmux Remote" onLogout={() => void logout()} />
          {notice ? <p className="app-notice" role="status">{notice}</p> : null}
          <Dashboard
            connection={connection}
            onOpen={openTerminal}
            workspaces={workspaces}
          />
        </>
      )}
      {inputError ? <p className="input-error" role="alert">{inputError}</p> : null}
      <StatusBar bridge={cmux.bridgeStatus} cmux={cmux.cmuxStatus} />
    </div>
  );
}
