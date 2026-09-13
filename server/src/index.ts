import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import {
  createAuthRoutes,
  isAllowedOrigin,
  isAuthenticated,
} from "./auth";
import { loadConfig, type RuntimeConfig } from "./config";
import { health } from "./health";
import { createWebSocketHandler } from "./ws";

const clientDistPath = join(import.meta.dir, "../../client/dist");

export function startServer(config: RuntimeConfig) {
  const app = new Hono();
  app.route("/", health);
  app.route("/", createAuthRoutes(config));
  app.use("/*", serveStatic({ root: clientDistPath }));

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
        return bunServer.upgrade(request, { data: {} as never })
          ? undefined
          : new Response("WebSocket upgrade failed", { status: 400 });
      }
      return app.fetch(request, bunServer);
    },
    websocket: createWebSocketHandler(),
  });

  console.log(
    `[server] cmux-remote bridge running on http://${config.hostname}:${server.port}`,
  );
  return server;
}

if (import.meta.main) {
  startServer(loadConfig(process.env));
}
