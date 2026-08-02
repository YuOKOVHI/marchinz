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
    if (saved.exportQuality) {
      // 旧ID(sns/hd/pro)は新ID(light/full)へ寄せてから採用する
      const q = MC.exporter.QUALITY_ALIAS[saved.exportQuality] || saved.exportQuality;
      if (MC.exporter.QUALITIES[q]) MC.S.exportQuality = q;
    }
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
     「← 戻る」(ヘッダー)・「最初から作り直す」(完成画面2箇所)・フッターの戻り。
     クラッシュ・リロードはここを通らないので、復元(続きから)は生きたまま */
  for (const sel of [".back-link", "#eoToTools", "#doneToTools", ".foot-link"]) {
    document.querySelectorAll(sel).forEach(a =>
      a.addEventListener("click", () => { MC.ui.resetSavedProject(); }));
  }

  // OPFSへ本当に書けるかを一度だけ実測してキャッシュ(G-1)。
  // これで maxExportableSec が「上限なし」と嘘をつかなくなる
  MC.exporter.probeOpfs().then(() => MC.exporter.opfsSweep()).catch(() => {});

  await MC.exporter.probeCaps();
  const badge = document.getElementById("capsBadge");
  badge.textContent = {
    fast: "MP4書き出し対応 ✓", realtime: "実時間録画モード",
    mute: "MP4対応(音声なし)", none: "書き出し非対応",
  }[MC.ui.exportMode()];
  MC.ui.renderAll();

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
