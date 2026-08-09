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
    exportPreset: null,   // "s30" | "short" | "mid" | "full"
    mobileLengthDecided: false, // 仕上げの好みで完成尺を決めたか(素材変更で戻す)
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
    /* おまかせの「仕上げの好み」(色/配置/切り替えの多さ)を選び終えたか
       (2026-08-03 優さん承認案。旧 wipePicked=ワイプ限定の割り当てを置き換え、
       3モードとも自走の前に1画面だけ挟む)。
       非永続: クリップidは読込ごとに変わり slots/wipeMainId 等も保存されないため、
       次に開いたときはもう一度(おすすめ選択済みで)確認してもらう */
    finishPicked: false,
    /* 「同じ演奏ではないようです」の2択で①同期なしを選んだ印(2026-08-02)。
       非永続: 素材が変われば疑いも判断もやり直し(resetEasyDone が落とす) */
    syncDoubtAccepted: false,
    /* Phase 3: 仕上げ */
    colorOn: true, colorStrength: 0.8,   // カラー自動マッチは初期ON(同期後に自動実行)
    horizonOn: true,      // 傾きの値を映像へ当てるか(手動値の適用も兼ねる。常にON)
    /* 傾きを自動で検出して直すか(2026-08-04 優さん指示で選べるようにした)。
       既定ON。「仕上げの好み」で毎回選び直すので保存しない ─ 一度OFFにした人が
       次に開いたときも黙ってOFFのまま、を作らない(horizonOn で踏んだ轍) */
    autoTilt: true,
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

/* 元ファイルの同一性と、編集中の素材インスタンスを分ける。
   管理者の検証では同じ動画を最大3枠へ入れるため、2本目以降だけ
   instanceKeyを持たせる。通常ユーザーの重複判定はsourceKeyで行う。 */
MC.sourceKey = c => `${c.name}|${c.size}|${c.lastModified}`;
MC.clipKey = c => c.instanceKey || MC.sourceKey(c);
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

/* ============ カメラの属性は2軸(2026-08-05 優さん指示) ============
   「①固定カメラか動きありか」「②撮影対象」をプルダウン2つで選ぶ。
   前版の5択(1択に全部畳む形)は、撮り方と対象が1つの軸に混ざって
   「三脚の寄りだけど途中から手持ちにした」が選べなかった。
   ★ 歩き撮りは選択肢から消えた ─ 「動きあり×ブレが多い」から自動で
     導出する(director.js の厳選門)。人に聞く必要がない */
MC.TARGETS = [
  { v: "auto",     label: "指定なし",           hint: "自動で判断します" },
  { v: "front",    label: "正面全体",           hint: "正面から全体が写る。カット割りの背骨(多めに使います)" },
  { v: "altwide",  label: "他の場所からの全体", hint: "側面・俯瞰など別の場所からの全体(固定なら1〜2番手として使います)" },
  { v: "spice",    label: "メジャー・ピット",   hint: "指揮や前列の打楽器(見せ場だけ・全体の1割まで)" },
  { v: "operator", label: "カメラマン操作",     hint: "演者を追いかけて抜くカメラ(ソロでは必ず使います)" },
  /* プレイヤー視点(2026-08-05 優さん追加指示)。奏者装着のPOV。隊形は見えず
     臨場感が売り ─ 厳選門(良い窓だけ・クールダウン)で短い差し込みとして扱う */
  { v: "pov",      label: "プレイヤー視点",     hint: "奏者につけたカメラ(見せ場に短く差し込みます)" },
];
/* 撮り方は現場の言葉で(2026-08-05 優さん実機指示「三脚/ジンバル/カメラマン/
   どれでもない」)。内部の rig へは applyAxes が畳む */
MC.MOTIONS = [
  { v: "auto",      label: "自動判定",   hint: "映像から判定します" },
  { v: "tripod",    label: "三脚",       hint: "置いて固定で撮った" },
  /* 手持ち(2026-08-05 優さん決定)。スマホを手で持って撮った=最頻ケース */
  { v: "handheld",  label: "手持ち",     hint: "スマホやカメラを手で持って撮った" },
  { v: "gimbal",    label: "ジンバル",   hint: "歩き・移動しながら撮った" },
  /* 旧ラベル「カメラマン」は被写体軸の「カメラマン操作」と混線した(レビューP1)。
     動作の言葉に改名。値は cameraman のまま(保存互換) */
  { v: "cameraman", label: "パン・ズームで追った", hint: "三脚ごしにカメラを振って追った" },
  /* アクションカメラ(2026-08-05 優さん追加指示)。体・楽器に装着 */
  { v: "action",    label: "アクションカメラ", hint: "体や楽器につけて撮った" },
  { v: "other",     label: "どれでもない", hint: "当てはまらない(自動で判定します)" },
];

/* 2軸 → 役割/出番/撮り方 への展開。「指定なし/自動判定」は触らない(自動へ委ねる) */
/* @param {"target"|"motion"} [axis] 変えた軸だけ展開する(省略=両軸)。
   ★「指定なし/自動判定」へ**戻した**ときは展開先も戻す(2026-08-05 レビューP1)。
     戻さないと spice で書いた role=pit・freq=less が残留し、spiceIds には
     入らない(=8%上限も窓条件も無い)まま pit の +1.2 だけが効く逆転が起きていた。
   ★ただし軸を限定できるようにする ─ 無条件に両軸を書くと、
     「じぶんで微調整」で role を手で変えた人が motion だけ触ったときに
     role まで戻されてしまう(変えていない軸の展開先は触らない) */
MC.applyAxes = (c, axis) => {
  if (!axis || axis === "target") {
    const t = c.target || "auto";
    /* pov は役を決めない ─ 引き/寄りの物差しで測らず、厳選門の専用規則で扱う */
    const roleMap = { front: "wide", altwide: "wide", spice: "pit", operator: "close", pov: "auto" };
    if (t !== "auto") {
      c.role = roleMap[t];
      c.freq = (t === "spice" || t === "pov") ? "less" : "auto";
    } else {
      c.role = "auto";
      c.freq = "auto";
    }
  }
  if (!axis || axis === "motion") {
    const m = c.motion || "auto";
    if (m !== "auto") {
      /* fixed/moving は v1.101.0 の旧値(互換のため受ける) */
      c.rig = (m === "tripod" || m === "fixed") ? "fixed"
            : m === "other" ? "auto" : "operated";
    } else {
      c.rig = "auto";
    }
  }
};

/* 旧データの移行: v1.100.0 の kind(5択)・v1.101.0 の motion(固定/動きあり)・
   それ以前の role だけの保存を現形式へ写す。読むだけで書き戻しはしない
   (次の saveState が新形式で保存する) */
MC.migrateAxes = c => {
  if (c.motion === "fixed") c.motion = "tripod";
  else if (c.motion === "moving") c.motion = "gimbal";
  if (c.target) return;
  const k = c.kind;
  const fromKind = {
    wide:     ["front", null],
    opposite: ["altwide", null],
    follow:   ["operator", null],
    spice:    ["spice", null],
    roam:     ["operator", "gimbal"],
  }[k];
  if (fromKind) {
    c.target = fromKind[0];
    if (fromKind[1]) c.motion = fromKind[1];
    MC.applyAxes(c);   // ★移行したら展開まで通す(2026-08-05 レビューP1。旧値の残留で食い違わせない)
    return;
  }
  const fromRole = { wide: "front", close: "operator", pit: "spice" }[c.role];
  if (fromRole) { c.target = fromRole; MC.applyAxes(c); }
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
      target: c.target || "auto", motion: c.motion || "auto",
      /* 本人が選んだ印(2026-08-06 レビューP1-2)。保存しないと再読込のたびに
         全クリップが「解析で上書きしてよい」対象へ戻る ─
         「UIの通行判定に消える値を使わない」と同型の穴 */
      targetByUser: !!c.targetByUser, motionByUser: !!c.motionByUser,
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
      clip.target = hit.target || null;
      clip.motion = hit.motion || null;
      clip.targetByUser = !!hit.targetByUser;
      clip.motionByUser = !!hit.motionByUser;
      clip.kind = hit.kind || null;          // 旧5択(v1.100.0)の保存。移行にだけ使う
      clip.role = hit.role || "auto";
      clip.freq = hit.freq || "auto";
      clip.rig = hit.rig || "auto";
      MC.migrateAxes(clip);                  // 旧kind/roleの保存を2軸へ写す(2026-08-05)
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
