import { describe, expect, it } from "bun:test";
import { JsonLineConnection } from "../cmux-connection";
import { eventually, startFakeCmuxServer } from "./fake-cmux";

describe("JsonLineConnection", () => {
  it("reassembles split frames and preserves frame order", async () => {
    const fake = await startFakeCmuxServer({
      onConnect(socket) {
        socket.write('{"id":"1","ok":');
        socket.write('true}\n{"id":"2","ok":true}\n');
      },
    });

    try {
      const connection = await JsonLineConnection.connect({
        socketPath: fake.path,
      });
      expect(await connection.read()).toEqual({ id: "1", ok: true });
      expect(await connection.read()).toEqual({ id: "2", ok: true });
      connection.close();
    } finally {
      await fake.close();
    }
  });

  it("closes on an oversized line", async () => {
    const fake = await startFakeCmuxServer({
      onConnect(socket) {
        socket.write(`{"x":"${"a".repeat(4_200_000)}"}\n`);
      },
    });

    try {
      const connection = await JsonLineConnection.connect({
        socketPath: fake.path,
      });
      await expect(connection.read()).rejects.toThrow("frame_limit");
    } finally {
      await fake.close();
    }
  });

  it("closes when more than 64 complete frames are queued", async () => {
    const fake = await startFakeCmuxServer({
      onConnect(socket) {
        for (let index = 0; index < 65; index += 1) {
          socket.write(`{"index":${index}}\n`);
        }
      },
    });

    try {
      const connection = await JsonLineConnection.connect({
        socketPath: fake.path,
      });
      await eventually(() => expect(connection.isOpen).toBe(false));
      await expect(connection.read()).rejects.toThrow("frame_queue_limit");
    } finally {
      await fake.close();
    }
  });
});
