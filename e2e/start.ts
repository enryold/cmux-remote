import { startServer } from "../server/src/index";
import {
  E2E_CAPABILITY,
  E2E_PAIRING_CODE,
  E2E_TOKEN,
} from "./helpers";
import { startFakeCmux } from "./fake-cmux";

const fake = await startFakeCmux();
// Test runner only. This control server is never part of the production bridge.
const controls = Bun.serve({ hostname: "127.0.0.1", port: 3458, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/calls" && request.method === "GET") return Response.json(fake.calls);
  if (request.method === "POST" && (path === "/uploads/fail" || path === "/uploads/reset")) {
    fake.configureUploads(path === "/uploads/fail"); return new Response(null, { status: 204 });
  }
  if (request.method === "POST" && (path === "/reset" || path === "/fail" || path === "/close")) {
    fake.configurePreview(path.slice(1) as "reset" | "fail" | "close"); return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 404 });
} });
const server = startServer({
  hostname: "127.0.0.1",
  port: 3457,
  remoteToken: E2E_TOKEN,
  publicOrigin: null,
  tailscaleCapability: E2E_CAPABILITY,
  pairingCode: E2E_PAIRING_CODE,
  socketPath: fake.socketPath,
  socketPassword: "e2e-cmux-password",
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await controls.stop(true);
  await server.stop(true);
  await fake.close();
  process.exit(0);
}

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
