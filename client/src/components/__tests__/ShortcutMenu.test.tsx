// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TerminalToolbar } from "../TerminalToolbar";
import { useTerminalPreferences } from "../../hooks/useTerminalPreferences";

afterEach(() => { cleanup(); localStorage.clear(); });
it("edits commands and favorites without sending terminal input", () => {
  const onKey = vi.fn(); const onSubmit = vi.fn();
  function Toolbar() { return <TerminalToolbar connected settings={useTerminalPreferences()} onKey={onKey} onSubmit={onSubmit} />; }
  render(<Toolbar />);
  const opener = screen.getByRole("button", { name: "Shortcuts" });
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "Shortcuts" });
  fireEvent.change(within(dialog).getByLabelText("Shortcut name"), { target: { value: "Launch" } });
  fireEvent.change(within(dialog).getByLabelText("Command"), { target: { value: "codex-dsp" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save command" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Pin Launch" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Edit Launch" }));
  fireEvent.change(within(dialog).getByLabelText("Command"), { target: { value: "claude-dsp" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save command" }));
  expect(within(dialog).getByText("claude-dsp")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Unpin Esc" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Close shortcuts" }));
  expect(screen.queryByRole("button", { name: "Esc" })).toBeNull();
  expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy();
  expect(document.activeElement).toBe(opener);
  expect(onKey).not.toHaveBeenCalled(); expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "Delete Launch" }));
  fireEvent.click(screen.getByRole("button", { name: "Close shortcuts" }));
  expect(screen.queryByRole("button", { name: "Launch" })).toBeNull();
});
it("allows configuration offline but prevents invocation", () => {
  function Toolbar() { return <TerminalToolbar connected={false} settings={useTerminalPreferences()} onKey={vi.fn()} onSubmit={vi.fn()} />; }
  render(<Toolbar />);
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
  const dialog = screen.getByRole("dialog");
  expect((within(dialog).getByRole("button", { name: "Shift+←" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Shortcut name"), { target: { value: "Bad" } });
  fireEvent.change(screen.getByLabelText("Command"), { target: { value: "💡".repeat(1025) } });
  fireEvent.click(screen.getByRole("button", { name: "Save command" }));
  expect(screen.getByRole("alert").textContent).toContain("4096");
  expect(screen.getByRole("dialog")).toBeTruthy();
});
