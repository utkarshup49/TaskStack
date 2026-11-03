// Service worker: lets TaskStack open without internet.
// When you change any file, bump CACHE_NAME (v1 -> v2) so phones pick up the new version.
const CACHE_NAME = 'taskstack-v11';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/core.js',
  './js/matrix.js',
  './js/tasks.js',
  './js/calendar.js',
  './js/focus.js',
  './js/habits.js',
  './js/colortracker.js',
  './js/sync.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(FILES); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  // delete caches from older versions
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Network first, cache as fallback: you always get the latest version when online.
// Only the app's own files and its fonts: Google sign-in and Drive requests must always go to the network.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin && url.hostname.indexOf('fonts.') !== 0) return;
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return response;
      })
      .catch(function () { return caches.match(event.request); })
  );
});
