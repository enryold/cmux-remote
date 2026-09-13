import { useCallback, useEffect, useState } from "react";

export type AuthStatus = "checking" | "anonymous" | "authenticated";

export function useAuth(): {
  status: AuthStatus;
  error: string | null;
  login(token: string): Promise<void>;
  logout(): Promise<void>;
  expire(): void;
} {
  const [status, setStatus] = useState<AuthStatus>("checking");
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
        const authenticated =
          typeof body === "object" &&
          body !== null &&
          "authenticated" in body &&
          body.authenticated === true;
        setStatus(authenticated ? "authenticated" : "anonymous");
      })
      .catch((fetchError: unknown) => {
        if ((fetchError as { name?: string }).name !== "AbortError") {
          setStatus("anonymous");
        }
      });
    return () => controller.abort();
  }, []);

  const login = useCallback(async (token: string) => {
    setError(null);
    const response = await fetch("/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      setStatus("anonymous");
      setError("Authentication failed");
      return;
    }
    setStatus("authenticated");
  }, []);

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

  return { status, error, login, logout, expire };
}
