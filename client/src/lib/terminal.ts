const sgr = new RegExp(`(${String.fromCharCode(27)}\\[[0-9;]*m)`, "g");

export function cleanTerminalSnapshot(content: string, columns?: number): string {
  return content
    .split("\n")
    .map((line) => {
      const clean = line.trimEnd();
      if (columns === undefined) return clean;
      const plain = clean.replace(sgr, "");
      if (plain.length <= columns || !/^ *([─━═_=-])\1{7,} *$/.test(plain)) return clean;
      let remaining = columns;
      return clean.split(sgr).map((part, index) => {
        if (index % 2) return part;
        const text = part.slice(0, remaining);
        remaining -= text.length;
        return text;
      }).join("");
    })
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
