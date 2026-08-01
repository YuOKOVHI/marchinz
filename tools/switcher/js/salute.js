"use strict";
/* ============ DMサリュート考慮の演奏区間検出 (Phase 3) ============
   演奏前はDMのサリュート(敬礼)＋アナウンスで静か→演奏開始で持続的に大きくなる。
   RMS包絡(100msホップ→1秒平滑)で
   「5秒以上の静けさ(T_low未満)の後、3秒以上持続する高エネルギー(T_high超)」を演奏開始とする。
   トリムIN提案 = 開始 − 前振り秒(サリュートが映るように)。自動適用はしない。 */

MC.salute = { OUT_AFTER: 10 };  // OUT = 演奏終了の10秒後(基本)

/* 自動トリム: サリュート考慮のIN(演奏開始-前振り)と、音が終わって10秒後のOUTを適用。
   検出失敗は静かに諦める(トリムなしで続行)。戻り値: 適用したか */
MC.salute.autoTrim = async () => {
  let s;
  try { s = await MC.salute.detect(); } catch (e) { MC.log("autoTrim: 検出できず →", e.message); return false; }
  MC.ui._salute = s;
  /* 前振りの入力欄は撤去した(2026-07-31)。既定の8秒で固定する ─
     残っている環境(旧HTMLのキャッシュ)でも壊れないよう、あくまで任意扱い */
  const preEl = document.getElementById("preRoll");
  const pre = (preEl && parseFloat(preEl.value)) || 8;
  MC.S.trimIn = Math.max(0, s.musicStart - pre);
  MC.S.trimOut = s.musicEnd != null
    ? Math.min(MC.timelineDuration(), s.musicEnd + MC.salute.OUT_AFTER) : null;
  MC.saveState();
  MC.ui.updateTransport();
  MC.ui.renderScrubTicks();
  return true;
};

/* 検出結果を音声クリップごとに覚える(2026-07-31 優さん報告
   「その進捗もわからんし、そこでずっと進まず」)。
   detect() は音声を**全尺で読み直す**うえ、おまかせの中だけでも
   ①音楽の解析(ui.js) ②自動トリム(autoTrim) の2回、さらに仕上げの
   「演奏の範囲を探す」で3回目が走っていた。長尺ほど無言で待たされる。
   同じ音声・同じズレなら答えは変わらないので、1回で済ませる。
   音声を選び直す/同期し直すと offset が変わり、鍵が変わって計算し直す */
MC.salute._cacheKey = null;
MC.salute._cache = null;
MC.salute.clearCache = () => { MC.salute._cacheKey = null; MC.salute._cache = null; };

/* onProg(0..1) を渡せる。★ここは長尺でいちばん長く無言になる場所。
   同期は「真ん中3分」の窓しか読まないのに、この検出は**全尺を読み直す**ため、
   8分の素材なら窓の倍以上を読むことになる。それを黙って待たせていた
   (2026-08-01 優さん報告「この画面から進まない、進捗もわからない」)。
   extract8k は元から進捗を返せるのに、呼び出し側が受け取っていなかった */
MC.salute.detect = async (onProg = null) => {
  const clip = MC.getClip(MC.S.audioClipId);
  if (!clip) throw new Error("音声クリップがありません");
  const key = `${clip.id}|${clip.name}|${clip.size}|${clip.offset}`;
  if (MC.salute._cacheKey === key && MC.salute._cache) {
    MC.log("salute: 前回の結果を使う(読み直さない)");
    return MC.salute._cache;
  }
  {
    const _t0 = performance.now();
    const hit = clip.audio8k && (clip.audio8kReqStart || 0) === 0;
    await MC.audio.extract8k(clip, MC.audio.MAX_SEC, onProg);   // 窓キャッシュなら全尺で読み直される
    MC.log(`salute抽出: ${hit ? "キャッシュ命中" : "全尺読み直し"} ${(performance.now() - _t0).toFixed(0)}ms`);
  }
  const sr = MC.audio.SR, hop = sr / 10;  // 100ms
  const pcm = clip.audio8k;
  const nH = Math.floor(pcm.length / hop);
  if (nH < 100) throw new Error("音声が短すぎます");
  const rms = new Float32Array(nH);
  for (let i = 0; i < nH; i++) {
    let s = 0;
    const o = i * hop;
    for (let j = 0; j < hop; j++) s += pcm[o + j] * pcm[o + j];
    rms[i] = Math.sqrt(s / hop);
  }
  // 1秒(10ホップ)移動平均
  const sm = new Float32Array(nH);
  for (let i = 0; i < nH; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 5); j <= Math.min(nH - 1, i + 4); j++) { s += rms[j]; n++; }
    sm[i] = s / n;
  }
  const sorted = Float32Array.from(sm).sort();
  const tLow = sorted[Math.floor(nH * 0.25)];
  const tHigh = sorted[Math.floor(nH * 0.60)];

  // 演奏開始: 30ホップ(3秒)持続してT_high超 かつ 直前50ホップ(5秒)の8割がT_low未満
  let startH = -1;
  for (let i = 50; i < nH - 30; i++) {
    if (sm[i] <= tHigh) continue;
    let sus = true;
    for (let j = i; j < i + 30; j++) if (sm[j] <= tHigh) { sus = false; break; }
    if (!sus) continue;
    let quiet = 0;
    for (let j = i - 50; j < i; j++) if (sm[j] < tLow) quiet++;
    if (quiet >= 40) { startH = i; break; }
  }
  // 演奏終了: 「最後に音が大きかった位置」。
  // T_high(60%点)は演奏がファイルの大半を占めると演奏レベル内に食い込み、
  // 持続条件が満たせず取り逃がすため、静寂〜ピークの間に置いた閾値の最終超えを使う
  const tPeak = sorted[Math.floor(nH * 0.95)];
  const tEnd = tLow + 0.3 * Math.max(0, tPeak - tLow);
  let endH = -1;
  for (let i = nH - 1; i >= Math.max(0, startH); i--) {
    if (sm[i] > tEnd) { endH = i; break; }
  }
  if (startH < 0) {
    // 静寂前提が満たされない(既に曲中から始まる素材など)→開始のみ緩く検出
    for (let i = 0; i < nH - 30; i++) {
      if (sm[i] > tHigh) { startH = i; break; }
    }
    if (startH < 0) throw new Error("演奏区間を検出できませんでした");
    MC.log("salute: 静寂→演奏 のパターンではないため簡易検出");
  }
  const res = {
    musicStart: startH * 0.1 + (clip.audio8kStart || 0) + clip.offset,   // 窓抽出でもズレない(2026-07-24)
    musicEnd: endH > startH ? endH * 0.1 + (clip.audio8kStart || 0) + clip.offset : null,
  };
  MC.log(`salute: start=${res.musicStart.toFixed(1)}s end=${res.musicEnd ? res.musicEnd.toFixed(1) : "?"}s`);
  MC.salute._cacheKey = key;   // 次からは読み直さない
  MC.salute._cache = res;
  return res;
};
