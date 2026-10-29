// Офлайн-копия приложения. Обновления приходят сами (файлы берутся сначала из сети);
// номер версии увеличивайте, когда меняется список файлов ниже.
const CACHE = 'colorknitter-v9';

const APP_FILES = [
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
];
// библиотеки с CDN: кешируются по возможности (их недоступность не должна ломать офлайн-режим)
const CDN_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js',
];

// Предзагрузка мимо HTTP-кеша браузера — чтобы в офлайн-копию не попали старые файлы
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(APP_FILES.map(u => new Request(u, { cache: 'reload' })))
        .then(() => Promise.all(CDN_FILES.map(u => c.add(u).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});

// Удаляем кеши старых версий
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Свои файлы: сначала сеть (обновления видны сразу), без интернета — из кеша.
// Библиотеки с CDN (версия зашита в адрес): сначала кеш.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
  } else if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      // подключение <script> даёт «непрозрачный» ответ — его тоже можно кешировать
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
  // остальное (например, радио) — напрямую, без сервис-воркера
});
