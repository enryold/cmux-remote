import { expect, it } from "vitest";
import { parseSurfacePreview, readPreviewResponse } from "../surface-preview";
import { imagePreview } from "../../test/preview-fixture";
it("accepts normalized captures and rejects invalid metadata or private fields", () => {
  expect(parseSurfacePreview(imagePreview)).toEqual(imagePreview);
  for (const value of [{ ...imagePreview, width: 4097 }, { ...imagePreview, width: 2 }, { ...imagePreview, path: "/private/test" }, { ...imagePreview, mime: "image/svg+xml" }, { ...imagePreview, base64: "invalid" }, { ...imagePreview, capturedAt: "invalid" }, { kind: "markdown", surfaceId: imagePreview.surfaceId, capturedAt: imagePreview.capturedAt, text: "x".repeat(262145) }]) expect(() => parseSurfacePreview(value)).toThrow();
});
it("bounds streaming response bytes even without truthful Content-Length", async () => {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(JSON.stringify(imagePreview))); controller.close(); } }));
  expect(await readPreviewResponse(response)).toEqual(imagePreview);
  for (const headers of [new Headers(), new Headers({ "content-length": "1" })]) {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.close(); } });
    await expect(readPreviewResponse(new Response(stream, { headers }))).rejects.toThrow("preview_too_large");
  }
});
