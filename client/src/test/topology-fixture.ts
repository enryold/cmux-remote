import type { TreeSnapshot } from "../lib/cmux-rpc";

export const terminalA = "11111111-1111-4111-8111-111111111111";
export const terminalB = "22222222-2222-4222-8222-222222222222";

export const snapshotWithTwoWorkspaces: TreeSnapshot = {
  workspaces: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "CODEX",
      index: 1,
      selected: true,
      panes: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          index: 0,
          focused: true,
          surfaces: [
            {
              id: terminalB,
              type: "terminal",
              title: "UI Agent",
              index: 2,
              selected: false,
            },
            {
              id: terminalA,
              type: "terminal",
              title: "API Agent",
              index: 0,
              selected: true,
            },
            {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              type: "browser",
              title: "localhost",
              index: 1,
              selected: false,
            },
          ],
        },
      ],
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "EMPTY",
      index: 0,
      selected: false,
      panes: [],
    },
  ],
};
