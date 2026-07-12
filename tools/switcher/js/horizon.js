"use strict";
/* ============ 自動水平 (Phase 3) ============
   カメラ別±5°の微回転(隅隠しズーム付き、layout.jsで適用)。
   自動提案: 25%地点のフレームを480pxでSobel→水平±8°限定のHough変換。
   (勾配方向ヒストグラムは小角度の傾きがピクセル階段状になり0°に吸われるため、
    同一直線上の証拠を集積するHoughで判定する)
   提案のみで自動適用しない。 */

MC.horizon = { RANGE: 5 };

/* 3フレーム(25/50/75%)で解析し、2つ以上が±0.6°で一致した時だけ提案する。
   真の傾きは時間不変、モアレや被写体由来の誤検出はフレームごとに変わるため分離できる */
MC.horizon.suggest = async clip => {
  const vals = [];
  for (const frac of [0.25, 0.5, 0.75]) {
    const a = await MC.horizon.analyzeFrame(clip, frac);
    if (a != null) vals.push(a);
  }
  if (vals.length < 2) return null;
  for (let i = 0; i < vals.length; i++) {
    for (let j = i + 1; j < vals.length; j++) {
      if (Math.abs(vals[i] - vals[j]) <= 0.6) {
        const m = +( (vals[i] + vals[j]) / 2 ).toFixed(2);
        MC.log(`horizon ${clip.name}: 多数決一致 [${vals.map(x => x.toFixed(1)).join(", ")}] → ${m}°`);
        return Math.abs(m) < 0.15 ? 0 : m;
      }
    }
  }
  MC.log(`horizon ${clip.name}: フレーム間で不一致 [${vals.map(x => x.toFixed(1)).join(", ")}] → 提案なし`);
  return null;
};

MC.horizon.analyzeFrame = async (clip, frac) => {
  const v = clip.video;
  const keep = v.currentTime;
  v.currentTime = clip.duration * frac;
  await new Promise(res => { v.onseeked = res; setTimeout(res, 2000); });
  const W = 480;
  const scale = W / Math.max(v.videoWidth, 1);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = Math.max(2, Math.round(v.videoHeight * scale));
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(v, 0, 0, cv.width, cv.height);
  const img = cx.getImageData(0, 0, cv.width, cv.height).data;
  v.currentTime = keep;

  const w = cv.width, h = cv.height;
  const g0 = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g0.length; i++, p += 4) {
    g0[i] = 0.299 * img[p] + 0.587 * img[p + 1] + 0.114 * img[p + 2];
  }
  // 3x3ブラー: 1px周期のテクスチャ(チェッカー等)のエイリアシングを抑える
  const gray = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      gray[i] = (g0[i - w - 1] + g0[i - w] + g0[i - w + 1] + g0[i - 1] + g0[i]
               + g0[i + 1] + g0[i + w - 1] + g0[i + w] + g0[i + w + 1]) / 9;
    }
  }
  // 水平っぽいエッジ点(縦勾配が支配的)を列ごと上位8点まで収集
  // (観客席など密なテクスチャが集積を支配しないように)
  const perCol = Array.from({ length: w }, () => []);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const gx = (gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1])
               - (gray[i - w - 1] + 2 * gray[i - 1] + gray[i + w - 1]);
      const gy = (gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1])
               - (gray[i - w - 1] + 2 * gray[i - w] + gray[i - w + 1]);
      const mag = gx * gx + gy * gy;
      if (mag < 1600) continue;  // ブラー後なので閾値は下げる
      if (Math.abs(gy) <= Math.abs(gx) * 1.5) continue;
      perCol[x].push([y, Math.sqrt(mag)]);
    }
  }
  const ex = [], ey = [], ew = [];
  for (let x = 0; x < w; x++) {
    const list = perCol[x];
    list.sort((a, b) => b[1] - a[1]);
    for (let k = 0; k < Math.min(8, list.length); k++) {
      ex.push(x); ey.push(list[k][0]); ew.push(list[k][1]);
    }
  }
  if (ex.length < 200) return null;

  // Hough: 角度θごとに切片 c = y - x·tanθ を集積し、上位5ピークの合計をスコアに
  const RANGE = 8, STEP = 0.2, CB = 2;  // 角度±8°/0.2°刻み、切片2pxビン
  const maxOff = w * Math.tan(RANGE * Math.PI / 180);
  const nC = Math.ceil((h + 2 * maxOff) / CB) + 2;
  const nTh = Math.round(2 * RANGE / STEP) + 1;
  const scores = new Float64Array(nTh);
  const acc = new Float64Array(nC);
  for (let ti = 0; ti < nTh; ti++) {
    const th = (ti * STEP - RANGE) * Math.PI / 180;
    const tan = Math.tan(th);
    acc.fill(0);
    for (let k = 0; k < ex.length; k++) {
      const c = ey[k] - ex[k] * tan;
      const bi = Math.round((c + maxOff) / CB);
      if (bi >= 0 && bi < nC) acc[bi] += ew[k];
    }
    // 上位5ピークの合計(複数の平行線[スタンド・ライン等]に頑健)
    const top = [0, 0, 0, 0, 0];
    for (let i = 0; i < nC; i++) {
      const val = acc[i];
      if (val > top[4]) {
        top[4] = val;
        top.sort((a, b) => b - a);
      }
    }
    scores[ti] = top[0] + top[1] + top[2] + top[3] + top[4];
  }
  // 端ビン(エイリアシング共鳴が出やすい)は探索から除外
  let best = 3;
  for (let i = 4; i <= nTh - 4; i++) if (scores[i] > scores[best]) best = i;
  // 信頼判定: 0°のスコアを10%以上上回らなければ「傾きなし」
  const zeroIdx = Math.round(RANGE / STEP);
  if (scores[best] < scores[zeroIdx] * 1.10) {
    MC.log(`horizon ${clip.name}: 0°優勢(best=${(best * STEP - RANGE).toFixed(1)}° 比${(scores[best] / scores[zeroIdx]).toFixed(2)})→傾きなし`);
    return 0;
  }
  // 放物線補間で0.2°未満へ精密化
  let angle = best * STEP - RANGE;
  {
    const y0 = scores[best - 1], y1 = scores[best], y2 = scores[best + 1];
    const den = y0 - 2 * y1 + y2;
    if (Math.abs(den) > 1e-9) angle += STEP * 0.5 * (y0 - y2) / den;
  }
  const correction = Math.max(-MC.horizon.RANGE, Math.min(MC.horizon.RANGE, -angle));
  MC.log(`horizon ${clip.name}: line=${angle.toFixed(2)}° → 提案 ${correction.toFixed(2)}°(edges=${ex.length})`);
  return Math.abs(correction) < 0.15 ? 0 : +correction.toFixed(2);
};
