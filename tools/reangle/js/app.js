"use strict";
/* ============ ReAngle 状態管理+共通ヘルパー ============ */

window.RA = {
  S: {
    clip: null,        // {file, name, url, video, duration, width, height}
    corners: null,     // 床の4隅 [{x,y}×4] 正規化表示座標(0〜1)、TL,TR,BR,BL
    sMain: 0.9,        // メイン補正「真正面へ」0〜1(横から→センター正面。遠近感は残す)
    sPersp: 0,         // サブ補正「俯瞰に起こす」0〜1(1=床が完全な長方形=見下ろし図)
    zoom: 1.0,         // 出力ズーム 1〜2
    panY: 0,           // 縦位置 -0.3〜0.3(表示高さ比)
    res: "1080",       // "1080" | "orig"
    compare: false,    // trueの間は補正なし(元の映像)を表示
    editCorners: true, // 四隅編集モード(ハンドル表示)
  },
  caps: { h264: null, aacEnc: null },
  testMode: /[?&]test/.test(location.search),
  debug: [],
};

RA.log = (...a) => {
  console.log("[RA]", ...a);
  RA.debug.push(a.map(x => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
};

/* タイマー節流(非表示タブ)の影響を受けないyield */
RA.yield = () => new Promise(r => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r();
  ch.port2.postMessage(0);
});

/* dequeueイベント待ち(タイムアウト付き) */
RA.waitDequeue = (codec, ms = 100) => new Promise(r => {
  const h = () => { clearTimeout(tm); r(); };
  codec.addEventListener("dequeue", h, { once: true });
  const tm = setTimeout(() => { codec.removeEventListener("dequeue", h); r(); }, ms);
});

/* 既定の台形プリセット(自動検出失敗時の初期配置) */
RA.presetCorners = () => ([
  { x: 0.18, y: 0.48 },  // TL
  { x: 0.82, y: 0.48 },  // TR
  { x: 0.98, y: 0.92 },  // BR
  { x: 0.02, y: 0.92 },  // BL
]);
