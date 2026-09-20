/* CozyMaker — the service worker deliberately caches nothing of the app.
 * A fix the writer cannot see because a stale copy was served is the same as
 * a fix that was never made. It exists only so the app can be installed to the
 * home screen. */
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => { /* straight to the network, always */ });
