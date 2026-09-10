const VERSION = "qmt-v4.0.0";
const CACHE = `${VERSION}-app`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/css/app.css",
  "./assets/js/app.js",
  "./assets/js/config.js",
  "./assets/js/core/db.js",
  "./assets/js/domain/quran.js",
  "./assets/js/domain/memorization.js",
  "./assets/js/domain/plan.js",
  "./assets/js/ui/helpers.js",
  "./assets/images/logo.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/vendor/fontawesome/all.min.js",
  "./data/quran-map.json",
];
const OPTIONAL_ASSETS = [
  "./assets/fonts/SomarSans-Regular.otf",
  "./assets/fonts/SomarSans-Medium.otf",
  "./assets/fonts/SomarSans-Medium.otf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await cache.addAll(APP_SHELL);
        await Promise.all(
          OPTIONAL_ASSETS.map((asset) => cache.add(asset).catch(() => null)),
        );
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("qmt-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
