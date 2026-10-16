const CACHE_NAME = 'dng-patrol-v11';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './app.js',
  './xlsx-populate.min.js',
  './Суточный_рапорт.xlsx',
  './manifest.json',
  './favicons/favicon.ico',
  './favicons/favicon-16x16.png',
  './favicons/favicon-32x32.png',
  './favicons/favicon-48x48.png',
  './favicons/apple-touch-icon.png',
  './favicons/android-chrome-192x192.png',
  './favicons/android-chrome-512x512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Кэшируем каждый ресурс устойчиво: сбой внешнего URL не ломает оффлайн-кэш локальных файлов
      await Promise.allSettled(ASSETS.map(url => cache.add(url)));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(
      ks.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // 1. Запросы к Google Apps Script (синхронизация) — только сеть, никогда не кэшировать
  if (url.includes('script.google.com') || url.includes('script.googleusercontent.com')) {
    return;
  }

  // 2. Для всех файлов приложения — Network-First (при наличии сети берем свежие, в оффлайне — из кэша)
  e.respondWith(
    fetch(e.request)
      .then(networkRes => {
        if (networkRes && (networkRes.status === 200 || networkRes.type === 'basic' || networkRes.type === 'cors')) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, resClone));
        }
        return networkRes;
      })
      .catch(() => caches.match(e.request).then(cached => {
        if (cached) return cached;
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html') || caches.match('./');
        }
        return null;
      }))
  );
});
