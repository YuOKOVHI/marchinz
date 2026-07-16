"use strict";
/**
 * 毎日更新データ(YouTubeリスト/note/ダイジェスト)の実行時リフレッシュ。
 *
 * 毎朝5時のbotによるデータpushは netlify.toml の ignore ルールでビルドされない
 * (Netlifyクレジット節約)。そのためデプロイ同梱の inline データは古くなるが、
 * このスクリプトがページ表示後に GitHub(main) の最新版を直接取得してグローバルを
 * 上書きし、`mz:data-refreshed` イベントで再描画を促す。
 * 取得失敗時(オフライン/PWA/raw障害)は同梱データのままなので劣化しない。
 */
(function () {
  var RAW_BASE = "https://raw.githubusercontent.com/YuOKOVHI/marchinz/main/";
  var FILES = [
    "data.inline.js",
    "digest.inline.js",
    "marchinz-notes.inline.js",
    "youtube-list/youtube-list.inline.js",
  ];

  function fetchAndApply(path) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var tm = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : 0;
    return fetch(RAW_BASE + path, { signal: ctl ? ctl.signal : undefined, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (text) {
        // 自リポジトリのデータ代入文であることを確認してから実行する
        if (!/^\s*window\.__[A-Z_]+\s*=/.test(text)) throw new Error("unexpected content");
        new Function(text)();
      })
      .finally(function () {
        if (tm) clearTimeout(tm);
      });
  }

  function run() {
    if (typeof fetch !== "function" || typeof Promise.allSettled !== "function") return;
    Promise.allSettled(FILES.map(fetchAndApply)).then(function (results) {
      var okCount = results.filter(function (r) { return r.status === "fulfilled"; }).length;
      if (okCount > 0) {
        document.dispatchEvent(new CustomEvent("mz:data-refreshed"));
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
