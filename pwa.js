// Регистрация сервис-воркера (офлайн-режим). Подключается на обеих страницах.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
