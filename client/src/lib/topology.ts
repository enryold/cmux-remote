import type { TreeSnapshot } from "./cmux-rpc";

export interface TerminalWorkspace {
  id: string;
  title: string;
  terminals: Array<{ id: string; title: string; selected: boolean }>;
}

export function terminalWorkspaces(tree: TreeSnapshot): TerminalWorkspace[] {
  return [...tree.workspaces]
    .sort((left, right) => left.index - right.index)
    .map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      terminals: [...workspace.panes]
        .sort((left, right) => left.index - right.index)
        .flatMap((pane) =>
          [...pane.surfaces]
            .sort((left, right) => left.index - right.index)
            .filter((surface) => surface.type === "terminal")
            .map((surface) => ({
              id: surface.id,
              title: surface.title,
              selected: surface.selected,
            })),
        ),
    }));
}

export function recoverSelectedSurface(
  tree: TreeSnapshot,
  selectedId: string | null,
): string | null {
  if (!selectedId) return null;
  for (const workspace of tree.workspaces) {
    for (const pane of workspace.panes) {
      if (
        pane.surfaces.some(
          (surface) =>
            surface.id === selectedId && surface.type === "terminal",
        )
      ) {
        return selectedId;
      }
    }
  }
  return null;
}
