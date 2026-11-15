// sw.js: offline support. App files are cached on install; decks are network-first
// (so a new lesson shows up as soon as you are online) with the cache as fallback.
const VERSION = 'wortkiste-v1.0.0';
const SHELL = [
  './', 'index.html', 'app.js', 'srs.js', 'decks.js', 'queue.js', 'store.js', 'audio.js', 'modes.js',
  'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'decks/index.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    try {
      const idx = await (await fetch('decks/index.json', { cache: 'no-cache' })).json();
      await cache.addAll((idx.decks || []).map((d) => `decks/${encodeURIComponent(d.file)}`));
    } catch { /* decks get cached on first use instead */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isDeck = url.pathname.includes('/decks/');
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const key = req.mode === 'navigate' ? 'index.html' : req;
    if (isDeck) {
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const hit = await cache.match(req, { ignoreSearch: true });
        return hit || new Response('', { status: 504 });
      }
    }
    // App files: answer from cache at once, refresh the cache in the background.
    const hit = await cache.match(key, { ignoreSearch: true });
    const refresh = fetch(req).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => null);
    if (hit) { event.waitUntil(refresh); return hit; }
    return (await refresh) || new Response('Offline', { status: 503 });
  })());
});
