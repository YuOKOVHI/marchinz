"use strict";
/* ============ MarchinZ Vlog: 構成テンプレの正本 ============
   出どころ(いずれも実測・分析済みの自作資産から必要部分を焼き直したもの):
   - THE FOCUS の VLOG 59本分析(VlogWorks): 尺%の骨格、カットリズム実測
     (2019年は7.1秒/カット → 2022年以降は3.2〜4.8秒/カットへ高速化)
   - 大石健弘さんの構成哲学(HappyWorks): 感情曲線「静→積み上げ→爆発→昇華」、
     寄り=温度/引き=情景 の距離設計、余韻を残す終わり方
   - DCI団体のエピソードシリーズ(本体のYouTubeリストに実在):
     BD360(Blue Devils) / From the Field(Santa Clara Vanguard) /
     Backstage(Boston Crusaders) などの「裏側を見せる」型

   モードは上の3つを比率でブレンドしたもの:
     recommend  大石2 : THE FOCUS+アメリカ8
     emotional  大石7 : 3
     active     大石0 : 10

   ブロックのフィールド:
     src    どの枠の素材を使うか interview | insert | logo | title
     pct    完成尺に対する配分(モード内で合計100)
     cutSec インサートの平均カット秒(長回しは null)
     trans  このブロックへ入るときの繋ぎ cut | dissolve
     duck   BGMを下げるか(インタビューは必ず true)
     dist   寄り/引き   emo 感情の位置(静/積み上げ/爆発/昇華)
     show   ショウ動画(本番演技)を優先的に充てるブロックか
     guide  枠に出す撮り方の指示 {what: 何を撮るか, how: どう撮るか} */

MV.DATA = {
  /* Artlist リファラル(優さん確定) */
  ARTLIST_REFERRAL: "https://artlist.io/referral/9e958a5d-8272-4c71-95d9-12ce5704a7dc",

  MODES: {

    /* ---------- おすすめ: 見やすさとテンポのバランス ---------- */
    recommend: {
      name: "おすすめ",
      lead: "見やすさとテンポのバランス型。練習の記録や団体紹介に。",
      endColor: "black",
      dissolveSec: 1.2,
      blocks: [
        { id: "cold", label: "つかみ", src: "insert", pct: 6, cutSec: 2.5, trans: "cut",
          dist: "寄り", emo: "静",
          guide: { what: "現場の素の一言・音", how: "しゃべっている途中から撮り始めてOK。整えない方が効きます" } },
        { id: "title", label: "タイトル", src: "title", pct: 4, cutSec: null, trans: "dissolve",
          guide: { what: "団体名とロゴ", how: "ロゴを入れると自動で表示します" } },
        { id: "digestA", label: "練習の風景", src: "insert", pct: 17, cutSec: 3.0, trans: "cut",
          dist: "引き", emo: "積み上げ",
          guide: { what: "合奏・基礎練・移動", how: "全体が見える引きを1本は入れる。三脚か、壁に体を預けて固定" } },
        { id: "itv1", label: "インタビュー①", src: "interview", pct: 14, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          guide: { what: "はじめたきっかけ", how: "胸から上。目線はカメラの少し横。相手が話し終えても3秒待つ" } },
        { id: "insB", label: "表情・手元", src: "insert", pct: 8, cutSec: 3.5, trans: "cut",
          dist: "寄り", emo: "積み上げ",
          guide: { what: "顔・指・楽器の寄り", how: "近づいて撮る。手ブレしやすいので脇を締めて" } },
        { id: "itv2", label: "インタビュー②", src: "interview", pct: 13, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          guide: { what: "大変だったこと・本音", how: "①とは別の場所で撮ると画が変わって見飽きません" } },
        { id: "high", label: "本番ハイライト", src: "insert", pct: 15, cutSec: 2.5, trans: "cut",
          dist: "引き", emo: "爆発", show: true,
          guide: { what: "本番・通し演技", how: "ショウ動画を入れると、盛り上がる場所を自動で選びます" } },
        { id: "itv3", label: "インタビュー③", src: "interview", pct: 12, cutSec: null,
          trans: "dissolve", duck: true, dist: "寄り", emo: "昇華",
          guide: { what: "これからのこと", how: "締めの言葉になります。短くて構いません" } },
        { id: "after", label: "余韻", src: "insert", pct: 6, cutSec: null, trans: "dissolve",
          dist: "引き", emo: "昇華",
          guide: { what: "終わったあとの風景", how: "1カットを長めに。人がいなくなった場所や空でも" } },
        { id: "end", label: "エンディング", src: "logo", pct: 5, cutSec: null, trans: "dissolve",
          guide: { what: "ロゴ", how: "自動で表示します" } },
      ],
    },

    /* ---------- エモーショナル: 大石7・語りが主役 ---------- */
    emotional: {
      name: "エモーショナル",
      lead: "ゆっくり見せて余韻を残す。引退・卒業・ドキュメント風に。",
      endColor: "white",
      dissolveSec: 2.0,
      blocks: [
        { id: "quiet", label: "静かな導入", src: "insert", pct: 8, cutSec: 7.0, trans: "dissolve",
          dist: "寄り", emo: "静",
          guide: { what: "何気ないものの寄り", how: "動かさず、長めに。楽器ケース・靴・譜面など" } },
        { id: "itv1", label: "インタビュー①", src: "interview", pct: 17, cutSec: null,
          trans: "dissolve", duck: true, dist: "寄り", emo: "静",
          guide: { what: "静かに語りはじめる", how: "しっかり近づく。沈黙も切らずに残します" } },
        { id: "scene", label: "情景", src: "insert", pct: 11, cutSec: 5.0, trans: "dissolve",
          dist: "引き", emo: "積み上げ",
          guide: { what: "場所が分かる引き", how: "練習場の全景・校舎・空。人が小さく写るくらいで" } },
        { id: "itv2", label: "インタビュー②", src: "interview", pct: 15, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          guide: { what: "つらかった時期のこと", how: "話し手が思い出す間を待つ。急かさない" } },
        { id: "faces", label: "表情", src: "insert", pct: 9, cutSec: 4.0, trans: "cut",
          dist: "寄り", emo: "積み上げ",
          guide: { what: "仲間の顔", how: "本人が気づいていない瞬間を、離れた場所から望遠で" } },
        { id: "burst", label: "演奏", src: "insert", pct: 13, cutSec: 3.0, trans: "cut",
          dist: "引き", emo: "爆発", show: true,
          guide: { what: "いちばん鳴っている場面", how: "ショウ動画を入れると、山場を自動で選びます" } },
        { id: "itv3", label: "インタビュー③", src: "interview", pct: 14, cutSec: null,
          trans: "dissolve", duck: true, dist: "寄り", emo: "昇華",
          guide: { what: "いまの気持ち", how: "この一言で終わります。言い切らなくても大丈夫" } },
        { id: "symbol", label: "象徴の余韻", src: "insert", pct: 7, cutSec: null, trans: "dissolve",
          dist: "引き", emo: "昇華",
          guide: { what: "その人を思い出させるもの", how: "1カット長回し。動かさない" } },
        { id: "end", label: "エンディング", src: "logo", pct: 6, cutSec: null, trans: "dissolve",
          guide: { what: "ロゴ", how: "自動で表示します（白背景）" } },
      ],
    },

    /* ---------- アクティブ: 海外コーのエピソード風 ---------- */
    active: {
      name: "アクティブ",
      lead: "テンポよく畳みかける。大会・遠征・日常の裏側に。",
      endColor: "black",
      dissolveSec: 0.8,
      blocks: [
        { id: "cold", label: "つかみ", src: "insert", pct: 5, cutSec: 2.0, trans: "cut",
          dist: "引き", emo: "爆発",
          guide: { what: "動きのある一発", how: "走る・跳ぶ・楽器を構える。1〜2秒で使います" } },
        { id: "title", label: "タイトル", src: "title", pct: 3, cutSec: null, trans: "cut",
          guide: { what: "団体名とロゴ", how: "自動で表示します" } },
        { id: "behindA", label: "裏側①", src: "insert", pct: 17, cutSec: 2.5, trans: "cut",
          dist: "寄り", emo: "積み上げ",
          guide: { what: "移動・積み込み・準備", how: "バスの中、荷物、着替え。生活感が効きます" } },
        { id: "itv1", label: "インタビュー①", src: "interview", pct: 12, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          guide: { what: "今日の意気込み", how: "立ち話でOK。テンポ重視なので短く" } },
        { id: "behindB", label: "裏側②", src: "insert", pct: 16, cutSec: 2.5, trans: "cut",
          dist: "引き", emo: "積み上げ",
          guide: { what: "練習・リハーサル", how: "同じ画が続かないよう、立ち位置を変えて数本" } },
        { id: "itv2", label: "インタビュー②", src: "interview", pct: 12, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "積み上げ",
          guide: { what: "仕上がりについて", how: "汗をかいたまま撮ると空気が出ます" } },
        { id: "high", label: "ハイライト", src: "insert", pct: 20, cutSec: 2.0, trans: "cut",
          dist: "引き", emo: "爆発", show: true,
          guide: { what: "本番・通し演技", how: "ショウ動画を入れると、盛り上がる場所を自動で選びます" } },
        { id: "itv3", label: "インタビュー③", src: "interview", pct: 11, cutSec: null,
          trans: "cut", duck: true, dist: "寄り", emo: "昇華",
          guide: { what: "次回への一言", how: "「次は◯◯です」と言ってもらうと続きが見たくなります" } },
        { id: "end", label: "エンディング", src: "logo", pct: 4, cutSec: null, trans: "dissolve",
          guide: { what: "ロゴ", how: "自動で表示します（黒背景）" } },
      ],
    },
  },
};

/* ブロック定義の自己検証(合計100%になっているか)。ズレたまま配分すると尺が狂う */
(() => {
  for (const [key, m] of Object.entries(MV.DATA.MODES)) {
    const sum = m.blocks.reduce((s, b) => s + b.pct, 0);
    if (Math.abs(sum - 100) > 0.01) {
      console.error(`[vlog] テンプレ ${key} の pct 合計が ${sum}%（100であるべき）`);
    }
  }
})();
