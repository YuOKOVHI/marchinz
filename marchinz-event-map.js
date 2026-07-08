/*
 * marchinz-event-map.js (v1.28.0) — イベントマップ
 * #community/events のリスト前に、開催地・時期を日本地図で一望するセクション。
 * calendar-events.js が renderCurrentView 後に window.MarchinZEventMap.refresh(events) を呼ぶ。
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

  var KIND_COLORS = {
    演奏会: "#7c3aed", 大会: "#1e4fd6", イベント: "#92400e", 一般: "#0f7a6c",
    高校: "#be185d", 中学生以下: "#2563a8", カラーガード: "#c2410c", 海外: "#475569",
  };

  var latestEvents = [];
  var map = null;
  var markerLayer = null;
  var period = "upcoming"; // upcoming | 3mo | all
  var initTried = false;

  function coords() { return window.MarchinZJourneyPrefCoords || {}; }

  function todayKey() {
    var n = new Date();
    return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
  }

  function plusMonthsKey(m) {
    var n = new Date();
    n.setMonth(n.getMonth() + m);
    return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
  }

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

  function block() { return document.getElementById("mz-event-map-block"); }
  function mapEl() { return document.getElementById("mz-event-map"); }

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
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("calendar-ev-card--highlight");
    window.setTimeout(function () { card.classList.remove("calendar-ev-card--highlight"); }, 4200);
  }

  function renderMarkers() {
    if (!map || !markerLayer || !window.L) return;
    var L = window.L;
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
      var html =
        '<span class="mz-evmap-pin" style="--pin:' + color + ";--mz-drop:" + (dropIndex++ * 70) + 'ms">' +
        (soon ? '<span class="mz-evmap-pulse"></span>' : "") +
        '<span class="mz-evmap-pin-count">' + list.length + "</span></span>";
      var icon = L.divIcon({ className: "mz-evmap-icon", html: html, iconSize: [34, 34], iconAnchor: [17, 17] });
      var m = L.marker(c, { icon: icon }).addTo(markerLayer);
      var pop = document.createElement("div");
      pop.className = "mz-evmap-pop";
      var head = document.createElement("p");
      head.className = "mz-evmap-pop-head";
      head.textContent = pref + " の予定 " + list.length + "件";
      pop.appendChild(head);
      list.slice(0, 3).forEach(function (ev) {
        var item = document.createElement("button");
        item.type = "button";
        item.className = "mz-evmap-pop-item";
        item.innerHTML =
          '<span class="mz-evmap-pop-date">' + String(ev.date).slice(5).replace("-", "/") + "</span>" +
          '<span class="mz-evmap-pop-kind" style="--pin:' + (KIND_COLORS[ev.kind] || "#1e4fd6") + '">' + (ev.kind || "") + "</span>" +
          '<span class="mz-evmap-pop-title"></span>';
        item.querySelector(".mz-evmap-pop-title").textContent = ev.title || "";
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
      m.bindPopup(pop, { maxWidth: 280 });
    });
    var cnt = document.querySelector("[data-evmap-count]");
    if (cnt) cnt.textContent = events.length ? events.length + "件を表示中" : "該当するイベントがありません";
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 7 });
    else if (bounds.length === 1) map.setView(bounds[0], 7);
  }

  /** イベントパネルが実際に画面に出ているときだけ Leaflet をロードする(TOP 等での余計な読込を防ぐ) */
  function panelVisible() {
    var page = document.getElementById("page-community");
    if (!page || page.hidden) return false;
    var b = block();
    return Boolean(b && b.offsetParent !== null);
  }

  function refresh(events) {
    latestEvents = Array.isArray(events) ? events.slice() : [];
    var b = block();
    if (!b) return;
    b.hidden = latestEvents.length === 0;
    if (!isOpen() || !panelVisible()) return;
    ensureMap().then(function (m) {
      if (!m) return;
      window.setTimeout(function () { m.invalidateSize(); renderMarkers(); }, 80);
    });
  }

  function bindUi() {
    var b = block();
    if (!b || b.dataset.bound) return;
    b.dataset.bound = "1";
    var toggle = b.querySelector("[data-evmap-toggle]");
    if (toggle) {
      toggle.addEventListener("click", function () {
        b.classList.toggle("mz-event-map-block--closed");
        var open = isOpen();
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        try { localStorage.setItem("mz_evmap_open", open ? "1" : "0"); } catch (e) { /* noop */ }
        if (open) refresh(latestEvents);
      });
      var saved = null;
      try { saved = localStorage.getItem("mz_evmap_open"); } catch (e) { /* noop */ }
      // モバイルは初回のみ折りたたみ(検索・一覧への到達を優先)。開閉の記憶はどちらの端末でも尊重する
      var defaultClosed = saved === null && window.innerWidth <= 640;
      if (saved === "0" || defaultClosed) {
        b.classList.add("mz-event-map-block--closed");
        toggle.setAttribute("aria-expanded", "false");
      }
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

  window.MarchinZEventMap = { refresh: refresh };
})();
