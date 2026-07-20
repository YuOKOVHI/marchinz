"use strict";
/* ============ MarchinZ Vlog: 名前空間と状態 ============
   素材を「枠」に入れると、モードの構成テンプレに沿って自動で並べ、
   3分1秒〜(ゲスト3分30秒/登録5分)のVlogに組み立ててMP4で書き出す。

   名前空間は MV(Switcherの MC / ReAngleの RA / Privacyの MZ と衝突しない)。
   素材はスロット型で持つ: インタビュー3・インサート10・ロゴ1・BGM3。 */

window.MV = {
  FPS: 30,

  /* 出し先(アスペクト)。モード=表現 とは独立した設定にする。
     SNSは縦、YouTube・MarchinZ掲載は横、と用途で分かれるため */
  ASPECTS: {
    landscape: { id: "landscape", label: "横（YouTube・MarchinZ）", W: 1920, H: 1080 },
    portrait:  { id: "portrait",  label: "縦（TikTok・リール・ストーリー）", W: 1080, H: 1920 },
  },

  S: {
    mode: null,            // "recommend" | "emotional" | "active"
    aspect: "landscape",   // "landscape" | "portrait"
    audioMode: "ambient",  // "ambient"(演奏をそのまま) | "bgm" | "both"
    orgName: "",           // 団体名(ロゴが無いときのタイトル/エンドに使う)
    forWhom: "",           // この動画をいちばん見てほしい人(1人)
    interviews: [],        // [{id,file,name,url,video,duration,thumb,trimIn,trimOut}]
    inserts: [],           // [{... , isShow:bool(ショウ動画), quality:解析結果, show:解析結果}]
    logo: null,            // {file,name,src,out,isPng,threshold,useOriginal,srcUrl}
    bgms: [],              // [{id,file,name,buffer,duration}]
    endColor: null,        // "white" | "black"(未設定ならモード既定)
    showMix: 0.3,          // ショウ動画区間の現場音ミックス比(BGM 70 : 現場 30)
    plan: null,            // planner.js の生成結果
    t: 0, playing: false,
  },

  /* 現在のアスペクトの解像度 */
  get W() { return MV.ASPECTS[MV.S.aspect].W; },
  get H() { return MV.ASPECTS[MV.S.aspect].H; },

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

  /* WebCodecsのデコード待ち。キューが詰まったとき dequeue を待つ。
     Switcher state.js から取りこぼしていた(audio.js が呼んでいる) */
  waitDequeue(codec, ms = 100) {
    return new Promise(r => {
      const h = () => { clearTimeout(tm); r(); };
      codec.addEventListener("dequeue", h, { once: true });
      const tm = setTimeout(() => { codec.removeEventListener("dequeue", h); r(); }, ms);
    });
  },

  /* ---- 素材の取り回し ---- */
  allClips() { return MV.S.interviews.concat(MV.S.inserts); },
  getClip(id) { return MV.allClips().find(c => c.id === id) || null; },
  clipKey(c) { return `${c.name}|${c.size}|${c.lastModified}`; },

  /* ---- 完成尺 ----
     目標は3分前後。ただし尺は素材に合わせてアルゴリズムが決め、短くなってもよい
     (優さん決定 2026-07-20)。3分より短いと本体のYouTube一覧には載せられない
     (MIN_VIDEO_DURATION_SEC = 181)ので、そのときだけ画面で知らせる。
     上限だけはロール別に効かせる(ゲスト3分30秒 / 登録5分)。 */
  TARGET_SEC: 190,          // 目標(3分10秒あたり)。素材が足りなければ下回ってよい
  MARCHINZ_MIN_SEC: 181,    // これ未満はMarchinZのYouTube一覧に載せられない

  lenRange() {
    const L = window.MZ_LIMITS || {};
    return [30, L.vlogMaxSec || 210];   // 下限は「動画として成立する最低限」だけ
  },

  /* MarchinZに載せられる長さか(下回っても書き出しは止めない) */
  fitsMarchinZ(sec) { return sec >= MV.MARCHINZ_MIN_SEC; },

  saveState() {
    try {
      localStorage.setItem(MV.SKEY, JSON.stringify({
        mode: MV.S.mode,
        orgName: MV.S.orgName, forWhom: MV.S.forWhom,
        aspect: MV.S.aspect, audioMode: MV.S.audioMode,
        endColor: MV.S.endColor, showMix: MV.S.showMix,
      }));
    } catch (_) {}
  },

  /* 2026-07-20: 雰囲気選択が単体の着地ページでなくなり、作業領域内の
     1セクションになったため、モードも他の設定と同様に保存して復元する */
  restoreState() {
    try {
      const r = JSON.parse(localStorage.getItem(MV.SKEY) || "null");
      if (!r) return;
      if (r.mode) MV.S.mode = r.mode;
      if (r.orgName) MV.S.orgName = r.orgName;
      if (r.forWhom) MV.S.forWhom = r.forWhom;
      if (MV.ASPECTS[r.aspect]) MV.S.aspect = r.aspect;
      if (["ambient", "bgm", "both"].includes(r.audioMode)) MV.S.audioMode = r.audioMode;
      if (r.endColor) MV.S.endColor = r.endColor;
      if (typeof r.showMix === "number") MV.S.showMix = r.showMix;
    } catch (_) {}
  },

  nextId: 1,
};
