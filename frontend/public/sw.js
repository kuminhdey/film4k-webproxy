const CACHE_NAME = 'bofilm-shell-v5';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/logo.png',
  '/logo-64.png',
  '/favicon.ico',
  '/favicon-32.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

const STREAM_MEDIA_EXT_RE = /\.(m3u8|ts|m4s|mp4|aac|mp3|vtt|srt)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('PWA Precache failed for some assets:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => {
              console.log('[SW] Purging old cache storage:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  // Never intercept non-HTTP(S) schemes or cross-origin CDN/media requests
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Never cache or intercept API endpoints, proxy queries, streaming playlists, subtitles, or video segments
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/stream/') ||
    url.pathname.startsWith('/proxy/') ||
    url.pathname === '/sw.js' ||
    url.searchParams.has('url') ||
    STREAM_MEDIA_EXT_RE.test(url.pathname)
  ) {
    return;
  }

  // Network first for HTML navigation to ensure SPA always gets the latest bundle hashes
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).catch(async () => {
        return (
          (await caches.match('/')) ||
          (await caches.match('/index.html')) ||
          Response.error()
        );
      })
    );
    return;
  }

  // Stale-while-revalidate for static shell assets only
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone).catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse || Response.error());

      return cachedResponse || fetchPromise;
    })
  );
});
