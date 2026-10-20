// @vitest-environment jsdom

import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
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
              urlLabel: null,
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
  const socket = FakeWebSocket.instances[0];
  if (!socket) throw new Error("missing fake WebSocket");
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

  it("does not let an older discovery response replace a newer post-action tree", async () => {
    const { result } = renderHook(() => useCmux());
    const socket = await bootstrap(result);
    let older: Promise<TreeSnapshot> | undefined;
    let newer: Promise<TreeSnapshot> | undefined;
    act(() => { older = result.current.refreshTree(); newer = result.current.refreshTree(); });
    const [first, second] = requests(socket).filter((request) => request.method === "system.tree").slice(-2);
    if (!first || !second || !older || !newer) throw new Error("missing discovery requests");
    await act(async () => {
      respond(socket, second, { workspaces: tree.workspaces.map((workspace) => ({ ...workspace, title: "Latest topology" })) });
      await newer;
    });
    await act(async () => { respond(socket, first, tree); await older; });
    expect(result.current.tree.workspaces[0]?.title).toBe("Latest topology");
  });

  it("loads capabilities and a typed tree after the bridge connects", async () => {
    const { result } = renderHook(() => useCmux());
    await bootstrap(result);
    expect(result.current.bridgeStatus).toBe("connected");
    expect(result.current.cmuxStatus).toBe("connected");
    expect(result.current.capabilities).toContain("terminal.viewport.v1");
  });

  it("accepts only boolean unread evidence and clears it when disconnected", async () => {
    const { result } = renderHook(() => useCmux());
    const socket = await bootstrap(result);
    const metadataTree = structuredClone(tree);
    const workspace = metadataTree.workspaces[0];
    if (!workspace?.panes[0]?.surfaces[0]) throw new Error("missing fixture terminal");
    workspace.activity = { observedAt: Date.now(), lastActivityAt: null, unreadCount: 1 };
    const surface = workspace.panes[0].surfaces[0];
    for (const value of ["true", true]) {
      Object.assign(surface, { hasUnread: value });
      await act(async () => {
        const pending = result.current.refreshTree();
        respond(socket, lastRequest(socket, "system.tree"), metadataTree);
        await pending;
      });
      expect(result.current.tree.workspaces[0]?.panes[0]?.surfaces[0]?.hasUnread).toBe(value === true ? true : undefined);
    }
    act(() => socket.closeFromServer());
    expect(result.current.tree.workspaces[0]?.activity).toBeUndefined();
    expect(result.current.tree.workspaces[0]?.panes[0]?.surfaces[0]?.hasUnread).toBeUndefined();
  });

  it("keeps a newer cmux connected state when an earlier connecting effect is still pending", async () => {
    const { result } = renderHook(() => {
      const api = useCmux();
      useLayoutEffect(() => {
        const socket = FakeWebSocket.instances[0];
        if (api.bridgeStatus === "connecting" && socket?.readyState === FakeWebSocket.CONNECTING) {
          socket.open();
          socket.receive('{"type":"state","cmux":"connected"}');
        }
      }, [api.bridgeStatus]);
      return api;
    });
    await waitFor(() => expect(result.current.bridgeStatus).toBe("connected"));
    expect(result.current.isConnectionCurrent(result.current.connectionGeneration)).toBe(true);
    expect(result.current.cmuxStatus).toBe("connected");
  });

  it("rejects pending RPCs when the bridge disconnects", async () => {
    const { result } = renderHook(() => useCmux());
    const socket = await bootstrap(result);
    const pending = result.current.readText(surfaceId, 20);
    act(() => socket.closeFromServer());
    await expect(pending).rejects.toThrow("bridge_disconnected");
  });

  it("invalidates input synchronously on cmux and bridge disconnection", async () => {
    const { result } = renderHook(() => useCmux());
    const socket = await bootstrap(result);
    const generation = result.current.connectionGeneration;
    expect(result.current.isConnectionCurrent(generation)).toBe(true);
    act(() => {
      socket.receive('{"type":"state","cmux":"disconnected"}');
      expect(result.current.isConnectionCurrent(generation)).toBe(false);
      socket.receive('{"type":"state","cmux":"connected"}');
    });
    expect(result.current.connectionGeneration).toBeGreaterThan(generation);
    expect(result.current.isConnectionCurrent(generation)).toBe(false);
    const next = result.current.connectionGeneration;
    act(() => { socket.closeFromServer(); expect(result.current.isConnectionCurrent(next)).toBe(false); });
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
