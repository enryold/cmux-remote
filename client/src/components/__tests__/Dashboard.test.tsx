// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewSurfaceWorkspaces } from "../../lib/topology";
import { snapshotWithTwoWorkspaces } from "../../test/topology-fixture";
import { Dashboard } from "../Dashboard";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("expires agent and notification evidence when metadata refresh stops", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  const workspaces = previewSurfaceWorkspaces(snapshotWithTwoWorkspaces);
  const workspace = workspaces.find((item) => item.surfaces.some((surface) => surface.type === "terminal"));
  if (!workspace) throw new Error("missing fixture workspace");
  workspace.activity = { observedAt: Date.now() - 60000, lastActivityAt: Date.now() - 60000, unreadCount: 2 };
  const terminal = workspace.surfaces.find((surface) => surface.type === "terminal");
  if (!terminal) throw new Error("missing fixture terminal");
  terminal.agent = { source: "test_agent", state: "working" };
  terminal.hasUnread = true;
  render(<Dashboard workspaces={workspaces} connection="connected" onOpen={vi.fn()} />);
  expect(screen.queryByText("Working")).toBeNull();
  expect(screen.queryByRole("img", { name: "Unread notification" })).toBeNull();
});

it("shows structured status, notifications and exact-pane creation; disconnect hides evidence", () => {
  const workspaces = previewSurfaceWorkspaces(snapshotWithTwoWorkspaces);
  const workspace = workspaces.find((item) => item.surfaces.some((surface) => surface.type === "terminal"));
  if (!workspace) throw new Error("missing fixture workspace");
  workspace.activity = { observedAt: Date.now(), lastActivityAt: Date.now() - 60000, unreadCount: 2 };
  const terminal = workspace.surfaces.find((surface) => surface.type === "terminal");
  if (!terminal) throw new Error("missing fixture terminal");
  terminal.agent = { source: "test_agent", state: "needs_attention" };
  const onCreate = vi.fn();
  const { rerender } = render(<Dashboard workspaces={workspaces} connection="connected" onOpen={vi.fn()} onCreate={onCreate} />);
  expect(screen.getByText("Needs attention")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Needs attention" })).toBeTruthy();
  expect(screen.getByText("2 unread")).toBeTruthy();
  const create = screen.getByRole("button", { name: `New terminal in ${workspace.title}` });
  expect(create.textContent).toBe("");
  expect(create.querySelector("svg circle")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: `New terminal in ${workspace.title}` }));
  expect(onCreate).toHaveBeenCalledWith(workspace.id, workspace.paneId);
  rerender(<Dashboard workspaces={workspaces} connection="disconnected" onOpen={vi.fn()} onCreate={onCreate} />);
  expect(screen.queryByText("Needs attention")).toBeNull();
  expect(screen.queryByRole("img", { name: "Needs attention" })).toBeNull();
  expect((screen.getByRole("button", { name: `New terminal in ${workspace.title}` }) as HTMLButtonElement).disabled).toBe(true);
});

describe("Dashboard", () => {
  it("replaces the dot with an accessible bell on the exact unread terminal, hides message text and clears stale evidence", () => {
    const workspaces = previewSurfaceWorkspaces(snapshotWithTwoWorkspaces);
    const workspace = workspaces.find((item) => item.title === "CODEX");
    if (!workspace) throw new Error("missing fixture workspace");
    workspace.activity = { observedAt: Date.now(), lastActivityAt: null, unreadCount: 1 };
    Object.assign(workspace.activity, { preview: "Floating completion message" });
    const terminal = workspace.surfaces.find((surface) => surface.title === "UI Agent");
    if (!terminal) throw new Error("missing fixture terminal");
    terminal.hasUnread = true;
    const onOpen = vi.fn();
    const { rerender } = render(<Dashboard workspaces={workspaces} connection="connected" onOpen={onOpen} />);
    const row = screen.getByRole("button", { name: "UI Agent" });
    expect(row.querySelector(".surface-dot")).toBeNull();
    const bell = screen.getByRole("img", { name: "Unread notification" });
    fireEvent.click(bell);
    expect(onOpen).toHaveBeenCalledWith(terminal.id);
    expect(screen.queryByText("Floating completion message")).toBeNull();
    rerender(<Dashboard workspaces={workspaces} connection="disconnected" onOpen={onOpen} />);
    expect(screen.queryByRole("img", { name: "Unread notification" })).toBeNull();
  });

  it("collapses only above two inactive tabs and promotes working or attentive tabs out of the group", () => {
    const workspaces = previewSurfaceWorkspaces(snapshotWithTwoWorkspaces);
    const workspace = workspaces.find((item) => item.title === "CODEX");
    if (!workspace) throw new Error("missing fixture workspace");
    workspace.activity = { observedAt: Date.now(), lastActivityAt: null, unreadCount: 0 };
    const { rerender } = render(<Dashboard workspaces={workspaces} connection="connected" onOpen={vi.fn()} />);
    expect(screen.queryByText(/Inactive tabs/)).toBeNull();
    workspace.surfaces.push({ id: "99999999-9999-4999-8999-999999999999", paneId: workspace.paneId ?? "", type: "browser", title: "Old browser", selected: false, urlLabel: null });
    rerender(<Dashboard workspaces={workspaces} connection="connected" onOpen={vi.fn()} />);
    const summary = screen.getByText("Inactive tabs (3)");
    expect(summary.closest("details")?.open).toBe(false);
    expect(screen.getByRole("button", { name: "API Agent" }).closest("details")).toBeNull();
    fireEvent.click(summary);
    const terminal = workspace.surfaces.find((surface) => surface.title === "UI Agent");
    if (!terminal) throw new Error("missing fixture terminal");
    terminal.agent = { source: "test_agent", state: "working" };
    rerender(<Dashboard workspaces={workspaces} connection="connected" onOpen={vi.fn()} />);
    expect(screen.queryByText(/Inactive tabs/)).toBeNull();
    terminal.agent = { source: "test_agent", state: "needs_attention" };
    rerender(<Dashboard workspaces={workspaces} connection="connected" onOpen={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Needs attention" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "UI Agent" }).closest("details")).toBeNull();
  });

  it("renders dense workspace groups and opens an exact terminal ID", () => {
    const onOpen = vi.fn();
    render(
      <Dashboard
        workspaces={previewSurfaceWorkspaces(snapshotWithTwoWorkspaces)}
        onOpen={onOpen}
        connection="connected"
      />,
    );

    expect(screen.getByRole("heading", { name: "Surfaces" })).toBeTruthy();
    expect(screen.queryByText("connected")).toBeNull();
    expect(screen.getByRole("heading", { name: "EMPTY" })).toBeTruthy();
    expect(screen.getByText("No surfaces")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "API Agent" }));
    expect(onOpen).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(screen.getByRole("button", { name: "localhost" })).toBeTruthy();
  });
});
