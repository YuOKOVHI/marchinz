/*
 * marchinz-journey-export.js (v1.30.0) — MarchinZ Log 再生の動画書き出し
 * marchinz-journey.js の「📹 動画を保存」から window.MarchinZJourneyExport.start(...) で起動。
 * Leaflet には依存せず、Web Mercator を自前計算してオフスクリーン canvas(1080×1920 縦型)へ
 * 地図タイル+軌跡+アバター+停留カードを再描画し、canvas.captureStream + MediaRecorder で録画する。
 *
 * CORS メモ(2026-07-08 更新):
 *   - CARTO タイル / lh3.googleusercontent.com(Googleアバター) … crossOrigin="anonymous" で taint なし
 *   - firebasestorage.googleapis.com(Note写真・アップロードアバター) … バケットに CORS 設定済み
 *     (marchinz.netlify.app + localhost:8000/8123 に GET 許可。docs/OPS_GUIDE.md「Storage CORS」参照)
 *     → 通常は taint せず写真が動画に写る。未許可オリジンや設定退行時は crossOrigin ロードに失敗し、
 *       プレースホルダへ自動フォールバック(1枚でも taint すると captureStream 全体が失敗するため)
 */
(function () {
  "use strict";

  var W = 1080;
  var H = 1920;
  var MAP_Y = 190;
  var MAP_H = 1200;
  var CARD_Y = MAP_Y + MAP_H + 40; // 1430
  var TILE_URL_TPL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png";
  var SUBS = ["a", "b", "c", "d"];
  var FPS = 30;
  var INTRO_MS = 1500;
  var OUTRO_MS = 3000;
  var TRAVEL_MS = 1000;
  var DWELL_MS = 1400;
  var MAX_TOTAL_MS = 55000; // SNS の尺制限を意識した上限
  var FONT = '-apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

  /* ---------- Web Mercator ---------- */

  function lngToX(lng, z) { return ((lng + 180) / 360) * 256 * Math.pow(2, z); }
  function latToY(lat, z) {
    var s = Math.sin((lat * Math.PI) / 180);
    s = Math.min(0.9999, Math.max(-0.9999, s));
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z);
  }

  /** stops の bbox が地図領域(パディング込み)へ収まる最大の整数ズームを選ぶ */
  function pickZoom(coords) {
    var pad = 120;
    var fitW = W - pad * 2;
    var fitH = MAP_H - pad * 2;
    for (var z = 8; z >= 4; z--) {
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      coords.forEach(function (c) {
        var x = lngToX(c[1], z);
        var y = latToY(c[0], z);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      });
      if (maxX - minX <= fitW && maxY - minY <= fitH) {
        return { z: z, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
      }
    }
    return null; // 呼び出し側で z=4 相当にフォールバック
  }

  /* ---------- 画像ロード(taint 検査つき) ---------- */

  function loadCrossOriginImage(url, timeoutMs) {
    return new Promise(function (resolve) {
      if (!url) { resolve(null); return; }
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, timeoutMs || 8000);
      img.crossOrigin = "anonymous";
      img.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // taint 検査: 1px 描いて toDataURL が通るか(通らない画像は動画全体を壊すため捨てる)
        try {
          var c = document.createElement("canvas");
          c.width = 2; c.height = 2;
          c.getContext("2d").drawImage(img, 0, 0, 2, 2);
          c.toDataURL();
          resolve(img);
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      };
      img.src = url;
    });
  }

  /** アバター取得失敗時: イニシャル円の data URL(taint しない) */
  function initialAvatarDataUrl(name) {
    var ch = String(name || "?").trim().charAt(0) || "?";
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">' +
      '<rect width="192" height="192" rx="96" fill="#1e3a5f"/>' +
      '<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="86" font-family="Arial, sans-serif" font-weight="700">' +
      ch.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
      "</text></svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  /* ---------- 描画ヘルパー ---------- */

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 日本語込みテキストを幅で折り返し(最大 maxLines 行、あふれは 「…」) */
  function wrapText(ctx, text, maxWidth, maxLines) {
    var lines = [];
    var cur = "";
    var chars = Array.from(String(text || ""));
    for (var i = 0; i < chars.length; i++) {
      var test = cur + chars[i];
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = chars[i];
        if (lines.length >= maxLines) break;
      } else {
        cur = test;
      }
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    if (lines.length >= maxLines && (cur || i < chars.length)) {
      var last = lines[maxLines - 1] || "";
      if (i < chars.length || cur !== last) {
        lines[maxLines - 1] = Array.from(last).slice(0, -1).join("") + "…";
      }
    }
    return lines.slice(0, maxLines);
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  /* ---------- タイムライン ---------- */

  function buildTimeline(stopCount) {
    var travel = TRAVEL_MS;
    var dwell = DWELL_MS;
    var core = (stopCount - 1) * travel + stopCount * dwell;
    var maxCore = MAX_TOTAL_MS - INTRO_MS - OUTRO_MS;
    if (core > maxCore) {
      var k = maxCore / core;
      travel = Math.max(250, travel * k);
      dwell = Math.max(400, dwell * k);
      core = (stopCount - 1) * travel + stopCount * dwell;
    }
    // 各 stop の [travelStart, dwellStart, dwellEnd] を絶対時刻(ms)で並べる
    var segs = [];
    var t = INTRO_MS;
    for (var i = 0; i < stopCount; i++) {
      var travelStart = t;
      if (i > 0) t += travel;
      var dwellStart = t;
      t += dwell;
      segs.push({ travelStart: travelStart, dwellStart: dwellStart, dwellEnd: t });
    }
    return { segs: segs, travel: travel, dwell: dwell, total: t + OUTRO_MS };
  }

  /* ---------- 本体 ---------- */

  var running = false;

  async function start(opts) {
    if (running) return;
    opts = opts || {};
    var stops = Array.isArray(opts.stops) ? opts.stops.filter(function (s) { return s && s.coord; }) : [];
    var host = opts.host || document.body;
    if (!stops.length) return;
    if (typeof HTMLCanvasElement === "undefined" || !HTMLCanvasElement.prototype.captureStream || !window.MediaRecorder) {
      window.alert("お使いのブラウザは動画の書き出しに対応していません。");
      return;
    }
    running = true;

    /* --- UI オーバーレイ --- */
    var overlay = document.createElement("div");
    overlay.className = "mz-jexp-overlay";
    overlay.innerHTML =
      '<div class="mz-jexp-panel">' +
      '<p class="mz-jexp-title">📹 MarchinZ Log を動画にする</p>' +
      '<p class="mz-jexp-status" data-jexp-status>準備中…</p>' +
      '<div class="mz-jexp-preview" data-jexp-preview></div>' +
      '<p class="mz-jexp-note" data-jexp-note hidden>録画中です。この画面を閉じたり、他のアプリ・タブに切り替えたりしないでください。</p>' +
      '<div class="mz-jexp-actions" data-jexp-actions>' +
      '<button type="button" class="mz-journey-share-btn" data-jexp-cancel>キャンセル</button>' +
      "</div></div>";
    host.appendChild(overlay);
    var statusEl = overlay.querySelector("[data-jexp-status]");
    var previewEl = overlay.querySelector("[data-jexp-preview]");
    var noteEl = overlay.querySelector("[data-jexp-note]");
    var actionsEl = overlay.querySelector("[data-jexp-actions]");

    var cancelled = false;
    var recorder = null;
    var rafId = 0;
    function cleanup() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch (e) { /* noop */ }
      overlay.remove();
    }
    overlay.querySelector("[data-jexp-cancel]").addEventListener("click", function () {
      cancelled = true;
      cleanup();
    });

    function setStatus(t) { statusEl.textContent = t; }

    try {
      /* --- 1) ビュー決定 + タイルプリフェッチ --- */
      setStatus("地図を準備中…");
      var coords = stops.map(function (s) { return s.coord; }); // [lat,lng]

      // ---- 移動カメラ(プレビュー journey.js と同じ「各停留に寄りつつ巡る」動き) ----
      // 従来は pickZoom で全体が収まる1ズームに固定し地図を1枚だけ事前描画していた(=引いた絵)。
      // ここではカメラ中心(アバター追従)とズームを時刻ごとに変え、毎フレーム、その視界の
      // タイルをキャッシュから描き直す。タイルはカメラ経路を先読みして必要分だけ一括ロードする。
      var DWELL_ZOOM_MAX = 12;
      var MIN_ZOOM = 4;

      function lerp(a, b, e) { return a + (b - a) * e; }

      /** coords(=[[lat,lng],...])の bbox が (地図領域-余白) に収まる最大ズーム(小数) */
      function fitZoomFor(cs, padPx) {
        if (!cs.length) return MIN_ZOOM;
        var minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
        cs.forEach(function (c) {
          if (c[1] < minLng) minLng = c[1]; if (c[1] > maxLng) maxLng = c[1];
          if (c[0] < minLat) minLat = c[0]; if (c[0] > maxLat) maxLat = c[0];
        });
        var fitW = Math.max(64, W - padPx * 2), fitH = Math.max(64, MAP_H - padPx * 2);
        var spanX0 = Math.abs(lngToX(maxLng, 0) - lngToX(minLng, 0)) || 1e-6; // z0 の世界px
        var spanY0 = Math.abs(latToY(maxLat, 0) - latToY(minLat, 0)) || 1e-6;
        var z = Math.min(Math.log(fitW / spanX0) / Math.LN2, Math.log(fitH / spanY0) / Math.LN2);
        return Math.max(MIN_ZOOM, Math.min(DWELL_ZOOM_MAX, z));
      }
      function centerOf(cs) {
        var la = 0, ln = 0;
        cs.forEach(function (c) { la += c[0]; ln += c[1]; });
        return { lat: la / cs.length, lng: ln / cs.length };
      }

      var overallFit = fitZoomFor(coords, 140);          // 全体表示(intro/outro)のズーム
      var overallCenter = centerOf(coords);
      // 停留の寄りズーム: 全体との差を確保しつつ寄る。1県のみは控えめ上限。タイル数次第で後段引き下げ。
      var dwellZoom = Math.min(DWELL_ZOOM_MAX, Math.max(overallFit + 1.6, coords.length === 1 ? 12 : 10.5));

      var tl = buildTimeline(stops.length);

      /** 時刻 t のアバター現在地(geo)+カード情報 */
      function playheadGeo(t) {
        if (t < INTRO_MS) return { lat: coords[0][0], lng: coords[0][1], cardIdx: -1, doneCount: 0 };
        var last = tl.segs[tl.segs.length - 1];
        if (t >= last.dwellEnd) return { lat: coords[coords.length - 1][0], lng: coords[coords.length - 1][1], cardIdx: stops.length - 1, doneCount: stops.length, outro: true };
        for (var i = 0; i < tl.segs.length; i++) {
          var sg = tl.segs[i];
          if (t < sg.dwellStart) {
            var k = easeInOut(Math.min(1, (t - sg.travelStart) / Math.max(1, tl.travel)));
            var a = coords[Math.max(0, i - 1)], b = coords[i];
            return { lat: lerp(a[0], b[0], k), lng: lerp(a[1], b[1], k), cardIdx: i - 1, doneCount: i };
          }
          if (t < sg.dwellEnd) return { lat: coords[i][0], lng: coords[i][1], cardIdx: i, doneCount: i + 1 };
        }
        return { lat: coords[coords.length - 1][0], lng: coords[coords.length - 1][1], cardIdx: stops.length - 1, doneCount: stops.length };
      }

      /** 時刻 t のカメラ {lng,lat,zoom} */
      function cameraAt(t) {
        var g = playheadGeo(t);
        var last = tl.segs[tl.segs.length - 1];
        if (t < INTRO_MS) {
          // イントロ: 全体からアバターへ寄る
          var ki = easeInOut(Math.min(1, t / Math.max(1, INTRO_MS)));
          return { lng: lerp(overallCenter.lng, coords[0][1], ki), lat: lerp(overallCenter.lat, coords[0][0], ki), zoom: lerp(overallFit, dwellZoom, ki) };
        }
        if (t >= last.dwellEnd) {
          // アウトロ: 最後の停留から全体へ引く(プレビューの flyToBounds 相当)
          var ko = easeInOut(Math.min(1, (t - last.dwellEnd) / Math.max(1, OUTRO_MS)));
          return { lng: lerp(coords[coords.length - 1][1], overallCenter.lng, ko), lat: lerp(coords[coords.length - 1][0], overallCenter.lat, ko), zoom: lerp(dwellZoom, overallFit, ko) };
        }
        var zoom = dwellZoom;
        for (var i = 0; i < tl.segs.length; i++) {
          var sg = tl.segs[i];
          if (t < sg.dwellStart) {
            if (i > 0) {
              // 移動中は隣接2点が収まるまで一旦引いて、また寄る(sinで谷)
              var k = Math.min(1, (t - sg.travelStart) / Math.max(1, tl.travel));
              var segFit = fitZoomFor([coords[i - 1], coords[i]], 200);
              zoom = lerp(dwellZoom, Math.min(dwellZoom, segFit), Math.sin(Math.PI * k));
            }
            break;
          }
          if (t < sg.dwellEnd) { zoom = dwellZoom; break; }
        }
        return { lng: g.lng, lat: g.lat, zoom: zoom };
      }

      /** geo → 地図領域canvas座標(0..W × 0..MAP_H) */
      function project(lng, lat, cam) {
        var zi = Math.round(cam.zoom), scale = Math.pow(2, cam.zoom - zi);
        var cwx = lngToX(cam.lng, zi), cwy = latToY(cam.lat, zi);
        return [W / 2 + (lngToX(lng, zi) - cwx) * scale, MAP_H / 2 + (latToY(lat, zi) - cwy) * scale];
      }

      // ---- 必要タイルを先読み(カメラ経路をサンプリングして集合化) ----
      function addTilesForCam(cam, set) {
        var zi = Math.round(cam.zoom), scale = Math.pow(2, cam.zoom - zi);
        var cwx = lngToX(cam.lng, zi), cwy = latToY(cam.lat, zi);
        var maxTile = Math.pow(2, zi);
        var hx = (W / 2) / scale, hy = (MAP_H / 2) / scale;
        var t0x = Math.floor((cwx - hx) / 256), t1x = Math.floor((cwx + hx) / 256);
        var t0y = Math.floor((cwy - hy) / 256), t1y = Math.floor((cwy + hy) / 256);
        for (var ty = t0y; ty <= t1y; ty++) {
          if (ty < 0 || ty >= maxTile) continue;
          for (var tx = t0x; tx <= t1x; tx++) {
            var wx = ((tx % maxTile) + maxTile) % maxTile;
            set[zi + "/" + wx + "/" + ty] = [zi, wx, ty];
          }
        }
      }
      var MAX_TILES = 420;
      var tileSet = {};
      while (true) {
        tileSet = {};
        for (var ts = 0; ts <= tl.total; ts += 80) addTilesForCam(cameraAt(ts), tileSet);
        addTilesForCam(cameraAt(tl.total - 1), tileSet);
        if (Object.keys(tileSet).length <= MAX_TILES || dwellZoom <= overallFit + 0.5) break;
        dwellZoom -= 0.5; // 寄りを弱めてタイル数を削減
      }

      var tileCache = {};
      var tileKeys = Object.keys(tileSet);
      var loadedCount = 0;
      var loadIdx = 0;
      async function tileWorker() {
        while (loadIdx < tileKeys.length) {
          if (cancelled) return;
          var myIdx = loadIdx++;
          var key = tileKeys[myIdx];
          var zxy = tileSet[key];
          var url = TILE_URL_TPL
            .replace("{s}", SUBS[myIdx % SUBS.length])
            .replace("{z}", String(zxy[0])).replace("{x}", String(zxy[1])).replace("{y}", String(zxy[2]));
          var img = await loadCrossOriginImage(url, 10000);
          if (img) tileCache[key] = img;
          loadedCount++;
          if (loadedCount % 15 === 0) setStatus("地図を準備中… " + Math.round((loadedCount / tileKeys.length) * 100) + "%");
        }
      }
      var workers = [];
      for (var wi = 0; wi < 8; wi++) workers.push(tileWorker());
      await Promise.all(workers);
      if (cancelled) return;

      /** cam のビューポートを tileCache から地図領域(0,0,W,MAP_H)へ描く */
      function drawMap(cam) {
        var zi = Math.round(cam.zoom), scale = Math.pow(2, cam.zoom - zi);
        var cwx = lngToX(cam.lng, zi), cwy = latToY(cam.lat, zi);
        var maxTile = Math.pow(2, zi);
        var hx = (W / 2) / scale, hy = (MAP_H / 2) / scale;
        var t0x = Math.floor((cwx - hx) / 256), t1x = Math.floor((cwx + hx) / 256);
        var t0y = Math.floor((cwy - hy) / 256), t1y = Math.floor((cwy + hy) / 256);
        var sz = 256 * scale + 1; // 継ぎ目防止に+1px
        for (var ty = t0y; ty <= t1y; ty++) {
          for (var tx = t0x; tx <= t1x; tx++) {
            var wx = ((tx % maxTile) + maxTile) % maxTile;
            var dx = (tx * 256 - cwx) * scale + W / 2;
            var dy = (ty * 256 - cwy) * scale + MAP_H / 2;
            var img = tileCache[zi + "/" + wx + "/" + ty];
            if (img) ctx.drawImage(img, dx, dy, sz, sz);
            else { ctx.fillStyle = "#e7edf4"; ctx.fillRect(dx, dy, sz, sz); }
          }
        }
      }

      /* --- 2) アバター/Note 写真のプリロード --- */
      setStatus("写真を準備中…");
      var avatarImg = await loadCrossOriginImage(opts.avatarUrl, 6000);
      if (!avatarImg) avatarImg = await loadCrossOriginImage(initialAvatarDataUrl(opts.displayName), 3000);
      var photoJobs = stops.map(function (s) { return s.notePhoto ? loadCrossOriginImage(s.notePhoto, 8000) : Promise.resolve(null); });
      var photos = await Promise.all(photoJobs);
      if (cancelled) return;

      /* --- 3) canvas / recorder セットアップ --- */
      var canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      canvas.className = "mz-jexp-canvas";
      previewEl.appendChild(canvas);
      var ctx = canvas.getContext("2d");

      var mime = "";
      ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].some(function (m) {
        if (window.MediaRecorder.isTypeSupported(m)) { mime = m; return true; }
        return false;
      });
      if (!mime) throw new Error("対応する動画形式がありません");
      var stream = canvas.captureStream(FPS);
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
      var chunks = [];
      recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      var recorderStopped = new Promise(function (resolve) { recorder.onstop = resolve; });

      /* --- 4) シーン事前計算(tl・カメラは上で定義済み) --- */
      var years = stops.map(function (s) { return Number(String(s.date).slice(0, 4)); }).filter(Boolean);
      var yearSpan = years.length ? Math.max(1, Math.max.apply(null, years) - Math.min.apply(null, years) + 1) : stops.length;
      var prefSet = {};
      stops.forEach(function (s) { prefSet[s.pref] = 1; });
      var prefCount = Object.keys(prefSet).length;

      function drawFrame(t) {
        var cam = cameraAt(t);
        var ph = playheadGeo(t);
        var avatarPos = project(ph.lng, ph.lat, cam); // アバターの地図領域座標
        var isOutro = t >= tl.total - OUTRO_MS;

        // 背景(全体)
        ctx.fillStyle = "#f4f6fb";
        ctx.fillRect(0, 0, W, H);

        // 上部バンド
        var grad = ctx.createLinearGradient(0, 0, W, MAP_Y);
        grad.addColorStop(0, "#0f2138");
        grad.addColorStop(1, "#1e3a6e");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, MAP_Y);
        ctx.fillStyle = "#d97706";
        ctx.font = "700 30px " + FONT;
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
        ctx.fillText("M A R C H I N Z   L O G", 48, 78);
        ctx.fillStyle = "#ffffff";
        ctx.font = "700 52px " + FONT;
        var nm = String(opts.displayName || "").trim();
        ctx.fillText((nm ? nm + " の" : "私の") + " MarchinZ Log 🗺️", 48, 148);

        // 地図(移動カメラ) — 地図領域にクリップして毎フレーム描き直す
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, MAP_Y, W, MAP_H);
        ctx.clip();
        ctx.translate(0, MAP_Y);
        drawMap(cam);

        // 軌跡(通過済み + 現在の移動分)
        ctx.strokeStyle = "#1e4fd6";
        ctx.lineWidth = 7;
        ctx.lineCap = "round";
        ctx.setLineDash([2, 18]);
        ctx.beginPath();
        var lastIdx = Math.max(0, ph.doneCount - 1);
        var p0 = project(coords[0][1], coords[0][0], cam);
        ctx.moveTo(p0[0], p0[1]);
        for (var li = 1; li <= lastIdx; li++) {
          var pli = project(coords[li][1], coords[li][0], cam);
          ctx.lineTo(pli[0], pli[1]);
        }
        ctx.lineTo(avatarPos[0], avatarPos[1]);
        ctx.stroke();
        ctx.setLineDash([]);

        // 通過済み停留ドット
        for (var di = 0; di < ph.doneCount; di++) {
          var pdi = project(coords[di][1], coords[di][0], cam);
          ctx.beginPath();
          ctx.arc(pdi[0], pdi[1], 11, 0, Math.PI * 2);
          ctx.fillStyle = "#1e4fd6";
          ctx.fill();
          ctx.lineWidth = 4;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
        }

        // dwell 中のパルス
        if (ph.cardIdx >= 0 && !isOutro) {
          var sg2 = tl.segs[ph.cardIdx];
          var dt = (t - sg2.dwellStart) / Math.max(1, tl.dwell);
          if (dt >= 0 && dt <= 1) {
            ctx.beginPath();
            ctx.arc(avatarPos[0], avatarPos[1], 40 + 46 * dt, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(30, 79, 214, " + (0.55 * (1 - dt)).toFixed(3) + ")";
            ctx.lineWidth = 6;
            ctx.stroke();
          }
        }

        // アバターマーカー
        var ax = avatarPos[0];
        var ay = avatarPos[1];
        ctx.beginPath();
        ctx.arc(ax, ay, 46, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        if (avatarImg) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(ax, ay, 40, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(avatarImg, ax - 40, ay - 40, 80, 80);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(ax, ay, 40, 0, Math.PI * 2);
          ctx.fillStyle = "#1e3a5f";
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(ax, ay, 46, 0, Math.PI * 2);
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#1e4fd6";
        ctx.stroke();

        // 帰属表記(タイル利用規約上、動画にも必須)
        ctx.font = "500 22px " + FONT;
        var attr = "© OpenStreetMap © CARTO";
        var aw = ctx.measureText(attr).width + 28;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        roundRect(ctx, W - aw - 14, MAP_H - 46, aw, 34, 8);
        ctx.fill();
        ctx.fillStyle = "#4b5a6b";
        ctx.fillText(attr, W - aw, MAP_H - 22);
        ctx.restore();

        // 停留カード / まとめカード
        if (isOutro) {
          drawSummaryCard();
        } else if (ph.cardIdx >= 0) {
          drawStopCard(stops[ph.cardIdx], photos[ph.cardIdx]);
        }

        // 進捗バー + フッター
        var pbY = H - 96;
        ctx.fillStyle = "rgba(15, 33, 56, 0.12)";
        roundRect(ctx, 48, pbY, W - 96, 12, 6);
        ctx.fill();
        ctx.fillStyle = "#1e4fd6";
        var prog = Math.min(1, Math.max(0.02, ph.doneCount / stops.length));
        roundRect(ctx, 48, pbY, (W - 96) * prog, 12, 6);
        ctx.fill();
        ctx.fillStyle = "#7b8794";
        ctx.font = "700 26px " + FONT;
        ctx.textAlign = "left";
        ctx.fillText("MarchinZ", 48, H - 34);
        ctx.textAlign = "right";
        ctx.font = "500 24px " + FONT;
        ctx.fillText("marchinz.netlify.app", W - 48, H - 34);
        ctx.textAlign = "left";
      }

      function drawStopCard(stop, photoImg) {
        var x = 48;
        var w = W - 96;
        var h = 380;
        ctx.save();
        ctx.shadowColor = "rgba(15, 33, 56, 0.18)";
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 8;
        ctx.fillStyle = "#ffffff";
        roundRect(ctx, x, CARD_Y, w, h, 26);
        ctx.fill();
        ctx.restore();

        var textRight = x + w - 40;
        if (photoImg) {
          var pw = 280;
          var pxx = x + w - pw - 36;
          var pyy = CARD_Y + 50;
          ctx.save();
          roundRect(ctx, pxx, pyy, pw, 280, 20);
          ctx.clip();
          // cover 描画
          var ratio = Math.max(pw / photoImg.naturalWidth, 280 / photoImg.naturalHeight);
          var dw = photoImg.naturalWidth * ratio;
          var dh = photoImg.naturalHeight * ratio;
          ctx.drawImage(photoImg, pxx + (pw - dw) / 2, pyy + (280 - dh) / 2, dw, dh);
          ctx.restore();
          textRight = pxx - 30;
        }

        var year = String(stop.date || "").slice(0, 4);
        ctx.fillStyle = "#d97706";
        ctx.font = "700 40px " + FONT;
        ctx.fillText(year ? year + "年" : "", x + 40, CARD_Y + 96);

        ctx.fillStyle = "#0f2138";
        ctx.font = "700 46px " + FONT;
        var lines = wrapText(ctx, stop.title || "(大会名未登録)", textRight - (x + 40), 2);
        lines.forEach(function (ln, i) {
          ctx.fillText(ln, x + 40, CARD_Y + 172 + i * 62);
        });

        ctx.fillStyle = "#5a6b7d";
        ctx.font = "600 34px " + FONT;
        var meta = "📍 " + (stop.pref || "") + (stop.roleLabel ? " ・ " + stop.roleLabel : "");
        ctx.fillText(wrapText(ctx, meta, textRight - (x + 40), 1)[0] || "", x + 40, CARD_Y + 322);
      }

      function drawSummaryCard() {
        var x = 48;
        var w = W - 96;
        var h = 380;
        ctx.save();
        ctx.shadowColor = "rgba(15, 33, 56, 0.18)";
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 8;
        ctx.fillStyle = "#ffffff";
        roundRect(ctx, x, CARD_Y, w, h, 26);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#0f2138";
        ctx.font = "700 52px " + FONT;
        ctx.textAlign = "center";
        ctx.fillText("🏁 MarchinZ Log まとめ", W / 2, CARD_Y + 106);
        ctx.font = "700 44px " + FONT;
        ctx.fillStyle = "#1e4fd6";
        ctx.fillText(yearSpan + "年間 ・ " + prefCount + "都道府県 ・ " + stops.length + "の記録", W / 2, CARD_Y + 208);
        ctx.font = "600 34px " + FONT;
        ctx.fillStyle = "#5a6b7d";
        ctx.fillText("#MarchinZ", W / 2, CARD_Y + 300);
        ctx.textAlign = "left";
      }

      /* --- 5) 録画実行 --- */
      setStatus("録画中… (約" + Math.round(tl.total / 1000) + "秒)");
      noteEl.hidden = false;
      recorder.start(500);
      var startTs = performance.now();
      await new Promise(function (resolve) {
        function loop(now) {
          if (cancelled) { resolve(); return; }
          var t = now - startTs;
          if (t >= tl.total) { resolve(); return; }
          drawFrame(t);
          setStatus("録画中… " + Math.min(100, Math.round((t / tl.total) * 100)) + "%");
          rafId = requestAnimationFrame(loop);
        }
        rafId = requestAnimationFrame(loop);
      });
      if (cancelled) return;
      drawFrame(tl.total - 1); // 最終フレーム
      recorder.stop();
      await recorderStopped;

      /* --- 6) 保存/シェア UI --- */
      var isMp4 = mime.indexOf("mp4") !== -1;
      var blob = new Blob(chunks, { type: isMp4 ? "video/mp4" : "video/webm" });
      var ext = isMp4 ? "mp4" : "webm";
      var dstr = new Date();
      var fileName =
        "marchinz-log-" +
        dstr.getFullYear() +
        String(dstr.getMonth() + 1).padStart(2, "0") +
        String(dstr.getDate()).padStart(2, "0") +
        "." + ext;

      noteEl.hidden = true;
      setStatus("できあがり! (" + (blob.size / 1024 / 1024).toFixed(1) + " MB / " + ext.toUpperCase() + ")");
      actionsEl.replaceChildren();

      var file = null;
      try { file = new File([blob], fileName, { type: blob.type }); } catch (e) { /* noop */ }
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        var shareBtn = document.createElement("button");
        shareBtn.type = "button";
        shareBtn.className = "mz-journey-share-btn mz-jexp-primary";
        shareBtn.textContent = "📤 シェア / 保存";
        shareBtn.addEventListener("click", function () {
          navigator.share({ files: [file], title: "MarchinZ Log" }).catch(function () { /* ユーザーキャンセル */ });
        });
        actionsEl.appendChild(shareBtn);
      }
      var dlBtn = document.createElement("a");
      dlBtn.className = "mz-journey-share-btn";
      dlBtn.textContent = "💾 端末に保存";
      dlBtn.href = URL.createObjectURL(blob);
      dlBtn.download = fileName;
      actionsEl.appendChild(dlBtn);
      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "mz-journey-share-btn";
      closeBtn.textContent = "閉じる";
      closeBtn.addEventListener("click", function () {
        URL.revokeObjectURL(dlBtn.href);
        cleanup();
      });
      actionsEl.appendChild(closeBtn);
      running = false; // 完了(オーバーレイは保存操作のため残す)
    } catch (err) {
      console.warn("[journey-export]", err);
      if (!cancelled) {
        setStatus("書き出しに失敗しました: " + (err && err.message ? err.message : err));
        noteEl.hidden = true;
        actionsEl.replaceChildren();
        var cb = document.createElement("button");
        cb.type = "button";
        cb.className = "mz-journey-share-btn";
        cb.textContent = "閉じる";
        cb.addEventListener("click", cleanup);
        actionsEl.appendChild(cb);
      }
      running = false;
    }
  }

  window.MarchinZJourneyExport = { start: start };
})();
