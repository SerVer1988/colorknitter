// Выполняется до загрузки страницы: редирект на генератор и разблокировка голоса
// Если нет флага активной вязалки и нет данных от генератора — на генератор
if (!localStorage.getItem('ck_has_sequence') && !localStorage.getItem('ck_from_generator')) {
  window.location.replace('generator.html');
}
function unlockSpeech() {
  const u = new SpeechSynthesisUtterance('');
  u.volume = 0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  document.removeEventListener('touchstart', unlockSpeech);
  document.removeEventListener('click', unlockSpeech);
}
document.addEventListener('touchstart', unlockSpeech);
document.addEventListener('click', unlockSpeech);
