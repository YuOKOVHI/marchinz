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
    this.firstTs = null;
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

  /* tLocalSec時点のVideoFrame(hold-last-frame)。クリップ末尾以降は最後のフレームを保持 */
  async frameAt(tLocalSec) {
    if (this.error) throw this.error;
    const tUs = tLocalSec * 1e6;
    for (let guard = 0; guard < 4000; guard++) {
      if (this.firstTs === null && this.frames.length) this.firstTs = this.frames[0].timestamp;
      while (this.frames.length && (this.frames[0].timestamp - this.firstTs) <= tUs) {
        if (this.current) this.current.close();
        this.current = this.frames.shift();
      }
      if (this.frames.length) return this.current;                    // 次フレームはtより先=確定
      if (this.eof && this.flushed) return this.current;              // もう来ない=最後を保持
      await this.pump();
      if (this.error) throw this.error;
      if (!this.frames.length && !this.eof) {
        await MC.waitDequeue(this.decoder, 50);
      }
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
  onStatus("音声をエンコード中…");
  let encErr = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
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
MC.exporter.exportMP4 = async onProgress => {
  const { w, h } = MC.PRESETS[MC.S.preset];
  const fps = 30;
  const [tIn, tOut] = MC.trimRange();
  const totalFrames = Math.max(1, Math.round((tOut - tIn) * fps));
  const used = MC.activeClips();
  if (!used.length) throw new Error("表示するクリップがありません");
  const audioClip = MC.getClip(MC.S.audioClipId);
  const withAudio = MC.caps.aac && !!audioClip;

  MC.exporter.cancelFlag = false;
  MC.exporter.running = true;
  const pipes = new Map();
  let venc = null;
  try {
    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: "avc", width: w, height: h },
      audio: withAudio ? { codec: "aac", sampleRate: 48000, numberOfChannels: 2 } : undefined,
      fastStart: "in-memory",
    });
    let vencErr = null;
    venc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: e => { vencErr = e; },
    });
    venc.configure({
      codec: "avc1.640028", width: w, height: h,
      bitrate: MC.S.preset === "1x1" ? 8e6 : 12e6, framerate: fps,
    });

    for (const c of used) {
      const pipe = new MC.exporter.VideoPipe(c);
      await pipe.init(tIn - c.offset);
      pipes.set(c.id, pipe);
    }

    const canvas = MC.exporter.makeCanvas(w, h);
    const ctx = canvas.getContext("2d");
    const t0 = performance.now();

    for (let k = 0; k < totalFrames; k++) {
      if (MC.exporter.cancelFlag) throw new Error("キャンセルしました");
      if (vencErr) throw vencErr;
      const t = tIn + k / fps;
      const srcMap = new Map();
      for (const [id, pipe] of pipes) {
        const clip = pipe.clip;
        const local = t - clip.offset;
        if (local < -0.05 || local > clip.duration + 0.05) { srcMap.set(id, null); continue; }
        const f = await pipe.frameAt(Math.max(0, local));
        srcMap.set(id, f);
      }
      MC.drawComposite(ctx, w, h, t, id => {
        const f = srcMap.get(id);
        if (!f) return null;
        const pipe = pipes.get(id);
        return { source: f, w: f.displayWidth || f.codedWidth, h: f.displayHeight || f.codedHeight, rotation: pipe.rotation };
      });
      const vf = new VideoFrame(canvas, {
        timestamp: Math.round(k * 1e6 / fps), duration: Math.round(1e6 / fps),
      });
      venc.encode(vf, { keyFrame: k % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await MC.waitDequeue(venc);
      if (k % 10 === 0) {
        const el = (performance.now() - t0) / 1000;
        const eta = el / (k + 1) * (totalFrames - k - 1);
        onProgress((k + 1) / totalFrames, `映像 ${k + 1}/${totalFrames} フレーム(残り約${Math.ceil(eta)}秒)`);
        await MC.yield();  // UI息継ぎ(非表示タブでも節流されない)
      }
    }
    await venc.flush();
    if (vencErr) throw vencErr;

    let audioOk = false;
    if (withAudio) {
      audioOk = await MC.exporter.encodeAudio(
        muxer, audioClip, tIn - audioClip.offset, tOut - tIn,
        s => onProgress(1, s));
      if (!audioOk && !MC.exporter.cancelFlag) MC.ui.toast("⚠️ 音声を書き出せませんでした(映像のみ出力します)");
    }
    if (MC.exporter.cancelFlag) throw new Error("キャンセルしました");

    onProgress(1, "MP4を組み立て中…");
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const name = `MarchinZ_Switcher_${MC.S.preset}_${new Date().toISOString().slice(0, 10)}.mp4`;
    MC.exporter.download(blob, name);
    MC.log(`export done: ${name} bytes=${blob.size} frames=${totalFrames} audio=${audioOk}`);
    return { blob, name };
  } finally {
    pipes.forEach(p => p.dispose());
    if (venc) { try { venc.close(); } catch (e) {} }
    MC.exporter.running = false;
  }
};

/* ---- リアルタイム録画fallback(Safariはmp4、Chromeはwebm) ---- */
MC.exporter.exportRealtime = async onProgress => {
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

MC.exporter.download = (blob, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  if (MC.testMode) {  // 自動検証用: ローカルサーバへも保存
    fetch(`/save?name=${encodeURIComponent(name)}`, { method: "PUT", body: blob })
      .then(() => MC.log("test upload ok:", name))
      .catch(e => MC.log("test upload failed:", e.message));
  }
};
