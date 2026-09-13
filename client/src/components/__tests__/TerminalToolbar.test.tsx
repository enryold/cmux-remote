// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TerminalToolbar } from "../TerminalToolbar";

afterEach(cleanup);

it("maps every named key to the exact cmux key", () => {
  const onKey = vi.fn();
  render(<TerminalToolbar onKey={onKey} />);

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
    <TerminalToolbar ctrlActive={false} onCtrl={onCtrl} onKey={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Ctrl" }));
  expect(onCtrl).toHaveBeenCalledOnce();

  rerender(
    <TerminalToolbar ctrlActive onCtrl={onCtrl} onKey={vi.fn()} />,
  );
  expect(screen.getByRole("button", { name: "Ctrl" }).getAttribute("aria-pressed"))
    .toBe("true");
});
