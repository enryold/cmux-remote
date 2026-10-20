import { expect, it } from "bun:test";
import { parseAllowedRequest, toCmuxCall } from "../rpc";
import { PREVIEW_SURFACE, PREVIEW_WORKSPACE } from "./preview-fixtures";

const pane = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const parse = (method: string, params: Record<string, unknown>) => parseAllowedRequest(JSON.stringify({ id: "action", method, params }));
it("allows only exact terminal creation and explicitly confirmed closing", () => {
  expect(toCmuxCall(parse("surface.create", { workspace_id: PREVIEW_WORKSPACE, pane_id: pane }), "client")).toEqual({
    method: "surface.create", params: { workspace_id: PREVIEW_WORKSPACE, pane_id: pane, type: "terminal", focus: false },
  });
  expect(toCmuxCall(parse("surface.close", { workspace_id: PREVIEW_WORKSPACE, surface_id: PREVIEW_SURFACE, confirmed: true }), "client")).toEqual({
    method: "surface.close", params: { workspace_id: PREVIEW_WORKSPACE, surface_id: PREVIEW_SURFACE, force: true },
  });
});
it("rejects implicit targets, commands, URLs, arbitrary types and unconfirmed force", () => {
  for (const params of [{}, { workspace_id: PREVIEW_WORKSPACE }, { workspace_id: PREVIEW_WORKSPACE, pane_id: "pane:1" },
    { workspace_id: PREVIEW_WORKSPACE, pane_id: pane, initial_command: "touch /tmp/no" },
    { workspace_id: PREVIEW_WORKSPACE, pane_id: pane, type: "browser" },
    { workspace_id: PREVIEW_WORKSPACE, pane_id: pane, url: "https://example.com" }]) expect(() => parse("surface.create", params)).toThrow();
  for (const params of [{ workspace_id: PREVIEW_WORKSPACE, surface_id: PREVIEW_SURFACE },
    { workspace_id: PREVIEW_WORKSPACE, surface_id: PREVIEW_SURFACE, confirmed: false },
    { workspace_id: PREVIEW_WORKSPACE, surface_id: PREVIEW_SURFACE, confirmed: true, force: true }]) expect(() => parse("surface.close", params)).toThrow();
});
