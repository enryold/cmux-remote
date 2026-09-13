// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  POLL_DELAYS,
  nextPollIndex,
  useTerminalPolling,
} from "../useTerminalPolling";

const surfaceId = "11111111-1111-4111-8111-111111111111";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setVisibility("visible");
});

describe("useTerminalPolling", () => {
  it("backs off while unchanged and returns to 250 ms after output changes", async () => {
    vi.useFakeTimers();
    const readText = vi
      .fn()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("changed")
      .mockResolvedValueOnce("changed again");

    const { result } = renderHook(() =>
      useTerminalPolling({ enabled: true, surfaceId, readText }),
    );
    await act(async () => Promise.resolve());
    expect(readText).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(readText).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(readText).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(readText).toHaveBeenCalledTimes(3);
    expect(result.current.content).toBe("changed");

    await act(async () => vi.advanceTimersByTimeAsync(249));
    expect(readText).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(readText).toHaveBeenCalledTimes(4);
  });

  it("never overlaps reads", async () => {
    vi.useFakeTimers();
    const deferred = createDeferred<string>();
    const readText = vi.fn().mockReturnValue(deferred.promise);

    renderHook(() =>
      useTerminalPolling({ enabled: true, surfaceId, readText }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(readText).toHaveBeenCalledTimes(1);
    await act(async () => deferred.resolve("ready"));
  });

  it("stops while hidden and reads immediately when visible", async () => {
    vi.useFakeTimers();
    const readText = vi.fn().mockResolvedValue("");
    setVisibility("hidden");

    renderHook(() =>
      useTerminalPolling({ enabled: true, surfaceId, readText }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(readText).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it("discards a response from a previously selected surface", async () => {
    const oldRead = createDeferred<string>();
    const readText = vi
      .fn()
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce("new surface");
    const { result, rerender } = renderHook(
      ({ selected }) =>
        useTerminalPolling({ enabled: true, surfaceId: selected, readText }),
      { initialProps: { selected: surfaceId } },
    );

    rerender({ selected: "22222222-2222-4222-8222-222222222222" });
    await act(async () => Promise.resolve());
    await act(async () => oldRead.resolve("old surface"));
    expect(result.current.content).toBe("new surface");
  });
});

describe("nextPollIndex", () => {
  it("uses the fixed adaptive delay ladder", () => {
    expect(POLL_DELAYS).toEqual([250, 500, 1_000, 2_000, 5_000]);
    expect(nextPollIndex(3, true)).toBe(0);
    expect(nextPollIndex(4, false)).toBe(4);
  });
});
