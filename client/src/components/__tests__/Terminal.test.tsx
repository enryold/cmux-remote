// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Terminal } from "../Terminal";
import { useTerminalPreferences } from "../../hooks/useTerminalPreferences";

const fake = vi.hoisted(() => ({ instances: [] as Array<{
  options: { fontSize: number }; writes: Array<{ text: string; done: () => void }>;
  selection: boolean; selectionChanged: () => void; dispose: ReturnType<typeof vi.fn>;
}> }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  options; writes: Array<{ text: string; done: () => void }> = []; selection = false; selectionChanged = () => {};
  buffer = { active: { baseY: 0, viewportY: 0, length: 0, getLine: () => undefined } }; rows = 24;
  constructor(options: { fontSize: number }) { this.options = options; fake.instances.push(this); }
  loadAddon() {} open() {} onData() {} onResize() {} onScroll() {} reset() {} focus() {} scrollToBottom() {} scrollToLine() {}
  hasSelection() { return this.selection; }
  onSelectionChange(callback: () => void) { this.selectionChanged = callback; }
  write(text: string, done: () => void) { this.writes.push({ text, done }); }
  dispose = vi.fn();
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
afterEach(() => { cleanup(); fake.instances = []; localStorage.clear(); });
function Screen({ content }: { content: string }) {
  return <Terminal surfaceId="original" content={content} stale={false} viewportEnabled={false} connected settings={useTerminalPreferences()}
    onInput={vi.fn()} onKey={vi.fn()} onSubmit={vi.fn()} onViewport={vi.fn()} onViewportClear={vi.fn()} />;
}
it("serializes xterm writes and retains only the latest waiting snapshot", () => {
  const { rerender } = render(<Screen content="one" />);
  const terminal = fake.instances[0]; if (!terminal) throw new Error("missing terminal");
  rerender(<Screen content="two" />); rerender(<Screen content="three" />);
  expect(terminal.writes.map((item) => item.text)).toEqual(["one"]);
  act(() => terminal.writes[0]?.done());
  expect(terminal.writes.map((item) => item.text)).toEqual(["one", "three"]);
});

it("changes font without replacing the terminal or writing output again", () => {
  render(<Screen content="one" />);
  const terminal = fake.instances[0]; if (!terminal) throw new Error("missing terminal");
  act(() => terminal.writes[0]?.done());
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
  fireEvent.click(screen.getByRole("button", { name: "Increase font" }));
  expect(terminal.options.fontSize).toBe(14);
  expect(fake.instances).toHaveLength(1);
  expect(terminal.writes).toHaveLength(1);
  for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Increase font" }));
  expect(terminal.options.fontSize).toBe(24);
  for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Decrease font" }));
  expect(terminal.options.fontSize).toBe(10);
});
it("defers snapshots through touch gestures and selection", () => {
  const { rerender } = render(<Screen content="one" />);
  const terminal = fake.instances[0]; if (!terminal) throw new Error("missing terminal");
  act(() => terminal.writes[0]?.done());
  const container = screen.getByRole("region", { name: "Terminal" });
  fireEvent.touchStart(container);
  rerender(<Screen content="two" />);
  expect(terminal.writes).toHaveLength(1);
  terminal.selection = true;
  fireEvent.touchEnd(container);
  expect(terminal.writes).toHaveLength(1);
  terminal.selection = false;
  act(() => terminal.selectionChanged());
  expect(terminal.writes.map((item) => item.text)).toEqual(["one", "two"]);
});
