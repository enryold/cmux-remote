import { useCallback, useEffect, useRef, useState } from "react";
import { readPreviewResponse, type SurfacePreview } from "../lib/surface-preview";
export type PreviewStatus = "idle" | "loading" | "ready" | "stale" | "unsupported" | "error";
interface PreviewState { surfaceId: string | null; surfaceType: string | null; generation: number; preview: SurfacePreview | null; status: PreviewStatus; }
export function useSurfacePreview({ surfaceId, surfaceType = null, enabled, onUnauthorized, generation = 0 }: { surfaceId: string | null; surfaceType?: string | null; enabled: boolean; onUnauthorized(): void; generation?: number }) {
  const [state, setState] = useState<PreviewState>({ surfaceId: null, surfaceType, generation, preview: null, status: "idle" });
  const active = useRef<{ controller: AbortController; serial: number } | null>(null);
  const serial = useRef(0);
  const expire = useRef(onUnauthorized); expire.current = onUnauthorized;
  const load = useCallback(async () => {
    if (!enabled || !surfaceId || document.visibilityState !== "visible" || active.current) return;
    const request = { controller: new AbortController(), serial: ++serial.current };
    active.current = request;
    setState((previous) => ({ surfaceId, surfaceType, generation, preview: previous.surfaceId === surfaceId && previous.surfaceType === surfaceType && previous.generation === generation ? previous.preview : null, status: "loading" }));
    const current = () => !request.controller.signal.aborted && request.serial === serial.current;
    try {
      const response = await fetch(`/api/surfaces/${encodeURIComponent(surfaceId)}/preview`, { method: "POST", credentials: "same-origin", cache: "no-store", signal: request.controller.signal });
      if (!current()) { await response.body?.cancel(); return; }
      if (response.status === 401) {
        await response.body?.cancel();
        setState({ surfaceId, surfaceType, generation, preview: null, status: "error" }); expire.current(); return;
      }
      if (!response.ok) {
        await response.body?.cancel();
        setState((previous) => ({ surfaceId, surfaceType, generation, preview: previous.preview, status: previous.preview ? "stale" : response.status === 422 ? "unsupported" : "error" })); return;
      }
      const preview = await readPreviewResponse(response);
      if (!current()) return;
      if (preview.surfaceId.toLowerCase() !== surfaceId.toLowerCase()) throw new Error("preview_failed");
      setState({ surfaceId, surfaceType, generation, preview, status: "ready" });
    } catch {
      if (current()) setState((previous) => ({ surfaceId, surfaceType, generation, preview: previous.preview, status: previous.preview ? "stale" : "error" }));
    } finally { if (active.current === request) active.current = null; }
  }, [enabled, surfaceId, surfaceType, generation]);
  const refresh = useCallback(() => { void load(); }, [load]);
  useEffect(() => {
    // A new connection generation clears captures even if React batches a quick reconnect.
    serial.current++;
    active.current?.controller.abort(); active.current = null;
    setState({ surfaceId, surfaceType, generation, preview: null, status: "idle" });
    void load();
    const onVisibility = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      serial.current++; active.current?.controller.abort(); active.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [surfaceId, surfaceType, generation, load]);
  const current = enabled && state.surfaceId === surfaceId && state.surfaceType === surfaceType && state.generation === generation;
  return { preview: current ? state.preview : null, status: current ? state.status : "idle" as PreviewStatus, refresh };
}
