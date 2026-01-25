self.addEventListener("install", event => {
  console.log("Service Worker installé");
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  console.log("Service Worker actif");
});

self.addEventListener("fetch", event => {
  // pour l’instant : aucun cache
});
