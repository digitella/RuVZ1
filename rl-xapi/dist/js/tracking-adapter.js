/* Russian Launchpad — tracking-adapter.js
 * Unified tracking for SCORM 1.2 / xAPI / cmi5 / preview-mock.
 * Modes (auto-detected or forced via RL_RUNTIME.mode):
 *   scorm  -> talks to the LMS API adapter (no external backend needed)
 *   xapi   -> real LRS if configured, else MockLRS (localStorage log)
 *   cmi5   -> xAPI with cmi5 context (registration/parent/moveOn from launch params), else mock
 *   preview-> MockLRS + localStorage progress
 */
(function () {
  'use strict';

  function ls(k, v) {
    if (v === undefined) { try { return JSON.parse(localStorage.getItem('rl_track_' + k)); } catch (e) { return null; } }
    localStorage.setItem('rl_track_' + k, JSON.stringify(v));
  }

  // ---------- Mock LRS: stores statements locally, never 404s -------------
  function MockLRS() { this.key = 'xapi_statements'; }
  MockLRS.prototype.stmt = function (verbId, verbDisp, objId, result, ctx) {
    var cfg = window.RL_TRACKING_CONFIG || {};
    var s = {
      actor: { objectType: 'Agent', account: { name: (cfg.agent && cfg.agent.name) || 'preview-user', homePage: (cfg.agent && cfg.agent.homePage) || 'https://russianlaunchpad.example' } },
      verb: { id: verbId, display: { 'en-US': verbDisp } },
      object: { id: objId || cfg.activityId || 'course', definition: { name: { 'en-US': 'Russian Launchpad A1-A2' }, type: 'https://russianlaunchpad.example/activity/course' } },
      context: Object.assign({ registration: cfg.registration || 'mock-registration', contextActivities: { parent: [{ id: cfg.activityId || 'course' }] } }, ctx || {}),
      timestamp: new Date().toISOString()
    };
    if (result) s.result = result;
    var all = ls(this.key) || []; all.push(s); ls(this.key, all);
    if (window.console && console.log) console.log('[MockLRS]', verbDisp, s.object.id.split('/').pop());
    return Promise.resolve(s);
  };
  MockLRS.prototype.log = function () { return ls(this.key) || []; };

  // ---------- Real LRS (xAPI basic auth) -----------------------------------
  function HttpLRS(cfg) { this.cfg = cfg; }
  HttpLRS.prototype.stmt = function (verbId, verbDisp, objId, result, ctx) {
    var base = window.RL_TRACKING_CONFIG.endpoint.replace(/\/$/, '');
    var cfg = window.RL_TRACKING_CONFIG;
    var s = {
      actor: { objectType: 'Agent', account: { name: cfg.agent.name, homePage: cfg.agent.homePage } },
      verb: { id: verbId, display: { 'en-US': verbDisp } },
      object: { id: objId || cfg.activityId },
      context: Object.assign({ registration: cfg.registration, contextActivities: { parent: [{ id: cfg.activityId }] } }, ctx || {}),
      timestamp: new Date().toISOString()
    };
    if (result) s.result = result;
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa(cfg.auth.key + ':' + cfg.auth.secret), 'X-Requested-With': 'XMLHttpRequest' };
    return fetch(base + '/statements', { method: 'POST', headers: headers, body: JSON.stringify(s) })
      .then(function (r) { if (!r.ok) throw new Error('LRS ' + r.status); return s; })
      .catch(function (e) { console.warn('LRS offline, falling back to mock', e); return (new MockLRS()).stmt(verbId, verbDisp, objId, result, ctx); });
  };

  // ---------- SCORM 1.2 API wrapper ----------------------------------------
  function ScormAPI() {
    this.api = findAPI(window);
    this.lmsConnected = !!this.api;
    this.startTime = Date.now();
    if (this.lmsConnected) this.api.LMSSetValue('cmi.core.lesson_status', 'not attempted');
  }
  function findAPI(w) {
    var i = 0;
    while (w && !w.API && i < 8) { try { w = w.parent; i++; } catch (e) { break; } }
    if (w && w.API) return w.API;
    if (window.opener && window.opener.API) return window.opener.API;
    return null;
  }
  ScormAPI.prototype.set = function (k, v) { if (this.lmsConnected) this.api.LMSSetValue(k, v); };
  ScormAPI.prototype.commit = function () { if (this.lmsConnected) this.api.LMSCommit(''); };
  ScormAPI.prototype.totalTime = function () {
    var secs = Math.floor((Date.now() - this.startTime) / 1000);
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  };

  // ---------- Adapter -------------------------------------------------------
  function Adapter() {
    var rt = window.RL_RUNTIME || {};
    this.mode = detectMode(rt.mode);
    this.scorm = null;
    if (this.mode === 'scorm') {
      this.scorm = new ScormAPI();
      if (this.scorm.lmsConnected) { this.scorm.api.LMSInitialize(''); this.scorm.set('cmi.core.lesson_status', 'incomplete'); this.scorm.commit(); }
      else { this.mode = 'preview'; } // opened directly: degrade gracefully
    }
    var cfg = window.RL_TRACKING_CONFIG || {};
    if (this.mode === 'xapi' || this.mode === 'cmi5') {
      this.lrs = (cfg.endpoint && cfg.auth) ? new HttpLRS(cfg) : new MockLRS();
    } else {
      this.lrs = new MockLRS();
    }
    this.V = 'https://russianlaunchpad.example/xapi/verb/';
    this.A = 'https://russianlaunchpad.example/xapi/activity/';
  }

  function detectMode(forced) {
    if (forced && forced !== 'preview') return forced;
    if (findAPI(window)) return 'scorm';
    var p = new URLSearchParams(location.search);
    if (p.get('launch_path') || p.get('cmi5_launch')) return 'cmi5';
    return forced || 'preview';
  }

  var ADL = { launched: 1, answered: 1, completed: 1, mastered: 1, failed: 1, terminated: 1 };
  Adapter.prototype._fire = function (verbId, disp, objId, result, ctx) {
    var verbUrl = this.V + verbId;
    if (this.mode === 'cmi5' && ADL[verbId]) verbUrl = 'http://adlnet.gov/expapi/verbs/' + verbId;
    if (this.mode === 'scorm' && this.scorm && this.scorm.lmsConnected) {
      // map core events onto SCORM 1.2 data model
      if (verbId === 'completed') this.scorm.set('cmi.core.lesson_status', 'completed');
      if (verbId === 'passed') { this.scorm.set('cmi.core.lesson_status', 'passed'); }
      if (verbId === 'failed') { this.scorm.set('cmi.core.lesson_status', 'failed'); }
      if (verbId === 'answered' && result && result.score) {
        this.scorm.set('cmi.core.score.raw', String(result.score.raw));
        this.scorm.set('cmi.core.score.min', String(result.score.min != null ? result.score.min : 0));
        this.scorm.set('cmi.core.score.max', String(result.score.max != null ? result.score.max : 100));
      }
      if (verbId === 'terminated' || verbId === 'completed') {
        this.scorm.set('cmi.core.total_time', this.scorm.totalTime());
        this.scorm.commit();
      }
    }
    // every mode also logs an xAPI-shaped statement (mock or real) for observability
    return this.lrs.stmt(verbUrl, disp, objId, result, ctx);
  };

  Adapter.prototype.launch = function () { return this._fire('launched', 'launched'); };
  Adapter.prototype.answered = function (qid, correct, rawScore, maxScore) {
    return this._fire('answered', 'answered', this.A + qid, { response: String(correct), success: !!correct, score: { raw: rawScore, min: 0, max: maxScore, scaled: maxScore ? (rawScore / maxScore) : 0 } });
  };
  Adapter.prototype.practiced = function (itemId, ok, transcript) {
    return this._fire('practiced', 'practiced', this.A + itemId, { response: transcript || '', success: !!ok });
  };
  Adapter.prototype.recorded = function (itemId, attempt, durationMs) {
    return this._fire('recorded', 'recorded', this.A + itemId, { duration: 'PT' + (durationMs / 1000).toFixed(1) + 'S' }, { extensions: { 'https://russianlaunchpad.example/xapi/ext/attempt': attempt } });
  };
  Adapter.prototype.compared = function (itemId) { return this._fire('compared', 'compared', this.A + itemId); };
  Adapter.prototype.commented = function (targetId, visibility) {
    return this._fire('commented', 'commented', this.A + targetId, null, { extensions: { 'https://russianlaunchpad.example/xapi/ext/comment-visibility': visibility } });
  };
  Adapter.prototype.completed = function () { return this._fire('completed', 'completed', null, { completion: true }); };
  Adapter.prototype.passed = function (scorePercent) {
    var self = this;
    return this._fire('passed', 'passed', null, { success: true, completion: true, score: { raw: scorePercent, min: 0, max: 100, scaled: scorePercent / 100 } })
      .then(function (s) { if (self.mode === 'cmi5') self.moveOn('Passed'); return s; });
  };
  Adapter.prototype.failed = function (scorePercent) {
    var self = this;
    return this._fire('failed', 'failed', null, { success: false, score: { raw: scorePercent, min: 0, max: 100, scaled: scorePercent / 100 } })
      .then(function (s) { if (self.mode === 'cmi5') self.moveOn('Failed'); return s; });
  };
  Adapter.prototype.subscription = function (kind, plan) { // activated|renewed|canceled
    return this._fire('subscription_' + kind, 'subscription ' + kind, this.A + 'subscription/' + plan, null, { extensions: { 'https://russianlaunchpad.example/xapi/ext/plan': plan } });
  };
  Adapter.prototype.terminate = function () { return this._fire('terminated', 'terminated', null, { duration: this.scorm ? 'PT' + Math.round((Date.now() - this.scorm.startTime) / 1000) + 'S' : undefined }); };

  // cmi5 move-on helper
  Adapter.prototype.moveOn = function (status) {
    if (this.mode !== 'cmi5') return;
    var url = (window.RL_CMI5 && window.RL_CMI5.moveOnUrl) || '';
    if (url) { try { fetch(url, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: status }); } catch (e) { /* best effort */ } }
    this._fire(status === 'Passed' ? 'mastered' : 'completed', 'move on: ' + status, null, { success: status === 'Passed', completion: status !== 'Not Attempted' });
  };

  window.RLTracking = new Adapter();
  window.RLMockLRSClass = MockLRS;
})();
