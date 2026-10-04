import type { ConnectionStatus } from "../lib/cmux-rpc";
import type { SurfaceWorkspace } from "../lib/topology";

interface DashboardProps {
  workspaces: SurfaceWorkspace[];
  connection: ConnectionStatus;
  onOpen(surfaceId: string): void;
}

export function Dashboard({
  workspaces,
  connection,
  onOpen,
}: DashboardProps) {
  return (
    <main className="dashboard">
      <div className="dashboard-heading">
        <h1>Surfaces</h1>
        <span className={`connection-label connection-${connection}`}>
          {connection}
        </span>
      </div>
      {workspaces.map((workspace) => (
        <section className="workspace-group" key={workspace.id}>
          <h2>{workspace.title}</h2>
          {workspace.surfaces.length === 0 ? (
            <p className="empty-row">No surfaces</p>
          ) : (
            <div className="terminal-list">
              {workspace.surfaces.map((terminal) => (
                <button
                  aria-label={terminal.title}
                  className="terminal-row"
                  key={terminal.id}
                  onClick={() => onOpen(terminal.id)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={terminal.selected ? "surface-dot selected" : "surface-dot"}
                  />
                  <span className="terminal-row-text">
                    <strong>{terminal.title}</strong>
                    <small>{terminal.type === "terminal" ? "Terminal" : terminal.type === "browser" ? `Browser${terminal.urlLabel ? ` · ${terminal.urlLabel}` : ""}` : terminal.type === "markdown" ? "Markdown · preview unavailable" : terminal.type === "filepreview" ? "Image · preview unavailable" : "Unsupported panel"}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
