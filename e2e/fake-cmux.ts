import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PREVIEW_IMAGE } from "./preview-image";

interface RequestFrame {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface FakeCmuxControl {
  socketPath: string;
  calls: Array<{ method: string; surfaceId: unknown; workspaceId: unknown }>;
  configurePreview(action: "reset" | "fail" | "close"): void;
  configureUploads(fail: boolean): void;
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
  const calls: FakeCmuxControl["calls"] = [];
  let browserVisible = true;
  let browserFailure = false;
  let eventSequence = 0;
  const questions = new Map<string, number>();
  const uploads = new Map<string, { operation: string; name: string; total: number; received: number }>();
  let uploadFailure = false;

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
                  ...(browserVisible ? [{
                    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    type: "browser",
                    title: "Browser preview",
                    url: "https://user:password@preview.example/private?token=secret#fragment",
                    index: 4,
                    selected: false,
                  }] : []),
                  { id: "13131313-1313-4313-8313-131313131313", type: "markdown", title: "Plan.md", index: 6, selected: false },
                  { id: "14141414-1414-4414-8414-141414141414", type: "filepreview", title: "Image.png", index: 7, selected: false },
                  { id: "15151515-1515-4515-8515-151515151515", type: "custom", title: "Other panel", index: 8, selected: false },
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
    calls.push({ method: request.method, surfaceId: request.params.surface_id, workspaceId: request.params.workspace_id });
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
    if (request.method === "mobile.task.attachment.upload") {
      if (uploadFailure) { fail(socket, request.id, "internal_error"); return; }
      const p = request.params;
      if (typeof p.upload_id !== "string" || typeof p.operation_id !== "string" || typeof p.file_name !== "string"
        || !Number.isSafeInteger(p.total_bytes) || Number(p.total_bytes) < 0 || Number(p.total_bytes) > 32 * 1024 * 1024
        || typeof p.data_b64 !== "string" || typeof p.last !== "boolean") {
        fail(socket, request.id, "invalid_params"); return;
      }
      const value = uploads.get(p.upload_id) ?? { operation: p.operation_id, name: p.file_name, total: Number(p.total_bytes), received: 0 };
      const chunk = Buffer.from(p.data_b64, "base64");
      if (chunk.toString("base64") !== p.data_b64 || chunk.length > 3 * 1024 * 1024 || p.offset !== value.received
        || value.operation !== p.operation_id || value.name !== p.file_name || value.total !== p.total_bytes
        || value.received + chunk.length > value.total || (p.last && value.received + chunk.length !== value.total)) {
        fail(socket, request.id, "invalid_params"); return;
      }
      value.received += chunk.length; uploads.set(p.upload_id, value);
      reply(socket, request.id, { received_bytes: value.received,
        ...(p.last ? { path: join(homedir(), ".cache/cmux/task-attachments", value.operation, value.name) } : {}) });
      return;
    }
    if (request.method === "browser.screenshot") {
      if (!browserVisible || request.params.surface_id !== "dddddddd-dddd-4ddd-8ddd-dddddddddddd" || request.params.workspace_id !== "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") fail(socket, request.id, "surface_not_found");
      else if (browserFailure) fail(socket, request.id, "internal_error");
      else reply(socket, request.id, { workspace_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", workspace_ref: "workspace:1", surface_id: "DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD", surface_ref: "surface:2", png_base64: PREVIEW_IMAGE, path: "/private/redacted/preview.png", url: "file:///private/redacted/preview.png" });
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
        if (text === "fixture:question") { questions.set(surface, 0); outputs.set(surface, "Open choices with Shift+Left\n"); }
        else if (text === "fixture:scroll") outputs.set(surface, Array.from({ length: 2000 }, (_, i) => `history ${i}`).join("\n"));
        else if (text === "fixture:append") outputs.set(surface, `${outputs.get(surface)}\n${Array.from({ length: 20 }, (_, i) => `latest append ${i}`).join("\n")}`);
        else if (text === "fixture:replace") outputs.set(surface, `${outputs.get(surface)?.split("\n").slice(0, -1).join("\n")}\nprompt replaced`);
        else outputs.set(surface, `${outputs.get(surface)}${text}`);
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
        if (questions.has(surface)) {
          const choice = questions.get(surface) ?? 0;
          if (key === "shift+left") { questions.set(surface, 1); outputs.set(surface, "Choice 1\n"); }
          else if (key === "down" && choice > 0) { questions.set(surface, 2); outputs.set(surface, "Choice 2\n"); }
          else if (key === "enter" && choice > 0) { questions.delete(surface); outputs.set(surface, `Confirmed choice ${choice}\n`); }
        } else outputs.set(surface, `${outputs.get(surface)}<${key}>`);
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
              seq: ++eventSequence,
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
    calls,
    configureUploads(fail) { uploadFailure = fail; },
    configurePreview(action) {
      if (action === "reset") { browserVisible = true; browserFailure = false; calls.length = 0; }
      else if (action === "fail") browserFailure = true;
      else {
        browserVisible = false;
        const seq = ++eventSequence;
        for (const socket of eventSockets) send(socket, { type: "event", seq, name: "surface.closed" });
      }
    },
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
