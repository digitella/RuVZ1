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
    // Re-render so the stress pass rewrites any text nodes that still contain
    // raw U+0301 marks (e.g. rendered while tint was on and now off).
    rerenderAll();
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

  /* ---------- Cyrillic homoglyph normalization ----------
   * Some sources contain Latin look-alikes inside Russian words (e.g. Latin "o"
   * in "сéгодня"). They must become real Cyrillic letters — and stressed vowels
   * are then rendered BOLD (never as an accent mark). We normalize the whole
   * text node: any Latin letter that sits next to Cyrillic (or carries U+0301)
   * is mapped to its Cyrillic equivalent. Pure English tokens are left intact. */
  var HOMOGLYPH = {
    'a': 'а', 'A': 'А', 'c': 'с', 'C': 'С', 'e': 'е', 'E': 'Е', 'j': 'ј', 'J': 'Ј',
    'K': 'К', 'k': 'к', 'M': 'М', 'm': 'м', 'H': 'Н', 'h': 'н', 'o': 'о', 'O': 'О',
    'p': 'р', 'P': 'Р', 'T': 'Т', 't': 'т', 'X': 'Х', 'x': 'х', 'y': 'у', 'Y': 'У',
    'B': 'В', 'S': 'Ѕ', 's': 'ѕ',
    // accented Latin (used by older stress tooling) -> plain Cyrillic
    '\u00e1': 'а', '\u00c1': 'А', '\u00e0': 'а', '\u00c0': 'А', '\u00e2': 'а', '\u00c2': 'А', '\u00e4': 'а', '\u00c4': 'А', '\u0101': 'а', '\u0100': 'А', '\u0105': 'а', '\u0104': 'А', '\u0103': 'а', '\u0102': 'А',
    '\u00e9': 'е', '\u00c9': 'Е', '\u00e8': 'е', '\u00c8': 'Е', '\u00ea': 'е', '\u00ca': 'Е', '\u00eb': 'е', '\u00cb': 'Е', '\u0113': 'е', '\u0112': 'Е', '\u011b': 'е', '\u011a': 'Е', '\u0119': 'е', '\u0118': 'Е', '\u0117': 'е', '\u0116': 'Е', '\u0115': 'й', '\u0114': 'Й',
    '\u00ed': 'и', '\u00cd': 'И', '\u00ec': 'и', '\u00cc': 'И', '\u00ee': 'и', '\u00ce': 'И', '\u00ef': 'и', '\u00cf': 'И', '\u012b': 'и', '\u012a': 'И', '\u012f': 'и', '\u012e': 'И', '\u0123': 'и', '\u0122': 'И',
    '\u00f3': 'о', '\u00d3': 'О', '\u00f2': 'о', '\u00d2': 'О', '\u00f4': 'о', '\u00d4': 'О', '\u00f6': 'о', '\u00d6': 'О', '\u014d': 'о', '\u014c': 'О', '\u0151': 'о', '\u0150': 'О', '\u014f': 'о', '\u014e': 'О',
    '\u00fa': 'у', '\u00da': 'У', '\u00f9': 'у', '\u00d9': 'У', '\u00fb': 'у', '\u00db': 'У', '\u00fc': 'у', '\u00dc': 'У', '\u016b': 'у', '\u016a': 'У', '\u016f': 'у', '\u016e': 'У', '\u0171': 'у', '\u0170': 'У',
    '\u00fd': 'ы', '\u00dd': 'Ы', '\u00ff': 'ы', '\u0178': 'Ы',
    '\u0121': 'г', '\u0120': 'Г', '\u011f': 'г', '\u011e': 'Г',
    '\u0137': 'к', '\u0136': 'К', '\u0138': 'к',
    '\u013c': 'л', '\u013b': 'Л', '\u0142': 'л', '\u0141': 'Л', '\u0143': 'н', '\u0144': 'н', '\u0145': 'ң', '\u0146': 'Ҥ',
    '\u0155': 'р', '\u0154': 'Р', '\u0159': 'р', '\u0158': 'Р',
    '\u015b': 'с', '\u015a': 'С', '\u0161': 'ш', '\u0160': 'Ш', '\u015f': 'с', '\u015e': 'С',
    '\u0165': 'т', '\u0164': 'Т', '\u0163': 'т', '\u0162': 'Т',
    '\u017e': 'ж', '\u017d': 'Ж', '\u017a': 'з', '\u0179': 'З', '\u017c': 'з', '\u017b': 'З',
    '\u0107': 'ч', '\u0106': 'Ч', '\u010d': 'ч', '\u010c': 'Ч',
    '\u0111': 'д', '\u0110': 'Д', '\u010f': 'д', '\u010e': 'Д',
    '\u00f1': 'н', '\u00d1': 'Н', '\u00e7': 'ч', '\u00c7': 'Ч'
  };
  function normalizeHomoglyphs(text) {
    if (!/[a-zA-Z\u00C0-\u017E]/.test(text)) return text;
    // split into word tokens (letters incl. combining marks), decide per token
    return text.replace(/[^\s]+/g, function (w) {
      var hasCyr = CYR.test(w);
      var hasAccLat = /[\u00C0-\u017E]/.test(w);
      var hasCombining = w.indexOf('\u0301') >= 0;
      if (!hasCyr && !hasAccLat) return w;              // pure English or numbers — keep
      if (!hasCyr && hasAccLat && !hasCombining) return w; // leave isolated latin accents alone
      var out = '';
      for (var i = 0; i < w.length; i++) {
        var ch = w[i];
        var prev = w[i - 1] || '', next = w[i + 1] || '';
        var cyrNear = CYR.test(prev) || CYR.test(next);
        if ((HOMOGLYPH[ch] !== undefined) && (cyrNear || hasCombining || hasAccLat)) {
          out += HOMOGLYPH[ch];
        } else {
          out += ch;
        }
      }
      return out;
    });
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
    // normalize Latin homoglyphs inside Russian words BEFORE tokenizing,
    // so stressed vowels end up as bold Cyrillic (never an accent mark)
    text = normalizeHomoglyphs(text);
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

  /* ---------- Stress-only pass (tint OFF) ----------
   * When the language tint is disabled we still must never show raw U+0301
   * combining marks. This pass rewrites text nodes: "base + U+0301" becomes a
   * bold Cyrillic <b class="stress"> with the mark removed. No chips, no colors. */
  function stripStressOnly(text) {
    if (text.indexOf('\u0301') < 0) return null;
    var frag = document.createDocumentFragment();
    var buf = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '\u0301' && buf) {
        var last = buf[buf.length - 1];
        buf = buf.slice(0, -1);
        if (buf) frag.appendChild(document.createTextNode(buf));
        var b = document.createElement('b');
        b.className = 'stress';
        b.textContent = last;
        frag.appendChild(b);
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf) frag.appendChild(document.createTextNode(buf));
    return frag;
  }

  function walkStressOnly(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeValue.indexOf('\u0301') < 0) return NodeFilter.FILTER_REJECT;
        if (n.parentElement && n.parentElement.closest && n.parentElement.closest('.no-tint')) return NodeFilter.FILTER_REJECT;
        return shouldSkip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      var p = n.parentNode;
      if (!p) return;
      var f = stripStressOnly(normalizeHomoglyphs(n.nodeValue));
      if (f) p.replaceChild(f, n);
    });
  }

  function walk(root) {
    if (!enabled) { walkStressOnly(root || document.body); return; }
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
