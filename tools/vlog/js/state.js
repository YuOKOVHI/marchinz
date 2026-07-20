"use strict";
/* ============ MarchinZ Vlog: 名前空間と状態 ============
   素材を「枠」に入れると、モードの構成テンプレに沿って自動で並べ、
   3分1秒〜(ゲスト3分30秒/登録5分)のVlogに組み立ててMP4で書き出す。

   名前空間は MV(Switcherの MC / ReAngleの RA / Privacyの MZ と衝突しない)。
   素材はスロット型で持つ: インタビュー3・インサート10・ロゴ1・BGM3。 */

window.MV = {
  /* 出力仕様。YouTube向け横型(本体のYouTube掲載条件=181秒以上に合わせた尺設計) */
  W: 1920, H: 1080, FPS: 30,

  S: {
    mode: null,            // "recommend" | "emotional" | "active"
    orgName: "",           // 団体名(ロゴが無いときのタイトル/エンドに使う)
    interviews: [],        // [{id,file,name,url,video,duration,thumb,trimIn,trimOut}]
    inserts: [],           // [{... , isShow:bool(ショウ動画), quality:解析結果, show:解析結果}]
    logo: null,            // {file,name,srcCanvas,outCanvas,isPng,threshold,useOriginal}
    bgms: [],              // [{id,file,name,buffer,duration}]
    endColor: null,        // "white" | "black"(未設定ならモード既定)
    showMix: 0.3,          // ショウ動画区間の現場音ミックス比(BGM 70 : 現場 30)
    plan: null,            // planner.js の生成結果
    t: 0, playing: false,
  },

  /* localStorage(素材そのものは保存しない。設定だけ) */
  SKEY: "mz_vlog_state_v1",

  log(...a) { try { console.log("[vlog]", ...a); } catch (_) {} MV.pushDebug(a.join(" ")); },

  /* エラーログ(Switcher v1.38.1と同じ狙い: 利用者がコピーして知らせられる) */
  _debug: [],
  pushDebug(line) {
    MV._debug.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
    if (MV._debug.length > 400) MV._debug.splice(0, MV._debug.length - 400);
  },

  /* 端末の対応状況(exporterの経路分岐に使う) */
  caps: { h264: false, aac: false, recMime: "", webcodecs: false },

  isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),

  /* 重い同期処理の合間に制御を返す。ブラウザペインは setTimeout を強く絞るため
     MessageChannel を使う(Switcherで確立した作法) */
  yield() {
    return new Promise(res => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => res();
      ch.port2.postMessage(0);
    });
  },

  /* ---- 素材の取り回し ---- */
  allClips() { return MV.S.interviews.concat(MV.S.inserts); },
  getClip(id) { return MV.allClips().find(c => c.id === id) || null; },
  clipKey(c) { return `${c.name}|${c.size}|${c.lastModified}`; },

  /* ---- ロール別の完成尺レンジ ----
     下限181秒(3分01秒)は全ロール共通。本体のYouTube掲載条件
     (export_youtube_list_via_api.py の MIN_VIDEO_DURATION_SEC = 181)に揃えてあり、
     作ったVlogがそのままMarchinZに載せられる長さになる。 */
  lenRange() {
    const L = window.MZ_LIMITS || {};
    return [L.vlogMinSec || 181, L.vlogMaxSec || 210];
  },

  saveState() {
    try {
      localStorage.setItem(MV.SKEY, JSON.stringify({
        mode: MV.S.mode, orgName: MV.S.orgName,
        endColor: MV.S.endColor, showMix: MV.S.showMix,
      }));
    } catch (_) {}
  },

  restoreState() {
    try {
      const r = JSON.parse(localStorage.getItem(MV.SKEY) || "null");
      if (!r) return;
      if (r.orgName) MV.S.orgName = r.orgName;
      if (r.endColor) MV.S.endColor = r.endColor;
      if (typeof r.showMix === "number") MV.S.showMix = r.showMix;
    } catch (_) {}
  },

  nextId: 1,
};
