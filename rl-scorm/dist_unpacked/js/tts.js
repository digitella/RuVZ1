/* Russian Launchpad — tts.js
 * Reference audio strategy:
 * 1) Web Speech API (ru-RU voice) when available;
 * 2) fallback to the OGG file (placeholder silent OGG exists for every item,
 *    so no 404 ever);
 * 3) exposes speed control via utterance.rate / audio.playbackRate.
 */
(function () {
  'use strict';

  var voices = [];
  function loadVoices() {
    if ('speechSynthesis' in window) {
      try { voices = window.speechSynthesis.getVoices(); } catch (e) { voices = []; }
    }
  }
  if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function ruVoice() {
    return voices.filter(function (v) { return /^ru/i.test(v.lang); })[0] || null;
  }

  function speak(text, opts) {
    opts = opts || {};
    var rate = opts.rate || 1; // 1 | 0.75 | 0.5
    if (!('speechSynthesis' in window) || !ruVoice()) {
      return Promise.resolve({ engine: 'file-fallback', ok: false });
    }
    return new Promise(function (resolve) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU'; u.voice = ruVoice(); u.rate = rate;
      u.onend = function () { resolve({ engine: 'webspeech', ok: true }); };
      setTimeout(function () { try { window.speechSynthesis.cancel(); } catch (e) {} }, 60000);
      u.onerror = function () { resolve({ engine: 'file-fallback', ok: false }); };
      window.speechSynthesis.speak(u);
    });
  }

  /* Play reference audio: TTS first, then guaranteed OGG fallback. */
  function playReference(item, opts) {
    opts = opts || {};
    var audioEl = opts.audioEl || null;
    return speak(item.ru || item.transcript || '', opts).then(function (r) {
      if (r.ok) return r;
      if (audioEl && item.audio) {
        audioEl.src = item.audio;           // relative path, placeholder exists
        audioEl.playbackRate = opts.rate || 1;
        return audioEl.play().then(function () { return { engine: 'ogg-file', ok: true }; })
          .catch(function () { return { engine: 'none', ok: false }; });
      }
      return r;
    });
  }

  window.RLTTS = { speak: speak, playReference: playReference, hasRuVoice: function () { return !!ruVoice(); } };
})();
