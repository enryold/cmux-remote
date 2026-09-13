import { useCallback, useEffect, useState } from "react";

export type AuthStatus = "checking" | "anonymous" | "authenticated";
export type AuthMode = "token" | "pairing";

export function useAuth(): {
  status: AuthStatus;
  mode: AuthMode;
  deviceAuthorized: boolean;
  error: string | null;
  login(token: string): Promise<void>;
  logout(): Promise<void>;
  expire(): void;
} {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [mode, setMode] = useState<AuthMode>("token");
  const [deviceAuthorized, setDeviceAuthorized] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/auth/status", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as unknown;
        const record =
          typeof body === "object" && body !== null
            ? (body as Record<string, unknown>)
            : null;
        const nextMode: AuthMode =
          record?.mode === "pairing" ? "pairing" : "token";
        const nextDeviceAuthorized =
          nextMode === "token" || record?.deviceAuthorized === true;
        const authenticated =
          nextDeviceAuthorized && record?.authenticated === true;
        setMode(nextMode);
        setDeviceAuthorized(nextDeviceAuthorized);
        setStatus(authenticated ? "authenticated" : "anonymous");
      })
      .catch((fetchError: unknown) => {
        if ((fetchError as { name?: string }).name !== "AbortError") {
          setStatus("anonymous");
        }
      });
    return () => controller.abort();
  }, []);

  const login = useCallback(
    async (credential: string) => {
      setError(null);
      if (mode === "pairing" && !deviceAuthorized) {
        setStatus("anonymous");
        setError("Authentication failed");
        return;
      }
      const response = await fetch("/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "pairing"
            ? { pairingCode: credential }
            : { token: credential },
        ),
      });
      if (!response.ok) {
        setStatus("anonymous");
        setError("Authentication failed");
        return;
      }
      setStatus("authenticated");
    },
    [deviceAuthorized, mode],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      setStatus("anonymous");
      setError(null);
    }
  }, []);

  const expire = useCallback(() => {
    setStatus("anonymous");
    setError("Session expired");
  }, []);

  return {
    status,
    mode,
    deviceAuthorized,
    error,
    login,
    logout,
    expire,
  };
}
