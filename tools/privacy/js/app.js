"use strict";
/* ============ MzMosaic 状態管理+共通ヘルパー ============ */

window.MZ = {
  S: {
    clip: null,        // {file, name, url, video, duration, width, height}
    type: "blur",      // blur | mosaic | fill(既定はぼかし=Premiere風の柔らかい隠し方)
    strength: 6,       // 濃さ 1〜10
    expand: 30,        // 広げ幅 0〜100(%)
    hold: 1.0,         // 前後の追従 0〜5秒
    res: "1080",       // "1080" | "orig"
    step: 1,           // ウィザード現在ステップ 1:確認 2:調整 3:保存
    manualBoxes: [],   // タップで追加した固定マスク(正規化ボックス)。もう一度タップで削除
    suppressedBoxes: [], // タップで外した自動検出の場所(正規化)。ここの検出は採用しない
    rangeStart: 0,     // 作業範囲の開始秒(60秒超の動画はインスタ風に範囲を選ぶ)
    rangeDur: 30,      // 作業範囲の長さ(10〜60秒、初期30)。短い動画はduration全部
    photos: [],        // 写真は最大4枚。各 {file,url,img,name,width,height,boxes,manualBoxes}
    photoIdx: 0,       // 表示中の写真index。MZ.S.clip は photos[photoIdx] を指す(既存互換)
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

/* tasks-vision(ESMバンドル)の遅延読み込み。呼ばれて初めてダウンロードする。
   wasm(約3MB)とモデル本体はさらに MZ.detect.init() 内で取得されるため、
   ページを開いただけの人は重いファイルを一切ダウンロードしない */
MZ.visionReady = () =>
  MZ._visionP || (MZ._visionP = import(new URL("vendor/tasks-vision.mjs", location.href).href)
    .then(m => ({ FilesetResolver: m.FilesetResolver, FaceDetector: m.FaceDetector }))
    .catch(e => { MZ._visionP = null; throw e; }));   // 失敗キャッシュを残さない(再挑戦可能に)

/* 作業範囲の終了秒(動画の実尺でクランプ) */
MZ.rangeEnd = () => {
  const c = MZ.S.clip;
  if (!c || c.kind !== "video") return 0;
  return Math.min(c.duration, MZ.S.rangeStart + MZ.S.rangeDur);
};

/* 正規化ボックス {x,y,w,h} のIoU */
MZ.iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
};

/* ============ シーン/カメラ切替の検出 ============
   64×36のグレースケール縮小で「画素差(MAD)」と「輝度ヒストグラム差」を見る合議制。
   等速パン(マーチングで頻発)での誤検出を防ぐため、直近の動き(中央値)との比も使う。
   カットを検出したら追跡を捨てて高精度再検出をやり直す(誤検出しても損は再検出1回分) */
MZ.SceneCut = class {
  constructor() { this.prev = null; this.mads = []; }
  reset() { this.prev = null; this.mads.length = 0; }
  /* A: 解析キャンバス。戻り true=カット(シーン切替) */
  check(A) {
    const c = this._cv || (this._cv = document.createElement("canvas"));
    if (c.width !== 64) { c.width = 64; c.height = 36; }
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(A, 0, 0, 64, 36);
    const px = ctx.getImageData(0, 0, 64, 36).data;
    const n = 64 * 36;
    const g = new Float32Array(n), hist = new Float32Array(32);
    for (let i = 0; i < n; i++) {
      const y = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      g[i] = y;
      hist[Math.min(31, (y / 8) | 0)] += 1 / n;
    }
    let cut = false;
    if (this.prev) {
      let mad = 0;
      for (let i = 0; i < n; i++) mad += Math.abs(g[i] - this.prev.g[i]);
      mad /= n;
      let inter = 0;
      for (let i = 0; i < 32; i++) inter += Math.min(hist[i], this.prev.hist[i]);
      const histD = 1 - inter;
      const sorted = [...this.mads].sort((a, b) => a - b);
      const med = sorted.length ? sorted[(sorted.length / 2) | 0] : 0;
      cut = histD > 0.45 || (histD > 0.25 && mad > 28 && mad > 3.5 * Math.max(med, 2));
      this.mads.push(mad);
      if (this.mads.length > 15) this.mads.shift();
    }
    this.prev = { g, hist };
    return cut;
  }
};

/* タップで外した場所と重なる検出を捨てる。supを省略すると現在のMZ.S.suppressedBoxes */
MZ.dropSuppressed = (dets, sup) => {
  if (sup == null) sup = MZ.S.suppressedBoxes || [];
  if (!sup.length) return dets;
  return dets.filter(d => !sup.some(s => {
    const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
    const mx = s.w * 0.3, my = s.h * 0.3;
    return (cx > s.x - mx && cx < s.x + s.w + mx && cy > s.y - my && cy < s.y + s.h + my)
      || MZ.iou(d, s) > 0.3;
  }));
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
