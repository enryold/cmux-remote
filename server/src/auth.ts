import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { RuntimeConfig } from "./config";

export const SESSION_COOKIE = "cmux_remote_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const LOGIN_BODY_LIMIT = 4_096;

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
  return session !== null && verifySessionValue(session, config.remoteToken, now);
}

function cookieOptions(request: Request, config: RuntimeConfig) {
  const origin = config.publicOrigin ?? new URL(request.url).origin;
  return {
    httpOnly: true,
    sameSite: "Strict" as const,
    secure: new URL(origin).protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function createAuthRoutes(config: RuntimeConfig): Hono {
  const app = new Hono();

  app.get("/auth/status", (c) =>
    c.json({ authenticated: isAuthenticated(c.req.raw, config) }),
  );

  app.post("/auth/login", async (c) => {
    if (!isAllowedOrigin(c.req.raw, config)) {
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

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("token" in body) ||
      typeof body.token !== "string"
    ) {
      return c.json({ error: "invalid_request" }, 400);
    }

    if (!safeEqual(body.token, config.remoteToken)) {
      return c.json({ error: "authentication_failed" }, 401);
    }

    const expiresAt = Math.floor(Date.now() / 1_000) + SESSION_TTL_SECONDS;
    setCookie(
      c,
      SESSION_COOKIE,
      createSessionValue(config.remoteToken, expiresAt),
      cookieOptions(c.req.raw, config),
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
