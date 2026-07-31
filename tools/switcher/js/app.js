"use strict";
/* ============ 起動 ============ */

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

  /* ============ ファーストビュー(2026-08-01 製品改革 段5) ============
     以前はここで「作る動画を選ぶ」の3枚のカードを見せていた。
     あれは**製品の内部構造をそのまま質問にしたもの**で、ユーザーはまだ
     何も見せていないのに出力形式を先に決めさせられていた。
     縦型かどうかは共有先で決まる話であって、撮った直後に分かるものではない。

     最初の画面は「動画を選ぶ」1つにする。種類は上部の
     「← 種類を変える」からいつでも変えられる(既にある導線)。
     既定は自動スイッチング ─ このツールの本命であり、
     素材の向きに関係なく成立する唯一のモードだから。

     ★ 保存済みのモードがあればそれを尊重する(前回の続きを勝手に変えない) */
  {
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem("marchcut_project") || "{}").mode; }
      catch (e) { return null; }
    })();
    const start = MC.ui.MODES[saved] ? saved : "switch";
    /* silent: 保存済みの preset/layout/border を上書きしない。
       新規のときは既定値がそのまま使われる */
    MC.ui.chooseMode(start, { silent: !!MC.ui.MODES[saved] });
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
