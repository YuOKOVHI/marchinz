"use strict";
/* ============ YuNet(ONNX Runtime Web)= 精度エンジン ============
   OpenCV Zoo の顔検出モデル(小さい顔に強い、検出レンジ約10px〜)。
   入力は640×640固定のため、フレームを「全体1発+960px級タイル」で走査する。
   ORT(約3MB)とモデル(232KB)は初回検出時に読み込む(遅延ロード)。

   iOS注意(シニアエンジニア調査済み):
   - ORT 1.19以降は iOS17 でメモリ死するため 1.18.0 に固定。安易に上げない
   - iOS/Safari 16.4 だけ wasm SIMD が「黙って誤答」するため SIMD を切る */

MZ.yunet = {
  session: null,
  initPromise: null,
  SCORE: 0.5,        // 採用スコア(√(cls×obj))
  SCORE_NEAR: 0.38,  // 追跡中の顔の近くだけ許す低め閾値(2段階信頼度)
  NMS_IOU: 0.35,

  init() {
    if (!this.initPromise) this.initPromise = this._init().catch(e => {
      this.initPromise = null;   // 失敗キャッシュを残さない(次回再挑戦)
      throw e;
    });
    return this.initPromise;
  },

  async _init() {
    if (!window.ort) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "vendor/ort.min.js";
        s.onload = res;
        s.onerror = () => rej(new Error("ort.min.jsを読み込めません"));
        document.head.appendChild(s);
      });
    }
    ort.env.wasm.wasmPaths = new URL("vendor/", location.href).href;  // 末尾スラッシュ必須
    ort.env.wasm.numThreads = 1;   // COOP/COEP不要のシングルスレッド
    // iOS/Safari 16.4: SIMDが結果を黙って壊すWebKitバグ → SIMDを無効化
    const m = navigator.userAgent.match(/(?:iPhone|iPad).*OS (\d+)_(\d+)/);
    if (m && +m[1] === 16 && +m[2] === 4) ort.env.wasm.simd = false;
    this.session = await ort.InferenceSession.create(
      new URL("vendor/face_detection_yunet_2023mar.onnx", location.href).href,
      { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    MZ.log("yunet ready (ort", (ort.env.versions && ort.env.versions.web) || "?", ")");
  },

  _canvas(w, h) {
    const c = this._cv || (this._cv = document.createElement("canvas"));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    return c;
  },

  /* 解析キャンバスA(表示向き)の領域(sx,sy,s)を640²へ縮小し BGR planar テンソル化 */
  _prep(A, sx, sy, s) {
    const c = this._canvas(640, 640);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(A, sx, sy, s, s, 0, 0, 640, 640);
    const px = ctx.getImageData(0, 0, 640, 640).data;
    const N = 640 * 640;
    const d = this._buf || (this._buf = new Float32Array(3 * N));  // 使い回し(GC対策)
    for (let i = 0; i < N; i++) {
      d[i] = px[i * 4 + 2];          // B
      d[N + i] = px[i * 4 + 1];      // G
      d[2 * N + i] = px[i * 4];      // R
    }
    return new ort.Tensor("float32", d, [1, 3, 640, 640]);
  },

  /* 出力(cls/obj/bbox × stride 8,16,32)を640px系のボックスへ復元 */
  _decode(out, thr) {
    const dets = [];
    for (const s of [8, 16, 32]) {
      const cls = out["cls_" + s].data, obj = out["obj_" + s].data,
            bb = out["bbox_" + s].data, cols = 640 / s;
      for (let i = 0; i < cls.length; i++) {
        const score = Math.sqrt(
          Math.max(0, Math.min(1, cls[i])) * Math.max(0, Math.min(1, obj[i])));
        if (score < thr) continue;
        const row = (i / cols) | 0, col = i % cols;
        const cx = (col + bb[i * 4]) * s, cy = (row + bb[i * 4 + 1]) * s;
        const w = Math.exp(bb[i * 4 + 2]) * s, h = Math.exp(bb[i * 4 + 3]) * s;
        if (!(w > 0 && h > 0)) continue;
        dets.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
      }
    }
    return dets;
  },

  /* 解析キャンバスAをリージョン群で走査して正規化ボックスを返す。
     regions: [{sx,sy,s}](A座標系, 正方形)。thrLow>0なら2段階閾値(近傍は低め) */
  async scan(A, regions, nearBoxes) {
    if (!this.session) return [];
    let all = [];
    for (const r of regions) {
      const tensor = this._prep(A, r.sx, r.sy, r.s);
      const out = await this.session.run({ input: tensor });
      for (const d of this._decode(out, this.SCORE_NEAR)) {
        all.push({
          x: (r.sx + d.x / 640 * r.s) / A.width,
          y: (r.sy + d.y / 640 * r.s) / A.height,
          w: d.w / 640 * r.s / A.width,
          h: d.h / 640 * r.s / A.height,
          score: d.score,
        });
      }
    }
    all = MZ.detect.nms(all, this.NMS_IOU);
    // 2段階信頼度: 高スコアは無条件、低スコアは追跡中の顔の近くだけ
    return all.filter(d =>
      d.score >= this.SCORE || (nearBoxes || []).some(nb => MZ.iou(nb, d) > 0.2));
  },

  /* 走査リージョンの組み立て(Aは表示向きの解析キャンバス)
     level "full": 全体1発 + 960px級タイル(50%重なり) … 精度重視
     level "l0":   全体1発のみ … 再生中の混ぜ込み用 */
  regionsFor(A, level) {
    const W = A.width, H = A.height, S = Math.max(W, H);
    const regions = [{ sx: 0, sy: 0, s: S }];
    if (level === "full" && S > 700) {
      const size = Math.min(S * 0.55, 1000);
      const step = size / 2;
      for (let y = 0; ; y++) {
        const sy = Math.min(y * step, Math.max(0, H - size));
        for (let x = 0; ; x++) {
          const sx = Math.min(x * step, Math.max(0, W - size));
          regions.push({ sx, sy, s: size });
          if (sx >= W - size) break;
        }
        if (sy >= H - size) break;
      }
    }
    return regions;
  },
};
