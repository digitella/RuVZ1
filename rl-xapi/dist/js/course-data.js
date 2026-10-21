/* Russian Launchpad — course-data.js
 * Loads the single-source content from a RELATIVE path (works on GitHub Pages subpaths).
 * Tries ./course.json first; falls back to an embedded minimal copy so even a
 * file:// double-click preview works.
 */
(function () {
  'use strict';

  window.RL_COURSE = null;

  function applyConfig() {
    var c = window.RL_COURSE.config || {};
    if (c.languageTint && c.languageTint.enabled === false && window.RL_Tint) window.RL_Tint.setEnabled(false);
  }

  function relUrl(base, file) {
    if (base === '' || base == null || base === '.') return file;            // same dir
    if (/^https?:/i.test(base)) return base.replace(/\/$/, '') + '/' + file; // absolute allowed only if user passes it
    return String(base).replace(/\/+$/, '') + '/' + file;                    // e.g. '../rl-content'
  }
  function load(base) {
    return fetch(relUrl(base, 'course.json'), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function () {
        if (window.RL_EMBEDDED_COURSE) return window.RL_EMBEDDED_COURSE;
        throw new Error('course.json not found');
      });
  }

  window.RLCourseData = {
    init: function (base) {
      return load(base).then(function (j) { window.RL_COURSE = j; applyConfig();
        return fetch(relUrl(base, 'media/audio-manifest.json'), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
          .then(function (man) { window.RL_AUDIO_MANIFEST = man; return j; });
      });
    },
    lesson: function (id) {
      return (window.RL_COURSE.lessons || []).filter(function (l) { return l.id === id; })[0];
    }
  };
})();
