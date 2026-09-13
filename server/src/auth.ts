import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { RuntimeConfig } from "./config";
import { hasTailscaleCapability } from "./tailscale";

export const SESSION_COOKIE = "cmux_remote_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const PAIRED_SESSION_TTL_SECONDS = 365 * 24 * 60 * 60;

const LOGIN_BODY_LIMIT = 4_096;
const PAIRING_TTL_SECONDS = 10 * 60;
const MAX_PAIRING_FAILURES = 5;

export interface PairingChallenge {
  verify(candidate: string, now?: number): boolean;
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sessionSignature(token: string, payload: string): string {
  return createHmac("sha256", token).update(payload).digest("base64url");
}

export function createSessionValue(token: string, expiresAt: number): string {
  const payload = `v1.${expiresAt}`;
  return `${payload}.${sessionSignature(token, payload)}`;
}

export function createPairedSessionValue(
  token: string,
  expiresAt: number,
  capability: string,
): string {
  const binding = createHash("sha256")
    .update(capability)
    .digest("base64url");
  const payload = `v2.${expiresAt}.${binding}`;
  return `${payload}.${sessionSignature(token, payload)}`;
}

export function verifySessionValue(
  value: string,
  token: string,
  now: number,
): boolean {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || now > expiresAt) return false;

  const payload = `v1.${expiresAt}`;
  return safeEqual(parts[2] ?? "", sessionSignature(token, payload));
}

function verifyPairedSessionValue(
  value: string,
  token: string,
  capability: string,
  now: number,
): boolean {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v2") return false;

  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || now > expiresAt) return false;

  const binding = createHash("sha256")
    .update(capability)
    .digest("base64url");
  if (!safeEqual(parts[2] ?? "", binding)) return false;

  const payload = `v2.${expiresAt}.${binding}`;
  return safeEqual(parts[3] ?? "", sessionSignature(token, payload));
}

export function createPairingChallenge(
  code: string,
  createdAt = Math.floor(Date.now() / 1_000),
): PairingChallenge {
  let used = false;
  let failures = 0;

  return {
    verify(candidate, now = Math.floor(Date.now() / 1_000)) {
      const matches = safeEqual(candidate, code);
      if (
        used ||
        failures >= MAX_PAIRING_FAILURES ||
        now > createdAt + PAIRING_TTL_SECONDS
      ) {
        return false;
      }
      if (matches) {
        used = true;
        return true;
      }
      failures += 1;
      return false;
    },
  };
}

export function isAllowedOrigin(
  request: Request,
  config: RuntimeConfig,
): boolean {
  const expected = config.publicOrigin ?? new URL(request.url).origin;
  return request.headers.get("origin") === expected;
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie");
  if (!cookies) return null;
  for (const pair of cookies.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    return pair.slice(separator + 1).trim();
  }
  return null;
}

export function isAuthenticated(
  request: Request,
  config: RuntimeConfig,
  now = Math.floor(Date.now() / 1_000),
): boolean {
  const session = readCookie(request, SESSION_COOKIE);
  if (session === null) return false;
  return config.tailscaleCapability === null
    ? verifySessionValue(session, config.remoteToken, now)
    : verifyPairedSessionValue(
        session,
        config.remoteToken,
        config.tailscaleCapability,
        now,
      );
}

export function isAuthorized(
  request: Request,
  config: RuntimeConfig,
  now = Math.floor(Date.now() / 1_000),
): boolean {
  return (
    hasTailscaleCapability(request, config.tailscaleCapability) &&
    isAuthenticated(request, config, now)
  );
}

function cookieOptions(
  request: Request,
  config: RuntimeConfig,
  maxAge = SESSION_TTL_SECONDS,
) {
  const origin = config.publicOrigin ?? new URL(request.url).origin;
  return {
    httpOnly: true,
    sameSite: "Strict" as const,
    secure: new URL(origin).protocol === "https:",
    path: "/",
    maxAge,
  };
}

export function createAuthRoutes(
  config: RuntimeConfig,
  pairingChallenge = config.pairingCode
    ? createPairingChallenge(config.pairingCode)
    : null,
): Hono {
  const app = new Hono();
  const pairingMode = config.tailscaleCapability !== null;

  app.get("/auth/status", (c) => {
    const deviceAuthorized = hasTailscaleCapability(
      c.req.raw,
      config.tailscaleCapability,
    );
    return c.json({
      authenticated: deviceAuthorized && isAuthenticated(c.req.raw, config),
      mode: pairingMode ? "pairing" : "token",
      deviceAuthorized,
    });
  });

  app.post("/auth/login", async (c) => {
    if (!isAllowedOrigin(c.req.raw, config)) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (
      pairingMode &&
      !hasTailscaleCapability(c.req.raw, config.tailscaleCapability)
    ) {
      return c.json({ error: "forbidden" }, 403);
    }

    const declaredLength = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > LOGIN_BODY_LIMIT) {
      return c.json({ error: "request_too_large" }, 413);
    }

    const rawBody = await c.req.text();
    if (new TextEncoder().encode(rawBody).length > LOGIN_BODY_LIMIT) {
      return c.json({ error: "request_too_large" }, 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "invalid_request" }, 400);
    }

    const key = pairingMode ? "pairingCode" : "token";
    const record = body as Record<string, unknown>;
    const credential = record[key];
    if (
      Object.keys(record).length !== 1 ||
      typeof credential !== "string" ||
      (pairingMode && !/^\d{6}$/.test(credential))
    ) {
      return c.json({ error: "invalid_request" }, 400);
    }

    const accepted = pairingMode
      ? pairingChallenge?.verify(credential) === true
      : safeEqual(credential, config.remoteToken);
    if (!accepted) {
      return c.json({ error: "authentication_failed" }, 401);
    }

    const maxAge = pairingMode
      ? PAIRED_SESSION_TTL_SECONDS
      : SESSION_TTL_SECONDS;
    const expiresAt = Math.floor(Date.now() / 1_000) + maxAge;
    setCookie(
      c,
      SESSION_COOKIE,
      config.tailscaleCapability === null
        ? createSessionValue(config.remoteToken, expiresAt)
        : createPairedSessionValue(
            config.remoteToken,
            expiresAt,
            config.tailscaleCapability,
          ),
      cookieOptions(c.req.raw, config, maxAge),
    );
    return c.body(null, 204);
  });

  app.post("/auth/logout", (c) => {
    if (!isAllowedOrigin(c.req.raw, config)) {
      return c.json({ error: "forbidden" }, 403);
    }
    deleteCookie(c, SESSION_COOKIE, cookieOptions(c.req.raw, config));
    return c.body(null, 204);
  });

  return app;
}
