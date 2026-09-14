import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface RequestFrame {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface FakeCmuxControl {
  socketPath: string;
  close(): Promise<void>;
}

const API_SURFACE = "11111111-1111-4111-8111-111111111111";
const UI_SURFACE = "22222222-2222-4222-8222-222222222222";
const NEW_SURFACE = "33333333-3333-4333-8333-333333333333";
const SERVER_SURFACE = "44444444-4444-4444-8444-444444444444";
const TESTS_SURFACE = "55555555-5555-4555-8555-555555555555";
const SHELL_SURFACE = "66666666-6666-4666-8666-666666666666";
const BACKEND_SURFACE = "77777777-7777-4777-8777-777777777777";
const LOGS_SURFACE = "88888888-8888-4888-8888-888888888888";
const WORKER_SURFACE = "12121212-1212-4212-8212-121212121212";

export async function startFakeCmux(): Promise<FakeCmuxControl> {
  const directory = await mkdtemp(join(tmpdir(), "cmux-remote-e2e-"));
  const socketPath = join(directory, "cmux.sock");
  const connections = new Set<Socket>();
  const eventSockets = new Set<Socket>();
  const outputs = new Map([
    [API_SURFACE, "api ready\n"],
    [UI_SURFACE, "ui ready\n"],
    [NEW_SURFACE, "new terminal ready\n"],
    [SERVER_SURFACE, "server ready\n"],
    [TESTS_SURFACE, "tests ready\n"],
    [SHELL_SURFACE, "shell ready\n"],
    [BACKEND_SURFACE, "backend ready\n"],
    [LOGS_SURFACE, "logs ready\n"],
    [WORKER_SURFACE, "worker ready\n"],
  ]);
  let newSurfaceVisible = false;
  let eventTimer: ReturnType<typeof setTimeout> | null = null;

  const tree = () => ({
    windows: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        workspaces: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            title: "CODEX",
            index: 0,
            selected: true,
            panes: [
              {
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                index: 0,
                focused: true,
                surfaces: [
                  {
                    id: API_SURFACE,
                    type: "terminal",
                    title: "API Agent",
                    index: 0,
                    selected: true,
                  },
                  {
                    id: SERVER_SURFACE,
                    type: "terminal",
                    title: "Dev server",
                    index: 1,
                    selected: false,
                  },
                  {
                    id: TESTS_SURFACE,
                    type: "terminal",
                    title: "Tests",
                    index: 2,
                    selected: false,
                  },
                  {
                    id: SHELL_SURFACE,
                    type: "terminal",
                    title: "Shell",
                    index: 3,
                    selected: false,
                  },
                  {
                    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    type: "browser",
                    title: "localhost:3000",
                    index: 4,
                    selected: false,
                  },
                  ...(newSurfaceVisible
                    ? [
                        {
                          id: NEW_SURFACE,
                          type: "terminal",
                          title: "New terminal",
                          index: 5,
                          selected: false,
                        },
                      ]
                    : []),
                ],
              },
            ],
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            title: "CLAUDE",
            index: 1,
            selected: false,
            panes: [
              {
                id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                index: 0,
                focused: false,
                surfaces: [
                  {
                    id: UI_SURFACE,
                    type: "terminal",
                    title: "UI Agent",
                    index: 0,
                    selected: true,
                  },
                  {
                    id: BACKEND_SURFACE,
                    type: "terminal",
                    title: "Backend",
                    index: 1,
                    selected: false,
                  },
                  {
                    id: LOGS_SURFACE,
                    type: "terminal",
                    title: "Logs",
                    index: 2,
                    selected: false,
                  },
                  {
                    id: WORKER_SURFACE,
                    type: "terminal",
                    title: "Worker",
                    index: 3,
                    selected: false,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  const send = (socket: Socket, frame: unknown) => {
    socket.write(`${JSON.stringify(frame)}\n`);
  };
  const reply = (socket: Socket, id: string, result: unknown) => {
    send(socket, { id, ok: true, result });
  };
  const fail = (socket: Socket, id: string, code: string) => {
    send(socket, { id, ok: false, error: { code, message: code } });
  };

  const handle = (request: RequestFrame, socket: Socket) => {
    if (request.method === "auth.login") {
      if (request.params.password === "e2e-cmux-password") {
        reply(socket, request.id, { authenticated: true });
      } else fail(socket, request.id, "authentication_failed");
      return;
    }
    if (request.method === "system.ping") {
      reply(socket, request.id, { pong: true });
      return;
    }
    if (request.method === "system.capabilities") {
      reply(socket, request.id, {
        protocol: "cmux-jsonrpc",
        version: 2,
        access_mode: "full",
        capabilities: ["terminal.viewport.v1", "events.stream.v1"],
      });
      return;
    }
    if (request.method === "system.tree") {
      reply(socket, request.id, tree());
      return;
    }
    if (request.method === "surface.read_text") {
      const surface = request.params.surface_id;
      if (typeof surface !== "string" || !outputs.has(surface)) {
        fail(socket, request.id, "surface_not_found");
      } else reply(socket, request.id, { text: outputs.get(surface) });
      return;
    }
    if (request.method === "surface.send_text") {
      const surface = request.params.surface_id;
      const text = request.params.text;
      if (typeof surface !== "string" || typeof text !== "string" || !outputs.has(surface)) {
        fail(socket, request.id, "invalid_params");
      } else {
        outputs.set(surface, `${outputs.get(surface)}${text}`);
        reply(socket, request.id, { accepted: true });
      }
      return;
    }
    if (request.method === "surface.send_key") {
      const surface = request.params.surface_id;
      const key = request.params.key;
      if (typeof surface !== "string" || typeof key !== "string" || !outputs.has(surface)) {
        fail(socket, request.id, "invalid_params");
      } else {
        outputs.set(surface, `${outputs.get(surface)}<${key}>`);
        reply(socket, request.id, { accepted: true });
      }
      return;
    }
    if (request.method === "terminal.viewport") {
      const surface = request.params.surface_id;
      if (typeof surface !== "string") {
        fail(socket, request.id, "invalid_params");
      } else if (request.params.clear === true) {
        reply(socket, request.id, { surface_id: surface });
      } else {
        reply(socket, request.id, {
          surface_id: surface,
          columns: request.params.viewport_columns,
          rows: request.params.viewport_rows,
        });
      }
      return;
    }
    if (request.method === "events.stream") {
      eventSockets.add(socket);
      send(socket, {
        type: "ack",
        protocol: "cmux-events",
        version: 1,
        resume: { gap: false },
      });
      if (eventTimer === null && !newSurfaceVisible) {
        eventTimer = setTimeout(() => {
          newSurfaceVisible = true;
          for (const eventSocket of eventSockets) {
            send(eventSocket, {
              type: "event",
              seq: 1,
              name: "surface.created",
            });
          }
        }, 1_500);
      }
      return;
    }
    fail(socket, request.id, "method_not_found");
  };

  const server: Server = createServer((socket) => {
    connections.add(socket);
    socket.once("close", () => {
      connections.delete(socket);
      eventSockets.delete(socket);
    });
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        try {
          handle(JSON.parse(line) as RequestFrame, socket);
        } catch {
          socket.destroy();
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    socketPath,
    async close() {
      if (eventTimer !== null) clearTimeout(eventTimer);
      for (const socket of connections) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
}
