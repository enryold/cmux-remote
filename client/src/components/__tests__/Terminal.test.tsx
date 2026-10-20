// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Terminal } from "../Terminal";
import { useTerminalPreferences } from "../../hooks/useTerminalPreferences";

const fake = vi.hoisted(() => ({ instances: [] as Array<{
  options: { fontSize: number; disableStdin: boolean }; writes: Array<{ text: string; done: () => void }>;
  textarea: HTMLTextAreaElement;
  selection: boolean; selectionChanged: () => void; dispose: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  resized: (size: { cols: number; rows: number }) => void;
}> }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  options; textarea = document.createElement("textarea"); writes: Array<{ text: string; done: () => void }> = []; selection = false; selectionChanged = () => {}; resized = (_size: { cols: number; rows: number }) => {};
  buffer = { active: { baseY: 0, viewportY: 0, length: 0, getLine: () => undefined } }; rows = 24;
  constructor(options: { fontSize: number; disableStdin: boolean }) { this.options = options; fake.instances.push(this); }
  loadAddon() {} open() {} onData() {} onResize(callback: (size: { cols: number; rows: number }) => void) { this.resized = callback; } onScroll() {} reset() {} scrollToBottom() {} scrollToLine() {}
  focus = vi.fn();
  hasSelection() { return this.selection; }
  onSelectionChange(callback: () => void) { this.selectionChanged = callback; }
  write(text: string, done: () => void) { this.writes.push({ text, done }); }
  dispose = vi.fn();
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
afterEach(() => { cleanup(); fake.instances = []; localStorage.clear(); vi.useRealTimers(); });
function Screen({ content, viewportEnabled = false, onViewport = vi.fn(), onViewportClear = vi.fn(), onKey = vi.fn() }: { content: string; viewportEnabled?: boolean; onViewport?: (columns: number, rows: number, generation: number) => void; onViewportClear?: (generation: number) => void; onKey?: (key: string) => void }) {
  return <Terminal surfaceId="original" content={content} stale={false} viewportEnabled={viewportEnabled} connected settings={useTerminalPreferences()}
    onKey={onKey} onSubmit={vi.fn()} onViewport={onViewport} onViewportClear={onViewportClear} />;
}
it("keeps terminal output read-only so all drafting stays in the local composer", () => {
  render(<Screen content="ready" />);
  expect(fake.instances[0]?.options.disableStdin).toBe(true);
  expect(fake.instances[0]?.textarea.readOnly).toBe(true);
  expect(fake.instances[0]?.textarea.inputMode).toBe("none");
});
it("sends shortcut keys without focusing the terminal's hidden input", () => {
  const onKey = vi.fn();
  render(<Screen content="menu choices" onKey={onKey} />);
  fireEvent.click(screen.getByRole("button", { name: "↓" }));
  expect(onKey).toHaveBeenCalledExactlyOnceWith("down");
  expect(fake.instances[0]?.focus).not.toHaveBeenCalled();
});
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
  expect(terminal.options.fontSize).toBe(13);
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

it("clears the prior Mac viewport when fitted dimensions fall outside the RPC bounds", () => {
  vi.useFakeTimers();
  const report = vi.fn(); const clear = vi.fn();
  render(<Screen content="" viewportEnabled onViewport={report} onViewportClear={clear} />);
  const terminal = fake.instances[0]; if (!terminal) throw new Error("missing terminal");
  act(() => { terminal.resized({ cols: 80, rows: 24 }); vi.advanceTimersByTime(100); });
  expect(report).toHaveBeenLastCalledWith(80, 24, 1);
  act(() => { terminal.resized({ cols: 10, rows: 4 }); vi.advanceTimersByTime(100); });
  expect(report).toHaveBeenCalledTimes(1);
  expect(clear).toHaveBeenLastCalledWith(2);
  act(() => { terminal.resized({ cols: 300, rows: 120 }); vi.advanceTimersByTime(100); });
  expect(report).toHaveBeenLastCalledWith(300, 120, 3);
  act(() => { terminal.resized({ cols: 301, rows: 121 }); vi.advanceTimersByTime(100); });
  expect(report).toHaveBeenCalledTimes(2);
  expect(clear).toHaveBeenLastCalledWith(4);
});
