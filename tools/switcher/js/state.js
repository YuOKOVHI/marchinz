"use strict";
/* ============ MarchCut 状態管理 ============ */

window.MC = {
  S: {
    clips: [],            // Clipオブジェクト(media.js参照)
    mode: null,           // 最初の選択(vertical=縦型 / switch=自動スイッチング)
    layoutId: "v2",
    preset: "9x16",
    audioClipId: null,    // 書き出し/再生に使う音声のクリップ
    refClipId: null,      // 同期の基準クリップ
    slots: [null, null, null],  // スロットi に表示するクリップid
    trimIn: 0, trimOut: null,   // 書き出し範囲(グローバル秒)。null=末尾まで
    t: 0, playing: false,
    /* Phase 2: スイッチング/ワイプ */
    cutList: [],                // [{t, clipId, trans:'cut'|'dissolve', dur}] 昇順・セグメント開始
    beatsPerBar: 4,
    cutLevel: 3,                // 切替頻度 1(ゆったり)〜5(細かい)
    wipeClipId: null,           // ワイプの小窓カメラ
    wipePos: "br", wipeSize: 0.32,
    /* Phase 3: 仕上げ */
    colorOn: false, colorStrength: 0.8,
    horizonOn: false,     // 自動水平補正のマスターON/OFF(仕上げ)
    filterId: "none",
  },
  caps: { h264: false, aac: false },
  testMode: false,
};

/* 端末判定(iPhone/iPad実機とタッチ環境) */
MC.isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
MC.isTouch = MC.isIOS || navigator.maxTouchPoints > 0;

MC.PRESETS = {
  "9x16": { w: 1080, h: 1920, label: "縦 9:16" },
  "16x9": { w: 1920, h: 1080, label: "横 16:9" },
  "1x1":  { w: 1080, h: 1080, label: "正方形 1:1" },
};

/* タイマー節流(非表示タブ)の影響を受けないyield */
MC.yield = () => new Promise(r => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r();
  ch.port2.postMessage(0);
});

/* dequeueイベント待ち(タイムアウト付き) */
MC.waitDequeue = (codec, ms = 100) => new Promise(r => {
  const h = () => { clearTimeout(tm); r(); };
  codec.addEventListener("dequeue", h, { once: true });
  const tm = setTimeout(() => { codec.removeEventListener("dequeue", h); r(); }, ms);
});

MC.clipKey = c => `${c.name}|${c.size}|${c.lastModified}`;
MC.getClip = id => MC.S.clips.find(c => c.id === id) || null;
MC.log = (...a) => console.log("[MC]", ...a);

/* タイムライン全長(全クリップ終端の最大) */
MC.timelineDuration = () =>
  MC.S.clips.length ? Math.max(...MC.S.clips.map(c => c.offset + c.duration)) : 0;

MC.trimRange = () => {
  const dur = MC.timelineDuration();
  const tIn = Math.max(0, Math.min(MC.S.trimIn, dur));
  const tOut = Math.min(MC.S.trimOut == null ? dur : MC.S.trimOut, dur);
  return [tIn, Math.max(tIn + 0.1, tOut)];
};

/* 現在レイアウトで実際に使われているクリップ(重複なし)。
   スイッチング/ワイプはカットリストが全カメラを使い得るため全クリップ */
MC.activeClips = () => {
  const L = MC.LAYOUTS[MC.S.layoutId];
  if (L.type === "switch" || L.type === "wipe") return [...MC.S.clips];
  const ids = [...new Set(MC.S.slots.slice(0, L.n).filter(id => id != null))];
  return ids.map(MC.getClip).filter(Boolean);
};

MC.saveState = () => {
  try {
    localStorage.setItem("marchcut_project", JSON.stringify({
      layoutId: MC.S.layoutId, preset: MC.S.preset,
      trimIn: MC.S.trimIn, trimOut: MC.S.trimOut,
      beatsPerBar: MC.S.beatsPerBar, cutLevel: MC.S.cutLevel,
      wipePos: MC.S.wipePos, wipeSize: MC.S.wipeSize,
      colorOn: MC.S.colorOn, colorStrength: MC.S.colorStrength, filterId: MC.S.filterId,
      horizonOn: MC.S.horizonOn,
      clips: MC.S.clips.map(c => ({
        key: MC.clipKey(c), offset: c.offset, confidence: c.confidence,
        syncMethod: c.syncMethod, pan: c.pan, role: c.role || "auto",
        colorT: c.colorT || null, rot: c.rot || 0,
      })),
      // クリップidは読込順で変わるためkeyで保存
      cutList: MC.S.cutList.map(e => {
        const c = MC.getClip(e.clipId);
        return c ? { t: e.t, key: MC.clipKey(c), trans: e.trans, dur: e.dur } : null;
      }).filter(Boolean),
    }));
  } catch (e) { /* localStorage不可でも動作は継続 */ }
};

/* 再読込時: 同一ファイル(名前|サイズ|更新時刻)なら同期結果を復元 */
MC.restoreClipState = clip => {
  try {
    const saved = JSON.parse(localStorage.getItem("marchcut_project") || "{}");
    const hit = (saved.clips || []).find(s => s.key === MC.clipKey(clip));
    if (hit) {
      clip.offset = hit.offset || 0;
      clip.confidence = hit.confidence;
      clip.syncMethod = hit.syncMethod || "未同期";
      clip.pan = hit.pan == null ? 0.5 : hit.pan;
      clip.role = hit.role || "auto";
      clip.colorT = hit.colorT || null;
      clip.rot = hit.rot || 0;
    }
    return !!hit;
  } catch (e) { return false; }
};

/* クリップ読込後: 保存済みカットリストをkey→idで復元(全key解決時のみ) */
MC.restoreCutList = () => {
  if (MC.S.cutList.length) return;
  try {
    const saved = JSON.parse(localStorage.getItem("marchcut_project") || "{}");
    if (!saved.cutList || !saved.cutList.length) return;
    const byKey = new Map(MC.S.clips.map(c => [MC.clipKey(c), c.id]));
    const cuts = saved.cutList.map(e =>
      byKey.has(e.key) ? { t: e.t, clipId: byKey.get(e.key), trans: e.trans, dur: e.dur } : null);
    if (cuts.every(Boolean)) MC.S.cutList = cuts;
  } catch (e) {}
};
