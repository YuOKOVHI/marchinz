"use strict";
/* ============ MarchinZ Vlog: ロゴ(読み込み・自動透過・描画) ============
   PNGで既に透過しているものはそのまま使う。背景がついている画像(JPEG等や
   白地のPNG)は、四隅から色をたどって背景だけを抜く。

   方式: 縁の8点から背景色を推定 → 画像の外周から flood-fill で「外側から
   つながっている背景色の領域」だけをαゼロにする。塗りつぶし範囲を外周からの
   連結に限るのが肝で、ロゴ内部にある同じ色(白抜き文字の中など)は残る。 */

MV.logo = {
  THRESHOLD: 40,     // 背景色との距離(0-441)。既定40。スライダーで調整できる
  MAX_SIDE: 1024,    // 解析・保持する最大辺(これ以上は縮める)
};

/* 画像の読み込み。iOSのHEIC等も考えて createImageBitmap → <img> の二段構え */
MV.logo.decode = async file => {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (_) {
    return await new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      MV.logo._fallbackUrl = url;   // 外すときに解放できるよう控えておく
      img.onload = () => res(img);
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("画像を読み込めません（PNG か JPEG でお試しください）")); };
      img.src = url;
    });
  }
};

MV.logo.load = async file => {
  const bmp = await MV.logo.decode(file);
  const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
  const s = Math.min(1, MV.logo.MAX_SIDE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));

  const src = document.createElement("canvas");
  src.width = w; src.height = h;
  src.getContext("2d", { willReadFrequently: true }).drawImage(bmp, 0, 0, w, h);

  const isPng = /image\/png/i.test(file.type) || /\.png$/i.test(file.name);
  const hasAlpha = MV.logo.hasAlpha(src);

  MV.S.logo = {
    file, name: file.name, src, w, h,
    srcUrl: MV.logo._fallbackUrl || "",   // fallback経路のときだけ入る
    isPng: isPng && hasAlpha,
    threshold: MV.logo.THRESHOLD,
    useOriginal: isPng && hasAlpha,
    out: null, preview: "",
  };
  MV.logo.process();
  MV.log(`logo: ${file.name} ${w}x${h} png=${isPng} alpha=${hasAlpha}`);
};

/* 透過画素が実際にあるか(拡張子がPNGでも中身が不透明なことがある) */
MV.logo.hasAlpha = cv => {
  const { width: w, height: h } = cv;
  const d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) return true;   // 間引いて走査
  return false;
};

/* 背景色の推定: 四隅+各辺の中点(計8点)の最頻色 */
MV.logo.estimateBg = (d, w, h) => {
  const pts = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [w >> 1, 0], [w >> 1, h - 1], [0, h >> 1], [w - 1, h >> 1],
  ];
  const buckets = new Map();
  for (const [x, y] of pts) {
    const i = (y * w + x) * 4;
    // 近い色をまとめるため16段階に丸める
    const k = `${d[i] >> 4}|${d[i + 1] >> 4}|${d[i + 2] >> 4}`;
    const cur = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    cur.n++; cur.r += d[i]; cur.g += d[i + 1]; cur.b += d[i + 2];
    buckets.set(k, cur);
  }
  let best = null;
  for (const v of buckets.values()) if (!best || v.n > best.n) best = v;
  return [best.r / best.n, best.g / best.n, best.b / best.n];
};

/* 外周から連結している背景色だけを抜く(内部の同色は残す) */
MV.logo.process = () => {
  const lg = MV.S.logo;
  if (!lg) return;
  const { src, w, h } = lg;

  if (lg.useOriginal) {
    lg.out = src;
    lg.preview = src.toDataURL("image/png");
    return;
  }

  const sctx = src.getContext("2d", { willReadFrequently: true });
  const img = sctx.getImageData(0, 0, w, h);
  const d = img.data;
  const [br, bg, bb] = MV.logo.estimateBg(d, w, h);
  const th = lg.threshold;

  // 外周を起点に幅優先で塗る。スタックは Int32Array(画素index)で持つ
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = p => { if (!seen[p]) { seen[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }

  const near = p => {
    const i = p * 4;
    const dr = d[i] - br, dg = d[i + 1] - bg, db = d[i + 2] - bb;
    return Math.sqrt(dr * dr + dg * dg + db * db) <= th;
  };

  const mask = new Uint8Array(w * h);   // 1 = 背景(抜く)
  while (sp > 0) {
    const p = stack[--sp];
    if (!near(p)) continue;
    mask[p] = 1;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }

  // 縁を1pxぼかす(ギザギザ防止)。周囲8画素の平均で境界をなじませる
  const alpha = new Float32Array(w * h);
  for (let p = 0; p < mask.length; p++) alpha[p] = mask[p] ? 0 : 1;
  const soft = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += alpha[yy * w + xx]; n++;
        }
      }
      soft[p] = s / n;
    }
  }
  for (let p = 0; p < soft.length; p++) d[p * 4 + 3] = Math.round(soft[p] * 255);

  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d").putImageData(img, 0, 0);
  lg.out = out;
  lg.preview = out.toDataURL("image/png");

  const removed = mask.reduce((s, v) => s + v, 0);
  MV.log(`logo: 背景を${Math.round(removed / (w * h) * 100)}%抜きました (しきい値${th})`);
};

/* しきい値を変えてやり直す */
/* しきい値を変えてやり直す。src は process() で書き換えていない
   (getImageData はコピーを返し、結果は別canvasへ書いている)ので再デコード不要 */
MV.logo.retry = th => {
  if (!MV.S.logo) return;
  MV.S.logo.threshold = th;
  MV.S.logo.useOriginal = false;
  MV.logo.process();
  MV.ui.renderAll();
};

MV.logo.reload = async () => {
  const lg = MV.S.logo;
  if (!lg) return;
  const th = lg.threshold, useOrig = lg.useOriginal;
  await MV.logo.load(lg.file);
  MV.S.logo.threshold = th;
  MV.S.logo.useOriginal = useOrig;
  MV.logo.process();
  MV.ui.renderAll();
};

/* ---------- 描画 ---------- */
/* 右上の小さなロゴ(バグ)。ウォーターマーク(MZWM)とは別物で、こちらは団体のロゴ */
MV.logo.drawBug = (ctx, W, H, opacity = 0.85) => {
  const lg = MV.S.logo;
  if (!lg || !lg.out) return;
  const tw = W * 0.12;
  const th = tw * (lg.h / lg.w);
  const pad = W * 0.03;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(lg.out, W - tw - pad, pad, tw, th);
  ctx.restore();
};

/* エンディング: 単色背景に大きくロゴ。ロゴが無ければ団体名を出す */
MV.logo.drawEnd = (ctx, W, H, progress, color) => {
  ctx.save();
  ctx.fillStyle = color === "white" ? "#ffffff" : "#000000";
  ctx.fillRect(0, 0, W, H);
  // 0→0.25 でフェードイン、0.75→1 でフェードアウト
  const a = progress < 0.25 ? progress / 0.25
    : progress > 0.75 ? Math.max(0, (1 - progress) / 0.25) : 1;
  ctx.globalAlpha = a;
  const lg = MV.S.logo;
  if (lg && lg.out) {
    const tw = W * 0.35;
    const th = tw * (lg.h / lg.w);
    ctx.drawImage(lg.out, (W - tw) / 2, (H - th) / 2, tw, th);
  } else if (MV.S.orgName) {
    ctx.fillStyle = color === "white" ? "#0f2138" : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(W * 0.045)}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif`;
    ctx.fillText(MV.S.orgName, W / 2, H / 2);
  }
  ctx.restore();
};
