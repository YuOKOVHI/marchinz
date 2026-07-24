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

  /* 取得したデータを「実行せずに」反映する(2026-07-25 セキュリティレビュー)。
     以前は new Function(text)() でそのまま実行していた。先頭が
     `window.__NAME =` で始まるかしか見ていなかったので、
     `window.__X=1;<任意のコード>` が素通りし、GitHub の main に書ける主体
     (botのGITHUB_TOKEN・漏れたPAT・リポジトリ書込権を持つ誰か)が
     Netlifyのデプロイを一切通さずに全訪問者のブラウザで任意コードを
     実行できる経路になっていた。netlify.toml のビルドスキップ運用と
     組み合わさって常時オンだった。
     inline データは4本とも `window.__NAME = <厳密なJSON>;` の単純代入なので、
     代入先の名前とJSON本体に分解して JSON.parse する。これならデータとして
     しか解釈されず、何が来てもコードは走らない。 */
  var ASSIGN_RE = /^\s*window\.(__[A-Z0-9_]+)\s*=\s*([\s\S]*?);?\s*$/;
  /* 上書きを許すグローバルを固定する。名前まで固定しておけば、
     万一 raw 側が別の名前で来ても関係ないものを触らせない */
  var ALLOWED_VARS = {
    __MARCHINZ_DATA: 1,
    __MARCHINZ_DIGEST: 1,
    __MARCHINZ_NOTES: 1,
    __YOUTUBE_LIST_ROWS: 1,
  };

  function applyPayload(text) {
    var m = ASSIGN_RE.exec(text);
    if (!m) throw new Error("unexpected content");
    var name = m[1];
    if (ALLOWED_VARS[name] !== 1) throw new Error("unexpected variable: " + name);
    window[name] = JSON.parse(m[2]);   // 失敗すれば例外 → 同梱データのまま
  }

  function fetchAndApply(path) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var tm = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : 0;
    return fetch(RAW_BASE + path, { signal: ctl ? ctl.signal : undefined, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (text) { applyPayload(text); })
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
