// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Login } from "../Login";

afterEach(cleanup);

it("submits the token once and clears it from component state", async () => {
  const onLogin = vi.fn().mockResolvedValue(undefined);
  render(
    <Login
      deviceAuthorized
      error={null}
      mode="token"
      onLogin={onLogin}
    />,
  );
  const input = screen.getByLabelText("Access token") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "private-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(onLogin).toHaveBeenCalledWith("private-token"));
  expect(input.value).toBe("");
  expect(screen.getByRole("heading", { name: "cmux Remote" })).toBeTruthy();
});

it("accepts and clears exactly six pairing digits", async () => {
  const onLogin = vi.fn().mockResolvedValue(undefined);
  render(
    <Login
      deviceAuthorized
      error={null}
      mode="pairing"
      onLogin={onLogin}
    />,
  );
  const input = screen.getByLabelText("Pairing code") as HTMLInputElement;
  expect(input.inputMode).toBe("numeric");
  expect(input.autocomplete).toBe("one-time-code");

  fireEvent.change(input, { target: { value: "12345" } });
  fireEvent.click(screen.getByRole("button", { name: "Pair" }));
  expect(onLogin).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Pair" }));
  await waitFor(() => expect(onLogin).toHaveBeenCalledWith("123456"));
  expect(input.value).toBe("");
});

it("does not render credentials for an unauthorized device", () => {
  render(
    <Login
      deviceAuthorized={false}
      error={null}
      mode="pairing"
      onLogin={vi.fn()}
    />,
  );
  expect(screen.getByText("Device not authorized")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
