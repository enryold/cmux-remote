import type { ConnectionStatus } from "../lib/cmux-rpc";
import type { TerminalWorkspace } from "../lib/topology";

interface DashboardProps {
  workspaces: TerminalWorkspace[];
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
        <h1>Terminals</h1>
        <span className={`connection-label connection-${connection}`}>
          {connection}
        </span>
      </div>
      {workspaces.map((workspace) => (
        <section className="workspace-group" key={workspace.id}>
          <h2>{workspace.title}</h2>
          {workspace.terminals.length === 0 ? (
            <p className="empty-row">No terminal surfaces</p>
          ) : (
            <div className="terminal-list">
              {workspace.terminals.map((terminal) => (
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
                    <small>Terminal</small>
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
