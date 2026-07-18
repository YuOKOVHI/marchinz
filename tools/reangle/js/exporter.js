"use strict";
/* ============ 書き出し ============
   本命: WebCodecs一括処理 → MP4(H.264+音声はAACパススルー=無劣化)
   フォールバック: <video>再生+MediaRecorder実時間録画(iPhoneの古いSafari等) */

RA.exporter = { cancelFlag: false, running: false };

RA.exporter.probeCaps = async () => {
  try {
    // 高速書き出しは VideoDecoder/Encoder + OffscreenCanvas が揃って初めて成立
    // (iOS17+ Safariは対応。未対応環境は実時間フォールバックへ)
    RA.caps.h264 = typeof OffscreenCanvas !== "undefined"
      && !!window.VideoDecoder && !!window.VideoEncoder
      && (await VideoEncoder.isConfigSupported({
        codec: "avc1.640028", width: 1920, height: 1080, bitrate: 8e6, framerate: 30,
      })).supported;
  } catch (e) { RA.caps.h264 = false; }
  try {
    RA.caps.aacEnc = !!window.AudioEncoder && (await AudioEncoder.isConfigSupported({
      codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 192000,
    })).supported;
  } catch (e) { RA.caps.aacEnc = false; }
  RA.log("caps:", JSON.stringify(RA.caps));
};

RA.exporter.run = async onProgress => {
  const clip = RA.S.clip;
  if (!clip) throw new Error("素材がありません");
  if (RA.caps.h264) {
    try {
      return await RA.exporter.exportMP4(clip, onProgress);
    } catch (e) {
      if (RA.exporter.cancelFlag) throw e;
      RA.log("高速書き出し失敗→実時間フォールバック:", e.message);
      RA.ui.toast("⚠ 高速書き出しに失敗したため、実時間モードで書き出します");
    }
  }
  return await RA.exporter.exportRealtime(clip, onProgress);
};

/* ---- 音声の扱いを決める: AACならパススルー(無劣化・Safari可) ---- */
RA.exporter.planAudio = async src => {
  const at = src.audioTrack();
  if (!at) return { mode: "none" };
  const cfg = src.audioDecoderConfig();
  if (/^mp4a\.40/.test(at.codec) && cfg.description) {
    return { mode: "copy", track: at, cfg, sampleRate: cfg.sampleRate, channels: cfg.numberOfChannels };
  }
  if (RA.caps.aacEnc && window.AudioDecoder) {
    const sup = await AudioDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (sup.supported) return { mode: "encode", track: at, cfg, sampleRate: 48000, channels: 2 };
  }
  return { mode: "none" };
};

/* AACサンプルをそのままコピー。エディットリスト(プライミング)分はタイムスタンプで相殺 */
RA.exporter.writeAudioCopy = async (muxer, src, plan) => {
  const editOff = src.editOffsetSec(plan.track);
  let meta = {
    decoderConfig: {
      codec: plan.cfg.codec,
      sampleRate: plan.sampleRate,
      numberOfChannels: plan.channels,
      description: plan.cfg.description,
    },
  };
  for await (const s of src.samples(plan.track.id, 0)) {
    if (RA.exporter.cancelFlag) return false;
    const durUs = Math.max(1, Math.round(s.duration * 1e6 / s.timescale));
    let tsUs = Math.round((s.cts / s.timescale - editOff) * 1e6);
    if (tsUs < 0) {
      if (tsUs + durUs <= 0) continue;  // 完全にプライミング領域→捨てる
      tsUs = 0;
    }
    muxer.addAudioChunkRaw(s.data, "key", tsUs, durUs, meta);
    meta = undefined;
  }
  return true;
};

/* 非AAC音源(PCM等): デコード→48kHzステレオ→AAC再エンコード(対応環境のみ) */
RA.exporter.writeAudioEncode = async (muxer, src, plan, durSec) => {
  const OUT_SR = 48000;
  const need = Math.ceil(durSec * OUT_SR);
  const chL = new Float32Array(need), chR = new Float32Array(need);
  let error = null, written = 0;
  const ratio = plan.cfg.sampleRate / OUT_SR;
  const decoder = new AudioDecoder({
    output: ad => {
      try {
        if (error || written >= need) return;
        const frames = ad.numberOfFrames, nch = ad.numberOfChannels;
        const L = new Float32Array(frames), R = new Float32Array(frames);
        ad.copyTo(L, { planeIndex: 0, format: "f32-planar" });
        if (nch > 1) ad.copyTo(R, { planeIndex: 1, format: "f32-planar" }); else R.set(L);
        const base = Math.round((ad.timestamp / 1e6) * OUT_SR);
        const outN = Math.round(frames / ratio);
        for (let i = 0; i < outN; i++) {
          const w = base + i;
          if (w < 0 || w >= need) continue;
          const si = Math.min(frames - 1, Math.floor(i * ratio));
          chL[w] = L[si]; chR[w] = R[si];
          if (w >= written) written = w + 1;
        }
      } finally { ad.close(); }
    },
    error: e => { error = e; },
  });
  decoder.configure(plan.cfg);
  for await (const s of src.samples(plan.track.id, 0)) {
    if (error || RA.exporter.cancelFlag) break;
    decoder.decode(new EncodedAudioChunk({
      type: s.is_sync ? "key" : "delta",
      timestamp: Math.round(s.cts * 1e6 / s.timescale),
      duration: Math.max(1, Math.round(s.duration * 1e6 / s.timescale)),
      data: s.data,
    }));
    if (decoder.decodeQueueSize > 32) await RA.waitDequeue(decoder);
  }
  if (!error) await decoder.flush().catch(() => {});
  try { decoder.close(); } catch (e) {}
  if (error || RA.exporter.cancelFlag) return false;

  let encErr = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: e => { encErr = e; },
  });
  encoder.configure({ codec: "mp4a.40.2", sampleRate: OUT_SR, numberOfChannels: 2, bitrate: 192000 });
  const FR = 1024;
  for (let o = 0; o < need; o += FR) {
    if (encErr || RA.exporter.cancelFlag) break;
    const n = Math.min(FR, need - o);
    const data = new Float32Array(n * 2);
    data.set(chL.subarray(o, o + n), 0);
    data.set(chR.subarray(o, o + n), n);
    encoder.encode(new AudioData({
      format: "f32-planar", sampleRate: OUT_SR, numberOfFrames: n, numberOfChannels: 2,
      timestamp: Math.round(o * 1e6 / OUT_SR), data,
    }));
    if (encoder.encodeQueueSize > 16) await RA.waitDequeue(encoder);
  }
  if (!encErr) await encoder.flush().catch(() => {});
  try { encoder.close(); } catch (e) {}
  return !encErr && !RA.exporter.cancelFlag;
};

/* ---- 本命: WebCodecs一括書き出し(decode→ワープ→encodeの直列パイプ) ---- */
RA.exporter.exportMP4 = async (clip, onProgress) => {
  RA.exporter.cancelFlag = false;
  RA.exporter.running = true;
  let venc = null, decoder = null, renderer = null;
  const pending = [];
  try {
    const src = new RA.MP4Source(clip.file);
    await src.init();
    const vt = src.videoTrack();
    if (!vt) throw new Error("映像トラックがありません");
    const cfg = src.videoDecoderConfig();
    const sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (!sup.supported) throw new Error(`このブラウザで読めない形式です(${cfg.codec})`);
    const rotation = src.rotationOf(vt);
    const swapped = rotation === 90 || rotation === 270;
    const rawW = vt.video.width, rawH = vt.video.height;
    const dispW = swapped ? rawH : rawW, dispH = swapped ? rawW : rawH;
    let scale = RA.S.res === "orig" ? 1 : Math.min(1, 1920 / Math.max(dispW, dispH));
    const W0 = Math.round(dispW * scale / 2) * 2, H0 = Math.round(dispH * scale / 2) * 2;
    const nb = vt.nb_samples || 1;
    const fps = Math.min(60, Math.max(10, nb / Math.max(0.5, clip.duration)));
    const keyInt = Math.max(1, Math.round(fps * 2));

    const audioPlan = await RA.exporter.planAudio(src);
    RA.log(`export: ${W0}x${H0} rot=${rotation} fps≈${fps.toFixed(1)} frames=${nb} audio=${audioPlan.mode}`);

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: "avc", width: W0, height: H0 },
      audio: audioPlan.mode !== "none"
        ? { codec: "aac", sampleRate: audioPlan.sampleRate, numberOfChannels: audioPlan.channels }
        : undefined,
      fastStart: "in-memory",
    });

    let vencErr = null;
    venc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: e => { vencErr = e; },
    });
    venc.configure({
      codec: (W0 * H0 > 1920 * 1088 || fps > 40) ? "avc1.640033" : "avc1.640028",
      width: W0, height: H0,
      bitrate: Math.min(24e6, Math.max(2e6, Math.round(W0 * H0 * fps * 0.14))),
      framerate: Math.round(fps),
    });

    // ワープ行列は全フレーム共通(生フレームなので回転の逆適用込み)
    const glCanvas = new OffscreenCanvas(W0, H0);
    renderer = new RA.WarpRenderer(glCanvas, { preserve: true });
    renderer.setSize(W0, H0);
    if (Math.max(rawW, rawH) > renderer.maxTex)
      throw new Error(`映像が大きすぎます(${rawW}x${rawH} > GPU上限${renderer.maxTex})`);
    const M = RA.H.buildMatrix({
      corners: RA.S.corners || RA.presetCorners(),
      sMain: RA.S.viewMode === "top" ? 1 : RA.S.sMain,
      sPersp: RA.S.viewMode === "top" ? RA.S.sTop : 0,
      tilt: RA.S.tilt, zoom: RA.S.zoom, panY: RA.S.panY,
      dispW, dispH, raw: true, rot: rotation, rawW, rawH,
    });

    const frames = [];
    let decErr = null, eof = false, flushed = false;
    decoder = new VideoDecoder({ output: f => frames.push(f), error: e => { decErr = e; } });
    decoder.configure(cfg);
    const iter = src.samples(vt.id, 0);
    const pump = async () => {
      while (!eof && decoder.decodeQueueSize < 12 && frames.length < 6) {
        const { value: s, done } = await iter.next();
        if (done) {
          eof = true;
          await decoder.flush().catch(() => {});
          flushed = true;
          return;
        }
        decoder.decode(new EncodedVideoChunk({
          type: s.is_sync ? "key" : "delta",
          timestamp: Math.round(s.cts * 1e6 / s.timescale),
          duration: Math.max(1, Math.round(s.duration * 1e6 / s.timescale)),
          data: s.data,
        }));
      }
    };

    let ts0 = null, k = 0;
    const t0 = performance.now();
    while (true) {
      if (RA.exporter.cancelFlag) throw new Error("キャンセルしました");
      if (decErr) throw decErr;
      if (vencErr) throw vencErr;
      if (!frames.length) {
        if (eof && flushed) break;
        await pump();
        if (!frames.length && !eof) await RA.waitDequeue(decoder, 50);
        continue;
      }
      const f = frames.shift();
      if (ts0 === null) ts0 = f.timestamp;
      renderer.upload(f);
      renderer.render(M);
      const vf = new VideoFrame(glCanvas, {
        timestamp: Math.max(0, f.timestamp - ts0),
        duration: f.duration || Math.round(1e6 / fps),
      });
      f.close();
      venc.encode(vf, { keyFrame: k % keyInt === 0 });
      vf.close();
      k++;
      while (venc.encodeQueueSize > 6) await RA.waitDequeue(venc);
      if (k % 5 === 0) {
        const el = (performance.now() - t0) / 1000;
        const eta = el / k * (nb - k);
        onProgress(0.92 * Math.min(0.99, k / nb),
          `正面補正しながら書き出し中… ${k}/${nb}フレーム(残り約${Math.ceil(eta)}秒)`);
        await RA.yield();
      }
    }
    await venc.flush();
    if (vencErr) throw vencErr;
    RA.log(`video done: ${k} frames`);

    if (audioPlan.mode === "copy") {
      onProgress(0.94, "音声をコピー中…");
      await RA.exporter.writeAudioCopy(muxer, src, audioPlan);
    } else if (audioPlan.mode === "encode") {
      onProgress(0.94, "音声を変換中…");
      const ok = await RA.exporter.writeAudioEncode(muxer, src, audioPlan, clip.duration);
      if (!ok && !RA.exporter.cancelFlag) RA.ui.toast("⚠ 音声を書き出せませんでした(映像のみ)");
    }
    if (RA.exporter.cancelFlag) throw new Error("キャンセルしました");

    onProgress(0.98, "MP4を組み立て中…");
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const name = RA.exporter.outName(clip, "mp4");
    RA.exporter.download(blob, name);
    RA.log(`export done: ${name} bytes=${blob.size}`);
    return { blob, name, frames: k };
  } finally {
    pending.forEach(f => { try { f.close(); } catch (err) {} });
    if (decoder) { try { decoder.close(); } catch (e) {} }
    if (venc) { try { venc.close(); } catch (e) {} }
    if (renderer) { try { renderer.dispose(); } catch (e) {} }
    RA.exporter.running = false;
  }
};

/* ---- フォールバック: プレビューを実時間録画(MediaRecorder) ---- */
RA.exporter.exportRealtime = async (clip, onProgress) => {
  RA.exporter.cancelFlag = false;
  RA.exporter.running = true;
  try {
    const video = clip.video;
    video.pause();
    video.currentTime = 0;
    await new Promise(r => { video.onseeked = r; });

    const canvas = RA.preview.canvas;
    const tracks = [...canvas.captureStream(30).getVideoTracks()];
    const actx = RA.exporter._actx || (RA.exporter._actx = new AudioContext());
    if (actx.state === "suspended") await actx.resume().catch(() => {});
    try {
      if (!clip.sourceNode) {
        clip.sourceNode = actx.createMediaElementSource(video);
        clip.sourceNode.connect(actx.destination);
      }
      const dest = actx.createMediaStreamDestination();
      clip.sourceNode.connect(dest);
      tracks.push(...dest.stream.getAudioTracks());
    } catch (e) { RA.log("音声キャプチャ不可(映像のみ):", e.message); }

    const mime = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4",
      "video/webm;codecs=vp9,opus", "video/webm"]
      .find(m => MediaRecorder.isTypeSupported(m)) || "";
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    const mr = new MediaRecorder(new MediaStream(tracks),
      { mimeType: mime || undefined, videoBitsPerSecond: 10e6 });
    const chunks = [];
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => { mr.onstop = r; });
    mr.start(200);
    await video.play();
    await new Promise(res => {
      const iv = setInterval(() => {
        onProgress(video.currentTime / clip.duration,
          `実時間で録画中… ${Math.floor(video.currentTime)} / ${Math.floor(clip.duration)}秒`);
        if (video.ended || RA.exporter.cancelFlag) { clearInterval(iv); res(); }
      }, 200);
    });
    video.pause();
    mr.stop();
    await stopped;
    if (RA.exporter.cancelFlag) throw new Error("キャンセルしました");
    const blob = new Blob(chunks, { type: mime || "video/webm" });
    const name = RA.exporter.outName(clip, ext);
    RA.exporter.download(blob, name);
    RA.log(`realtime export done: ${name} bytes=${blob.size}`);
    return { blob, name };
  } finally {
    RA.exporter.running = false;
  }
};

RA.exporter.outName = (clip, ext) => {
  const base = (clip.name || "video").replace(/\.[^.]+$/, "");
  return `${base}_front.${ext}`;
};

/* iOS SafariはWeb Share(files)でカメラロール/ファイルへ保存できる。
   共有はユーザー操作(タップ)内でしか呼べないため、iOSでは自動保存せず
   完了後の「保存」ボタンのタップから RA.ui.saveResult() が共有する。 */
RA.exporter._shareMode = null;
RA.exporter.shareMode = () => {
  if (RA.exporter._shareMode != null) return RA.exporter._shareMode;
  let ok = false;
  try {
    const probe = new File([new Uint8Array(1)], "probe.mp4", { type: "video/mp4" });
    ok = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [probe] }));
  } catch (e) { ok = false; }
  return (RA.exporter._shareMode = ok);
};

/* <a download> による保存(デスクトップ/Android)。iOS Safariでは無視されるので使わない */
RA.exporter.triggerDownload = (blob, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
};

/* 書き出し結果の受け渡し。共有可なら結果を保持して待つ(ボタンのタップで共有)、
   それ以外は即ダウンロード。テスト時は常にローカルサーバへPUT。 */
RA.exporter.download = (blob, name) => {
  RA.exporter.lastResult = { blob, name, type: blob.type };
  if (RA.testMode) {  // 自動検証用: ローカルサーバへも保存
    fetch(`/save?name=${encodeURIComponent(name)}`, { method: "PUT", body: blob })
      .then(() => RA.log("test upload ok:", name))
      .catch(e => RA.log("test upload failed:", e.message));
  }
  if (!RA.exporter.shareMode()) RA.exporter.triggerDownload(blob, name);
};
