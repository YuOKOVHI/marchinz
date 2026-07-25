"use strict";
/* ============ UI描画とイベント ============ */

MC.ui = {};
MC.ui.$ = s => document.querySelector(s);

MC.ui.toast = msg => {
  const el = MC.ui.$("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(MC.ui._toastTm);
  MC.ui._toastTm = setTimeout(() => el.classList.remove("show"), 3500);
};

/* 書き出し完了カード。iOS(共有可)は「動画を保存」タップで初めて保存する */
/* プラン上の書き出し上限に当たったときの案内。
   ゲストには登録でどう変わるかまで見せる(ただ断らない) */
MC.ui.showExportLimitHelp = (wantSec, lim) => {
  const $ = MC.ui.$;
  $("#doneCard").hidden = false;
  $("#saveBtn").style.display = "none";
  const dl = $("#downloadBtn"); if (dl) dl.style.display = "none";
  $("#doneText").innerHTML =
    `<span class="warn">書き出せるのは${MC.ui.esc(lim.exportLimitLabel)}までです`
    + `（いまの範囲は${MC.ui.fmtTime(wantSec)}）</span>`;
  const note = $("#doneNote");
  if (lim.member) {
    note.textContent = "「ここから書き出す IN」「ここまで OUT」で範囲を狭めてください。";
  } else {
    note.innerHTML = "「ここから書き出す IN」「ここまで OUT」で範囲を狭めてください。"
      + '無料登録すると8分30秒まで書き出せます（ショウ全体が入ります）。 '
      + '<a href="/#signup">無料登録</a>';
  }
};

/* 端末のメモリでは収まらない長さのときの案内。/* 端末のメモリでは収まらない長さのときの案内。
   ただ断るのではなく、次の一手(範囲を狭める/パソコンで開く)まで書く */
MC.ui.showLongExportHelp = (okMin, mb) => {
  const $ = MC.ui.$;
  $("#doneCard").hidden = false;
  $("#saveBtn").style.display = "none";
  const dl = $("#downloadBtn"); if (dl) dl.style.display = "none";
  $("#doneText").innerHTML =
    `<span class="warn">この端末では書き出せない長さです（約${mb}MB）</span>`;
  /* 実測が失敗した理由を小さく添える。実機で原因を特定するための診断表示
     (2026-07-24: iPhoneでディスク直書きが効かない原因調査) */
  const diag = MC.exporter._opfsProbeErr;
  $("#doneNote").textContent =
    `スマホ・タブレットは動画を丸ごとメモリに載せるため、${okMin}分ほどが上限です。`
    + `「ここから書き出す IN」「ここまで OUT」で範囲を狭めるか、`
    + `パソコンのChromeで開くと最後まで書き出せます。`
    + (diag ? `〔診断: ${diag}〕` : "");
};

/* ============ 書き出しの全画面(案B / 2026-07-24) ============
   open()   : 書き出し開始時に「書き出し中」画面を全画面で出す
   done()   : 成功したら同じ画面内で「保存」画面へ切り替える
   fail()   : 失敗はMZPのfail表示(#eoProgress内)が出るので閉じるボタンだけ出す
   close()  : 畳む。パネル側のdoneCard/エラーログは従来どおり残っているので、
              閉じたあとも状態は見える */
MC.ui.exportOverlay = {
  open() {
    const el = MC.ui.$("#exportOverlay");
    if (!el) return;
    MC.ui.$("#eoTitleText").textContent = "書き出し中…";
    MC.ui.$("#eoTitleIcon").className = "fa-solid fa-file-export";
    MC.ui.$("#eoRun").hidden = false;
    MC.ui.$("#eoDone").hidden = true;
    MC.ui.$("#eoClose").hidden = true;
    MC.ui.$("#eoCancel").style.display = "";
    el.hidden = false;
    document.body.classList.add("mz-export-open");
  },
  done() {
    const el = MC.ui.$("#exportOverlay");
    if (!el || el.hidden) return;
    MC.ui.$("#eoTitleText").textContent = "できあがりました";
    MC.ui.$("#eoTitleIcon").className = "fa-solid fa-circle-check eo-check";
    MC.ui.$("#eoRun").hidden = true;
    MC.ui.$("#eoDone").hidden = false;
    MC.ui.$("#eoClose").hidden = false;
  },
  fail() {
    const el = MC.ui.$("#exportOverlay");
    if (!el || el.hidden) return;
    MC.ui.$("#eoTitleText").textContent = "書き出せませんでした";
    MC.ui.$("#eoTitleIcon").className = "fa-solid fa-triangle-exclamation";
    MC.ui.$("#eoCancel").style.display = "none";   // 失敗後の中止は意味がない
    MC.ui.$("#eoClose").hidden = false;            // 詳細はMZPのfail表示が出ている
  },
  close() {
    const el = MC.ui.$("#exportOverlay");
    if (!el) return;
    el.hidden = true;
    document.body.classList.remove("mz-export-open");
  },
};

MC.ui.showDone = res => {
  const share = MC.exporter.shareMode();
  const $ = MC.ui.$;
  $("#doneCard").hidden = false;
  /* オーバーレイの保存画面にも同じ内容を映す(2026-07-24 案B)。
     文言はパネル側(doneText/doneNote)を組み立ててからコピーする */
  const mirror = () => {
    const eo = $("#exportOverlay");
    if (!eo || eo.hidden) return;
    $("#eoDoneText").innerHTML = $("#doneText").innerHTML;
    $("#eoDoneNote").textContent = $("#doneNote").textContent;
    $("#eoSaveBtn").style.display = $("#saveBtn").style.display;
    const dl = $("#downloadBtn");
    $("#eoDownloadBtn").style.display = dl ? dl.style.display : "";
    MC.ui.exportOverlay.done();
  };
  /* ディスクへ直接書き出した場合は blob を持たない(メモリに溜めないため)。
     その場では既に保存が終わっているので、再保存の導線は出さない */
  if (res && res.saved) {
    $("#saveBtn").style.display = "none";
    const dl = $("#downloadBtn"); if (dl) dl.style.display = "none";
    $("#doneText").innerHTML = `<span class="ok">✓ 「${MC.ui.esc(res.name)}」を保存しました</span>`;
    $("#doneNote").textContent = "選んだ場所に書き出し済みです。";
    MC.ui.toast("✔ 書き出しが完了しました");
    mirror();
    return;
  }
  if (share) {
    // iOS等: 共有シート保存が主導線、ダウンロードも選べる
    $("#saveBtn").style.display = "inline-flex";
    $("#doneText").innerHTML = `<span class="ok">✓ 準備できました(${(res.blob.size / 1e6).toFixed(1)}MB)</span>`;
    $("#doneNote").textContent = "「動画を保存」で写真(カメラロール)やファイルへ。「ダウンロード」でファイル保存もできます。";
    MC.ui.toast("✔ 準備できました。保存を押してください");
  } else {
    // PC/Mac: 自動ダウンロード済み。再ダウンロードだけ出す
    $("#saveBtn").style.display = "none";
    $("#doneText").innerHTML = `<span class="ok">✓ 「${res.name}」を保存しました(${(res.blob.size / 1e6).toFixed(1)}MB)</span>`;
    $("#doneNote").textContent = "ダウンロードに保存されています(もう一度保存するには「ダウンロード」)。";
    MC.ui.toast("✔ 書き出しが完了しました");
  }
  mirror();
};

/* 保存の実行。iOSはWeb Shareで写真/ファイルへ、それ以外はダウンロード */
MC.ui.saveResult = async () => {
  const r = MC.exporter.lastResult;
  if (!r) return;
  if (MC.exporter.shareMode()) {
    try {
      /* すでに File(OPFSから取り出したもの)ならそのまま渡す。
         new File([blob]) は中身を丸ごとメモリへ複製するため、
         長尺だとここで OPFS 化の意味が消える(2026-07-23 Phase 1) */
      const file = (r.blob instanceof File && r.blob.name === r.name)
        ? r.blob
        : new File([r.blob], r.name, { type: r.type || r.blob.type });
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e && e.name === "AbortError") return;         // ユーザーがキャンセル
      MC.log("share失敗→ダウンロード:", e && e.message);
      MC.exporter.triggerDownload(r.blob, r.name);        // 最後の手段
    }
  } else {
    MC.exporter.triggerDownload(r.blob, r.name);
  }
  /* ここでは消さない。保存 → ダウンロード と続けて押されると2回目が失敗する
     (レビュー指摘 2026-07-23)。片付けは「次の書き出し」「やり直し」「起動時」で行う */
};

MC.ui.fmtTime = s => {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60), sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
};

/* innerHTMLへ流し込むファイル名等のHTMLエスケープ(自己XSS防止) */
MC.ui.esc = s => String(s).replace(/[&<>"']/g,
  ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

/* ファイル名を短く。拡張子は落とし、長ければ頭を残して末尾…にする
   (Timeline 3.mov → Timeline 3 / 長い名前 → 頭6文字…)。
   2026-07-23 優さん指示「今の半分でいい」。番号が見える方を優先 */
MC.ui.shortName = (name, max = 16) => {
  let s = String(name || "").replace(/\.[^.]{1,5}$/, "");   // まず拡張子(.mov等)を落とす
  if (s.length <= max) return s;                             // これで大半は十分短い
  return s.slice(0, max - 1) + "…";                          // それでも長い名前だけ末尾…
};

/* 最初からやり直す: 保存済みの設定(同期・カット割・範囲)ごと消す。
   「前回の続きが復元される」仕組みの対になる出口(2026-07-21 優さん指示) */
/* 復元されたことを画面に残す。トーストは3.4秒で消えるうえ1回きりで、
   見逃すと「同期し直し」に数分を無駄にする(2026-07-21 レビュー指摘)。
   何が戻ったかは MC.restoreInfo(実際の結果)だけで書く。
   推測で「書き出し範囲も復元」と言って事実と違っていたのが前版 */
MC.ui.renderRestoreNote = () => {
  const host = MC.ui.$("#dropSec");
  const old = document.getElementById("mzRestoreNote");
  if (old) old.remove();
  const info = MC.restoreInfo || {};
  if (!host || !info.sync) return;
  const got = [`同期（${info.sync}本）`];
  if (info.cuts) got.push("カット割");
  if (info.trim) got.push("書き出し範囲");
  const el = document.createElement("p");
  el.id = "mzRestoreNote";
  el.className = "mz-restore-note";
  el.innerHTML = '<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> '
    + `前回の続きから始められます（${got.join("・")}を復元しました）`;
  const slots = MC.ui.$("#clipSlots");
  if (slots) host.insertBefore(el, slots); else host.appendChild(el);
};

MC.ui.resetProject = () => {
  if (!confirm("最初からやり直します。\n\n読み込んだ動画を外し、同期・カット割・書き出し範囲の保存も消します。\n（動画ファイル自体は消えません）")) return;
  /* 先に素材を外す。removeClip は afterChange 経由で saveState() を呼ぶため、
     先に localStorage を消すと空データが書き戻されてしまう(レビュー指摘) */
  [...MC.S.clips].forEach(c => MC.media.removeClip(c.id));
  MC.S.trimIn = 0;
  MC.S.trimOut = null;
  MC.S.cutList = [];
  MC.restoreInfo = { sync: 0, cuts: false, trim: false };
  try { localStorage.removeItem("marchcut_project"); } catch (_) {}
  MC.exporter.releaseOpfs();   // 書き出し済みファイルもここで片付ける
  MC.ui.clearErrorLog();
  MC.ui.resetEasyDone();
  MC.ui.renderRestoreNote();
  MC.ui.renderAll();
  MC.ui.toast("まっさらな状態に戻しました");
};

/* 取り込んだ直後、次にすることが画面に入っていなければそこまで運ぶ。
   スマホは画面が狭く、追加した下に何があるか分からない(2026-07-21 優さん指示)。
   すでに見えているときは動かさない(勝手にスクロールされる不快感を避ける) */
/* 書き出せる長さに収まっているか点検し、超えていればその場で直せるようにする。
   「あとで弾く」のではなく「先に知らせて、ワンタップで直せる」形にする */
MC.ui.checkExportable = () => {
  const host = MC.ui.$("#easyStatus");
  const old = document.getElementById("mzExportWarn");
  if (old) old.remove();
  /* 範囲は自動トリム(サリュート検出)の結果をそのまま使うのが基本。
     書き出せる長さを超えたときだけ、ここで知らせて詰める(優さん指示)。
     効く上限は2つあり、厳しい方が効く:
       hardMax … 端末のメモリから来る物理上限(iPhoneで約8分41秒)
       roleMax … 会員種別の上限(登録8分30秒 / ゲスト5分 / 管理者は無制限) */
  const hardMax = MC.exporter.maxExportableSec();
  const roleMax = (window.MZ_LIMITS && MZ_LIMITS.maxExportSec) || Infinity;
  const limit = Math.min(hardMax, roleMax);
  if (!isFinite(limit)) return;                    // どちらも無制限(Macの管理者等)
  const [tIn, tOut] = MC.trimRange();
  const sec = Math.max(0, tOut - tIn);
  if (sec <= limit) return;                        // 収まっている=アルゴリズムの結果を尊重

  /* 詰める長さは「ショウ1本ぶん」の 8分30秒 を基本にする。
     この数字の根拠は**マーチングのショウが規定8分**であること(2026-07-23 優さん確認)。
     端末のメモリ上限から逆算した数字ではないので、端末が速くなっても変えない。
     ゲスト等で上限がさらに短ければそちらに従う */
  const SHOW_SEC = 510;                            // 8分30秒
  const fitSec = Math.min(limit, isFinite(roleMax) ? roleMax : SHOW_SEC);
  const byDevice = hardMax <= roleMax;             // どちらの制限で止まっているか
  const mm = Math.floor(fitSec / 60), ss = Math.round(fitSec % 60);
  const fitLabel = `${mm}分${String(ss).padStart(2, "0")}秒`;

  const box = document.createElement("div");
  box.id = "mzExportWarn";
  box.className = "mz-export-warn";
  box.innerHTML =
    '<p class="mzw-title"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> '
    + `いまの範囲(${MC.ui.fmtTime(sec)})は、この端末では書き出せません</p>`
    + '<p class="mzw-body">'
    + (byDevice
        ? `スマホ・タブレットは動画を丸ごとメモリに載せるため、${fitLabel}までです。`
          + "パソコンのChromeで開くと最後まで書き出せます。"
        : `いま書き出せるのは${fitLabel}までです。`)
    + "</p>"
    + '<button type="button" class="btn primary" id="mzwFit">'
    + `<i class="fa-solid fa-scissors"></i> INから${fitLabel}に詰める</button>`;
  host.appendChild(box);
  box.querySelector("#mzwFit").onclick = () => {
    /* INは動かさない。自動トリム(サリュート検出)が決めた「演奏の始まり」を
       尊重し、そこから fitSec ぶんだけ残す(2026-07-21 優さん指示) */
    const [i0] = MC.trimRange();
    MC.S.trimIn = i0;
    MC.S.trimOut = i0 + fitSec;
    MC.saveState();
    MC.ui.renderAll();
    MC.preview.seek(i0);
    MC.ui.toast(`INから ${fitLabel} に詰めました`);
    MC.ui.checkExportable();
  };
};

/* やさしいスクロール(2026-07-23 優さん指摘「ジャンプしすぎ」対応)。
   block:"center"は要素を画面中央へ運ぶ=大移動になりがち。
   対象が十分見えている(上部バーの下〜画面下80px)なら**動かさない**。
   見えていないときだけ、最小限(nearest)で寄せる */
MC.ui.gentleScrollTo = (el, block = "nearest") => {
  if (!el || el.offsetParent === null) return;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || 800;
  const topBar = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue("--mz-journey-h")) || 72;
  if (r.top >= topBar && r.top <= vh - 80) return;   // 見えている=動かさない
  el.scrollIntoView({ behavior: "smooth", block });
};

MC.ui.focusNextAction = () => {
  if (!MC.S.clips.length) return;
  /* 取り込んだ直後に傾きを測り、「直した後」を見せる(2026-07-23 優さん指示)。
     待たせないよう裏で走らせ、終わり次第プレビューへ反映する */
  MC.ui.autoDetectTilt();
  setTimeout(() => {
    const btn = MC.ui.$("#easyStartBtn");
    if (!btn || btn.offsetParent === null) return;
    const panel = btn.closest(".panel") || btn;
    const r = panel.getBoundingClientRect();
    if (r.top >= 60 && r.top <= (window.innerHeight || 800) - 120) return;
    MC.ui.gentleScrollTo(panel, "nearest");
    panel.classList.add("mz-focus-flash");
    setTimeout(() => panel.classList.remove("mz-focus-flash"), 1200);
  }, 260);   // サムネ生成でレイアウトが動くので少し待つ
};

/* おまかせ完了状態の解除。素材・モードが変わったら準備からやり直し */
MC.ui.resetEasyDone = () => {
  MC.S.audioDecided = false;   // 素材が変われば音声も選び直し(2026-07-24)
  if (!MC.S.easyDone) return;
  MC.S.easyDone = false;
  MC.ui.renderEasyButton();
};

/* 「なぜ上限があるのか」を実態に合わせて書く(2026-07-23 B-2)。
   OPFSへ逐次書ける端末ではメモリ上限が外れるので、理由をプラン側へ切り替える。
   嘘の理由を残さないために、必ず maxExportableSec() の実値から書く */
MC.ui.renderLimitWhy = () => {
  const el = document.querySelector(".mz-limit-why");
  if (!el) return;
  const hardMax = MC.exporter.maxExportableSec();
  const roleMax = (window.MZ_LIMITS && MZ_LIMITS.maxExportSec) || Infinity;
  const mmss = sec => {
    if (!isFinite(sec)) return "";
    const m = Math.floor(sec / 60), ss = Math.round(sec % 60);
    return ss ? `${m}分${String(ss).padStart(2, "0")}秒` : `${m}分`;
  };
  const icon = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i> ';
  if (isFinite(hardMax) && hardMax <= roleMax) {
    // 端末のメモリで頭打ちになる環境(OPFS非対応の古いブラウザ等)
    el.innerHTML = icon
      + `<b>3本まで・${mmss(hardMax)}まで</b>なのは、この端末では動画を丸ごとメモリに`
      + "載せて処理するためです。これを超えると書き出しの途中で止まってしまいます。"
      + "長いときはINとOUTで区切ってお使いください。";
    return;
  }
  if (isFinite(roleMax)) {
    // 端末側の制限は無い。残るのはプランの上限だけ
    el.innerHTML = icon
      + `<b>3本まで・${mmss(roleMax)}まで</b>お使いいただけます。`
      + "長いときはINとOUTで区切ってください。";
    return;
  }
  el.innerHTML = icon + "<b>3本まで</b>お使いいただけます。長さの上限はありません。";
};

MC.ui.renderAll = () => {
  MC.ui.applyGuestLocks();
  MC.ui.renderQualityPicker();
  MC.ui.renderPlacement();
  if (MC.ui._syncFloatPos) MC.ui._syncFloatPos();   // 素材の増減で位置が変わる
  {
    const prb = MC.ui.$("#projectResetBtn");
    if (prb) prb.hidden = !MC.S.clips.length;
  }
  /* スマホのフロートプレビューは素材があるときだけ(空の黒枠を浮かせない) */
  document.body.classList.toggle("mz-has-clips", MC.S.clips.length > 0);
  /* カット切替モードの入口はカットがあるときだけ */
  {
    const cmb = MC.ui.$("#cutModeBtn");
    if (cmb) cmb.hidden = !MC.S.cutList.length || MC.S.mode !== "switch";   // カット割は③だけ(2026-07-24)
  }
  MC.ui.renderClips();
  MC.ui.renderLimitWhy();
  MC.ui.renderAudio();
  MC.ui.renderEasyLead();
  MC.ui.renderLayout();
  MC.ui.renderFinish();
  MC.ui.renderExportMode();
  MC.ui.updateTransport();
  MC.timeline.render();
  MC.ui.refreshSetupTabs();
  MC.ui.$("#syncBtn").disabled = MC.S.clips.filter(c => !c.isImage).length < 2;
  MC.ui.$("#exportBtn").disabled = !MC.S.clips.length;
  {
    // タブを先頭へ出したので、素材ゼロでもボタンが見える。押せない状態にしておく
    const eb = MC.ui.$("#easyStartBtn");
    if (eb) eb.disabled = !MC.S.clips.length;
  }
  MC.ui.refreshJourney();
};

/* ---- ジャーニーバー(どのフェーズにいるかの常時表示) ---- */
MC.ui.JOURNEY_SECTIONS = { mat: "#dropSec", sync: "#syncSec", audio: "#audioSec", polish: "#layoutSec", export: "#exportSec" };

MC.ui.initJourney = () => {
  MZJourney.init({
    container: MC.ui.$("#workspace"),
    phases: [
      { id: "mat",    label: "動画を選ぶ",   hint: "3つまでまとめて選べます" },
      { id: "sync",   label: "同期と分析",   hint: "音のズレ合わせと素材の分析をします" },
      { id: "audio",  label: "音声を選ぶ",   hint: "試聴して「この音で進める」を押してください" },
      { id: "polish", label: "自動編集設定", hint: "設定はそのままでOK。「動画を書き出す」で仕上がります" },
      { id: "export", label: "書き出し",     hint: "「動画を書き出す」で完成です" },
    ],
    doneHint: "書き出し完了。調整して書き出し直すこともできます",
    canSelect: () => true,   // タップ=そのセクションへ移動(状態は変えないので常に安全)
    onSelect: id => {
      /* すんだステップは地図からのタップでそのまま開く(畳んだ先へ飛ばされて
         「何もない」にならないように) */
      const g = MC.ui.STEP_GROUPS.find(x => x.id === id);
      if (g && MC.ui._stepPhase != null &&
          MC.ui.STEP_RANK[id] < MC.ui.STEP_RANK[MC.ui._stepPhase]) {
        g.panels.forEach(sel => MC.ui._stepOpen.add(sel));
        MC.ui.applySteps(MC.ui._stepPhase);
      }
      const el = document.querySelector(MC.ui.JOURNEY_SECTIONS[id]);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  });
  MC.ui.initSteps();
  MC.ui.refreshJourney();
};

/* ---- ボトムアクションバー(モバイル): 現在フェーズの主アクションを親指ゾーンへ ---- */
MC.ui.initActionBar = () => {
  const bar = document.createElement("div");
  bar.className = "mz-actionbar";
  bar.innerHTML = '<button id="abPrimary" class="btn primary" type="button"></button>';
  document.getElementById("workspace").appendChild(bar);
  bar.querySelector("#abPrimary").onclick = () => { if (MC.ui._abAction) MC.ui._abAction(); };
  setInterval(MC.ui.updateActionBar, 500);   // MZP稼働状態の反映(ジャーニーバーと同じ流儀)
};

MC.ui.updateActionBar = () => {
  const bar = document.querySelector(".mz-actionbar");
  if (!bar) return;
  /* ピンチズーム中はfixedがビューポートに追従せず画面中央に浮いて見える
     (2026-07-24 実機スクショで発覚)。ズームが戻るまで引っ込める */
  if (window.visualViewport && window.visualViewport.scale > 1.05) {
    bar.classList.remove("on");
    document.body.classList.remove("mz-actionbar-on");
    return;
  }
  const btn = bar.querySelector("#abPrimary");
  const ws = document.getElementById("workspace");
  // 進捗ドック表示中はドックに場所を譲る(操作もさせない)
  const busy = window.MZP && MZP.current && !MZP.current.closed &&
    ["run", "pulse", "frozen"].includes(MZP.current.state);
  let conf = null;
  if (!ws.hidden && !busy) {
    const cur = MZJourney.current;
    if (cur === "mat") {
      conf = { label: MC.S.mode === "vertical" ? "動画・写真を選ぶ" : "動画を選ぶ",
        icon: "fa-folder-open",
        act: () => MC.ui.$(MC.S.mode === "vertical" ? "#fileInputV" : "#fileInput").click() };
    } else if (cur === "audio") {
      /* 音声を選ぶ: 本体の決定ボタンが見えているなら重ねない(書き出しと同じ流儀) */
      const db = MC.ui.$("#audioDecideBtn");
      const r = db ? db.getBoundingClientRect() : { height: 0 };
      if (r.height > 0 && r.top < window.innerHeight - 70 && r.bottom > 0) {
        bar.classList.remove("on");
        document.body.classList.remove("mz-actionbar-on");
        return;
      }
      conf = { label: "この音で進める", icon: "fa-check", act: () => db && db.click() };
    } else if ((cur === "sync" || cur === "polish") &&
               MC.ui._setupTab !== "pro" && !MC.S.easyDone) {
      /* おまかせタブでは同期ボタンは隠れている。次の一手は「おまかせで開始」。
         本体の同じボタンが画面に見えているときは重ねない(2026-07-23) */
      const eb = MC.ui.$("#easyStartBtn");
      const r = eb.getBoundingClientRect();
      if (r.height > 0 && r.top < window.innerHeight - 70 && r.bottom > 0) {
        bar.classList.remove("on");
        document.body.classList.remove("mz-actionbar-on");
        return;
      }
      conf = { label: "分析を開始", icon: "fa-wand-magic-sparkles",
        disabled: eb.disabled, act: () => eb.click() };
    } else if (cur === "sync") {
      conf = { label: "波形で同期する", icon: "fa-wave-square",
        disabled: MC.ui.$("#syncBtn").disabled, act: () => MC.ui.$("#syncBtn").click() };
    } else if (cur === "polish") {
      const cutMode = MC.S.mode === "switch";   // カット割は③自動スイッチングだけ(2026-07-24)
      if (cutMode && !MC.S.cutList.length) {
        conf = { label: "自動カット割", icon: "fa-clapperboard",
          act: () => MC.ui.$("#autocutBtn").click() };
      } else {
        /* 本体の書き出しボタン(緑のおまかせ完了ボタン/書き出しセクション)が
           画面に見えているなら、同じボタンを下にもう1つ重ねない。
           1画面に「書き出す」が3つ並んで迷う(2026-07-22 広報レビュー) */
        const dup = ["#easyStartBtn", "#exportBtn"].some(sel => {
          const el = MC.ui.$(sel);
          if (!el || el.disabled) return false;
          if (sel === "#easyStartBtn" && !MC.S.easyDone) return false;
          const r = el.getBoundingClientRect();
          return r.height > 0 && r.top < window.innerHeight - 70 && r.bottom > 0;
        });
        if (dup) { bar.classList.remove("on"); document.body.classList.remove("mz-actionbar-on"); return; }
        conf = { label: "動画を書き出す", icon: "fa-file-export",
          disabled: MC.ui.$("#exportBtn").disabled, act: () => MC.ui.$("#exportBtn").click() };
      }
    } else if (cur === "export" && MC.exporter.lastResult) {
      const r = MC.exporter.lastResult;
      conf = MC.exporter.shareMode()
        ? { label: "動画を保存", icon: "fa-arrow-up-from-bracket", act: () => MC.ui.saveResult() }
        : { label: "ダウンロード", icon: "fa-download",
            act: () => MC.exporter.triggerDownload(r.blob, r.name) };
    }
  }
  if (!conf) { bar.classList.remove("on"); document.body.classList.remove("mz-actionbar-on"); return; }
  bar.classList.add("on");
  document.body.classList.add("mz-actionbar-on");   // 中断の帯を親指バーの上へ積む(D-1)
  const html = `<i class="fa-solid ${conf.icon}"></i> ${conf.label}`;
  if (btn.dataset.h !== html) { btn.innerHTML = html; btn.dataset.h = html; }
  btn.disabled = !!conf.disabled;
  MC.ui._abAction = conf.act;
};

/* stateからフェーズを導出してバーと現在セクションの強調を更新 */
MC.ui.refreshJourney = () => {
  if (!document.querySelector(".mzj")) return;   // 未初期化なら何もしない
  const slot = MC.media.slotClips();
  const vids = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  const synced = vids.length >= 2
    ? vids.every(c => c.syncMethod !== "未同期")
    : slot.length > 0;   // 素材1つ(写真のみ含む)なら同期は不要=済み扱い
  const exported = !!MC.exporter.lastResult;
  /* 音声を選ぶフェーズ(2026-07-24): 音のある動画が2本以上のときだけ通る。
     1本なら選ぶ余地がないのでスキップ(優さん確定) */
  const audioNeeded = vids.length >= 2;
  const audioDone = MC.S.audioDecided || !audioNeeded;
  const done = [];
  if (slot.length) done.push("mat");
  if (slot.length && synced) done.push("sync");
  if (slot.length && synced && audioDone) done.push("audio");
  if (exported) done.push("polish", "export");
  const current = !slot.length ? "mat"
    : (vids.length >= 2 && !synced) ? "sync"
    : !audioDone ? "audio"
    : exported ? "export" : "polish";
  MZJourney.set(current, done);
  // 済んだフェーズの説明をCSSで畳むための現在地(2026-07-23 表示すっきり)
  document.body.dataset.mzjPhase = current;
  // 現在フェーズのセクションをそっと強調
  document.querySelectorAll(".side .panel").forEach(p => p.classList.remove("phase-current"));
  const target = document.querySelector(MC.ui.JOURNEY_SECTIONS[current]);
  if (target) target.classList.add("phase-current");
  MC.ui.applySteps(current);
  MC.ui.updateActionBar();
};

/* ============ ステップ表示: ウィザード折衷案(2026-07-23 優さん指示) ============
   画面遷移はしない。ジャーニーの現在フェーズから各パネルを
     いま  = 展開(青枠の強調は従来どおり)
     すみ  = 1行に畳む。タップでいつでも開閉できる(直したくなったら戻れる)
     まだ  = 1行に畳んでロック。何が待っているかだけ見せる
   に振り分ける。1画面で決めることを絞りつつ、全体の地図は縦に残す。
   状態は refreshJourney が導出したものをそのまま使う(新しい状態機械を作らない) */
MC.ui.STEP_RANK = { mat: 0, sync: 1, audio: 2, polish: 3, export: 4 };
MC.ui.STEP_GROUPS = [
  { id: "mat",    panels: ["#dropSec"] },
  { id: "sync",   panels: ["#syncSec"] },
  { id: "audio",  panels: ["#audioSec"] },
  { id: "polish", panels: ["#placeSec", "#layoutSec", "#finishSec"] },
  { id: "export", panels: ["#exportSec"] },
];
/* ロック中に「何を待っているか」を短く。mat は最初のステップなのでロックされない */
MC.ui.STEP_WAIT_NOTE = { sync: "素材のあと", audio: "分析のあと", polish: "音声のあと", export: "音声のあと" };
MC.ui._stepOpen = new Set();   // 手で開いた「すみ」パネル(フェーズが進むと畳み直す)
MC.ui._stepPhase = null;

/* 畳んだヘッダーに残す一言。素材は本数が分かると安心(それ以外は✓だけで足りる) */
MC.ui.stepSummary = sel => {
  if (sel === "#dropSec") {
    const n = MC.media.slotClips().length;
    if (n) return `${n}本`;
  }
  return "すみ";
};

MC.ui.applySteps = current => {
  const R = MC.ui.STEP_RANK;
  const cur = R[current] ?? 0;
  const advanced = MC.ui._stepPhase != null && cur > R[MC.ui._stepPhase];
  if (MC.ui._stepPhase !== current) { MC.ui._stepOpen.clear(); MC.ui._stepPhase = current; }
  let scrollTo = null;
  MC.ui.STEP_GROUPS.forEach(g => {
    let state = R[g.id] < cur ? "done" : R[g.id] === cur ? "current" : "locked";
    /* 書き出しは「整える」と同時に開く。整えるのは任意で、ゴールのボタンを
       ロックしたままにしない(自動カット割へは actionbar が誘導する) */
    if (g.id === "export" && cur >= R.polish) state = "current";
    g.panels.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) return;
      const open = state === "current" || (state === "done" && MC.ui._stepOpen.has(sel));
      el.classList.toggle("step-collapsed", !open);
      el.classList.toggle("step-done", state === "done");
      el.classList.toggle("step-locked", state === "locked");
      const h2 = el.querySelector(":scope > h2");
      if (h2) {
        let html = "";
        if (state === "done") {
          html = open
            ? '<i class="fa-solid fa-circle-check"></i> <i class="fa-solid fa-chevron-up"></i>'
            : `<i class="fa-solid fa-circle-check"></i> ${MC.ui.stepSummary(sel)} <i class="fa-solid fa-chevron-down"></i>`;
        } else if (state === "locked") {
          html = `<i class="fa-solid fa-lock"></i> ${MC.ui.STEP_WAIT_NOTE[g.id] || ""}`;
        }
        let chip = h2.querySelector(".mz-step-chip");
        if (html) {
          if (!chip) {
            chip = document.createElement("span");
            chip.className = "mz-step-chip";
            h2.appendChild(chip);
          }
          if (chip.dataset.h !== html) { chip.innerHTML = html; chip.dataset.h = html; }
          chip.classList.toggle("locked", state === "locked");
        } else if (chip) {
          chip.remove();
        }
        if (state === "done") {
          h2.setAttribute("role", "button");
          h2.setAttribute("tabindex", "0");
          h2.setAttribute("aria-expanded", open ? "true" : "false");
        } else {
          h2.removeAttribute("role");
          h2.removeAttribute("tabindex");
          h2.removeAttribute("aria-expanded");
        }
      }
      if (!scrollTo && state === "current" && R[g.id] === cur && !el.hidden) scrollTo = el;
    });
  });
  /* フェーズが進んだら、新しく開いたステップへそっと運ぶ。
     おまかせの実行中は進捗ドックが主役なので動かさない */
  if (advanced && !MC.ui._busy && scrollTo && scrollTo.offsetParent) {
    MC.ui.gentleScrollTo(scrollTo, "start");   // 見えていれば動かさない(2026-07-23)
  }
};

/* 「すみ」ヘッダーの開閉。パネルは静的HTMLなので初期化時に1回だけ付ける */
MC.ui.initSteps = () => {
  MC.ui.STEP_GROUPS.forEach(g => g.panels.forEach(sel => {
    const h2 = document.querySelector(sel + " > h2");
    if (!h2) return;
    const act = () => {
      if (!h2.parentElement.classList.contains("step-done")) return;   // いま/まだ は開閉しない
      if (MC.ui._stepOpen.has(sel)) MC.ui._stepOpen.delete(sel);
      else MC.ui._stepOpen.add(sel);
      MC.ui.applySteps(MC.ui._stepPhase);
    };
    h2.addEventListener("click", act);
    h2.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); }
    });
  }));
};

/* 撮り方の判定バッジ。自動判定の結果と、手で上書きしているかが分かるようにする。
   映像解析(自動カット割)を通す前は判定できないので「解析前」と出す */
MC.ui.rigBadge = c => {
  const rig = c.rig || "auto";
  if (rig !== "auto") {
    return `<span class="rig-badge manual" title="手動で指定しています">手動</span>`;
  }
  const v = c.visual;
  if (!v || typeof v.operated !== "boolean") {
    return `<span class="rig-badge none" title="自動カット割を実行すると判定されます">解析前</span>`;
  }
  const pct = Math.round((v.movingFrac || 0) * 100);
  return v.operated
    ? `<span class="rig-badge op" title="画面全体が動いている区間が${pct}%。人が操作していると判定">カメラマン付き</span>`
    : `<span class="rig-badge fx" title="画面全体が動いている区間が${pct}%。動いているのは被写体だけと判定">定点固定</span>`;
};

/* --- クリップカード --- */
/* 動画1/2/3の3スロット。空きは選択ボタン、読み込み済みはクリップカード */
MC.ui.renderClips = () => {
  const box = MC.ui.$("#clipSlots");
  box.innerHTML = "";
  const vertical = MC.S.mode === "vertical";
  /* 縦型は写真も入れられる。見出しの名詞をモードに合わせる(2026-07-23 B-4)。
     h2にはステップのチップが付くので、専用spanだけを書き換える */
  {
    const t = document.querySelector("#dropSec .drop-title");
    if (t) t.textContent = vertical ? "動画・写真を読み込む" : "動画を読み込む";
  }
  const slotClips = MC.media.slotClips();   // 音声のみを除く(動画+画像)

  for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
    const c = slotClips[slotIdx];
    const slot = document.createElement("div");
    slot.className = "clip-slot" + (c ? " filled" : " empty");
    const lb = document.createElement("div");
    lb.className = "clip-slot-label";
    const noun = vertical ? "素材" : "動画";
    lb.innerHTML = `<i class="fa-solid fa-video"></i> ${noun}${slotIdx + 1}${slotIdx === 2 ? "（なくてもOK）" : ""}`;
    slot.appendChild(lb);
    if (!c) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "clip-slot-add";
      btn.innerHTML = vertical
        ? 'タップして動画・写真を選ぶ<br><span class="hint">まとめて選べます／ここにドロップでもOK</span>'
        : 'タップして動画を選ぶ<br><span class="hint">まとめて選べます／ここにドロップでもOK</span>';
      btn.onclick = () => MC.ui.$(vertical ? "#fileInputV" : "#fileInput").click();
      slot.appendChild(btn);
      box.appendChild(slot);
      continue;
    }
    const card = document.createElement("div");
    /* おまかせのときは「ちゃんと取り込めた」ことだけ分かればいい。
       同期のズレ・信頼度・微調整・横位置・役割・出番・撮り方は
       こだわり側の話なので出さない(2026-07-22 優さん指示)。
       サムネイルは切り取らず枠内に収め、文字情報はその下にまとめる */
    const pro = MC.ui._setupTab === "pro";
    card.className = "clip-card" + (pro ? " clip-card--pro" : " clip-card--easy");
    const badgeCls = c.isImage ? "" : c.syncMethod === "基準" ? "ref" : c.syncMethod.startsWith("波形") ? "wave" : c.syncMethod.startsWith("タイムスタンプ") ? "ts" : "";
    const conf = c.confidence != null && isFinite(c.confidence) ? `信頼度${c.confidence.toFixed(1)}` : "";
    card.innerHTML = `
      <div class="clip-thumb-wrap">
        ${c.thumb ? `<img class="clip-thumb" src="${c.thumb}" alt="">` : `<div class="clip-thumb clip-thumb--empty"></div>`}
      </div>
      <div class="clip-info">
        <div class="clip-name" title="${MC.ui.esc(c.name)}">${MC.ui.esc(c.name)}</div>
        <div class="clip-meta">
          <span class="clip-spec">${c.width}×${c.height}</span>
          <span class="clip-spec">${c.isImage ? "写真" : MC.ui.fmtTime(c.duration)}</span>
          ${pro ? "" : '<span class="clip-ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> 読み込みました</span>'}
        </div>
        ${(!pro || c.isImage) ? "" : `
        <div class="clip-sync">
          <span class="sync-badge ${badgeCls}">${c.syncMethod}</span>
          <span>${c.offset ? "+" + c.offset.toFixed(3) + "s" : "0s"}</span>
          <span class="hint">${conf}</span>
        </div>
        <div class="clip-sync">
          <span class="nudge">
            <button data-n="-1">-1s</button><button data-n="-0.1">-0.1</button><button data-n="-0.033">-1f</button>
            <button data-n="0.033">+1f</button><button data-n="0.1">+0.1</button><button data-n="1">+1s</button>
          </span>
          <button class="btn small ghost listen" title="基準と重ねて試聴">🎧</button>
        </div>`}
        ${!pro ? "" : `
        <div class="pan-row">横位置 <input type="range" class="pan" min="0" max="1" step="0.01" value="${c.pan}"></div>`}
        ${(pro && MC.S.mode === "switch") ? `
        <div class="pan-row">役割 <select class="role-sel select-mini" title="自動カット割でこのカメラをどう扱うか">
          <option value="auto" ${c.role === "auto" ? "selected" : ""}>自動判定</option>
          <option value="wide" ${c.role === "wide" ? "selected" : ""}>引き（全体）</option>
          <option value="close" ${c.role === "close" ? "selected" : ""}>寄り（アップ）</option>
          <option value="pit" ${c.role === "pit" ? "selected" : ""}>フロントピット</option>
        </select></div>
        <div class="pan-row">出番 <select class="freq-sel select-mini" title="自動カット割でこのカメラをどのくらい使うか">
          <option value="less" ${c.freq === "less" ? "selected" : ""}>少なめ</option>
          <option value="auto" ${!c.freq || c.freq === "auto" ? "selected" : ""}>おまかせ</option>
          <option value="more" ${c.freq === "more" ? "selected" : ""}>多め</option>
        </select></div>
        <div class="pan-row">撮り方 <select class="rig-sel select-mini" title="定点固定か、人が操作しているか。カット割の扱いが変わります">
          <option value="auto" ${!c.rig || c.rig === "auto" ? "selected" : ""}>自動判定</option>
          <option value="fixed" ${c.rig === "fixed" ? "selected" : ""}>定点固定</option>
          <option value="operated" ${c.rig === "operated" ? "selected" : ""}>カメラマン付き</option>
        </select>${MC.ui.rigBadge(c)}</div>` : ""}
      </div>
      <button class="clip-remove" title="削除">✕</button>`;
    card.querySelectorAll(".nudge button").forEach(b =>
      b.onclick = () => MC.sync.nudge(c.id, parseFloat(b.dataset.n)));
    const listen = card.querySelector(".listen");
    if (listen) listen.onclick = () => MC.sync.listenCheck(c.id);
    const panEl = card.querySelector(".pan");   // おまかせでは出さないので必ず確かめる
    if (panEl) panEl.oninput = e => { c.pan = parseFloat(e.target.value); MC.saveState(); };
    const roleSel = card.querySelector(".role-sel");
    if (roleSel) roleSel.onchange = e => { c.role = e.target.value; MC.saveState(); };
    const freqSel = card.querySelector(".freq-sel");
    if (freqSel) freqSel.onchange = e => { c.freq = e.target.value; MC.saveState(); };
    const rigSel = card.querySelector(".rig-sel");
    // 撮り方を変えたらカット割の前提が変わるので、割り直しを促す
    if (rigSel) rigSel.onchange = e => {
      c.rig = e.target.value;
      MC.saveState();
      MC.ui.renderClips();
      if (MC.S.cutList.length) MC.ui.toast("撮り方を変えました。「自動カット割」で割り直せます");
    };
    card.querySelector(".clip-remove").onclick = () => MC.media.removeClip(c.id);
    slot.appendChild(card);
    box.appendChild(slot);
  }
};

/* --- 音声選択 --- */
MC.ui.renderAudio = () => {
  const box = MC.ui.$("#audioChoices");
  const cands = MC.S.clips.filter(c => !c.isImage);   // 静止画に音は無い
  if (!cands.length) { box.innerHTML = `<span class="hint">クリップを読み込むと表示されます</span>`; return; }
  const reco = MC.audio.recommend();
  /* 初期選択は「おすすめ」。recommend() は clip.stats が要るので、
     読み込み直後は null → 解析が終わって初めて確定する。
     ユーザーが手で選ぶまでは、確定したおすすめに追従させる。 */
  if (reco && !MC.S.audioPickedByUser && MC.S.audioClipId !== reco.id) {
    MC.S.audioClipId = reco.id;
    if (MC.preview && typeof MC.preview.applyMute === "function") MC.preview.applyMute();
  }
  box.innerHTML = "";
  for (const c of cands) {
    const label = document.createElement("label");
    label.className = "audio-choice" + (MC.S.audioClipId === c.id ? " selected" : "");
    const stat = c.stats
      ? `音量${(20 * Math.log10(c.stats.rms || 1e-6)).toFixed(0)}dB${c.stats.clipRatio > 0.001 ? "・歪みあり⚠" : ""}`
      : (c.hasAudio === false ? "音声なし" : "未解析");
    label.innerHTML = `
      <input type="radio" name="audioClip" ${MC.S.audioClipId === c.id ? "checked" : ""} ${c.hasAudio === false ? "disabled" : ""}>
      ${c.isAudio ? '<i class="fa-solid fa-file-audio" title="取り込んだ音声ファイル"></i> ' : ""}<span>${MC.ui.esc(c.name.length > 18 ? c.name.slice(0, 17) + "…" : c.name)}</span>
      ${reco && reco.id === c.id ? `<span class="reco-badge">おすすめ</span>` : ""}
      <span class="audio-stat">${stat}</span>`;
    label.querySelector("input").onchange = () => {
      MC.S.audioClipId = c.id;
      MC.S.audioPickedByUser = true;   // 以後おすすめには追従しない
      MC.preview.applyMute();
      MC.ui.renderAudio();
    };
    box.appendChild(label);
  }
};

/* --- プリセット/レイアウト/スロット --- */
MC.ui.renderLayout = () => {
  const conf = MC.ui.modeConf();
  const row = MC.ui.$("#presetRow");
  row.innerHTML = "";
  const presetIds = conf.presets.filter(id => MC.PRESETS[id]);
  for (const id of presetIds) {
    const p = MC.PRESETS[id];
    if (presetIds.length === 1) {
      // 選べる比率が1つだけなら、押せるボタンにせず現在のサイズを示すだけにする
      const fixed = document.createElement("span");
      fixed.className = "preset-fixed";
      fixed.textContent = `${p.label} ${p.w}×${p.h}`;
      row.appendChild(fixed);
      break;
    }
    const chip = document.createElement("button");
    chip.className = "preset-chip" + (MC.S.preset === id ? " selected" : "");
    chip.textContent = `${p.label} ${p.w}×${p.h}`;
    chip.onclick = () => { MC.S.preset = id; MC.preview.applyPreset(); MC.saveState(); MC.ui.renderLayout(); MC.ui.renderExportMode(); };
    row.appendChild(chip);
  }
  const sel = MC.ui.$("#layoutSelect");
  sel.innerHTML = "";
  const layoutIds = conf.layouts.filter(id => MC.LAYOUTS[id]);
  for (const id of layoutIds) {
    const o = document.createElement("option");
    o.value = id; o.textContent = MC.LAYOUTS[id].name;
    if (id === MC.S.layoutId) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => { MC.S.layoutId = sel.value; MC.saveState(); MC.ui.renderLayout(); MC.timeline.render(); };
  // スイッチング/ワイプは自動カット割パネル、それ以外はスロット割当
  const L = MC.LAYOUTS[MC.S.layoutId];
  const isCutMode = L.type === "switch" || L.type === "wipe";
  /* 自動カット割はスイッチングだけ。ワイプはメイン固定なのでカット割なし(2026-07-24) */
  MC.ui.$("#autocutPanel").style.display = L.type === "switch" ? "block" : "none";
  MC.ui.$("#wipeOpts").hidden = L.type !== "wipe";
  if (L.type === "wipe") {
    const pipCands = MC.media.slotClips();
    const main = MC.wipeMain();
    const wm = MC.ui.$("#wipeMainSelect");
    wm.innerHTML = pipCands.map(c =>
      `<option value="${c.id}" ${main === c.id ? "selected" : ""}>${MC.ui.esc(c.name.slice(0, 12))}</option>`).join("");
    const ws = MC.ui.$("#wipeCamSelect");
    ws.innerHTML = pipCands.map(c =>
      `<option value="${c.id}" ${MC.wipePip1(main) === c.id ? "selected" : ""}>${MC.ui.esc(c.name.slice(0, 12))}</option>`).join("");
    const ws2 = MC.ui.$("#wipeCamSelect2");
    ws2.innerHTML = `<option value="">（なし）</option>` + pipCands.map(c =>
      `<option value="${c.id}" ${MC.S.wipeClipId2 === c.id ? "selected" : ""}>${MC.ui.esc(c.name.slice(0, 12))}</option>`).join("");
    MC.ui.$("#wipePosSelect").value = MC.S.wipePos;
    MC.ui.$("#wipePosSelect2").value = MC.S.wipePos2;
    MC.ui.$("#wipeSizeRange").value = MC.S.wipeSize;
  }
  // 境界線(分割セルとワイプ小窓の枠)
  MC.ui.$("#borderRow").style.display = MC.S.layoutId === "single" ? "none" : "flex";
  MC.ui.$("#borderToggle").checked = MC.S.borderOn;
  MC.ui.$("#borderColor").value = MC.S.borderColor;
  MC.ui.$("#borderWRange").value = MC.S.borderW;
  MC.ui.$("#borderWVal").textContent = MC.S.borderW + "px";
  MC.ui.$("#bpbSelect").value = String(MC.S.beatsPerBar);
  // スロット割当
  const rows = MC.ui.$("#slotRows");
  rows.innerHTML = "";
  const n = isCutMode ? 0 : L.n;
  for (let i = 0; i < n; i++) {
    const div = document.createElement("div");
    div.className = "slot-row";
    div.innerHTML = `<label>カメラ ${i + 1}</label>`;
    const s = document.createElement("select");
    s.innerHTML = `<option value="">（なし）</option>` +
      MC.S.clips.map(c => `<option value="${c.id}" ${MC.S.slots[i] === c.id ? "selected" : ""}>${MC.ui.esc(c.name)}</option>`).join("");
    s.onchange = () => { MC.S.slots[i] = s.value ? parseInt(s.value) : null; MC.saveState(); };
    div.appendChild(s);
    rows.appendChild(div);
  }
};

/* --- 書き出しモード判定と表示 ---
   fast    : WebCodecs MP4(高速・H.264+AAC)
   realtime: MediaRecorder実時間録画(Safariはmp4/Chromeはwebm)
   mute    : WebCodecs MP4 映像のみ  */
MC.ui.exportMode = () => {
  if (MC.caps.h264 && MC.caps.aac) return "fast";
  if (MC.caps.recMime) return "realtime";
  if (MC.caps.h264) return "mute";
  return "none";
};

MC.ui.renderExportMode = () => {
  const el = MC.ui.$("#exportMode");
  const btn = MC.ui.$("#exportBtn");
  const mode = MC.ui.exportMode();
  if (mode === "fast") {
    el.innerHTML = "";   // 正常時は技術情報を出さない(そのまま保存できるのが当たり前の姿)
    btn.innerHTML = '<i class="fa-solid fa-file-export"></i> 動画を書き出す';
  } else if (mode === "realtime") {
    el.innerHTML = `<span class="warn">⚠ この端末は実時間録画になります。書き出し中は画面を閉じないでください</span>`;
    btn.innerHTML = '<i class="fa-solid fa-file-export"></i> 動画を書き出す(実時間)';
  } else if (mode === "mute") {
    el.innerHTML = `<span class="warn">⚠ この端末では音声を付けられません(映像のみ)</span>`;
    btn.innerHTML = '<i class="fa-solid fa-file-export"></i> 動画を書き出す(音声なし)';
  } else {
    el.innerHTML = `<span class="err">✗ この環境では書き出しできません(Safari/Chromeの最新版をお使いください)</span>`;
    btn.textContent = "書き出し不可";
  }
};

/* ---------- 書き出し画質の選択(2026-07-23 優さん指示) ----------
   sns(720p)が既定。1080pは時間がかかる旨+パソコン推奨を明記。
   高画質はパソコン(ディスク直書きできる環境)限定で、スマホには出さない */
MC.ui.renderQualityPicker = () => {
  const host = MC.ui.$("#qualityPicker");
  if (!host) return;
  const cur = MC.exporter.quality();
  /* スマホでもディスク(OPFS)へ直接書ける端末は、メモリのために画質を落とす
     必要がなくなった(2026-07-23 Phase 1)。「パソコン推奨」の但し書きは、
     本当に不利な端末にだけ出す。実態と違う遠慮はユーザーの損になる */
  /* 既定のライトを先に置く。フルHDはいつでも選べる */
  const defs = [
    { id: "light", name: "ライトモード", tag: "おすすめ",
      desc: "速度重視（720p）" },
    { id: "full", name: "リッチモード", tag: "",
      desc: "高画質ですが、時間がかかります（1080p）" },
  ];
  host.innerHTML = defs.map(d => `
    <button type="button" class="q-card${d.id === cur ? " on" : ""}" role="radio"
      aria-checked="${d.id === cur}" data-q="${d.id}">
      <span class="q-name">${d.name}${d.tag ? ` <em class="q-tag">${d.tag}</em>` : ""}</span>
      <span class="q-desc">${d.desc}</span>
    </button>`).join("");
  host.querySelectorAll("[data-q]").forEach(b => {
    b.onclick = () => {
      MC.S.exportQuality = b.dataset.q;
      MC.saveState();
      MC.ui.renderQualityPicker();
      /* 関数名は updateTransport。renderTransport は存在せず、ここで TypeError になって
         次行の checkExportable() まで到達していなかった(2026-07-25 レビューで発覚)。
         checkExportable は「この長さをこの端末で書き出せるか」を判定するが、その上限は
         videoBitrate() 経由で画質に依存する(ライト8Mbps / フル12Mbps)。つまり
         ライト→フルに切り替えたとき、出るべき「書き出せません」の警告が出ていなかった */
      MC.ui.updateTransport();       // 見積り(ETA)を新しい画質で引き直す
      MC.ui.checkExportable();
    };
  });
};

/* ---------- 縦型: カメラの配置(上/中/下)の確認と入れ替え ----------
   縦積みレイアウトはスロット順がそのまま上→下の並びになる。
   どれがどこに置かれたかを見せて、▲▼で入れ替えられるようにする
   (2026-07-23 優さん指示) */
MC.ui.renderPlacement = () => {
  const sec = MC.ui.$("#placeSec");
  const rows = MC.ui.$("#placeRows");
  if (!sec || !rows) return;
  const L = MC.LAYOUTS[MC.S.layoutId];
  const vertical = MC.S.mode === "vertical";
  /* スロットには消したクリップのidが残ることがある(モードを行き来した後など)。
     実在するクリップだけを表示対象にする */
  const ids = vertical && L.rects
    ? MC.S.slots.slice(0, L.n).filter(id => id != null && MC.getClip(id))
    : [];
  const cams = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  const showPlace = vertical && ids.length >= 2;
  /* 傾き修正は縦型・横型どちらでも出す(2026-07-23 優さん指示)。
     素材が1本でも傾きは直せるので、カメラが1つ以上あれば表示する */
  const showTilt = cams.length >= 1;
  if (!showPlace && !showTilt) { sec.hidden = true; return; }
  sec.hidden = false;

  const head = sec.querySelector("h2 .place-title");
  if (head) head.textContent = showPlace ? "カメラの配置と傾き" : "カメラの傾き";
  const lead = sec.querySelector(".place-lead");
  if (lead) {
    lead.textContent = showPlace
      ? "画面のどこに置くかを確認してください。入れ替えできます。傾きも直せます。"
      : "傾きを自動で直しています。気になるときは調整してください。";
  }

  /* --- 縦型: 上/中/下 の並び替え --- */
  rows.innerHTML = "";
  rows.hidden = !showPlace;
  if (showPlace) {
    const POS = ids.length === 2 ? ["上", "下"] : ["上", "中", "下"];
    ids.forEach((id, i) => {
      const c = MC.getClip(id);
      if (!c) return;
      const row = document.createElement("div");
      row.className = "place-row";
      row.innerHTML = `
        <span class="place-pos">${POS[i] || i + 1}</span>
        ${c.thumb ? `<img class="place-thumb" src="${c.thumb}" alt="">` : '<span class="place-thumb place-thumb--empty"></span>'}
        <span class="place-name" title="${MC.ui.esc(c.name)}">${MC.ui.esc(MC.ui.shortName(c.name))}</span>
        <span class="place-btns">
          <button type="button" class="place-move" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="上へ">▲</button>
          <button type="button" class="place-move" data-d="1" ${i === ids.length - 1 ? "disabled" : ""} aria-label="下へ">▼</button>
        </span>`;
      row.querySelectorAll(".place-move").forEach(b => {
        b.onclick = () => {
          const k = i + parseInt(b.dataset.d);
          if (k < 0 || k >= ids.length) return;
          const realIdx = [];
          MC.S.slots.forEach((sl, x) => {
            if (sl != null && MC.getClip(sl) && realIdx.length < ids.length) realIdx.push(x);
          });
          const a = realIdx[i], bIdx = realIdx[k];
          [MC.S.slots[a], MC.S.slots[bIdx]] = [MC.S.slots[bIdx], MC.S.slots[a]];
          MC.saveState();
          MC.ui.renderAll();
          MC.preview.seek(MC.S.t);
        };
      });
      rows.appendChild(row);
    });
  }

  MC.ui.renderTilt(cams, showTilt);
};

/* ---------- 自動傾き修正(確認ステップ内) ----------
   0.1°刻み。既定ONで、取り込み直後に自動検出して「直した後」を見せる。
   仕上げ欄にも同じ機能があったが、確認するのは素材を入れた直後がいちばん自然
   (2026-07-23 優さん指示) */
MC.ui.renderTilt = (cams, show) => {
  const box = MC.ui.$("#tiltBox");
  if (!box) return;
  box.hidden = !show;
  if (!show) return;
  const on = !!MC.S.horizonOn;
  box.querySelector("#tiltToggle").checked = on;
  const list = box.querySelector("#tiltRows");
  list.hidden = !on;
  list.innerHTML = "";
  if (!on) return;

  /* 各カメラ1枚のカードに、上段=名前+角度、下段=−／スライダー／＋／自動。
     以前は6列gridで375pxだと横に潰れて見えなくなっていた(2026-07-23 実機で発覚)。
     縦2段なら幅に依存せず必ず出る */
  for (const c of cams) {
    const rot = +(c.rot || 0);
    const row = document.createElement("div");
    row.className = "tilt-row";
    row.innerHTML = `
      <div class="tilt-top">
        <span class="tilt-name" title="${MC.ui.esc(c.name)}">${MC.ui.esc(MC.ui.shortName(c.name))}</span>
        <span class="tilt-val">${rot.toFixed(1)}°</span>
      </div>
      <div class="tilt-ctrl">
        <button type="button" class="tilt-step" data-d="-0.1" aria-label="左へ0.1度">−</button>
        <input type="range" class="tilt-range" min="-5" max="5" step="0.1" value="${rot}" aria-label="${MC.ui.esc(c.name)} の傾き">
        <button type="button" class="tilt-step" data-d="0.1" aria-label="右へ0.1度">＋</button>
        <button type="button" class="tilt-auto" title="もう一度自動で検出">自動</button>
      </div>`;
    const range = row.querySelector(".tilt-range");
    const val = row.querySelector(".tilt-val");
    const apply = v => {
      c.rot = Math.max(-5, Math.min(5, Math.round(v * 10) / 10));   // 0.1°刻みに丸める
      range.value = c.rot;
      val.textContent = c.rot.toFixed(1) + "°";
      MC.saveState();
      MC.ui.tiltFocus(c);     // 対象カメラを単独表示して「直した後」を見せる
    };
    range.oninput = e => apply(parseFloat(e.target.value));
    /* 触れた瞬間から対象カメラを見せる(値が変わる前でも) */
    range.addEventListener("pointerdown", () => MC.ui.tiltFocus(c), { passive: true });
    row.querySelectorAll(".tilt-step").forEach(b => {
      b.onclick = () => apply((+c.rot || 0) + parseFloat(b.dataset.d));
    });
    row.querySelector(".tilt-auto").onclick = async ev => {
      ev.target.disabled = true;
      try {
        const sug = await MC.horizon.suggest(c);
        if (sug == null || sug === 0) MC.ui.toast(`${MC.ui.shortName(c.name)}: 傾きは見つかりませんでした`);
        else { apply(sug); MC.ui.toast(`${MC.ui.shortName(c.name)}: ${sug.toFixed(1)}° 直しました`); }
      } finally { ev.target.disabled = false; }
    };
    list.appendChild(row);
  }

  box.querySelector("#tiltToggle").onchange = async e => {
    MC.S.horizonOn = e.target.checked;
    MC.saveState();
    if (MC.S.horizonOn) await MC.ui.autoDetectTilt();
    MC.ui.renderPlacement();
    MC.preview.draw();
  };
};

/* 傾き調整中: 対象カメラをプレビューに単独表示し、見えていなければ
   画面上部へピン留めする(2026-07-24 優さん指示: 対象の動画を見ながら調整)。
   操作が2.6秒止まったら通常表示へ戻す */
MC.ui.tiltFocus = c => {
  if (!c) return;
  MC.preview.soloId = c.id;
  clearTimeout(MC.ui._tiltFocusTimer);
  MC.ui._tiltFocusTimer = setTimeout(() => {
    MC.preview.soloId = null;
    document.body.classList.remove("mz-pin-force");
    if (MC.ui._syncFloatPos) MC.ui._syncFloatPos();
    MC.preview.draw();
  }, 2600);
  const holder = document.querySelector(".canvas-holder");
  const r = holder ? holder.getBoundingClientRect() : null;
  const visible = r && r.height > 0 && r.top >= 0 && r.top < window.innerHeight * 0.5;
  if (!visible) document.body.classList.add("mz-pin-force");
  MC.preview.draw();
};

/* 未検出のカメラだけ自動で傾きを測る。手で直した値は上書きしない */
MC.ui._tiltBusy = false;
MC.ui.autoDetectTilt = async () => {
  if (MC.ui._tiltBusy || !MC.S.horizonOn) return;
  const todo = MC.S.clips.filter(c => !c.isAudio && !c.isImage && c.rot == null);
  if (!todo.length) return;
  MC.ui._tiltBusy = true;
  const st = MC.ui.$("#tiltStatus");
  if (st) st.textContent = "傾きを見ています…";
  try {
    for (const c of todo) {
      try {
        const sug = await MC.horizon.suggest(c);
        c.rot = (sug == null) ? 0 : sug;    // 測れなかったら0(=再測定しない印)
      } catch (_) { c.rot = 0; }
    }
    MC.saveState();
  } finally {
    MC.ui._tiltBusy = false;
    if (st) st.textContent = "";
    MC.ui.renderPlacement();
    MC.preview.draw();
  }
};

/* おまかせの説明。カット割をするのはスイッチング/ワイプのときだけなので、
   縦型では文言から外す(やらないことを書かない) */
MC.ui.renderEasyLead = () => {
  const el = document.querySelector(".easy-lead");
  if (!el) return;
  const cutMode = MC.S.mode === "switch";   // カット割の説明は③だけ(2026-07-24)
  /* 完了後は完了カード(easyStatus)が同じことを言うので、リード文は畳む
     (同じ表示を2箇所に出さない。失敗時は markExportFailed がここへ書く) */
  el.hidden = !!MC.S.easyDone;
  if (!MC.S.easyDone) {
    el.textContent = cutMode
      ? "同期・カット割・色みまで、おまかせで仕上げます。"
      : "同期・色みまで、おまかせで仕上げます。";
  }
  MC.ui.renderEasyButton();
};

/* 書き出しに失敗したら、おまかせ側の「準備ができました」を失敗表示に
   差し替える。上半分が成功・下半分が失敗という矛盾した画面を残さない
   (2026-07-22 広報レビュー)。ボタンは「動画を書き出す」のまま=そのまま再挑戦できる */
MC.ui.markExportFailed = () => {
  const st = MC.ui.$("#easyStatus");
  if (st) st.innerHTML = "";          // 「書き出す準備ができました」の完了カードを消す
  const lead = document.querySelector(".easy-lead");
  if (lead) {
    lead.hidden = false;   // 完了時は畳んでいるので、失敗表示のときは開く
    /* まず「何が残っているか」を言う。失敗の告知だけだと、
       最初からやり直しだと思わせてしまう(2026-07-23 Phase 2) */
    lead.innerHTML = '<span class="err"><b>同期・カット割・書き出し範囲は残っています。</b>'
      + '書き出しだけが失敗しました。ボタンからもう一度お試しください'
      + '(原因は下の「詳しいログ」に出ています)。</span>';
  }
};

/* おまかせボタンの二役: 通常=おまかせで開始 / 完了後=動画を書き出す。
   状態はボタンを見れば分かるように、文言も色もはっきり変える */
MC.ui.renderEasyButton = () => {
  const btn = MC.ui.$("#easyStartBtn");
  if (!btn) return;
  if (MC.S.easyDone) {
    btn.innerHTML = '<i class="fa-solid fa-file-export"></i> 動画を書き出す';
    btn.classList.add("export-ready");
  } else {
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 分析を開始';
    btn.classList.remove("export-ready");
  }
};

/* 「おまかせ / こだわり」タブ。素材が入ったら出す(それまでは邪魔なので隠す) */
/* ゲストは「こだわり」の設定を触れない(音声の選択と書き出しだけ)。
   隠すのではなくグレーアウトで見せる: 何が待っているか分かる方が
   登録の動機になる(2026-07-21 優さん指示) */
MC.ui.applyGuestLocks = () => {
  const L = window.MZ_LIMITS || {};
  const guest = !(L.member || L.unlimited);
  document.body.classList.toggle("mz-guest", guest);
  ["#syncSec", "#layoutSec", "#finishSec"].forEach(sel => {
    const el = MC.ui.$(sel);
    if (el) el.classList.toggle("mz-locked", guest);
  });
  /* ロックされた欄をタップしたら、黙って無視せず理由を返す(2026-07-23 A-2)。
     操作の抑止は CSS(子要素の pointer-events を切る)側で行い、
     セクション自身がタップを受けて案内を出す */
  if (!MC.ui._guestLockWired) {
    MC.ui._guestLockWired = true;
    document.addEventListener("click", ev => {
      if (!document.body.classList.contains("mz-guest")) return;
      const sec = ev.target.closest(".mz-locked");
      if (!sec || ev.target.closest("h2")) return;   // 見出しは畳み開閉に使う
      MC.ui.toast("この設定は無料登録で使えます");
      const n = document.getElementById("mzProLockNote");
      if (n) n.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  const pane = MC.ui.$("#proPane");
  let note = document.getElementById("mzProLockNote");
  if (guest && pane && !note) {
    note = document.createElement("div");
    note.id = "mzProLockNote";
    note.className = "mz-pro-lock-note";
    note.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i> '
      + 'こだわり設定は MarchinZ への登録で使えます。'
      + 'ゲストは「使う音声」の選択だけ変更できます。 '
      + '<a href="/#signup">無料登録</a>';
    pane.insertBefore(note, pane.firstChild);
  } else if (!guest && note) {
    note.remove();
  }
};

MC.ui.setSetupTab = tab => {
  const changed = MC.ui._setupTab !== tab;
  MC.ui._setupTab = tab;
  const easy = tab !== "pro";
  MC.ui.$("#easyPane").hidden = !easy;
  MC.ui.$("#proPane").hidden = easy;
  document.querySelectorAll("#setupTabs .tab").forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  /* おまかせ⇄こだわりで素材カードの中身が変わる(おまかせは解像度と長さだけ)。
     タブが変わったら描き直す */
  if (changed && MC.S.clips.length) MC.ui.renderClips();
};

/* 「おまかせ / こだわり」はモード選択の直後から出す(2026-07-23 B-1)。
   以前は素材を入れてから現れたため、ステップ表示と二重の階層になっていた。
   おまかせ = ステップを飛ばす道、と定義して分岐を先頭に置く */
MC.ui.refreshSetupTabs = () => {
  const tabs = MC.ui.$("#setupTabs");
  if (!tabs) return;
  tabs.hidden = false;
  const lead = MC.ui.$("#setupTabsLead");
  if (lead) {
    lead.textContent = MC.ui._setupTab === "pro"
      ? "同期・レイアウト・仕上げを自分で決めます"
      : "同期もカット割も自動。まず素材を入れてください";
  }
  MC.ui.setSetupTab(MC.ui._setupTab || "easy");
};

/* おまかせで開始: 同期 → (カット割モードなら)自動カット割 → カラーマッチ を続けて実行 */
/* 長い処理の間、競合する操作をまとめて止める(二重実行でcutList/offsetが壊れるのを防ぐ) */
MC.ui.BUSY_FLAG_KEY = "mz_switcher_busy_v1";
MC.ui.setBusy = busy => {
  MC.ui._busy = !!busy;
  /* 「作業中」の印を sessionStorage に置く(2026-07-23 E-3 / F-1で修正)。
     _hiddenAt はメモリ上なので、iOSがタブごと捨てて再読込になると消える。
     本当に作業が飛ぶのはその破棄ケースなのに、そこでは何も出せなかった。
     sessionStorage はタブ内では再読込を越えて残り、かつ別タブへは漏れない。
     localStorage だと2枚目のタブが「前回途中で終わった」と誤報し、
     さらに印を消して本物の破棄を検知できなくしてしまう。正常終了で必ず消す */
  try {
    if (busy) sessionStorage.setItem(MC.ui.BUSY_FLAG_KEY, String(Date.now()));
    else sessionStorage.removeItem(MC.ui.BUSY_FLAG_KEY);
  } catch (_) {}
  if (busy) MC.ui.clearInterruptNote();   // 新しい作業を始めたら前回の中断案内は消す
  else MC.ui._hiddenAt = 0;
  const ids = ["#easyStartBtn", "#syncBtn", "#autocutBtn", "#colorMatchBtn", "#exportBtn", "#abPrimary"];
  ids.forEach(id => {
    const el = MC.ui.$(id);
    if (el) el.disabled = busy ? true : el.dataset.mzWasDisabled === "1";
  });
  const dz = MC.ui.$("#clipSlots");
  if (dz) dz.classList.toggle("mz-busy", !!busy);
  MC.ui.guardLeave(!!busy);   // 作業中はタブを閉じさせない・画面を消させない
};

/* ---------- 素材を入れた直後に「どれくらい待つか」を伝える ----------
   長い処理が2段(分析→書き出し)あるので、始める前に合計の目安を出す。
   分析の重さは「本数 × 尺」にほぼ比例する(各クリップの映像を順に見るため)。

   速さは端末で何倍も違うので、**実際にかかった時間を覚えて次から使う**。
   初回だけは控えめな既定値(iPhoneは実時間の0.5倍/本、パソコンは0.2倍/本)を
   使い、おまかせが終わるたびに実測へ寄せていく(2026-07-22 優さん指示) */
const MZ_SPEED_KEY = "mz_switcher_speed_v1";

MC.ui.analysisRate = () => {
  try {
    const v = parseFloat(JSON.parse(localStorage.getItem(MZ_SPEED_KEY) || "{}").analysis);
    if (isFinite(v) && v > 0.01 && v < 5) return v;   // 桁違いの値は信用しない
  } catch (_) {}
  return MC.isIOS ? 0.5 : 0.2;
};

/** おまかせにかかった実測から、1本1秒あたりの分析時間を覚える */
MC.ui.learnAnalysisRate = (elapsedSec, clipCount, showSec) => {
  if (!(elapsedSec > 0) || !(clipCount > 0) || !(showSec > 5)) return;
  const rate = elapsedSec / (clipCount * showSec);
  if (!(rate > 0.01 && rate < 5)) return;
  /* 前回と平均して寄せる(1回の外れ値で見積りが暴れないように) */
  const next = (MC.ui.analysisRate() + rate) / 2;
  try {
    localStorage.setItem(MZ_SPEED_KEY, JSON.stringify({ analysis: next, at: new Date().toISOString() }));
  } catch (_) {}
};

MC.ui.renderTotalEta = (dur, tIn, tOut) => {
  const el = MC.ui.$("#totalEtaHint");
  if (!el) return;
  /* おまかせが済んだら、残る作業は書き出しだけ。書き出し欄のETAと
     同じ内容を2箇所に出さない(2026-07-23 表示すっきり) */
  if (MC.S.easyDone) { el.hidden = true; return; }
  const clips = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  const showSec = Math.max(0, (tOut ?? 0) - (tIn ?? 0));
  if (!dur || !clips.length || showSec < 1) { el.hidden = true; return; }

  const anaSec = clips.length * showSec * MC.ui.analysisRate();
  let expFactor = MC.ui.exportMode() === "realtime" ? 1.15 : (MC.isIOS ? 1.8 : 0.9);
  if (MC.exporter.quality() === "light") expFactor *= 0.8;
  const expSec = showSec * expFactor;

  /* 1分未満は「1分ほど」に丸める。秒まで出すと正確に見えすぎる */
  const mins = (s) => Math.max(1, Math.round(s / 60));
  const anaMin = mins(anaSec), expMin = mins(expSec);
  const end = new Date(Date.now() + (anaSec + expSec) * 1000);
  const endTxt = `${end.getHours()}:${String(end.getMinutes()).padStart(2, "0")}頃`;

  el.hidden = false;
  el.innerHTML = `<i class="fa-solid fa-hourglass-half" aria-hidden="true"></i> `
    + `素材の分析におよそ<b>${anaMin}分</b>、書き出しにおよそ<b>${expMin}分</b>かかりそうです。`
    + `<span class="total-eta-sub">いま始めると${endTxt}に終わる見込みです</span>`;   // 本数・尺は非表示(2026-07-24 優さん指示)
};

/* ---------- フロートプレビューはスクロール時だけ ----------
   ずっと固定だと、画面上部にいるときまでヘッダーや操作に重なる。
   本来の位置を通り過ぎたときだけ浮かせる(2026-07-22 優さん指示)。

   判定は「浮いていないときのプレビューの位置」を覚えておいて、
   スクロール量と比べるだけにする。実装中に2つ踏んだので書き残す:
     ・浮いた状態で位置を測ると、的(fixed=流れから外れる)が動いてしまい
       測るたびに答えが変わる堂々巡りになる → 浮いていない間だけ測り直す
     ・目印の空要素を差し込む案は、親がグリッドだと最後の枠へ飛ばされて
       まったく違う位置になった → DOMは足さない
   scrollY の比較だけなので rAF にも IntersectionObserver にも頼らない */
/* 旧: 右上の小窓フロート。実機でサイトヘッダーへ重なり破綻したため廃止し、
   「スクロールでプレビューが見えなくなったら、画面上部1/3へ全幅ピン留め」に
   変えた(2026-07-24 優さん指示)。クラスは mz-pin-on。
   ピン留め中は .stage が空になり本文が跳ねるので、元の高さを min-height で保つ */
MC.ui.initFloatOnScroll = () => {
  const stage = document.querySelector(".stage");
  if (!stage) return;
  let baseY = 0;          // ピンでないときのプレビューの位置(ページ先頭から)
  let baseH = 0;          // ピンでないときのプレビューの高さ
  const HYST = 24;        // 境目でのちらつき防止

  const update = () => {
    if (document.body.classList.contains("mz-float-full")) return;   // 全画面中は触らない
    if (document.body.classList.contains("mz-pin-force")) return;    // 傾き調整中は固定のまま
    /* ピンチズーム中は fixed がビューポートに追従せず画面を汚すので出さない
       (2026-07-24 実機スクショで発覚) */
    if (window.visualViewport && window.visualViewport.scale > 1.05) {
      document.body.classList.remove("mz-pin-on");
      stage.style.minHeight = "";
      return;
    }
    const on = document.body.classList.contains("mz-pin-on");
    if (!on) {
      const rect = stage.getBoundingClientRect();
      /* まだ画面に出ていない(モード選択中など)ときは矩形が全部0になる。
         そのまま基準にすると「常にピン」状態になる(実装中に踏んだ) */
      if (!rect.height) { return; }
      baseY = rect.top + window.scrollY;
      baseH = rect.height;
    }
    const barH = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue("--mz-journey-h")) || 72;
    /* プレビューの大半(70%)が隠れるまでは元の位置のまま粘る */
    const onLine = baseY + baseH * 0.7 - barH;
    const want = on
      ? window.scrollY > onLine - HYST    // ピンの間は少し粘ってから戻す
      : window.scrollY > onLine;
    document.body.classList.toggle("mz-pin-on", want);
    stage.style.minHeight = want ? baseH + "px" : "";   // 本文の跳ね防止
  };

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  if (window.visualViewport) visualViewport.addEventListener("resize", update, { passive: true });
  /* scrollイベントを取りこぼす環境(iOSの慣性終端やズーム復帰など)への保険。
     700msごとの再判定なら負荷は無視できる */
  setInterval(update, 700);
  MC.ui._syncFloatPos = update;   // 素材の増減で高さが変わったときに呼び直す
  update();
};

/* 全画面プレビューに「この見た目で書き出します」を出す(2026-07-23 優さん指示)。
   範囲と画質を添えて、いま見ているものがそのまま完成品だと伝える */
MC.ui.renderFullLabel = on => {
  const holder = document.querySelector(".canvas-holder");
  let el = document.getElementById("mzFullLabel");
  if (!on) { if (el) el.remove(); return; }
  if (!holder) return;
  if (!el) {
    el = document.createElement("div");
    el.id = "mzFullLabel";
    el.className = "mz-full-label";
    holder.appendChild(el);
  }
  const range = MC.trimRange();
  const q = MC.exporter.QUALITIES[MC.exporter.quality()];
  el.innerHTML = '<i class="fa-solid fa-clapperboard" aria-hidden="true"></i> '
    + '<span><b>この見た目で書き出します</b>'
    + `範囲 ${MC.ui.fmtTime(range[0])}〜${MC.ui.fmtTime(range[1])}`
    + (q ? " ・ " + MC.ui.esc(q.label) : "") + "</span>";
};

/* ============ 作業中の離脱・画面ロックを防ぐ ============
   同期・カット割・書き出しはすべて「このタブが生きていること」が前提。
   タブを閉じる/リロードすると当然止まり、画面がロックされても
   rAF とデコーダが止まって進まなくなる(2026-07-21 優さん報告)。

   3段構え:
     ① beforeunload … 閉じる/リロードの前に確認ダイアログを出す
     ② Wake Lock   … 画面を点けたままにする(marchinz-base.jsのメトロノームと同じ)
     ③ 復帰時の再取得 … 一度でも画面が消えると Wake Lock は解放されるので、
                        戻ってきたら取り直す
   すべて「効かない環境では静かに諦める」設計にし、処理自体は止めない。 */
MC.ui._wakeLock = null;
MC.ui._leaveGuarded = false;

MC.ui._onBeforeUnload = e => {
  if (!MC.ui._busy) return;
  e.preventDefault();
  e.returnValue = "";   // 文言はブラウザ側が決める(独自文字列は無視される)
  return "";
};

/* ============ 離脱の検知(Phase 2 / 2026-07-23) ============
   iOS はタブが背面に回ると処理を止め、メモリが逼迫すればタブごと捨てる。
   Web である限り「切り替えても完走」は保証できないので、次の3つに絞る:
     ① 隠れる瞬間に保存する    … 未保存の編集を落とさない
     ② 隠れていた時間を数える  … 戻ってきたときに事実を伝えられる
     ③ 戻ったら正直に伝える    … 「止まっていたかも」と、何が残っているか
   処理そのものは止めない(勝手に中断する方が損)。 */
MC.ui._hiddenAt = 0;

MC.ui._onVisChange = () => {
  if (document.visibilityState === "hidden") {
    MC.saveState();                     // ① 未保存の編集をここで確定させる
    if (MC.ui._busy) MC.ui._hiddenAt = Date.now();
    return;
  }
  // 画面が戻ったら Wake Lock を取り直す(消灯・アプリ切替で解放されるため)
  if (MC.ui._busy) MC.ui._holdWake(true);
  if (MC.ui._hiddenAt) {
    const ms = Date.now() - MC.ui._hiddenAt;
    MC.ui._hiddenAt = 0;
    /* まだ走っているなら「続けています」、終わっていたら「やり直せます」。
       走っている最中に「やり直せます」と出すと、健全な書き出しを
       捨ててやり直す人が出る(2026-07-24 通知タップ問題の一部) */
    if (ms >= 2000) MC.ui.showInterruptNote(ms, { running: MC.ui._busy });   // ③
  }
};

/* 中断を知らせる。言うことは2つだけ ─「中断されたかも」と「やり直せる」。
   長文は読まれず×を押される(2026-07-23 D-2で短縮)。トーストは見逃すので
   閉じるまで残す。crashed=前回タブごと終了(E-3) / それ以外=離脱からの復帰 */
MC.ui.showInterruptNote = (ms, opts = {}) => {
  let el = document.getElementById("mzInterruptNote");
  if (!el) {
    el = document.createElement("div");
    el.id = "mzInterruptNote";
    el.className = "mz-interrupt-note";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  const head = opts.crashed
    ? "前回は途中で終わっています。"
    : opts.running
      ? "離れていた間は止まっていました。"
      : "中断されたかもしれません。";
  const body = opts.running
    ? "続きから進めています。終わるまでこの画面のままお待ちください。"
    : "同期とカット割は残っています。書き出しだけやり直せます。";
  el.innerHTML = '<i class="fa-solid fa-circle-pause" aria-hidden="true"></i> '
    + `<span><b>${head}</b>${body}</span>`
    + '<button type="button" class="mz-interrupt-close" aria-label="閉じる">×</button>';
  el.querySelector(".mz-interrupt-close").onclick = () => MC.ui.clearInterruptNote();
  /* 中断の帯が出ている間は、素材欄の常設ヒント(青の上限案内・お待ちください)を
     控える。黄色い帯と青い箱が同時に並んで「今どれに対処するのか」が
     ぼやけるのを防ぐ(F-4) */
  document.body.classList.add("mz-interrupt-on");
};

MC.ui.clearInterruptNote = () => {
  const el = document.getElementById("mzInterruptNote");
  if (el) el.remove();
  document.body.classList.remove("mz-interrupt-on");
};

/* ============ 分析完了の目立つ通知(2026-07-23 優さん指示) ============
   ①バイブ ②タブのタイトルを一時的に変える(裏で待っている人向け)
   ③画面内の大きな完了バナー(タップで消える)。三重にして見逃しを防ぐ */
MC.ui.notifyAnalysisDone = () => {
  // iOS Safari は vibrate 非対応(効かない)。Android等では鳴る。害はないので残す(G-5)
  try { if (navigator.vibrate) navigator.vibrate([80, 40, 80]); } catch (_) {}
  /* タブ裏で待つ人向け: タイトルを点滅風に。操作が戻ったら元へ */
  try {
    const orig = document.title;
    document.title = "✅ 分析完了 — 書き出せます";
    const restore = () => {
      document.title = orig;
      document.removeEventListener("visibilitychange", onVis);
    };
    const onVis = () => { if (document.visibilityState === "visible") restore(); };
    document.addEventListener("visibilitychange", onVis);
    setTimeout(restore, 15000);
  } catch (_) {}

  let el = document.getElementById("mzAnalysisDone");
  if (!el) {
    el = document.createElement("div");
    el.id = "mzAnalysisDone";
    el.className = "mz-analysis-done";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.innerHTML = '<button type="button" class="mz-adone-main">'
    + '<span class="mz-adone-icon"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></span>'
    + '<span class="mz-adone-text"><b>分析が終わりました</b>タップで「動画を書き出す」へ</span>'
    + '</button>'
    + '<button type="button" class="mz-adone-close" aria-label="閉じる"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
  el.classList.remove("mz-adone-hide");
  void el.offsetWidth;                 // アニメ再生のためリフロー
  el.classList.add("mz-adone-show");
  const hide = () => { el.classList.remove("mz-adone-show"); el.classList.add("mz-adone-hide"); };
  el.querySelector(".mz-adone-close").onclick = hide;
  /* バナー本体タップ→書き出しボタンへ運ぶ(G-3)。「終わった、で、どこ?」を消す */
  el.querySelector(".mz-adone-main").onclick = () => {
    hide();
    const b = MC.ui.$("#exportBtn") || MC.ui.$("#easyStartBtn");
    if (b) {
      const panel = b.closest(".panel") || b;
      panel.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  clearTimeout(MC.ui._adoneTm);
  MC.ui._adoneTm = setTimeout(hide, 8000);   // 8秒で自動で引っ込む
};

MC.ui._holdWake = async want => {
  try {
    if (want && !MC.ui._wakeLock && navigator.wakeLock) {
      MC.ui._wakeLock = await navigator.wakeLock.request("screen");
      MC.ui._wakeLock.addEventListener("release", () => { MC.ui._wakeLock = null; });
    } else if (!want && MC.ui._wakeLock) {
      const w = MC.ui._wakeLock;
      MC.ui._wakeLock = null;
      await w.release();
    }
  } catch (_) {
    // 非対応・省電力モード・非表示タブ等。画面ロック対策なしで続行する
    MC.ui._wakeLock = null;
  }
};

/* 作業中だけ出す「このまま待ってて」の帯。guardLeave と運命共同体にする
   (出し忘れ・消し忘れが構造的に起きない)。2026-07-21 優さん指示 */
MC.ui._stayBanner = on => {
  let el = document.getElementById("mzStayBanner");
  if (on && !el) {
    el = document.createElement("div");
    el.id = "mzStayBanner";
    el.className = "mz-stay-banner";
    el.setAttribute("role", "status");
    el.innerHTML = '<i class="fa-solid fa-mug-hot" aria-hidden="true"></i> '
      + '作業中です。この画面のままお待ちください（切り替えると止まることがあります）';
    document.body.appendChild(el);
  } else if (!on && el) {
    el.remove();
  }
};

MC.ui.guardLeave = on => {
  if (on === MC.ui._leaveGuarded) return;
  MC.ui._leaveGuarded = on;
  MC.ui._stayBanner(on);
  if (on) {
    window.addEventListener("beforeunload", MC.ui._onBeforeUnload);
    MC.ui._holdWake(true);
  } else {
    window.removeEventListener("beforeunload", MC.ui._onBeforeUnload);
    MC.ui._holdWake(false);
  }
};

/* visibilitychange は作業中に限らず常時聴く(2026-07-23 Phase 2)。
   guardLeave の中で付け外ししていたため、編集中の離脱では保存が走らなかった。
   Wake Lock の取り直しは _onVisChange 側で busy を見て判断する */
MC.ui.initVisibility = () => {
  // 冪等にする(2回呼ばれても二重登録しない)。_onVisChange は固定参照なので外せる(F-3)
  document.removeEventListener("visibilitychange", MC.ui._onVisChange);
  document.addEventListener("visibilitychange", MC.ui._onVisChange);
  /* 前回、作業中のままタブが終了(iOSの破棄・クラッシュ・強制終了)していたら、
     その印が残る。ただし知らせるのは**復元できる素材が実際にある**ときだけ(F-2)。
     「始めてすぐ閉じた」等では素材が無く、翌日開いた人に身に覚えのない警告が出る。
     印はここで必ず消す(一度きり)。素材の有無に関わらず消さないと残り続ける */
  try {
    const flag = sessionStorage.getItem(MC.ui.BUSY_FLAG_KEY);
    if (flag) {
      sessionStorage.removeItem(MC.ui.BUSY_FLAG_KEY);
      let hasRestorable = false;
      try {
        const saved = JSON.parse(localStorage.getItem("marchcut_project") || "{}");
        hasRestorable = Array.isArray(saved.clips) && saved.clips.length > 0;
      } catch (_) {}
      // 素材やUIが整ってから出す(初期化途中に body へ差し込むと位置が崩れる)
      if (hasRestorable) setTimeout(() => MC.ui.showInterruptNote(null, { crashed: true }), 600);
    }
  } catch (_) {}
};

/* おまかせ 第1段(2026-07-24 優さん指示で2段化):
   「分析を開始」= 同期(窓ラダー)だけ。終わったら「音声を選ぶ」フェーズへ。
   動画1本(選ぶ余地なし)ならそのまま第2段へ直行する */
MC.ui.runEasy = async () => {
  const btn = MC.ui.$("#easyStartBtn");
  if (btn.disabled || MC.ui._busy) return;
  MC.ui.setBusy(true);
  MC.ui.clearErrorLog();   // やり直しでは前回の失敗ログを見せない
  MC.preview.pause();
  const p = MZP.start({ mount: "#easyStatus", chapter: "同期", delay: 0,
                        label: "音を合わせています…" });
  try {
    const vids = MC.S.clips.filter(c => !c.isImage);
    if (vids.length >= 2) {
      p.pulse("音を合わせています…");
      await MC.sync.run(p);
    }
    if (vids.length >= 2 && !MC.S.audioDecided) {
      /* ここで一度手を止める: 音声を選んでから仕上げへ */
      p.done("同期できました", { sub: "使う音声を選んで「この音で進める」を押してください" });
      MC.ui.renderAll();
      MC.ui.gentleScrollTo(document.querySelector("#audioSec"), "start");
      return;
    }
    await MC.ui.runEasyFinish(p);   // 1本だけ→選ぶフェーズを飛ばして仕上げへ
  } catch (e) {
    console.error(e);
    p.fail("うまくできませんでした", { detail: e.message });
    MC.ui.showErrorLog(e);
  } finally {
    MC.ui.setBusy(false);
    MC.ui.renderAll();   // 途中で止まってもタイムライン等の表示を状態に合わせ直す
  }
};

/* おまかせ 第2段: 「この音で進める」後の仕上げ。
   トリム→(③自動スイッチングのみ)カット割→色そろえ。
   ①縦動画/②ワイプカメラはシーン分析を丸ごと飛ばす(2026-07-24 優さん指示) */
MC.ui.runEasyFinish = async pIn => {
  if (!pIn && MC.ui._busy) return;
  const t0 = performance.now();   // 次回の見積りを実測へ寄せるため
  if (!pIn) { MC.ui.setBusy(true); MC.ui.clearErrorLog(); MC.preview.pause(); }
  const p = pIn || MZP.start({ mount: "#easyStatus", chapter: "仕上げ", delay: 0,
                               label: "仕上げています…" });
  try {
    // 開始/終了の自動区切り。演奏の前後(アナウンス・拍手・片付け)を落とす。
    // カット割より先に行う: director は MC.trimRange() の中だけを割るため
    if (MC.S.trimIn === 0 && MC.S.trimOut == null) {
      p.pulse("最初と最後を探しています…");
      await MZP.paint();
      await MC.salute.autoTrim();   // 検出できなければ静かに諦める(トリムなしで続行)
    }
    if (MC.S.mode === "switch") {   // シーン分析は③自動スイッチングだけ
      p.pulse("カットを割っています…");
      await MC.director.run(p);
      MC.timeline.render();
    }
    let colorFailed = false;
    if (MC.S.colorOn) {
      p.pulse("色をそろえています…");
      await MC.color.run(p).catch(() => { colorFailed = true; });
    }
    MC.ui.renderAll();
    const [ti, to] = MC.trimRange();
    MC.preview.seek(ti);
    const trimmed = MC.S.trimIn > 0 || MC.S.trimOut != null;
    /* ドックは「結果の詳細(範囲・色)」に徹する。「終わった」の気づきは下の
       バナー(notifyAnalysisDone)に一本化し、同じ文言を2箇所に出さない(G-4) */
    p.done("整いました", {
      sub: (colorFailed ? "色そろえだけできませんでした。" : "")
        + (trimmed ? `書き出し範囲 ${MC.ui.fmtTime(ti)}〜${MC.ui.fmtTime(to)} を自動設定。` : "")
        + "プレビューを見て、よければ書き出してください",
    });
    /* 分析後は傾き補正を必ずON+自動調整+チェック(2026-07-24 優さん指示)。
       旧保存のOFFが残っていても、ここで確実にONへ揃える */
    MC.S.horizonOn = true;
    MC.saveState();
    MC.ui.renderPlacement();     // tiltBoxのチェックと角度表示を描き直す
    MC.ui.autoDetectTilt();      // 未検出のカメラだけ裏で測って反映
    /* 分析が終わったことを目立たせて知らせる(2026-07-23 優さん指示)。
       スマホは分析中に別アプリへ切り替えていることが多いので、
       戻ってきたとき/戻る前どちらでも気づけるように出す */
    MC.ui.notifyAnalysisDone();
    /* ここからの主役は書き出し。おまかせボタン自体を「動画を書き出す」に
       化けさせ、次にすることを迷わせない(2026-07-21 優さん指示) */
    MC.S.easyDone = true;
    /* 実際にかかった時間を覚えて、次からの見積りを自分の端末に合わせる
       (2段化後は仕上げ段の実測。同期段はsync側で速くなっている) */
    const [eIn, eOut] = MC.trimRange();
    MC.ui.learnAnalysisRate(
      (performance.now() - t0) / 1000,
      MC.S.clips.filter(c => !c.isAudio && !c.isImage).length,
      Math.max(0, eOut - eIn));
    /* 長すぎて書き出せない場合は、ここで知らせる。
       書き出しボタンを押すまで黙っていると「15分待って書き出せません」に
       なる(2026-07-21 実機で発生) */
    MC.ui.checkExportable();
  } catch (e) {
    console.error(e);
    p.fail("うまくできませんでした", { detail: e.message });
    MC.ui.showErrorLog(e);
  } finally {
    if (!pIn) { MC.ui.setBusy(false); MC.ui.renderAll(); }
  }
};

/* 失敗したときのログ表示。原因を優さん/利用者が自分で確認でき、
   そのまま連絡にも貼れるように「コピー」も付ける */
MC.ui.showErrorLog = err => {
  try {
    MC.ui._showErrorLog(err);
  } catch (e) {
    // 報告機構自体が落ちても、元のエラーを見失わないようにする
    console.error("[MC] showErrorLog failed", e, "original:", err);
  }
};

/* エラーログを消す。書き出し・おまかせを「やり直した」時に呼ぶ。
   前回の失敗ログが残ったままだと、今回も失敗したのか紛らわしい
   (2026-07-21 優さん指摘) */
MC.ui.clearErrorLog = () => {
  const host = MC.ui.$("#errorLog");
  if (!host) return;
  host.hidden = true;
  host.textContent = "";
};

MC.ui._showErrorLog = err => {
  const host = MC.ui.$("#errorLog");
  if (!host) return;
  const env = [
    `MarchinZ Switcher ${document.documentElement.getAttribute("data-mz-version") || "(版不明)"}`,
    `${navigator.userAgent}`,
    `書き出し方式: ${MC.ui.exportMode()} / H264:${MC.caps.h264} AAC:${MC.caps.aac}`,
    // メタデータ未確定のクリップでも落ちないよう、数値は必ず正規化する
    `素材: ${MC.S.clips.map(c => `${c.name} ${c.width | 0}x${c.height | 0} ${Number(c.duration || 0).toFixed(1)}s`).join(" / ") || "なし"}`,
    `レイアウト: ${MC.S.layoutId} / 比率: ${MC.S.preset} / カット: ${MC.S.cutList.length}`,
    `エラー: ${(err && err.stack) || (err && err.message) || err}`,
  ].join("\n");
  const text = `${env}\n---- ログ ----\n${MC.debug.slice(-120).join("\n")}`;
  host.hidden = false;
  host.innerHTML = `
    <details open>
      <summary><i class="fa-solid fa-triangle-exclamation"></i> 詳しいログ（うまくいかないときは、これをコピーしてお知らせください）</summary>
      <pre id="errorLogText"></pre>
      <div class="row">
        <button type="button" id="errorLogCopy" class="btn small"><i class="fa-regular fa-copy"></i> コピー</button>
        <button type="button" id="errorLogClose" class="btn small ghost">閉じる</button>
      </div>
    </details>`;
  host.querySelector("#errorLogText").textContent = text;
  host.querySelector("#errorLogCopy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      MC.ui.toast("ログをコピーしました");
    } catch (e) {
      // クリップボードが使えない環境では選択状態にして手動コピーを促す
      const r = document.createRange();
      r.selectNodeContents(host.querySelector("#errorLogText"));
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      MC.ui.toast("選択しました。長押し/右クリックでコピーしてください");
    }
  };
  host.querySelector("#errorLogClose").onclick = () => { host.hidden = true; };
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
};

/* 書き出し失敗の原因別ヒント。原文も残して、問い合わせ時に伝えられるようにする */
MC.ui.exportFailHint = e => {
  const m = String((e && e.message) || e);
  const dur = (() => { const [a, b] = MC.trimRange(); return Math.max(0, b - a); })();
  let hint = "";
  if (/メモリ|memory|allocat|OOM/i.test(m)) {
    hint = "端末のメモリが足りなくなった可能性があります。IN/OUT で書き出す範囲を短くするか、素材の本数を減らしてお試しください。";
  } else if (/大きすぎ|maxTex|too large/i.test(m)) {
    hint = "映像の解像度がこの端末の上限を超えています。書き出しサイズを下げるか、小さい素材でお試しください。";
  } else if (/対応|support|codec|decoder|decode/i.test(m)) {
    hint = "この形式の映像/音声をブラウザが扱えないようです。別のブラウザ(Chrome/Safariの最新版)か、書き出し直した素材でお試しください。";
  } else if (dur > 300) {
    hint = `書き出す範囲が長い(${Math.round(dur / 60)}分)ため、途中で力尽きた可能性があります。IN/OUT で範囲を区切ってお試しください。`;
  }
  return hint ? `${hint}（詳細: ${m}）` : m;
};

/* --- トランスポート --- */
MC.ui.updateTransport = () => {
  const dur = MC.timelineDuration();
  const scrub = MC.ui.$("#scrub");
  if (parseFloat(scrub.max) !== dur) scrub.max = dur;
  if (!MC.ui._scrubbing) scrub.value = MC.S.t;
  MC.ui.$("#timeLabel").textContent = `${MC.ui.fmtTime(MC.S.t)} / ${MC.ui.fmtTime(dur)}`;
  MC.ui.$("#playBtn").innerHTML = MC.S.playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
  const [tIn, tOut] = MC.trimRange();
  // INかOUTをユーザーが動かしているか(初期値=全体)
  const custom = MC.S.trimIn > 0.05 || MC.S.trimOut != null;
  MC.ui.$("#trimLabel").textContent = !dur || !custom ? ""
    : `書き出し範囲 IN ${MC.ui.fmtTime(tIn)} → OUT ${MC.ui.fmtTime(tOut)}`;
  /* 書き出しの所要時間の目安。8分30秒×1.8倍≒15分(iPhone 15 Pro実測ベースの概算)。
     嘘をつかないよう「およそ」で丸め、範囲が変わるたびに追随させる(2026-07-21) */
  const etaHint = MC.ui.$("#exportEtaHint");
  if (etaHint) {
    if (!dur) {
      etaHint.textContent = "";
    } else {
      const sec = Math.max(0, tOut - tIn);
      const mm = Math.floor(sec / 60), ss = Math.round(sec % 60);
      /* iPhone/iPadは実時間の約1.8倍。パソコンは同じ処理でもずっと速いので
         過大な数字を見せない(レビュー指摘)。実時間録画は尺そのもの+仕上げ */
      let factor = MC.ui.exportMode() === "realtime" ? 1.15 : (MC.isIOS ? 1.8 : 0.9);
      if (MC.exporter.quality() === "light") factor *= 0.8;   // 720pは実測22%速い
      const estMin = Math.max(1, Math.round(sec * factor / 60));
      const end = new Date(Date.now() + sec * factor * 1000);
      const endTxt = `${end.getHours()}:${String(end.getMinutes()).padStart(2, "0")}頃`;
      etaHint.textContent = `${mm}分${ss ? String(ss).padStart(2, "0") + "秒" : ""}の動画で、`
        + `書き出しにはおよそ${estMin}分（いま始めると${endTxt}に終わります）`;
    }
  }
  MC.ui.renderTotalEta(dur, tIn, tOut);

  // スライダー下の範囲バンド(どこからどこまで書き出すかをいつでも見せる)
  const band = MC.ui.$("#trimBand");
  if (band) {
    if (dur > 0) {
      band.hidden = false;
      band.classList.toggle("full", !custom);
      band.style.left = `${(tIn / dur) * 100}%`;
      band.style.width = `${(Math.max(0, tOut - tIn) / dur) * 100}%`;
    } else {
      band.hidden = true;
    }
  }
  MC.timeline.updateHead();
};

/* --- 最初のモード選択(縦型作成 / 自動スイッチング) ---
   presets/layouts = そのモードで選べるものだけ。ここに無い選択肢はUIに出さない */
MC.ui.MODES = {
  vertical: {
    preset: "9x16", layoutId: "v3", label: "縦型動画",   // 3分割縦積みが初期
    presets: ["9x16"],                                   // 縦型で固定(比率は選ばせない)
    layouts: ["v3", "v2", "big2", "single"],             // 横並べは廃止
  },
  wipeCam: {
    preset: "16x9", layoutId: "wipe", label: "ワイプカメラ動画",   // メイン固定+小窓2まで(2026-07-24)
    presets: ["16x9"],
    layouts: ["wipe"],
  },
  switch: {
    preset: "16x9", layoutId: "switch", label: "自動スイッチング動画",
    presets: ["16x9"],                                    // 横型のみ(2026-07-19 優さん指定)
    layouts: ["switch"],                                  // ワイプは専用モードへ分離(2026-07-24)
  },
};

/* いま選ばれているモードの設定 */
MC.ui.modeConf = () => MC.ui.MODES[MC.S.mode] || MC.ui.MODES.vertical;

/* 保存状態の復元やモード切替で、そのモードに無い比率/レイアウトが残らないように寄せる */
MC.ui.normalizeForMode = () => {
  const m = MC.ui.modeConf();
  if (!m.presets.includes(MC.S.preset)) MC.S.preset = m.preset;
  if (!m.layouts.includes(MC.S.layoutId)) MC.S.layoutId = m.layoutId;
};

MC.ui.chooseMode = (mode, { silent = false } = {}) => {
  const m = MC.ui.MODES[mode] || MC.ui.MODES.vertical;
  MC.S.mode = mode;
  if (!silent) {
    MC.S.preset = m.preset;
    MC.S.layoutId = m.layoutId;
    // 境界線の初期値はモードで変える: 自動スイッチングはオフ(全画面カットに枠は不要)、
    // 縦型(分割)はオン(2026-07-19 優さん指定)
    MC.S.borderOn = mode !== "switch";
  }
  MC.ui.normalizeForMode();
  if (!silent) MC.saveState();
  MC.ui.$("#modeSelect").hidden = true;
  MC.ui.$("#workspace").hidden = false;
  const lbl = MC.ui.$("#modeLabel");
  if (lbl) lbl.textContent = m.label;
  MC.preview.applyPreset();
  MC.ui.renderAll();
};

MC.ui.showModeSelect = () => {
  MC.preview.pause();  // 選択画面の裏で音が鳴り続けないように
  MC.ui.$("#workspace").hidden = true;
  MC.ui.$("#modeSelect").hidden = false;
};

/* --- イベント配線 --- */
MC.ui.wire = () => {
  const $ = MC.ui.$;

  document.querySelectorAll(".mode-card").forEach(card =>
    card.onclick = () => MC.ui.chooseMode(card.dataset.mode));
  document.querySelectorAll("#setupTabs .tab").forEach(b =>
    b.onclick = () => MC.ui.setSetupTab(b.dataset.tab));
  $("#easyStartBtn").onclick = () => {
    if (MC.S.easyDone) { $("#exportBtn").click(); return; }
    MC.ui.runEasy();
  };
  $("#modeBackBtn").onclick = () => MC.ui.showModeSelect();

  if (MC.cutmode) MC.cutmode.init();
  const prb = $("#projectResetBtn");
  if (prb) prb.onclick = () => MC.ui.resetProject();
  /* フロートのプレビューはタップで全画面。閉じるボタンで戻す
     (2026-07-21 優さん指示)。全画面中は本文のスクロールを止める */
  const holder = document.querySelector(".canvas-holder");
  const closeBtn = $("#floatClose");
  MC.ui.setFloatFull = on => {
    if (!holder) return;
    /* 全画面中は本文スクロールを完全に止める(2026-07-24 優さん指示: 下が
       スクロールできて透けていた)。iOSはoverflow:hiddenだけでは止まらないので
       bodyをposition:fixedにし、閉じるとき元のスクロール位置へ戻す */
    if (on && !holder.classList.contains("float-full")) {
      MC.ui._fullLockY = window.scrollY || 0;
      document.body.style.top = -MC.ui._fullLockY + "px";
    }
    holder.classList.toggle("float-full", !!on);
    document.body.classList.toggle("mz-float-full", !!on);   // バー類を隠すため
    document.documentElement.style.overflow = on ? "hidden" : "";
    if (!on) {
      document.body.style.top = "";
      window.scrollTo(0, MC.ui._fullLockY || 0);
    }
    MC.ui.renderFullLabel(!!on);   // 全画面中だけ「この見た目で書き出します」(2026-07-23)
  };
  if (holder) holder.addEventListener("click", ev => {
    if (ev.target.closest("#floatClose")) return;        // 閉じるボタンは別処理
    if (holder.classList.contains("float-full")) return; // 全画面中の誤タップでは閉じない
    if (!document.body.classList.contains("mz-has-clips")) return;  // 素材が無い時は何もしない
    if (document.body.classList.contains("cutmode-open")) return;
    MC.ui.setFloatFull(true);
  });
  if (closeBtn) closeBtn.onclick = ev => { ev.stopPropagation(); MC.ui.setFloatFull(false); };
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && holder && holder.classList.contains("float-full")) MC.ui.setFloatFull(false);
  });

  const dz = $("#clipSlots"), fi = $("#fileInput"), fiv = $("#fileInputV");
  fi.onchange = () => { MC.media.addFiles([...fi.files]); fi.value = ""; };
  fiv.onchange = () => { MC.media.addFiles([...fiv.files]); fiv.value = ""; };
  /* 音声を選ぶフェーズ(2026-07-24)。別録り音源の取り込みは廃止(優さん指示) */
  $("#audioListenBtn").onclick = () => {
    MC.preview.toggle();
    /* 再生状態はplay()のPromise後に確定するので少し待ってから表示を合わせる */
    setTimeout(() => {
      const b = $("#audioListenBtn");
      if (b) b.innerHTML = MC.S.playing
        ? '<i class="fa-solid fa-pause"></i> 停止'
        : '<i class="fa-solid fa-headphones"></i> 試聴する';
    }, 250);
  };
  $("#audioDecideBtn").onclick = () => {
    if (MC.ui._busy) return;
    MC.preview.pause();
    MC.S.audioDecided = true;
    if (MC.ui._setupTab === "pro") {
      /* こだわりタブは自走させない(同期→カット割→色を自分の手順で進める人) */
      MC.ui.refreshJourney();
      MC.ui.toast("この音で進めます");
      return;
    }
    if (!MC.S.easyDone) MC.ui.runEasyFinish();
    else MC.ui.refreshJourney();   // 仕上げ済みで選び直しただけなら状態更新のみ
  };
  ["dragover", "dragenter"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", e => MC.media.addFiles([...e.dataTransfer.files]));

  $("#syncBtn").onclick = async () => {
    $("#syncBtn").disabled = true;
    const p = MZP.start({ mount: "#syncStatus", chapter: "同期", steps: 4,
                          label: "音を分析しています…" });
    try {
      const r = await MC.sync.run(p);
      // カラー自動マッチ(初期ON)。失敗しても同期は成功扱い
      const vclips = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
      if (MC.S.colorOn && vclips.length >= 2 && !vclips.some(c => c.colorT)) {
        p.step(3, "色をそろえています…");
        try { await MC.color.run(p); MC.ui.renderFinish(); }
        catch (e) { MC.log("自動カラーマッチ失敗:", e.message); }
      }
      // 最初と最後の自動カット(初期ON)。ユーザーがトリム済みなら触らない
      if (MC.S.autoTrim && MC.S.trimIn === 0 && MC.S.trimOut == null) {
        p.step(4, "最初と最後を探しています…");
        await MZP.paint();
        await MC.salute.autoTrim();
        MC.preview.seek(MC.trimRange()[0]);
      }
      const [ti, to] = MC.trimRange();
      p.done(r && r.low ? `ズレを合わせました(${r.low}本は手動調整をおすすめします)`
                        : "ズレを合わせました",
             { sub: MC.S.trimOut != null ? `書き出し範囲 ${MC.ui.fmtTime(ti)}〜${MC.ui.fmtTime(to)} を自動設定` : "" });
      // 次のフェーズ(整える)へそっと誘導
      setTimeout(() => { MC.ui.gentleScrollTo($("#layoutSec"), "start"); }, 900);
    } catch (e) {
      MC.ui.toast("⚠ 同期に失敗: " + e.message); console.error(e);
      p.fail("ズレを合わせられませんでした", { detail: e.message,
        retry: () => $("#syncBtn").click() });
    } finally { $("#syncBtn").disabled = MC.S.clips.length < 2; }
  };

  $("#playBtn").onclick = () => MC.preview.toggle();
  const scrub = $("#scrub");
  scrub.oninput = () => { MC.ui._scrubbing = true; MC.preview.pause(); MC.preview.seek(parseFloat(scrub.value)); MC.ui.updateTransport(); };
  scrub.onchange = () => { MC.ui._scrubbing = false; };

  $("#trimInBtn").onclick = () => { MC.S.trimIn = MC.S.t; if (MC.S.trimOut != null && MC.S.trimOut <= MC.S.trimIn) MC.S.trimOut = null; MC.saveState(); MC.ui.updateTransport(); };
  $("#trimOutBtn").onclick = () => { if (MC.S.t > MC.S.trimIn + 0.1) { MC.S.trimOut = MC.S.t; MC.saveState(); MC.ui.updateTransport(); } };
  $("#trimResetBtn").onclick = () => { MC.S.trimIn = 0; MC.S.trimOut = null; MC.saveState(); MC.ui.updateTransport(); };

  $("#exportBtn").onclick = async () => {
    if (MC.exporter.running) return;
    MC.preview.pause();
    const prog = $("#exportProgress");   // 旧・パネル内進捗(全画面移行後は使わない)
    $("#doneCard").hidden = true;
    $("#exportBtn").disabled = true;
    $("#cancelBtn").style.display = "inline-block";
    const mode = MC.ui.exportMode();

    /* プラン上の書き出し上限(登録8分30秒 / ゲスト5分)。
       端末のメモリ上限とは理由が違うので、案内も分ける */
    {
      const lim = window.MZ_LIMITS;
      const [tI, tO] = MC.trimRange();
      const wantSec = Math.max(0, tO - tI);
      if (lim && wantSec > lim.maxExportSec) {
        MC.ui.showExportLimitHelp(wantSec, lim);
        $("#exportBtn").disabled = !MC.S.clips.length;
        $("#cancelBtn").style.display = "none";
        prog.style.display = "none";
        return;
      }
    }

    /* 保存先を先に決める。ここで得たハンドルへ muxer が直接書くので、
       完成MP4をメモリに溜めずに済む(長尺の Array buffer allocation failed 対策)。
       showSaveFilePicker はユーザー操作の直後でないと拒否されるため、
       進捗表示やデコードを始める前に呼ぶ。

       ただしダイアログには macOS/Chrome の警告文が付き、こちらでは変えられない。
       短い書き出しはメモリに載るので従来どおり自動ダウンロードにして、
       ダイアログは容量が大きい見込みのときだけ出す */
    let saveHandle = null;
    const estBytes = MC.exporter.estimateBytes();
    const needsStream = estBytes > MC.exporter.MEM_LIMIT_BYTES;
    if (mode !== "realtime" && needsStream && window.showSaveFilePicker) {
      const suggested = `MarchinZ_Switcher_${MC.S.preset}_${new Date().toISOString().slice(0, 10)}.mp4`;
      try {
        saveHandle = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: "MP4 動画", accept: { "video/mp4": [".mp4"] } }],
        });
      } catch (err) {
        if (err && err.name === "AbortError") {   // 保存先選択をやめた
          $("#exportBtn").disabled = !MC.S.clips.length;
          $("#cancelBtn").style.display = "none";
          return;
        }
        // ピッカーが使えないときは従来どおりメモリ経由で書き出す
        MC.log(`保存先の選択に失敗（${err && err.name}）。メモリ経由で続けます`);
      }
    } else if (mode !== "realtime") {
      MC.log(`推定 ${(estBytes / 1e6).toFixed(0)}MB。メモリ経由で書き出します（保存先の確認は出しません）`);
      /* 保存先を選べない環境(iPhone等)はディスクへ直接書けず、完成MP4を
         すべてメモリに載せるしかない。iOS は上限が厳しく、超えるとタブごと
         落ちてエラーも出ない。無警告で走らせず、ここで止める */
      if (estBytes > MC.exporter.MEM_HARD_LIMIT && !window.showSaveFilePicker) {
        /* 断る前に、もう一度だけOPFS(ディスク直書き)を実測する【敗者復活】。
           起動時の実測が一時的な理由で失敗すると false が永久キャッシュされ、
           本当は書ける端末まで4分上限に落ちていた(2026-07-24 優さんのiPhoneで発覚) */
        MC.ui.toast("この端末で長尺を書き出せるか確認しています…", 3000);
        const revived = await MC.exporter.probeOpfs(true);
        if (revived) {
          MC.log("OPFS敗者復活: ディスク直書きが使えたので上限なしで続行します");
        } else {
          const mb = Math.round(estBytes / 1e6);
          const okMin = Math.max(1, Math.floor(MC.exporter.MEM_HARD_LIMIT
            / ((MC.exporter.videoBitrate() + 192e3) / 8) / 60));
          MC.ui.toast(`この長さ(約${mb}MB)はこの端末では書き出せません。`
            + `${okMin}分以内に範囲を狭めてお試しください`, 7000);
          MC.ui.showLongExportHelp(okMin, mb);
          $("#exportBtn").disabled = !MC.S.clips.length;
          $("#cancelBtn").style.display = "none";
          prog.style.display = "none";
          return;
        }
      }
    }

    /* 書き出しはサイト全体(全タブ)で同時に1本だけ。
       2026-07-20、縦型とスイッチングを別タブで同時に書き出した結果、
       同一プロセスのメモリを取り合って 20:38:26 に両方が同時死した
       (muxer の RangeError と NotReadableError は同じメモリ枯渇の別の顔)。
       Web Locks は同一オリジンの全タブで共有される */
    let releaseExportLock = null;
    if (navigator.locks) {
      const got = await new Promise(resolve => {
        navigator.locks.request("mz-export", { ifAvailable: true }, lock => {
          if (!lock) { resolve(false); return; }
          resolve(true);
          return new Promise(r => { releaseExportLock = r; });  // 書き出し中は保持
        }).catch(() => resolve(true));   // Locks自体の失敗は素通し(単独タブ想定)
      });
      if (!got) {
        MC.ui.toast("別のタブで書き出し中です。終わってからもう一度お試しください");
        $("#exportBtn").disabled = !MC.S.clips.length;
        $("#cancelBtn").style.display = "none";
        prog.style.display = "none";
        return;
      }
    }
    MC.ui.exportOverlay.open();   // ここから全画面(案B)。進捗は下のmountへ実る
    const p = MZP.start({
      mount: "#eoProgress", chapter: "書き出し", delay: 0,
      label: mode === "realtime" ? "再生しながら録画しています…" : "映像を作っています…",
      sub: mode === "realtime" ? "画面を閉じずにお待ちください" : "",
      // 中止は枠の外の #cancelBtn が既に担っているので、ここでは出さない(二重表示の回避)
    });
    MC.ui.clearErrorLog();   // やり直しでは前回の失敗ログを見せない
    /* 書き出し中はボタンを全部止める。以前は離脱防止だけで、
       3つある書き出しボタンがどれも押せて二重起動できた(2026-07-22)。
       中止(#cancelBtn)は setBusy の対象外なのでいつでも押せる */
    MC.ui.setBusy(true);
    try {
      if (mode === "none") throw new Error("この環境では書き出しできません");
      const res = mode === "realtime"
        ? await MC.exporter.exportRealtime(p.legacy())
        : await MC.exporter.exportMP4(p.legacy(), saveHandle);
      p.done("書き出しました", { chip: false });
      MC.ui.showDone(res);
    } catch (e) {
      console.error(e);
      if (e.message.includes("キャンセル")) {
        p.close();
        MC.ui.exportOverlay.close();   // 中止はそのまま元の画面へ
        MC.ui.toast("書き出しを中止しました");
      } else {
        p.fail("書き出せませんでした", { detail: MC.ui.exportFailHint(e) });
        MC.ui.exportOverlay.fail();    // 全画面に失敗表示を残し「閉じる」を出す
        MC.ui.showErrorLog(e);
        MC.ui.markExportFailed();   // 「準備ができました」を残さない
      }
    } finally {
      MC.ui.setBusy(false);   // ボタン解放+離脱防止の解除をまとめて
      if (releaseExportLock) releaseExportLock();
      $("#exportBtn").disabled = !MC.S.clips.length;
      $("#cancelBtn").style.display = "none";
      setTimeout(() => { prog.style.display = "none"; }, 2500);
    }
  };
  $("#cancelBtn").onclick = () => { MC.exporter.cancelFlag = true; };
  $("#saveBtn").onclick = () => MC.ui.saveResult();
  $("#downloadBtn").onclick = () => {
    const r = MC.exporter.lastResult;
    if (r) MC.exporter.triggerDownload(r.blob, r.name);
  };
  // 書き出し全画面(案B)のボタン。中身はパネル側と同じ動きに寄せる
  $("#eoCancel").onclick = () => { MC.exporter.cancelFlag = true; };
  $("#eoSaveBtn").onclick = () => MC.ui.saveResult();
  $("#eoDownloadBtn").onclick = () => {
    const r = MC.exporter.lastResult;
    if (r) MC.exporter.triggerDownload(r.blob, r.name);
  };
  $("#eoClose").onclick = () => MC.ui.exportOverlay.close();
  document.addEventListener("keydown", ev => {
    // Escは「閉じる」が出ているときだけ(書き出し中の誤爆で消さない)
    if (ev.key === "Escape" && !$("#exportOverlay").hidden && !$("#eoClose").hidden) {
      MC.ui.exportOverlay.close();
    }
  });

  // --- Phase 2: 自動カット割+ワイプ+タイムライン ---
  $("#bpbSelect").onchange = e => { MC.S.beatsPerBar = parseInt(e.target.value); MC.saveState(); };
  MC.ui.renderLevel();
  $("#autocutBtn").onclick = async () => {
    $("#autocutBtn").disabled = true;
    MC.preview.pause();   // 解析中はvideo要素をシークで専有する
    const p = MZP.start({ mount: "#autocutStatus", chapter: "レイアウト",
                          delay: 0, steps: 3 });
    p.pulse("音楽を解析しています…");
    await MZP.paint();
    try {
      const r = await MC.director.run(p);
      p.done(`${r.bpm.toFixed(0)} BPM・${r.segments}カットを作りました`,
             { sub: `ディゾルブ${r.dissolves}回・帯をタップするとそこへ移動します` });
      MC.timeline.render();
      MC.preview.seek(MC.trimRange()[0]);
    } catch (e) {
      console.error(e);
      p.fail("カット割を作れませんでした", { detail: e.message });
      MC.ui.showErrorLog(e);
    } finally { $("#autocutBtn").disabled = false; }
  };
  $("#wipeMainSelect").onchange = e => { MC.S.wipeMainId = parseInt(e.target.value); MC.ui.renderLayout(); MC.saveState(); MC.preview.draw(); };
  $("#wipeCamSelect").onchange = e => { MC.S.wipeClipId = parseInt(e.target.value); MC.saveState(); MC.preview.draw(); };
  $("#wipePosSelect").onchange = e => { MC.S.wipePos = e.target.value; MC.saveState(); MC.preview.draw(); };
  $("#wipeCamSelect2").onchange = e => { MC.S.wipeClipId2 = e.target.value ? parseInt(e.target.value) : null; MC.saveState(); MC.preview.draw(); };
  $("#wipePosSelect2").onchange = e => { MC.S.wipePos2 = e.target.value; MC.saveState(); MC.preview.draw(); };
  $("#wipeSizeRange").oninput = e => { MC.S.wipeSize = parseFloat(e.target.value); MC.saveState(); MC.preview.draw(); };
  // 境界線
  $("#borderToggle").onchange = e => { MC.S.borderOn = e.target.checked; MC.saveState(); MC.preview.draw(); };
  $("#borderColor").oninput = e => { MC.S.borderColor = e.target.value; MC.saveState(); MC.preview.draw(); };
  $("#borderWRange").oninput = e => {
    MC.S.borderW = parseInt(e.target.value);
    $("#borderWVal").textContent = MC.S.borderW + "px";
    MC.saveState(); MC.preview.draw();
  };

  // --- Phase 3: 仕上げ ---
  $("#filterSelect").innerHTML = Object.entries(MC.color.FILTERS)
    .map(([id, f]) => `<option value="${id}">${f.name}</option>`).join("");
  $("#filterSelect").onchange = e => { MC.S.filterId = e.target.value; MC.saveState(); MC.preview.draw(); };
  $("#colorStrength").oninput = e => { MC.S.colorStrength = parseFloat(e.target.value); MC.saveState(); MC.preview.draw(); };
  $("#colorMatchBtn").onclick = async () => {
    $("#colorMatchBtn").disabled = true;
    const p = MZP.start({ mount: "#finishStatus", chapter: "仕上げ",
                          label: "色を見比べています…" });
    try {
      await MC.color.run(p);
      p.done("色をそろえました", { sub: "音声に使うカメラに合わせています" });
      MC.ui.renderFinish(); MC.preview.draw();
    } catch (e) {
      console.error(e);
      p.fail("色をそろえられませんでした", { detail: e.message });
    } finally { $("#colorMatchBtn").disabled = false; }
  };
  $("#colorClearBtn").onclick = () => {
    MC.S.colorOn = false;
    MC.S.clips.forEach(c => { c.colorT = null; });
    MC.saveState(); MC.ui.renderFinish(); MC.preview.draw();
    $("#finishStatus").textContent = "";
  };
  const att = $("#autoTrimToggle");
  att.checked = MC.S.autoTrim;
  att.onchange = e => { MC.S.autoTrim = e.target.checked; MC.saveState(); };
  $("#saluteBtn").onclick = async () => {
    $("#saluteBtn").disabled = true;
    const p = MZP.start({ mount: "#finishStatus", chapter: "仕上げ", delay: 0 });
    p.frozen("演奏のはじまりを探しています…");
    await MZP.paint();   // 画面が止まる前に、必ず表示を描いてから解析へ入る
    try {
      MC.ui._salute = await MC.salute.detect();
      const s = MC.ui._salute;
      $("#saluteRow").style.display = "flex";
      $("#saluteInfo").textContent =
        `演奏 ${MC.ui.fmtTime(s.musicStart)} 〜 ${s.musicEnd ? MC.ui.fmtTime(s.musicEnd) : "?"}`;
      p.done(`演奏のはじまりは ${MC.ui.fmtTime(s.musicStart)} でした`);
      MC.ui.renderScrubTicks();
    } catch (e) {
      p.fail("演奏のはじまりを見つけられませんでした", { detail: e.message });
    } finally { $("#saluteBtn").disabled = false; }
  };
  $("#saluteInBtn").onclick = () => {
    const s = MC.ui._salute; if (!s) return;
    const pre = parseFloat($("#preRoll").value) || 0;
    MC.S.trimIn = Math.max(0, s.musicStart - pre);
    if (MC.S.trimOut != null && MC.S.trimOut <= MC.S.trimIn) MC.S.trimOut = null;
    MC.saveState(); MC.ui.updateTransport(); MC.preview.seek(MC.S.trimIn);
    MC.ui.toast(`INを ${MC.ui.fmtTime(MC.S.trimIn)} に設定しました(演奏開始の${pre}秒前)`);
  };
  $("#saluteOutBtn").onclick = () => {
    const s = MC.ui._salute; if (!s || s.musicEnd == null) { MC.ui.toast("終了位置は検出できていません"); return; }
    MC.S.trimOut = Math.min(MC.timelineDuration(), s.musicEnd + MC.salute.OUT_AFTER);
    MC.saveState(); MC.ui.updateTransport();
    MC.ui.toast(`OUTを ${MC.ui.fmtTime(MC.S.trimOut)} に設定しました(演奏終了+${MC.salute.OUT_AFTER}秒)`);
  };
};

/* 切替頻度(少なめ/おすすめ/多め)のセグメントコントロール */
MC.ui.renderLevel = () => {
  const seg = MC.ui.$("#levelSeg");
  if (!seg) return;
  seg.querySelectorAll("button").forEach(b => {
    const lv = parseInt(b.dataset.lv);
    b.classList.toggle("selected", lv === MC.S.cutLevel);
    b.setAttribute("aria-checked", lv === MC.S.cutLevel ? "true" : "false");
    b.onclick = () => {
      MC.S.cutLevel = lv;
      MC.saveState();
      MC.ui.renderLevel();
    };
  });
};

/* 仕上げパネルの状態反映(カラーマッチON表示+水平スライダー) */
MC.ui.renderFinish = () => {
  const on = MC.S.colorOn && MC.S.clips.some(c => c.colorT);
  MC.ui.$("#colorClearBtn").style.display = on ? "inline-block" : "none";
  MC.ui.$("#colorStrengthRow").style.display = on ? "flex" : "none";
  MC.ui.$("#colorStrength").value = MC.S.colorStrength;
  MC.ui.$("#filterSelect").value = MC.S.filterId;

  /* 自動水平補正のUIはここには置かない。「カメラの配置と傾き」(tiltBox)に一本化
     (2026-07-24 優さん指示: 2箇所にあって混雑していた) */
};

/* サリュート検出結果をスクラブバー上のマーカーで表示 */
MC.ui.renderScrubTicks = () => {
  const box = MC.ui.$("#scrubTicks");
  box.innerHTML = "";
  const s = MC.ui._salute;
  const dur = MC.timelineDuration();
  if (!s || !dur) return;
  const mk = (t, cls, label) => {
    if (t == null) return;
    const el = document.createElement("div");
    el.className = "scrub-tick " + cls;
    el.style.left = (t / dur * 100) + "%";
    el.title = label;
    box.appendChild(el);
  };
  mk(s.musicStart, "start", "演奏開始");
  mk(s.musicEnd, "end", "演奏終了");
};
