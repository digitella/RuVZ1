/* Russian Launchpad — tint.js
 * Language tint: high-contrast teal chips for Russian words, violet chips for English.
 * Redundant coding (NN/g "don't rely on color alone"): hue + weight/italic + underline
 * are defined in CSS (.tint-ru/.tint-en); a legend is rendered by the player.
 * - Skips input/textarea/select/audio/canvas/script/style (and code/pre optional).
 * - Can be disabled via course config (config.languageTint.enabled=false)
 *   or at runtime: RL_Tint.disable().
 */
(function () {
  'use strict';

  var CYR = /[а-яёА-ЯЁ]/;
  var LATIN = /[a-zA-Z]/;
  var SKIP_TAGS = ['INPUT', 'TEXTAREA', 'SELECT', 'AUDIO', 'CANVAS', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'];
  var LS_TINT = 'rl_tint_enabled';
  var LS_THEME = 'rl_theme';
  // Runtime state is restored from localStorage so toggles survive reloads.
  var enabled = true;
  try { enabled = localStorage.getItem(LS_TINT) !== 'off'; } catch (e) {}

  function applyTintClass(v) {
    document.documentElement.classList.toggle('tint-off', !v);
  }

  /* ---------- Theme (light / dark) ---------- */
  function getTheme() {
    try {
      var t = localStorage.getItem(LS_THEME);
      if (t === 'light' || t === 'dark') return t;
    } catch (e) {}
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    } catch (e) {}
    return 'dark';
  }
  function setTheme(t) {
    t = (t === 'light') ? 'light' : 'dark';
    document.documentElement.classList.toggle('theme-light', t === 'light');
    document.documentElement.classList.toggle('theme-dark', t === 'dark');
    try { localStorage.setItem(LS_THEME, t); } catch (e) {}
    syncControls();
    return t;
  }
  function toggleTheme() {
    return setTheme(getTheme() === 'light' ? 'dark' : 'light');
  }

  /* ---------- Shared control wiring (checkbox-style switches) ----------
   * One implementation used by the webapp and the SCORM/xAPI/cmi5 bundles.
   * Toggles are <input type="checkbox" role="switch"> styled as switches in CSS.
   * IMPORTANT: we do NOT location.reload() — we re-render the DOM in place so
   * the current view/lesson is preserved (NN/g: visibility of system status,
   * no disorienting full-page refresh). */
  function syncControls() {
    var tintOn = enabled, theme = getTheme();
    var tc = document.getElementById('tint-toggle');
    if (tc) {
      tc.checked = tintOn;
      tc.setAttribute('aria-checked', tintOn ? 'true' : 'false');
    }
    var th = document.getElementById('theme-toggle');
    if (th) {
      var isLight = theme === 'light';
      th.checked = isLight;
      th.setAttribute('aria-checked', isLight ? 'true' : 'false');
      var lbl = document.getElementById('theme-toggle-label');
      if (lbl) lbl.textContent = isLight ? 'Light' : 'Dark';
    }
    // Font scale readout (works in every bundle that ships the .fontctl markup).
    var fs = getFontScale();
    var fv = document.getElementById('font-value');
    if (fv) fv.textContent = Math.round(fs * 100) + '%';
    var fminus = document.getElementById('font-minus');
    var fplus = document.getElementById('font-plus');
    if (fminus) fminus.disabled = fs <= FS_MIN;
    if (fplus) fplus.disabled = fs >= FS_MAX;
  }

  function rerenderAll() {
    // Re-render mounted player instances in place (no reload, no state loss).
    try { if (window.RLPlayer && typeof window.RLPlayer.rerenderMounted === 'function') { window.RLPlayer.rerenderMounted(); return; } } catch (e) {}
    try { if (window.rlApp && typeof window.rlApp.rerender === 'function') { window.rlApp.rerender(); return; } } catch (e) {}
  }

  // Robust fallback: even if this script ran before the toggle existed, or a
  // stale cached copy of tint.js missed the wiring, a change event from
  // #tint-toggle / #theme-toggle is still handled (capture listener).
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || t.dataset.rlWired === '1') return;
    if (t.id === 'tint-toggle') {
      t.dataset.rlWired = '1';
      window.RL_Tint.setEnabled(t.checked);
      rerenderAll();
    } else if (t.id === 'theme-toggle') {
      t.dataset.rlWired = '1';
      setTheme(t.checked ? 'light' : 'dark');
    }
  }, true);

  function initControls() {
    var tc = document.getElementById('tint-toggle');
    if (tc && !tc.dataset.rlWired) {
      tc.dataset.rlWired = '1';
      tc.addEventListener('change', function () {
        window.RL_Tint.setEnabled(tc.checked);
        rerenderAll();
      });
    }
    var th = document.getElementById('theme-toggle');
    if (th && !th.dataset.rlWired) {
      th.dataset.rlWired = '1';
      th.addEventListener('change', function () { setTheme(th.checked ? 'light' : 'dark'); });
    }
    var fminus = document.getElementById('font-minus');
    if (fminus && !fminus.dataset.rlWired) {
      fminus.dataset.rlWired = '1';
      fminus.addEventListener('click', function () { bumpFontScale(-1); });
    }
    var fplus = document.getElementById('font-plus');
    if (fplus && !fplus.dataset.rlWired) {
      fplus.dataset.rlWired = '1';
      fplus.addEventListener('click', function () { bumpFontScale(1); });
    }
    syncControls();
  }

  // Apply persisted settings ASAP (this script is loaded early in <body>).
  applyTintClass(enabled);
  setTheme(getTheme());
  document.documentElement.style.setProperty('--fs', String(getFontScale()));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initControls);
  } else {
    initControls();
  }

  function shouldSkip(node) {
    var el = node.parentElement;
    while (el) {
      if (SKIP_TAGS.indexOf(el.tagName) >= 0) return true;
      if (el.classList && (el.classList.contains('no-tint') || el.classList.contains('tint-legend'))) return true;
      el = el.parentElement;
    }
    return false;
  }

  function classifyToken(t) {
    var hasCyr = CYR.test(t), hasLat = LATIN.test(t);
    if (hasCyr) return 'ru';
    if (hasLat) return 'en';
    return null;
  }

  // Stress rendering: convert "Vowel + U+0301" into a bold <b> span.
  // This fulfills the course rule: stressed vowels are shown BOLD, not with an accent mark.
  function buildStressedFragment(tok) {
    var frag = document.createDocumentFragment();
    var buf = '';
    for (var i = 0; i < tok.length; i++) {
      var ch = tok[i];
      if (ch === '\u0301') {
        // attach combining mark to the buffered base letter, render it bold
        if (buf) {
          var last = buf[buf.length - 1];
          buf = buf.slice(0, -1);
          if (buf) frag.appendChild(document.createTextNode(buf));
          var b = document.createElement('b');
          b.className = 'stress';
          b.textContent = last;
          frag.appendChild(b);
          buf = '';
        }
        continue;
      }
      buf += ch;
    }
    if (buf) frag.appendChild(document.createTextNode(buf));
    return frag;
  }

  function wrapToken(tok, cls) {
    var s = document.createElement('span');
    s.className = 'tint-' + cls;
    if (tok.indexOf('\u0301') >= 0) {
      s.appendChild(buildStressedFragment(tok));
    } else {
      s.textContent = tok;
    }
    return s;
  }

  function tintText(text) {
    // split preserving whitespace/punctuation runs
    var frag = document.createDocumentFragment();
    var parts = text.split(/(\s+)/);
    parts.forEach(function (p) {
      if (!p) return;
      if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
      var cls = classifyToken(p);
      if (!cls) { frag.appendChild(document.createTextNode(p)); return; }
      frag.appendChild(wrapToken(p, cls));
    });
    return frag;
  }

  function walk(root) {
    if (!enabled) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (n.parentElement && n.parentElement.closest && n.parentElement.closest('.tint-done,.no-tint')) return NodeFilter.FILTER_REJECT;
        return shouldSkip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      if (!CYR.test(n.nodeValue) && !LATIN.test(n.nodeValue)) return;
      var f = tintText(n.nodeValue);
      var p = n.parentNode;
      if (!p) return;
      p.replaceChild(f, n);
      if (p.classList) p.classList.add('tint-done');
    });
  }

  /* ---------- Font size scale (A- / A+ controls, NN/g inclusivity) ---------- */
  var LS_FS = 'rl_font_scale';
  var FS_MIN = 0.9, FS_MAX = 1.3, FS_STEP = 0.1;
  function getFontScale() {
    try {
      var v = parseFloat(localStorage.getItem(LS_FS));
      if (v >= FS_MIN && v <= FS_MAX) return v;
    } catch (e) {}
    return 1;
  }
  function setFontScale(v) {
    v = Math.min(FS_MAX, Math.max(FS_MIN, Math.round(v * 100) / 100));
    document.documentElement.style.setProperty('--fs', String(v));
    try { localStorage.setItem(LS_FS, String(v)); } catch (e) {}
    syncControls();
    return v;
  }
  function bumpFontScale(dir) { return setFontScale(getFontScale() + dir * FS_STEP); }

  window.RL_Tint = {
    apply: function (root) { walk(root || document.body); },
    setEnabled: function (v) {
      enabled = !!v;
      applyTintClass(enabled);
      try { localStorage.setItem(LS_TINT, enabled ? 'on' : 'off'); } catch (e) {}
      syncControls();
    },
    isEnabled: function () { return enabled; },
    // Theme API — usable from console or other modules.
    getTheme: getTheme,
    getFontScale: getFontScale,
    setFontScale: setFontScale,
    bumpFontScale: bumpFontScale,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    syncControls: syncControls
  };
})();
