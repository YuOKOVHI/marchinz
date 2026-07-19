"use strict";
/* ============ 床4隅の軽量自動検出(OpenCV不使用・純JS) ============
   v2: 旧版の前提「床=画面下部の大面積」はアリーナ撮影(画面下部が観客席、
   床は画面中段)で破綻して大きく歪んだ四角を返し、デフォルト補正が映像全体を
   回転・シアーさせる事故になっていた。v2は:
   ① 複数の水平バンドから「一様な床色」を探索(床が画面のどの高さでも拾える)
   ② バンドごとに 二値化→クロージング→flood→凸包→面積最大の内接四角形
   ③ エッジ実在性検証: 四角形の各辺が実際の領域境界に直線的に沿っているかを
      内外プローブで測る。奥の縁(上辺)が実在しない候補は捨てる
   ④ 信頼度後処理: 実在しない辺(観客席のシルエット等)は「補正が働かない形」へ
      均し、誤った回転・横ずれ補正が入らないようにする
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

  /* 候補バンド(中心y)。下から上へ。旧版相当の下部(0.83)も含む */
  const bands = [0.83, 0.76, 0.69, 0.62, 0.55, 0.48];
  let best = null;
  for (const yc of bands) {
    const r = RA.detect._tryBand(px, W, H, yc);
    if (r && (!best || r.score > best.score)) best = r;
  }
  if (!best) return null;
  RA.log(`floor detect: ${Math.round(performance.now() - t0)}ms band=${best.yc} score=${best.score.toFixed(2)} sup=[${best.sup.map(s => s.toFixed(2))}]`);
  return best.quad.map(p => ({ x: p.x / W, y: p.y / H }));
};

/* 1つの候補バンドで検出を試す。成功なら {quad(縮小px), score, yc, sup} */
RA.detect._tryBand = (px, W, H, yc) => {
  // ① バンド内の色を採取(y: yc±4%、x: 30〜70%)
  const y0 = Math.max(0, Math.floor(H * (yc - 0.04)));
  const y1 = Math.min(H, Math.ceil(H * (yc + 0.04)));
  const rs = [], gs = [], bs = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = Math.floor(W * 0.30); x < W * 0.70; x += 2) {
      const i = (y * W + x) * 4;
      rs.push(px[i]); gs.push(px[i + 1]); bs.push(px[i + 2]);
    }
  }
  if (rs.length < 20) return null;
  const med = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const mr = med(rs), mg = med(gs), mb = med(bs);
  const lum = 0.299 * mr + 0.587 * mg + 0.114 * mb;
  if (lum < 60) return null;                 // 暗い=観客席・暗幕・スタンド

  // 人・ライン・楽器が乗っていても床画素が多数派なら拾えるよう、散らばりはp60で測る
  const dists = [];
  for (let k = 0; k < rs.length; k++)
    dists.push(Math.abs(rs[k] - mr) + Math.abs(gs[k] - mg) + Math.abs(bs[k] - mb));
  dists.sort((p, q) => p - q);
  const p60 = dists[Math.floor(dists.length * 0.6)];
  if (p60 > 50) return null;                 // 多数派すら一様でない=床ではない
  const thr = Math.max(30, Math.min(95, p60 * 3.5));

  // ② 二値化 → クロージング(コートライン・マットの継ぎ目でマスクが分断されるのを防ぐ)
  let mask = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < W * H; i += 4, j++) {
    const d = Math.abs(px[i] - mr) + Math.abs(px[i + 1] - mg) + Math.abs(px[i + 2] - mb);
    mask[j] = d < thr ? 1 : 0;
  }
  mask = RA.detect._morph(mask, W, H, "dilate");
  mask = RA.detect._morph(mask, W, H, "dilate");
  mask = RA.detect._morph(mask, W, H, "erode");
  mask = RA.detect._morph(mask, W, H, "erode");

  // ③ バンド内シードから連結成分
  const region = new Uint8Array(W * H);
  const stack = [];
  const sy = Math.max(1, Math.min(H - 2, Math.round(H * yc)));
  for (const yy of [y0, sy, y1 - 1]) {
    for (let x = Math.floor(W * 0.25); x < W * 0.75; x += 4) {
      if (mask[yy * W + x]) stack.push(yy * W + x);
    }
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
  const areaR = area / (W * H);
  if (areaR < 0.10 || areaR > 0.85) return null;

  // ④ 境界点 → 凸包 → 面積最大の内接四角形
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
  const quad = RA.detect._maxQuad(hull);
  if (!quad) return null;

  // 並べ替え: 上2点をx順にTL,TR、下2点をx順にBL,BR
  const byY = [...quad].sort((a, b) => a.y - b.y);
  const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bot = byY.slice(2).sort((a, b) => a.x - b.x);
  const q = [top[0], top[1], bot[1], bot[0]];   // TL,TR,BR,BL

  // ⑤ 妥当性(形): 凸・面積・上辺<下辺(斜め上から見た台形)・上辺が上端に張り付かない
  const areaQ = RA.detect._area(q);
  const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const topW = len(q[0], q[1]);
  const botW = len(q[3], q[2]);
  if (areaQ < W * H * 0.10 || topW < W * 0.25 || !RA.detect._isConvex(q)) return null;
  if (topW >= botW * 1.02) return null;
  if (q[0].y <= 1 && q[1].y <= 1) return null;

  // ⑥ エッジ実在性: 各辺が領域の実境界に直線的に沿っているか
  const { sup, neutral } = RA.detect._edgeSupport(region, W, H, q);
  const REAL = 0.75;
  // 奥の縁(上辺)だけは実在必須。ここが偽物だと補正が映像全体を回してしまう
  if (sup[0] < REAL) return null;

  // ⑦ 信頼度後処理: 実在しない辺には補正が働かないよう「既に補正済みの形」へ均す
  //  - 下辺が偽物(観客席のシルエット等) → 水平化(targetSymの水平化が無効になる)
  //  - 左右辺が偽物/切り取り → 上下辺の中心を揃える(横ずれ補正が無効になる)
  if (sup[1] < REAL && !neutral[1]) {
    const yb = (q[2].y + q[3].y) / 2;
    q[2] = { x: q[2].x, y: yb };
    q[3] = { x: q[3].x, y: yb };
  }
  if (sup[2] < REAL || sup[3] < REAL) {
    const ct = (q[0].x + q[1].x) / 2;
    const cb = (q[2].x + q[3].x) / 2;
    const cc = (ct + cb) / 2;
    q[0] = { x: q[0].x + (cc - ct), y: q[0].y };
    q[1] = { x: q[1].x + (cc - ct), y: q[1].y };
    q[2] = { x: q[2].x + (cc - cb), y: q[2].y };
    q[3] = { x: q[3].x + (cc - cb), y: q[3].y };
  }

  const avgSup = (sup[0] * 2 + sup[1] + sup[2] + sup[3]) / 5;   // 奥の縁を重視
  const score = avgSup * 0.7 + Math.min(0.5, areaQ / (W * H)) * 0.6;
  return { quad: q, score, yc, sup };
};

/* 各辺のサポート率(内外プローブ方式):
   辺に沿って標本し、「辺の内側(重心側)3pxに領域があり、外側6pxに領域がない」割合。
   外側6pxはレンズ歪みで床の縁が数px湾曲してもフォールスにならないための余裕。
   「床の真ん中を横切る辺」(内外とも領域)は確実に0近くになる。
   床がフレーム外へ続いて辺が切り取りになっている場合(外側の領域がそのまま
   フレーム端まで達している)は判定不能として中立値0.6を返す。
   返り値 { sup:[top,bottom,left,right], neutral:[…] }。フレーム外は「領域なし」扱い */
RA.detect._edgeSupport = (region, W, H, q) => {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const at = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || xi >= W || yi < 0 || yi >= H) return 0;   // フレーム外=領域なし
    return region[yi * W + xi];
  };
  // 外側プローブ点からさらに外へ辿り、領域がフレーム端まで連続しているか(=切り取り辺)
  const runsToBorder = (x, y, nx, ny) => {
    for (let s = 0; s < Math.max(W, H); s += 2) {
      const xi = Math.round(x - nx * s), yi = Math.round(y - ny * s);
      if (xi < 4 || xi >= W - 4 || yi < 4 || yi >= H - 4) return true;   // 端に到達(モルフォロジーの縁欠け分の余裕)
      if (!region[yi * W + xi]) return false;                            // 途切れた=実境界がある
    }
    return true;
  };
  const edge = (a, b) => {
    const ex = b.x - a.x, ey = b.y - a.y;
    const L = Math.hypot(ex, ey) || 1;
    let nx = -ey / L, ny = ex / L;                 // 法線(重心側へ向ける)
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (nx * (cx - mx) + ny * (cy - my) < 0) { nx = -nx; ny = -ny; }
    const n = Math.max(8, Math.round(L / 2));
    let ok = 0, cnt = 0, truncated = 0;
    for (let k = 1; k < n; k++) {                  // 端点(コーナー)は避ける
      const t = k / n;
      const sx = a.x + ex * t, sy = a.y + ey * t;
      cnt++;
      const inside = at(sx + nx * 3, sy + ny * 3);
      const outside = at(sx - nx * 6, sy - ny * 6);
      if (inside && !outside) ok++;
      else if (inside && outside && runsToBorder(sx - nx * 6, sy - ny * 6, nx, ny)) truncated++;
    }
    if (!cnt) return { v: 0, neutral: false };
    if (truncated / cnt > 0.5) return { v: 0.6, neutral: true };  // 切り取り辺(床が画面外へ続く)
    return { v: ok / cnt, neutral: false };
  };
  const es = [edge(q[0], q[1]), edge(q[3], q[2]), edge(q[0], q[3]), edge(q[1], q[2])];
  return { sup: es.map(e => e.v), neutral: es.map(e => e.neutral) };
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
