// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "../useAuth";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("useAuth", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("moves from anonymous to authenticated only after login succeeds", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ authenticated: false }));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("anonymous"));

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(async () => result.current.login("a".repeat(32)));
    expect(result.current.status).toBe("authenticated");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ token: "a".repeat(32) }),
      }),
    );
  });

  it("does not echo server details after failed login", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ authenticated: false }));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("anonymous"));

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "internal-secret-path" }, 401),
    );
    await act(async () => result.current.login("wrong"));
    expect(result.current.status).toBe("anonymous");
    expect(result.current.error).toBe("Authentication failed");
  });

  it("submits a pairing code when status selects pairing mode", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        authenticated: false,
        mode: "pairing",
        deviceAuthorized: true,
      }),
    );
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(result.current.mode).toBe("pairing");
    expect(result.current.deviceAuthorized).toBe(true);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(async () => result.current.login("123456"));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/auth/login",
      expect.objectContaining({
        body: JSON.stringify({ pairingCode: "123456" }),
      }),
    );
  });

  it("fails closed when pairing status does not authorize the device", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        authenticated: false,
        mode: "pairing",
        deviceAuthorized: false,
      }),
    );
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(result.current.mode).toBe("pairing");
    expect(result.current.deviceAuthorized).toBe(false);
  });
});
