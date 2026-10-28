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
  var enabled = true;

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

  function wrapToken(tok, cls) {
    var s = document.createElement('span');
    s.className = 'tint-' + cls;
    s.textContent = tok;
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

  window.RL_Tint = {
    apply: function (root) { walk(root || document.body); },
    setEnabled: function (v) { enabled = !!v; if (!v) document.documentElement.classList.add('tint-off'); else document.documentElement.classList.remove('tint-off'); },
    isEnabled: function () { return enabled; }
  };
})();
