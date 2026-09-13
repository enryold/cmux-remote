import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        sw: resolve(import.meta.dirname, "src/service-worker.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
      },
    },
  },
  server: {
    proxy: {
      "/auth": {
        target: "http://localhost:3456",
      },
      "/ws": {
        target: "ws://localhost:3456",
        ws: true,
      },
      "/health": {
        target: "http://localhost:3456",
      },
    },
  },
});
