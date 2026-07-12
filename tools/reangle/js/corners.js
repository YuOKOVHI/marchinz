"use strict";
/* ============ 床4隅のハンドルUI ============
   プレビューの上に重ねた透明canvasにハンドルを描き、Pointer Eventsでドラッグ。
   ドラッグ中は指の上にルーペ(2.5倍拡大+十字線)を出す。
   座標は正規化表示座標(0〜1)で RA.S.corners に保持する。 */

RA.corners = {
  overlay: null, ctx: null,
  loupe: null, loupeCtx: null,
  dragIdx: -1,
  HIT: 26,          // 当たり判定半径(CSSpx) ≒ 44pxタップ領域
  LOUPE: 120,       // ルーペ直径(CSSpx)
  ZOOM: 2.5,

  init() {
    this.overlay = document.getElementById("cornerOverlay");
    this.ctx = this.overlay.getContext("2d");
    this.loupe = document.getElementById("loupe");
    this.loupeCtx = this.loupe.querySelector("canvas").getContext("2d");
    this.loupeCtx.setTransform(2, 0, 0, 2, 0, 0);   // 実体240px / 表示120px(Retina)

    this.overlay.addEventListener("pointerdown", e => this._down(e));
    this.overlay.addEventListener("pointermove", e => this._move(e));
    this.overlay.addEventListener("pointerup", e => this._up(e));
    this.overlay.addEventListener("pointercancel", e => this._up(e));

    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => this.resize()).observe(this.overlay.parentElement);
    }
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 300));
  },

  /* プレビューの表示サイズにオーバーレイを合わせる(Retina対応) */
  resize() {
    const el = this.overlay;
    const cw = el.parentElement.clientWidth;
    const ch = el.parentElement.clientHeight;
    if (!cw || !ch) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(cw * dpr);
    el.height = Math.round(ch * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cw = cw; this._ch = ch;
    this.draw();
  },

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this._cw || 0, this._ch || 0);
    if (!RA.S.editCorners || !RA.S.clip || !RA.S.corners) return;
    const pts = RA.S.corners.map(c => ({ x: c.x * this._cw, y: c.y * this._ch }));

    // 床領域の面と輪郭
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(77, 163, 255, 0.10)";
    ctx.fill();
    ctx.strokeStyle = "rgba(77, 163, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ハンドル
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = i === this.dragIdx ? "rgba(77,163,255,0.35)" : "rgba(15,17,22,0.75)";
      ctx.fill();
      ctx.strokeStyle = "#4da3ff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#4da3ff";
      ctx.fill();
    });
  },

  _pos(e) {
    const r = this.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  },

  _down(e) {
    if (!RA.S.editCorners || !RA.S.corners) return;
    const m = this._pos(e);
    let best = -1, bestD = this.HIT;
    RA.S.corners.forEach((c, i) => {
      const d = Math.hypot(c.x * this._cw - m.x, c.y * this._ch - m.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) return;
    this.dragIdx = best;
    this.overlay.setPointerCapture(e.pointerId);
    const v = RA.S.clip && RA.S.clip.video;
    if (v && !v.paused) v.pause();
    this._move(e);
    e.preventDefault();
  },

  _move(e) {
    if (this.dragIdx < 0) return;
    const m = this._pos(e);
    // 床の隅が画面外にある映像もあるため、少しだけはみ出しを許す
    RA.S.corners[this.dragIdx] = {
      x: Math.max(-0.25, Math.min(1.25, m.x / this._cw)),
      y: Math.max(-0.25, Math.min(1.25, m.y / this._ch)),
    };
    this.draw();
    this._updateLoupe(e, m);
    e.preventDefault();
  },

  _up(e) {
    if (this.dragIdx < 0) return;
    this.dragIdx = -1;
    try { this.overlay.releasePointerCapture(e.pointerId); } catch (err) {}
    this.loupe.hidden = true;
    this.draw();
  },

  /* ルーペ: ソース映像のコーナー周辺を2.5倍で表示 */
  _updateLoupe(e, m) {
    const clip = RA.S.clip;
    if (!clip || !clip.video || clip.video.readyState < 2) return;
    const L = this.LOUPE;
    const c = RA.S.corners[this.dragIdx];
    const scaleX = clip.width / this._cw;         // オーバーレイCSSpx → 映像px
    const srcR = (L / this.ZOOM / 2) * scaleX;    // 映像px単位の取り込み半径
    const cx = c.x * clip.width, cy = c.y * clip.height;

    const lctx = this.loupeCtx;
    lctx.clearRect(0, 0, L, L);
    lctx.save();
    lctx.beginPath();
    lctx.arc(L / 2, L / 2, L / 2 - 1, 0, Math.PI * 2);
    lctx.clip();
    lctx.fillStyle = "#000";
    lctx.fillRect(0, 0, L, L);
    lctx.drawImage(clip.video, cx - srcR, cy - srcR, srcR * 2, srcR * 2, 0, 0, L, L);
    // 十字線
    lctx.strokeStyle = "rgba(77,163,255,0.9)";
    lctx.lineWidth = 1;
    lctx.beginPath();
    lctx.moveTo(L / 2, 8); lctx.lineTo(L / 2, L - 8);
    lctx.moveTo(8, L / 2); lctx.lineTo(L - 8, L / 2);
    lctx.stroke();
    lctx.restore();

    // 指の上60pxに配置(画面からはみ出さないようクランプ)
    const x = Math.max(4, Math.min(window.innerWidth - L - 4, e.clientX - L / 2));
    const y = Math.max(4, e.clientY - L - 60);
    this.loupe.style.left = `${x}px`;
    this.loupe.style.top = `${y}px`;
    this.loupe.hidden = false;
  },
};
