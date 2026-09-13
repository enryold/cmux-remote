// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminalWorkspaces } from "../../lib/topology";
import { snapshotWithTwoWorkspaces } from "../../test/topology-fixture";
import { Dashboard } from "../Dashboard";

afterEach(cleanup);

describe("Dashboard", () => {
  it("renders dense workspace groups and opens an exact terminal ID", () => {
    const onOpen = vi.fn();
    render(
      <Dashboard
        workspaces={terminalWorkspaces(snapshotWithTwoWorkspaces)}
        onOpen={onOpen}
        connection="connected"
      />,
    );

    expect(screen.getByRole("heading", { name: "Terminals" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "EMPTY" })).toBeTruthy();
    expect(screen.getByText("No terminal surfaces")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "API Agent" }));
    expect(onOpen).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(screen.queryByRole("button", { name: "localhost" })).toBeNull();
  });
});
