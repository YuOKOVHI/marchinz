"use strict";
/* ============ MarchinZ Vlog: 書き出し ============
   高速経路: WebCodecs で plan を1コマずつ合成 → H.264+AAC の MP4。
   実時間経路: プレビューを再生しながら MediaRecorder で録る(iOS等)。

   Switcher exporter.js で確立した作法をそのまま踏襲する:
   - fastStart:false(in-memoryは全チャンクをメモリに溜め続ける。2026-07-20の教訓)
   - エンコーダの output コールバック内で throw しない(握って外で失敗させる)
   - AACのプライミング遅延を実測して相殺する
   - 映像が終わったらデコーダを即解放してから音声へ
   - iOSは保存前にサイズを見積もり、載らないなら始める前に断る

   Vlogならではの点:
   - カメラ並列ではなくセグメント逐次。同時に開くデコードパイプは
     最大3本(現行+ディゾルブの前+Bロール)で済む
   - 音は「完成尺ぶんのミックスバス(48kHzステレオ)」を先に組み立てる。
     素材音(フェード・クロスフェード)とBGM(ダッキング)をここへ足し込む */

MV.exporter = { cancelFlag: false, running: false, lastResult: null };

MV.exporter.OUT_SR = 48000;

MV.exporter.videoBitrate = () => {
  const base = (window.MZ_LIMITS || {}).vlogBitrate || 8e6;
  return MV.isIOS ? 5e6 : base;   // 投稿先の実効レートに合わせ、書き出せる尺を優先(Switcherと同じ判断)
};

MV.exporter.estimateBytes = () => {
  const plan = MV.S.plan;
  if (!plan) return 0;
  return plan.totalSec * (MV.exporter.videoBitrate() + 192e3) / 8;
};

/* iOSは完成MP4を丸ごとメモリに載せるしかない。超えると無警告でタブごと落ちる */
MV.exporter.MEM_HARD_LIMIT = MV.isIOS ? 260e6 : 1.6e9;

/* これを超える見込みなら保存先を選ばせてディスクへ直接書く(Switcherと同じ) */
MV.exporter.MEM_LIMIT_BYTES = 700e6;

/* 高速経路が同時に確保する作業メモリ込みの見積り。完成MP4だけで判定すると、
   音声ミックスバスとBGMデコードの分を見落として「上限内のはずが落ちる」になる
   (encodeAudioPcmの196MB保持と同じ型の見落とし。2026-07-20レビューの指摘) */
MV.exporter.estimateWorkBytes = () => {
  const plan = MV.S.plan;
  if (!plan) return 0;
  const busBytes = plan.totalSec * MV.exporter.OUT_SR * 4 * 2;   // Float32 L/R
  let bgmBytes = 0;   // BGMは1曲ずつデコードするのでピークは最長1曲分
  if (plan.bgm.length && MV.S.bgms.length) {
    const longest = Math.max(...MV.S.bgms.map(b => b.duration || 0), 0);
    bgmBytes = Math.min(longest, 600) * MV.exporter.OUT_SR * 4 * 2;
  }
  return MV.exporter.estimateBytes() + busBytes + bgmBytes;
};

/* 書き出し中の画面ロック対策。ロックすると rAF / MediaRecorder が止まり、
   壊れた短いMP4が無言で保存される。marchinz-base.js のメトロノームと同じ実装 */
MV.exporter._wake = null;
MV.exporter.holdWake = async want => {
  try {
    if (want && !MV.exporter._wake && navigator.wakeLock) {
      MV.exporter._wake = await navigator.wakeLock.request("screen");
      MV.exporter._wake.addEventListener("release", () => { MV.exporter._wake = null; });
    } else if (!want && MV.exporter._wake) {
      const w = MV.exporter._wake;
      MV.exporter._wake = null;
      await w.release();
    }
  } catch (_) { MV.exporter._wake = null; }
};

MV.exporter.makeCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  return cv;
};

/* ---- 1素材ぶんのデコードパイプ(Switcherと同一の作法・hold-last-frame) ---- */
MV.exporter.VideoPipe = class {
  constructor(clip) {
    this.clip = clip;
    this.frames = [];
    this.current = null;
    this.eof = false;
    this.flushed = false;
    this.error = null;
  }

  async init(fromLocalSec) {
    this.src = new MV.MP4Source(this.clip.file);
    await this.src.init();
    const vt = this.src.videoTrack();
    if (!vt) throw new Error("映像トラックがありません: " + this.clip.name);
    const cfg = this.src.videoDecoderConfig();
    const sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (!sup.supported) throw new Error(`デコード非対応(${cfg.codec}): ${this.clip.name}`);
    this.rotation = this.src.rotationOf(vt);
    this.decoder = new VideoDecoder({
      output: f => this.frames.push(f),
      error: e => { this.error = e; },
    });
    this.decoder.configure(cfg);
    this.iter = this.src.samples(vt.id, Math.max(0, fromLocalSec));
  }

  async pump() {
    while (!this.eof && this.decoder.decodeQueueSize < 12 && this.frames.length < 8) {
      const { value: s, done } = await this.iter.next();
      if (done) {
        this.eof = true;
        await this.decoder.flush().catch(() => {});
        this.flushed = true;
        return;
      }
      this.decoder.decode(new EncodedVideoChunk({
        type: s.is_sync ? "key" : "delta",
        timestamp: Math.round(s.cts * 1e6 / s.timescale),
        duration: Math.max(1, Math.round(s.duration * 1e6 / s.timescale)),
        data: s.data,
      }));
    }
  }

  /* tLocalSec は素材先頭からの絶対秒。frames[].timestamp と同じ基準なので
     そのまま突き合わせる(相対化すると途中開始で二重に進む。2026-07-20の教訓) */
  async frameAt(tLocalSec) {
    if (this.error) throw this.error;
    const tUs = tLocalSec * 1e6;
    let guard = 0;
    while (guard < 4000) {
      let advanced = false;
      while (this.frames.length && this.frames[0].timestamp <= tUs) {
        if (this.current) this.current.close();
        this.current = this.frames.shift();
        advanced = true;
      }
      if (this.frames.length) return this.current;
      if (this.eof && this.flushed) return this.current;
      await this.pump();
      if (this.error) throw this.error;
      if (!this.frames.length && !this.eof) {
        await MV.waitDequeue(this.decoder, 50);
      }
      guard = advanced ? 0 : guard + 1;
    }
    throw new Error("デコードが進みません: " + this.clip.name);
  }

  dispose() {
    try { this.decoder.close(); } catch (e) {}
    this.frames.forEach(f => { try { f.close(); } catch (e) {} });
    this.frames = [];
    if (this.current) { try { this.current.close(); } catch (e) {} this.current = null; }
    if (this.iter && this.iter.return) this.iter.return();
  }
};

/* ---- AACプライミング遅延の実測(Switcherと同一) ---- */
MV.exporter.measureAacDelay = async () => {
  if (MV.caps.aacDelay != null) return MV.caps.aacDelay;
  try {
    const SR = 48000, N = SR / 2, BURST = 12000;
    const sig = new Float32Array(N * 2);
    for (let i = 0; i < 960; i++) {
      const v = Math.sin(2 * Math.PI * 1000 * i / SR) * (i < 100 ? i / 100 : 1);
      sig[BURST + i] = v; sig[N + BURST + i] = v;
    }
    const chunks = [];
    let decCfg = null, encErr = null;
    const enc = new AudioEncoder({
      output: (c, m) => { chunks.push(c); if (m && m.decoderConfig) decCfg = m.decoderConfig; },
      error: e => { encErr = e; },
    });
    enc.configure({ codec: "mp4a.40.2", sampleRate: SR, numberOfChannels: 2, bitrate: 192000 });
    enc.encode(new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: N, numberOfChannels: 2, timestamp: 0, data: sig }));
    await enc.flush(); enc.close();
    if (encErr || !chunks.length) throw encErr || new Error("no chunks");
    const pcm = [];
    const dec = new AudioDecoder({
      output: ad => {
        const b = new Float32Array(ad.numberOfFrames);
        ad.copyTo(b, { planeIndex: 0, format: "f32-planar" });
        pcm.push(b); ad.close();
      },
      error: e => { encErr = e; },
    });
    dec.configure(decCfg || { codec: "mp4a.40.2", sampleRate: SR, numberOfChannels: 2 });
    for (const c of chunks) dec.decode(c);
    await dec.flush(); dec.close();
    const all = new Float32Array(pcm.reduce((s, a) => s + a.length, 0));
    let o = 0; for (const a of pcm) { all.set(a, o); o += a.length; }
    let onset = -1;
    for (let i = 0; i < all.length; i++) if (Math.abs(all[i]) > 0.1) { onset = i; break; }
    MV.caps.aacDelay = onset >= 0 ? Math.max(0, onset - BURST) : 0;
  } catch (e) {
    console.warn("[MV] AAC遅延計測失敗(0扱い):", e.message);
    MV.caps.aacDelay = 0;
  }
  MV.log("aac priming delay =", MV.caps.aacDelay, "samples");
  return MV.caps.aacDelay;
};

/* ---- 素材音声の読み出し: [fromSec, fromSec+durSec] → 48kHzステレオ ---- */
/* 戻り値 {L, R}(長さ durSec*48000。取れなかった部分は無音のまま) */
MV.exporter.readClipAudio = async (clip, fromSec, durSec) => {
  const OUT_SR = MV.exporter.OUT_SR;
  const need = Math.ceil(durSec * OUT_SR);
  const L = new Float32Array(need), R = new Float32Array(need);
  const src = new MV.MP4Source(clip.file);
  await src.init();

  /* リニアPCM(ResolveのMOV等)は生読み */
  if (src.pcm) {
    const rsL = new MV.audio.LinearResampler(src.pcm.rate, OUT_SR);
    const rsR = new MV.audio.LinearResampler(src.pcm.rate, OUT_SR);
    let skipOut = null, outCount = 0;
    for await (const c of src.pcmChunks(Math.max(0, fromSec - 0.5))) {
      if (MV.exporter.cancelFlag) break;
      if (skipOut === null) {
        const firstSec = c.startFrame / src.pcm.rate;
        skipOut = Math.max(0, Math.round((fromSec - firstSec) * OUT_SR));
      }
      const chans = src.pcmToFloat(c.data, c.frames);
      const oL = rsL.push(chans[0]);
      const oR = rsR.push(chans.length > 1 ? chans[1] : chans[0]);
      for (let i = 0; i < oL.length; i++) {
        const pos = outCount + i;
        if (pos < skipOut) continue;
        const w = pos - skipOut;
        if (w >= need) break;
        L[w] = oL[i]; R[w] = oR[i];
      }
      outCount += oL.length;
      if (outCount - (skipOut || 0) >= need) break;
      await MV.yield();
    }
    return { L, R };
  }

  const at = src.audioTrack();
  if (!at) return { L, R };    // 音なし素材は無音
  const cfg = src.audioDecoderConfig();
  const sup = await AudioDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!sup.supported) return { L, R };

  const rsL = new MV.audio.LinearResampler(cfg.sampleRate, OUT_SR);
  const rsR = new MV.audio.LinearResampler(cfg.sampleRate, OUT_SR);
  const editOff = src.editOffsetSec(at);
  let error = null;
  let skipOut = null, outCount = 0, firstFedCts = null, wrote = 0;
  const decoder = new AudioDecoder({
    output: ad => {
      try {
        if (error || wrote >= need) return;
        const frames = ad.numberOfFrames, nch = ad.numberOfChannels;
        const buf = new Float32Array(frames);
        const cl = new Float32Array(frames), cr = new Float32Array(frames);
        for (let c = 0; c < Math.min(nch, 2); c++) {
          ad.copyTo(buf, { planeIndex: c, format: "f32-planar" });
          (c === 0 ? cl : cr).set(buf);
        }
        if (nch === 1) cr.set(cl);
        const oL = rsL.push(cl), oR = rsR.push(cr);
        for (let i = 0; i < oL.length; i++) {
          const pos = outCount + i;
          if (pos < skipOut) continue;
          const w = pos - skipOut;
          if (w >= need) break;
          L[w] = oL[i]; R[w] = oR[i];
          if (w >= wrote) wrote = w + 1;
        }
        outCount += oL.length;
      } finally { ad.close(); }
    },
    error: e => { error = e; },
  });
  decoder.configure(cfg);
  for await (const s of src.samples(at.id, Math.max(0, fromSec - 0.5))) {
    if (error || MV.exporter.cancelFlag) break;
    const ctsSec = s.cts / s.timescale;
    if (firstFedCts === null) {
      firstFedCts = ctsSec;
      skipOut = Math.max(0, Math.round((fromSec + editOff - firstFedCts) * OUT_SR));
    }
    decoder.decode(new EncodedAudioChunk({
      type: s.is_sync ? "key" : "delta",
      timestamp: Math.round(ctsSec * 1e6),
      duration: Math.max(1, Math.round(s.duration * 1e6 / s.timescale)),
      data: s.data,
    }));
    if (ctsSec - firstFedCts > (fromSec + editOff - firstFedCts) + durSec + 1) break;
    if (decoder.decodeQueueSize > 32) await MV.waitDequeue(decoder);
  }
  if (!error) await decoder.flush().catch(() => {});
  try { decoder.close(); } catch (e) {}
  return { L, R };
};

/* ---- ミックスバスの組み立て ---- */
/* 台形エンベロープで足し込む(クリック防止の縁フェード込み) */
MV.exporter.mixInto = (bus, part, atSample, gain, fadeInSec, fadeOutSec) => {
  const SR = MV.exporter.OUT_SR;
  const n = part.L.length;
  const fi = Math.max(1, Math.round((fadeInSec || 0.03) * SR));
  const fo = Math.max(1, Math.round((fadeOutSec || 0.03) * SR));
  for (let i = 0; i < n; i++) {
    const w = atSample + i;
    if (w < 0 || w >= bus.L.length) continue;
    let env = gain;
    if (i < fi) env *= i / fi;
    if (n - 1 - i < fo) env *= (n - 1 - i) / fo;
    bus.L[w] += part.L[i] * env;
    bus.R[w] += part.R[i] * env;
  }
};

MV.exporter.buildAudioBus = async onStatus => {
  const plan = MV.S.plan;
  const SR = MV.exporter.OUT_SR;
  const total = Math.ceil(plan.totalSec * SR);
  const bus = { L: new Float32Array(total), R: new Float32Array(total) };
  const segs = plan.segments;

  /* 1) 素材の音。区間は [t0, t1 + 次のtransIn](ディゾルブ中も前の音が残って
        クロスフェードになる)。フェードは transIn に合わせる */
  const jobs = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind !== "video" || !s.ambient || s.ambientGain <= 0) continue;
    const nextTrans = i + 1 < segs.length ? segs[i + 1].transIn : 0;
    const clip = MV.getClip(s.clipId);
    if (!clip) continue;
    let span = (s.t1 - s.t0) + nextTrans;
    /* 素材の音は素材の実長までしか無い(絵はhold-lastで伸びるが音は伸びない) */
    span = Math.min(span, Math.max(0, clip.duration - s.srcIn));
    if (span <= 0.05) continue;
    jobs.push({
      clip, fromSec: s.srcIn, durSec: span,
      atSample: Math.round(s.t0 * SR), gain: s.ambientGain,
      fadeIn: s.transIn > 0 ? s.transIn : 0.03,
      fadeOut: nextTrans > 0 ? nextTrans : 0.03,
    });
  }
  for (let i = 0; i < jobs.length; i++) {
    if (MV.exporter.cancelFlag) return bus;
    const j = jobs[i];
    onStatus(`音を集めています… ${i + 1}/${jobs.length}`);
    const part = await MV.exporter.readClipAudio(j.clip, j.fromSec, j.durSec);
    MV.exporter.mixInto(bus, part, j.atSample, j.gain, j.fadeIn, j.fadeOut);
    await MV.yield();
  }

  /* 2) BGM(ダッキングを掛けながら足し込む)。
        decodeAudioData は曲全体を48kHz Float32で展開する(5分の曲で約110MB)。
        3曲を同時に持つとそれだけで330MBになり、iPhoneでは完成MP4と合わせて
        上限を超える。曲ごとにデコード→書き込み→解放し、ピークを1曲分に抑える */
  if (plan.bgm.length) {
    onStatus("BGMを重ねています…");
    const byId = new Map();   // bgmId -> [entry...]
    for (const e of plan.bgm) {
      if (!byId.has(e.bgmId)) byId.set(e.bgmId, []);
      byId.get(e.bgmId).push(e);
    }
    for (const [bgmId, entries] of byId) {
      if (MV.exporter.cancelFlag) return bus;
      const bgm = MV.S.bgms.find(b => b.id === bgmId);
      if (!bgm) continue;
      const ab = await bgm.file.arrayBuffer();
      const dctx = new OfflineAudioContext(2, 2, SR);   // decodeAudioDataの48kHzリサンプルに使う
      const buf = await dctx.decodeAudioData(ab);
      const dL = buf.getChannelData(0);
      const dR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : dL;
      for (const entry of entries) {
        const t0s = Math.round(entry.t0 * SR);
        const n = Math.min(Math.round((entry.t1 - entry.t0) * SR), dL.length - Math.round(entry.srcIn * SR));
        const off = Math.round(entry.srcIn * SR);
        const fi = Math.max(1, Math.round(entry.fadeIn * SR));
        const fo = Math.max(1, Math.round(entry.fadeOut * SR));
        for (let i = 0; i < n; i++) {
          const w = t0s + i;
          if (w < 0 || w >= total) continue;
          const t = w / SR;
          let env = entry.gain * MV.preview.duckGain(plan, t);
          if (i < fi) env *= i / fi;
          if (n - 1 - i < fo) env *= (n - 1 - i) / fo;
          bus.L[w] += dL[off + i] * env;
          bus.R[w] += dR[off + i] * env;
        }
        await MV.yield();
      }
      // ループを次へ進めた時点で buf への参照が切れ、この曲のメモリが返る
    }
  }

  /* 3) クリップ防止の軽いリミッタ(足し込みで1.0を超えた分を丸める) */
  for (let i = 0; i < total; i++) {
    const l = bus.L[i], r = bus.R[i];
    if (l > 1) bus.L[i] = 1 - 1 / (1 + l); else if (l < -1) bus.L[i] = -1 + 1 / (1 - l);
    if (r > 1) bus.R[i] = 1 - 1 / (1 + r); else if (r < -1) bus.R[i] = -1 + 1 / (1 - r);
  }
  return bus;
};

/* ---- 書き出しモード ---- */
MV.exporter.mode = () => {
  if (MV.caps.h264 && MV.caps.aac) return "fast";
  if (MV.caps.recMime) return "realtime";
  return "none";
};

/* 使う素材が今も読めるか(30秒かけてから落ちるより先に分かった方がよい) */
MV.exporter.preflight = async () => {
  const plan = MV.S.plan;
  const ids = new Set();
  plan.segments.forEach(s => {
    if (s.clipId != null) ids.add(s.clipId);
    if (s.bRoll) ids.add(s.bRoll.clipId);
  });
  for (const id of ids) {
    const c = MV.getClip(id);
    if (!c || !c.file) continue;
    await c.file.slice(0, Math.min(16, c.file.size)).arrayBuffer();
  }
  MV.log(`preflight OK: ${ids.size}素材すべて読めます`);
};

/* ---- 高速経路 ---- */
MV.exporter.exportMP4 = async (onProgress, saveHandle) => {
  const plan = MV.S.plan;
  if (!plan) throw new Error("先に「Vlog自動編集」で組み立ててください");
  const { W, H } = { W: plan.W, H: plan.H };
  const fps = plan.fps;
  const totalFrames = Math.max(1, Math.round(plan.totalSec * fps));

  MV.exporter.cancelFlag = false;
  MV.exporter.running = true;
  const pipes = new Map();      // key(s0/b0...) -> {pipe, clipId, expect}
  let venc = null;
  /* 失敗・中断時は abort で破棄する。FS Access API は swap ファイル方式で、
     close() は部分データの「コミット」=壊れた書きかけMP4を実ファイルにして
     しまう。abort() なら何も書かれず、上書き対象だった既存ファイルも無傷 */
  let writable = null;
  const abortWritable = () => {
    if (!writable) return;
    const w = writable;
    writable = null;
    try { w.abort().catch(() => {}); } catch (_) {}
  };
  try {
    await MV.exporter.holdWake(true);   // 画面ロックでrAF/デコーダが止まるのを防ぐ
    await MV.exporter.preflight();

    /* 保存先が選ばれていればディスクへ直接書く(完成MP4をメモリに溜めない) */
    let target;
    if (saveHandle) {
      writable = await saveHandle.createWritable();
      target = new Mp4Muxer.FileSystemWritableFileStreamTarget(writable);
      MV.log("export: ファイルへ直接書き込みます(メモリに溜めません)");
    } else {
      target = new Mp4Muxer.ArrayBufferTarget();
    }
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: { codec: "avc", width: W, height: H },
      audio: { codec: "aac", sampleRate: MV.exporter.OUT_SR, numberOfChannels: 2 },
      fastStart: false,   // in-memoryは全チャンク保持で長尺が死ぬ(2026-07-20の教訓)
    });
    let vencErr = null;
    venc = new VideoEncoder({
      output: (chunk, meta) => {
        try { muxer.addVideoChunk(chunk, meta); } catch (err) { vencErr = vencErr || err; }
      },
      error: e => { vencErr = e; },
    });
    venc.configure({
      codec: "avc1.640028", width: W, height: H,
      bitrate: MV.exporter.videoBitrate(), framerate: fps,
    });

    const canvas = MV.exporter.makeCanvas(W, H);
    const ctx = canvas.getContext("2d");
    const segs = plan.segments;
    const t0Perf = performance.now();
    let tRecent = t0Perf, kRecent = 0;

    const ensurePipe = async (key, clip, fromSec) => {
      if (pipes.has(key)) return pipes.get(key);
      const pipe = new MV.exporter.VideoPipe(clip);
      await pipe.init(Math.max(0, fromSec));
      const rec = { pipe, clipId: clip.id };
      pipes.set(key, rec);
      return rec;
    };

    for (let k = 0; k < totalFrames; k++) {
      if (MV.exporter.cancelFlag) throw new Error("キャンセルしました");
      if (vencErr) throw vencErr;
      const t = k / fps;
      const i = MV.segIndexAt(plan, t);
      const seg = segs[i];

      /* このコマに要るパイプ(現行・ディゾルブの前・Bロール)を揃える */
      const wanted = new Map();   // key -> {clip, srcAt, srcSec}
      if (seg.kind === "video") {
        const clip = MV.getClip(seg.clipId);
        const inBR = seg.bRoll && t >= seg.bRoll.tA && t < seg.bRoll.tB;
        wanted.set(`s${i}`, {
          clip, srcAt: seg.srcIn,
          srcSec: inBR ? null : Math.min(seg.srcIn + (t - seg.t0), clip.duration - 0.001),
        });
        if (seg.bRoll && t >= seg.bRoll.tA - 0.2 && t < seg.bRoll.tB) {
          const bc = MV.getClip(seg.bRoll.clipId);
          wanted.set(`b${i}`, {
            clip: bc, srcAt: seg.bRoll.srcIn,
            srcSec: t >= seg.bRoll.tA
              ? Math.min(seg.bRoll.srcIn + (t - seg.bRoll.tA), bc.duration - 0.001) : null,
          });
        }
      }
      if (i > 0 && seg.transIn > 0 && t - seg.t0 < seg.transIn && segs[i - 1].kind === "video") {
        const prev = segs[i - 1];
        const pc = MV.getClip(prev.clipId);
        wanted.set(`s${i - 1}`, {
          clip: pc, srcAt: prev.srcIn,
          srcSec: Math.min(prev.srcIn + (t - prev.t0), pc.duration - 0.001),
        });
      }

      /* 不要になったパイプは即解放(同時最大3本を守る) */
      for (const [key, rec] of pipes) {
        if (!wanted.has(key)) { rec.pipe.dispose(); pipes.delete(key); }
      }

      /* フレームを取得し、素材IDと素材内秒で引けるようにする */
      const got = [];   // {clipId, srcSec, frame, rotation}
      for (const [key, w] of wanted) {
        const rec = await ensurePipe(key, w.clip, w.srcAt);
        if (w.srcSec == null) continue;    // 開いて待機だけ(Bロール直前/Bロール中の本体)
        const f = await rec.pipe.frameAt(w.srcSec);
        if (f) got.push({ clipId: w.clip.id, srcSec: w.srcSec, frame: f, rotation: rec.pipe.rotation });
      }

      MV.compose(ctx, W, H, t, req => {
        /* 同じ素材を2役で使う瞬間があるため、素材内秒の近さで選ぶ */
        let best = null, bd = Infinity;
        for (const g of got) {
          if (g.clipId !== req.clipId) continue;
          const d = Math.abs(g.srcSec - req.srcSec);
          if (d < bd) { bd = d; best = g; }
        }
        if (!best) return null;
        const f = best.frame;
        return {
          source: f,
          w: f.displayWidth || f.codedWidth, h: f.displayHeight || f.codedHeight,
          rotation: best.rotation,
        };
      });

      const vf = new VideoFrame(canvas, {
        timestamp: Math.round(k * 1e6 / fps), duration: Math.round(1e6 / fps),
      });
      venc.encode(vf, { keyFrame: k % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await MV.waitDequeue(venc);

      if (k % 10 === 0) {
        const now = performance.now();
        const perFrame = (k >= 60)
          ? (now - tRecent) / 1000 / Math.max(1, k - kRecent)
          : (now - t0Perf) / 1000 / (k + 1);
        const eta = perFrame * (totalFrames - k - 1);
        if (k - kRecent >= 60) { tRecent = now; kRecent = k; }
        onProgress((k + 1) / totalFrames * 0.80, `映像 ${k + 1}/${totalFrames} コマ`, { eta });
        await MV.yield();
      }
    }
    await venc.flush();
    if (vencErr) throw vencErr;

    /* 映像のデコーダを解放してから音へ(メモリの取り合いを避ける) */
    pipes.forEach(rec => rec.pipe.dispose());
    pipes.clear();

    /* ---- 音: ミックスバス → AAC ---- */
    const bus = await MV.exporter.buildAudioBus(s => onProgress(0.85, s));
    if (MV.exporter.cancelFlag) throw new Error("キャンセルしました");

    onProgress(0.93, "音を入れています…");
    const SR = MV.exporter.OUT_SR;
    const priming = await MV.exporter.measureAacDelay();
    let encErr = null;
    const aenc = new AudioEncoder({
      output: (chunk, meta) => {
        try { muxer.addAudioChunk(chunk, meta); } catch (err) { encErr = encErr || err; }
      },
      error: e => { encErr = e; },
    });
    aenc.configure({ codec: "mp4a.40.2", sampleRate: SR, numberOfChannels: 2, bitrate: 192000 });
    const FR = 1024;
    const totalS = bus.L.length;
    for (let o = 0; o < totalS; o += FR) {
      if (encErr || MV.exporter.cancelFlag) break;
      const n = Math.min(FR, totalS - o);
      const data = new Float32Array(n * 2);
      /* プライミングで先頭に入る無音のぶん、読み出しを先へずらして相殺する */
      for (let i = 0; i < n; i++) {
        const p = o + i + priming;
        data[i] = p < totalS ? bus.L[p] : 0;
        data[n + i] = p < totalS ? bus.R[p] : 0;
      }
      aenc.encode(new AudioData({
        format: "f32-planar", sampleRate: SR, numberOfFrames: n, numberOfChannels: 2,
        timestamp: Math.round(o * 1e6 / SR), data,
      }));
      if (aenc.encodeQueueSize > 16) await MV.waitDequeue(aenc);
    }
    if (!encErr) await aenc.flush().catch(() => {});
    try { aenc.close(); } catch (e) {}
    if (encErr) throw encErr;
    if (MV.exporter.cancelFlag) throw new Error("キャンセルしました");

    onProgress(0.97, "ファイルにまとめています…");
    muxer.finalize();
    if (writable) {
      await writable.close();   // ここで初めてディスク上のファイルが完成する
      writable = null;
      const name = saveHandle.name;
      MV.exporter.lastResult = { blob: null, name, saved: true };
      MV.log(`export done: ${name} frames=${totalFrames} (直接書き込み)`);
      return { name, saved: true, blob: null };
    }
    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const name = `MarchinZ_Vlog_${plan.aspect === "portrait" ? "縦" : "横"}_${new Date().toISOString().slice(0, 10)}.mp4`;
    MV.exporter.download(blob, name);
    MV.log(`export done: ${name} bytes=${blob.size} frames=${totalFrames}`);
    return { blob, name };
  } finally {
    pipes.forEach(rec => rec.pipe.dispose());
    if (venc) { try { venc.close(); } catch (e) {} }
    abortWritable();   // 成功時は既にnull。失敗時だけ書きかけを破棄する
    MV.exporter.holdWake(false);
    MV.exporter.running = false;
  }
};

/* ---- 実時間経路(プレビューを録る) ---- */
MV.exporter.exportRealtime = async onProgress => {
  const plan = MV.S.plan;
  if (!plan) throw new Error("先に「Vlog自動編集」で組み立ててください");
  MV.exporter.cancelFlag = false;
  MV.exporter.running = true;
  /* 実時間録画中に画面ロック・アプリ切替でタブが隠れると、rAFもMediaRecorderも
     止まり、壊れた短いMP4が「成功」として保存されてしまう。隠れた時点で
     中止し、理由を告げる(無言の壊れ物より、やり直せる失敗のほうがよい) */
  let hiddenAbort = false;
  const onVis = () => {
    if (document.hidden && MV.exporter.running) {
      hiddenAbort = true;
      MV.exporter.cancelFlag = true;
    }
  };
  document.addEventListener("visibilitychange", onVis);
  try {
    await MV.exporter.holdWake(true);   // そもそもロックさせないのが第一の防御
    const canvas = MV.preview.canvas;
    MV.preview.pause();
    MV.preview.seek(0);
    const tracks = [...canvas.captureStream(30).getVideoTracks()];
    tracks.push(...MV.preview.captureAudioStream().getAudioTracks());
    const mime = MV.caps.recMime || "video/webm";
    const mr = new MediaRecorder(new MediaStream(tracks), {
      mimeType: mime, videoBitsPerSecond: MV.exporter.videoBitrate(),
    });
    const chunks = [];
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => { mr.onstop = r; });
    mr.start(200);
    await MV.preview.play();
    await new Promise(res => {
      const iv = setInterval(() => {
        onProgress(MV.S.t / plan.totalSec,
          `録画中… ${MV.ui.fmtClock(MV.S.t)} / ${MV.ui.fmtClock(plan.totalSec)}（実時間）`);
        if (!MV.preview.playing || MV.exporter.cancelFlag) { clearInterval(iv); res(); }
      }, 200);
    });
    MV.preview.pause();
    mr.stop();
    await stopped;
    if (MV.exporter.cancelFlag) {
      throw new Error(hiddenAbort
        ? "画面が切り替わったため中止しました。実時間の書き出し中は、画面を点けたままこのタブを開いておいてください"
        : "キャンセルしました");
    }
    const isMp4 = mime.startsWith("video/mp4");
    const blob = new Blob(chunks, { type: isMp4 ? "video/mp4" : "video/webm" });
    const name = `MarchinZ_Vlog_${plan.aspect === "portrait" ? "縦" : "横"}_${new Date().toISOString().slice(0, 10)}.${isMp4 ? "mp4" : "webm"}`;
    MV.exporter.download(blob, name);
    return { blob, name };
  } finally {
    document.removeEventListener("visibilitychange", onVis);
    MV.exporter.holdWake(false);
    MV.exporter.running = false;
  }
};

/* ---- 保存(Switcher/ReAngle/Privacyと同じ流儀) ---- */
MV.exporter._shareMode = null;
MV.exporter.shareMode = () => {
  if (MV.exporter._shareMode != null) return MV.exporter._shareMode;
  let ok = false;
  try {
    const probe = new File([new Uint8Array(1)], "probe.mp4", { type: "video/mp4" });
    ok = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [probe] }));
  } catch (e) { ok = false; }
  return (MV.exporter._shareMode = ok);
};

MV.exporter.triggerDownload = (blob, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
};

MV.exporter.download = (blob, name) => {
  MV.exporter.lastResult = { blob, name, type: blob.type };
  if (MV.testMode) {   // 自動検証用: ローカルサーバへも保存
    fetch(`/save?name=${encodeURIComponent(name)}`, { method: "PUT", body: blob })
      .then(() => MV.log("test upload ok:", name))
      .catch(e => MV.log("test upload failed:", e.message));
  }
  if (MV.exporter.shareMode()) return;   // iOSは完了カードの「動画を保存」から共有
  MV.exporter.triggerDownload(blob, name);
};
