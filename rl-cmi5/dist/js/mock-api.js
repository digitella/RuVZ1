/* Russian Launchpad — mock-api.js
 * Backend-free preview: localStorage "database" + demo accounts.
 * All paths relative; no absolute URLs. Loaded before app.js in every static bundle.
 */
(function () {
  'use strict';
  var LS = window.localStorage;
  var DB_KEY = 'rl_db_v1';

  function hash(s) { // demo-grade, not for production
    var h = 0, i; for (i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return 'h' + (h >>> 0).toString(36);
  }
  function uid(p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function seed() {
    return {
      users: [
        { id: 'u-student', email: 'student@demo.test', pass: hash('demo123'), name: 'Sam Student', role: 'student' },
        { id: 'u-editor', email: 'editor@demo.test', pass: hash('demo123'), name: 'Elena Editor', role: 'editor' },
        { id: 'u-admin', email: 'admin@demo.test', pass: hash('admin123'), name: 'Admin Adminov', role: 'admin' }
      ],
      sessions: {},           // token -> userId
      subscriptions: {},      // userId -> {plan,status,expiresAt,autoRenew}
      comments: [],           // {id,targetType,targetId,authorId,body,visibility,parentReply,resolved,internalNote,createdAt}
      practice: [],           // attempts: quiz answers, recordings meta, speech results
      crm: [
        { id: 'c1', contact: 'lead-visitor@example.com', source: 'landing_form', status: 'new', notes: 'Downloaded syllabus', assigned_to: 'u-editor', createdAt: Date.now() },
        { id: 'c2', contact: 'tg-user-42', source: 'telegram_mini_app', status: 'contacted', notes: 'Asked about RVP exam prep', assigned_to: 'u-editor', createdAt: Date.now() - 86400000 }
      ],
      progress: {}            // userId -> {lessonId: {quizScore, completed}}
    };
  }
  function db() {
    var raw = LS.getItem(DB_KEY);
    if (!raw) { var d = seed(); LS.setItem(DB_KEY, JSON.stringify(d)); return d; }
    try { return JSON.parse(raw); } catch (e) { var d2 = seed(); LS.setItem(DB_KEY, JSON.stringify(d2)); return d2; }
  }
  function save(d) { LS.setItem(DB_KEY, JSON.stringify(d)); }

  function res(code, body) {
    return Promise.resolve({ ok: code < 400, status: code, json: function () { return Promise.resolve(body); } });
  }

  // ---- handlers -----------------------------------------------------------
  var routes = {
    'POST /auth/login': function (b, d) {
      var u = d.users.filter(function (x) { return x.email === b.email && x.pass === hash(b.password || ''); })[0];
      if (!u) return res(401, { detail: 'Invalid credentials' });
      // reuse an existing session for this user so reloads keep you logged in
      var tok = null;
      for (var t in d.sessions) { if (d.sessions[t] === u.id) { tok = t; break; } }
      if (!tok) { tok = uid('tok'); d.sessions[tok] = u.id; }
      try { localStorage.setItem('rl_sessions', JSON.stringify(d.sessions)); } catch (e) {}
      save(d);
      return res(200, { access_token: tok, token_type: 'bearer', user: { id: u.id, email: u.email, name: u.name, role: u.role } });
    },
    'POST /auth/register': function (b, d) {
      if (d.users.some(function (x) { return x.email === b.email; })) return res(409, { detail: 'Email exists' });
      var u = { id: uid('u'), email: b.email, pass: hash(b.password || 'demo123'), name: b.name || 'New learner', role: 'student' };
      d.users.push(u);
      d.crm.push({ id: uid('c'), contact: u.email, source: 'web_register', status: 'new', notes: '', assigned_to: null, createdAt: Date.now() });
      save(d);
      return routes['POST /auth/login'](b, d);
    },
    'GET /auth/me': function (b, d, tok) {
      var uidn = d.sessions[tok]; var u = uidn && d.users.filter(function (x) { return x.id === uidn; })[0];
      return u ? res(200, { id: u.id, email: u.email, name: u.name, role: u.role }) : res(401, { detail: 'Not authenticated' });
    },
    'GET /access': function (b, d, tok) {
      var uidn = d.sessions[tok]; if (!uidn) return res(401, { detail: 'No session' });
      var sub = d.subscriptions[uidn];
      var active = sub && (sub.status === 'active' || sub.status === 'trial') && (!sub.expiresAt || sub.expiresAt > Date.now());
      var u = d.users.filter(function (x) { return x.id === uidn; })[0];
      return res(200, { hasAccess: !!active || u.role !== 'student', subscription: sub || null, role: u.role });
    },
    'POST /payments/checkout': function (b, d, tok) {
      var uidn = d.sessions[tok]; if (!uidn) return res(401, { detail: 'No session' });
      var plan = b.plan === 'one_year' ? 'one_year' : 'six_months';
      var days = plan === 'one_year' ? 365 : 180;
      var provider = b.provider || 'mock'; // mock | stripe | yookassa (stub)
      var payId = uid('pay_' + provider);
      d.pendingPayments = d.pendingPayments || {};
      d.pendingPayments[payId] = { userId: uidn, plan: plan, days: days, provider: provider, autoRenew: !!b.autoRenew };
      save(d);
      // Mock providers "confirm" instantly; real Stripe/YooKassa would redirect.
      return res(200, { paymentId: payId, provider: provider, status: provider === 'mock' ? 'requires_confirmation' : 'checkout_redirect', confirmUrl: null });
    },
    'POST /payments/confirm': function (b, d) {
      // dev activation path — in the real API guarded by ALLOW_DEV_ACTIVATION env
      var p = (d.pendingPayments || {})[b.paymentId];
      if (!p) return res(404, { detail: 'Unknown payment' });
      var now = Date.now();
      var prev = d.subscriptions[p.userId];
      var base = (prev && prev.expiresAt && prev.expiresAt > now && prev.plan === p.plan) ? prev.expiresAt : now;
      d.subscriptions[p.userId] = { plan: p.plan, status: 'active', expiresAt: base + p.days * 86400000, autoRenew: p.autoRenew, provider: p.provider };
      delete d.pendingPayments[b.paymentId];
      if (!d._log) d._log = [];
      d._log.push({ t: 'subscription_activated', plan: p.plan });
      save(d);
      return res(200, d.subscriptions[p.userId]);
    },
    'POST /payments/renew': function (b, d, tok) {
      var uidn = d.sessions[tok]; var s = d.subscriptions[uidn];
      if (!s) return res(400, { detail: 'No subscription' });
      var days = s.plan === 'one_year' ? 365 : 180;
      s.expiresAt = Math.max(s.expiresAt || Date.now(), Date.now()) + days * 86400000;
      if (!d._log) d._log = []; d._log.push({ t: 'subscription_renewed' });
      save(d); return res(200, s);
    },
    'POST /payments/cancel': function (b, d, tok) {
      var uidn = d.sessions[tok]; var s = d.subscriptions[uidn];
      if (!s) return res(400, { detail: 'No subscription' });
      s.status = 'canceled'; s.autoRenew = false;
      if (!d._log) d._log = []; d._log.push({ t: 'subscription_canceled' });
      save(d); return res(200, s);
    },
    'GET /crm/contacts': function (b, d, tok, u) {
      if (!u || (u.role !== 'editor' && u.role !== 'admin')) return res(403, { detail: 'Editor/admin only' });
      return res(200, d.crm);
    },
    'POST /crm/contacts': function (b, d, tok, u) {
      if (!u || (u.role !== 'editor' && u.role !== 'admin')) return res(403, { detail: 'Editor/admin only' });
      var c = { id: uid('c'), contact: b.contact, source: b.source || 'manual', status: b.status || 'new', notes: b.notes || '', assigned_to: b.assigned_to || null, createdAt: Date.now() };
      d.crm.push(c); save(d); return res(200, c);
    },
    'PATCH /crm/contacts/:id': function (b, d, tok, u, params) {
      if (!u || (u.role !== 'editor' && u.role !== 'admin')) return res(403, { detail: 'Editor/admin only' });
      var c = d.crm.filter(function (x) { return x.id === params.id; })[0];
      if (!c) return res(404, { detail: 'Not found' });
      ['status', 'notes', 'assigned_to', 'source'].forEach(function (k) { if (b[k] !== undefined) c[k] = b[k]; });
      save(d); return res(200, c);
    },
    'GET /comments': function (b, d, tok, u, params, q) {
      var mine = d.comments.filter(function (c) {
        if (q.targetType && c.targetType !== q.targetType) return false;
        if (q.targetId && c.targetId !== q.targetId) return false;
        if (u.role === 'student') return c.authorId === u.id || (c.visibility === 'public' && !c.resolved);
        return true; // editor/admin inbox sees all
      });
      return res(200, mine);
    },
    'POST /comments': function (b, d, tok, u) {
      var c = {
        id: uid('cm'), targetType: b.targetType, targetId: b.targetId, authorId: u.id, authorRole: u.role,
        body: b.body, visibility: b.visibility || 'private_instructor', replyTo: b.replyTo || null,
        resolved: false, internalNote: null, createdAt: Date.now()
      };
      if (u.role === 'student' && c.visibility === 'public' && !publicEnabled()) c.visibility = 'private_instructor';
      d.comments.push(c); save(d); return res(200, c);
    },
    'PATCH /comments/:id': function (b, d, tok, u, params) {
      var c = d.comments.filter(function (x) { return x.id === params.id; })[0];
      if (!c) return res(404, { detail: 'Not found' });
      if (u.role !== 'student') {
        if (b.resolved !== undefined) c.resolved = b.resolved;
        if (b.internalNote !== undefined) c.internalNote = b.internalNote;
        if (b.visibility !== undefined) c.visibility = b.visibility;
      } else if (c.authorId === u.id && b.body !== undefined) { c.body = b.body; }
      else return res(403, { detail: 'Forbidden' });
      save(d); return res(200, c);
    },
    'POST /practice/attempt': function (b, d, tok, u) {
      var a = Object.assign({ id: uid('at'), userId: u.id, ts: Date.now() }, b);
      d.practice.push(a);
      if (b.kind === 'quiz' && b.lessonId) {
        var pg = d.progress[u.id] = d.progress[u.id] || {};
        var lp = pg[b.lessonId] = pg[b.lessonId] || {};
        lp.quizScore = b.scorePercent != null ? b.scorePercent : lp.quizScore;
        if ((lp.quizScore || 0) >= 70) lp.completed = true;
      }
      save(d); return res(200, a);
    },
    'GET /practice/attempts': function (b, d, tok, u, params, q) {
      var list = d.practice.filter(function (a) {
        if (u.role === 'student' && a.userId !== u.id) return false;
        if (q.targetId && a.targetId !== q.targetId) return false;
        if (q.kind && a.kind !== q.kind) return false;
        return true;
      });
      return res(200, list);
    },
    'DELETE /practice/attempt/:id': function (b, d, tok, u, params) {
      var before = d.practice.length;
      d.practice = d.practice.filter(function (a) { return !(a.id === params.id && (u.role !== 'student' || a.userId === u.id)); });
      save(d); return res(200, { deleted: before - d.practice.length });
    },
    'GET /course/data': function (b, d) { return fetch('course.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { return { ok: true, status: 200, json: function () { return j; } }; }); },
    'GET /progress': function (b, d, tok, u) { return res(200, d.progress[u.id] || {}); },
    'GET /auth/token': function (b, d) { return res(200, { token: null }); },
    'POST /telegram/auth': function (b, d) {
      // initData verification lives in rl-api; mock accepts any tg id with demo user
      var u = { id: 'tg-' + (b.tgId || 'demo'), email: 'tg-' + (b.tgId || 'demo') + '@t.me', name: b.firstName || 'Telegram Learner', role: 'student' };
      var tok = uid('tok'); d.sessions[tok] = d.users.some(function (x) { return x.id === u.id; }) ? u.id : (d.users.push(u), u.id); save(d);
      return res(200, { access_token: tok, user: u });
    },
    'POST /xapi/statements': function (b, d) {
      d.xapiLog = d.xapiLog || [];
      (Array.isArray(b) ? b : [b]).forEach(function (s) { d.xapiLog.push(Object.assign({ stored: Date.now() }, s)); });
      save(d); return res(200, Array.isArray(b) ? b.map(function () { return { id: uid('stmt') }; }) : [{ id: uid('stmt') }]);
    },
    'GET /xapi/statements': function (b, d) { return res(200, { statements: d.xapiLog || [] }); }
  };

  function publicEnabled() {
    try { return !!(window.RL_COURSE && window.RL_COURSE.config && window.RL_COURSE.config.comments.publicCommentsEnabled); } catch (e) { return false; }
  }

  function match(method, url) {
    var clean = url.split('?')[0];
    if (!/^\/(auth|access|payments|crm|comments|practice|course|progress|telegram|xapi|cmi5)/.test(clean)) {
      var mm = clean.match(/(\/auth|\/access|\/payments|\/crm|\/comments|\/practice|\/course|\/progress|\/telegram|\/xapi|\/cmi5)(.*)$/);
      clean = mm ? mm[1] + mm[2] : clean;
    }
    var q = {}; (url.split('?')[1] || '').split('&').forEach(function (kv) { if (kv) { var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); } });
    var keys = Object.keys(routes);
    for (var i = 0; i < keys.length; i++) {
      var parts = keys[i].split(' '); if (parts[0] !== method) continue;
      var tmpl = parts[1].split('/'), act = clean.split('/');
      if (tmpl.length !== act.length) continue;
      var params = {}, ok = true;
      for (var j = 0; j < tmpl.length; j++) {
        if (tmpl[j].charAt(0) === ':') params[tmpl[j].slice(1)] = act[j];
        else if (tmpl[j] !== act[j]) { ok = false; break; }
      }
      if (ok) return { key: keys[i], params: params, q: q };
    }
    return null;
  }

  function request(method, url, body) {
    var m = match(method, url);
    var d = db();
    if (!m) return res(404, { detail: 'mock route not found: ' + method + ' ' + url });
    var handler = routes[m.key];
    var tok = (LS.getItem('rl_token') || '').replace(/"/g, '');
    var uidn = d.sessions[tok];
    var u = uidn && d.users.filter(function (x) { return x.id === uidn; })[0];
    try { return Promise.resolve(handler(body || {}, d, tok, u, m.params, m.q)); }
    catch (e) { return res(500, { detail: String(e) }); }
  }

  window.RLMockAPI = {
    request: request,
    hash: hash,
    reset: function () { LS.removeItem(DB_KEY); },
    db: db,
    // direct helpers used by offline SCORM mode (no login required there)
    localGet: function (k) { try { return JSON.parse(LS.getItem('rl_local_' + k)); } catch (e) { return null; } },
    localSet: function (k, v) { LS.setItem('rl_local_' + k, JSON.stringify(v)); }
  };
})();
