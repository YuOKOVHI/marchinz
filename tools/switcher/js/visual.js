"use strict";
/* ============ 映像解析(スイッチング用スコアリングの材料) ============
   各クリップをサンプリング(約1〜5秒間隔・最大120点)し、点ごとに
   ① フレームペア(t, t+0.12s)のブロックマッチングでグローバル動き
      → 手ブレ(大きく向きが暴れる)・急パン(大きく一方向)の検知
   ② Laplacian分散でシャープネス(フォーカス外れ・モーションブラー検知)
   ③ グローバル動き補償後の残差を6×4グリッドで集計
      → 画面のどれだけが動いているか(フラッグ全体アンサンブル等の手がかり)
   ④ YuNet顔検出(2点に1回) → 顔の数と最大サイズ
      → アップ/ミドル/引きのショット種推定(顔が大きい=アップ、多数で小さい=引き)
   結果は clip.visual にクリップローカル秒のタイムラインでキャッシュする。

   YuNetはPrivacyツールと同じ資産(../privacy/vendor/)を遅延ロードで共用する。
   iOS注意はPrivacy側の知見を踏襲: ORT 1.18固定 / iOS16.4はSIMDオフ。 */

MC.visual = {
  PAIR_DT: 0.12,     // ペア2枚目までの間隔(秒)
  MOTION_W: 128,     // モーション解析の幅(px)
  FACE_EVERY: 2,     // 顔検出は2サンプルに1回
  GRID_X: 6, GRID_Y: 4,
  // ブレ判定しきい値(画面幅比/秒)
  TH_RAPID: 0.28,    // これ以上のグローバル動き=急パン・激しいブレ
  TH_SHAKE: 0.11,    // これ以上=手ブレ(単独で失格。向きの暴れは条件にしない)
  // カメラを振っている(パン)の判定。向きが一定のまま動いている状態。
  // 手ブレ(向きが暴れる)と区別するため flipRatio が低いことを条件にする。
  // ディレクター指示: 振っている最中の絵は絶対に使わない
  TH_PAN: 0.05,       // これ以上動いていて
  TH_PAN_RATIO: 0.50, // 方向のそろった動きがこの割合を超えたら「振っている」
  // カメラ自身が動いたと言えるのは、その動き分で補正したときに画面が揃うとき。
  // 補正後もこれ以上の領域が動いていたら、動いていたのは被写体であってカメラではない
  TH_CAM_RESID: 0.55,
  // 被写体がいない画(誰もいないピット等)の判定
  TH_EMPTY: 0.12,    // 顔が取れず、動いている領域もこれ未満なら人がいない
  /* 「誰もいない」を判定するときに前後どれだけ見るか(秒)。
     空の舞台はずっと静かだが、隊形が決まって止まる瞬間は前後が動いている */
  NEAR_SEC: 8,
  /* WebCodecs解析でサンプル点の間がこれ(秒)より空くときだけシークで飛ぶ。
     続行 = 空白秒ぶんのフレームをデコード
     飛び = 平均 GOP長/2 ぶんの再デコード + reset + 読み直し
     つまり **間隔 > GOP長/2 のときだけシークが得**。実カメラのGOPは1〜2秒
     なので損益分岐は0.5〜1秒。3秒に置くのは、シーク回数を抑える方が
     素材の読み直し(Driveや大容量で遅い)の失敗リスクが下がるため。
     実測(2026-07-23、120秒/GOP2秒/間隔0.99秒、開発機):
       毎点シーク(HOP=0.3) 5175ms / 連続デコード(HOP≧1) 3337ms
     間隔0.99秒はGOP長の半分(1秒)とほぼ同じで、シークが損になる境界。
     8分30秒の実ケースは間隔4秒なのでシークが明確に得(この設定で正しい) */
  HOP: 3.0,
  /* 殺しスイッチ: trueで旧video要素シーク方式に固定(実機切り分け用) */
  forceSeek: false,
};

/* ---------- 顔検出の実行場所(3段構え) ----------
   ① 専用Worker(faceworker.js) … 前処理+推論を丸ごとWorkerで。デコードと完全並走
   ② ORT proxy Worker          … 推論だけWorker(前処理はメインに残る)
   ③ メインスレッド            … 従来どおり
   どれで走っても**計算は同一**(前処理コードは一字一句同じ)。
   殺しスイッチ: MC.visual.faceWorker = false(①を飛ばす) / faceProxy = false(②を飛ばす) */
MC.visual._fw = null;
MC.visual._fwDead = false;

MC.visual.initFaceWorker = () => {
  if (MC.visual._fwReadyP) return MC.visual._fwReadyP;
  MC.visual._fwReadyP = new Promise((res, rej) => {
    let w;
    // ページ(tools/switcher/)からの相対。?v=はscriptタグ側の流儀に合わせて付ける
    try { w = new Worker("js/faceworker.js?v=" + (document.documentElement.getAttribute("data-mz-app-v") || "1")); }
    catch (e) { rej(e); return; }
    const tm = setTimeout(() => { try { w.terminate(); } catch (_) {} rej(new Error("worker init timeout")); }, 15000);
    w.onmessage = ev => {
      const m = ev.data || {};
      if (m.type === "ready") {
        clearTimeout(tm);
        MC.visual._fw = w;
        MC.visual._fwSeq = 0;
        MC.visual._fwMap = new Map();
        MC.visual._fwInflight = [];
        w.onmessage = ev2 => {
          const r = ev2.data || {};
          const h = MC.visual._fwMap.get(r.id);
          if (!h) return;
          MC.visual._fwMap.delete(r.id);
          if (r.type === "result") h.res(r.res);
          else h.rej(new Error(r.message || "worker error"));
        };
        w.onerror = e2 => {
          MC.visual._fwDead = true;
          for (const h of MC.visual._fwMap.values()) h.rej(new Error("worker crashed"));
          MC.visual._fwMap.clear();
        };
        res(w);
      } else if (m.type === "init-error") {
        clearTimeout(tm);
        try { w.terminate(); } catch (_) {}
        rej(new Error(m.message));
      }
    };
    w.onerror = e => { clearTimeout(tm); rej(new Error("workerを起動できません")); };
    const base = new URL("../privacy/vendor/", location.href).href;
    /* SIMDの誤答判定は MZDevice 1箇所に集約(2026-08-01)。
       同じ式がここと下の ORT 初期化に二重にあった */
    w.postMessage({ type: "init", base, noSimd: !!(window.MZDevice && MZDevice.simdBroken) });
  }).catch(e => { MC.visual._fwReadyP = null; MC.visual._fwDead = true; throw e; });
  return MC.visual._fwReadyP;
};

/** VideoFrameをWorkerへtransferして顔検出。呼び出し時にclone(同期)するので、
    呼び出し直後に元フレームをcloseしてよい */
MC.visual._fwDetect = (frame, sw, sh, rotation) => {
  let clone;
  try { clone = frame.clone(); }
  catch (e) { return Promise.reject(e); }
  return (async () => {
    // 背圧: Workerへ積みすぎない(VideoFrameを掴んだまま滞留させない)。同時4件まで
    while (MC.visual._fwInflight.length >= 4) {
      await Promise.race(MC.visual._fwInflight).catch(() => {});
    }
    if (MC.visual._fwDead || !MC.visual._fw) { try { clone.close(); } catch (_) {} throw new Error("worker dead"); }
    const id = ++MC.visual._fwSeq;
    const p = new Promise((res, rej) => MC.visual._fwMap.set(id, { res, rej }));
    const track = p.then(() => {}, () => {}).finally(() => {
      const i = MC.visual._fwInflight.indexOf(track);
      if (i >= 0) MC.visual._fwInflight.splice(i, 1);
    });
    MC.visual._fwInflight.push(track);
    MC.visual._fw.postMessage({ type: "detect", id, frame: clone, sw, sh, rotation }, [clone]);
    return p;
  })();
};

/** 顔検出の準備。使える実行場所を選んで返す("worker"|"proxy"|"main") */
MC.visual.initFace = async () => {
  if (MC.visual.faceWorker !== false && !MC.visual._fwDead) {
    try { await MC.visual.initFaceWorker(); return "worker"; }
    catch (e) { MC.log("visual: 専用Worker不可→次の手段へ:", e && e.message); }
  }
  await MC.visual.initYuNet();
  return MC.visual._proxyOn ? "proxy" : "main";
};

/* ---------- YuNet(ORT)遅延ロード: Privacyのvendorを共用 ---------- */
MC.visual._ort = null;

MC.visual.initYuNet = async () => {
  if (MC.visual._ort) return MC.visual._ort;
  if (MC.visual._ortP) return MC.visual._ortP;
  MC.visual._ortP = (async () => {
    const base = new URL("../privacy/vendor/", location.href).href;
    if (!window.ort) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = base + "ort.min.js";
        s.onload = res;
        s.onerror = () => rej(new Error("ort.min.jsを読み込めません"));
        document.head.appendChild(s);
      });
    }
    ort.env.wasm.wasmPaths = base;
    ort.env.wasm.numThreads = 1;
    // iOS/Safari 16.4 のSIMD誤答バグ回避。判定は MZDevice 1箇所(2026-08-01)
    if (window.MZDevice && MZDevice.simdBroken) ort.env.wasm.simd = false;
    /* 推論をORT付属のproxy Workerへ(Phase 3 / 2026-07-23)。
       wasm推論はメインスレッドを止めるため、デコードと直列になっていた
       (顔61% vs デコード39%の実測)。Workerなら2つが重なり合計≒max(両者)。
       モデル・入力・フレームは同一なので**結果は変わらない**(検証で完全一致を確認)。
       proxyを作れない環境は従来どおりメインスレッドで動く。
       殺しスイッチ: MC.visual.faceProxy = false */
    let session = null;
    MC.visual._proxyOn = false;
    if (MC.visual.faceProxy !== false) {
      try {
        ort.env.wasm.proxy = true;
        session = await ort.InferenceSession.create(
          base + "face_detection_yunet_2023mar.onnx",
          { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
        MC.visual._proxyOn = true;
      } catch (e) {
        MC.log("visual: proxy Worker不可→メインスレッドで続行:", e && e.message);
        session = null;
      }
    }
    if (!session) {
      ort.env.wasm.proxy = false;
      session = await ort.InferenceSession.create(
        base + "face_detection_yunet_2023mar.onnx",
        { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    }
    MC.log("visual: yunet ready" + (MC.visual._proxyOn ? " (worker)" : ""));
    MC.visual._ort = session;
    return session;
  })().catch(e => { MC.visual._ortP = null; throw e; });
  return MC.visual._ortP;
};

/* 顔検出(全体1発)。ソース→640²正方(表示辺max基準)へ縮小してBGR planar化。
   VideoFrame は tkhd 回転が適用されていないため rotation を渡して正立させてから
   検出する(これを忘れると縦撮り素材の顔検出が全滅する)。
   <video> はブラウザが回転適用済みなので rotation=0 の薄いラッパを使う */
MC.visual.detectFacesFrom = async (source, sw, sh, rotation = 0) => {
  /* 専用Workerが生きていて、ソースがVideoFrame(=transfer可能)ならWorkerで。
     <video>やcanvasはtransferできないため従来経路(下)を使う */
  if (MC.visual._fw && !MC.visual._fwDead &&
      typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
    return MC.visual._fwDetect(source, sw, sh, rotation);
  }
  const session = MC.visual._ort;
  if (!session) return null;
  const rot = (((rotation || 0) % 360) + 360) % 360;
  const swp = rot === 90 || rot === 270;
  const dw = swp ? sh : sw, dh = swp ? sw : sh;   // 表示上の寸法
  const S = Math.max(dw, dh);
  const c = MC.visual._fcv || (MC.visual._fcv = document.createElement("canvas"));
  if (c.width !== 640) { c.width = 640; c.height = 640; }
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 640, 640);
  const k = 640 / S;
  ctx.save();
  ctx.translate(dw * k / 2, dh * k / 2);
  if (rot) ctx.rotate(rot * Math.PI / 180);
  ctx.scale(k, k);
  ctx.drawImage(source, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
  /* ここまで(画素の取り出し)は同期。VideoFrameは呼び出し直後にcloseされるため、
     awaitを挟む前に必ずコピーを終えること(Phase 3で遅延実行にした際の前提) */
  const px = ctx.getImageData(0, 0, 640, 640).data;
  const N = 640 * 640;
  /* proxy(Worker)時は入力バッファを**毎回新品**にする。ORT proxyはテンソルの
     ArrayBufferをWorkerへtransferするため、run()を呼んだ瞬間に手元のバッファは
     長さ0に無効化される(再利用すると "data length(0)" で全滅。2026-07-23実測)。
     transferはコピーではないので、新品を作って渡すのが正しくかつ速い。
     非proxy時は従来どおり1本を使い回す(同期実行でバッファは無傷) */
  const d = MC.visual._proxyOn
    ? new Float32Array(3 * N)
    : (MC.visual._fbuf || (MC.visual._fbuf = new Float32Array(3 * N)));
  for (let i = 0; i < N; i++) {
    d[i] = px[i * 4 + 2];
    d[N + i] = px[i * 4 + 1];
    d[2 * N + i] = px[i * 4];
  }
  /* 背圧: Workerへ積みすぎない(1件4.9MBが滞留するため)。同時4件まで */
  if (!MC.visual._inflight) MC.visual._inflight = [];
  while (MC.visual._inflight.length >= 4) {
    await Promise.race(MC.visual._inflight).catch(() => {});
  }
  const runP = session.run({ input: new ort.Tensor("float32", d, [1, 3, 640, 640]) });
  const track = runP.then(() => {}, () => {}).finally(() => {
    const i = MC.visual._inflight.indexOf(track);
    if (i >= 0) MC.visual._inflight.splice(i, 1);
  });
  MC.visual._inflight.push(track);
  const out = await runP;
  // stride 8/16/32 のcls/obj/bboxを復元(Privacy yunet.jsと同じ)
  let dets = [];
  for (const s of [8, 16, 32]) {
    const cls = out["cls_" + s].data, obj = out["obj_" + s].data,
          bb = out["bbox_" + s].data, cols = 640 / s;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(
        Math.max(0, Math.min(1, cls[i])) * Math.max(0, Math.min(1, obj[i])));
      if (score < 0.5) continue;
      const row = (i / cols) | 0, col = i % cols;
      const cx = (col + bb[i * 4]) * s, cy = (row + bb[i * 4 + 1]) * s;
      const w = Math.exp(bb[i * 4 + 2]) * s, h = Math.exp(bb[i * 4 + 3]) * s;
      if (!(w > 0 && h > 0)) continue;
      dets.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
    }
  }
  dets = MC.visual._nms(dets, 0.35);
  // 640²(S基準の正方)→フレーム相対へ。フレーム外に落ちた検出は捨てる
  const res = [];
  for (const de of dets) {
    const fx = (de.x + de.w / 2) / 640 * S, fy = (de.y + de.h / 2) / 640 * S;
    if (fx < 0 || fx > dw || fy < 0 || fy > dh) continue;
    res.push({ h: de.h / 640 * S / dh, score: de.score });
  }
  return res;
};

MC.visual.detectFaces = v => MC.visual.detectFacesFrom(v, v.videoWidth, v.videoHeight, 0);

MC.visual._nms = (dets, iouTh) => {
  dets.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const d of dets) {
    let ok = true;
    for (const k of keep) {
      const x1 = Math.max(d.x, k.x), y1 = Math.max(d.y, k.y);
      const x2 = Math.min(d.x + d.w, k.x + k.w), y2 = Math.min(d.y + d.h, k.y + k.h);
      const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      if (inter / (d.w * d.h + k.w * k.h - inter) > iouTh) { ok = false; break; }
    }
    if (ok) keep.push(d);
  }
  return keep;
};

/* ---------- フレーム取得・モーション ---------- */
MC.visual.seek = (v, t) => new Promise(res => {
  const tm = setTimeout(() => { v.removeEventListener("seeked", h); res(); }, 2500);
  const h = () => { clearTimeout(tm); res(); };
  v.addEventListener("seeked", h, { once: true });
  v.currentTime = Math.max(0, Math.min(v.duration - 0.05, t));
});

/* フレームをグレースケール小画像へ。rotation は VideoFrame 用
   (tkhd回転を自前で適用して正立させる。<video>は適用済みなので0) */
MC.visual.grabGrayFrom = (source, sw, sh, rotation = 0) => {
  const rot = (((rotation || 0) % 360) + 360) % 360;
  const swp = rot === 90 || rot === 270;
  const dw = swp ? sh : sw, dh = swp ? sw : sh;   // 表示上の寸法
  const w = MC.visual.MOTION_W;
  const h = Math.max(8, Math.round(dh / dw * w));
  const c = MC.visual._mcv || (MC.visual._mcv = document.createElement("canvas"));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (rot) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rot * Math.PI / 180);
    const sc = w / dw;
    ctx.scale(sc, sc);
    ctx.drawImage(source, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  } else {
    ctx.drawImage(source, 0, 0, w, h);
  }
  const px = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
  }
  return { g, w, h };
};

MC.visual.grabGray = v => MC.visual.grabGrayFrom(v, v.videoWidth, v.videoHeight, 0);

/* Laplacian分散(シャープネス)。ブラー・フォーカス外れで低下 */
MC.visual.sharpness = A => {
  const { g, w, h } = A;
  let sum = 0, sq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i];
      sum += v; sq += v * v; n++;
    }
  }
  const mean = sum / n;
  return sq / n - mean * mean;
};

/* グローバル動き推定: 中央領域のSAD最小探索(±8px、1px格子)＋サブピクセル補間。
   戻り値 { dx, dy }        … 整数(残差補償のシフトに使う。補間値では画素をずらせない)
           { fdx, fdy }     … サブピクセル(ブレ量の計算に使う)

   ★ 補間が要る理由(2026-07-31 実測)。整数だけだと、128px幅・dt=0.12秒では
     1px = ブレ量0.065 の階段になり、手ブレのしきい値 0.11 は 1px と 2px の
     あいだに落ちる ─ つまり**静止から失格までに段階が実質2つしかない**。
     実測: ずれ0.5px→0.065 / 1px→0.065 / 1.5px→0.130 / 2px→0.130
     1.5px と 2px が同じ値になり、手持ちカメラは構造的に全滅していた
     (引き継ぎ書③の「ブレ判定が1px量子化」。DCI団体のレビューでも
      「3.2秒のショットを0.12秒の1点で決めている」と独立に指摘された)。
     SAD最小点の両隣を放物線で結んで頂点を求めれば、実際のずれに比例した
     連続値が得られる ─ 追加コストは最小点まわりの3点を覚えておくだけ */
MC.visual.globalMotion = (A, B) => {
  const { g: a, w, h } = A;
  const b = B.g;
  const R = 8;
  const x0 = R + 2, x1 = w - R - 2, y0 = R + 2, y1 = h - R - 2;
  const N = 2 * R + 1;
  const sad = new Float32Array(N * N);
  let bestDx = 0, bestDy = 0, bestS = Infinity;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      let s = 0;
      for (let y = y0; y < y1; y += 2) {
        const ra = y * w, rb = (y + dy) * w + dx;
        for (let x = x0; x < x1; x += 2) s += Math.abs(a[ra + x] - b[rb + x]);
      }
      sad[(dy + R) * N + (dx + R)] = s;
      if (s < bestS) { bestS = s; bestDx = dx; bestDy = dy; }
    }
  }
  /* 放物線フィットで頂点を求める。両隣が探索範囲の外なら補間しない。
     分母は下に凸(谷)のとき正。0以下なら谷になっていないので補間を捨てる。
     ずれは±0.5pxに収める(隣の格子を越えるのは、そもそも最小点が違う) */
  const sub = (c, m, p) => {
    const den = m - 2 * c + p;
    if (!(den > 0)) return 0;
    return Math.max(-0.5, Math.min(0.5, 0.5 * (m - p) / den));
  };
  const ix = bestDx + R, iy = bestDy + R;
  const fdx = bestDx + ((ix > 0 && ix < N - 1)
    ? sub(sad[iy * N + ix], sad[iy * N + ix - 1], sad[iy * N + ix + 1]) : 0);
  const fdy = bestDy + ((iy > 0 && iy < N - 1)
    ? sub(sad[iy * N + ix], sad[(iy - 1) * N + ix], sad[(iy + 1) * N + ix]) : 0);
  return { dx: bestDx, dy: bestDy, fdx, fdy };
};

/* グローバル動き補償後の残差をグリッド集計 → 動いている領域の割合と強さ */
MC.visual.residualGrid = (A, B, dx, dy) => {
  const { g: a, w, h } = A;
  const b = B.g;
  const GX = MC.visual.GRID_X, GY = MC.visual.GRID_Y;
  const cellE = new Float32Array(GX * GY);
  const cellN = new Float32Array(GX * GY);
  for (let y = 2; y < h - 2; y++) {
    const by = y + dy;
    if (by < 0 || by >= h) continue;
    const gy = Math.min(GY - 1, (y / h * GY) | 0);
    for (let x = 2; x < w - 2; x++) {
      const bx = x + dx;
      if (bx < 0 || bx >= w) continue;
      const gx = Math.min(GX - 1, (x / w * GX) | 0);
      const i = gy * GX + gx;
      cellE[i] += Math.abs(a[y * w + x] - b[by * w + bx]);
      cellN[i]++;
    }
  }
  let active = 0, total = 0, cells = 0;
  for (let i = 0; i < GX * GY; i++) {
    if (!cellN[i]) continue;
    const e = cellE[i] / cellN[i] / 255;   // 0..1
    total += e; cells++;
    if (e > 0.055) active++;
  }
  return { moE: cells ? total / cells : 0, act: cells ? active / cells : 0 };
};

/* ---------- クリップ解析(メイン) ---------- */
/* 1サンプル点の計算(ペア2枚→動き/シャープ/残差/顔)。
   WebCodecs経路とシーク経路で同じ数式を使うために抽出した。
   dt はペア2枚の実時刻差(WebCodecsでは実フレーム差、シークではPAIR_DT) */
MC.visual._samplePoint = (V, A, B, faces, t, dt) => {
  const gm = MC.visual.globalMotion(A, B);
  const res = MC.visual.residualGrid(A, B, gm.dx, gm.dy);
  V.t.push(t);
  /* ブレ量はサブピクセル値で。整数だと 1px=0.065 の階段になり、
     しきい値0.11 が 1px と 2px のあいだに落ちて段階が2つしかなくなる */
  V.shake.push(Math.hypot(gm.fdx ?? gm.dx, gm.fdy ?? gm.dy) / A.w / dt);   // 画面幅比/秒
  V.dxs.push(gm.fdx ?? gm.dx);
  V.sharp.push(MC.visual.sharpness(A));
  V.moE.push(res.moE);
  V.act.push(res.act);
  V.nF.push(faces ? faces.length : -1);           // -1 = この点は未検出
  V.maxF.push(faces && faces.length ? Math.max(...faces.map(f => f.h)) : (faces ? 0 : -1));
};

/* サンプル収集後の集計(中央値・撮り方の自動判定)。両経路共通 */
MC.visual._finalize = V => {
  const ss = [...V.sharp].sort((a, b) => a - b);
  V.sharpMed = ss.length ? ss[ss.length >> 1] : 0;

  /* 撮り方の自動判定。
     判別の原理は「背景ごと動いたか、被写体だけが動いたか」:
       ・カメラマン付き(手持ち・ジンバル・操作する三脚)
           → 画面全体が動く。その動き分ずらせば画面がピタリと揃う = 残差が小さい
       ・定点固定カメラ
           → 動くのは被写体だけ。カメラは動いていない

     残差(補正後の act)を条件に入れているのが肝。globalMotion は
     中央のブロックマッチングなので、大きな被写体が画面を占めると
     マッチングが被写体に食いついて dx≠0 になる。その動きで補正すると
     背景がずれて残差が大きくなるため、それをカメラの動きから除外できる。
     この条件が無いと「定点カメラで奏者が大きく動いただけ」を
     カメラマン付きと誤判定する */
  let camMoveN = 0;
  for (let i = 0; i < V.dxs.length; i++) {
    if (Math.abs(V.dxs[i]) >= 2 && V.act[i] < MC.visual.TH_CAM_RESID) camMoveN++;
  }
  V.movingFrac = V.dxs.length ? camMoveN / V.dxs.length : 0;
  V.operated = V.movingFrac > 0.15;
};

/* 入口: WebCodecs逐次デコード(速い)を試し、開けない素材・失敗は
   従来のvideo要素シーク方式へ自動フォールバック。
   iOSのシークは1回数十〜数百msで、1点2シーク×最大120点が解析の主コストだった
   (2026-07-22 高速化)。MC.visual.forceSeek=true で旧方式へ固定できる */
MC.visual.analyzeClip = async (clip, l0, l1, prog) => {
  const key = `${l0.toFixed(1)}|${l1.toFixed(1)}`;
  if (clip.visual && clip.visual.key === key) return clip.visual;
  if (!MC.visual.forceSeek && typeof VideoDecoder !== "undefined" &&
      !clip._wcAnalyzeNG && clip.file) {
    try {
      const V = await MC.visual.analyzeClipWC(clip, l0, l1, prog);
      clip.visual = V;
      return V;
    } catch (e) {
      clip._wcAnalyzeNG = true;   // この素材では再挑戦しない
      MC.log("visual: WebCodecs解析不可→シーク方式へ:", clip.name, e && e.message);
    }
  }
  return MC.visual.analyzeClipSeek(clip, l0, l1, prog);
};

/* WebCodecs経路: 連続デコードの流れからサンプル点を拾う。
   1点2シークの往復が消えるぶん速い。色統計(colormatch)の8点も
   同じ流れに相乗りさせ、2度目の動画オープンを消す */
MC.visual.analyzeClipWC = async (clip, l0, l1, prog) => {
  const key = `${l0.toFixed(1)}|${l1.toFixed(1)}`;
  const range = Math.max(1, l1 - l0);
  const interval = Math.max(0.8, Math.min(5, range / 120));
  const n = Math.max(2, Math.floor(range / interval));
  let faceOK = true;
  try { const mode = await MC.visual.initFace(); MC.log("visual: 顔検出=" + mode); }
  catch (e) { faceOK = false; MC.log("visual: 顔検出なしで続行:", e.message); }

  // 欲しい時刻(昇順)。A=ペア1枚目 / B=2枚目 / color=色統計
  const wanted = [];
  let pts = 0;
  for (let i = 0; i < n; i++) {
    const t = l0 + (i + 0.5) * interval;
    if (t >= clip.duration - 0.2) break;
    wanted.push({ t, kind: "A", i: pts });
    wanted.push({ t: t + MC.visual.PAIR_DT, kind: "B", i: pts });
    pts++;
  }
  if (!pts) throw new Error("解析範囲が短すぎます");
  const wantColor = !clip.colorStats && MC.color && MC.color.statsAcc;
  if (wantColor) {
    for (let j = 0; j < MC.color.STATS_FRAMES; j++) {
      const t = clip.duration * (0.1 + 0.8 * j / (MC.color.STATS_FRAMES - 1));
      wanted.push({ t: Math.min(t, clip.duration - 0.25), kind: "color" });
    }
  }
  wanted.sort((a, b) => a.t - b.t);

  const src = new MZ_MP4.MP4Source(clip.file);
  await src.init();
  const vt = src.videoTrack();
  if (!vt) throw new Error("映像トラックなし");
  const cfg = src.videoDecoderConfig();
  if (!cfg) throw new Error("デコード設定を作れません");
  const sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!sup.supported) throw new Error("デコード非対応: " + cfg.codec);
  const rotation = src.rotationOf(vt);      // VideoDecoderはtkhd回転を適用しない
  const tsOff = src.editOffsetSec(vt);      // elst補正: frameSec = ts - tsOff
  const cur = src.cursor(vt.id);

  let decErr = null;
  const outQ = [];
  const dec = new VideoDecoder({ output: f => outQ.push(f), error: e => { decErr = e; } });
  dec.configure(cfg);

  const V = { key, t: [], shake: [], dxs: [], sharp: [], moE: [], act: [], nF: [], maxF: [], faceOK };
  const colorAcc = wantColor ? MC.color.statsAcc() : null;
  const pending = {};      // ペア1枚目の保管: i -> {A, tA, tWant, facesP}
  const deferred = [];     // 組み立て待ちのサンプル(順序保持。Phase 3)
  let sampleDone = 0;
  let lastTs = -Infinity;  // 直近で出したフレームの秒(HOP判定)
  let srcEof = false, flushed = false, drained = false;
  /* ★ キーフレーム待ち(2026-08-02)。configure/reset の直後のデコーダは
     RAP しか受け取らず、デルタを食わせると decode() が即例外を投げる
     ("Key frame is required")。この解析は catch してシーク方式へ落ちるので
     実害は速度だけだったが、同じ根っこで**書き出しは即死していた**。
     供給元(cursor)は必ず RAP から返すので普段ここは動かない。
     動いたら供給側の不具合なので、枚数を記録に残す */
  let needKey = true, droppedDelta = 0;

  const closeAll = () => { outQ.forEach(f => { try { f.close(); } catch (e) {} }); outQ.length = 0; };

  try {
    cur.seek(Math.max(0, wanted[0].t));
    for (let ptr = 0; ptr < wanted.length; ptr++) {
      if (decErr) throw decErr;
      if (drained) break;                      // 素材が尽きた(末尾の点は欠測扱い)
      const wt = wanted[ptr];
      if (wt.t >= clip.duration - 0.05) continue;
      // 次の点まで遠い→間のGOPをデコードせずシークで飛ぶ
      if (isFinite(lastTs) && wt.t - lastTs > MC.visual.HOP) {
        /* flush() は溜まった出力を全部待つ同期点で、捨てるだけなのに待つのは無駄。
           reset() は保留を捨てるだけで速い(実測40回シークで 643ms→507ms、21%短縮)。
           reset 後は設定が消えるので configure し直す */
        try { dec.reset(); dec.configure(cfg); }
        catch (e) { await dec.flush().catch(() => {}); }   // reset非対応環境は従来どおり
        closeAll();
        cur.seek(wt.t);
        needKey = true;                    // reset/flush 後はキーフレーム必須
        srcEof = false; flushed = false;
        lastTs = -Infinity;
      }
      // wt.t 以後の最初のフレームを得る
      let frame = null, guard = 0;
      while (!frame) {
        if (decErr) throw decErr;
        while (outQ.length) {
          const f = outQ[0];
          const fs = f.timestamp / 1e6 - tsOff;
          if (fs + 1e-6 < wt.t) { lastTs = fs; outQ.shift().close(); }
          else { frame = outQ.shift(); lastTs = fs; break; }
        }
        if (frame) break;
        if (srcEof && flushed && !outQ.length) { drained = true; break; }
        if (!srcEof && dec.decodeQueueSize < (MC.isIOS ? 6 : 12) && outQ.length < (MC.isIOS ? 4 : 8)) {
          const { value: s, done } = await cur.next();
          if (done) {
            srcEof = true;
            await dec.flush().catch(() => {});
            flushed = true;
            continue;
          }
          if (needKey && !s.is_sync) {
            droppedDelta++;                // キーフレームが来るまで食わせない
          } else {
            needKey = false;
            dec.decode(new EncodedVideoChunk({
              type: s.is_sync ? "key" : "delta",
              timestamp: Math.round(s.cts * 1e6 / s.timescale),
              duration: Math.max(1, Math.round(s.duration * 1e6 / s.timescale)),
              data: s.data,
            }));
          }
        } else {
          await MC.waitDequeue(dec, 50);   // 出力待ち(イベント駆動)
        }
        if (++guard > 20000) throw new Error("解析デコードが進みません");
      }
      if (!frame) continue;
      const fSec = frame.timestamp / 1e6 - tsOff;
      const fw = frame.displayWidth || frame.codedWidth;
      const fh = frame.displayHeight || frame.codedHeight;
      if (wt.kind === "color") {
        if (colorAcc) colorAcc.add(frame, fw, fh);
      } else if (wt.kind === "A") {
        const A = MC.visual.grabGrayFrom(frame, fw, fh, rotation);
        /* 顔検出はawaitしない(Phase 3)。画素の取り出しは関数内の同期部で終わるので、
           この後すぐ frame.close() しても安全。推論はWorkerで走り、
           その間メインスレッドは次のフレームのデコードを進める */
        let facesP = null;
        if (faceOK && wt.i % MC.visual.FACE_EVERY === 0) {
          facesP = MC.visual.detectFacesFrom(frame, fw, fh, rotation);
          facesP.catch(() => {});   // 失敗は組み立て時にまとめて拾う(unhandled回避)
        }
        pending[wt.i] = { A, tA: fSec, tWant: wt.t, facesP };
      } else {   // "B" = ペア2枚目
        const P = pending[wt.i];
        if (P) {
          const B = MC.visual.grabGrayFrom(frame, fw, fh, rotation);
          /* 実フレームの時刻差で正規化(30fpsはPAIR_DT=0.12にぴったり乗らない)。
             同一フレームを掴んだ場合(dt→0)はdx=0なのでclampで害はない */
          const dt = Math.max(0.02, fSec - P.tA);
          /* その場で_samplePointしない(Phase 3)。顔の答え(facesP)を待つと
             せっかくWorkerへ逃した推論と再び直列になる。順序ごと控えておき、
             デコードが全部終わってからまとめて組み立てる(V配列の並びは不変)。
             控えるのは縮小グレー(128px幅・約9KB)×最大240枚≒2MBで軽い */
          deferred.push({ A: P.A, B, facesP: P.facesP, tWant: P.tWant, dt });
          delete pending[wt.i];
        }
        sampleDone++;
        if (prog) prog(sampleDone, pts);
      }
      frame.close();
      await MC.yield();
    }
  } finally {
    try { dec.close(); } catch (e) {}
    closeAll();
  }
  /* デコードが終わってから、順序どおりに組み立てる。顔の答えが未着なら
     ここで待つ(Workerが遅れても最後にまとめて追いつく) */
  for (const dS of deferred) {
    let faces = null;
    if (dS.facesP) {
      try { faces = await dS.facesP; }
      catch (e) { faceOK = false; V.faceOK = false; }
    }
    MC.visual._samplePoint(V, dS.A, dS.B, faces, dS.tWant, dS.dt);
  }
  if (V.t.length < 2) throw new Error("解析サンプルが取れません");
  MC.visual._finalize(V);
  if (colorAcc && colorAcc.count() > 0) clip.colorStats = colorAcc.finish();
  MC.log(`visual: WC解析 ${clip.name} 点${V.t.length}/${pts}` + (clip.colorStats ? " +色統計" : "")
         + (droppedDelta ? ` /キーフレーム待ちで${droppedDelta}枚捨てた` : ""));
  return V;
};

/* 従来経路(video要素シーク)。WebCodecsが使えない素材・失敗時の受け皿。
   l0/l1 = クリップローカル秒。prog(i,n)で進捗通知。clip.visualへキャッシュ */
MC.visual.analyzeClipSeek = async (clip, l0, l1, prog) => {
  const key = `${l0.toFixed(1)}|${l1.toFixed(1)}`;
  if (clip.visual && clip.visual.key === key) return clip.visual;
  const v = clip.video;
  const keep = v.currentTime;
  const range = Math.max(1, l1 - l0);
  const interval = Math.max(0.8, Math.min(5, range / 120));
  const n = Math.max(2, Math.floor(range / interval));
  let faceOK = true;
  try { await MC.visual.initYuNet(); }
  catch (e) { faceOK = false; MC.log("visual: 顔検出なしで続行:", e.message); }

  const V = {
    key, t: [], shake: [], dxs: [], sharp: [], moE: [], act: [],
    nF: [], maxF: [], faceOK,
  };
  for (let i = 0; i < n; i++) {
    const t = l0 + (i + 0.5) * interval;
    if (t >= clip.duration - 0.2) break;
    await MC.visual.seek(v, t);
    const A = MC.visual.grabGray(v);
    // 顔検出はseek直後のフレームで(2点に1回)
    let faces = null;
    if (faceOK && i % MC.visual.FACE_EVERY === 0) {
      try { faces = await MC.visual.detectFaces(v); }
      catch (e) { faceOK = false; V.faceOK = false; }
    }
    await MC.visual.seek(v, t + MC.visual.PAIR_DT);
    const B = MC.visual.grabGray(v);
    MC.visual._samplePoint(V, A, B, faces, t, MC.visual.PAIR_DT);
    if (prog) prog(i + 1, n);
    await MC.yield();
  }
  MC.visual._finalize(V);
  await MC.visual.seek(v, keep);
  clip.visual = V;
  return V;
};

/* ---------- セグメント集計(グローバル秒区間 → 指標) ---------- */
MC.visual.seg = (clip, g0, g1) => {
  const V = clip.visual;
  if (!V || !V.t.length) return null;
  const l0 = g0 - clip.offset, l1 = g1 - clip.offset;
  let idx = [];
  for (let i = 0; i < V.t.length; i++) if (V.t[i] >= l0 && V.t[i] <= l1) idx.push(i);
  if (!idx.length) {
    // 区間内にサンプルが無ければ最寄り1点
    let best = 0, bd = Infinity;
    const mid = (l0 + l1) / 2;
    for (let i = 0; i < V.t.length; i++) {
      const d = Math.abs(V.t[i] - mid);
      if (d < bd) { bd = d; best = i; }
    }
    idx = [best];
  }
  const pick = arr => idx.map(i => arr[i]);
  const sorted = a => [...a].sort((x, y) => x - y);
  const p = (a, q) => { const s = sorted(a); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
  const shakes = pick(V.shake);
  const dxs = pick(V.dxs);
  // 向きの暴れ: 隣接サンプルでdxの符号が反転する割合(動きが小さい点は除外)
  let flips = 0, moves = 0;
  for (let k = 1; k < dxs.length; k++) {
    const a = dxs[k - 1], b = dxs[k];
    if (Math.abs(a) < 2 || Math.abs(b) < 2) continue;
    moves++;
    if (Math.sign(a) !== Math.sign(b)) flips++;
  }
  /* パン(カメラを振っている)の度合い。
     「カメラが動いたと言えるサンプルの割合」×「その向きがそろっている割合」。

     カメラが動いたと数えるのは、はっきり動いていて(|dx|>=2)、かつ
     その動きで補正したときに画面が揃う(残差 act が小さい)ときだけ。
     定点カメラの前で奏者が大きく動くと、中央のブロックマッチングが被写体に
     食いついて dx≠0 になるが、その動きで補正すると背景がずれて残差が大きくなる。
     この条件が無いと「被写体が動いただけ」をパン扱いで失格にしてしまう。

     また、固定カメラのノイズ由来の微小な揺れ(1px程度)は |dx|<2 で除外されるため
     panRatio が 0 になる。shakeP75 と flipRatio だけで判定すると、
     flipRatio は |dx|<2 のサンプルを数えないので 0(=向きが一定)と評価され、
     固定カメラが誤ってパン扱いになる */
  const acts = pick(V.act);
  let posN = 0, negN = 0, camMoveN = 0;
  for (let k = 0; k < dxs.length; k++) {
    const v = dxs[k];
    if (Math.abs(v) < 2) continue;
    if (acts[k] >= MC.visual.TH_CAM_RESID) continue;   // 動いたのは被写体でカメラではない
    camMoveN++;
    if (v > 0) posN++; else negN++;
  }
  const panRatio = camMoveN
    ? (Math.max(posN, negN) / camMoveN) * (camMoveN / dxs.length)
    : 0;
  const faces = [];
  const sizes = [];
  for (const i of idx) {
    if (V.nF[i] >= 0) { faces.push(V.nF[i]); sizes.push(V.maxF[i]); }
  }
  /* 「被写体が動いただけ」のサンプルを除いた手ブレ量。補正後も画面が揃わない
     (act >= TH_CAM_RESID)ときは、動いたのはカメラではなく被写体なので数えない。
     panRatio(:722)と operated(:439)は同じ考えで既に除外していた(2026-07-29) */
  const shakesCam = idx.filter(i => V.act[i] < MC.visual.TH_CAM_RESID).map(i => V.shake[i]);
  /* この区間の前後(±NEAR秒)も含めた動きの量。
     「誰もいない」の判定に使う ─ 区間内だけを見ると、隊形が決まって
     全員が静止した一瞬が「動いていない=人がいない」になる(下の noSubject 参照) */
  let nearSum = 0, nearN = 0;
  {
    const c0 = (l0 + l1) / 2, R = MC.visual.NEAR_SEC;
    for (let i = 0; i < V.t.length; i++) {
      if (Math.abs(V.t[i] - c0) <= R) { nearSum += V.act[i]; nearN++; }
    }
  }
  return {
    actNear: nearN ? nearSum / nearN : null,
    n: idx.length,
    shakeP75: p(shakes, 0.75),
    shakeCamP75: shakesCam.length ? p(shakesCam, 0.75) : null,
    flipRatio: moves ? flips / moves : 0,
    panRatio,
    // 撮り方は自動判定だが、外していたら手で上書きできる(clip.rig)
    operated: clip.rig === "operated" ? true
            : clip.rig === "fixed" ? false
            : !!V.operated,
    /* 据わっている(振り終わって止まっている)か。操作カメラでは、ここが
       狙って撮られた良い画になる */
    settled: panRatio < 0.25 && p(shakes, 0.75) <= MC.visual.TH_PAN,
    sharpMean: pick(V.sharp).reduce((s, x) => s + x, 0) / idx.length,
    sharpMed: V.sharpMed,
    moE: pick(V.moE).reduce((s, x) => s + x, 0) / idx.length,
    act: pick(V.act).reduce((s, x) => s + x, 0) / idx.length,
    nF: faces.length ? sorted(faces)[faces.length >> 1] : -1,
    maxF: sizes.length ? Math.max(...sizes) : -1,
    faceOK: V.faceOK,
  };
};

/* カメラを振っている(パン)か。向きが一定のまま動き続けている状態。
   手ブレは向きが暴れる(flipRatioが高い)ので、それとは別物として扱う */
MC.visual.isPanning = m => {
  if (!m) return false;
  // panRatio で判定する。shakeP75 と flipRatio だけで見ると、ノイズで1px揺れる
  // 固定カメラが flipRatio=0(=向きが一定)と評価されてパン扱いになってしまう
  //(flipRatio は |dx|<2px のサンプルを除外して数えるため)
  return m.panRatio > MC.visual.TH_PAN_RATIO && m.shakeP75 > MC.visual.TH_PAN;
};

/* 人が写っていないか(誰もいないピット、空の舞台など)。
   顔が1つも取れず、画面もほとんど動いていないときは被写体がいないとみなす。
   ※引きの画は顔が小さくて取れないことがあるため、動きの有無を併せて見る
     (演者がいれば必ず画面のどこかが動く) */
MC.visual.noSubject = (m, role) => {
  if (!m || !m.faceOK || m.nF < 0) return false;   // 顔検出が効いていないときは判定しない
  if (m.nF > 0) return false;                      // 顔が取れている=人がいる
  // ピット用カメラは寄り気味で、人がいれば顔が取れるはず。空舞台の可能性が高い
  if (role === "pit") return true;
  if (m.act >= MC.visual.TH_EMPTY) return false;
  /* ★ 前後(±NEAR_SEC秒)も静かなときだけ「誰もいない」とみなす。
     引きの画では顔は640²入力で数pxしかなく検出できない(nF=0)ので、
     残る手がかりは動きの量だけになる。ところが**隊形が決まって全員が
     静止した瞬間**は act がほぼ0で、マーチングでいちばん見せたい絵が
     「人が写っていない」で失格していた(引き継ぎ書③・裏取り済み)。
     空の舞台は前後もずっと静かなので、これで両者を分けられる */
  if (m.actNear != null && m.actNear >= MC.visual.TH_EMPTY) return false;
  return true;
};

/* 採用してはいけない画の理由を返す(null=問題なし)。
   role を渡すと、その役割に応じた判定(ピットの空舞台など)も行う。
   理由を文字列で持つのは、実素材でしきい値を詰めるときに
   「どの理由で何区間落ちたか」をログで確かめられるようにするため */
MC.visual.dqReason = (m, role) => {
  if (!m) return null;
  if (m.shakeP75 > MC.visual.TH_RAPID) return "急パン・激ブレ";
  /* 手ブレは単独条件で失格にする(ディレクター指示: 手ブレの多い画は絶対に使わない)。
     以前は flipRatio > 0.45 との AND だったが、flipRatio は |dx|<2px のサンプルを
     除外して数えるため、ゆっくり同じ方向へ揺れる手ブレでは 0 に近くなる。
     その結果しっかりブレていても失格を免れていた */
  /* 被写体の動きを手ブレと取り違えない(2026-07-29 マーチング指導者の指摘)。
     中央ブロックマッチングは大きな被写体に食いつくので、カンパニーフロントや
     ドラムラインが画面を横切ると、微動だにしていない三脚カメラでも
     globalMotion が大きく出る ─ つまり**いちばん見せたい瞬間**が「手ブレ」で
     失格していた。panRatio(:722)と operated(:439)には同じガード(act < TH_CAM_RESID)が
     既に入っており、ここだけ抜けていた */
  if (m.shakeCamP75 != null ? m.shakeCamP75 > MC.visual.TH_SHAKE
                            : m.shakeP75 > MC.visual.TH_SHAKE) return "手ブレ";
  if (m.sharpMed > 40 && m.sharpMean < m.sharpMed * 0.30) return "フォーカス外れ";
  if (MC.visual.isPanning(m)) return "カメラを振っている";
  if (MC.visual.noSubject(m, role)) return "人が写っていない";
  return null;
};

/* 採用してはいけない画の判定(絶対条件) */
MC.visual.disqualified = (m, role) => MC.visual.dqReason(m, role) != null;

/* ショット種スコア(0..1): 顔情報が無い点はモーション分布で控えめに推定 */
MC.visual.shotScores = m => {
  if (!m) return { close: 0.3, group: 0.3, wide: 0.4, ensemble: 0 };
  const ensemble = Math.min(1, m.act * 1.6) * Math.min(1, m.moE * 12);
  if (!m.faceOK || m.nF < 0) {
    // 顔なし解析: 画面の動き分布だけで大まかに(全面が動く=引きで隊列、局所大=寄り)
    const wide = Math.min(1, 0.35 + m.act * 0.8);
    const close = Math.max(0, 0.55 - m.act);
    return { close, group: 0.3, wide, ensemble };
  }
  const close = m.maxF <= 0 ? 0 : Math.max(0, Math.min(1, (m.maxF - 0.09) / 0.14));
  // グループ = 3〜10人規模。人数に上限を設けないと、客席からの引き(顔が20人以上
  // 写る)がグループ満点になり、引きが一度も選ばれなくなる
  const group = Math.max(0, Math.min(1, (m.nF - 2) / 3)) *
                Math.max(0, Math.min(1, (14 - m.nF) / 7)) *
                (m.maxF > 0.035 && m.maxF < 0.20 ? 1 : 0.5);
  // 引き = 顔が小さい。客席から撮った全景でも前サイドラインの顔は画面高8〜15%で
  // 写るため、旧式(0.05で頭打ち)では実素材の引きが常に0点になり、
  // director側の引き織り込み圧力(wWide×sh.wide)が乗算で死んでいた
  const wide = m.nF === 0 ? 0.8
    : Math.max(0, Math.min(1, (0.16 - m.maxF) / 0.11)) * (m.nF >= 6 ? 1 : 0.7);
  return { close, group, wide, ensemble };
};
