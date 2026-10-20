const MAX_BYTES = 2 * 1024 * 1024;
const attributes = [["bold", 1], ["faint", 2], ["italic", 3], ["underline", 4], ["blink", 5], ["inverse", 7], ["invisible", 8], ["strikethrough", 9], ["overline", 53]] as const;
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

// Only full snapshots and generated SGR enter xterm; upstream VT/OSC and modes never do.
export function coloredTerminalText(value: unknown, surfaceId: string, lines: number): string | null {
  const result = record(value);
  const grid = record(result?.render_grid);
  if (!grid || typeof result?.surface_id !== "string" || result.surface_id.toLowerCase() !== surfaceId
    || typeof grid.surface_id !== "string" || grid.surface_id.toLowerCase() !== surfaceId
    || grid.format !== "cmux.render-grid.v1" || grid.full !== true || grid.anchor !== "screen"
    || !integer(grid.columns, 1, 1000) || !integer(grid.rows, 1, 500) || !integer(grid.scrollback_rows, 0, 2000)
    || !integer(lines, 1, 2000) || !Array.isArray(grid.styles) || grid.styles.length > 4096
    || !Array.isArray(grid.row_spans) || !Array.isArray(grid.scrollback_spans)
    || grid.row_spans.length + grid.scrollback_spans.length > 65536) return null;
  const styles = new Map<number, string>();
  for (const raw of grid.styles) {
    const style = record(raw);
    if (!style || !integer(style.id, 0, 65535) || styles.has(style.id)) return null;
    const codes = [0];
    for (const [attribute, code] of attributes) {
      if (style[attribute] !== undefined && typeof style[attribute] !== "boolean") return null;
      if (style[attribute] === true) codes.push(code);
    }
    for (const [color, code] of [["foreground", 38], ["background", 48]] as const) {
      const hex = style[color];
      if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
      if (style[`${color}_source`] !== "default") codes.push(code, 2, ...[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)));
    }
    styles.set(style.id, `\u001b[${codes.join(";")}m`);
  }
  const rows: Array<Array<{ column: number; width: number; text: string; style: string }>> = Array.from({ length: grid.scrollback_rows + grid.rows }, () => []);
  let inputBytes = 0;
  for (const [spans, count, offset] of [[grid.scrollback_spans, grid.scrollback_rows, 0], [grid.row_spans, grid.rows, grid.scrollback_rows]] as const) {
    for (const raw of spans) {
      const span = record(raw);
      if (!span || !integer(span.row, 0, count - 1) || !integer(span.column, 0, grid.columns - 1)
        || !integer(span.cell_width, 1, grid.columns - span.column) || !integer(span.style_id, 0, 65535)
        || typeof span.text !== "string" || Buffer.byteLength(span.text) > 16384
        || Array.from(span.text).some((character) => { const code = character.charCodeAt(0); return code < 32 || (code >= 127 && code <= 159); })) return null;
      const style = styles.get(span.style_id);
      if (!style) return null;
      inputBytes += Buffer.byteLength(span.text);
      if (inputBytes > MAX_BYTES) return null;
      rows[span.row + offset]?.push({ column: span.column, width: span.cell_width, text: span.text, style });
    }
  }
  const output: string[] = [];
  let bytes = rows.length;
  for (const spans of rows.slice(-lines)) {
    let column = 0;
    let line = "";
    spans.sort((a, b) => a.column - b.column);
    const lastText = spans.findLastIndex((span) => span.text.trimEnd() !== "");
    for (const [index, span] of spans.entries()) {
      if (span.column < column) return null;
      const gap = span.column - column;
      column = span.column + span.width;
      if (index > lastText) continue;
      // Desktop fill cells must not wrap into extra mobile rows after SGR is added.
      const content = index === lastText ? span.text.trimEnd() : span.text;
      const text = `${" ".repeat(gap)}${span.style}${content}\u001b[0m`;
      bytes += Buffer.byteLength(text);
      if (bytes > MAX_BYTES) return null;
      line += text;
    }
    output.push(line);
  }
  while (output.at(-1) === "") output.pop();
  return output.join("\n");
}
