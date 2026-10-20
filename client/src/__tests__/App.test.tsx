// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { App } from "../App";
import type { CmuxApi } from "../hooks/useCmux";
import { snapshotWithTwoWorkspaces, terminalA } from "../test/topology-fixture";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useCmux: vi.fn(),
  terminal: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({ useAuth: mocks.useAuth }));
vi.mock("../hooks/useCmux", () => ({ useCmux: mocks.useCmux }));
vi.mock("../components/Terminal", () => ({
  Terminal: (props: unknown) => {
    mocks.terminal(props);
    return <section aria-label="Terminal">Terminal screen</section>;
  },
}));

const originalVisualViewport = window.visualViewport;

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
    connectionGeneration: 1,
    isConnectionCurrent: (generation) => generation === 1,
    bridgeStatus: "connected",
    cmuxStatus: "connected",
    capabilities: ["terminal.viewport.v1"],
    tree: snapshotWithTwoWorkspaces,
    getCapabilities: vi.fn(),
    refreshTree: vi.fn(),
    readText: vi.fn().mockResolvedValue("ready"),
    sendText: vi.fn().mockResolvedValue(undefined),
    sendKey: vi.fn().mockResolvedValue(undefined),
    createSurface: vi.fn(),
    closeSurface: vi.fn(),
    reportViewport: vi.fn().mockResolvedValue(undefined),
    clearViewport: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  history.replaceState(null, "", "/");
  mocks.useAuth.mockReturnValue(auth);
  mocks.useCmux.mockReturnValue(cmuxApi());
});

function inactiveTree() {
  const tree = structuredClone(snapshotWithTwoWorkspaces);
  const workspace = tree.workspaces[0];
  if (!workspace?.panes[0]) throw new Error("missing fixture");
  workspace.activity = { observedAt: Date.now(), lastActivityAt: null, unreadCount: 0 };
  workspace.panes[0].surfaces.push({ id: "99999999-9999-4999-8999-999999999999", title: "Old browser", type: "browser", selected: false, index: 3, urlLabel: null });
  return tree;
}

it("confirms bulk closing once, targets only captured inactive tabs and skips a newly working tab", async () => {
  const api = cmuxApi(); api.tree = inactiveTree();
  const updated = structuredClone(api.tree);
  const ui = updated.workspaces[0]?.panes[0]?.surfaces.find((surface) => surface.title === "UI Agent");
  if (!ui) throw new Error("missing fixture");
  ui.agent = { source: "test_agent", state: "working" };
  vi.mocked(api.refreshTree).mockResolvedValue(updated).mockResolvedValueOnce(api.tree);
  vi.mocked(api.closeSurface).mockResolvedValue(undefined);
  mocks.useCmux.mockReturnValue(api);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<App />);
  fireEvent.click(screen.getByText("Inactive tabs (3)"));
  fireEvent.click(screen.getByRole("button", { name: "Chiudi tutti i tab inattivi in CODEX" }));
  await waitFor(() => expect(api.closeSurface).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.closeSurface).mock.calls).toEqual([
    ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
    ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "99999999-9999-4999-8999-999999999999"],
  ]);
  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm.mock.calls[0]?.[0]).toContain("3 inactive tabs");
  confirm.mockRestore();
});

it.each([false, true])("does not replay bulk closes after cancellation or an uncertain result (confirmed=%s)", async (confirmed) => {
  const api = cmuxApi(); api.tree = inactiveTree();
  vi.mocked(api.refreshTree).mockResolvedValue(api.tree);
  vi.mocked(api.closeSurface).mockRejectedValue(new Error("rpc_timeout"));
  mocks.useCmux.mockReturnValue(api);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(confirmed);
  render(<App />);
  fireEvent.click(screen.getByText("Inactive tabs (3)"));
  fireEvent.click(screen.getByRole("button", { name: "Chiudi tutti i tab inattivi in CODEX" }));
  if (confirmed) await screen.findByRole("alert");
  expect(api.closeSurface).toHaveBeenCalledTimes(confirmed ? 1 : 0);
  confirm.mockRestore();
});

it("enters the exact newly created terminal immediately after discovery publishes it", async () => {
  const api = cmuxApi();
  const surfaceId = "99999999-9999-4999-8999-999999999999";
  const createdTree = structuredClone(snapshotWithTwoWorkspaces);
  createdTree.workspaces[0]?.panes[0]?.surfaces.push({ id: surfaceId, title: "Created terminal", type: "terminal", index: 3, selected: false, urlLabel: null });
  vi.mocked(api.createSurface).mockResolvedValue(surfaceId);
  mocks.useCmux.mockImplementation(() => {
    const [tree, setTree] = useState(snapshotWithTwoWorkspaces);
    return { ...api, tree, refreshTree: async () => { setTree(createdTree); return createdTree; } };
  });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "New terminal in CODEX" }));
  await waitFor(() => expect(screen.getByText("Created terminal").closest("header")).not.toBeNull());
  expect(history.state).toEqual({ surfaceId });
  expect(mocks.terminal.mock.calls[mocks.terminal.mock.calls.length - 1]?.[0]).toMatchObject({ surfaceId });
  expect(api.createSurface).toHaveBeenCalledOnce();
});

it("explains an outdated bridge and lets the user dismiss the notice without retrying creation", async () => {
  const api = cmuxApi();
  vi.mocked(api.createSurface).mockRejectedValue(new Error("unsupported_method"));
  vi.mocked(api.refreshTree).mockResolvedValue(snapshotWithTwoWorkspaces);
  mocks.useCmux.mockReturnValue(api);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "New terminal in CODEX" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Restart the bridge, then reload the app.");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(api.createSurface).toHaveBeenCalledOnce();
});

it("clears an unconfirmed creation notice when navigating to an existing terminal", async () => {
  const api = cmuxApi();
  vi.mocked(api.createSurface).mockRejectedValue(new Error("rpc_timeout"));
  vi.mocked(api.refreshTree).mockResolvedValue(snapshotWithTwoWorkspaces);
  mocks.useCmux.mockReturnValue(api);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "New terminal in CODEX" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Check the tabs before trying again.");
  fireEvent.click(screen.getByRole("button", { name: "API Agent" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(api.createSurface).toHaveBeenCalledOnce();
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--app-height");
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: originalVisualViewport,
  });
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
  expect(screen.getByRole("heading", { name: "Surfaces" })).toBeTruthy();
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
    expect(screen.getByText("Surface closed")).toBeTruthy(),
  );
  expect(screen.getByRole("heading", { name: "Surfaces" })).toBeTruthy();
});

it("submits prompt text before the terminal Enter key", async () => {
  const api = cmuxApi();
  mocks.useCmux.mockReturnValue(api);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "API Agent" }));

  const terminal = mocks.terminal.mock.calls[
    mocks.terminal.mock.calls.length - 1
  ]?.[0] as {
    onSubmit(text: string): Promise<string>;
  };
  await expect(terminal.onSubmit("continue the task")).resolves.toBe("accepted");

  expect(api.sendText).toHaveBeenCalledWith(terminalA, "continue the task");
  expect(api.sendKey).toHaveBeenCalledWith(terminalA, "enter");
  expect(vi.mocked(api.sendText).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(api.sendKey).mock.invocationCallOrder[0] as number,
  );
});

it("leaves keyboard viewport sizing to CSS", () => {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: {
      height: 320,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });

  render(<App />);

  expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("");
});

it("cancels late Enter when leaving the original terminal", async () => {
  const api = cmuxApi();
  let acknowledge!: () => void;
  vi.mocked(api.sendText).mockImplementation(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
  mocks.useCmux.mockReturnValue(api);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "API Agent" }));
  const terminal = mocks.terminal.mock.lastCall?.[0] as { onSubmit(text: string): Promise<string> };
  const result = terminal.onSubmit("launch");
  await waitFor(() => expect(api.sendText).toHaveBeenCalledOnce());
  act(() => window.dispatchEvent(new PopStateEvent("popstate", { state: null })));
  fireEvent.click(screen.getByRole("button", { name: "API Agent" }));
  acknowledge();
  await expect(result).resolves.toBe("enter_unconfirmed");
  expect(api.sendKey).not.toHaveBeenCalled();
});

it("cancels late Enter when the selected UUID no longer identifies a terminal", async () => {
  const api = cmuxApi();
  let acknowledge!: () => void;
  vi.mocked(api.sendText).mockImplementation(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
  mocks.useCmux.mockReturnValue(api);
  const { rerender } = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "API Agent" }));
  const terminal = mocks.terminal.mock.lastCall?.[0] as { onSubmit(text: string): Promise<string> };
  const result = terminal.onSubmit("launch");
  await waitFor(() => expect(api.sendText).toHaveBeenCalledOnce());
  api.tree = structuredClone(snapshotWithTwoWorkspaces);
  const target = api.tree.workspaces.flatMap((workspace) => workspace.panes).flatMap((pane) => pane.surfaces).find((surface) => surface.id === terminalA);
  if (!target) throw new Error("Missing fixture surface");
  target.type = "filepreview";
  rerender(<App />);
  acknowledge();
  await expect(result).resolves.toBe("enter_unconfirmed");
  expect(api.sendKey).not.toHaveBeenCalled();
});
