// Russian Launchpad — scormdriver.js (SCORM 1.2 API bootstrap, self-contained)
(function () {
  'use strict';
  function findAPI(w) {
    var i = 0;
    while (w && !w.API && i < 8) { try { w = w.parent; } catch (e) { break; } if (!w) break; w = w.parent ? w : null; if (w && w === w.parent) break; }
    // simpler robust walk:
    return null;
  }
  window.rlFindScormAPI = function () {
    var w = window, depth = 0;
    while (w && depth < 10) { if (w.API) return w.API; if (w === w.parent) break; w = w.parent; depth++; }
    if (window.opener && window.opener.API) return window.opener.API;
    return null;
  };
})();
