import { enrichDashboard } from "./dashboard";

export type AllowedKey =
  | "escape"
  | "tab"
  | "shift+tab"
  | "left"
  | "right"
  | "shift+left"
  | "shift+right"
  | "shift+up"
  | "shift+down"
  | "ctrl+c"
  | "ctrl+d"
  | "up"
  | "down"
  | "enter";

export type AllowedRequest =
  | {
      id: string;
      method: "system.capabilities";
      params: Record<string, never>;
    }
  | { id: string; method: "system.tree"; params: Record<string, never> }
  | { id: string; method: "surface.create"; params: { workspace_id: string; pane_id: string } }
  | { id: string; method: "surface.close"; params: { workspace_id: string; surface_id: string; confirmed: true } }
  | {
      id: string;
      method: "surface.read_text";
      params: { surface_id: string; lines: number };
    }
  | {
      id: string;
      method: "surface.send_text";
      params: { surface_id: string; text: string };
    }
  | {
      id: string;
      method: "surface.send_key";
      params: { surface_id: string; key: AllowedKey };
    }
  | {
      id: string;
      method: "terminal.viewport";
      params:
        | {
            surface_id: string;
            viewport_columns: number;
            viewport_rows: number;
            viewport_generation: number;
          }
        | {
            surface_id: string;
            clear: true;
            viewport_generation: number;
          };
    };

export interface AgentActivity { source: string | null; state: "working" | "needs_attention" | "idle" | "unknown" }
export interface WorkspaceActivity { observedAt: number; lastActivityAt: number | null; unreadCount: number }
export interface TreeSnapshot {
  workspaces: Array<{
    id: string;
    title: string;
    index: number;
    selected: boolean;
    activity?: WorkspaceActivity;
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
        urlLabel: string | null;
        agent?: AgentActivity;
        hasUnread?: boolean;
      }>;
    }>;
  }>;
}

export class RpcValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RpcValidationError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_KEYS = new Set<AllowedKey>([
  "escape",
  "tab",
  "shift+tab",
  "left",
  "right",
  "shift+left",
  "shift+right",
  "shift+up",
  "shift+down",
  "ctrl+c",
  "ctrl+d",
  "up",
  "down",
  "enter",
]);
const encoder = new TextEncoder();

function fail(code: string): never {
  throw new RpcValidationError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function uuid(value: unknown, code = "invalid_params"): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) fail(code);
  return value.toLowerCase();
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  code = "invalid_params",
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(code);
  }
  return value;
}

function emptyParams(
  id: string,
  method: "system.capabilities" | "system.tree",
  params: Record<string, unknown>,
): AllowedRequest {
  if (!exactKeys(params, [])) fail("invalid_params");
  return { id, method, params: {} };
}

export function parseAllowedRequest(raw: string): AllowedRequest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("invalid_json");
  }

  if (!isRecord(value) || !exactKeys(value, ["id", "method", "params"])) {
    fail("invalid_request");
  }
  if (
    typeof value.id !== "string" ||
    encoder.encode(value.id).length < 1 ||
    encoder.encode(value.id).length > 128 ||
    typeof value.method !== "string" ||
    !isRecord(value.params)
  ) {
    fail("invalid_request");
  }

  const { id, method, params } = value;
  if (method === "system.capabilities" || method === "system.tree") {
    return emptyParams(id, method, params);
  }

  if (method === "surface.read_text") {
    if (!exactKeys(params, ["surface_id", "lines"])) fail("invalid_params");
    return {
      id,
      method,
      params: {
        surface_id: uuid(params.surface_id),
        lines: boundedInteger(params.lines, 1, 2_000),
      },
    };
  }

  if (method === "surface.create") {
    if (!exactKeys(params, ["workspace_id", "pane_id"])) fail("invalid_params");
    return { id, method, params: { workspace_id: uuid(params.workspace_id), pane_id: uuid(params.pane_id) } };
  }
  if (method === "surface.close") {
    if (!exactKeys(params, ["workspace_id", "surface_id", "confirmed"]) || params.confirmed !== true) fail("invalid_params");
    return { id, method, params: { workspace_id: uuid(params.workspace_id), surface_id: uuid(params.surface_id), confirmed: true } };
  }

  if (method === "surface.send_text") {
    if (!exactKeys(params, ["surface_id", "text"])) fail("invalid_params");
    if (
      typeof params.text !== "string" ||
      encoder.encode(params.text).length > 16_384
    ) {
      fail("invalid_params");
    }
    return {
      id,
      method,
      params: { surface_id: uuid(params.surface_id), text: params.text },
    };
  }

  if (method === "surface.send_key") {
    if (!exactKeys(params, ["surface_id", "key"])) fail("invalid_params");
    if (typeof params.key !== "string" || !ALLOWED_KEYS.has(params.key as AllowedKey)) {
      fail("invalid_params");
    }
    return {
      id,
      method,
      params: {
        surface_id: uuid(params.surface_id),
        key: params.key as AllowedKey,
      },
    };
  }

  if (method === "terminal.viewport") {
    const surface_id = uuid(params.surface_id);
    const viewport_generation = boundedInteger(
      params.viewport_generation,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    if ("clear" in params) {
      if (
        !exactKeys(params, ["surface_id", "clear", "viewport_generation"]) ||
        params.clear !== true
      ) {
        fail("invalid_params");
      }
      return {
        id,
        method,
        params: { surface_id, clear: true, viewport_generation },
      };
    }
    if (
      !exactKeys(params, [
        "surface_id",
        "viewport_columns",
        "viewport_rows",
        "viewport_generation",
      ])
    ) {
      fail("invalid_params");
    }
    return {
      id,
      method,
      params: {
        surface_id,
        viewport_columns: boundedInteger(params.viewport_columns, 20, 300),
        viewport_rows: boundedInteger(params.viewport_rows, 5, 120),
        viewport_generation,
      },
    };
  }

  return fail("unsupported_method");
}

export function toCmuxCall(
  request: AllowedRequest,
  clientId: string,
): {
  method: AllowedRequest["method"];
  params: Record<string, unknown>;
} {
  switch (request.method) {
    case "system.capabilities":
      return { method: request.method, params: {} };
    case "system.tree":
      return { method: request.method, params: { all: true } };
    case "surface.read_text":
      return {
        method: request.method,
        params: { ...request.params, scrollback: true },
      };
    case "surface.send_text":
    case "surface.send_key":
      return { method: request.method, params: { ...request.params } };
    case "surface.create":
      return { method: request.method, params: { ...request.params, type: "terminal", focus: false } };
    case "surface.close":
      return { method: request.method, params: { workspace_id: request.params.workspace_id, surface_id: request.params.surface_id, force: true } };
    case "terminal.viewport":
      return {
        method: request.method,
        params: { ...request.params, client_id: clientId },
      };
  }
}

function cmuxRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail("invalid_cmux_response");
  return value;
}

function cmuxString(value: unknown): string {
  if (typeof value !== "string") fail("invalid_cmux_response");
  return value;
}

function cmuxBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") fail("invalid_cmux_response");
  return value;
}

function cmuxInteger(value: unknown): number {
  return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, "invalid_cmux_response");
}

function cmuxArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail("invalid_cmux_response");
  return value;
}

function sanitizeCapabilities(value: unknown) {
  const result = cmuxRecord(value);
  return {
    protocol: cmuxString(result.protocol),
    version: cmuxInteger(result.version),
    access_mode: cmuxString(result.access_mode),
    capabilities: cmuxArray(result.capabilities).map(cmuxString),
  };
}

function sanitizeTree(value: unknown): TreeSnapshot {
  const result = cmuxRecord(value);
  const workspaces = cmuxArray(result.windows).flatMap((windowValue) => {
    const window = cmuxRecord(windowValue);
    return cmuxArray(window.workspaces).map((workspaceValue) => {
      const workspace = cmuxRecord(workspaceValue);
      return {
        id: uuid(workspace.id, "invalid_cmux_response"),
        title: cmuxString(workspace.title),
        index: cmuxInteger(workspace.index),
        selected: cmuxBoolean(workspace.selected),
        panes: cmuxArray(workspace.panes).map((paneValue) => {
          const pane = cmuxRecord(paneValue);
          return {
            id: uuid(pane.id, "invalid_cmux_response"),
            index: cmuxInteger(pane.index),
            focused: cmuxBoolean(pane.focused),
            surfaces: cmuxArray(pane.surfaces).map((surfaceValue) => {
              const surface = cmuxRecord(surfaceValue);
              const type = cmuxString(surface.type);
              const title = cmuxString(surface.title);
              const urlLabel = type === "browser" ? browserOrigin(surface.url) : null;
              return {
                id: uuid(surface.id, "invalid_cmux_response"),
                type,
                title: type === "browser" && /^(?:https?:|file:|javascript:|data:)/i.test(title) ? urlLabel ?? "Browser" : title,
                urlLabel,
                index: cmuxInteger(surface.index),
                selected: cmuxBoolean(surface.selected),
              };
            }),
          };
        }),
      };
    });
  });
  return { workspaces };
}

function browserOrigin(value: unknown): string | null {
  if (typeof value !== "string" || encoder.encode(value).length > 4096 || !/^https?:\/\//i.test(value)) return null;
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null; }
  catch { return null; }
}

function trailingUtf8Bytes(value: string, maximum: number): string {
  const bytes = encoder.encode(value);
  if (bytes.length <= maximum) return value;

  let start = bytes.length - maximum;
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) {
    start += 1;
  }
  return new TextDecoder().decode(bytes.subarray(start));
}

function sanitizeViewport(value: unknown) {
  const result = cmuxRecord(value);
  const surface_id = uuid(result.surface_id, "invalid_cmux_response");
  if (result.columns === undefined && result.rows === undefined) {
    return { surface_id };
  }
  return {
    surface_id,
    columns: cmuxInteger(result.columns),
    rows: cmuxInteger(result.rows),
  };
}

export function sanitizeCmuxResult(
  method: AllowedRequest["method"],
  result: unknown,
  metadata?: unknown,
  notifications?: unknown,
): unknown {
  switch (method) {
    case "system.capabilities":
      return sanitizeCapabilities(result);
    case "system.tree":
      return enrichDashboard(sanitizeTree(result), metadata, notifications);
    case "surface.create": {
      const value = cmuxRecord(result);
      if (value.type !== "terminal") fail("invalid_cmux_response");
      return { workspace_id: uuid(value.workspace_id, "invalid_cmux_response"), pane_id: uuid(value.pane_id, "invalid_cmux_response"), surface_id: uuid(value.surface_id, "invalid_cmux_response") };
    }
    case "surface.close": {
      const value = cmuxRecord(result);
      return { workspace_id: uuid(value.workspace_id, "invalid_cmux_response"), surface_id: uuid(value.surface_id, "invalid_cmux_response") };
    }
    case "surface.read_text":
      return {
        text: trailingUtf8Bytes(
          cmuxString(cmuxRecord(result).text),
          2 * 1024 * 1024,
        ),
      };
    case "surface.send_text":
    case "surface.send_key":
      return { accepted: true };
    case "terminal.viewport":
      return sanitizeViewport(result);
  }
}
