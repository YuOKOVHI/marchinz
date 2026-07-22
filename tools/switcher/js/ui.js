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
  $("#doneNote").textContent =
    `iPhone・iPadは動画を丸ごとメモリに載せるため、${okMin}分ほどが上限です。`
    + `「ここから書き出す IN」「ここまで OUT」で範囲を狭めるか、`
    + `パソコンのChromeで開くと最後まで書き出せます。`;
};

MC.ui.showDone = res => {
  const share = MC.exporter.shareMode();
  const $ = MC.ui.$;
  $("#doneCard").hidden = false;
  /* ディスクへ直接書き出した場合は blob を持たない(メモリに溜めないため)。
     その場では既に保存が終わっているので、再保存の導線は出さない */
  if (res && res.saved) {
    $("#saveBtn").style.display = "none";
    const dl = $("#downloadBtn"); if (dl) dl.style.display = "none";
    $("#doneText").innerHTML = `<span class="ok">✓ 「${MC.ui.esc(res.name)}」を保存しました</span>`;
    $("#doneNote").textContent = "選んだ場所に書き出し済みです。";
    MC.ui.toast("✔ 書き出しが完了しました");
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
};

/* 保存の実行。iOSはWeb Shareで写真/ファイルへ、それ以外はダウンロード */
MC.ui.saveResult = async () => {
  const r = MC.exporter.lastResult;
  if (!r) return;
  if (MC.exporter.shareMode()) {
    try {
      const file = new File([r.blob], r.name, { type: r.type || r.blob.type });
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e && e.name === "AbortError") return;         // ユーザーがキャンセル
      MC.log("share失敗→ダウンロード:", e && e.message);
      MC.exporter.triggerDownload(r.blob, r.name);        // 最後の手段
    }
  } else {
    MC.exporter.triggerDownload(r.blob, r.name);
  }
};

MC.ui.fmtTime = s => {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60), sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
};

/* innerHTMLへ流し込むファイル名等のHTMLエスケープ(自己XSS防止) */
MC.ui.esc = s => String(s).replace(/[&<>"']/g,
  ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

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
     端末上限(8分41秒など)の半端な数字ではなく、案内している上限と同じ
     キリのいい長さに揃える。ゲスト等で上限がさらに短ければそちらに従う */
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
        ? `iPhone・iPadは動画を丸ごとメモリに載せるため、${fitLabel}までです。`
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

MC.ui.focusNextAction = () => {
  if (!MC.S.clips.length) return;
  setTimeout(() => {
    const btn = MC.ui.$("#easyStartBtn");
    if (!btn || btn.offsetParent === null) return;
    const r = btn.getBoundingClientRect();
    const visible = r.top >= 0 && r.bottom <= window.innerHeight;
    if (visible) return;
    const panel = btn.closest(".panel") || btn;
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
    panel.classList.add("mz-focus-flash");
    setTimeout(() => panel.classList.remove("mz-focus-flash"), 1200);
  }, 260);   // サムネ生成でレイアウトが動くので少し待つ
};

/* おまかせ完了状態の解除。素材・モードが変わったら準備からやり直し */
MC.ui.resetEasyDone = () => {
  if (!MC.S.easyDone) return;
  MC.S.easyDone = false;
  MC.ui.renderEasyButton();
};

MC.ui.renderAll = () => {
  MC.ui.applyGuestLocks();
  {
    const prb = MC.ui.$("#projectResetBtn");
    if (prb) prb.hidden = !MC.S.clips.length;
  }
  /* スマホのフロートプレビューは素材があるときだけ(空の黒枠を浮かせない) */
  document.body.classList.toggle("mz-has-clips", MC.S.clips.length > 0);
  /* カット切替モードの入口はカットがあるときだけ */
  {
    const cmb = MC.ui.$("#cutModeBtn");
    if (cmb) cmb.hidden = !MC.S.cutList.length;
  }
  MC.ui.renderClips();
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
  MC.ui.refreshJourney();
};

/* ---- ジャーニーバー(どのフェーズにいるかの常時表示) ---- */
MC.ui.JOURNEY_SECTIONS = { mat: "#dropSec", sync: "#syncSec", polish: "#layoutSec", export: "#exportSec" };

MC.ui.initJourney = () => {
  MZJourney.init({
    container: MC.ui.$("#workspace"),
    phases: [
      { id: "mat",    label: "素材",     hint: "3つまでまとめて選べます" },
      { id: "sync",   label: "同期",     hint: "「波形で同期する」でズレを合わせます" },
      { id: "polish", label: "整える",   hint: "音声・レイアウト・仕上げを整えます" },
      { id: "export", label: "書き出す", hint: "「MP4を書き出す」で完成です" },
    ],
    doneHint: "書き出し完了。調整して書き出し直すこともできます",
    canSelect: () => true,   // タップ=そのセクションへ移動(状態は変えないので常に安全)
    onSelect: id => {
      const el = document.querySelector(MC.ui.JOURNEY_SECTIONS[id]);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  });
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
    } else if (cur === "sync") {
      conf = { label: "波形で同期する", icon: "fa-wave-square",
        disabled: MC.ui.$("#syncBtn").disabled, act: () => MC.ui.$("#syncBtn").click() };
    } else if (cur === "polish") {
      const cutMode = ["switch", "wipe"].includes(MC.S.layoutId);
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
        if (dup) { bar.classList.remove("on"); return; }
        conf = { label: "MP4を書き出す", icon: "fa-file-export",
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
  if (!conf) { bar.classList.remove("on"); return; }
  bar.classList.add("on");
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
  const done = [];
  if (slot.length) done.push("mat");
  if (slot.length && synced) done.push("sync");
  if (exported) done.push("polish", "export");
  const current = !slot.length ? "mat"
    : (vids.length >= 2 && !synced) ? "sync"
    : exported ? "export" : "polish";
  MZJourney.set(current, done);
  // 現在フェーズのセクションをそっと強調
  document.querySelectorAll(".side .panel").forEach(p => p.classList.remove("phase-current"));
  const target = document.querySelector(MC.ui.JOURNEY_SECTIONS[current]);
  if (target) target.classList.add("phase-current");
  MC.ui.updateActionBar();
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
    card.className = "clip-card";
    const badgeCls = c.isImage ? "" : c.syncMethod === "基準" ? "ref" : c.syncMethod.startsWith("波形") ? "wave" : c.syncMethod.startsWith("タイムスタンプ") ? "ts" : "";
    const conf = c.confidence != null && isFinite(c.confidence) ? `信頼度${c.confidence.toFixed(1)}` : "";
    card.innerHTML = `
      ${c.thumb ? `<img class="clip-thumb" src="${c.thumb}">` : `<div class="clip-thumb"></div>`}
      <div class="clip-info">
        <div class="clip-name" title="${MC.ui.esc(c.name)}">${MC.ui.esc(c.name)}</div>
        <div class="clip-meta">${c.width}×${c.height}${c.isImage ? "・写真" : "・" + MC.ui.fmtTime(c.duration)}</div>
        ${c.isImage ? "" : `
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
        <div class="pan-row">横位置 <input type="range" class="pan" min="0" max="1" step="0.01" value="${c.pan}"></div>
        ${MC.S.mode === "switch" ? `
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
    card.querySelector(".pan").oninput = e => { c.pan = parseFloat(e.target.value); MC.saveState(); };
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
  MC.ui.$("#autocutPanel").style.display = isCutMode ? "block" : "none";
  MC.ui.$("#wipeOpts").hidden = L.type !== "wipe";
  if (L.type === "wipe") {
    const pipCands = MC.media.slotClips();
    const ws = MC.ui.$("#wipeCamSelect");
    ws.innerHTML = pipCands.map(c =>
      `<option value="${c.id}" ${MC.S.wipeClipId === c.id ? "selected" : ""}>${MC.ui.esc(c.name.slice(0, 12))}</option>`).join("");
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
    el.innerHTML = `<span class="ok">✓ MP4 (H.264+AAC) 高速書き出し — そのままSNSに投稿できます</span>`;
    btn.innerHTML = '<i class="fa-solid fa-file-export"></i> MP4を書き出す';
  } else if (mode === "realtime") {
    const mp4 = MC.caps.recMime.startsWith("video/mp4");
    el.innerHTML = `<span class="warn">⚠ この端末は実時間録画モード(${mp4 ? "MP4" : "WebM"})。書き出し中は画面を閉じないでください</span>`;
    btn.innerHTML = `<i class="fa-solid fa-file-export"></i> ${mp4 ? "MP4" : "WebM"}を書き出す(実時間)`;
  } else if (mode === "mute") {
    el.innerHTML = `<span class="warn">⚠ 音声エンコード非対応 → 映像のみMP4</span>`;
    btn.innerHTML = '<i class="fa-solid fa-file-export"></i> MP4を書き出す(音声なし)';
  } else {
    el.innerHTML = `<span class="err">✗ この環境では書き出しできません(Safari/Chromeの最新版をお使いください)</span>`;
    btn.textContent = "書き出し不可";
  }
};

/* おまかせの説明。カット割をするのはスイッチング/ワイプのときだけなので、
   縦型では文言から外す(やらないことを書かない) */
MC.ui.renderEasyLead = () => {
  const el = document.querySelector(".easy-lead");
  if (!el) return;
  const cutMode = ["switch", "wipe"].includes(MC.S.layoutId);
  el.textContent = MC.S.easyDone
    ? "準備ができました。あとは書き出すだけです。"
    : cutMode
      ? "同期・カット割・色みまで、おまかせで仕上げます。"
      : "同期・色みまで、おまかせで仕上げます。";
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
    lead.innerHTML = '<span class="err">書き出しに失敗しました。下の「詳しいログ」に原因が出ています。'
      + 'ボタンからもう一度お試しください。</span>';
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
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> おまかせで開始';
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
  MC.ui._setupTab = tab;
  const easy = tab !== "pro";
  MC.ui.$("#easyPane").hidden = !easy;
  MC.ui.$("#proPane").hidden = easy;
  document.querySelectorAll("#setupTabs .tab").forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
};

MC.ui.refreshSetupTabs = () => {
  const has = MC.S.clips.length > 0;
  const tabs = MC.ui.$("#setupTabs");
  if (!tabs) return;
  tabs.hidden = !has;
  if (!has) { MC.ui.$("#proPane").hidden = true; return; }
  MC.ui.setSetupTab(MC.ui._setupTab || "easy");
};

/* おまかせで開始: 同期 → (カット割モードなら)自動カット割 → カラーマッチ を続けて実行 */
/* 長い処理の間、競合する操作をまとめて止める(二重実行でcutList/offsetが壊れるのを防ぐ) */
MC.ui.setBusy = busy => {
  MC.ui._busy = !!busy;
  const ids = ["#easyStartBtn", "#syncBtn", "#autocutBtn", "#colorMatchBtn", "#exportBtn", "#abPrimary"];
  ids.forEach(id => {
    const el = MC.ui.$(id);
    if (el) el.disabled = busy ? true : el.dataset.mzWasDisabled === "1";
  });
  const dz = MC.ui.$("#clipSlots");
  if (dz) dz.classList.toggle("mz-busy", !!busy);
  MC.ui.guardLeave(!!busy);   // 作業中はタブを閉じさせない・画面を消させない
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

MC.ui._onVisChange = () => {
  // 画面が戻ったら Wake Lock を取り直す(消灯・アプリ切替で解放されるため)
  if (document.visibilityState === "visible" && MC.ui._busy) MC.ui._holdWake(true);
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
      + '作業中です。この画面のまま、ほかのアプリに切り替えずにお待ちください';
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
    document.addEventListener("visibilitychange", MC.ui._onVisChange);
    MC.ui._holdWake(true);
  } else {
    window.removeEventListener("beforeunload", MC.ui._onBeforeUnload);
    document.removeEventListener("visibilitychange", MC.ui._onVisChange);
    MC.ui._holdWake(false);
  }
};

MC.ui.runEasy = async () => {
  const btn = MC.ui.$("#easyStartBtn");
  if (btn.disabled || MC.ui._busy) return;
  MC.ui.setBusy(true);
  MC.ui.clearErrorLog();   // やり直しでは前回の失敗ログを見せない
  MC.preview.pause();
  const cutMode = ["switch", "wipe"].includes(MC.S.layoutId);
  // sync/director/color はいずれも MZP の Handle をそのまま受け取る(legacy()は別物なので渡さない)
  const p = MZP.start({ mount: "#easyStatus", chapter: "おまかせ", delay: 0,
                        label: "音を合わせています…" });
  try {
    if (MC.S.clips.filter(c => !c.isImage).length >= 2) {
      p.pulse("音を合わせています…");
      await MC.sync.run(p);
    }
    // 開始/終了の自動区切り。演奏の前後(アナウンス・拍手・片付け)を落とす。
    // カット割より先に行う: director は MC.trimRange() の中だけを割るため
    if (MC.S.trimIn === 0 && MC.S.trimOut == null) {
      p.pulse("最初と最後を探しています…");
      await MZP.paint();
      await MC.salute.autoTrim();   // 検出できなければ静かに諦める(トリムなしで続行)
    }
    if (cutMode) {
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
    p.done("書き出す準備ができました", {
      sub: (colorFailed ? "色そろえだけできませんでした。" : "")
        + (trimmed ? `書き出し範囲 ${MC.ui.fmtTime(ti)}〜${MC.ui.fmtTime(to)} を自動設定。` : "")
        + "プレビューを見て、よければ書き出してください",
    });
    /* ここからの主役は書き出し。おまかせボタン自体を「動画を書き出す」に
       化けさせ、次にすることを迷わせない(2026-07-21 優さん指示) */
    MC.S.easyDone = true;
    /* 長すぎて書き出せない場合は、ここで知らせる。
       書き出しボタンを押すまで黙っていると「15分待って書き出せません」に
       なる(2026-07-21 実機で発生) */
    MC.ui.checkExportable();
  } catch (e) {
    console.error(e);
    p.fail("うまくできませんでした", { detail: e.message });
    MC.ui.showErrorLog(e);
  } finally {
    MC.ui.setBusy(false);
    MC.ui.renderAll();   // 途中で止まってもタイムライン等の表示を状態に合わせ直す
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
      const factor = MC.ui.exportMode() === "realtime" ? 1.15 : (MC.isIOS ? 1.8 : 0.9);
      const estMin = Math.max(1, Math.round(sec * factor / 60));
      const end = new Date(Date.now() + sec * factor * 1000);
      const endTxt = `${end.getHours()}:${String(end.getMinutes()).padStart(2, "0")}頃`;
      etaHint.textContent = `${mm}分${ss ? String(ss).padStart(2, "0") + "秒" : ""}の動画で、`
        + `書き出しにはおよそ${estMin}分（いま始めると${endTxt}に終わります）`;
    }
  }
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
  switch: {
    preset: "16x9", layoutId: "switch", label: "自動スイッチング動画",
    presets: ["16x9"],                                    // 横型のみ(2026-07-19 優さん指定)
    layouts: ["switch", "wipe"],                          // スイッチングとワイプのみ
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
    holder.classList.toggle("float-full", !!on);
    document.body.classList.toggle("mz-float-full", !!on);   // バー類を隠すため
    document.documentElement.style.overflow = on ? "hidden" : "";
  };
  if (holder) holder.addEventListener("click", ev => {
    if (ev.target.closest("#floatClose")) return;        // 閉じるボタンは別処理
    if (holder.classList.contains("float-full")) return; // 全画面中の誤タップでは閉じない
    if (!document.body.classList.contains("mz-has-clips")) return;  // フロートでない時は何もしない
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
  const ai = $("#audioInput");
  $("#audioImportBtn").onclick = () => ai.click();
  ai.onchange = async () => {
    if (ai.files.length) await MC.media.addAudioFile(ai.files[0]);
    ai.value = "";
  };
  ["dragover", "dragenter"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", e => MC.media.addFiles([...e.dataTransfer.files]));

  $("#syncBtn").onclick = async () => {
    $("#syncBtn").disabled = true;
    const p = MZP.start({ mount: "#syncStatus", chapter: "同期", steps: 4,
                          label: "音を取り出しています…" });
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
      setTimeout(() => {
        const el = $("#layoutSec");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 900);
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
    const prog = $("#exportProgress");
    prog.style.display = "block";
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
    const p = MZP.start({
      mount: "#exportProgress", chapter: "書き出し", delay: 0,
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
        MC.ui.toast("書き出しを中止しました");
      } else {
        p.fail("書き出せませんでした", { detail: MC.ui.exportFailHint(e) });
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

  // 自動水平補正のマスターON/OFFトグル
  const htoggle = MC.ui.$("#horizonToggle");
  const rows = MC.ui.$("#horizonRows");
  if (htoggle) {
    htoggle.checked = !!MC.S.horizonOn;
    rows.style.display = MC.S.horizonOn ? "" : "none";
    htoggle.onchange = async e => {
      MC.S.horizonOn = e.target.checked;
      MC.saveState();
      if (MC.S.horizonOn) {
        // ONにしたら未設定(rot=0)のスロットを一括で自動検出。手動調整済みの値は温存。
        htoggle.disabled = true;
        MC.ui.$("#finishStatus").textContent = "水平の傾きを自動検出中…";
        try {
          for (const c of MC.S.clips) {
            if (c.rot) continue;
            try { const sug = await MC.horizon.suggest(c); if (sug != null && sug !== 0) c.rot = sug; } catch (_) { /* noop */ }
          }
        } finally { htoggle.disabled = false; }
        MC.ui.$("#finishStatus").textContent = "自動水平補正: ON";
        MC.saveState();
      } else {
        MC.ui.$("#finishStatus").textContent = "自動水平補正: OFF";
      }
      MC.ui.renderFinish();
      MC.preview.draw();
    };
  }

  rows.innerHTML = "";
  for (const c of MC.S.clips.filter(x => !x.isAudio && !x.isImage)) {
    const div = document.createElement("div");
    div.className = "slot-row";
    div.innerHTML = `
      <label title="${MC.ui.esc(c.name)}">${MC.ui.esc(c.name.length > 8 ? c.name.slice(0, 7) + "…" : c.name)}</label>
      <input type="range" class="hrot" min="-5" max="5" step="0.1" value="${c.rot || 0}" style="flex:1; accent-color:var(--acc)">
      <span class="hval hint" style="width:44px; text-align:right">${(c.rot || 0).toFixed(1)}°</span>
      <button class="btn small hauto" title="傾きを自動検出">📐</button>`;
    const slider = div.querySelector(".hrot"), val = div.querySelector(".hval");
    slider.oninput = e => {
      c.rot = parseFloat(e.target.value);
      val.textContent = c.rot.toFixed(1) + "°";
      MC.saveState(); MC.preview.draw();
    };
    div.querySelector(".hauto").onclick = async ev => {
      ev.target.disabled = true;
      try {
        const sug = await MC.horizon.suggest(c);
        if (sug == null || sug === 0) MC.ui.toast(`${c.name}: 傾きは検出されませんでした`);
        else {
          c.rot = sug; slider.value = sug; val.textContent = sug.toFixed(1) + "°";
          MC.saveState(); MC.preview.draw();
          MC.ui.toast(`${c.name}: ${sug.toFixed(1)}° の水平補正を提案・適用(スライダーで調整可)`);
        }
      } finally { ev.target.disabled = false; }
    };
    rows.appendChild(div);
  }
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
