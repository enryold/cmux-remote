export function terminalGridFixture(surfaceId: string) {
  const base = { foreground: "#ffffff", background: "#10131a", foreground_source: "default", background_source: "default", bold: false, faint: false, italic: false, underline: false, blink: false, inverse: false, invisible: false, strikethrough: false, overline: false };
  return {
    workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", surface_id: surfaceId, seq: 10, columns: 40, rows: 4,
    render_grid: {
      format: "cmux.render-grid.v1", surface_id: surfaceId, state_seq: 10, full: true, anchor: "screen",
      columns: 40, rows: 4, scrollback_rows: 1, history_rows: 1, active_screen: "primary",
      render_epoch: "fixture", render_revision: 1, row_space_revision: 1, modes: [], cleared_rows: [], scrolled_rows: 0,
      cursor: { row: 3, column: 0, visible: true }, terminal_foreground: "#ffffff", terminal_background: "#10131a",
      styles: [
        { ...base, id: 0 },
        { ...base, id: 1, foreground: "#ff7777", background: "#51251f", foreground_source: "rgb", background_source: "rgb", bold: true },
        { ...base, id: 2, foreground: "#a4df8d", background: "#1f3b29", foreground_source: "rgb", background_source: "rgb" },
        { ...base, id: 3, foreground: "#8db3ff", foreground_source: "rgb", italic: true },
      ],
      scrollback_spans: [{ row: 0, column: 0, cell_width: 15, style_id: 3, text: "previous output" }],
      row_spans: [
        { row: 0, column: 0, cell_width: 40, style_id: 1, text: "- removed line".padEnd(40) },
        { row: 1, column: 0, cell_width: 40, style_id: 2, text: "+ added line".padEnd(40) },
        { row: 2, column: 0, cell_width: 9, style_id: 0, text: "日本語 👋" },
      ],
    },
  };
}

export function paddedTerminalGridFixture(surfaceId: string) {
  const frame = terminalGridFixture(surfaceId);
  frame.columns = frame.render_grid.columns = 181;
  frame.rows = frame.render_grid.rows = 6;
  frame.render_grid.row_spans = [
    { row: 0, column: 0, cell_width: 24, style_id: 2, text: "+ added output 日本語 👋" },
    { row: 1, column: 0, cell_width: 181, style_id: 1, text: " ".repeat(181) },
    { row: 2, column: 0, cell_width: 2, style_id: 1, text: "› " },
    { row: 2, column: 2, cell_width: 29, style_id: 3, text: "Write a prompt".padEnd(29) },
    { row: 2, column: 31, cell_width: 150, style_id: 1, text: " ".repeat(150) },
    { row: 3, column: 0, cell_width: 181, style_id: 1, text: " ".repeat(181) },
    { row: 4, column: 0, cell_width: 5, style_id: 0, text: "Ready" },
    { row: 5, column: 2, cell_width: 28, style_id: 0, text: "1. Continue    2. Cancel".padEnd(28) },
  ];
  return frame;
}

export function ruledTerminalGridFixture(surfaceId: string) {
  const frame = paddedTerminalGridFixture(surfaceId);
  frame.render_grid.row_spans = frame.render_grid.row_spans.map((span) => span.row === 1 || span.row === 3
    ? { ...span, style_id: 3, text: "─".repeat(181) } : span);
  return frame;
}
