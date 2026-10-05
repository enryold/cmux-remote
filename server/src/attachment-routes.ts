import { homedir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { isAllowedOrigin, isAuthorized } from "./auth";
import { CmuxClient, CmuxRequestError } from "./cmux-client";
import type { RuntimeConfig } from "./config";
import { isPreviewSurfaceId, PreviewError, resolvePreviewSurface } from "./surface-preview";

export const ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_CHUNK_BYTES = 256 * 1024;
const statuses = { unauthorized: 401, surface_unavailable: 404, upload_invalid: 422,
  upload_unsupported: 422, upload_too_large: 413, upload_busy: 429, upload_timeout: 504, upload_failed: 502 } as const;
type UploadCode = keyof typeof statuses;
class UploadError extends Error {
  constructor(readonly code: UploadCode) { super(code); }
}
function fail(code: UploadCode): never { throw new UploadError(code); }

export function createAttachmentRoutes(config: RuntimeConfig, options: { deadlineMs?: number } = {}) {
  const app = new Hono();
  // ponytail: one upload bounds memory; add parallel slots only if transfers contend.
  let busy = false;
  let closed = false;
  let cancelActive: ((code: UploadCode) => void) | null = null;
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    if (!isAllowedOrigin(c.req.raw, config) || !isAuthorized(c.req.raw, config)) return c.json({ error: { code: "unauthorized" } }, 401);
    await next();
  });
  app.post("/api/surfaces/:surfaceId/attachments", async (c) => {
    const error = (code: UploadCode) => c.json({ error: { code } }, statuses[code]);
    const surfaceId = c.req.param("surfaceId").toLowerCase();
    if (!isPreviewSurfaceId(surfaceId)) return error("surface_unavailable");
    if (new URL(c.req.url).search || c.req.header("content-type") !== "application/octet-stream") return error("upload_invalid");
    let fileName: string;
    try {
      const raw = decodeURIComponent(c.req.header("x-file-name") ?? "");
      if (!raw || Buffer.byteLength(raw) > 180 || /[/\\\p{C}]/u.test(raw)) return error("upload_invalid");
      fileName = raw.trim().replace(/^\.+/, "").trim() || "attachment";
    } catch { return error("upload_invalid"); }
    const declared = c.req.header("content-length");
    if (declared !== undefined && !/^\d+$/.test(declared)) return error("upload_invalid");
    if (Number(declared) > ATTACHMENT_BYTES) return error("upload_too_large");
    if (closed) return error("upload_failed");
    if (busy) return error("upload_busy");
    busy = true;
    const client = new CmuxClient({ socketPath: config.socketPath, socketPassword: config.socketPassword, maxPending: 1 });
    let cancelled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => { if (cancelled || closed) fail("upload_failed"); };
    const request = async (method: "system.tree" | "mobile.task.attachment.upload", params: Record<string, unknown>) => {
      current();
      const result = await client.request(method, params);
      current();
      return result;
    };
    const cancellation = new Promise<never>((_, reject) => {
      cancelActive = (code) => {
        cancelled = true;
        void reader?.cancel().catch(() => undefined);
        client.disconnect();
        reject(new UploadError(code));
      };
      timer = setTimeout(() => cancelActive?.("upload_timeout"), options.deadlineMs ?? 120_000);
    });
    const abort = () => cancelActive?.("upload_failed");
    c.req.raw.signal.addEventListener("abort", abort, { once: true });
    if (c.req.raw.signal.aborted) abort();
    try {
      const upload = async () => {
        const target = resolvePreviewSurface(await request("system.tree", { all: true }), surfaceId);
        if (target.type !== "terminal") fail("surface_unavailable");
        reader = c.req.raw.body?.getReader();
        const bytes = Buffer.alloc(ATTACHMENT_BYTES);
        let size = 0;
        while (reader) {
          current();
          const { done, value } = await reader.read();
          if (done) break;
          if (size + value.byteLength > ATTACHMENT_BYTES) fail("upload_too_large");
          bytes.set(value, size);
          size += value.byteLength;
        }
        current();
        if (declared !== undefined && Number(declared) !== size) fail("upload_invalid");
        const operationId = crypto.randomUUID();
        const uploadId = crypto.randomUUID();
        const path = join(homedir(), ".cache/cmux/task-attachments", operationId, fileName);
        let offset = 0;
        do {
          const chunk = bytes.subarray(offset, Math.min(size, offset + ATTACHMENT_CHUNK_BYTES));
          const last = offset + chunk.length === size;
          const raw = await request("mobile.task.attachment.upload", {
            operation_id: operationId, upload_id: uploadId, file_name: fileName,
            total_bytes: size, offset, data_b64: chunk.toString("base64"), last,
          });
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("upload_failed");
          const result = raw as Record<string, unknown>;
          if (result.received_bytes !== offset + chunk.length || (last ? result.path !== path : result.path !== undefined)) fail("upload_failed");
          offset += chunk.length;
        } while (offset < size);
        const now = resolvePreviewSurface(await request("system.tree", { all: true }), surfaceId);
        if (now.type !== "terminal" || now.workspaceId !== target.workspaceId) fail("surface_unavailable");
        return { surfaceId, path };
      };
      return c.json(await Promise.race([cancellation, upload()]));
    } catch (failure) {
      if (failure instanceof UploadError) return error(failure.code);
      if (failure instanceof PreviewError && failure.code === "surface_unavailable") return error("surface_unavailable");
      if (failure instanceof CmuxRequestError) {
        if (failure.code === "cmux_timeout") return error("upload_timeout");
        if (["method_not_found", "not_supported", "unsupported_method"].includes(failure.code)) return error("upload_unsupported");
      }
      return error("upload_failed");
    } finally {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      c.req.raw.signal.removeEventListener("abort", abort);
      void reader?.cancel().catch(() => undefined);
      client.disconnect();
      cancelActive = null;
      busy = false;
    }
  });
  return { routes: app, close() { closed = true; cancelActive?.("upload_failed"); } };
}
