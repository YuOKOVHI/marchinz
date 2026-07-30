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
    { key: "climax",   label: "大盛り上がり", why: "全員で一番大きく鳴っているところ",
      icon: "fa-fire", score: c => c.tutti },
    { key: "ballad",   label: "バラード",     why: "静かでゆったりしたところ",
      icon: "fa-moon", score: c => c.quiet },
    { key: "drumline", label: "ドラムライン", why: "打楽器が手数多く叩いているところ",
      icon: "fa-drum", score: c => c.percussion },
    { key: "solo",     label: "ソロ",         why: "誰かが抜かれているところ",
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
  START:  { key: "start",  label: "スタート",   why: "演奏のはじまりから", icon: "fa-flag" },
  FINALE: { key: "finale", label: "フィナーレ", why: "終わりまで入るところ", icon: "fa-flag-checkered" },
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

/* 選んだ長さの実尺を決める。
   「まるごと」は代表値(8分30秒)ではなく**演奏の実尺**を使う。
   優さん指示の「8分30秒前後(いい感じのおすすめ時間でやる)」がこれ。
   どのプリセットでも、会員種別・端末・端末のメモリの上限で頭打ちにする */
MC.highlight.presetSec = (preset, showSec) => {
  const lim = window.MZ_LIMITS || {};
  const hard = MC.exporter && MC.exporter.maxExportableSec
    ? MC.exporter.maxExportableSec() : Infinity;
  const cap = Math.min(lim.maxExportSec == null ? Infinity : lim.maxExportSec, hard);
  const want = preset && preset.whole ? (showSec || preset.sec) : preset.sec;
  return Math.max(5, Math.min(want, cap, showSec || want));
};
