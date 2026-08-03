"use strict";
/* ============ ディレクター(スコアリング型 自動カット割) ============
   拍・小節グリッド(beats.js)+音声セクション(sections.js)+映像解析(visual.js)を
   組み合わせて cutList を生成する。優先ルール:
   ① ブレ・急パン・フォーカス外れのカメラは失格(絶対条件)
   ② オープニング(演奏開始前)は単独の大きい人物(DM・サリュート)を最優先
   ③ ソロっぽい区間 → 単独アップ / バッテリー鳴り → グループショット
   ④ フラッグ等の同期した大きな動き → 引きの画角
   ⑤ ピット的な区間 → 役割タグ「ピット」のカメラへ意図的に切替
   ⑥ 一定間隔で引き(フォーメーション)を織り込む
   ⑦ 切替頻度はレベル1〜5×局所BPM/音圧で動的に。静か/低BPMはディゾルブ
   cutList形式は既存互換 [{t, clipId, trans, dur}]。 */

MC.director = {
  /* 切替頻度3段階: 基準ショット長(秒)と引き画の織り込み間隔(何ショットに1回)。
     ★ 既定(2:おすすめ)を 5.0/3.0/9 → 4.0/2.5/7 に短縮(2026-08-02 優さん指示
     「切り替えはもう少し多めにして」)。反省会用途では全員の視点がテンポよく
     見えるのが価値で、9秒上限は1カメラを見つめ続ける時間として長すぎた。
     1(少なめ)と3(多め)は本人が明示的に選ぶ値なので据え置く */
  /* ★ 2026-08-03 優さん指示①「もっと切り替え頻度を多く。4秒以上は同じのにしない」
     +補足「きっちり4秒じゃなくてもいい。少し誤差があってもいい」。
     おすすめ(2)は目標レンジ2.0〜4.0秒の**ソフト上限** ─ 小節の区切りを優先し、
     スナップの都合で+1秒程度の超過は許容する(音楽的な区切り > きっちり4秒)。
     sameSec = 同一カメラの連続オンエア時間の上限(秒)。回数(MAX_RUN)より
     **時間が主**。おすすめでは典型ショット(約3秒)なら2本目で超えるため
     実質「同じカメラの連続は1ショット強」。最短ショット(2秒)どうしなら
     2本(計4秒)までは収まる ─ それでも4秒目安の趣旨の中にある。
     多め(3)=目安2〜3秒でさらに短く / 少なめ(1)=従来寄り(5〜7秒・上限も緩い) */
  LEVELS: {
    1: { base: 5.0, min: 3.5, max: 7.0, sameSec: 8.0, interleave: 2 },  // 少なめ(ゆったり)
    2: { base: 3.0, min: 2.0, max: 4.0, sameSec: 5.0, interleave: 3 },  // おすすめ(2〜4秒)
    3: { base: 2.4, min: 1.8, max: 3.0, sameSec: 4.0, interleave: 4 },  // 多め(細かい)
  },
  /* 素材ごとの出番の希望(clip.freq)をスコアへ足す量。
     「少なめ」は下の登場間隔ボーナス(最大0.48)より小さくして、
     出番ゼロにはならず「たまに出る」に落ち着かせる */
  FREQ_BIAS: { less: -0.35, auto: 0, more: 0.45 },
  /* ★ 同一カメラの連続ショット上限(2026-08-02 優さん実機: 動画2本で
     1カメラに張り付いた)。スコアの交互化圧力は prevId -0.9 + 登場間隔 +0.48 の
     計1.38が上限で、ソロ区間(wClose=0.30+0.95*feature)+操作カメラ加点
     (+0.12+0.9*feature*close)が重なると片方が常勝し、曲の間ずっと
     切り替わらない。マーチングの反省会では「両方の視点が見える」ことが
     価値なので、上限に達したら失格でない別カメラへ強制的に切り替える。
     失格(dq)しか残っていなければ切り替えない ─ 「振っている絵は絶対に
     入れない」(ディレクター指示)は連続上限より強い。
     ★ 2026-08-03: 主役は時間上限(MAX_SAME_SEC)に交代。回数は時間が測れない
       異常系の保険として残す(時間上限が先に効くので通常は出番がない) */
  MAX_RUN: 3,
  /* ★ カメラの性格の重み(2026-08-03 優さん指示②「俯瞰固定は気持ち多め、
     フロントピットやドラムメジャーなど、人が動いてないのは少なめ」)。
     性格の推定は visual.js の _finalize(overheadFixed / staticScene)。
     ・OVERHEAD_BONUS: 控えめな加点。ショット種スコア(重み0.25〜1.3×0..1)の
       数%〜10%相当。強くしすぎると俯瞰に張り付く
     ・STATIC_BIAS: FREQ_BIAS.less(-0.35)と同格の減点。出番ゼロにはしない ─
       登場間隔ボーナス(最大+0.48)と飢餓ガード(STARVE)が最低保証を担う */
  OVERHEAD_BONUS: 0.15,
  STATIC_BIAS: -0.4,
  /* ★ 出番の飢餓ガード(2026-08-02 優さん実機: 「3本入れたのに2台しか出ない」。
     N本入れるとN-1台になる規則性)。原因はスコアの構造 ─ 上位2台は
     「直前 -0.9 / 2つ前 -0.25」の罰を交互に払いながら回るが、3台目は
     常に**その区間の勝者**(罰を払っていない側)に勝たねばならず、
     登場間隔ボーナス(最大+0.48)では届かない。つまり少し弱いカメラは
     何本入れても構造的に出番ゼロになる(2本のときは2台目が同じ理屈で消える)。
     ─ そこで「STARVE ショット以上出ていない失格でないカメラ」がいたら、
     採点に関係なく次のショットに出す。反省会では全員の視点が見えることが
     採点の細かい優劣より価値が高い(優さんの用途判断)。
     値4: おすすめ(基準4秒)でおよそ20秒に1回は必ず巡ってくる間隔 */
  STARVE: 4,
  DISSOLVE_BPM: 92,    // これ未満の局所BPMはディゾルブ候補
  _salute: null,
};

/* ---------- パイプライン(UIのボタンから呼ぶ) ---------- */
/* p = MZP進捗。①音声解析 ②映像解析 ③カット割 の3段を名乗る。
   base = 外側の流れで既に済んでいる段数。おまかせ(runEasyFinish)は同期・区切りが
   先にあるので、その数を渡してもらう。渡さないと 1/6 の途中で 1/6 へ巻き戻って
   「何段目か」が嘘になる(2026-07-26)。単体の #autocutBtn は steps:3 なので base=0 */
MC.director.run = async (p, base = 0) => {
  const audioClip = MC.getClip(MC.S.audioClipId);
  if (!audioClip) throw new Error("音声クリップがありません");
  if (MC.S.clips.filter(c => !c.isAudio && !c.isImage).length < 2) throw new Error("2本以上の動画が必要です");

  // ① 音声: 拍+セクション
  p.step(base + 1, "音楽を解析しています…");
  p.pulse("音楽を解析しています…");
  await MZP.paint();
  await MC.audio.extract8k(audioClip);   // 窓キャッシュなら全尺で読み直される(2026-07-24)
  if (!audioClip.beatsData) audioClip.beatsData = MC.beats.analyze(audioClip.audio8k);
  await MC.sections.analyze(audioClip);
  // サリュート(演奏開始)は取れれば使う(失敗しても続行)
  if (!MC.director._salute) {
    try { MC.director._salute = await MC.salute.detect(); } catch (e) { /* 任意 */ }
  }

  // ② 映像: 各クリップの解析(重い。件数進捗)。音声のみ・静止画は対象外
  const [tIn, tOut] = MC.trimRange();
  const vclips = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  for (let ci = 0; ci < vclips.length; ci++) {
    /* ★ 中断点(2026-08-01 レビュー14件)。ここに1つも無かったため、おまかせ画面で
       「やめる」を押しても解析は最後まで走り続け、その間ずっと
       端末が熱いまま裏の画面のボタンも全部無効だった */
    if (MC.ui && MC.ui._autoCancel) throw new Error("やめました");
    const c = vclips[ci];
    p.step(base + 2, `映像を見ています…(${ci + 1}/${vclips.length}本目)`);
    const l0 = Math.max(0, tIn - c.offset);
    const l1 = Math.max(l0 + 1, Math.min(c.duration, tOut - c.offset));
    // 進捗は全クリップ通算(クリップごとに0%へ巻き戻さない)
    await MC.visual.analyzeClip(c, l0, l1, (i, n) => {
      if (MC.ui && MC.ui._autoCancel) throw new Error("やめました");
      const fr = (ci + i / n) / vclips.length;
      p.set(fr, null, { sub: `${ci + 1} / ${vclips.length} 本目・${MZP.shortName(c.name)}` });
      /* おまかせ画面のバーにも流す。この段(w:30)がいちばん長いので、
         ここが段単位のままだと数分間 51% で固定されて見える */
      if (MC.ui && MC.ui.autoStage) MC.ui.autoStage.progress(fr * 0.85);
    });
  }

  // ③ カット割
  p.step(base + 3, "カットを割っています…");
  p.pulse("カットを割っています…");
  await MZP.paint();
  return MC.director.generate();
};

/* ---------- 拍・小節グリッド(グローバル秒) ---------- */
MC.director._grid = (audioClip, tIn, tOut) => {
  const B = audioClip.beatsData;
  const beats = B.beats.map(b => b + audioClip.offset).filter(b => b > tIn + 0.5 && b < tOut - 0.5);
  if (beats.length < 4) throw new Error("範囲内に拍が足りません(トリム範囲を広げてください)");
  const bpb = MC.S.beatsPerBar;
  let downIdx = 0, bestS = -1;
  for (let ph = 0; ph < bpb; ph++) {
    let s = 0;
    for (let i = ph; i < beats.length; i += bpb) {
      const li = Math.round((beats[i] - audioClip.offset - 0.032) / B.hopSec);
      s += B.env[Math.max(0, Math.min(B.env.length - 1, li))] || 0;
    }
    if (s > bestS) { bestS = s; downIdx = ph; }
  }
  const bars = [];
  for (let i = downIdx; i < beats.length; i += bpb) bars.push(beats[i]);
  return { beats, bars: bars.length >= 3 ? bars : beats, period: B.period };
};

/* tTarget 以降で最寄りのカット点(minT より後)を拍/小節から選ぶ */
MC.director._snap = (grid, tTarget, minT) => {
  let best = null, bd = Infinity;
  for (const b of grid.bars) {
    if (b < minT) continue;
    const d = Math.abs(b - tTarget);
    if (d < bd) { bd = d; best = b; }
  }
  // 小節が遠すぎる(1.5拍超ズレ)なら拍で
  if (best == null || bd > grid.period * 1.5) {
    for (const b of grid.beats) {
      if (b < minT) continue;
      const d = Math.abs(b - tTarget);
      if (d < bd) { bd = d; best = b; }
    }
  }
  return best != null ? best : Math.max(minT, tTarget);
};

/* ---------- セグメントのカメラ採点 ---------- */
/* 戻り値: {id, score, wideChosen} のリスト(スコア降順) */
MC.director._rank = (g0, g1, cls, ctx) => {
  const opening = MC.director._salute &&
    g0 < MC.director._salute.musicStart - 0.5;
  // 望むショット種の重み(セクション分類から)
  let wClose, wGroup, wWide;
  if (opening) {
    wClose = 1.0; wGroup = 0.1; wWide = 0.4;   // DM・サリュートのアップ最優先
  } else if (cls) {
    // ソロ・ソリ(誰かが抜かれている場面)は、抜いているカメラをかなり強く優先する
    wClose = 0.30 + 0.95 * cls.feature;
    wGroup = 0.25 + 0.60 * cls.percussion;
    wWide = 0.25 + 0.45 * cls.tutti;
    // 聴かせどころでは引きに逃げない(引きの織り込み圧力もここでは弱める)
    if (cls.feature > 0.45) wWide *= 0.5;
  } else {
    wClose = 0.35; wGroup = 0.3; wWide = 0.35;
  }
  // 引き画の織り込み圧力(interleaveショットごとに1回は引きへ)
  const pw = ctx.segsSinceWide / ctx.interleave;
  wWide += pw >= 1 ? 1.0 : 0.5 * pw;
  const pitSeg = !opening && cls && cls.pit > 0.45 && ctx.hasPitCam;

  // 素材範囲: 全区間カバー→中点カバー→全クリップ の順で候補を確保
  //(録画開始のズレで区間を全カバーするカメラが無くても、カット割を止めない)
  const mid = (g0 + g1) / 2;
  const pool = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  let cands = pool.filter(c => g0 >= c.offset - 0.2 && g1 <= c.offset + c.duration + 0.2);
  if (!cands.length) cands = pool.filter(c => mid >= c.offset && mid <= c.offset + c.duration);
  if (!cands.length) {
    // どのカメラも区間をカバーしない(録画長の差など)。
    // 盲目にスコアで選ぶと素材の無いカメラ=黒画面が混入するため、
    // 区間との重なりが最大(同率なら距離が最小)のカメラだけを候補にする
    const overlap = c => Math.max(0,
      Math.min(g1, c.offset + c.duration) - Math.max(g0, c.offset));
    const dist = c => Math.max(0, Math.max(g0 - (c.offset + c.duration), c.offset - g1));
    cands = [...pool].sort((a, b) => (overlap(b) - overlap(a)) || (dist(a) - dist(b))).slice(0, 1);
  }

  const ranked = [];
  for (const c of cands) {
    const m = MC.visual.seg(c, g0, g1);
    const sh = MC.visual.shotScores(m);
    // 役割タグで底上げ(自動判定の誤りを人の指定が上書き)
    if (c.role === "wide") sh.wide = Math.max(sh.wide, 0.8);
    if (c.role === "close") sh.close = Math.max(sh.close, 0.7);
    let score = 0;
    const dqWhy = MC.visual.dqReason(m, c.role);
    const dq = dqWhy != null;
    if (dq) score -= 1000;      // 絶対条件: 採用不可(全滅時の比較用に相対値は残す)
    score += wClose * sh.close + wGroup * sh.group + wWide * sh.wide;
    // フラッグ等の同期した大きな動きは「引きで見せる」を後押し
    score += sh.ensemble * 0.3 * sh.wide;
    // ピット区間はピットタグのカメラを意図的に採用。それ以外の区間では専用機を少し引っ込める
    if (c.role === "pit") score += pitSeg ? 1.2 : -0.35;
    // 素材ごとの出番の希望(少なめ/おまかせ/多め)
    score += MC.director.FREQ_BIAS[c.freq] || 0;
    /* ★ カメラの性格で出番を重み付け(2026-08-03 優さん指示②)。
       クリップ全体の性格(visual._finalize が推定)を読むだけ ─
       俯瞰固定=控えめに加点 / 人が動かない定点=減点(ゼロにはしない。
       登場間隔ボーナスと飢餓ガードが最低保証) */
    const Vc = c.visual;
    if (Vc) {
      if (Vc.overheadFixed) score += MC.director.OVERHEAD_BONUS;
      if (Vc.staticScene) score += MC.director.STATIC_BIAS;
    }
    // 画質(セグメント内シャープネスがクリップ中央値に対して高いか)
    if (m && m.sharpMed > 1e-6) score += 0.1 * Math.min(1.2, m.sharpMean / m.sharpMed);

    /* 操作カメラ(手持ち・ジンバル・カメラマン付き三脚)の扱い。
       被写体を変えるために振っている最中の絵は使えない(既に失格にしている)が、
       振り終わって据わっている絵は「狙って撮った画」なので価値が高い。
       とくにソロ・ソリの最中は、そのカメラが奏者を抜いている可能性が高いので
       強く後押しする。据わっている絵をしっかり使うことで、
       移動中を捨てたぶんの帳尻を合わせる */
    if (m && m.operated && m.settled) {
      score += 0.12;                                    // 狙って撮られた画(控えめ)
      // 加点はソロ・ソリに集中させる。ここを厚くすることで、移動中を捨てたぶんの
      // 帳尻を合わせる。常時加点にすると全奏でも寄りが勝ってしまう
      if (cls && cls.feature > 0.35) score += 0.9 * cls.feature * sh.close;
    }
    // 連続・直近使用のペナルティ、しばらく出ていないカメラのボーナス
    if (c.id === ctx.prevId) score -= 0.9;
    if (c.id === ctx.prev2Id) score -= 0.25;
    score += 0.06 * Math.min(8, ctx.sinceUse.get(c.id) || 0);   // 出番が空くほど戻りやすく(最大0.48)
    ranked.push({ id: c.id, score, wideChosen: sh.wide >= 0.5, dq, dqWhy: dqWhy });
  }
  ranked.sort((a, b) => b.score - a.score);

  /* 引きの織り込みはハード制約で担保する。
     重み(wWide)への加算は score = wWide × sh.wide の乗算経路を通るため、
     引きスコアが0のカメラしか無い状況では何度足しても0のままで発火しない。
     間隔を過ぎたら「引きに見えるカメラ」だけに候補を絞る。
     ただし該当が無い(全滅・全部失格)ときは通常の順位に戻し、カット割自体は止めない */
  // ただしソロ・ソリの最中は引きへ戻さない(抜いている画を見せ切る)。
  // segsSinceWide は増え続けるので、聴かせどころが終わった直後に引きへ戻る
  const featuring = cls && cls.feature > 0.45;
  if (!opening && !featuring && ctx.segsSinceWide >= ctx.interleave) {
    const wides = ranked.filter(r => r.wideChosen && !r.dq);
    if (wides.length) return wides;
  }
  return ranked;
};

/* ---------- cutList 生成 ---------- */
MC.director.generate = () => {
  const audioClip = MC.getClip(MC.S.audioClipId);
  const S = audioClip.sections;
  const [tIn, tOut] = MC.trimRange();
  const grid = MC.director._grid(audioClip, tIn, tOut);
  const L = MC.director.LEVELS[MC.S.cutLevel] || MC.director.LEVELS[3];
  const bpmAll = audioClip.beatsData.bpm;

  const ctx = {
    prevId: null, prev2Id: null,
    runLen: 0,          // いまのカメラが何ショット連続しているか(MAX_RUN用)
    runSec: 0,          // いまのカメラの連続オンエア秒(sameSec用。時間が主)
    segsSinceWide: 0,
    interleave: L.interleave,
    sinceUse: new Map(MC.S.clips.map(c => [c.id, 99])),
    hasPitCam: MC.S.clips.some(c => c.role === "pit"),
  };
  const cuts = [];
  /* 失格で見送った区間の集計。実素材でしきい値を詰めるための根拠を残す */
  const dqTally = { total: 0, by: {} };
  let forcedN = 0;   // 連続上限による強制切替の回数(実素材で偏りを読む根拠)
  let t = tIn;
  let guard = 0;
  while (t < tOut - L.min && guard++ < 2000) {
    // ショット長: レベル基準 × 局所テンポ/音圧(速い・大きい→短く)
    const probe = MC.sections.classify(audioClip, t, Math.min(tOut, t + L.base));
    let mod = 1;
    if (probe) {
      const tempoN = probe.bpm ? Math.max(0, Math.min(1, (probe.bpm - 90) / 60)) : 0.5;
      mod = Math.max(0.6, Math.min(1.5, 1.3 - 0.5 * probe.dyn - 0.3 * tempoN));
    }
    const target = Math.max(L.min, Math.min(L.max, L.base * mod));
    let tNext = MC.director._snap(grid, t + target, t + L.min);
    tNext = Math.min(tNext, tOut);
    if (tNext <= t + 0.5) tNext = Math.min(tOut, t + L.min);
    /* ★ ソフト上限(2026-08-03 優さん①+補足)。小節スナップの都合で max を
       多少(+1秒まで)超えるのは許す ─ 音楽的な区切りを優先する。
       それすら無い(小節が遠い)ときだけ、区切りより長さを採って max で切る */
    if (tNext - t > L.max + 1.0) tNext = Math.min(tOut, t + L.max);

    // このセグメントのカメラを選ぶ
    const cls = MC.sections.classify(audioClip, t, tNext);
    const ranked = MC.director._rank(t, tNext, cls, ctx);
    if (!ranked.length) break;
    let top = ranked[0];

    /* 採用できる画が1つも無い区間(全カメラがパン中・人が写っていない等)。
       ディレクター指示「振っている絵は絶対に入れない」を満たすため、
       妥協して失格の画を出すのではなく、直前のカットをこの区間まで延ばす。
       延ばせない(冒頭)ときだけ、やむを得ず最良の1本を使う */
    if (top.dq) {
      if (cuts.length) {
        const why = ranked.map(r => r.dqWhy).filter(Boolean);
        const tally = {};
        why.forEach(w => { tally[w] = (tally[w] || 0) + 1; });
        dqTally.total++;
        why.forEach(w => { dqTally.by[w] = (dqTally.by[w] || 0) + 1; });
        const detail = Object.entries(tally).map(([k, v]) => `${k}×${v}`).join(" / ");
        MC.log(`director: ${t.toFixed(1)}s〜 は使える画が無いため直前のカットを延長（${detail}）`);
        // 文脈は進めずに時刻だけ進める(このセグメントは前のカットが占める)。
        // 連続オンエア秒だけは足す ─ 延長は sameSec を超えうるが、
        // 「振っている絵は絶対に入れない」(絶対条件)が時間上限より強い
        ctx.runSec += (tNext - t);
        t = tNext;
        continue;
      }
      const usable = ranked.find(r => !r.dq);
      if (usable) top = usable;
    }

    /* ★ 全カメラの出番を仕組みで保証する2枚のガード(2026-08-02 優さん実機)。
       採点は「どの画がいまいちばん良いか」を決めるだけで、
       「全員の視点が見える」ことは採点からは出てこない ─ ここで保証する。
       どちらのガードも失格(dq)のカメラへは切り替えない(「振っている絵は
       絶対に入れない」の絶対条件が上)。なお失格延長(上のcontinue)は
       cuts を増やさないので runLen には数えない ─ 延長は「良い画が無い」
       ときの緊急避難で、ここで無理に切ると失格の画が出る */
    if (!top.dq) {
      /* ① 飢餓ガード: STARVE ショット以上出ていないカメラを強制的に出す。
         該当が複数なら採点順で最良の1台(ranked はスコア降順)。
         ★ cuts.length との min を取る(2026-08-02 push前レビュー):
         sinceUse は「未登場でも登場間隔ボーナスが満額つく」ように 99 で
         初期化されているため、素の値だと開始直後は全カメラが飢餓に見え、
         1カット目が毎回ランク2位へ強制されていた(オープニングの
         DM・サリュート最優先=採点ルール②が常に破られる)。
         「実際に経過したショット数」で数えれば、飢餓は本来どおり
         STARVE カット目以降にしか成立しない */
      const starving = ranked.find(r => !r.dq && r.id !== top.id
        && Math.min(ctx.sinceUse.get(r.id) || 0, cuts.length) >= MC.director.STARVE);
      if (starving) {
        forcedN++;
        MC.log(`director: ${t.toFixed(1)}s〜 ${ctx.sinceUse.get(starving.id)}ショット出ていないカメラを出す`);
        top = starving;
      }
      /* ② 連続上限: **時間が主・回数は従**(2026-08-03 優さん指示①)。
         同じカメラの連続オンエアが L.sameSec を超える見込みなら別カメラへ。
         おすすめ(sameSec=5)では典型ショット(約3秒)の2本目で超えるため、
         実質「同じカメラは1ショット強まで」= 4秒目安のソフト上限が効く
         (最短2秒×2本=4秒だけは収まる。LEVELS の注記参照)。
         MAX_RUN(回数)は時間が測れない異常系の保険として残す */
      if (top.id === ctx.prevId
          && (ctx.runSec + (tNext - t) > (L.sameSec || Infinity)
              || ctx.runLen >= MC.director.MAX_RUN)) {
        const alt = ranked.find(r => r.id !== ctx.prevId && !r.dq);
        if (alt) {
          forcedN++;
          MC.log(`director: ${t.toFixed(1)}s〜 連続${ctx.runSec.toFixed(1)}秒/${ctx.runLen}ショットのため別カメラへ強制切替`);
          top = alt;
        }
      }
    }

    // トランジション: 静か or 局所BPM低 → ディゾルブ(冒頭カットはそのまま)
    let trans = "cut", dur = 0;
    if (cuts.length) {
      const slow = cls && cls.bpm && cls.bpm < MC.director.DISSOLVE_BPM;
      const quiet = cls && cls.quiet > 0.55;
      if (slow || quiet) {
        trans = "dissolve";
        dur = Math.min(0.9, Math.max(0.5, (tNext - t) / 4));
      }
    }
    cuts.push({ t, clipId: top.id, trans, dur });

    // 文脈更新
    ctx.runSec = top.id === ctx.prevId ? ctx.runSec + (tNext - t) : (tNext - t);
    ctx.runLen = top.id === ctx.prevId ? ctx.runLen + 1 : 1;
    for (const [id, v] of ctx.sinceUse) ctx.sinceUse.set(id, v + 1);
    ctx.sinceUse.set(top.id, 0);
    ctx.prev2Id = ctx.prevId;
    ctx.prevId = top.id;
    ctx.segsSinceWide = top.wideChosen ? 0 : ctx.segsSinceWide + 1;
    t = tNext;
  }
  if (!cuts.length) throw new Error("カットを作れませんでした(範囲を確認してください)");
  // 末尾の短すぎるセグメントは1つ前と統合
  if (cuts.length > 1 && tOut - cuts[cuts.length - 1].t < 1.5) cuts.pop();
  MC.S.cutList = cuts;
  MC.saveState();
  const nDissolve = cuts.filter(c => c.trans === "dissolve").length;
  MC.log(`director: level=${MC.S.cutLevel} ${cuts.length}カット(ディゾルブ${nDissolve}`
    + `${forcedN ? `・強制切替${forcedN}` : ""}) bpm=${bpmAll.toFixed(1)}`);
  return { segments: cuts.length, bpm: bpmAll, dissolves: nDissolve };
};
