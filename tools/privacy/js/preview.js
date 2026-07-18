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
    this.scenecut = this.scenecut || new MZ.SceneCut();
    this.scenecut.reset();
    this.lastYunetTime = 0;
    this.detectBusy = false;
    this.boxes = [];
    this.lastDetectAt = -1;
    // 高精度スキャンはここでは始めない。範囲が決まり、その先頭フレームが
    // 実際に表示されてから MZ.preview.startInitialScan() で開始する
    this.pendingInit = false;
    this.initRunning = false;
    this.initProgress = 0;
    this.imageDirty = true;   // 写真は検出を一度だけ走らせるフラグ
    cancelAnimationFrame(this.raf);
    const loop = () => { this.drawOnce(); this.raf = requestAnimationFrame(loop); };
    loop();
  },

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; },

  /* 高精度スキャンの予約。実行は描画ループ側(検出モデルの準備完了を待つため) */
  startInitialScan() {
    const clip = MZ.S.clip;
    if (!clip || clip.kind !== "video") return;
    this.pendingInit = true;
  },

  drawOnce() {
    const clip = MZ.S.clip;
    if (!clip) return;
    if (clip.kind === "image") return this.drawImageOnce(clip);
    if (!clip.video || clip.video.readyState < 2) return;
    const v = clip.video, W = this.canvas.width, H = this.canvas.height;
    // 作業範囲の終わりで止める(実時間書き出し中はexporterが制御)
    if (!MZ.exporter.running && clip.duration > MZ_LIMITS.maxRangeSec) {
      const end = MZ.rangeEnd();
      if (v.currentTime > end + 0.05) { v.pause(); v.currentTime = end; }
    }
    // 範囲が決まった直後に1回だけ、時間をかけた高精度スキャンで小さな顔まで拾う
    if (this.pendingInit && MZ.detect.detector && !MZ.exporter.running) void this._runInitialScan(v);
    // 検出は約80ms間隔+シーク時。YuNet(非同期)が走っている間はトラッカーの予測が埋める
    const t = v.currentTime;
    const due = (MZ.exporter.running
      || Math.abs(t - this.lastDetectAt) > 0.001 && (performance.now() - this.lastDetectTime > 80))
      && !this.detectBusy
      && !(this.initRunning && v.paused && !MZ.exporter.running);   // 停止中は高精度スキャンと重複させない
    if (MZ.detect.detector && due) void this._runDetect(v, t);
    MZ.drawFrame(this.ctx, v, v.videoWidth, v.videoHeight, 0, W, H);
    const all = this.boxes.concat(MZ.S.manualBoxes);
    MZ.mosaic.apply(this.ctx, W, H, all, MZ.S);
    this.drawRings(all, W, H);
  },

  /* 1回ぶんの検出(非同期)。シーン/カメラ切替を見つけたら追跡を捨てて高精度で再検出。
     停止中=高精度(YuNet全体+タイル) 再生中=BlazeFace軽量+0.4秒ごとにYuNet全体を混ぜる */
  async _runDetect(v, t) {
    this.detectBusy = true;
    try {
      const A = MZ.detect.analysisOf(v, v.videoWidth, v.videoHeight, 0);
      const isCut = this.scenecut && this.scenecut.check(A);
      const paused = v.paused && !MZ.exporter.running;
      if (isCut) {
        this.tracker.reset();   // 切替後は古い追跡を信じない
        MZ.log("scene cut → re-detect");
      }
      const near = this.tracker.tracks.map(tr => tr.box);
      let dets;
      const now = performance.now();
      if (isCut || paused) {
        dets = await MZ.detect.yunetScan(A, "full", near);
        this.lastYunetTime = now;
      } else if (now - this.lastYunetTime > 400) {
        dets = MZ.detect.blazeLight(A, near)
          .concat(await MZ.detect.yunetScan(A, "l0", near));
        dets = MZ.detect.nms(dets, 0.4);
        this.lastYunetTime = now;
      } else {
        dets = MZ.detect.blazeLight(A, near);
      }
      // 検出中に別の素材へ切り替わっていたら捨てる
      if (!MZ.S.clip || MZ.S.clip.video !== v) return;
      this.boxes = this.tracker.update(MZ.dropSuppressed(dets), t, MZ.S.hold).active;
      this.lastDetectAt = t;
      this.lastDetectTime = performance.now();
    } catch (e) {
      MZ.log("detect error:", e && e.message);
      this.lastDetectTime = performance.now();   // エラー連打を防ぐ
    } finally {
      this.detectBusy = false;
    }
  },

  /* 読み込み直後の1回だけ: 細かいタイルまで時間をかけて検出し、追跡の種にする */
  async _runInitialScan(v) {
    this.pendingInit = false;
    this.initRunning = true;
    this.initProgress = 0;
    const t = v.currentTime;
    try {
      const dets = MZ.dropSuppressed(await MZ.detect.initialScan(
        v, v.videoWidth, v.videoHeight, 0, p => { this.initProgress = p; }));
      // スキャン中に大きく再生が進んでいたら捨てる(通常の検出に任せる)
      if (MZ.S.clip && MZ.S.clip.video === v && Math.abs(v.currentTime - t) < 1) {
        this.boxes = this.tracker.update(dets, t, MZ.S.hold).active;
        this.lastDetectAt = t;
        this.lastDetectTime = performance.now();
      }
      MZ.log(`initial scan: ${dets.length} face(s)`);
    } catch (e) {
      MZ.log("initial scan failed:", e && e.message);
    } finally {
      this.initRunning = false;
    }
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

  /* 写真: 検出は初回だけ(YuNet高精度・非同期)。マスク描画は毎フレーム */
  drawImageOnce(clip) {
    const W = this.canvas.width, H = this.canvas.height;
    if (MZ.detect.detector && this.imageDirty && !this.detectBusy) {
      this.imageDirty = false;
      this.detectBusy = true;
      const A = MZ.detect.analysisOf(clip.img, clip.width, clip.height, 0);
      MZ.detect.yunetScan(A, "full", null).then(dets => {
        if (MZ.S.clip === clip) this.boxes = MZ.dropSuppressed(dets);
      }).catch(e => MZ.log("photo detect error:", e && e.message))
        .finally(() => { this.detectBusy = false; });
    }
    MZ.drawFrame(this.ctx, clip.img, clip.width, clip.height, 0, W, H);
    const all = this.boxes.concat(MZ.S.manualBoxes);
    MZ.mosaic.apply(this.ctx, W, H, all, MZ.S);
    this.drawRings(all, W, H);
  },
};
