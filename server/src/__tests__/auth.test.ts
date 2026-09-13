import { describe, expect, it } from "bun:test";
import {
  createAuthRoutes,
  createSessionValue,
  verifySessionValue,
} from "../auth";

const config = {
  hostname: "127.0.0.1",
  port: 3456,
  remoteToken: "a".repeat(32),
  publicOrigin: "https://mac.tail.example",
  tailscaleCapability: null,
  pairingCode: null,
  socketPath: "/tmp/cmux.sock",
  socketPassword: null,
};

const loginHeaders = {
  origin: config.publicOrigin,
  "content-type": "application/json",
};

describe("auth", () => {
  it("rejects cross-origin login and wrong tokens", async () => {
    const app = createAuthRoutes(config);
    const crossOrigin = await app.request("/auth/login", {
      method: "POST",
      headers: { ...loginHeaders, origin: "https://evil.example" },
      body: JSON.stringify({ token: config.remoteToken }),
    });
    expect(crossOrigin.status).toBe(403);

    const wrongToken = await app.request("/auth/login", {
      method: "POST",
      headers: loginHeaders,
      body: JSON.stringify({ token: "wrong" }),
    });
    expect(wrongToken.status).toBe(401);
  });

  it("rejects oversized or non-exact login bodies", async () => {
    const app = createAuthRoutes(config);
    const oversized = await app.request("/auth/login", {
      method: "POST",
      headers: loginHeaders,
      body: JSON.stringify({ token: config.remoteToken, padding: "x".repeat(4096) }),
    });
    expect(oversized.status).toBe(413);

    const extraField = await app.request("/auth/login", {
      method: "POST",
      headers: loginHeaders,
      body: JSON.stringify({ token: config.remoteToken, remember: true }),
    });
    expect(extraField.status).toBe(400);
  });

  it("sets a secure HttpOnly strict cookie for a valid token", async () => {
    const app = createAuthRoutes(config);
    const response = await app.request("/auth/login", {
      method: "POST",
      headers: loginHeaders,
      body: JSON.stringify({ token: config.remoteToken }),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("rejects an expired or modified session", () => {
    const value = createSessionValue(config.remoteToken, 1_000);
    expect(verifySessionValue(value, config.remoteToken, 999)).toBe(true);
    expect(verifySessionValue(value, config.remoteToken, 1_001)).toBe(false);
    expect(verifySessionValue(`${value}x`, config.remoteToken, 999)).toBe(false);
    expect(value).not.toContain(config.remoteToken);
  });
});
