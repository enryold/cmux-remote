import { useCallback, useEffect, useRef, useState } from "react";

export const POLL_DELAYS = [250, 500, 1_000, 2_000, 5_000] as const;

export function nextPollIndex(current: number, changed: boolean): number {
  return changed ? 0 : Math.min(current + 1, POLL_DELAYS.length - 1);
}

interface PollingOptions {
  enabled: boolean;
  surfaceId: string | null;
  readText(surfaceId: string, lines: number): Promise<string>;
}

export function useTerminalPolling({
  enabled,
  surfaceId,
  readText,
}: PollingOptions): {
  content: string;
  error: string | null;
  refreshNow(): void;
} {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    setContent("");
    setError(null);
    if (!enabled || !surfaceId) {
      refreshRef.current = () => undefined;
      return;
    }

    let cancelled = false;
    let inFlight = false;
    let refreshRequested = false;
    let pollIndex = 0;
    let previous = "";
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const schedule = (delay: number) => {
      clearTimer();
      if (!cancelled && document.visibilityState === "visible") {
        timer = setTimeout(poll, delay);
      }
    };

    const poll = async () => {
      timer = null;
      if (cancelled || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      let delay = 2_000;
      try {
        const next = await readText(surfaceId, 2_000);
        if (cancelled) return;
        const changed = next !== previous;
        previous = next;
        pollIndex = nextPollIndex(pollIndex, changed);
        delay = POLL_DELAYS[pollIndex] ?? 5_000;
        setContent(next);
        setError(null);
      } catch {
        if (!cancelled) setError("Terminal output is stale");
      } finally {
        inFlight = false;
        if (!cancelled) {
          const nextDelay = refreshRequested ? 0 : delay;
          refreshRequested = false;
          schedule(nextDelay);
        }
      }
    };

    const refreshNow = () => {
      clearTimer();
      if (inFlight) refreshRequested = true;
      else void poll();
    };
    refreshRef.current = refreshNow;

    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshNow();
      else clearTimer();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") void poll();

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibility);
      if (refreshRef.current === refreshNow) {
        refreshRef.current = () => undefined;
      }
    };
  }, [enabled, surfaceId, readText]);

  const refreshNow = useCallback(() => refreshRef.current(), []);
  return { content, error, refreshNow };
}
