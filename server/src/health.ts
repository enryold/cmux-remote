import { Hono } from "hono";
import { CmuxClient } from "./cmux-client";
import type { RuntimeConfig } from "./config";

export function createHealthRoutes(config: RuntimeConfig): Hono {
  const health = new Hono();

  health.get("/health", async (c) => {
    const client = new CmuxClient({
      socketPath: config.socketPath,
      socketPassword: config.socketPassword,
    });
    let connected = false;
    try {
      await client.request("system.ping", {});
      connected = true;
    } catch {
      connected = false;
    } finally {
      client.disconnect();
    }

    return c.json({
      status: "ok",
      cmux: connected ? "connected" : "disconnected",
      uptime: process.uptime(),
    });
  });

  return health;
}
