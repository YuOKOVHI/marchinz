"use strict";
/* ============ 音声区間解析(曲調・テンポ・セクションの手がかり) ============
   マスター音声(8kHzモノ)から0.5秒ホップで特徴量タイムラインを作る:
   - rms        : 音圧(ダイナミクス)
   - onset      : オンセット密度(beats.jsのフラックス包絡を利用)
   - centroid   : スペクトル重心(高いほど明るい音色=マレット/シンバル寄り)
   - harm       : 調波性(自己相関ピーク。高い=音程もの、低い=打撃音)
   - bpmLocal   : 12秒窓の局所テンポ(4秒ホップ)
   セクション分類(スコア0..1):
   - quiet      : 静か(バラード・ディゾルブ向き)
   - solo       : ソロっぽい(薄いテクスチャ+調波的 → 単独奏者のアップ向き)
   - percussion : バッテリー鳴り(打撃的+調波性低 → グループショット向き)
   - pit        : 鍵盤(マレット)が手数多い(高重心+調波的+オンセット密 → ピット画角向き)
   - tutti      : 全奏・盛り上がり(音圧高 → 引き・ダイナミックなカット向き)
   audioClip.sections にキャッシュする。 */

MC.sections = { HOP: 0.5, WIN: 1.0 };

MC.sections.analyze = async audioClip => {
  if (audioClip.sections) return audioClip.sections;
  if (!audioClip.audio8k) await MC.audio.extract8k(audioClip);
  if (!audioClip.beatsData) audioClip.beatsData = MC.beats.analyze(audioClip.audio8k);
  const pcm = audioClip.audio8k, sr = MC.audio.SR;
  const B = audioClip.beatsData;
  const hop = Math.round(MC.sections.HOP * sr);
  const win = Math.round(MC.sections.WIN * sr);
  const nH = Math.max(1, Math.floor((pcm.length - win) / hop));

  const FR = 512;
  const fft = new FFT(FR);
  const spec = fft.createComplexArray();
  const frame = new Float64Array(FR);
  const hann = MC.beats._hann(FR);

  const S = {
    hop: MC.sections.HOP, t: new Float32Array(nH),
    rms: new Float32Array(nH), onset: new Float32Array(nH),
    centroid: new Float32Array(nH), harm: new Float32Array(nH),
  };

  // beats.env(16msホップ)→0.5秒ビンのオンセット密度へ集約
  const envHopSec = B.hopSec;
  for (let i = 0; i < nH; i++) {
    const t0 = i * MC.sections.HOP;
    const e0 = Math.round(t0 / envHopSec), e1 = Math.min(B.env.length, Math.round((t0 + MC.sections.WIN) / envHopSec));
    let s = 0;
    for (let k = e0; k < e1; k++) s += B.env[k];
    S.onset[i] = e1 > e0 ? s / (e1 - e0) : 0;
  }

  for (let i = 0; i < nH; i++) {
    const o = i * hop;
    S.t[i] = o / sr + MC.sections.WIN / 2;
    // RMS
    let sq = 0;
    for (let j = o; j < o + win; j++) sq += pcm[j] * pcm[j];
    S.rms[i] = Math.sqrt(sq / win);
    // スペクトル重心(窓中央のFRサンプル)
    const c0 = o + ((win - FR) >> 1);
    for (let j = 0; j < FR; j++) frame[j] = pcm[c0 + j] * hann[j];
    fft.realTransform(spec, frame);
    let num = 0, den = 0;
    for (let k = 1; k < FR / 2; k++) {
      const m = Math.hypot(spec[2 * k], spec[2 * k + 1]);
      num += k * m; den += m;
    }
    S.centroid[i] = den > 1e-9 ? (num / den) * (sr / FR) : 0;   // Hz
    // 調波性: 2048サンプルの自己相関最大(40〜400Hzのラグ)/ゼロラグ
    const AL = 2048;
    const a0 = o + ((win - AL) >> 1);
    let e0 = 0;
    for (let j = 0; j < AL; j++) e0 += pcm[a0 + j] * pcm[a0 + j];
    let best = 0;
    if (e0 > 1e-7) {
      const lagMin = Math.round(sr / 400), lagMax = Math.round(sr / 40);
      for (let lag = lagMin; lag <= lagMax; lag += 2) {
        let r = 0;
        for (let j = 0; j + lag < AL; j += 2) r += pcm[a0 + j] * pcm[a0 + j + lag];
        r = 2 * r / e0;
        if (r > best) best = r;
      }
    }
    S.harm[i] = Math.max(0, Math.min(1, best));
    if (i % 40 === 39) await MC.yield();
  }

  // 局所BPM: 12秒窓・4秒ホップでオンセット包絡を自己相関(60〜200BPM)
  const bw = Math.round(12 / envHopSec), bh = Math.round(4 / envHopSec);
  const minLag = Math.round(60 / 200 / envHopSec), maxLag = Math.round(60 / 60 / envHopSec);
  const bpmT = [], bpmV = [];
  for (let o = 0; o + bw <= B.env.length; o += bh) {
    let bestLag = minLag, bestR = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let r = 0;
      for (let i = o; i + lag < o + bw; i++) r += B.env[i] * B.env[i + lag];
      if (r > bestR) { bestR = r; bestLag = lag; }
    }
    bpmT.push((o + bw / 2) * envHopSec);
    bpmV.push(60 / (bestLag * envHopSec));
  }
  S.bpmT = bpmT; S.bpmV = bpmV;

  // 正規化基準(パーセンタイル)
  const pct = (arr, q) => {
    const s = Array.from(arr).filter(x => isFinite(x)).sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0;
  };
  S.rmsLo = pct(S.rms, 0.15); S.rmsHi = pct(S.rms, 0.90);
  S.onLo = pct(S.onset, 0.20); S.onHi = pct(S.onset, 0.90);
  S.cenMed = pct(S.centroid, 0.5); S.cenHi = pct(S.centroid, 0.85);

  audioClip.sections = S;
  MC.log(`sections: ${nH}点 bpm範囲=${Math.round(Math.min(...bpmV))}〜${Math.round(Math.max(...bpmV))}`);
  return S;
};

/* クリップローカル→インデックス(クランプ) */
MC.sections._idx = (S, tLocal) =>
  Math.max(0, Math.min(S.t.length - 1, Math.round((tLocal - MC.sections.WIN / 2) / S.hop)));

/* グローバル秒tの局所BPM */
MC.sections.bpmAt = (audioClip, tGlobal) => {
  const S = audioClip.sections;
  if (!S || !S.bpmT.length) return null;
  const tl = tGlobal - audioClip.offset;
  let best = 0, bd = Infinity;
  for (let i = 0; i < S.bpmT.length; i++) {
    const d = Math.abs(S.bpmT[i] - tl);
    if (d < bd) { bd = d; best = i; }
  }
  return S.bpmV[best];
};

/* グローバル秒区間[g0,g1]のセクションスコア。
   norm(x, lo, hi) = 0..1 正規化(loで0, hiで1) */
MC.sections.classify = (audioClip, g0, g1) => {
  const S = audioClip.sections;
  if (!S) return null;
  const i0 = MC.sections._idx(S, g0 - audioClip.offset);
  const i1 = Math.max(i0, MC.sections._idx(S, g1 - audioClip.offset));
  const mean = arr => {
    let s = 0;
    for (let i = i0; i <= i1; i++) s += arr[i];
    return s / (i1 - i0 + 1);
  };
  const norm = (x, lo, hi) => Math.max(0, Math.min(1, (x - lo) / Math.max(1e-9, hi - lo)));
  const rms = mean(S.rms), onset = mean(S.onset), cen = mean(S.centroid), harm = mean(S.harm);
  const dyn = norm(rms, S.rmsLo, S.rmsHi);          // 音圧 0..1
  const dens = norm(onset, S.onLo, S.onHi);         // オンセット密度 0..1
  const bright = norm(cen, S.cenMed, S.cenHi);      // 音色の明るさ 0..1
  const bpm = MC.sections.bpmAt(audioClip, (g0 + g1) / 2);
  return {
    dyn, dens, bright, harm, bpm,
    quiet: 1 - dyn,
    solo: (1 - dyn) * harm * (1 - dens * 0.5),
    percussion: dens * (1 - harm) * Math.min(1, dyn + 0.3),
    pit: bright * harm * dens,
    tutti: dyn,
  };
};
