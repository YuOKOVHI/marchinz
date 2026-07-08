/*
 * marchinz-journey.js (v1.30.0) — MarchinZ Log 再生(旧称 Journey)
 * MarchinZ Log(年代・県・大会名)から「足取り」を日本地図上でアニメーション再生する。
 * - Leaflet 1.9 + OpenStreetMap タイルを初回起動時に動的ロード(初期ページ重量ゼロ増)
 * - プロフィール(#profile &tab=mll)の「MarchinZ Logを再生」ボタンから起動
 * - 公開制御は Firestore ルール任せ(他人のプロフィールでは公開 Log のみ読める)
 * - Note(event_log_diaries)の表紙写真があれば停留カードに表示
 * - 動画書き出しは marchinz-journey-export.js(window.MarchinZJourneyExport)
 */
(function () {
  "use strict";

  var LEAFLET_CSS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css";
  var LEAFLET_JS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js";
  // CARTO Positron: ミニマルなライトグレー基調(イベントマップと共通デザイン)
  var TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  var TILE_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
  var TILE_OPTS = { attribution: TILE_ATTR, subdomains: "abcd", maxZoom: 19 };
  var JAPAN_BOUNDS = [[22.0, 120.0], [47.5, 151.0]];

  var PREF_COORDS = {
    北海道: [43.064, 141.347], 青森県: [40.824, 140.74], 岩手県: [39.704, 141.153],
    宮城県: [38.269, 140.872], 秋田県: [39.719, 140.102], 山形県: [38.24, 140.364],
    福島県: [37.75, 140.468], 茨城県: [36.342, 140.447], 栃木県: [36.566, 139.884],
    群馬県: [36.391, 139.06], 埼玉県: [35.857, 139.649], 千葉県: [35.605, 140.123],
    東京都: [35.69, 139.692], 神奈川県: [35.448, 139.643], 新潟県: [37.902, 139.023],
    富山県: [36.695, 137.211], 石川県: [36.594, 136.626], 福井県: [36.065, 136.222],
    山梨県: [35.664, 138.568], 長野県: [36.651, 138.181], 岐阜県: [35.391, 136.722],
    静岡県: [34.977, 138.383], 愛知県: [35.18, 136.907], 三重県: [34.73, 136.509],
    滋賀県: [35.005, 135.869], 京都府: [35.021, 135.756], 大阪府: [34.686, 135.52],
    兵庫県: [34.691, 135.183], 奈良県: [34.685, 135.833], 和歌山県: [34.226, 135.168],
    鳥取県: [35.504, 134.238], 島根県: [35.472, 133.05], 岡山県: [34.662, 133.934],
    広島県: [34.396, 132.459], 山口県: [34.186, 131.471], 徳島県: [34.066, 134.559],
    香川県: [34.34, 134.043], 愛媛県: [33.842, 132.766], 高知県: [33.56, 133.531],
    福岡県: [33.607, 130.418], 佐賀県: [33.249, 130.3], 長崎県: [32.745, 129.874],
    熊本県: [32.79, 130.742], 大分県: [33.238, 131.613], 宮崎県: [31.911, 131.424],
    鹿児島県: [31.56, 130.558], 沖縄県: [26.212, 127.681], 海外: [25.5, 122.0],
  };

  var leafletReady = null;

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletReady) return leafletReady;
    leafletReady = new Promise(function (resolve, reject) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
      var s = document.createElement("script");
      s.src = LEAFLET_JS;
      s.onload = function () { resolve(window.L); };
      s.onerror = function () { leafletReady = null; reject(new Error("Leaflet load failed")); };
      document.head.appendChild(s);
    });
    return leafletReady;
  }

  window.MarchinZJourneyPrefCoords = PREF_COORDS;
  window.MarchinZLeafletLoader = loadLeaflet;

  function getDb() {
    try { return window.MLL_AUTH?.getDb?.() || null; } catch (e) { return null; }
  }

  function prefCoord(name) {
    var key = String(name || "").trim();
    if (PREF_COORDS[key]) return PREF_COORDS[key];
    var hit = Object.keys(PREF_COORDS).find(function (k) {
      return key && (k.indexOf(key) === 0 || key.indexOf(k.replace(/[都道府県]$/, "")) === 0);
    });
    return hit ? PREF_COORDS[hit] : null;
  }

  /* ---------- dialog ---------- */

  var dlg = null;
  var els = {};

  function buildDialog() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.id = "mz-journey-dialog";
    dlg.className = "mz-journey-dialog";
    dlg.innerHTML =
      '<div class="mz-journey-surface" role="document">' +
      '<button type="button" class="mz-journey-x" data-journey-close aria-label="閉じる">×</button>' +
      '<div class="mz-journey-head"><span class="mz-journey-eyebrow" lang="en">MARCHINZ LOG</span>' +
      '<p class="mz-journey-title" data-journey-title>MarchinZ Log</p></div>' +
      '<div class="mz-journey-map" data-journey-map aria-label="足取りの地図"></div>' +
      '<div class="mz-journey-card" data-journey-card hidden></div>' +
      '<div class="mz-journey-controls" data-journey-controls hidden>' +
      '<button type="button" class="mz-journey-btn" data-journey-prev aria-label="前へ">⏮</button>' +
      '<button type="button" class="mz-journey-btn mz-journey-btn--play" data-journey-play aria-label="再生/一時停止">⏸</button>' +
      '<button type="button" class="mz-journey-btn" data-journey-next aria-label="次へ">⏭</button>' +
      '<div class="mz-journey-progress"><div class="mz-journey-progress-bar" data-journey-bar></div></div>' +
      '<span class="mz-journey-year" data-journey-year></span>' +
      '<button type="button" class="mz-journey-btn mz-journey-speed" data-journey-speed aria-label="再生速度">1x</button>' +
      '<button type="button" class="mz-journey-btn mz-journey-export-btn" data-journey-export aria-label="動画を保存">📹</button>' +
      "</div>" +
      '<p class="mz-journey-msg" data-journey-msg hidden></p>' +
      "</div>";
    document.body.appendChild(dlg);
    els = {
      title: dlg.querySelector("[data-journey-title]"),
      map: dlg.querySelector("[data-journey-map]"),
      card: dlg.querySelector("[data-journey-card]"),
      controls: dlg.querySelector("[data-journey-controls]"),
      play: dlg.querySelector("[data-journey-play]"),
      prev: dlg.querySelector("[data-journey-prev]"),
      next: dlg.querySelector("[data-journey-next]"),
      bar: dlg.querySelector("[data-journey-bar]"),
      year: dlg.querySelector("[data-journey-year]"),
      speed: dlg.querySelector("[data-journey-speed]"),
      msg: dlg.querySelector("[data-journey-msg]"),
    };
    dlg.querySelector("[data-journey-close]").addEventListener("click", close);
    dlg.addEventListener("cancel", function () { stopPlayback(); });
    els.play.addEventListener("click", togglePlay);
    els.prev.addEventListener("click", function () { jump(-1); });
    els.next.addEventListener("click", function () { jump(1); });
    els.speed.addEventListener("click", cycleSpeed);
    dlg.querySelector("[data-journey-export]").addEventListener("click", startExport);
    return dlg;
  }

  function close() {
    stopPlayback();
    try { dlg.close(); } catch (e) { /* noop */ }
    dlg.removeAttribute("open");
  }

  /* ---------- playback state ---------- */

  var map = null;
  var marker = null;
  var line = null;
  var stops = [];
  var idx = -1;
  var playing = false;
  var speed = 1;
  var rafId = 0;
  var phase = "idle"; // idle | travel | dwell | done
  var phaseStart = 0;
  var summaryShown = false;
  var avatarUrl = "";
  var displayName = "";
  var currentUid = "";

  /** 再生を止めて動画書き出し(marchinz-journey-export.js)へ引き渡す */
  function startExport() {
    if (!stops.length) return;
    if (!window.MarchinZJourneyExport) {
      window.alert("動画書き出し機能を読み込めませんでした。ページを再読み込みしてお試しください。");
      return;
    }
    stopPlayback();
    els.play.textContent = "▶";
    window.MarchinZJourneyExport.start({
      uid: currentUid,
      stops: stops,
      displayName: displayName,
      avatarUrl: avatarUrl,
      host: dlg, // <dialog> の top layer 内に UI を出すため(body 直下だと modal の下に隠れる)
    });
  }

  var TRAVEL_MS = 1700;
  var DWELL_MS = 1500;

  function stopPlayback() {
    playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function setMsg(text) {
    els.msg.textContent = text || "";
    els.msg.hidden = !text;
  }

  function kindColorForRole() {
    return "#1e4fd6";
  }

  function renderCard(stop) {
    var year = String(stop.date || "").slice(0, 4);
    els.card.innerHTML =
      '<span class="mz-journey-card-year">' + (year || "—") + "</span>" +
      '<span class="mz-journey-card-body"><span class="mz-journey-card-title"></span>' +
      '<span class="mz-journey-card-meta"><span class="mz-journey-card-pref"></span>' +
      (stop.roleLabel ? '<span class="mz-journey-card-role"></span>' : "") +
      "</span></span>";
    els.card.querySelector(".mz-journey-card-title").textContent = stop.title || "(大会名未登録)";
    els.card.querySelector(".mz-journey-card-pref").textContent = "📍 " + stop.pref;
    var roleEl = els.card.querySelector(".mz-journey-card-role");
    if (roleEl) roleEl.textContent = stop.roleLabel;
    if (stop.notePhoto) {
      var ph = document.createElement("img");
      ph.className = "mz-journey-card-photo";
      ph.src = stop.notePhoto;
      ph.alt = "";
      ph.loading = "lazy";
      ph.decoding = "async";
      ph.onerror = function () { ph.remove(); };
      els.card.appendChild(ph);
    }
    els.card.hidden = false;
    els.card.classList.remove("mz-journey-card--bounce");
    void els.card.offsetWidth;
    els.card.classList.add("mz-journey-card--bounce");
    els.year.textContent = year ? year + "年" : "";
    els.bar.style.width = ((idx + 1) / stops.length) * 100 + "%";
  }

  function showSummary() {
    if (summaryShown) return;
    summaryShown = true;
    var years = stops.map(function (s) { return Number(String(s.date).slice(0, 4)); }).filter(Boolean);
    var span = years.length ? Math.max(1, Math.max.apply(null, years) - Math.min.apply(null, years) + 1) : stops.length;
    var prefs = {};
    stops.forEach(function (s) { prefs[s.pref] = 1; });
    var prefCount = Object.keys(prefs).length;
    var shareText =
      (displayName ? displayName + "の" : "私の") + "MarchinZ Log🗺️ " +
      span + "年間・" + prefCount + "都道府県・" + stops.length + "の記録 #MarchinZ https://marchinz.netlify.app";
    els.card.innerHTML =
      '<div class="mz-journey-summary">' +
      '<p class="mz-journey-summary-head">🏁 MarchinZ Log まとめ</p>' +
      '<p class="mz-journey-summary-stats">' +
      '<span><b>' + span + "</b>年間</span><span><b>" + prefCount + "</b>都道府県</span><span><b>" + stops.length + "</b>の記録</span></p>" +
      '<div class="mz-journey-summary-actions">' +
      '<button type="button" class="mz-journey-share-btn" data-journey-share>シェア文をコピー</button>' +
      '<button type="button" class="mz-journey-share-btn mz-journey-export-cta" data-journey-export-cta>📹 動画を保存</button>' +
      "</div></div>";
    els.card.hidden = false;
    els.card.querySelector("[data-journey-share]").addEventListener("click", function () {
      var btn = this;
      (navigator.clipboard ? navigator.clipboard.writeText(shareText) : Promise.reject())
        .then(function () { btn.textContent = "コピーしました!"; })
        .catch(function () { window.prompt("コピーしてください", shareText); });
    });
    els.card.querySelector("[data-journey-export-cta]").addEventListener("click", startExport);
    els.play.textContent = "↻";
    window.MarchinZConfetti?.burst();
    if (map) {
      var pts = stops.map(function (s) { return s.coord; });
      map.flyToBounds(pts, { padding: [46, 46], duration: 1.2 });
    }
  }

  function currentPos(t) {
    var from = stops[Math.max(0, idx - 1)].coord;
    var to = stops[idx].coord;
    var e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOut
    return [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
  }

  function frame(now) {
    if (!playing) return;
    var elapsed = (now - phaseStart) * speed;
    if (phase === "travel") {
      var t = Math.min(1, elapsed / TRAVEL_MS);
      var pos = currentPos(t);
      marker.setLatLng(pos);
      map.panTo(pos, { animate: false });
      if (t >= 1) {
        line.addLatLng(stops[idx].coord);
        renderCard(stops[idx]);
        phase = "dwell";
        phaseStart = now;
      }
    } else if (phase === "dwell") {
      if (elapsed >= DWELL_MS) {
        if (idx >= stops.length - 1) {
          phase = "done";
          playing = false;
          showSummary();
          return;
        }
        idx += 1;
        var same = stops[idx].coord[0] === stops[idx - 1].coord[0] && stops[idx].coord[1] === stops[idx - 1].coord[1];
        if (same) {
          renderCard(stops[idx]);
          phase = "dwell";
        } else {
          phase = "travel";
        }
        phaseStart = now;
      }
    }
    rafId = requestAnimationFrame(frame);
  }

  function startFrom(i, autoplay) {
    stopPlayback();
    summaryShown = false;
    idx = Math.max(0, Math.min(i, stops.length - 1));
    var pts = stops.slice(0, idx + 1).map(function (s) { return s.coord; });
    line.setLatLngs(pts);
    marker.setLatLng(stops[idx].coord);
    map.panTo(stops[idx].coord, { animate: false });
    renderCard(stops[idx]);
    els.play.textContent = autoplay ? "⏸" : "▶";
    if (autoplay) {
      playing = true;
      phase = "dwell";
      phaseStart = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  function togglePlay() {
    if (phase === "done" || (!playing && idx >= stops.length - 1 && summaryShown)) {
      startFrom(0, true);
      return;
    }
    if (playing) {
      stopPlayback();
      els.play.textContent = "▶";
    } else {
      playing = true;
      if (phase === "idle" || phase === "done") phase = "dwell";
      phaseStart = performance.now();
      els.play.textContent = "⏸";
      rafId = requestAnimationFrame(frame);
    }
  }

  function jump(dir) {
    if (!stops.length) return;
    startFrom(idx + dir, false);
  }

  function cycleSpeed() {
    speed = speed >= 2 ? 1 : 2;
    els.speed.textContent = speed + "x";
  }

  /* ---------- data + open ---------- */

  function avatarIcon(L) {
    var src = avatarUrl || "logo/marchinz-logo.png";
    return L.divIcon({
      className: "mz-journey-avatar-icon",
      html: '<span class="mz-journey-avatar-ring"><img src="' + src.replace(/"/g, "&quot;") + '" alt=""></span>',
      iconSize: [46, 46],
      iconAnchor: [23, 23],
    });
  }

  async function open(uid, name) {
    uid = String(uid || "").trim();
    if (!uid) return;
    currentUid = uid;
    displayName = String(name || "").trim();
    buildDialog();
    setMsg("");
    els.card.hidden = true;
    els.controls.hidden = true;
    els.title.textContent = (displayName ? displayName + "さんの" : "") + "MarchinZ Log";
    dlg.removeAttribute("hidden");
    try { if (!dlg.open) dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    setMsg("読み込み中…");

    var db = getDb();
    if (!db) { setMsg("データに接続できません。"); return; }

    var L;
    try { L = await loadLeaflet(); } catch (e) { setMsg("地図の読み込みに失敗しました。通信環境をご確認ください。"); return; }

    var logs = [];
    try {
      var snap = await db.collection("mll_logs").where("user_id", "==", uid).limit(400).get();
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        logs.push({
          date: String(d.event_date || "").trim(),
          title: String(d.event_name || "").trim(),
          venue: String(d.venue || "").trim(),
          roleLabel: String(d.role_label || "").trim(),
          eventId: String(d.calendar_event_id || "").trim(),
        });
      });
    } catch (e) {
      console.warn("[journey]", e);
      setMsg("Log を読み込めませんでした(非公開の可能性があります)。");
      return;
    }

    try {
      var p = await db.collection("mll_profiles").doc(uid).get();
      var pd = p.exists ? p.data() || {} : {};
      avatarUrl = String(pd.avatar_url || "").trim();
      if (!displayName) displayName = String(pd.display_name || "").trim();
      els.title.textContent = (displayName ? displayName + "さんの" : "") + "MarchinZ Log";
    } catch (e) { /* avatar は任意 */ }

    logs.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var skipped = 0;
    stops = [];
    logs.forEach(function (lg) {
      if (!lg.date) { skipped += 1; return; }
      var c = prefCoord(lg.venue);
      if (!c) { skipped += 1; return; }
      stops.push({ coord: c, pref: lg.venue, date: lg.date, title: lg.title, roleLabel: lg.roleLabel, eventId: lg.eventId, notePhoto: "" });
    });

    if (!stops.length) {
      setMsg("場所つきの公開 Log がまだありません。イベントに参加して Log を残すと、ここに足あとが描かれます。");
      return;
    }

    // Note(event_log_diaries)の表紙写真を停留カードに出す。
    // 他人の非公開 Note は permission-denied になるため、1件ずつ get して個別に握りつぶす。
    try {
      var eventIds = [];
      stops.forEach(function (s) {
        if (s.eventId && eventIds.indexOf(s.eventId) === -1) eventIds.push(s.eventId);
      });
      var coverByEventId = {};
      await Promise.all(
        eventIds.map(function (eid) {
          return db
            .collection("mll_profiles").doc(uid)
            .collection("event_log_diaries").doc(eid)
            .get()
            .then(function (noteSnap) {
              if (!noteSnap.exists) return;
              var nd = noteSnap.data() || {};
              var cover = window.MarchinZDefaultAssets?.noteCoverUrl?.(nd.photo_urls, nd.cover_photo_index) || "";
              if (cover) coverByEventId[eid] = cover;
            })
            .catch(function () { /* 非公開・権限なしはスキップ */ });
        }),
      );
      stops.forEach(function (s) {
        if (s.eventId && coverByEventId[s.eventId]) s.notePhoto = coverByEventId[s.eventId];
      });
    } catch (e) { /* Note 写真は任意装飾。失敗しても再生は続行 */ }

    setMsg(skipped > 0 ? skipped + "件は場所未登録のためスキップしました" : "");

    if (!map) {
      map = L.map(els.map, {
        zoomControl: false,
        attributionControl: true,
        maxBounds: JAPAN_BOUNDS,
        maxBoundsViscosity: 0.8,
        minZoom: 4.4,
      });
      L.tileLayer(TILE_URL, TILE_OPTS).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
    }
    setTimeout(function () { map.invalidateSize(); }, 60);

    if (line) { line.remove(); }
    if (marker) { marker.remove(); }
    line = L.polyline([], { color: "#1e4fd6", weight: 3, opacity: 0.85, dashArray: "1 7", lineCap: "round" }).addTo(map);
    marker = L.marker(stops[0].coord, { icon: avatarIcon(L), zIndexOffset: 500 }).addTo(map);

    var pts = stops.map(function (s) { return s.coord; });
    if (pts.length > 1) map.fitBounds(pts, { padding: [46, 46] });
    else map.setView(pts[0], 7);

    els.controls.hidden = false;
    speed = 1;
    els.speed.textContent = "1x";

    setTimeout(function () {
      map.setView(stops[0].coord, Math.max(map.getZoom(), 6.5), { animate: true });
      startFrom(0, true);
    }, 900);
  }

  /* ---------- profile ボタンの結線 ---------- */

  function bindProfileButton() {
    var btn = document.getElementById("mz-journey-open-btn");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", function () {
      var uid = "";
      var name = "";
      try {
        var params = window.MarchinZProfileHashParams?.() || {};
        uid = String(params.uid || "").trim();
      } catch (e) { /* fallthrough */ }
      if (!uid) {
        var m = String(location.hash || "").match(/[?&]uid=([^&]+)/);
        if (m) uid = decodeURIComponent(m[1]);
      }
      if (!uid) uid = String(window.MLL_AUTH?.getUser?.()?.id || "").trim();
      var nameEl = document.getElementById("prof-page-heading");
      if (nameEl) name = "";
      open(uid, name);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindProfileButton);
  } else {
    bindProfileButton();
  }
  window.addEventListener("mll-auth-changed", bindProfileButton);

  window.MarchinZJourney = { open: open };
})();
