import { describe, expect, it } from "bun:test";
import {
  createAuthRoutes,
  createPairingChallenge,
  createSessionValue,
  verifySessionValue,
} from "../auth";
import { TAILSCALE_CAPABILITIES_HEADER } from "../tailscale";

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

const capability = "example.com/cap/cmux-remote";
const pairingConfig = {
  ...config,
  tailscaleCapability: capability,
  pairingCode: "123456",
};
const pairingHeaders = {
  ...loginHeaders,
  [TAILSCALE_CAPABILITIES_HEADER]: JSON.stringify({
    [capability]: [{ access: true }],
  }),
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
    expect(response.headers.get("set-cookie")).toContain("Max-Age=604800");
  });

  it("rejects an expired or modified session", () => {
    const value = createSessionValue(config.remoteToken, 1_000);
    expect(verifySessionValue(value, config.remoteToken, 999)).toBe(true);
    expect(verifySessionValue(value, config.remoteToken, 1_001)).toBe(false);
    expect(verifySessionValue(`${value}x`, config.remoteToken, 999)).toBe(false);
    expect(value).not.toContain(config.remoteToken);
  });

  it("expires, consumes, and locks a pairing challenge", () => {
    const challenge = createPairingChallenge("123456", 1_000);
    expect(challenge.verify("123456", 1_001)).toBe(true);
    expect(challenge.verify("123456", 1_002)).toBe(false);

    const expired = createPairingChallenge("123456", 1_000);
    expect(expired.verify("123456", 1_601)).toBe(false);

    const locked = createPairingChallenge("123456", 1_000);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(locked.verify("000000", 1_001)).toBe(false);
    }
    expect(locked.verify("123456", 1_001)).toBe(false);
  });

  it("requires the device capability before examining a pairing code", async () => {
    const app = createAuthRoutes(
      pairingConfig,
      createPairingChallenge("123456"),
    );
    const missingCapability = await app.request("/auth/login", {
      method: "POST",
      headers: loginHeaders,
      body: JSON.stringify({ pairingCode: "123456" }),
    });
    expect(missingCapability.status).toBe(403);

    const validAfterRejectedDevice = await app.request("/auth/login", {
      method: "POST",
      headers: pairingHeaders,
      body: JSON.stringify({ pairingCode: "123456" }),
    });
    expect(validAfterRejectedDevice.status).toBe(204);
  });

  it("issues one long-lived paired session without revealing challenge state", async () => {
    const app = createAuthRoutes(
      pairingConfig,
      createPairingChallenge("123456"),
    );
    const wrong = await app.request("/auth/login", {
      method: "POST",
      headers: pairingHeaders,
      body: JSON.stringify({ pairingCode: "000000" }),
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "authentication_failed" });

    const paired = await app.request("/auth/login", {
      method: "POST",
      headers: pairingHeaders,
      body: JSON.stringify({ pairingCode: "123456" }),
    });
    expect(paired.status).toBe(204);
    expect(paired.headers.get("set-cookie")).toContain("HttpOnly");
    expect(paired.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(paired.headers.get("set-cookie")).toContain("Secure");
    expect(paired.headers.get("set-cookie")).toContain("Max-Age=31536000");

    const reused = await app.request("/auth/login", {
      method: "POST",
      headers: pairingHeaders,
      body: JSON.stringify({ pairingCode: "123456" }),
    });
    expect(reused.status).toBe(401);
    expect(await reused.json()).toEqual({ error: "authentication_failed" });
  });

  it("reports pairing mode and device authorization without exposing grants", async () => {
    const app = createAuthRoutes(
      pairingConfig,
      createPairingChallenge("123456"),
    );
    const denied = await app.request("/auth/status");
    expect(await denied.json()).toEqual({
      authenticated: false,
      mode: "pairing",
      deviceAuthorized: false,
    });

    const allowed = await app.request("/auth/status", {
      headers: pairingHeaders,
    });
    expect(await allowed.json()).toEqual({
      authenticated: false,
      mode: "pairing",
      deviceAuthorized: true,
    });
  });
});
