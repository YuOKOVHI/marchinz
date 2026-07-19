"use strict";
/* ============ レイアウト定義+コンポジタ(プレビュー/書き出し共用) ============ */

MC.LAYOUTS = {
  v2:     { name: "2分割 縦積み",  n: 2, rects: [{x:0,y:0,w:1,h:.5},{x:0,y:.5,w:1,h:.5}] },
  v3:     { name: "3分割 縦積み",  n: 3, rects: [{x:0,y:0,w:1,h:1/3},{x:0,y:1/3,w:1,h:1/3},{x:0,y:2/3,w:1,h:1/3}] },
  h2:     { name: "2分割 横並び",  n: 2, rects: [{x:0,y:0,w:.5,h:1},{x:.5,y:0,w:.5,h:1}] },
  h3:     { name: "3分割 横並び",  n: 3, rects: [{x:0,y:0,w:1/3,h:1},{x:1/3,y:0,w:1/3,h:1},{x:2/3,y:0,w:1/3,h:1}] },
  big2:   { name: "大1+小2",       n: 3, rects: [{x:0,y:0,w:1,h:2/3},{x:0,y:2/3,w:.5,h:1/3},{x:.5,y:2/3,w:.5,h:1/3}] },
  single: { name: "1画面",         n: 1, rects: [{x:0,y:0,w:1,h:1}] },
  switch: { name: "スイッチング(自動カット割)", n: 0, type: "switch" },
  wipe:   { name: "ワイプ(メイン+小窓)",       n: 0, type: "wipe" },
};

/* 時刻tのカット状態: {cur, prev, blend} blend<1ならディゾルブ中 */
MC.cutAt = t => {
  const cl = MC.S.cutList;
  if (!cl.length) {
    const c = MC.getClip(MC.S.audioClipId) || MC.S.clips[0];
    return { cur: c ? c.id : null, prev: null, blend: 1 };
  }
  let i = 0;
  while (i + 1 < cl.length && cl[i + 1].t <= t) i++;
  const e = cl[i];
  if (i > 0 && e.trans === "dissolve" && e.dur > 0 && t - e.t < e.dur) {
    return { cur: e.clipId, prev: cl[i - 1].clipId, blend: (t - e.t) / e.dur };
  }
  return { cur: e.clipId, prev: null, blend: 1 };
};

/* ソースを rect に cover-crop で描画。
   src = { source: <video>|VideoFrame|canvas, w, h, rotation }
   w/h はソースの「素の」ピクセル寸法(回転前)。<video>はブラウザが回転適用済みなので rotation=0 で渡す。
   pan: 0〜1 横方向の見せ位置(0=左端, 1=右端) */
MC.drawSource = (ctx, src, rx, ry, rw, rh, pan = 0.5) => {
  const rot = (((src.rotation || 0) % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const sw = swapped ? src.h : src.w;   // 表示上の寸法
  const sh = swapped ? src.w : src.h;
  if (!sw || !sh) return;
  const scale = Math.max(rw / sw, rh / sh);
  const vw = rw / scale, vh = rh / scale;          // 見える範囲(表示座標)
  const sx = (sw - vw) * pan, sy = (sh - vh) * 0.5;
  ctx.save();
  ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
  ctx.translate(rx - sx * scale, ry - sy * scale);
  ctx.scale(scale, scale);
  ctx.translate(sw / 2, sh / 2);
  if (rot) ctx.rotate(rot * Math.PI / 180);
  if (src.fineRot) {
    // 水平補正: 微回転+隅が見えないズーム
    const th = Math.abs(src.fineRot);
    const z = Math.max(
      (sw * Math.cos(th) + sh * Math.sin(th)) / sw,
      (sw * Math.sin(th) + sh * Math.cos(th)) / sh);
    ctx.rotate(src.fineRot);
    ctx.scale(z, z);
  }
  ctx.drawImage(src.source, -src.w / 2, -src.h / 2, src.w, src.h);
  ctx.restore();
};

/* クリップの仕上げ(カラーマッチ/フィルター/水平)をsrcに適用 */
MC.prepSrc = (clip, src) => {
  if (!src) return null;
  if (MC.color && MC.color.active(clip)) src = MC.color.process(clip, src);
  if (MC.S.horizonOn && clip.rot) src = Object.assign({}, src, { fineRot: clip.rot * Math.PI / 180 });
  return src;
};

/* フルフレーム描画(なければ黒) */
MC.drawFull = (ctx, W, H, clipId, resolveSrc, alpha = 1) => {
  const clip = MC.getClip(clipId);
  const src = clip ? MC.prepSrc(clip, resolveSrc(clipId)) : null;
  if (!src) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  MC.drawSource(ctx, src, 0, 0, W, H, clip.pan);
  ctx.restore();
};

/* 境界線の実効太さ(1080px基準の指定pxを出力解像度に比例) */
MC.borderPx = (W, H) => MC.S.borderW * Math.max(1, Math.min(W, H) / 1080);

/* ワイプ小窓を1つ描く(角にぴったり+枠線) */
MC.drawPip = (ctx, W, H, clipId, pos, resolveSrc) => {
  const pipClip = MC.getClip(clipId);
  if (!pipClip) return;
  const src = MC.prepSrc(pipClip, resolveSrc(pipClip.id));
  if (!src) return;
  const s = MC.S.wipeSize;
  const pw = W * s, ph = pw * 9 / 16;
  const px = pos.includes("l") ? 0 : W - pw;   // 角にぴったり
  const py = pos.includes("t") ? 0 : H - ph;
  MC.drawSource(ctx, src, px, py, pw, ph, pipClip.pan);
  if (MC.S.borderOn && MC.S.borderW > 0) {
    const lw = MC.borderPx(W, H);
    ctx.save();
    ctx.strokeStyle = MC.S.borderColor;
    ctx.lineWidth = lw;
    ctx.strokeRect(px + lw / 2, py + lw / 2, pw - lw, ph - lw);  // 枠線は窓の内側に
    ctx.restore();
  }
};

/* 全体を合成。t=グローバル秒(スイッチング/ワイプで使用)。
   resolveSrc(clipId) → src|null(nullなら黒+ラベル) */
MC.drawComposite = (ctx, W, H, t, resolveSrc) => {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const L = MC.LAYOUTS[MC.S.layoutId];

  if (L.type === "switch" || L.type === "wipe") {
    const cut = MC.cutAt(t);
    if (cut.prev != null && cut.blend < 1) {
      MC.drawFull(ctx, W, H, cut.prev, resolveSrc, 1);
      MC.drawFull(ctx, W, H, cut.cur, resolveSrc, cut.blend);
    } else {
      MC.drawFull(ctx, W, H, cut.cur, resolveSrc, 1);
    }
    if (L.type === "wipe") {
      const id1 = MC.S.wipeClipId != null ? MC.S.wipeClipId
        : (MC.S.clips.find(c => c.id !== cut.cur) || {}).id;
      if (id1 != null) MC.drawPip(ctx, W, H, id1, MC.S.wipePos, resolveSrc);
      if (MC.S.wipeClipId2 != null && MC.S.wipeClipId2 !== id1) {
        MC.drawPip(ctx, W, H, MC.S.wipeClipId2, MC.S.wipePos2, resolveSrc);
      }
    }
    if (window.MZWM) MZWM.draw(ctx, W, H);   // ウォーターマーク(プレビュー/書き出し共通)
    return;
  }

  L.rects.forEach((r, i) => {
    const rx = r.x * W, ry = r.y * H, rw = r.w * W, rh = r.h * H;
    const clipId = MC.S.slots[i];
    const clip = clipId != null ? MC.getClip(clipId) : null;
    const src = clip ? MC.prepSrc(clip, resolveSrc(clip.id)) : null;
    if (src) {
      MC.drawSource(ctx, src, rx, ry, rw, rh, clip.pan);
    } else {
      ctx.fillStyle = "#15171d";
      ctx.fillRect(rx + 2, ry + 2, rw - 4, rh - 4);
      ctx.fillStyle = "#4a5060";
      ctx.font = `${Math.round(Math.min(rw, rh) * 0.08)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(clip ? "（範囲外）" : `カメラ ${i + 1}`, rx + rw / 2, ry + rh / 2);
      ctx.fillStyle = "#000";
    }
  });
  // 境界線: 分割セルの区切り(1画面では引かない)
  if (MC.S.borderOn && MC.S.borderW > 0 && L.rects.length > 1) {
    ctx.save();
    ctx.strokeStyle = MC.S.borderColor;
    ctx.lineWidth = MC.borderPx(W, H);
    for (const r of L.rects) ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
    ctx.restore();
  }
  if (window.MZWM) MZWM.draw(ctx, W, H);   // ウォーターマーク(プレビュー/書き出し共通)
};
