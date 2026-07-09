/*
 * marchinz-event-map.js (v1.33.1) — イベントマップ
 * #community/events のリスト前、および TOP の「近日開催予定」に、開催地・時期を日本地図で一望するセクション。
 * calendar-events.js が renderCurrentView 後に window.MarchinZEventMap.refresh(events) を呼ぶ（#community/events 側）。
 * marchinz-top-highlights.js が renderUpcomingEvents 後に window.MarchinZEventMapTop.refresh(events) を呼ぶ（TOP 側）。
 * 複数箇所に同時設置できるよう、状態はコントローラー単位（createController）に閉じ込めている。
 * Leaflet と都道府県座標は marchinz-journey.js のローダー/テーブルを共用する。
 */
(function () {
  "use strict";

  // CARTO Positron: ミニマルなライトグレー基調でブランド色のピンが主役になる(無料・要帰属表記)
  var TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  var TILE_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
  var TILE_OPTS = { attribution: TILE_ATTR, subdomains: "abcd", maxZoom: 19 };
  /** 日本周辺に視点を固定(大陸側へ迷子にならない) */
  var JAPAN_BOUNDS = [[22.0, 120.0], [47.5, 151.0]];

  // ピンの色は種別を表す(ポップアップの種別ラベルと対応)。楽しく見えるよう鮮やかめに統一。
  var KIND_COLORS = {
    演奏会: "#8b5cf6", 大会: "#2563eb", イベント: "#f59e0b", 一般: "#10b981",
    高校: "#ec4899", 中学生以下: "#0ea5e9", カラーガード: "#f97316", 海外: "#64748b",
  };

  function coords() { return window.MarchinZJourneyPrefCoords || {}; }

  var POP_WDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  /** "YYYY-MM-DD" → "M/D(曜)"。不正な日付は "MM/DD" 形式のまま返す */
  function fmtStopDate(d) {
    var s = String(d || "").slice(0, 10);
    var t = new Date(s + "T00:00:00");
    if (isNaN(t.getTime())) return s.slice(5).replace("-", "/");
    return t.getMonth() + 1 + "/" + t.getDate() + "(" + POP_WDAYS[t.getDay()] + ")";
  }

  /**
   * 吹き出しの参加予定者アイコン(facepile)。Apple Watch の連絡先クラスタのように、
   * 人数が増えるほどアイコンを小さく重ねて表示する。ev.faces はアバターURL配列(空文字=未設定)。
   * @param {HTMLElement|null} host
   * @param {{faces?: string[], faces_total?: number}} ev
   */
  function appendPopFaces(host, ev) {
    if (!host || !Array.isArray(ev.faces) || !ev.faces.length) return;
    var total = Number(ev.faces_total) || ev.faces.length;
    // 人数でサイズ段階を決める(多いほど小さく)
    var size = total <= 3 ? "s1" : total <= 6 ? "s2" : "s3";
    var row = document.createElement("span");
    row.className = "mz-evmap-pop-faces mz-evmap-pop-faces--" + size;
    var shown = ev.faces.slice(0, 7);
    shown.forEach(function (u, i) {
      var im = document.createElement("img");
      im.className = "mz-evmap-pop-face";
      im.alt = "";
      im.loading = "lazy";
      im.decoding = "async";
      im.style.zIndex = String(shown.length - i);
      im.src = u || "logo/marchinz-logo.png";
      im.onerror = function () { im.src = "logo/marchinz-logo.png"; im.onerror = null; };
      row.appendChild(im);
    });
    if (total > shown.length) {
      var more = document.createElement("span");
      more.className = "mz-evmap-pop-face-more";
      more.textContent = "+" + (total - shown.length);
      row.appendChild(more);
    }
    host.appendChild(row);
  }

  function todayKey() {
    var n = new Date();
    return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
  }

  function plusMonthsKey(m) {
    var n = new Date();
    n.setMonth(n.getMonth() + m);
    return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
  }

  /**
   * @param {{blockId: string, mapElId: string, storageKey: string, panelVisible: () => boolean}} cfg
   */
  function createController(cfg) {
    var latestEvents = [];
    var map = null;
    var markerLayer = null;
    var period = "upcoming"; // upcoming | 3mo | all
    var initTried = false;

    function filteredEvents() {
      var today = todayKey();
      var limit3 = plusMonthsKey(3);
      return latestEvents.filter(function (ev) {
        var d = String(ev.date || "").slice(0, 10);
        if (!d) return false;
        if (period === "upcoming") return d >= today;
        if (period === "3mo") return d >= today && d <= limit3;
        return true;
      });
    }

    function block() { return document.getElementById(cfg.blockId); }
    function mapEl() { return document.getElementById(cfg.mapElId); }

    function isOpen() {
      var b = block();
      return b && !b.classList.contains("mz-event-map-block--closed");
    }

    function ensureMap() {
      if (map || initTried) return Promise.resolve(map);
      var loader = window.MarchinZLeafletLoader;
      if (!loader || !mapEl()) return Promise.resolve(null);
      initTried = true;
      return loader()
        .then(function (L) {
          map = L.map(mapEl(), {
            zoomControl: false,
            attributionControl: true,
            scrollWheelZoom: false,
            maxBounds: JAPAN_BOUNDS,
            maxBoundsViscosity: 0.8,
            minZoom: 4.4,
          });
          L.tileLayer(TILE_URL, TILE_OPTS).addTo(map);
          L.control.zoom({ position: "bottomright" }).addTo(map);
          markerLayer = L.layerGroup().addTo(map);
          map.setView([37.5, 137.2], 5);
          // カード(ポップアップ)を読んでいる間は装飾アニメ(揺れ・パルス)を止める。
          // 「動くのは一度に1つ」: 開く瞬間は地図パンだけが動き、読む時間は静止、閉じたら再開。
          map.on("popupopen", function () {
            var el = mapEl();
            if (el) el.classList.add("mz-evmap--reading");
          });
          map.on("popupclose", function () {
            var el = mapEl();
            if (el) el.classList.remove("mz-evmap--reading");
          });
          return map;
        })
        .catch(function (err) {
          console.warn("[event-map]", err);
          initTried = false;
          return null;
        });
    }

    function jumpToCard(evId) {
      var card = document.querySelector('.calendar-ev-card[data-cal-event-id="' + evId + '"]');
      if (!card) {
        // TOP のマップにはカード一覧が無いため、コミュニティのイベント一覧へ遷移する
        window.location.hash = "#community/events";
        return;
      }
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.add("calendar-ev-card--highlight");
      window.setTimeout(function () { card.classList.remove("calendar-ev-card--highlight"); }, 4200);
    }

    function renderMarkers() {
      if (!map || !markerLayer || !window.L) return;
      var L = window.L;
      // 再描画時に開いたままのポップアップは、元マーカーが clearLayers で消えると
      // 古い座標に取り残されて頭バンドや地図外で見切れる。必ず閉じてから作り直す。
      map.closePopup();
      markerLayer.clearLayers();
      var events = filteredEvents();
      var byPref = {};
      events.forEach(function (ev) {
        var pref = String(ev.venue_pref || "").trim();
        if (!coords()[pref]) return;
        (byPref[pref] = byPref[pref] || []).push(ev);
      });
      var today = todayKey();
      var soonKey = plusMonthsKey(1);
      var bounds = [];
      var dropIndex = 0;
      Object.keys(byPref).forEach(function (pref) {
        var list = byPref[pref].sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
        var c = coords()[pref];
        bounds.push(c);
        var dominant = list[0];
        var color = KIND_COLORS[dominant.kind] || "#1e4fd6";
        var soon = list.some(function (ev) {
          var d = String(ev.date).slice(0, 10);
          return d >= today && d <= soonKey;
        });
        // 揺れはピンごとにランダム周期・位相(風で揺れる風船のように、全部同じ動きにならない)
        var swayDur = (2.6 + Math.random() * 1.8).toFixed(2) + "s";
        var swayDelay = (0.7 + Math.random() * 2.2).toFixed(2) + "s";
        var html =
          '<span class="mz-evmap-pin' + (soon ? " mz-evmap-pin--soon" : "") + '" style="--pin:' + color +
          ";--mz-drop:" + (dropIndex++ * 70) + "ms;--mz-sway-dur:" + swayDur + ";--mz-sway-delay:" + swayDelay + '">' +
          (soon ? '<span class="mz-evmap-pulse"></span>' : "") +
          '<span class="mz-evmap-pin-count">' + list.length + "</span></span>";
        // アンカーはバルーン下端の尖り(46px目)= 実際の開催地に合わせる
        var icon = L.divIcon({ className: "mz-evmap-icon", html: html, iconSize: [40, 46], iconAnchor: [20, 46] });
        var m = L.marker(c, { icon: icon }).addTo(markerLayer);
        var pop = document.createElement("div");
        pop.className = "mz-evmap-pop";
        var head = document.createElement("p");
        head.className = "mz-evmap-pop-head";
        // UIアイコンはFAモノクロ統一(📍カラー絵文字の置換、CLAUDE.md 必須ルール6)
        head.innerHTML = '<i class="fa-solid fa-location-dot" aria-hidden="true"></i> ';
        head.appendChild(document.createTextNode(pref + "・" + list.length + "件"));
        pop.appendChild(head);
        list.slice(0, 3).forEach(function (ev) {
          var kColor = KIND_COLORS[ev.kind] || "#1e4fd6";
          var item = document.createElement("button");
          item.type = "button";
          item.className = "mz-evmap-pop-item";
          item.style.setProperty("--pin", kColor);
          item.innerHTML =
            '<span class="mz-evmap-pop-date">' + fmtStopDate(ev.date) + "</span>" +
            '<span class="mz-evmap-pop-main">' +
            '<span class="mz-evmap-pop-kind">' + (ev.kind || "") + "</span>" +
            '<span class="mz-evmap-pop-title"></span></span>' +
            '<span class="mz-evmap-pop-go" aria-hidden="true">→</span>';
          item.querySelector(".mz-evmap-pop-title").textContent = ev.title || "";
          appendPopFaces(item.querySelector(".mz-evmap-pop-main"), ev);
          item.addEventListener("click", function () {
            map.closePopup();
            jumpToCard(ev.id);
          });
          pop.appendChild(item);
        });
        if (list.length > 3) {
          var more = document.createElement("p");
          more.className = "mz-evmap-pop-more";
          more.textContent = "ほか " + (list.length - 3) + " 件はリストで";
          pop.appendChild(more);
        }
        // autoPan: 開く瞬間に一度だけ地図をパンしてポップアップを可視域へ収める。
        // keepInView は使わない(v1.33.1): 表示中ずっと地図を引き戻すため、カードを
        // 開いたまま隣を見ようとするスワイプと地図がケンカして操作しづらかった。
        m.bindPopup(pop, {
          maxWidth: 250,
          minWidth: 200,
          keepInView: false,
          autoPan: true,
          autoPanPadding: L.point(28, 28),
          className: "mz-evmap-popup",
        });
      });
      var cnt = block() && block().querySelector("[data-evmap-count]");
      if (cnt) cnt.textContent = events.length ? events.length + "件を表示中" : "該当するイベントがありません";
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 7 });
      else if (bounds.length === 1) map.setView(bounds[0], 7);
    }

    function refresh(events) {
      latestEvents = Array.isArray(events) ? events.slice() : [];
      var b = block();
      if (!b) return;
      b.hidden = latestEvents.length === 0;
      if (!isOpen() || !cfg.panelVisible()) return;
      ensureMap().then(function (m) {
        if (!m) return;
        // ポップアップを開いて読んでいる最中のバックグラウンド更新(参加者情報の遅延取得等)では
        // 作り直さない(閉じられる・地図が飛ぶのを防ぐ)。次の更新タイミングで反映される。
        if (m._popup && typeof m._popup.isOpen === "function" && m._popup.isOpen()) return;
        window.setTimeout(function () { m.invalidateSize(); renderMarkers(); }, 80);
      });
    }

    function bindUi() {
      var b = block();
      if (!b || b.dataset.bound) return;
      b.dataset.bound = "1";
      var toggle = b.querySelector("input[data-evmap-toggle]");
      if (toggle) {
        var applyOpen = function (open) {
          b.classList.toggle("mz-event-map-block--closed", !open);
          toggle.checked = open;
        };
        toggle.addEventListener("change", function () {
          var open = toggle.checked;
          applyOpen(open);
          try { localStorage.setItem(cfg.storageKey, open ? "1" : "0"); } catch (e) { /* noop */ }
          if (open) refresh(latestEvents);
        });
        var saved = null;
        try { saved = localStorage.getItem(cfg.storageKey); } catch (e) { /* noop */ }
        // マップ表示がデフォルト。チェックを外した場合のみ次回以降も閉じたまま(端末を問わず記憶)
        applyOpen(saved !== "0");
      }
      b.querySelectorAll("[data-evmap-period]").forEach(function (chip) {
        chip.addEventListener("click", function () {
          period = chip.getAttribute("data-evmap-period") || "upcoming";
          b.querySelectorAll("[data-evmap-period]").forEach(function (c) {
            c.classList.toggle("mz-evmap-chip--active", c === chip);
          });
          renderMarkers();
        });
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bindUi);
    } else {
      bindUi();
    }

    // イベントタブへ遷移してきたときに(初回はここで Leaflet をロードして)描画する
    window.addEventListener("hashchange", function () {
      window.setTimeout(function () {
        if (latestEvents.length) refresh(latestEvents);
      }, 350);
    });

    return { refresh: refresh };
  }

  /** イベントパネルが実際に画面に出ているときだけ Leaflet をロードする(TOP 等での余計な読込を防ぐ) */
  function pageVisible(pageId, blockId) {
    return function () {
      var page = document.getElementById(pageId);
      if (!page || page.hidden) return false;
      var b = document.getElementById(blockId);
      return Boolean(b && b.offsetParent !== null);
    };
  }

  window.MarchinZEventMap = createController({
    blockId: "mz-event-map-block",
    mapElId: "mz-event-map",
    storageKey: "mz_evmap_open",
    panelVisible: pageVisible("page-community", "mz-event-map-block"),
  });

  window.MarchinZEventMapTop = createController({
    blockId: "mz-top-event-map-block",
    mapElId: "mz-top-event-map",
    storageKey: "mz_evmap_open_top",
    panelVisible: pageVisible("page-mll", "mz-top-event-map-block"),
  });
})();
