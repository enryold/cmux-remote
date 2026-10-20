import { describe, expect, it } from "bun:test";
import type { ServerWebSocket } from "bun";
import { CmuxClient } from "../cmux-client";
import type { CmuxEventStream, TopologyChange } from "../cmux-events";
import type { RuntimeConfig } from "../config";
import {
  createWebSocketData,
  createWebSocketHandler,
  type WSData,
} from "../ws";
import { eventually, startFakeCmuxServer } from "./fake-cmux";
import { PREVIEW_SURFACE, PREVIEW_WORKSPACE, previewTree } from "./preview-fixtures";
import { terminalGridFixture } from "./terminal-grid-fixture";

const surfaceId = "11111111-1111-4111-8111-111111111111";

class FakeEventStream {
  readonly listeners = new Set<(change: TopologyChange) => void>();

  async start(): Promise<void> {}
  stop(): void {}
  subscribe(listener: (change: TopologyChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(change: TopologyChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

interface WebSocketHarness {
  ws: ServerWebSocket<WSData>;
  messages: Array<Record<string, unknown>>;
  closed: Array<{ code?: number; reason?: string }>;
}

function createSocketHarness(): WebSocketHarness {
  const messages: Array<Record<string, unknown>> = [];
  const closed: Array<{ code?: number; reason?: string }> = [];
  const ws = {
    data: createWebSocketData(),
    send(value: string | Buffer) {
      messages.push(JSON.parse(value.toString()) as Record<string, unknown>);
      return value.toString().length;
    },
    close(code?: number, reason?: string) {
      closed.push({ code, reason });
    },
  } as unknown as ServerWebSocket<WSData>;
  return { ws, messages, closed };
}

const config: RuntimeConfig = {
  hostname: "127.0.0.1",
  port: 3456,
  remoteToken: "a".repeat(32),
  publicOrigin: null,
  tailscaleCapability: null,
  pairingCode: null,
  socketPath: "/tmp/cmux-test.sock",
  socketPassword: null,
};

describe("WebSocket bridge", () => {
  it("does not attach a color replay to a stopped terminal", async () => {
    const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
      if (request.method === "surface.read_text") server.fail(socket, request.id, "terminal_not_running", "stopped");
      else server.reply(socket, request.id, terminalGridFixture(surfaceId));
    } });
    const harness = createSocketHarness();
    const handler = createWebSocketHandler({ config: { ...config, socketPath: fake.path }, eventStream: new FakeEventStream() as unknown as CmuxEventStream });
    try {
      handler.open(harness.ws);
      await eventually(() => expect(harness.ws.data.cmux?.isConnected).toBe(true));
      await handler.message(harness.ws, JSON.stringify({ id: "stopped", method: "surface.read_text", params: { surface_id: surfaceId, lines: 10 } }));
      expect(harness.messages.at(-1)).toMatchObject({ ok: false, error: { code: "terminal_not_running" } });
      expect(fake.requests.some((request) => request.method === "terminal.replay")).toBe(false);
    } finally { await handler.close(harness.ws, 1000, "test"); await fake.close(); }
  });

  it.each(["unsupported", "invalid", "stalled"])("retains bounded plain-text reads when color capture is %s", async (mode) => {
    const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
      if (request.method === "terminal.replay") {
        if (mode === "stalled") return;
        if (mode === "unsupported") server.fail(socket, request.id, "method_not_found", "unsupported");
        else server.reply(socket, request.id, terminalGridFixture(PREVIEW_SURFACE));
      } else server.reply(socket, request.id, { text: "safe plain output" });
    } });
    const harness = createSocketHarness();
    const handler = createWebSocketHandler({ config: { ...config, socketPath: fake.path }, eventStream: new FakeEventStream() as unknown as CmuxEventStream });
    try {
      handler.open(harness.ws);
      await eventually(() => expect(harness.ws.data.cmux?.isConnected).toBe(true));
      const started = Date.now();
      await handler.message(harness.ws, JSON.stringify({ id: "fallback", method: "surface.read_text", params: { surface_id: surfaceId, lines: 10 } }));
      expect(Date.now() - started).toBeLessThan(1500);
      expect(harness.messages.at(-1)).toEqual({ id: "fallback", ok: true, result: { text: "safe plain output" } });
      expect(fake.requests.find((request) => request.method === "surface.read_text")?.params).toEqual({ surface_id: surfaceId, lines: 10, scrollback: true });
    } finally { await handler.close(harness.ws, 1000, "test"); await fake.close(); }
  });

  it("returns selected-terminal colors as generated SGR without exposing replay metadata or adding a public RPC", async () => {
    const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
      server.reply(socket, request.id, request.method === "terminal.replay" ? terminalGridFixture(surfaceId) : { text: "plain fallback" });
    } });
    const harness = createSocketHarness();
    const handler = createWebSocketHandler({ config: { ...config, socketPath: fake.path }, eventStream: new FakeEventStream() as unknown as CmuxEventStream });
    try {
      handler.open(harness.ws);
      await eventually(() => expect(harness.ws.data.cmux?.isConnected).toBe(true));
      await handler.message(harness.ws, JSON.stringify({ id: "colors", method: "surface.read_text", params: { surface_id: surfaceId, lines: 2000 } }));
      expect(harness.messages.at(-1)).toMatchObject({ id: "colors", ok: true, result: { text: expect.stringContaining("\u001b[0;1;38;2;255;119;119;48;2;81;37;31m- removed line") } });
      expect(Object.keys(harness.messages.at(-1)?.result as object)).toEqual(["text"]);
      expect(fake.requests.find((request) => request.method === "terminal.replay")?.params).toEqual({ surface_id: surfaceId, anchor: "screen", max_scrollback_rows: 2000 });
      await handler.message(harness.ws, JSON.stringify({ id: "blocked", method: "terminal.replay", params: { surface_id: surfaceId } }));
      expect(harness.messages.at(-1)).toMatchObject({ ok: false, error: { code: "unsupported_method" } });
    } finally { await handler.close(harness.ws, 1000, "test"); await fake.close(); }
  });

  it("checks live ownership before mutations and strips the upstream action response", async () => {
    const paneId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
      if (request.method === "system.tree") server.reply(socket, request.id, previewTree("terminal"));
      else server.reply(socket, request.id, { workspace_id: PREVIEW_WORKSPACE.toUpperCase(), pane_id: paneId.toUpperCase(), surface_id: PREVIEW_SURFACE.toUpperCase(), type: "terminal", private_path: "/private/no" });
    } });
    const harness = createSocketHarness();
    const handler = createWebSocketHandler({ config: { ...config, socketPath: fake.path }, eventStream: new FakeEventStream() as unknown as CmuxEventStream });
    try {
      handler.open(harness.ws);
      await eventually(() => expect(harness.ws.data.cmux?.isConnected).toBe(true));
      await handler.message(harness.ws, JSON.stringify({ id: "wrong", method: "surface.create", params: { workspace_id: PREVIEW_WORKSPACE, pane_id: surfaceId } }));
      expect(harness.messages.at(-1)).toMatchObject({ ok: false, error: { code: "surface_unavailable" } });
      expect(fake.requests.some((request) => request.method === "surface.create")).toBe(false);
      await handler.message(harness.ws, JSON.stringify({ id: "right", method: "surface.create", params: { workspace_id: PREVIEW_WORKSPACE, pane_id: paneId } }));
      expect(harness.messages.at(-1)).toEqual({ id: "right", ok: true, result: { workspace_id: PREVIEW_WORKSPACE, pane_id: paneId, surface_id: PREVIEW_SURFACE } });
      expect(fake.requests.find((request) => request.method === "surface.create")?.params).toEqual({ workspace_id: PREVIEW_WORKSPACE, pane_id: paneId, type: "terminal", focus: false });
      await handler.message(harness.ws, JSON.stringify({ id: "close", method: "surface.close", params: { workspace_id: surfaceId, surface_id: PREVIEW_SURFACE, confirmed: true } }));
      expect(harness.messages.at(-1)).toMatchObject({ ok: false, error: { code: "surface_unavailable" } });
      expect(fake.requests.some((request) => request.method === "surface.close")).toBe(false);
    } finally { await handler.close(harness.ws, 1000, "test"); await fake.close(); }
  });

  it.each(["mobile.workspace.list", "notification.list"])("isolates stalled %s metadata from terminal reads and bounds the total wait", async (stalled) => {
    const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
      if (request.method === stalled) return;
      server.reply(socket, request.id, request.method === "system.tree" ? previewTree("terminal") : { text: "terminal usable" });
    } });
    const harness = createSocketHarness();
    const handler = createWebSocketHandler({ config: { ...config, socketPath: fake.path }, eventStream: new FakeEventStream() as unknown as CmuxEventStream });
    try {
      handler.open(harness.ws);
      const started = Date.now();
      const discovery = handler.message(harness.ws, '{"id":"tree","method":"system.tree","params":{}}');
      await eventually(() => expect(fake.requests.some((request) => request.method === stalled)).toBe(true));
      await handler.message(harness.ws, JSON.stringify({ id: "read", method: "surface.read_text", params: { surface_id: PREVIEW_SURFACE, lines: 10 } }));
      expect(harness.messages.at(-1)).toMatchObject({ id: "read", ok: true, result: { text: "terminal usable" } });
      await discovery;
      expect(Date.now() - started).toBeLessThan(1500);
      expect(harness.messages.at(-1)).toMatchObject({ id: "tree", ok: true });
      expect(harness.ws.data.cmux?.isConnected).toBe(true);
    } finally { await handler.close(harness.ws, 1000, "test"); await fake.close(); }
  });

  it.each([false, true])("joins unread notifications without exposing messages and tolerates unsupported notification lists (%s)", async (unsupported) => {
    const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
      if (request.method === "system.tree") server.reply(socket, request.id, previewTree("terminal"));
      else if (request.method === "mobile.workspace.list") server.reply(socket, request.id, { workspaces: [{ id: PREVIEW_WORKSPACE, unread_count: 1, terminals: [{ id: PREVIEW_SURFACE, agent_source: "test_agent", agent_state: "Running" }] }] });
      else if (unsupported) server.fail(socket, request.id, "method_not_found", "private upstream error");
      else server.reply(socket, request.id, { notifications: [{ workspace_id: PREVIEW_WORKSPACE, surface_id: PREVIEW_SURFACE, is_read: false, body: "private notification message" }] });
    } });
    const harness = createSocketHarness();
    const handler = createWebSocketHandler({ config: { ...config, socketPath: fake.path }, eventStream: new FakeEventStream() as unknown as CmuxEventStream });
    try {
      handler.open(harness.ws);
      await handler.message(harness.ws, '{"id":"tree","method":"system.tree","params":{}}');
      const result = harness.messages.at(-1)?.result as import("../rpc").TreeSnapshot;
      const surface = result.workspaces[0]?.panes[0]?.surfaces[0];
      expect(surface?.agent?.state).toBe("working");
      expect(surface?.hasUnread === true).toBe(!unsupported);
      expect(JSON.stringify(result)).not.toContain("private");
    } finally { await handler.close(harness.ws, 1000, "test"); await fake.close(); }
  });

  it("does not replay a tab mutation after its validation connection is lost", async () => {
    const fake = await startFakeCmuxServer({ onRequest(request, socket) {
      if (request.method === "system.tree") socket.destroy();
    } });
    const harness = createSocketHarness();
    const handler = createWebSocketHandler({ config: { ...config, socketPath: fake.path }, eventStream: new FakeEventStream() as unknown as CmuxEventStream });
    try {
      handler.open(harness.ws);
      await eventually(() => expect(harness.ws.data.cmux?.isConnected).toBe(true));
      await handler.message(harness.ws, JSON.stringify({ id: "create", method: "surface.create", params: { workspace_id: PREVIEW_WORKSPACE, pane_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } }));
      expect(harness.messages.at(-1)).toMatchObject({ id: "create", ok: false });
      expect(fake.requests.map((request) => request.method)).toEqual(["system.tree"]);
    } finally { await handler.close(harness.ws, 1000, "test"); await fake.close(); }
  });
  it("rejects unsupported methods before they reach cmux", async () => {
    const fake = await startFakeCmuxServer();
    const eventStream = new FakeEventStream();
    const harness = createSocketHarness();
    const handler = createWebSocketHandler({
      config: { ...config, socketPath: fake.path },
      eventStream: eventStream as unknown as CmuxEventStream,
      createCmuxClient: (onStateChange) =>
        new CmuxClient({ socketPath: fake.path, onStateChange }),
    });

    try {
      await handler.open?.(harness.ws);
      await handler.message(harness.ws, '{"id":"browser-7","method":"workspace.create","params":{}}');
      expect(fake.requests).toHaveLength(0);
      expect(harness.messages.at(-1)).toMatchObject({
        id: "browser-7",
        ok: false,
        error: { code: "unsupported_method" },
      });

      eventStream.emit({ seq: 9, gap: false });
      expect(harness.messages.at(-1)).toEqual({
        type: "event",
        event: "topology.changed",
        seq: 9,
        gap: false,
      });
    } finally {
      await handler.close?.(harness.ws, 1000, "test");
      await fake.close();
    }
  });

  it("serializes input and clears a sticky viewport on close", async () => {
    const fake = await startFakeCmuxServer({
      onRequest(request, socket, server) {
        if (request.method === "terminal.viewport") {
          server.reply(
            socket,
            request.id,
            request.params.clear
              ? { surface_id: surfaceId }
              : { surface_id: surfaceId, columns: 80, rows: 24 },
          );
        } else {
          server.reply(socket, request.id, { accepted: true });
        }
      },
    });
    const harness = createSocketHarness();
    const handler = createWebSocketHandler({
      config: { ...config, socketPath: fake.path },
      eventStream: new FakeEventStream() as unknown as CmuxEventStream,
      createCmuxClient: (onStateChange) =>
        new CmuxClient({ socketPath: fake.path, onStateChange }),
    });
    const viewport = JSON.stringify({
      id: "viewport-1",
      method: "terminal.viewport",
      params: {
        surface_id: surfaceId,
        viewport_columns: 80,
        viewport_rows: 24,
        viewport_generation: 1,
      },
    });
    const input = (id: string, text: string) =>
      JSON.stringify({
        id,
        method: "surface.send_text",
        params: { surface_id: surfaceId, text },
      });

    try {
      await handler.open?.(harness.ws);
      await handler.message(harness.ws, viewport);
      await Promise.all([
        handler.message(harness.ws, input("input-a", "a")),
        handler.message(harness.ws, input("input-b", "b")),
      ]);
      await handler.close?.(harness.ws, 1000, "test");

      expect(
        fake.requests
          .filter(({ method }) => method === "surface.send_text")
          .map(({ params }) => params.text),
      ).toEqual(["a", "b"]);
      expect(fake.requests.at(-1)).toMatchObject({
        method: "terminal.viewport",
        params: { surface_id: surfaceId, clear: true },
      });
    } finally {
      await handler.close?.(harness.ws, 1000, "test");
      await fake.close();
    }
  });

  it("closes before parsing an oversized browser message", async () => {
    const fake = await startFakeCmuxServer();
    const harness = createSocketHarness();
    const handler = createWebSocketHandler({
      config: { ...config, socketPath: fake.path },
      eventStream: new FakeEventStream() as unknown as CmuxEventStream,
      createCmuxClient: (onStateChange) =>
        new CmuxClient({ socketPath: fake.path, onStateChange }),
    });

    try {
      await handler.open?.(harness.ws);
      await eventually(() =>
        expect(harness.messages).toContainEqual({
          type: "state",
          cmux: "connected",
        }),
      );
      await handler.message(harness.ws, "x".repeat(65_537));
      expect(harness.closed).toEqual([
        { code: 1009, reason: "message_too_large" },
      ]);
      expect(fake.requests).toHaveLength(0);
    } finally {
      await handler.close?.(harness.ws, 1000, "test");
      await fake.close();
    }
  });
});
