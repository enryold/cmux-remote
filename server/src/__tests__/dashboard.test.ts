import { expect, it } from "bun:test";
import { type TreeSnapshot, sanitizeCmuxResult } from "../rpc";
import { PREVIEW_SURFACE, PREVIEW_WORKSPACE, previewTree } from "./preview-fixtures";

function metadata(state = "Running") {
  return { workspaces: [{ id: PREVIEW_WORKSPACE.toUpperCase(), last_activity_at: Date.now() / 1000 - 60,
    preview: "\x1b[31mApproval\x1b[0m\nneeded", unread_count: 2, current_directory: "/private/redacted",
    terminals: [{ id: PREVIEW_SURFACE.toUpperCase(), agent_source: "test_agent", agent_state: state, transcript_path: "/private/transcript" }], surfaces: [{ file_path: "/private/file" }] }] };
}

it("joins only current structured agent metadata and returns bounded public dashboard fields", () => {
  const tree = sanitizeCmuxResult("system.tree", previewTree("terminal"), metadata()) as TreeSnapshot;
  expect(tree.workspaces[0]?.activity).toMatchObject({ unreadCount: 2, observedAt: expect.any(Number) });
  expect(tree.workspaces[0]?.panes[0]?.surfaces[0]?.agent).toEqual({ source: "test_agent", state: "working" });
  expect(JSON.stringify(tree)).not.toMatch(/private|transcript_path|current_directory|file_path/);
});

it.each([["Idle", "idle"], ["Needs input", "needs_attention"], ["Done", "unknown"], ["error", "unknown"]] as const)("maps %s conservatively", (upstream, expected) => {
  const result = sanitizeCmuxResult("system.tree", previewTree("terminal"), metadata(upstream)) as TreeSnapshot;
  expect(result.workspaces[0]?.panes[0]?.surfaces[0]?.agent?.state).toBe(expected);
});

it("fails closed for duplicate ownership, missing sources, malformed inventories and unknown IDs", () => {
  const raw = metadata(); raw.workspaces.push({ ...raw.workspaces[0] });
  const result = sanitizeCmuxResult("system.tree", previewTree("terminal"), raw) as TreeSnapshot;
  expect(result.workspaces[0]?.activity).toBeUndefined();
  const duplicated = metadata(); duplicated.workspaces[0].terminals.push({ ...duplicated.workspaces[0].terminals[0] });
  const ambiguous = sanitizeCmuxResult("system.tree", previewTree("terminal"), duplicated) as TreeSnapshot;
  expect(ambiguous.workspaces[0]?.panes[0]?.surfaces[0]?.agent?.state).toBe("unknown");
  for (const value of [undefined, {}, { workspaces: [] }]) {
    expect(sanitizeCmuxResult("system.tree", previewTree("terminal"), value)).toEqual(sanitizeCmuxResult("system.tree", previewTree("terminal")));
  }
});

it("rejects path-bearing agent identities instead of exposing them as display names", () => {
  const raw = metadata(); raw.workspaces[0].terminals[0].agent_source = "/private/transcript/provider";
  const result = sanitizeCmuxResult("system.tree", previewTree("terminal"), raw) as TreeSnapshot;
  expect(result.workspaces[0]?.panes[0]?.surfaces[0]?.agent).toEqual({ source: null, state: "unknown" });
});

it("associates unread notifications with only their exact live terminal and exports no messages", () => {
  const raw = metadata();
  const notifications = { notifications: [{ workspace_id: PREVIEW_WORKSPACE.toUpperCase(), surface_id: PREVIEW_SURFACE.toUpperCase(), is_read: false, body: "private notification body", title: "private title", id: "/private/id" }] };
  const tree = sanitizeCmuxResult("system.tree", previewTree("terminal"), raw, notifications) as TreeSnapshot;
  expect(tree.workspaces[0]?.panes[0]?.surfaces[0]).toMatchObject({ hasUnread: true });
  expect(tree.workspaces[0]?.activity).not.toHaveProperty("preview");
  expect(JSON.stringify(tree)).not.toMatch(/private|Approval|notification body/);
});

it("ignores read, unscoped, foreign, removed and nonterminal notification targets", () => {
  for (const override of [
    { is_read: true }, { is_read: "false" }, { workspace_id: undefined },
    { workspace_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
    { surface_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
  ]) {
    const notifications = { notifications: [{ workspace_id: PREVIEW_WORKSPACE, surface_id: PREVIEW_SURFACE, is_read: false, ...override }] };
    const tree = sanitizeCmuxResult("system.tree", previewTree("terminal"), metadata(), notifications) as TreeSnapshot;
    expect(tree.workspaces[0]?.panes[0]?.surfaces[0]).not.toMatchObject({ hasUnread: true });
  }
  const tree = sanitizeCmuxResult("system.tree", previewTree("browser"), metadata(), { notifications: [{ workspace_id: PREVIEW_WORKSPACE, surface_id: PREVIEW_SURFACE, is_read: false }] }) as TreeSnapshot;
  expect(tree.workspaces[0]?.panes[0]?.surfaces[0]).not.toMatchObject({ hasUnread: true });
});

it("rejects notification association when a surface ID has duplicate live ownership", () => {
  const rawTree = previewTree("terminal");
  rawTree.windows[0]?.workspaces[0]?.panes[0]?.surfaces.push({ ...rawTree.windows[0].workspaces[0].panes[0].surfaces[0] });
  const result = sanitizeCmuxResult("system.tree", rawTree, metadata(), { notifications: [{ workspace_id: PREVIEW_WORKSPACE, surface_id: PREVIEW_SURFACE, is_read: false }] }) as TreeSnapshot;
  expect(result.workspaces[0]?.panes[0]?.surfaces.every((surface) => !surface.hasUnread)).toBe(true);
});
