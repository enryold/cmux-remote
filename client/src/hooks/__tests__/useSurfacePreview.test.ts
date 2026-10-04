// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSurfacePreview } from "../useSurfacePreview";
import { imagePreview } from "../../test/preview-fixture";
const originalFetch = fetch;
afterEach(() => { cleanup(); vi.useRealTimers(); vi.stubGlobal("fetch", originalFetch); vi.restoreAllMocks(); });
function response(value: unknown = imagePreview) { return new Response(JSON.stringify(value), { status: 200 }); }
it("captures on open and refresh, marks failed refresh stale, and clears on disconnect", async () => {
  const request = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response("", { status: 502 }));
  vi.stubGlobal("fetch", request);
  const { result, rerender } = renderHook(({ enabled }) => useSurfacePreview({ surfaceId: imagePreview.surfaceId, enabled, onUnauthorized: vi.fn() }), { initialProps: { enabled: true } });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[0]).toBe(`/api/surfaces/${imagePreview.surfaceId}/preview`);
  expect(request.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
  expect(request.mock.calls[0]?.[1]).not.toHaveProperty("body");
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.status).toBe("stale"));
  expect(result.current.preview).toEqual(imagePreview);
  rerender({ enabled: false });
  expect(result.current.preview).toBeNull();
});
it("discards late captures for a previously selected surface", async () => {
  let complete!: (response: Response) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve; })).mockResolvedValue(new Response("", { status: 422 }));
  vi.stubGlobal("fetch", request);
  const { result, rerender } = renderHook(({ surfaceId }) => useSurfacePreview({ surfaceId, enabled: true, onUnauthorized: vi.fn() }), { initialProps: { surfaceId: imagePreview.surfaceId as string } });
  rerender({ surfaceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
  await act(async () => { complete(response()); });
  await waitFor(() => expect(result.current.status).toBe("unsupported"));
  expect(result.current.preview).toBeNull();
});
it("expires auth and forgets all bytes", async () => {
  const request = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response("", { status: 401 }));
  vi.stubGlobal("fetch", request);
  const expire = vi.fn();
  const { result } = renderHook(() => useSurfacePreview({ surfaceId: imagePreview.surfaceId, enabled: true, onUnauthorized: expire }));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  act(() => result.current.refresh());
  await waitFor(() => expect(expire).toHaveBeenCalledOnce());
  expect(result.current.preview).toBeNull();
});
it("refreshes on foreground without periodic captures", async () => {
  const request = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal("fetch", request);
  const { result } = renderHook(() => useSurfacePreview({ surfaceId: imagePreview.surfaceId, enabled: true, onUnauthorized: vi.fn() }));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  vi.useFakeTimers(); act(() => vi.advanceTimersByTime(60000));
  expect(request).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
});
it("clears a previous capture for a new connection generation", async () => {
  let complete!: (response: Response) => void;
  const request = vi.fn().mockResolvedValueOnce(response()).mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve; }));
  vi.stubGlobal("fetch", request);
  const { result, rerender } = renderHook(({ generation }) => useSurfacePreview({ surfaceId: imagePreview.surfaceId, enabled: true, onUnauthorized: vi.fn(), generation }), { initialProps: { generation: 1 } });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  rerender({ generation: 2 });
  expect(result.current.preview).toBeNull();
  await act(async () => { complete(response()); });
  await waitFor(() => expect(result.current.status).toBe("ready"));
});
