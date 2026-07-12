"use strict";
/* ============ 顔ボックスの追跡: IoUマッチ+EMA平滑+ロスト後ホールド ============ */

MZ.Tracker = class {
  constructor() { this.tracks = []; this.nextId = 1; }

  reset() { this.tracks = []; this.nextId = 1; }

  /* dets: [{x,y,w,h,score}](正規化) t: 秒 holdSec: ロスト後も維持する秒数
     戻り: { active: 現在マスクすべきボックス配列, born: 新規トラック配列 } */
  update(dets, t, holdSec) {
    for (const tr of this.tracks) tr.matched = false;
    const born = [];
    for (const d of [...dets].sort((a, b) => (b.score || 0) - (a.score || 0))) {
      let best = null, bestIou = 0.12;
      for (const tr of this.tracks) {
        if (tr.matched) continue;
        const i = MZ.iou(tr.box, d);
        if (i > bestIou) { bestIou = i; best = tr; }
      }
      if (best) {
        const A = 0.55;  // 新検出の重み(揺れ抑制)
        for (const k of ["x", "y", "w", "h"]) best.box[k] = best.box[k] * (1 - A) + d[k] * A;
        best.matched = true;
        best.lastSeen = t;
      } else {
        const tr = { id: this.nextId++, box: { x: d.x, y: d.y, w: d.w, h: d.h }, lastSeen: t, matched: true };
        this.tracks.push(tr);
        born.push(tr);
      }
    }
    // 巻き戻しシーク(プレビュー)にも耐えるよう絶対値で判定
    this.tracks = this.tracks.filter(tr => Math.abs(t - tr.lastSeen) <= holdSec + 0.01);
    return { active: this.tracks.map(tr => ({ ...tr.box, id: tr.id })), born };
  }
};
