/* Russian Launchpad — app.js (webapp shell: landing, pricing, auth, dashboard, player, labs, CRM, subscription) */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var me = null;               // current user
  var access = null;           // /access result

  function apiGet(url) { return window.RLMockAPI.request('GET', url).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); }); }
  function apiSend(method, url, body) { return window.RLMockAPI.request(method, url, body).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); }); }

  function show(view) {
    ['landing', 'pricing', 'login', 'dashboard', 'player', 'pronlab', 'speech', 'inbox', 'crm', 'subscribe'].forEach(function (v) {
      var e = document.getElementById('view-' + v); if (e) e.classList.add('hidden');
    });
    var t = document.getElementById('view-' + view); if (t) t.classList.remove('hidden');
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (a) {
      a.classList.toggle('active', a.getAttribute('data-view') === view);
    });
    if (view === 'dashboard') loadDashboard();
    if (view === 'inbox' || view === 'crm') {
      if (!me) { show('login'); return; }
      if (me.role === 'student') { show('dashboard'); return; }
    }
    if (view === 'inbox') loadInbox();
    if (view === 'crm') loadCRM();
    if (view === 'subscribe') loadSubscribe();
    if (view === 'pronlab' || view === 'speech') ensurePlayer();
    history.replaceState(null, '', '#' + view);
  }

  // ---------------------------------------------------------------- auth ---
  function initAuthNav() {
    var token = localStorage.getItem('rl_token');
    if (!token) return Promise.resolve();
    var tok = JSON.parse(token);
    // re-register mirrored sessions into the fresh db copy (mock storage resets per tab seed)
    try {
      var mirror = JSON.parse(localStorage.getItem('rl_sessions') || '{}');
      var d = window.RLMockAPI.db(); var dirty = false;
      Object.keys(mirror).forEach(function (t) { if (!d.sessions[t]) { d.sessions[t] = mirror[t]; dirty = true; } });
      if (dirty) localStorage.setItem('rl_db_v1', JSON.stringify(d));
    } catch (e) {}
    return apiGet('/auth/me').then(function (r) { if (r.ok) setLogged(r.body); else localStorage.removeItem('rl_token'); });
  }
  function setLogged(u) {
    me = u;
    $('#whoami').textContent = u.name + ' (' + u.role + ')';
    Array.prototype.forEach.call(document.querySelectorAll('.hidden-if-student'), function (a) {
      a.classList.toggle('hidden', u.role === 'student');
    });
    $('#btn-logout').classList.remove('hidden');
    $('#nav-auth').classList.add('hidden');
    refreshAccess();
  }
  function refreshAccess() {
    return apiGet('/access').then(function (r) { if (r.ok) access = r.body; });
  }
  $('#btn-login').onclick = function () {
    apiSend('POST', '/auth/login', { email: $('#login-email').value, password: $('#login-pass').value })
      .then(function (r) {
        if (!r.ok) { $('#login-err').textContent = r.body.detail || 'Login failed'; return; }
        localStorage.setItem('rl_token', JSON.stringify(r.body.access_token));
        setLogged(r.body.user); show('dashboard');
      });
  };
  $('#btn-register').onclick = function () {
    apiSend('POST', '/auth/register', { email: $('#reg-email').value, password: $('#reg-pass').value, name: $('#reg-name').value })
      .then(function (r) {
        if (!r.ok) { $('#reg-err').textContent = r.body.detail; return; }
        localStorage.setItem('rl_token', JSON.stringify(r.body.access_token));
        setLogged(r.body.user); show('dashboard');
      });
  };
  $('#btn-logout').onclick = function () {
    localStorage.removeItem('rl_token'); me = null; access = null;
    $('#whoami').textContent = ''; $('#btn-logout').classList.add('hidden'); $('#nav-auth').classList.remove('hidden');
    show('landing');
  };

  // ------------------------------------------------------------ gating -----
  function gate(next) {
    if (!me) { show('login'); return false; }
    if (access && !access.hasAccess) { show('subscribe'); return false; }
    next(); return true;
  }

  // --------------------------------------------------------- dashboard -----
  function loadDashboard() {
    var host = $('#dash-cards'); host.innerHTML = '';
    window.RL_COURSE.lessons.forEach(function (l) {
      var c = document.createElement('div'); c.className = 'card col';
      c.appendChild(Object.assign(document.createElement('h3'), { textContent: l.title }));
      c.appendChild(Object.assign(document.createElement('p'), { className: 'muted', textContent: l.objectives[0] }));
      var b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Open lesson';
      b.onclick = function () { window.RLPlayer.state.lessonId = l.id; gatePlayer(l.id); };
      c.appendChild(b);
      host.appendChild(c);
    });
    apiGet('/progress').then(function (r) {
      if (!r.ok) return;
      var pg = r.body; var done = Object.keys(pg).filter(function (k) { return pg[k].completed; });
      $('#dash-progress').textContent = 'Completed lessons: ' + done.length + ' / ' + window.RL_COURSE.lessons.length;
    });
    var daily = $('#daily-mission');
    var missions = ['Record 2 phrases in the Pronunciation Lab and compare them with the reference.',
      'Finish Lesson 2 quiz with 75%+.',
      'Say 3 fill-in-the-blank answers out loud (hybrid mode).'];
    daily.textContent = '🎯 Daily mission: ' + missions[new Date().getDay() % missions.length];
  }

  var playerMounted = false;
  function ensurePlayer() {
    if (!playerMounted) {
      window.RLPlayerUser = me;
      window.RLPlayer.mount('player-root');
      playerMounted = true;
    }
  }
  function gatePlayer(lessonId) {
    if (!gate(function () {})) return;
    ensurePlayer();
    if (lessonId) window.RLPlayer.state.lessonId = lessonId;
    show(me && me.role === 'student' && !(access && access.hasAccess) ? 'subscribe' : 'player');
  }

  // ------------------------------------------------------- subscription ----
  function loadSubscribe() {
    var host = $('#sub-state');
    if (!me) { show('login'); return; }
    apiGet('/access').then(function (r) {
      var a = r.body;
      if (a.subscription && a.subscription.status === 'active') {
        host.innerHTML = '<span class="pill ok">Active ' + a.subscription.plan + '</span> until ' + new Date(a.subscription.expiresAt).toLocaleDateString() +
          ' · auto-renew ' + (a.subscription.autoRenew ? 'on' : 'off');
      } else if (a.subscription) {
        host.innerHTML = '<span class="pill warn">' + a.subscription.status + '</span>';
      } else {
        host.textContent = 'No subscription yet. Demo tip: pick any plan and confirm the mock payment.';
      }
    });
  }
  function subscribe(plan) {
    apiSend('POST', '/payments/checkout', { plan: plan, provider: 'mock', autoRenew: true }).then(function (r) {
      if (!r.ok) return;
      return apiSend('POST', '/payments/confirm', { paymentId: r.body.paymentId });
    }).then(function (r) {
      if (r && r.ok) {
        window.RLTracking.subscription('activated', plan);
        refreshAccess(); loadSubscribe();
        $('#sub-msg').textContent = '✅ Subscription activated (mock payment). Welcome aboard!';
      }
    });
  }
  window.rlSubscribe = subscribe;
  $('#btn-renew').onclick = function () { apiSend('POST', '/payments/renew', {}).then(function (r) { if (r.ok) { window.RLTracking.subscription('renewed', r.body.plan); loadSubscribe(); } }); };
  $('#btn-cancel').onclick = function () { apiSend('POST', '/payments/cancel', {}).then(function (r) { if (r.ok) { window.RLTracking.subscription('canceled', r.body.plan); loadSubscribe(); } }); };

  // ------------------------------------------------------------- inbox -----
  function loadInbox() {
    if (!me || me.role === 'student') { $('#inbox-root').innerHTML = '<p class="muted">Editor/admin only.</p>'; return; }
    apiGet('/comments').then(function (r) {
      var host = $('#inbox-root'); host.innerHTML = '';
      var card = document.createElement('div'); card.className = 'card';
      card.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Comment inbox (' + r.body.length + ')' }));
      window.RLComments.render(card, {
        targetType: 'all', targetId: 'all', user: me, list: r.body,
        onPost: function () {}, onPatch: function (id, patch) { apiSend('PATCH', '/comments/' + id, patch); }
      });
      host.appendChild(card);
    });
  }

  // --------------------------------------------------------------- crm -----
  function loadCRM() {
    if (!me || me.role === 'student') { $('#crm-root').innerHTML = '<p class="muted">Editor/admin only.</p>'; return; }
    apiGet('/crm/contacts').then(function (r) {
      var host = $('#crm-root'); host.innerHTML = '';
      var card = document.createElement('div'); card.className = 'card';
      var table = document.createElement('table');
      table.innerHTML = '<tr><th>Contact</th><th>Source</th><th>Status</th><th>Notes</th><th>Assigned</th><th></th></tr>';
      r.body.forEach(function (c) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + esc(c.contact) + '</td><td>' + esc(c.source) + '</td><td></td><td>' + esc(c.notes) + '</td><td></td>';
        var stSel = document.createElement('select');
        ['new', 'contacted', 'interested', 'trial', 'paid', 'churned', 'spam'].forEach(function (s) {
          var o = document.createElement('option'); o.value = s; o.textContent = s; if (s === c.status) o.selected = true; stSel.appendChild(o);
        });
        stSel.onchange = function () { apiSend('PATCH', '/crm/contacts/' + c.id, { status: stSel.value }); };
        tr.children[2].appendChild(stSel);
        var asgSel = document.createElement('select');
        ['', 'u-editor', 'u-admin'].forEach(function (s) {
          var o = document.createElement('option'); o.value = s; o.textContent = s || 'unassigned'; if (c.assigned_to === s) o.selected = true; asgSel.appendChild(o);
        });
        asgSel.onchange = function () { apiSend('PATCH', '/crm/contacts/' + c.id, { assigned_to: asgSel.value || null }); };
        tr.children[4].appendChild(asgSel);
        table.appendChild(tr);
      });
      card.appendChild(table);
      var add = document.createElement('div'); add.className = 'row';
      add.innerHTML = '<input id="crm-new" placeholder="New contact email/tag"><select id="crm-src"><option>manual</option><option>landing_form</option><option>stripe_checkout</option><option>telegram_mini_app</option><option>web_register</option></select>';
      var btn = document.createElement('button'); btn.className = 'btn small'; btn.textContent = 'Add';
      btn.onclick = function () { apiSend('POST', '/crm/contacts', { contact: $('#crm-new').value, source: $('#crm-src').value }).then(loadCRM); };
      add.appendChild(btn); card.appendChild(add);
      host.appendChild(card);
    });
  }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  // ----------------------------------------------------------- tracking UI -
  $('#btn-statements').onclick = function () {
    var log = (window.RLTracking.lrs.log && window.RLTracking.lrs.log()) || [];
    $('#stmt-count').textContent = log.length + ' statements in mock LRS';
    $('#stmt-dump').textContent = JSON.stringify(log.slice(-8), null, 2);
    $('#stmt-modal').showModal();
  };

  // ---------------------------------------------------------------- boot ---
  Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var v = a.getAttribute('data-view');
      if (['dashboard', 'player', 'pronlab', 'speech', 'subscribe'].indexOf(v) >= 0) { if (!gate(function () { show(v); })) return; if (v !== 'dashboard' && v !== 'subscribe') ensurePlayer(); }
      else if (v === 'inbox' || v === 'crm') { if (!me) { show('login'); return; } show(v); }
      else show(v);
    });
  });

  function boot() {
    window.RLCourseData.init('').then(function (course) {
      // attach immigration glossary for the lab tab
      window.RL_IMMIGRATION_GLOSSARY = course.immigrationGlossary = [];
      course.lessons.forEach(function (l) {
        l.vocabulary.forEach(function (v) { if (v.immigration) course.immigrationGlossary.push({ lessonId: l.id, type: 'term', ru: v.ru, en: v.en, hint: v.hint }); });
      });
      return initAuthNav();
    }).then(function () {
      var h = (location.hash || '#landing').slice(1);
      if (me) show(h === 'landing' ? 'dashboard' : h); else if (['landing','pricing','login'].indexOf(h) >= 0) show(h); else show('landing');
      if (!me) show('landing');
    }).catch(function (e) {
      document.body.insertAdjacentHTML('beforeend', '<p style="color:#f87171;padding:16px">Failed to load course data: ' + e + '. Serve via python3 -m http.server.</p>');
    });
  }
  boot();
})();
