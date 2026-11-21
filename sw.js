// Offline support: the app shell is network-first (so updates arrive right away)
// with a cached fallback; posters are cached as you browse.
const SHELL_CACHE = 'upnext-shell-v1';
const IMG_CACHE = 'upnext-img-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'js/app.js', 'js/api.js', 'js/store.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL_CACHE, IMG_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
    );
    return;
  }

  if (url.hostname === 'static.tvmaze.com') {
    e.respondWith(
      caches.open(IMG_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      }))),
    );
  }
  // api.tvmaze.com goes straight to the network — the app keeps its own episode cache.
});
