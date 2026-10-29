// При любом изменении файлов приложения увеличивайте номер версии,
// иначе у пользователей останется старая версия из кеша.
const CACHE = 'colorknitter-v7';

const FILES = [
  './',
  './index.html',
  './generator.html',
  './manifest.json',
  './css/common.css',
  './css/knitter.css',
  './css/generator.css',
  './js/pwa.js',
  './js/knitter-boot.js',
  './js/stringart-core.js',
  './js/generator.js',
  './img/logo.png',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/ui/ic_back.png',
  './img/ui/ic_music.png',
  './img/ui/ic_next.png',
  './img/ui/ic_pause.png',
  './img/ui/ic_play.png',
  './img/ui/ic_settings.png',
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

// Удаляем кеши старых версий
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
