const CACHE_NAME = 'dng-patrol-v35';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './app.js',
  './manifest.json',
  './favicons/favicon.ico',
  './favicons/favicon-16x16.png',
  './favicons/favicon-32x32.png',
  './favicons/favicon-48x48.png',
  './favicons/apple-touch-icon.png',
  './favicons/android-chrome-192x192.png',
  './favicons/android-chrome-512x512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-First стратегия: при наличии интернета берутся свежие файлы кода, при офлайне — из кэша
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Для спутниковых тайлов карт (Google / Esri / OSM) — Cache-First (экономия мобильного трафика)
  if (e.request.url.includes('google.com') || e.request.url.includes('arcgisonline.com') || e.request.url.includes('openstreetmap.org')) {
    e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
    return;
  }

  // Для всех файлов скриптов и стилей приложения — Network-First
  e.respondWith(
    fetch(e.request)
      .then(networkRes => {
        if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, resClone));
        }
        return networkRes;
      })
      .catch(() => caches.match(e.request))
  );
});
