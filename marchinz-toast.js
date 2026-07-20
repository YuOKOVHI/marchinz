/*!
 * marchinz-toast.js — 画面を止めない通知(alert の置き換え)
 *
 * 2026-07-20 UI/UXレビューで新設。alert() は 22 箇所で使われていたが、
 * ネイティブダイアログは (1) 操作を止める (2) ブランド体験から浮く
 * (3) iPhone では特に唐突、という理由でツール品質を下げていた。
 *
 * 使い方:
 *   MZToast.ok("コピーしました");
 *   MZToast.err("更新に失敗しました");
 *   MZToast.warn("プロフィール設定を完了してください");
 *   MZToast.info("処理を開始しました");
 *
 * 注意: alert() と違い **処理を止めない**。alert の直後に location を
 * 変えている箇所では、トーストが見えないまま遷移してしまう。
 * そういう場所は MZToast.err(msg, { hold: true }) で遷移前に間を置くか、
 * 遷移をやめて画面内で伝えること。
 */
(function () {
  "use strict";
  if (window.MZToast) return;

  var HOST_ID = "mz-toast-host";
  var MAX = 3;
  var host = null;

  function ensureHost() {
    if (host && host.isConnected) return host;
    host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.className = "mz-toast-host";
      // 読み上げは「割り込まない」= polite。エラーだけ assertive に上書きする
      host.setAttribute("aria-live", "polite");
      host.setAttribute("aria-atomic", "false");
      document.body.appendChild(host);
    }
    return host;
  }

  var ICONS = {
    ok: "fa-circle-check",
    err: "fa-circle-exclamation",
    warn: "fa-triangle-exclamation",
    info: "fa-circle-info",
  };

  var DURATION = { ok: 3200, info: 3600, warn: 5000, err: 6000 };

  function dismiss(el) {
    if (!el || el.dataset.leaving === "1") return;
    el.dataset.leaving = "1";
    clearTimeout(+el.dataset.timer || 0);
    if (el._mzOnVis) {
      document.removeEventListener("visibilitychange", el._mzOnVis);
      el._mzOnVis = null;
    }
    el.classList.add("is-leaving");
    var done = function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    // アニメーション無効環境でも必ず消えるよう保険を張る
    var t = setTimeout(done, 400);
    el.addEventListener("transitionend", function () {
      clearTimeout(t);
      done();
    }, { once: true });
  }

  /*
   * 表示時間は「画面が見えている間」だけ数える。
   * document.hidden のまま setTimeout で消すと、バックグラウンドタブに
   * 出たトーストがタブに戻る前に消えて一度も読まれない(alert からの
   * 置き換えでは、これは機能の後退になる)。
   */
  function scheduleDismiss(el, ms) {
    if (!(ms > 0)) return;
    clearTimeout(+el.dataset.timer || 0);
    if (document.hidden) {
      if (el._mzOnVis) return;                 // 二重登録を防ぐ
      el._mzOnVis = function () {
        if (document.hidden) return;
        document.removeEventListener("visibilitychange", el._mzOnVis);
        el._mzOnVis = null;
        scheduleDismiss(el, ms);               // 見えてから改めて数え直す
      };
      document.addEventListener("visibilitychange", el._mzOnVis);
      return;
    }
    el.dataset.timer = setTimeout(function () { dismiss(el); }, ms);
  }

  function show(message, opts) {
    opts = opts || {};
    var type = opts.type || "info";
    if (!ICONS[type]) type = "info";
    var text = String(message == null ? "" : message).trim();
    if (!text) return null;

    var h = ensureHost();

    // 同じ文言が既に出ていれば作り直さず時間だけ延ばす(連打対策)
    var existing = h.querySelector('.mz-toast[data-text="' + CSS.escape(text) + '"]');
    if (existing && existing.dataset.leaving !== "1") {
      scheduleDismiss(existing, opts.duration || DURATION[type]);
      return existing;
    }

    while (h.children.length >= MAX) dismiss(h.firstElementChild);

    var el = document.createElement("div");
    el.className = "mz-toast mz-toast--" + type;
    el.dataset.text = text;
    el.setAttribute("role", type === "err" ? "alert" : "status");

    var icon = document.createElement("i");
    icon.className = "fa-solid " + ICONS[type] + " mz-toast-icon";
    icon.setAttribute("aria-hidden", "true");

    var body = document.createElement("span");
    body.className = "mz-toast-text";
    body.textContent = text;          // innerHTML を使わない(XSS対策)

    var close = document.createElement("button");
    close.type = "button";
    close.className = "mz-toast-close";
    close.setAttribute("aria-label", "閉じる");
    var x = document.createElement("i");
    x.className = "fa-solid fa-xmark";
    x.setAttribute("aria-hidden", "true");
    close.appendChild(x);
    close.addEventListener("click", function (ev) {
      ev.stopPropagation();
      dismiss(el);
    });

    el.appendChild(icon);
    el.appendChild(body);
    el.appendChild(close);
    el.addEventListener("click", function () { dismiss(el); });

    h.appendChild(el);
    // 入場は CSS animation に任せる。rAF は document.hidden === true
    // (ブラウザペイン/バックグラウンドタブ)で発火せず、トーストが
    // 透明のまま残る。v1.37.2 と同じ型の罠なのでここでは使わないこと。

    scheduleDismiss(el, opts.duration || DURATION[type]);
    return el;
  }

  window.MZToast = {
    show: show,
    ok: function (m, o) { return show(m, Object.assign({}, o, { type: "ok" })); },
    err: function (m, o) { return show(m, Object.assign({}, o, { type: "err" })); },
    warn: function (m, o) { return show(m, Object.assign({}, o, { type: "warn" })); },
    info: function (m, o) { return show(m, Object.assign({}, o, { type: "info" })); },
    dismissAll: function () {
      if (!host) return;
      Array.prototype.slice.call(host.children).forEach(dismiss);
    },
  };
})();
