import { startServer } from "../server/src/index";
import { E2E_TOKEN } from "./helpers";
import { startFakeCmux } from "./fake-cmux";

const fake = await startFakeCmux();
const server = startServer({
  hostname: "127.0.0.1",
  port: 3457,
  remoteToken: E2E_TOKEN,
  publicOrigin: null,
  tailscaleCapability: null,
  pairingCode: null,
  socketPath: fake.socketPath,
  socketPassword: "e2e-cmux-password",
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop(true);
  await fake.close();
  process.exit(0);
}

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
