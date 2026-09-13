import { describe, expect, it } from "bun:test";
import {
  createPairedSessionValue,
  createSessionValue,
  SESSION_COOKIE,
} from "../auth";
import type { RuntimeConfig } from "../config";
import { startServer } from "../index";
import { TAILSCALE_CAPABILITIES_HEADER } from "../tailscale";

describe("WebSocket upgrade boundary", () => {
  it("requires both a valid same-origin request and session", async () => {
    const config: RuntimeConfig = {
      hostname: "127.0.0.1",
      port: 0,
      remoteToken: "a".repeat(32),
      publicOrigin: null,
      tailscaleCapability: null,
      pairingCode: null,
      socketPath: "/tmp/cmux-test.sock",
      socketPassword: null,
    };
    const server = startServer(config);
    const origin = `http://127.0.0.1:${server.port}`;
    const session = createSessionValue(
      config.remoteToken,
      Math.floor(Date.now() / 1_000) + 60,
    );

    try {
      const anonymous = await fetch(`${origin}/ws`, {
        headers: { origin },
      });
      expect(anonymous.status).toBe(401);

      const crossOrigin = await fetch(`${origin}/ws`, {
        headers: {
          origin: "https://evil.example",
          cookie: `${SESSION_COOKIE}=${session}`,
        },
      });
      expect(crossOrigin.status).toBe(401);

      const authenticated = await fetch(`${origin}/ws`, {
        headers: {
          origin,
          cookie: `${SESSION_COOKIE}=${session}`,
        },
      });
      expect(authenticated.status).toBe(400);
    } finally {
      await server.stop(true);
    }
  });

  it("applies browser hardening headers to served app responses", async () => {
    const server = startServer({
      hostname: "127.0.0.1",
      port: 0,
      remoteToken: "a".repeat(32),
      publicOrigin: null,
      tailscaleCapability: null,
      pairingCode: null,
      socketPath: "/tmp/cmux-test.sock",
      socketPassword: null,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    } finally {
      await server.stop(true);
    }
  });

  it("requires the configured device capability in addition to the session", async () => {
    const capability = "example.com/cap/cmux-remote";
    const config: RuntimeConfig = {
      hostname: "127.0.0.1",
      port: 0,
      remoteToken: "a".repeat(32),
      publicOrigin: null,
      tailscaleCapability: capability,
      pairingCode: "123456",
      socketPath: "/tmp/cmux-test.sock",
      socketPassword: null,
    };
    const server = startServer(config);
    const origin = `http://127.0.0.1:${server.port}`;
    const session = createPairedSessionValue(
      config.remoteToken,
      Math.floor(Date.now() / 1_000) + 60,
      capability,
    );

    try {
      const missingCapability = await fetch(`${origin}/ws`, {
        headers: {
          origin,
          cookie: `${SESSION_COOKIE}=${session}`,
        },
      });
      expect(missingCapability.status).toBe(401);

      const authorized = await fetch(`${origin}/ws`, {
        headers: {
          origin,
          cookie: `${SESSION_COOKIE}=${session}`,
          [TAILSCALE_CAPABILITIES_HEADER]: JSON.stringify({
            [capability]: [{ access: true }],
          }),
        },
      });
      expect(authorized.status).toBe(400);
    } finally {
      await server.stop(true);
    }
  });
});
