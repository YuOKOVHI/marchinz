"use strict";
/* ============ 拍検出+自動カット割 (Phase 2) ============
   スペクトラルフラックス→オンセット→テンポ(自己相関)→拍グリッド→カットリスト生成。
   ルールベースで決定的。素材は8kHzモノPCM(sync用に抽出済みのものを再利用)。 */

MC.beats = {
  MIN_SHOT: 3.0,   // ショット最短(秒)
  MAX_SHOT: 8.0,   // ショット最長(秒)
  DISSOLVE_DUR: 0.7,
};

MC.beats._hann = n => {
  if (MC.beats._hc && MC.beats._hc.length === n) return MC.beats._hc;
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  return (MC.beats._hc = w);
};

/* 拍解析。pcm=8kHzモノ。戻り {bpm, period, beats[](クリップローカル秒), conf} */
MC.beats.analyze = (pcm, sr = 8000) => {
  const FR = 512, HOP = 128;               // 窓64ms・ホップ16ms
  const hopSec = HOP / sr;
  const nF = Math.floor((pcm.length - FR) / HOP) + 1;
  if (nF < 100) throw new Error("音声が短すぎて拍を検出できません");
  const fft = new FFT(FR);
  const win = MC.beats._hann(FR);
  const frame = new Float64Array(FR);
  const spec = fft.createComplexArray();
  const half = FR / 2;
  let prev = new Float32Array(half);
  const flux = new Float32Array(nF);
  for (let i = 0; i < nF; i++) {
    const o = i * HOP;
    for (let j = 0; j < FR; j++) frame[j] = pcm[o + j] * win[j];
    fft.realTransform(spec, frame);
    let f = 0;
    for (let k = 1; k < half; k++) {
      const m = Math.hypot(spec[2 * k], spec[2 * k + 1]);
      const d = m - prev[k];
      if (d > 0) f += d;
      prev[k] = m;
    }
    flux[i] = f;
  }
  // 適応しきい値: 移動中央値(±21フレーム≒0.67秒)を引く
  const W = 21;
  const env = new Float32Array(nF);
  const buf = [];
  for (let i = 0; i < nF; i++) {
    buf.length = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(nF - 1, i + W); j++) buf.push(flux[j]);
    buf.sort((a, b) => a - b);
    env[i] = Math.max(0, flux[i] - buf[Math.floor(buf.length / 2)]);
  }
  // テンポ: オンセット包絡の自己相関(60〜200BPM)
  const minLag = Math.round(60 / 200 / hopSec), maxLag = Math.round(60 / 60 / hopSec);
  let bestLag = minLag, bestR = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0;
    for (let i = 0; i + lag < nF; i++) r += env[i] * env[i + lag];
    r /= (nF - lag);
    if (r > bestR) { bestR = r; bestLag = lag; }
  }
  // 位相: グリッド上のオンセット合計が最大になるオフセット
  let bestPhase = 0, bestS = -1;
  for (let p = 0; p < bestLag; p++) {
    let s = 0;
    for (let i = p; i < nF; i += bestLag) s += env[i];
    if (s > bestS) { bestS = s; bestPhase = p; }
  }
  // 拍列生成+近傍オンセットへスナップ(±80ms、テンポ揺れの吸収)
  const snapW = Math.round(0.08 / hopSec);
  const beats = [];
  for (let i = bestPhase; i < nF; i += bestLag) {
    let k = i, best = env[i];
    for (let j = Math.max(0, i - snapW); j <= Math.min(nF - 1, i + snapW); j++) {
      if (env[j] > best) { best = env[j]; k = j; }
    }
    beats.push((k * HOP + FR / 2) / sr);
  }
  const bpm = 60 / (bestLag * hopSec);
  MC.log(`beats: bpm=${bpm.toFixed(1)} beats=${beats.length}`);
  return { bpm, period: bestLag * hopSec, beats, env, hopSec };
};

/* tGlobal近傍のRMS(音声クリップの8kHz PCMから、±winSec) */
MC.beats.rmsAt = (clip, tGlobal, winSec = 1.0) => {
  const sr = MC.audio.SR;
  const c0 = Math.max(0, Math.round((tGlobal - clip.offset - winSec) * sr));
  const c1 = Math.min(clip.audio8k.length, Math.round((tGlobal - clip.offset + winSec) * sr));
  if (c1 - c0 < sr / 4) return 0;
  let s = 0;
  for (let i = c0; i < c1; i++) s += clip.audio8k[i] * clip.audio8k[i];
  return Math.sqrt(s / (c1 - c0));
};

/* 自動カット割: トリム範囲に cutList を生成して MC.S.cutList に入れる */
MC.beats.autocut = async () => {
  const audioClip = MC.getClip(MC.S.audioClipId);
  if (!audioClip) throw new Error("音声クリップがありません");
  if (!audioClip.audio8k) await MC.audio.extract8k(audioClip);
  if (!audioClip.beatsData) audioClip.beatsData = MC.beats.analyze(audioClip.audio8k);
  const B = audioClip.beatsData;
  const [tIn, tOut] = MC.trimRange();
  // グローバル時刻の拍列(トリム範囲内)
  const beats = B.beats.map(b => b + audioClip.offset).filter(b => b > tIn + 0.5 && b < tOut - 0.5);
  if (beats.length < 4) throw new Error("範囲内に拍が足りません(トリム範囲を広げてください)");
  const bpb = MC.S.beatsPerBar;
  // 頭拍: bpb間隔でオンセットエネルギー最大の位相
  let downIdx = 0, bestS = -1;
  for (let p = 0; p < bpb; p++) {
    let s = 0;
    for (let i = p; i < beats.length; i += bpb) {
      const li = Math.round((beats[i] - audioClip.offset - 0.032) / B.hopSec);
      s += B.env[Math.max(0, Math.min(B.env.length - 1, li))] || 0;
    }
    if (s > bestS) { bestS = s; downIdx = p; }
  }
  const bars = [];
  for (let i = downIdx; i < beats.length; i += bpb) bars.push(beats[i]);

  // 全体のRMS中央値(トランジション判定基準)
  const samples = [];
  for (let t = tIn + 1; t < tOut - 1; t += 2) samples.push(MC.beats.rmsAt(audioClip, t));
  samples.sort((a, b) => a - b);
  const medRms = samples.length ? samples[Math.floor(samples.length / 2)] : 0;

  // カメラ順: ラウンドロビン(直前と同じカメラは選ばない)
  const cams = MC.S.clips.map(c => c.id);
  if (cams.length < 2) throw new Error("2本以上のクリップが必要です");
  let camIdx = cams.indexOf(MC.S.audioClipId);  // 頭は音声カメラ(だいたい引き)
  if (camIdx < 0) camIdx = 0;

  const cuts = [{ t: tIn, clipId: cams[camIdx], trans: "cut", dur: 0 }];
  let segStart = tIn;
  const points = bars.length >= 3 ? bars : beats;  // 小節が少なければ拍でカット
  for (const bt of points) {
    const len = bt - segStart;
    if (len < MC.beats.MIN_SHOT) continue;
    // MAX超過しそうなら強制、それ以外もMIN以上ならこの小節でカット
    if (len >= MC.beats.MIN_SHOT) {
      camIdx = (camIdx + 1) % cams.length;  // 決定的ローテーション(直前と必ず変わる)
      const quiet = MC.beats.rmsAt(audioClip, bt) < medRms * 0.85;
      cuts.push({
        t: bt, clipId: cams[camIdx],
        trans: quiet && len > 1.5 ? "dissolve" : "cut",
        dur: quiet ? MC.beats.DISSOLVE_DUR : 0,
      });
      segStart = bt;
    }
  }
  // 末尾が短すぎるセグメントは1つ前と統合
  if (cuts.length > 1 && tOut - cuts[cuts.length - 1].t < 1.5) cuts.pop();
  MC.S.cutList = cuts;
  MC.saveState();
  MC.log(`autocut: ${cuts.length} segments, bpm=${B.bpm.toFixed(1)}`);
  return { segments: cuts.length, bpm: B.bpm };
};
