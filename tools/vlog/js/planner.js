"use strict";
/* ============ MarchinZ Vlog: 自動編集の設計図(plan)を作る ============
   素材とモードから「どの時刻に・どの素材の・どの区間を・どう繋いで出すか」を
   決める。描画はしない(compose.js)。書き出しもしない(exporter.js)。

   割当は「ブロック → 素材ID + 使う区間」方式。
   i番目のインタビュー→i番目のブロックの1対1はやらない
   (語りを2つに割る srcRef、Bロール被せ、前方専用デコードの全てに必要。
    大石さん・原口さん・エンジニアが別々の動機で一致した要求 2026-07-20)。

   インタビューが尺より長いときは頭から切って「最後」を残す
   (原口さん・大石さん一致:「本音は最後に来る」)。

   plan の形(このデータ構造が preview / exporter の共通言語):
   {
     mode, aspect, W, H, fps, totalSec, endColor, audioMode, shortNotice,
     segments: [{
       blockId, label, kind: "video"|"title"|"end",
       t0, t1,              完成動画の中の時刻
       clipId, srcIn,       kind=video: 素材と、素材内の開始秒
       transIn,             前セグメントからのディゾルブ秒(0=カット)
       ambient, ambientGain 素材自身の音を使うか・その音量
       bRoll: {clipId, srcIn, tA, tB} | null   絵だけ差し替える窓(音は継続)
     }],
     duckRanges: [{t0, t1, deep}],     BGMを下げる範囲(インタビュー±0.4s)
     bgm: [{bgmId, t0, t1, srcIn, gain, fadeIn, fadeOut}],
   } */

MV.planner = {};

/* 乱数(ジッター用)。素材とモードが同じなら同じ結果になるよう種を固定する。
   「組み直すたびに違うものが出る」と検証も説明もできなくなる */
MV.planner.rng = seed => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

MV.planner.seed = () => {
  let h = 0;
  const feed = s => { for (const ch of String(s)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; };
  feed(MV.S.mode);
  MV.allClips().forEach(c => { feed(c.name); feed(Math.round(c.duration * 10)); });
  return h || 1;
};

/* 素材の使える範囲 [in, out] (トリムUIは未実装だが構造は持っておく) */
MV.planner.usable = clip => {
  const tIn = clip.trimIn || 0;
  const tOut = clip.trimOut != null ? clip.trimOut : clip.duration;
  return [tIn, Math.max(tIn, tOut)];
};

/* ---------- 1) ブロック確定: 素材が無いブロックを落とし、割当を決める ---------- */
MV.planner.resolveBlocks = () => {
  const mode = MV.DATA.MODES[MV.S.mode];
  const itvs = MV.S.interviews;

  /* interviewブロックを srcRef でグループ化(登場順)。グループk ← itvs[k] */
  const groupOf = new Map();   // blockId -> groupIndex
  const groupKeys = [];
  for (const b of mode.blocks) {
    if (b.src !== "interview") continue;
    const key = b.srcRef || b.id;
    if (!groupKeys.includes(key)) groupKeys.push(key);
    groupOf.set(b.id, groupKeys.indexOf(key));
  }

  const hasBrand = !!(MV.S.logo && MV.S.logo.out) || !!MV.S.orgName;
  const blocks = mode.blocks.filter(b => {
    if (b.src === "interview") return groupOf.get(b.id) < itvs.length;  // 素材のある分だけ
    if (b.src === "title" || b.src === "logo") return hasBrand;         // 出すものが無ければ落とす
    if (b.src === "insert") return MV.S.inserts.length > 0;             // Bロール0本なら語りだけで組む
    return true;
  });
  return { blocks, groupOf, groupCount: Math.min(groupKeys.length, itvs.length) };
};

/* ---------- 2) 目標尺(UIの見込み MV.ui.estimate と同じ考え方) ---------- */
MV.planner.targetSec = (blocks, groupCount) => {
  const [lo, hi] = MV.lenRange();
  const pctSum = blocks.reduce((s, b) => s + b.pct, 0);
  const itvShare = blocks.filter(b => b.src === "interview")
    .reduce((s, b) => s + b.pct, 0) / pctSum;
  const itvTotal = MV.S.interviews.slice(0, groupCount)
    .reduce((s, c) => { const [a, b] = MV.planner.usable(c); return s + Math.min(b - a, 60); }, 0);
  const insTotal = MV.S.inserts.reduce((s, c) => { const [a, b] = MV.planner.usable(c); return s + (b - a); }, 0);
  let raw = itvTotal > 0 && itvShare > 0
    ? itvTotal / itvShare
    : Math.min(MV.TARGET_SEC, Math.max(45, insTotal * 1.6));
  raw = Math.min(raw, MV.TARGET_SEC * 1.35);
  return Math.max(lo, Math.min(hi, raw));
};

/* ---------- 3) 本体 ---------- */
MV.planner.build = () => {
  const mode = MV.DATA.MODES[MV.S.mode];
  if (!mode) throw new Error("雰囲気が選ばれていません");
  const inserts = MV.S.inserts;
  /* インタビュー構成ツール(2026-07-21): 主役は語り。インタビューが無ければ
     組めない。Bロール(インサート)は飾りなので無くても成立する */
  if (!MV.S.interviews.length) throw new Error("インタビューがありません");

  const { blocks, groupOf, groupCount } = MV.planner.resolveBlocks();
  const target = MV.planner.targetSec(blocks, groupCount);
  const pctSum = blocks.reduce((s, b) => s + b.pct, 0);
  const rand = MV.planner.rng(MV.planner.seed());

  /* ブロック秒。interviewは素材尺でキャップする(足りない分だけ全体が縮む。
     尺は素材に合わせて短くなってよい: 優さん決定 2026-07-20) */
  const secOf = new Map();
  {
    /* グループ単位でキャップを配る。srcRef で分割されたブロック群は
       同じインタビューを順に使うため、合計が素材尺を超えられない */
    const wantByGroup = new Map();     // groupIndex -> [{block, want}]
    for (const b of blocks) {
      const want = b.pct / pctSum * target;
      if (b.src !== "interview") { secOf.set(b.id, want); continue; }
      const g = groupOf.get(b.id);
      if (!wantByGroup.has(g)) wantByGroup.set(g, []);
      wantByGroup.get(g).push({ block: b, want });
    }
    for (const [g, list] of wantByGroup) {
      const clip = MV.S.interviews[g];
      const [uIn, uOut] = MV.planner.usable(clip);
      const avail = uOut - uIn;
      const wantSum = list.reduce((s, x) => s + x.want, 0);
      const scale = wantSum > avail ? avail / wantSum : 1;
      for (const x of list) secOf.set(x.block.id, x.want * scale);
    }
  }

  /* インタビューのグループごとに、素材内の読み出し開始位置を決める。
     頭トリム優先: 割当合計が素材より短ければ「後ろ」を使う */
  const groupCursor = new Map();   // groupIndex -> 素材内の現在位置(秒)
  {
    const needByGroup = new Map();
    for (const b of blocks) {
      if (b.src !== "interview") continue;
      const g = groupOf.get(b.id);
      needByGroup.set(g, (needByGroup.get(g) || 0) + secOf.get(b.id));
    }
    for (const [g, need] of needByGroup) {
      const clip = MV.S.interviews[g];
      const [uIn, uOut] = MV.planner.usable(clip);
      groupCursor.set(g, Math.max(uIn, uOut - need));
    }
  }

  /* インサートの使用回数を先に数える(等間隔散らしのため)。
     ショウ指定(isShow)の素材は show:true のブロックへ優先して回す */
  const showClips = inserts.filter(c => c.isShow);
  const pickPool = b => (b.show && showClips.length ? showClips : inserts);
  const useCount = new Map();      // clipId -> 総使用回数(散らしの分母)
  const planCuts = [];             // [{block, cutSec[]}] 後段のために控える
  for (const b of blocks) {
    if (b.src !== "insert") continue;
    const dur = secOf.get(b.id);
    const cutSec = b.cutSec;
    const n = cutSec ? Math.max(1, Math.round(dur / cutSec)) : 1;
    const cuts = [];
    let rest = dur;
    for (let i = 0; i < n; i++) {
      const base = rest / (n - i);
      const jit = i < n - 1 ? base * (0.8 + rand() * 0.4) : rest;   // ±20%(最後は帳尻)
      cuts.push(jit);
      rest -= jit;
    }
    planCuts.push({ block: b, cuts });
    const pool = pickPool(b);
    for (let i = 0; i < n; i++) {
      const c = pool[(useCount.get("_rr_" + (b.show ? "s" : "n")) || 0) % pool.length];
      useCount.set("_rr_" + (b.show ? "s" : "n"), (useCount.get("_rr_" + (b.show ? "s" : "n")) || 0) + 1);
      useCount.set(c.id, (useCount.get(c.id) || 0) + 1);
    }
  }
  useCount.delete("_rr_s"); useCount.delete("_rr_n");

  /* 各クリップの k回目の使用が素材内のどこを使うか(等間隔散らし) */
  const usedSoFar = new Map();     // clipId -> 使った回数
  const windowFor = (clip, cutDur) => {
    const [uIn, uOut] = MV.planner.usable(clip);
    const avail = Math.max(0, uOut - uIn - cutDur);
    const total = useCount.get(clip.id) || 1;
    const k = usedSoFar.get(clip.id) || 0;
    usedSoFar.set(clip.id, k + 1);
    const pos = total > 1 ? k / (total - 1) : 0.3;    // 1回だけなら3割地点(頭の準備動作を避ける)
    return uIn + avail * pos;
  };

  /* ---------- セグメント生成 ---------- */
  const segments = [];
  const audioMode = MV.S.audioMode;
  const withBgm = audioMode !== "ambient" && MV.S.bgms.length > 0;
  let t = 0;
  let rrShow = 0, rrNorm = 0;      // ラウンドロビンのカーソル(散らし分母と同じ順で回す)
  let firstBlock = true;

  for (const b of blocks) {
    const dur = secOf.get(b.id);
    if (dur <= 0.05) { firstBlock = false; continue; }
    const transIn = !firstBlock && b.trans === "dissolve"
      ? Math.min(b.transSec || mode.dissolveSec, dur * 0.5) : 0;

    if (b.src === "interview") {
      const g = groupOf.get(b.id);
      const clip = MV.S.interviews[g];
      const srcIn = groupCursor.get(g);
      groupCursor.set(g, srcIn + dur);
      const seg = {
        blockId: b.id, label: b.label, kind: "video",
        t0: t, t1: t + dur, clipId: clip.id, srcIn,
        transIn, ambient: true, ambientGain: 1, bRolls: [],
      };
      /* Bロールの被せ: bRollEvery 秒ごとに bRollSec 秒、絵だけ差し替える
         (音は語りが続く。Bロール側は無音)。頭4秒は顔を見せてから、
         締めの3秒は必ず顔へ戻る。同一素材はこのシーンでは1回まで
         (2026-07-21 インタビュー構成ツール化) */
      if (b.bRollEvery && inserts.length && dur > b.bRollEvery * 0.8) {
        const usable = dur - 4 - 3;                       // 頭4秒・尻3秒は顔
        let n = Math.max(0, Math.round(usable / b.bRollEvery));
        n = Math.min(n, inserts.length);                  // 同一素材1回まで → 本数が上限
        const usedHere = new Set();
        const space = n > 0 ? usable / n : 0;
        for (let k = 0; k < n; k++) {
          const c = inserts[rrNorm % inserts.length]; rrNorm++;
          if (usedHere.has(c.id)) continue;               // 念のための二重ガード
          usedHere.add(c.id);
          const slack = Math.max(0, space - b.bRollSec - 1);
          const tA = t + 4 + k * space + rand() * slack;
          const tB = Math.min(tA + b.bRollSec, t + dur - 3);
          if (tB - tA < 1) continue;
          const [uIn, uOut] = MV.planner.usable(c);
          const bSrcIn = uIn + Math.max(0, (uOut - uIn - (tB - tA))) * rand();
          seg.bRolls.push({ clipId: c.id, srcIn: bSrcIn, tA, tB });
        }
      }
      segments.push(seg);
      t += dur;
    } else if (b.src === "insert") {
      const entry = planCuts.find(x => x.block === b);
      const pool = pickPool(b);
      entry.cuts.forEach((cutDur, i) => {
        const c = b.show && showClips.length
          ? pool[rrShow % pool.length] : pool[rrNorm % pool.length];
        if (b.show && showClips.length) rrShow++; else rrNorm++;
        /* 素材自身の音: BGMなし=全部そのまま。BGMあり=ambient指定ブロックだけ、
           ショウ(演奏)は現場音を showMix で残す(既定 BGM70:現場30) */
        const ambient = audioMode === "ambient" ? true : !!b.ambient;
        const gain = !withBgm ? 1 : (b.show ? MV.S.showMix : (b.ambient ? 1 : 0));
        segments.push({
          blockId: b.id, label: b.label, kind: "video",
          t0: t, t1: t + cutDur, clipId: c.id,
          srcIn: windowFor(c, cutDur),
          transIn: i === 0 ? transIn : 0,
          ambient, ambientGain: ambient ? gain : 0, bRolls: [],
        });
        t += cutDur;
      });
    } else {   // title / logo(エンド)
      segments.push({
        blockId: b.id, label: b.label,
        kind: b.src === "title" ? "title" : "end",
        t0: t, t1: t + dur, clipId: null, srcIn: 0,
        transIn, ambient: false, ambientGain: 0, bRolls: [],
      });
      t += dur;
    }
    firstBlock = false;
  }

  const totalSec = t;

  /* ---------- BGMの配置(3幕: 導入・中盤・ハイライト) ---------- */
  const bgmPlan = [];
  const duckRanges = segments
    .filter(s => s.kind === "video" && MV.getClip(s.clipId) && MV.S.interviews.some(c => c.id === s.clipId))
    .map(s => {
      const block = mode.blocks.find(b => b.id === s.blockId) || {};
      return { t0: Math.max(0, s.t0 - 0.4), t1: Math.min(totalSec, s.t1 + 0.4), deep: !!block.duckDeep };
    });

  if (withBgm) {
    const bgms = MV.S.bgms;
    const base = audioMode === "both" ? 0.35 : 1.0;   // 「両方」はBGMを薄く敷く
    /* 幕の境界: 2曲=ハイライト頭で切替 / 3曲=最初のインタビュー頭でも切替 */
    const showSeg = segments.find(s => {
      const b = mode.blocks.find(x => x.id === s.blockId);
      return b && b.show;
    });
    const itvSeg = segments.find(s => MV.S.interviews.some(c => c.id === s.clipId));
    const cut1 = bgms.length >= 3 && itvSeg ? itvSeg.t0 : null;
    const cut2 = bgms.length >= 2 && showSeg ? showSeg.t0 : null;
    const bounds = [0, cut1, cut2, totalSec]
      .filter(v => v != null).sort((a, b2) => a - b2)
      .filter((v, i, a) => i === 0 || v - a[i - 1] > 5);   // 5秒未満の幕は作らない
    const XF = 1.5;
    for (let i = 0; i + 1 < bounds.length; i++) {
      const t0 = bounds[i], t1 = bounds[i + 1];
      const song = bgms[Math.min(i, bgms.length - 1)];
      /* 曲が幕より短ければループ(エントリを並べる) */
      let pos = t0;
      while (pos < t1 - 0.2) {
        const len = Math.min(song.duration, t1 - pos);
        bgmPlan.push({
          bgmId: song.id, t0: pos, t1: pos + len, srcIn: 0, gain: base,
          fadeIn: pos === t0 ? (i === 0 ? 0.8 : XF) : 0.02,
          fadeOut: pos + len >= t1 - 0.2 ? (i + 2 === bounds.length ? 2.0 : XF) : 0.02,
        });
        pos += len;
      }
    }
  }

  const plan = {
    version: 1,
    mode: MV.S.mode, aspect: MV.S.aspect, W: MV.W, H: MV.H, fps: MV.FPS,
    totalSec, endColor: MV.S.endColor || mode.endColor,
    audioMode, shortNotice: !MV.fitsMarchinZ(totalSec),
    segments, duckRanges, bgm: bgmPlan,
  };

  MV.planner.validate(plan);
  MV.log(`plan: ${segments.length}セグメント / ${MV.ui.fmtTime(totalSec)} / モード=${MV.S.mode}`
    + ` / BGM=${bgmPlan.length}区間 / duck=${duckRanges.length}箇所`);
  return plan;
};

/* plan の自己検証。壊れた設計図で書き出しに入ってから死ぬより、ここで止める */
MV.planner.validate = plan => {
  const segs = plan.segments;
  if (!segs.length) throw new Error("セグメントが0件です");
  const [lo, hi] = MV.lenRange();
  if (plan.totalSec > hi + 0.5) throw new Error(`完成尺${plan.totalSec.toFixed(1)}秒が上限${hi}秒を超えています`);
  if (plan.totalSec < lo - 0.5) throw new Error(`完成尺${plan.totalSec.toFixed(1)}秒が短すぎます`);
  let prev = 0;
  for (const s of segs) {
    if (Math.abs(s.t0 - prev) > 0.01) throw new Error(`セグメントが連続していません: ${s.blockId} t0=${s.t0.toFixed(2)} 期待=${prev.toFixed(2)}`);
    if (s.t1 - s.t0 <= 0) throw new Error(`長さ0のセグメント: ${s.blockId}`);
    if (s.kind === "video") {
      const c = MV.getClip(s.clipId);
      if (!c) throw new Error(`素材が見つかりません: ${s.blockId}`);
      if (s.srcIn < -0.01) throw new Error(`srcInが負: ${s.blockId}`);
      /* srcIn+長さが素材を超える分は hold-last-frame で最後のコマが続く。
         0.5秒までは許容(見た目は静止)。それ以上は割当のバグ */
      const over = (s.srcIn + (s.t1 - s.t0)) - c.duration;
      if (over > 0.75) throw new Error(`素材の範囲を超えています: ${s.blockId} ${c.name} 超過${over.toFixed(2)}秒`);
    }
    if (s.bRolls && s.bRolls.length) {
      let prevB = s.t0;
      const usedClip = new Set();
      for (const w of s.bRolls) {
        if (w.tA < s.t0 || w.tB > s.t1) throw new Error(`bRollが親からはみ出しています: ${s.blockId}`);
        if (w.tA < prevB) throw new Error(`bRoll窓が重なっています: ${s.blockId}`);
        if (usedClip.has(w.clipId)) throw new Error(`同一Bロール素材が同じシーンに2回: ${s.blockId}`);
        usedClip.add(w.clipId);
        if (!MV.getClip(w.clipId)) throw new Error(`bRoll素材が見つかりません: ${s.blockId}`);
        prevB = w.tB;
      }
    }
    prev = s.t1;
  }
  if (Math.abs(prev - plan.totalSec) > 0.01) throw new Error("totalSecと末尾が一致しません");
};
