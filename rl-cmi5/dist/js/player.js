/* Russian Launchpad — shared lesson player (webapp, SCORM, xAPI, cmi5 bundles) */
(function () {
  'use strict';

  var state = { lessonId: null, tab: 'dialogue', rate: 1 };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function api() { return window.RLPlayerAPI || window.RLMockAPI; }
  function user() { return window.RLPlayerUser || null; }
  function saveAttempt(a, cb) {
    // mirror into local storage so SCORM/offline finish logic can read progress
    try {
      var pg = (window.RLMockAPI && window.RLMockAPI.localGet('progress')) || {};
      if (a.kind === 'quiz' && a.lessonId) {
        var lp = pg[a.lessonId] = pg[a.lessonId] || {};
        lp.quizScore = a.scorePercent; if (a.scorePercent >= 70) lp.completed = true;
        window.RLMockAPI && window.RLMockAPI.localSet('progress', pg);
      }
    } catch (e) {}
    if (!api()) { cb && cb(); return; }
    api().request('POST', '/practice/attempt', a).then(function () { cb && cb(); }).catch(function () { cb && cb(); });
  }
  function getAttempts(targetId, cb) {
    if (!api()) return cb([]);
    api().request('GET', '/practice/attempts?targetId=' + encodeURIComponent(targetId))
      .then(function (r) { return r.json(); }).then(cb).catch(function () { cb([]); });
  }

  // ------------------------------------------------------------- tabs ------
  var TAB_DEFS = [
    ['dialogue', 'Dialogue'], ['vocab', 'Vocabulary'], ['grammar', 'Grammar'],
    ['pron', 'Pronunciation Lab'], ['speech', 'Speech Fill-in-the-Blank'],
    ['quiz', 'Quiz']
  ];
  function renderTabs(host, lesson, containerId) {
    host.innerHTML = '';
    var defs = TAB_DEFS.slice();
    if (lesson.id === 'l3') defs.push(['immigration', 'Immigration Test Lab']);
    var bar = el('div', 'tabs');
    defs.forEach(function (d) {
      var b = el('button', state.tab === d[0] ? 'active' : '', d[1]);
      b.setAttribute('data-tab', d[0]);
      b.onclick = function () {
        state.tab = d[0];
        try { localStorage.setItem('rl_tab_' + containerId, d[0]); } catch (e) {}
        renderTabs(host, lesson, containerId); renderBody(lesson, containerId);
      };
      bar.appendChild(b);
    });
    host.appendChild(bar);
  }

  function renderBody(lesson, containerId) {
    var body = document.getElementById('lesson-body-' + containerId) || document.getElementById('lesson-body');
    body.innerHTML = '';
    ({
      dialogue: viewDialogue, vocab: viewVocab, grammar: viewGrammar,
      pron: viewPron, speech: viewSpeech, quiz: viewQuiz, immigration: viewImmigration
    })[state.tab](body, lesson);
    if (window.RL_Tint) window.RL_Tint.apply(body);
    // Language legend (redundant cue beyond color — NN/g: don't rely on color alone).
    // Inserted AFTER tinting and marked no-tint so its own words are not painted.
    try {
      var tintOn = !window.RL_Tint || window.RL_Tint.isEnabled();
      if (tintOn && body.querySelector('.tint-ru,.tint-en')) {
        var lg = el('div', 'tint-legend no-tint');
        lg.appendChild(el('span', 'lg-ru', '● русский'));
        lg.appendChild(el('span', 'lg-en', '● English'));
        var st = document.createElement('span');
        st.className = 'lg-stress';
        st.innerHTML = '<b class="stress">о</b> — ударная буква (жирная)';
        lg.appendChild(st);
        body.insertBefore(lg, body.firstChild);
      }
    } catch (e) {}
  }

  // --------------------------------------------------------- dialogue ------
  function viewDialogue(host, lesson) {
    var d = lesson.dialogue;
    var card = el('div', 'card');
    card.appendChild(el('h3', null, d.title));
    d.lines.forEach(function (ln) {
      var row = el('div', 'dlg-line'); row.style.margin = '10px 0';
      var who = el('span', 'pill', ln.speaker); row.appendChild(who);
      var spkBtn = el('button', 'btn small secondary', '🔊');
      spkBtn.style.marginLeft = '8px';
      spkBtn.onclick = function () { window.RLTTS.playReference({ ru: ln.ru }, { rate: state.rate }); };
      row.appendChild(spkBtn);
      var ru = el('div', null, ln.ru); ru.style.fontSize = '18px'; row.appendChild(ru);
      row.appendChild(el('div', 'muted', ln.en));
      row.appendChild(el('div', 'muted', '💡 ' + (ln.hint || '')));
      card.appendChild(row);
    });
    commentSlot(card, 'lesson', lesson.id + ':dialogue');
    host.appendChild(card);
  }

  // ------------------------------------------------------------ vocab ------
  function viewVocab(host, lesson) {
    var card = el('div', 'card'); card.appendChild(el('h3', null, 'Vocabulary'));
    lesson.vocabulary.forEach(function (v) {
      var row = el('div', 'row'); row.style.borderBottom = '1px dashed #334155'; row.style.padding = '6px 0';
      var ru = el('b', null, v.ru); var en = el('span', 'muted', v.en + ' · ' + v.pos);
      var hint = el('span', 'muted', v.hint || '');
      var btn = el('button', 'btn small secondary', '🔊');
      btn.onclick = function () { window.RLTTS.speak(v.ru, { rate: state.rate }); };
      row.appendChild(ru); row.appendChild(btn); row.appendChild(en); row.appendChild(hint);
      card.appendChild(row);
    });
    host.appendChild(card);
  }

  // ---------------------------------------------------------- grammar ------
  function viewGrammar(host, lesson) {
    lesson.grammar.forEach(function (g) {
      var card = el('div', 'card');
      card.appendChild(el('h3', null, g.title));
      card.appendChild(el('p', 'muted', g.summary));
      g.examples.forEach(function (ex) {
        var r = el('div', 'row'); r.style.margin = '6px 0';
        r.appendChild(el('span', null, ex.ru)); r.appendChild(el('span', 'muted', ex.en));
        card.appendChild(r);
      });
      if (g.conjugation && g.conjugation.forms) {
        var t = el('table'); var tr = el('tr');
        g.conjugation.forms.forEach(function (f) {
          var td = el('td'); td.appendChild(el('b', null, f.person)); td.appendChild(el('div', 'tint-done', f.ru)); tr.appendChild(td);
        });
        t.appendChild(tr); card.appendChild(t);
        if (g.conjugation.infinitive) card.appendChild(el('div', 'muted', 'Infinitive: ' + g.conjugation.infinitive + ' · ' + (g.conjugation.tense || '')));
      }
      commentSlot(card, 'exercise', g.id);
      host.appendChild(card);
    });
  }

  // ------------------------------------------------- Pronunciation Lab -----
  function viewPron(host, lesson) {
    var card = el('div', 'card');
    card.appendChild(el('h3', null, 'Pronunciation Lab'));
    card.appendChild(el('p', 'muted', 'Read the phrase aloud, listen to yourself, then compare with the reference TTS.'));
    var picker = el('select'); 
    lesson.pronunciation.forEach(function (p) { var o = el('option', null, p.ru); o.value = p.id; picker.appendChild(o); });
    card.appendChild(picker);
    var wrap = el('div'); card.appendChild(wrap);
    if (!lesson.pronunciation || !lesson.pronunciation.length) { card.appendChild(el('p','muted','No pronunciation items in this lesson.')); host.appendChild(card); return; }
    picker.onchange = function () { pronItem(wrap, lesson, picker.value); };
    if (lesson.pronunciation && lesson.pronunciation.length) pronItem(wrap, lesson, lesson.pronunciation[0].id);
    host.appendChild(card);
  }

  function pronItem(host, lesson, pid) {
    host.innerHTML = '';
    var item = lesson.pronunciation.filter(function (p) { return p.id === pid; })[0];
    var box = el('div'); box.style.marginTop = '12px';
    box.appendChild(el('div', null, item.ru)).style.fontSize = '22px';
    box.appendChild(el('div', 'muted', item.en));
    box.appendChild(el('div', 'muted', item.ipa + ' · 💡 ' + item.hint));

    // speed control 1x / 0.75x / 0.5x + loop
    var ctl = el('div', 'row');
    var speedSel = el('select'); speedSel.style.width = 'auto';
    [['1x', 1], ['0.75x', 0.75], ['0.5x', 0.5]].forEach(function (s) {
      var o = el('option', null, s[0]); o.value = s[1]; if (s[1] === state.rate) o.selected = true; speedSel.appendChild(o);
    });
    speedSel.onchange = function () { state.rate = parseFloat(speedSel.value); };
    var loopChk = el('input'); loopChk.type = 'checkbox';
    ctl.appendChild(el('label', null, 'Speed')); ctl.appendChild(speedSel);
    ctl.appendChild(el('label', null, 'Loop reference')); ctl.appendChild(loopChk);
    box.appendChild(ctl);

    var refBtn = el('button', 'btn secondary', '▶ Reference (TTS)');
    refBtn.onclick = function () {
      playRef();
      function playRef() {
        window.RLTTS.playReference(item, { rate: state.rate, audioEl: hiddenAudio() }).then(function (r) {
          if (r.engine === 'webspeech' && loopChk.checked) setTimeout(playRef, 900);
        });
      }
    };
    box.appendChild(refBtn);

    // Record button + waveform + timer
    var recBtn = el('button', 'btn', '● Record');
    var stopBtn = el('button', 'btn danger hidden', '■ Stop');
    var timer = el('span', 'rec-timer', '0.0s');
    var canvas = el('canvas', 'wave'); canvas.width = 600; canvas.height = 64;
    var micRow = el('div', 'row'); micRow.appendChild(recBtn); micRow.appendChild(stopBtn); micRow.appendChild(timer);
    box.appendChild(micRow); box.appendChild(canvas);

    // Fallbacks when microphone unavailable
    var fb = el('div', 'card', ''); fb.style.background = 'var(--panel2)';
    var canMic = window.RLRecorder.micAvailable();
    if (!canMic) {
      fb.appendChild(el('p', 'muted', 'Microphone is not available here — use one of the fallbacks below (your attempt is still saved).'));
    }
    var typeIn = el('input'); typeIn.placeholder = 'Typing fallback: transliterate what you said…';
    var typeBtn = el('button', 'btn small', 'Save typed attempt');
    fb.appendChild(typeIn); fb.appendChild(typeBtn);
    var fileIn = el('input'); fileIn.type = 'file'; fileIn.accept = 'audio/*';
    var fileLbl = el('label', 'muted', 'File input fallback: upload your recording');
    fb.appendChild(fileLbl); fb.appendChild(fileIn);
    box.appendChild(fb);

    var attemptsUl = el('ul', 'attempts'); box.appendChild(attemptsUl);
    function refreshAttempts() {
      getAttempts(item.id, function (list) {
        attemptsUl.innerHTML = '';
        list.filter(function (a) { return a.kind === 'pronunciation'; }).forEach(function (a) {
          var li = el('li');
          var info = el('span', null, new Date(a.ts).toLocaleTimeString() + ' · ' + (a.mode || 'mic') + (a.durationMs ? ' · ' + (a.durationMs / 1000).toFixed(1) + 's' : ''));
          li.appendChild(info);
          if (a.url) { var pb = el('button', 'btn small secondary', '▶ Play mine'); pb.onclick = function () { var au = new Audio(a.url); au.playbackRate = state.rate; au.play(); }; li.appendChild(pb); }
          var cmp = el('button', 'btn small', 'Compare');
          cmp.onclick = function () {
            if (a.url) { var au = new Audio(a.url); au.playbackRate = state.rate; au.play(); }
            setTimeout(function () { window.RLTTS.playReference(item, { rate: state.rate, audioEl: hiddenAudio() }); }, a.url ? 400 : 0);
            window.RLTracking.compared(item.id);
          };
          li.appendChild(cmp);
          var del = el('button', 'btn small danger', '✕');
          del.onclick = function () {
            if (api()) api().request('DELETE', '/practice/attempt/' + a.id).then(refreshAttempts);
          };
          li.appendChild(del);
          attemptsUl.appendChild(li);
        });
      });
    }
    refreshAttempts();

    var rec = null, waveInt = null, timerInt = null;
    var ctx2d = canvas.getContext('2d');
    recBtn.onclick = function () {
      rec = new window.RLRecorder.Recorder({});
      rec.start().then(function () {
        recBtn.classList.add('hidden'); stopBtn.classList.remove('hidden');
        timerInt = setInterval(function () { timer.textContent = (rec.elapsedMs() / 1000).toFixed(1) + 's'; }, 100);
        waveInt = setInterval(drawWave, 80);
      }).catch(function () {
        timer.textContent = 'no mic — use fallbacks';
      });
    };
    stopBtn.onclick = function () {
      rec.stop().then(function (res) {
        clearInterval(waveInt); clearInterval(timerInt);
        stopBtn.classList.add('hidden'); recBtn.classList.remove('hidden');
        drawStaticWave();
        saveAttempt({ kind: 'pronunciation', targetId: item.id, lessonId: lesson.id, mode: 'mic', url: res.url, durationMs: res.durationMs }, refreshAttempts);
        window.RLTracking.recorded(item.id, 1, res.durationMs);
      });
    };
    function drawWave() {
      var data = rec.sampleWaveform(); if (!data) return;
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.fillStyle = '#22d3ee';
      var bw = canvas.width / data.length;
      data.forEach(function (v, i) { ctx2d.fillRect(i * bw, canvas.height - (v / 255) * canvas.height, bw - 1, (v / 255) * canvas.height); });
    }
    function drawStaticWave() {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.strokeStyle = '#94a3b8'; ctx2d.beginPath();
      for (var x = 0; x < canvas.width; x += 6) ctx2d.lineTo(x, canvas.height / 2 + Math.sin(x / 18) * 12);
      ctx2d.stroke();
    }
    typeBtn.onclick = function () {
      saveAttempt({ kind: 'pronunciation', targetId: item.id, lessonId: lesson.id, mode: 'typing', note: typeIn.value }, refreshAttempts);
      window.RLTracking.recorded(item.id, 1, 0); typeIn.value = '';
    };
    fileIn.onchange = function () {
      var f = fileIn.files[0]; if (!f) return;
      var url = URL.createObjectURL(f);
      saveAttempt({ kind: 'pronunciation', targetId: item.id, lessonId: lesson.id, mode: 'file-upload', url: url, durationMs: Math.round(f.size / 16) }, refreshAttempts);
      window.RLTracking.recorded(item.id, 1, 0);
    };
    box.appendChild(el('p', 'muted', canMic ? '' : '⚠ Recording fallback active: typing/file modes are fully supported.'));
    host.appendChild(box);
    commentSlot(host, 'pronunciation_phrase', item.id);
  }

  var _hiddenAudio = null;
  function hiddenAudio() {
    if (!_hiddenAudio) { _hiddenAudio = el('audio'); _hiddenAudio.className = 'hidden'; document.body.appendChild(_hiddenAudio); }
    return _hiddenAudio;
  }

  // ------------------------------------------- Speech Fill-in-the-Blank ----
  function viewSpeech(host, lesson) {
    var card = el('div', 'card');
    card.appendChild(el('h3', null, 'Speech Fill-in-the-Blank'));
    card.appendChild(el('p', 'muted, ', ''));
    var modeNote = el('p', 'muted', 'Mode: hybrid (speech first, typing always available).');
    card.appendChild(modeNote);
    if (!lesson.speechBlanks || !lesson.speechBlanks.length) { card.appendChild(el('p','muted','No exercises yet.')); }
    else lesson.speechBlanks.forEach(function (sb) { speechItem(card, lesson, sb); });
    host.appendChild(card);
  }

  function speechItem(host, lesson, sb) {
    var box = el('div'); box.style.cssText = 'border-top:1px solid var(--surface-line);padding:12px 0;margin-top:8px';
    var shown = sb.sentence_ru.replace('___', '______');
    box.appendChild(el('div', null, shown)).style.fontSize = '19px';
    box.appendChild(el('div', 'muted', sb.en));
    box.appendChild(el('div', 'muted', '💡 Hint: ' + sb.hint));

    // Buttons live in a .row so CSS gives them a clear gap (Listen | Say the word)
    var actions = el('div', 'row'); actions.style.marginTop = '8px';
    var listenBtn = el('button', 'btn small secondary', '🔊 Listen');
    listenBtn.onclick = function () { window.RLTTS.playReference(sb, { rate: state.rate, audioEl: hiddenAudio() }); };
    actions.appendChild(listenBtn);

    var sayBtn = el('button', 'btn', '● Say the word');
    var status = el('span', 'muted', ' ');
    actions.appendChild(sayBtn); actions.appendChild(status);
    box.appendChild(actions);
    var typeIn = el('input'); typeIn.placeholder = '…or type the missing word (typing fallback)';
    var checkType = el('button', 'btn small', 'Check typed answer');
    var fb = el('div'); fb.className = window.RLRecorder.srAvailable() && window.RLRecorder.micAvailable() ? 'hidden' : '';
    if (fb.className !== 'hidden') fb.appendChild(el('p', 'muted', 'Speech recognition unavailable → typing fallback enabled automatically.'));
    fb.appendChild(typeIn); fb.appendChild(checkType);
    box.appendChild(fb);

    var resultLine = el('div'); box.appendChild(resultLine);
    var attemptsUl = el('ul', 'attempts'); box.appendChild(attemptsUl);
    function refresh() {
      getAttempts(sb.id, function (list) {
        attemptsUl.innerHTML = '';
        list.filter(function (a) { return a.kind === 'speech_blank'; }).slice(-5).forEach(function (a) {
          var li = el('li');
          li.appendChild(el('span', null, new Date(a.ts).toLocaleTimeString() + ' · ' + a.mode + ' · "' + a.transcript + '"'));
          li.appendChild(el('span', 'fb-' + a.grade, a.grade));
          var del = el('button', 'btn small danger', '✕');
          del.onclick = function () { if (api()) api().request('DELETE', '/practice/attempt/' + a.id).then(refresh); };
          li.appendChild(del);
          attemptsUl.appendChild(li);
        });
      });
    }
    refresh();

    function finish(transcript, mode) {
      var grade = window.RLRecorder.gradeAnswer(transcript, sb.answer);
      resultLine.innerHTML = '';
      var cls = 'fb-' + grade;
      resultLine.appendChild(el('span', cls, grade === 'correct' ? '✅ Correct!' : grade === 'near' ? '≈ So close! Expected: ' + sb.answer : '❌ Not quite. Expected: ' + sb.answer));
      saveAttempt({ kind: 'speech_blank', targetId: sb.id, lessonId: lesson.id, mode: mode, transcript: transcript, grade: grade }, refresh);
      window.RLTracking.practiced(sb.id, grade === 'correct', transcript);
    }

    sayBtn.onclick = function () {
      status.textContent = 'Listening… speak now';
      var rec = new window.RLRecorder.Recorder({});
      rec.recognizeWord('ru-RU').then(function (r) {
        status.textContent = 'Heard: "' + r.transcript + '"';
        finish(r.transcript, 'speech');
      }).catch(function (e) {
        status.textContent = 'Speech failed (' + e.message + ') — type instead.';
        fb.classList.remove('hidden');
      });
    };
    checkType.onclick = function () { if (typeIn.value.trim()) { finish(typeIn.value.trim(), 'typing'); typeIn.value = ''; } };
    typeIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') checkType.click(); });
    host.appendChild(box);
    commentSlot(box, 'exercise', sb.id);
  }

  // -------------------------------------------------------------- quiz -----
  function viewQuiz(host, lesson) {
    var card = el('div', 'card');
    card.appendChild(el('h3', null, 'Lesson Quiz'));
    var answers = {};
    lesson.quiz.forEach(function (q, qi) {
      var qb = el('div'); qb.style.marginBottom = '18px';
      qb.appendChild(el('b', null, (qi + 1) + '. ' + q.prompt));
      if (q.hint) qb.appendChild(el('div', 'muted', q.hint));
      if (q.type === 'multiple_choice') {
        q.options.forEach(function (opt, oi) {
          var lab = el('label', 'quiz-opt'); lab.textContent = opt;
          lab.onclick = function () { answers[q.id] = oi; Array.prototype.forEach.call(qb.querySelectorAll('.quiz-opt'), function (x) { x.classList.remove('sel'); }); lab.classList.add('sel'); };
          qb.appendChild(lab);
        });
      } else {
        var inp = el('input'); inp.placeholder = 'Type your answer…';
        inp.oninput = function () { answers[q.id] = inp.value; };
        qb.appendChild(inp);
      }
      card.appendChild(qb);
      commentSlot(card, 'quiz_question', q.id);
    });
    var submit = el('button', 'btn', 'Submit quiz');
    var out = el('div'); card.appendChild(submit); card.appendChild(out);
    submit.onclick = function () {
      var correct = 0;
      out.innerHTML = '';
      lesson.quiz.forEach(function (q) {
        var ok;
        if (q.type === 'multiple_choice') ok = answers[q.id] === q.correct;
        else ok = window.RLRecorder.normalize(answers[q.id]) === window.RLRecorder.normalize(q.answer);
        if (ok) correct++;
        var line = el('div', ok ? 'fb-correct' : 'fb-incorrect', (ok ? '✔ ' : '✘ ') + q.prompt + (ok ? '' : ' — ' + q.explanation));
        out.appendChild(line);
        window.RLTracking.answered(q.id, ok, ok ? 1 : 0, 1);
      });
      var pct = Math.round(100 * correct / lesson.quiz.length);
      var big = el('h4', pct >= 70 ? 'fb-correct' : 'fb-incorrect', 'Score: ' + correct + '/' + lesson.quiz.length + ' (' + pct + '%)');
      out.insertBefore(big, out.firstChild);
      saveAttempt({ kind: 'quiz', targetId: lesson.id + ':quiz', lessonId: lesson.id, scorePercent: pct, correct: correct, total: lesson.quiz.length });
      if (pct >= 70) { window.RLTracking.passed(pct); window.RLTracking.completed(); }
      else window.RLTracking.failed(pct);
      updateProgress();
    };
    host.appendChild(card);
  }

  // -------------------------------------------------- Immigration Lab ------
  function viewImmigration(host, lesson) {
    var card = el('div', 'card');
    card.appendChild(el('h3', null, 'Immigration Test Lab'));
    card.appendChild(el('p', 'muted', 'Key documents and exam-format questions for the A2 migration language exam. Based on publicly known regulations; verify current rules before your appointment.'));
    var gl = window.RL_IMMIGRATION_GLOSSARY || (window.RL_COURSE.immigrationGlossary || []);
    var gloss = gl.filter(function (g) { return g.lessonId === lesson.id; });
    gloss.forEach(function (g) {
      if (g.type === 'exam_question') return;
      var r = el('div', 'row'); r.style.padding = '6px 0'; r.style.borderBottom = '1px dashed #334155';
      r.appendChild(el('b', null, g.ru));
      var b2 = el('button', 'btn small secondary', '🔊'); b2.onclick = function () { window.RLTTS.speak(g.ru, { rate: state.rate }); };
      r.appendChild(b2);
      r.appendChild(el('span', 'muted', g.en + ' — ' + g.hint));
      card.appendChild(r);
    });
    host.appendChild(card);
  }

  // ------------------------------------------------------------ comments --
  function commentSlot(parent, targetType, targetId) {
    if (window.RLPlayerDisableComments) return;
    var slot = el('div', 'rl-comments-slot no-tint');
    parent.appendChild(slot);
    try {
      window.RLComments.render(slot, {
        targetType: targetType, targetId: targetId, user: user(),
        onPost: function (c, done) { if (api()) api().request('POST', '/comments', c).then(done); },
        onPatch: function (id, patch) { if (api()) api().request('PATCH', '/comments/' + id, patch); }
      });
    } catch (e) { /* comments optional */ }
  }

  // --------------------------------------------------------- dashboard -----
  function updateProgress(containerId) {
    var bar = document.getElementById('course-progress-' + containerId) || document.getElementById('course-progress');
    if (!bar || !user()) return;
    api().request('GET', '/progress').then(function (r) { return r.json(); }).then(function (pg) {
      var total = window.RL_COURSE.lessons.length;
      var done = Object.keys(pg).filter(function (k) { return pg[k].completed; }).length;
      bar.style.width = Math.round(100 * done / total) + '%';
    }).catch(function () {});
  }

  // ------------------------------------------------------------- mount -----
  var mountedHosts = [];   // containerIds currently mounted — used for live re-render (tint toggle)
  function mount(containerId) {
    var root = document.getElementById(containerId);
    root.innerHTML = '';
    if (mountedHosts.indexOf(containerId) < 0) mountedHosts.push(containerId);
    // per-instance tab memory: lab views (#pronlab / #speech) remember their tab
    try { state.tab = localStorage.getItem('rl_tab_' + containerId) || state.tab; } catch (e) {}
    var nav = el('div', 'row');
    var sel = el('select'); sel.style.width = 'auto';
    window.RL_COURSE.lessons.forEach(function (l) { var o = el('option', null, l.title); o.value = l.id; sel.appendChild(o); });
    sel.onchange = function () { state.lessonId = sel.value; open(); };
    nav.appendChild(el('b', null, 'Lessons:')); nav.appendChild(sel);
    var progWrap = el('div', 'progressbar col');
    var progBar = el('div'); progBar.id = 'course-progress-' + containerId; progBar.style.width = '0%';
    progWrap.appendChild(progBar); nav.appendChild(progWrap);
    root.appendChild(nav);
    var tabsHost = el('div'); root.appendChild(tabsHost);
    var body = el('div'); body.id = 'lesson-body-' + containerId; root.appendChild(body);

    function open() {
      var lesson = window.RLCourseData.lesson(state.lessonId);
      renderTabs(tabsHost, lesson, containerId); renderBody(lesson, containerId); updateProgress(containerId);
      window.RLTracking.launch();
    }
    if (!state.lessonId || !window.RLCourseData.lesson(state.lessonId)) state.lessonId = window.RL_COURSE.lessons[0].id;
    open();
    // keep a re-render hook per mounted host (used by the tint toggle — no page reload)
    root.__rlRerender = open;
  }

  function rerenderMounted() {
    mountedHosts.slice().forEach(function (id) {
      var host = document.getElementById(id);
      if (host && typeof host.__rlRerender === 'function') host.__rlRerender();
    });
  }

  window.RLPlayer = { mount: mount, updateProgress: updateProgress, state: state, rerenderMounted: rerenderMounted };
})();
