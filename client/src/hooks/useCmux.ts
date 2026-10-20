import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRpcRequest,
  parseServerMessage,
  type AllowedKey,
  type AllowedMethod,
  type Capabilities,
  type ConnectionStatus,
  type ServerMessage,
  type TreeSnapshot,
  type AgentActivity,
  type WorkspaceActivity,
} from "../lib/cmux-rpc";
import { useWebSocket } from "./useWebSocket";

interface PendingRequest {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CmuxApi {
  connectionGeneration: number;
  isConnectionCurrent(generation: number): boolean;
  bridgeStatus: ConnectionStatus;
  cmuxStatus: "connected" | "disconnected";
  capabilities: string[];
  tree: TreeSnapshot;
  getCapabilities(): Promise<Capabilities>;
  refreshTree(): Promise<TreeSnapshot>;
  readText(surfaceId: string, lines?: number): Promise<string>;
  sendText(surfaceId: string, text: string): Promise<void>;
  sendKey(surfaceId: string, key: AllowedKey): Promise<void>;
  createSurface(workspaceId: string, paneId: string): Promise<string>;
  closeSurface(workspaceId: string, surfaceId: string): Promise<void>;
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
        activity: activityResult(workspace.activity),
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
                || (surface.urlLabel !== null && (typeof surface.urlLabel !== "string" || new TextEncoder().encode(surface.urlLabel).length > 4096))
              ) {
                return invalidResult();
              }
              return {
                id: surface.id,
                type: surface.type,
                title: surface.title,
                index: surface.index,
                selected: surface.selected,
                urlLabel: surface.urlLabel as string | null,
                agent: agentResult(surface.agent),
                ...(surface.hasUnread === true ? { hasUnread: true } : {}),
              };
            }),
          };
        }),
      };
    }),
  };
}

function activityResult(value: unknown): WorkspaceActivity | undefined {
  if (value === undefined) return undefined;
  const item = record(value);
  if (!item || typeof item.observedAt !== "number" || !Number.isFinite(item.observedAt)
    || (item.lastActivityAt !== null && (typeof item.lastActivityAt !== "number" || !Number.isFinite(item.lastActivityAt)))
    || typeof item.unreadCount !== "number" || !Number.isSafeInteger(item.unreadCount) || item.unreadCount < 0 || item.unreadCount > 9999) return undefined;
  return { observedAt: item.observedAt, lastActivityAt: item.lastActivityAt as number | null, unreadCount: item.unreadCount };
}
function agentResult(value: unknown): AgentActivity | undefined {
  const item = record(value);
  if (!item || (item.source !== null && (typeof item.source !== "string" || new TextEncoder().encode(item.source).length > 160))
    || !["working", "idle", "needs_attention", "unknown"].includes(String(item.state))) return undefined;
  return { source: item.source as string | null, state: item.state as AgentActivity["state"] };
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
  const pendingTreeRefreshRef = useRef<Promise<TreeSnapshot> | null>(null);
  const connectionRef = useRef({ generation: 0, bridge: false, cmux: false });
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const invalidate = useCallback(() => {
    connectionRef.current.generation++;
    setConnectionGeneration(connectionRef.current.generation);
    for (const pending of pendingRef.current.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("bridge_disconnected"));
    }
    pendingRef.current.clear();
    pendingTreeRefreshRef.current = null;
    setTree((previous) => ({ workspaces: previous.workspaces.map((workspace) => ({ ...workspace, activity: undefined,
      panes: workspace.panes.map((pane) => ({ ...pane, surfaces: pane.surfaces.map((surface) => ({ ...surface, agent: undefined, hasUnread: undefined })) })) })) }));
  }, []);
  const isConnectionCurrent = useCallback((generation: number) => {
    const connection = connectionRef.current;
    return generation === connection.generation && connection.bridge && connection.cmux;
  }, []);
  const onBridgeStatus = useCallback((status: ConnectionStatus) => {
    const connection = connectionRef.current;
    if (status !== "connected") {
      invalidate();
      connection.cmux = false;
      setCmuxStatus("disconnected");
    }
    connection.bridge = status === "connected";
  }, [invalidate]);
  const topologyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTreeRef = useRef<() => Promise<TreeSnapshot>>(() =>
    Promise.reject(new Error("bridge_disconnected")),
  );

  const handleMessage = useCallback((data: string) => {
    let message: ServerMessage;
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
      if (message.cmux === "disconnected") invalidate();
      connectionRef.current.cmux = message.cmux === "connected";
      setCmuxStatus(message.cmux);
      return;
    }

    if (topologyTimerRef.current !== null) return;
    topologyTimerRef.current = setTimeout(() => {
      topologyTimerRef.current = null;
      void refreshTreeRef.current().catch(() => undefined);
    }, 100);
  }, [invalidate]);

  const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
  const { status: bridgeStatus, send } = useWebSocket({
    url: wsUrl,
    enabled,
    onMessage: handleMessage,
    onUnauthorized,
    onStatusChange: onBridgeStatus,
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

  const refreshTree = useCallback(() => {
    const generation = connectionRef.current.generation;
    const refresh: Promise<TreeSnapshot> = rpc("system.tree").then((value) => {
      if (generation !== connectionRef.current.generation) throw new Error("bridge_disconnected");
      if (pendingTreeRefreshRef.current && pendingTreeRefreshRef.current !== refresh) return pendingTreeRefreshRef.current;
      const result = treeResult(value);
      setTree(result);
      return result;
    });
    pendingTreeRefreshRef.current = refresh;
    return refresh;
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

  const createSurface = useCallback(async (workspaceId: string, paneId: string) => {
    const result = record(await rpc("surface.create", { workspace_id: workspaceId, pane_id: paneId }));
    if (!result || result.workspace_id !== workspaceId || result.pane_id !== paneId || typeof result.surface_id !== "string") return invalidResult();
    return result.surface_id;
  }, [rpc]);
  const closeSurface = useCallback(async (workspaceId: string, surfaceId: string) => {
    const result = record(await rpc("surface.close", { workspace_id: workspaceId, surface_id: surfaceId, confirmed: true }));
    if (!result || result.workspace_id !== workspaceId || result.surface_id !== surfaceId) return invalidResult();
  }, [rpc]);

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
    // A socket event can arrive before this render's passive effect. Never let
    // an older connecting/disconnected render overwrite the newer connection.
    if (connectionGeneration !== connectionRef.current.generation
      || (bridgeStatus === "connected") !== connectionRef.current.bridge) return;
    if (bridgeStatus !== "connected") {
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
  }, [bridgeStatus, connectionGeneration, getCapabilities, refreshTree]);

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
    connectionGeneration,
    isConnectionCurrent,
    bridgeStatus,
    cmuxStatus,
    capabilities,
    tree,
    getCapabilities,
    refreshTree,
    readText,
    sendText,
    sendKey,
    createSurface,
    closeSurface,
    reportViewport,
    clearViewport,
  };
}
