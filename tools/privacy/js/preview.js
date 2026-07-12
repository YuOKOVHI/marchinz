"use strict";
/* ============ プレビュー: <video>を毎フレーム描画し、その場でマスクを重ねる ============
   実時間フォールバック書き出しの録画元キャンバスも兼ねる(長辺≤1280の実解像度) */

MZ.preview = {
  canvas: null, ctx: null,
  tracker: null,
  boxes: [],
  lastDetectAt: -1,
  lastDetectTime: 0,
  raf: 0,

  init() {
    this.canvas = document.getElementById("previewCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.tracker = new MZ.Tracker();
  },

  setClip(clip) {
    const s = Math.min(1, 1280 / Math.max(clip.width, clip.height));
    this.canvas.width = Math.max(2, Math.round(clip.width * s));
    this.canvas.height = Math.max(2, Math.round(clip.height * s));
    this.tracker.reset();
    this.boxes = [];
    this.lastDetectAt = -1;
    this.imageDirty = true;   // 写真は検出を一度だけ走らせるフラグ
    cancelAnimationFrame(this.raf);
    const loop = () => { this.drawOnce(); this.raf = requestAnimationFrame(loop); };
    loop();
  },

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; },

  drawOnce() {
    const clip = MZ.S.clip;
    if (!clip) return;
    if (clip.kind === "image") return this.drawImageOnce(clip);
    if (!clip.video || clip.video.readyState < 2) return;
    const v = clip.video, W = this.canvas.width, H = this.canvas.height;
    // 検出は約130ms間隔+シーク時(書き出し中の実時間録画は毎フレーム)
    const t = v.currentTime;
    const due = MZ.exporter.running
      || Math.abs(t - this.lastDetectAt) > 0.001 && (performance.now() - this.lastDetectTime > 130);
    if (MZ.detect.detector && due) {
      // 再生中は軽量モード、一時停止中は書き出しと同じ精度で確認できる
      const mode = (MZ.S.deep && v.paused && !MZ.exporter.running) ? "deep" : "light";
      const dets = MZ.detect.onSource(v, v.videoWidth, v.videoHeight, 0, mode);
      this.boxes = this.tracker.update(dets, t, MZ.S.hold).active;
      this.lastDetectAt = t;
      this.lastDetectTime = performance.now();
    }
    MZ.drawFrame(this.ctx, v, v.videoWidth, v.videoHeight, 0, W, H);
    MZ.mosaic.apply(this.ctx, W, H, this.boxes, MZ.S);
  },

  /* 写真: 検出は初回とdeep切替時だけ。マスク描画は毎フレーム(濃さ/種類の変更を即反映) */
  drawImageOnce(clip) {
    const W = this.canvas.width, H = this.canvas.height;
    if (MZ.detect.detector && this.imageDirty) {
      this.boxes = MZ.detect.onSource(clip.img, clip.width, clip.height, 0, MZ.S.deep ? "deep" : "light");
      this.imageDirty = false;
    }
    MZ.drawFrame(this.ctx, clip.img, clip.width, clip.height, 0, W, H);
    MZ.mosaic.apply(this.ctx, W, H, this.boxes, MZ.S);
  },
};
