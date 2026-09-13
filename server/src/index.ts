import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import {
  createAuthRoutes,
  createPairingChallenge,
  isAllowedOrigin,
  isAuthenticated,
} from "./auth";
import { CmuxEventStream } from "./cmux-events";
import { loadConfig, type RuntimeConfig } from "./config";
import { createHealthRoutes } from "./health";
import { createWebSocketData, createWebSocketHandler } from "./ws";

const clientDistPath = join(import.meta.dir, "../../client/dist");

export interface RunningServer {
  port: number;
  stop(closeActiveConnections?: boolean): Promise<void>;
}

export function startServer(config: RuntimeConfig): RunningServer {
  const app = new Hono();
  const pairingChallenge = config.pairingCode
    ? createPairingChallenge(config.pairingCode)
    : null;
  app.use("*", async (context, next) => {
    await next();
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'none'; connect-src 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    context.header("Referrer-Policy", "no-referrer");
    context.header("X-Content-Type-Options", "nosniff");
    context.header("X-Frame-Options", "DENY");
  });
  app.route("/", createHealthRoutes(config));
  app.route("/", createAuthRoutes(config, pairingChallenge));
  app.use("/*", serveStatic({ root: clientDistPath }));

  const eventStream = new CmuxEventStream({
    socketPath: config.socketPath,
    socketPassword: config.socketPassword,
  });
  void eventStream.start().catch(() => undefined);

  const server = Bun.serve({
    hostname: config.hostname,
    port: config.port,
    fetch(request, bunServer) {
      if (new URL(request.url).pathname === "/ws") {
        if (
          !isAllowedOrigin(request, config) ||
          !isAuthenticated(request, config)
        ) {
          return new Response("Unauthorized", { status: 401 });
        }
        return bunServer.upgrade(request, { data: createWebSocketData() })
          ? undefined
          : new Response("WebSocket upgrade failed", { status: 400 });
      }
      return app.fetch(request, bunServer);
    },
    websocket: createWebSocketHandler({ config, eventStream }),
  });

  console.log(
    `[server] cmux-remote bridge running on http://${config.hostname}:${server.port}`,
  );
  if (config.pairingCode) {
    console.log(
      `[auth] pairing code ${config.pairingCode} (expires in 10 minutes)`,
    );
  }
  return {
    port: server.port ?? config.port,
    async stop(closeActiveConnections) {
      eventStream.stop();
      await server.stop(closeActiveConnections);
    },
  };
}

if (import.meta.main) {
  startServer(loadConfig(process.env));
}
