// RoadSleep service worker — minimal, deliberately conservative.
//
// What this enables:
//   - Driver can launch the app from their home screen icon and see *something*
//     even with no signal (cached homepage shell).
//   - Static assets (icons, fonts, CSS) load from cache instantly on repeat visits.
//
// What this does NOT do:
//   - Does NOT cache Supabase API responses (drivers need fresh hotel data).
//   - Does NOT cache Mapbox API responses (locations change).
//   - Does NOT cache any HTML page beyond the homepage shell.
//   - Does NOT do background sync, push notifications, or anything fancy.
//
// Bumping CACHE_VERSION below invalidates all cached assets — do this on any
// significant deploy to make sure drivers get the latest UI on next launch.
//
// IMPORTANT: changes to this file only take effect after the SW is replaced,
// which can take up to 24h on some browsers. Use Chrome DevTools >
// Application > Service Workers > "Update on reload" while testing.

const CACHE_VERSION = 'roadsleep-v4';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// Pre-cache the absolute minimum to render the home screen shell when offline.
// Resist the urge to add more — every line below is a thing that has to update
// when we deploy. Keep it short.
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // addAll fails atomically — if any URL 404s, none cache. Use individual
      // adds with catches so a single bad URL doesn't break offline support.
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch(() => {
            // Silently skip — we'd rather have a partial cache than no cache.
          })
        )
      );
    })
  );
  // Activate immediately — don't wait for old SW pages to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Wipe any cache versions from previous deploys so we don't accumulate
  // megabytes of dead assets on the driver's phone.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GETs. POST/PUT/PATCH go straight to the network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // NEVER cache API calls or third-party services. Drivers need fresh data
  // for hotels, locations, and auth. The list below is intentionally
  // explicit so a future maintainer doesn't accidentally cache something
  // that should be live.
  const isAPI =
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('mapbox.com') ||
    url.hostname.includes('vercel-insights.com') ||
    url.pathname.startsWith('/api/');
  if (isAPI) return;

  // Only cache same-origin assets. No Google Fonts, no CDN images we don't
  // control. Keeps the cache predictable and small.
  if (url.origin !== self.location.origin) return;

  // Strategy: cache-first for static assets, network-first for HTML pages.
  // This gives drivers fast load on icons/CSS/fonts while still letting them
  // see updated copy whenever they have signal.
  const isHTMLDocument =
    request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');

  if (isHTMLDocument) {
    // Network-first for navigations. Falls back to cached homepage on offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Update the cached shell if this was the homepage.
          if (url.pathname === '/' && response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Cache-first for static assets (icons, manifest, etc.)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Only cache successful, basic-type responses (skip 404s, opaque cross-origin)
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
