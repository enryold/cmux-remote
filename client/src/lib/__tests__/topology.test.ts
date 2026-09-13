import { describe, expect, it } from "vitest";
import {
  snapshotWithTwoWorkspaces,
  terminalA,
  terminalB,
} from "../../test/topology-fixture";
import { recoverSelectedSurface, terminalWorkspaces } from "../topology";

describe("terminal topology", () => {
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
