// Cora's Creations — Service Worker v4
const CACHE = 'coras-creations-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/coaster-butterfly.jpeg',
  '/dragon-jar.jpeg',
  '/galaxy-tray.jpeg',
  '/dragon-figure.jpeg',
  '/flower-dish.jpeg'
];

// Install — delete ALL old caches immediately, then cache fresh files
self.addEventListener('install', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => caches.open(CACHE).then(c => c.addAll(ASSETS)))
  );
  self.skipWaiting();
});

// Activate — take control of all clients immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, cache as fallback (always tries fresh content)
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
