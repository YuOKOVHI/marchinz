"use strict";
/* ============ 顔検出ワーカー(Phase 3 / 2026-07-23) ============
   前処理(640²化+BGR planar)と YuNet 推論を丸ごとこのWorkerで行う。
   メインスレッドは VideoFrame を transfer で手渡すだけになり、
   デコードと顔処理が完全に並走する。

   **前処理はメインスレッド版 detectFacesFrom と一字一句同じ計算**にすること。
   ここがズレると「Workerの有無で解析結果が変わる」ことになり、
   完全一致の検証(visual.js側)が落ちる。

   プロトコル:
     ← {type:"init", base, noSimd}
     → {type:"ready"} / {type:"init-error", message}
     ← {type:"detect", id, frame(VideoFrame, transfer), sw, sh, rotation}
     → {type:"result", id, res} / {type:"error", id, message} */

let session = null;
let fcv = null, fbuf = null;

function nms(dets, thr) {
  /* visual.js の _nms と同じ計算(降順→IoU抑制) */
  dets.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const d of dets) {
    let ok = true;
    for (const k of keep) {
      const x1 = Math.max(d.x, k.x), y1 = Math.max(d.y, k.y);
      const x2 = Math.min(d.x + d.w, k.x + k.w), y2 = Math.min(d.y + d.h, k.y + k.h);
      const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      const iou = inter / (d.w * d.h + k.w * k.h - inter);
      if (iou > thr) { ok = false; break; }
    }
    if (ok) keep.push(d);
  }
  return keep;
}

async function detect(frame, sw, sh, rotation) {
  const rot = (((rotation || 0) % 360) + 360) % 360;
  const swp = rot === 90 || rot === 270;
  const dw = swp ? sh : sw, dh = swp ? sw : sh;
  const S = Math.max(dw, dh);
  if (!fcv) fcv = new OffscreenCanvas(640, 640);
  const ctx = fcv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 640, 640);
  const k = 640 / S;
  ctx.save();
  ctx.translate(dw * k / 2, dh * k / 2);
  if (rot) ctx.rotate(rot * Math.PI / 180);
  ctx.scale(k, k);
  ctx.drawImage(frame, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
  const px = ctx.getImageData(0, 0, 640, 640).data;
  const N = 640 * 640;
  const d = fbuf || (fbuf = new Float32Array(3 * N));   // Worker内は逐次なので使い回せる
  for (let i = 0; i < N; i++) {
    d[i] = px[i * 4 + 2];
    d[N + i] = px[i * 4 + 1];
    d[2 * N + i] = px[i * 4];
  }
  const out = await session.run({ input: new self.ort.Tensor("float32", d, [1, 3, 640, 640]) });
  let dets = [];
  for (const s of [8, 16, 32]) {
    const cls = out["cls_" + s].data, obj = out["obj_" + s].data,
          bb = out["bbox_" + s].data, cols = 640 / s;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(
        Math.max(0, Math.min(1, cls[i])) * Math.max(0, Math.min(1, obj[i])));
      if (score < 0.5) continue;
      const row = (i / cols) | 0, col = i % cols;
      const cx = (col + bb[i * 4]) * s, cy = (row + bb[i * 4 + 1]) * s;
      const w = Math.exp(bb[i * 4 + 2]) * s, h = Math.exp(bb[i * 4 + 3]) * s;
      if (!(w > 0 && h > 0)) continue;
      dets.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
    }
  }
  dets = nms(dets, 0.35);
  const res = [];
  for (const de of dets) {
    const fx = (de.x + de.w / 2) / 640 * S, fy = (de.y + de.h / 2) / 640 * S;
    if (fx < 0 || fx > dw || fy < 0 || fy > dh) continue;
    res.push({ h: de.h / 640 * S / dh, score: de.score });
  }
  return res;
}

self.onmessage = async e => {
  const m = e.data || {};
  if (m.type === "init") {
    try {
      importScripts(m.base + "ort.min.js");
      self.ort.env.wasm.wasmPaths = m.base;
      self.ort.env.wasm.numThreads = 1;
      if (m.noSimd) self.ort.env.wasm.simd = false;
      session = await self.ort.InferenceSession.create(
        m.base + "face_detection_yunet_2023mar.onnx",
        { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "init-error", message: String((err && err.message) || err) });
    }
    return;
  }
  if (m.type === "detect") {
    try {
      const res = await detect(m.frame, m.sw, m.sh, m.rotation);
      self.postMessage({ type: "result", id: m.id, res });
    } catch (err) {
      self.postMessage({ type: "error", id: m.id, message: String((err && err.message) || err) });
    } finally {
      try { m.frame.close(); } catch (e2) { /* transfer済みフレームの後始末 */ }
    }
  }
};
