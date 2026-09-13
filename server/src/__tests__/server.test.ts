import { describe, expect, it } from "bun:test";
import { createSessionValue, SESSION_COOKIE } from "../auth";
import type { RuntimeConfig } from "../config";
import { startServer } from "../index";

describe("WebSocket upgrade boundary", () => {
  it("requires both a valid same-origin request and session", async () => {
    const config: RuntimeConfig = {
      hostname: "127.0.0.1",
      port: 0,
      remoteToken: "a".repeat(32),
      publicOrigin: null,
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
});
