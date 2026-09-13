// @vitest-environment jsdom

import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeSnapshot } from "../../lib/cmux-rpc";
import { FakeWebSocket } from "../../test/fake-websocket";
import { useCmux } from "../useCmux";

interface WireRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

const surfaceId = "11111111-1111-4111-8111-111111111111";
const tree: TreeSnapshot = {
  workspaces: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      title: "CODEX",
      index: 0,
      selected: true,
      panes: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          index: 0,
          focused: true,
          surfaces: [
            {
              id: surfaceId,
              type: "terminal",
              title: "API Agent",
              index: 0,
              selected: true,
            },
          ],
        },
      ],
    },
  ],
};

function requests(socket: FakeWebSocket): WireRequest[] {
  return socket.sent.map((value) => JSON.parse(value) as WireRequest);
}

function lastRequest(socket: FakeWebSocket, method: string): WireRequest {
  const request = requests(socket)
    .reverse()
    .find((candidate) => candidate.method === method);
  if (!request) throw new Error(`missing ${method} request`);
  return request;
}

function respond(
  socket: FakeWebSocket,
  request: WireRequest,
  result: unknown,
): void {
  socket.receive(JSON.stringify({ id: request.id, ok: true, result }));
}

async function bootstrap(
  result: { current: ReturnType<typeof useCmux> },
): Promise<FakeWebSocket> {
  const socket = FakeWebSocket.instances[0]!;
  act(() => {
    socket.open();
    socket.receive('{"type":"state","cmux":"connected"}');
  });
  await waitFor(() =>
    expect(requests(socket).some(({ method }) => method === "system.capabilities")).toBe(true),
  );
  act(() =>
    respond(socket, lastRequest(socket, "system.capabilities"), {
      protocol: "cmux-socket",
      version: 2,
      access_mode: "automation",
      capabilities: ["events.v1", "terminal.viewport.v1"],
    }),
  );
  await waitFor(() =>
    expect(requests(socket).some(({ method }) => method === "system.tree")).toBe(true),
  );
  act(() => respond(socket, lastRequest(socket, "system.tree"), tree));
  await waitFor(() => expect(result.current.tree).toEqual(tree));
  return socket;
}

describe("useCmux", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads capabilities and a typed tree after the bridge connects", async () => {
    const { result } = renderHook(() => useCmux());
    await bootstrap(result);
    expect(result.current.bridgeStatus).toBe("connected");
    expect(result.current.cmuxStatus).toBe("connected");
    expect(result.current.capabilities).toContain("terminal.viewport.v1");
  });

  it("rejects pending RPCs when the bridge disconnects", async () => {
    const { result } = renderHook(() => useCmux());
    const socket = await bootstrap(result);
    const pending = result.current.readText(surfaceId, 20);
    act(() => socket.closeFromServer());
    await expect(pending).rejects.toThrow("bridge_disconnected");
  });

  it("coalesces topology event bursts into one tree refresh", async () => {
    const { result } = renderHook(() => useCmux());
    const socket = await bootstrap(result);
    vi.useFakeTimers();
    const event =
      '{"type":"event","event":"topology.changed","seq":5,"gap":false}';
    act(() => {
      socket.receive(event);
      socket.receive(event);
      vi.advanceTimersByTime(100);
    });
    expect(
      requests(socket).filter(({ method }) => method === "system.tree"),
    ).toHaveLength(2);
  });
});
