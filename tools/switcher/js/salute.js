"use strict";
/* ============ DMサリュート考慮の演奏区間検出 (Phase 3) ============
   演奏前はDMのサリュート(敬礼)＋アナウンスで静か→演奏開始で持続的に大きくなる。
   RMS包絡(100msホップ→1秒平滑)で
   「5秒以上の静けさ(T_low未満)の後、3秒以上持続する高エネルギー(T_high超)」を演奏開始とする。
   トリムIN提案 = 開始 − 前振り秒(サリュートが映るように)。自動適用はしない。 */

MC.salute = {};

MC.salute.detect = async () => {
  const clip = MC.getClip(MC.S.audioClipId);
  if (!clip) throw new Error("音声クリップがありません");
  if (!clip.audio8k) await MC.audio.extract8k(clip);
  const sr = MC.audio.SR, hop = sr / 10;  // 100ms
  const pcm = clip.audio8k;
  const nH = Math.floor(pcm.length / hop);
  if (nH < 100) throw new Error("音声が短すぎます");
  const rms = new Float32Array(nH);
  for (let i = 0; i < nH; i++) {
    let s = 0;
    const o = i * hop;
    for (let j = 0; j < hop; j++) s += pcm[o + j] * pcm[o + j];
    rms[i] = Math.sqrt(s / hop);
  }
  // 1秒(10ホップ)移動平均
  const sm = new Float32Array(nH);
  for (let i = 0; i < nH; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 5); j <= Math.min(nH - 1, i + 4); j++) { s += rms[j]; n++; }
    sm[i] = s / n;
  }
  const sorted = Float32Array.from(sm).sort();
  const tLow = sorted[Math.floor(nH * 0.25)];
  const tHigh = sorted[Math.floor(nH * 0.60)];

  // 演奏開始: 30ホップ(3秒)持続してT_high超 かつ 直前50ホップ(5秒)の8割がT_low未満
  let startH = -1;
  for (let i = 50; i < nH - 30; i++) {
    if (sm[i] <= tHigh) continue;
    let sus = true;
    for (let j = i; j < i + 30; j++) if (sm[j] <= tHigh) { sus = false; break; }
    if (!sus) continue;
    let quiet = 0;
    for (let j = i - 50; j < i; j++) if (sm[j] < tLow) quiet++;
    if (quiet >= 40) { startH = i; break; }
  }
  // 演奏終了: 末尾から見て最後に3秒持続でT_high超だった位置の終端
  let endH = -1;
  for (let i = nH - 31; i >= Math.max(0, startH); i--) {
    let sus = true;
    for (let j = i; j < i + 30; j++) if (sm[j] <= tHigh) { sus = false; break; }
    if (sus) { endH = i + 30; break; }
  }
  if (startH < 0) {
    // 静寂前提が満たされない(既に曲中から始まる素材など)→開始のみ緩く検出
    for (let i = 0; i < nH - 30; i++) {
      if (sm[i] > tHigh) { startH = i; break; }
    }
    if (startH < 0) throw new Error("演奏区間を検出できませんでした");
    MC.log("salute: 静寂→演奏 のパターンではないため簡易検出");
  }
  const res = {
    musicStart: startH * 0.1 + clip.offset,
    musicEnd: endH > startH ? endH * 0.1 + clip.offset : null,
  };
  MC.log(`salute: start=${res.musicStart.toFixed(1)}s end=${res.musicEnd ? res.musicEnd.toFixed(1) : "?"}s`);
  return res;
};
