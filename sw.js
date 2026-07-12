// Service Worker: オフラインキャッシュ & PWAインストール要件を満たすため
// バージョンを上げるとキャッシュが入れ替わります。ファイルを更新したら CACHE_NAME を変更してください。
const CACHE_NAME = 'voyagelog-cache-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './constants.js',
  './date-utils.js',
  './recurrence.js',
  './ics-export.js',
  './calendar-grid.js',
  './icons.jsx',
  './VoyageLog.jsx',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// CDN依存(React / Babel / Tailwind)。ネットワーク優先だが、取得できたらキャッシュしておく。
const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
  'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/@babel/standalone@7.24.7/babel.min.js',
  'https://cdn.tailwindcss.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const isCDN = CDN_URLS.some((u) => req.url.startsWith(u.split('?')[0]));

  if (isCDN) {
    // CDNファイル: ネットワーク優先、失敗したらキャッシュにフォールバック
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // 自前ファイル: キャッシュ優先、裏で更新
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
