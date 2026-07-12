"use strict";
/* ============ 顔検出: MediaPipe FaceDetector(BlazeFace short-range) ============
   スマホの遠い顔対策: 表示向きの解析キャンバス(長辺≤1280)を作り、
   全体1回+「小さな顔も探す」ONなら2×2オーバーラップタイルでも検出してNMS統合 */

MZ.detect = {
  detector: null,
  initPromise: null,

  init() {
    if (!this.initPromise) this.initPromise = this._init();
    return this.initPromise;
  },

  async _init() {
    const { FilesetResolver, FaceDetector } = await MZ.visionReady();
    const fileset = await FilesetResolver.forVisionTasks("vendor/wasm");
    const make = delegate => FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "vendor/blaze_face_short_range.tflite", delegate },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.35,
    });
    try {
      this.detector = await make("GPU");
    } catch (e) {
      MZ.log("GPUデリゲート失敗→CPUで再試行:", e.message);
      this.detector = await make("CPU");
    }
    MZ.log("face detector ready");
  },

  _canvas(key, w, h) {
    const c = this[key] || (this[key] = document.createElement("canvas"));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    return c;
  },

  /* 解析キャンバスの領域(sx,sy,sw,sh)を≤512pxに縮小して検出。正規化座標で返す */
  _region(src, sx, sy, sw, sh) {
    const scale = Math.min(1, 512 / Math.max(sw, sh));
    const cw = Math.max(2, Math.round(sw * scale)), ch = Math.max(2, Math.round(sh * scale));
    const c = this._canvas("_work", cw, ch);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch);
    const res = this.detector.detect(c);
    const fx = sw / cw, fy = sh / ch;
    return (res.detections || []).map(d => {
      const b = d.boundingBox;
      return {
        x: (sx + b.originX * fx) / src.width,
        y: (sy + b.originY * fy) / src.height,
        w: (b.width * fx) / src.width,
        h: (b.height * fy) / src.height,
        score: (d.categories && d.categories[0] && d.categories[0].score) || 0,
      };
    });
  },

  nms(dets, thr) {
    const sorted = [...dets].sort((a, b) => b.score - a.score);
    const out = [];
    for (const d of sorted) if (!out.some(o => MZ.iou(o, d) > thr)) out.push(d);
    return out;
  },

  /* n×nのオーバーラップタイル(各辺size割合)で検出して連結 */
  _grid(A, n, size) {
    let dets = [];
    const tw = Math.round(A.width * size), th = Math.round(A.height * size);
    const step = n > 1 ? (1 - size) / (n - 1) : 0;
    for (let ix = 0; ix < n; ix++) {
      for (let iy = 0; iy < n; iy++) {
        dets = dets.concat(this._region(A,
          Math.round(ix * step * A.width), Math.round(iy * step * A.height), tw, th));
      }
    }
    return dets;
  },

  /* source: VideoFrame | <video> | canvas。rawW/rawH は回転前寸法、rotで表示向きに直して検出。
     mode: "light"=全体+2×2(プレビュー/実時間用) "deep"=+4×4タイルで小さな顔も拾う
     (BlazeFaceはタイル幅の約8%未満の顔を見逃すため、段階的にズームして検出する) */
  onSource(source, rawW, rawH, rot, mode) {
    if (!this.detector) return [];
    const swapped = rot === 90 || rot === 270;
    const dispW = swapped ? rawH : rawW, dispH = swapped ? rawW : rawH;
    const s = Math.min(1, 1920 / Math.max(dispW, dispH));
    const aw = Math.max(2, Math.round(dispW * s)), ah = Math.max(2, Math.round(dispH * s));
    const A = this._canvas("_analysis", aw, ah);
    MZ.drawFrame(A.getContext("2d"), source, rawW, rawH, rot, aw, ah);
    let dets = this._region(A, 0, 0, aw, ah);
    dets = dets.concat(this._grid(A, 2, 0.6));
    if (mode === "deep") dets = dets.concat(this._grid(A, 4, 0.3));
    return this.nms(dets, 0.45);
  },
};
