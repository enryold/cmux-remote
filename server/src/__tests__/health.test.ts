import { describe, expect, it } from "bun:test";
import type { RuntimeConfig } from "../config";
import { createHealthRoutes } from "../health";
import { eventually, startFakeCmuxServer } from "./fake-cmux";

const baseConfig: RuntimeConfig = {
  hostname: "127.0.0.1",
  port: 3456,
  remoteToken: "a".repeat(32),
  publicOrigin: null,
  tailscaleCapability: null,
  pairingCode: null,
  socketPath: "/tmp/cmux-test.sock",
  socketPassword: null,
};

describe("Health endpoint", () => {
  it("pings cmux and returns only availability plus uptime", async () => {
    const fake = await startFakeCmuxServer({
      onRequest(request, socket, server) {
        server.reply(socket, request.id, { pong: true });
      },
    });
    const health = createHealthRoutes({ ...baseConfig, socketPath: fake.path });

    try {
      const response = await health.request("/health");
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["cmux", "status", "uptime"]);
      expect(body).toMatchObject({ status: "ok", cmux: "connected" });
      expect(fake.requests.map(({ method }) => method)).toEqual(["system.ping"]);
      await eventually(() => expect(fake.connections.size).toBe(0));
    } finally {
      await fake.close();
    }
  });

  it("reports a disconnected cmux without exposing its path", async () => {
    const socketPath = `/tmp/cmux-remote-missing-${crypto.randomUUID()}.sock`;
    const health = createHealthRoutes({ ...baseConfig, socketPath });
    const response = await health.request("/health");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", cmux: "disconnected" });
    expect(JSON.stringify(body)).not.toContain(socketPath);
  });
});
