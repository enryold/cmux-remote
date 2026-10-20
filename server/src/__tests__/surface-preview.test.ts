import { describe, expect, it } from "bun:test";
import { CmuxClient } from "../cmux-client";
import { createPreviewService, PREVIEW_TIMEOUT_MS, resolvePreviewSurface, sanitizeBrowserPreview } from "../surface-preview";
import { eventually, startFakeCmuxServer } from "./fake-cmux";
import { browserPreviewFixture, PREVIEW_SURFACE, PREVIEW_WORKSPACE, previewTree, previewConfig } from "./preview-fixtures";

const target = { workspaceId: PREVIEW_WORKSPACE, surfaceId: PREVIEW_SURFACE };
const capturedAt = "2026-10-04T12:00:00.000Z";
describe("preview validation", () => {
  it("resolves only an exact live UUID and strips screenshot private fields", () => {
    expect(resolvePreviewSurface(previewTree(), PREVIEW_SURFACE)).toEqual({ ...target, type: "browser" });
    expect(() => resolvePreviewSurface(previewTree(), "surface:1")).toThrow("surface_unavailable");
    expect(() => resolvePreviewSurface({ windows: [] }, PREVIEW_SURFACE)).toThrow("surface_unavailable");
    const preview = sanitizeBrowserPreview(browserPreviewFixture(), target, capturedAt);
    expect(preview).toMatchObject({ kind: "image", surfaceId: PREVIEW_SURFACE, capturedAt, mime: "image/png", width: 1, height: 1 });
    expect(JSON.stringify(preview)).not.toContain("/private/");
    expect(Object.keys(preview).sort()).toEqual(["base64", "capturedAt", "height", "kind", "mime", "surfaceId", "width"]);
  });
  it("rejects malformed bytes, wrong identities and all size budgets", () => {
    const valid = browserPreviewFixture();
    for (const invalid of [{ ...valid, surface_id: PREVIEW_WORKSPACE }, { ...valid, workspace_id: PREVIEW_SURFACE }, { ...valid, png_base64: "not-base64" }, { ...valid, png_base64: Buffer.from("<svg />").toString("base64") }, { ...valid, png_base64: valid.png_base64.slice(0, 20) }]) expect(() => sanitizeBrowserPreview(invalid, target, capturedAt)).toThrow("preview_failed");
    expect(() => sanitizeBrowserPreview({ ...valid, png_base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64") }, target, capturedAt)).toThrow("preview_too_large");
    expect(() => sanitizeBrowserPreview({ ...valid, path: "x".repeat(3 * 1024 * 1024) }, target, capturedAt)).toThrow("preview_too_large");
    for (const [width, height] of [[4097, 1], [4096, 4096]]) {
      const png = Buffer.from(valid.png_base64, "base64"); png.writeUInt32BE(width as number, 16); png.writeUInt32BE(height as number, 20);
      expect(() => sanitizeBrowserPreview({ ...valid, png_base64: png.toString("base64") }, target, capturedAt)).toThrow("preview_too_large");
    }
  });
  it("rejects a PNG whose pixel chunk was corrupted", () => {
    const raw = browserPreviewFixture();
    const bytes = Buffer.from(raw.png_base64, "base64"); bytes[45] = (bytes[45] ?? 0) ^ 1;
    expect(() => sanitizeBrowserPreview({ ...raw, png_base64: bytes.toString("base64") }, target, capturedAt)).toThrow("preview_failed");
  });
});
describe("preview capture", () => {
  it("authenticates, targets explicit IDs and rechecks ownership after capture", async () => {
    const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
      server.reply(socket, request.id, request.method === "auth.login" ? { authenticated: true } : request.method === "system.tree" ? previewTree() : browserPreviewFixture());
    } });
    const service = createPreviewService({ ...previewConfig(fake.path), socketPassword: "test-socket-password" });
    try {
      await expect(service.capture(PREVIEW_SURFACE)).resolves.toMatchObject({ surfaceId: PREVIEW_SURFACE });
      expect(fake.requests.map((item) => item.method)).toEqual(["auth.login", "system.tree", "browser.screenshot", "system.tree"]);
      expect(fake.requests[2]?.params).toEqual({ workspace_id: PREVIEW_WORKSPACE, surface_id: PREVIEW_SURFACE });
    } finally { service.close(); await fake.close(); }
  });
  it.each(["terminal", "markdown", "unknown"])("rejects %s without a capture", async (type) => {
    const fake = await startFakeCmuxServer({ onRequest(request, socket, server) { server.reply(socket, request.id, previewTree(type)); } });
    const service = createPreviewService(previewConfig(fake.path));
    try { await expect(service.capture(PREVIEW_SURFACE)).rejects.toThrow("preview_unsupported"); expect(fake.requests.map((item) => item.method)).toEqual(["system.tree"]); }
    finally { service.close(); await fake.close(); }
  });
  it("discards a moved surface and normalizes path-bearing failures", async () => {
    let trees = 0; let fail = false;
    const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
      if (fail) { server.fail(socket, request.id, "internal_error", "Error /private/secret.png"); return; }
      server.reply(socket, request.id, request.method === "system.tree" ? previewTree("browser", ++trees === 1 ? PREVIEW_WORKSPACE : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") : browserPreviewFixture());
    } });
    const service = createPreviewService(previewConfig(fake.path));
    try {
      await expect(service.capture(PREVIEW_SURFACE)).rejects.toThrow("surface_unavailable"); fail = true;
      await expect(service.capture(PREVIEW_SURFACE)).rejects.toThrow(/^preview_failed$/);
    } finally { service.close(); await fake.close(); }
  });
  it("bounds concurrency, expires a capture, and leaves terminal RPCs usable", async () => {
    expect(PREVIEW_TIMEOUT_MS).toBe(10000);
    let hold = true;
    const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
      if (request.method === "browser.screenshot" && hold) return;
      server.reply(socket, request.id, request.method === "system.tree" ? previewTree() : request.method === "browser.screenshot" ? browserPreviewFixture() : { accepted: true });
    } });
    const service = createPreviewService(previewConfig(fake.path), { deadlineMs: 80 });
    const terminal = new CmuxClient({ socketPath: fake.path });
    try {
      const capture = service.capture(PREVIEW_SURFACE).then(() => "unexpected_success", (error) => error.message);
      await eventually(() => expect(fake.requests.some((item) => item.method === "browser.screenshot")).toBe(true));
      await expect(service.capture(PREVIEW_SURFACE)).rejects.toThrow("preview_busy");
      await expect(terminal.request("surface.send_key", { surface_id: "11111111-1111-4111-8111-111111111111", key: "enter" })).resolves.toEqual({ accepted: true });
      expect(await capture).toBe("preview_timeout"); hold = false;
      await expect(service.capture(PREVIEW_SURFACE)).resolves.toMatchObject({ kind: "image" });
      service.close(); await expect(service.capture(PREVIEW_SURFACE)).rejects.toThrow("preview_failed");
    } finally { service.close(); terminal.disconnect(); await fake.close(); }
  });
});
