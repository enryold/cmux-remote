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
