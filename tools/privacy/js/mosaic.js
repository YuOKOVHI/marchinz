"use strict";
/* ============ マスク描画: 円形(楕円)+フェザーで馴染ませる ============
   Premiere Pro のブラー/モザイクエフェクトのように、顔を楕円形で覆い、
   縁はラジアルグラデーションのフェザーで背景に溶けさせる。
   type: mosaic(ピクセレート) / blur(多段縮小拡大のガウシアン風) / fill(黒) */

MZ.mosaic = {
  _tmp1: document.createElement("canvas"),
  _tmp2: document.createElement("canvas"),
  _face: document.createElement("canvas"),

  /* boxes: 正規化ボックス配列。opts: {type, strength(1-10), expand(0-100)} */
  apply(ctx, W, H, boxes, opts) {
    for (const b of boxes) {
      // expand + フェザーの余白ぶんまで広げた矩形(楕円の外接矩形)
      const feather = opts.type === "mosaic" ? 0.12 : 0.22;  // モザイクは輪郭を残し気味に
      const grow = opts.expand / 100 + feather;
      const ex = b.w * grow, ey = b.h * grow;
      const ux = (b.x - ex / 2) * W, uy = (b.y - ey / 2) * H;   // クリップ前(楕円定義用)
      const uw = (b.w + ex) * W, uh = (b.h + ey) * H;
      let x = Math.floor(ux), y = Math.floor(uy);
      let w = Math.ceil(uw), h = Math.ceil(uh);
      if (x < 0) { w += x; x = 0; }
      if (y < 0) { h += y; y = 0; }
      w = Math.min(W - x, w); h = Math.min(H - y, h);
      if (w < 2 || h < 2) continue;

      // ① 顔領域を加工用キャンバスへ
      const face = this._face, fc = face.getContext("2d");
      if (face.width !== w) face.width = w;
      if (face.height !== h) face.height = h;
      fc.clearRect(0, 0, w, h);

      if (opts.type === "fill") {
        fc.fillStyle = "#101014";
        fc.fillRect(0, 0, w, h);
      } else if (opts.type === "mosaic") {
        // 濃さ10→顔の横幅2ブロック、濃さ1→18ブロック
        const t1 = this._tmp1, c1 = t1.getContext("2d");
        const bw = Math.max(2, Math.round(20 - opts.strength * 1.8));
        const bh = Math.max(2, Math.round(bw * h / w));
        t1.width = bw; t1.height = bh;
        c1.imageSmoothingEnabled = true;
        c1.drawImage(ctx.canvas, x, y, w, h, 0, 0, bw, bh);
        fc.imageSmoothingEnabled = false;
        fc.drawImage(t1, 0, 0, bw, bh, 0, 0, w, h);
        fc.imageSmoothingEnabled = true;
      } else {
        // blur: 3段の縮小→拡大でガウシアン風の滑らかなぼかし(ctx.filter非対応環境でも動く)
        const f = 2 + opts.strength;  // 濃さ10→1/12
        const w1 = Math.max(2, Math.round(w / f)), h1 = Math.max(2, Math.round(h / f));
        const w2 = Math.max(2, Math.round(w1 / 2)), h2 = Math.max(2, Math.round(h1 / 2));
        const t1 = this._tmp1, c1 = t1.getContext("2d");
        const t2 = this._tmp2, c2 = t2.getContext("2d");
        t1.width = w1; t1.height = h1;
        c1.imageSmoothingEnabled = true;
        c1.drawImage(ctx.canvas, x, y, w, h, 0, 0, w1, h1);
        t2.width = w2; t2.height = h2;
        c2.imageSmoothingEnabled = true;
        c2.drawImage(t1, 0, 0, w1, h1, 0, 0, w2, h2);
        c1.clearRect(0, 0, w1, h1);
        c1.drawImage(t2, 0, 0, w2, h2, 0, 0, w1, h1);   // 中間へ戻し
        fc.imageSmoothingEnabled = true;
        fc.drawImage(t1, 0, 0, w1, h1, 0, 0, w, h);     // 最終拡大で滑らかに
      }

      // ② 楕円フェザーマスク(中心不透明→縁で透明)を destination-in で適用。
      //    楕円はクリップ前の矩形で定義し、画面端でも中心がズレないようにする
      const cx = ux + uw / 2 - x, cy = uy + uh / 2 - y;
      const rx = uw / 2, ry = uh / 2;
      const inner = Math.max(0.05, 1 - feather * 2.2);  // フェザー開始位置(半径比)
      fc.save();
      fc.globalCompositeOperation = "destination-in";
      fc.translate(cx, cy);
      fc.scale(rx, ry);   // 単位円 → 楕円
      const g = fc.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(inner, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      fc.fillStyle = g;
      fc.fillRect(-1.2, -1.2, 2.4, 2.4);
      fc.restore();

      // ③ 本体へ合成
      ctx.drawImage(face, x, y);
    }
  },
};
