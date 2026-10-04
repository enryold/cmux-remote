export function cleanTerminalSnapshot(content: string): string {
  return content
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

export function snapshotUpdate(previous: string | null, next: string): { kind: "unchanged" | "append" | "replace"; text: string } {
  if (previous === next) return { kind: "unchanged", text: "" };
  if (previous !== null && next.startsWith(previous)) return { kind: "append", text: next.slice(previous.length) };
  return { kind: "replace", text: next };
}

export function controlText(letter: string): string | null {
  if (!/^[a-z]$/i.test(letter)) return null;
  return String.fromCharCode(letter.toUpperCase().charCodeAt(0) & 31);
}

export function restoredViewportLine(
  baseY: number,
  distanceFromBottom: number,
): number {
  return Math.max(0, baseY - distanceFromBottom);
}
