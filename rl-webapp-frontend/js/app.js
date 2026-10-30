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
    if (view === 'pronlab' || view === 'speech') {
      ensurePlayer(view);
      var hostId = PLAYER_HOSTS[view];
      // lab views must land on their own tab, not whatever the main player left open
      var want = LAB_TAB[view];
      try { localStorage.setItem('rl_tab_' + hostId, want); } catch (e) {}
      openLabTab(hostId, want);
    }
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

  // --------------------------------------------------------- player hosts --
  // Each view (player / pronlab / speech) gets its OWN RLPlayer instance so a
  // direct visit to #pronlab (e.g. via GitHub Pages deep link) renders the real
  // Pronunciation Lab instead of an empty redirect stub.
  var PLAYER_HOSTS = { player: 'player-root', pronlab: 'player-root-pron', speech: 'player-root-speech' };
  function ensurePlayer(view) {
    var id = PLAYER_HOSTS[view || 'player'];
    if (!id) return;
    var host = document.getElementById(id);
    if (!host || host.dataset.mounted === '1') return;
    window.RLPlayerUser = me;
    try {
      window.RLPlayer.mount(id);
      host.dataset.mounted = '1';
      if (window.RLPlayer.instances) window.RLPlayer.instances[id] = null; // reset per-instance tab memory
    } catch (e) {
      host.innerHTML = '<div class="card"><p class="fb-incorrect">Player failed to load: ' + e + '</p></div>';
    }
  }
  // After mount, jump a lab instance straight to its tab.
  var LAB_TAB = { pronlab: 'pron', speech: 'speech' };
  function openLabTab(containerId, tab) {
    var host = document.getElementById(containerId);
    if (!host) return;
    var btns = host.querySelectorAll('.tabs button');
    Array.prototype.forEach.call(btns, function (b) {
      if (b.getAttribute('data-tab') === tab) b.click();
    });
  }
  function gatePlayer(lessonId) {
    if (!gate(function () {})) return;
    ensurePlayer();
    if (lessonId) window.RLPlayer.state.lessonId = lessonId;
    show(me && me.role === 'student' && !(access && access.hasAccess) ? 'subscribe' : 'player');
  }

  // --------------------------------------------------- lessons dropdown ----
  var LESSON_SECTIONS = [
    ['Basics & Getting Around', ['l1', 'l2', 'l3', 'l4', 'l5', 'l6']],
    ['Everyday Errands', ['l7', 'l8', 'l9', 'l10', 'l11', 'l12']],
    ['Health, Money & Services', ['l13', 'l14', 'l15', 'l16']],
    ['Work, Study & Family', ['l17', 'l18', 'l19', 'l20']],
    ['Immigration Test Lab', ['l21', 'l22', 'l23', 'l24', 'l25', 'l26', 'l27']]
  ];
  function buildLessonsDropdown() {
    var panel = document.getElementById('lesson-dropdown');
    var btn = document.getElementById('btn-nav-lessons');
    if (!panel || !btn || !window.RL_COURSE) return;
    panel.innerHTML = '';
    var byId = {};
    window.RL_COURSE.lessons.forEach(function (l) { byId[l.id] = l; });
    var placed = {};
    LESSON_SECTIONS.forEach(function (sec) {
      var items = sec[1].filter(function (id) { return byId[id]; });
      if (!items.length) return;
      items.forEach(function (id) { placed[id] = true; });
      panel.appendChild(Object.assign(document.createElement('div'), { className: 'dd-group-title', textContent: sec[0] }));
      items.forEach(function (id) {
        var l = byId[id];
        var b = document.createElement('button'); b.className = 'dd-item'; b.type = 'button'; b.setAttribute('role', 'menuitem');
        b.innerHTML = '<span class="dd-num">' + l.order + '</span><span>' + l.title +
          '</span><span class="dd-sit">' + (l.situation || '') + '</span>';
        b.onclick = function () { closeDropdown(); gatePlayer(l.id); };
        panel.appendChild(b);
      });
    });
    // any lesson not covered by the section map (future additions) goes to "More"
    var rest = window.RL_COURSE.lessons.filter(function (l) { return !placed[l.id]; });
    if (rest.length) {
      panel.appendChild(Object.assign(document.createElement('div'), { className: 'dd-group-title', textContent: 'More' }));
      rest.forEach(function (l) {
        var b = document.createElement('button'); b.className = 'dd-item'; b.type = 'button';
        b.innerHTML = '<span class="dd-num">' + l.order + '</span><span>' + l.title + '</span>';
        b.onclick = function () { closeDropdown(); gatePlayer(l.id); };
        panel.appendChild(b);
      });
    }
    function openDropdown() { panel.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); }
    function closeDropdown() { panel.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); }
    btn.onclick = function (e) { e.stopPropagation(); panel.classList.contains('hidden') ? openDropdown() : closeDropdown(); };
    document.addEventListener('click', function (e) { if (!panel.contains(e.target) && e.target !== btn) closeDropdown(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDropdown(); });
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
  var pendingRoute = null;   // hash chosen before the app finished booting
  Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var v = a.getAttribute('data-view');
      if (!window.RL_COURSE) { pendingRoute = v; }     // still booting — remember and let boot() route
      if (['dashboard', 'player', 'pronlab', 'speech', 'subscribe'].indexOf(v) >= 0) { if (!gate(function () { show(v); })) return; if (v === 'player') ensurePlayer('player'); }
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
      buildLessonsDropdown();
      var h = pendingRoute || (location.hash || '#landing').slice(1);
      pendingRoute = null;
      route(h);
      // deep links / back-forward navigation on GitHub Pages must re-route live
      window.addEventListener('hashchange', function () { route((location.hash || '#landing').slice(1)); });
    }).catch(function (e) {
      document.body.insertAdjacentHTML('beforeend', '<p style="color:#f87171;padding:16px">Failed to load course data: ' + e + '. Serve via python3 -m http.server.</p>');
    });
  }
  function route(h) {
    if (!h || h === '#' || h === '') h = 'landing';
    if (['landing', 'pricing', 'login'].indexOf(h) >= 0) { show(h); return; }
    if (['dashboard', 'player', 'pronlab', 'speech', 'subscribe', 'inbox', 'crm'].indexOf(h) >= 0) {
      if (!me) { show('login'); return; }              // stay on #login view; user logs in → dashboard
      if (h === 'inbox' || h === 'crm') { show(h); return; }
      gate(function () { show(h); });                   // show() mounts lab instances itself
      return;
    }
    show('landing');                                    // unknown hash → landing
  }
  boot();
})();
