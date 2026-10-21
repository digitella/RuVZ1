/* Russian Launchpad — recorder.js
 * Microphone recorder with waveform + timer, and ALWAYS-available fallbacks:
 *   - typing fallback (never blocked)
 *   - file input fallback (upload own recording)
 * Also wraps SpeechRecognition for Fill-in-the-Blank with hybrid mode default.
 */
(function () {
  'use strict';

  function micAvailable() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }
  function srAvailable() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    return !!SR;
  }

  function Recorder(opts) {
    opts = opts || {};
    this.opts = opts;
    this.chunks = []; this.stream = null; this.rec = null;
    this.audioCtx = null; this.analyser = null; this.dataArr = null;
    this.timerInt = null; this.startedAt = 0; this.blobUrl = null;
  }

  Recorder.prototype.start = function () {
    var self = this;
    if (!micAvailable()) return Promise.reject(new Error('microphone-unavailable'));
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      self.stream = stream;
      self.rec = new MediaRecorder(stream);
      self.chunks = [];
      self.rec.ondataavailable = function (e) { if (e.data.size) self.chunks.push(e.data); };
      self.rec.start(100);
      self.startedAt = Date.now();
      // waveform
      try {
        self.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        var src = self.audioCtx.createMediaStreamSource(stream);
        self.analyser = self.audioCtx.createAnalyser(); self.analyser.fftSize = 512;
        src.connect(self.analyser);
        self.dataArr = new Uint8Array(self.analyser.frequencyBinCount);
      } catch (e) { /* waveform optional */ }
      if (self.opts.onStart) self.opts.onStart();
      return true;
    });
  };

  Recorder.prototype.sampleWaveform = function () {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this.dataArr);
    var out = [];
    for (var i = 0; i < this.dataArr.length; i += 4) out.push(this.dataArr[i]);
    return out.slice(0, 64);
  };

  Recorder.prototype.elapsedMs = function () { return this.startedAt ? Date.now() - this.startedAt : 0; };

  Recorder.prototype.stop = function () {
    var self = this;
    return new Promise(function (resolve) {
      if (!self.rec) return resolve(null);
      self.rec.onstop = function () {
        var blob = new Blob(self.chunks, { type: self.chunks[0] ? self.chunks[0].type : 'audio/webm' });
        if (self.blobUrl) URL.revokeObjectURL(self.blobUrl);
        self.blobUrl = URL.createObjectURL(blob);
        var dur = Date.now() - self.startedAt;
        if (self.stream) self.stream.getTracks().forEach(function (t) { t.stop(); });
        if (self.audioCtx) { try { self.audioCtx.close(); } catch (e) {} }
        self.timerInt && clearInterval(self.timerInt);
        resolve({ url: self.blobUrl, durationMs: dur, blob: blob });
      };
      self.rec.stop();
    });
  };

  /* Speech-to-text for fill-in-the-blank. Resolves {ok, transcript} or rejects. */
  Recorder.prototype.recognizeWord = function (lang) {
    return new Promise(function (resolve, reject) {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR || !micAvailable()) return reject(new Error('speech-recognition-unavailable'));
      var r = new SR();
      r.lang = lang || 'ru-RU'; r.interimResults = false; r.maxAlternatives = 3; r.continuous = false;
      var alts = [];
      r.onresult = function (e) { for (var i = 0; i < e.results.length; i++) for (var j = 0; j < e.results[i].length; j++) alts.push(e.results[i][j].transcript); };
      r.onerror = function (ev) { reject(new Error(ev.error || 'sr-error')); };
      r.onend = function () { alts.length ? resolve({ transcript: alts[0], alternatives: alts }) : reject(new Error('no-speech')); };
      try { r.start(); } catch (e) { reject(e); }
    });
  };

  /* Normalization + scoring for Russian answers: correct / near / incorrect */
  function normalize(s) {
    return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/gi, '').trim();
  }
  function levenshtein(a, b) {
    var m = a.length, n = b.length, dp = [], i, j;
    for (i = 0; i <= m; i++) dp[i] = [i];
    for (j = 0; j <= n; j++) dp[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[m][n];
  }
  function gradeAnswer(given, expected) {
    var g = normalize(given), e = normalize(expected);
    if (!g) return 'incorrect';
    if (g === e || g.split(' ').indexOf(e) >= 0) return 'correct';
    var d = levenshtein(g, e);
    if (d <= Math.max(1, Math.floor(e.length * 0.2))) return 'near';
    return 'incorrect';
  }

  window.RLRecorder = {
    Recorder: Recorder, micAvailable: micAvailable, srAvailable: srAvailable,
    gradeAnswer: gradeAnswer, normalize: normalize
  };
})();
