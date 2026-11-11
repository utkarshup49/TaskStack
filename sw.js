// Service worker: lets TaskStack open without internet.
// When you change any file, bump CACHE_NAME (v1 -> v2) so phones pick up the new version.
const CACHE_NAME = 'taskstack-v28';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/core.js',
  './js/repeat.js',
  './js/lists.js',
  './js/remind.js',
  './js/matrix.js',
  './js/tasks.js',
  './js/calendar.js', './js/calplus.js', './js/tasksplus.js',
  './js/focus.js',
  './js/habits.js',
  './js/colortracker.js',
  './js/kinds.js',
  './js/ctstats.js',
  './js/ctview.js',
  './js/ctlog.js', './js/ctexport.js',
  './js/notes.js', './js/plan.js',
  './js/profile.js', './js/navbar.js',
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
  const own = url.origin === self.location.origin;
  if (!own && url.hostname.indexOf('fonts.') !== 0) return;
  // GitHub Pages lets the browser reuse files for 10 minutes. 'no-cache' asks the server every time
  // (a tiny "not changed" reply when nothing changed), so an update shows up on the next open.
  // (A page-load request can't be copied with options, so fetch its URL instead.)
  const live = own ? fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(event.request);
  event.respondWith(
    live
      .then(function (response) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return response;
      })
      // offline: a page opened as ./?do=add (home-screen shortcut) still finds the cached page
      .catch(function () { return caches.match(event.request, { ignoreSearch: event.request.mode === 'navigate' }); })
  );
});

// Tapping a reminder notification (or its Done / Snooze button): tell the open app, or open it.
self.addEventListener('notificationclick', function (event) {
  const data = event.notification.data || {};
  const action = event.action || 'open';
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      const msg = { type: 'note', action: action, taskId: data.taskId || null, view: data.view || null };
      if (list.length) {
        const c = list[0];
        c.postMessage(msg);
        return c.focus ? c.focus() : null;
      }
      const q = '?note=' + encodeURIComponent(action) + (data.taskId ? '&task=' + encodeURIComponent(data.taskId) : '') + (data.view ? '&view=' + encodeURIComponent(data.view) : '');
      return self.clients.openWindow('./' + q + '#' + (data.view || 'tasks'));
    })
  );
});
