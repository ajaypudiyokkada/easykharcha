// EasyKharcha service worker — registered only in production builds (see
// src/pwa/registerServiceWorker.ts). Bump CACHE_VERSION on every release that should push existing
// clients onto a fresh cache; the old one is deleted on activate.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `easykharcha-shell-${CACHE_VERSION}`;

// Never cached, regardless of method: the backend API, anything auth-related, and uploaded media
// (business logos) — all of it needs to be live, not a stale snapshot.
function isNeverCached(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/');
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only GET is ever cached or served from cache — every write always goes straight to the network,
  // untouched by this worker (and the app itself already refuses to send one at all while offline;
  // see src/api/client.ts).
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isNeverCached(url)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);

      if (request.mode === 'navigate') {
        // Network-first for the HTML shell itself, so a logged-in user always sees the latest
        // build when online; falls back to whatever shell is cached (or the cached "/") when not.
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          return (await cache.match(request)) || (await cache.match('/')) || cached;
        }
      }

      // Cache-first for everything else same-origin (hashed JS/CSS bundles, bundled fonts, icons) —
      // their filenames change when their content does, so a cache hit is always still correct.
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
