"use strict";
/* ============ 顔検出: YuNet(精度) + BlazeFace(速度)の2エンジン ============
   YuNet(OpenCV Zoo)は約10px超の小さい顔まで拾える精度エンジン。
   初期スキャン・一時停止・シーン切替・書き出しキーフレームで使う。
   BlazeFace(MediaPipe)は軽いが約50px未満の顔を見逃すため、
   再生中の「大きめの顔の追従」と横顔の補完に限って使う。 */

MZ.detect = {
  detector: null,
  initPromise: null,

  init() {
    if (!this.initPromise) this.initPromise = this._init();
    return this.initPromise;
  },

  async _init() {
    // YuNet(精度エンジン)は並行して読み込む。失敗してもBlazeFaceだけで動く(縮退)
    const yunetP = MZ.yunet.init().catch(e => MZ.log("YuNet読み込み失敗(BlazeFaceのみで動作):", e.message));
    const { FilesetResolver, FaceDetector } = await MZ.visionReady();
    const fileset = await FilesetResolver.forVisionTasks("vendor/wasm");
    const make = delegate => FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "vendor/blaze_face_short_range.tflite", delegate },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.2,
    });
    try {
      this.detector = await make("GPU");
    } catch (e) {
      MZ.log("GPUデリゲート失敗→CPUで再試行:", e.message);
      this.detector = await make("CPU");
    }
    await yunetP;
    MZ.log("face detector ready");
  },

  /* 表示向きの解析キャンバス(長辺≤1920)を作る。YuNet/BlazeFace/シーンカット共用 */
  analysisOf(source, rawW, rawH, rot) {
    const swapped = rot === 90 || rot === 270;
    const dispW = swapped ? rawH : rawW, dispH = swapped ? rawW : rawH;
    const s = Math.min(1, 1920 / Math.max(dispW, dispH));
    const aw = Math.max(2, Math.round(dispW * s)), ah = Math.max(2, Math.round(dispH * s));
    const A = this._canvas("_analysis", aw, ah);
    MZ.drawFrame(A.getContext("2d"), source, rawW, rawH, rot, aw, ah);
    return A;
  },

  /* 解析キャンバスAに対するBlazeFace軽量検出(全体+2×2)。同期・約60ms */
  blazeLight(A, nearBoxes) {
    if (!this.detector) return [];
    let dets = this._region(A, 0, 0, A.width, A.height);
    dets = dets.concat(this._grid(A, 2, 0.6));
    return this.nms(dets, 0.45).filter(d =>
      d.score >= 0.3 || (nearBoxes || []).some(nb => MZ.iou(nb, d) > 0.2));
  },

  /* YuNet高精度検出(解析キャンバスAに対して非同期)。
     level "full"=全体+960pxタイル(精度重視) "l0"=全体1発(再生中の混ぜ込み)
     BlazeFaceの軽量結果も統合する(横顔・大きい顔の補完)。 */
  async yunetScan(A, level, nearBoxes, onProgress) {
    if (!MZ.yunet.session) {
      // YuNetが無い環境: BlazeFaceの従来deepで代替
      let dets = this.blazeLight(A, nearBoxes);
      dets = dets.concat(this._grid(A, 4, 0.3));
      return this.nms(dets, 0.45).filter(d =>
        d.score >= 0.3 || (nearBoxes || []).some(nb => MZ.iou(nb, d) > 0.2));
    }
    const regions = MZ.yunet.regionsFor(A, level);
    let all = [];
    for (let i = 0; i < regions.length; i++) {
      const part = await MZ.yunet.scan(A, [regions[i]], nearBoxes);
      all = all.concat(part);
      if (onProgress) onProgress((i + 1) / regions.length);
      await MZ.yield();   // 推論の合間にUIへ制御を返す
    }
    if (level === "full") all = all.concat(this.blazeLight(A, nearBoxes));
    return this.nms(all, 0.4);
  },

  _canvas(key, w, h) {
    const c = this[key] || (this[key] = document.createElement("canvas"));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    return c;
  },

  /* 解析キャンバスの領域(sx,sy,sw,sh)を≤512pxに縮小して検出。正規化座標で返す */
  _region(src, sx, sy, sw, sh) {
    const scale = Math.min(1, 640 / Math.max(sw, sh));
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

  /* n×nタイルのうち phase 番から count 枚だけ検出(再生中の巡回deep用) */
  _gridSubset(A, n, size, phase, count) {
    let dets = [];
    const tw = Math.round(A.width * size), th = Math.round(A.height * size);
    const step = n > 1 ? (1 - size) / (n - 1) : 0;
    for (let k = 0; k < count; k++) {
      const idx = (phase + k) % (n * n);
      const ix = idx % n, iy = Math.floor(idx / n);
      dets = dets.concat(this._region(A,
        Math.round(ix * step * A.width), Math.round(iy * step * A.height), tw, th));
    }
    return dets;
  },
  _rotPhase: 0,

  /* source: VideoFrame | <video> | canvas。rawW/rawH は回転前寸法、rotで表示向きに直して検出。
     mode: "light"=全体+2×2(プレビュー/実時間用) "deep"=+4×4+6×6タイルで小さな顔も拾う
     (BlazeFaceはタイル幅の約8%未満の顔を見逃すため、段階的にズームして検出する) */
  onSource(source, rawW, rawH, rot, mode, nearBoxes) {
    if (!this.detector) return [];
    const swapped = rot === 90 || rot === 270;
    const dispW = swapped ? rawH : rawW, dispH = swapped ? rawW : rawH;
    const s = Math.min(1, 1920 / Math.max(dispW, dispH));
    const aw = Math.max(2, Math.round(dispW * s)), ah = Math.max(2, Math.round(dispH * s));
    const A = this._canvas("_analysis", aw, ah);
    MZ.drawFrame(A.getContext("2d"), source, rawW, rawH, rot, aw, ah);
    let dets = this._region(A, 0, 0, aw, ah);
    dets = dets.concat(this._grid(A, 2, 0.6));
    if (mode === "deep") {
      // 時間より精度重視: 4×4に加えて6×6の細タイルで、さらに小さな顔まで拾う
      dets = dets.concat(this._grid(A, 4, 0.3));
      dets = dets.concat(this._grid(A, 6, 0.2));
    } else if (mode === "rotate") {
      // 再生中の巡回deep: 4×4のうち4タイルずつ順番に回し、4回の検出で全域をカバー
      dets = dets.concat(this._gridSubset(A, 4, 0.3, this._rotPhase, 4));
      this._rotPhase = (this._rotPhase + 4) % 16;
    }
    let out = this.nms(dets, 0.45);
    // 2段階信頼度: 0.3以上は無条件採用、0.2〜0.3は追跡中の顔の近くだけ採用
    // (しきい値を下げつつ誤検出を抑える。行進で小さくなった顔を粘って拾う)
    out = out.filter(d =>
      d.score >= 0.3 || (nearBoxes || []).some(nb => MZ.iou(nb, d) > 0.2));
    return out;
  },

  /* 読み込み直後の高精度スキャン: YuNetで全体+タイルをじっくり走査する。
     専用スナップショットに対して行い、進捗コールバックを返す */
  async initialScan(source, rawW, rawH, rot, onProgress) {
    if (!this.detector && !MZ.yunet.session) return [];
    const swapped = rot === 90 || rot === 270;
    const dispW = swapped ? rawH : rawW, dispH = swapped ? rawW : rawH;
    const s = Math.min(1, 1920 / Math.max(dispW, dispH));
    const aw = Math.max(2, Math.round(dispW * s)), ah = Math.max(2, Math.round(dispH * s));
    const A = this._canvas("_initSnap", aw, ah);   // 専用スナップショット(通常検出と干渉しない)
    MZ.drawFrame(A.getContext("2d"), source, rawW, rawH, rot, aw, ah);
    return this.yunetScan(A, "full", null, onProgress);
  },

  /* タップ地点の周辺だけを高倍率で検出(手動追加の一次候補)。
     YuNetを優先し、無ければBlazeFace。tapX/tapY は表示向きの正規化座標 */
  async probeAt(source, rawW, rawH, rot, tapX, tapY) {
    if (!this.detector && !MZ.yunet.session) return null;
    const A = this.analysisOf(source, rawW, rawH, rot);
    const rw = 0.28;
    const sx = Math.max(0, Math.min(1 - rw, tapX - rw / 2));
    const sy = Math.max(0, Math.min(1 - rw, tapY - rw / 2));
    let dets;
    if (MZ.yunet.session) {
      const s = Math.round(rw * Math.max(A.width, A.height));
      dets = await MZ.yunet.scan(A, [{
        sx: Math.round(sx * A.width), sy: Math.round(sy * A.height), s }], null);
    } else {
      dets = this._region(A,
        Math.round(sx * A.width), Math.round(sy * A.height),
        Math.round(rw * A.width), Math.round(rw * A.height));
    }
    let best = null, bestD = 0.1;  // タップから半径10%以内のみ
    for (const d of dets) {
      const dist = Math.hypot(d.x + d.w / 2 - tapX, d.y + d.h / 2 - tapY);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  },
};
