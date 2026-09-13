import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRpcRequest,
  parseServerMessage,
  type AllowedKey,
  type AllowedMethod,
  type Capabilities,
  type ConnectionStatus,
  type TreeSnapshot,
} from "../lib/cmux-rpc";
import { useWebSocket } from "./useWebSocket";

interface PendingRequest {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CmuxApi {
  bridgeStatus: ConnectionStatus;
  cmuxStatus: "connected" | "disconnected";
  capabilities: string[];
  tree: TreeSnapshot;
  getCapabilities(): Promise<Capabilities>;
  refreshTree(): Promise<TreeSnapshot>;
  readText(surfaceId: string, lines?: number): Promise<string>;
  sendText(surfaceId: string, text: string): Promise<void>;
  sendKey(surfaceId: string, key: AllowedKey): Promise<void>;
  reportViewport(
    surfaceId: string,
    columns: number,
    rows: number,
    generation: number,
  ): Promise<void>;
  clearViewport(surfaceId: string, generation: number): Promise<void>;
}

const EMPTY_TREE: TreeSnapshot = { workspaces: [] };
const RPC_TIMEOUT = 10_000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function invalidResult(): never {
  throw new Error("invalid_bridge_result");
}

function capabilitiesResult(value: unknown): Capabilities {
  const result = record(value);
  if (
    !result ||
    typeof result.protocol !== "string" ||
    typeof result.version !== "number" ||
    !Number.isSafeInteger(result.version) ||
    typeof result.access_mode !== "string" ||
    !Array.isArray(result.capabilities) ||
    !result.capabilities.every((item) => typeof item === "string")
  ) {
    return invalidResult();
  }
  return {
    protocol: result.protocol,
    version: result.version,
    access_mode: result.access_mode,
    capabilities: result.capabilities,
  };
}

function treeResult(value: unknown): TreeSnapshot {
  const result = record(value);
  if (!result || !Array.isArray(result.workspaces)) return invalidResult();

  return {
    workspaces: result.workspaces.map((workspaceValue) => {
      const workspace = record(workspaceValue);
      if (
        !workspace ||
        typeof workspace.id !== "string" ||
        typeof workspace.title !== "string" ||
        typeof workspace.index !== "number" ||
        typeof workspace.selected !== "boolean" ||
        !Array.isArray(workspace.panes)
      ) {
        return invalidResult();
      }
      return {
        id: workspace.id,
        title: workspace.title,
        index: workspace.index,
        selected: workspace.selected,
        panes: workspace.panes.map((paneValue) => {
          const pane = record(paneValue);
          if (
            !pane ||
            typeof pane.id !== "string" ||
            typeof pane.index !== "number" ||
            typeof pane.focused !== "boolean" ||
            !Array.isArray(pane.surfaces)
          ) {
            return invalidResult();
          }
          return {
            id: pane.id,
            index: pane.index,
            focused: pane.focused,
            surfaces: pane.surfaces.map((surfaceValue) => {
              const surface = record(surfaceValue);
              if (
                !surface ||
                typeof surface.id !== "string" ||
                typeof surface.type !== "string" ||
                typeof surface.title !== "string" ||
                typeof surface.index !== "number" ||
                typeof surface.selected !== "boolean"
              ) {
                return invalidResult();
              }
              return {
                id: surface.id,
                type: surface.type,
                title: surface.title,
                index: surface.index,
                selected: surface.selected,
              };
            }),
          };
        }),
      };
    }),
  };
}

export function useCmux(
  options: { enabled?: boolean; onUnauthorized?: () => void } = {},
): CmuxApi {
  const { enabled = true, onUnauthorized } = options;
  const [cmuxStatus, setCmuxStatus] = useState<
    "connected" | "disconnected"
  >("disconnected");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [tree, setTree] = useState<TreeSnapshot>(EMPTY_TREE);
  const pendingRef = useRef(new Map<string, PendingRequest>());
  const topologyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTreeRef = useRef<() => Promise<TreeSnapshot>>(() =>
    Promise.reject(new Error("bridge_disconnected")),
  );

  const handleMessage = useCallback((data: string) => {
    let message;
    try {
      message = parseServerMessage(data);
    } catch {
      return;
    }

    if ("id" in message) {
      const pending = pendingRef.current.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingRef.current.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error.code));
      return;
    }

    if (message.type === "state") {
      setCmuxStatus(message.cmux);
      return;
    }

    if (topologyTimerRef.current !== null) return;
    topologyTimerRef.current = setTimeout(() => {
      topologyTimerRef.current = null;
      void refreshTreeRef.current().catch(() => undefined);
    }, 100);
  }, []);

  const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
  const { status: bridgeStatus, send } = useWebSocket({
    url: wsUrl,
    enabled,
    onMessage: handleMessage,
    onUnauthorized,
  });

  const rpc = useCallback(
    (method: AllowedMethod, params: Record<string, unknown> = {}) => {
      const request = createRpcRequest(method, params);
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRef.current.delete(request.id);
          reject(new Error("rpc_timeout"));
        }, RPC_TIMEOUT);
        pendingRef.current.set(request.id, { resolve, reject, timer });
        if (!send(JSON.stringify(request))) {
          clearTimeout(timer);
          pendingRef.current.delete(request.id);
          reject(new Error("bridge_disconnected"));
        }
      });
    },
    [send],
  );

  const getCapabilities = useCallback(async () => {
    const result = capabilitiesResult(await rpc("system.capabilities"));
    setCapabilities(result.capabilities);
    return result;
  }, [rpc]);

  const refreshTree = useCallback(async () => {
    const result = treeResult(await rpc("system.tree"));
    setTree(result);
    return result;
  }, [rpc]);
  refreshTreeRef.current = refreshTree;

  const readText = useCallback(
    async (surfaceId: string, lines = 2_000) => {
      const result = record(
        await rpc("surface.read_text", { surface_id: surfaceId, lines }),
      );
      if (!result || typeof result.text !== "string") return invalidResult();
      return result.text;
    },
    [rpc],
  );

  const sendText = useCallback(
    async (surfaceId: string, text: string) => {
      await rpc("surface.send_text", { surface_id: surfaceId, text });
    },
    [rpc],
  );

  const sendKey = useCallback(
    async (surfaceId: string, key: AllowedKey) => {
      await rpc("surface.send_key", { surface_id: surfaceId, key });
    },
    [rpc],
  );

  const reportViewport = useCallback(
    async (
      surfaceId: string,
      columns: number,
      rows: number,
      generation: number,
    ) => {
      await rpc("terminal.viewport", {
        surface_id: surfaceId,
        viewport_columns: columns,
        viewport_rows: rows,
        viewport_generation: generation,
      });
    },
    [rpc],
  );

  const clearViewport = useCallback(
    async (surfaceId: string, generation: number) => {
      await rpc("terminal.viewport", {
        surface_id: surfaceId,
        clear: true,
        viewport_generation: generation,
      });
    },
    [rpc],
  );

  useEffect(() => {
    if (bridgeStatus !== "connected") {
      setCmuxStatus("disconnected");
      setCapabilities([]);
      for (const pending of pendingRef.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("bridge_disconnected"));
      }
      pendingRef.current.clear();
      if (topologyTimerRef.current !== null) {
        clearTimeout(topologyTimerRef.current);
        topologyTimerRef.current = null;
      }
      return;
    }

    void getCapabilities()
      .then(() => refreshTree())
      .catch(() => undefined);
  }, [bridgeStatus, getCapabilities, refreshTree]);

  useEffect(() => {
    if (bridgeStatus !== "connected") return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const startInterval = () => {
      if (interval !== null) clearInterval(interval);
      interval =
        document.visibilityState === "visible"
          ? setInterval(() => {
              void refreshTree().catch(() => undefined);
            }, 15_000)
          : null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshTree().catch(() => undefined);
      }
      startInterval();
    };
    startInterval();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (interval !== null) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bridgeStatus, refreshTree]);

  useEffect(
    () => () => {
      for (const pending of pendingRef.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("bridge_disconnected"));
      }
      pendingRef.current.clear();
    },
    [],
  );

  return {
    bridgeStatus,
    cmuxStatus,
    capabilities,
    tree,
    getCapabilities,
    refreshTree,
    readText,
    sendText,
    sendKey,
    reportViewport,
    clearViewport,
  };
}
