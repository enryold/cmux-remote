export type AllowedMethod =
  | "system.capabilities"
  | "system.tree"
  | "surface.read_text"
  | "surface.send_text"
  | "surface.send_key"
  | "terminal.viewport";

export type AllowedKey =
  | "escape"
  | "tab"
  | "ctrl+c"
  | "ctrl+d"
  | "up"
  | "down"
  | "enter";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface RpcRequest {
  id: string;
  method: AllowedMethod;
  params: Record<string, unknown>;
}

export interface Capabilities {
  protocol: string;
  version: number;
  access_mode: string;
  capabilities: string[];
}

export interface TreeSnapshot {
  workspaces: Array<{
    id: string;
    title: string;
    index: number;
    selected: boolean;
    panes: Array<{
      id: string;
      index: number;
      focused: boolean;
      surfaces: Array<{
        id: string;
        type: string;
        title: string;
        index: number;
        selected: boolean;
      }>;
    }>;
  }>;
}

export type ServerMessage =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: string; message: string } }
  | { type: "state"; cmux: "connected" | "disconnected" }
  | {
      type: "event";
      event: "topology.changed";
      seq: number | null;
      gap: boolean;
    };

let rpcId = 0;

export function createRpcRequest(
  method: AllowedMethod,
  params: Record<string, unknown> = {},
): RpcRequest {
  return { id: String(++rpcId), method, params };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length && expected.every((key) => key in value)
  );
}

function invalid(): never {
  throw new Error("invalid_server_message");
}

export function parseServerMessage(data: string): ServerMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return invalid();
  }

  const value = record(parsed);
  if (!value) return invalid();

  if ("id" in value) {
    if (typeof value.id !== "string" || typeof value.ok !== "boolean") {
      return invalid();
    }
    if (value.ok) {
      if (!exactKeys(value, ["id", "ok", "result"])) return invalid();
      return { id: value.id, ok: true, result: value.result };
    }

    if (!exactKeys(value, ["id", "ok", "error"])) return invalid();
    const error = record(value.error);
    if (
      !error ||
      !exactKeys(error, ["code", "message"]) ||
      typeof error.code !== "string" ||
      typeof error.message !== "string"
    ) {
      return invalid();
    }
    return {
      id: value.id,
      ok: false,
      error: { code: error.code, message: error.message },
    };
  }

  if (value.type === "state") {
    if (
      !exactKeys(value, ["type", "cmux"]) ||
      (value.cmux !== "connected" && value.cmux !== "disconnected")
    ) {
      return invalid();
    }
    return { type: "state", cmux: value.cmux };
  }

  if (value.type === "event") {
    if (
      !exactKeys(value, ["type", "event", "seq", "gap"]) ||
      value.event !== "topology.changed" ||
      (value.seq !== null &&
        (typeof value.seq !== "number" ||
          !Number.isSafeInteger(value.seq) ||
          value.seq < 0)) ||
      typeof value.gap !== "boolean"
    ) {
      return invalid();
    }
    return {
      type: "event",
      event: "topology.changed",
      seq: value.seq,
      gap: value.gap,
    };
  }

  return invalid();
}
