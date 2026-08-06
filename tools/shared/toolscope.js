"use strict";
/* ============ ツールスコープ(?tool=) — 見た目3ツール化の土台 ============
   映像ツール再編(2026-08-07 優さん指示): Switcher の3モードを
   ①MarchinZ Reel(縦型) ②MarchinZ Switcher(自動スイッチング) ③MarchinZ Wipe(ワイプ)
   という3つの「ツール」として見せる。実体は /tools/switcher/ の1アプリのまま。

   このファイルは <h1 class="tool-name"> の**直後**に同期で読み込むこと。
   ・<head> だと #toolName がまだ無い / </body> 直前だと「Switcher」が
     一瞬見えてから化ける(スマホSafari最優先の方針に反する)
   ・h1 直後なら、要素は既にパース済みで、ペイント前に名前が確定する

   ★ <body data-mz-tool="switcher"> には触らない。あれは
     limits.js(登録特典の辞書)と sitechrome.js(mount)が読む内部ID。
     スコープは documentElement の data-mz-tool-scope(別属性)で持つ。 */

window.MZToolScope = (() => {
  /* 公開語彙(reel/switcher/wipe)と内部ID(vertical/switch/wipeCam)の対応の正本。
     ui.js の MC.ui.MODES にも同じ値を持たせてある(toolKey/toolName/toolShort) ─
     あちらは「モード→ツール」、こちらは「URL→ツール」の入口で、両方から
     同じツールへ辿り着けるようにする */
  const TOOLS = {
    reel:     { key: "reel",     mode: "vertical", name: "MarchinZ Reel",     short: "Reel",     jp: "縦型動画" },
    switcher: { key: "switcher", mode: "switch",   name: "MarchinZ Switcher", short: "Switcher", jp: "自動スイッチング動画" },
    wipe:     { key: "wipe",     mode: "wipeCam",  name: "MarchinZ Wipe",     short: "Wipe",     jp: "ワイプカメラ動画" },
  };
  /* 旧名(内部ID)でも受ける ─ 手打ち・古いリンクを白画面にしない */
  const ALIAS = { vertical: "reel", switch: "switcher", wipecam: "wipe" };

  let scope = null;
  try {
    const raw = String(new URLSearchParams(location.search).get("tool") || "").toLowerCase();
    const key = TOOLS[raw] ? raw : ALIAS[raw];
    if (key) scope = TOOLS[key];
  } catch (_) { /* 未知値・壊れたURLはスコープなし=従来の3枚カードへ */ }

  if (scope) {
    document.documentElement.setAttribute("data-mz-tool-scope", scope.key);
    /* タブ名。「〈ベータ版〉」等の残りは静的titleの書式に合わせる */
    try { document.title = `${scope.name} — ${scope.jp}〈ベータ版〉`; } catch (_) {}
    const h1 = document.getElementById("toolName");
    if (h1) h1.textContent = scope.short;
  }

  return { get: () => scope, TOOLS };
})();
