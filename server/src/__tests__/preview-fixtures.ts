// Synthetic complete response shape verified via browser.screenshot on cmux 0.64.25 (106).
// The CLI screenshot command consumes png_base64 locally; the raw socket RPC includes it.
export const PREVIEW_WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PREVIEW_SURFACE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const PREVIEW_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
export function browserPreviewFixture() {
  return {
    workspace_id: PREVIEW_WORKSPACE.toUpperCase(), workspace_ref: "workspace:1",
    surface_id: PREVIEW_SURFACE.toUpperCase(), surface_ref: "surface:2",
    png_base64: PREVIEW_PNG, path: "/private/redacted/capture.png", url: "file:///private/redacted/capture.png",
  };
}
export function previewConfig(socketPath = "/tmp/nonexistent-preview.sock") {
  return { hostname: "127.0.0.1", port: 0, remoteToken: "a".repeat(32), publicOrigin: "https://mac.example", tailscaleCapability: null, pairingCode: null, socketPath, socketPassword: null };
}
export const NATIVE_PREVIEW_FAILURE = {
  ok: false, error: { code: "internal_error", message: "v2 worker method 'mobile.panel.artifact.stat' has no worker handler" },
};
export function previewTree(type = "browser", workspaceId = PREVIEW_WORKSPACE) {
  return { windows: [{ workspaces: [{ id: workspaceId, title: "Disposable", index: 0, selected: true,
    panes: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", index: 0, focused: true,
      surfaces: [{ id: PREVIEW_SURFACE, type, title: "Public test", index: 0, selected: true }] }] }] }] };
}
