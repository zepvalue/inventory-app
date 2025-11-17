// A unique name for our cache. Change this whenever you update the service worker file.
const CACHE_NAME = 'inventory-inventory-cache-v7'; // Incremented version

// The list of core files to pre-cache when the service worker is installed.
const urlsToCache = [
  '/',
  '/dashboard',
  '/offline.html'
];

// Install event: opens the cache and adds the core files to it.
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // Activate new worker immediately
  );
});

// Activate event: cleans up old caches.
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('[SW] Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Take control of all pages
  );
});

// Fetch event: Implements a robust cache-first, then network, with offline fallback strategy.
self.addEventListener('fetch', (event) => {
  // We only handle GET requests.
  if (event.request.method !== 'GET') {
    return;
  }
  // We don't cache API calls.
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    // 1. Try to find the request in the cache.
    caches.match(event.request)
      .then((cachedResponse) => {
        // 2. If it's in the cache, return it immediately.
        if (cachedResponse) {
          // In the background, fetch a fresh version from the network to keep the cache up-to-date.
          fetch(event.request).then((networkResponse) => {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          });
          return cachedResponse;
        }

        // 3. If it's not in the cache, fetch it from the network.
        return fetch(event.request).then((networkResponse) => {
          // And cache the new response for next time.
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
      .catch(() => {
        // 4. If both the cache and network fail, show the offline fallback page.
        if (event.request.mode === 'navigate') {
          return caches.match('/offline.html');
        }
      })
  );
});
