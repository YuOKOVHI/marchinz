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

/* 出番のないカメラを飛ばす下限(秒)。これ以上先へ跳ぶ要求だけ再シークする。
   続行コスト ≈ 空白秒×fps枚のデコード、飛びコスト ≈ flush+RAPからの
   GOP再デコード(1〜2秒分)+読み直し。損益分岐は1.5〜2秒だが、再シークは
   回数が少ないほど安全なので4秒に置く(カットが3〜8秒で回るスイッチングでは
   「2カット以上出番が無いときだけ飛ぶ」相当)。
   Infinity にすると従来どおり全部デコード(殺しスイッチ) */
MC.exporter.SKIP_MIN = 4.0;

/* ---- 1カメラ分のデコードパイプ: frameAt(tLocal秒)がhold-last-frameでフレームを返す ---- */
MC.exporter.VideoPipe = class {
  constructor(clip) {
    this.clip = clip;
    this.frames = [];      // デコード済み(表示順)
    this.current = null;   // いま保持しているフレーム
    this.eof = false;
    this.flushed = false;
    this.error = null;
    this.lastReqUs = null; // 直前に要求された時刻(前方ジャンプ検知用)
    this.noSkip = false;   // 再シークに失敗したパイプは以後直列デコードへ
    this.prof = null;      // exportMP4 が挿す(skips/reseekMs)
  }

  async init(fromLocalSec) {
    this.src = new MZ_MP4.MP4Source(this.clip.file);
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
    this.cursor = this.src.cursor(vt.id);
    this.cursor.seek(Math.max(0, fromLocalSec));
  }

  async pump() {
    /* 保持するフレーム数は iOS だけ半分にする(2026-07-20 検討メモ 項目5)。
       VideoFrame は iOS では IOSurface(GPUメモリ)を掴むため、1080p×3カメラ×8枚で
       数十MBになる。**iOS実機での速度影響は未検証**。詰まって遅くなるようなら
       この係数(6/4)を戻す。デスクトップの水位(12/8)は変えない */
    while (!this.eof && this.decoder.decodeQueueSize < (MC.isIOS ? 6 : 12) &&
           this.frames.length < (MC.isIOS ? 4 : 8)) {
      const { value: s, done } = await this.cursor.next();
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

  /* 出番が無かった区間を飛ばして tLocalSec の直前RAPから読み直す。
     this.current は閉じない(seek失敗・EOFクランプ時の hold-last-frame 保険) */
  async skipTo(tLocalSec) {
    const t0 = performance.now();
    try {
      await this.decoder.flush().catch(() => {});
      this.frames.forEach(f => { try { f.close(); } catch (e) {} });
      this.frames = [];
      // 末尾ぎりぎりへ飛ぶと RAP 以降にフレームが無く黒コマ化するためクランプ
      const target = Math.min(tLocalSec, Math.max(0, this.clip.duration - 0.3));
      this.cursor.seek(target);
      this.eof = false;
      this.flushed = false;
      if (this.prof) { this.prof.skips++; this.prof.reseekMs += performance.now() - t0; }
    } catch (err) {
      // 再シークできない素材は、このパイプだけ従来の直列デコードで続行
      MC.log("skipTo失敗→このカメラは直列デコード:", this.clip.name, err && err.message);
      this.noSkip = true;
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
    /* 前回の要求からSKIP_MIN秒より先へ跳んでいる=その間このカメラは
       出番が無かった。間のフレームをデコードせず直前RAPへ飛ぶ(2026-07-22) */
    if (!this.noSkip && this.lastReqUs != null &&
        tUs - this.lastReqUs > MC.exporter.SKIP_MIN * 1e6) {
      await this.skipTo(tLocalSec);
    }
    this.lastReqUs = tUs;
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
    if (this.cursor && this.cursor.stop) this.cursor.stop();   // mp4boxの抽出も止める
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
  const src = new MZ_MP4.MP4Source(clip.file);
  await src.init();
  if (src.pcm) return MC.exporter.encodeAudioPcm(muxer, src, fromLocalSec, durSec, onStatus);
  const at = src.audioTrack();
  if (!at) return false;
  const cfg = src.audioDecoderConfig();
  const sup = await AudioDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!sup.supported) return false;

  /* デコードしながら、1024フレーム窓が埋まるたびに即AACへ流す
     (2026-07-23 Phase 1 項目4)。以前は全長のPCMを貯めてから
     エンコードしており、8分30秒で約196MBを保持していた */
  const OUT_SR = 48000;
  const FR = 1024;
  const need = Math.ceil(durSec * OUT_SR);
  let error = null;
  const rsL = new MC.audio.LinearResampler(cfg.sampleRate, OUT_SR);
  const rsR = new MC.audio.LinearResampler(cfg.sampleRate, OUT_SR);
  /* 位置決め: 「最初に投入したチャンクのcts + 連続サンプル数」で数え、
     ソースのelst分 + 出力AACエンコーダのプライミング分を足してスキップする */
  const editOff = src.editOffsetSec(at);
  const primingSec = (await MC.exporter.measureAacDelay()) / 48000;
  let skipOut = null;       // fromLocalに相当する48kHz出力サンプル数(先頭スキップ)
  let outCount = 0;         // リサンプル出力の通し位置

  let encErr = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      try { muxer.addAudioChunk(chunk, meta); } catch (err) { encErr = encErr || err; }
    },
    error: e => { encErr = e; },
  });
  encoder.configure({ codec: "mp4a.40.2", sampleRate: OUT_SR, numberOfChannels: 2, bitrate: 192000 });

  /* f32-planar 1窓ぶんの作業領域: [L×FR][R×FR] */
  const pend = new Float32Array(FR * 2);
  let pendN = 0, emitted = 0;
  /* デコーダのコールバックは同期なので await できない。
     encode() 自体は同期に積めるため、背圧は下の投入ループ側で見る */
  const emitWindow = () => {
    if (!pendN || encErr) { pendN = 0; return; }
    const n = pendN;
    const data = new Float32Array(n * 2);
    data.set(pend.subarray(0, n), 0);
    data.set(pend.subarray(FR, FR + n), n);
    encoder.encode(new AudioData({
      format: "f32-planar", sampleRate: OUT_SR, numberOfFrames: n, numberOfChannels: 2,
      timestamp: Math.round(emitted * 1e6 / OUT_SR), data,
    }));
    emitted += n;
    pendN = 0;
  };

  const decoder = new AudioDecoder({
    output: ad => {
      try {
        if (error || encErr || emitted + pendN >= need) { return; }
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
          if (emitted + pendN >= need) break;
          pend[pendN] = oL[i];
          pend[FR + pendN] = oR[i];
          pendN++;
          if (pendN === FR) emitWindow();
        }
        outCount += oL.length;
      } finally { ad.close(); }
    },
    error: e => { error = e; },
  });
  decoder.configure(cfg);
  let firstFedCts = null;
  let fed = 0;
  for await (const s of src.samples(at.id, Math.max(0, fromLocalSec - 0.5))) {
    if (error || MC.exporter.cancelFlag) break;
    const ctsSec = s.cts / s.timescale;
    if ((fed++ & 63) === 0 && firstFedCts !== null) {
      onStatus("音を整えています…", 0.6 * Math.min(1, (ctsSec - firstFedCts) / Math.max(1, durSec)));
    }
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
    if (encoder.encodeQueueSize > 32) await MC.waitDequeue(encoder);
  }
  if (!error) await decoder.flush().catch(() => {});
  try { decoder.close(); } catch (e) {}
  if (error || MC.exporter.cancelFlag) { try { encoder.close(); } catch (e) {} return false; }

  onStatus("音を入れています…", 0.9);
  emitWindow();                     // 端数を出す
  /* 素材が書き出し範囲より短いときは無音で埋めて尺を合わせる
     (以前は「全長ゼロ配列」がこの役目を兼ねていた) */
  while (emitted < need && !encErr && !MC.exporter.cancelFlag) {
    const n = Math.min(FR, need - emitted);
    pend.fill(0, 0, n);
    pend.fill(0, FR, FR + n);
    pendN = n;
    emitWindow();
    if (encoder.encodeQueueSize > 32) await MC.waitDequeue(encoder);
  }
  if (!encErr) await encoder.flush().catch(() => {});
  try { encoder.close(); } catch (e) {}
  return !encErr && !MC.exporter.cancelFlag;
};

/* リニアPCM音声(Resolve等のMOV): デコーダを通さず範囲を生読みして48kHzステレオ→AAC */
/* 実素材(LPCM等)の音声を AAC へ。
   **読みながら1024フレームずつ即エンコードする**(2026-07-23 Phase 1 項目4)。
   以前は全長を Float32Array で確保しており、8分30秒で約196MB を保持していた。
   映像を OPFS へ逃がしてもここが残るとメモリ削減が中途半端になる。
   窓ぶん(1024×2ch=8KB)だけ持てば足りる。 */
MC.exporter.encodeAudioPcm = async (muxer, src, fromLocalSec, durSec, onStatus) => {
  const OUT_SR = 48000;
  const FR = 1024;
  const need = Math.ceil(durSec * OUT_SR);
  const rsL = new MC.audio.LinearResampler(src.pcm.rate, OUT_SR);
  const rsR = new MC.audio.LinearResampler(src.pcm.rate, OUT_SR);
  const primingSec = (await MC.exporter.measureAacDelay()) / 48000;
  const from = Math.max(0, fromLocalSec + primingSec);

  onStatus("音を入れています…");
  let encErr = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      try { muxer.addAudioChunk(chunk, meta); } catch (err) { encErr = encErr || err; }
    },
    error: e => { encErr = e; },
  });
  encoder.configure({ codec: "mp4a.40.2", sampleRate: OUT_SR, numberOfChannels: 2, bitrate: 192000 });

  /* f32-planar 1窓ぶんの作業領域: [L×FR][R×FR] */
  const pend = new Float32Array(FR * 2);
  let pendN = 0, emitted = 0;

  const flushWindow = async () => {
    if (!pendN || encErr) { pendN = 0; return; }
    const n = pendN;
    const data = new Float32Array(n * 2);
    data.set(pend.subarray(0, n), 0);
    data.set(pend.subarray(FR, FR + n), n);
    encoder.encode(new AudioData({
      format: "f32-planar", sampleRate: OUT_SR, numberOfFrames: n, numberOfChannels: 2,
      timestamp: Math.round(emitted * 1e6 / OUT_SR), data,
    }));
    emitted += n;
    pendN = 0;
    if (encoder.encodeQueueSize > 16) await MC.waitDequeue(encoder);
  };

  let skipOut = null, outCount = 0, done = false;
  for await (const c of src.pcmChunks(Math.max(0, from - 0.5))) {
    if (MC.exporter.cancelFlag || encErr) { done = true; break; }
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
      if (emitted + pendN >= need) { done = true; break; }
      pend[pendN] = oL[i];
      pend[FR + pendN] = oR[i];
      pendN++;
      if (pendN === FR) await flushWindow();
    }
    outCount += oL.length;
    if (done) break;
    await MC.yield();
  }
  await flushWindow();

  /* 素材が書き出し範囲より短いときは無音で埋めて尺を合わせる。
     以前は「全長ゼロ配列」がこの役目を兼ねていた */
  while (emitted < need && !encErr && !MC.exporter.cancelFlag) {
    const n = Math.min(FR, need - emitted);
    pend.fill(0, 0, n);
    pend.fill(0, FR, FR + n);
    pendN = n;
    await flushWindow();
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
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  /* デコード済みバッファから直接窓を切り出す。全長のコピーは作らない
     (2026-07-23 Phase 1 項目4。encodeAudioPcm と同じ理由) */
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
    for (let i = 0; i < n; i++) {
      const p = off + o + i;
      data[i] = p < L.length ? L[p] : 0;
      data[n + i] = p < R.length ? R[p] : 0;
    }
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
/* ---------- 画質モード(2026-07-23 優さん指示) ----------
   sns: 720p。iPhoneの画質を縛るのは解像度ではなくメモリ260MB(→3.88Mbps固定)。
        720pなら同じビットレートで1画素あたり2.25倍=実質きれいで、22%速い(実測)。
        SNS(Instagram/TikTok/X)は先方で再圧縮されるので720pで十分
   hd:  1080p。YouTubeへ上げる人向け。時間がかかる(パソコン推奨)
   pro: 1080p高ビットレート。ディスクへ直接書けるパソコン限定
        (スマホはメモリ上限があり高ビットレートは尺が入らない) */
/* 書き出しの画質は2択(2026-07-23 優さん指示)。
   端末で分けない: OPFSでメモリ制約が消えたので、iPhoneでもフルHD 12Mbpsを出す */
MC.exporter.QUALITIES = {
  full:  { label: "リッチモード", scale: 1 },      // 1080p / 12Mbps(高画質・時間かかる)
  light: { label: "ライトモード", scale: 2 / 3 },  // 720p / 8Mbps(速度重視・既定)
};
/* 旧IDからの移行(sns=720p→light / hd,pro=1080p→full) */
MC.exporter.QUALITY_ALIAS = { sns: "light", hd: "full", pro: "full" };

MC.exporter.isPC = () =>
  !MC.isIOS && !/Android/i.test(navigator.userAgent);

MC.exporter.quality = () => {
  /* 既定はライト(720p/8Mbps)。多くの人はSNSへ出すので、速く軽い方を初期値にする。
     きれいに残したい人はフルHDへ1タップで切り替えられる(2026-07-23 優さん指示) */
  let q = MC.S.exportQuality || "light";
  q = MC.exporter.QUALITY_ALIAS[q] || q;              // 旧IDの保存値を寄せる
  return MC.exporter.QUALITIES[q] ? q : "light";
};

/* 書き出しの出力サイズ。プレビューはプリセットのまま、出力だけ変える */
MC.exporter.exportDims = () => {
  const { w, h } = MC.PRESETS[MC.S.preset];
  const s = MC.exporter.QUALITIES[MC.exporter.quality()].scale;
  const even = x => Math.round(x * s / 2) * 2;
  return { w: even(w / 1), h: even(h / 1) };
};

MC.exporter.videoBitrate = () => {
  const q = MC.exporter.quality();
  const sq = MC.S.preset === "1x1";
  /* メモリに溜めずに書ける環境(ディスク直書き or OPFS)なら、端末で差をつけない。
     iPhoneを3.8Mbpsに落としていたのは「完成MP4を丸ごとメモリに載せる」制約の
     ためであって、その制約は Phase 1 で消えた(2026-07-23 優さん指示で12Mbpsへ) */
  if (MC.exporter.streamingOut()) {
    return q === "light" ? (sq ? 6e6 : 8e6) : (sq ? 8e6 : 12e6);
  }
  /* 旧経路(OPFSもディスク直書きも使えない端末)だけは、メモリ上限に
     8分30秒を収めるため3.8Mbpsに留める */
  if (MC.isIOS) return 3.8e6;
  return q === "light" ? (sq ? 6e6 : 8e6) : (sq ? 8e6 : 12e6);
};

/** 完成MP4をメモリに溜めずに書ける環境か(ディスク直書き or OPFS) */
MC.exporter.streamingOut = () =>
  !!window.showSaveFilePicker || MC.exporter.opfsSupported();

/* この端末で書き出せる最大の秒数。案内と自動調整の両方で使う */
/* ============ OPFS への逐次書き出し(Phase 1 / 2026-07-23) ============
   iOS には showSaveFilePicker が無いため、これまでは完成MP4をメモリ上の
   ArrayBuffer に丸ごと積んでいた。これが 8分41秒 の上限(MEM_HARD_LIMIT)の正体。

   OPFS(ブラウザ内のプライベート領域)なら iOS Safari でもファイルへ逐次書ける。
   muxer 側は既に FileSystemWritableFileStreamTarget + fastStart:false で
   ストリーム対応済みなので、writable を差し替えるだけで尺に比例したメモリ消費が消える。

   ・書き出し中: メモリではなく OPFS のファイルへ流れる
   ・完成後:     handle.getFile() で File を得る(JSヒープに全読みしない)
   ・後始末:     保存/破棄の後に削除。前回の書きかけは起動時に掃除する

   殺しスイッチ: MC.exporter.FORCE_LEGACY = true でメモリ方式へ即時復帰 */
MC.exporter.FORCE_LEGACY = false;
MC.exporter.OPFS_DIR = "mz-export";

/* OPFSへ実際に書けるか(G-1 / 2026-07-23)。
   以前は「getDirectoryとWorkerがある」だけの見込みでtrueを返していたが、
   iOS Safariの createSyncAccessHandle が使えない端末で maxExportableSec が
   Infinity(上限なし)を案内し、書き出しで断る矛盾が出た(E-1の再来)。
   起動時に probeOpfs() が本当に書けるか一度だけ実測し、その事実をキャッシュ。
   probe未了の間は「入口の有無」で暫定判定(probeが即後に上書きする) */
MC.exporter._opfsProbed = null;   // null=未実測 / true / false
MC.exporter.opfsSupported = () => {
  if (MC.exporter.FORCE_LEGACY) return false;
  if (MC.exporter._opfsProbed !== null) return MC.exporter._opfsProbed;
  try {
    return !!(navigator.storage && navigator.storage.getDirectory &&
      typeof Worker !== "undefined");
  } catch (e) { return false; }
};

/** OPFSへ実際に書けるかをWorkerで一度だけ確かめ、結果をキャッシュする。
    起動時(app.js)に呼ぶ。以後 opfsSupported() はこの事実を返す */
MC.exporter._opfsProbeErr = null;   // 直近の実測失敗の理由(診断表示用)
MC.exporter.probeOpfs = async force => {
  if (MC.exporter._opfsProbed === true) return true;
  if (MC.exporter._opfsProbed === false && !force) return false;
  if (force && MC.exporter._writer) {
    /* 敗者復活(2026-07-24): 起動時の一時的な失敗でfalseが永久キャッシュされ、
       iPhoneがずっとメモリ方式(4分上限)に落ちていた。workerごと作り直して再実測 */
    try { MC.exporter._writer.terminate(); } catch (_) {}
    MC.exporter._writer = null;
    MC.exporter._writerP = null;
  }
  let ok = false;
  const name = "__probe_" + Date.now() + ".mp4";   // 固定名だと前回の残骸と衝突しうる
  try {
    if (navigator.storage && navigator.storage.getDirectory && typeof Worker !== "undefined") {
      await MC.exporter.initWriter();
      await MC.exporter._writerReq({ type: "open", dir: MC.exporter.OPFS_DIR, name });
      const b = new Uint8Array([77, 90]);
      await MC.exporter._writerReq({ type: "write", data: b.buffer, position: 0 }, [b.buffer]);
      await MC.exporter._writerReq({ type: "finalize" });
      ok = true;
      MC.exporter._opfsProbeErr = null;
      MC.exporter.opfsRemove(name);   // 後始末(非同期でよい)
    } else {
      MC.exporter._opfsProbeErr = "storage.getDirectoryまたはWorkerが無い";
    }
  } catch (e) {
    MC.exporter._opfsProbeErr =
      (e && e.name ? e.name + ": " : "") + String((e && e.message) || e);
    MC.log("OPFS実測NG→この端末はメモリ方式: " + MC.exporter._opfsProbeErr);
    ok = false;
  }
  MC.exporter._opfsProbed = ok;
  return ok;
};

/* 画面が隠れていた時間を数えないタイムアウト(2026-07-24 優さん実機報告)は
   tools/shared/session.js へ移した。4本すべてが同じ守りを使う。 */

/* ---- 書き込みワーカー(js/exportwriter.js)の起動と1往復のやりとり ---- */
MC.exporter._writer = null;
MC.exporter._writerBusy = false;
MC.exporter.initWriter = () => {
  if (MC.exporter._writer) return Promise.resolve(MC.exporter._writer);
  if (MC.exporter._writerP) return MC.exporter._writerP;
  MC.exporter._writerP = new Promise((res, rej) => {
    let w;
    try { w = new Worker("js/exportwriter.js?v=" + (document.documentElement.getAttribute("data-mz-app-v") || "1")); }
    catch (e) { rej(e); return; }
    /* worker からの ready 通知を待ってから使い始める(2026-07-24)。
       以前は即resolveしており、workerの読み込みに失敗すると次の open が
       永遠に待つ穴があった */
    const cancelTm = MZ_SESSION.patientTimeout(() => { try { w.terminate(); } catch (_) {} rej(new Error("writer worker起動タイムアウト")); }, 8000);
    w.onerror = ev => {
      cancelTm();
      try { w.terminate(); } catch (_) {}
      rej(new Error("writer workerを起動できません" + (ev && ev.message ? ": " + ev.message : "")));
    };
    const onReady = ev => {
      if (!ev.data || ev.data.type !== "ready") return;
      cancelTm();
      w.removeEventListener("message", onReady);
      w.onerror = null;
      MC.exporter._writer = w;
      res(w);
    };
    w.addEventListener("message", onReady);
  }).catch(e => { MC.exporter._writerP = null; throw e; });
  return MC.exporter._writerP;
};

/** worker と1往復。応答待ちは1件ずつ(sync handle は直列書き込み)。
    応答が返らない事故で永遠に待たないようタイムアウト付き(2026-07-24) */
MC.exporter._writerReq = (msg, transfer, timeoutMs = 12000) => new Promise((res, rej) => {
  const w = MC.exporter._writer;
  if (!w) { rej(new Error("writer未初期化")); return; }
  const cancelTm = MZ_SESSION.patientTimeout(() => {
    w.removeEventListener("message", onMsg);
    rej(new Error((msg && msg.type) + ": workerの応答がありません"));
  }, timeoutMs);
  const onMsg = ev => {
    const m = ev.data || {};
    if (m.type === "ready") return;   // 起動通知はここでは無視
    cancelTm();
    w.removeEventListener("message", onMsg);
    if (m.type === "error") rej(new Error(m.op + ": " + m.message));
    else res(m);
  };
  w.addEventListener("message", onMsg);
  w.postMessage(msg, transfer || []);
});

/** 書き出し用の OPFS ファイルを用意する。失敗したら null(=メモリ方式へ)。
    書き込みは Worker(createSyncAccessHandle)で行うため、Worker を起こして open する。
    返り値の target を muxer に渡す(StreamTarget: onData→worker write)。 */
MC.exporter.opfsCreate = async name => {
  if (!MC.exporter.opfsSupported()) return null;
  try {
    await MC.exporter.initWriter();
    await MC.exporter._writerReq({ type: "open", dir: MC.exporter.OPFS_DIR, name });
    /* StreamTarget: muxer がチャンクを吐くたび onData(data, position)。
       data は muxer 内部バッファなので、transfer せずコピー(slice)して送る
       (transferすると muxer 側が壊れる可能性)。position は任意位置書き込み対応 */
    const target = new Mp4Muxer.StreamTarget({
      onData: (data, position) => {
        const copy = data.slice();
        /* 背圧の注記(G-3レビュー): onDataは同期で積まれ、実書き込みは直列。
           チャンクは16MB単位(下のchunkSize)なので同時未完了は実測1〜数個で収まる。
           16MB×数個ぶんのコピーが一時的にメモリに乗るが尺には比例しない */
        MC.exporter._pendWrites = (MC.exporter._pendWrites || Promise.resolve())
          .then(() => MC.exporter._writerReq(
            { type: "write", data: copy.buffer, position }, [copy.buffer], 30000));   // 16MB書きに遅い端末の余裕
        MC.exporter._pendWrites.catch(() => {});   // 本エラーは finalize/await で受ける
      },
      chunked: true,
      chunkSize: 16 * 1024 * 1024,   // 明示(G-2)。ライブラリ既定に依存しない
    });
    MC.exporter._pendWrites = Promise.resolve();
    return { name, target, viaWorker: true };
  } catch (err) {
    MC.log("OPFS 準備に失敗(メモリ方式へ): " + err.message);
    return null;
  }
};

/** worker 書き込みの完了を待ち、ファイルを確定して File を取り出す(読み取りはメインでOK) */
MC.exporter.opfsFinalizeWorker = async name => {
  await (MC.exporter._pendWrites || Promise.resolve());   // 積んだ write を全部流し切る
  /* finalize(flush+close)は500MB級だと遅い端末で12秒を超えうる。
     数分書き出した後の最後の一瞬で殺さないよう、ここだけ大きく取る(レビュー指摘) */
  await MC.exporter._writerReq({ type: "finalize" }, null, 120000);
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(MC.exporter.OPFS_DIR, { create: false });
  const fh = await dir.getFileHandle(name, { create: false });
  return fh.getFile();
};

/** worker 書き込みを中断(失敗・キャンセル時)。ファイルの削除は呼び出し側 */
MC.exporter.opfsAbortWorker = async () => {
  try { await (MC.exporter._pendWrites || Promise.resolve()); } catch (_) {}
  try { if (MC.exporter._writer) await MC.exporter._writerReq({ type: "abort" }); } catch (_) {}
};

/** 使い終わった書き出しファイルを消す。失敗しても黙って進む(掃除は必須ではない) */
MC.exporter.opfsRemove = async name => {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(MC.exporter.OPFS_DIR, { create: false });
    await dir.removeEntry(name);
  } catch (e) { /* 無ければそれでよい */ }
};

/** 起動時の掃除。前回の失敗で残った書きかけを消す(容量を食い続けないように)。
    **6時間より新しいファイルは触らない**: 別タブが今まさに書き出している最中に
    新しいタブを開くと、その書きかけを消してしまうため(レビュー指摘 2026-07-23) */
MC.exporter.OPFS_STALE_MS = 6 * 60 * 60 * 1000;
MC.exporter.opfsSweep = async () => {
  if (!MC.exporter.opfsSupported()) return;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(MC.exporter.OPFS_DIR, { create: false });
    const now = Date.now();
    for await (const [n, h] of dir.entries()) {
      try {
        const f = await h.getFile();
        if (now - f.lastModified < MC.exporter.OPFS_STALE_MS) continue;  // 進行中かも
      } catch (e) { /* 読めないものは古いとみなして消す */ }
      await dir.removeEntry(n).catch(() => {});
    }
  } catch (e) { /* ディレクトリが無ければ何もしない */ }
};

/** 書き出し前に空き容量を確かめる。足りないなら「始める前に」断る。
    走り出してから途中で失敗するのがいちばん損(数分が無駄になる) */
MC.exporter.checkQuota = async needBytes => {
  if (!navigator.storage || !navigator.storage.estimate) return;   // 測れないなら通す
  let est;
  try { est = await navigator.storage.estimate(); } catch (e) { return; }
  if (!est || !isFinite(est.quota)) return;
  const free = est.quota - (est.usage || 0);
  const need = needBytes * 1.15;                    // ヘッダ等の余裕を15%見る
  if (free >= need) return;
  const gb = b => (b / 1e9).toFixed(1) + "GB";
  throw new Error(
    `端末の空き容量が足りません(必要 約${gb(need)} / 空き 約${gb(free)})。` +
    "不要な写真や動画を減らすか、書き出す範囲をINとOUTで短くしてください。"
  );
};

MC.exporter.maxExportableSec = () => {
  if (window.showSaveFilePicker) return Infinity;   // ディスクへ直接書ける環境は制限なし
  if (MC.exporter.opfsSupported()) return Infinity; // OPFSへ逐次書ける環境も制限なし
  const perSec = (MC.exporter.videoBitrate() + 192e3) / 8;
  return MC.exporter.MEM_HARD_LIMIT / perSec;
};
MC.exporter.estimateBytes = () => {
  const [tIn, tOut] = MC.trimRange();
  const sec = Math.max(0, tOut - tIn);
  const audio = 192e3;                       // AAC 192kbps
  return sec * (MC.exporter.videoBitrate() + audio) / 8;
};

/* メモリ上で組み立てられる上限の目安。これを超える見込みなら
   保存先を選ばせてディスクへ直接書く(ダイアログは大きいときだけ) */
MC.exporter.MEM_LIMIT_BYTES = 700e6;

/* 保存先を選べない環境(iPhone等)で、これを超えたら書き出しを断る。
   iOS Safari はタブのメモリ上限が厳しく、超えると警告なくタブごと落ちる。
   落ちてから気づくより、始める前に断って範囲の狭め方を案内する */
MC.exporter.MEM_HARD_LIMIT = MC.isIOS ? 260e6 : 1.6e9;

MC.exporter.preflightFiles = async clips => {
  for (const c of clips) {
    if (!c.file) continue;
    try {
      await MZ_MP4.readSlice(c.file, 0, Math.min(16, c.file.size));
    } catch (err) {
      MC.log(`preflight NG: ${c.name}`);
      throw err;   // readSlice が日本語のメッセージに変換済み
    }
  }
  MC.log(`preflight OK: ${clips.length}本すべて読めます`);
};

MC.exporter.exportMP4 = async (onProgress, saveHandle) => {
  let writable = null;
  let opfs = null;
  /* 失敗・中断時は abort で破棄する。FS Access API は swap ファイル方式で、
     close() は部分データの「コミット」= 壊れた書きかけMP4を実ファイルにして
     しまう。abort() なら何も書かれず、上書き対象だった既存ファイルも無傷 */
  const writableRef = () => {
    if (!writable) return;
    const w = writable;
    writable = null;
    try { w.abort().catch(() => {}); } catch (err) {}
  };
  const { w, h } = MC.exporter.exportDims();   // 画質モードで720p/1080pが変わる
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
    const outName = saveHandle
      ? saveHandle.name
      : `MarchinZ_Switcher_${MC.S.preset}_${new Date().toISOString().slice(0, 10)}.mp4`;
    if (saveHandle) {
      writable = await saveHandle.createWritable();
      target = new Mp4Muxer.FileSystemWritableFileStreamTarget(writable);
      MC.log("export: ファイルへ直接書き込みます(メモリに溜めません)");
    } else if (MC.exporter.opfsSupported()) {
      /* ここに来た時点で、尺の上限(maxExportableSec)もビットレート(videoBitrate)も
         「OPFSへ逐次書ける」前提で決まっている。だから OPFS の準備に失敗したら、
         メモリ方式へ黙って落とさず**断る**。落とすと「上限なし×高レート×メモリ」という
         Phase 1 以前より確実に落ちる組み合わせで走り出す(レビュー指摘 2026-07-23 E-1)。
         副作用(checkQuotaの例外)は if の前に素直に出す(E-2) */
      await MC.exporter.checkQuota(MC.exporter.estimateBytes());   // 足りなければ throw
      opfs = await MC.exporter.opfsCreate(outName);
      if (!opfs) {
        throw new Error(
          "この端末の保存領域を用意できませんでした。ブラウザを開き直すか、" +
          "端末の空き容量を増やしてからもう一度お試しください。"
        );
      }
      /* 書き込みは Worker(createSyncAccessHandle)。target は opfsCreate が
         用意した StreamTarget をそのまま使う(iOSでOPFSに書ける唯一の道) */
      target = opfs.target;
      /* 一括sweepはしない。別タブが書き出し中だと、その書きかけを消してしまう
         (レビュー指摘 2026-07-23)。片付けるのは「このタブの前回分」だけ */
      if (MC.exporter._opfsName && MC.exporter._opfsName !== outName) {
        MC.exporter.opfsRemove(MC.exporter._opfsName);
      }
      MC.exporter._opfsName = null;
      MC.log("export: OPFSへ逐次書き込みます(メモリに溜めません)");
    } else {
      /* OPFSもディスク直書きも無い端末。ここは maxExportableSec が
         メモリ上限で頭打ちにしており、ビットレートも3.8Mbpsに落ちている */
      target = new Mp4Muxer.ArrayBufferTarget();
      MC.log("export: メモリ上で組み立てます(短めの尺のみ)");
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
    /* ハードウェアエンコーダを明示要求(対応環境で速くなる。主にChrome系)。
       "prefer-hardware" はHWが無い環境で unsupported になる仕様なので、
       必ず isConfigSupported で確かめて従来構成へ戻す。
       latencyMode は既定(quality)のまま: "realtime" はレート制御が緩んで
       iOS 3.8Mbps×260MB のメモリ見積りが崩れるため使わない(2026-07-22) */
    const baseCfg = {
      codec: "avc1.640028", width: w, height: h,
      bitrate: MC.exporter.videoBitrate(), framerate: fps,
    };
    let vcfg = { ...baseCfg, hardwareAcceleration: "prefer-hardware" };
    try {
      const s = await VideoEncoder.isConfigSupported(vcfg);
      if (!s || !s.supported) vcfg = baseCfg;
    } catch (err) { vcfg = baseCfg; }
    venc.configure(vcfg);
    MC.log("export: encoder=" + (vcfg.hardwareAcceleration || "auto"));

    // 素材が今も読めるかを先に確かめる(途中で落ちるより早く知らせる)

    await MC.exporter.preflightFiles(used.filter(c => !c.isImage));

    const prof = { decode: 0, draw: 0, encode: 0, skips: 0, reseekMs: 0 };
    for (const c of used) {
      if (c.isImage) continue;   // 静止画はデコード不要(そのまま描く)
      const pipe = new MC.exporter.VideoPipe(c);
      pipe.prof = prof;
      await pipe.init(tIn - c.offset);
      pipes.set(c.id, pipe);
    }

    const canvas = MC.exporter.makeCanvas(w, h);
    const ctx = canvas.getContext("2d");
    const t0 = performance.now();
    let tRecent = t0, kRecent = 0;   // 残り時間は直近の速度で出す(序盤の助走に引きずられないため)

    for (let k = 0; k < totalFrames; k++) {
      if (MC.exporter.cancelFlag) throw new Error("キャンセルしました");
      if (vencErr) throw vencErr;
      const t = tIn + k / fps;
      const srcMap = new Map();
      const _tDec = performance.now();
      /* このコマに実際映るカメラだけデコードする(2026-07-22)。
         出番のないカメラのパイプは触らず眠らせ、次に必要になったとき
         frameAt の前方ジャンプ検知が間を飛ばす。
         カメラ間は Promise.all で並行(パイプの状態は互いに独立) */
      const need = new Set(MC.neededIds(t));
      const decodeP = Promise.all([...pipes].map(async ([id, pipe]) => {
        if (!need.has(id)) return;
        const clip = pipe.clip;
        const local = t - clip.offset;
        if (local < -0.05 || local > clip.duration + 0.05) { srcMap.set(id, null); return; }
        srcMap.set(id, await pipe.frameAt(Math.max(0, local)));
      }));
      /* エンコーダの詰まり待ちをデコードと重ねる(待っている間も裏でデコードが進む)。
         待っている間に decodeP が失敗すると、await が付くまでの一瞬だけ
         「未処理のPromise拒否」になる。捨てハンドラを先に付けて黙らせ、
         本物のエラーは下の await decodeP で受ける */
      decodeP.catch(() => {});
      while (venc.encodeQueueSize > 6) await MC.waitDequeue(venc);
      await decodeP;
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
        + `/ ${totalFrames}コマ ${w}x${h} ${(MC.exporter.videoBitrate() / 1e6).toFixed(0)}Mbps`
        + ` / スキップ${prof.skips}回(${(prof.reseekMs / 1000).toFixed(1)}秒)`);
    }

    /* 映像が終わったらデコーダを即解放する。音声エンコードは977秒分の
       Float32(数百MB)を確保するため、3本分のデコーダとフレームキューを
       抱えたままだとメモリの取り合いになる */
    pipes.forEach(pp => pp.dispose());
    pipes.clear();

    let audioOk = false;
    if (withAudio) {
      const enc = audioClip.isAudio ? MC.exporter.encodeAudioFile : MC.exporter.encodeAudio;
      /* 93%で固まって見えた問題(2026-07-23 優さん指摘): 音声は
         デコード+エンコードで数十秒かかるのに、進捗が一点張り付きだった。
         0.90〜0.97 を実際の進み(frac 0..1)で埋める */
      audioOk = await enc(
        muxer, audioClip, tIn - audioClip.offset, tOut - tIn,
        (s, frac) => onProgress(0.90 + 0.07 * Math.max(0, Math.min(1, frac ?? 0.5)), s));
      if (!audioOk && !MC.exporter.cancelFlag) MC.ui.toast("⚠ 音声を書き出せませんでした(映像のみ出力します)");
    }
    if (MC.exporter.cancelFlag) throw new Error("キャンセルしました");

    onProgress(0.97, "ファイルにまとめています…");
    muxer.finalize();
    const name = outName;

    if (opfs && opfs.viaWorker) {
      /* Worker(createSyncAccessHandle)へ積んだ書き込みを流し切り、確定して
         File を取り出す。取り出し(getFile)はメインで動く。iOSでOPFSに書ける道 */
      const file = await MC.exporter.opfsFinalizeWorker(name);
      MC.exporter._opfsName = name;   // 保存/破棄のあとに消すため覚えておく
      MC.exporter.download(file, name);
      MC.log(`export done: ${name} bytes=${file.size} frames=${totalFrames} audio=${audioOk} (OPFS/worker)`);
      return { blob: file, name, opfs: true };
    }
    if (writable) {
      await writable.close();     // PC等のディスク直書き。ここでファイル完成
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
    // OPFS(worker)は成功していなければ中断してファイルを消す
    if (opfs && opfs.viaWorker && MC.exporter._opfsName !== opfs.name) {
      await MC.exporter.opfsAbortWorker().catch(() => {});
      MC.exporter.opfsRemove(opfs.name);
    }
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
MC.exporter._opfsName = null;

/** 保存/ダウンロードが済んだ書き出しファイルを OPFS から消す。
    lastResult.blob は File なので、消したあとに再保存はできない点に注意
    (完了カードは保存後に閉じる運用なので実害なし) */
MC.exporter.releaseOpfs = () => {
  const n = MC.exporter._opfsName;
  if (!n) return;
  MC.exporter._opfsName = null;
  MC.exporter.lastResult = null;
  MC.exporter.opfsRemove(n);
};
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
