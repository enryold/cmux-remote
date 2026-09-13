/// <reference lib="webworker" />

const CACHE_NAME = "cmux-remote-static-v1";
const STATIC_PATHS = new Set([
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
]);

export function isCacheableRequest(request: Request, origin: string): boolean {
  const url = new URL(request.url);
  return (
    request.method === "GET" &&
    url.origin === origin &&
    (url.pathname.startsWith("/assets/") || STATIC_PATHS.has(url.pathname))
  );
}

if ("skipWaiting" in globalThis) {
  const worker = globalThis as unknown as ServiceWorkerGlobalScope;

  worker.addEventListener("install", (event) => {
    event.waitUntil(worker.skipWaiting());
  });

  worker.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then(async (names) => {
        await Promise.all(
          names
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        );
        await worker.clients.claim();
      }),
    );
  });

  worker.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.mode === "navigate") {
      event.respondWith(
        fetch(request).catch(
          () =>
            new Response("<!doctype html><title>Offline</title><p>cmux Remote is offline</p>", {
              status: 503,
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
        ),
      );
      return;
    }
    if (!isCacheableRequest(request, worker.location.origin)) return;

    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? Response.error()),
    );
  });
}
