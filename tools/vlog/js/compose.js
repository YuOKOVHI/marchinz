"use strict";
/* ============ MarchinZ Vlog: 合成(プレビューと書き出しの共通描画) ============
   MV.compose(ctx, W, H, t, resolveSrc) が「時刻tの完成画面」を1枚描く。
   プレビューは<video>要素を、書き出しはVideoFrameを resolveSrc で渡す。
   ここを二重実装しないことが Phase 1.5 の目的そのもの
   (プレビューで見たものがそのまま書き出される)。

   resolveSrc(req) の契約:
     req = { clipId, srcSec }   素材IDと素材内の秒
     戻り = { source, w, h, rotation } | null   null なら黒のまま */

/* 時刻tのセグメント番号(二分探索)。t が範囲外なら端に丸める */
MV.segIndexAt = (plan, t) => {
  const segs = plan.segments;
  if (t <= 0) return 0;
  if (t >= plan.totalSec) return segs.length - 1;
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t0 <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
};

/* 変形描画の共通部(Switcher layout.js の drawSource と同じ作法・回転対応)。
   fit="cover"=画面を埋める(はみ出しは切る) / "contain"=全体を収める */
MV._drawTransformed = (ctx, src, W, H, fit) => {
  const rot = (((src.rotation || 0) % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const sw = swapped ? src.h : src.w;
  const sh = swapped ? src.w : src.h;
  const scale = fit === "contain" ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
  const vw = W / scale, vh = H / scale;
  const sx = (sw - vw) * 0.5, sy = (sh - vh) * 0.5;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  ctx.translate(-sx * scale, -sy * scale);
  ctx.scale(scale, scale);
  ctx.translate(sw / 2, sh / 2);
  if (rot) ctx.rotate(rot * Math.PI / 180);
  ctx.drawImage(src.source, -src.w / 2, -src.h / 2, src.w, src.h);
  ctx.restore();
};

/* 1フレーム描画。縦横が食い違う素材(スマホの縦動画を横で使う・その逆)は、
   cover で切り抜くと顔や頭が切れる(中学広報の実体験指摘 2026-07-20)。
   アスペクト比の食い違いが1.5倍を超えたら「ぼかし背景+全体表示」に自動で
   切り替える。ぼかしは ctx.filter に頼らず縮小→拡大で作る
   (iOS Safari の filter 対応差を踏まない・どの環境でも同じ見た目) */
MV.FIT_BLUR_RATIO = 1.5;
MV.drawFrame = (ctx, src, W, H, alpha = 1) => {
  if (!src || !src.w || !src.h) return;
  const rot = (((src.rotation || 0) % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const sw = swapped ? src.h : src.w;
  const sh = swapped ? src.w : src.h;
  const srcAspect = sw / sh, outAspect = W / H;
  const ratio = Math.max(srcAspect / outAspect, outAspect / srcAspect);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (ratio > MV.FIT_BLUR_RATIO) {
    // 背景: 1/24に縮小して描き、全面へ引き伸ばす(強いぼかしと同等)
    const b = MV._blurCv || (MV._blurCv = document.createElement("canvas"));
    const bw = Math.max(2, Math.round(W / 24)), bh = Math.max(2, Math.round(H / 24));
    if (b.width !== bw) b.width = bw;
    if (b.height !== bh) b.height = bh;
    const bctx = b.getContext("2d");
    MV._drawTransformed(bctx, src, bw, bh, "cover");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(b, 0, 0, W, H);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";   // 背景を沈めて前景を立てる
    ctx.fillRect(0, 0, W, H);
    MV._drawTransformed(ctx, src, W, H, "contain");
  } else {
    MV._drawTransformed(ctx, src, W, H, "cover");
  }
  ctx.restore();
};

/* セグメントの「絵」を1枚描く(ディゾルブは呼び出し側が2枚重ねる) */
MV.drawSegment = (ctx, W, H, plan, seg, t, resolveSrc, alpha = 1) => {
  if (seg.kind === "title") {
    MV.drawTitleCard(ctx, W, H, plan, (t - seg.t0) / (seg.t1 - seg.t0), alpha);
    return;
  }
  if (seg.kind === "end") {
    ctx.save();
    ctx.globalAlpha = alpha;
    MV.logo.drawEnd(ctx, W, H, (t - seg.t0) / (seg.t1 - seg.t0), plan.endColor);
    ctx.restore();
    return;
  }
  /* video: bRoll の窓の間は絵だけ差し替える(音は preview/exporter 側で継続) */
  const br = (seg.bRolls || []).find(w => t >= w.tA && t < w.tB);
  const req = br
    ? { clipId: br.clipId, srcSec: br.srcIn + (t - br.tA) }
    : { clipId: seg.clipId, srcSec: seg.srcIn + (t - seg.t0) };
  const src = resolveSrc(req);
  if (src) MV.drawFrame(ctx, src, W, H, alpha);
};

/* タイトルカード: 単色地にロゴ(無ければ団体名)。0→0.3フェードイン */
MV.drawTitleCard = (ctx, W, H, plan, progress, alpha = 1) => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = plan.endColor === "white" ? "#ffffff" : "#0b0f14";
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = alpha * Math.min(1, progress / 0.3);
  const lg = MV.S.logo;
  const fg = plan.endColor === "white" ? "#0f2138" : "#ffffff";
  if (lg && lg.out) {
    const tw = W * 0.28;
    const th = tw * (lg.h / lg.w);
    ctx.drawImage(lg.out, (W - tw) / 2, H / 2 - th / 2 - (MV.S.orgName ? H * 0.04 : 0), tw, th);
    if (MV.S.orgName) {
      ctx.fillStyle = fg;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `600 ${Math.round(W * 0.028)}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif`;
      ctx.fillText(MV.S.orgName, W / 2, H / 2 + th / 2 + H * 0.02);
    }
  } else if (MV.S.orgName) {
    ctx.fillStyle = fg;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(W * 0.05)}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif`;
    ctx.fillText(MV.S.orgName, W / 2, H / 2);
  }
  ctx.restore();
};

/* ---------- 本体 ---------- */
MV.compose = (ctx, W, H, t, resolveSrc) => {
  const plan = MV.S.plan;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (!plan) return;

  const i = MV.segIndexAt(plan, t);
  const seg = plan.segments[i];

  /* ディゾルブ: 入りの transIn 秒は前セグメントの絵に現セグメントを重ねる。
     前セグメントの絵は自分の t1 を越えて伸びる(hold-last-frame が支える) */
  if (i > 0 && seg.transIn > 0 && t - seg.t0 < seg.transIn) {
    const prev = plan.segments[i - 1];
    MV.drawSegment(ctx, W, H, plan, prev, t, resolveSrc, 1);
    MV.drawSegment(ctx, W, H, plan, seg, t, resolveSrc, (t - seg.t0) / seg.transIn);
  } else {
    MV.drawSegment(ctx, W, H, plan, seg, t, resolveSrc, 1);
  }

  /* 右上のロゴ(バグ)。最後のシーン(エンドカード)以外はずっと表示する
     (2026-07-21 優さん指示)。タイトルカードは中央に大きく出すので重ねない */
  if (seg.kind === "video" && MV.S.logo && MV.S.logo.out) {
    MV.logo.drawBug(ctx, W, H);
  }

  /* ゲスト透かし(プレビューにも書き出しにも同じに載る) */
  if (window.MZWM) MZWM.draw(ctx, W, H);
};
