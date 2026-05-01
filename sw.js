const CACHE = 'colorknitter-v11';
const FILES = [
  '/colorknitter/',
  '/colorknitter/index.html',
  '/colorknitter/generator.html',
  '/colorknitter/icon.png',
  '/colorknitter/manifest.json',
  '/colorknitter/ic_music.png',
  '/colorknitter/ic_back.png',
  '/colorknitter/ic_play.png',
  '/colorknitter/ic_pause.png',
  '/colorknitter/ic_next.png',
  '/colorknitter/ic_settings.png'
];

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
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
