/* MarchinZ SG — YouTube のショウ動画のテンポと音量を可視化する
 * データ: /tools/sg/data/<動画ID>.json（tools/sg/analyze_show.py が生成）
 * テーマ・ショウ概要・ショウ解説: この端末の localStorage（mzsg:<動画ID>）
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var DB_TOP = 0, DB_BOTTOM = -60;
  var PAD = { l: 44, r: 10, t: 20, b: 22 };

  var state = {
    vid: null,
    data: null,          // 解析データ（無ければ null）
    show: { theme: '', summary: '', notes: [] },
    tempoMode: 'abs',
    player: null,
    playerReady: false,
    now: 0,
    duration: 0,
    editing: null,       // 編集中の解説 id
    hoverX: null
  };

  /* ---------- 小物 ---------- */
  function parseVideoId(s) {
    s = (s || '').trim();
    var m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    return null;
  }
  function fmt(t) {
    if (t == null || !isFinite(t)) return '—';
    t = Math.max(0, Math.floor(t));
    var m = Math.floor(t / 60), s = t % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function parseTime(s) {
    s = (s || '').trim().replace(/：/g, ':').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    if (!s) return null;
    var p = s.split(':');
    if (p.length > 3 || p.some(function (x) { return !/^\d+(\.\d+)?$/.test(x); })) return null;
    var t = 0;
    p.forEach(function (x) { t = t * 60 + parseFloat(x); });
    return t;
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  function uid() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- データ参照 ---------- */
  function dbAt(t) {
    var L = state.data && state.data.loudness;
    if (!L) return null;
    var i = Math.round(t / L.hop);
    return (i >= 0 && i < L.values.length) ? L.values[i] : null;
  }
  function bpmAt(t) {
    var T = state.data && state.data.tempo;
    if (!T) return null;
    var i = Math.round(t / T.hop);
    return (i >= 0 && i < T.values.length) ? T.values[i] : null;
  }
  function relOf(bpm) {
    var med = state.data && state.data.tempo.median;
    if (bpm == null || !med) return null;
    return (bpm / med - 1) * 100;
  }
  function tempoText(bpm) {
    if (bpm == null) return '—';
    if (state.tempoMode === 'rel') {
      var r = relOf(bpm);
      return (r >= 0 ? '+' : '') + r.toFixed(1) + '%';
    }
    return Math.round(bpm) + ' BPM';
  }

  /* ---------- 保存 ---------- */
  function saveShow() { if (state.vid) store('mzsg:' + state.vid, state.show); }
  function loadShow(defaults) {
    var saved = store('mzsg:' + state.vid);
    var d = defaults || {};
    state.show = {
      theme: saved && saved.theme != null ? saved.theme : (d.theme || ''),
      summary: saved && saved.summary != null ? saved.summary : (d.summary || ''),
      notes: (saved && Array.isArray(saved.notes) ? saved.notes : (d.notes || [])).map(function (n) {
        return { id: n.id || uid(), t: +n.t || 0, text: String(n.text || '') };
      })
    };
    sortNotes();
  }
  function sortNotes() { state.show.notes.sort(function (a, b) { return a.t - b.t; }); }

  /* ---------- 読み込み ---------- */
  function open(vid) {
    state.vid = vid;
    state.data = null;
    state.now = 0;
    try { history.replaceState(null, '', '?v=' + vid); } catch (e) { /* noop */ }
    $('showSec').hidden = false;
    $('charts').hidden = true;
    $('pending').hidden = true;
    loadPlayer(vid);

    fetch('data/' + vid + '.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        state.data = d;
        state.duration = d.duration || state.duration;
        loadShow(d.show);
        $('charts').hidden = false;
        buildTable();
        renderAll();
      })
      .catch(function () {
        loadShow(null);
        $('pending').hidden = false;
        $('pendingCmd').textContent = 'python3 tools/sg/analyze_show.py "https://youtu.be/' + vid + '"';
        renderAll();
      });
  }

  /* ---------- YouTube ---------- */
  var ytQueue = null;
  function withYT(fn) {
    if (window.YT && window.YT.Player) return fn();
    if (ytQueue) { ytQueue.push(fn); return; }
    ytQueue = [fn];
    window.onYouTubeIframeAPIReady = function () { ytQueue.forEach(function (f) { f(); }); ytQueue = []; };
    var s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }
  function loadPlayer(vid) {
    withYT(function () {
      if (state.player && state.playerReady) { state.player.cueVideoById(vid); return; }
      state.player = new YT.Player('player', {
        videoId: vid,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: function () {
            state.playerReady = true;
            var d = state.player.getDuration();
            if (d && !state.data) state.duration = d;
          }
        }
      });
    });
  }
  function seek(t) {
    state.now = t;
    if (state.player && state.playerReady) {
      state.player.seekTo(t, true);
      var st = state.player.getPlayerState && state.player.getPlayerState();
      if (st !== 1) state.player.playVideo();
    }
    tick(true);
  }
  function tick(force) {
    if (state.player && state.playerReady && state.player.getCurrentTime) {
      var t = state.player.getCurrentTime() || 0;
      if (!force && Math.abs(t - state.now) < 0.04) return;
      state.now = t;
      if (!state.data) { var d = state.player.getDuration(); if (d) state.duration = d; }
    }
    $('nowTime').textContent = fmt(state.now);
    var db = dbAt(state.now);
    $('nowDb').textContent = db == null ? '—' : db.toFixed(0) + ' dB';
    $('nowBpm').textContent = tempoText(bpmAt(state.now));
    markNowNote();
    drawCharts();
  }

  /* ---------- グラフ ---------- */
  function setupCanvas(cv) {
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h, pw: w - PAD.l - PAD.r, ph: h - PAD.t - PAD.b };
  }
  function xOf(g, t) { return PAD.l + (state.duration ? t / state.duration : 0) * g.pw; }
  function tOf(cv, clientX) {
    var r = cv.getBoundingClientRect();
    var f = (clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r);
    return Math.max(0, Math.min(1, f)) * state.duration;
  }

  function tempoScale() {
    var vals = state.data.tempo.values.filter(function (v) { return v != null; });
    if (state.tempoMode === 'rel') {
      var rs = vals.map(relOf), mx = 10;
      rs.forEach(function (r) { mx = Math.max(mx, Math.abs(r)); });
      mx = Math.ceil(mx / 10) * 10;
      return { lo: -mx, hi: mx, step: mx / 2, map: relOf, label: function (v) { return (v > 0 ? '+' : '') + v + '%'; } };
    }
    var lo = Math.min.apply(null, vals.concat([120])), hi = Math.max.apply(null, vals.concat([120]));
    lo = Math.floor((lo - 5) / 20) * 20; hi = Math.ceil((hi + 5) / 20) * 20;
    var step = (hi - lo) > 80 ? 40 : 20;
    return { lo: lo, hi: hi, step: step, map: function (v) { return v; }, label: function (v) { return String(v); } };
  }

  function gridY(g, lo, hi, step, label, zeroStrong) {
    var c = g.ctx;
    c.font = '11px -apple-system, "Hiragino Sans", sans-serif';
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (var v = lo; v <= hi + 1e-9; v += step) {
      var y = PAD.t + (1 - (v - lo) / (hi - lo)) * g.ph;
      c.strokeStyle = (zeroStrong && Math.abs(v) < 1e-9) ? cssVar('--axis') : cssVar('--grid');
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(PAD.l, Math.round(y) + .5); c.lineTo(PAD.l + g.pw, Math.round(y) + .5); c.stroke();
      c.fillStyle = cssVar('--ink-3');
      c.fillText(label(v), PAD.l - 6, y);
    }
  }
  function gridX(g) {
    var c = g.ctx, d = state.duration;
    if (!d) return;
    var step = d > 600 ? 120 : d > 240 ? 60 : 30;
    c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = cssVar('--ink-3');
    c.font = '11px -apple-system, "Hiragino Sans", sans-serif';
    for (var t = 0; t <= d; t += step) c.fillText(fmt(t), xOf(g, t), PAD.t + g.ph + 5);
  }
  function overlays(g, withNumbers) {
    var c = g.ctx;
    // ショウ解説の位置
    state.show.notes.forEach(function (n, i) {
      var x = xOf(g, n.t);
      c.strokeStyle = cssVar('--marker'); c.globalAlpha = .35; c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.beginPath(); c.moveTo(Math.round(x) + .5, PAD.t); c.lineTo(Math.round(x) + .5, PAD.t + g.ph); c.stroke();
      c.setLineDash([]); c.globalAlpha = 1;
      if (withNumbers) {
        c.fillStyle = cssVar('--ink'); c.font = '11px -apple-system, "Hiragino Sans", sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'bottom';
        c.fillText(String(i + 1), x, PAD.t - 4);
      }
    });
    // ホバー位置
    if (state.hoverX != null) {
      c.strokeStyle = cssVar('--ink-3'); c.lineWidth = 1;
      c.beginPath(); c.moveTo(state.hoverX + .5, PAD.t); c.lineTo(state.hoverX + .5, PAD.t + g.ph); c.stroke();
    }
    // 再生位置
    var px = xOf(g, state.now);
    c.strokeStyle = cssVar('--key'); c.lineWidth = 2;
    c.beginPath(); c.moveTo(px, PAD.t - 2); c.lineTo(px, PAD.t + g.ph + 2); c.stroke();
  }

  function drawDb() {
    var g = setupCanvas($('dbCanvas')), c = g.ctx, L = state.data.loudness;
    gridY(g, DB_BOTTOM, DB_TOP, 20, function (v) { return String(v); });
    // 1px ごとに区間の最大値を取る（包絡線）
    var pts = [], n = L.values.length;
    for (var px = 0; px <= g.pw; px++) {
      var a = Math.floor(px / g.pw * n), b = Math.max(a + 1, Math.floor((px + 1) / g.pw * n));
      var m = DB_BOTTOM;
      for (var i = a; i < b && i < n; i++) if (L.values[i] > m) m = L.values[i];
      pts.push(PAD.t + (1 - (m - DB_BOTTOM) / (DB_TOP - DB_BOTTOM)) * g.ph);
    }
    var base = PAD.t + g.ph;
    c.beginPath(); c.moveTo(PAD.l, base);
    pts.forEach(function (y, i) { c.lineTo(PAD.l + i, y); });
    c.lineTo(PAD.l + pts.length - 1, base); c.closePath();
    c.fillStyle = cssVar('--db-fill'); c.fill();
    c.beginPath();
    pts.forEach(function (y, i) { if (i) c.lineTo(PAD.l + i, y); else c.moveTo(PAD.l, y); });
    c.strokeStyle = cssVar('--db'); c.lineWidth = 1.5; c.lineJoin = 'round'; c.stroke();
    overlays(g, true);
  }

  function drawBpm() {
    var g = setupCanvas($('bpmCanvas')), c = g.ctx, T = state.data.tempo, s = tempoScale();
    gridY(g, s.lo, s.hi, s.step, s.label, state.tempoMode === 'rel');
    c.strokeStyle = cssVar('--bpm'); c.lineWidth = 2; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath();
    var pen = false;
    T.values.forEach(function (v, i) {
      if (v == null) { pen = false; return; }
      var x = xOf(g, i * T.hop);
      var y = PAD.t + (1 - (s.map(v) - s.lo) / (s.hi - s.lo)) * g.ph;
      if (pen) c.lineTo(x, y); else c.moveTo(x, y);
      pen = true;
    });
    c.stroke();
    gridX(g);
    overlays(g, false);
  }

  function drawCharts() {
    if (!state.data || $('charts').hidden) return;
    drawDb(); drawBpm();
  }

  function updateTempoLabels() {
    var rel = state.tempoMode === 'rel', med = state.data && state.data.tempo.median;
    $('tempoUnit').textContent = rel ? '%' : 'BPM';
    $('tempoNote').textContent = med ? (rel ? '（ショウ全体の中央値 ' + Math.round(med) + ' BPM を 0%）' : '（中央値 ' + Math.round(med) + ' BPM）') : '';
    document.querySelectorAll('[data-tempo-mode]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-tempo-mode') === state.tempoMode));
    });
  }

  function buildTable() {
    var rows = [], d = state.duration;
    for (var t = 0; t <= d; t += 10) {
      var db = dbAt(t), bpm = bpmAt(t), r = relOf(bpm);
      rows.push('<tr><td>' + fmt(t) + '</td><td>' + (db == null ? '—' : db.toFixed(1)) + '</td><td>' +
        (bpm == null ? '—' : bpm.toFixed(1)) + '</td><td>' + (r == null ? '—' : (r >= 0 ? '+' : '') + r.toFixed(1)) + '</td></tr>');
    }
    $('tableBody').innerHTML = rows.join('');
  }

  /* ---------- ホバー・タップ ---------- */
  function bindChart(cv) {
    function show(ev) {
      if (!state.data) return;
      var r = cv.getBoundingClientRect();
      var x = ev.clientX - r.left;
      if (x < PAD.l || x > r.width - PAD.r) { hide(); return; }
      state.hoverX = Math.round(x);
      var t = tOf(cv, ev.clientX);
      var db = dbAt(t), bpm = bpmAt(t);
      var tip = $('tip');
      tip.innerHTML = '<strong>' + fmt(t) + '</strong><br>音量 ' + (db == null ? '—' : db.toFixed(0) + ' dBFS') +
        '<br>テンポ ' + (bpm == null ? '不明' : Math.round(bpm) + ' BPM' + (relOf(bpm) != null ? '（' + tempoTextRel(bpm) + '）' : ''));
      tip.hidden = false;
      var box = $('charts').getBoundingClientRect();
      var left = r.left - box.left + x + 12;
      if (left + tip.offsetWidth > box.width) left = r.left - box.left + x - tip.offsetWidth - 12;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = (r.top - box.top + 8) + 'px';
      drawCharts();
    }
    function hide() { state.hoverX = null; $('tip').hidden = true; drawCharts(); }
    cv.addEventListener('pointermove', function (ev) { if (ev.pointerType === 'mouse') show(ev); });
    cv.addEventListener('pointerleave', hide);
    cv.addEventListener('click', function (ev) {
      if (!state.duration) return;
      var r = cv.getBoundingClientRect();
      if (ev.clientX - r.left < PAD.l) return;
      seek(tOf(cv, ev.clientX));
    });
  }
  function tempoTextRel(bpm) { var r = relOf(bpm); return (r >= 0 ? '+' : '') + r.toFixed(1) + '%'; }

  /* ---------- ショウ解説 ---------- */
  function renderNotes() {
    var ol = $('notes');
    ol.innerHTML = '';
    state.show.notes.forEach(function (n, i) {
      var li = document.createElement('li');
      li.className = 'sg-note-item';
      li.dataset.id = n.id;
      var no = document.createElement('span'); no.className = 'sg-note-no'; no.textContent = i + 1;
      var tb = document.createElement('button'); tb.type = 'button'; tb.className = 'sg-note-t'; tb.textContent = fmt(n.t);
      tb.setAttribute('aria-label', fmt(n.t) + ' から再生');
      tb.addEventListener('click', function () { seek(n.t); });
      var tx = document.createElement('div'); tx.className = 'sg-note-text'; tx.textContent = n.text;
      var act = document.createElement('div'); act.className = 'sg-note-act';
      var eb = document.createElement('button'); eb.type = 'button'; eb.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
      eb.setAttribute('aria-label', '編集');
      eb.addEventListener('click', function () { startEdit(n); });
      var db = document.createElement('button'); db.type = 'button'; db.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
      db.setAttribute('aria-label', '削除');
      db.addEventListener('click', function () {
        if (!confirm(fmt(n.t) + ' のショウ解説を削除しますか？')) return;
        state.show.notes = state.show.notes.filter(function (x) { return x.id !== n.id; });
        saveShow(); renderAll();
      });
      act.appendChild(eb); act.appendChild(db);
      li.appendChild(no); li.appendChild(tb); li.appendChild(tx); li.appendChild(act);
      ol.appendChild(li);
    });
    $('notesEmpty').hidden = state.show.notes.length > 0;
    markNowNote();
  }
  function markNowNote() {
    var cur = null;
    state.show.notes.forEach(function (n) { if (n.t <= state.now + 0.05) cur = n.id; });
    document.querySelectorAll('.sg-note-item').forEach(function (li) { li.classList.toggle('is-now', li.dataset.id === cur); });
  }
  function startEdit(n) {
    state.editing = n.id;
    $('addTime').value = fmt(n.t);
    $('addText').value = n.text;
    $('addSubmit').innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> 保存';
    $('addCancel').hidden = false;
    $('addText').focus();
  }
  function endEdit() {
    state.editing = null;
    $('addTime').value = ''; $('addText').value = '';
    $('addSubmit').innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> ショウ解説を追加';
    $('addCancel').hidden = true;
  }

  function renderAll() {
    $('themeInput').value = state.show.theme;
    $('summaryInput').value = state.show.summary;
    updateTempoLabels();
    renderNotes();
    tick(true);
  }

  /* ---------- 起動 ---------- */
  function init() {
    $('urlForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var vid = parseVideoId($('urlInput').value);
      $('urlErr').hidden = !!vid;
      if (!vid) { $('urlErr').textContent = 'YouTubeのURLを読み取れませんでした。'; return; }
      open(vid);
    });
    document.querySelectorAll('[data-tempo-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.tempoMode = b.getAttribute('data-tempo-mode');
        store('mzsg:tempoMode', state.tempoMode);
        updateTempoLabels(); tick(true);
      });
    });
    $('themeInput').addEventListener('input', function () { state.show.theme = this.value; saveShow(); });
    $('summaryInput').addEventListener('input', function () { state.show.summary = this.value; saveShow(); });
    $('useNow').addEventListener('click', function () { $('addTime').value = fmt(state.now); });
    $('addCancel').addEventListener('click', endEdit);
    $('addForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var t = parseTime($('addTime').value), text = $('addText').value.trim();
      if (t == null) { alert('時刻を 0:46 のように入力してください。'); $('addTime').focus(); return; }
      if (state.duration && t > state.duration) { alert('動画の長さ（' + fmt(state.duration) + '）を超えています。'); return; }
      if (!text) { $('addText').focus(); return; }
      if (state.editing) {
        state.show.notes.forEach(function (n) { if (n.id === state.editing) { n.t = t; n.text = text; } });
      } else {
        state.show.notes.push({ id: uid(), t: t, text: text });
      }
      sortNotes(); saveShow(); endEdit(); renderAll();
    });
    $('exportBtn').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify({ videoId: state.vid, show: state.show }, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'sg-show-' + state.vid + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    bindChart($('dbCanvas')); bindChart($('bpmCanvas'));
    window.addEventListener('resize', drawCharts);
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', drawCharts);
    }
    setInterval(function () { tick(false); }, 100);

    var savedMode = store('mzsg:tempoMode');
    if (savedMode === 'rel' || savedMode === 'abs') state.tempoMode = savedMode;
    var q = new URLSearchParams(location.search).get('v');
    if (q && parseVideoId(q)) $('urlInput').value = 'https://youtu.be/' + parseVideoId(q);
    $('urlForm').requestSubmit ? $('urlForm').requestSubmit() : $('urlForm').dispatchEvent(new Event('submit'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
