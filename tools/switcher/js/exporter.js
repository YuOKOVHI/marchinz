"use strict";
/* ============ 書き出し: WebCodecs → MP4 (H.264+AAC) / WebM fallback ============ */

MC.exporter = { cancelFlag: false, running: false };

MC.exporter.probeCaps = async () => {
  try {
    MC.caps.h264 = typeof VideoEncoder !== "undefined" && (await VideoEncoder.isConfigSupported({
      codec: "avc1.640028", width: 1080, height: 1920, bitrate: 12e6, framerate: 30,
    })).supported;
  } catch (e) { MC.caps.h264 = false; }
  try {
    MC.caps.aac = typeof AudioEncoder !== "undefined" && (await AudioEncoder.isConfigSupported({
      codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 192000,
    })).supported;
  } catch (e) { MC.caps.aac = false; }
  // リアルタイム録画(MediaRecorder)のフォーマット: Safariはmp4、Chromeはwebm
  MC.caps.recMime = null;
  if (typeof MediaRecorder !== "undefined") {
    for (const m of ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4",
                     "video/webm;codecs=vp9,opus", "video/webm"]) {
      try { if (MediaRecorder.isTypeSupported(m)) { MC.caps.recMime = m; break; } } catch (e) {}
    }
  }
  MC.log("caps:", JSON.stringify(MC.caps));
};

/* OffscreenCanvas非対応環境(旧Safari)は通常canvasで代替 */
MC.exporter.makeCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  return cv;
};

/* ---- 1カメラ分のデコードパイプ: frameAt(tLocal秒)がhold-last-frameでフレームを返す ---- */
MC.exporter.VideoPipe = class {
  constructor(clip) {
    this.clip = clip;
    this.frames = [];      // デコード済み(表示順)
    this.current = null;   // いま保持しているフレーム
    this.eof = false;
    this.flushed = false;
    this.error = null;
  }

  async init(fromLocalSec) {
    this.src = new MC.MP4Source(this.clip.file);
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

  /* tLocalSec時点のVideoFrame(hold-last-frame)。クリップ末尾以降は最後のフレームを保持
     tLocalSec は「クリップ先頭からの秒数」。frames[].timestamp は demux が
     s.cts から作るトラック内の絶対時刻なので、そのまま突き合わせる。
     以前は最初に届いたフレームの timestamp(=firstTs)を引いて相対化していたが、
     init(fromLocalSec) で途中から始めると firstTs がその地点になり、
     要求位置からさらに同じだけ先へ進もうとして破綻していた
     (トリム開始が 0 のときだけ偶然動く。自動トリム導入で表面化。2026-07-20) */
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
      if (this.frames.length) return this.current;                    // 次フレームはtより先=確定
      if (this.eof && this.flushed) return this.current;              // もう来ない=最後を保持
      await this.pump();
      if (this.error) throw this.error;
      if (!this.frames.length && !this.eof) {
        await MC.waitDequeue(this.decoder, 50);
      }
      // 前に進めている限りは打ち切らない(seekが効かず先頭から流す時に効く)
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

/* AACエンコーダのプライミング(先頭に挿入される無音)を実測する。
   出力MP4はこの分だけ音が遅れて聞こえるため、切り出し側で同量を余分にスキップして相殺する */
MC.exporter.measureAacDelay = async () => {
  if (MC.caps.aacDelay != null) return MC.caps.aacDelay;
  try {
    const SR = 48000, N = SR / 2, BURST = 12000;
    const sig = new Float32Array(N * 2);  // f32-planar 2ch
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
    MC.caps.aacDelay = onset >= 0 ? Math.max(0, onset - BURST) : 0;
  } catch (e) {
    console.warn("[MC] AAC遅延計測失敗(0扱い):", e.message);
    MC.caps.aacDelay = 0;
  }
  MC.log("aac priming delay =", MC.caps.aacDelay, "samples");
  return MC.caps.aacDelay;
};

/* ---- 音声: 選択クリップの範囲をデコード→48kHzステレオ→AAC ---- */
MC.exporter.encodeAudio = async (muxer, clip, fromLocalSec, durSec, onStatus) => {
  const src = new MC.MP4Source(clip.file);
  await src.init();
  if (src.pcm) return MC.exporter.encodeAudioPcm(muxer, src, fromLocalSec, durSec, onStatus);
  const at = src.audioTrack();
  if (!at) return false;
  const cfg = src.audioDecoderConfig();
  const sup = await AudioDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!sup.supported) return false;

  // デコードして範囲分の48kHzステレオPCMを貯める
  const OUT_SR = 48000;
  const need = Math.ceil(durSec * OUT_SR);
  const chL = new Float32Array(need), chR = new Float32Array(need);
  let error = null;
  const rsL = new MC.audio.LinearResampler(cfg.sampleRate, OUT_SR);
  const rsR = new MC.audio.LinearResampler(cfg.sampleRate, OUT_SR);
  /* 位置決め: 「最初に投入したチャンクのcts + 連続サンプル数」で数え、
     ソースのelst分 + 出力AACエンコーダのプライミング分を足してスキップする */
  const editOff = src.editOffsetSec(at);
  const primingSec = (await MC.exporter.measureAacDelay()) / 48000;
  let written = 0;          // 48kHz出力の書き込み位置
  let skipOut = null;       // fromLocalに相当する48kHz出力サンプル数(先頭スキップ)
  let outCount = 0;         // リサンプル出力の通し位置
  const decoder = new AudioDecoder({
    output: ad => {
      try {
        if (error || written >= need) { return; }
        const frames = ad.numberOfFrames, nch = ad.numberOfChannels;
        const buf = new Float32Array(frames);
        const L = new Float32Array(frames), R = new Float32Array(frames);
        for (let c = 0; c < Math.min(nch, 2); c++) {
          ad.copyTo(buf, { planeIndex: c, format: "f32-planar" });
          (c === 0 ? L : R).set(buf);
        }
        if (nch === 1) R.set(L);
        const oL = rsL.push(L), oR = rsR.push(R);
        for (let i = 0; i < oL.length; i++) {
          const pos = outCount + i;
          if (pos < skipOut) continue;
          const w = pos - skipOut;
          if (w >= need) break;
          chL[w] = oL[i]; chR[w] = oR[i];
          if (w >= written) written = w + 1;
        }
        outCount += oL.length;
      } finally { ad.close(); }
    },
    error: e => { error = e; },
  });
  decoder.configure(cfg);
  let firstFedCts = null;
  for await (const s of src.samples(at.id, Math.max(0, fromLocalSec - 0.5))) {
    if (error || MC.exporter.cancelFlag) break;
    const ctsSec = s.cts / s.timescale;
    if (firstFedCts === null) {
      firstFedCts = ctsSec;
      // 目標メディア時刻 = fromLocal + elst + エンコーダプライミング相殺
      skipOut = Math.max(0, Math.round((fromLocalSec + editOff + primingSec - firstFedCts) * OUT_SR));
    }
    decoder.decode(new EncodedAudioChunk({
      type: s.is_sync ? "key" : "delta",
      timestamp: Math.round(ctsSec * 1e6),
      duration: Math.max(1, Math.round(s.duration * 1e6 / s.timescale)),
      data: s.data,
    }));
    if (ctsSec - firstFedCts > (fromLocalSec + editOff - firstFedCts) + durSec + 1) break;
    if (decoder.decodeQueueSize > 32) await MC.waitDequeue(decoder);
  }
  if (!error) await decoder.flush().catch(() => {});
  try { decoder.close(); } catch (e) {}
  if (error || MC.exporter.cancelFlag) return false;

  // AACエンコード(1024フレームずつ)
  onStatus("音を入れています…");
  let encErr = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      try { muxer.addAudioChunk(chunk, meta); } catch (err) { encErr = encErr || err; }
    },
    error: e => { encErr = e; },
  });
  encoder.configure({ codec: "mp4a.40.2", sampleRate: OUT_SR, numberOfChannels: 2, bitrate: 192000 });
  const FR = 1024;
  for (let o = 0; o < need; o += FR) {
    if (encErr || MC.exporter.cancelFlag) break;
    const n = Math.min(FR, need - o);
    const data = new Float32Array(n * 2);
    data.set(chL.subarray(o, o + n), 0);
    data.set(chR.subarray(o, o + n), n);
    encoder.encode(new AudioData({
      format: "f32-planar", sampleRate: OUT_SR, numberOfFrames: n, numberOfChannels: 2,
      timestamp: Math.round(o * 1e6 / OUT_SR), data,
    }));
    if (encoder.encodeQueueSize > 16) await MC.waitDequeue(encoder);
  }
  if (!encErr) await encoder.flush().catch(() => {});
  try { encoder.close(); } catch (e) {}
  return !encErr && !MC.exporter.cancelFlag;
};

/* リニアPCM音声(Resolve等のMOV): デコーダを通さず範囲を生読みして48kHzステレオ→AAC */
MC.exporter.encodeAudioPcm = async (muxer, src, fromLocalSec, durSec, onStatus) => {
  const OUT_SR = 48000;
  const need = Math.ceil(durSec * OUT_SR);
  const chL = new Float32Array(need), chR = new Float32Array(need);
  const rsL = new MC.audio.LinearResampler(src.pcm.rate, OUT_SR);
  const rsR = new MC.audio.LinearResampler(src.pcm.rate, OUT_SR);
  const primingSec = (await MC.exporter.measureAacDelay()) / 48000;
  const from = Math.max(0, fromLocalSec + primingSec);
  let skipOut = null, outCount = 0, written = 0;
  for await (const c of src.pcmChunks(Math.max(0, from - 0.5))) {
    if (MC.exporter.cancelFlag) return false;
    if (skipOut === null) {
      const firstSec = c.startFrame / src.pcm.rate;
      skipOut = Math.max(0, Math.round((from - firstSec) * OUT_SR));
    }
    const chans = src.pcmToFloat(c.data, c.frames);
    const L = chans[0];
    const R = chans.length > 1 ? chans[1] : chans[0];
    const oL = rsL.push(L), oR = rsR.push(R);
    for (let i = 0; i < oL.length; i++) {
      const pos = outCount + i;
      if (pos < skipOut) continue;
      const w = pos - skipOut;
      if (w >= need) break;
      chL[w] = oL[i]; chR[w] = oR[i];
      if (w >= written) written = w + 1;
    }
    outCount += oL.length;
    if (outCount - (skipOut || 0) >= need) break;
    await MC.yield();
  }

  onStatus("音を入れています…");
  let encErr = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      try { muxer.addAudioChunk(chunk, meta); } catch (err) { encErr = encErr || err; }
    },
    error: e => { encErr = e; },
  });
  encoder.configure({ codec: "mp4a.40.2", sampleRate: OUT_SR, numberOfChannels: 2, bitrate: 192000 });
  const FR = 1024;
  for (let o = 0; o < need; o += FR) {
    if (encErr || MC.exporter.cancelFlag) break;
    const n = Math.min(FR, need - o);
    const data = new Float32Array(n * 2);
    data.set(chL.subarray(o, o + n), 0);
    data.set(chR.subarray(o, o + n), n);
    encoder.encode(new AudioData({
      format: "f32-planar", sampleRate: OUT_SR, numberOfFrames: n, numberOfChannels: 2,
      timestamp: Math.round(o * 1e6 / OUT_SR), data,
    }));
    if (encoder.encodeQueueSize > 16) await MC.waitDequeue(encoder);
  }
  if (!encErr) await encoder.flush().catch(() => {});
  try { encoder.close(); } catch (e) {}
  return !encErr && !MC.exporter.cancelFlag;
};

/* 音声ファイル(mp3/wav/m4a等の「音声のみ取り込み」): decodeAudioDataで48kHzへ→範囲を切ってAAC */
MC.exporter.encodeAudioFile = async (muxer, clip, fromLocalSec, durSec, onStatus) => {
  const OUT_SR = 48000;
  const ab = await clip.file.arrayBuffer();
  const dctx = new OfflineAudioContext(2, 2, OUT_SR);   // 48kHzへ自動リサンプル
  const buf = await dctx.decodeAudioData(ab);
  const primingSec = (await MC.exporter.measureAacDelay()) / 48000;
  const need = Math.ceil(durSec * OUT_SR);
  const off = Math.max(0, Math.round((fromLocalSec + primingSec) * OUT_SR));
  const chL = new Float32Array(need), chR = new Float32Array(need);
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  for (let i = 0; i < need; i++) {
    const p = off + i;
    if (p >= L.length) break;
    chL[i] = L[p]; chR[i] = R[p];
  }
  onStatus("音を入れています…");
  let encErr = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      try { muxer.addAudioChunk(chunk, meta); } catch (err) { encErr = encErr || err; }
    },
    error: e => { encErr = e; },
  });
  encoder.configure({ codec: "mp4a.40.2", sampleRate: OUT_SR, numberOfChannels: 2, bitrate: 192000 });
  const FR = 1024;
  for (let o = 0; o < need; o += FR) {
    if (encErr || MC.exporter.cancelFlag) break;
    const n = Math.min(FR, need - o);
    const data = new Float32Array(n * 2);
    data.set(chL.subarray(o, o + n), 0);
    data.set(chR.subarray(o, o + n), n);
    encoder.encode(new AudioData({
      format: "f32-planar", sampleRate: OUT_SR, numberOfFrames: n, numberOfChannels: 2,
      timestamp: Math.round(o * 1e6 / OUT_SR), data,
    }));
    if (encoder.encodeQueueSize > 16) await MC.waitDequeue(encoder);
  }
  if (!encErr) await encoder.flush().catch(() => {});
  try { encoder.close(); } catch (e) {}
  return !encErr && !MC.exporter.cancelFlag;
};

/* ---- MP4書き出し本体 ---- */
/* 書き出し前に、使う素材が今も読めるか確かめる。
   実素材テストで、解析は通ったのに書き出しの途中で
   NotReadableError になる事例が出た(2026-07-20)。
   30秒かけてから落ちるより、最初に分かった方がよい。 */
/* 書き出しの推定バイト数。保存方法の判断に使う。
   映像ビットレートは exportMP4 の venc.configure と揃えること */
MC.exporter.videoBitrate = () => (MC.S.preset === "1x1" ? 8e6 : 12e6);
MC.exporter.estimateBytes = () => {
  const [tIn, tOut] = MC.trimRange();
  const sec = Math.max(0, tOut - tIn);
  const audio = 192e3;                       // AAC 192kbps
  return sec * (MC.exporter.videoBitrate() + audio) / 8;
};

/* メモリ上で組み立てられる上限の目安。これを超える見込みなら
   保存先を選ばせてディスクへ直接書く(ダイアログは大きいときだけ) */
MC.exporter.MEM_LIMIT_BYTES = 700e6;

MC.exporter.preflightFiles = async clips => {
  for (const c of clips) {
    if (!c.file) continue;
    try {
      await MC.readSlice(c.file, 0, Math.min(16, c.file.size));
    } catch (err) {
      MC.log(`preflight NG: ${c.name}`);
      throw err;   // readSlice が日本語のメッセージに変換済み
    }
  }
  MC.log(`preflight OK: ${clips.length}本すべて読めます`);
};

MC.exporter.exportMP4 = async (onProgress, saveHandle) => {
  let writable = null;
  /* 失敗・中断時は abort で破棄する。FS Access API は swap ファイル方式で、
     close() は部分データの「コミット」= 壊れた書きかけMP4を実ファイルにして
     しまう。abort() なら何も書かれず、上書き対象だった既存ファイルも無傷 */
  const writableRef = () => {
    if (!writable) return;
    const w = writable;
    writable = null;
    try { w.abort().catch(() => {}); } catch (err) {}
  };
  const { w, h } = MC.PRESETS[MC.S.preset];
  const fps = 30;
  const [tIn, tOut] = MC.trimRange();
  const totalFrames = Math.max(1, Math.round((tOut - tIn) * fps));
  const used = MC.activeClips().filter(c => !c.isAudio);   // 音声のみは映像に出さない
  if (!used.length) throw new Error("表示するクリップがありません");
  const audioClip = MC.getClip(MC.S.audioClipId);
  const withAudio = MC.caps.aac && !!audioClip;

  MC.exporter.cancelFlag = false;
  MC.exporter.running = true;
  const pipes = new Map();
  let venc = null;
  try {
    /* 完成MP4をメモリに溜めない。16分半×12Mbpsで約1.5GBになり、
       ArrayBufferTarget では確保に失敗する(実素材テストで発生)。
       保存先が選ばれていればディスクへ直接書く */
    let target;
    if (saveHandle) {
      writable = await saveHandle.createWritable();
      target = new Mp4Muxer.FileSystemWritableFileStreamTarget(writable);
      MC.log("export: ファイルへ直接書き込みます(メモリに溜めません)");
    } else {
      target = new Mp4Muxer.ArrayBufferTarget();
      MC.log("export: メモリ上で組み立てます(長尺では失敗することがあります)");
    }
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: { codec: "avc", width: w, height: h },
      audio: withAudio ? { codec: "aac", sampleRate: 48000, numberOfChannels: 2 } : undefined,
      /* 'in-memory' は全チャンクをメモリに溜めて finalize で一括書き出しする
         指定で、977秒×12Mbps では約1.5GB を保持し続ける(RangeError の真因)。
         false なら mdat を先に書いて moov を末尾に置くため、ストリーム先へは
         チャンク到着のたびに流れ、メモリに残らない。moov が末尾でも
         ローカル再生・SNSアップロードには支障ない */
      fastStart: false,
    });
    let vencErr = null;
    venc = new VideoEncoder({
      /* addVideoChunk はコールバック内で走るため、投げると Uncaught になり
         muxer の内部状態が壊れて null.slice の連鎖になる(2026-07-20 に実測)。
         捕まえて vencErr に落とし、ループ側できれいに失敗させる */
      output: (chunk, meta) => {
        try { muxer.addVideoChunk(chunk, meta); } catch (err) { vencErr = vencErr || err; }
      },
      error: e => { vencErr = e; },
    });
    venc.configure({
      codec: "avc1.640028", width: w, height: h,
      bitrate: MC.exporter.videoBitrate(), framerate: fps,
    });

    // 素材が今も読めるかを先に確かめる(途中で落ちるより早く知らせる)

    await MC.exporter.preflightFiles(used.filter(c => !c.isImage));

    for (const c of used) {
      if (c.isImage) continue;   // 静止画はデコード不要(そのまま描く)
      const pipe = new MC.exporter.VideoPipe(c);
      await pipe.init(tIn - c.offset);
      pipes.set(c.id, pipe);
    }

    const canvas = MC.exporter.makeCanvas(w, h);
    const ctx = canvas.getContext("2d");
    const t0 = performance.now();
    let tRecent = t0, kRecent = 0;   // 残り時間は直近の速度で出す(序盤の助走に引きずられないため)

    /* どこが重いかを測る。推測で最適化しないための材料 */
    const prof = { decode: 0, draw: 0, encode: 0 };
    for (let k = 0; k < totalFrames; k++) {
      if (MC.exporter.cancelFlag) throw new Error("キャンセルしました");
      if (vencErr) throw vencErr;
      const t = tIn + k / fps;
      const srcMap = new Map();
      const _tDec = performance.now();
      for (const [id, pipe] of pipes) {
        const clip = pipe.clip;
        const local = t - clip.offset;
        if (local < -0.05 || local > clip.duration + 0.05) { srcMap.set(id, null); continue; }
        const f = await pipe.frameAt(Math.max(0, local));
        srcMap.set(id, f);
      }
      prof.decode += performance.now() - _tDec;
      const _tDraw = performance.now();
      MC.drawComposite(ctx, w, h, t, id => {
        const clip = MC.getClip(id);
        if (clip && clip.isImage) return { source: clip.img, w: clip.width, h: clip.height, rotation: 0 };
        const f = srcMap.get(id);
        if (!f) return null;
        const pipe = pipes.get(id);
        return { source: f, w: f.displayWidth || f.codedWidth, h: f.displayHeight || f.codedHeight, rotation: pipe.rotation };
      });
      prof.draw += performance.now() - _tDraw;
      const _tEnc = performance.now();
      const vf = new VideoFrame(canvas, {
        timestamp: Math.round(k * 1e6 / fps), duration: Math.round(1e6 / fps),
      });
      venc.encode(vf, { keyFrame: k % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await MC.waitDequeue(venc);
      prof.encode += performance.now() - _tEnc;
      if (k % 10 === 0) {
        const now = performance.now();
        /* 長尺ではデコーダの助走で序盤が遅い。全体平均だと残りを過大に出し
           続けてしまうので、直近60コマ分の速度で見積もる */
        const perFrame = (k >= 60)
          ? (now - tRecent) / 1000 / Math.max(1, k - kRecent)
          : (now - t0) / 1000 / (k + 1);
        const eta = perFrame * (totalFrames - k - 1);
        if (k - kRecent >= 60) { tRecent = now; kRecent = k; }
        onProgress((k + 1) / totalFrames * 0.90,
          `映像 ${k + 1}/${totalFrames} コマ`, { eta });
        await MC.yield();  // UI息継ぎ(非表示タブでも節流されない)
      }
    }
    await venc.flush();
    if (vencErr) throw vencErr;
    {
      const tot = (prof.decode + prof.draw + prof.encode) / 1000;
      const pc = v => tot > 0 ? Math.round(v / 10 / tot) : 0;   // v[ms] / tot[s] → %
      MC.log(`映像の内訳: 合計${tot.toFixed(0)}秒 / デコード${(prof.decode / 1000).toFixed(0)}秒(${pc(prof.decode)}%) `
        + `合成${(prof.draw / 1000).toFixed(0)}秒(${pc(prof.draw)}%) `
        + `エンコード${(prof.encode / 1000).toFixed(0)}秒(${pc(prof.encode)}%) `
        + `/ ${totalFrames}コマ ${w}x${h} ${(MC.exporter.videoBitrate() / 1e6).toFixed(0)}Mbps`);
    }

    /* 映像が終わったらデコーダを即解放する。音声エンコードは977秒分の
       Float32(数百MB)を確保するため、3本分のデコーダとフレームキューを
       抱えたままだとメモリの取り合いになる */
    pipes.forEach(pp => pp.dispose());
    pipes.clear();

    let audioOk = false;
    if (withAudio) {
      const enc = audioClip.isAudio ? MC.exporter.encodeAudioFile : MC.exporter.encodeAudio;
      audioOk = await enc(
        muxer, audioClip, tIn - audioClip.offset, tOut - tIn,
        s => onProgress(0.93, s));
      if (!audioOk && !MC.exporter.cancelFlag) MC.ui.toast("⚠ 音声を書き出せませんでした(映像のみ出力します)");
    }
    if (MC.exporter.cancelFlag) throw new Error("キャンセルしました");

    onProgress(0.97, "ファイルにまとめています…");
    muxer.finalize();
    const name = saveHandle
      ? saveHandle.name
      : `MarchinZ_Switcher_${MC.S.preset}_${new Date().toISOString().slice(0, 10)}.mp4`;

    if (writable) {
      await writable.close();     // ここで初めてディスク上のファイルが完成する
      writable = null;
      MC.log(`export done: ${name} frames=${totalFrames} audio=${audioOk} (直接書き込み)`);
      return { name, saved: true, blob: null, size: null };
    }
    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    MC.exporter.download(blob, name);
    MC.log(`export done: ${name} bytes=${blob.size} frames=${totalFrames} audio=${audioOk}`);
    return { blob, name };
  } finally {
    pipes.forEach(p => p.dispose());
    if (venc) { try { venc.close(); } catch (e) {} }
    // 途中で失敗したときも書きかけのハンドルは閉じる(閉じないとファイルが壊れたまま残る)
    if (typeof writableRef === "function") writableRef();
    MC.exporter.running = false;
  }
};

/* ---- リアルタイム録画fallback(Safariはmp4、Chromeはwebm) ---- */
MC.exporter.exportRealtime = async onProgress => {
  // プレビュー専用の重ね描き(カメラ名バッジ・範囲外の案内)は録画へ焼き込まない。
  // このcanvasをそのまま録るため、必ず finally で戻す
  MC.preview.overlayOn = false;
  try {
    return await MC.exporter._exportRealtimeInner(onProgress);
  } finally {
    MC.preview.overlayOn = true;
    MC.preview.draw();
  }
};

MC.exporter._exportRealtimeInner = async onProgress => {
  const canvas = MC.preview.canvas;
  const [tIn, tOut] = MC.trimRange();
  MC.preview.seek(tIn);
  const tracks = [...canvas.captureStream(30).getVideoTracks()];
  const aClip = MC.getClip(MC.S.audioClipId);
  if (aClip) {
    const actx = MC.exporter._actx || (MC.exporter._actx = new AudioContext());
    if (!aClip.sourceNode) {
      aClip.sourceNode = actx.createMediaElementSource(aClip.video);
      aClip.sourceNode.connect(actx.destination);  // 以後もスピーカーへ流す
    }
    const dest = actx.createMediaStreamDestination();
    aClip.sourceNode.connect(dest);
    tracks.push(...dest.stream.getAudioTracks());
  }
  const mime = MC.caps.recMime || "video/webm";
  const mr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 10e6 });
  const chunks = [];
  mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { mr.onstop = r; });
  mr.start(200);
  await MC.preview.play();
  // trimOut到達(preview側で自動pause)まで待つ
  await new Promise(res => {
    const iv = setInterval(() => {
      onProgress((MC.S.t - tIn) / (tOut - tIn), `録画中… ${MC.ui.fmtTime(MC.S.t - tIn)} / ${MC.ui.fmtTime(tOut - tIn)}(実時間)`);
      if (!MC.S.playing || MC.exporter.cancelFlag) { clearInterval(iv); res(); }
    }, 200);
  });
  MC.preview.pause();
  mr.stop();
  await stopped;
  if (MC.exporter.cancelFlag) throw new Error("キャンセルしました");
  const isMp4 = mime.startsWith("video/mp4");
  const blob = new Blob(chunks, { type: isMp4 ? "video/mp4" : "video/webm" });
  const name = `MarchinZ_Switcher_${MC.S.preset}_${new Date().toISOString().slice(0, 10)}.${isMp4 ? "mp4" : "webm"}`;
  MC.exporter.download(blob, name);
  return { blob, name };
};

/* iOS SafariはWeb Share(files)でカメラロール/ファイルへ保存できる。
   共有はユーザー操作(タップ)内でしか呼べないため、iOSでは自動保存せず
   完了カードの「動画を保存」タップから MC.ui.saveResult() が共有する。
   (ReAngle/Privacyと同じ保存フロー) */
MC.exporter.lastResult = null;
MC.exporter._shareMode = null;
MC.exporter.shareMode = () => {
  if (MC.exporter._shareMode != null) return MC.exporter._shareMode;
  let ok = false;
  try {
    const probe = new File([new Uint8Array(1)], "probe.mp4", { type: "video/mp4" });
    ok = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [probe] }));
  } catch (e) { ok = false; }
  return (MC.exporter._shareMode = ok);
};

/* <a download> による保存(デスクトップ/Android)。iOS Safariでは無視されるので使わない */
MC.exporter.triggerDownload = (blob, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
};

MC.exporter.download = (blob, name) => {
  MC.exporter.lastResult = { blob, name, type: blob.type };
  if (MC.testMode) {  // 自動検証用: ローカルサーバへも保存
    fetch(`/save?name=${encodeURIComponent(name)}`, { method: "PUT", body: blob })
      .then(() => MC.log("test upload ok:", name))
      .catch(e => MC.log("test upload failed:", e.message));
  }
  if (MC.exporter.shareMode()) return;  // iOSは完了カードの「動画を保存」から共有
  MC.exporter.triggerDownload(blob, name);
};
