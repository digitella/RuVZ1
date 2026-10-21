/* Russian Launchpad — comments.js
 * Shared comment widget used by webapp / SCORM / xAPI / cmi5 / telegram bundles.
 * Target types: lesson | exercise | quiz_question | pronunciation_phrase.
 * Visibility model: private_instructor (default), public (only if course config allows).
 * Storage: mock-api (localStorage) in preview; real API when RL_API_BASE configured.
 * In SCORM builds comments are disabled by default (commentsInScorm=false).
 */
(function () {
  'use strict';

  function api() { return window.RLCommentsAPI || window.RLMockAPI; }

  function render(mountEl, ctx) {
    // ctx: {targetType, targetId, user, readOnly, list, onPost, onPatch}
    var el = mountEl;
    el.className = 'rl-comments no-tint';
    el.innerHTML = '';

    var h = document.createElement('h4'); h.textContent = 'Questions & notes'; el.appendChild(h);

    var list = document.createElement('ul'); list.className = 'cm-list'; el.appendChild(list);
    (ctx.list || []).forEach(function (c) {
      var li = document.createElement('li'); li.className = 'cm-item' + (c.resolved ? ' resolved' : '');
      var meta = document.createElement('div'); meta.className = 'cm-meta';
      meta.textContent = (c.authorRole === 'editor' || c.authorRole === 'admin' ? 'Instructor · ' : '') + new Date(c.createdAt).toLocaleString() + ' · ' + c.visibility + (c.resolved ? ' · resolved' : '');
      var body = document.createElement('div'); body.className = 'cm-body'; body.textContent = c.body;
      li.appendChild(meta); li.appendChild(body);
      if (c.internalNote && ctx.user && ctx.user.role !== 'student') {
        var inote = document.createElement('div'); inote.className = 'cm-internal'; inote.textContent = 'Internal note: ' + c.internalNote; li.appendChild(inote);
      }
      if (ctx.user && ctx.user.role !== 'student') {
        var btns = document.createElement('div'); btns.className = 'cm-actions';
        var replyBtn = mkBtn('Reply', function () { openForm(c.id); });
        var resBtn = mkBtn(c.resolved ? 'Reopen' : 'Resolve', function () { ctx.onPatch && ctx.onPatch(c.id, { resolved: !c.resolved }); refresh(); });
        var noteBtn = mkBtn('Internal note', function () {
          var t = prompt('Maintainer note (not shown to students):', c.internalNote || '');
          if (t !== null) { ctx.onPatch && ctx.onPatch(c.id, { internalNote: t }); refresh(); }
        });
        btns.appendChild(replyBtn); btns.appendChild(resBtn); btns.appendChild(noteBtn);
        li.appendChild(btns);
      }
      list.appendChild(li);
    });

    if (ctx.readOnly) {
      var msg = document.createElement('p'); msg.className = 'cm-off'; msg.textContent = 'Comments are disabled in this mode.'; el.appendChild(msg);
      return;
    }

    var formWrap = document.createElement('div'); formWrap.className = 'cm-form'; el.appendChild(formWrap);

    function mkBtn(label, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = label; b.onclick = fn; return b; }

    function openForm(replyTo) {
      formWrap.innerHTML = '';
      var ta = document.createElement('textarea'); ta.placeholder = replyTo ? 'Reply to student…' : 'Ask a question about this item (goes privately to your instructor)…'; ta.rows = 2;
      var visRow = document.createElement('label'); visRow.className = 'cm-vis';
      var pubOk = window.RL_COURSE && window.RL_COURSE.config && window.RL_COURSE.config.comments.publicCommentsEnabled;
      var canChoosePublic = pubOk && ctx.user && ctx.user.role !== 'student';
      if (canChoosePublic) {
        var chk = document.createElement('input'); chk.type = 'checkbox'; visRow.appendChild(chk);
        visRow.appendChild(document.createTextNode(' Public'));
      }
      var post = mkBtn('Post', function () {
        if (!ta.value.trim()) return;
        var visibility = (canChoosePublic && formWrap.querySelector('input[type=checkbox]').checked) ? 'public' : 'private_instructor';
        ctx.onPost({ targetType: ctx.targetType, targetId: ctx.targetId, body: ta.value.trim(), visibility: visibility, replyTo: replyTo || null }, function () { refresh(); });
        if (window.RLTracking) window.RLTracking.commented(ctx.targetId, visibility);
      });
      formWrap.appendChild(ta); formWrap.appendChild(visRow); formWrap.appendChild(post);
      ta.focus();
    }

    function refresh() {
      if (!api()) return;
      var q = '?targetType=' + ctx.targetType + '&targetId=' + encodeURIComponent(ctx.targetId);
      Promise.resolve(api().request('GET', '/comments' + q)).then(function (r) { return r.json(); }).then(function (listData) {
        ctx.list = listData; render(el, ctx);
      }).catch(function () {});
    }

    if (!ctx.list) refresh(); else openForm(null);
  }

  window.RLComments = { render: render };
})();
