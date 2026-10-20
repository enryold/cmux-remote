import type { ServerWebSocket } from "bun";
import { CmuxClient, CmuxRequestError } from "./cmux-client";
import type { CmuxEventStream } from "./cmux-events";
import type { RuntimeConfig } from "./config";
import { coloredTerminalText } from "./terminal-colors";
import {
  parseAllowedRequest,
  RpcValidationError,
  sanitizeCmuxResult,
  toCmuxCall,
  type AllowedRequest,
  type TreeSnapshot,
} from "./rpc";

export interface WSData {
  clientId: string;
  cmux: CmuxClient | null;
  metadata: CmuxClient | null;
  cmuxState: "connected" | "disconnected" | null;
  inputTail: Promise<void>;
  inputQueued: number;
  viewport: { surfaceId: string; generation: number } | null;
  unsubscribeEvents: (() => void) | null;
  closed: boolean;
  connectionGeneration: number;
}

interface WebSocketDependencies {
  config: RuntimeConfig;
  eventStream: CmuxEventStream;
  createCmuxClient?: (
    onStateChange: (connected: boolean) => void,
  ) => CmuxClient;
}

export function createWebSocketData(): WSData {
  return {
    clientId: crypto.randomUUID(),
    cmux: null,
    metadata: null,
    cmuxState: null,
    inputTail: Promise.resolve(),
    inputQueued: 0,
    viewport: null,
    unsubscribeEvents: null,
    closed: false,
    connectionGeneration: 0,
  };
}

function sendJson(
  ws: ServerWebSocket<WSData>,
  value: Record<string, unknown>,
): void {
  if (ws.data.closed) return;
  try {
    ws.send(JSON.stringify(value));
  } catch {
    // Socket teardown races are expected during background/network changes.
  }
}

function sendState(
  ws: ServerWebSocket<WSData>,
  cmux: "connected" | "disconnected",
): void {
  if (ws.data.cmuxState === cmux) return;
  ws.data.cmuxState = cmux;
  sendJson(ws, { type: "state", cmux });
}

function requestId(raw: string): string | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" && Buffer.byteLength(id) <= 128 ? id : null;
  } catch {
    return null;
  }
}

function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof RpcValidationError || error instanceof CmuxRequestError) {
    return { code: error.code, message: error.code };
  }
  return { code: "bridge_error", message: "bridge_error" };
}

async function dispatch(
  data: WSData,
  request: AllowedRequest,
): Promise<unknown> {
  const cmux = data.cmux;
  if (!cmux) throw new CmuxRequestError("cmux_disconnected");

  const generation = data.connectionGeneration;
  if (request.method === "surface.create" || request.method === "surface.close") {
    if (!cmux.isConnected || data.cmuxState !== "connected") throw new CmuxRequestError("cmux_disconnected");
    const tree = sanitizeCmuxResult("system.tree", await cmux.request("system.tree", { all: true })) as TreeSnapshot;
    const owners = tree.workspaces.filter((workspace) => workspace.id === request.params.workspace_id);
    const owner = owners[0];
    if (owners.length !== 1 || !owner) throw new RpcValidationError("surface_unavailable");
    if (request.method === "surface.create") {
      if (owner.panes.filter((pane) => pane.id === request.params.pane_id).length !== 1) throw new RpcValidationError("surface_unavailable");
    } else {
      const matches = tree.workspaces.flatMap((workspace) => workspace.panes.flatMap((pane) => pane.surfaces.filter((surface) => surface.id === request.params.surface_id).map(() => workspace.id)));
      if (matches.length !== 1 || matches[0] !== owner.id) throw new RpcValidationError("surface_unavailable");
    }
    if (data.closed || generation !== data.connectionGeneration || !cmux.isConnected) throw new CmuxRequestError("cmux_disconnected");
  }

  if (request.method === "terminal.viewport") {
    const previous = data.viewport;
    const nextSurface = request.params.surface_id;
    if (previous && previous.surfaceId !== nextSurface) {
      await cmux.request("terminal.viewport", {
        surface_id: previous.surfaceId,
        client_id: data.clientId,
        clear: true,
        viewport_generation: previous.generation + 1,
      });
      data.viewport = null;
    }
  }

  const call = toCmuxCall(request, data.clientId);
  const result = await cmux.request(call.method, call.params);

  if (request.method === "surface.read_text") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const replay = await Promise.race([
        cmux.request("terminal.replay", { surface_id: request.params.surface_id, anchor: "screen", max_scrollback_rows: request.params.lines }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("capture_timeout")), 500); }),
      ]);
      const text = coloredTerminalText(replay, request.params.surface_id, request.params.lines);
      if (!data.closed && generation === data.connectionGeneration && text !== null) return { text };
    } catch { /* Older or unavailable captures retain the plain-text path. */ }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  if (request.method === "system.tree") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const metadata = await Promise.race([
        (async () => {
          const dashboard = await data.metadata?.request("mobile.workspace.list", {});
          const notifications = await data.metadata?.request("notification.list", {}).catch(() => undefined);
          return { dashboard, notifications };
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("metadata_timeout")), 1000); }),
      ]);
      return sanitizeCmuxResult(request.method, result, metadata.dashboard, metadata.notifications);
    } catch { return sanitizeCmuxResult(request.method, result); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }

  if (request.method === "terminal.viewport") {
    if ("clear" in request.params) {
      if (data.viewport?.surfaceId === request.params.surface_id) {
        data.viewport = null;
      }
    } else {
      data.viewport = {
        surfaceId: request.params.surface_id,
        generation: request.params.viewport_generation,
      };
    }
  }
  const sanitized = sanitizeCmuxResult(request.method, result);
  if (request.method === "surface.create" || request.method === "surface.close") {
    const identity = sanitized as { workspace_id: string; pane_id?: string; surface_id: string };
    if (identity.workspace_id !== request.params.workspace_id || (request.method === "surface.create"
      ? identity.pane_id !== request.params.pane_id : identity.surface_id !== request.params.surface_id)) throw new RpcValidationError("invalid_cmux_response");
  }
  return sanitized;
}

export function createWebSocketHandler(dependencies: WebSocketDependencies) {
  return {
    open(ws: ServerWebSocket<WSData>) {
      const onStateChange = (connected: boolean) => {
        if (!connected) ws.data.connectionGeneration++;
        sendState(ws, connected ? "connected" : "disconnected");
      };
      const cmux = dependencies.createCmuxClient
        ? dependencies.createCmuxClient(onStateChange)
        : new CmuxClient({
            socketPath: dependencies.config.socketPath,
            socketPassword: dependencies.config.socketPassword,
            onStateChange,
          });
      ws.data.cmux = cmux;
      ws.data.metadata = new CmuxClient({ socketPath: dependencies.config.socketPath, socketPassword: dependencies.config.socketPassword, requestTimeoutMs: 1000, maxPending: 1 });
      ws.data.unsubscribeEvents = dependencies.eventStream.subscribe((change) =>
        sendJson(ws, {
          type: "event",
          event: "topology.changed",
          seq: change.seq,
          gap: change.gap,
        }),
      );
      void cmux.connect().then(
        () => sendState(ws, "connected"),
        () => sendState(ws, "disconnected"),
      );
    },

    async message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
      const size =
        typeof message === "string"
          ? Buffer.byteLength(message)
          : message.byteLength;
      if (size > 65_536) {
        ws.close(1009, "message_too_large");
        return;
      }

      const raw = typeof message === "string" ? message : message.toString("utf8");
      const id = requestId(raw);
      try {
        const request = parseAllowedRequest(raw);
        let result: unknown;
        if (
          request.method === "surface.send_text" ||
          request.method === "surface.send_key" || request.method === "surface.create" || request.method === "surface.close"
        ) {
          if (ws.data.inputQueued >= 64) {
            throw new RpcValidationError("busy");
          }
          ws.data.inputQueued += 1;
          const generation = ws.data.connectionGeneration;
          const operation = ws.data.inputTail.then(() => {
            if (ws.data.closed || generation !== ws.data.connectionGeneration) {
              throw new CmuxRequestError("bridge_disconnected");
            }
            return dispatch(ws.data, request);
          });
          ws.data.inputTail = operation.then(
            () => undefined,
            () => undefined,
          );
          try {
            result = await operation;
          } finally {
            ws.data.inputQueued -= 1;
          }
        } else {
          result = await dispatch(ws.data, request);
        }
        sendJson(ws, { id: request.id, ok: true, result });
      } catch (error) {
        if (id !== null) {
          sendJson(ws, { id, ok: false, error: publicError(error) });
        }
      }
    },

    async close(ws: ServerWebSocket<WSData>, _code: number, _reason: string) {
      if (ws.data.closed) return;
      ws.data.closed = true;
      ws.data.metadata?.disconnect();
      ws.data.metadata = null;
      ws.data.unsubscribeEvents?.();
      ws.data.unsubscribeEvents = null;
      await ws.data.inputTail;

      const cmux = ws.data.cmux;
      const viewport = ws.data.viewport;
      if (cmux && viewport) {
        try {
          await cmux.request("terminal.viewport", {
            surface_id: viewport.surfaceId,
            client_id: ws.data.clientId,
            clear: true,
            viewport_generation: viewport.generation + 1,
          });
        } catch {
          // Disconnect cleanup is best effort when cmux is already gone.
        }
      }
      ws.data.viewport = null;
      cmux?.disconnect();
      ws.data.cmux = null;
    },
  };
}
