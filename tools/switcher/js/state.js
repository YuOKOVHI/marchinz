"use strict";
/* ============ MarchCut 状態管理 ============ */

window.MC = {
  S: {
    clips: [],            // Clipオブジェクト(media.js参照)
    mode: null,           // 最初の選択(vertical=縦型 / switch=自動スイッチング)
    layoutId: "v3",       // 縦型の初期は3分割縦積み
    preset: "9x16",
    audioClipId: null,    // 書き出し/再生に使う音声のクリップ
    audioPickedByUser: false,  // 手で選んだか。false の間は「おすすめ」に追従する
    refClipId: null,      // 同期の基準クリップ
    audioDecided: false,  // 「この音で進める」を押したか(音声を選ぶフェーズ。非永続)
    slots: [null, null, null],  // スロットi に表示するクリップid
    trimIn: 0, trimOut: null,   // 書き出し範囲(グローバル秒)。null=末尾まで
    t: 0, playing: false,
    /* 長さと開始位置を選ぶフェーズ(2026-07-31 優さん指示)。
       showIn/showOut = 音で見つけた「演奏そのもの」の範囲(グローバル秒)。
       trimIn/trimOut は**そこから切り出した書き出し範囲**なので別に持つ。
       これを分けないと、長さを選び直すたびに元の演奏範囲が失われて
       だんだん短くなっていく(選び直せなくなる) */
    showIn: null, showOut: null,
    exportPreset: null,   // "short" | "mid" | "full"
    startKey: null,       // "start"|"climax"|"ballad"|"drumline"|"solo"|"finale"|"manual"
    startAt: null,        // startKey==="manual" のときの開始位置(グローバル秒)
    lengthDecided: false, // 「この長さで進める」を押したか
    /* Phase 2: スイッチング/ワイプ */
    cutList: [],                // [{t, clipId, trans:'cut'|'dissolve', dur}] 昇順・セグメント開始
    beatsPerBar: 4,
    cutLevel: 2,                // 切替頻度 1:少なめ 2:おすすめ 3:多め
    wipeMainId: null,           // ワイプカメラモードのメイン(固定1カメラ。2026-07-24)
    wipeClipId: null,           // ワイプの小窓カメラ(1つ目)
    wipeClipId2: null,          // ワイプの小窓カメラ(2つ目、null=なし)
    wipePos: "br", wipePos2: "bl", wipeSize: 0.32,
    /* おまかせ×ワイプの「メイン/右下ワイプ」の割り当てを済ませたか(2026-08-02
       優さん指示: おまかせでもワイプだけはここを本人が選ぶ)。
       非永続: クリップidは読込ごとに変わり wipeMainId 等も保存されないため、
       次に開いたときはもう一度選んでもらう */
    wipePicked: false,
    /* Phase 3: 仕上げ */
    colorOn: true, colorStrength: 0.8,   // カラー自動マッチは初期ON(同期後に自動実行)
    horizonOn: true,      // 自動傾き修正(既定ON。2026-07-23 優さん指示)
    /* 傾きの確認を飛ばしたか(2026-08-01)。ゲートは外れるが「確認ずみ」には
       ならない ─ 工程表の丸は未確認のまま残り、いつでも戻って直せる。
       保存しない: 次に開いたときは、もう一度ひととおり見てもらう */
    tiltSkipped: false,
    filterId: "marchinz",  // MarchinZルックが初期フィルター
    autoTrim: true,        // 最初と最後の自動カット(サリュートIN+音終了10秒後OUT)
    /* 境界線(分割レイアウトのセル間+ワイプ小窓の枠) */
    borderOn: true, borderColor: "#ffffff", borderW: 2,
  },
  caps: { h264: false, aac: false },
  testMode: false,
};

/* 端末判定(iPhone/iPad実機とタッチ環境) */
/* 端末の判定は shared/limits.js の MZDevice が唯一の正本(2026-08-01)。
   MC.isIOS という名前は呼び出しが多いので残し、中身だけ寄せる。
   ★ limits.js は index.html でこれより先に読まれる(script順) */
MC.isIOS = window.MZDevice ? MZDevice.ios
  : (/iP(hone|ad|od)/.test(navigator.userAgent) ||
     (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
MC.isTouch = MC.isIOS || navigator.maxTouchPoints > 0;

MC.PRESETS = {
  "9x16": { w: 1080, h: 1920, label: "縦 9:16" },
  "16x9": { w: 1920, h: 1080, label: "横 16:9" },
  "1x1":  { w: 1080, h: 1080, label: "正方形 1:1" },
};

/* clip.video のシークを直列にする。傾き(horizon)と色そろえ(colormatch)は
   同じ <video> の onseeked を上書きし合うため、同時に走ると片方が必ず
   2秒タイムアウトへ落ち、しかも誤った時刻のフレームで統計を取る
   (2026-07-28 レビュー指摘)。速度の話ではなく、無言で結果が狂う競合 */
MC._seekLock = Promise.resolve();
MC.withSeekLock = fn => {
  const run = MC._seekLock.then(fn, fn);
  MC._seekLock = run.then(() => {}, () => {});
  return run;
};

/* タイマー節流(非表示タブ)の影響を受けないyield */
MC.yield = () => new Promise(r => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r();
  ch.port2.postMessage(0);
});

/* dequeueイベント待ち(タイムアウト付き) */
MC.waitDequeue = (codec, ms = 100) => new Promise(r => {
  const h = () => { clearTimeout(tm); r(); };
  codec.addEventListener("dequeue", h, { once: true });
  const tm = setTimeout(() => { codec.removeEventListener("dequeue", h); r(); }, ms);
});

MC.clipKey = c => `${c.name}|${c.size}|${c.lastModified}`;
MC.getClip = id => MC.S.clips.find(c => c.id === id) || null;
MC.debug = [];
/* 不具合のご連絡用にログを残す(端末内のみ)。
   全経路をここへ通し、必ず400件で打ち切る(エラーが連続しても膨らませない) */
MC.pushDebug = line => {
  MC.debug.push(`${new Date().toLocaleTimeString("ja-JP")} ${line}`);
  if (MC.debug.length > 400) MC.debug.splice(0, MC.debug.length - 400);
};
MC.log = (...a) => {
  console.log("[MC]", ...a);
  const line = a.map(x => {
    if (typeof x === "string") return x;
    // 循環参照(VideoFrame等)でも行ごと失わないようにする
    try { return JSON.stringify(x); } catch (e) { return String(x); }
  }).join(" ");
  MC.pushDebug(line);
};

/* 共通デマックス(tools/shared/mp4source.js)のログをこのツールのデバッグ欄へ流す */
MZ_MP4.setLogger(msg => MC.log(msg));
/* 未捕捉のエラーもログへ(画面から見えるようにする) */
window.addEventListener("error", e => {
  MC.pushDebug(`[error] ${e.message} @${(e.filename || "").split("/").pop()}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", e => {
  MC.pushDebug(`[error] ${(e.reason && e.reason.message) || e.reason}`);
});

/* タイムライン全長(全クリップ終端の最大)。静止画(duration=0)は数えない */
MC.timelineDuration = () => {
  const cs = MC.S.clips.filter(c => !c.isImage);
  return cs.length ? Math.max(...cs.map(c => c.offset + c.duration)) : 0;
};

MC.trimRange = () => {
  const dur = MC.timelineDuration();
  const tIn = Math.max(0, Math.min(MC.S.trimIn, dur));
  const tOut = Math.min(MC.S.trimOut == null ? dur : MC.S.trimOut, dur);
  return [tIn, Math.max(tIn + 0.1, tOut)];
};

/* 現在レイアウトで実際に使われているクリップ(重複なし)。
   スイッチング/ワイプはカットリストが全カメラを使い得るため全クリップ */
MC.activeClips = () => {
  const L = MC.LAYOUTS[MC.S.layoutId];
  if (L.type === "switch" || L.type === "wipe") return [...MC.S.clips];
  const ids = [...new Set(MC.S.slots.slice(0, L.n).filter(id => id != null))];
  return ids.map(MC.getClip).filter(Boolean);
};

MC.saveState = () => {
  try {
    /* ---- 再読込直後に「前回のつづき」を自分で消さない(2026-07-29 優さん実機) ----
       File はブラウザに保存できないので、再読込すると MC.S.clips も cutList も空になる。
       その状態で saveState が走ると clips:[] / cutList:[] を書き込み、
       **前回の同期とカット割を自分で消してしまう**。
       実際の順番はこうだった:
         書き出しが62%で落ちる → 再読込 → 「つづきがあります」の案内は正しく出る
         → モードのカードをタップ(chooseMode が saveState を呼ぶ ui.js:2236)
         → ここで保存が空になる → 同じ動画を選び直しても照合先が無い
       素材が1本も無いときは、前回の clips / cutList をそのまま残す。
       本当に捨てたいときは「最初からやり直す」が localStorage を消すので影響しない */
    let prev = null;
    try { prev = JSON.parse(localStorage.getItem("marchcut_project") || "null"); } catch (_) {}
    const clipsNow = MC.S.clips.map(c => ({
      key: MC.clipKey(c), offset: c.offset, confidence: c.confidence,
      syncMethod: c.syncMethod, pan: c.pan,
      role: c.role || "auto", freq: c.freq || "auto", rig: c.rig || "auto",
      colorT: c.colorT || null, rot: c.rot || 0, tiltOk: !!c.tiltOk,
    }));
    const cutNow = MC.S.cutList.map(e => {
      const c = MC.getClip(e.clipId);
      return c ? { t: e.t, key: MC.clipKey(c), trans: e.trans, dur: e.dur } : null;
    }).filter(Boolean);
    const keepPrev = !clipsNow.length && prev
      && Array.isArray(prev.clips) && prev.clips.length > 0;
    localStorage.setItem("marchcut_project", JSON.stringify({
      /* 作るものの種類(2026-08-01)。それまで保存していなかった ─
         モード選択が起動時の必須画面だったので、毎回そこで選び直していたから。
         入口からその画面を外した以上、覚えていないと
         「縦型を選んだのに次に開いたら横型に戻る」ことになる */
      mode: MC.S.mode,
      layoutId: MC.S.layoutId, preset: MC.S.preset, exportQuality: MC.S.exportQuality,
      trimIn: MC.S.trimIn, trimOut: MC.S.trimOut,
      beatsPerBar: MC.S.beatsPerBar, cutLevel: MC.S.cutLevel,
      wipePos: MC.S.wipePos, wipePos2: MC.S.wipePos2, wipeSize: MC.S.wipeSize,
      autoTrim: MC.S.autoTrim,
      borderOn: MC.S.borderOn, borderColor: MC.S.borderColor, borderW: MC.S.borderW,
      colorOn: MC.S.colorOn, colorStrength: MC.S.colorStrength, filterId: MC.S.filterId,
      horizonOn: MC.S.horizonOn,
      /* 長さと開始位置の選択(2026-07-31)。trimIn/trimOut と同じく
         「素材が0本のときは書き戻さない」の保護に乗せる(下の keepPrev) */
      showIn: MC.S.showIn, showOut: MC.S.showOut,
      exportPreset: MC.S.exportPreset, startKey: MC.S.startKey, startAt: MC.S.startAt,
      lengthDecided: MC.S.lengthDecided,
      // クリップidは読込順で変わるためkeyで保存
      clips: keepPrev ? prev.clips : clipsNow,
      cutList: keepPrev ? (prev.cutList || []) : cutNow,
      // 範囲も同じ理由で守る(空の状態で0/nullを書き戻さない)
      ...(keepPrev ? {
        trimIn: prev.trimIn ?? 0, trimOut: prev.trimOut ?? null,
        showIn: prev.showIn ?? null, showOut: prev.showOut ?? null,
        exportPreset: prev.exportPreset ?? null, startKey: prev.startKey ?? null,
        startAt: prev.startAt ?? null,
        lengthDecided: prev.lengthDecided ?? false,
      } : {}),
    }));
  } catch (e) { /* localStorage不可でも動作は継続 */ }
};

/* 再読込時: 同一ファイル(名前|サイズ|更新時刻)なら同期結果を復元 */
MC.restoreClipState = clip => {
  try {
    const saved = JSON.parse(localStorage.getItem("marchcut_project") || "{}");
    const hit = (saved.clips || []).find(s => s.key === MC.clipKey(clip));
    if (hit) {
      clip.offset = hit.offset || 0;
      clip.confidence = hit.confidence;
      clip.syncMethod = hit.syncMethod || "未同期";
      clip.pan = hit.pan == null ? 0.5 : hit.pan;
      clip.role = hit.role || "auto";
      clip.freq = hit.freq || "auto";
      clip.rig = hit.rig || "auto";
      clip.colorT = hit.colorT || null;
      clip.rot = hit.rot || 0;
      clip.tiltOk = !!hit.tiltOk;
    }
    return !!hit;
  } catch (e) { return false; }
};

/* 今回の読み込みで何がどこまで戻ったか。トーストの文言を事実に合わせるため、
   推測ではなくここで実際の結果を記録する(2026-07-21 レビュー指摘) */
MC.restoreInfo = { sync: 0, cuts: false, trim: false };

/* 書き出し範囲(IN/OUT)の復元。保存はしていたのに起動時に読み戻していなかった
   ため、「書き出し範囲も復元しました」が事実と違っていた(同レビュー指摘)。
   素材が1本でも復元できたときだけ戻す(別の動画に範囲だけ残ると事故る) */
MC.restoreTrim = () => {
  MC.restoreInfo.trim = false;
  if (!MC.S.clips.some(c => c.restored)) return;
  if (MC.S.trimIn > 0.05 || MC.S.trimOut != null) return;   // すでに指定済みなら触らない
  try {
    const saved = JSON.parse(localStorage.getItem("marchcut_project") || "{}");
    const hasTrim = (saved.trimIn > 0.05) || (saved.trimOut != null);
    if (!hasTrim) return;
    MC.S.trimIn = saved.trimIn || 0;
    MC.S.trimOut = saved.trimOut == null ? null : saved.trimOut;
    /* 演奏そのものの範囲と、選んだ長さ・始まりも一緒に戻す。
       これが戻らないと、再開したときに「長さと開始位置」の画面が
       候補を作れず(showIn/showOut が無い)、選び直しができない */
    MC.S.showIn = saved.showIn == null ? null : saved.showIn;
    MC.S.showOut = saved.showOut == null ? null : saved.showOut;
    MC.S.exportPreset = saved.exportPreset || null;
    MC.S.startKey = saved.startKey || null;
    MC.S.startAt = saved.startAt == null ? null : saved.startAt;
    MC.S.lengthDecided = !!saved.lengthDecided;
    MC.restoreInfo.trim = true;
  } catch (e) {}
};

/* クリップ読込後: 保存済みカットリストをkey→idで復元(全key解決時のみ) */
MC.restoreCutList = () => {
  MC.restoreInfo.cuts = false;
  if (MC.S.cutList.length) return;
  try {
    const saved = JSON.parse(localStorage.getItem("marchcut_project") || "{}");
    if (!saved.cutList || !saved.cutList.length) return;
    const byKey = new Map(MC.S.clips.map(c => [MC.clipKey(c), c.id]));
    const cuts = saved.cutList.map(e =>
      byKey.has(e.key) ? { t: e.t, clipId: byKey.get(e.key), trans: e.trans, dur: e.dur } : null);
    if (cuts.every(Boolean)) { MC.S.cutList = cuts; MC.restoreInfo.cuts = true; }
  } catch (e) {}
};
