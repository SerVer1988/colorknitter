const CACHE = 'colorknitter-v10';
const FILES = ['/colorknitter/', '/colorknitter/index.html', '/colorknitter/icon.png', '/colorknitter/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Для HTML — всегда сеть, кеш только если нет сети
  if (e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request).then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Для остального — кеш, потом сеть
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
