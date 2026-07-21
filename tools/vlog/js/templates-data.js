"use strict";
/* ============ MarchinZ Vlog: 構成テンプレの正本 ============
   2026-07-21 全面再構築: 「インタビュー構成ツール」へ。

   考え方(優さん指示):
   - インタビューが主軸で必須。Vlogの背骨は「人の言葉」
   - Bロール(インサート映像)は基本、インタビューの上に絵だけ被せる
     (音はインタビューが続く。被せは bRollEvery 秒ごとに bRollSec 秒)
   - 同一のBロール素材は、ひとつのシーン(ブロック)につき1回まで
   - Bロールだけの独立カットは「つかみ・場面転換・本番・余韻」に限る
   - インサートが0本でもインタビューだけで成立する(独立ブロックは落ちる)

   出どころ(実測・分析済みの自作資産):
   - THE FOCUS の VLOG 59本分析(VlogWorks): 尺%の骨格、カットリズム実測
   - 大石健弘さんの構成哲学(HappyWorks): 感情曲線「静→積み上げ→爆発→昇華」、
     語りを長く使う勇気、締めは顔を見せ切る
   - DCI団体のエピソードシリーズ: BD360 / From the Field / Backstage

   ブロックのフィールド:
     src       interview | insert | logo | title
     srcRef    同じインタビューを複数ブロックで使う場合の紐づけ(語りを割る)
     pct       完成尺に対する配分(モード内で合計100)
     cutSec    独立insertブロックの平均カット秒
     bRollEvery/bRollSec  インタビューへの被せ間隔と長さ(無指定=被せない)
     trans     このブロックへ入るときの繋ぎ cut | dissolve
     transSec  繋ぎの秒数(未指定はモード既定)
     duck      BGMを下げるか(インタビューは必ず true)
     ambient   現場音を前に出すか
     dist/emo  距離と感情の位置
     show      ショウ動画(本番演技)を優先的に充てるか
     guide     枠に出す撮り方の指示 {what, how} */

MV.DATA = {
  /* Artlist リファラル(優さん確定)。BGM枠と書き出し後の両方で使う */
  ARTLIST_REFERRAL: "https://artlist.io/referral/9e958a5d-8272-4c71-95d9-12ce5704a7dc",

  MODES: {

    /* ---------- おすすめ: インタビューを軸に、聞かせる ---------- */
    recommend: {
      name: "おすすめ",
      lead: "語りを軸にした聞かせるバランス型。練習の記録や団体紹介に。",
      endColor: "black",
      dissolveSec: 1.2,
      blocks: [
        { id: "cold", label: "つかみ", src: "insert", pct: 4, cutSec: null, trans: "cut",
          dist: "寄り", emo: "静", ambient: true,
          guide: { what: "何も起きていない時間", icon: "fa-hourglass-half",
                   how: "集合前や練習の合間を10秒だけ回してください。呼びかけて振り向いたところ、笑っているところ。決めゼリフはいりません" } },

        { id: "title", label: "タイトル", src: "title", pct: 3, cutSec: null, trans: "dissolve",
          guide: { what: "団体名とロゴ", how: "自動で表示します" } },

        { id: "itv1", label: "語り① きっかけ", src: "interview", pct: 20, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          bRollEvery: 12, bRollSec: 3.5,
          guide: { what: "はじめたきっかけ",
                   how: "いちばん大事なのは音です。風の当たらない静かな場所で、スマホを相手の胸の高さ、1メートルまで近づけて。話し終わっても5秒は止めない。そのあとに本音が来ます" } },

        { id: "scene", label: "場面転換", src: "insert", pct: 5, cutSec: 3.0, trans: "cut",
          dist: "引き", emo: "積み上げ",
          guide: { what: "練習や移動の風景", icon: "fa-people-group",
                   how: "10秒回して、止めて、立ち位置を変える。これを3回。歩きながら撮らない、ズームは使わない" } },

        { id: "itv2", label: "語り② 本音", src: "interview", pct: 20, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          bRollEvery: 12, bRollSec: 3.5,
          guide: { what: "大変だったこと・本音",
                   how: "①と別の場所で、背景を変えて。同じ壁の前で撮ると同じ人が2回出てきたように見えます。うまくまとめさせないでください" } },

        { id: "high", label: "本番ハイライト", src: "insert", pct: 12, cutSec: 3.5, trans: "cut",
          dist: "引き", emo: "爆発", show: true, ambient: true,
          guide: { what: "本番・通し演技", icon: "fa-star",
                   how: "全体が入る位置から固定で回しっぱなし。動かさない、ズームしない。どこを使うかはこちらで選びます" } },

        { id: "itv3", label: "締めの語り", src: "interview", pct: 26, cutSec: null,
          trans: "dissolve", duck: true, duckDeep: true, dist: "寄り", emo: "昇華",
          bRollEvery: 16, bRollSec: 4,
          guide: { what: "これからのこと",
                   how: "ここがいちばん長く使うところです。「これからどうしたいか」を聞いて、言葉に詰まっても待つ。詰まった間ごと使います。話が終わったあとの表情まで5秒余分に回して" } },

        { id: "after", label: "余韻", src: "insert", pct: 5, cutSec: null, trans: "dissolve",
          dist: "引き", emo: "昇華", ambient: true,
          guide: { what: "終わったあとの風景", icon: "fa-door-open",
                   how: "撮り終わったと思ってから、カメラを下ろさずもう10秒。誰もいなくなった場所や片付け中の背中" } },

        { id: "end", label: "エンディング", src: "logo", pct: 5, cutSec: null, trans: "dissolve",
          guide: { what: "ロゴ", how: "自動で表示します" } },
      ],
    },

    /* ---------- アクティブ: テンポよく語りをつなぐ ---------- */
    active: {
      name: "アクティブ",
      lead: "語りをテンポよくつなぐ。大会・遠征・日常の裏側に。",
      endColor: "black",
      dissolveSec: 0.8,
      blocks: [
        { id: "cold", label: "つかみ", src: "insert", pct: 4, cutSec: 2.0, trans: "cut",
          dist: "引き", emo: "爆発", ambient: true,
          guide: { what: "動きのある一発", icon: "fa-person-running",
                   how: "走る・跳ぶ・楽器を構える。1〜2秒で使うので、短くて構いません" } },

        { id: "title", label: "タイトル", src: "title", pct: 3, cutSec: null, trans: "cut",
          guide: { what: "団体名とロゴ", how: "自動で表示します" } },

        { id: "today", label: "今日は何の日", src: "insert", pct: 4, cutSec: 2.5, trans: "cut",
          dist: "引き", emo: "積み上げ",
          guide: { what: "日付と場所が分かるもの", icon: "fa-map-pin",
                   how: "会場の看板、朝の集合。「今日は◯◯大会です」と言ってもらうと一発で伝わります" } },

        { id: "itv1", label: "語り① 意気込み", src: "interview", pct: 16, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          bRollEvery: 10, bRollSec: 3,
          guide: { what: "今日の意気込み",
                   how: "本番前の1分でいい。「今日どうですか」で十分です。並ばせずに、その場にいる人をつかまえて" } },

        { id: "behind", label: "裏側", src: "insert", pct: 8, cutSec: 2.5, trans: "cut",
          dist: "寄り", emo: "積み上げ",
          guide: { what: "移動・積み込み・準備", icon: "fa-truck",
                   how: "バスの中、荷物、着替え。生活感が効きます。1本10〜20秒で、場所を変えて数本" } },

        { id: "itv2", label: "語り② 仕上がり", src: "interview", pct: 16, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          bRollEvery: 10, bRollSec: 3,
          guide: { what: "仕上がりについて",
                   how: "汗をかいたまま撮ると空気が出ます。整理して喋らせないでください" } },

        { id: "high", label: "ハイライト", src: "insert", pct: 14, cutSec: 3.0, trans: "cut",
          dist: "引き", emo: "爆発", show: true, ambient: true,
          guide: { what: "本番・通し演技", icon: "fa-star",
                   how: "全体が入る位置から固定で回しっぱなし。ショウ動画を入れると盛り上がる場所を自動で選びます" } },

        { id: "itv3", label: "本番直後の感想", src: "interview", pct: 30, cutSec: null,
          trans: "cut", duck: true, duckDeep: true, dist: "寄り", emo: "昇華",
          bRollEvery: 14, bRollSec: 3,
          guide: { what: "終わった直後の言葉",
                   how: "演技が終わって戻ってきた直後、5分以内につかまえてください。息が上がったままがいちばんいい。最後に「次は◯◯です」を一言だけ足してもらう" } },

        { id: "end", label: "エンディング", src: "logo", pct: 5, cutSec: null, trans: "dissolve",
          guide: { what: "ロゴ", how: "自動で表示します（黒背景）" } },
      ],
    },

    /* ---------- エモーショナル: 1人の語りを深く ---------- */
    emotional: {
      name: "エモーショナル",
      lead: "1人の語りを深く聞かせて余韻を残す。引退・卒業・ドキュメント風に。",
      endColor: "white",
      dissolveSec: 2.0,
      blocks: [
        { id: "quiet", label: "静かな導入", src: "insert", pct: 6, cutSec: 4.5,
          trans: "dissolve", transSec: 2.0, dist: "寄り", emo: "静", ambient: true,
          guide: { what: "ひとりでいる人", icon: "fa-user",
                   how: "顔は見えなくていいです。準備している背中、片付けている手。スマホは手で持たず、棚やカバンの上に置いて8つ数えてから止める" } },

        { id: "itv1a", label: "語りのはじまり", src: "interview", srcRef: "itv1", pct: 10,
          cutSec: null, trans: "cut", duck: true, dist: "寄り", emo: "静",
          guide: { what: "入口の一言",
                   how: "回す前に「なんであなたに聞きたいか」を本人に言ってください。それから始めると、返ってくる言葉が変わります。ここは顔を見せ切るので、Bロールは被せません" } },

        { id: "scene", label: "情景", src: "insert", pct: 5, cutSec: 3.5,
          trans: "dissolve", transSec: 1.2, dist: "引き", emo: "積み上げ",
          guide: { what: "場所が分かる引き", icon: "fa-mountain-sun",
                   how: "練習場の全景・校舎・空。人が小さく写るくらいで" } },

        { id: "itv1b", label: "語りの本題", src: "interview", srcRef: "itv1", pct: 22,
          cutSec: null, trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          bRollEvery: 13, bRollSec: 4,
          guide: { what: "(同じ人の続き)", how: "①の続きを自動で使います" } },

        { id: "burst", label: "演奏", src: "insert", pct: 12, cutSec: 3.0, trans: "cut",
          dist: "引き", emo: "爆発", show: true, ambient: true,
          guide: { what: "いちばん鳴っている場面", icon: "fa-bolt",
                   how: "全体が入る位置から固定で。ショウ動画を入れると山場を自動で選びます" } },

        { id: "afterglow", label: "余熱", src: "insert", pct: 4, cutSec: null, trans: "cut",
          dist: "寄り", emo: "昇華", ambient: true,
          guide: { what: "演奏が終わった直後", icon: "fa-clock-rotate-left",
                   how: "楽器を下ろす手、肩で息をしている顔。7秒だけ、誰も喋っていない時間が要ります" } },

        { id: "itv3", label: "締めの語り", src: "interview", pct: 27, cutSec: null,
          trans: "dissolve", transSec: 1.2, duck: true, duckDeep: true,
          dist: "寄り", emo: "昇華",
          bRollEvery: 18, bRollSec: 4,
          guide: { what: "いまの気持ち",
                   how: "この一言で終わります。言い切らなくても大丈夫です。黙っている時間を切らないでください。10秒の沈黙がいちばん良かったりします" } },

        { id: "symbol", label: "象徴の余韻", src: "insert", pct: 6, cutSec: null,
          trans: "dissolve", transSec: 2.0, dist: "引き", emo: "昇華", ambient: true,
          guide: { what: "その人を思い出させるもの", icon: "fa-heart",
                   how: "その人がいなくなった場所を、動かさず10秒。あとで効きます" } },

        { id: "end", label: "エンディング", src: "logo", pct: 8, cutSec: null,
          trans: "dissolve", transSec: 2.0,
          guide: { what: "ロゴ", how: "自動で表示します（白背景）" } },
      ],
    },
  },

  /* 素材を集めるときのチェックリスト(重複を除いた一覧をセクションに1枚出す) */
  insertChecklist(modeId) {
    const m = MV.DATA.MODES[modeId];
    if (!m) return [];
    const seen = new Set();
    const out = [];
    for (const b of m.blocks) {
      if (b.src !== "insert" || !b.guide) continue;
      if (seen.has(b.guide.what)) continue;
      seen.add(b.guide.what);
      out.push({ id: b.id, what: b.guide.what, how: b.guide.how, icon: b.guide.icon || "fa-video" });
    }
    return out;
  },
};

/* テンプレの自己検証。合計100%からずれたまま配分すると尺が狂う */
(() => {
  for (const [key, m] of Object.entries(MV.DATA.MODES)) {
    const sum = m.blocks.reduce((s, b) => s + b.pct, 0);
    if (Math.abs(sum - 100) > 0.01) {
      console.error(`[vlog] テンプレ ${key} の pct 合計が ${sum}%（100であるべき）`);
    }
    const nItv = new Set(m.blocks.filter(b => b.src === "interview")
      .map(b => b.srcRef || b.id)).size;
    if (nItv > 3) console.error(`[vlog] テンプレ ${key} が要求するインタビューが ${nItv}人（上限3）`);
    if (nItv < 1) console.error(`[vlog] テンプレ ${key} にインタビューがありません(インタビュー構成ツールとして不成立)`);
  }
})();
