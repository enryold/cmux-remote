import { useState } from "react";
import type { PreviewStatus } from "../hooks/useSurfacePreview";
import type { SurfacePreview as Preview } from "../lib/surface-preview";
export function SurfacePreview({ preview, status, refresh }: { preview: Preview | null; status: PreviewStatus; refresh(): void }) {
  const [zoom, setZoom] = useState(100);
  return (
    <main className="preview-page">
      <div className="preview-controls">
        <button type="button" disabled={status === "loading" || status === "idle"} onClick={refresh}>Refresh</button>
        {preview?.kind === "image" ? <>
          <button type="button" aria-label="Zoom out" disabled={zoom <= 25} onClick={() => setZoom((value) => value - 25)}>−</button>
          <span>{zoom}%</span>
          <button type="button" aria-label="Zoom in" disabled={zoom >= 300} onClick={() => setZoom((value) => value + 25)}>+</button>
        </> : null}
      </div>
      {status === "loading" ? <p role="status">Capturing preview…</p> : null}
      {status === "idle" ? <p role="status">Connect to view a preview.</p> : null}
      {status === "unsupported" ? <p role="status">Preview unavailable for this panel on the installed cmux version.</p> : null}
      {status === "error" ? <p role="alert">Could not capture this preview. Try Refresh.</p> : null}
      {status === "stale" ? <p role="status">Capture may be stale. Refresh failed.</p> : null}
      {preview ? <p className="preview-time">Captured <time dateTime={preview.capturedAt}>{new Date(preview.capturedAt).toLocaleTimeString()}</time></p> : null}
      <section className="preview-content" aria-label="Surface preview">
        {preview?.kind === "image" ? <img alt="Surface capture" draggable={false} src={`data:${preview.mime};base64,${preview.base64}`} style={{ width: `${preview.width * zoom / 100}px`, height: `${preview.height * zoom / 100}px` }} /> : null}
        {preview?.kind === "markdown" ? <pre>{preview.text}</pre> : null}
      </section>
      <p className="preview-note">Read-only capture. Zoom and pan affect this device.</p>
    </main>
  );
}
