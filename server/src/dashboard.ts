import type { AgentActivity, TreeSnapshot } from "./rpc";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
}
function id(value: unknown): string | null { return typeof value === "string" ? value.toLowerCase() : null; }
function agent(value: Record<string, unknown> | undefined): AgentActivity {
  const source = typeof value?.agent_source === "string" && /^[a-z0-9][a-z0-9_.-]{0,39}$/i.test(value.agent_source) ? value.agent_source : null;
  const state = typeof value?.agent_state === "string" && value.agent_state.length <= 40 ? value.agent_state.trim().toLowerCase() : "";
  return { source, state: !source ? "unknown" : ["running", "working"].includes(state) ? "working"
    : ["needsinput", "needs_input", "needs input", "needs_attention"].includes(state) ? "needs_attention" : state === "idle" ? "idle" : "unknown" };
}

export function enrichDashboard(tree: TreeSnapshot, raw: unknown, notificationsRaw?: unknown): TreeSnapshot {
  const inventory = rows(record(raw)?.workspaces);
  if (inventory.length === 0) return tree;
  const notifications = rows(record(notificationsRaw)?.notifications);
  const surfaceIds = tree.workspaces.flatMap((workspace) => workspace.panes.flatMap((pane) => pane.surfaces.map((surface) => surface.id)));
  const now = Date.now();
  return { workspaces: tree.workspaces.map((workspace) => {
    const matches = inventory.filter((item) => id(item.id) === workspace.id);
    const owner = matches[0];
    if (matches.length !== 1 || !owner) return workspace;
    const terminals = rows(owner.terminals);
    const unread = new Set(notifications.filter((item) => item.is_read === false && id(item.workspace_id) === workspace.id).map((item) => id(item.surface_id)));
    const last = owner.last_activity_at;
    return { ...workspace, activity: {
      observedAt: now,
      lastActivityAt: typeof last === "number" && Number.isFinite(last) && last > 0 && last * 1000 <= now + 60000 ? last * 1000 : null,
      unreadCount: typeof owner.unread_count === "number" && Number.isSafeInteger(owner.unread_count) && owner.unread_count >= 0 ? Math.min(owner.unread_count, 9999) : 0,
    }, panes: workspace.panes.map((pane) => ({ ...pane, surfaces: pane.surfaces.map((surface) => {
      if (surface.type !== "terminal") return surface;
      const candidates = terminals.filter((item) => id(item.id) === surface.id);
      const hasUnread = unread.has(surface.id) && surfaceIds.filter((surfaceId) => surfaceId === surface.id).length === 1;
      return { ...surface, ...(hasUnread ? { hasUnread: true } : {}), agent: agent(candidates.length === 1 ? candidates[0] : undefined) };
    }) })) };
  }) };
}
