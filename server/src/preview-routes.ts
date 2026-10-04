import { Hono } from "hono";
import { isAllowedOrigin, isAuthorized } from "./auth";
import type { RuntimeConfig } from "./config";
import { type createPreviewService, isPreviewSurfaceId, PreviewError, type PreviewErrorCode } from "./surface-preview";

const statuses = { unauthorized: 401, surface_unavailable: 404, preview_unsupported: 422, preview_too_large: 413, preview_busy: 429, preview_timeout: 504, preview_failed: 502 } as const;
export function createPreviewRoutes(config: RuntimeConfig, service: ReturnType<typeof createPreviewService>): Hono {
  const app = new Hono();
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store"); c.header("X-Content-Type-Options", "nosniff");
    if (!isAllowedOrigin(c.req.raw, config) || !isAuthorized(c.req.raw, config)) return c.json({ error: { code: "unauthorized" } }, 401);
    await next();
  });
  app.post("/api/surfaces/:surfaceId/preview", async (c) => {
    const surfaceId = c.req.param("surfaceId");
    const error = (code: PreviewErrorCode) => c.json({ error: { code } }, statuses[code]);
    if (!isPreviewSurfaceId(surfaceId)) return error("surface_unavailable");
    if (c.req.raw.body !== null || new URL(c.req.url).search !== "") return error("preview_unsupported");
    try { return c.json(await service.capture(surfaceId.toLowerCase())); }
    catch (failure) { return error(failure instanceof PreviewError ? failure.code : "preview_failed"); }
  });
  return app;
}
