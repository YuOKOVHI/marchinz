"use strict";
/* ============ 波形同期: GCC-PHAT (WaveSync/wavesync_core.py の移植) ============
   二段構成: 500Hzで全体を粗く→8kHzで±3秒窓を精密化(メモリと速度のため)。
   offset > 0 = そのクリップは基準より後に録り始めた。 */

MC.sync = { MIN_CONF: 8.0 };

MC.sync.nextPow2 = n => 1 << Math.ceil(Math.log2(n));

/* boxcar平均でデシメート */
MC.sync.decimate = (pcm, factor) => {
  const n = Math.floor(pcm.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) s += pcm[base + j];
    out[i] = s / factor;
  }
  return out;
};

/* GCC-PHAT本体。a=基準, b=対象。戻り {offset(秒), conf} 。
   corr[k]: a[t+k] ≈ b[t] → lag>0 = bが後から録り始め。
   長尺ではFFT1回が秒単位かかるため、合間にyieldしてメインスレッドを返す
   (固まり続けるとiOS Safariがページを強制終了して「落ちる」) */
MC.sync.gccPhat = async (a, b, sr) => {
  const n = MC.sync.nextPow2(a.length + b.length - 1);
  const fft = new FFT(n);
  const pa = new Float64Array(n); pa.set(a);
  const pb = new Float64Array(n); pb.set(b);
  const A = fft.createComplexArray(); fft.realTransform(A, pa); fft.completeSpectrum(A);
  await MC.yield();
  const B = fft.createComplexArray(); fft.realTransform(B, pb); fft.completeSpectrum(B);
  await MC.yield();
  const X = A;  // Aを上書きして R*conj(S) をPHAT正規化
  for (let i = 0; i < n; i++) {
    const re = A[2 * i] * B[2 * i] + A[2 * i + 1] * B[2 * i + 1];
    const im = A[2 * i + 1] * B[2 * i] - A[2 * i] * B[2 * i + 1];
    const mag = Math.max(Math.hypot(re, im), 1e-12);
    X[2 * i] = re / mag;
    X[2 * i + 1] = im / mag;
  }
  await MC.yield();
  const out = fft.createComplexArray();
  fft.inverseTransform(out, X);
  await MC.yield();
  // |corr| の最大と中央値(2000ビンヒストグラム近似; ソート回避)
  let kMax = 0, peak = 0;
  for (let k = 0; k < n; k++) {
    const v = Math.abs(out[2 * k]);
    if (v > peak) { peak = v; kMax = k; }
  }
  const NB = 2000;
  const hist = new Uint32Array(NB);
  const inv = NB / (peak || 1e-12);
  for (let k = 0; k < n; k++) {
    let b2 = (Math.abs(out[2 * k]) * inv) | 0;
    if (b2 >= NB) b2 = NB - 1;
    hist[b2]++;
  }
  let acc = 0, medBin = 0;
  for (let i = 0; i < NB; i++) { acc += hist[i]; if (acc >= n / 2) { medBin = i; break; } }
  const floor = Math.max(((medBin + 0.5) / NB) * peak, 1e-12);
  const lag = kMax < n / 2 ? kMax : kMax - n;
  return { offset: lag / sr, conf: peak / floor };
};

/* 二段GCC-PHAT: ref8k/sig8k は8kHzモノ。戻り {offset, conf} */
MC.sync.offsetBetween = async (ref8k, sig8k) => {
  const SR = MC.audio.SR;
  // 一段目: 500Hz(長尺はさらに半分ずつ落とし、FFTサイズを約2^20以下に抑える)
  let F = 16;
  while ((ref8k.length + sig8k.length) / F > 1.2e6) F *= 2;
  const coarse = await MC.sync.gccPhat(MC.sync.decimate(ref8k, F), MC.sync.decimate(sig8k, F), SR / F);
  const L = coarse.offset;
  const refDur = ref8k.length / SR, sigDur = sig8k.length / SR;
  const ovA = Math.max(0, L), ovB = Math.min(refDur, L + sigDur);
  if (ovB - ovA < 5) return coarse;  // 重なり5秒未満は精密化不能
  // 二段目: 8kHz・窓60秒・±3秒マージン
  const M = 3;
  const w = Math.min(60, ovB - ovA - 0.5);
  const ctr = (ovA + ovB) / 2;
  let r0 = Math.max(0, Math.min(ctr - w / 2, refDur - w));
  let s0 = Math.max(0, Math.min((ctr - L) - w / 2 - M, sigDur - (w + 2 * M)));
  if (s0 < 0) return coarse;
  const refSeg = ref8k.subarray(Math.round(r0 * SR), Math.round((r0 + w) * SR));
  const sigSeg = sig8k.subarray(Math.round(s0 * SR), Math.round((s0 + w + 2 * M) * SR));
  const fine = await MC.sync.gccPhat(refSeg, sigSeg, SR);
  // sigSeg[t]の内容 = ref時刻 r0 + t + lag2 = s0 + t + L_true → L_true = r0 - s0 + lag2
  const Lfine = r0 - s0 + fine.offset;
  if (Math.abs(Lfine - L) > M + 1) return coarse;  // 精密化が窓の外→粗い値を採用
  return { offset: Lfine, conf: fine.conf };
};

/* タイムスタンプ推定: 更新時刻=録画終了とみなし、開始時刻 = mtime - duration */
MC.sync.tsRecordStart = clip => clip.lastModified / 1000 - clip.duration;

/* 全クリップの同期を実行 */
/* p: MZPの進捗ハンドル(省略可) */
MC.sync.run = async p => {
  const clips = MC.S.clips.filter(c => !c.isImage);   // 静止画は同期対象外
  if (clips.length < 2) { MC.ui.toast("2本以上のクリップが必要です"); return; }

  // 音声抽出
  let i = 0;
  for (const c of clips) {
    i++;
    if (c.audio8k) continue;
    if (p) p.step(1, "音を取り出しています…").count(i, clips.length, { unit: "本目", name: c.name });
    try { await MC.audio.extract8k(c); }
    catch (e) { console.warn("[MC]", e.message); MC.ui.toast(`⚠ ${e.message}`); }
    await new Promise(r => setTimeout(r, 0));
  }

  const ref = clips.find(c => c.id === MC.S.refClipId && c.audio8k) || clips.find(c => c.audio8k);
  const results = [];
  let j = 0;
  for (const c of clips) {
    j++;
    if (ref && c === ref) {
      results.push({ clip: c, raw: 0, conf: Infinity, method: "基準" });
      continue;
    }
    if (ref && c.audio8k) {
      if (p) p.step(2, "ズレを合わせています…").count(j, clips.length, { unit: "本目", name: c.name });
      await new Promise(r => setTimeout(r, 0));  // UI更新の息継ぎ
      let r = null;
      try {
        r = await MC.sync.offsetBetween(ref.audio8k, c.audio8k);
        MC.log(`sync ${c.name}: offset=${r.offset.toFixed(4)}s conf=${r.conf.toFixed(1)}`);
      } catch (e) {
        MC.log(`sync ${c.name}: 波形照合に失敗→タイムスタンプへ:`, e.message);
      }
      if (r && r.conf >= MC.sync.MIN_CONF) {
        results.push({ clip: c, raw: r.offset, conf: r.conf, method: "波形" });
        continue;
      }
    }
    // フォールバック: カメラのタイムスタンプ
    const raw = ref ? MC.sync.tsRecordStart(c) - MC.sync.tsRecordStart(ref) : 0;
    results.push({ clip: c, raw, conf: null, method: "タイムスタンプ" });
    MC.log(`sync ${c.name}: timestamp fallback raw=${raw.toFixed(2)}s`);
  }

  // 正規化: 最小オフセットを0に(グローバルタイムライン先頭)
  const minRaw = Math.min(...results.map(r => r.raw));
  for (const r of results) {
    r.clip.offset = r.raw - minRaw;
    r.clip.confidence = r.conf;
    r.clip.syncMethod = r.method;
  }
  MC.S.trimIn = 0; MC.S.trimOut = null;
  MC.saveState();
  MC.ui.renderAll();
  const low = results.filter(r => r.method === "タイムスタンプ").length;
  MC.ui.toast(low ? `同期完了(${low}本は時刻推定・精度±数秒 → 手動微調整してください)` : "波形同期が完了しました 🎯");
  return { low, total: clips.length };
};

/* 手動ナッジ: delta秒ずらして最小0に再正規化 */
MC.sync.nudge = (clipId, delta) => {
  const c = MC.getClip(clipId);
  if (!c) return;
  c.offset += delta;
  c.syncMethod = c.syncMethod.includes("手動") ? c.syncMethod : c.syncMethod + "+手動";
  const syncable = MC.S.clips.filter(x => !x.isImage);
  const min = Math.min(...syncable.map(x => x.offset));
  if (min !== 0) syncable.forEach(x => { x.offset -= min; });
  MC.saveState();
  MC.ui.renderClips();
  MC.preview.seek(MC.S.t);  // 画で確認できるよう再シーク
};

/* 試聴チェック: 現在位置から基準+対象の音声を4秒重ねて再生(ズレ確認用) */
MC.sync.listenCheck = clipId => {
  const c = MC.getClip(clipId);
  const ref = MC.getClip(MC.S.refClipId);
  if (!c || !ref || !c.audio8k || !ref.audio8k || c === ref) return;
  const SR = MC.audio.SR, DUR = 4;
  const ctx = MC.sync._actx || (MC.sync._actx = new AudioContext());
  const t = MC.S.t;
  const mk = clip => {
    const start = Math.max(0, Math.round((t - clip.offset) * SR));
    const seg = clip.audio8k.subarray(start, start + DUR * SR);
    if (seg.length < SR) return null;
    const buf = ctx.createBuffer(1, seg.length, SR);
    buf.copyToChannel(Float32Array.from(seg), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.5;
    src.connect(g).connect(ctx.destination);
    return src;
  };
  const s1 = mk(ref), s2 = mk(c);
  if (!s1 || !s2) { MC.ui.toast("この位置では両方の音がありません"); return; }
  const at = ctx.currentTime + 0.05;
  s1.start(at); s2.start(at);
  MC.ui.toast("🎧 2本の音を重ねて再生中(ピッタリなら同期OK)");
};
