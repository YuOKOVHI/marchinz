"use strict";
/* ============ クリップ読み込み・メタデータ・サムネイル ============ */

MC.media = { nextId: 1 };

MC.media.addFiles = async files => {
  let added = 0;
  for (const f of files) {
    if (!/^video\//.test(f.type) && !/\.(mp4|mov|m4v)$/i.test(f.name)) continue;
    const key = `${f.name}|${f.size}|${f.lastModified}`;
    if (MC.S.clips.some(c => MC.clipKey(c) === key)) { MC.ui.toast(`${f.name} は読み込み済みです`); continue; }
    if (MC.S.clips.length >= 3) { MC.ui.toast("動画は3本までです"); break; }
    const clip = {
      id: MC.media.nextId++, file: f,
      name: f.name, size: f.size, lastModified: f.lastModified,
      url: URL.createObjectURL(f),
      video: document.createElement("video"),
      duration: 0, width: 0, height: 0,
      offset: 0, confidence: null, syncMethod: "未同期",
      pan: 0.5, role: "auto",
      audio8k: null, stats: null, thumb: null, hasAudio: null,
    };
    const v = clip.video;
    v.src = clip.url; v.muted = true; v.playsInline = true;
    v.setAttribute("playsinline", "");  // iOS Safariは属性も必要
    v.preload = MC.isIOS ? "metadata" : "auto";  // iPhoneのメモリ節約
    try {
      await new Promise((res, rej) => {
        v.onloadedmetadata = res;
        v.onerror = () => rej(new Error("動画として読み込めません(コーデック非対応の可能性)"));
      });
    } catch (e) {
      MC.ui.toast(`⚠ ${f.name}: ${e.message}`);
      URL.revokeObjectURL(clip.url);
      continue;
    }
    if (v.duration > MZ_LIMITS.maxVideoSec) {
      MC.ui.toast(`⚠ ${f.name}: 動画は${MZ_LIMITS.videoLimitLabel}までです(約${Math.round(v.duration / 60)}分)`);
      URL.revokeObjectURL(clip.url);
      continue;
    }
    clip.duration = v.duration;
    clip.width = v.videoWidth;
    clip.height = v.videoHeight;
    clip.restored = MC.restoreClipState(clip);
    MC.S.clips.push(clip);
    added++;
    MC.media.makeThumb(clip);  // 非同期・完了後にカード再描画
  }
  if (added) MC.media.afterChange();
};

MC.media.makeThumb = async clip => {
  const v = clip.video;
  try {
    v.currentTime = Math.min(3, clip.duration * 0.1);
    await new Promise((res, rej) => { v.onseeked = res; v.onerror = rej; setTimeout(res, 3000); });
    const cv = document.createElement("canvas");
    cv.width = 168; cv.height = 100;
    const s = Math.max(cv.width / v.videoWidth, cv.height / v.videoHeight);
    const w = v.videoWidth * s, h = v.videoHeight * s;
    cv.getContext("2d").drawImage(v, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
    clip.thumb = cv.toDataURL("image/jpeg", 0.7);
    v.currentTime = 0;
  } catch (e) { /* サムネ失敗は無視 */ }
  MC.ui.renderClips();
};

MC.media.removeClip = id => {
  const i = MC.S.clips.findIndex(c => c.id === id);
  if (i < 0) return;
  const c = MC.S.clips[i];
  try { c.video.pause(); } catch (e) {}
  URL.revokeObjectURL(c.url);
  MC.S.clips.splice(i, 1);
  MC.S.slots = MC.S.slots.map(s => (s === id ? null : s));
  if (MC.S.audioClipId === id) MC.S.audioClipId = null;
  if (MC.S.refClipId === id) MC.S.refClipId = null;
  MC.media.afterChange();
};

/* クリップ増減後の既定値決め: スロット自動割当・レイアウト・音声・基準 */
MC.media.afterChange = () => {
  const clips = MC.S.clips;
  const n = clips.length;
  // 空スロットへ未割当クリップを順に入れる
  const assigned = new Set(MC.S.slots.filter(x => x != null));
  clips.forEach(c => {
    if (!assigned.has(c.id)) {
      const empty = MC.S.slots.findIndex(s => s == null);
      if (empty >= 0) { MC.S.slots[empty] = c.id; assigned.add(c.id); }
    }
  });
  // レイアウト既定: プリセット向きとクリップ数から(スイッチング/ワイプ選択中は触らない)。
  // 自動スイッチングモードは分割レイアウトを使わないので自動割当そのものを行わない
  const portrait = MC.S.preset === "9x16";
  const allowSplit = MC.ui.modeConf().layouts.includes("single");
  const cutMode = ["switch", "wipe"].includes(MC.S.layoutId);
  if (allowSplit && !cutMode) {
    if (n === 1) MC.S.layoutId = "single";
    else if (n === 2 && !["v2", "h2"].includes(MC.S.layoutId)) MC.S.layoutId = portrait ? "v2" : "h2";
    else if (n >= 3 && !["v3", "h3", "big2"].includes(MC.S.layoutId)) MC.S.layoutId = portrait ? "v3" : "h3";
  }
  if (MC.S.audioClipId == null && n) MC.S.audioClipId = clips[0].id;
  if (MC.S.refClipId == null && n) MC.S.refClipId = clips[0].id;
  if (MC.S.wipeClipId == null && n) MC.S.wipeClipId = clips[0].id;
  MC.restoreCutList();
  MC.preview.applyMute();
  MC.saveState();
  MC.ui.renderAll();
};
