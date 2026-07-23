"use strict";
/* ============ 音声抽出(8kHzモノラル)+音質統計 ============ */

MC.audio = { SR: 8000, MAX_SEC: 1800 };

/* 線形補間のストリーミングリサンプラ(チャンクをまたいで連続) */
MC.audio.LinearResampler = class {
  constructor(fromRate, toRate) {
    this.ratio = fromRate / toRate;
    this.pos = 0;        // 入力系列上の小数位置(グローバル)
    this.consumed = 0;   // これまでに捨てた入力サンプル数
    this.carry = null;   // 前チャンク末尾1サンプル
  }
  push(chunk) {
    const src = this.carry != null ? (() => {
      const a = new Float32Array(chunk.length + 1);
      a[0] = this.carry; a.set(chunk, 1);
      return a;
    })() : chunk;
    const base = this.consumed - (this.carry != null ? 1 : 0);  // srcの先頭のグローバル位置
    const out = [];
    while (this.pos + 1 < base + src.length) {
      const rel = this.pos - base;
      const i = Math.floor(rel), f = rel - i;
      out.push(src[i] * (1 - f) + src[i + 1] * f);
      this.pos += this.ratio;
    }
    this.carry = src[src.length - 1];
    this.consumed = base + src.length;
    return Float32Array.from(out);
  }
};

/* クリップの音声を8kHzモノラルFloat32Arrayで取得(clip.audio8k にキャッシュ)。
   startSec で「途中からの窓抽出」ができる(2026-07-24 窓同期)。
   - clip.audio8kStart    … 実際の開始秒(AACはフレーム境界で要求とズレるため実測値)
   - clip.audio8kReqStart … 要求した開始秒(キャッシュ判定のキー)
   - clip.audio8kReqSpan  … 要求した長さ(秒)
   窓→全尺のように条件が変わったら再抽出して上書きする。上書き時は
   窓データ由来の解析キャッシュ(beatsData/sections)を必ず捨てる */
MC.audio.extract8k = async (clip, maxSec = MC.audio.MAX_SEC, onProg = null, startSec = 0) => {
  if (clip.audio8k &&
      (clip.audio8kReqStart || 0) === startSec &&
      (clip.audio8kReqSpan || 0) >= Math.min(maxSec, Math.max(0, (clip.duration || maxSec) - startSec))) {
    return clip.audio8k;
  }
  let r = null, err1 = null;
  try {
    r = await MC.audio.viaRawPcm(clip, maxSec, onProg, startSec);   // リニアPCM(Resolve等のMOV)は生読みが最速・最軽量
    if (!r) r = await MC.audio.viaWebCodecs(clip, maxSec, startSec);
  } catch (e) {
    err1 = e;
    console.warn("[MC] WebCodecs音声抽出失敗→decodeAudioDataへ:", e.message);
    try { r = await MC.audio.viaDecodeAudioData(clip, maxSec, startSec); }
    catch (e2) {
      clip.hasAudio = false;
      throw new Error(`音声を抽出できません(${clip.name}): ${err1.message} / ${e2.message}`);
    }
  }
  if (r.pcm.length < MC.audio.SR) { clip.hasAudio = false; throw new Error(`音声が短すぎます(1秒未満): ${clip.name}`); }
  clip.hasAudio = true;
  clip.audio8k = r.pcm;
  clip.audio8kStart = r.start;
  clip.audio8kReqStart = startSec;
  clip.audio8kReqSpan = maxSec;
  clip.beatsData = null;   // 旧窓データ由来の解析を残さない(静かな汚染防止)
  clip.sections = null;
  clip.stats = MC.audio.stats(r.pcm);
  return r.pcm;
};

/* 同期用の窓: 3分超は「真ん中3分」だけ読む(2026-07-24 優さん指示)。
   短い素材は窓化の得がないので全体 */
MC.audio.WIN_SEC = 180;
MC.audio.midWindow = clip => {
  const d = clip.duration || 0;
  if (d <= MC.audio.WIN_SEC + 30) return { start: 0, span: MC.audio.MAX_SEC };
  return { start: (d - MC.audio.WIN_SEC) / 2, span: MC.audio.WIN_SEC };
};

/* リニアPCM(lpcm/sowt等)の生読み: デコーダ不要。チャンクを順に読み
   モノラル化→8kHzへ。PCMトラックが無いファイルでは null を返す。
   startSec 指定時はそこから読む(跨ぎチャンクの頭は捨ててフレーム精度で揃える) */
MC.audio.viaRawPcm = async (clip, maxSec, onProg = null, startSec = 0) => {
  const src = new MC.MP4Source(clip.file);
  await src.init();
  if (!src.pcm) return null;
  const resampler = new MC.audio.LinearResampler(src.pcm.rate, MC.audio.SR);
  const outChunks = [];
  let total = 0;
  const maxFrames = maxSec * MC.audio.SR;
  /* 進捗の分母は「実際に読む長さ」。maxSec(上限30分)で割ると、8分音声が
     27%で完了して見えるため。duration が無ければ上限で近似(2026-07-23) */
  const target = Math.min(maxFrames,
    Math.max(1, Math.round(((clip.duration || maxSec) - startSec) * MC.audio.SR)));
  /* 窓の開始フレーム(ソースのレート基準)。pcmChunks は跨ぎチャンクを
     丸ごと返すので、最初のチャンクで頭を捨てて startSec 始まりに揃える */
  const startFrameReq = Math.max(0, Math.floor(startSec * src.pcm.rate));
  const actualStart = startFrameReq / src.pcm.rate;
  let tick = 0;
  for await (const c of src.pcmChunks(startSec)) {
    let chans = src.pcmToFloat(c.data, c.frames);
    const skip = startFrameReq - c.startFrame;
    if (skip > 0) chans = chans.map(a => a.subarray(skip));
    const mono = chans[0];
    for (let ch = 1; ch < chans.length; ch++) {
      const a = chans[ch];
      for (let i = 0; i < mono.length; i++) mono[i] += a[i];
    }
    if (chans.length > 1) for (let i = 0; i < mono.length; i++) mono[i] /= chans.length;
    const out = resampler.push(mono);
    if (out.length) { outChunks.push(out); total += out.length; }
    if (onProg && (tick++ & 7) === 0) onProg(Math.min(1, total / target));
    if (total >= maxFrames) break;
    await MC.yield();   // 20分素材でもUIを固めない
  }
  if (onProg) onProg(1);
  const pcm = new Float32Array(Math.min(total, maxFrames));
  let o = 0;
  for (const a of outChunks) {
    const n = Math.min(a.length, pcm.length - o);
    if (n <= 0) break;
    pcm.set(a.subarray(0, n), o); o += n;
  }
  return { pcm, start: actualStart };
};

/* 主経路: mp4boxデマックス + AudioDecoder(大きいファイルでもメモリ軽量)。
   startSec 指定時はそこからデコード。AACはフレーム境界が要求秒に一致しないため、
   最初に出てきた AudioData の実タイムスタンプを開始秒として返す(同期精度を守る) */
MC.audio.viaWebCodecs = async (clip, maxSec, startSec = 0) => {
  const src = new MC.MP4Source(clip.file);
  await src.init();
  const at = src.audioTrack();
  if (!at) throw new Error("音声トラックがありません");
  const cfg = src.audioDecoderConfig();
  const sup = await AudioDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!sup.supported) throw new Error(`音声コーデック非対応: ${cfg.codec}`);

  const outChunks = [];
  let decodedSec = 0, error = null;
  let resampler = null;
  let firstTs = null;   // 実際の開始秒(最初のデコード済みフレームのタイムスタンプ)
  const decoder = new AudioDecoder({
    output: ad => {
      try {
        if (firstTs == null) firstTs = ad.timestamp / 1e6;
        const frames = ad.numberOfFrames, ch = ad.numberOfChannels;
        if (!resampler) resampler = new MC.audio.LinearResampler(ad.sampleRate, MC.audio.SR);
        // モノラルミックスダウン
        const mono = new Float32Array(frames);
        const buf = new Float32Array(frames);
        for (let c = 0; c < ch; c++) {
          ad.copyTo(buf, { planeIndex: c, format: "f32-planar" });
          for (let i = 0; i < frames; i++) mono[i] += buf[i] / ch;
        }
        const out = resampler.push(mono);
        if (out.length) outChunks.push(out);
        decodedSec += frames / ad.sampleRate;
      } finally { ad.close(); }
    },
    error: e => { error = e; },
  });
  decoder.configure(cfg);
  for await (const s of src.samples(at.id, startSec)) {
    if (error) break;
    decoder.decode(new EncodedAudioChunk({
      type: s.is_sync ? "key" : "delta",
      timestamp: Math.round(s.cts * 1e6 / s.timescale),
      duration: Math.round(s.duration * 1e6 / s.timescale),
      data: s.data,
    }));
    if (decodedSec >= maxSec) break;
    if (decoder.decodeQueueSize > 32) await MC.waitDequeue(decoder);
  }
  if (!error) await decoder.flush().catch(() => {});
  try { decoder.close(); } catch (e) {}
  if (error) throw error;
  // 連結
  const total = outChunks.reduce((s, a) => s + a.length, 0);
  const pcm = new Float32Array(Math.min(total, maxSec * MC.audio.SR));
  let o = 0;
  for (const a of outChunks) {
    const n = Math.min(a.length, pcm.length - o);
    if (n <= 0) break;
    pcm.set(a.subarray(0, n), o); o += n;
  }
  return { pcm, start: firstTs != null ? firstTs : startSec };
};

/* 代替経路: decodeAudioData(ファイル全読み込みなのでサイズ制限あり。iPhoneはメモリが厳しいため控えめに) */
MC.audio.viaDecodeAudioData = async (clip, maxSec, startSec = 0) => {
  const limit = MC.isIOS ? 3e8 : 1.2e9;
  if (clip.size > limit) throw new Error(`ファイルが大きすぎます(${Math.round(limit / 1e8) / 10}GB超)`);
  const ab = await clip.file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, MC.audio.SR, MC.audio.SR);  // 8kHzへ自動リサンプル
  const buf = await ctx.decodeAudioData(ab);
  const d = buf.getChannelData(0);
  const s0 = Math.min(d.length, Math.max(0, Math.floor(startSec * MC.audio.SR)));
  const n = Math.min(d.length - s0, maxSec * MC.audio.SR);
  return { pcm: Float32Array.from(d.subarray(s0, s0 + n)), start: s0 / MC.audio.SR };
};

/* 音質統計: 有音部分の代表RMSとクリッピング率 */
MC.audio.stats = pcm => {
  const win = MC.audio.SR / 2;  // 0.5秒窓
  const rmsList = [];
  let clipped = 0;
  for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > 0.985) clipped++;
  for (let o = 0; o + win <= pcm.length; o += win) {
    let s = 0;
    for (let i = o; i < o + win; i++) s += pcm[i] * pcm[i];
    const r = Math.sqrt(s / win);
    if (r > 0.004) rmsList.push(r);  // ほぼ無音の窓は除外
  }
  rmsList.sort((a, b) => a - b);
  const rms = rmsList.length ? rmsList[Math.floor(rmsList.length / 2)] : 0;
  return { rms, clipRatio: clipped / pcm.length };
};

/* 音声トラックのおすすめ: RMS大きい順、クリッピングにペナルティ */
MC.audio.recommend = () => {
  const cands = MC.S.clips.filter(c => c.stats);
  if (!cands.length) return null;
  const score = c => c.stats.rms * (1 - Math.min(1, c.stats.clipRatio * 200));
  return cands.reduce((best, c) => (score(c) > score(best) ? c : best), cands[0]);
};
