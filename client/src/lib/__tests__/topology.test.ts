import { describe, expect, it } from "vitest";
import {
  snapshotWithTwoWorkspaces,
  terminalA,
  terminalB,
} from "../../test/topology-fixture";
import { previewSurfaceWorkspaces, recoverSelectedSurface, terminalWorkspaces } from "../topology";

describe("terminal topology", () => {
  it("discovers typed browser and native panels in pane order", () => {
    const tree = structuredClone(snapshotWithTwoWorkspaces);
    const pane = tree.workspaces[0]?.panes[0]; if (!pane) throw new Error("missing pane");
    pane.surfaces.push({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", title: "Plan.md", type: "markdown", selected: false, index: 3, urlLabel: null });
    expect(previewSurfaceWorkspaces(tree)[1]?.surfaces.map((item) => item.type)).toEqual(["terminal", "browser", "terminal", "markdown"]);
  });
  it("sorts arbitrary workspaces and every terminal while ignoring browsers", () => {
    expect(terminalWorkspaces(snapshotWithTwoWorkspaces)).toEqual([
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "EMPTY",
        terminals: [],
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "CODEX",
        terminals: [
          { id: terminalA, title: "API Agent", selected: true },
          { id: terminalB, title: "UI Agent", selected: false },
        ],
      },
    ]);
  });

  it("keeps a selected terminal only while its exact ID exists", () => {
    expect(recoverSelectedSurface(snapshotWithTwoWorkspaces, terminalA)).toBe(
      terminalA,
    );
    expect(
      recoverSelectedSurface(
        snapshotWithTwoWorkspaces,
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ),
    ).toBeNull();
  });
});
