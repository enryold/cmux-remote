// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../App";
import type { CmuxApi } from "../hooks/useCmux";
import { snapshotWithTwoWorkspaces, terminalA } from "../test/topology-fixture";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useCmux: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({ useAuth: mocks.useAuth }));
vi.mock("../hooks/useCmux", () => ({ useCmux: mocks.useCmux }));
vi.mock("../components/Terminal", () => ({
  Terminal: () => <section aria-label="Terminal">Terminal screen</section>,
}));

const auth = {
  status: "authenticated" as const,
  mode: "token" as const,
  deviceAuthorized: true,
  error: null,
  login: vi.fn(),
  logout: vi.fn(),
  expire: vi.fn(),
};

function cmuxApi(): CmuxApi {
  return {
    bridgeStatus: "connected",
    cmuxStatus: "connected",
    capabilities: ["terminal.viewport.v1"],
    tree: snapshotWithTwoWorkspaces,
    getCapabilities: vi.fn(),
    refreshTree: vi.fn(),
    readText: vi.fn().mockResolvedValue("ready"),
    sendText: vi.fn().mockResolvedValue(undefined),
    sendKey: vi.fn().mockResolvedValue(undefined),
    reportViewport: vi.fn().mockResolvedValue(undefined),
    clearViewport: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  history.replaceState(null, "", "/");
  mocks.useAuth.mockReturnValue(auth);
  mocks.useCmux.mockReturnValue(cmuxApi());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("opens an exact surface and returns to the dashboard on popstate", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "API Agent" }));
  expect(history.state).toEqual({ surfaceId: terminalA });
  expect(screen.getByLabelText("Terminal")).toBeTruthy();

  act(() => {
    history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
  expect(screen.getByRole("heading", { name: "Terminals" })).toBeTruthy();
});

it("returns to the dashboard when cmux closes the selected surface", async () => {
  const api = cmuxApi();
  mocks.useCmux.mockReturnValue(api);
  const { rerender } = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "API Agent" }));

  api.tree = { workspaces: [] };
  mocks.useCmux.mockReturnValue(api);
  rerender(<App />);

  await waitFor(() =>
    expect(screen.getByText("Terminal closed")).toBeTruthy(),
  );
  expect(screen.getByRole("heading", { name: "Terminals" })).toBeTruthy();
});
