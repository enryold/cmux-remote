// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWebSocket } from "../../test/fake-websocket";
import { reconnectDelay, useWebSocket } from "../useWebSocket";

describe("useWebSocket", () => {
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

  it("keeps retrying past ten failures", () => {
    vi.useFakeTimers();
    renderHook(() =>
      useWebSocket({ url: "ws://test/ws", enabled: true, onMessage: vi.fn() }),
    );

    for (let attempt = 0; attempt < 12; attempt += 1) {
      act(() =>
        FakeWebSocket.instances[
          FakeWebSocket.instances.length - 1
        ]?.closeFromServer(),
      );
      act(() => vi.advanceTimersByTime(30_000));
    }
    expect(FakeWebSocket.instances).toHaveLength(13);
  });

  it("reconnects immediately on foreground and never queues a disconnected send", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://test/ws", enabled: true, onMessage: vi.fn() }),
    );
    act(() => FakeWebSocket.instances[0]?.closeFromServer());
    expect(result.current.send("secret")).toBe(false);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.status).toBe("connecting");
  });

  it("reports an expired session without reconnecting", () => {
    vi.useFakeTimers();
    const onUnauthorized = vi.fn();
    renderHook(() =>
      useWebSocket({
        url: "ws://test/ws",
        enabled: true,
        onMessage: vi.fn(),
        onUnauthorized,
      }),
    );
    act(() => FakeWebSocket.instances[0]?.closeFromServer(4401));
    act(() => vi.advanceTimersByTime(60_000));
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("marks the bridge disconnected while offline and reconnects on online", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://test/ws", enabled: true, onMessage: vi.fn() }),
    );
    act(() => FakeWebSocket.instances[0]?.open());
    expect(result.current.status).toBe("connected");

    act(() => window.dispatchEvent(new Event("offline")));
    expect(result.current.status).toBe("disconnected");
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => window.dispatchEvent(new Event("online")));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.status).toBe("connecting");
  });

  it("bounds reconnect delay with deterministic jitter", () => {
    expect(reconnectDelay(0, 0)).toBe(800);
    expect(reconnectDelay(20, 0.5)).toBe(30_000);
    expect(reconnectDelay(20, 1)).toBe(36_000);
  });
});
