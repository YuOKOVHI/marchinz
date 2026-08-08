"use strict";
/* ============ 起動 ============ */

/* ★ 戻る/進むで bfcache から丸ごと蘇ったら読み直す(2026-08-02 優さん報告⑪
   「一度選んでツールに戻ったとき、前に選んでいた動画が残って、さらにエラーログがでる」)。
   iOS Safari はページを離れてもJSの状態ごと凍結保存し、戻ると**そのまま再開**する。
   前回の動画・進捗の顔・エラー表示・(凍結で殺された)デコーダまで蘇るため、
   エラーだけが残った壊れた画面になる。意図した再訪はリセットで開始する。
   リロード事故(書き出し中に落ちた等)は persisted=false なので、
   同期・カット割の復元(localStorage)は従来どおり効く */
window.addEventListener("pageshow", e => {
  if (e.persisted) location.reload();
});

window.addEventListener("DOMContentLoaded", async () => {
  MC.preview.init(document.getElementById("cv"));
  MC.ui.wire();
  MC.ui.initJourney();
  MC.ui.initActionBar();
  MC.ui.initFloatOnScroll();
  MC.ui.initVisibility();
  MC.ui.renderAll();
  if (MC.storageDiag) MC.storageDiag.init();
  /* 「開いた」をトップページへ置き手紙(2026-08-04)。種類を選べば ui.js の
     入口が種類つきで上書きする。選ばずに離れた人も1件として残るようにする */
  MC.ui.noteToolUse();

  // 保存済みのプリセット/レイアウト等を復元
  try {
    const saved = JSON.parse(localStorage.getItem("marchcut_project") || "{}");
    if (saved.preset && MC.PRESETS[saved.preset]) MC.S.preset = saved.preset;
    if (saved.layoutId && MC.LAYOUTS[saved.layoutId]) MC.S.layoutId = saved.layoutId;
    if (saved.colorOn != null) MC.S.colorOn = saved.colorOn;
    /* horizonOn(傾き補正)は保存値を復元しない=常に既定ON。旧保存のOFFを
       引き継ぐと「初期でオン」の指示が巻き戻る(2026-07-24 実機で発覚)。
       セッション内でOFFにするのは自由だが、次回開いたらONに戻る */
    if (saved.colorStrength != null) MC.S.colorStrength = saved.colorStrength;
    /* exportQuality の復元は廃止(2026-08-03「12だけに統一」)。
       ビットレートは videoBitrate() が一律12Mbps(旧端末のメモリ例外のみ)で、
       保存値を戻しても何も変わらない */
    // フィルターは復元しない: 初期値は常に「MarchinZ」(2026-07-19 優さん指定)
    if (saved.beatsPerBar) MC.S.beatsPerBar = saved.beatsPerBar;
    // 切替頻度: 旧5段階の保存値は3段階(少なめ/おすすめ/多め)へ寄せる
    if (saved.cutLevel >= 1 && saved.cutLevel <= 5) {
      MC.S.cutLevel = saved.cutLevel <= 2 ? 1 : saved.cutLevel >= 4 ? 3 : 2;
    }
    if (saved.wipePos) MC.S.wipePos = saved.wipePos;
    if (saved.wipePos2) MC.S.wipePos2 = saved.wipePos2;
    if (saved.wipeSize) MC.S.wipeSize = saved.wipeSize;
    if (saved.autoTrim != null) MC.S.autoTrim = saved.autoTrim;
    if (saved.borderOn != null) MC.S.borderOn = saved.borderOn;
    if (saved.borderColor) MC.S.borderColor = saved.borderColor;
    if (saved.borderW != null) MC.S.borderW = saved.borderW;
  } catch (e) {}

  /* ============ ファーストビュー(2026-08-01 優さん指示で作り直し) ============
     最初に聞くのは「進め方」= おまかせ / こだわり の2択(index.html #modeSelect)。

     いちど「出力の種類(縦型/スイッチング/ワイプ)を聞かず、すぐ作業画面へ」と
     したが、優さんの指示で**別の2択を最初に置く**ことになったので、
     その自動遷移は取り消す ─ 残したままだと2択の画面が一度も出ない
     (実測: modeSelect が hidden のまま作業画面が開いていた)。

     出力の種類は、おまかせなら自動スイッチング固定。
     こだわりの人は「← 種類を変える」で選び直せる。
     mode の保存(state.js)はそのまま残す ─ 前回の種類を覚えている */

  /* ★ 意図してツールを出る導線では、保存済みの前回状態も捨てる(2026-08-02 ⑪
     「一度戻ると、リセットした状態でスタート」)。対象は
     「最初から作り直す」(完成画面2箇所)・フッターの戻り。
     クラッシュ・リロードはここを通らないので、復元(続きから)は生きたまま */
  /* ★ .back-link はここに入れない(2026-08-05 優さん実機)。「← 戻る」は
     ツール内(種類選択)へ戻る導線になった ─ 「取り込んだ動画はそのまま」と
     言いながら保存状態を消すことになる。退出=リセットは本当に離れる導線だけ */
  for (const sel of ["#eoToTools", "#doneToTools", ".foot-link"]) {
    document.querySelectorAll(sel).forEach(a =>
      a.addEventListener("click", () => { MC.ui.releaseToolSession("退出リンク"); }));
  }
  /* sitechromeのメニューはDOMContentLoaded後に増えるため委譲で拾う。
     作業中の「← 戻る」はui.jsがpreventDefaultしてツール内へ戻すので解放しない。
     別タブで開く操作も現在のツールは残るため対象外。 */
  document.addEventListener("click", e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    let dest;
    try { dest = new URL(a.href, location.href); } catch (_) { return; }
    if (dest.origin !== location.origin || dest.pathname === location.pathname) return;
    if (MC.ui._busy || (MC.exporter && MC.exporter.running)) return;
    MC.ui.releaseToolSession("MarchinZ内の別ページへ移動");
  });

  /* ★ 掃除を probe の後ろにぶら下げない(2026-08-06 優さん実機 14.88GB、3度目の対策)。
     probeOpfs は Worker を起こして open/write/finalize の応答を待つ実測で、
     **タイムアウトが無い**。iOS Safari で Worker が応答しないと、この then は
     永遠に来ない = 掃除は1バイトも走らない。前回 opfsSweep の入口だけ緩めたが、
     呼び出し側がこの形のままだったので効かなかった。
     掃除に probe の結果は要らない(main thread の entries/removeEntry だけ)ので、
     両者は独立に走らせる */
  (MC.storageDiag ? MC.storageDiag.sweepCycle("起動時") : MC.exporter.opfsSweep())
    .then(() => MC.exporter.refreshEstimate())
    /* 掃除の**あと**に数える。残っていれば本人が消せるよう画面に出す */
    .then(() => MC.ui.refreshStorageNote()).catch(() => {});
  // OPFSへ本当に書けるかを一度だけ実測してキャッシュ(G-1)。
  // これで maxExportableSec が「上限なし」と嘘をつかなくなる
  if (MC.storageDiag) MC.storageDiag.probeStart();
  let opfsProbeSettled = false;
  MC.exporter.probeOpfs().then(ok => {
    opfsProbeSettled = true;
    if (MC.storageDiag) MC.storageDiag.probeResult(ok);
  }).catch(e => {
    opfsProbeSettled = true;
    if (MC.storageDiag) MC.storageDiag.probeResult(false, e);
  });
  /* probe自体の挙動は変えず、15秒返らない事実だけを診断へ残す。
     掃除は上で既に独立して始まっているため、ここが固まっても妨げない。 */
  setTimeout(() => {
    if (!opfsProbeSettled && MC.storageDiag) MC.storageDiag.probePending();
  }, 15000);
  /* 退出時にも据え置き分を掃く(2026-08-06 Safari容量調査)。再開用パーツ等の
     新しいファイルは sweep 側の6時間窓が守る。pagehide内のasyncは
     完走保証が無いが、掃除は必須ではない(次回起動時sweepが拾う) */
  window.addEventListener("pagehide", () => {
    /* 縮小版は**このセッションでしか使えない**(引き当てに元の File が要るが、
       File は再読み込みをまたいで生き残らない)。持ち越す意味がないので手放す。
       pagehide の非同期は完走保証が無いが、取りこぼしても次回起動の掃除が
       据え置き窓を無視して必ず消す */
    if (window.MC && MC.storageDiag) MC.storageDiag.pagehide();
    if (window.MC && MC.proxy) MC.proxy.disposeAll();
    MC.exporter.opfsSweep();
  });

  await MC.exporter.probeCaps();
  const badge = document.getElementById("capsBadge");
  badge.textContent = {
    fast: "MP4書き出し対応 ✓", realtime: "実時間録画モード",
    mute: "MP4対応(音声なし)", none: "書き出し非対応",
  }[MC.ui.exportMode()];
  MC.ui.renderAll();
  /* ★ 種類選択(1/2)の案内(#mzModeTip「フルショウはパソコンから」)を初回から出す
     (2026-08-06 優さん指示+高校生レビューP0: showModeStep は種類を選んだ後にしか
     呼ばれず、いちばん読んでほしい初回に一度も表示されていなかった)。
     復元で作業画面に居る場合も、親(modeSelect)が hidden なだけで無害 */
  MC.ui.showModeStep("kind");

  // 自動テストモード: ?test で test_clips.json のクリップを読み込む
  if (new URLSearchParams(location.search).has("test")) {
    MC.testMode = true;
    MC.ui.chooseMode("switch", { silent: true });  // モード選択をスキップ
    try {
      const list = await (await fetch("test_clips.json")).json();
      const files = [];
      for (const item of list) {
        const blob = await (await fetch(item.url)).blob();
        files.push(new File([blob], item.name, { type: "video/mp4", lastModified: item.lastModified || Date.now() }));
      }
      await MC.media.addFiles(files);
      MC.log("test clips loaded:", files.map(f => f.name).join(", "));
    } catch (e) {
      MC.log("test mode load failed:", e.message);
    }
  }
});
