import { describe, expect, it } from "bun:test";
import { CmuxClient } from "../cmux-client";
import { startFakeCmuxServer } from "./fake-cmux";

describe("CmuxClient", () => {
  it("authenticates before RPCs and correlates out-of-order replies", async () => {
    const fake = await startFakeCmuxServer({
      onRequest(request, socket, server) {
        if (request.method === "auth.login") {
          server.reply(socket, request.id, { authenticated: true });
        } else if (request.method === "first") {
          setTimeout(
            () => server.reply(socket, request.id, { value: 1 }),
            10,
          );
        } else {
          server.reply(socket, request.id, { value: 2 });
        }
      },
    });
    const client = new CmuxClient({
      socketPath: fake.path,
      socketPassword: "socket-secret",
    });

    try {
      const [first, second] = await Promise.all([
        client.request("first", {}),
        client.request("second", {}),
      ]);
      expect([first, second]).toEqual([{ value: 1 }, { value: 2 }]);
      expect(fake.requests.map(({ method }) => method)).toEqual([
        "auth.login",
        "first",
        "second",
      ]);
    } finally {
      client.disconnect();
      await fake.close();
    }
  });

  it("rejects pending work when cmux disconnects", async () => {
    const fake = await startFakeCmuxServer({
      onRequest(_request, socket) {
        socket.destroy();
      },
    });
    const client = new CmuxClient({ socketPath: fake.path });

    try {
      await expect(client.request("system.ping", {})).rejects.toThrow(
        "cmux_disconnected",
      );
      expect(client.isConnected).toBe(false);
    } finally {
      client.disconnect();
      await fake.close();
    }
  });

  it("does not send RPCs after socket authentication is rejected", async () => {
    const fake = await startFakeCmuxServer({
      onRequest(request, socket, server) {
        server.reply(socket, request.id, { authenticated: false });
      },
    });
    const client = new CmuxClient({
      socketPath: fake.path,
      socketPassword: "wrong-secret",
    });

    try {
      await expect(client.request("system.ping", {})).rejects.toThrow(
        "cmux_auth_failed",
      );
      expect(fake.requests.map(({ method }) => method)).toEqual(["auth.login"]);
    } finally {
      client.disconnect();
      await fake.close();
    }
  });

  it("enforces the pending request bound", async () => {
    const fake = await startFakeCmuxServer();
    const client = new CmuxClient({
      socketPath: fake.path,
      maxPending: 1,
      requestTimeoutMs: 50,
    });

    try {
      const first = client.request("first", {});
      await expect(client.request("second", {})).rejects.toThrow("cmux_busy");
      await expect(first).rejects.toThrow("cmux_timeout");
    } finally {
      client.disconnect();
      await fake.close();
    }
  });
});
