"use strict";
/* ============ MarchinZ Vlog: 構成テンプレの正本 ============
   出どころ(いずれも実測・分析済みの自作資産から必要部分を焼き直したもの):
   - THE FOCUS の VLOG 59本分析(VlogWorks): 尺%の骨格、カットリズム実測
     (2019年7.1秒/カット → 2022年以降3.2〜4.8秒/カットへ高速化)
   - 大石健弘さんの構成哲学(HappyWorks): 感情曲線「静→積み上げ→爆発→昇華」、
     寄り=温度/引き=情景 の距離設計、余韻の残し方
   - DCI団体のエピソードシリーズ: BD360(Blue Devils) / From the Field(SCV) /
     Backstage(Boston Crusaders) などの「裏側を見せる」型

   2026-07-20 のレビューで入った主な修正:
   - 「今日は何の日か」ブロックを新設(VlogWorks DNA.skeleton の 5-15% を落としていた)。
     いつ・どこの・何の映像かが冒頭で分からないと、以降ずっと意味が入ってこない
   - 締めの語り(itv3)を最長に。元データは 70-90% が「代表の語り(クライマックス)、
     長回しを恐れない」。ここを短くしていたのは配分が逆だった
   - エモーショナルのカット秒を短縮。大石作品の実測は 1.58〜3.69秒/カットで、
     長回しは「人の言葉」だけ。情景は普通に切る(4〜7秒は遅すぎた)
   - 爆発と昇華の間に「余熱」を新設。演奏直後にすぐ喋らせない
   - 本番ハイライトのカット秒を伸ばす。2.0〜2.5秒だと何をやっているか
     認識される前に切れる(マーチングは動きが大きい)
   - インタビューにBロール(音は続けたまま絵だけインサートに差し替え)を定義。
     素人素材で1人25秒の据え置きは物理的に持たない。締めだけは顔を見せ切る

   ブロックのフィールド:
     src     どの枠の素材を使うか interview | insert | logo | title
     srcRef  同じ素材を複数ブロックで使う場合の紐づけ(語りを割る用)
     pct     完成尺に対する配分(モード内で合計100)
     cutSec  インサートの平均カット秒(長回しは null)
     trans   このブロックへ入るときの繋ぎ cut | dissolve
     transSec 繋ぎの秒数(未指定はモード既定)
     duck    BGMを下げるか(インタビューは必ず true)
     ambient 現場音を前に出すか(つかみ・余熱・演奏など)
     bRoll   {atPct, sec} 語りの途中で絵だけ差し替える(音は継続)
     dist / emo  距離と感情の位置
     show    ショウ動画(本番演技)を優先的に充てるブロックか
     guide   枠に出す撮り方の指示 {what, how} */

MV.DATA = {
  /* Artlist リファラル(優さん確定)。BGM枠と書き出し後の両方で使う */
  ARTLIST_REFERRAL: "https://artlist.io/referral/9e958a5d-8272-4c71-95d9-12ce5704a7dc",

  MODES: {

    /* ---------- おすすめ ---------- */
    recommend: {
      name: "おすすめ",
      lead: "見やすさとテンポのバランス型。練習の記録や団体紹介に。",
      endColor: "black",
      dissolveSec: 1.2,
      blocks: [
        { id: "cold", label: "つかみ", src: "insert", pct: 5, cutSec: null, trans: "cut",
          dist: "寄り", emo: "静", ambient: true,
          guide: { what: "何も起きていない時間", icon: "fa-hourglass-half",
                   how: "集合前や練習の合間を10秒だけ回してください。呼びかけて振り向いたところ、笑っているところ。決めゼリフはいりません。気づかれても、そのまま回し続けて" } },

        { id: "today", label: "今日は何の日", src: "insert", pct: 5, cutSec: 3.0, trans: "cut",
          dist: "引き", emo: "静",
          guide: { what: "日付と場所が分かるもの", icon: "fa-map-pin",
                   how: "会場の看板、朝の集合、バスの前。ひとこと「今日は◯◯大会です」と言ってもらえると完璧です" } },

        { id: "title", label: "タイトル", src: "title", pct: 3, cutSec: null, trans: "dissolve",
          guide: { what: "団体名とロゴ", how: "自動で表示します" } },

        { id: "digestA", label: "練習の風景", src: "insert", pct: 15, cutSec: 3.0, trans: "cut",
          dist: "引き", emo: "積み上げ",
          guide: { what: "合奏・基礎練・移動", icon: "fa-people-group",
                   how: "10秒回して、止めて、立ち位置を変える。これを3回。歩きながら撮らない、ズームは使わない(寄りたければ自分が近づく)。1本は全員が画面に入る位置から" } },

        { id: "itv1", label: "インタビュー①", src: "interview", pct: 13, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          bRoll: { atPct: 0.45, sec: 3.5 },
          guide: { what: "はじめたきっかけ",
                   how: "いちばん大事なのは音です。風の当たらない静かな場所で、スマホを相手の胸の高さ、1メートルまで近づけて。画は胸から上。話し終わっても5秒は止めない。そのあとに本音が来ます" } },

        { id: "insB", label: "表情・手元", src: "insert", pct: 7, cutSec: 3.0, trans: "cut",
          dist: "寄り", emo: "積み上げ",
          guide: { what: "顔・指・楽器の寄り", icon: "fa-magnifying-glass",
                   how: "手が届く距離まで寄って、両ひじを体につけて、息を止めて5秒。指・マウスピース・汗・靴・楽器のベル。顔が写っていなくて構いません" } },

        { id: "itv2", label: "インタビュー②", src: "interview", pct: 12, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          bRoll: { atPct: 0.5, sec: 3.5 },
          guide: { what: "大変だったこと・本音",
                   how: "①と別の場所で、背景を変えて。同じ壁の前で3人撮ると、同じ人が3回出てきたように見えます。うまくまとめさせないでください" } },

        { id: "high", label: "本番ハイライト", src: "insert", pct: 16, cutSec: 3.5, trans: "cut",
          dist: "引き", emo: "爆発", show: true, ambient: true,
          guide: { what: "本番・通し演技", icon: "fa-star",
                   how: "全体が入る位置から固定で回しっぱなし。途中で動かさない、ズームしない、追いかけない。どこを使うかはこちらで選びます。前の演目から回し始めておくと安全です" } },

        { id: "itv3", label: "締めの語り", src: "interview", pct: 16, cutSec: null,
          trans: "dissolve", duck: true, duckDeep: true, dist: "寄り", emo: "昇華",
          guide: { what: "これからのこと",
                   how: "ここがいちばん長く使うところです。短くしないでください。「これからどうしたいか」を聞いて、言葉に詰まっても待つ。詰まった間ごと使います。話が終わったあとの表情まで5秒余分に回して" } },

        { id: "after", label: "余韻", src: "insert", pct: 5, cutSec: null, trans: "dissolve",
          dist: "引き", emo: "昇華", ambient: true,
          guide: { what: "終わったあとの風景", icon: "fa-door-open",
                   how: "撮り終わったと思ってから、カメラを下ろさずもう10秒。誰もいなくなった場所を、手で持たずに(カバンや台に立てかけて)。片付け中の背中でも構いません" } },

        { id: "end", label: "エンディング", src: "logo", pct: 3, cutSec: null, trans: "dissolve",
          guide: { what: "ロゴ", how: "自動で表示します" } },
      ],
    },

    /* ---------- エモーショナル ---------- */
    emotional: {
      name: "エモーショナル",
      lead: "ゆっくり見せて余韻を残す。引退・卒業・ドキュメント風に。",
      endColor: "white",
      dissolveSec: 2.0,
      blocks: [
        { id: "quiet", label: "静かな導入", src: "insert", pct: 10, cutSec: 4.5,
          trans: "dissolve", transSec: 2.0, dist: "寄り", emo: "静", ambient: true,
          guide: { what: "ひとりでいる人", icon: "fa-user",
                   how: "顔は見えなくていいです。準備している背中、片付けている手。スマホは手で持たず、棚やカバンの上に置いて8つ数えてから止める" } },

        { id: "itv1a", label: "語りのはじまり", src: "interview", srcRef: "itv1", pct: 7,
          cutSec: null, trans: "cut", duck: true, dist: "寄り", emo: "静",
          guide: { what: "入口の一言",
                   how: "回す前に「なんであなたに聞きたいか」を本人に言ってください。それから始めると、返ってくる言葉が変わります" } },

        { id: "scene", label: "情景", src: "insert", pct: 9, cutSec: 3.5,
          trans: "dissolve", transSec: 1.2, dist: "引き", emo: "積み上げ",
          guide: { what: "場所が分かる引き", icon: "fa-mountain-sun",
                   how: "練習場の全景・校舎・空。人が小さく写るくらいで。ここは長回しにしなくて大丈夫です" } },

        { id: "itv1b", label: "語りの本題", src: "interview", srcRef: "itv1", pct: 11,
          cutSec: null, trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          bRoll: { atPct: 0.55, sec: 4.0 },
          guide: { what: "(同じ人の続き)", how: "①の続きを自動で使います" } },

        { id: "faces", label: "表情", src: "insert", pct: 9, cutSec: 4.0, trans: "cut",
          dist: "寄り", emo: "積み上げ",
          guide: { what: "仲間の顔", icon: "fa-face-smile",
                   how: "「撮るね」と言ってから、近づいて撮ってください。隠れて撮った顔より強いです。ズームは使わない(画質が落ちます)。1人5秒ずつ、3人ぶん" } },

        { id: "itv2", label: "インタビュー②", src: "interview", pct: 13, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          bRoll: { atPct: 0.5, sec: 4.0 },
          guide: { what: "つらかった時期のこと",
                   how: "黙っている時間を切らないでください。10秒の沈黙がいちばん良かったりします。うなずき声は入れずに、無言でうなずいて" } },

        { id: "burst", label: "演奏", src: "insert", pct: 14, cutSec: 3.0, trans: "cut",
          dist: "引き", emo: "爆発", show: true, ambient: true,
          guide: { what: "いちばん鳴っている場面", icon: "fa-bolt",
                   how: "全体が入る位置から固定で。ショウ動画を入れると山場を自動で選びます" } },

        { id: "afterglow", label: "余熱", src: "insert", pct: 4, cutSec: null, trans: "cut",
          dist: "寄り", emo: "昇華", ambient: true,
          guide: { what: "演奏が終わった直後", icon: "fa-clock-rotate-left",
                   how: "楽器を下ろす手、肩で息をしている顔、目を合わせる二人。7秒だけ、誰も喋っていない時間が要ります" } },

        { id: "itv3", label: "締めの語り", src: "interview", pct: 12, cutSec: null,
          trans: "dissolve", transSec: 1.2, duck: true, duckDeep: true,
          dist: "寄り", emo: "昇華",
          guide: { what: "いまの気持ち",
                   how: "この一言で終わります。言い切らなくても大丈夫です。話し終わったあとも止めないで" } },

        { id: "symbol", label: "象徴の余韻", src: "insert", pct: 6, cutSec: null,
          trans: "dissolve", transSec: 2.0, dist: "引き", emo: "昇華", ambient: true,
          guide: { what: "その人を思い出させるもの", icon: "fa-heart",
                   how: "その人がいなくなった場所を、動かさず10秒。あとで効きます" } },

        { id: "end", label: "エンディング", src: "logo", pct: 5, cutSec: null,
          trans: "dissolve", transSec: 2.0,
          guide: { what: "ロゴ", how: "自動で表示します（白背景）" } },
      ],
    },

    /* ---------- アクティブ ---------- */
    active: {
      name: "アクティブ",
      lead: "テンポよく畳みかける。大会・遠征・日常の裏側に。",
      endColor: "black",
      dissolveSec: 0.8,
      blocks: [
        { id: "cold", label: "つかみ", src: "insert", pct: 5, cutSec: 2.0, trans: "cut",
          dist: "引き", emo: "爆発", ambient: true,
          guide: { what: "動きのある一発", icon: "fa-person-running",
                   how: "走る・跳ぶ・楽器を構える。1〜2秒で使うので、短くて構いません" } },

        { id: "title", label: "タイトル", src: "title", pct: 3, cutSec: null, trans: "cut",
          guide: { what: "団体名とロゴ", how: "自動で表示します" } },

        { id: "today", label: "今日は何の日", src: "insert", pct: 5, cutSec: 2.5, trans: "cut",
          dist: "引き", emo: "積み上げ",
          guide: { what: "日付と場所が分かるもの", icon: "fa-map-pin",
                   how: "会場の看板、朝の集合。「今日は◯◯大会です」と言ってもらうと一発で伝わります" } },

        { id: "behindA", label: "裏側①", src: "insert", pct: 17, cutSec: 2.5, trans: "cut",
          dist: "寄り", emo: "積み上げ",
          guide: { what: "移動・積み込み・準備", icon: "fa-truck",
                   how: "バスの中、荷物、着替え。生活感が効きます。1本10〜20秒で、場所を変えて数本" } },

        { id: "itv1", label: "インタビュー①", src: "interview", pct: 11, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          bRoll: { atPct: 0.5, sec: 3.0 },
          guide: { what: "今日の意気込み",
                   how: "本番前の1分でいい。3人に同じ質問を1つだけ。「今日どうですか」で十分です。ひとり15秒。並ばせずに、その場にいる人をつかまえて" } },

        { id: "behindB", label: "裏側②", src: "insert", pct: 13, cutSec: 2.5, trans: "cut",
          dist: "引き", emo: "積み上げ",
          guide: { what: "練習・リハーサル", icon: "fa-dumbbell",
                   how: "同じ画が続かないよう、立ち位置を変えて数本。歩きながら撮らないこと" } },

        { id: "itv2", label: "インタビュー②", src: "interview", pct: 11, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          bRoll: { atPct: 0.5, sec: 3.0 },
          guide: { what: "仕上がりについて",
                   how: "汗をかいたまま撮ると空気が出ます。整理して喋らせないでください" } },

        { id: "high", label: "ハイライト", src: "insert", pct: 18, cutSec: 3.0, trans: "cut",
          dist: "引き", emo: "爆発", show: true, ambient: true,
          guide: { what: "本番・通し演技", icon: "fa-star",
                   how: "全体が入る位置から固定で回しっぱなし。動かさない、ズームしない。ショウ動画を入れると盛り上がる場所を自動で選びます" } },

        { id: "itv3", label: "本番直後の感想", src: "interview", pct: 14, cutSec: null,
          trans: "cut", duck: true, duckDeep: true, dist: "寄り", emo: "昇華",
          guide: { what: "終わった直後の言葉",
                   how: "演技が終わって戻ってきた直後、5分以内につかまえてください。息が上がったままがいちばんいい。整理して喋らせない。最後に「次は◯◯です」を一言だけ足してもらう" } },

        { id: "end", label: "エンディング", src: "logo", pct: 3, cutSec: null, trans: "dissolve",
          guide: { what: "ロゴ", how: "自動で表示します（黒背景）" } },
      ],
    },
  },

  /* 素材を集めるときのチェックリスト(枠ごとではなくセクションに1枚出す)。
     枠ごとに同じ文を並べると、10枠で同じ指示が2周して「同じものを2本撮れ」に
     見えてしまうため、重複を除いた一覧をここから作る */
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
  }
})();
