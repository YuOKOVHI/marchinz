"use strict";
/* ============ プレビュー: <video>を毎フレームWebGLワープして表示 ============
   実時間フォールバック書き出しの録画元キャンバスも兼ねる(長辺≤1280) */

RA.preview = {
  canvas: null, renderer: null, raf: 0,

  init() {
    this.canvas = document.getElementById("previewCanvas");
    this.renderer = new RA.WarpRenderer(this.canvas);
  },

  setClip(clip) {
    const s = Math.min(1, 1280 / Math.max(clip.width, clip.height));
    const W = Math.max(2, Math.round(clip.width * s));
    const H = Math.max(2, Math.round(clip.height * s));
    this.renderer.setSize(W, H);
    // ウォーターマーク: プレビューはWebGL直描きのためDOMオーバーレイで載せる
    if (window.MZWM) MZWM.overlay(this.canvas.parentElement, W, H);
    cancelAnimationFrame(this.raf);
    clearInterval(this.iv);
    const loop = () => { this.drawOnce(); this.raf = requestAnimationFrame(loop); };
    loop();
    // rAFが止まる環境(バックグラウンドタブ等)の保険。実時間録画の絵が止まるのを防ぐ
    this.iv = setInterval(() => {
      if (performance.now() - this._lastDraw > 200) this.drawOnce();
    }, 100);
  },

  stop() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.iv);
    this.raf = 0;
  },

  drawOnce() {
    const clip = RA.S.clip;
    if (!clip || !clip.video || clip.video.readyState < 2) return;
    // 四隅編集中と「元を見る」長押し中は無補正のソースを表示する
    // (ハンドルはソース座標なので、補正後の絵に重ねるとズレて操作できない)
    const off = RA.S.compare || RA.S.editCorners;
    const M = RA.H.buildMatrix({
      corners: RA.S.corners || RA.presetCorners(),
      sMain: off ? 0 : (RA.S.viewMode === "top" ? 1 : RA.S.sMain),
      sPersp: off ? 0 : (RA.S.viewMode === "top" ? RA.S.sTop : 0),
      tilt: off ? 0 : RA.S.tilt,
      zoom: off ? 1 : RA.S.zoom,
      panY: off ? 0 : RA.S.panY,
      dispW: clip.width, dispH: clip.height,
    });
    this.renderer.upload(clip.video);
    this.renderer.render(M, off ? null : RA.fx());
    this._lastDraw = performance.now();
  },
};
