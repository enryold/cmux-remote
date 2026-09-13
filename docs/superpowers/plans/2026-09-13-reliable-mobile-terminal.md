# Reliable Mobile Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Milestone 1: an authenticated iPhone PWA that discovers every live cmux terminal, opens one safely, supports bidirectional input, and recovers after background or network changes.

**Architecture:** Keep the existing React/Bun split. The Bun bridge binds locally, authenticates the browser, validates a small RPC whitelist, and talks to cmux over one request socket plus one dedicated event-stream socket. The client uses `system.tree` for topology, adaptive `surface.read_text` polling only for the open terminal, and xterm.js for display and input.

**Tech Stack:** Bun 1.3+, Hono 4, React 19, TypeScript 5.7, Vite 6, xterm.js 5.5, Vitest 3, Bun test, Biome 2.5.13, Playwright 1.63.0, cmux socket protocol v2.

**Spec:** `docs/superpowers/specs/2026-09-13-cmux-remote-command-center-design.md`

## Global Constraints

- Preserve `LICENSE` and the original MIT copyright notice.
- Default server bind is `127.0.0.1:3456`; public ingress is never enabled implicitly.
- `CMUX_REMOTE_TOKEN` is mandatory and must contain at least 32 UTF-8 bytes.
- Optional external origin is an exact origin in `CMUX_REMOTE_ORIGIN`; no wildcard origins.
- Browser-to-server WebSocket messages are at most 65,536 UTF-8 bytes.
- Terminal text input is at most 16,384 UTF-8 bytes per request.
- Terminal reads accept `lines` from 1 through 2,000 and return at most 2 MiB of trailing text.
- Viewport reports accept 20–300 columns and 5–120 rows.
- A client may have at most 64 pending cmux RPC requests, 64 queued JSON frames, 64 queued input
  operations, and 8 MiB of aggregate buffered cmux frames.
- cmux connect timeout is 5 seconds; individual RPC timeout is 10 seconds.
- Client reconnect is unlimited, capped at 30 seconds, with ±20% jitter.
- Adaptive terminal delays are 250, 500, 1,000, 2,000, and 5,000 ms.
- The fallback topology refresh is every 15 seconds only while the document is visible.
- Session cookies expire after seven days and are invalidated by changing the configured token.
- Only canonical UUID `surface_id` targets reach cmux; refs, indexes, missing targets, camelCase keys, and unknown fields are rejected.
- Milestone 1 does not expose notifications, `cmux sessions`, browser URLs, browser controls, workspace mutation, shell creation, or arbitrary RPC.
- Every non-trivial behavior change follows red → green → refactor and ends with a focused commit.
- Run repository commands through `devenv shell -- ...`.

## File Map

### Server

- `server/src/config.ts`: parse and validate environment configuration and resolve the cmux socket path.
- `server/src/auth.ts`: token comparison, signed session cookies, same-origin checks, and Hono auth routes.
- `server/src/cmux-connection.ts`: bounded newline-delimited JSON transport over a Unix socket.
- `server/src/cmux-client.ts`: correlated v2 RPC requests and optional cmux socket authentication.
- `server/src/cmux-events.ts`: reconnectable `events.stream` subscription and topology-change signals.
- `server/src/rpc.ts`: exact browser RPC schemas, cmux parameter mapping, and response sanitization.
- `server/src/ws.ts`: authenticated WebSocket lifecycle, request dispatch, ordered input, and viewport cleanup.
- `server/src/index.ts`: Hono/static composition and `Bun.serve` startup.
- `server/src/health.ts`: minimal bridge/cmux availability without path disclosure.
- `server/src/__tests*.test.ts`: focused Bun tests for each server boundary.

### Client

- `client/src/lib/cmux-rpc.ts`: browser request/response/event types and strict server-message parsing.
- `client/src/lib/topology.ts`: pure helpers for terminal-only workspace grouping and selection recovery.
- `client/src/hooks/useWebSocket.ts`: unlimited reconnect and foreground/network wakeups.
- `client/src/hooks/useCmux.ts`: pending RPC lifecycle, topology snapshots, sanitized terminal operations, and cmux connection state.
- `client/src/hooks/useAuth.ts`: session status, login, and logout.
- `client/src/hooks/useTerminalPolling.ts`: one-in-flight adaptive read loop.
- `client/src/components/Login.tsx`: token login form.
- `client/src/components/Dashboard.tsx`: dense workspace/terminal list.
- `client/src/components/Terminal.tsx`: xterm lifecycle, snapshot replacement, input, resize, selection, and scroll preservation.
- `client/src/components/TerminalToolbar.tsx`: accessible mobile key toolbar.
- `client/src/components/Header.tsx`: dashboard title or terminal back action.
- `client/src/components/StatusBar.tsx`: bridge/cmux state.
- `client/src/App.tsx`: auth gate and dashboard/terminal navigation.
- `client/src/styles/global.css`: mobile layout, safe areas, visual viewport, and disconnected states.
- Delete `client/src/components/Drawer.tsx` and `client/src/hooks/useGesture.ts`; remove Hammer because it conflicts with terminal selection and is no longer needed.

### PWA, tooling, and E2E

- `client/index.html`, `client/public/manifest.json`, `client/src/service-worker.ts`: installable non-caching terminal shell.
- `client/public/icon-192.png`, `client/public/icon-512.png`, `client/public/apple-touch-icon.png`: committed app icons.
- `package.json`, `bun.lock`, `biome.json`: repository-wide lint and Playwright tooling.
- `playwright.config.ts`: Chromium and iPhone/WebKit projects.
- `e2e/fake-cmux.ts`: deterministic Unix-socket implementation of the whitelisted cmux contract.
- `e2e/start.ts`: start fake cmux and the production bridge for Playwright.
- `e2e/*.spec.ts`: authentication, discovery, terminal input, reconnect, and service-worker flows.
- `devenv.nix`: expose lint, browser installation, E2E, and the final `check` gate.
- `README.md`: secure Tailscale deployment and development instructions.

---

### Task 1: Fail-closed runtime configuration and authentication

**Files:**
- Create: `server/src/config.ts`
- Create: `server/src/auth.ts`
- Create: `server/src/__tests__/config.test.ts`
- Create: `server/src/__tests__/auth.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Produces: `RuntimeConfig`, `loadConfig(env)`, `createAuthRoutes(config)`, `isAuthenticated(request, config)`, and `isAllowedOrigin(request, config)`.
- Consumes: Hono and `hono/cookie`; no new runtime dependency.

- [ ] **Step 1: Write failing configuration tests**

```ts
import { describe, expect, it } from "bun:test";
import { loadConfig } from "../config";

const token = "a".repeat(32);

describe("loadConfig", () => {
  it("binds to localhost by default", () => {
    expect(loadConfig({ CMUX_REMOTE_TOKEN: token })).toMatchObject({
      hostname: "127.0.0.1",
      port: 3456,
      remoteToken: token,
    });
  });

  it("honors an explicit cmux socket path", () => {
    expect(loadConfig({ CMUX_REMOTE_TOKEN: token, CMUX_SOCKET_PATH: "/tmp/cmux-test.sock" }).socketPath)
      .toBe("/tmp/cmux-test.sock");
  });

  it("rejects a missing or short token", () => {
    expect(() => loadConfig({})).toThrow("CMUX_REMOTE_TOKEN");
    expect(() => loadConfig({ CMUX_REMOTE_TOKEN: "short" })).toThrow("32");
  });

  it("rejects invalid ports and non-origin public URLs", () => {
    expect(() => loadConfig({ CMUX_REMOTE_TOKEN: token, PORT: "0" })).toThrow("PORT");
    expect(() => loadConfig({
      CMUX_REMOTE_TOKEN: token,
      CMUX_REMOTE_ORIGIN: "https://mac.example/path",
    })).toThrow("CMUX_REMOTE_ORIGIN");
  });
});
```

- [ ] **Step 2: Run the configuration test and confirm red**

Run: `devenv shell -- bun test server/src/__tests__/config.test.ts`
Expected: FAIL because `server/src/config.ts` does not exist.

- [ ] **Step 3: Implement exact runtime configuration**

```ts
export interface RuntimeConfig {
  hostname: string;
  port: number;
  remoteToken: string;
  publicOrigin: string | null;
  socketPath: string;
  socketPassword: string | null;
}

export function loadConfig(env: Record<string, string | undefined>): RuntimeConfig {
  const remoteToken = env.CMUX_REMOTE_TOKEN ?? "";
  if (new TextEncoder().encode(remoteToken).length < 32) {
    throw new Error("CMUX_REMOTE_TOKEN must contain at least 32 UTF-8 bytes");
  }
  const port = Number(env.PORT ?? "3456");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  const publicOrigin = parseExactOrigin(env.CMUX_REMOTE_ORIGIN);
  return {
    hostname: env.HOST ?? "127.0.0.1",
    port,
    remoteToken,
    publicOrigin,
    socketPath: resolveSocketPath(env),
    socketPassword: env.CMUX_SOCKET_PASSWORD || null,
  };
}

function parseExactOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (url.origin !== value || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("CMUX_REMOTE_ORIGIN must be an exact HTTP(S) origin");
  }
  return value;
}

export function resolveSocketPath(env: Record<string, string | undefined>): string;
```

`resolveSocketPath` must use this order: `CMUX_SOCKET_PATH`, legacy `CMUX_SOCKET`, the trimmed existing
`~/.local/state/cmux/last-socket-path`, existing `~/.local/state/cmux/cmux.sock`, then existing legacy
`~/Library/Application Support/cmux/cmux.sock`. If none exist, return the current state-socket path so
health and reconnect report unavailable consistently.

- [ ] **Step 4: Write failing authentication tests**

```ts
import { describe, expect, it } from "bun:test";
import { createAuthRoutes, createSessionValue, verifySessionValue } from "../auth";

const config = {
  hostname: "127.0.0.1",
  port: 3456,
  remoteToken: "a".repeat(32),
  publicOrigin: "https://mac.tail.example",
  socketPath: "/tmp/cmux.sock",
  socketPassword: null,
};

describe("auth", () => {
  it("rejects cross-origin login and wrong tokens", async () => {
    const app = createAuthRoutes(config);
    const crossOrigin = await app.request("/auth/login", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ token: config.remoteToken }),
    });
    expect(crossOrigin.status).toBe(403);
    const wrongToken = await app.request("/auth/login", {
      method: "POST",
      headers: { origin: config.publicOrigin!, "content-type": "application/json" },
      body: JSON.stringify({ token: "wrong" }),
    });
    expect(wrongToken.status).toBe(401);
  });

  it("rejects oversized or non-exact login bodies", async () => {
    const app = createAuthRoutes(config);
    const oversized = await app.request("/auth/login", {
      method: "POST",
      headers: { origin: config.publicOrigin!, "content-type": "application/json" },
      body: JSON.stringify({ token: config.remoteToken, padding: "x".repeat(4096) }),
    });
    expect(oversized.status).toBe(413);
    const extraField = await app.request("/auth/login", {
      method: "POST",
      headers: { origin: config.publicOrigin!, "content-type": "application/json" },
      body: JSON.stringify({ token: config.remoteToken, remember: true }),
    });
    expect(extraField.status).toBe(400);
  });

  it("sets a secure HttpOnly strict cookie for a valid token", async () => {
    const app = createAuthRoutes(config);
    const response = await app.request("/auth/login", {
      method: "POST",
      headers: { origin: config.publicOrigin!, "content-type": "application/json" },
      body: JSON.stringify({ token: config.remoteToken }),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("rejects an expired or modified session", () => {
    const value = createSessionValue(config.remoteToken, 1_000);
    expect(verifySessionValue(value, config.remoteToken, 999)).toBe(true);
    expect(verifySessionValue(value, config.remoteToken, 1_001)).toBe(false);
    expect(verifySessionValue(`${value}x`, config.remoteToken, 999)).toBe(false);
    expect(value).not.toContain(config.remoteToken);
  });
});
```

- [ ] **Step 5: Run the authentication test and confirm red**

Run: `devenv shell -- bun test server/src/__tests__/auth.test.ts`
Expected: FAIL because `server/src/auth.ts` does not exist.

- [ ] **Step 6: Implement signed-cookie authentication and same-origin checks**

Use Node standard-library `createHash`, `createHmac`, and `timingSafeEqual`. The session value is
`v1.<expiresEpochSeconds>.<base64urlHmac>` where the HMAC input is `v1.<expiresEpochSeconds>` and the
configured token is the key.

```ts
export const SESSION_COOKIE = "cmux_remote_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function isAllowedOrigin(request: Request, config: RuntimeConfig): boolean {
  const origin = request.headers.get("origin");
  const expected = config.publicOrigin ?? new URL(request.url).origin;
  return origin === expected;
}

export function createSessionValue(token: string, expiresAt: number): string;
export function verifySessionValue(value: string, token: string, now: number): boolean;
export function isAuthenticated(request: Request, config: RuntimeConfig, now?: number): boolean;
export function createAuthRoutes(config: RuntimeConfig): Hono;
```

The routes are `GET /auth/status`, `POST /auth/login`, and `POST /auth/logout`. Login rejects a
declared or measured body over 4,096 UTF-8 bytes before parsing, accepts exactly JSON
`{ token: string }`, and returns generic 401/403 responses without logging the token. Set the cookie's
`Secure` attribute whenever the configured/request origin uses HTTPS; keep `HttpOnly`,
`SameSite=Strict`, and `Path=/` in both HTTP and HTTPS modes.

- [ ] **Step 7: Protect WebSocket upgrade and bind explicitly**

Refactor `server/src/index.ts` to export `startServer(config: RuntimeConfig)` and start only under
`import.meta.main`. Before `server.upgrade`, require both `isAllowedOrigin` and `isAuthenticated`.

```ts
if (url.pathname === "/ws") {
  if (!isAllowedOrigin(req, config) || !isAuthenticated(req, config)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return server.upgrade(req, { data: createWebSocketData() })
    ? undefined
    : new Response("WebSocket upgrade failed", { status: 400 });
}
```

Pass both `hostname: config.hostname` and `port: config.port` to `Bun.serve`.

- [ ] **Step 8: Run focused and baseline verification**

Run: `devenv shell -- bun test server/src/__tests__/config.test.ts server/src/__tests__/auth.test.ts`
Expected: PASS.
Run: `devenv shell -- check`
Expected: existing 12 tests, both typechecks, and client build PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/config.ts server/src/auth.ts server/src/index.ts server/src/__tests__/config.test.ts server/src/__tests__/auth.test.ts
git commit -m "feat(server): require authenticated local access"
```

---

### Task 2: Exact RPC whitelist and sanitized response contract

**Files:**
- Create: `server/src/rpc.ts`
- Create: `server/src/__tests__/rpc.test.ts`

**Interfaces:**
- Consumes: raw browser WebSocket text.
- Produces: `AllowedRequest`, `parseAllowedRequest(raw)`, `toCmuxCall(request, clientId)`, and `sanitizeCmuxResult(method, result)`.

- [ ] **Step 1: Write failing trust-boundary tests**

```ts
import { describe, expect, it } from "bun:test";
import { parseAllowedRequest, sanitizeCmuxResult, toCmuxCall } from "../rpc";

const surfaceId = "11111111-1111-4111-8111-111111111111";

describe("parseAllowedRequest", () => {
  it("accepts a bounded exact terminal read", () => {
    expect(parseAllowedRequest(JSON.stringify({
      id: "7",
      method: "surface.read_text",
      params: { surface_id: surfaceId, lines: 2000 },
    }))).toEqual({
      id: "7",
      method: "surface.read_text",
      params: { surface_id: surfaceId, lines: 2000 },
    });
  });

  it("rejects arbitrary methods, implicit targets, aliases, and extra fields", () => {
    expect(() => parseAllowedRequest('{"id":"1","method":"workspace.create","params":{}}')).toThrow("unsupported_method");
    expect(() => parseAllowedRequest('{"id":"1","method":"surface.send_text","params":{"text":"pwd"}}')).toThrow("invalid_params");
    expect(() => parseAllowedRequest(JSON.stringify({ id: "1", method: "surface.send_text", params: { surfaceId, text: "pwd" } }))).toThrow("invalid_params");
    expect(() => parseAllowedRequest(JSON.stringify({ id: "1", method: "surface.send_key", params: { surface_id: surfaceId, key: "cmd+q" } }))).toThrow("invalid_params");
  });
});

describe("sanitization", () => {
  it("forces full tree reads and strips tty, URL, refs, and unknown fields", () => {
    expect(toCmuxCall({ id: "1", method: "system.tree", params: {} }, "client-1")).toEqual({
      method: "system.tree",
      params: { all: true },
    });
    const result = sanitizeCmuxResult("system.tree", {
      windows: [{ workspaces: [{ id: surfaceId, title: "CODEX", index: 0, selected: true, panes: [{
        id: "22222222-2222-4222-8222-222222222222",
        index: 0,
        focused: true,
        surfaces: [{ id: surfaceId, type: "terminal", title: "API", index: 0, selected: true, tty: "/dev/ttys001", url: "https://secret.invalid" }],
      }] }] }],
    });
    expect(JSON.stringify(result)).not.toContain("ttys001");
    expect(JSON.stringify(result)).not.toContain("secret.invalid");
  });
});
```

- [ ] **Step 2: Run the test and confirm red**

Run: `devenv shell -- bun test server/src/__tests__/rpc.test.ts`
Expected: FAIL because `server/src/rpc.ts` does not exist.

- [ ] **Step 3: Define the closed request union**

```ts
export type AllowedKey = "escape" | "tab" | "ctrl+c" | "ctrl+d" | "up" | "down" | "enter";

export type AllowedRequest =
  | { id: string; method: "system.capabilities"; params: Record<string, never> }
  | { id: string; method: "system.tree"; params: Record<string, never> }
  | { id: string; method: "surface.read_text"; params: { surface_id: string; lines: number } }
  | { id: string; method: "surface.send_text"; params: { surface_id: string; text: string } }
  | { id: string; method: "surface.send_key"; params: { surface_id: string; key: AllowedKey } }
  | { id: string; method: "terminal.viewport"; params:
      | { surface_id: string; viewport_columns: number; viewport_rows: number; viewport_generation: number }
      | { surface_id: string; clear: true; viewport_generation: number } };

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
```

Implement per-method exact-key sets. Count byte limits with `TextEncoder`, not JavaScript string
length. Validate UUIDs with a case-insensitive canonical UUID expression and normalize them to
lowercase.

- [ ] **Step 4: Map requests without forwarding browser-owned routing data**

`system.tree` always becomes `{ all: true }`; reads always add `{ scrollback: true }`; viewport calls
add the server-owned `client_id`.

```ts
export function toCmuxCall(request: AllowedRequest, clientId: string): {
  method: AllowedRequest["method"];
  params: Record<string, unknown>;
};
```

Never forward the browser's request ID to cmux. `CmuxClient` creates its own correlation ID and the
WebSocket handler restores only the original browser ID in the response.

- [ ] **Step 5: Sanitize every result**

```ts
export function sanitizeCmuxResult(method: AllowedRequest["method"], result: unknown): unknown {
  switch (method) {
    case "system.capabilities":
      return sanitizeCapabilities(result);
    case "system.tree":
      return sanitizeTree(result);
    case "surface.read_text":
      return { text: trailingUtf8Bytes(readText(result), 2 * 1024 * 1024) };
    case "surface.send_text":
    case "surface.send_key":
      return { accepted: true };
    case "terminal.viewport":
      return sanitizeViewport(result);
  }
}
```

Define `sanitizeCapabilities`, `sanitizeTree`, `readText`, and `sanitizeViewport` in the same module.
Each accepts `unknown`, checks every required object/array/scalar, and builds a new object containing
only the public fields declared in this task. `sanitizeTree` flattens the v2 `windows[].workspaces[]`
result into `TreeSnapshot.workspaces`; `readText` accepts only `{ text: string }`;
`sanitizeViewport` returns only `{ surface_id, columns, rows }`. `trailingUtf8Bytes` encodes once,
starts at `bytes.length - maxBytes`, skips UTF-8 continuation bytes, and decodes the remaining suffix,
so it is linear and never splits a code point.
Malformed cmux shapes return a stable `invalid_cmux_response` error; they are not passed through.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `devenv shell -- bun test server/src/__tests__/rpc.test.ts`
Expected: PASS.
Run: `devenv shell -- typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/rpc.ts server/src/__tests__/rpc.test.ts
git commit -m "feat(server): define the cmux RPC allowlist"
```

---

### Task 3: Persistent bounded cmux socket client

**Files:**
- Create: `server/src/cmux-connection.ts`
- Rewrite: `server/src/cmux-client.ts`
- Rewrite: `server/src/__tests__/cmux-client.test.ts`
- Create: `server/src/__tests__/cmux-connection.test.ts`
- Create: `server/src/__tests__/fake-cmux.ts`

**Interfaces:**
- Consumes: `RuntimeConfig.socketPath` and optional `socketPassword`.
- Produces: `JsonLineConnection.connect(options)`, `authenticateCmux(connection, password)`, and `CmuxClient.request(method, params)`.

Create this shared test helper in `server/src/__tests__/fake-cmux.ts`:

```ts
import type { Socket } from "node:net";

export interface FakeCmuxRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface FakeCmuxServer {
  path: string;
  requests: FakeCmuxRequest[];
  connections: Set<Socket>;
  reply(socket: Socket, id: string, result: unknown): void;
  send(socket: Socket, frame: unknown): void;
  disconnectAll(): void;
  close(): Promise<void>;
}

export function startFakeCmuxServer(options?: {
  onConnect?: (socket: Socket, server: FakeCmuxServer) => void;
  onRequest?: (request: FakeCmuxRequest, socket: Socket, server: FakeCmuxServer) => void;
}): Promise<FakeCmuxServer>;

export async function eventually(assertion: () => void, timeoutMs = 1_000): Promise<void>;
```

`eventually` retries the assertion every 10 ms, rethrowing its last error when the deadline expires.

- [ ] **Step 1: Write failing JSON-line transport tests with a temporary Unix socket**

```ts
import { describe, expect, it } from "bun:test";
import { JsonLineConnection } from "../cmux-connection";
import { eventually, startFakeCmuxServer } from "./fake-cmux";

describe("JsonLineConnection", () => {
  it("reassembles split frames and preserves frame order", async () => {
    const fake = await startFakeCmuxServer({ onConnect(socket) {
      socket.write('{"id":"1","ok":');
      socket.write('true}\n{"id":"2","ok":true}\n');
    } });
    const connection = await JsonLineConnection.connect({ socketPath: fake.path });
    expect(await connection.read()).toEqual({ id: "1", ok: true });
    expect(await connection.read()).toEqual({ id: "2", ok: true });
    await fake.close();
  });

  it("closes on an oversized line", async () => {
    const fake = await startFakeCmuxServer({
      onConnect(socket) { socket.write(`{"x":"${"a".repeat(4_200_000)}"}\n`); },
    });
    const connection = await JsonLineConnection.connect({ socketPath: fake.path });
    await expect(connection.read()).rejects.toThrow("frame_limit");
    await fake.close();
  });

  it("closes when more than 64 complete frames are queued", async () => {
    const fake = await startFakeCmuxServer({
      onConnect(socket) {
        for (let index = 0; index < 65; index += 1) socket.write(`{"index":${index}}\n`);
      },
    });
    const connection = await JsonLineConnection.connect({ socketPath: fake.path });
    await eventually(() => expect(connection.isOpen).toBe(false));
    await expect(connection.read()).rejects.toThrow("frame_queue_limit");
    await fake.close();
  });
});
```

The test helper creates its directory with `mkdtemp(join(tmpdir(), "cmux-remote-"))`, listens on a
socket inside it, closes the server, and removes only that exact temporary directory.

- [ ] **Step 2: Run transport tests and confirm red**

Run: `devenv shell -- bun test server/src/__tests__/cmux-connection.test.ts`
Expected: FAIL because `JsonLineConnection` does not exist.

- [ ] **Step 3: Implement the bounded transport**

```ts
export interface JsonLineOptions {
  socketPath: string;
  connectTimeoutMs?: number;
  maxLineBytes?: number;
  maxQueuedFrames?: number;
  maxBufferedBytes?: number;
}

export class JsonLineConnection {
  static connect(options: JsonLineOptions): Promise<JsonLineConnection>;
  write(frame: unknown): void;
  read(): Promise<unknown>;
  close(reason?: Error): void;
  get isOpen(): boolean;
}
```

Defaults are 5,000 ms, 4 MiB per line, 64 frames, and 8 MiB buffered in aggregate. Parse only complete
newline-delimited JSON objects. Invalid JSON, either overflow, socket error, and close reject the
current and future `read()` calls. Do not log frame contents.

- [ ] **Step 4: Write failing correlated RPC and socket-password tests**

```ts
describe("CmuxClient", () => {
  it("authenticates before the first RPC and correlates out-of-order replies", async () => {
    const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
      if (request.method === "auth.login") return server.reply(socket, request.id, { authenticated: true });
      if (request.method === "first") return setTimeout(() => server.reply(socket, request.id, { value: 1 }), 10);
      return server.reply(socket, request.id, { value: 2 });
    } });
    const client = new CmuxClient({ socketPath: fake.path, socketPassword: "socket-secret" });
    const [first, second] = await Promise.all([
      client.request("first", {}),
      client.request("second", {}),
    ]);
    expect([first, second]).toEqual([{ value: 1 }, { value: 2 }]);
    expect(fake.requests[0]?.method).toBe("auth.login");
  });

  it("rejects pending work when cmux disconnects", async () => {
    const fake = await startFakeCmuxServer({ onRequest(_request, socket) { socket.destroy(); } });
    const client = new CmuxClient({ socketPath: fake.path });
    await expect(client.request("system.ping", {})).rejects.toThrow("cmux_disconnected");
  });
});
```

- [ ] **Step 5: Run RPC tests and confirm red**

Run: `devenv shell -- bun test server/src/__tests__/cmux-client.test.ts`
Expected: FAIL because the old client has no correlated `request` API.

- [ ] **Step 6: Implement `CmuxClient`**

```ts
export interface CmuxClientOptions {
  socketPath: string;
  socketPassword?: string | null;
  requestTimeoutMs?: number;
  maxPending?: number;
  onStateChange?: (connected: boolean) => void;
}

export class CmuxClient {
  constructor(options: CmuxClientOptions);
  connect(): Promise<void>;
  request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
  disconnect(): void;
  get isConnected(): boolean;
}
```

Deduplicate concurrent connects. After transport connect, send `auth.login` and require an `ok`
response before marking the client connected. Use bridge-generated IDs, a 64-entry pending map, and a
10-second timeout. Reject all pending requests on disconnect. Redact cmux error details to code plus a
bounded message.

- [ ] **Step 7: Run server tests and typecheck**

Run: `devenv shell -- bun test server/src/__tests__/cmux-connection.test.ts server/src/__tests__/cmux-client.test.ts`
Expected: PASS.
Run: `devenv shell -- typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/cmux-connection.ts server/src/cmux-client.ts server/src/__tests__/fake-cmux.ts server/src/__tests__/cmux-connection.test.ts server/src/__tests__/cmux-client.test.ts
git commit -m "feat(server): add persistent cmux RPC transport"
```

---

### Task 4: Event-driven topology and secure WebSocket bridge

**Files:**
- Create: `server/src/cmux-events.ts`
- Create: `server/src/__tests__/cmux-events.test.ts`
- Rewrite: `server/src/ws.ts`
- Create: `server/src/__tests__/ws.test.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/health.ts`
- Modify: `server/src/__tests__/health.test.ts`

**Interfaces:**
- Consumes: `AllowedRequest`, `CmuxClient`, `JsonLineConnection`, and `RuntimeConfig`.
- Produces: `CmuxEventStream.subscribe(listener)`, `createWebSocketData()`, and `createWebSocketHandler(dependencies)`.

In `cmux-events.test.ts`, build the event fixture from Task 3's shared fake:

```ts
async function startEventServer(options: { gap?: boolean } = {}) {
  const fake = await startFakeCmuxServer({
    onRequest(request, socket, server) {
      if (request.method === "auth.login") {
        server.reply(socket, request.id, { authenticated: true });
      } else if (request.method === "events.stream") {
        server.send(socket, {
          type: "ack",
          protocol: "cmux-events",
          version: 1,
          boot_id: "33333333-3333-4333-8333-333333333333",
          resume: { gap: options.gap ?? false },
        });
      }
    },
  });
  return Object.assign(fake, {
    sendEvent(frame: unknown) {
      for (const socket of fake.connections) fake.send(socket, frame);
    },
    lastSubscription() {
      return [...fake.requests].reverse().find((request) => request.method === "events.stream");
    },
    disconnect() { fake.disconnectAll(); },
  });
}
```

- [ ] **Step 1: Write failing event-stream tests**

```ts
describe("CmuxEventStream", () => {
  it("authenticates, subscribes to topology categories, and resumes after the last sequence", async () => {
    const fake = await startEventServer();
    const changes: Array<{ seq: number | null; gap: boolean }> = [];
    const stream = new CmuxEventStream({ socketPath: fake.path });
    const unsubscribe = stream.subscribe((change) => changes.push(change));
    await stream.start();
    fake.sendEvent({ type: "event", category: "surface", seq: 42, name: "surface.created" });
    await eventually(() => expect(changes).toContainEqual({ seq: 42, gap: false }));
    fake.disconnect();
    await eventually(() => expect(fake.lastSubscription()?.params.after_seq).toBe(42));
    unsubscribe();
    stream.stop();
  });

  it("requests a fresh snapshot when the ack reports a gap", async () => {
    const fake = await startEventServer({ gap: true });
    const changes: Array<{ seq: number | null; gap: boolean }> = [];
    const stream = new CmuxEventStream({ socketPath: fake.path });
    const unsubscribe = stream.subscribe((change) => changes.push(change));
    await stream.start();
    await eventually(() => expect(changes).toContainEqual({ seq: null, gap: true }));
    unsubscribe();
    stream.stop();
  });
});
```

- [ ] **Step 2: Run the event test and confirm red**

Run: `devenv shell -- bun test server/src/__tests__/cmux-events.test.ts`
Expected: FAIL because `CmuxEventStream` does not exist.

- [ ] **Step 3: Implement the dedicated event connection**

```ts
export interface TopologyChange {
  seq: number | null;
  gap: boolean;
}

export class CmuxEventStream {
  constructor(options: CmuxClientOptions);
  start(): Promise<void>;
  subscribe(listener: (change: TopologyChange) => void): () => void;
  stop(): void;
}
```

After optional `auth.login`, send exactly:

```json
{
  "id": "cmux-remote-events",
  "method": "events.stream",
  "params": {
    "categories": ["window", "workspace", "pane", "surface"],
    "include_heartbeats": true
  }
}
```

Add `after_seq` only after processing an event. Ignore heartbeats. On `ack.resume.gap`, emit one gap
signal. Reconnect forever at 1, 2, 4, 8, 16, then 30 seconds, resetting after a valid ack.

- [ ] **Step 4: Write failing WebSocket dispatch tests**

```ts
const surfaceId = "11111111-1111-4111-8111-111111111111";

class FakeCmuxClient {
  requests: Array<{ method: string; params: Record<string, unknown> }> = [];

  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.requests.push({ method, params });
    if (method === "terminal.viewport") {
      return { surface_id: surfaceId, columns: 80, rows: 24 } as T;
    }
    return {} as T;
  }

  async connect(): Promise<void> {}
  disconnect(): void {}
  get isConnected(): boolean { return true; }
}

class FakeEventStream {
  async start(): Promise<void> {}
  subscribe(_listener: (change: TopologyChange) => void): () => void { return () => {}; }
  stop(): void {}
}

const config: RuntimeConfig = {
  hostname: "127.0.0.1",
  port: 3456,
  remoteToken: "a".repeat(32),
  publicOrigin: null,
  socketPath: "/tmp/cmux-test.sock",
  socketPassword: null,
};

function sendText(text: string): string {
  return JSON.stringify({ id: crypto.randomUUID(), method: "surface.send_text", params: { surface_id: surfaceId, text } });
}

const validViewportMessage = JSON.stringify({
  id: "viewport-1",
  method: "terminal.viewport",
  params: { surface_id: surfaceId, viewport_columns: 80, viewport_rows: 24, viewport_generation: 1 },
});

function createWebSocketHarness({ cmux }: { cmux: FakeCmuxClient }) {
  const sent: string[] = [];
  const ws = {
    data: createWebSocketData(),
    send(value: string) { sent.push(value); },
  } as unknown as ServerWebSocket<WSData>;
  const handler = createWebSocketHandler({
    config,
    eventStream: new FakeEventStream() as unknown as CmuxEventStream,
    createCmuxClient: () => cmux as unknown as CmuxClient,
  });
  handler.open(ws);
  return {
    message: (value: string) => handler.message(ws, value),
    close: () => handler.close(ws, 1000, "test"),
    lastJson: () => JSON.parse(sent.at(-1) ?? "null"),
  };
}

describe("WebSocket bridge", () => {
  it("never forwards unsupported methods and preserves the browser response id", async () => {
    const cmux = new FakeCmuxClient();
    const bridge = createWebSocketHarness({ cmux });
    await bridge.message('{"id":"browser-7","method":"workspace.create","params":{}}');
    expect(cmux.requests).toHaveLength(0);
    expect(bridge.lastJson()).toMatchObject({ id: "browser-7", ok: false, error: { code: "unsupported_method" } });
  });

  it("serializes input and clears a sticky viewport when the WebSocket closes", async () => {
    const cmux = new FakeCmuxClient();
    const bridge = createWebSocketHarness({ cmux });
    await bridge.message(validViewportMessage);
    await Promise.all([bridge.message(sendText("a")), bridge.message(sendText("b"))]);
    await bridge.close();
    expect(cmux.requests.filter((request) => request.method === "surface.send_text").map((request) => request.params.text)).toEqual(["a", "b"]);
    expect(cmux.requests.at(-1)).toMatchObject({ method: "terminal.viewport", params: { clear: true } });
  });
});
```

- [ ] **Step 5: Run the WebSocket test and confirm red**

Run: `devenv shell -- bun test server/src/__tests__/ws.test.ts`
Expected: FAIL because the existing handler still has a transparent proxy and CLI fallback.

- [ ] **Step 6: Replace the relay with validated dispatch**

```ts
export interface WSData {
  clientId: string;
  cmux: CmuxClient | null;
  inputTail: Promise<void>;
  inputQueued: number;
  viewport: { surfaceId: string; generation: number } | null;
  unsubscribeEvents: (() => void) | null;
}

export function createWebSocketData(): WSData;

export function createWebSocketHandler(dependencies: {
  config: RuntimeConfig;
  eventStream: CmuxEventStream;
  createCmuxClient?: () => CmuxClient;
}): WebSocketHandler<WSData>;
```

The handler must:

- reject a message larger than 65,536 bytes before JSON parsing;
- call `parseAllowedRequest`, `toCmuxCall`, and `sanitizeCmuxResult`;
- send stable `{ id, ok, result|error }` envelopes;
- serialize `surface.send_text` and `surface.send_key` through `inputTail`, rejecting above 64 queued
  operations with `busy`;
- permit reads concurrently without exceeding the client's pending limit;
- emit `{ "type":"state", "cmux":"connected|disconnected" }` without paths;
- translate any topology event to `{ "type":"event", "event":"topology.changed", "seq", "gap" }`;
- track the server-owned viewport client ID;
- clear the previous viewport on surface switch and clear the final viewport on WebSocket close;
- remove all CLI fallback and transparent forwarding code.

- [ ] **Step 7: Wire one shared event stream and minimal health**

Create one `CmuxEventStream` in `startServer`, start it without blocking HTTP startup, and inject it
into the WebSocket handler. Health uses a short-lived `CmuxClient.request("system.ping", {})`, always
disconnects that client in `finally`, and returns only:

```json
{ "status": "ok", "cmux": "connected", "uptime": 12.3 }
```

The disconnected form changes only `cmux` to `disconnected`.

- [ ] **Step 8: Run all server verification**

Run: `devenv shell -- bun --cwd server test`
Expected: PASS with no terminal content, socket path, or secret in captured logs.
Run: `devenv shell -- typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/cmux-events.ts server/src/ws.ts server/src/index.ts server/src/health.ts server/src/__tests__
git commit -m "feat(server): expose an event-driven secure terminal bridge"
```

---

### Task 5: Strict client protocol and unlimited reconnect

**Files:**
- Rewrite: `client/src/lib/cmux-rpc.ts`
- Rewrite: `client/src/lib/__tests__/cmux-rpc.test.ts`
- Rewrite: `client/src/hooks/useWebSocket.ts`
- Create: `client/src/hooks/__tests__/useWebSocket.test.tsx`
- Rewrite: `client/src/hooks/useCmux.ts`
- Create: `client/src/hooks/__tests__/useCmux.test.tsx`

**Interfaces:**
- Consumes: authenticated `/ws` server envelopes from Task 4.
- Produces: `ServerMessage`, `TreeSnapshot`, `useWebSocket`, and typed `useCmux` operations.

Use this browser WebSocket double in `useWebSocket.test.tsx`:

```ts
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  send(_data: string): void {}
  close(): void { this.closeFromServer(1000); }
  closeFromServer(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }
}

vi.stubGlobal("WebSocket", FakeWebSocket);
```

- [ ] **Step 1: Write failing protocol parser tests**

```ts
it("parses only known response, state, and topology envelopes", () => {
  expect(parseServerMessage('{"id":"1","ok":true,"result":{}}')).toMatchObject({ id: "1", ok: true });
  expect(parseServerMessage('{"type":"state","cmux":"connected"}')).toEqual({ type: "state", cmux: "connected" });
  expect(parseServerMessage('{"type":"event","event":"topology.changed","seq":4,"gap":false}')).toMatchObject({ event: "topology.changed" });
  expect(() => parseServerMessage('{"type":"event","event":"browser.input"}')).toThrow("invalid_server_message");
});
```

- [ ] **Step 2: Run the protocol test and confirm red**

Run: `devenv shell -- bun run --cwd client test -- src/lib/__tests__/cmux-rpc.test.ts`
Expected: FAIL because the existing parser casts arbitrary JSON.

- [ ] **Step 3: Implement the strict client contract**

Define the same `TreeSnapshot` shape returned by Task 2 and these messages:

```ts
export type ServerMessage =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: string; message: string } }
  | { type: "state"; cmux: "connected" | "disconnected" }
  | { type: "event"; event: "topology.changed"; seq: number | null; gap: boolean };

export type AllowedMethod =
  | "system.capabilities"
  | "system.tree"
  | "surface.read_text"
  | "surface.send_text"
  | "surface.send_key"
  | "terminal.viewport";

export type AllowedKey = "escape" | "tab" | "ctrl+c" | "ctrl+d" | "up" | "down" | "enter";
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

export function createRpcRequest(method: AllowedMethod, params: Record<string, unknown>): RpcRequest;
export function parseServerMessage(data: string): ServerMessage;
```

Use explicit object/field checks rather than assertions from `unknown`.

- [ ] **Step 4: Write failing reconnect tests with a fake browser WebSocket**

```ts
it("keeps retrying and reconnects immediately on foreground", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useWebSocket({ url: "ws://test/ws", enabled: true, onMessage: vi.fn() }));
  FakeWebSocket.instances[0]?.closeFromServer();
  act(() => vi.advanceTimersByTime(30_000));
  expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(result.current.status).toBe("connecting");
});

it("does not queue sends while disconnected", () => {
  const { result } = renderHook(() => useWebSocket({ url: "ws://test/ws", enabled: false, onMessage: vi.fn() }));
  expect(result.current.send("secret")).toBe(false);
});
```

- [ ] **Step 5: Run reconnect tests and confirm red**

Run: `devenv shell -- bun run --cwd client test -- src/hooks/__tests__/useWebSocket.test.tsx`
Expected: FAIL because the old hook stops after ten retries and has no lifecycle listeners.

- [ ] **Step 6: Implement reconnect and wakeup behavior**

```ts
export interface UseWebSocketOptions {
  url: string;
  enabled: boolean;
  onMessage: (data: string) => void;
  onUnauthorized?: () => void;
}

export function reconnectDelay(attempt: number, random: number): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  return Math.round(base * (0.8 + random * 0.4));
}

export function useWebSocket(options: UseWebSocketOptions): {
  status: "connecting" | "connected" | "disconnected";
  send: (data: string) => boolean;
  reconnectNow: () => void;
};
```

Treat close code 4401 as an expired session. Add `visibilitychange`, `online`, and `pageshow`
listeners; each clears a pending retry and attempts immediately. Never retain unsent terminal input.

- [ ] **Step 7: Refactor `useCmux` around typed RPC and disconnect cleanup**

```ts
export interface CmuxApi {
  bridgeStatus: ConnectionStatus;
  cmuxStatus: "connected" | "disconnected";
  tree: TreeSnapshot;
  getCapabilities(): Promise<Capabilities>;
  refreshTree(): Promise<TreeSnapshot>;
  readText(surfaceId: string, lines?: number): Promise<string>;
  sendText(surfaceId: string, text: string): Promise<void>;
  sendKey(surfaceId: string, key: AllowedKey): Promise<void>;
  reportViewport(surfaceId: string, columns: number, rows: number, generation: number): Promise<void>;
  clearViewport(surfaceId: string, generation: number): Promise<void>;
}
```

Reject immediately if `send` returns false. On WebSocket close, clear every timer and reject every
pending request with `bridge_disconnected`. On connect, fetch capabilities then tree. Coalesce
`topology.changed` bursts into one refresh within 100 ms. Independently refresh the tree every 15
seconds while visible, stop that timer while hidden, and refresh immediately on foreground; this is
the bounded fallback when the installed cmux does not provide a stable event stream.

- [ ] **Step 8: Run client tests, typecheck, and build**

Run: `devenv shell -- bun run --cwd client test`
Expected: PASS.
Run: `devenv shell -- typecheck`
Expected: PASS.
Run: `devenv shell -- build-all`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/lib client/src/hooks/useWebSocket.ts client/src/hooks/useCmux.ts client/src/hooks/__tests__
git commit -m "feat(client): reconnect indefinitely with a typed bridge protocol"
```

---

### Task 6: Authentication gate and dynamic terminal dashboard

**Files:**
- Create: `client/src/hooks/useAuth.ts`
- Create: `client/src/hooks/__tests__/useAuth.test.tsx`
- Create: `client/src/components/Login.tsx`
- Create: `client/src/components/Dashboard.tsx`
- Create: `client/src/components/__tests__/Dashboard.test.tsx`
- Create: `client/src/lib/topology.ts`
- Create: `client/src/lib/__tests__/topology.test.ts`
- Rewrite: `client/src/App.tsx`
- Modify: `client/src/components/Header.tsx`
- Modify: `client/src/components/StatusBar.tsx`
- Delete: `client/src/components/Drawer.tsx`
- Delete: `client/src/hooks/useGesture.ts`
- Modify: `client/package.json`

**Interfaces:**
- Consumes: `TreeSnapshot` and typed `CmuxApi` from Task 5.
- Produces: authenticated dashboard navigation and `terminalWorkspaces(tree)`.

Use these local test helpers in `useAuth.test.tsx`:

```ts
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 1: Write failing auth-hook tests**

```ts
it("does not connect the terminal bridge until login succeeds", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ authenticated: false }));
  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.status).toBe("anonymous"));
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await act(() => result.current.login("a".repeat(32)));
  expect(result.current.status).toBe("authenticated");
});
```

- [ ] **Step 2: Run the auth-hook test and confirm red**

Run: `devenv shell -- bun run --cwd client test -- src/hooks/__tests__/useAuth.test.tsx`
Expected: FAIL because `useAuth` does not exist.

- [ ] **Step 3: Implement auth state and login form**

```ts
export type AuthStatus = "checking" | "anonymous" | "authenticated";

export function useAuth(): {
  status: AuthStatus;
  error: string | null;
  login(token: string): Promise<void>;
  logout(): Promise<void>;
  expire(): void;
};
```

All fetches use `credentials: "same-origin"`. `Login` renders the `cmux Remote` heading and the
login form uses `<input type="password" autocomplete="current-password">`, does not retain the token
after submit, and labels failures as authentication failures without echoing server details.

- [ ] **Step 4: Write failing topology and dashboard tests**

```ts
const workspaceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workspaceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const terminalA = "11111111-1111-4111-8111-111111111111";
const terminalB = "22222222-2222-4222-8222-222222222222";
const snapshotWithTwoWorkspaces: TreeSnapshot = {
  workspaces: [
    {
      id: workspaceA, title: "CODEX", index: 0, selected: true,
      panes: [{
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", index: 0, focused: true,
        surfaces: [
          { id: terminalA, type: "terminal", title: "API Agent", index: 0, selected: true },
          { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", type: "browser", title: "localhost", index: 1, selected: false },
        ],
      }],
    },
    {
      id: workspaceB, title: "CLAUDE", index: 1, selected: false,
      panes: [{
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", index: 0, focused: false,
        surfaces: [{ id: terminalB, type: "terminal", title: "UI Agent", index: 0, selected: true }],
      }],
    },
  ],
};

it("groups every terminal by workspace and ignores browser surfaces", () => {
  expect(terminalWorkspaces(snapshotWithTwoWorkspaces)).toEqual([
    { id: workspaceA, title: "CODEX", terminals: [expect.objectContaining({ id: terminalA })] },
    { id: workspaceB, title: "CLAUDE", terminals: [expect.objectContaining({ id: terminalB })] },
  ]);
});

it("renders more than one terminal per pane and uses exact surface IDs", () => {
  const onOpen = vi.fn();
  render(<Dashboard workspaces={terminalWorkspaces(snapshotWithTwoWorkspaces)} onOpen={onOpen} connection="connected" />);
  fireEvent.click(screen.getByRole("button", { name: /API Agent/ }));
  expect(onOpen).toHaveBeenCalledWith(terminalA);
});
```

- [ ] **Step 5: Run dashboard tests and confirm red**

Run: `devenv shell -- bun run --cwd client test -- src/lib/__tests__/topology.test.ts src/components/__tests__/Dashboard.test.tsx`
Expected: FAIL because the dashboard and topology helper do not exist.

- [ ] **Step 6: Implement terminal-only grouping and dense dashboard**

```ts
export interface TerminalWorkspace {
  id: string;
  title: string;
  terminals: Array<{ id: string; title: string; selected: boolean }>;
}

export function terminalWorkspaces(tree: TreeSnapshot): TerminalWorkspace[];
export function recoverSelectedSurface(tree: TreeSnapshot, selectedId: string | null): string | null;
```

Render a `Terminals` heading. Sort workspaces and surfaces by their cmux indexes. Keep empty
workspaces visible with a `No terminal surfaces` row. Each terminal is a native button with a 44 px
minimum target and its exact UUID in the callback, never a ref or index.

- [ ] **Step 7: Replace drawer navigation with dashboard/terminal history state**

`App` shows `Login` until authenticated. Once authenticated it mounts `useCmux`. Dashboard → terminal
uses `history.pushState({ surfaceId }, "", "#terminal")`; `popstate` returns to the dashboard. If a
tree refresh removes the selected surface, call `history.back()` when possible or replace the state
with dashboard and show `Terminal closed`.

Remove Hammer and its type package from `client/package.json`; delete `Drawer.tsx` and
`useGesture.ts`. Modify `Header` to accept `{ title, onBack?: () => void }`. Modify `StatusBar` to show
both bridge and cmux states without pane dots.

- [ ] **Step 8: Run client verification**

Run: `devenv shell -- bun install --cwd client`
Expected: lockfile updates after Hammer removal.
Run: `devenv shell -- bun run --cwd client test`
Expected: PASS.
Run: `devenv shell -- typecheck`
Expected: PASS.
Run: `devenv shell -- build-all`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/package.json client/bun.lock client/src
git commit -m "feat(client): add authenticated dynamic terminal dashboard"
```

---

### Task 7: Adaptive selected-terminal polling

**Files:**
- Create: `client/src/hooks/useTerminalPolling.ts`
- Create: `client/src/hooks/__tests__/useTerminalPolling.test.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `readText(surfaceId, lines)` and the selected surface from Task 6.
- Produces: `{ content, error, refreshNow }` with one request in flight.

Define these local test helpers before the polling cases:

```ts
const surfaceId = "11111111-1111-4111-8111-111111111111";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}
```

- [ ] **Step 1: Write failing adaptive-loop tests**

```ts
it("backs off while unchanged, returns to 250 ms on change, and never overlaps reads", async () => {
  vi.useFakeTimers();
  const deferred = createDeferred<string>();
  const readText = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue("changed");
  const { result } = renderHook(() => useTerminalPolling({ enabled: true, surfaceId, readText }));
  act(() => vi.advanceTimersByTime(10_000));
  expect(readText).toHaveBeenCalledTimes(1);
  deferred.resolve("same");
  await act(async () => await deferred.promise);
  act(() => vi.advanceTimersByTime(500));
  expect(readText).toHaveBeenCalledTimes(2);
  expect(result.current.content).toBe("changed");
});

it("stops while hidden and reads immediately when visible", async () => {
  const readText = vi.fn().mockResolvedValue("");
  setVisibility("hidden");
  renderHook(() => useTerminalPolling({ enabled: true, surfaceId, readText }));
  act(() => vi.advanceTimersByTime(30_000));
  expect(readText).not.toHaveBeenCalled();
  setVisibility("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(readText).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run polling tests and confirm red**

Run: `devenv shell -- bun run --cwd client test -- src/hooks/__tests__/useTerminalPolling.test.tsx`
Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the one-in-flight adaptive state machine**

```ts
export const POLL_DELAYS = [250, 500, 1000, 2000, 5000] as const;

export function nextPollIndex(current: number, changed: boolean): number {
  return changed ? 0 : Math.min(current + 1, POLL_DELAYS.length - 1);
}

export function useTerminalPolling(options: {
  enabled: boolean;
  surfaceId: string | null;
  readText: (surfaceId: string, lines: number) => Promise<string>;
}): { content: string; error: string | null; refreshNow: () => void };
```

Use one `setTimeout`, scheduled only after the previous promise settles. Clear it on surface change,
disconnect, unmount, and hidden state. Discard a late response when its surface no longer matches.
Use 2,000 lines. On an RPC error, retain the last content, mark it stale, and retry after 2 seconds.

- [ ] **Step 4: Wire only the selected terminal**

In `App`, enable polling only when auth, bridge, cmux, and selected surface are all active. Dashboard
rows never call `readText`. Pass the returned snapshot and stale state into `Terminal`.

- [ ] **Step 5: Run focused and client verification**

Run: `devenv shell -- bun run --cwd client test -- src/hooks/__tests__/useTerminalPolling.test.tsx`
Expected: PASS.
Run: `devenv shell -- bun run --cwd client test`
Expected: PASS.
Run: `devenv shell -- typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useTerminalPolling.ts client/src/hooks/__tests__/useTerminalPolling.test.tsx client/src/App.tsx
git commit -m "feat(client): poll only the open terminal adaptively"
```

---

### Task 8: Bidirectional xterm, mobile toolbar, and viewport cleanup

**Files:**
- Rewrite: `client/src/components/Terminal.tsx`
- Create: `client/src/components/TerminalToolbar.tsx`
- Create: `client/src/components/__tests__/TerminalToolbar.test.tsx`
- Create: `client/src/lib/terminal.ts`
- Create: `client/src/lib/__tests__/terminal.test.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/styles/global.css`

**Interfaces:**
- Consumes: terminal snapshot and typed send/key/viewport functions from Tasks 5 and 7.
- Produces: a selectable xterm with ordered input and an accessible mobile toolbar.

- [ ] **Step 1: Write failing terminal-helper and toolbar tests**

```ts
it("normalizes padded snapshots without trimming meaningful leading text", () => {
  expect(cleanTerminalSnapshot("  prompt  \nvalue    \n")).toBe("  prompt\nvalue\n");
});

it("maps every named-key toolbar action to the exact cmux key", () => {
  const onKey = vi.fn();
  render(<TerminalToolbar onKey={onKey} />);
  fireEvent.click(screen.getByRole("button", { name: "Esc" }));
  fireEvent.click(screen.getByRole("button", { name: "Tab" }));
  fireEvent.click(screen.getByRole("button", { name: "Ctrl-C" }));
  fireEvent.click(screen.getByRole("button", { name: "Ctrl-D" }));
  fireEvent.click(screen.getByRole("button", { name: "Up" }));
  fireEvent.click(screen.getByRole("button", { name: "Down" }));
  fireEvent.click(screen.getByRole("button", { name: "Enter" }));
  expect(onKey.mock.calls.map(([key]) => key)).toEqual([
    "escape", "tab", "ctrl+c", "ctrl+d", "up", "down", "enter",
  ]);
});

it("applies Ctrl to the next letter only", () => {
  expect(controlText("c")).toBe("\u0003");
  expect(controlText("D")).toBe("\u0004");
  expect(controlText("l")).toBe("\u000c");
  expect(controlText("1")).toBeNull();
});
```

- [ ] **Step 2: Run terminal tests and confirm red**

Run: `devenv shell -- bun run --cwd client test -- src/lib/__tests__/terminal.test.ts src/components/__tests__/TerminalToolbar.test.tsx`
Expected: FAIL because the helper and toolbar do not exist.

- [ ] **Step 3: Implement terminal helpers and toolbar**

```ts
export function cleanTerminalSnapshot(content: string): string;
export function controlText(letter: string): string | null;
export function restoredViewportLine(baseY: number, distanceFromBottom: number): number;
```

The toolbar renders native `type="button"` controls for Esc, Tab, Ctrl, Ctrl-C, Ctrl-D, Up, Down,
and Enter. Ctrl is one-shot and converts the next ASCII letter to its control byte with
`letter.toUpperCase().charCodeAt(0) & 31`; dedicated Ctrl-C/D use named keys and always work.
Every button has a visible label, `aria-label`, and a minimum 44 px touch target.

- [ ] **Step 4: Enable xterm input and safe snapshot replacement**

Use this public component contract:

```ts
interface TerminalProps {
  surfaceId: string;
  content: string;
  stale: boolean;
  viewportEnabled: boolean;
  onInput(text: string): void;
  onKey(key: AllowedKey): void;
  onViewport(columns: number, rows: number, generation: number): void;
  onViewportClear(generation: number): void;
}
```

Set `disableStdin: false` and `screenReaderMode: true`. Subscribe to `term.onData`; when the toolbar's
local Ctrl state is armed, transform the next single ASCII letter with `controlText`, consume the
modifier, and call `onInput` with the resulting byte. All other data calls `onInput` unchanged.
Subscribe to `term.onResize`, debounce resize reports by 100 ms, and increment a per-surface
generation. On unmount or surface change call `onViewportClear` with a newer generation.

Before replacing a changed snapshot, record whether `viewportY === baseY` and the distance from the
bottom. If `term.hasSelection()` is true, keep only the newest pending snapshot and apply it after the
selection clears. Otherwise reset/write the cleaned snapshot, then scroll to bottom or restore the
distance after xterm's write callback. Identical snapshots do nothing.

- [ ] **Step 5: Wire input without optimistic echo**

`App` calls `sendText(surfaceId, text)` for xterm input and `sendKey(surfaceId, key)` for toolbar
actions. Do not echo locally; the next cmux snapshot is authoritative. After accepted input, call
`refreshNow()` so output is fetched immediately. Failed input leaves a visible transient error and is
never replayed automatically after reconnect.

Enable viewport calls only when capabilities include `terminal.viewport.v1`. The client sends
columns/rows/generation; the server supplies its private `client_id` and clears sticky reports on any
disconnect.

- [ ] **Step 6: Update mobile terminal CSS**

Remove `touch-action: none`. Use a column layout based on `100dvh`, `env(safe-area-inset-*)`, and a
fixed toolbar above the bottom safe area. The xterm container gets `min-height: 0`, text selection,
and vertical pan behavior. Use `window.visualViewport` resize only to set a CSS custom property for
the available height; do not add a keyboard-detection library.

- [ ] **Step 7: Run client verification**

Run: `devenv shell -- bun run --cwd client test`
Expected: PASS.
Run: `devenv shell -- typecheck`
Expected: PASS.
Run: `devenv shell -- build-all`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/App.tsx client/src/components/Terminal.tsx client/src/components/TerminalToolbar.tsx client/src/components/__tests__/TerminalToolbar.test.tsx client/src/lib/terminal.ts client/src/lib/__tests__/terminal.test.ts client/src/styles/global.css
git commit -m "feat(client): support reliable mobile terminal input"
```

---

### Task 9: Correct PWA installation and offline boundary

**Files:**
- Modify: `client/index.html`
- Modify: `client/src/main.tsx`
- Modify: `client/src/styles/global.css`
- Modify: `client/vite.config.ts`
- Modify: `client/public/manifest.json`
- Delete: `client/public/sw.js`
- Create: `client/src/service-worker.ts`
- Create: `client/public/icon-192.png`
- Create: `client/public/icon-512.png`
- Create: `client/public/apple-touch-icon.png`
- Create: `client/src/lib/__tests__/service-worker-policy.test.ts`

**Interfaces:**
- Consumes: built Vite assets and authentication routes.
- Produces: installable Safari PWA whose cache cannot store terminal/auth/API data.

- [ ] **Step 1: Write a failing service-worker policy test**

```ts
import { isCacheableRequest } from "../../service-worker";

it("caches only same-origin static GET requests", () => {
  const origin = "https://mac.test";
  expect(isCacheableRequest(new Request(`${origin}/assets/app.js`), origin)).toBe(true);
  expect(isCacheableRequest(new Request(`${origin}/auth/status`), origin)).toBe(false);
  expect(isCacheableRequest(new Request(`${origin}/health`), origin)).toBe(false);
  expect(isCacheableRequest(new Request(`${origin}/ws`), origin)).toBe(false);
  expect(isCacheableRequest(new Request(`${origin}/`, { method: "POST" }), origin)).toBe(false);
  expect(isCacheableRequest(new Request("https://other.test/app.js"), origin)).toBe(false);
});
```

- [ ] **Step 2: Run the policy test and confirm red**

Run: `devenv shell -- bun run --cwd client test -- src/lib/__tests__/service-worker-policy.test.ts`
Expected: FAIL because the existing worker caches nearly every fetch.

- [ ] **Step 3: Implement a static-only cache policy**

Implement `client/src/service-worker.ts` as a module with:

```ts
const STATIC_PATHS = new Set([
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
]);

export function isCacheableRequest(request: Request, origin: string): boolean {
  const url = new URL(request.url);
  return request.method === "GET"
    && url.origin === origin
    && (url.pathname.startsWith("/assets/") || STATIC_PATHS.has(url.pathname));
}
```

The worker uses that exact predicate before `cache.put`. Navigation is never cached; when its network
request fails, return a small `503 text/html` response saying `cmux Remote is offline`. Configure Vite
with `index.html` and `src/service-worker.ts` as build inputs and force the worker entry name to
`sw.js`:

```ts
import { resolve } from "node:path";

build: {
  rollupOptions: {
    input: {
      app: resolve(import.meta.dirname, "index.html"),
      sw: resolve(import.meta.dirname, "src/service-worker.ts"),
    },
    output: {
      entryFileNames: (chunk) => chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
    },
  },
},
```

Register `/sw.js` from `main.tsx` with `{ type: "module" }`. Guard worker event registration with
`"skipWaiting" in globalThis` so importing the pure predicate in Vitest has no browser-window side
effects.

- [ ] **Step 4: Correct install metadata and app bootstrap**

Set `<html lang="en">`, keep `viewport-fit=cover`, add `apple-touch-icon`, and set the manifest fields:

```json
{
  "name": "cmux Remote",
  "short_name": "cmux",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "theme_color": "#0b1020",
  "background_color": "#0b1020"
}
```

Replace the root non-null assertion in `main.tsx` with an explicit missing-root error before
`createRoot`.

- [ ] **Step 5: Generate and inspect original PWA icons**

Use the `imagegen` skill to create a simple original dark cmux-remote mark with no third-party logo,
then export exact 192×192, 512×512, and 180×180 PNG files. Inspect each generated PNG before adding
it. The icons contain no text smaller than the 180 px rendering can preserve.

- [ ] **Step 6: Run PWA-focused and client verification**

Run: `devenv shell -- bun run --cwd client test -- src/lib/__tests__/service-worker-policy.test.ts`
Expected: PASS.
Run: `devenv shell -- bun run --cwd client test`
Expected: PASS.
Run: `devenv shell -- build-all`
Expected: PASS and all manifest-referenced icons exist in `client/dist`.

- [ ] **Step 7: Commit**

```bash
git add client/index.html client/vite.config.ts client/src/main.tsx client/src/service-worker.ts client/src/styles/global.css client/public client/src/lib/__tests__/service-worker-policy.test.ts
git commit -m "feat(pwa): enforce a static-only offline boundary"
```

---

### Task 10: Repository lint gate and deterministic browser E2E

**Files:**
- Create: `package.json`
- Create: `bun.lock`
- Create: `biome.json`
- Create: `playwright.config.ts`
- Create: `e2e/fake-cmux.ts`
- Create: `e2e/start.ts`
- Create: `e2e/helpers.ts`
- Create: `e2e/auth.spec.ts`
- Create: `e2e/terminal.spec.ts`
- Create: `e2e/reconnect.spec.ts`
- Modify: `devenv.nix`
- Modify: `README.md`

**Interfaces:**
- Consumes: the complete production bridge and PWA from Tasks 1–9.
- Produces: `lint`, `e2e-deps`, `e2e`, and final `check` commands.

Use one shared login helper from `e2e/helpers.ts`:

```ts
import type { Page } from "@playwright/test";

export async function login(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Access token").fill("e2e-token-with-at-least-32-bytes");
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: "Terminals" }).waitFor();
}
```

- [ ] **Step 1: Add pinned repository tooling**

```json
{
  "name": "cmux-remote-tooling",
  "private": true,
  "scripts": {
    "lint": "biome lint client/src server/src e2e playwright.config.ts",
    "e2e": "bun run --cwd client build && playwright test"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.13",
    "@playwright/test": "1.63.0"
  }
}
```

Create `biome.json` with recommended TypeScript/React correctness and accessibility rules, formatter
disabled, generated `dist`, `node_modules`, and `.devenv` excluded. Run `devenv shell -- bun install`
and commit the root `bun.lock`.

- [ ] **Step 2: Run lint and correct every finding**

Run: `devenv shell -- bun run lint`
Expected before corrections: FAIL on concrete code findings.
Apply the smallest behavior-preserving correction for every finding.
Run: `devenv shell -- bun run lint`
Expected after corrections: PASS with zero errors and warnings.

- [ ] **Step 3: Create the deterministic fake cmux socket**

```ts
export interface FakeCmuxControl {
  socketPath: string;
  close(): Promise<void>;
}

export async function startFakeCmux(): Promise<FakeCmuxControl>;
```

The fake implements only `auth.login`, `system.ping`, `system.capabilities`, `system.tree`,
`surface.read_text`, `surface.send_text`, `surface.send_key`, `terminal.viewport`, and
`events.stream`. It starts with two workspaces and at least three terminals, keeps per-surface output,
echoes accepted text/key markers only into the exact target, records viewport clear, and emits a
delayed `surface.created` event so the dashboard can prove live rediscovery. Unknown methods return
`method_not_found`.

`e2e/start.ts` starts the fake, calls the production `startServer(loadConfig({...}))` in the same
process with a fixed test-only token, socket password, `127.0.0.1:3457`, and the fake socket path, and
closes both on SIGINT or SIGTERM. The fake alone owns and removes its exact temporary socket
directory; no child-process wrapper or shell cleanup is needed.

- [ ] **Step 4: Configure Chromium and iPhone WebKit**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3457", trace: "retain-on-failure" },
  webServer: {
    command: "bun e2e/start.ts",
    url: "http://127.0.0.1:3457/health",
    reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-webkit", use: { ...devices["iPhone 15"] } },
  ],
});
```

- [ ] **Step 5: Write failing authentication and discovery E2E**

```ts
test("requires login and discovers a new terminal without reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "cmux Remote" })).toBeVisible();
  await page.getByLabel("Access token").fill("wrong");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Authentication failed")).toBeVisible();
  await page.getByLabel("Access token").fill("e2e-token-with-at-least-32-bytes");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("button", { name: "API Agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New terminal" })).toBeVisible();
});
```

Run: `devenv shell -- bunx playwright test e2e/auth.spec.ts --project=chromium`
Expected: FAIL until the fake event and production bridge lifecycle are correct.

- [ ] **Step 6: Write terminal switching and input E2E**

Cover these exact assertions in both configured projects:

```ts
test("reads, types, sends mobile keys, and switches exact surfaces", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "API Agent" }).click();
  const terminal = page.getByRole("region", { name: "Terminal" });
  const accessibleText = terminal.locator(".xterm-accessibility-tree");
  await expect(accessibleText).toContainText("api ready");
  await terminal.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("status");
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(accessibleText).toContainText("status<enter>");
  await page.getByRole("button", { name: "Ctrl-C" }).click();
  await expect(accessibleText).toContainText("<ctrl+c>");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "UI Agent" }).click();
  const nextText = page.getByRole("region", { name: "Terminal" }).locator(".xterm-accessibility-tree");
  await expect(nextText).toContainText("ui ready");
  await expect(nextText).not.toContainText("status<enter>");
});
```

- [ ] **Step 7: Write reconnect and offline E2E**

```ts
test("recovers after offline and foreground transitions", async ({ page, context }) => {
  await login(page);
  await page.getByRole("button", { name: "API Agent" }).click();
  await context.setOffline(true);
  await expect(page.getByText("Disconnected")).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await expect(page.getByText("Connected")).toBeVisible();
  await expect(page.getByText("api ready")).toBeVisible();
});
```

Add a service-worker case proving terminal/auth responses are absent from Cache Storage.

- [ ] **Step 8: Wire devenv quality commands**

Add root dependency installation to `deps`, plus:

```nix
scripts.lint.exec = "bun run lint";
scripts.e2e-deps.exec = "bunx playwright install chromium webkit";
scripts.e2e.exec = "bun run e2e";

scripts.check.exec = ''
  lint
  test-all
  typecheck
  e2e
'';
```

`deps` installs root, client, and server packages. Browser download remains a separate idempotent
`e2e-deps` command because it is large and unnecessary for non-browser work.

- [ ] **Step 9: Document secure operation and verification**

Rewrite README claims so they match behavior. Document:

- `devenv shell -- deps` and `devenv shell -- e2e-deps`;
- `devenv up`, `check`, and individual commands;
- generation and storage of `CMUX_REMOTE_TOKEN` outside Git;
- default localhost bind;
- Tailscale Serve over localhost and explicit Tailscale-IP bind as the two supported remote modes;
- optional `CMUX_REMOTE_ORIGIN`, `CMUX_SOCKET_PATH`, and `CMUX_SOCKET_PASSWORD`;
- why `0.0.0.0` and public tunnels are unsafe;
- whitelist and absence of browser control;
- iPhone Add to Home Screen and reconnect expectations;
- real-device checklist with eight disposable terminal surfaces.

Do not mark `Developed` or `Live` in `docs/superpowers/ROADMAP.md` until their defined lifecycle event
has actually happened.

- [ ] **Step 10: Run the complete automated gate**

Run: `devenv shell -- deps`
Expected: all three Bun dependency sets are installed from committed locks.
Run once per machine: `devenv shell -- e2e-deps`
Expected: Chromium and WebKit are installed.
Run: `devenv shell -- check`
Expected: lint, all client/server tests, both typechecks, production build, Chromium E2E, and iPhone
WebKit E2E PASS.

- [ ] **Step 11: Run real cmux and iPhone checks**

Create a disposable cmux workspace containing eight disposable terminal surfaces. Verify terminal
listing, rapid bounded output, idle output, switching, typing, Enter, Ctrl-C, selection/copy, closing
the selected surface, ten-minute background/foreground, and Tailscale disconnect/reconnect. Inspect
that the Mac viewport returns to its original grid after leaving the PWA.

Run negative requests without a cookie, with a wrong Origin, with an oversized message, and with
`workspace.create`; all must fail before reaching cmux. Remove only the disposable workspace after
capturing the results.

- [ ] **Step 12: Commit**

```bash
git add package.json bun.lock biome.json playwright.config.ts e2e devenv.nix README.md
git commit -m "test: cover the mobile terminal end to end"
```

---

## Final Verification and Delivery

- [ ] Run `devenv shell -- check` from a clean worktree and retain the exact output.
- [ ] Run `git diff --check` and confirm no whitespace errors.
- [ ] Run `git status --short` and confirm only intentional changes exist.
- [ ] Verify every manifest icon exists and every service-worker exclusion is covered.
- [ ] Verify no browser-visible response contains socket paths, TTY paths, credentials, transcript
  paths, process arguments, or raw cmux capability methods.
- [ ] Verify no input request can omit `surface_id` or use a ref/index fallback.
- [ ] Use `superpowers:requesting-code-review` for the final security-sensitive whole-branch review.
- [ ] Address only evidence-backed review findings and rerun the complete gate.
- [ ] Use `superpowers:finishing-a-development-branch` to choose merge/PR delivery while preserving
  the upstream remote and original MIT attribution.
