import type { ConnectionStatus } from "../lib/cmux-rpc";

interface StatusBarProps {
  bridge: ConnectionStatus;
  cmux: "connected" | "disconnected";
}

export function StatusBar({ bridge, cmux }: StatusBarProps) {
  const connected = bridge === "connected" && cmux === "connected";
  const label = connected
    ? "Connected"
    : bridge === "connecting"
      ? "Reconnecting…"
      : bridge === "connected"
        ? "cmux unavailable"
        : "Disconnected";

  return (
    <footer className={`status-bar ${connected ? "connected" : "disconnected"}`}>
      <span aria-hidden="true" className="status-dot" />
      <span>{label}</span>
    </footer>
  );
}
