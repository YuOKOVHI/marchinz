"use strict";
/* ============ ホモグラフィ数学コア ============
   3x3行列は行優先の長さ9配列 [a,b,c, d,e,f, g,h,i]。
   座標系はすべて「左上原点・y下向き」(canvas/テクスチャと同じ)。
   コーナー順は TL, TR, BR, BL(単位正方形 (0,0),(1,0),(1,1),(0,1) に対応)。 */

RA.H = {};

RA.H.identity = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];

RA.H.mul = (A, B) => {
  const C = new Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return C;
};

/* 随伴行列による逆行列(スケール不定でも射影としては同値だが、正規化して返す) */
RA.H.inv = A => {
  const [a, b, c, d, e, f, g, h, i] = A;
  const A11 = e * i - f * h, A12 = c * h - b * i, A13 = b * f - c * e;
  const A21 = f * g - d * i, A22 = a * i - c * g, A23 = c * d - a * f;
  const A31 = d * h - e * g, A32 = b * g - a * h, A33 = a * e - b * d;
  const det = a * A11 + b * A21 + c * A31;
  if (!det || !isFinite(det)) return null;
  return [A11 / det, A12 / det, A13 / det,
          A21 / det, A22 / det, A23 / det,
          A31 / det, A32 / det, A33 / det];
};

RA.H.apply = (A, x, y) => {
  const w = A[6] * x + A[7] * y + A[8];
  return {
    x: (A[0] * x + A[1] * y + A[2]) / w,
    y: (A[3] * x + A[4] * y + A[5]) / w,
  };
};

/* 単位正方形 (0,0),(1,0),(1,1),(0,1) → 四角形 p[4] の射影(Heckbertの閉形式) */
RA.H.squareToQuad = p => {
  const [p0, p1, p2, p3] = p;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    // アフィン(平行四辺形)
    return [p1.x - p0.x, p3.x - p0.x, p0.x,
            p1.y - p0.y, p3.y - p0.y, p0.y,
            0, 0, 1];
  }
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  if (!den || !isFinite(den)) return null;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
          p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
          g, h, 1];
};

/* 四角形A → 四角形B の射影(A_i が B_i に写る) */
RA.H.quadToQuad = (A, B) => {
  const HA = RA.H.squareToQuad(A);
  const HB = RA.H.squareToQuad(B);
  if (!HA || !HB) return null;
  const HAi = RA.H.inv(HA);
  return HAi ? RA.H.mul(HB, HAi) : null;
};

/* 正面化の目標矩形: 幅=上下辺長平均、高さ=左右辺長平均、中心=重心
   (強度を上げても見かけのスケール変化が最小になる) */
RA.H.targetRect = p => {
  const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const w = (len(p[0], p[1]) + len(p[3], p[2])) / 2;
  const h = (len(p[0], p[3]) + len(p[1], p[2])) / 2;
  const cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4;
  const cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4;
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
};

/* 表示px → 生ピクセルpx(tkhd回転の逆適用)。<video>は回転適用済みなので不要、
   VideoDecoderの生フレームに対してのみ使う */
RA.H.rotToRaw = (rot, rawW, rawH) => {
  rot = ((rot || 0) % 360 + 360) % 360;
  switch (rot) {
    case 90:  return [0, 1, 0, -1, 0, rawH, 0, 0, 1];
    case 180: return [-1, 0, rawW, 0, -1, rawH, 0, 0, 1];
    case 270: return [0, -1, rawW, 1, 0, 0, 0, 0, 1];
    default:  return RA.H.identity();
  }
};

/* シェーダに渡す行列を全合成する。
   入力: 出力キャンバスの正規化座標 (0,0)=左上
   出力: ソーステクスチャの正規化座標
   チェーン: 正規化→表示px → ズーム/パン逆 → 強度付きホモグラフィ逆 → (回転逆) → テクスチャ正規化
   opts: { corners(正規化4点), strength, zoom, panY, dispW, dispH,
           raw(書き出し時true), rot, rawW, rawH } */
RA.H.buildMatrix = opts => {
  const { corners, strength, zoom, panY, dispW, dispH } = opts;
  // 正規化コーナー → 表示px
  const p = corners.map(c => ({ x: c.x * dispW, y: c.y * dispH }));
  const r = RA.H.targetRect(p);
  const s = Math.max(0, Math.min(1, strength));
  const q = p.map((pt, i) => ({
    x: pt.x + (r[i].x - pt.x) * s,
    y: pt.y + (r[i].y - pt.y) * s,
  }));

  // ① 出力正規化 → 表示px
  let M = [dispW, 0, 0, 0, dispH, 0, 0, 0, 1];

  // ② ズーム/パンの逆: corr = c + (out - c - pan)/zoom
  const z = Math.max(0.2, zoom || 1);
  const cx = dispW / 2, cy = dispH / 2;
  const panPx = (panY || 0) * dispH;
  const Vinv = [1 / z, 0, cx - cx / z,
                0, 1 / z, cy - (cy + panPx) / z,
                0, 0, 1];
  M = RA.H.mul(Vinv, M);

  // ③ 補正の逆: 出力側の点 q(s) → ソース側の点 p
  const Hs = RA.H.quadToQuad(q, p);
  if (Hs) M = RA.H.mul(Hs, M);

  // ④ テクスチャ正規化(書き出しは回転逆→生px正規化、プレビューは表示px正規化)
  if (opts.raw) {
    const R = RA.H.rotToRaw(opts.rot, opts.rawW, opts.rawH);
    M = RA.H.mul(R, M);
    M = RA.H.mul([1 / opts.rawW, 0, 0, 0, 1 / opts.rawH, 0, 0, 0, 1], M);
  } else {
    M = RA.H.mul([1 / dispW, 0, 0, 0, 1 / dispH, 0, 0, 0, 1], M);
  }
  return M;
};

/* 起動時セルフテスト: 写像誤差 <1e-6 を確認 */
RA.testHomography = () => {
  let maxErr = 0;
  const chk = (got, want) => {
    maxErr = Math.max(maxErr, Math.abs(got.x - want.x), Math.abs(got.y - want.y));
  };
  // 1) 正方形→四角形
  const quad = [{ x: 120, y: 90 }, { x: 530, y: 110 }, { x: 610, y: 420 }, { x: 40, y: 400 }];
  const Hq = RA.H.squareToQuad(quad);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => chk(RA.H.apply(Hq, u, v), quad[i]));
  // 2) 四角形→四角形
  const A = [{ x: 10, y: 20 }, { x: 300, y: 15 }, { x: 280, y: 200 }, { x: 5, y: 210 }];
  const H2 = RA.H.quadToQuad(A, quad);
  A.forEach((a, i) => chk(RA.H.apply(H2, a.x, a.y), quad[i]));
  // 3) 逆行列
  const I = RA.H.mul(Hq, RA.H.inv(Hq));
  for (let i = 0; i < 9; i++) maxErr = Math.max(maxErr, Math.abs(I[i] - (i % 4 === 0 ? 1 : 0)));
  // 4) 強度0 = 恒等(出力正規化uvがソース正規化uvにそのまま写る)
  const M0 = RA.H.buildMatrix({
    corners: RA.presetCorners(), strength: 0, zoom: 1, panY: 0, dispW: 1920, dispH: 1080,
  });
  [[0.1, 0.2], [0.9, 0.8], [0.5, 0.5]].forEach(([u, v]) => chk(RA.H.apply(M0, u, v), { x: u, y: v }));
  // 5) 強度1 = コーナーが目標矩形の隅からソースの隅へ写る
  const corners = RA.presetCorners();
  const dispW = 1920, dispH = 1080;
  const p = corners.map(c => ({ x: c.x * dispW, y: c.y * dispH }));
  const r = RA.H.targetRect(p);
  const M1 = RA.H.buildMatrix({ corners, strength: 1, zoom: 1, panY: 0, dispW, dispH });
  r.forEach((ri, i) => {
    const got = RA.H.apply(M1, ri.x / dispW, ri.y / dispH);
    chk({ x: got.x * dispW, y: got.y * dispH }, p[i]);
  });

  const ok = maxErr < 1e-6;
  RA.log(`homography self-test ${ok ? "OK" : "FAILED"} (maxErr=${maxErr.toExponential(2)})`);
  return ok;
};
