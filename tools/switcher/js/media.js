"use strict";
/* ============ クリップ読み込み・メタデータ・サムネイル ============ */

MC.media = { nextId: 1 };

MC.media.addFiles = async files => {
  let added = 0;
  for (const f of files) {
    const isImage = /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name);
    if (isImage) {
      // 画像・写真は縦型動画作成でのみ取り込める
      if (MC.S.mode !== "vertical") { MC.ui.toast("画像・写真は「縦型動画作成」でのみ使えます"); continue; }
      if (await MC.media.addImageFile(f)) added++;
      continue;
    }
    if (!/^video\//.test(f.type) && !/\.(mp4|mov|m4v)$/i.test(f.name)) continue;
    const key = `${f.name}|${f.size}|${f.lastModified}`;
    if (MC.S.clips.some(c => MC.clipKey(c) === key)) { MC.ui.toast(`${f.name} は読み込み済みです`); continue; }
    if (MC.media.slotClips().length >= 3) { MC.ui.toast("素材は3つまでです"); break; }
    const clip = {
      id: MC.media.nextId++, file: f,
      name: f.name, size: f.size, lastModified: f.lastModified,
      url: URL.createObjectURL(f),
      video: document.createElement("video"),
      duration: 0, width: 0, height: 0,
      offset: 0, confidence: null, syncMethod: "未同期",
      pan: 0.5, role: "auto", freq: "auto", rig: "auto",
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
      MC.ui.toast(`⚠ ${f.name} は約${Math.round(v.duration / 60)}分です。`
        + (MZ_LIMITS.member
            ? `動画は${MZ_LIMITS.videoLimitLabel}までです。`
            : `ゲストは${MZ_LIMITS.videoLimitLabel}・無料登録で12分まで使えます。`)
        + "見せたい場面だけ短く切り出してからお試しください");
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

/* スロット(動画1/2/3)に入る素材 = 音声のみ以外 */
MC.media.slotClips = () => MC.S.clips.filter(c => !c.isAudio);

/* 画像・写真クリップ(縦型のみ)。duration=0でタイムライン長には影響させず、常に表示できる素材 */
MC.media.addImageFile = f => new Promise(resolve => {
  const key = `${f.name}|${f.size}|${f.lastModified}`;
  if (MC.S.clips.some(c => MC.clipKey(c) === key)) { MC.ui.toast(`${f.name} は読み込み済みです`); return resolve(false); }
  if (MC.media.slotClips().length >= 3) { MC.ui.toast("素材は3つまでです"); return resolve(false); }
  const nImg = MC.S.clips.filter(c => c.isImage).length;
  if (nImg + 1 > MZ_LIMITS.maxPhotos) { MC.ui.toast(`写真は一度に${MZ_LIMITS.maxPhotos}枚までです`); return resolve(false); }
  const img = new Image();
  const url = URL.createObjectURL(f);
  img.onload = () => {
    const clip = {
      id: MC.media.nextId++, file: f,
      name: f.name, size: f.size, lastModified: f.lastModified,
      url, img, isImage: true, video: null,
      duration: 0, width: img.naturalWidth, height: img.naturalHeight,
      offset: 0, confidence: null, syncMethod: "静止画",
      pan: 0.5, role: "auto",
      audio8k: null, stats: null, thumb: null, hasAudio: false,
    };
    // サムネイル
    const cv = document.createElement("canvas");
    cv.width = 168; cv.height = 100;
    const s = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
    cv.getContext("2d").drawImage(img, (cv.width - img.naturalWidth * s) / 2,
      (cv.height - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    clip.thumb = cv.toDataURL("image/jpeg", 0.7);
    MC.S.clips.push(clip);
    MC.media.afterChange();
    resolve(true);
  };
  img.onerror = () => {
    MC.ui.toast(`⚠ ${f.name}: 画像として読み込めません`);
    URL.revokeObjectURL(url);
    resolve(false);
  };
  img.src = url;
});

/* 音声のみ取り込み(mp3/wav/m4a等)。取り込んだらこの音を使用する。
   スロットには入らず、「使う音声」の選択肢+書き出し音声になる */
MC.media.addAudioFile = async f => {
  // 既存の音声のみクリップは置き換え(同時に使うのは1つ)
  const old = MC.S.clips.find(c => c.isAudio);
  if (old) MC.media.removeClip(old.id);
  const a = document.createElement("audio");
  const url = URL.createObjectURL(f);
  a.src = url; a.preload = "metadata";
  try {
    await new Promise((res, rej) => {
      a.onloadedmetadata = res;
      a.onerror = () => rej(new Error("音声として読み込めません"));
    });
  } catch (e) {
    MC.ui.toast(`⚠ ${f.name}: ${e.message}`);
    URL.revokeObjectURL(url);
    return false;
  }
  if (a.duration > MZ_LIMITS.maxVideoSec) {
    MC.ui.toast(`⚠ ${f.name}: 音声は${MZ_LIMITS.videoLimitLabel}までです`);
    URL.revokeObjectURL(url);
    return false;
  }
  const clip = {
    id: MC.media.nextId++, file: f,
    name: f.name, size: f.size, lastModified: f.lastModified,
    url, video: a, isAudio: true,
    duration: a.duration, width: 0, height: 0,
    offset: 0, confidence: null, syncMethod: "未同期",
    pan: 0.5, role: "auto",
    audio8k: null, stats: null, thumb: null, hasAudio: true,
  };
  clip.restored = MC.restoreClipState(clip);
  MC.S.clips.push(clip);
  MC.S.audioClipId = clip.id;   // 取り込んだらこの音を使用する
  MC.S.audioPickedByUser = true;  // 明確な意思なので「おすすめ」に上書きさせない
  // 音質統計(おすすめ表示用)は裏で
  MC.audio.extract8k(clip).then(() => MC.ui.renderAudio()).catch(() => {});
  MC.media.afterChange();
  MC.ui.toast(`♪ ${f.name} を書き出しの音声にしました`);
  return true;
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
  MC.ui.resetEasyDone();   // 素材が変わったら「書き出すだけ」状態を解除
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
  const slotClips = MC.media.slotClips();   // 音声のみを除いた素材(動画・画像)
  const n = slotClips.length;
  // 空スロットへ未割当クリップを順に入れる(音声のみはスロットに入れない)。
  // 空きが無ければ「同じ素材の2回目」(2素材時の上下同一の複製)を新しい素材で置き換える
  const assigned = new Set(MC.S.slots.filter(x => x != null));
  slotClips.forEach(c => {
    if (assigned.has(c.id)) return;
    let idx = MC.S.slots.findIndex(s => s == null);
    if (idx < 0) {
      const seen = new Set();
      for (let i = 0; i < MC.S.slots.length; i++) {
        if (seen.has(MC.S.slots[i])) { idx = i; break; }
        seen.add(MC.S.slots[i]);
      }
    }
    if (idx >= 0) { MC.S.slots[idx] = c.id; assigned.add(c.id); }
  });
  // レイアウト既定: 縦型は3分割縦積みが基本。素材2つなら一番上と下を同じにする
  const allowSplit = MC.ui.modeConf().layouts.includes("single");
  const cutMode = ["switch", "wipe"].includes(MC.S.layoutId);
  if (allowSplit && !cutMode) {
    if (n === 1) MC.S.layoutId = "single";
    else if (n === 2) {
      if (!["v2", "v3", "big2"].includes(MC.S.layoutId)) MC.S.layoutId = "v3";
      if (MC.S.layoutId === "v3" && MC.S.slots[2] == null) MC.S.slots[2] = MC.S.slots[0];
    } else if (n >= 3 && !["v3", "big2"].includes(MC.S.layoutId)) MC.S.layoutId = "v3";
  }
  const firstVideo = MC.S.clips.find(c => !c.isImage);   // 音声既定は音の出る素材から
  // stats が揃うまでの暫定。解析後は renderAudio が「おすすめ」に差し替える
  if (MC.S.audioClipId == null && firstVideo) MC.S.audioClipId = firstVideo.id;
  if (MC.S.refClipId == null && firstVideo) MC.S.refClipId = firstVideo.id;
  if (MC.S.wipeClipId == null && n) MC.S.wipeClipId = slotClips[0].id;
  MC.restoreCutList();
  MC.restoreTrim();
  MC.preview.applyMute();
  MC.saveState();
  MC.ui.resetEasyDone();   // 素材が変わったら「書き出すだけ」状態を解除
  MC.ui.renderAll();
  MC.ui.focusNextAction();   // 次にすること(おまかせで開始)まで運ぶ
  /* 何がどこまで戻ったかを、実際の結果だけで伝える。
     以前は cutList の有無だけを見て「書き出し範囲も復元」と言っており、
     事実と違うことがあった(2026-07-21 レビュー指摘) */
  MC.restoreInfo.sync = MC.S.clips.filter(c => c.restored).length;
  MC.ui.renderRestoreNote();
};
