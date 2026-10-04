// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SurfacePreview } from "../SurfacePreview";
import { imagePreview } from "../../test/preview-fixture";
afterEach(cleanup);
it("zooms only locally and labels stale captures", () => {
  const refresh = vi.fn();
  render(<SurfacePreview preview={imagePreview} status="stale" refresh={refresh} />);
  expect(screen.getByRole("img", { name: "Surface capture" })).toBeTruthy();
  expect(screen.getByText(/Capture may be stale/)).toBeTruthy();
  for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByText("300%", { exact: true })).toBeTruthy();
  for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(screen.getByText("25%", { exact: true })).toBeTruthy();
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(refresh).toHaveBeenCalledOnce();
});
