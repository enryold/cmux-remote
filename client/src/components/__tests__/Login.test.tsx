// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Login } from "../Login";

afterEach(cleanup);

it("submits the token once and clears it from component state", async () => {
  const onLogin = vi.fn().mockResolvedValue(undefined);
  render(<Login error={null} onLogin={onLogin} />);
  const input = screen.getByLabelText("Access token") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "private-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(onLogin).toHaveBeenCalledWith("private-token"));
  expect(input.value).toBe("");
  expect(screen.getByRole("heading", { name: "cmux Remote" })).toBeTruthy();
});
