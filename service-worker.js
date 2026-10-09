/* Thought Cards — service worker
   Caches only the app's own static files so it opens offline after the first visit.
   Strategy: network first (always fresh when online), cache as offline fallback.
   Bump CACHE_VERSION when you publish changes. */

const CACHE_PREFIX = 'thought-cards-';
const CACHE_VERSION = 'v1.2.0';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts etc. are left to the browser

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});

/* Push from the reminder server: a time reminder, the daily recap or a test.
   Every push must show a notification (iOS stops delivering otherwise). */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const options = {
    body: data.body || 'Something is waiting for you in your Thought Bank.',
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    // A recap notification opens the Daily recap screen.
    data: { url: data.kind === 'recap' ? './#recap' : (data.url || './'), thoughtId: data.thoughtId || null, kind: data.kind || null },
  };
  if (data.tag) { options.tag = data.tag; options.renotify = true; }
  event.waitUntil(self.registration.showNotification(data.title || 'Thought Cards', options));
});

/* Tapping a notification opens the app on the right thought (or the Thought Bank for a recap). */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((c) => c.url.startsWith(self.registration.scope));
    if (client) {
      try { await client.focus(); } catch (_) { /* some browsers refuse focus */ }
      client.postMessage({ type: 'open-from-notification', thoughtId: data.thoughtId, kind: data.kind });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
