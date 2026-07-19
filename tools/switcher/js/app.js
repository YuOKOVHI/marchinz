"use strict";
/* ============ 起動 ============ */

window.addEventListener("DOMContentLoaded", async () => {
  MC.preview.init(document.getElementById("cv"));
  MC.ui.wire();
  MC.ui.initJourney();
  MC.ui.initActionBar();
  MC.ui.renderAll();

  // 保存済みのプリセット/レイアウト等を復元
  try {
    const saved = JSON.parse(localStorage.getItem("marchcut_project") || "{}");
    if (saved.preset && MC.PRESETS[saved.preset]) MC.S.preset = saved.preset;
    if (saved.layoutId && MC.LAYOUTS[saved.layoutId]) MC.S.layoutId = saved.layoutId;
    if (saved.colorOn != null) MC.S.colorOn = saved.colorOn;
    if (saved.horizonOn != null) MC.S.horizonOn = saved.horizonOn;
    else if (Array.isArray(saved.clips) && saved.clips.some(c => c.rot)) MC.S.horizonOn = true; // 旧プロジェクト移行: rot設定済みなら水平補正ONを維持
    if (saved.colorStrength != null) MC.S.colorStrength = saved.colorStrength;
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
