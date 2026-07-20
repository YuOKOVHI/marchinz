"use strict";
/* ============ MarchCut 状態管理 ============ */

window.MC = {
  S: {
    clips: [],            // Clipオブジェクト(media.js参照)
    mode: null,           // 最初の選択(vertical=縦型 / switch=自動スイッチング)
    layoutId: "v3",       // 縦型の初期は3分割縦積み
    preset: "9x16",
    audioClipId: null,    // 書き出し/再生に使う音声のクリップ
    audioPickedByUser: false,  // 手で選んだか。false の間は「おすすめ」に追従する
    refClipId: null,      // 同期の基準クリップ
    slots: [null, null, null],  // スロットi に表示するクリップid
    trimIn: 0, trimOut: null,   // 書き出し範囲(グローバル秒)。null=末尾まで
    t: 0, playing: false,
    /* Phase 2: スイッチング/ワイプ */
    cutList: [],                // [{t, clipId, trans:'cut'|'dissolve', dur}] 昇順・セグメント開始
    beatsPerBar: 4,
    cutLevel: 2,                // 切替頻度 1:少なめ 2:おすすめ 3:多め
    wipeClipId: null,           // ワイプの小窓カメラ(1つ目)
    wipeClipId2: null,          // ワイプの小窓カメラ(2つ目、null=なし)
    wipePos: "br", wipePos2: "bl", wipeSize: 0.32,
    /* Phase 3: 仕上げ */
    colorOn: true, colorStrength: 0.8,   // カラー自動マッチは初期ON(同期後に自動実行)
    horizonOn: false,     // 自動水平補正のマスターON/OFF(仕上げ)
    filterId: "marchinz",  // MarchinZルックが初期フィルター
    autoTrim: true,        // 最初と最後の自動カット(サリュートIN+音終了10秒後OUT)
    /* 境界線(分割レイアウトのセル間+ワイプ小窓の枠) */
    borderOn: true, borderColor: "#ffffff", borderW: 2,
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
MC.debug = [];
/* 不具合のご連絡用にログを残す(端末内のみ)。
   全経路をここへ通し、必ず400件で打ち切る(エラーが連続しても膨らませない) */
MC.pushDebug = line => {
  MC.debug.push(`${new Date().toLocaleTimeString("ja-JP")} ${line}`);
  if (MC.debug.length > 400) MC.debug.splice(0, MC.debug.length - 400);
};
MC.log = (...a) => {
  console.log("[MC]", ...a);
  const line = a.map(x => {
    if (typeof x === "string") return x;
    // 循環参照(VideoFrame等)でも行ごと失わないようにする
    try { return JSON.stringify(x); } catch (e) { return String(x); }
  }).join(" ");
  MC.pushDebug(line);
};
/* 未捕捉のエラーもログへ(画面から見えるようにする) */
window.addEventListener("error", e => {
  MC.pushDebug(`[error] ${e.message} @${(e.filename || "").split("/").pop()}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", e => {
  MC.pushDebug(`[error] ${(e.reason && e.reason.message) || e.reason}`);
});

/* タイムライン全長(全クリップ終端の最大)。静止画(duration=0)は数えない */
MC.timelineDuration = () => {
  const cs = MC.S.clips.filter(c => !c.isImage);
  return cs.length ? Math.max(...cs.map(c => c.offset + c.duration)) : 0;
};

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
      wipePos: MC.S.wipePos, wipePos2: MC.S.wipePos2, wipeSize: MC.S.wipeSize,
      autoTrim: MC.S.autoTrim,
      borderOn: MC.S.borderOn, borderColor: MC.S.borderColor, borderW: MC.S.borderW,
      colorOn: MC.S.colorOn, colorStrength: MC.S.colorStrength, filterId: MC.S.filterId,
      horizonOn: MC.S.horizonOn,
      clips: MC.S.clips.map(c => ({
        key: MC.clipKey(c), offset: c.offset, confidence: c.confidence,
        syncMethod: c.syncMethod, pan: c.pan,
        role: c.role || "auto", freq: c.freq || "auto", rig: c.rig || "auto",
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
      clip.freq = hit.freq || "auto";
      clip.rig = hit.rig || "auto";
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
