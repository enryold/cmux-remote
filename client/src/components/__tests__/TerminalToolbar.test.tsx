// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TerminalToolbar } from "../TerminalToolbar";
import { useTerminalPreferences } from "../../hooks/useTerminalPreferences";

afterEach(() => { cleanup(); localStorage.clear(); });
function Toolbar(props: Pick<Parameters<typeof TerminalToolbar>[0], "onKey" | "onSubmit">) {
  return <TerminalToolbar {...props} connected settings={useTerminalPreferences()} />;
}

it("maps every named key to the exact cmux key", () => {
  const onKey = vi.fn();
  render(<Toolbar onKey={onKey} onSubmit={vi.fn()} />);

  for (const name of ["Esc", "Tab", "←", "→", "↑", "↓", "Shift+←", "Enter"]) {
    fireEvent.click(screen.getByRole("button", { name }));
  }
  expect(onKey.mock.calls.map(([key]) => key)).toEqual([
    "escape",
    "tab",
    "left",
    "right",
    "up",
    "down",
    "shift+left",
    "enter",
  ]);
});

it("offers Ctrl-C and Ctrl-D through the shortcuts catalogue", () => {
  render(<Toolbar onKey={vi.fn()} onSubmit={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Ctrl" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Ctrl-C" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Ctrl-D" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
  expect(screen.getByRole("dialog", { name: "Shortcuts" })).toBeTruthy();
  expect(screen.getByText("Interrupt the current process")).toBeTruthy();
  expect(screen.getByText("End input; may close a shell")).toBeTruthy();
});

it("submits a visible prompt and clears it only after accepted", async () => {
  const onSubmit = vi
    .fn()
    .mockResolvedValueOnce("text_unconfirmed")
    .mockResolvedValueOnce("accepted");
  render(<Toolbar onKey={vi.fn()} onSubmit={onSubmit} />);

  const input = screen.getByRole("textbox", { name: "Prompt or command" });
  expect(input.getAttribute("enterkeyhint")).toBe("send");
  fireEvent.change(input, { target: { value: "continue the task" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);

  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("continue the task"));
  expect((input as HTMLInputElement).value).toBe("continue the task");

  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
});

it("sends empty Return once and keeps composing Return local", async () => {
  const onSubmit = vi.fn().mockResolvedValue("accepted");
  render(<Toolbar onKey={vi.fn()} onSubmit={onSubmit} />);
  const input = screen.getByRole("textbox", { name: "Prompt or command" });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit).toHaveBeenCalledWith("");
});
