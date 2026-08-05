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
  /* ★ ショット種と長さの連動(2026-08-04 DCI配信ディレクター P2改
     「引きは4〜8秒読ませ、寄りは2〜4秒で回す」)。
     引き(隊列・フォーメーション)は形を読む時間が要るので長く、
     寄り(奏者の表情)は情報が早く出尽くすので短く回す。
     ★ 目標値は**切替頻度レベルの中で**スケールさせる ─ 「多め」を選んだ人に
       8秒の引きを出すのは選択の否定になる。おすすめ(2)で引き4〜6秒/寄り2〜4秒。
     ★ 引きは L.sameSec(同一カメラの連続オンエア上限)を1ショットで超えうる。
       sameSec は「同じカメラが**続く**時間」の門なので単発の引きは通る ─
       ここは 2026-08-03「4秒以上は同じのにしない」と正面から当たる箇所で、
       引きだけ例外にするのが今回の指示(P2改)。寄り側は 2〜4秒のまま。 */
  /* ★ front = カンパニーフロント(全奏)の引き専用レンジ(2026-08-04 優さん決定①)。
     全体の隊形変化は4〜6秒では見切れない ─ 全奏で引きに座る回だけ
     さらに長く読ませる(おすすめで6〜8秒)。「4秒以上は同じのにしない」
     (2026-08-03)の明示的な例外。他の引き(楽章の切れ目・織り込み)は wide のまま。
     多め(3)を選んだ人に8秒は選択の否定なので、レベル内でスケールさせる */
  LEVELS: {
    // 少なめ(ゆったり)
    1: { base: 5.0, min: 3.5, max: 7.0, sameSec: 8.0, interleave: 2,
         wide: { base: 6.5, min: 5.0, max: 8.0 }, close: { base: 4.0, min: 3.5, max: 5.0 },
         front: { base: 8.0, min: 6.5, max: 9.5 } },
    // おすすめ(2〜4秒)
    2: { base: 3.0, min: 2.0, max: 4.0, sameSec: 5.0, interleave: 3,
         wide: { base: 5.0, min: 4.0, max: 6.0 }, close: { base: 2.8, min: 2.0, max: 4.0 },
         front: { base: 7.0, min: 6.0, max: 8.0 } },
    // 多め(細かい)
    3: { base: 2.4, min: 1.8, max: 3.0, sameSec: 4.0, interleave: 4,
         wide: { base: 3.6, min: 3.0, max: 4.5 }, close: { base: 2.2, min: 1.8, max: 3.0 },
         front: { base: 5.2, min: 4.5, max: 6.5 } },
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
  /* ===== カメラの属性2軸(2026-08-05 優さん指示で改訂) ===== */
  /* 他の場所からの全体: 「固定であれば10のうち2〜4」。引きのローテーションに
     普通に参加させ(前版の「場面の変わり目だけ」の縛りは廃止)、
     合計が全尺の4割を超えたら強く引っ込める */
  ALT_WIDE_CAP: 0.40,
  ALT_WIDE_PENALTY: 3.0,
  /* スパイス(メジャー・ピット): 「10のうち1あれば十分」→実機で
     「頻度が多すぎる。全体で5-10%前後に」(2026-08-05 優さん)。
     上限8%(5〜10%の中央寄り)+発火条件も下で締めた。条件外は role=pit の -0.35 に上乗せ */
  SPICE_PENALTY: 1.5,
  SPICE_CAP_RATIO: 0.08,
  HARD_WIDE_NO_SPICE: true,   // 引き限定の受け皿にスパイスを使わない(QAの変異用に定数化)
  /* ソロは操作カメラで抜く(「ソロを抜いていたら必ず使う」)。
     失格(ブレ・パン)していれば使わない ─ その判定は dq が担う */
  SOLO_OPERATOR: true,
  /* 動きあり×ブレ多の素材(旧・歩き撮り): 良い区間だけの飛び道具。
     乱発させないクールダウン(秒) */
  ROAM_BONUS: 0.6,
  ROAM_PENALTY: 3.0,
  ROAM_COOLDOWN: 20,
  /* アクションカメラ・プレイヤー視点は全尺の5〜15%(2026-08-05 優さん指示)。
     上限15%で打ち止め。下限側は「良い窓なら中立で採点勝負」(下の gate)が支える */
  ACTION_CAP_RATIO: 0.15,
  /* ★ 出番を控えるカメラの飢餓の間隔を伸ばす(2026-08-04 優さん指示
     「ドラムメジャーやフロントピットなど、対象のドリル・MMがない固定カメラは
     使用する頻度を少なめに」)。
     ★ ここが本丸: 減点(STATIC_BIAS -0.40 / FREQ_BIAS.less -0.35)は
       **採点の話**でしかなく、飢餓ガードは採点を無視して STARVE ショットごとに
       強制的に出す。つまり「少なめ」と指定しても、出番の**回数**は
       他のカメラと変わっていなかった(2026-08-03に減点を入れて以来ずっと)。
       控えたいカメラは、飢餓とみなすまでの間隔そのものを伸ばす。
     2倍 = おすすめ(基準3秒)でおよそ50秒に1回へ(標準は25秒に1回) */
  QUIET_STARVE_MULT: 2,
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
  /* ★ ソロ・ソリの最中は飢餓ガードを何ショットまで我慢するか(2026-08-04 P3改)。
     抜いている画を見せ切りたいので待たせるが、**無制限にはしない** ─
     2026-08-02 の実機不具合(3本入れて2台)は feature が曲じゅう高止まりして
     起きており、ソロ中は無条件で見送る作りにすると、あの不具合がそのまま戻る。
     待てるのはここまで、と上限で縛ることで「本物のソロは伸ばす／
     高止まりでは戻る」を両立させる。2 = STARVE(4)と合わせて最大6ショット待ち */
  STARVE_DEFER: 2,
  DISSOLVE_BPM: 92,    // これ未満の局所BPMはディゾルブ候補
  /* ★ バラードのディゾルブは1.0〜2.0秒(2026-08-04 P3改)。
     旧値(0.5〜0.9秒)は「ゆったり見せる」ために選んだ演出なのに、
     実際は速いクロスフェードにしかなっていなかった。
     ショット長の6割を上限にする(短いショットを丸ごと混ぜない) */
  DISSOLVE_MIN: 1.0,
  DISSOLVE_MAX: 2.0,
  /* ★ カンパニーフロント(全奏)は絶対に引き(2026-08-04 P1)。
     tutti(=音圧dyn)がこの値以上の区間は、候補を引きの画に限定するハード規則。
     旧来は score += ensemble*0.3*wide 程度の弱い後押しで、
     操作カメラの寄り加点に負けて「いちばん見せ場で寄り」が普通に起きていた */
  TUTTI_WIDE: 0.7,
  /* ★ インパクト(衝撃)の先読み(2026-08-04 P1・いちばん化ける)。
     いまのカット割は音圧が上がったのを**見てから**引きへ行く=後追い。
     中継は「音楽より先に座る」ので、衝撃のSEAT_BEATS拍前に引きへ切っておく。
     IMPACT_HIGH  : この音圧に達していなければ衝撃と呼ばない
     IMPACT_RISE  : 直前3点の平均からの上げ幅
     IMPACT_GAP   : 近すぎる衝撃はまとめる(秒) */
  IMPACT_HIGH: 0.62,
  IMPACT_RISE: 0.22,
  IMPACT_GAP: 4.0,
  SEAT_BEATS: 2,
  /* ★ 楽章・セクションの切れ目(2026-08-04 DCIディレクターの回答C) */
  BREAK_LOW: 0.30,        // これ未満を「静けさ」とみなす
  BREAK_HIGH: 0.50,       // ここまで戻ったら「また始まった」
  BREAK_MIN_SEC: 1.2,     // 静けさがこの秒数続いて初めて切れ目とみなす
  BREAK_BPM_RATIO: 0.18,  // 局所BPMがこの割合以上変わったら切れ目
  BREAK_GAP: 10.0,        // 近すぎる切れ目はまとめる(秒)
  /* ★ 切り替わったと分からない画へは切らない(2026-08-04 DCIディレクターの回答A)。
     カメラの位置関係を持っていないので、位置の代わりに**画の似かた**で見る ─
     直前と画角・人数がほぼ同じカメラへ切ると、見ている人には
     「切り替わっていない」ようにしか見えない(いわゆるジャンプカット)。
     ★ 減点であって失格にはしない。3台とも似た引き、という素材は普通にあり、
       失格にすると切り替え自体が止まってしまう */
  JUMP_NEAR: 0.35,        // 画の隔たりがこれ未満なら「似すぎ」
  JUMP_PENALTY: 0.55,     // 似ているほど最大この幅で減点
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

/* tTarget に最も近い「拍」(minT より後)。小節を優先する _snap と違い、
   衝撃の2拍前という**拍単位の狙い**を鈍らせないために拍だけを見る */
MC.director._snapBeat = (grid, tTarget, minT) => {
  let best = null, bd = Infinity;
  for (const b of grid.beats) {
    if (b < minT) continue;
    const d = Math.abs(b - tTarget);
    if (d < bd) { bd = d; best = b; }
  }
  return best != null ? best : Math.max(minT, tTarget);
};

/* ---------- 衝撃(インパクト)の時刻 ---------- */
/* 音圧(dyn)の急上昇＝ヒットの瞬間を、カット割の前にまとめて拾っておく。
   ★ 時刻の精度について正直に書く: sections の rms は1.0秒窓の**中央**時刻を
     持つので、立ち上がりは実際より約0.25秒後ろに出る。差し引いたうえで
     最寄りの拍へスナップして吸収する(マーチングの衝撃は拍に乗る)。
     拍から1拍以上離れていればスナップしない(拍の推定が外れている場面)。
   sections が無い/スタブのときは空配列 ─ 先読みは黙って効かなくなるだけで
   カット割自体は従来どおり動く */
MC.director._impacts = (audioClip, grid, tIn, tOut) => {
  const S = audioClip.sections;
  if (!S || !S.rms || !S.t || !S.t.length) return [];
  const lo = S.rmsLo, hi = S.rmsHi;
  if (!(hi > lo)) return [];
  const dyn = i => Math.max(0, Math.min(1, (S.rms[i] - lo) / (hi - lo)));
  const out = [];
  for (let i = 3; i < S.t.length; i++) {
    const now = dyn(i);
    if (now < MC.director.IMPACT_HIGH) continue;
    const before = (dyn(i - 1) + dyn(i - 2) + dyn(i - 3)) / 3;
    if (now - before < MC.director.IMPACT_RISE) continue;
    let tt = S.t[i] + audioClip.offset - MC.sections.WIN / 4;   // 窓の遅れぶん戻す
    let best = null, bd = Infinity;
    for (const b of grid.beats) { const d = Math.abs(b - tt); if (d < bd) { bd = d; best = b; } }
    if (best != null && bd <= grid.period) tt = best;
    if (tt < tIn + 1 || tt > tOut - 0.5) continue;
    if (out.length && tt - out[out.length - 1] < MC.director.IMPACT_GAP) continue;
    out.push(tt);
  }
  return out;
};

/* 出番を控えるカメラか(2026-08-04 優さん指示)。
   ・人が「少なめ」と指定した素材(自動判定より人の指定が上)
   ・解析で「その場で動いているだけ」と推定された定点(DM・フロントピット等)
   ・解析で「ほとんど何も動かない」と推定された定点 */
MC.director._quietCam = c => {
  if (!c) return false;
  if (c.freq === "less") return true;
  const V = c.visual;
  return !!(V && (V.staticScene || V.staticSubject));
};

/* ---------- 楽章・セクションの切れ目 ---------- */
/* ★ 2026-08-04 DCIディレクターの回答C「楽章が変わる瞬間は、必ず一度引きで
   リセットする」。ショウは1曲ではなく複数の楽章で、切れ目で場面が変わる ─
   そこを寄りのまま通過すると、見ている人は「まだ同じ場面」だと思い続ける。
   手がかりは2つとも音だけから取れる:
     ① 静けさの谷 … 音が BREAK_LOW 未満へ落ちて BREAK_MIN_SEC 以上続き、
                     そのあと BREAK_HIGH を超えて戻る(楽章の間)
     ② テンポの変化 … 隣り合う局所BPMが BREAK_BPM_RATIO 以上変わる
   衝撃(_impacts)と違い、こちらは**曲の構造**を見ている。 */
MC.director._breaks = (audioClip, grid, tIn, tOut) => {
  const S = audioClip.sections;
  if (!S || !S.rms || !S.t || !S.t.length) return [];
  const lo = S.rmsLo, hi = S.rmsHi;
  if (!(hi > lo)) return [];
  const dyn = i => Math.max(0, Math.min(1, (S.rms[i] - lo) / (hi - lo)));
  const raw = [];
  // ① 静けさの谷から戻ってきた瞬間
  let lowFrom = -1;
  for (let i = 0; i < S.t.length; i++) {
    const v = dyn(i);
    if (v < MC.director.BREAK_LOW) { if (lowFrom < 0) lowFrom = i; continue; }
    if (lowFrom >= 0) {
      const len = (i - lowFrom) * (S.hop || 0.5);
      if (len >= MC.director.BREAK_MIN_SEC && v >= MC.director.BREAK_HIGH) {
        raw.push(S.t[i] + audioClip.offset);
      }
      lowFrom = -1;
    }
  }
  // ② 局所テンポが変わった瞬間
  if (S.bpmT && S.bpmV) {
    for (let k = 1; k < S.bpmV.length; k++) {
      const a = S.bpmV[k - 1], b = S.bpmV[k];
      if (a > 0 && Math.abs(b - a) / a >= MC.director.BREAK_BPM_RATIO) {
        raw.push(S.bpmT[k] + audioClip.offset);
      }
    }
  }
  // 小節頭へ寄せ、近すぎるものはまとめる
  const out = [];
  for (const t0 of raw.sort((x, y) => x - y)) {
    let tt = t0, bd = Infinity, best = null;
    for (const b of grid.bars) { const d = Math.abs(b - t0); if (d < bd) { bd = d; best = b; } }
    if (best != null && bd <= grid.period * 2) tt = best;
    if (tt < tIn + 1 || tt > tOut - 1) continue;
    if (out.length && tt - out[out.length - 1] < MC.director.BREAK_GAP) continue;
    out.push(tt);
  }
  return out;
};

/* ---------- 音の判定が実素材で何区間立つか ---------- */
/* しきい値は director が実際に使っている値。ここで別の値を書くと、
   ログが「実際に効いている判定」ではなく別のものを報告することになる。
   percussion だけは閾値を持たない重み(wGroup)なので、報告用の 0.40 を置く。
   数え方: 解析の窓(S.hop)ごとに1区間。カットの採否は見ない。 */
/* ★ しきい値は「読むたびに」引く ─ 定数を配列へ写し取ると、
   TUTTI_WIDE を変えたときログだけが古い値を報告する(嘘をつく) */
MC.director.TALLY = [
  { key: "pit", th: () => 0.45, hit: (v, th) => v > th, note: "+1.2" },
  { key: "full", th: () => MC.director.TUTTI_WIDE, hit: (v, th) => v >= th, note: "引き限定" },
  { key: "feature", th: () => 0.45, hit: (v, th) => v > th, note: "寄り" },
  { key: "percussion", th: () => 0.40, hit: (v, th) => v > th, note: "報告のみ" },
];
MC.director._clsTally = (audioClip, tIn, tOut) => {
  const S = audioClip && audioClip.sections;
  if (!S || !S.hop || !(tOut > tIn)) return "測れず(解析なし)";
  const hop = S.hop;
  const T = MC.director.TALLY;
  const th = T.map(d => d.th());
  const hit = T.map(() => 0);
  let n = 0;
  for (let t = tIn; t < tOut; t += hop) {
    const cls = MC.sections.classify(audioClip, t, Math.min(tOut, t + hop));
    if (!cls) continue;
    n++;
    for (let i = 0; i < T.length; i++) if (T[i].hit(cls[T[i].key], th[i])) hit[i]++;
  }
  if (!n) return "測れず(区間なし)";
  return T.map((d, i) => `${d.key}≧${th[i]}=${hit[i]}/${n}`
    + `(${Math.round(hit[i] / n * 100)}%・${d.note})`).join(" ");
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
    /* 引きの重みも「全奏らしさ」で見る(2026-08-04)。音圧だけだと
       フォルテのソロで引きへ引っぱられる。cls.full が無い呼び出し
       (試験のスタブ等)は従来どおり tutti へ落ちる */
    wWide = 0.25 + 0.45 * (cls.full != null ? cls.full : cls.tutti);
    // 聴かせどころでは引きに逃げない(引きの織り込み圧力もここでは弱める)
    if (cls.feature > 0.45) wWide *= 0.5;
  } else {
    wClose = 0.35; wGroup = 0.3; wWide = 0.35;
  }
  // 引き画の織り込み圧力(interleaveショットごとに1回は引きへ)
  const pw = ctx.segsSinceWide / ctx.interleave;
  wWide += pw >= 1 ? 1.0 : 0.5 * pw;
  /* ★ 山へ向かって寄りで煽る(2026-08-04 DCI規則3)。クレッシェンドの最中は
     引きへの圧力を弱めて寄りを立てる。山そのもの(全奏)に着いたら
     既存のハード規則(引き限定)が受ける ─ 「緊張は寄り、解決は引き」 */
  if (ctx.dynRising) { wClose += 0.35; wWide *= 0.7; }
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
    let roamBad = false;
    let dqWhy = MC.visual.dqReason(m, c.role);
    /* プレイヤー視点は「人が写っていない」を失格にしない(2026-08-05) ─
       自分の視点なので人が写らないのが普通。ブレ・パンの失格はそのまま */
    if (dqWhy === "人が写っていない" && ctx.povIds && ctx.povIds.has(c.id)) dqWhy = null;
    const dq = dqWhy != null;
    if (dq) score -= 1000;      // 絶対条件: 採用不可(全滅時の比較用に相対値は残す)
    score += wClose * sh.close + wGroup * sh.group + wWide * sh.wide;
    // フラッグ等の同期した大きな動きは「引きで見せる」を後押し
    score += sh.ensemble * 0.3 * sh.wide;
    // ピット区間はピットタグのカメラを意図的に採用。それ以外の区間では専用機を少し引っ込める
    if (c.role === "pit") score += pitSeg ? 1.2 : -0.35;
    // 素材ごとの出番の希望(少なめ/おまかせ/多め)
    score += MC.director.FREQ_BIAS[c.freq] || 0;

    /* ===== カメラの属性2軸の規則(2026-08-05 優さん指示で改訂) ===== */
    /* 正面全体は「背骨・多めに使います」(UIの約束)。控えめな加点で常に一歩前へ
       (2026-08-05 レビューP2: frontIds が定義だけで未参照=約束が未実装だった) */
    if (ctx.frontIds && ctx.frontIds.has(c.id)) score += 0.1;
    if (ctx.altWideIds && ctx.altWideIds.has(c.id)) {
      /* 他の場所からの全体: 引きのローテーションに普通に参加(10のうち2〜4が目安)。
         合計が全尺の4割を超えたら強く引っ込める。
         動きあり×ブレ多の素材は roam の厳選門が別に掛かる */
      if (ctx.altWideCapHit) score -= MC.director.ALT_WIDE_PENALTY;
    }
    if (ctx.spiceIds && ctx.spiceIds.has(c.id)) {
      /* スパイスは鳴っている時だけ:
         ピット規則 = ピット音×静かめ(バラードで効く。全奏は引き限定が締め出す)
         メジャー規則 = サリュートや楽章の切れ目の近く(指揮の見せ場)
         さらに 全尺10%上限・スパイス→別スパイスの連続禁止 */
      /* 実機「頻度が多すぎる」(2026-08-05)を受けて静かめの条件を締めた
         (quiet 0.3→0.35 / dyn 0.5→0.45) */
      const pitOk = pitSeg && cls && (cls.quiet > 0.35 || cls.dyn < 0.45);
      const ok = (pitOk || ctx.spiceWindow) && !ctx.spiceCapHit
        && !(ctx.prevWasSpice && c.id !== ctx.prevId);
      /* ★ 上限到達後は罰を倍にする ─ ピットの見せ場が続く曲では
         +1.2(pit加点)が単発の罰を食い破り、10%を大きく超えて出続けた
         (QA変異で実測14秒/上限6秒)。見せ場の途中でも上限は上限 */
      /* 上限到達後は4倍(=どの加点でも食い破れない)。2倍では pit の +1.2 と
         引き・寄りの加点が重なると再び顔を出した(2026-08-05 優さん実機) */
      if (!ok) score -= MC.director.SPICE_PENALTY * (ctx.spiceCapHit ? 4 : 1);
    }
    if (ctx.roamIds && ctx.roamIds.has(c.id)) {
      /* 歩き撮り: いまの窓の実測が良い(据わっていて・ブレが小さく・普段より
         シャープ)ときだけ、使いどころ(楽章の頭・盛り上がりの助走)で浮かせる。
         クールダウンで乱発を防ぐ。衝撃の前後は座り(forceWide=引き限定)が
         そもそも締め出す ─ 「飛び道具を衝撃前に置くな」はそこで担保される */
      const shakeHere = m && (m.shakeCamP75 != null ? m.shakeCamP75 : m.shakeP75);
      const good = m && !dq && m.settled !== false
        && shakeHere <= MC.visual.TH_SHAKE * 0.6
        && (!m.sharpMed || m.sharpMean >= m.sharpMed * 0.9);
      const wanted = ctx.roamMoment && g0 >= (ctx.roamReadyAt || 0);
      const isAction = ctx.actionIds && ctx.actionIds.has(c.id);
      roamBad = !good;   // ソロのハード選抜からも外す材料(下の ranked.push が持つ)
      if (!good) score -= MC.director.ROAM_PENALTY;
      else if (isAction && ctx.actionCapHit) score -= MC.director.ROAM_PENALTY;  // 15%で打ち止め
      /* アクション枠は良い窓なら中立で採点勝負(5〜15%へ寄せる。2026-08-05)。
         選択ミス保険で門に入った素材は従来どおり控えめ */
      else score += wanted ? MC.director.ROAM_BONUS : (isAction ? 0 : -MC.director.ROAM_BONUS);
    }
    /* 遮蔽疑い(観客席の引きにありがちな前の人の頭・手すり):
       顔ゼロ+動きが無い+普段より甘い引きは、少しだけ引っ込める(失格にはしない) */
    if (m && c.role === "wide" && m.nF === 0 && m.act < 0.15
        && m.sharpMed > 0 && m.sharpMean < m.sharpMed * 0.8) score -= 0.15;
    /* ★ カメラの性格で出番を重み付け(2026-08-03 優さん指示②)。
       クリップ全体の性格(visual._finalize が推定)を読むだけ ─
       俯瞰固定=控えめに加点 / 人が動かない定点=減点(ゼロにはしない。
       登場間隔ボーナスと飢餓ガードが最低保証) */
    const Vc = c.visual;
    if (Vc) {
      if (Vc.overheadFixed) score += MC.director.OVERHEAD_BONUS;
      /* 「ほとんど動かない」か「その場で動いているだけ」なら減点(2026-08-04)。
         二重には引かない */
      if (Vc.staticScene || Vc.staticSubject) score += MC.director.STATIC_BIAS;
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
    /* ★ 直前の画と似すぎているカメラへは切らない(2026-08-04)。
       画角(寄り/引き)と写っている人数がほぼ同じなら、切り替えたことが
       伝わらない。ctx.prevShot は generate() が採用した1台ぶんだけ持つ */
    const nF = m && m.nF > 0 ? m.nF : 0;
    if (ctx.prevShot && c.id !== ctx.prevId) {
      const d = Math.abs(sh.close - ctx.prevShot.close)
        + Math.abs(sh.wide - ctx.prevShot.wide)
        + Math.min(1, Math.abs(nF - ctx.prevShot.nF) / 4);
      if (d < MC.director.JUMP_NEAR) {
        score -= MC.director.JUMP_PENALTY * (MC.director.JUMP_NEAR - d) / MC.director.JUMP_NEAR;
      }
    }
    ranked.push({ id: c.id, score, wideChosen: sh.wide >= 0.5, dq, dqWhy: dqWhy,
                  roamBad, close: sh.close, wide: sh.wide, nF });
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
  /* ★ ctx.forceWide は織り込み間隔より強く、ソロの例外も貫く(2026-08-04)。
     全奏(tutti≥TUTTI_WIDE)・衝撃の2拍前・サリュート直後の1カット目は、
     「いま抜いている奏者」より隊列を見せることが上位だとディレクターが言う
     場面。generate() が区間ごとに理由の文字列を入れる(null なら従来どおり) */
  const hardWide = !opening &&
    (!!ctx.forceWide || (!featuring && ctx.segsSinceWide >= ctx.interleave));
  if (hardWide) {
    /* ★ スパイス(ピット定点)を引きの受け皿にしない(2026-08-05 優さん実機
       「ピットにしたのに出まくってる」)。前列の定点は全体が写って
       wideChosen になりがちで、全奏・織り込みの引き限定のたびに
       ピットが選ばれ、8%上限を素通りしていた ─ 引きの席は全体(front/altwide)へ。
       スパイスしか引きが無いときだけ従来どおり(黒画面よりまし) */
    const wides = ranked.filter(r => r.wideChosen && !r.dq
      && !(MC.director.HARD_WIDE_NO_SPICE && ctx.spiceIds && ctx.spiceIds.has(r.id)));
    if (wides.length) return wides;
    /* スパイスしか引きが無い構成でも、上限到達後は引き強制を諦めて通常順位へ
       (2026-08-05 レビューP1: ここで返し続けると8%素通りが同じ形で再発する。
       下の return ranked に落ちても黒画面にはならない ─ 罰4倍の通常採点になるだけ) */
    const anyWide = ranked.filter(r => r.wideChosen && !r.dq);
    if (anyWide.length && !ctx.spiceCapHit) return anyWide;
  }
  /* ★ ソロは操作カメラで抜く(2026-08-05 優さん指示「ソロを抜いていたら必ず使う」)。
     feature が立っている区間では、「カメラマン操作」のカメラが失格でなければ
     必ずそこから選ぶ。ブレて失格なら普通の順位へ落ちる(「ブレが多いところは
     使わない」)。全奏・衝撃前の引き限定(forceWide)はこれより上位 */
  if (MC.director.SOLO_OPERATOR && featuring && !ctx.forceWide
      && ctx.operatorIds && ctx.operatorIds.size) {
    /* ★ 厳選門で「悪い窓」と判定された operator(action/ブレ多の自動降格)は
       強制しない(2026-08-05 レビューP1)。「ブレが多いところは使わない」が
       ハード選抜より上 ─ 良い窓の operator が居なければ通常の順位へ落ちる。
       ★ ops だけを返すと飢餓ガード・連続上限(sameSec)の切替先まで消え、
         feature が高止まりする実素材で1台張り付きが再発する(レビューP1)。
         全候補を full に添えて返し、探索はそちらを見る */
    const ops = ranked.filter(r => ctx.operatorIds.has(r.id) && !r.dq && !r.roamBad);
    if (ops.length) { ops.full = ranked; return ops; }
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
    forceWide: null,    // この区間を引きに限定する理由(2026-08-04)。null=従来どおり
    starveDefer: 0,     // ソロ中に飢餓ガードを見送った連続ショット数
    saluteDone: false,  // サリュート直後の1カット目を出したか
    prevShot: null,     // 直前に採用した画の形{close,wide,nF}(ジャンプカット防止)
  };
  /* ===== カメラの属性2軸(2026-08-05 優さん指示)を一度だけ仕分ける =====
     旧データ(kind 5択や role のみ)は migrateAxes が2軸へ写す。
     ★ 厳選門(旧・歩き撮り)への自動振り分け: 「動きあり」(明示 or 実測)で、
       クリップ全体のブレ中央値が失格しきい値を超える素材は、半分以上が
       使えない ─ 良い窓だけの飛び道具として扱う(全体・スパイス指定は除く) */
  const vidsAll = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  vidsAll.forEach(c => MC.migrateAxes(c));
  const targetOf = c => c.target || "auto";
  ctx.frontIds = new Set(vidsAll.filter(c => targetOf(c) === "front").map(c => c.id));
  ctx.altWideIds = new Set(vidsAll.filter(c => targetOf(c) === "altwide").map(c => c.id));
  ctx.wideIds = new Set([...ctx.frontIds, ...ctx.altWideIds]);
  ctx.spiceIds = new Set(vidsAll.filter(c => targetOf(c) === "spice").map(c => c.id));
  ctx.operatorIds = new Set(vidsAll.filter(c => targetOf(c) === "operator").map(c => c.id));
  /* プレイヤー視点(奏者装着POV)は常に厳選門(2026-08-05 優さん追加指示)。
     隊形は見えず臨場感が売り ─ 良い窓だけを見せ場に短く差し込む */
  ctx.povIds = new Set(vidsAll.filter(c => targetOf(c) === "pov").map(c => c.id));
  ctx.roamIds = new Set(vidsAll.filter(c => {
    const t = targetOf(c);
    /* ★除外を先に見る(2026-08-05 レビューP2)。spice×action が両方の門に入ると
       条件外の減点(-1.5と-3.0)が重複して実質出番ゼロになる ─
       全体・スパイス指定はそれぞれの規則だけに従わせる */
    if (t === "front" || t === "altwide" || t === "spice") return false;
    if (t === "pov") return true;                       // POVは無条件で厳選門
    if (c.motion === "action") return true;             // アクションカメラも同様
    const moving = c.motion === "moving" || c.rig === "operated" || (c.visual && c.visual.operated);
    return moving && c.visual && c.visual.shakeMed > MC.visual.TH_SHAKE;
  }).map(c => c.id));
  ctx.spiceSec = 0; ctx.spiceCapHit = false; ctx.prevWasSpice = false;
  ctx.altWideSec = 0; ctx.altWideCapHit = false;
  /* アクション枠 = 装着カメラ(motion=action)+プレイヤー視点 */
  ctx.actionIds = new Set(vidsAll.filter(c => c.motion === "action" || targetOf(c) === "pov").map(c => c.id));
  ctx.actionSec = 0; ctx.actionCapHit = false;
  ctx.roamReadyAt = 0; ctx.roamMoment = false; ctx.spiceWindow = false; ctx.dynRising = false;
  /* ★ 衝撃の先読み(P1)。カット割の前に一度だけ拾う */
  const impacts = MC.director._impacts(audioClip, grid, tIn, tOut);
  /* ★ 楽章・セクションの切れ目(2026-08-04 回答C)。ここでも一度だけ拾う */
  const breaks = MC.director._breaks(audioClip, grid, tIn, tOut);
  const period = grid.period || 0.5;
  const musicStart = MC.director._salute ? MC.director._salute.musicStart : null;
  const cuts = [];
  /* 失格で見送った区間の集計。実素材でしきい値を詰めるための根拠を残す */
  const dqTally = { total: 0, by: {} };
  let forcedN = 0;   // 連続上限による強制切替の回数(実素材で偏りを読む根拠)
  let deferN = 0;    // ソロ・ソリのため飢餓ガードを繰り延べた回数
  let wideN = 0;     // 引きに限定した回数(理由の内訳つき)
  const wideWhy = {};
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

    /* ★★ ここから: 引きに座るべき区間かを、カメラを選ぶ**前に**決める(2026-08-04)。
       ショット長も引き/寄りで変える(P2改)ので、順番が
       「種を決める → 長さを決める → カメラを選ぶ」になる。
       材料は probe(この時点で分かる音の性格)と ctx だけ ─
       カメラの採点結果を使うと鶏と卵になる */
    const isOpening = musicStart != null && t < musicStart - 0.5;
    const probeFeat = !!(probe && probe.feature > 0.45);

    /* ★ 種類規則の区間材料(2026-08-04 DCI協議)。
       dynRising: 直前4秒より音圧がはっきり上がっている=クレッシェンドの最中
       spiceWindow: サリュートや楽章の切れ目の近く=指揮の見せ場
       roamMoment: 楽章の頭・盛り上がりの助走=歩き撮りの使いどころ */
    const before4 = t - 4 > tIn ? MC.sections.classify(audioClip, t - 4, t) : null;
    ctx.dynRising = !!(probe && before4 && !probeFeat && (probe.dyn - before4.dyn) > 0.12);
    /* 窓も締めた(サリュート±5→±4秒 / 切れ目±2.5→±2秒。2026-08-05 実機) */
    ctx.spiceWindow = (musicStart != null && Math.abs(t - musicStart) < 4)
      || breaks.some(b => Math.abs(b - t) < 2);
    ctx.roamMoment = ctx.dynRising || breaks.some(b => b > t - 0.5 && b < t + 2);

    /* ① 衝撃の2拍前に座る(P1)。次の衝撃と、その2拍前=座る時刻を出す */
    let impAt = null, seatAt = null, seatWide = false;
    if (impacts.length) {
      for (const x of impacts) { if (x > t + 0.05) { impAt = x; break; } }
      if (impAt != null) seatAt = impAt - MC.director.SEAT_BEATS * period;
    }
    /* 座る時刻が「もう来ている」or「近すぎて切り分けられない」なら、この区間が
       座る回。2拍前より早く座るのは構わない(遅れるのだけが失敗) */
    if (seatAt != null && !isOpening && seatAt <= t + L.min) seatWide = true;

    /* ② サリュート直後の1カット目は全景でセットを見せる(P2) */
    const saluteWide = musicStart != null && !ctx.saluteDone && !isOpening
      && t >= musicStart - 0.25;

    /* ③ カンパニーフロント(全奏)は絶対に引き(P1) */
    /* ★ full が無いときは tutti へ落ちる(2026-08-04)。
       audioClip.sections はキャッシュされるので、full を持たない古い解析結果が
       復元セッションから戻ってくる。undefined >= 0.7 は常に false になり、
       「全奏は絶対に引き」が黙って効かなくなる ─ 静かに壊れる型なので必ず落とす */
    const fullNow = probe ? (probe.full != null ? probe.full : probe.tutti) : null;
    const tuttiWide = !!(fullNow != null && fullNow >= MC.director.TUTTI_WIDE);

    /* ④ 楽章・セクションの切れ目は、一度引きでリセットする(回答C)。
       この区間が切れ目そのものから始まるときだけ */
    const breakWide = !isOpening && breaks.some(b => Math.abs(b - t) < 0.3);

    ctx.forceWide = isOpening ? null
      : seatWide ? "衝撃の2拍前"
      : saluteWide ? "サリュート直後"
      : breakWide ? "楽章の切れ目"
      : tuttiWide ? "全奏" : null;

    /* ④ ショット種 → 長さの目標レンジ(P2改)。
       引きに限定される回に加え、織り込み間隔で引きへ回る回も「引きの長さ」 */
    /* ★ クレッシェンドの最中は引きの織り込みを止める(DCI規則3の片翼)。
       助走を引きで邪魔しない ─ 山に着けば forceWide(全奏)が引きで受ける */
    const wideTurn = !!ctx.forceWide
      || (!isOpening && !probeFeat && !ctx.dynRising && ctx.segsSinceWide >= ctx.interleave);
    /* カンパニーフロント(全奏)で座る引きだけ front(おすすめ6〜8秒)。
       楽章の切れ目・サリュート・織り込みの引きは wide(4〜6秒)のまま
       (2026-08-04 優さん決定①) */
    const R = wideTurn ? ((ctx.forceWide === "全奏" && L.front) ? L.front : (L.wide || L))
      : (probeFeat && L.close) ? L.close : L;
    /* ★ 引きの回は「大きい音ほど短く」を弱める(2026-08-04 実測)。
       mod は音圧が高いほど小さくなるが、引きに座る理由そのものが
       「音圧が高い(全奏・衝撃)」なので、素の mod を掛けると
       目標がいつも下限(おすすめなら4.0秒)へ張り付き、
       「引きは読ませる」というP2改の狙いが消える。
       効きを4割に薄めて、4〜6秒の中で音楽に応じて揺れるようにする */
    const modR = wideTurn ? 1 + (mod - 1) * 0.4 : mod;
    /* ★ 静けさでは切らない(2026-08-04 DCI規則4)。バラードで忙しく切るのは
       素人編集の最大の特徴 ─ 静けさはショットの長さで表現する。
       静かで音圧が低い区間はレンジを2倍(ただし12秒で頭打ち=静止画防止)。
       ソロ中は伸ばさない(既にソロの規則が粘りを持っている) */
    const calmK = (probe && probe.quiet > 0.5 && probe.dyn < 0.35 && !probeFeat) ? 2 : 1;
    const maxHere = Math.min(12, R.max * calmK);
    const target = Math.max(R.min, Math.min(maxHere, R.base * modR * calmK));
    let tNext = MC.director._snap(grid, t + target, t + R.min);
    tNext = Math.min(tNext, tOut);
    if (tNext <= t + 0.5) tNext = Math.min(tOut, t + R.min);
    /* ★ ソフト上限(2026-08-03 優さん①+補足)。小節スナップの都合で max を
       多少(+1秒まで)超えるのは許す ─ 音楽的な区切りを優先する。
       それすら無い(小節が遠い)ときだけ、区切りより長さを採って max で切る */
    if (tNext - t > maxHere + 1.0) tNext = Math.min(tOut, t + maxHere);

    /* ⑤-0 演奏開始そのものにカットを置く(P2)。
       これが無いと、直前のショットが演奏開始を跨いで伸び、全景が1秒遅れて
       入る(実測: musicStart=10.0 に対し 11.0)。サリュートは「開始の瞬間に
       セットを見せる」のが値打ちなので、開始点はカット点として最優先で拾う */
    let landOn = (musicStart != null && !ctx.saluteDone
      && musicStart > t + R.min && musicStart <= t + R.max + 1.0) ? musicStart : null;
    /* 楽章の切れ目にもカット点を置く(回答C)。置かないと直前のショットが
       切れ目を跨いで伸び、リセットの引きが遅れて入る */
    if (landOn == null) {
      for (const b of breaks) {
        if (b > t + R.min && b <= t + R.max + 1.0) { landOn = b; break; }
      }
    }

    /* ⑤ 衝撃に間に合わせる(P1)。
       ・まだ座る時刻が先 → **そこでちょうど切る**(次の区間が引きで座る回になる)
       ・もう座っている   → 衝撃を1拍ぶん見せ切るまで引っぱる */
    if (landOn != null) {
      tNext = Math.min(tOut, MC.director._snapBeat(grid, landOn, t + R.min));
    } else if (!seatWide && seatAt != null && seatAt > t + R.min && seatAt <= t + R.max + 1.0) {
      tNext = Math.min(tOut, MC.director._snapBeat(grid, seatAt, t + R.min));
    } else if (seatWide && impAt != null) {
      /* ★ 衝撃の直後に切ると余韻が死ぬ(2026-08-04 DCI規則2)。
         座った引きはヒットを受けて+2秒(最低でも2拍)は保持する。旧値は1拍 */
      const need = impAt + Math.max(2.0, period * 2);
      if (tNext < need) {
        tNext = Math.min(tOut, MC.director._snapBeat(grid, need, t + R.min));
        if (tNext - t > R.max + 1.5) tNext = Math.min(tOut, t + R.max + 1.5);
      }
    }
    if (tNext <= t + 0.5) tNext = Math.min(tOut, t + R.min);

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
        /* ★ 延長ぶんも配分の記帳に載せる(2026-08-05 レビューP2)。
           載せないと、ブレの多い素材でスパイス等の実オンエアが上限を超える */
        if (ctx.spiceIds && ctx.spiceIds.has(ctx.prevId)) {
          ctx.spiceSec += (tNext - t);
          if (ctx.spiceSec > (tOut - tIn) * MC.director.SPICE_CAP_RATIO) ctx.spiceCapHit = true;
        }
        if (ctx.altWideIds && ctx.altWideIds.has(ctx.prevId)) {
          ctx.altWideSec += (tNext - t);
          if (ctx.altWideSec > (tOut - tIn) * MC.director.ALT_WIDE_CAP) ctx.altWideCapHit = true;
        }
        if (ctx.actionIds && ctx.actionIds.has(ctx.prevId)) {
          ctx.actionSec += (tNext - t);
          if (ctx.actionSec > (tOut - tIn) * MC.director.ACTION_CAP_RATIO) ctx.actionCapHit = true;
        }
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
      /* ★ 出番を控えるカメラは飢餓の間隔を伸ばす(2026-08-04 優さん指示)。
         減点だけでは飢餓ガードが素通しするので、回数が減らなかった */
      const starveOf = id => MC.director._quietCam(MC.getClip(id))
        ? MC.director.STARVE * MC.director.QUIET_STARVE_MULT : MC.director.STARVE;
      /* ★ 厳選門の素材(動きあり×ブレ多)とスパイスは出番保証の対象外
         (2026-08-04 DCI規則5)。義務で悪い画・場違いな画を出すと1カットで
         全体の信頼が壊れる ─ 使いどころが来れば採点で自然に出る。
         出なかった理由は完了時に一覧で言う。
         他の場所からの全体は通常のローテーションに参加するので対象のまま */
      const rankedAll = ranked.full || ranked;   // ソロ選抜中も全候補を見る(2026-08-05)
      const starving = rankedAll.find(r => !r.dq && r.id !== top.id
        && !(ctx.roamIds && ctx.roamIds.has(r.id))
        && !(ctx.spiceIds && ctx.spiceIds.has(r.id))
        && Math.min(ctx.sinceUse.get(r.id) || 0, cuts.length) >= starveOf(r.id));
      /* ★ ソロ・ソリの最中は繰り延べる(2026-08-04 P3改)。
         抜いている奏者の画を、出番の都合だけで途中で断ち切らない。
         ただし待てるのは STARVE_DEFER ショットまで ─ feature が曲じゅう
         高止まりする実素材があり(2026-08-02 実機)、無条件に見送ると
         「N本入れてN-1台」の不具合がそのまま戻る */
      const featNow = cls && cls.feature > 0.45;
      if (!featNow) ctx.starveDefer = 0;
      if (starving) {
        if (featNow && ctx.starveDefer < MC.director.STARVE_DEFER) {
          ctx.starveDefer++;
          deferN++;
          MC.log(`director: ${t.toFixed(1)}s〜 ソロ・ソリのため出番の割り込みを繰り延べ`
            + `(${ctx.starveDefer}/${MC.director.STARVE_DEFER})`);
        } else {
          ctx.starveDefer = 0;
          forcedN++;
          MC.log(`director: ${t.toFixed(1)}s〜 ${ctx.sinceUse.get(starving.id)}ショット出ていないカメラを出す`);
          top = starving;
        }
      }
      /* ② 連続上限: **時間が主・回数は従**(2026-08-03 優さん指示①)。
         同じカメラの連続オンエアが L.sameSec を超える見込みなら別カメラへ。
         おすすめ(sameSec=5)では典型ショット(約3秒)の2本目で超えるため、
         実質「同じカメラは1ショット強まで」= 4秒目安のソフト上限が効く
         (最短2秒×2本=4秒だけは収まる。LEVELS の注記参照)。
         MAX_RUN(回数)は時間が測れない異常系の保険として残す */
      /* ★ ソロ・ソリの最中だけ同一カメラを長く許す(2026-08-04 優さん決定②)。
         「4秒以上は同じのにしない」(2026-08-03)の明示的な例外 ─ 抜いている
         奏者の画を時間の都合で断ち切らない。おすすめ5秒→8秒
         (レベル内でスケール: 多め6.4秒・少なめは元々8秒)。
         回数の保険(MAX_RUN)は触らない ─ 時間が主・回数は異常系の従のまま */
      const sameBase = L.sameSec || Infinity;
      /* ★ 有限のときだけ緩める ─ Infinity(門を外した状態=QAの変異)に 1.6 を
         掛けても Infinity で、min(8, Infinity)=8 が新しい門になってしまう。
         門を外したら外れたままであるべき(2026-08-04、modeCapped の教訓と同型) */
      const sameCap = featNow && Number.isFinite(sameBase)
        ? Math.min(8.0, sameBase * 1.6)
        : sameBase;
      if (top.id === ctx.prevId
          && (ctx.runSec + (tNext - t) > sameCap
              || ctx.runLen >= MC.director.MAX_RUN)) {
        /* 強制切替の逃げ先にもスパイス・厳選門は選ばない(場違いな1枚を挟まない)。
           他に誰も居なければ従来どおり */
        const altPool = ranked.full || ranked;
        const alt = altPool.find(r => r.id !== ctx.prevId && !r.dq
            && !(ctx.spiceIds && ctx.spiceIds.has(r.id))
            && !(ctx.roamIds && ctx.roamIds.has(r.id)))
          || altPool.find(r => r.id !== ctx.prevId && !r.dq);
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
        /* ★ 1.0〜2.0秒(2026-08-04 P3改)。旧値0.5〜0.9秒では
           「ゆったり見せる」意図に対して速すぎた。
           ただしショット長の6割を超えない(短い1枚を丸ごと混色にしない) */
        const len = tNext - t;
        dur = Math.max(MC.director.DISSOLVE_MIN,
                       Math.min(MC.director.DISSOLVE_MAX, len / 3));
        dur = Math.min(dur, len * 0.6);
      }
    }
    if (ctx.forceWide) { wideN++; wideWhy[ctx.forceWide] = (wideWhy[ctx.forceWide] || 0) + 1; }
    if (saluteWide) ctx.saluteDone = true;
    cuts.push({ t, clipId: top.id, trans, dur });

    /* ★ 属性規則の記帳(2026-08-05 改訂)。
       スパイス: 使った秒数を数え、全尺10%で打ち止め。直後は引きで受ける
       (segsSinceWide を満了させ、次の区間を引きの織り込みにする)。
       他の場所からの全体: 使った秒数を数え、全尺40%で打ち止め。
       厳選門(動きあり×ブレ多): 使ったらクールダウン(乱発防止) */
    ctx.prevWasSpice = !!(ctx.spiceIds && ctx.spiceIds.has(top.id));
    if (ctx.prevWasSpice) {
      ctx.spiceSec += (tNext - t);
      if (ctx.spiceSec > (tOut - tIn) * MC.director.SPICE_CAP_RATIO) ctx.spiceCapHit = true;
      ctx.segsSinceWide = ctx.interleave;
    }
    if (ctx.altWideIds && ctx.altWideIds.has(top.id)) {
      ctx.altWideSec += (tNext - t);
      if (ctx.altWideSec > (tOut - tIn) * MC.director.ALT_WIDE_CAP) ctx.altWideCapHit = true;
    }
    if (ctx.roamIds && ctx.roamIds.has(top.id)) {
      ctx.roamReadyAt = tNext + MC.director.ROAM_COOLDOWN;
    }
    if (ctx.actionIds && ctx.actionIds.has(top.id)) {
      ctx.actionSec += (tNext - t);
      if (ctx.actionSec > (tOut - tIn) * MC.director.ACTION_CAP_RATIO) ctx.actionCapHit = true;
    }
    // 文脈更新
    ctx.runSec = top.id === ctx.prevId ? ctx.runSec + (tNext - t) : (tNext - t);
    ctx.runLen = top.id === ctx.prevId ? ctx.runLen + 1 : 1;
    for (const [id, v] of ctx.sinceUse) ctx.sinceUse.set(id, v + 1);
    ctx.sinceUse.set(top.id, 0);
    ctx.prev2Id = ctx.prevId;
    ctx.prevId = top.id;
    /* ジャンプカット防止のため、採用した画の形を覚える(2026-08-04) */
    ctx.prevShot = (top.close != null)
      ? { close: top.close, wide: top.wide, nF: top.nF || 0 } : null;
    ctx.segsSinceWide = top.wideChosen ? 0 : ctx.segsSinceWide + 1;
    t = tNext;
  }
  if (!cuts.length) throw new Error("カットを作れませんでした(範囲を確認してください)");
  // 末尾の短すぎるセグメントは1つ前と統合
  if (cuts.length > 1 && tOut - cuts[cuts.length - 1].t < 1.5) cuts.pop();
  MC.S.cutList = cuts;
  /* ★ 出なかったカメラの理由(2026-08-04 DCI規則5)。出番の義務をやめた
     代わりに、出せなかった理由をここで言う(撮影者の心情ケアは本編でなく一覧で)。
     UI(renderCutSummary 系)が完了時に表示する */
  {
    const usedIds = new Set(cuts.map(x => x.clipId));
    MC.S.unusedCams = vidsAll.filter(c => !usedIds.has(c.id)).map(c => ({
      id: c.id, name: c.name,
      why: ctx.povIds && ctx.povIds.has(c.id) ? "差し込みに向く落ち着いた場面が見つからなかったため"
        : ctx.roamIds.has(c.id) ? "ブレの少ない良い場面が見つからなかったため"
        : ctx.spiceIds.has(c.id) ? "ピットや指揮の見せ場に良い区間が無かったため"
        : "他のカメラの画が優先されたため",
    }));
    if (MC.S.unusedCams.length) {
      MC.log("director: 未使用カメラ "
        + MC.S.unusedCams.map(u => `${u.name}(${u.why})`).join(" / "));
    }
  }
  MC.saveState();
  const nDissolve = cuts.filter(c => c.trans === "dissolve").length;
  /* ★ 実素材でしきい値を詰めるための根拠を残す(2026-08-04)。
     「どのカメラを控えめにしたか」と、その判断のもとになった hotCells */
  const quiet = MC.S.clips.filter(c => !c.isAudio && !c.isImage && MC.director._quietCam(c))
    .map(c => `${MC.shortName ? MC.shortName(c.name) : c.name}`
      + `(${c.freq === "less" ? "指定" : "推定"}`
      + `${c.visual && c.visual.hotCells != null ? `・動くセル${c.visual.hotCells}/24` : ""})`);
  if (quiet.length) MC.log(`director: 出番を控えるカメラ ${quiet.join(" / ")}`);
  /* ★ 音の判定が実素材で何区間立つかを出す(2026-08-04 三者レビュー)。
     いちばん強い加点(pit の +1.2)が、いちばん検証されていない ─
     sections.js 自身が「発火しすぎの可能性がある側」と書いたまま
     合成素材でしか確かめられていない(101分割中24区間)。
     ★ カットの結果ではなく音の判定そのものを数える。
       採用されたカットだけを見ると、飢餓ガードや引き限定に消された
       ぶんが見えず「判定が出ていない」と読み違える。
     しきい値は director が実際に使っている値と同じものを使う
     (percussion だけは閾値を持たない重みなので、報告用に0.40を置く) */
  MC.log(`director: 音の判定 ${MC.director._clsTally(audioClip, tIn, tOut)}`);
  const whyTxt = Object.entries(wideWhy).map(([k, v]) => `${k}×${v}`).join("/");
  MC.log(`director: level=${MC.S.cutLevel} ${cuts.length}カット(ディゾルブ${nDissolve}`
    + `${forcedN ? `・強制切替${forcedN}` : ""}${wideN ? `・引き限定${wideN}(${whyTxt})` : ""}`
    + `${deferN ? `・ソロで繰り延べ${deferN}` : ""}) bpm=${bpmAll.toFixed(1)}`
    + `${impacts.length ? ` 衝撃${impacts.length}箇所` : ""}`
    + `${breaks.length ? ` 切れ目${breaks.length}箇所` : ""}`);
  return { segments: cuts.length, bpm: bpmAll, dissolves: nDissolve,
           impacts: impacts.length, breaks: breaks.length,
           wideForced: wideN, starveDeferred: deferN };
};
