import { CmuxClient, CmuxRequestError } from "./cmux-client";
import type { RuntimeConfig } from "./config";
import { sanitizeCmuxResult, type TreeSnapshot } from "./rpc";

export type SurfacePreview =
  | { kind: "image"; surfaceId: string; capturedAt: string; mime: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number; base64: string }
  | { kind: "markdown"; surfaceId: string; capturedAt: string; text: string };
export type PreviewErrorCode = "unauthorized" | "surface_unavailable" | "preview_unsupported" | "preview_too_large" | "preview_busy" | "preview_timeout" | "preview_failed";
export class PreviewError extends Error {
  constructor(readonly code: PreviewErrorCode) { super(code); }
}
export const PREVIEW_TIMEOUT_MS = 10000;
const IMAGE_BYTES = 2 * 1024 * 1024;
const JSON_BYTES = 3 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isPreviewSurfaceId(value: string): boolean { return uuid.test(value); }
function fail(code: PreviewErrorCode): never { throw new PreviewError(code); }
function nativePath(raw: unknown, target: { workspaceId: string; surfaceId: string }): string {
  const workspaces = raw && typeof raw === "object" ? (raw as { workspaces?: unknown }).workspaces : null;
  if (!Array.isArray(workspaces)) fail("preview_unsupported");
  const owners = workspaces.filter((w) => typeof w?.id === "string" && w.id.toLowerCase() === target.workspaceId);
  if (owners.length !== 1 || !Array.isArray(owners[0].surfaces)) fail("surface_unavailable");
  const surfaces = owners[0].surfaces.filter((s: Record<string, unknown>) => typeof s?.surface_id === "string" && s.surface_id.toLowerCase() === target.surfaceId);
  const descriptor = surfaces[0];
  if (surfaces.length !== 1 || descriptor?.kind !== "filePreview" || typeof descriptor.file_path !== "string"
    || !descriptor.file_path.startsWith("/") || descriptor.file_path.includes("\0") || Buffer.byteLength(descriptor.file_path) > 4096) fail("surface_unavailable");
  return descriptor.file_path;
}

function nativeThumbnail(raw: unknown, target: { surfaceId: string }, capturedAt: string): SurfacePreview {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("preview_failed");
  if (Buffer.byteLength(JSON.stringify(raw)) > JSON_BYTES) fail("preview_too_large");
  const value = raw as Record<string, unknown>;
  const base64 = value.data_b64;
  if (typeof base64 !== "string" || !Number.isInteger(value.pixel_width) || !Number.isInteger(value.pixel_height)) fail("preview_failed");
  if (base64.length > Math.ceil(IMAGE_BYTES / 3) * 4) fail("preview_too_large");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail("preview_failed");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > IMAGE_BYTES) fail("preview_too_large");
  if (bytes.toString("base64") !== base64 || bytes.length < 12 || bytes.readUInt16BE(0) !== 0xffd8
    || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) fail("preview_failed");
  let offset = 2; let width = 0; let height = 0; let scan = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) fail("preview_failed");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) fail("preview_failed");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length - 2) fail("preview_failed");
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8 || width !== 0) fail("preview_failed");
      height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5);
    }
    if (marker === 0xda) { scan = offset + length < bytes.length - 2; break; }
    offset += length;
  }
  if (!scan || width < 1 || height < 1 || width !== value.pixel_width || height !== value.pixel_height) fail("preview_failed");
  if (width > 1024 || height > 1024) fail("preview_too_large");
  return { kind: "image", surfaceId: target.surfaceId, capturedAt, mime: "image/jpeg", width, height, base64 };
}
export function resolvePreviewSurface(rawTree: unknown, surfaceId: string) {
  if (!uuid.test(surfaceId)) fail("surface_unavailable");
  const tree = sanitizeCmuxResult("system.tree", rawTree) as TreeSnapshot;
  const matches = tree.workspaces.flatMap((workspace) => workspace.panes.flatMap((pane) => pane.surfaces
    .filter((surface) => surface.id === surfaceId.toLowerCase())
    .map((surface) => ({ workspaceId: workspace.id, surfaceId: surface.id, type: surface.type }))));
  if (matches.length !== 1 || !matches[0]) fail("surface_unavailable");
  return matches[0];
}
export function sanitizeBrowserPreview(raw: unknown, target: { workspaceId: string; surfaceId: string }, capturedAt: string): SurfacePreview {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("preview_failed");
  if (Buffer.byteLength(JSON.stringify(raw)) > JSON_BYTES) fail("preview_too_large");
  const value = raw as Record<string, unknown>;
  if (typeof value.workspace_id !== "string" || value.workspace_id.toLowerCase() !== target.workspaceId
    || typeof value.surface_id !== "string" || value.surface_id.toLowerCase() !== target.surfaceId || typeof value.png_base64 !== "string") fail("preview_failed");
  const base64 = value.png_base64;
  if (base64.length > Math.ceil(IMAGE_BYTES / 3) * 4) fail("preview_too_large");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail("preview_failed");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > IMAGE_BYTES) fail("preview_too_large");
  if (bytes.toString("base64") !== base64 || bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") fail("preview_failed");
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) fail("preview_failed");
  if (width > 4096 || height > 4096 || width * height > 8388608) fail("preview_too_large");
  if (bytes[26] !== 0 || bytes[27] !== 0 || (bytes[28] !== 0 && bytes[28] !== 1)) fail("preview_failed");
  const bitDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!bitDepths[bytes[25] ?? -1]?.includes(bytes[24] ?? -1)) fail("preview_failed");
  let offset = 8; let data = false; let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + 12 + length > bytes.length) fail("preview_failed");
    if (Bun.hash.crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) fail("preview_failed");
    if (type === "IHDR" && offset !== 8) fail("preview_failed");
    if (type === "IDAT") data = true;
    offset += length + 12;
    if (type === "IEND") { if (length !== 0) fail("preview_failed"); ended = true; break; }
  }
  if (!data || !ended || offset !== bytes.length) fail("preview_failed");
  return { kind: "image", surfaceId: target.surfaceId, capturedAt, mime: "image/png", width, height, base64 };
}
export function createPreviewService(config: RuntimeConfig, options: { deadlineMs?: number } = {}) {
  const client = new CmuxClient({ socketPath: config.socketPath, socketPassword: config.socketPassword });
  let busy = false; let closed = false;
  return {
    async capture(surfaceId: string): Promise<SurfacePreview> {
      if (closed) fail("preview_failed");
      if (!uuid.test(surfaceId)) fail("surface_unavailable");
      if (busy) fail("preview_busy");
      busy = true;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const request = async (method: "system.tree" | "browser.screenshot" | "mobile.workspace.list" | "mobile.panel.artifact.stat" | "mobile.panel.artifact.thumbnail", params: Record<string, unknown>) => {
        if (cancelled || closed) fail("preview_failed");
        const result = await client.request(method, params);
        if (cancelled || closed) fail("preview_failed");
        return result;
      };
      try {
        const capture = async () => {
          const target = resolvePreviewSurface(await request("system.tree", { all: true }), surfaceId);
          if (target.type !== "browser" && target.type !== "filepreview") fail("preview_unsupported");
          const params = { workspace_id: target.workspaceId, surface_id: target.surfaceId };
          let path: string | null = null;
          let preview: SurfacePreview;
          if (target.type === "browser") {
            preview = sanitizeBrowserPreview(await request("browser.screenshot", params), target, new Date().toISOString());
          } else {
            path = nativePath(await request("mobile.workspace.list", { workspace_id: target.workspaceId }), target);
            const stat = await request("mobile.panel.artifact.stat", { ...params, path }) as Record<string, unknown>;
            if (stat?.exists !== true || stat.is_directory !== false || !["image/png", "image/jpeg", "image/webp"].includes(String(stat.mime_type))) fail("preview_unsupported");
            preview = nativeThumbnail(await request("mobile.panel.artifact.thumbnail", { ...params, path, max_dimension: 1024 }), target, new Date().toISOString());
          }
          const current = resolvePreviewSurface(await request("system.tree", { all: true }), surfaceId);
          if (current.workspaceId !== target.workspaceId || current.type !== target.type) fail("surface_unavailable");
          if (path !== null && nativePath(await request("mobile.workspace.list", { workspace_id: target.workspaceId }), target) !== path) fail("surface_unavailable");
          return preview;
        };
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { cancelled = true; reject(new PreviewError("preview_timeout")); client.disconnect(); }, options.deadlineMs ?? PREVIEW_TIMEOUT_MS);
        });
        return await Promise.race([capture(), deadline]);
      } catch (error) {
        if (error instanceof PreviewError) throw error;
        if (error instanceof CmuxRequestError && error.code === "cmux_timeout") fail("preview_timeout");
        if (error instanceof CmuxRequestError && ["method_not_found", "unsupported_media"].includes(error.code)) fail("preview_unsupported");
        if (error instanceof CmuxRequestError && ["not_found", "file_not_found", "forbidden"].includes(error.code)) fail("surface_unavailable");
        if (error instanceof Error && /frame_(?:limit|buffer_limit|queue_limit)/.test(error.message)) fail("preview_too_large");
        fail("preview_failed");
      } finally {
        cancelled = true;
        if (timer !== undefined) clearTimeout(timer);
        client.disconnect();
        busy = false;
      }
    },
    close() { closed = true; client.disconnect(); },
  };
}
