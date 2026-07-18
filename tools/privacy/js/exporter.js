"use strict";
/* ============ 書き出し ============
   本命: WebCodecs一括処理 → MP4(H.264+音声はAACパススルー=無劣化)
   フォールバック: <video>再生+MediaRecorder実時間録画(iPhoneの古いSafari等) */

MZ.exporter = { cancelFlag: false, running: false };

MZ.exporter.probeCaps = async () => {
  try {
    // 高速書き出しは VideoDecoder/Encoder + OffscreenCanvas が揃って初めて成立
    // (iOS17+ Safariは対応。未対応環境は実時間フォールバックへ)
    MZ.caps.h264 = typeof OffscreenCanvas !== "undefined"
      && !!window.VideoDecoder && !!window.VideoEncoder
      && (await VideoEncoder.isConfigSupported({
        codec: "avc1.640028", width: 1920, height: 1080, bitrate: 8e6, framerate: 30,
      })).supported;
  } catch (e) { MZ.caps.h264 = false; }
  try {
    MZ.caps.aacEnc = !!window.AudioEncoder && (await AudioEncoder.isConfigSupported({
      codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 192000,
    })).supported;
  } catch (e) { MZ.caps.aacEnc = false; }
  MZ.log("caps:", JSON.stringify(MZ.caps));
};

MZ.exporter.run = async onProgress => {
  const clip = MZ.S.clip;
  if (!clip) throw new Error("素材がありません");
  if (clip.kind === "image") return MZ.exporter.exportImage(clip, onProgress);
  if (MZ.caps.h264) {
    try {
      return await MZ.exporter.exportMP4(clip, onProgress);
    } catch (e) {
      if (MZ.exporter.cancelFlag) throw e;
      MZ.log("高速書き出し失敗→実時間フォールバック:", e.message);
      MZ.ui.toast("⚠ 高速書き出しに失敗したため、実時間モードで書き出します");
    }
  }
  return await MZ.exporter.exportRealtime(clip, onProgress);
};

/* ---- 音声の扱いを決める: AACならパススルー(無劣化・Safari可) ---- */
MZ.exporter.planAudio = async src => {
  const at = src.audioTrack();
  if (!at) return { mode: "none" };
  const cfg = src.audioDecoderConfig();
  if (/^mp4a\.40/.test(cfg.codec) && cfg.description) {   // cfg.codecは正規化済み(MOVの"mp4a"にも対応)
    return { mode: "copy", track: at, cfg, sampleRate: cfg.sampleRate, channels: cfg.numberOfChannels };
  }
  if (MZ.caps.aacEnc && window.AudioDecoder) {
    const sup = await AudioDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (sup.supported) return { mode: "encode", track: at, cfg, sampleRate: 48000, channels: 2 };
  }
  return { mode: "none" };
};

/* AACサンプルをそのままコピー。エディットリスト(プライミング)分はタイムスタンプで相殺 */
MZ.exporter.writeAudioCopy = async (muxer, src, plan, rangeStart, rangeEnd) => {
  const editOff = src.editOffsetSec(plan.track);
  const rs = rangeStart || 0;
  let meta = {
    decoderConfig: {
      codec: plan.cfg.codec,
      sampleRate: plan.sampleRate,
      numberOfChannels: plan.channels,
      description: plan.cfg.description,
    },
  };
  for await (const s of src.samples(plan.track.id, rs)) {
    if (MZ.exporter.cancelFlag) return false;
    const secIn = s.cts / s.timescale - editOff;
    if (rangeEnd != null && secIn > rangeEnd + 0.05) break;   // 範囲を過ぎたら終了
    const durUs = Math.max(1, Math.round(s.duration * 1e6 / s.timescale));
    let tsUs = Math.round((secIn - rs) * 1e6);
    if (tsUs < 0) {
      if (tsUs + durUs <= 0) continue;  // プライミング/範囲前→捨てる
      tsUs = 0;
    }
    muxer.addAudioChunkRaw(s.data, "key", tsUs, durUs, meta);
    meta = undefined;
  }
  return true;
};

/* 非AAC音源(PCM等): デコード→48kHzステレオ→AAC再エンコード(対応環境のみ) */
MZ.exporter.writeAudioEncode = async (muxer, src, plan, durSec, rangeStart) => {
  const OUT_SR = 48000;
  const rs = rangeStart || 0;
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
        const base = Math.round((ad.timestamp / 1e6 - rs) * OUT_SR);
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
  for await (const s of src.samples(plan.track.id, rs)) {
    if (error || MZ.exporter.cancelFlag) break;
    if (s.cts / s.timescale - rs > durSec + 0.5) break;   // 範囲を過ぎたら終了
    decoder.decode(new EncodedAudioChunk({
      type: s.is_sync ? "key" : "delta",
      timestamp: Math.round(s.cts * 1e6 / s.timescale),
      duration: Math.max(1, Math.round(s.duration * 1e6 / s.timescale)),
      data: s.data,
    }));
    if (decoder.decodeQueueSize > 32) await MZ.waitDequeue(decoder);
  }
  if (!error) await decoder.flush().catch(() => {});
  try { decoder.close(); } catch (e) {}
  if (error || MZ.exporter.cancelFlag) return false;

  let encErr = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: e => { encErr = e; },
  });
  encoder.configure({ codec: "mp4a.40.2", sampleRate: OUT_SR, numberOfChannels: 2, bitrate: 192000 });
  const FR = 1024;
  for (let o = 0; o < need; o += FR) {
    if (encErr || MZ.exporter.cancelFlag) break;
    const n = Math.min(FR, need - o);
    const data = new Float32Array(n * 2);
    data.set(chL.subarray(o, o + n), 0);
    data.set(chR.subarray(o, o + n), n);
    encoder.encode(new AudioData({
      format: "f32-planar", sampleRate: OUT_SR, numberOfFrames: n, numberOfChannels: 2,
      timestamp: Math.round(o * 1e6 / OUT_SR), data,
    }));
    if (encoder.encodeQueueSize > 16) await MZ.waitDequeue(encoder);
  }
  if (!encErr) await encoder.flush().catch(() => {});
  try { encoder.close(); } catch (e) {}
  return !encErr && !MZ.exporter.cancelFlag;
};

/* ---- 本命: WebCodecs一括書き出し ---- */
MZ.exporter.exportMP4 = async (clip, onProgress) => {
  MZ.exporter.cancelFlag = false;
  MZ.exporter.running = true;
  let venc = null, decoder = null;
  const buffer = [];  // {frame, ts, dur, boxes} — 新しい顔の「さかのぼりマスク」用の遅延バッファ
  const frames = [];  // デコーダ出力の未処理フレーム(finallyで確実にcloseするためtryの外で宣言)
  try {
    const src = new MZ.MP4Source(clip.file);
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
    const scale = MZ.S.res === "orig" ? 1 : Math.min(1, 1920 / Math.max(dispW, dispH));
    const W = Math.round(dispW * scale / 2) * 2, H = Math.round(dispH * scale / 2) * 2;
    const nb = vt.nb_samples || 1;
    const fps = Math.min(60, Math.max(10, nb / Math.max(0.5, clip.duration)));
    const keyInt = Math.max(1, Math.round(fps * 2));
    // 作業範囲(長い動画は選んだ最大60秒だけを書き出す)
    const rs = clip.duration > MZ_LIMITS.maxRangeSec ? MZ.S.rangeStart : 0;
    const re = clip.duration > MZ_LIMITS.maxRangeSec ? MZ.rangeEnd() : clip.duration;
    const nbRange = Math.max(1, Math.round(nb * (re - rs) / Math.max(0.5, clip.duration)));

    const audioPlan = await MZ.exporter.planAudio(src);
    MZ.log(`export: ${W}x${H} rot=${rotation} fps≈${fps.toFixed(1)} frames=${nb} audio=${audioPlan.mode}`);

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: "avc", width: W, height: H },
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
      codec: (W * H > 1920 * 1088 || fps > 40) ? "avc1.640033" : "avc1.640028",
      width: W, height: H,
      bitrate: Math.min(24e6, Math.max(2e6, Math.round(W * H * fps * 0.14))),
      framerate: Math.round(fps),
    });

    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d");
    const tracker = new MZ.Tracker();
    const scenecut = new MZ.SceneCut();
    const cutTimes = [];   // シーン切替時刻(タップ抑制のシーン限定用)
    let lastKeySec = -9;   // 前回のYuNet検出時刻
    const BUF = Math.max(2, Math.min(10, Math.round(0.3 * fps)));
    // YuNet定期検出の間隔: さかのぼりバッファで必ず遡れる長さに連動させる
    // (間隔>バッファだと、間に現れた小さい顔が数フレーム未マスクで確定してしまう)
    const KEY_SEC = Math.max(0.2, (BUF - 1) / fps);

    let decErr = null, eof = false, flushed = false;
    decoder = new VideoDecoder({ output: f => frames.push(f), error: e => { decErr = e; } });
    decoder.configure(cfg);
    const iter = src.samples(vt.id, rs);
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

    let ts0 = null, k = 0, faceFrames = 0;
    const t0 = performance.now();
    const renderOne = async entry => {
      MZ.drawFrame(ctx, entry.frame, rawW, rawH, rotation, W, H);
      if (entry.boxes.length) faceFrames++;
      MZ.mosaic.apply(ctx, W, H, entry.boxes, MZ.S);
      const vf = new VideoFrame(canvas, { timestamp: entry.ts, duration: entry.dur });
      venc.encode(vf, { keyFrame: k % keyInt === 0 });
      vf.close();
      entry.frame.close();
      k++;
      while (venc.encodeQueueSize > 6) await MZ.waitDequeue(venc);
      if (k % 5 === 0) {
        const el = (performance.now() - t0) / 1000;
        const eta = k < 15 ? null : el / k * Math.max(0, nbRange - k);
        onProgress(0.92 * Math.min(0.99, k / nbRange),
          `顔を隠しながら書き出し中… ${k}/${nbRange}フレーム`
          + (eta == null ? "(残り時間を計測中…)" : `(残り約${Math.ceil(eta)}秒)`));
        await MZ.yield();
      }
    };

    while (true) {
      if (MZ.exporter.cancelFlag) throw new Error("キャンセルしました");
      if (decErr) throw decErr;
      if (vencErr) throw vencErr;
      if (!frames.length) {
        if (eof && flushed) break;
        await pump();
        if (!frames.length && !eof) await MZ.waitDequeue(decoder, 50);
        continue;
      }
      const f = frames.shift();
      const absSec = f.timestamp / 1e6;
      if (absSec < rs - 1e-3) { f.close(); continue; }   // シークRAPから範囲までの先行分
      if (absSec > re + 1e-3) { f.close(); eof = true; flushed = true; frames.forEach(x => x.close()); frames.length = 0; break; }
      if (ts0 === null) ts0 = f.timestamp;
      const tSec = (f.timestamp - ts0) / 1e6;
      // 専用の解析キャンバス(プレビュー側の検出と共有しない)
      const A = MZ.detect.analysisOf(f, rawW, rawH, rotation, "_exportA");
      const isCut = scenecut.check(A);
      if (isCut) {
        // カット前のフレームを書き出し切ってから追跡を捨てる
        // (切替後の顔が「さかのぼりマスク」で切替前のフレームに付かないように)
        while (buffer.length) await renderOne(buffer.shift());
        tracker.reset();
        cutTimes.push(tSec);
        MZ.log(`export scene cut at ${tSec.toFixed(2)}s → re-detect`);
      }
      const near = tracker.tracks.map(tr => tr.box);   // リセット後に取る(切替前の位置を引きずらない)
      let dets;
      if (isCut) {
        dets = await MZ.detect.yunetScan(A, "full", near);   // 切替直後は全体+タイルで種を撒く
        lastKeySec = tSec;
      } else if (tSec - lastKeySec >= KEY_SEC) {
        dets = await MZ.detect.yunetScan(A, "l0", near);     // 定期は全体1発(速度と精度の均衡)
        lastKeySec = tSec;
      } else {
        dets = MZ.detect.blazeLight(A, near);
      }
      dets = MZ.dropSuppressed(dets, null, tSec, cutTimes);
      const { active, born } = tracker.update(dets, tSec, MZ.S.hold);
      active.push(...MZ.S.manualBoxes);
      // 新しく現れた顔は、まだ書き出していない直前フレームにもさかのぼってマスク
      if (born.length) {
        for (const e of buffer) for (const tr of born) e.boxes.push({ ...tr.box });
      }
      buffer.push({
        frame: f,
        ts: Math.max(0, f.timestamp - ts0),
        dur: f.duration || Math.round(1e6 / fps),
        boxes: active,
      });
      while (buffer.length > BUF) await renderOne(buffer.shift());
    }
    while (buffer.length) await renderOne(buffer.shift());
    await venc.flush();
    if (vencErr) throw vencErr;
    MZ.log(`video done: ${k} frames, ${faceFrames} frames masked`);

    if (audioPlan.mode === "copy") {
      onProgress(0.94, "音声をコピー中…");
      await MZ.exporter.writeAudioCopy(muxer, src, audioPlan, rs, re);
    } else if (audioPlan.mode === "encode") {
      onProgress(0.94, "音声を変換中…");
      const ok = await MZ.exporter.writeAudioEncode(muxer, src, audioPlan, re - rs, rs);
      if (!ok && !MZ.exporter.cancelFlag) MZ.ui.toast("⚠ 音声を書き出せませんでした(映像のみ)");
    }
    if (MZ.exporter.cancelFlag) throw new Error("キャンセルしました");

    onProgress(0.98, "MP4を組み立て中…");
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const name = MZ.exporter.outName(clip, "mp4");
    MZ.exporter.download(blob, name);
    MZ.log(`export done: ${name} bytes=${blob.size} masked=${faceFrames}/${k}`);
    return { blob, name, frames: k, faceFrames };
  } finally {
    frames.forEach(x => { try { x.close(); } catch (err) {} });   // 未処理のデコード済みフレームも解放
    buffer.forEach(e => { try { e.frame.close(); } catch (err) {} });
    if (decoder) { try { decoder.close(); } catch (e) {} }
    if (venc) { try { venc.close(); } catch (e) {} }
    MZ.exporter.running = false;
  }
};

/* 1枚の写真をレンダリング(検出→円形マスク)→ {blob,name}。boxesは写真ごとに保持 */
MZ.exporter._renderPhoto = async photo => {
  const W = photo.width, H = photo.height;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(photo.img, 0, 0, W, H);
  // 写真はEXIF回転済みImageBitmapなので rot=0。
  // 再検出+プレビューで確定した検出(タップ追加含む)をNMS統合し、固定マスクを足す
  const A = MZ.detect.analysisOf(photo.img, W, H, 0);
  const dets = await MZ.detect.yunetScan(A, "full", null);
  const boxes = MZ.detect.nms(
    MZ.dropSuppressed(
      dets.concat((photo.boxes || []).map(b => ({ ...b, score: b.score || 0.5 }))),
      photo.suppressedBoxes || []),
    0.45,
  ).concat(photo.manualBoxes || []);
  MZ.mosaic.apply(ctx, W, H, boxes, MZ.S);
  const png = /png/i.test(photo.file.type) || /\.png$/i.test(photo.name);
  const mime = png ? "image/png" : "image/jpeg";
  const ext = png ? "png" : "jpg";
  const blob = await new Promise((res, rej) =>
    canvas.toBlob(b => (b ? res(b) : rej(new Error("画像を書き出せませんでした"))), mime, 0.92));
  return { blob, name: MZ.exporter.outName(photo, ext), type: mime, faces: boxes.length };
};

/* ---- 写真: 全枚(最大4枚)を順に検出→マスク→PNG/JPEG ---- */
MZ.exporter.exportImage = async (clip, onProgress) => {
  MZ.exporter.cancelFlag = false;
  MZ.exporter.running = true;
  try {
    if (MZ.ui._syncCurrentPhoto) MZ.ui._syncCurrentPhoto();   // 表示中の検出/手動を退避
    const photos = (MZ.S.photos && MZ.S.photos.length) ? MZ.S.photos : [clip];
    const results = [];
    for (let i = 0; i < photos.length; i++) {
      if (MZ.exporter.cancelFlag) throw new Error("キャンセルしました");
      const base = i / photos.length;
      onProgress(base + 0.15 / photos.length,
        photos.length > 1 ? `${i + 1}/${photos.length}枚目の顔を検出しています…` : "顔を検出しています…");
      await MZ.yield();
      results.push(await MZ.exporter._renderPhoto(photos[i]));
      onProgress((i + 1) / photos.length, `${i + 1}/${photos.length}枚 完了`);
    }
    // 保存: 共有可なら結果を保持してタップ待ち、非共有は即ダウンロード
    MZ.exporter.lastResults = results;
    MZ.exporter.lastResult = results[0] || null;
    if (MZ.testMode) {
      for (const r of results) {
        fetch(`/save?name=${encodeURIComponent(r.name)}`, { method: "PUT", body: r.blob })
          .then(() => MZ.log("test upload ok:", r.name)).catch(e => MZ.log("test upload failed:", e.message));
      }
    }
    if (!MZ.exporter.shareMode()) results.forEach(r => MZ.exporter.triggerDownload(r.blob, r.name));
    MZ.log(`image export done: ${results.length} file(s)`);
    return results[0] || { blob: new Blob(), name: "" };
  } finally {
    MZ.exporter.running = false;
  }
};

/* ---- フォールバック: プレビューを実時間録画(MediaRecorder) ---- */
MZ.exporter.exportRealtime = async (clip, onProgress) => {
  MZ.exporter.cancelFlag = false;
  MZ.exporter.running = true;
  MZ.exporter.realtimeMode = true;   // プレビュー検出は続行(このcanvasが録画源のため)
  try {
    const video = clip.video;
    const rs = clip.duration > MZ_LIMITS.maxRangeSec ? MZ.S.rangeStart : 0;
    const re = clip.duration > MZ_LIMITS.maxRangeSec ? MZ.rangeEnd() : clip.duration;
    video.pause();
    if (Math.abs(video.currentTime - rs) > 0.05) {
      video.currentTime = rs;
      await new Promise(r => {
        video.onseeked = () => { video.onseeked = null; r(); };
        setTimeout(r, 2000);   // 既に位置が合っている等でseekedが来ない環境への保険
      });
    }
    MZ.preview.tracker.reset();

    const canvas = MZ.preview.canvas;
    const tracks = [...canvas.captureStream(30).getVideoTracks()];
    const actx = MZ.exporter._actx || (MZ.exporter._actx = new AudioContext());
    if (actx.state === "suspended") await actx.resume().catch(() => {});
    try {
      if (!clip.sourceNode) {
        clip.sourceNode = actx.createMediaElementSource(video);
        clip.sourceNode.connect(actx.destination);
      }
      const dest = actx.createMediaStreamDestination();
      clip.sourceNode.connect(dest);
      tracks.push(...dest.stream.getAudioTracks());
    } catch (e) { MZ.log("音声キャプチャ不可(映像のみ):", e.message); }

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
        onProgress(Math.min(1, (video.currentTime - rs) / Math.max(0.1, re - rs)),
          `実時間で録画中… ${Math.max(0, Math.floor(video.currentTime - rs))} / ${Math.floor(re - rs)}秒`);
        if (video.ended || video.currentTime >= re || MZ.exporter.cancelFlag) { clearInterval(iv); res(); }
      }, 80);
    });
    video.pause();
    mr.stop();
    await stopped;
    if (MZ.exporter.cancelFlag) throw new Error("キャンセルしました");
    const blob = new Blob(chunks, { type: mime || "video/webm" });
    const name = MZ.exporter.outName(clip, ext);
    MZ.exporter.download(blob, name);
    MZ.log(`realtime export done: ${name} bytes=${blob.size}`);
    return { blob, name };
  } finally {
    MZ.exporter.running = false;
    MZ.exporter.realtimeMode = false;
  }
};

MZ.exporter.outName = (clip, ext) => {
  const base = (clip.name || "video").replace(/\.[^.]+$/, "");
  return `${base}_mosaic.${ext}`;
};

/* iOS SafariはWeb Share(files)でカメラロール/ファイルへ保存できる。
   共有はユーザー操作(タップ)内でしか呼べないため、iOSでは自動保存せず
   完了後の「保存」ボタンのタップから MZ.ui.saveResult() が共有する。 */
MZ.exporter._shareMode = null;
MZ.exporter.shareMode = () => {
  if (MZ.exporter._shareMode != null) return MZ.exporter._shareMode;
  let ok = false;
  try {
    const probe = new File([new Uint8Array(1)], "probe.mp4", { type: "video/mp4" });
    ok = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [probe] }));
  } catch (e) { ok = false; }
  return (MZ.exporter._shareMode = ok);
};

/* <a download> による保存(デスクトップ/Android)。iOS Safariでは無視されるので使わない */
MZ.exporter.triggerDownload = (blob, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
};

/* 書き出し結果の受け渡し。共有可なら結果を保持して待つ(ボタンのタップで共有)、
   それ以外は即ダウンロード。テスト時は常にローカルサーバへPUT。 */
MZ.exporter.download = (blob, name) => {
  MZ.exporter.lastResult = { blob, name, type: blob.type };
  MZ.exporter.lastResults = null;   // 動画は単一結果。写真の配列結果と混同しない
  if (MZ.testMode) {  // 自動検証用: ローカルサーバへも保存
    fetch(`/save?name=${encodeURIComponent(name)}`, { method: "PUT", body: blob })
      .then(() => MZ.log("test upload ok:", name))
      .catch(e => MZ.log("test upload failed:", e.message));
  }
  if (!MZ.exporter.shareMode()) MZ.exporter.triggerDownload(blob, name);
};
