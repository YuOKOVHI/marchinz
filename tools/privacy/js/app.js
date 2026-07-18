"use strict";
/* ============ MzMosaic 状態管理+共通ヘルパー ============ */

window.MZ = {
  S: {
    clip: null,        // {file, name, url, video, duration, width, height}
    type: "blur",      // blur | mosaic | fill(既定はぼかし=Premiere風の柔らかい隠し方)
    strength: 6,       // 濃さ 1〜10
    expand: 30,        // 広げ幅 0〜100(%)
    hold: 1.0,         // 前後の追従 0〜5秒
    deep: true,        // 小さな顔も探す(タイル検出)
    res: "1080",       // "1080" | "orig"
    step: 1,           // ウィザード現在ステップ 1:確認 2:調整 3:保存
  },
  caps: { h264: null, aacEnc: null },
  testMode: /[?&]test/.test(location.search),
  debug: [],
};

MZ.log = (...a) => {
  console.log("[MZ]", ...a);
  MZ.debug.push(a.map(x => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
};

/* タイマー節流(非表示タブ)の影響を受けないyield */
MZ.yield = () => new Promise(r => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r();
  ch.port2.postMessage(0);
});

/* dequeueイベント待ち(タイムアウト付き) */
MZ.waitDequeue = (codec, ms = 100) => new Promise(r => {
  const h = () => { clearTimeout(tm); r(); };
  codec.addEventListener("dequeue", h, { once: true });
  const tm = setTimeout(() => { codec.removeEventListener("dequeue", h); r(); }, ms);
});

/* tasks-vision(ESMバンドル)の読み込み完了待ち */
MZ.visionReady = () =>
  window.MZVision
    ? Promise.resolve(window.MZVision)
    : new Promise(r => window.addEventListener("mz-vision-ready", () => r(window.MZVision), { once: true }));

/* 正規化ボックス {x,y,w,h} のIoU */
MZ.iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
};

/* ソース(VideoFrame/video/canvas)を回転込みでキャンバス全面に描画。
   rawW/rawH は回転前の素のピクセル寸法。<video>はブラウザが回転適用済みなので rot=0 で渡す */
MZ.drawFrame = (ctx, source, rawW, rawH, rot, W, H) => {
  rot = ((rot || 0) % 360 + 360) % 360;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  if (rot) ctx.rotate(rot * Math.PI / 180);
  const s = (rot === 90 || rot === 270) ? H / rawW : W / rawW;
  ctx.drawImage(source, -rawW * s / 2, -rawH * s / 2, rawW * s, rawH * s);
  ctx.restore();
};
