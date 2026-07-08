const CACHE = 'runsheet-v4';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/geo.js',
  './js/optimizer.js',
  './js/setup.js',
  './js/scheduled.js',
  './js/photos.js',
  './js/hud.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-maskable.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// App shell: network-first so a fresh deploy is always picked up while online;
// falls back to cache only when offline. (ORS API calls, maps links: untouched,
// no same-origin match so they always go straight to network.)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;
  if(event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).then((res) => {
      if(res.ok){
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
      }
      return res;
    }).catch(() =>
      caches.match(event.request).then((cached) =>
        cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : undefined)
      )
    )
  );
});
