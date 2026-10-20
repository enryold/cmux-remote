import type { ConnectionStatus } from "../lib/cmux-rpc";
import type { SurfaceWorkspace } from "../lib/topology";
import { useEffect, useState } from "react";

interface DashboardProps {
  workspaces: SurfaceWorkspace[];
  connection: ConnectionStatus;
  onOpen(surfaceId: string): void;
  onCreate?(workspaceId: string, paneId: string): void;
  onCloseInactive?(workspaceId: string, surfaceIds: string[]): void;
  busy?: boolean;
}

export function Dashboard({
  workspaces,
  connection,
  onOpen,
  onCreate,
  onCloseInactive,
  busy = false,
}: DashboardProps) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const currentTime = Math.max(now, Date.now());
  const labels = { working: "Working", needs_attention: "Needs attention", idle: "Idle", unknown: "Unknown" };
  return (
    <main className="dashboard">
      <div className="dashboard-heading">
        <h1>Surfaces</h1>
      </div>
      {workspaces.map((workspace) => {
        const fresh = connection === "connected" && workspace.activity !== undefined && currentTime - workspace.activity.observedAt < 45000 && workspace.activity.observedAt <= currentTime + 60000;
        const terminals = workspace.surfaces.filter((surface) => surface.type === "terminal");
        const state = (surface: typeof workspace.surfaces[number]) => fresh ? surface.agent?.state ?? "unknown" : "unknown";
        const unread = (surface: typeof workspace.surfaces[number]) => fresh && surface.type === "terminal" && surface.hasUnread === true;
        const needsAttention = (surface: typeof workspace.surfaces[number]) => unread(surface) || state(surface) === "needs_attention";
        const working = terminals.filter((surface) => state(surface) === "working").length;
        const attention = terminals.filter(needsAttention).length;
        const inactive = workspace.surfaces.filter((surface) => !surface.selected && state(surface) !== "working" && !needsAttention(surface));
        const grouped = inactive.length > 2;
        const visible = grouped ? workspace.surfaces.filter((surface) => !inactive.includes(surface)) : workspace.surfaces;
        const activity = fresh ? workspace.activity : undefined;
        const minutes = activity?.lastActivityAt ? Math.max(0, Math.floor((currentTime - activity.lastActivityAt) / 60000)) : null;
        const renderSurface = (surface: typeof workspace.surfaces[number]) => {
          const bellLabel = unread(surface) ? "Unread notification" : needsAttention(surface) ? "Needs attention" : null;
          return <button aria-label={surface.title} aria-describedby={bellLabel ? `attention-${surface.id}` : undefined} className="terminal-row" key={surface.id} onClick={() => onOpen(surface.id)} type="button">
            {bellLabel ? <svg id={`attention-${surface.id}`} role="img" aria-label={bellLabel} className="attention-bell" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg> : <span aria-hidden="true" className={surface.selected ? "surface-dot selected" : "surface-dot"} />}
            <span className="terminal-row-text">
              <strong>{surface.title}</strong>
              <small>{surface.type === "terminal" ? fresh && surface.agent?.source ? `Terminal · ${surface.agent.source}` : "Terminal" : surface.type === "browser" ? `Browser${surface.urlLabel ? ` · ${surface.urlLabel}` : ""}` : surface.type === "markdown" ? "Markdown · preview unavailable" : surface.type === "filepreview" ? "Image · thumbnail" : "Unsupported panel"}</small>
            </span>
            {surface.type === "terminal" ? <span className={`agent-state agent-${state(surface)}`}>{labels[state(surface)]}</span> : null}
          </button>;
        };
        return (
        <section className="workspace-group" key={workspace.id}>
          <div className="workspace-heading">
            <h2>{workspace.title}</h2>
            {onCreate && workspace.paneId ? <button type="button" className="new-terminal" title="New terminal" aria-label={`New terminal in ${workspace.title}`} disabled={connection !== "connected" || busy} onClick={() => workspace.paneId && onCreate(workspace.id, workspace.paneId)}><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg></button> : null}
          </div>
          <p className="workspace-counts">{terminals.length} terminals · {working} working · {attention} need attention</p>
          {activity ? <div className="workspace-activity">
            {activity.unreadCount > 0 ? <span className="unread-count">{activity.unreadCount} unread</span> : null}
            {minutes !== null && activity.lastActivityAt !== null ? <time dateTime={new Date(activity.lastActivityAt).toISOString()}>Active {minutes === 0 ? "just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`}</time> : null}
          </div> : null}
          {workspace.surfaces.length === 0 ? (
            <p className="empty-row">No surfaces</p>
          ) : (
            <>
              {visible.length > 0 ? <div className="terminal-list">{visible.map(renderSurface)}</div> : null}
              {grouped ? <details className="inactive-tabs"><summary><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m9 6 6 6-6 6" /></svg>Inactive tabs ({inactive.length})</summary>
                {onCloseInactive ? <button className="inactive-close" type="button" aria-label={`Chiudi tutti i tab inattivi in ${workspace.title}`} disabled={connection !== "connected" || busy} onClick={() => onCloseInactive(workspace.id, inactive.map((surface) => surface.id))}>Chiudi tutte</button> : null}
                <div className="terminal-list">{inactive.map(renderSurface)}</div></details> : null}
            </>
          )}
        </section>
      ); })}
    </main>
  );
}
