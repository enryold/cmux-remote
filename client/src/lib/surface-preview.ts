export type SurfacePreview =
  | { kind: "image"; surfaceId: string; capturedAt: string; mime: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number; base64: string }
  | { kind: "markdown"; surfaceId: string; capturedAt: string; text: string };
export const PREVIEW_BODY_LIMIT = 3 * 1024 * 1024;
const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(): never { throw new Error("preview_failed"); }
export function parseSurfacePreview(value: unknown): SurfacePreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const item = value as Record<string, unknown>;
  if (typeof item.surfaceId !== "string" || !uuid.test(item.surfaceId) || typeof item.capturedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item.capturedAt) || !Number.isFinite(Date.parse(item.capturedAt))) invalid();
  if (item.kind === "markdown") {
    if (Object.keys(item).length !== 4 || typeof item.text !== "string" || encoder.encode(item.text).length > 256 * 1024) invalid();
    return { kind: "markdown", surfaceId: item.surfaceId, capturedAt: item.capturedAt, text: item.text };
  }
  if (item.kind !== "image" || Object.keys(item).length !== 7 || !Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height)
    || typeof item.width !== "number" || typeof item.height !== "number" || item.width < 1 || item.height < 1 || item.width > 4096 || item.height > 4096 || item.width * item.height > 8388608
    || (item.mime !== "image/png" && item.mime !== "image/jpeg" && item.mime !== "image/webp") || typeof item.base64 !== "string" || item.base64.length > Math.ceil(2 * 1024 * 1024 / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64)) invalid();
  let bytes: string;
  try { bytes = atob(item.base64); } catch { invalid(); }
  if (bytes.length > 2 * 1024 * 1024 || btoa(bytes) !== item.base64) invalid();
  if (item.mime === "image/png") {
    if (bytes.length < 33 || bytes.slice(0, 8) !== "\u0089PNG\r\n\u001a\n" || bytes.slice(12, 16) !== "IHDR") invalid();
    const uint32 = (offset: number) => bytes.charCodeAt(offset) * 16777216 + bytes.charCodeAt(offset + 1) * 65536 + bytes.charCodeAt(offset + 2) * 256 + bytes.charCodeAt(offset + 3);
    if (uint32(8) !== 13 || uint32(16) !== item.width || uint32(20) !== item.height) invalid();
  } else if (item.mime === "image/jpeg") { if (!bytes.startsWith("\u00ff\u00d8\u00ff")) invalid(); }
  else if (bytes.slice(0, 4) !== "RIFF" || bytes.slice(8, 12) !== "WEBP") invalid();
  return { kind: "image", surfaceId: item.surfaceId, capturedAt: item.capturedAt, mime: item.mime, width: item.width, height: item.height, base64: item.base64 };
}
export async function readPreviewResponse(response: Response): Promise<SurfacePreview> {
  if (Number(response.headers.get("content-length")) > PREVIEW_BODY_LIMIT) { await response.body?.cancel(); throw new Error("preview_too_large"); }
  const reader = response.body?.getReader();
  if (!reader) invalid();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0; let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PREVIEW_BODY_LIMIT) throw new Error("preview_too_large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return parseSurfacePreview(JSON.parse(text));
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}
