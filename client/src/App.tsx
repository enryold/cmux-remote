import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { Header } from "./components/Header";
import { Login } from "./components/Login";
import { StatusBar } from "./components/StatusBar";
import { Terminal } from "./components/Terminal";
import { useAuth } from "./hooks/useAuth";
import { useCmux } from "./hooks/useCmux";
import { useTerminalPolling } from "./hooks/useTerminalPolling";
import type { AllowedKey, ConnectionStatus } from "./lib/cmux-rpc";
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
      setSelectedId(typeof state?.surfaceId === "string" ? state.surfaceId : null);
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
      setSelectedId(null);
      setNotice("Terminal closed");
      if (history.state?.surfaceId) history.back();
      else history.replaceState(null, "", location.pathname);
    }
  }, [cmux.tree, selectedId]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--app-height",
        `${viewport.height}px`,
      );
    };
    updateHeight();
    viewport.addEventListener("resize", updateHeight);
    return () => {
      viewport.removeEventListener("resize", updateHeight);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);

  useEffect(
    () => () => {
      if (inputErrorTimer.current !== null) {
        clearTimeout(inputErrorTimer.current);
      }
    },
    [],
  );

  const showInputError = useCallback(() => {
    setInputError("Input was not sent");
    if (inputErrorTimer.current !== null) clearTimeout(inputErrorTimer.current);
    inputErrorTimer.current = setTimeout(() => setInputError(null), 3_000);
  }, []);

  const sendText = useCallback(
    async (text: string) => {
      if (!selectedId) return false;
      try {
        await cmux.sendText(selectedId, text);
        setInputError(null);
        polling.refreshNow();
        return true;
      } catch {
        showInputError();
        return false;
      }
    }, [cmux.sendText, polling.refreshNow, selectedId, showInputError],
  );

  const sendKey = useCallback(
    async (key: AllowedKey) => {
      if (!selectedId) return;
      try {
        await cmux.sendKey(selectedId, key);
        setInputError(null);
        polling.refreshNow();
      } catch {
        showInputError();
      }
    }, [cmux.sendKey, polling.refreshNow, selectedId, showInputError],
  );

  const connection: ConnectionStatus = terminalConnected
    ? "connected"
    : cmux.bridgeStatus === "connecting"
      ? "connecting"
      : "disconnected";

  const openTerminal = (surfaceId: string) => {
    history.pushState({ surfaceId }, "", "#terminal");
    setNotice(null);
    setSelectedId(surfaceId);
  };

  return (
    <div className="app-shell">
      {selectedId && selected ? (
        <>
          <Header title={selected.title} onBack={() => history.back()} />
          <Terminal
            key={selectedId}
            content={polling.content}
            onInput={(text) => void sendText(text)}
            onKey={(key) => void sendKey(key)}
            onSubmit={(text) => sendText(`${text}\r`)}
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
