import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeCmuxRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface FakeCmuxServer {
  path: string;
  requests: FakeCmuxRequest[];
  connections: Set<Socket>;
  reply(socket: Socket, id: string, result: unknown): void;
  fail(socket: Socket, id: string, code: string, message: string): void;
  send(socket: Socket, frame: unknown): void;
  disconnectAll(): void;
  close(): Promise<void>;
}

export async function startFakeCmuxServer(options: {
  onConnect?: (socket: Socket, server: FakeCmuxServer) => void;
  onRequest?: (
    request: FakeCmuxRequest,
    socket: Socket,
    server: FakeCmuxServer,
  ) => void;
} = {}): Promise<FakeCmuxServer> {
  const directory = await mkdtemp(join(tmpdir(), "cmux-remote-"));
  const socketPath = join(directory, "cmux.sock");
  const connections = new Set<Socket>();
  const requests: FakeCmuxRequest[] = [];
  let closed = false;
  let server: Server;

  const fake: FakeCmuxServer = {
    path: socketPath,
    requests,
    connections,
    reply(socket, id, result) {
      fake.send(socket, { id, ok: true, result });
    },
    fail(socket, id, code, message) {
      fake.send(socket, { id, ok: false, error: { code, message } });
    },
    send(socket, frame) {
      socket.write(`${JSON.stringify(frame)}\n`);
    },
    disconnectAll() {
      for (const socket of connections) socket.destroy();
    },
    async close() {
      if (closed) return;
      closed = true;
      fake.disconnectAll();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(directory, { recursive: true, force: true });
    },
  };

  server = createServer((socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));

    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const request = JSON.parse(line) as FakeCmuxRequest;
        requests.push(request);
        options.onRequest?.(request, socket, fake);
      }
    });

    options.onConnect?.(socket, fake);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return fake;
}

export async function eventually(
  assertion: () => void,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(10);
    }
  }
  throw lastError;
}
