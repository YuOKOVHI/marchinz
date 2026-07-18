"use strict";
/* ============ 顔ボックスの追跡: IoUマッチ+EMA平滑+速度予測+ロスト後ホールド ============
   マーチングは行進で「顔がほぼ等速で動き続ける」ため、各トラックに速度を持たせ、
   ①マッチ判定は等速外挿した予測位置で行い(移動する小さな顔を掴みやすく)、
   ②検出が途切れた間も予測位置へマスクを動かし続ける(減衰つき)。 */

MZ.Tracker = class {
  constructor() { this.tracks = []; this.nextId = 1; }

  reset() { this.tracks = []; this.nextId = 1; }

  /* dets: [{x,y,w,h,score}](正規化) t: 秒 holdSec: ロスト後も維持する秒数
     戻り: { active: 現在マスクすべきボックス配列, born: 新規トラック配列 } */
  update(dets, t, holdSec) {
    // ① 前回からの経過で等速外挿(シークで大きく飛んだ・巻き戻った場合は外挿しない)
    for (const tr of this.tracks) {
      tr.matched = false;
      const dt = t - (tr.lastT != null ? tr.lastT : t);
      if (dt > 0 && dt <= 0.34) {
        tr.box.x += (tr.vx || 0) * dt;
        tr.box.y += (tr.vy || 0) * dt;
        if (!tr.matchedRecently) {  // ロスト中は徐々に減速(暴走防止)
          tr.vx = (tr.vx || 0) * 0.9;
          tr.vy = (tr.vy || 0) * 0.9;
        }
      }
      tr.lastT = t;
    }

    const born = [];
    for (const d of [...dets].sort((a, b) => (b.score || 0) - (a.score || 0))) {
      let best = null, bestIou = 0.12;
      for (const tr of this.tracks) {
        if (tr.matched) continue;
        const i = MZ.iou(tr.box, d);
        if (i > bestIou) { bestIou = i; best = tr; }
      }
      if (best) {
        // ② 観測との差から速度を更新(EMA)。dtはこのフレームまでの実測経過
        const dt = t - (best.lastSeen != null ? best.lastSeen : t);
        if (dt > 0.005 && dt <= 0.6) {
          const obsVx = (d.x + d.w / 2 - (best.box.x + best.box.w / 2)) / dt;
          const obsVy = (d.y + d.h / 2 - (best.box.y + best.box.h / 2)) / dt;
          const VA = 0.45;
          best.vx = (best.vx || 0) * (1 - VA) + obsVx * VA;
          best.vy = (best.vy || 0) * (1 - VA) + obsVy * VA;
        }
        const A = 0.55;  // 新検出の重み(揺れ抑制)
        for (const k of ["x", "y", "w", "h"]) best.box[k] = best.box[k] * (1 - A) + d[k] * A;
        best.matched = true;
        best.matchedRecently = true;
        best.lastSeen = t;
      } else {
        const tr = {
          id: this.nextId++,
          box: { x: d.x, y: d.y, w: d.w, h: d.h },
          vx: 0, vy: 0, lastT: t, lastSeen: t,
          matched: true, matchedRecently: true,
        };
        this.tracks.push(tr);
        born.push(tr);
      }
    }
    for (const tr of this.tracks) if (!tr.matched) tr.matchedRecently = false;
    // 巻き戻しシーク(プレビュー)にも耐えるよう絶対値で判定
    this.tracks = this.tracks.filter(tr => Math.abs(t - tr.lastSeen) <= holdSec + 0.01);
    return { active: this.tracks.map(tr => ({ ...tr.box, id: tr.id })), born };
  }
};
