import { homedir } from "node:os";
import { join } from "node:path";
import type { Socket } from "node:net";
import { expect, it } from "bun:test";
import { createPairedSessionValue, SESSION_COOKIE } from "../auth";
import { createAttachmentRoutes, ATTACHMENT_BYTES, ATTACHMENT_CHUNK_BYTES } from "../attachment-routes";
import { TAILSCALE_CAPABILITIES_HEADER } from "../tailscale";
import { eventually, startFakeCmuxServer, type FakeCmuxRequest, type FakeCmuxServer } from "./fake-cmux";
import { PREVIEW_SURFACE, PREVIEW_WORKSPACE, previewConfig, previewTree } from "./preview-fixtures";

const config = { ...previewConfig(), tailscaleCapability: "example.com/cap/cmux-remote" };
function headers(name = "photo.png") {
  const session = createPairedSessionValue(config.remoteToken, Math.floor(Date.now() / 1000) + 60, config.tailscaleCapability);
  return { origin: config.publicOrigin, cookie: `${SESSION_COOKIE}=${session}`,
    [TAILSCALE_CAPABILITIES_HEADER]: JSON.stringify({ [config.tailscaleCapability]: [{ access: true }] }),
    "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) };
}
const route = `/api/surfaces/${PREVIEW_SURFACE}/attachments`;
function nativeReply(request: FakeCmuxRequest, socket: Socket, fake: FakeCmuxServer) {
  if (request.method === "auth.login") { fake.reply(socket, request.id, { authenticated: true }); return; }
  if (request.method === "system.tree") { fake.reply(socket, request.id, previewTree("terminal")); return; }
  const p = request.params;
  fake.reply(socket, request.id, { received_bytes: Number(p.offset) + Buffer.from(String(p.data_b64), "base64").length,
    ...(p.last ? { path: join(homedir(), ".cache/cmux/task-attachments", String(p.operation_id), String(p.file_name)) } : {}) });
}

it("requires exact Origin, paired cookie and capability before reading an upload", async () => {
  const fake = await startFakeCmuxServer({ onRequest: nativeReply });
  const app = createAttachmentRoutes({ ...config, socketPath: fake.path });
  try {
    for (const extra of [{ origin: "" }, { cookie: "" }, { [TAILSCALE_CAPABILITIES_HEADER]: "{}" }]) {
      const response = await app.routes.request(route, { method: "POST", headers: { ...headers(), ...extra }, body: "data" });
      expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(fake.requests).toHaveLength(0);
  } finally { app.close(); await fake.close(); }
});

it("bounds names, UUIDs, content types, declared sizes and streamed bytes before native writes", async () => {
  const fake = await startFakeCmuxServer({ onRequest: nativeReply });
  const app = createAttachmentRoutes({ ...config, socketPath: fake.path });
  try {
    for (const name of ["../secret", "folder\\file", "x\nenter", "a".repeat(181)]) {
      expect((await app.routes.request(route, { method: "POST", headers: headers(name), body: "x" })).status).toBe(422);
    }
    expect((await app.routes.request(route, { method: "POST", headers: { ...headers(), "x-file-name": "%" }, body: "x" })).status).toBe(422);
    expect((await app.routes.request(route, { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: "{}" })).status).toBe(422);
    expect((await app.routes.request(`${route}?path=/private/file`, { method: "POST", headers: headers(), body: "x" })).status).toBe(422);
    expect((await app.routes.request("/api/surfaces/surface:1/attachments", { method: "POST", headers: headers(), body: "x" })).status).toBe(404);
    expect((await app.routes.request(route, { method: "POST", headers: { ...headers(), "content-length": String(ATTACHMENT_BYTES + 1) } })).status).toBe(413);
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(ATTACHMENT_BYTES)); c.enqueue(new Uint8Array(1)); c.close(); } });
    expect((await app.routes.request(route, { method: "POST", headers: headers(), body })).status).toBe(413);
    expect(fake.requests.some((r) => r.method === "mobile.task.attachment.upload")).toBe(false);
  } finally { app.close(); await fake.close(); }
});

it("forwards complete binary chunks under server-owned IDs and returns only a verified path", async () => {
  const fake = await startFakeCmuxServer({ onRequest: nativeReply });
  const app = createAttachmentRoutes({ ...config, socketPath: fake.path, socketPassword: "test-password" });
  const bytes = Buffer.alloc(ATTACHMENT_CHUNK_BYTES + 3, 0xff);
  try {
    const response = await app.routes.request(route, { method: "POST", headers: headers("image 'été'.png"), body: bytes });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const calls = fake.requests.filter((r) => r.method === "mobile.task.attachment.upload");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.params).toMatchObject({ file_name: "image 'été'.png", offset: 0, total_bytes: bytes.length, last: false });
    expect(calls[1]?.params).toMatchObject({ offset: ATTACHMENT_CHUNK_BYTES, last: true });
    expect(calls[0]?.params.operation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]?.params.upload_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1]?.params.operation_id).toBe(calls[0]?.params.operation_id);
    expect(Buffer.concat(calls.map((r) => Buffer.from(String(r.params.data_b64), "base64")))).toEqual(bytes);
    expect(await response.json()).toEqual({ surfaceId: PREVIEW_SURFACE,
      path: join(homedir(), ".cache/cmux/task-attachments", String(calls[0]?.params.operation_id), "image 'été'.png") });
    expect(fake.requests.map((r) => r.method)).toEqual(["auth.login", "system.tree", "mobile.task.attachment.upload", "mobile.task.attachment.upload", "system.tree"]);
  } finally { app.close(); await fake.close(); }
});

it("supports empty files and normalizes hidden filenames using the native contract", async () => {
  const fake = await startFakeCmuxServer({ onRequest: nativeReply });
  const app = createAttachmentRoutes({ ...config, socketPath: fake.path });
  try {
    expect((await app.routes.request(route, { method: "POST", headers: headers(".gitignore") })).status).toBe(200);
    expect(fake.requests.find((r) => r.method === "mobile.task.attachment.upload")?.params).toMatchObject({
      file_name: "gitignore", total_bytes: 0, offset: 0, last: true, data_b64: "",
    });
  } finally { app.close(); await fake.close(); }
});

it("rejects nonterminal and moved surfaces", async () => {
  let type = "browser"; let trees = 0; let workspace = PREVIEW_WORKSPACE;
  const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
    if (request.method === "system.tree") server.reply(socket, request.id, previewTree(type, ++trees % 2 === 0 ? workspace : PREVIEW_WORKSPACE));
    else nativeReply(request, socket, server);
  } });
  const app = createAttachmentRoutes({ ...config, socketPath: fake.path });
  try {
    expect((await app.routes.request(route, { method: "POST", headers: headers(), body: "x" })).status).toBe(404);
    expect(fake.requests.some((r) => r.method === "mobile.task.attachment.upload")).toBe(false);
    type = "terminal"; trees = 0; workspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect((await app.routes.request(route, { method: "POST", headers: headers(), body: "x" })).status).toBe(404);
  } finally { app.close(); await fake.close(); }
});

it("rejects wrong acknowledgments/paths and hides native path-bearing failures", async () => {
  let reply: Record<string, unknown> = { received_bytes: 2 };
  let failure = "";
  const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
    if (request.method !== "mobile.task.attachment.upload") nativeReply(request, socket, server);
    else if (failure) server.fail(socket, request.id, failure, "/private/secret/file");
    else server.reply(socket, request.id, reply);
  } });
  const app = createAttachmentRoutes({ ...config, socketPath: fake.path });
  try {
    for (const path of ["/private/secret/file", "/tmp/file", `${homedir()}/.cache/cmux/task-attachments/../file`]) {
      reply = { received_bytes: 1, path };
      const response = await app.routes.request(route, { method: "POST", headers: headers(), body: "x" });
      expect(response.status).toBe(502); expect(JSON.stringify(await response.json())).not.toContain(path);
    }
    reply = { received_bytes: 2 };
    expect((await app.routes.request(route, { method: "POST", headers: headers(), body: "x" })).status).toBe(502);
    failure = "method_not_found";
    expect((await app.routes.request(route, { method: "POST", headers: headers(), body: "x" })).status).toBe(422);
    failure = "internal_error";
    expect(await (await app.routes.request(route, { method: "POST", headers: headers(), body: "x" })).json()).toEqual({ error: { code: "upload_failed" } });
  } finally { app.close(); await fake.close(); }
});

it("bounds concurrency and cancels stalled bodies/native calls without replay", async () => {
  let hold = true;
  const fake = await startFakeCmuxServer({ onRequest(request, socket, server) {
    if (hold && request.method === "mobile.task.attachment.upload") return;
    nativeReply(request, socket, server);
  } });
  const app = createAttachmentRoutes({ ...config, socketPath: fake.path }, { deadlineMs: 200 });
  try {
    const pending = app.routes.request(route, { method: "POST", headers: headers(), body: "x" });
    await eventually(() => expect(fake.requests.some((r) => r.method === "mobile.task.attachment.upload")).toBe(true));
    expect((await app.routes.request(route, { method: "POST", headers: headers(), body: "x" })).status).toBe(429);
    expect((await pending).status).toBe(504);
    hold = false;
    expect((await app.routes.request(route, { method: "POST", headers: headers(), body: "x" })).status).toBe(200);
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    expect((await app.routes.request(route, { method: "POST", headers: headers(), body })).status).toBe(504);
    expect(cancelled).toBe(true);
    const controller = new AbortController();
    const aborted = app.routes.request(route, { method: "POST", headers: headers(), signal: controller.signal, body: new ReadableStream() });
    controller.abort();
    expect((await aborted).status).toBe(502);
    expect((await app.routes.request(route, { method: "POST", headers: headers(), body: "x" })).status).toBe(200);
  } finally { app.close(); await fake.close(); }
});
