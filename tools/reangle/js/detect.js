"use strict";
/* ============ 床4隅の軽量自動検出(OpenCV不使用・純JS) ============
   体育館フロアは「画面下部の大面積を占める明るい単色領域」という前提で、
   ① 下部中央の色を床色とみなす → ② 色距離で二値化 → ③ ノイズ整形 →
   ④ 下部中央から連結成分を取る → ⑤ 凸包 → ⑥ 面積最大の内接四角形。
   あくまで初期配置。失敗したら null(呼び出し側がプリセット台形を使う)。 */

RA.detect = {};

/* video の現在フレームから床の四角形を推定。正規化座標4点(TL,TR,BR,BL) or null */
RA.detect.floorQuad = video => {
  const t0 = performance.now();
  const W = 320;
  const H = Math.max(40, Math.round(W * video.videoHeight / video.videoWidth));
  const cv = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(W, H)
    : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, W, H);
  let px;
  try { px = ctx.getImageData(0, 0, W, H).data; } catch (e) { return null; }

  // ① 床色: 下部中央(y 72〜94%、x 30〜70%)の中央値
  const rs = [], gs = [], bs = [];
  for (let y = Math.floor(H * 0.72); y < H * 0.94; y += 2) {
    for (let x = Math.floor(W * 0.30); x < W * 0.70; x += 2) {
      const i = (y * W + x) * 4;
      rs.push(px[i]); gs.push(px[i + 1]); bs.push(px[i + 2]);
    }
  }
  if (rs.length < 20) return null;
  const med = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const mr = med(rs), mg = med(gs), mb = med(bs);

  // しきい値はサンプル群の散らばりから自動決定
  const dists = [];
  for (let k = 0; k < rs.length; k++)
    dists.push(Math.abs(rs[k] - mr) + Math.abs(gs[k] - mg) + Math.abs(bs[k] - mb));
  const p90 = dists.sort((p, q) => p - q)[Math.floor(dists.length * 0.9)];
  const thr = Math.max(45, Math.min(140, p90 * 2.2));

  // ② 二値化
  let mask = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const d = Math.abs(px[i] - mr) + Math.abs(px[i + 1] - mg) + Math.abs(px[i + 2] - mb);
    mask[j] = d < thr ? 1 : 0;
  }

  // ③ クロージング(dilate→erode): コートライン等の細い線でマスクが
  //    分断されるのを防ぐ(体育館の床はラインだらけなのでここが重要)
  mask = RA.detect._morph(mask, W, H, "dilate");
  mask = RA.detect._morph(mask, W, H, "dilate");
  mask = RA.detect._morph(mask, W, H, "erode");
  mask = RA.detect._morph(mask, W, H, "erode");

  // ④ 下部中央のシードから連結成分(床は必ず画面下部につながっている前提)
  const comp = RA.detect._floodFromBottom(mask, W, H);
  if (!comp) return null;
  const { region, area } = comp;
  if (area < W * H * 0.12) return null;

  // ⑤ 境界点 → 凸包 → 点数を絞る
  const boundary = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!region[y * W + x]) continue;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1
        || !region[y * W + x - 1] || !region[y * W + x + 1]
        || !region[(y - 1) * W + x] || !region[(y + 1) * W + x]) {
        boundary.push({ x, y });
      }
    }
  }
  if (boundary.length < 8) return null;
  let hull = RA.detect._hull(boundary);
  hull = RA.detect._reduce(hull, 20);
  if (hull.length < 4) return null;

  // ⑥ 凸包上の4点で面積最大の四角形(n≤20 → 総当たり数千通り、数ms)
  const quad = RA.detect._maxQuad(hull);
  if (!quad) return null;

  // 並べ替え: 上2点をx順にTL,TR、下2点をx順にBL,BR
  const byY = [...quad].sort((a, b) => a.y - b.y);
  const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bot = byY.slice(2).sort((a, b) => a.x - b.x);
  const ordered = [top[0], top[1], bot[1], bot[0]];

  // 妥当性: 凸・面積15%以上・上辺<下辺(斜め上から見た台形)
  const areaQ = RA.detect._area(ordered);
  const topW = Math.hypot(top[1].x - top[0].x, top[1].y - top[0].y);
  const botW = Math.hypot(bot[1].x - bot[0].x, bot[1].y - bot[0].y);
  if (areaQ < W * H * 0.15 || topW >= botW * 0.98 || !RA.detect._isConvex(ordered)) return null;

  RA.log(`floor detect: ${Math.round(performance.now() - t0)}ms area=${Math.round(areaQ / (W * H) * 100)}% thr=${Math.round(thr)}`);
  return ordered.map(p => ({ x: p.x / W, y: p.y / H }));
};

/* 3x3 erode / dilate */
RA.detect._morph = (src, W, H, mode) => {
  const out = new Uint8Array(W * H);
  const er = mode === "erode";
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let hit = er;
      for (let dy = -1; dy <= 1 && (er ? hit : !hit); dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const v = src[i + dy * W + dx];
          if (er) { if (!v) { hit = false; break; } }
          else if (v) { hit = true; break; }
        }
      out[i] = hit ? 1 : 0;
    }
  }
  return out;
};

/* 下部中央のシードからflood fill。{region, area} or null */
RA.detect._floodFromBottom = (mask, W, H) => {
  const region = new Uint8Array(W * H);
  const stack = [];
  const sy = Math.floor(H * 0.88);
  for (let x = Math.floor(W * 0.3); x < W * 0.7; x += 4) {
    if (mask[sy * W + x]) stack.push(sy * W + x);
  }
  if (!stack.length) return null;
  let area = 0;
  while (stack.length) {
    const i = stack.pop();
    if (region[i] || !mask[i]) continue;
    region[i] = 1;
    area++;
    const x = i % W;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (i >= W) stack.push(i - W);
    if (i < W * (H - 1)) stack.push(i + W);
  }
  return { region, area };
};

/* Andrewのmonotone chainで凸包 */
RA.detect._hull = pts => {
  pts = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
};

/* 凸包の点数をn以下へ(隣接3点の三角形面積が最小の中点を消していく) */
RA.detect._reduce = (hull, n) => {
  hull = [...hull];
  const triArea = (a, b, c) =>
    Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  while (hull.length > n) {
    let minA = Infinity, minI = 0;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[(i - 1 + hull.length) % hull.length];
      const c = hull[(i + 1) % hull.length];
      const A = triArea(a, hull[i], c);
      if (A < minA) { minA = A; minI = i; }
    }
    hull.splice(minI, 1);
  }
  return hull;
};

/* 凸包上の4点(巡回順)で面積最大の四角形 */
RA.detect._maxQuad = hull => {
  const n = hull.length;
  let best = null, bestA = 0;
  for (let i = 0; i < n - 3; i++)
    for (let j = i + 1; j < n - 2; j++)
      for (let k = j + 1; k < n - 1; k++)
        for (let l = k + 1; l < n; l++) {
          const q = [hull[i], hull[j], hull[k], hull[l]];
          const A = RA.detect._area(q);
          if (A > bestA) { bestA = A; best = q; }
        }
  return best;
};

/* 多角形の面積(shoelace) */
RA.detect._area = q => {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
};

RA.detect._isConvex = q => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-9) continue;
    const s = Math.sign(cr);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
};
