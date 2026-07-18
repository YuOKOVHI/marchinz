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
    // 作業範囲の終わりで止める(実時間書き出し中はexporterが制御)
    if (!MZ.exporter.running && clip.duration > 60) {
      const end = MZ.rangeEnd();
      if (v.currentTime > end + 0.05) { v.pause(); v.currentTime = end; }
    }
    // 検出は約80ms間隔+シーク時(書き出し中の実時間録画は毎フレーム)。速度予測トラッカーが間を埋める
    const t = v.currentTime;
    const due = MZ.exporter.running
      || Math.abs(t - this.lastDetectAt) > 0.001 && (performance.now() - this.lastDetectTime > 80);
    if (MZ.detect.detector && due) {
      // 一時停止中=全タイルdeep / 再生中=巡回deep(4タイルずつ回して数回で全域)
      const mode = !MZ.S.deep ? "light"
        : (v.paused && !MZ.exporter.running) ? "deep" : "rotate";
      const near = this.tracker.tracks.map(tr => tr.box);
      const dets = MZ.detect.onSource(v, v.videoWidth, v.videoHeight, 0, mode, near);
      this.boxes = this.tracker.update(dets, t, MZ.S.hold).active;
      this.lastDetectAt = t;
      this.lastDetectTime = performance.now();
    }
    MZ.drawFrame(this.ctx, v, v.videoWidth, v.videoHeight, 0, W, H);
    const all = this.boxes.concat(MZ.S.manualBoxes);
    MZ.mosaic.apply(this.ctx, W, H, all, MZ.S);
    this.drawRings(all, W, H);
  },

  /* 認識・手動マスクの位置を赤い丸線で示す(①②ステップのみ。
     実時間書き出しはこのcanvasを録画するため、書き出し中は描かない) */
  drawRings(all, W, H) {
    if (MZ.exporter.running || MZ.S.step === 3) return;
    const ctx = this.ctx;
    const feather = MZ.S.type === "mosaic" ? 0.12 : 0.22;
    const grow = MZ.S.expand / 100 + feather;
    ctx.save();
    ctx.strokeStyle = "rgba(230, 40, 60, 0.95)";
    ctx.lineWidth = Math.max(1.5, W / 480);
    for (const b of all) {
      const manual = MZ.S.manualBoxes.includes(b);
      ctx.setLineDash(manual ? [6, 4] : []);   // 手動追加は破線で区別
      const rx = (b.w * (1 + grow)) / 2 * W;
      const ry = (b.h * (1 + grow)) / 2 * H;
      ctx.beginPath();
      ctx.ellipse((b.x + b.w / 2) * W, (b.y + b.h / 2) * H, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },

  /* 写真: 検出は初回とdeep切替時だけ。マスク描画は毎フレーム(濃さ/種類の変更を即反映) */
  drawImageOnce(clip) {
    const W = this.canvas.width, H = this.canvas.height;
    if (MZ.detect.detector && this.imageDirty) {
      this.boxes = MZ.detect.onSource(clip.img, clip.width, clip.height, 0, MZ.S.deep ? "deep" : "light");
      this.imageDirty = false;
    }
    MZ.drawFrame(this.ctx, clip.img, clip.width, clip.height, 0, W, H);
    const all = this.boxes.concat(MZ.S.manualBoxes);
    MZ.mosaic.apply(this.ctx, W, H, all, MZ.S);
    this.drawRings(all, W, H);
  },
};
