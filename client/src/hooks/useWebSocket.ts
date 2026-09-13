import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "../lib/cmux-rpc";

export interface UseWebSocketOptions {
  url: string;
  enabled: boolean;
  onMessage: (data: string) => void;
  onUnauthorized?: () => void;
}

export function reconnectDelay(attempt: number, random: number): number {
  const base = Math.min(1_000 * 2 ** attempt, 30_000);
  return Math.round(base * (0.8 + random * 0.4));
}

export function useWebSocket({
  url,
  enabled,
  onMessage,
  onUnauthorized,
}: UseWebSocketOptions): {
  status: ConnectionStatus;
  send: (data: string) => boolean;
  reconnectNow: () => void;
} {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<() => void>(() => undefined);
  const onMessageRef = useRef(onMessage);
  const onUnauthorizedRef = useRef(onUnauthorized);
  const unmountedRef = useRef(false);
  onMessageRef.current = onMessage;
  onUnauthorizedRef.current = onUnauthorized;

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const connect = useCallback(() => {
    if (!enabled || unmountedRef.current) return;
    if (!navigator.onLine) {
      setStatus("disconnected");
      return;
    }
    if (
      socketRef.current?.readyState === WebSocket.OPEN ||
      socketRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    clearRetry();
    setStatus("connecting");

    const scheduleRetry = () => {
      if (unmountedRef.current || !enabled) return;
      const delay = reconnectDelay(retryRef.current, Math.random());
      retryRef.current += 1;
      retryTimerRef.current = setTimeout(() => connectRef.current(), delay);
    };

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      setStatus("disconnected");
      scheduleRetry();
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) return;
      retryRef.current = 0;
      setStatus("connected");
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") onMessageRef.current(event.data);
    };
    socket.onclose = (event) => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      setStatus("disconnected");
      if (unmountedRef.current || !enabled) return;
      if (event.code === 4401) {
        onUnauthorizedRef.current?.();
        return;
      }
      scheduleRetry();
    };
    socket.onerror = () => socket.close();
  }, [clearRetry, enabled, url]);
  connectRef.current = connect;

  const reconnectNow = useCallback(() => {
    if (!enabled || unmountedRef.current) return;
    clearRetry();
    const socket = socketRef.current;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      socketRef.current = null;
    }
    connectRef.current();
  }, [clearRetry, enabled]);

  const send = useCallback((data: string): boolean => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(data);
    return true;
  }, []);

  const goOffline = useCallback(() => {
    clearRetry();
    const socket = socketRef.current;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      socketRef.current = null;
    }
    setStatus("disconnected");
  }, [clearRetry]);

  useEffect(() => {
    unmountedRef.current = false;
    if (enabled) connectRef.current();
    else setStatus("disconnected");

    return () => {
      unmountedRef.current = true;
      clearRetry();
      const socket = socketRef.current;
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      socketRef.current = null;
    };
  }, [clearRetry, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconnectNow();
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", reconnectNow);
    window.addEventListener("pageshow", reconnectNow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", reconnectNow);
      window.removeEventListener("pageshow", reconnectNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, goOffline, reconnectNow]);

  return { status, send, reconnectNow };
}
