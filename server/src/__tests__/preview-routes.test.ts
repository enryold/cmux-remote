import { expect, it, mock } from "bun:test";
import { createPairedSessionValue, SESSION_COOKIE } from "../auth";
import { createPreviewRoutes } from "../preview-routes";
import { PREVIEW_SURFACE, previewConfig } from "./preview-fixtures";
import { TAILSCALE_CAPABILITIES_HEADER } from "../tailscale";

it("protects every preview and rejects client paths, RPC names, and bodies before capture", async () => {
  const config = { ...previewConfig(), tailscaleCapability: "example.com/cap/cmux-remote" };
  const session = createPairedSessionValue(config.remoteToken, Math.floor(Date.now() / 1000) + 60, config.tailscaleCapability);
  const headers = { origin: config.publicOrigin, cookie: `${SESSION_COOKIE}=${session}`, [TAILSCALE_CAPABILITIES_HEADER]: JSON.stringify({ [config.tailscaleCapability]: [{ access: true }] }) };
  const capture = mock(async () => ({ kind: "image" as const, surfaceId: PREVIEW_SURFACE, capturedAt: new Date().toISOString(), mime: "image/png" as const, width: 1, height: 1, base64: "test" }));
  const app = createPreviewRoutes(config, { capture, close() {} });
  const route = `/api/surfaces/${PREVIEW_SURFACE}/preview`;
  for (const rejected of [
    { headers: {} }, { headers: { ...headers, origin: "https://evil.example" } },
    { headers: { ...headers, cookie: "" } }, { headers: { ...headers, [TAILSCALE_CAPABILITIES_HEADER]: "{}" } },
  ]) {
    const response = await app.request(route, { method: "POST", ...rejected });
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
  }
  for (const path of ["surface:1", "..%2Fprivate%2Ffile", "not-a-uuid"]) expect((await app.request(`/api/surfaces/${path}/preview`, { method: "POST", headers })).status).toBe(404);
  for (const body of ["{}", " ", JSON.stringify({ path: "/private/file", method: "browser.eval" })]) expect((await app.request(route, { method: "POST", headers, body })).status).toBe(422);
  const extra = await app.request(`${route}?path=/private/file`, { method: "POST", headers }); expect(extra.status).toBe(422);
  expect(capture).not.toHaveBeenCalled();
  const success = await app.request(route, { method: "POST", headers });
  expect(success.status).toBe(200); expect(capture).toHaveBeenCalledWith(PREVIEW_SURFACE);
  expect(success.headers.get("x-content-type-options")).toBe("nosniff");
});
