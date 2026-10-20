import { expect, it } from "bun:test";
import { coloredTerminalText } from "../terminal-colors";
import { paddedTerminalGridFixture, terminalGridFixture } from "./terminal-grid-fixture";
const id = "11111111-1111-4111-8111-111111111111";
const sgr = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]+m`, "g");

it("preserves true colors, background, emphasis, history and wide Unicode with generated SGR only", () => {
  const text = coloredTerminalText(terminalGridFixture(id), id, 2000);
  expect(text).toContain("\u001b[0;3;38;2;141;179;255mprevious output\u001b[0m");
  expect(text).toContain("\u001b[0;1;38;2;255;119;119;48;2;81;37;31m- removed line");
  expect(text).toContain("\u001b[0;38;2;164;223;141;48;2;31;59;41m+ added line");
  expect(text).toContain("\u001b[0m日本語 👋\u001b[0m");
  expect(text?.replace(sgr, "")).not.toContain("\u001b");
  expect(coloredTerminalText(terminalGridFixture(id), id, 3)).not.toContain("previous output");
});

it("uses cell widths for gaps and sorts spans without splitting wide characters", () => {
  const frame = terminalGridFixture(id);
  frame.render_grid.scrollback_rows = 0; frame.render_grid.scrollback_spans = [];
  frame.render_grid.row_spans = [
    { row: 0, column: 3, cell_width: 2, style_id: 0, text: "👋" },
    { row: 0, column: 1, cell_width: 2, style_id: 0, text: "界" },
  ];
  expect(coloredTerminalText(frame, id, 2000)?.replace(sgr, "")).toBe(" 界👋");
});

it("removes desktop padding from colored rows without hiding prompts, choices or indentation", () => {
  const frame = paddedTerminalGridFixture(id);
  const text = coloredTerminalText(frame, id, 2000);
  expect(text?.replace(sgr, "")).toBe("previous output\n+ added output 日本語 👋\n\n› Write a prompt\n\nReady\n  1. Continue    2. Cancel");
  expect(text).toContain("48;2;81;37;31m› ");
  frame.render_grid.row_spans.push({ row: 1, column: 180, cell_width: 1, style_id: 1, text: " " });
  expect(coloredTerminalText(frame, id, 2000)).toBeNull();
});

it.each([
  (f: ReturnType<typeof terminalGridFixture>) => { f.surface_id = "wrong"; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.surface_id = "wrong"; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.full = false; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.anchor = "viewport"; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.format = "future"; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.columns = 1001; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.rows = 501; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.scrollback_rows = 2001; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.styles[0].foreground = "\u001b]52;c;clipboard\u0007"; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.styles.push(f.render_grid.styles[0]); },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.row_spans[0].column = -1; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.row_spans[0].cell_width = 41; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.row_spans[0].style_id = 99; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.row_spans[0].text = "\u001b[6n"; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.row_spans[0].text = "newline\n"; },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.row_spans[0].text = "x".repeat(16385); },
  (f: ReturnType<typeof terminalGridFixture>) => { f.render_grid.row_spans.push(f.render_grid.row_spans[0]); },
])("rejects mismatched, malformed, oversized, overlapping or control-bearing capture %#", (mutate) => {
  const frame = terminalGridFixture(id); mutate(frame);
  expect(coloredTerminalText(frame, id, 2000)).toBeNull();
});
