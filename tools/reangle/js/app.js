"use strict";
/* ============ ReAngle 状態管理+共通ヘルパー ============ */

window.RA = {
  S: {
    clip: null,        // {file, name, url, video, duration, width, height}
    corners: null,     // 床の4隅 [{x,y}×4] 正規化表示座標(0〜1)、TL,TR,BR,BL
    viewMode: "front", // "front"=正面モード(メイン) | "top"=俯瞰モード
    sMain: 0.9,        // 正面モードの補正強度 0〜1(横から→センター正面。遠近感は残す)
    sTop: 1.0,         // 俯瞰モードの起こし具合 0〜1(1=床が完全な長方形=見下ろし図)
    tilt: 0,           // 傾き調整(度、出力を画面中心周りに回転)
    preset: "none",    // カラープリセットid(RA.PRESETS)
    sharp: 0,          // 解像感(アンシャープ)0〜1。補正で甘くなった画をくっきりさせる
    fillEdge: true,    // 補正で切れた範囲外(黒縁)をミラー+ぼかしで自動的に埋める
    zoom: 1.0,         // 出力ズーム 1〜2
    panY: 0,           // 縦位置 -0.3〜0.3(表示高さ比)
    res: "1080",       // "1080" | "orig"
    compare: false,    // trueの間は補正なし(元の映像)を表示
    editCorners: true, // 四隅編集モード(ハンドル表示)
    step: 1,           // ウィザード現在ステップ 1:四角 2:調整 3:保存
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

/* カラープリセット(シェーダの uColor に渡す値の組)。Switcherのフィルター系と同トーン */
RA.PRESETS = [
  ["none",   "なし",     { bright: 1,    contrast: 1,    sat: 1,    temp: 0 }],
  ["cinema", "シネマ",   { bright: 1.02, contrast: 1.12, sat: 0.92, temp: 0.015 }],
  ["vivid",  "ビビッド", { bright: 1.03, contrast: 1.10, sat: 1.28, temp: 0 }],
  ["warm",   "ウォーム", { bright: 1.02, contrast: 1.04, sat: 1.06, temp: 0.045 }],
  ["cool",   "クール",   { bright: 1.0,  contrast: 1.05, sat: 1.0,  temp: -0.045 }],
  ["mono",   "モノクロ", { bright: 1.0,  contrast: 1.08, sat: 0,    temp: 0 }],
];

/* 現在の状態から描画エフェクト(シェーダfx)を組み立てる。preview/exporter共用 */
RA.fx = (overridePreset) => {
  const id = overridePreset != null ? overridePreset : RA.S.preset;
  const found = RA.PRESETS.find(p => p[0] === id);
  const c = found ? found[2] : RA.PRESETS[0][2];
  return { bright: c.bright, contrast: c.contrast, sat: c.sat, temp: c.temp, sharp: RA.S.sharp, fillEdge: RA.S.fillEdge };
};

/* 既定の台形プリセット(自動検出失敗時の初期配置) */
RA.presetCorners = () => ([
  { x: 0.18, y: 0.48 },  // TL
  { x: 0.82, y: 0.48 },  // TR
  { x: 0.98, y: 0.92 },  // BR
  { x: 0.02, y: 0.92 },  // BL
]);
