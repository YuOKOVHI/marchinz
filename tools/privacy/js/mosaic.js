"use strict";
/* ============ マスク描画: モザイク / ぼかし / 黒塗り ============ */

MZ.mosaic = {
  _tmp1: document.createElement("canvas"),
  _tmp2: document.createElement("canvas"),

  /* boxes: 正規化ボックス配列。opts: {type, strength(1-10), expand(0-100)} */
  apply(ctx, W, H, boxes, opts) {
    for (const b of boxes) {
      const ex = b.w * opts.expand / 100, ey = b.h * opts.expand / 100;
      let x = Math.floor((b.x - ex / 2) * W), y = Math.floor((b.y - ey / 2) * H);
      let w = Math.ceil((b.w + ex) * W), h = Math.ceil((b.h + ey) * H);
      if (x < 0) { w += x; x = 0; }
      if (y < 0) { h += y; y = 0; }
      w = Math.min(W - x, w); h = Math.min(H - y, h);
      if (w < 2 || h < 2) continue;

      if (opts.type === "fill") {
        ctx.fillStyle = "#101014";
        ctx.fillRect(x, y, w, h);
        continue;
      }

      const t1 = this._tmp1, c1 = t1.getContext("2d");
      if (opts.type === "mosaic") {
        // 濃さ10→顔の横幅2ブロック、濃さ1→18ブロック
        const bw = Math.max(2, Math.round(20 - opts.strength * 1.8));
        const bh = Math.max(2, Math.round(bw * h / w));
        t1.width = bw; t1.height = bh;
        c1.imageSmoothingEnabled = true;
        c1.drawImage(ctx.canvas, x, y, w, h, 0, 0, bw, bh);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(t1, 0, 0, bw, bh, x, y, w, h);
        ctx.imageSmoothingEnabled = true;
      } else {  // blur: 2段の縮小→拡大(ctx.filter非対応環境でも動く)
        const f = 2 + opts.strength;  // 濃さ10→1/12
        const w1 = Math.max(2, Math.round(w / f)), h1 = Math.max(2, Math.round(h / f));
        const w2 = Math.max(2, Math.round(w1 / 2)), h2 = Math.max(2, Math.round(h1 / 2));
        t1.width = w1; t1.height = h1;
        c1.imageSmoothingEnabled = true;
        c1.drawImage(ctx.canvas, x, y, w, h, 0, 0, w1, h1);
        const t2 = this._tmp2, c2 = t2.getContext("2d");
        t2.width = w2; t2.height = h2;
        c2.imageSmoothingEnabled = true;
        c2.drawImage(t1, 0, 0, w1, h1, 0, 0, w2, h2);
        c1.clearRect(0, 0, w1, h1);
        c1.drawImage(t2, 0, 0, w2, h2, 0, 0, w1, h1);  // 中間サイズへ戻してから
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(t1, 0, 0, w1, h1, x, y, w, h);   // 最終拡大で滑らかに
      }
    }
  },
};
