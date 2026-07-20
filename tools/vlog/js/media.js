"use strict";
/* ============ MarchinZ Vlog: 素材の取り込み(スロット型) ============
   Switcher の media.js と同じ作法(重複キー・上限チェック・サムネ生成・
   iOSは preload="metadata" でメモリ節約)を、枠ごとの受け入れに置き換えたもの。 */

MV.media = {};

const VIDEO_RE = /\.(mp4|mov|m4v)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|aac|aiff?|caf)$/i;
const IMAGE_RE = /\.(png|jpe?g|webp|heic|heif|gif|svg)$/i;

MV.media.kindOf = f => {
  if (/^video\//.test(f.type) || VIDEO_RE.test(f.name)) return "video";
  if (/^audio\//.test(f.type) || AUDIO_RE.test(f.name)) return "audio";
  if (/^image\//.test(f.type) || IMAGE_RE.test(f.name)) return "image";
  return "";
};

/* 画面のどこにドロップされても、種類から行き先を決めて振り分ける。
   動画は必ず映像(インサート)へ。インタビューは枠を明示してもらう
   ——推測で振り分けると、最初の1本がインタビュー扱いになるなど意図とズレるため */
MV.media.addAuto = async files => {
  const arr = [...files];
  const vids = arr.filter(f => MV.media.kindOf(f) === "video");
  const auds = arr.filter(f => MV.media.kindOf(f) === "audio");
  const imgs = arr.filter(f => MV.media.kindOf(f) === "image");
  if (vids.length) await MV.media.add("ins", vids);
  if (auds.length) await MV.media.add("bgm", auds);
  if (imgs.length) await MV.media.add("logo", imgs);
};

MV.media.add = async (slot, files) => {
  const arr = [...(files || [])];
  if (!arr.length) return;
  try {
    if (slot === "itv" || slot === "ins") await MV.media.addVideos(slot, arr);
    else if (slot === "bgm") await MV.media.addAudios(arr);
    else if (slot === "logo") await MV.media.addLogo(arr[0]);
  } catch (e) {
    MV.log("取り込み失敗:", e && e.message);
    MV.ui.toast(`⚠ 取り込めませんでした: ${e && e.message ? e.message : e}`);
  }
  MV.S.plan = null;               // 素材が変わったら組み立て直し
  MV.ui.renderAll();
};

/* ---------- 動画(インタビュー / インサート) ---------- */
MV.media.addVideos = async (slot, files) => {
  const L = window.MZ_LIMITS || {};
  const list = slot === "itv" ? MV.S.interviews : MV.S.inserts;
  const max = slot === "itv" ? (L.maxVlogInterviews || 1) : (L.maxVlogInserts || 5);
  const labelJa = slot === "itv" ? "インタビュー" : "インサート映像";

  for (const f of files) {
    if (MV.media.kindOf(f) !== "video") {
      MV.ui.toast(`⚠ ${f.name} は動画ではありません`);
      continue;
    }
    if (list.length >= max) {
      MV.ui.toast(L.member || L.unlimited
        ? `${labelJa}は${max}${slot === "itv" ? "人" : "本"}までです`
        : `ゲストは${labelJa}${max}${slot === "itv" ? "人" : "本"}まで。無料登録で増やせます`);
      break;
    }
    // 重複判定は同じ枠の中だけ。インタビュー動画の別部分を映像として使うのは正当
    const key = `${f.name}|${f.size}|${f.lastModified}`;
    if (list.some(c => MV.clipKey(c) === key)) {
      MV.ui.toast(`${f.name} は読み込み済みです`);
      continue;
    }

    const clip = {
      id: MV.nextId++, slot, file: f,
      name: f.name, size: f.size, lastModified: f.lastModified,
      url: URL.createObjectURL(f),
      video: document.createElement("video"),
      duration: 0, width: 0, height: 0,
      trimIn: 0, trimOut: null,
      isShow: false, quality: null, show: null, thumb: null,
    };
    const v = clip.video;
    v.src = clip.url;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");     // iOS Safariは属性も必要
    v.preload = MV.isIOS ? "metadata" : "auto";

    try {
      // タイムアウトが無いと、1本詰まっただけで残りの取り込みが全部止まる
      await new Promise((res, rej) => {
        const tm = setTimeout(() => rej(new Error("読み込みに時間がかかりすぎました")), 15000);
        v.onloadedmetadata = () => { clearTimeout(tm); res(); };
        v.onerror = () => { clearTimeout(tm); rej(new Error("動画として読み込めません（コーデック非対応の可能性）")); };
        v.load();   // iOS Safari は preload="metadata" でも load() が要ることがある
      });
    } catch (e) {
      MV.ui.toast(`⚠ ${f.name}: ${e.message}`);
      URL.revokeObjectURL(clip.url);
      continue;
    }

    // Vlog専用の1本あたりの上限。Switcher/ReAngleのmaxVideoSecとは別枠(2026-07-20)
    if (v.duration > (L.maxVlogClipSec || 300)) {
      MV.ui.toast(`⚠ ${f.name} は約${Math.round(v.duration / 60)}分です。`
        + (L.member || L.unlimited
            ? `1本${L.vlogClipLimitLabel || "10分"}までです。`
            : `ゲストは${L.vlogClipLimitLabel || "5分"}・無料登録で10分まで使えます。`)
        + "使いたい場面だけ切り出してからお試しください");
      URL.revokeObjectURL(clip.url);
      continue;
    }

    clip.duration = v.duration;
    clip.width = v.videoWidth;
    clip.height = v.videoHeight;
    // 長い映像は本番の通し演技であることが多い。ショウ動画の候補として印をつけておく
    if (slot === "ins" && v.duration >= 180) clip.isShow = true;

    list.push(clip);
    // 直列に並べる。10本同時にseekするとデコーダが10個起動してiPhoneが落ちる
    MV.media._thumbQ = (MV.media._thumbQ || Promise.resolve())
      .then(() => MV.media.makeThumb(clip))
      .catch(() => {});
  }
};

/* サムネ(168×100)。seek→描画。失敗しても致命ではないので握りつぶす */
MV.media.makeThumb = async clip => {
  try {
    const v = clip.video;
    const t = Math.min(clip.duration * 0.25, 3);
    await new Promise(res => {
      const done = () => { clearTimeout(tm); res(); };
      const tm = setTimeout(done, 2500);
      v.addEventListener("seeked", done, { once: true });
      v.currentTime = Math.max(0, Math.min(clip.duration - 0.05, t));
    });
    const cv = document.createElement("canvas");
    cv.width = 336; cv.height = 189;
    const s = Math.max(cv.width / v.videoWidth, cv.height / v.videoHeight);
    cv.getContext("2d").drawImage(v, (cv.width - v.videoWidth * s) / 2,
      (cv.height - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s);
    clip.thumb = cv.toDataURL("image/jpeg", 0.72);
    if (MV.isIOS) v.preload = "none";     // 取り終えたらメモリを返す
    MV.ui.updateThumb(clip);              // DOM全体は作り直さない
  } catch (_) { /* サムネなしで続行 */ }
};

/* ---------- BGM ---------- */
MV.media.addAudios = async files => {
  const max = (window.MZ_LIMITS || {}).maxVlogBgm || 3;
  for (const f of files) {
    if (MV.media.kindOf(f) !== "audio") { MV.ui.toast(`⚠ ${f.name} は音声ではありません`); continue; }
    if (MV.S.bgms.length >= max) { MV.ui.toast(`BGMは${max}曲までです`); break; }
    const key = `${f.name}|${f.size}|${f.lastModified}`;
    if (MV.S.bgms.some(b => `${b.name}|${b.size}|${b.lastModified}` === key)) {
      MV.ui.toast(`${f.name} は読み込み済みです`);
      continue;
    }
    // 長さだけ先に取る(デコードは組み立て時。ここで全曲デコードするとiPhoneが厳しい)
    const url = URL.createObjectURL(f);
    const a = document.createElement("audio");
    a.src = url; a.preload = "metadata";
    let dur = 0;
    try {
      await new Promise((res, rej) => {
        const tm = setTimeout(() => rej(new Error("読み込みに時間がかかりすぎました")), 15000);
        a.onloadedmetadata = () => { clearTimeout(tm); res(); };
        a.onerror = () => { clearTimeout(tm); rej(new Error("音声として読み込めません")); };
        a.load();
      });
      dur = a.duration;
    } catch (e) {
      MV.ui.toast(`⚠ ${f.name}: ${e.message}`);
      URL.revokeObjectURL(url);
      continue;
    }
    MV.S.bgms.push({
      id: MV.nextId++, file: f, name: f.name, size: f.size,
      lastModified: f.lastModified, url, duration: dur, buffer: null,
    });
  }
};

/* ---------- ロゴ ---------- */
MV.media.addLogo = async f => {
  if (!f) return;
  const L = window.MZ_LIMITS || {};
  if (!(L.maxVlogLogos > 0)) {
    MV.ui.toast("ロゴの追加は無料登録が必要です。 " + "登録すると団体ロゴを1枚まで使えます");
    return;
  }
  if (MV.media.kindOf(f) !== "image") { MV.ui.toast(`⚠ ${f.name} は画像ではありません`); return; }
  if (MV.S.logo) MV.media.remove("logo", "logo");
  await MV.logo.load(f);
};

/* ---------- 取り外し ---------- */
MV.media.remove = (kind, id) => {
  if (kind === "logo") {
    if (MV.S.logo && MV.S.logo.srcUrl) URL.revokeObjectURL(MV.S.logo.srcUrl);
    MV.S.logo = null;
  } else if (kind === "bgm") {
    const i = MV.S.bgms.findIndex(b => String(b.id) === String(id));
    if (i >= 0) { URL.revokeObjectURL(MV.S.bgms[i].url); MV.S.bgms.splice(i, 1); }
  } else {
    const list = kind === "itv" ? MV.S.interviews : MV.S.inserts;
    const i = list.findIndex(c => String(c.id) === String(id));
    if (i >= 0) {
      URL.revokeObjectURL(list[i].url);
      list[i].video.src = "";
      list.splice(i, 1);
    }
  }
  MV.S.plan = null;
  MV.ui.renderAll();
};
