const CACHE_VERSION = "v1";
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

const ASSETS_TO_CACHE = [
  "/",
  "/offline.html",
  "/styles.css",
  "/app.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

// INSTALL
self.addEventListener("install", event => {
  console.log("SW installé");
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
});

// ACTIVATE
self.addEventListener("activate", event => {
  console.log("SW activé");
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== STATIC_CACHE) return caches.delete(key);
        })
      )
    )
  );
  return self.clients.claim();
});

// FETCH
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const request = event.request;

  // HTML → network-first
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(request)
        .then(response => response)
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Assets → cache-first
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});
