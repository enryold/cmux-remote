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

afterEach(cleanup);

it("maps every named key to the exact cmux key", () => {
  const onKey = vi.fn();
  render(<TerminalToolbar onKey={onKey} onSubmit={vi.fn()} />);

  for (const name of ["Esc", "Tab", "Ctrl-C", "Ctrl-D", "Up", "Down", "Enter"]) {
    fireEvent.click(screen.getByRole("button", { name }));
  }
  expect(onKey.mock.calls.map(([key]) => key)).toEqual([
    "escape",
    "tab",
    "ctrl+c",
    "ctrl+d",
    "up",
    "down",
    "enter",
  ]);
});

it("exposes the generic Ctrl key as a one-shot toggle", () => {
  const onCtrl = vi.fn();
  const { rerender } = render(
    <TerminalToolbar
      ctrlActive={false}
      onCtrl={onCtrl}
      onKey={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Ctrl" }));
  expect(onCtrl).toHaveBeenCalledOnce();

  rerender(
    <TerminalToolbar
      ctrlActive
      onCtrl={onCtrl}
      onKey={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Ctrl" }).getAttribute("aria-pressed"))
    .toBe("true");
});

it("submits a visible prompt and clears it only after accepted", async () => {
  const onSubmit = vi
    .fn()
    .mockResolvedValueOnce("text_unconfirmed")
    .mockResolvedValueOnce("accepted");
  render(<TerminalToolbar onKey={vi.fn()} onSubmit={onSubmit} />);

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
  render(<TerminalToolbar onKey={vi.fn()} onSubmit={onSubmit} />);
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
