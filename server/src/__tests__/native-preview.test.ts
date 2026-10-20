import { expect, it } from "bun:test";
import { NATIVE_THUMBNAIL } from "./native-preview-fixture";
import { createPreviewService } from "../surface-preview";
import { startFakeCmuxServer } from "./fake-cmux";
import { PREVIEW_SURFACE, PREVIEW_WORKSPACE, previewConfig, previewTree } from "./preview-fixtures";

const filePath = "/private/redacted/public-probe.png";
function inventory(path = filePath) {
  return { workspaces: [{ id: PREVIEW_WORKSPACE.toUpperCase(), surfaces: [{ surface_id: PREVIEW_SURFACE.toUpperCase(), kind: "filePreview", file_path: path, title: "Image", is_focused: false }] }] };
}

it("reads a native JPEG thumbnail using only its exact live descriptor and strips paths", async () => {
  const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
    server.reply(socket, request.id, request.method === "system.tree" ? previewTree("filepreview")
      : request.method === "mobile.workspace.list" ? inventory()
      : request.method === "mobile.panel.artifact.stat" ? { exists: true, is_directory: false, size: 157, modified_at: 1792522710, mime_type: "image/png", kind: "image" }
      : NATIVE_THUMBNAIL);
  } });
  const service = createPreviewService(previewConfig(fake.path));
  try {
    const result = await service.capture(PREVIEW_SURFACE);
    expect(result).toMatchObject({ kind: "image", mime: "image/jpeg", width: 96, height: 48, surfaceId: PREVIEW_SURFACE });
    expect(JSON.stringify(result)).not.toContain("/private/");
    expect(fake.requests.find((r) => r.method === "mobile.panel.artifact.thumbnail")?.params).toEqual({ workspace_id: PREVIEW_WORKSPACE, surface_id: PREVIEW_SURFACE, path: filePath, max_dimension: 1024 });
    expect(fake.requests.filter((r) => r.method === "mobile.workspace.list")).toHaveLength(2);
  } finally { service.close(); await fake.close(); }
});

it.each(["descriptor changed", "duplicate descriptor", "unsupported media", "bad JPEG", "wrong dimensions"])("rejects native capture: %s", async (mode) => {
  let inventories = 0;
  const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
    let response: unknown = NATIVE_THUMBNAIL;
    if (request.method === "system.tree") response = previewTree("filepreview");
    if (request.method === "mobile.workspace.list") {
      const value = inventory(mode === "descriptor changed" && ++inventories > 1 ? "/private/redacted/replaced.png" : filePath);
      if (mode === "duplicate descriptor") value.workspaces[0]?.surfaces.push({ ...value.workspaces[0].surfaces[0] });
      response = value;
    }
    if (request.method === "mobile.panel.artifact.stat") response = { exists: true, is_directory: false, size: 157, mime_type: mode === "unsupported media" ? "image/svg+xml" : "image/png", kind: "image" };
    if (request.method === "mobile.panel.artifact.thumbnail" && mode === "bad JPEG") response = { ...NATIVE_THUMBNAIL, data_b64: Buffer.from("<svg />").toString("base64") };
    if (request.method === "mobile.panel.artifact.thumbnail" && mode === "wrong dimensions") response = { ...NATIVE_THUMBNAIL, pixel_width: 97 };
    server.reply(socket, request.id, response);
  } });
  const service = createPreviewService(previewConfig(fake.path));
  try { await expect(service.capture(PREVIEW_SURFACE)).rejects.toThrow(mode === "unsupported media" ? "preview_unsupported" : mode.includes("descriptor") ? "surface_unavailable" : "preview_failed"); }
  finally { service.close(); await fake.close(); }
});
