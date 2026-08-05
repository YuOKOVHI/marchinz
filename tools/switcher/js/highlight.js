"use strict";
/* ============ どこから始めるか(見どころ候補) ============
   書き出しの長さを選べるようにした(2026-07-31 優さん指示)。8分のショウから
   1分だけ切り出すなら「どこの1分か」を決めないといけない ─ その候補を
   音楽解析(sections.js)から自動で出し、**単語の理由つき**で5つ並べる。

   考え方は単純で、選んだ長さの窓を曲じゅうスライドさせ、
   窓ごとに「この窓はどの性格が強いか」を測って、性格ごとの最強窓を1つ拾う。

     スタート    … 演奏のはじまり(常に候補に入れる)
     大盛り上がり… 音圧(tutti)が最大
     バラード    … 静けさ(quiet)が最大
     ドラムライン… 打撃的(percussion)が最大
     ソロ        … 誰かが抜かれている(feature)が最大
     フィナーレ  … 終盤で音圧が最大

   ★ 性格どうしのスコアを**そのまま**比べてはいけない。
     sections.classify の tutti は 0..1 に正規化された単独値だが、
     percussion は3つの積、feature も積なので構造的に小さい。生値で並べると
     「大盛り上がり」と「バラード」だけが毎回勝ち、打楽器とソロが一度も
     出てこない。そこで各性格の**その曲の中での z 値**(平均から何σ突き出て
     いるか)で比べる。尺度が消えるので性格どうしを公平に比べられる。 */

MC.highlight = {
  /* 音で探す性格。表示順ではなく定義順(並びは最後に時刻順へ並べ替える) */
  KINDS: [
    { key: "climax",   label: "大盛り上がり", why: "全員が最も大きく鳴っている位置",
      icon: "fa-fire", score: c => c.tutti },
    { key: "ballad",   label: "バラード",     why: "静かでゆったりした位置",
      icon: "fa-moon", score: c => c.quiet },
    { key: "drumline", label: "ドラムライン", why: "打楽器が多く鳴っている位置",
      icon: "fa-drum", score: c => c.percussion },
    { key: "solo",     label: "ソロ",         why: "特定の奏者が抜かれている位置",
      icon: "fa-star", score: c => c.feature },
  ],
  /* 位置で決まる2つ。音で探さない ─ 探すと必ず他の性格と場所を取り合う。
       スタート  … 演奏のはじまりが入る唯一の切り出し
       フィナーレ… 演奏の終わりが入る唯一の切り出し
     「フィナーレ」を『終盤で音圧が最大』として探していたときは、
     長さを3分にすると探索範囲がほとんど残らず候補から消え、
     1分にすると「大盛り上がり」と同じ場所を取り合って片方が消えた。
     終わりが入ることこそがフィナーレなので、位置で定義するのが正しい */
  /* アイコンは旗/チェッカーフラッグの対にする。以前は「スタート」を fa-play に
     していたが、各カード右端の「ここを聴く」も▶なので同じ記号が並んで見えた */
  START:  { key: "start",  label: "スタート",   why: "演奏の開始から", icon: "fa-flag" },
  /* おすすめの5つで足りないとき用。音では探さず、本人が決める(2026-07-31 優さん指示) */
  MANUAL: { key: "manual", label: "自分で選ぶ", why: "好きな場所から始められます", icon: "fa-hand-pointer" },
  FINALE: { key: "finale", label: "フィナーレ", why: "演奏の終わりまで入ります", icon: "fa-flag-checkered" },
  /* 候補どうしがこれより近ければ同じ場面とみなす。長さに比例させるが、
     曲の長さでも頭を打つ ─ 比例だけにすると、3分×8分30秒の曲では
     離れた候補が2つしか作れず「5つ出す」が成立しない。
     実測(8分30秒のショウ): 1分で5つ / 3分で5つ が出る値に合わせた */
  SEP_RATIO: 0.45,
  SPAN_DIV: 7,
  MIN_SEP: 8,
  /* その性格が「その曲に本当にあるか」の下限(平均から何σ突き出ているか)。
     これを下回る性格は、席が余っていない限り出さない ─ バラードの無い曲で
     ただの中くらいの区間に「バラード」と名前を付けてしまうため */
  Z_MIN: 0.8,
  MAX: 5,
};

/* 窓をスライドさせて性格ごとの時系列を作る。
   戻り値 { ts:[], by: {key: [score...]} } (ts はグローバル秒の窓開始) */
MC.highlight._scan = (audioClip, lenSec, t0, t1) => {
  const span = t1 - t0;
  const last = t1 - lenSec;                       // これ以上うしろからは始められない
  const ts = [], by = {};
  MC.highlight.KINDS.forEach(k => { by[k.key] = []; });
  if (last <= t0 + 0.5) return { ts, by };
  /* 窓の刻み。細かすぎると同じ場面を何度も測るだけなので、長さの1/10 */
  const step = Math.max(0.5, Math.min(6, lenSec / 10));
  for (let s = t0; s <= last + 1e-6; s += step) {
    const cls = MC.sections.classify(audioClip, s, s + lenSec);
    if (!cls) break;
    ts.push(s);
    MC.highlight.KINDS.forEach(k => by[k.key].push(k.score(cls) || 0));
  }
  return { ts, by };
};

/* 平均と標準偏差(z値の材料) */
MC.highlight._stat = arr => {
  const n = arr.length;
  if (!n) return { mean: 0, sd: 0 };
  let s = 0;
  for (const v of arr) s += v;
  const mean = s / n;
  let q = 0;
  for (const v of arr) q += (v - mean) * (v - mean);
  return { mean, sd: Math.sqrt(q / n) };
};

/* 候補を作る。
     audioClip … 音声クリップ(sections 解析済みであること)
     lenSec    … 書き出す長さ(秒)
     t0,t1     … 演奏の範囲(グローバル秒)
   戻り値: [{ key, label, why, icon, t, dur, z }] を時刻順に最大5件。
   先頭の「スタート」は必ず入る(t0 そのもの)。 */
/* ============ 「一番いいシーン」の採点(2026-08-05 DCI配信ディレクター協議) ============
   従来の「性格ごとの代表を1つずつ」(下の _legacyCandidates)は網羅的だが序列が無く、
   おまかせの1発目が「そのショウの一番」にならなかった。協議の結論:
     ・良い切り出し=「終わり方が気持ちいい60秒」。フィナーレ(最後の衝撃+余韻)が別格
     ・payoff(衝撃が窓の後半にある)・arc(静→爆発の落差)・climax(音圧の山)で採点
     ・終点を先に決める(衝撃+2.5秒へスナップ)。始点は従属
     ・ソロの途中で切らない/ヒット寸前で切らない(現場で苦情が来る2大事故)
     ・短い素材は「頭から」「尻まで」の2択で正直に(3本目の水増しはしない)
   ★ ここは sections だけに依存させる(QAが sections+highlight を隔離ロードするため、
     director.js の衝撃/切れ目検出は使わず同じ式を自前で持つ。定数は director と揃える) */
MC.highlight.SCORE = {
  W_FINALE: 3.0, W_PAYOFF: 2.0, W_ARC: 1.5, W_CLIMAX: 1.0, W_VARIETY: 0.5,
  P_SOLO_CUT: 2.0, P_PRE_HIT: 2.0, P_COLD_OPEN: 1.0, P_FLAT_LOUD: 0.5,
  IMPACT_HIGH: 0.62, IMPACT_RISE: 0.22, IMPACT_GAP: 4.0,   // director.js と同値
  SNAP_TAIL: 2.5,     // 衝撃のあとに残す余韻(秒)
  START_T: 0.15,      // 始点の調整はこの割合(len×)まで
  SHORT_SPAN: 12,     // ずらし幅がこれ未満なら「頭から/尻まで」の2択
  WHOLE_SPAN: 4,      // これ未満は選ぶ余地なし(1本)
};

/* dyn(0..1) の時系列。sections.rms を正規化して最近傍で引く */
MC.highlight._dynSeries = (S, offset) => {
  const lo = S.rmsLo, hi = S.rmsHi;
  const ok = hi > lo;
  const val = i => ok ? Math.max(0, Math.min(1, (S.rms[i] - lo) / (hi - lo))) : 0;
  const at = t => {
    if (!S.t.length) return 0;
    const local = t - offset;
    let lo2 = 0, hi2 = S.t.length - 1;
    while (hi2 - lo2 > 1) { const m = (lo2 + hi2) >> 1; if (S.t[m] < local) lo2 = m; else hi2 = m; }
    return val(Math.abs(S.t[lo2] - local) < Math.abs(S.t[hi2] - local) ? lo2 : hi2);
  };
  return { at, val, n: S.t.length };
};

/* 衝撃(ヒット)の時刻列。director._impacts と同じ式(拍スナップだけ省略) */
MC.highlight._impacts = (S, offset, t0, t1) => {
  const C = MC.highlight.SCORE;
  const dyn = MC.highlight._dynSeries(S, offset);
  const out = [];
  for (let i = 3; i < S.t.length; i++) {
    const now = dyn.val(i);
    if (now < C.IMPACT_HIGH) continue;
    const before = (dyn.val(i - 1) + dyn.val(i - 2) + dyn.val(i - 3)) / 3;
    if (now - before < C.IMPACT_RISE) continue;
    const tt = S.t[i] + offset - MC.sections.WIN / 4;
    if (tt < t0 + 1 || tt > t1 - 0.5) continue;
    if (out.length && tt - out[out.length - 1] < C.IMPACT_GAP) continue;
    out.push(tt);
  }
  return out;
};

/* 静けさの谷(切れ目/ブレスの候補)。director._breaks の簡易版 */
MC.highlight._valleys = (S, offset, t0, t1) => {
  const dyn = MC.highlight._dynSeries(S, offset);
  const out = [];
  for (let i = 1; i < S.t.length - 1; i++) {
    const tt = S.t[i] + offset;
    if (tt <= t0 || tt >= t1) continue;
    const v = dyn.val(i);
    if (v < 0.30 && v <= dyn.val(i - 1) && v <= dyn.val(i + 1)) {
      if (!out.length || tt - out[out.length - 1] > 3) out.push(tt);
    }
  }
  return out;
};

/* 一番いいシーンから順に最大 max 件。
   戻り値は candidates と同じ形: [{key,label,why,icon,t,dur,rank,score}] を**順位順**で返す */
MC.highlight.bestScenes = (audioClip, lenSec, t0, t1, max) => {
  const H = MC.highlight, C = H.SCORE;
  const MAXN = max || H.MAX;
  const span = (t1 - t0) - lenSec;             // 窓をずらせる幅
  const S = audioClip && audioClip.sections;
  const dur = Math.min(lenSec, t1 - t0);
  const startCand = { ...H.START, t: t0, dur, rank: 1, score: 0 };
  if (!S || span < C.WHOLE_SPAN) return [startCand];   // 選ぶ余地なし=1本
  const dyn = H._dynSeries(S, audioClip.offset || 0);
  const imps = H._impacts(S, audioClip.offset || 0, t0, t1);
  const valleys = H._valleys(S, audioClip.offset || 0, t0, t1);
  const lastImp = imps.length ? imps[imps.length - 1] : null;

  /* --- 短い素材: 「尻まで」(最後のヒットで終わる)と「頭から」の2択で正直に --- */
  if (span < C.SHORT_SPAN) {
    /* 「尻まで」の snap は、snap後も「頭から」と有意に区別できるときだけ。
       衝撃の位置次第で snap先が t0 近くへ潰れ、2択が1つになる(QAが捕まえた) */
    let endT = t1 - lenSec;
    if (lastImp != null) {
      const s2 = lastImp + C.SNAP_TAIL - lenSec;
      if (s2 > t0 + 1 && s2 <= t1 - lenSec) endT = s2;
    }
    /* 1位の席は通常経路と同じ "best"(おまかせ・作り直しが引く鍵。非対称にしない) */
    const out = [{ ...H.FINALE, key: "best", t: endT, dur, rank: 1, score: 1 }];
    if (Math.abs(endT - t0) > 1) out.push({ ...startCand, rank: 2 });
    return out;
  }

  /* --- 通常: 窓を張って採点 → snap → ペナルティ → 重なり整理 → 順位 --- */
  const hop = Math.max(1, Math.min(3, lenSec / 20));
  const wins = [];
  for (let s = t0; s <= t1 - lenSec + 1e-6; s += hop) wins.push(s);
  /* 「尻まで」の窓は必ず張る(hop の端数で抜けると、ヒットで終わるショウの
     1位が中盤へずれる。2026-08-05 レビューP2) */
  if (!wins.length || wins[wins.length - 1] < t1 - lenSec - 1e-6) wins.push(t1 - lenSec);
  if (!wins.length) return [startCand];

  /* 窓ごとの素点(z化のため全窓ぶん先に測る) */
  const raw = wins.map(s => {
    const e = s + lenSec;
    let mx = 0, mn = 1;
    for (let t = s; t <= e; t += 1) { const v = dyn.at(t); if (v > mx) mx = v; if (v < mn) mn = v; }
    const inImps = imps.filter(x => x >= s && x <= e);
    const last = inImps.length ? inImps[inImps.length - 1] : null;
    return { s, e, arc: mx - mn, mx, last };
  });
  const st = arr => {
    let m = 0; arr.forEach(v => m += v); m /= arr.length;
    let q = 0; arr.forEach(v => q += (v - m) * (v - m));
    return { m, sd: Math.sqrt(q / arr.length) || 1e-6 };
  };
  const arcS = st(raw.map(r => r.arc)), mxS = st(raw.map(r => r.mx));

  const scored = raw.map(r => {
    /* snap: 終点を先に決める(窓内最後の衝撃+余韻)。始点は従属。
       衝撃が無い窓は始点を近くの谷(ブレス)へ寄せる */
    let s = r.s;
    if (r.last != null) {
      /* 末尾ぎりぎりの衝撃は t1 でクランプ(余韻が短くても尻まで見せる) */
      s = Math.max(t0, Math.min(t1 - lenSec, Math.min(t1, r.last + C.SNAP_TAIL) - lenSec));
    } else {
      const T = lenSec * C.START_T;
      const near = valleys.find(v => Math.abs(v - s) <= T);
      if (near != null) s = Math.max(t0, Math.min(t1 - lenSec, near - 0.7));
    }
    const e = s + lenSec;
    const inImps = imps.filter(x => x >= s && x <= e - 0.5);
    const last = inImps.length ? inImps[inImps.length - 1] : null;
    /* 採点(DCI協議の式) */
    let score = 0;
    const isFinale = lastImp != null && last != null
      && Math.abs(last - lastImp) < 0.5 && e >= lastImp + C.SNAP_TAIL - 0.6;
    if (isFinale) score += C.W_FINALE;
    if (last != null) score += C.W_PAYOFF * Math.max(0, Math.min(1, (last - s) / lenSec));
    /* z は ±2 でクランプ(合成素材で sd が極小だと z が数十になり、
       フィナーレ別格(3.0)を食い破る ─ QAが実際に捕まえた) */
    const zc = v => Math.max(-2, Math.min(2, v));
    score += C.W_ARC * zc((r.arc - arcS.m) / arcS.sd) * 0.5;
    score += C.W_CLIMAX * zc((r.mx - mxS.m) / mxS.sd) * 0.5;
    /* ペナルティ: ヒット寸前切り / ずっと大きくて起伏なし / ffの真ん中から開始 */
    if (imps.some(x => x > e && x <= e + 3)) score -= C.P_PRE_HIT;
    if (r.arc < arcS.m - arcS.sd && r.mx > 0.7) score -= C.P_FLAT_LOUD;
    const d0 = dyn.at(s), d1 = dyn.at(Math.max(t0, s - 2));
    if (d0 > 0.7 && Math.abs(d0 - d1) < 0.06) score -= C.P_COLD_OPEN;
    return { s, e, score, isFinale, last };
  });

  /* ソロの途中で切らない(端±2秒の feature)。classify は重いので上位だけ精密に */
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 12);
  for (const w of top) {
    for (const edge of [w.s, w.e]) {
      const c = MC.sections.classify(audioClip, Math.max(t0, edge - 2), Math.min(t1, edge + 2));
      if (c && c.feature > 0.6) { w.score -= C.P_SOLO_CUT; break; }
    }
  }
  top.sort((a, b) => b.score - a.score);

  /* 重なり整理: 50%以上重なる/8秒未満しか離れていない下位は落とす */
  const kept = [];
  for (const w of top) {
    const dup = kept.some(k =>
      Math.min(k.e, w.e) - Math.max(k.s, w.s) > lenSec * 0.5 || Math.abs(k.s - w.s) < 8);
    if (!dup) kept.push(w);
    if (kept.length >= MAXN) break;
  }

  /* ラベルは順位の飾り(選定後に付ける)。1位のキーは "best"(おまかせの既定) */
  const label = (w, i) => {
    if (w.isFinale) return { ...H.FINALE };
    if (Math.abs(w.s - t0) < 2) return { ...H.START };
    const c = MC.sections.classify(audioClip, w.s, w.e) || {};
    if (c.feature > 0.45) return { key: "solo", label: "ソロ", why: "特定の奏者が抜かれている位置", icon: "fa-star" };
    if (c.percussion > 0.4) return { key: "drumline", label: "ドラムライン", why: "打楽器が多く鳴っている位置", icon: "fa-drum" };
    if (c.quiet > 0.5) return { key: "ballad", label: "バラード", why: "静かでゆったりした位置", icon: "fa-moon" };
    if ((c.full != null ? c.full : c.tutti) > 0.5) return { key: "climax", label: "大盛り上がり", why: "全員が最も大きく鳴っている位置", icon: "fa-fire" };
    return { key: "scene" + (i + 1), label: "シーン" + (i + 1), why: "音の流れが良い位置", icon: "fa-clapperboard" };
  };
  const out = kept.map((w, i) => ({
    ...label(w, i),
    t: w.s, dur, rank: i + 1, score: +w.score.toFixed(2),
  }));
  if (out.length) out[0] = { ...out[0], key: "best" };   // 1位の席は不動(おまかせが引く)
  /* スタートが選ばれていなければプールとして最後に足す(場所を選び直せる道を残す) */
  if (!out.some(o => Math.abs(o.t - t0) < 2) && out.length < MAXN) {
    out.push({ ...startCand, rank: out.length + 1 });
  }
  return out;
};

MC.highlight.candidates = (audioClip, lenSec, t0, t1) => {
  const H = MC.highlight;
  const mk = (k, t, z) => ({
    key: k.key, label: k.label, why: k.why, icon: k.icon,
    t: Math.max(t0, Math.min(t1 - lenSec, t)),
    dur: Math.min(lenSec, t1 - t0),
    z: z || 0,
  });
  const startCand = { ...H.START, t: t0, dur: Math.min(lenSec, t1 - t0), z: Infinity };
  if (!audioClip || !audioClip.sections) return [startCand];
  /* 選んだ長さが演奏まるごとを覆う=選ぶ余地が無い。スタートだけ返す */
  if (t1 - t0 <= lenSec + 1) return [startCand];

  const { ts, by } = H._scan(audioClip, lenSec, t0, t1);
  if (ts.length < 2) return [startCand];

  const sep = Math.max(H.MIN_SEP,
    Math.min(lenSec * H.SEP_RATIO, (t1 - t0) / H.SPAN_DIV));
  const kept = [startCand];
  const free = t => kept.every(k => Math.abs(k.t - t) >= sep);

  /* 位置で決まる「フィナーレ」を先に確保する。演奏の終わりが入る切り出しは
     これ1つだけなので、音で探す性格に場所を譲ってはいけない */
  const finaleT = t1 - lenSec;
  if (free(finaleT)) kept.push({ ...H.FINALE, t: finaleT, dur: lenSec, z: Infinity });

  /* 性格ごとに「その曲の中でいちばん突き出た窓」を測る。
     比べるのは生スコアではなく z 値(冒頭の★参照) */
  const cand = [];
  for (const k of H.KINDS) {
    const arr = by[k.key];
    const { mean, sd } = H._stat(arr);
    let bi = -1, bv = -Infinity;
    for (let i = 0; i < arr.length; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; }
    if (bi < 0) continue;
    /* sd がほぼ0 = その性格に起伏が無い曲。z は意味を持たないので0にして、
       他の性格に席をゆずる */
    cand.push({ k, arr, mean, sd, z: sd > 1e-6 ? (bv - mean) / sd : 0 });
  }

  /* 席の取り方。
     順番は KINDS の定義順(大盛り上がり→バラード→ドラムライン→ソロ)で固定する。
     ★ z の大きい順にしてはいけない。z は「その曲の中でどれだけ突き出ているか」
       なので、ずっと大音量の曲では「大盛り上がり」の z が構造的に低くなり、
       いちばん分かりやすい選択肢が毎回いちばん先に落ちる(実測で確認)。
       z は順位ではなく**足切り**(Z_MIN)に使うのが正しい。
     ★ すでに埋まった場所とぶつかったら、その性格を捨てるのではなく
       **その性格にとって次に良い場所**を探す。捨てる実装にしていたときは、
       静かで調波的な区間で「ソロ」と「バラード」が同じ窓を取り合い、
       負けた方が候補から丸ごと消えていた(5つ出ずに4つになった) */
  const seat = minZ => {
    for (const c of cand) {
      if (kept.length >= H.MAX) return;
      if (c.used || c.z < minZ) continue;
      const order = c.arr.map((v, i) => i).sort((i, j) => c.arr[j] - c.arr[i]);
      for (const i of order) {
        if (!free(ts[i])) continue;
        c.used = true;
        kept.push(mk(c.k, ts[i], c.sd > 1e-6 ? (c.arr[i] - c.mean) / c.sd : 0));
        break;
      }
    }
  };
  seat(H.Z_MIN);   // まず「その曲に本当にある」性格だけで埋める
  seat(-Infinity); // 席が余ったら、弱い性格でも埋めて5つに近づける
  return kept.sort((a, b) => a.t - b.t);
};

/* 自分で決めた位置を「使える位置」へ丸める。
   ★ 拍にスナップする。0.1秒きざみのスライダーをそのまま使うと、
     どこで止めても音楽の途中から始まって頭が欠けたように聞こえる。
     拍が取れていない素材(拍検出に失敗)は素通しする */
MC.highlight.snapToBeat = (t, audioClip, lo, hi) => {
  const clamp = x => Math.max(lo, Math.min(hi, x));
  const B = audioClip && audioClip.beatsData;
  if (!B || !B.beats || !B.beats.length) return clamp(t);
  const off = audioClip.offset || 0;
  let best = null, bd = Infinity;
  for (const b of B.beats) {
    const g = b + off;
    if (g < lo - 1e-6 || g > hi + 1e-6) continue;
    const d = Math.abs(g - t);
    if (d < bd) { bd = d; best = g; }
  }
  /* 近くに拍が無い(範囲の端など)ときは丸めない。無理に遠くの拍へ飛ばすと
     スライダーを動かしても位置が変わらないように見える */
  return (best != null && bd <= 1.0) ? best : clamp(t);
};

/* 選んだ長さの実尺を決める。
   「まるごと」は代表値(8分30秒)ではなく**演奏の実尺**を使う。
   優さん指示の「8分30秒前後(いい感じのおすすめ時間でやる)」がこれ。
   どのプリセットでも、会員種別・端末・端末のメモリの上限で頭打ちにする */
MC.highlight.presetSec = (preset, showSec) => {
  const lim = window.MZ_LIMITS || {};
  const hard = MC.exporter && MC.exporter.maxExportableSec
    ? MC.exporter.maxExportableSec() : Infinity;
  /* ★ モード込みで聞く(2026-08-04)。自動スイッチング×スマホは30秒 */
  const roleCap = lim.maxExportSecFor
    ? lim.maxExportSecFor(MC.S.mode)
    : (lim.maxExportSec == null ? Infinity : lim.maxExportSec);
  const cap = Math.min(roleCap, hard);
  const want = preset && preset.whole ? (showSec || preset.sec) : preset.sec;
  return Math.max(5, Math.min(want, cap, showSec || want));
};
