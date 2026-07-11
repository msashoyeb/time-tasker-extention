/* ============================================================================
   service-worker.js  —  makes the app work offline and be installable.

   It caches the app's own files (the "shell") so the app opens with no
   internet. Requests to OTHER sites (your Google Apps Script, the Hijri date
   API) are left alone so they always hit the live network.

   If you change any app file, bump CACHE_VERSION so phones fetch the new copy.
   ========================================================================== */

var CACHE_VERSION = "tt-mobile-v1";

var APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./chrome-shim.js",
  "./zip.js",
  "./sync.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon48.png",
  "./icons/icon128.png",
  "./icons/icon192.png",
  "./icons/icon512.png",
  "./icons/maskable512.png",
];

// Install: pre-cache the app shell.
self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (c) { return c.addAll(APP_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

// Activate: delete old caches from previous versions.
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Fetch: serve app files from cache; let everything else go to the network.
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);

  // Other origins (script.google.com, api.aladhan.com) -> normal network.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request);
    })
  );
});
