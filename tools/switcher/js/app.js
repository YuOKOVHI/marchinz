"use strict";
/* ============ 起動 ============ */

window.addEventListener("DOMContentLoaded", async () => {
  MC.preview.init(document.getElementById("cv"));
  MC.ui.wire();
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
    if (saved.filterId && MC.color.FILTERS[saved.filterId]) MC.S.filterId = saved.filterId;
    if (saved.beatsPerBar) MC.S.beatsPerBar = saved.beatsPerBar;
    if (saved.cutLevel >= 1 && saved.cutLevel <= 5) MC.S.cutLevel = saved.cutLevel;
    if (saved.wipePos) MC.S.wipePos = saved.wipePos;
    if (saved.wipeSize) MC.S.wipeSize = saved.wipeSize;
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
