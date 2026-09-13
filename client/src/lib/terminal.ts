export function cleanTerminalSnapshot(content: string): string {
  return content
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
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
