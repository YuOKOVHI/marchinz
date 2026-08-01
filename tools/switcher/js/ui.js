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
  /* 上限は「会員種別 × 端末」で決まる(2026-07-31)。次の一手も相手で変える ─
     スマホの登録ユーザーに「無料登録すると」と言っても、登録済みなので伸びない */
  const back = "「長さと開始位置」に戻ると、収まる長さを選び直せます。";
  if (lim.unlimited) {
    note.textContent = back;
  } else if (lim.member && lim.mobile) {
    note.textContent = back + "パソコンで開くと10分まで書き出せます（ショウ全体が入ります）。";
  } else if (lim.member) {
    note.textContent = back;
  } else {
    note.innerHTML = MC.ui.esc(back)
      + `無料登録すると${MC.ui.esc(lim.memberExportLabel)}まで書き出せます。`
      + (lim.mobile ? "パソコンで開けば10分まで（ショウ全体が入ります）。" : "")
      + ' <a href="/#signup">無料登録</a>';
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
    el.classList.remove("eo-failed");   // 前回の失敗表示を引きずらない
    /* 開始前の見積りを引き継ぐ。実測の残り時間が出るまでの間、
       ここだけが「あと何分か」の手がかりになる */
    const pre = MC.ui.$("#exportEtaHint");
    const preEl = MC.ui.$("#eoPreEta");
    if (preEl) {
      preEl.textContent = (pre && pre.textContent) || "";
      preEl.hidden = !preEl.textContent;
      preEl.classList.remove("eo-resume");
    }
    /* 「前回のつづきから ─ ◯分ぶんは終わっています」の常設案内は廃止
       (2026-07-31 優さん指示「落ちたら結局戻れないからその案内けして」)。
       戻れると書いておいて戻れないのは、黙っているより悪い。
       中の仕組み(完了パートの再利用)は残す ─ 効いたときは黙って速くなる */
    MC.ui.showResumeNoteIfAny = () => {};
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
    MC.ui.renderFaceNote();   // Privacy の実態から組み立てる(固定文にしない)
    MC.ui.showExportStats();
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
    MC.ui.$("#eoTitleIcon").className = "fa-solid fa-triangle-exclamation eo-fail";
    MC.ui.$("#eoCancel").style.display = "none";   // 失敗後の中止は意味がない
    MC.ui.$("#eoClose").hidden = false;            // 詳細はMZPのfail表示が出ている
    /* 「この画面のままお待ちください」を消す(2026-07-25 実機レビュー)。
       失敗しているのに待機を促す文が残り、画面が矛盾していた。
       #eoRun ごと隠してはいけない ─ 失敗の理由を出す #eoProgress(MZPのfailカード)が
       その中にあるため、丸ごと隠すと対処法まで消える。案内文だけを落とす。
       アイコンも eo-fail で危険色にする(それまで通常時と同じブランド青で、
       色による危険の信号がゼロだった) */
    el.classList.add("eo-failed");
  },
  close() {
    const el = MC.ui.$("#exportOverlay");
    if (!el) return;
    el.hidden = true;
    document.body.classList.remove("mz-export-open");
  },
};

/* 「書き出しの記録」。成功したときは今までログがどこにも出ず、実機(iPhone)では
   何にどれだけ掛かったのか確かめようがなかった(失敗時の #errorLog だけが出口だった)。
   ここが速度改善の効果を実機で読むための唯一の窓口になる。
   ログ文字列を読み取るのではなく MC.exporter.lastStats(構造体)から組み立てる。 */
MC.ui.showExportStats = () => {
  const host = MC.ui.$("#eoStats");
  const s = MC.exporter.lastStats;
  if (!host) return;
  if (!s) { host.hidden = true; return; }
  const sec = ms => (ms / 1000).toFixed(1);
  const mmss = t => `${Math.floor(t / 60)}分${String(Math.round(t % 60)).padStart(2, "0")}秒`;
  /* 全角は2桁ぶんの幅を取るので、文字数ではなく表示幅で揃える。
     iPhone(375px)で折り返さない範囲に収めること ─ 折り返すと表が読めなくなる */
  const padW = (str, width) => {
    let w = 0;
    for (const ch of str) w += /[\u3000-\u30ff\u4e00-\u9fff\uff00-\uff60]/.test(ch) ? 2 : 1;
    return str + " ".repeat(Math.max(0, width - w));
  };
  const bucket = (name, ms) => {
    const tot = s.decodeMs + s.drawMs + s.waitMs + s.encodeMs;
    const pc = tot > 0 ? Math.round(ms / tot * 100) : 0;
    return `  ${padW(name, 13)}${sec(ms).padStart(5)}秒 ${String(pc).padStart(3)}%`;
  };
  const speed = s.spanSec > 0 ? (s.spanSec / (s.totalMs / 1000)).toFixed(1) : "-";
  const lines = [
    `書き出し ${sec(s.totalMs)}秒`,
    `素材 ${mmss(s.spanSec)} → 実時間の${speed}倍速`,
    `${s.w}x${s.h} ${(s.bitrate / 1e6).toFixed(0)}Mbps ${s.frames}コマ`,
    `カメラ${s.cams}台 / ${s.layoutId} / 画質 ${s.quality}`,
    "",
    "── 何に時間がかかったか ──",
    bucket("デコード待ち", s.decodeMs),
    bucket("合成", s.drawMs),
    bucket("下流待ち", s.waitMs),
    bucket("投入", s.encodeMs),
    "  ※下流待ちはGPU全体の待ち時間です",
    "    (エンコードだけの重さではありません)",
    "",
    s.withAudio
      ? `音声 ${sec(s.audioMs)}秒`
        + `\n  ${s.audioParallel ? "映像と並行" : "直列"}・待たされた${sec(s.audioWaitMs)}秒`
        + (s.audioOk ? "" : "\n  ※音声は入っていません")
      : "音声 なし",
    `色 ${s.filterId}${s.colorOn ? " + カメラ間の色合わせ" : ""}`,
    `保存先 ${s.route}`,
    s.skips ? `カメラの飛ばし読み ${s.skips}回 (${sec(s.reseekMs)}秒)` : null,
  ].filter(v => v !== null);
  const text = lines.join("\n");
  /* 中高生が読むのはこの1行だけでよい。畳んだ中身は開発者向け */
  const one = MC.ui.$("#eoOneLine");
  if (one) {
    /* 同じ1行で単位系を割らない。素材側を「8分30秒」と読ませておいて
       所要だけ「912.4秒」だと、それが15分だと分かる部員はいない(2026-07-26) */
    one.textContent = `${mmss(s.spanSec)}の動画を${mmss(s.totalMs / 1000)}で書き出しました（${s.w}×${s.h}）`;
    one.hidden = false;
  }
  host.hidden = false;
  host.open = false;                       // 既定は畳んでおく(見たい人だけ開く)
  MC.ui.$("#eoStatsText").textContent = text;
  const btn = MC.ui.$("#eoStatsCopy");
  if (btn) btn.onclick = async () => {
    const full = `MarchinZ Switcher ${document.documentElement.getAttribute("data-mz-version") || "(版不明)"}\n`
      + `${navigator.userAgent}\n\n${text}\n\n---- ログ ----\n${MC.debug.slice(-60).join("\n")}`;
    try { await navigator.clipboard.writeText(full); MC.ui.toast("記録をコピーしました"); }
    catch (e) {
      const r = document.createRange();
      r.selectNodeContents(MC.ui.$("#eoStatsText"));
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      MC.ui.toast("選択しました。長押しでコピーしてください");
    }
  };
};

/* 失敗の記録をひとまとめにしてコピーする(2026-08-01 優さん指示)。
   実機で踏んだものをそのまま送れるようにする ─ 画面の写真では文字が読めず、
   打ち直しでは肝心のログが落ちる */
/* 失敗の中身から、次に何をすればよいかを1つだけ出す。
   固定文だと「正解に近いが理由が違う」案内になり、次に活かせない */
MC.ui.failHint = m => {
  m = String(m || "");
  if (/読み込めませんでした|デコード/.test(m)) {
    return "カメラが3本あると、iPhoneでは重すぎて止まることがあります。1本減らすか、画質を軽いほうにしてお試しください。";
  }
  if (/演奏している場所/.test(m)) {
    return "拍手やアナウンスだけの場所だと、演奏の始まりを見つけられないことがあります。演奏が入っているところから取り込み直してください。";
  }
  if (/カメラの切り替え/.test(m)) {
    return "動画が1本だけだと、切り替える相手がいないので止まります。2本以上でお試しください。";
  }
  if (/書き出しを始められません/.test(m)) {
    return "書き出せる長さを超えているか、素材がまだ揃っていないことがあります。こだわりで長さを確かめてください。";
  }
  return "素材が短すぎたり、途中で画面が消えると、ここで止まることがあります。";
};

/* 記録を組み立てる。画面に出すものとコピーするものを同じ1本から作る ─
   別々に作ると、見えているものと送られるものが食い違う */
MC.ui.buildReport = () => {
  const de = document.documentElement;
  const ver = de.getAttribute("data-mz-app-v") || de.getAttribute("data-mz-version") || "(版不明)";
  const mats = MC.S.clips.filter(c => !c.isAudio).map(c => {
    const wh = (c.width && c.height) ? ` ${c.width}x${c.height}` : "";
    return `${c.name}${wh} ${(c.duration || 0).toFixed(1)}s`;
  }).join(" / ");
  const f = MC.ui.autoStage && MC.ui.autoStage._fail;
  /* 生の原因(ブラウザが返す英語)は画面には出さないが、記録には必ず残す */
  const raw = (f && f.raw) ? `\n原因(そのまま): ${f.raw}` : "";
  return `MarchinZ Switcher ${ver}\n${navigator.userAgent}\n`
    + `比率: ${MC.S.preset || "?"} / レイアウト: ${MC.S.layoutId || "?"}\n`
    + `素材: ${mats}\n`
    + `エラー: ${f ? (f.message || String(f)) : "(なし)"}${raw}\n`
    + `---- ログ ----\n${(MC.debug || []).slice(-60).join("\n")}`;
};

MC.ui.copyReport = async () => {
  const text = MC.ui.buildReport();
  const pre = MC.ui.$("#asFailLog");
  if (pre) pre.textContent = text;
  try {
    await navigator.clipboard.writeText(text);
    MC.ui.toast("記録をコピーしました。そのまま貼って送れます");
  } catch (e) {
    /* クリップボードを断られる端末がある。読める形で出して長押しに委ねる */
    const d = MC.ui.$("#asFailDetails"); if (d) d.open = true;
    if (pre) {
      const r = document.createRange(); r.selectNodeContents(pre);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    MC.ui.toast("選択しました。長押しでコピーしてください");
  }
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
    /* 起きた事実だけを言う(2026-08-01)。「前回の続きから始められます」は
       これから何ができるかの約束で、消した案内と同じ系統だった。
       ここは**もう起きたこと**を報告する場所なので、そう書く */
    + `${got.join("・")}を復元しました`;
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
       roleMax … 会員種別と端末の上限(2026-07-31: ゲスト1分未満 /
                 登録×スマホ3分 / 登録×パソコン10分 / 管理者は無制限) */
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
     ゲスト等で上限がさらに短ければそちらに従う。
     ※通常はここに来ない ─「長さと開始位置」で選べる長さは最初から上限内に
       丸めてある(highlight.presetSec)。手でIN/OUTを動かしたときの受け皿 */
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
    /* lengthDecided は落とさない。落とすと現在地が「長さと開始位置」へ戻り、
       書き出し画面の警告を押した人がいきなり2工程前へ飛ばされる。
       手で詰めた範囲はこのまま使い、あの画面を開き直したときだけ
       選択(exportPreset/startKey)から作り直される */
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
  /* ★ おまかせを選んでいるなら、ここから先は一度も止まらない(2026-08-01 優さん指示)。
     取り込みが終わった時点で自走を始める ─ これが「タップせずに最後まで」の入口。
     二重に走らないよう、実行中と書き出し済みは弾く */
  if (MC.ui._autoFlow && !MC.ui._busy && !(MC.exporter && MC.exporter.running)
      && !MC.S.easyDone) {
    setTimeout(() => MC.ui.runAuto(), 260);
    return;
  }
  /* こだわり: 傾きの確認は本人の目で1本ずつ(2026-07-28)。
     取り込んだ直後は自動でその画面へ運び、選ぶ→確認→同期 を途切れさせない */
  {
    const pending = MC.ui.tiltPending();
    if (pending) { setTimeout(() => MC.ui.openTilt(), 260); return; }
  }
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
/* 素材が変わったので確認をやり直す。
   ★ restored=true（前回と同じ動画が戻ってきた）のときは、演奏の範囲まで
     捨ててはいけない。ここを無条件に null にしていたため、
     media.js の `restoreTrim() → saveState() → resetEasyDone()` の並びで
     **復元した showIn/showOut を3行あとに自分で消し、次の保存で
     localStorage ごと壊していた**（2026-07-31 シニアエンジニアのレビューで
     実測発覚。復元バナーは「範囲も復元しました」と言いながら中身は空だった）。
   長さの確認(lengthDecided)は復元でも落とす ─ clip.visual は保存されないので、
   どのみち映像解析はやり直しになる。範囲だけ引き継いで選び直してもらう */
MC.ui.resetEasyDone = (restored = false) => {
  MC.S.audioDecided = false;   // 素材が変われば音声も選び直し(2026-07-24)
  MC.S.lengthDecided = false;
  MC.ui._tabsForced = false;   // 同期失敗の前倒し開放は素材が変われば解除(2026-07-31)
  if (!restored) {
    MC.S.showIn = null;
    MC.S.showOut = null;
    MC.S.startAt = null;   // 前の素材の絶対秒が「自分で選ぶ」に残らないように
    /* 演奏開始(サリュート)の検出結果も捨てる。director.js:47 は
       「まだ無ければ検出する」なので、捨てないと前の素材の値が残る。
       おまかせは runEasyScan が毎回上書きするが、#autocutBtn を直接押す
       経路はここを通らない(引き継ぎ書③の最後の1件) */
    if (MC.director) MC.director._salute = null;
    /* 検出そのもののキャッシュも捨てる(2026-07-31)。鍵は音声クリップの
       id/名前/大きさ/ズレなので、別素材なら自然に外れるが、
       「同じ動画を選び直した」ときは鍵まで一致してしまう ─
       素材をやり直したなら計算もやり直す */
    if (MC.salute && MC.salute.clearCache) MC.salute.clearCache();
    MC.S.tiltSkipped = false;   // 素材が変われば傾きの確認もやり直し
  }
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
  /* ★ この文はいちばん最初の「動画を選ぶ」画面に出る(index.html:101)。
     だから言うべきは**取り込める長さ**であって、書き出しの上限ではない。
     ここを maxExportSec で書いていたため、ゲストのスマホでは
     読み込み画面に「3本まで・59秒まで」と出ていた ─ 取り込みは5分なのに。
     地区大会レベルの顧問レビューで「意味が通らない」と指摘された(2026-07-31) */
  const srcMax = (window.MZ_LIMITS && MZ_LIMITS.maxSourceSec) || Infinity;
  if (isFinite(srcMax)) {
    /* 数字は limits.js の正式なラベルを使う(maxSourceSec は 1200.5 のように
       許容誤差ぶんの端数を持ち、そのまま出すと「20分01秒」になる)。
       ★ 言うのは「長くても入る」こと。使う範囲はあとで選べるので、
         ここで身構えさせない(2026-07-31 4団体レビュー) */
    const L2 = window.MZ_LIMITS;
    el.innerHTML = icon
      + `<b>3本まで・1本${MC.ui.esc(L2.sourceLimitLabel)}まで</b>取り込めます。`
      + "長い録画でも構いません。<b>どこを何分使うか</b>は、この後で選びます。"
      /* 端末のメモリで書き出しが頭打ちになる環境だけ、その理由も添える */
      + (isFinite(hardMax) && hardMax <= roleMax
          ? `（この端末で書き出せるのは${mmss(hardMax)}までです）`
          : isFinite(roleMax) ? `（書き出せるのは${MC.ui.esc(L2.exportLimitLabel)}までです）` : "");
    return;
  }
  /* 上限が外れている端末(手元の環境・管理者)。ここで「3本まで」と言うと、
     limits.js が出す #adminLimitBadge の「上限なし」と真正面から矛盾する。
     上限の話はこの1文に集約し、バッジの方を畳む(2026-07-28) */
  el.innerHTML = icon + "<b>本数・長さの上限なし</b>で取り込めます。";
  const badge = document.getElementById("adminLimitBadge");
  if (badge) badge.hidden = true;
};

/* 書き出し完了画面の顔の注意。**Privacy でいま本当にできること**から組み立てる。
   以前は「顔モザイク(Privacy)で隠せます」と固定文で書いていたが、
   Privacy の動画モザイクは管理者限定(privacy/js/ui.js:438 videoAllowed)で、
   一般の人がリンクを踏むと「いまは写真のみ対応しています」と断られていた。
   学校へ持ち込む顧問がこれを職員に説明できない ─ 案内した先に機能が無いのは、
   機能が無いことより悪い(2026-07-31 全国常連校の顧問レビュー P0)。
   Privacy 側が動画に対応したら、ここは自動で本来の案内に戻る */
MC.ui.renderFaceNote = () => {
  const el = document.getElementById("eoFaces");
  if (!el) return;
  const L = window.MZ_LIMITS || {};
  const videoOK = !!L.privacyVideoAllowed;   // 正本はlimits.js(条件のコピーをやめた 2026-07-31)
  el.innerHTML = '<i class="fa-solid fa-user-shield" aria-hidden="true"></i> '
    + "多くの人の顔が写っています。SNSや外部へ公開するときは、"
    + "写っている人（未成年なら保護者）の同意をご確認ください。"
    + (videoOK
        ? '<br><a href="/tools/privacy/">顔モザイク（Privacy）</a>で隠せます。'
        : '<br><span class="hint">動画の顔モザイクは準備中です。'
          + '写真なら <a href="/tools/privacy/">Privacy</a> で隠せます。</span>');
};

/* ============ 長さと開始位置を決める(2026-07-31 優さん指示) ============
   8分のショウから1分だけ切り出すなら「どこの1分か」を決めないといけない。
   問いを2つ(何分にするか / どこから始めるか)だけに絞り、選んだ瞬間に
   書き出し範囲へ反映してプレビューで確かめられるようにする。 */

/* 「分」「分秒」の読みやすい表記。fmtTime(0:59.0)は時計の表記で、
   長さの表記としては読みにくい */
MC.ui.fmtLen = sec => {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60), r = s % 60;
  if (!m) return `${r}秒`;
  return r ? `${m}分${String(r).padStart(2, "0")}秒` : `${m}分`;
};

/* 演奏そのものの範囲(グローバル秒)。見つかっていなければ素材全体 */
MC.ui.showRange = () => {
  const dur = MC.timelineDuration();
  const a = MC.S.showIn == null ? 0 : Math.max(0, Math.min(MC.S.showIn, dur));
  const b = MC.S.showOut == null ? dur : Math.max(0, Math.min(MC.S.showOut, dur));
  return [a, Math.max(a + 1, b)];
};

/* いま選ばれているプリセット(使えないものを選んでいたら、使える中で一番長いもの)。
   既定を「使える中で一番長い」にしているのは、これまでの動き(演奏まるごと)に
   一番近いのが「まるごと」だから ─ 上限が足りる人には今までどおりに見える */
/* いまの演奏で意味のある選択肢だけを返す。
   ★ 演奏より長いプリセットは出さない。presetSec は演奏尺で頭打ちするので、
     50秒の演奏では「ショート50秒 / ミドル50秒 / まるごと50秒」と
     同じ数字のカードが3枚並ぶ(2026-07-31 レビューで実測)。
   ★ 鍵の判定も**実尺**でやり直す。limits.js は代表値(まるごと=510秒)で
     比べるので、45秒の演奏でもゲストには「まるごと」が鍵つきに見えていた ─
     45秒なら上限(59秒)に収まるので、本当は使える。 */
MC.ui.usablePresets = showLen => {
  const all = (window.MZ_LIMITS && MZ_LIMITS.exportPresets) ? MZ_LIMITS.exportPresets() : [];
  if (!all.length) return [];
  const hard = (MC.exporter && MC.exporter.maxExportableSec)
    ? MC.exporter.maxExportableSec() : Infinity;
  const cap = Math.min(MZ_LIMITS.maxExportSec == null ? Infinity : MZ_LIMITS.maxExportSec, hard);
  const rated = all.map(p => {
    const want = p.whole ? (showLen || p.sec) : p.sec;
    const locked = want > cap + 0.01;
    return { ...p, locked, unlock: locked ? p.unlock : "" };
  });
  if (!(showLen > 0)) return rated;
  const fit = rated.filter(p => p.whole || p.sec < showLen - 1);
  return fit.length ? fit : rated.filter(p => p.whole);
};

MC.ui.currentPreset = showLen => {
  const list = MC.ui.usablePresets(showLen);
  if (!list.length) return null;
  const open = list.filter(p => !p.locked);
  const pick = list.find(p => p.id === MC.S.exportPreset && !p.locked);
  return pick || open[open.length - 1] || list[0];
};

/* 選択を書き出し範囲(trimIn/trimOut)へ落とす。
   ★ showIn/showOut は動かさない。ここを潰すと、長さを選び直すたびに
     元の演奏範囲が短くなっていって選び直せなくなる */
MC.ui.applyLengthChoice = () => {
  const [s0, s1] = MC.ui.showRange();
  const preset = MC.ui.currentPreset(s1 - s0);
  if (!preset) return null;
  const lenSec = MC.highlight.presetSec(preset, s1 - s0);
  const audioClip = MC.getClip(MC.S.audioClipId);
  const cands = MC.highlight.candidates(audioClip, lenSec, s0, s1);
  /* 選ぶ余地があるか。候補の数ではなく**実際の自由度**で見る ─
     候補が1つしか作れない曲でも、余地があるなら自分で決められるべき */
  const room = (s1 - s0) - lenSec;
  const canChoose = room > 1;
  let cand;
  if (MC.S.startKey === "manual" && canChoose) {
    const base = MC.S.startAt == null ? cands[0].t : MC.S.startAt;
    const t = MC.highlight.snapToBeat(base, audioClip, s0, s1 - lenSec);
    MC.S.startAt = t;
    cand = { ...MC.highlight.MANUAL, t, dur: lenSec, z: 0 };
  } else {
    cand = cands.find(c => c.key === MC.S.startKey) || cands[0];
  }
  MC.S.exportPreset = preset.id;
  MC.S.startKey = cand.key;
  MC.S.trimIn = cand.t;
  MC.S.trimOut = Math.min(s1, cand.t + lenSec);
  MC.saveState();
  return { preset, lenSec, cands, cand, canChoose, room, audioClip };
};

/* 選び直したら、カット割は作り直さないと合わない。
   カットリストは**前に選んだ範囲**に対して作られているので、範囲を変えたまま
   書き出しへ行くと、MC.cutAt が先頭のカットで頭打ちして
   「新しい区間ぜんぶが1カメラ」になる(黒コマにはならないので気づけない)。
   lengthDecided を落とすと、ジャーニーがこの工程に留めてくれるので、
   「この長さで進める」を押さないと先へ進めなくなる */
MC.ui.invalidateCuts = () => {
  if (!MC.S.lengthDecided) return;
  MC.S.lengthDecided = false;
  /* 色統計も捨てる。clip.visual は l0|l1 をキーに持つ(visual.js:451)ので
     範囲を変えれば解析し直されるが、colorStats は「一度積んだら二度と
     捨てない」実装(visual.js:489 / colormatch.js:75)だった。
     バラード(暗い)で決めてから大盛り上がり(明るい)へ選び直すと、
     明るい区間に暗所基準の補正が当たる ─ エラーは出ない(2026-07-31) */
  MC.S.clips.forEach(c => { c.colorStats = null; c.colorT = null; });
  MC.saveState();
  MC.ui.refreshJourney();
};

/* 鍵つきの長さを押したときの案内。**この画面に登録リンクを置くのはここだけ**。
   「無料登録で使えます」と書いておきながら、押しても無反応で登録への道が
   画面のどこにも無い、という行き止まりを作らないため */
MC.ui.showUnlockHelp = p => {
  const host = document.getElementById("lenPresets");
  if (!host) return;
  let el = document.getElementById("lenUnlockNote");
  if (!el) {
    el = document.createElement("div");
    el.id = "lenUnlockNote";
    el.className = "len-unlock-note";
    el.setAttribute("role", "status");
    host.insertAdjacentElement("afterend", el);
  }
  const L = window.MZ_LIMITS || {};
  const needsPc = /パソコン/.test(p.unlock || "");
  el.innerHTML =
    `<p class="lun-title"><i class="fa-solid fa-lock" aria-hidden="true"></i> `
    + `「${MC.ui.esc(p.label)}」は、いまはまだ使えません</p>`
    + `<p class="lun-body">${MC.ui.esc(p.unlock)}。`
    /* メモリの説明は OPFS の無い端末だけ(2026-07-31 5巡目P1)。
       採用基準の iOS16+ はOPFS対応=ストリーム書き出しでメモリ上限は外れており、
       登録×スマホが3分止まりの本当の理由はプランの壁。嘘をつかない */
    + (needsPc && !(MC.exporter && MC.exporter.opfsSupported && MC.exporter.opfsSupported())
        ? "この端末は動画を丸ごとメモリに載せるため、長い書き出しが途中で止まってしまいます。" : "")
    + `いまは<b>${MC.ui.esc(L.exportLimitLabel || "")}</b>まで作れます。</p>`
    + (L.member ? "" : '<a class="lun-btn" href="/#signup">無料登録する</a>');
};

MC.ui.renderLengthSec = () => {
  const host = document.getElementById("lengthSec");
  if (!host || host.classList.contains("step-off")) return;
  const presetHost = document.getElementById("lenPresets");
  const startBox = document.getElementById("lenStartBox");
  const startHost = document.getElementById("lenStarts");
  const summary = document.getElementById("lenSummary");
  if (!presetHost || !startHost) return;

  const applied = MC.ui.applyLengthChoice();
  if (!applied) return;
  const { preset, lenSec, cands, cand, canChoose, audioClip } = applied;
  const [s0, s1] = MC.ui.showRange();
  const list = MC.ui.usablePresets(s1 - s0);

  /* --- 長さのカード --- */
  presetHost.innerHTML = "";
  for (const p of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "len-card" + (p.locked ? " locked" : "")
      + (!p.locked && p.id === preset.id ? " on" : "");
    /* role="radio" は使わない。矢印キー移動と roving tabindex を実装していない
       ラジオグループは ARIA に沿わず、読み上げの案内(「1/3」等)も嘘になる。
       排他の押しボタン(aria-pressed)として正しく名乗る */
    b.setAttribute("aria-pressed", String(!p.locked && p.id === preset.id));
    /* 表示する尺は、使えるか使えないかで意味が変わる。
       ・使える  … **実際に書き出される尺**(presetSec。上限で丸めた後)。
                  ここを Math.min(p.sec, 演奏尺) にしていたときは、10分のショウを
                  登録×パソコン(上限10分)で開くとカードに「8分30秒」と出るのに
                  実際は10分書き出され、同じ画面のまとめ文と数字が食い違った
       ・使えない … **解除したら得られる尺**。presetSec は今の上限で丸めるので、
                  ゲスト(59秒)では鍵つきの3枚が全部「59秒」になり、
                  何が違うのか分からないカードが並んだ(2026-07-31 スクショで発覚) */
    const shown = p.locked
      /* 解除したら得られる尺。whole の上限は登録×PCの600秒(limits.js)。
         代表値510で見せると、20分のショウでは解除後(10分)より短く出て嘘になる */
      ? (p.whole ? Math.min(s1 - s0, 600) : p.sec)
      : MC.highlight.presetSec(p, s1 - s0);
    b.innerHTML =
      `<span class="len-name">${MC.ui.esc(p.label)}</span>`
      + `<span class="len-dur">${MC.ui.esc(MC.ui.fmtLen(shown))}</span>`
      + `<span class="len-why">${MC.ui.esc(p.hint)}</span>`
      + (p.locked
          ? `<span class="len-unlock"><i class="fa-solid fa-lock" aria-hidden="true"></i>${MC.ui.esc(p.unlock)}</span>`
          : "");
    if (p.locked) {
      /* 鍵つきカードは押しても無反応、という行き止まりにしない。
         この画面には登録リンクが1つも無い(#dropSec の data-mz-plan は
         2026-07-28 に撤去され、limits.js の renderSignupPerks は
         置き場所が無くて何も出していない)ので、ここが唯一の導線になる */
      b.setAttribute("aria-disabled", "true");
      b.onclick = () => MC.ui.showUnlockHelp(p);
    } else {
      b.onclick = () => {
        if (p.id === MC.S.exportPreset) return;
        MC.S.exportPreset = p.id;
        MC.ui.invalidateCuts();     // 範囲が変わる=前のカット割は合わない
        /* 長さが変われば見どころの窓も変わる。始まりは選び直させず、
           同じ性格(startKey)の新しい最適位置へ自動で追従させる */
        MC.ui.renderLengthSec();
        MC.ui.renderSectionBand();   // 帯の印も選択に追従させる
        MC.ui.updateTransport();
        MC.preview.seek(MC.S.trimIn);
      };
    }
    presetHost.appendChild(b);
  }

  /* --- 始まりのカード --- */
  startBox.hidden = !canChoose;
  startHost.innerHTML = "";
  if (canChoose) {
    /* おすすめの5つ + 「自分で選ぶ」。おすすめで足りない人を行き止まりにしない */
    for (const c of [...cands, { ...MC.highlight.MANUAL, t: MC.S.startAt == null ? s0 : MC.S.startAt }]) {
      /* ★ ボタンの中にボタンを入れない。カード自体を <button> にして
         「ここを聴く」を appendChild していたのは HTML として不正で、
         読み上げでも入れ子の対話要素は正しく扱われない。
         枠は <div>、選ぶ本体と聴くボタンは**兄弟**にする */
      const row = document.createElement("div");
      row.className = "len-start" + (c.key === cand.key ? " on" : "");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "len-pick";
      b.setAttribute("aria-pressed", String(c.key === cand.key));
      b.innerHTML =
        `<span class="len-ico"><i class="fa-solid ${MC.ui.esc(c.icon)}" aria-hidden="true"></i></span>`
        + `<span class="len-body"><span class="len-label">${MC.ui.esc(c.label)}</span>`
        + `<span class="len-reason">${MC.ui.esc(c.why)}</span></span>`
        + `<span class="len-at">${MC.ui.esc(MC.ui.fmtClock(c.t - s0))}</span>`;
      b.onclick = () => {
        if (c.key === MC.S.startKey) return;
        MC.S.startKey = c.key;
        MC.ui.invalidateCuts();     // 始まりが変わる=前のカット割は合わない
        MC.ui.renderLengthSec();
        MC.ui.renderSectionBand();   // 帯の印も選択に追従させる
        MC.ui.updateTransport();
        MC.preview.seek(MC.S.trimIn);
      };
      const listen = document.createElement("button");
      listen.type = "button";
      /* 再生中はこのボタンが停止ボタンになる。押しっぱなしで止め方が
         画面から消えるのを防ぐ(以前は .playing のCSSだけあって未実装だった) */
      const playing = MC.S.playing && c.key === cand.key;
      listen.className = "len-listen" + (playing ? " playing" : "");
      listen.title = playing ? "止める" : "ここから試聴";
      listen.setAttribute("aria-label", playing ? "止める" : `${c.label}から試聴`);
      listen.innerHTML = `<i class="fa-solid ${playing ? "fa-pause" : "fa-play"}" aria-hidden="true"></i>`;
      listen.onclick = () => {
        if (playing) { MC.preview.pause(); MC.ui.renderLengthSec(); return; }
        if (c.key !== MC.S.startKey) { MC.S.startKey = c.key; MC.ui.invalidateCuts(); }
        MC.ui.renderLengthSec();
        MC.ui.renderSectionBand();   // 帯の印も選択に追従させる
        MC.ui.updateTransport();
        MC.preview.seek(MC.S.trimIn);
        MC.preview.play().then(() => MC.ui.renderLengthSec());
      };
      row.appendChild(b);
      row.appendChild(listen);
      startHost.appendChild(row);
    }
  }

  /* --- 「自分で選ぶ」のスライダー --- */
  const man = document.getElementById("lenManual");
  const rng = document.getElementById("lenManualRange");
  const atEl = document.getElementById("lenManualAt");
  const hereBtn = document.getElementById("lenManualHere");
  const hi = Math.max(s0, s1 - lenSec);
  if (man) {
    man.hidden = !(canChoose && cand.key === "manual");
    if (!man.hidden) {
      rng.min = String(s0);
      rng.max = String(Math.max(s0 + 0.1, hi));
      rng.value = String(cand.t);
      atEl.textContent = MC.ui.fmtClock(cand.t - s0);
      /* min/max/value は素材の頭からの絶対秒だが、画面に出るのは演奏の頭からの
         位置。valuetext を付けないと、読み上げには画面と違う数字が届く */
      rng.setAttribute("aria-valuetext", MC.ui.fmtClock(cand.t - s0) + " から");
      /* ドラッグ中は**作り直さない**。ここで renderLengthSec を呼ぶと
         スライダー自身が作り直されて指が離れてしまう。
         画面の数字と範囲だけ動かし、確定(change)でまとめて反映する */
      const live = t => {
        MC.S.startAt = t;
        MC.S.trimIn = t;
        MC.S.trimOut = Math.min(s1, t + lenSec);
        atEl.textContent = MC.ui.fmtClock(t - s0);
        rng.setAttribute("aria-valuetext", MC.ui.fmtClock(t - s0) + " から");
        const chip = startHost.querySelector(".len-start.on .len-at");
        if (chip) chip.textContent = MC.ui.fmtClock(t - s0);
        summary.textContent =
          `${MC.ui.fmtLen(MC.S.trimOut - MC.S.trimIn)}の動画を、`
          + `演奏の開始から ${MC.ui.fmtClock(t - s0)} の位置で作ります`
          + MC.ui.lengthEta(MC.S.trimOut - MC.S.trimIn);
        MC.ui.updateTransport();
        MC.preview.seek(t);
      };
      rng.oninput = () => live(MC.highlight.snapToBeat(
        parseFloat(rng.value), audioClip, s0, hi));
      rng.onchange = () => { MC.ui.invalidateCuts(); MC.saveState(); };
      /* プレビューで気になる場面を見つけた人の近道。
         スライダーで8分の中の1点を指で当てるのは、375pxではまず無理 */
      hereBtn.onclick = () => {
        const t = MC.highlight.snapToBeat(MC.S.t, audioClip, s0, hi);
        rng.value = String(t);
        live(t);
        MC.ui.invalidateCuts();
        MC.saveState();
      };
    }
  }

  /* --- まとめ --- */
  const [tIn, tOut] = MC.trimRange();
  summary.textContent = (!canChoose
    ? `演奏全体（${MC.ui.fmtLen(tOut - tIn)}）を1本にします`
    : cand.key === "manual"
      ? `${MC.ui.fmtLen(tOut - tIn)}の動画を、演奏の開始から ${MC.ui.fmtClock(tIn - s0)} の位置で作ります`
      : `${MC.ui.fmtLen(tOut - tIn)}の動画を、「${cand.label}」から作ります`)
    + MC.ui.lengthEta(tOut - tIn);
};

/* この長さを選んだら、あとどれくらい待つのか(2026-07-31 UI/UXレビュー P1)。
   「この長さで進める」はいちばん重い映像解析の引き金なので、
   長さを選ぶ画面にこそ待ち時間が要る ─ 短いほうを選ぶ理由にもなる。
   式は #totalEtaHint と同じ(2箇所で違う数字を出さない) */
MC.ui.lengthEta = showSec => {
  const clips = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  if (!clips.length || !(showSec > 1)) return "";
  const anaSec = clips.length * showSec * MC.ui.analysisRate();
  let expFactor = MC.ui.exportMode() === "realtime" ? 1.15 : (MC.isIOS ? 1.8 : 0.9);
  if (MC.exporter.quality() === "light") expFactor *= 0.8;
  // 1分未満は「1分ほど」に丸める。秒まで出すと正確に見えすぎる
  const mins = s => Math.max(1, Math.round(s / 60));
  /* 「できるまで、あわせておよそ◯分」→「完成までおよそ◯分」(2026-08-01)。
     「あわせて」は分析と書き出しの内訳を指していたが、待つ側に内訳は要らない。
     知りたいのは合計で、それはこの数字そのもの */
  return `。完成までおよそ${mins(anaSec + showSec * expFactor)}分`;
};

/* 演奏のはじまりを0とした位置の表記(0:00形式)。
   fmtTime は小数第1位まで出すので、場所を指すには細かすぎる */
MC.ui.fmtClock = sec => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

MC.ui.renderAll = () => {
  MC.ui.applyGuestLocks();
  /* 区間の色帯。音の解析が済んだ素材なら描く(2026-08-01)。
     renderAll は素材・音声・解析のどれが変わっても通るので、ここに置けば
     「音声を選び直したら帯が前の素材のまま」を避けられる */
  if (MC.ui.renderSectionBand) MC.ui.renderSectionBand();
  MC.ui.renderQualityPicker();
  MC.ui.renderPlacement();
  if (MC.ui._syncFloatPos) MC.ui._syncFloatPos();   // 素材の増減で位置が変わる
  {
    const prb = MC.ui.$("#projectResetBtn");
    if (prb) prb.hidden = !MC.S.clips.length;
  }
  /* スマホのフロートプレビューは素材があるときだけ(空の黒枠を浮かせない) */
  document.body.classList.toggle("mz-has-clips", MC.S.clips.length > 0);
  /* ロゴの説明は、ロゴが実際に見えているときだけ出す(2026-08-01)。
     素材が無い=プレビューが黒いだけの画面で先に断りを入れても意味が無い */
  {
    const wm = MC.ui.$("#wmNote");
    if (wm) wm.hidden = !MC.S.clips.length;
  }
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
MC.ui.JOURNEY_SECTIONS = { mat: "#dropSec", tilt: "#tiltSec", sync: "#syncSec", length: "#lengthSec", export: "#exportSec" };

MC.ui.initJourney = () => {
  MZJourney.init({
    container: MC.ui.$("#workspace"),
    phases: [
      /* shortLabel は狭い画面(iPhone)で現在地以外に出す短縮名。
         先の工程のパネルを画面から消した以上、ここが「何が残っているか」を
         知る唯一の場所になったので、名前を消してはいけない(2026-07-26) */
      /* 傾きは単独の工程(2026-07-31 優さん指示)。1画面に1本ぶんだけ出す */
      { id: "mat",    label: "動画を選ぶ", shortLabel: "動画", hint: "使う動画を選びます" },
      { id: "tilt",   label: "傾きを直す", shortLabel: "傾き", hint: "1本ずつ傾きを直します" },
      { id: "sync",   label: "同期と分析",   shortLabel: "同期", hint: "音のズレを合わせ、素材を分析します" },
      { id: "length", label: "長さと開始位置", shortLabel: "長さ", hint: "長さと開始位置を選びます" },
      { id: "export", label: "書き出し",     shortLabel: "書出", hint: "画質を選んで書き出します。色は気になるときだけ" },
    ],
    doneHint: "書き出し完了。調整して書き出し直すこともできます",
    /* 1画面1操作(デッキ式)になってから、画面に出ているパネルは常に1枚だけ。
       「見えているか」で判定すると現在地しか押せず、**戻る導線が全滅**する
       (2026-07-28 実測: 6枠中5枠が disabled)。到達済みかどうかで判定し、
       タップしたらその工程の画面へ切り替える(scrollIntoView は効かない) */
    canSelect: id => {
      const R = MC.ui.STEP_RANK;
      const reached = MC.ui._derivedPhase || "mat";
      return !!document.querySelector(MC.ui.JOURNEY_SECTIONS[id]) && R[id] <= R[reached];
    },
    onSelect: id => {
      const R = MC.ui.STEP_RANK;
      if (R[id] > R[MC.ui._derivedPhase || "mat"]) return;   // まだ来ていない工程へは飛ばない
      MC.ui._viewPhase = id;      // 進行が先に進むまで、この工程を見せ続ける
      MC.ui.refreshJourney();     // showPhase だけだとジャーニーと行動バーが前の工程のまま
      window.scrollTo({ top: 0, behavior: "smooth" });
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
    if (cur === "tilt") {
      /* 傾きの画面(2026-07-31 単独工程)。本体の OK ボタンが見えているなら重ねない */
      const okBtn = MC.ui.$("#tiltOkBtn");
      const r = okBtn ? okBtn.getBoundingClientRect() : null;
      if (r && r.height > 0 && r.top < window.innerHeight - 70 && r.bottom > 0) {
        bar.classList.remove("on");
        document.body.classList.remove("mz-actionbar-on");
        return;
      }
      if (okBtn) conf = { label: okBtn.textContent.trim() || "この動画はOK",
        icon: "fa-check", act: () => okBtn.click() };
    } else if (cur === "mat") {
      /* 素材を見に戻っているだけ(_viewPhase)なら、進む道を主ボタンにする。
         ここが無いと「動画を選ぶ」画面から先へ戻れない(2026-07-28) */
      const R = MC.ui.STEP_RANK;
      const reached = MC.ui._derivedPhase || "mat";
      if (MC.ui._viewPhase === "mat" && R[reached] > R.mat) {
        conf = { label: "これでOK、続ける", icon: "fa-arrow-right",
          act: () => { MC.ui._viewPhase = null; MC.ui.refreshJourney(); } };
      } else {
        conf = { label: MC.S.mode === "vertical" ? "動画・写真を選ぶ" : "動画を選ぶ",
          icon: "fa-folder-open",
          act: () => MC.ui.$(MC.S.mode === "vertical" ? "#fileInputV" : "#fileInput").click() };
      }
    } else if (cur === "length") {
      /* 長さと開始位置(2026-07-31 UI/UXレビュー P0)。
         375pxではカードが最大9枚並び、決定ボタンは折り返しのはるか下にある。
         他の工程は全部この親指バーで受けているのに、ここだけ抜けていた。
         流儀は音声と同じ ─ 本体のボタンが見えているときは重ねない */
      const lb = MC.ui.$("#lenDecideBtn");
      if (!lb) {
        bar.classList.remove("on");
        document.body.classList.remove("mz-actionbar-on");
        return;
      }
      const r = lb.getBoundingClientRect();
      if (r.height > 0 && r.top < window.innerHeight - 70 && r.bottom > 0) {
        bar.classList.remove("on");
        document.body.classList.remove("mz-actionbar-on");
        return;
      }
      conf = { label: "この長さで進める", icon: "fa-check",
        disabled: lb.disabled, act: () => lb.click() };
    } else if (cur === "sync") {
      /* 同期の工程は2段になった(2026-08-01 工程統合)。
         ①まだ分析していない → 分析を開始
         ②分析は済んだが音声が未決 → この音で進める
         音声を選ぶ工程を畳んだので、その一手をここで受ける */
      const db = MC.ui.$("#audioDecideBtn");
      const audioTurn = db && !db.disabled && !MC.S.audioDecided;
      const near = el => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.top < window.innerHeight - 70 && r.bottom > 0;
      };
      if (audioTurn) {
        /* 本体の決定ボタンが見えているなら重ねない(書き出しと同じ流儀) */
        if (near(db)) { bar.classList.remove("on"); document.body.classList.remove("mz-actionbar-on"); return; }
        conf = { label: "この音で進める", icon: "fa-check", act: () => db.click() };
      } else if (MC.ui._setupTab !== "pro" && !MC.S.easyDone) {
        /* おまかせタブでは同期ボタンは隠れている。次の一手は「おまかせで開始」 */
        const eb = MC.ui.$("#easyStartBtn");
        if (near(eb)) { bar.classList.remove("on"); document.body.classList.remove("mz-actionbar-on"); return; }
        conf = { label: "分析を開始", icon: "fa-wand-magic-sparkles",
          disabled: eb.disabled, act: () => eb.click() };
      } else {
        conf = { label: "波形で同期する", icon: "fa-wave-square",
          disabled: MC.ui.$("#syncBtn").disabled, act: () => MC.ui.$("#syncBtn").click() };
      }
    } else if (cur === "export" && !MC.exporter.lastResult) {
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
/* 「同期が済んでいるか」の唯一の判定。ジャーニーの現在地と、
   「この音で進める」を押させてよいかの両方がこれを見る。
   ※ clip.stats で代用してはいけない。stats は File 由来で再読込後に復元されず、
     「再読込→同じ動画を入れ直す」で永久に false になる(2026-07-26 レビュー指摘)。
     syncMethod は localStorage から復元される(state.js の restoreClipState) */
MC.ui.isSynced = () => {
  const vids = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  if (vids.length >= 2) return vids.every(c => (c.syncMethod || "未同期") !== "未同期");
  return MC.media.slotClips().length > 0;   // 素材1つ(写真のみ含む)なら同期は不要=済み扱い
};

MC.ui.refreshJourney = () => {
  if (!document.querySelector(".mzj")) return;   // 未初期化なら何もしない
  const slot = MC.media.slotClips();
  const vids = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  const synced = MC.ui.isSynced();
  const exported = !!MC.exporter.lastResult;
  /* 音声を選ぶフェーズ(2026-07-24): 音のある動画が2本以上のときだけ通る。
     1本なら選ぶ余地がないのでスキップ(優さん確定) */
  const audioNeeded = vids.length >= 2;
  const audioDone = MC.S.audioDecided || !audioNeeded;
  /* 傾きの確認(2026-07-28 優さん指示): 自動検出は全廃。動画1本ずつ
     本人がOKするまで先へ進まない。easyDone 済みの旧セッションは
     引き戻さない(過去の自動値は本人が polish で見られる) */
  /* tiltOk を持たない保存データ(この機能より前のセッション)は「未確認」ではなく
     「対象外」として扱う。こだわりで使っていた人は easyDone が立たないため、
     同期もレイアウトも済んでいるのに毎回傾きへ引き戻されていた
     (2026-07-28 レビュー指摘) */
  const legacy = synced && vids.some(c => c.tiltOk === undefined);
  /* 「全部確認した」= 工程の完了印 */
  const tiltConfirmed = !vids.length || legacy || vids.every(c => c.tiltOk);
  /* 「先へ進めてよい」= 確認したか、本人が「このまま進む」を選んだか。
     ★ ゲートと完了印を分ける(2026-08-01)。まっすぐ撮れているのが最頻ケースで、
       そこに毎回N回のタップを強いるのは順序が逆だった。
       ただし飛ばした回を「確認ずみ」とは記録しない ─ 工程表の丸は
       未確認のまま残り、いつでも戻って直せる。嘘の✓を付けない */
  const tiltDone = tiltConfirmed || !!MC.S.tiltSkipped;
  /* 音楽の解析まで済んだか(2026-07-31)。ここまで来ると「長さと開始位置」の
     候補を作れる。showIn は演奏そのものの範囲なので、書き出し範囲(trimIn)を
     いくら動かしても消えない ─ 何度でも選び直せる */
  const scanned = MC.S.showIn != null && MC.S.showOut != null;
  const lengthDone = !!MC.S.lengthDecided;
  const done = [];
  /* 傾きが単独工程に戻ったので(2026-07-31)、素材の完了は「入っている」だけ。
     かたむきの確認ずみは tilt 工程の完了として別に立てる */
  if (slot.length) done.push("mat");
  if (slot.length && tiltConfirmed) done.push("tilt");   // 飛ばした回は✓にしない
  /* 同期の完了に「音声を決めた」を含める(2026-08-01 工程統合)。
     音声の決定は同期と分析の中の一手になった */
  if (slot.length && synced && audioDone) done.push("sync");
  if (slot.length && synced && audioDone && lengthDone) done.push("length");
  if (exported) done.push("export");
  let current = !slot.length ? "mat"
    : (!tiltDone && !MC.S.easyDone) ? "tilt"
    /* 同期と音声の決定は同じ工程(2026-08-01)。どちらか未了なら sync に留まる */
    : ((vids.length >= 2 && !synced) || !audioDone) ? "sync"
    /* 音楽の解析が済んで、まだ長さを決めていないならここで止める。
       重い映像解析はこの選択のあとで、選ばれた範囲だけを見る */
    : (scanned && !lengthDone) ? "length"
    /* 仕上げ設定は工程ではなくなり、書き出しの画面へ入った(2026-08-01)。
       以前ここを polish にしていたため、初回は #exportSec が step-off のままで
       **書き出しボタンがどこにも出ない**デッドロックだった */
    : "export";
  /* 分析の実行中は「同期と分析」を見せる。進捗(#easyStatus)は #easyPane の中にあり、
     これは sync 工程のパネルなので、他の工程を見せると進捗と中止ボタンが
     画面から消える。書き出し中は専用の全画面があるので対象外 */
  if (MC.ui._busy && !(MC.exporter && MC.exporter.running)) current = "sync";
  /* 到達点(current)と、いま見せている工程(shown)を分ける。
     ジャーニーから済んだ工程へ戻れるようにするため(2026-07-28) */
  const advanced = MC.ui._derivedPhase !== current;
  MC.ui._derivedPhase = current;
  if (advanced) MC.ui._viewPhase = null;   // 工程が進んだら寄り道を解除して追従する
  const R2 = MC.ui.STEP_RANK;
  const shown = (MC.ui._viewPhase && R2[MC.ui._viewPhase] <= R2[current])
    ? MC.ui._viewPhase : current;
  MZJourney.set(shown, done);
  MC.ui.showPhase(shown);
  MC.ui.updateActionBar();
};

/* ============ ステップ表示: 1画面1操作(2026-07-28 優さん指示) ============
   ジャーニーの現在フェーズの工程だけを画面に出す。済んだ工程も、まだの工程も出さない。

   2026-07-23〜27 は「いま=展開 / すみ=1行に畳む / まだ=畳んでロック」の
   折衷案だった。これを捨てた理由は思想ではなく実測:
     ・設定の画面に押せるものが29個・ページが2039px(画面の2.9倍)あった
     ・「動画を書き出す」が同じ画面に2つ出ていた
     ・そして #syncSec と #layoutSec は #proPane(hidden)の中にあったため、
       既定のおまかせでは工程②と④の画面が1枚も表示されなかった ─
       ジャーニーが現在地だと言っている工程の中身が画面に無い状態
   畳み方をいくら調整してもこれは直らないので、出し分けをここに一本化した。
   状態は refreshJourney が導出したものをそのまま使う(新しい状態機械を作らない) */
/* 工程は5つ(2026-08-01 品質改修で 7→5)。
   375px に7つは**入りきらなかった**(実測 59px はみ出し)。
   入りきらないのは装飾の問題ではなく、モデルが大きすぎる合図。
   減らしたのは「決定を伴わない2つ」:

   ・仕上げ設定(polish) … 本人が「そのままでもOK」と言われる任意の調整。
     工程として1枚立てると「通らねばならない関門」に見える。
     書き出しの画面へ吸収し、出す直前に触れるようにした
   ・音声を選ぶ(audio) … 決定は1つだけ(どのカメラの音を使うか)。
     しかも音のある動画が2本以上のときしか出ない。同期と分析の中へ入れる

   残した3つ(素材・傾き・長さと開始位置)は、どれも**本人が決めないと
   先が決まらない**もの。ここを削ると、ツールが勝手に決めたことになる */
MC.ui.STEP_RANK = { mat: 0, tilt: 1, sync: 2, length: 3, export: 4 };
MC.ui.STEP_GROUPS = [
  { id: "mat",    panels: ["#dropSec"] },
  /* 傾きは単独の工程(2026-07-31 優さん指示)。1画面に1本ぶんだけを出し、
     動画1 → 動画2 → 動画3 と送る */
  { id: "tilt",   panels: ["#tiltSec"] },
  /* #easyPane を sync に載せる(2026-07-28)。おまかせの実際の操作＝「分析を開始」は
     この枠にあるのに、工程表に載っていなかったため applySteps が一切触れられず、
     分析が済んだあとも全工程に出続けていた。
     #audioSec もここへ(2026-08-01) ─ 「この音で進める」は分析の続きの一手 */
  { id: "sync",   panels: ["#syncSec", "#easyPane", "#audioSec"] },
  /* 長さと開始位置を決める(2026-07-31)。音楽の解析だけ先に済ませてここで止まり、
     決まった範囲だけを映像解析する */
  { id: "length", panels: ["#lengthSec"] },
  /* 仕上げの3枠を書き出しへ吸収(2026-08-01)。任意の調整は、
     出す直前に「気になるところだけ」触るのが自然な順序 */
  { id: "export", panels: ["#exportSec", "#placeSec", "#layoutSec", "#finishSec"] },
];
MC.ui._stepOpen = new Set();   // 手で開いた「すみ」パネル(フェーズが進むと畳み直す)
MC.ui._stepPhase = null;

/* 畳んだヘッダーに残す一言。素材は本数が分かると安心(それ以外は✓だけで足りる) */
MC.ui.stepSummary = sel => {
  if (sel === "#dropSec") {
    const n = MC.media.slotClips().length;
    if (n) return `${n}本`;
  }
  return "済";
};

/* 表示する工程を切り替える唯一の入口。dataset(CSSの出し分け)・強調・
   applySteps・傾きフェーズの出入りをここに集約する */
MC.ui.showPhase = id => {
  document.body.dataset.mzjPhase = id;
  document.querySelectorAll(".side .panel").forEach(p => p.classList.remove("phase-current"));
  const target = document.querySelector(MC.ui.JOURNEY_SECTIONS[id]);
  if (target) target.classList.add("phase-current");
  MC.ui.applySteps(id);
  /* 「長さと開始位置」は開いた時点で候補を作り直す。長さ・演奏範囲・上限の
     どれが変わっていても、画面に出ているものが必ず今の状態を指すようにする */
  if (id === "length") MC.ui.renderLengthSec();
  /* 傾きは単独工程(2026-07-31)。この画面に入ったら対象の1本を描き、
     出るときは固定プレビューを解く。パネルの出し入れは applySteps に任せる */
  if (id === "tilt") MC.ui.renderTiltSec();
  else MC.ui.unpinTilt();
  MC.ui.refreshSetupTabs();   // タブの表示条件は現在工程に依存する(polish以降)
};

MC.ui.applySteps = current => {
  const R = MC.ui.STEP_RANK;
  const cur = R[current] ?? 0;
  const advanced = MC.ui._stepPhase != null && cur > R[MC.ui._stepPhase];
  const changed = MC.ui._stepPhase !== current;
  if (changed) { MC.ui._stepOpen.clear(); MC.ui._stepPhase = current; }
  MC.ui.STEP_GROUPS.forEach(g => {
    const state = R[g.id] < cur ? "done" : R[g.id] === cur ? "current" : "locked";
    g.panels.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) return;
      /* いまの工程だけ出す。「書き出しは整えると同時に開く」の例外は捨てた ─
         ジャーニーが「5 書出」をまだ先だと表示している横で、その中身
         (画質の選択と「動画を書き出す」)が既に画面にあった */
      el.classList.toggle("step-off", state !== "current");
      el.classList.toggle("step-done", state === "done");
      el.classList.remove("step-collapsed", "step-locked");
      /* 畳みヘッダーの✓チップはもう使わない(畳まないので)。残骸を消す */
      const h2 = el.querySelector(":scope > h2");
      const chip = h2 && h2.querySelector(".mz-step-chip");
      if (chip) chip.remove();
      if (h2) {
        h2.removeAttribute("role");
        h2.removeAttribute("tabindex");
        h2.removeAttribute("aria-expanded");
      }
    });
  });
  /* 工程が変わったら必ず先頭から読ませる。前の工程のスクロール位置が残ると、
     新しい画面の途中から始まって「何も出ていない」ように見える。
     おまかせの実行中は進捗ドックが主役なので動かさない */
  if (advanced && !MC.ui._busy) window.scrollTo({ top: 0, behavior: "smooth" });
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
    return `<span class="rig-badge none" title="自動カット割を実行すると判定されます">まだ見ていません</span>`;
  }
  const pct = Math.round((v.movingFrac || 0) * 100);
  return v.operated
    ? `<span class="rig-badge op" title="画面全体が動いている区間が${pct}%。人が操作していると判定">手でもって撮影</span>`
    : `<span class="rig-badge fx" title="画面全体が動いている区間が${pct}%。動いているのは被写体だけと判定">置いて撮影</span>`;
};

/* --- クリップカード --- */
/* 動画1/2/3の3スロット。空きは選択ボタン、読み込み済みはクリップカード */
/* 「前回のつづきがあります ─ この順番で選び直すと、分析をやり直さずに
   書き出しへ進めます」の案内は廃止(2026-08-01 優さん指示
   「落ちたら結局戻れないからその案内けして」)。

   2026-07-31 に同じ系統の案内を3つ消したとき、この1つだけ言い回しが違って
   生き残っていた。しかも入口の画面から「作る動画を選ぶ」を外した結果、
   **新しい第一画面でいちばん目立つ塊**になっていた ─ 戻れると約束する文が、
   最初に目に入る場所へ繰り上がっていたことになる。

   復元そのものは残す。実際に起きたときだけ、起きた事実を
   renderRestoreNote が「◯◯を復元しました」と報告する(約束ではなく結果) */
MC.ui.renderResumeNote = () => {
  const el = MC.ui.$("#resumeNote");
  if (el) { el.hidden = true; el.innerHTML = ""; }
};

MC.ui.renderClips = () => {
  MC.ui.renderResumeNote();
  const box = MC.ui.$("#clipSlots");
  box.innerHTML = "";
  const vertical = MC.S.mode === "vertical";
  /* 縦型は写真も入れられる。見出しの名詞をモードに合わせる(2026-07-23 B-4)。
     h2にはステップのチップが付くので、専用spanだけを書き換える */
  {
    const t = document.querySelector("#dropSec .drop-title");
    if (t) t.textContent = vertical ? "動画・写真を選ぶ" : "動画を選ぶ";
  }
  const slotClips = MC.media.slotClips();   // 音声のみを除く(動画+画像)
  /* 空き枠の補足を出す最初の1枠。3枠すべてに同じ説明を繰り返さない */
  const firstEmptyIdx = [0, 1, 2].find(i => !slotClips[i]);

  for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
    const c = slotClips[slotIdx];
    const firstEmpty = slotIdx === firstEmptyIdx;
    const slot = document.createElement("div");
    slot.className = "clip-slot" + (c ? " filled" : " empty");
    const lb = document.createElement("div");
    lb.className = "clip-slot-label";
    const noun = vertical ? "素材" : "動画";
    /* 2本目から先は任意(1本でも成立する)。3本目だけに但し書きを付けると、
       2本目は必須のように読める(2026-08-01) */
    lb.innerHTML = `<i class="fa-solid fa-video"></i> ${noun}${slotIdx + 1}`
      + (slotIdx >= 1 ? ` <span class="hint">任意</span>` : "");
    slot.appendChild(lb);
    if (!c) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "clip-slot-add";
      btn.innerHTML = vertical
        /* 補足は最初の空き枠にだけ付ける。3枠すべてに同じ説明を繰り返すと、
           1画面に同じ文が3回並ぶ(2026-07-28 文言の棚卸し) */
        ? 'タップして動画・写真を選ぶ' + (firstEmpty ? '<br><span class="hint">まとめて選べます／ここにドロップでもOK</span>' : '')
        : 'タップして動画を選ぶ' + (firstEmpty ? '<br><span class="hint">まとめて選べます／ここにドロップでもOK</span>' : '');
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
${c.isImage ? "" : (c.tiltOk
          /* 状態は名詞で言う(動詞は行動バーに集約)。直した実感が残るように
             何度なおしたかを添える。`›` は「押せる」ことを iPhone に伝える
             唯一の手段 ─ title 属性は iOS Safari では永久に読まれない */
          ? `<button type="button" class="tilt-badge done" data-tilt aria-label="傾きを見直す">
               <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
               <span>傾き 確認ずみ${c.rot ? `（${c.rot > 0 ? "+" : ""}${c.rot.toFixed(1)}°を修正）` : "（修正なし）"}</span>
               <span class="tilt-badge-go" aria-hidden="true">›</span></button>`
          : `<button type="button" class="tilt-badge todo" data-tilt>
               <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
               <span>傾き 未確認</span>
               <span class="tilt-badge-go" aria-hidden="true">›</span></button>`)}
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
          <option value="fixed" ${c.rig === "fixed" ? "selected" : ""}>置いて撮影</option>
          <option value="operated" ${c.rig === "operated" ? "selected" : ""}>手でもって撮影</option>
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
    /* 傾きバッジ → その動画から確認/再調整(2026-07-31 カード内タスク化) */
    const tb = card.querySelector("[data-tilt]");
    if (tb) tb.onclick = () => {
      const i = MC.ui.tiltCams().findIndex(x => x.id === c.id);
      MC.ui.openTilt(i >= 0 ? i : null);
    };
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
    /* dB表記はやめた(2026-07-28 文言見直し)。「音量-14dB」は中高生に通じない。
       rms を3段の言葉に割る(-20dB相当=0.1 / -34dB相当=0.02 が境目) */
    const loud = r => r >= 0.1 ? "音が大きい" : r >= 0.02 ? "音は標準" : "音が小さめ";
    const stat = c.stats
      ? `${loud(c.stats.rms || 0)}${c.stats.clipRatio > 0.001 ? "・音がわれています⚠" : ""}`
      : (c.hasAudio === false ? "音声なし" : "分析するとここに音量が出ます");
    /* 呼び名は「動画N」に統一(2026-08-01)。素材カードも傾きの画面も「動画N」なのに、
       ここだけ「カメラN」で、同じものを2つの名前で呼んでいた。
       プレビュー左下のバッジも同じ日に「動画N」へ揃えた */
    const slotIdx = MC.S.slots.indexOf(c.id);
    const dispName = c.isAudio ? "音声ファイル"
      : slotIdx >= 0 ? `動画${slotIdx + 1}` : MC.ui.shortName(c.name);
    label.innerHTML = `
      <input type="radio" name="audioClip" ${MC.S.audioClipId === c.id ? "checked" : ""} ${c.hasAudio === false ? "disabled" : ""}>
      ${c.isAudio ? '<i class="fa-solid fa-file-audio" title="取り込んだ音声ファイル"></i> ' : ""}<span>${MC.ui.esc(dispName)}${!c.isAudio && slotIdx >= 0 ? ` <span class="hint">${MC.ui.esc(MC.ui.shortName(c.name, 12))}</span>` : ""}</span>
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
  /* 「この音で進める」は**分析が終わるまで押させない**（2026-07-25 実機で事故）。
     このパネルは最初から画面にあり、読み込んだ直後でも押せてしまっていた。
     押すと同期も解析もしていない素材のまま仕上げ(runEasyFinish)が走り、
     優さんのiPhoneでタブごと落ちた。
     判定は「同期が済んだか」(MC.ui.isSynced)。ジャーニーの現在地と同じ物差しを使う。 */
  const analyzed = MC.ui.isSynced();
  const db = MC.ui.$("#audioDecideBtn");
  if (db) {
    db.disabled = !analyzed;
    if (!analyzed) db.dataset.mzWasDisabled = "1";   // 作業中ロックの解除で誤って有効化されないように
    else delete db.dataset.mzWasDisabled;
  }
  const hint = MC.ui.$("#audioGateHint");
  if (hint) hint.hidden = analyzed;
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
    el.innerHTML = `<span class="warn">この端末では、動画とおなじ長さの時間がかかります（3分の動画なら約3分）。おわるまで画面を閉じないでください</span>`;
    btn.innerHTML = '<i class="fa-solid fa-file-export"></i> 動画を書き出す';
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
  /* 「ライトモード(720p)」等はやめた(2026-07-28)。「モード」はこのツールで
     3つの意味に使われ、p表記は通じない。速いか・きれいか、だけを言う */
  const defs = [
    { id: "light", name: "標準", tag: "おすすめ",
      desc: "SNSに投稿するのに十分な画質。書き出しが約2割速い" },
    { id: "full", name: "高画質", tag: "",
      desc: "大きな画面で見る場合に。書き出しに時間がかかります" },
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
  /* 傾きUIは独立フェーズ(#tiltSec)へ移した(2026-07-28)。ここは配置専用 */
  if (!showPlace) { sec.hidden = true; return; }
  sec.hidden = false;

  const head = sec.querySelector("h2 .place-title");
  if (head) head.textContent = "カメラの配置";
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

};

/* ---------- 傾きの確認(独立フェーズ・手動のみ 2026-07-28 優さん指示) ----------
   自動検出(horizon.js)は全廃。1本ずつプレビューで確認し、0.1度きざみで手で直す。
   全カメラをOKするまで次の工程へ進まない(スキップなし。OKは1タップ)。
   c.rot は従来どおり保存・復元(layout.js の fineRot 経路は無変更)。
   c.tiltOk = 本人が確認した印(保存・復元する) */
MC.ui._tiltIdx = 0;
MC.ui._tiltPinned = false;
MC.ui.tiltCams = () => MC.S.clips.filter(c => !c.isAudio && !c.isImage);

/* かたむきの確認が要るか。refreshJourney の免除(legacy)と**同じ物差し**を使う。
   ここを素の !tiltOk で判定していたため、免除でゲートは通っているのに
   カードは⚠のまま・行動バーが「かたむきを確認する」に乗っ取られ、
   素材画面から先へ戻る「これでOK、つづける」が出なくなっていた */
MC.ui.tiltPending = () => {
  const cams = MC.ui.tiltCams();
  if (!cams.length || MC.S.easyDone) return false;
  if (MC.ui.isSynced() && cams.some(c => c.tiltOk === undefined)) return false;  // 旧データは対象外
  return cams.some(c => !c.tiltOk);
};

/* 傾きの画面へ移る(2026-07-31 単独工程へ戻した)。
   idx を渡すとその動画から、渡さなければ最初の未確認から見る */
MC.ui.openTilt = idx => {
  if (!MC.ui.tiltCams().length) return;
  /* 明示指定は renderTiltSec の「未確認から始める」再探索より強い。
     この印が無かったときは、確認ずみカードの✓を押すと
     **押したのと別の動画**(全部確認ずみなら常に最後の1本)が開いていた */
  MC.ui._tiltPick = idx != null;
  if (idx != null) MC.ui._tiltIdx = idx;
  /* 工程そのものを切り替える。refreshJourney が showPhase("tilt") を通し、
     その中で renderTiltSec が走る(applySteps が .step-off を外したあと) */
  MC.ui._viewPhase = "tilt";
  MC.ui.refreshJourney();
  window.scrollTo({ top: 0, behavior: "smooth" });
};
/* 固定プレビューと単独表示を解く。パネルの表示は applySteps の担当なので触らない */
MC.ui.unpinTilt = () => {
  if (!MC.ui._tiltPinned) return;
  MC.ui._tiltPinned = false;
  document.body.classList.remove("mz-pin-force");
  document.documentElement.style.removeProperty("--mz-tilt-pad");
  MC.preview.soloId = null;
  MC.preview.draw();
};
/* 傾きの補正は隅が出ないようにズームするので、まわりが切れる(layout.js の z と同式)。
   何%切れるかを言わないと、5度も回して「なんか小さくなった」になる */
MC.ui.tiltCropPct = deg => {
  const th = Math.abs((+deg || 0) * Math.PI / 180);
  if (!th) return 0;
  const w = 16, h = 9;   // 比率だけで決まる
  const z = Math.max((w * Math.cos(th) + h * Math.sin(th)) / w,
                     (w * Math.sin(th) + h * Math.cos(th)) / h);
  return Math.round((1 - 1 / z) * 1000) / 10;
};
MC.ui.renderTiltSec = () => {
  const cams = MC.ui.tiltCams();
  if (!cams.length) return;
  /* まだ確認していないカメラから始める(全部OKなら最後の1台)。
     入れ直しのたびに確認済みの分まで押させない */
  if (MC.ui._tiltPick) {
    MC.ui._tiltPick = false;              // 明示指定は一度だけ効く
  } else if (MC.ui._tiltIdx == null || !cams[MC.ui._tiltIdx] || cams[MC.ui._tiltIdx].tiltOk) {
    const i = cams.findIndex(c => !c.tiltOk);
    MC.ui._tiltIdx = i >= 0 ? i : cams.length - 1;
  }
  MC.ui._tiltIdx = Math.max(0, Math.min(MC.ui._tiltIdx, cams.length - 1));
  const c = cams[MC.ui._tiltIdx];
  const no = MC.ui.$("#tiltCamNo");
  /* 呼び名は「動画N」に統一(2026-07-31)。スロットは「動画1/2/3」なのに
     ここだけ「カメラN」で、カード内タスク化で両者が同じ画面に並んだ */
  if (no) no.textContent = `動画${MC.ui._tiltIdx + 1} / ${cams.length}`;
  const fileEl = MC.ui.$("#tiltFile");
  if (fileEl) fileEl.textContent = MC.ui.shortName(c.name, 14);
  const th = MC.ui.$("#tiltThumb");
  if (th) { if (c.thumb) { th.src = c.thumb; th.hidden = false; } else { th.hidden = true; } }
  const val = MC.ui.$("#tiltVal2");
  if (val) val.textContent = (+(c.rot || 0)).toFixed(1) + "°";
  const crop = MC.ui.$("#tiltCrop");
  if (crop) {
    const pct = MC.ui.tiltCropPct(c.rot);
    crop.textContent = pct ? `まわりが約${pct}%切れます` : "";
    crop.hidden = !pct;
  }
  /* 0秒目は三脚を触っている・足元が映っている等で判断できない。
     真ん中あたりの場面を出す(2026-07-28 レビューP0) */
  if (c.video && c.duration && !c._tiltSeeked) {
    c._tiltSeeked = true;
    try { c.video.currentTime = Math.min(c.duration * 0.35, Math.max(0, c.duration - 0.1)); } catch (_) {}
  }
  const range = MC.ui.$("#tiltRange2");
  if (range) range.value = +(c.rot || 0);
  const prev = MC.ui.$("#tiltPrevBtn");
  if (prev) prev.disabled = MC.ui._tiltIdx === 0;
  const ok = MC.ui.$("#tiltOkBtn");
  if (ok) ok.innerHTML = '<i class="fa-solid fa-check"></i> '
    + (MC.ui._tiltIdx === cams.length - 1 ? "OK、これで進む" : "この動画はOK");
  /* 対象カメラを単独表示し、プレビューを画面上部に固定して見ながら直す */
  MC.preview.soloId = c.id;
  MC.ui._tiltPinned = true;
  document.body.classList.add("mz-pin-force");
  MC.preview.draw();
  /* 固定プレビューは流れの高さを持たない。実際の下端を測って、その分だけ
     パネルを下げる(足りないと見出しが隠れ、多いと主ボタンが画面外に出る)。
     rAF に入れてはいけない ─ 非表示タブでは発火せず、別アプリから戻ったときに
     余白ゼロのまま見出しが隠れる。getBoundingClientRect がレイアウトを
     確定させるので、ここで同期に測って問題ない */
  {
    const ch = document.querySelector(".canvas-holder");
    const side = document.querySelector(".side");
    if (ch && side) {
      /* 余白を**一度ゼロに戻してから**素の位置を測る(2026-07-29 優さん報告で修正)。
         padding-top は要素自身の top を動かさない(中身が下がるだけ)ので、
         現在の padding を引いて「本来の位置」を出したつもりになっていた前の式は、
         カメラを送るたびに 111px ずつ余白を積み増していた。
         removeProperty の直後に getBoundingClientRect を読むとレイアウトが
         確定するので、その値が素の位置になる */
      document.documentElement.style.removeProperty("--mz-tilt-pad");
      const r = ch.getBoundingClientRect();
      const top = side.getBoundingClientRect().top;
      if (r.height >= 1) {                          // 固定が効かない画面幅では何もしない
        const pad = Math.max(0, Math.round(r.bottom - top + 12));
        document.documentElement.style.setProperty("--mz-tilt-pad", pad + "px");
      }
    }
  }
};
MC.ui.wireTiltSec = () => {
  const $ = MC.ui.$;
  const cur = () => MC.ui.tiltCams()[MC.ui._tiltIdx];
  const apply = v => {
    const c = cur();
    if (!c) return;
    /* 実用範囲は±3度。±5度は15%も切れて使いものにならず、
       スライダーの1目盛りが指より細かくなるだけだった(2026-07-28 実測) */
    c.rot = Math.max(-3, Math.min(3, Math.round(v * 10) / 10));   // 0.1°刻み
    const val = $("#tiltVal2"); if (val) val.textContent = c.rot.toFixed(1) + "°";
    const range = $("#tiltRange2"); if (range) range.value = c.rot;
    const crop = $("#tiltCrop");
    if (crop) {
      const pct = MC.ui.tiltCropPct(c.rot);
      crop.textContent = pct ? `まわりが約${pct}%切れます` : "";
      crop.hidden = !pct;
    }
    MC.saveState();
    MC.preview.draw();
  };
  const range = $("#tiltRange2");
  if (range) range.oninput = e => apply(parseFloat(e.target.value));
  const minus = $("#tiltMinus"), plus = $("#tiltPlus");
  /* 1タップ0.5度。0.1度刻みだと端から端まで50タップで実用外だった */
  if (minus) minus.onclick = () => apply((+(cur()?.rot) || 0) - 0.5);
  if (plus) plus.onclick = () => apply((+(cur()?.rot) || 0) + 0.5);
  const scene = $("#tiltSceneBtn");
  if (scene) scene.onclick = () => {
    const c = cur();
    if (!c || !c.video || !c.duration) return;
    /* 0.2 → 0.35 → 0.5 → 0.65 → 0.8 と場面を送る。1か所で決めさせない */
    const steps = [0.2, 0.35, 0.5, 0.65, 0.8];
    c._tiltScene = ((c._tiltScene == null ? 1 : c._tiltScene) + 1) % steps.length;
    try { c.video.currentTime = Math.min(c.duration * steps[c._tiltScene], c.duration - 0.1); } catch (_) {}
    setTimeout(() => MC.preview.draw(), 120);
  };
  const prev = $("#tiltPrevBtn");
  if (prev) prev.onclick = () => {
    if (MC.ui._tiltIdx <= 0) return;
    MC.ui._tiltIdx--;
    /* ★ 明示の指定であることを伝える。これが無いと renderTiltSec の
       「未確認の動画から始める」再探索に即座に上書きされ、**ボタンを押しても
       画面が1つも戻らない**(2026-07-31 実測: 動画3で押しても動画3のまま)。
       傾きが単独の工程になって順に送る形になったため、1つ前は必ず確認ずみ ─
       つまりこのボタンは本来の使い道でだけ壊れていた */
    MC.ui._tiltPick = true;
    MC.ui.renderTiltSec();
  };
  /* このまま進む(2026-08-01)。確認ずみの印は付けない ─ 工程表の丸は
     未確認のまま残り、いつでも戻れる。嘘の✓を付けないのが要点 */
  const skip = $("#tiltSkipBtn");
  if (skip) skip.onclick = () => {
    MC.S.tiltSkipped = true;
    MC.ui._viewPhase = null;
    MC.ui.renderClips();        // カードのバッジは⚠のまま(飛ばしただけなので)
    MC.ui.refreshJourney();     // showPhase が固定プレビューを解いて次の工程へ
  };
  /* #tiltAddBtn は撤去(2026-07-31)。動画を足しに戻るのは工程表の「動画」から */
  const ok = $("#tiltOkBtn");
  if (ok) ok.onclick = () => {
    const cams = MC.ui.tiltCams();
    const c = cams[MC.ui._tiltIdx];
    if (!c) return;
    c.tiltOk = true;
    MC.saveState();
    const next = cams.findIndex((x, i) => i > MC.ui._tiltIdx && !x.tiltOk);
    if (next >= 0) {
      MC.ui._tiltIdx = next;
      MC.ui.renderTiltSec();
      /* いま確認した動画のバッジを✓へ。ここを呼ばないと、上へスクロールした
         とき「さっきOKしたはずの動画」が⚠のまま出ている(renderClips に
         定期実行は無く、呼び出し元は6箇所だけ) */
      MC.ui.renderClips();
    } else {
      /* 全部おわり → 寄り道を解いて次の工程へ。refreshJourney が
         tilt を完了にし、showPhase("sync") が固定プレビューを解く */
      MC.ui._viewPhase = null;
      MC.ui.renderClips();
      MC.ui.refreshJourney();
    }
  };
};

/* おまかせの説明。カット割をするのはスイッチング/ワイプのときだけなので、
   縦型では文言から外す(やらないことを書かない) */
MC.ui.renderEasyLead = () => {
  const el = document.querySelector(".easy-lead");
  if (!el) return;
  const cutMode = MC.S.mode === "switch";   // カット割の説明は③だけ(2026-07-24)
  /* 完了後は完了カード(easyStatus)が同じことを言うので、リード文は畳む
     (同じ表示を2箇所に出さない。失敗時は markExportFailed がここへ書く) */
  /* リード文はもう出さない(2026-07-28)。すぐ上のタブ説明
     「おまかせ＝同期もカット割も自動で仕上げます」(setSetupTabsLead)と
     ほぼ同じ文が、同じ画面に2行並んでいた。残すのは失敗時の差し替えだけ */
  el.hidden = true;
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
    if (!el) return;
    /* ★ 同期に失敗したゲストを詰ませない。失敗時は「唯一の復旧手段だから」と
       こだわりタブを前倒しで開放している(_tabsForced)のに、その先の
       「波形で同期する」がロックされていて押せなかった ─ ツールが自分で
       唯一の復旧手段と呼んだものが、失敗した本人に閉じていた(2026-07-31) */
    const rescue = sel === "#syncSec" && MC.ui._tabsForced;
    el.classList.toggle("mz-locked", guest && !rescue);
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
  /* 土台は #layoutSec(2026-07-28)。タブは polish から出すため、#syncSec は
     同期失敗時にしか見えない。polish で必ず見える方に案内を置く */
  const pane = MC.ui.$("#layoutSec");
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
  /* #proPane は廃止した(2026-07-28)。ラッパで隠すと、その中の #syncSec と
     #layoutSec が工程②④の画面そのものなので、おまかせでは現在地の画面が
     消えていた。おまかせ/こだわりの出し分けは body のクラスで行い、
     工程の出し分け(applySteps)と喧嘩させない */
  document.body.classList.toggle("tab-easy", easy);
  document.body.classList.toggle("tab-pro", !easy);
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
  /* タブは同期の工程から出す(2026-08-01)。こだわり＝「おまかせの結果を直す道具」で、
     素材を選んでいる段では押しても何も起きない。
     例外: 同期に失敗したとき(_tabsForced)は途中でも開く ─ 手動同期(#syncBtn)が
     唯一の復旧手段のため。

     ★ ここは rank.polish を見ていた。工程を7→5へ畳んで polish を消したとき、
       rank.polish が undefined になり `数値 < undefined` が常に false ─
       つまり**タブが最初の画面から出っぱなし**になっていた。
       消した工程の名前が条件に残ると、こうして静かに壊れる */
  const rank = MC.ui.STEP_RANK;
  tabs.hidden = !MC.ui._tabsForced &&
    (rank[MC.ui._stepPhase ?? "mat"] ?? 0) < rank.sync;
  if (tabs.hidden && MC.ui._setupTab === "pro") { MC.ui.setSetupTab("easy"); return; }
  const lead = MC.ui.$("#setupTabsLead");
  if (lead) {
    lead.textContent = MC.ui._setupTab === "pro"
      ? "同期・レイアウト・仕上げを自分で決めます"
      : "おまかせ＝同期もカット割も自動で仕上げます";
  }
  MC.ui.setSetupTab(MC.ui._setupTab || "easy");
};

/* おまかせで開始: 同期 → (カット割モードなら)自動カット割 → カラーマッチ を続けて実行 */
/* 長い処理の間、競合する操作をまとめて止める(二重実行でcutList/offsetが壊れるのを防ぐ) */
MC.ui.BUSY_FLAG_KEY = "mz_switcher_busy_v1";
MC.ui.setBusy = busy => {
  /* ★ おまかせの自走が終わるまで鍵を外さない(2026-08-01)。
     自走は runEasy → runEasyFinish → 書き出し と**複数の処理をまたぐ**が、
     それぞれの finally が setBusy(false) を呼ぶ。そのままだと段の切れ目で
     操作が開き、走っている最中に別のボタンを押せてしまう
     (実測: 仕上げに入った時点で押せるものが 0個 → 14個 に戻っていた)。
     解放は runAuto が最後に一度だけ行う */
  if (!busy && MC.ui._autoRunning) return;
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
  /* ---- 作業中は操作を全部止める（2026-07-25 実機で事故） ----
     以前は6個を名指しで止めていた。名指しから漏れた #audioDecideBtn が分析中も
     押せてしまい、優さんのiPhoneで分析の途中に押して落ちた。
     名指しは「ボタンを増やすたびに漏れる」形なので、逆にする:
     作業領域(main)のボタンを全部止め、**止めてはいけないものだけ**を残す。

     残すもの:
       #cancelBtn / #eoCancel … 中止。作業中にこそ押せないと困る
       #eoClose               … 失敗表示を閉じる
       #errorLog 内           … ログのコピー/閉じる（失敗時に必要）
     ヘッダ(サイト共通のハンバーガー等)は main の外なので元から対象外。 */
  /* #floatClose を止めると、分析中に全画面プレビューへ入った人が出られなくなる。
     入口(.canvas-holder のclick)は div なので busy でも通り、出口は
     このボタンと Escape だけ ─ iPhone に Escape は無い(2026-07-26 レビュー指摘) */
  const KEEP = new Set(["cancelBtn", "eoCancel", "eoClose", "floatClose"]);
  /* main では狭い。#modeBackBtn / モード選択カード / #cutModal / 行動バーは main の外にあり、
     とくに「つくる動画を選び直す」は走っている解析を止めずに画面だけ戻してしまう */
  const lockables = [
    ...document.querySelectorAll(
      "#workspace button, #workspace input, #workspace select, " +
      "#modeSelect button, #exportOverlay button, #cutModal button"),
  ].filter(Boolean);
  lockables.forEach(el => {
    if (KEEP.has(el.id)) return;
    if (el.closest("#errorLog")) return;
    // 進捗カードが自分で出す「中止する」「やり直す」。ここを止めると長い処理を殺せなくなる
    if (el.classList.contains("mzp-cancel") || el.classList.contains("mzp-retry")) return;
    if (busy) {
      /* もともと disabled だったものは、解除時にその状態へ戻す。
         この印は今まで読むだけで一度も書かれておらず、解除のたびに
         「本来まだ押せないボタン」まで有効になっていた（例: #exportBtn）。
         直後の renderAll が上書きするので表面化していなかっただけ */
      if (!el.dataset.mzWasDisabled) el.dataset.mzWasDisabled = el.disabled ? "1" : "0";
      el.disabled = true;
    } else if ("mzWasDisabled" in el.dataset) {
      /* busy 中に生まれた要素は印を持たない。印の無いものまで有効化すると、
         例えば「音声の無いカメラ」のラジオが選べるようになる(いまは直後の
         renderAll に救われているだけ)。印のあるものだけ元へ戻す */
      el.disabled = el.dataset.mzWasDisabled === "1";
      delete el.dataset.mzWasDisabled;
    }
  });
  document.body.classList.toggle("mz-busy-lock", !!busy);
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
  let showSec = Math.max(0, (tOut ?? 0) - (tIn ?? 0));
  if (!dur || !clips.length || showSec < 1) { el.hidden = true; return; }
  /* ★ 長さを決める前は素材の全長で見積もらない(2026-07-31 5巡目P0)。
     入口を20分に開いた直後、ここが全長を分母にしていたため、
     「長い録画でも大丈夫です」の同じ画面で「分析に20分・書き出しに36分」と
     予告していた ─ 実際に解析も書き出しも見るのは選んだ範囲だけ。
     使える最長プリセット(ゲスト59秒/登録3分/PC10分)を分母の上限にする */
  if (!MC.S.lengthDecided && MC.ui.usablePresets) {
    const open = MC.ui.usablePresets(showSec).filter(p => !p.locked);
    if (open.length) {
      showSec = Math.min(showSec, MC.highlight.presetSec(open[open.length - 1], showSec));
    }
  }

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
  /* 傾きの確認中に見えているのは1台のソロ表示で、完成品ではない
     (2026-07-28 レビューP1)。工程に合わない断言をしない */
  const ph = document.body.dataset.mzjPhase;
  if (ph !== "export") {   // 仕上げは書き出しの画面へ吸収(2026-08-01)
    const sc0 = MC.getClip(MC.preview.soloId);
    el.innerHTML = '<i class="fa-solid fa-ruler-horizontal" aria-hidden="true"></i> '
      + '<span><b>傾きを確認しています</b>'
      + (sc0 ? `${MC.ui.esc(MC.ui.shortName(sc0.name))} ${(+sc0.rot || 0).toFixed(1)}°` : "")
      + "</span>";
    return;
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
MC.ui._leaveGuarded = false;

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
  if (MC.ui._busy) MZ_SESSION.keepAwake(true);
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
  /* 書き出しの途中で落ちたときは、どこまで進んだかを具体的に言う。
     「途中で終わっています」だけでは、原因究明にも次の行動にもつながらない */
  let stalled = null;
  try { stalled = JSON.parse(sessionStorage.getItem("mz_switcher_export_at_v1") || "null"); } catch (_) {}
  const head = (opts.crashed && stalled)
    ? `書き出しが ${stalled.pct}% で止まりました。`
    : opts.crashed
      ? "前回は途中で終わっています。"
      : opts.running
        ? "離れていた間は止まっていました。"
        : "中断された可能性があります。";
  const body = opts.running
    ? "続きから進めています。終わるまでこの画面のままお待ちください。"
    : (opts.crashed && stalled)
      /* 「選び直せば書き出しからやり直せます」「◯分ぶんは書けています。
         もう一度押すと、そこから続きます」を削除(2026-07-31 優さん指示)。
         実際には戻れなかった。残すのは起きた事実と、次を追うための診断だけ */
      ? `<span class="mz-stall-detail">${stalled.k}/${stalled.total}コマ・`
        + `${stalled.w}x${stalled.h}・${stalled.mbps || "?"}Mbps・`
        + `カメラ${stalled.cams || "?"}本・${stalled.route || "?"}・`
        + `${stalled.sec != null ? stalled.sec + "秒で" : ""}約${stalled.mb || "?"}MBまで`
        + `${stalled.apar ? "・音声並行" : "・音声直列"}`
        + (stalled.part ? `・パート${stalled.part}` : "")
        /* 1コマも書けずに落ちた回は k=0 のまま。どの段で消えたかは
           _markPhase の足跡だけが知っている(2026-07-31) */
        + (stalled.phase ? `・${MC.ui.esc(stalled.phase)}` : "")
        + `・再シーク${stalled.skips ?? "?"}回`
        + `${stalled.freeMB != null ? "・空き" + stalled.freeMB + "MB" : ""}`
        + `${stalled.noskip ? "・診断(noskip)中" : ""}</span>`
      : "";
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
MC.ui.notifyAnalysisDone = (opt) => {
  /* ★ おまかせの最中は黙る(2026-08-01 レビュー14件)。ここは分析が済んだだけで、このあと
     書き出しが数分続く。完了バナー自体は全画面(z-index 130)の下に隠れるが、
     **バイブとタブのタイトルは端末に届いてしまう**ので、別アプリへ行っていた
     人を「もう終わった・書き出せます」と勘違いさせて呼び戻していた。
     しかも押すべきボタンはおまかせが自分で押す。
     おまかせ本来の完了は、書き出しが終わった時に1回だけ出る */
  if (opt && opt.silent) return;
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
  MC.ui._stayBanner(on);          // 帯はこのツール固有(共通側は見た目を持たない)
  MZ_SESSION.guardLeave(on);      // beforeunload + Wake Lock
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
/* ============ おまかせ: 取り込んだら書き出しまで自走(2026-08-01 優さん指示) ============
   「できるだけタップやクリックせずに最後までやってほしい」。
   決め打ちにするのは4つ:
     完成60秒 / 盛り上がるシーン / 音はおすすめ / 傾き自動 / 色は MarchinZカラー

   ★ 途中で一度も止まらないので、**止まるべき所で止まらない**のがいちばん怖い。
     ・上限を超える長さは選ばない(ゲストは59秒までなので presetSec が丸める)
     ・失敗したらそこで止めて、こだわりへ逃がす(黙って続けない)
     ・すでに書き出し済みなら走らせない(二重書き出し) */
MC.ui.AUTO = {
  preset: "short",        // 完成60秒(実尺は上限で丸まる)
  startKey: "climax",     // 盛り上がるシーン
  filterId: "marchinz",   // MarchinZカラー
};

/* おまかせで決め打ちにする設定を当てる。呼ぶのは自走の入口だけ */
MC.ui.applyAutoChoices = () => {
  MC.S.exportPreset = MC.ui.AUTO.preset;
  MC.S.startKey = MC.ui.AUTO.startKey;
  MC.S.startAt = null;
  MC.S.filterId = MC.ui.AUTO.filterId;
  MC.S.colorOn = true;
  MC.S.horizonOn = true;
};

/* 傾きを自動で当てる。検出できた本だけ回し、できなかった本は0のまま。
   ★ 本人の確認は求めない(おまかせなので)が、「確認ずみ」の印も付けない ─
     こだわりへ切り替えたときに、見ていないものが✓になっていては嘘になる */
MC.ui.autoHorizon = async p => {
  const cams = MC.ui.tiltCams();
  if (!cams.length || !MC.horizon || !MC.horizon.suggest) return 0;
  let fixed = 0;
  for (const c of cams) {
    if (MC.ui._autoCancel) break;
    try {
      const deg = await MC.horizon.suggest(c);
      if (deg != null && Math.abs(deg) >= 0.15) { c.rot = Math.max(-3, Math.min(3, deg)); fixed++; }
    } catch (e) { MC.log("horizon 自動: " + c.name + " → " + e.message); }
  }
  MC.S.tiltSkipped = true;    // ゲートは通す。ただし tiltOk は立てない(嘘の✓を付けない)
  MC.saveState();
  return fixed;
};

/* おまかせ画面でプレビューを流す。音は鳴らさない ─ 解析中に音だけ流れると驚く。
   ★ 消音は play() の**後**で当てる。play() の中の applyMute が
     「音声担当だけ鳴らす」で上書きするため、先に消しても戻る */
MC.ui.autoPreviewPlay = () => {
  try {
    MC.preview.play();
    MC.S.clips.forEach(c => { if (c.video) c.video.muted = true; });
  } catch (e) { MC.log("autoStage: プレビュー再生に失敗 " + e.message); }
};

/* 音声を自動で決める。stats が取れていれば recommend、無ければ先頭の動画 */
MC.ui.autoPickAudio = () => {
  const reco = MC.audio.recommend && MC.audio.recommend();
  const fallback = MC.S.clips.find(c => !c.isImage && c.hasAudio !== false);
  const pick = reco || fallback;
  if (pick) MC.S.audioClipId = pick.id;
  MC.S.audioPickedByUser = false;   // 手で選んでいない=以後もおすすめに追従
  MC.S.audioDecided = true;
  MC.saveState();
  return pick;
};

/* 自走の残り時間。3〜9分ほど何もできないので、**あと何分か**が唯一の情報になる。
   式は「長さと開始位置」の案内(lengthEta)と同じものを使う ─
   同じ待ちについて2箇所で違う数字を出さない */
MC.ui.autoEtaSec = () => {
  const clips = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  if (!clips.length) return 0;
  /* 長さは決め打ち(60秒)。上限で丸まるので実尺を使う */
  const lenSec = MC.highlight && MC.highlight.presetSec
    ? MC.highlight.presetSec({ id: MC.ui.AUTO.preset, sec: 59 }, 1e9) : 59;
  const ana = clips.length * lenSec * MC.ui.analysisRate();
  let exp = MC.ui.exportMode() === "realtime" ? 1.15 : (MC.isIOS ? 1.8 : 0.9);
  if (MC.exporter.quality() === "light") exp *= 0.8;
  return ana + lenSec * exp;
};

/* ============ おまかせ専用の1画面(2026-08-01 優さん指示) ============
   「完全にUIを分けて。1つの画面だけに。何をしてるかがわかる。
     プレビューがわかるように。できていってる！がわかる楽しいUI」

   ★ プレビューは**同じ canvas を移す**(複製しない)。preview.js は
     this.canvas の参照で描き続けるので、DOM上の親が変わっても絵は流れる。
     複製すると2枚を毎フレーム描くことになり、iPhoneでは倍の負荷になる。
     終わったら必ず元の場所へ戻す ─ 戻し忘れるとプレビューが消える */
MC.ui.autoStage = {
  /* 段の重み。実測の所要に近い比率にしておくと、バーが等速に見える */
  /* 段の名前は2つ持つ。いま動いている間は「何をしているか」、
     済んだら「何ができたか」。できた実感は動詞ではなく成果から出る */
  STEPS: [
    { key: "tilt",   label: "傾きを直す",         done: "傾きを直しました",     w: 12 },
    { key: "sync",   label: "音を合わせる",       done: "音がそろいました",     w: 10 },
    { key: "audio",  label: "いちばん良い音を選ぶ", done: "いちばん良い音にしました", w: 2 },
    { key: "scan",   label: "見どころを探す",      done: "見どころが決まりました", w: 16 },
    { key: "finish", label: "カメラを切り替える",   done: "カメラ割りができました", w: 30 },
    { key: "export", label: "動画を書き出す",      done: "書き出しました",       w: 30 },
  ],
  _done: [], _now: null, _home: null,
  /* _sub=いま動いている段の補足 / _doneSub=済んだ段の成果 / _inner=段の中の進み具合
     _fail=失敗の顔を出しているか / _prevFocus=開く前にフォーカスがあった要素 */
  _sub: null, _doneSub: {}, _inner: 0, _fail: null, _prevFocus: null,
  /* _failedStep=どの段で止まったか / _wakeWarn=消灯の警告(0=無 1=断られた 2=非対応) */
  _failedStep: null, _wakeWarn: 0,

  open() {
    const el = MC.ui.$("#autoStage");
    if (!el || !el.hidden) return;
    /* ★ _sub / _doneSub / _inner / _fail も戻す(2026-08-01 レビュー14件)。
       _sub を戻していなかったため、前の段の文字が次の段に居座っていた
       (「カメラを切り替える  音を読み込み中 100%」のような表示) */
    this._done = []; this._now = null;
    this._sub = null; this._doneSub = {}; this._inner = 0; this._fail = null;
    this._failedStep = null; this._wakeWarn = 0;
    el.classList.remove("as-failed");
    const wt0 = el.querySelector(".as-wait"); if (wt0) wt0.hidden = false;
    const fb = MC.ui.$("#asFail"); if (fb) fb.hidden = true;
    const cb = MC.ui.$("#asCancel");
    if (cb) { cb.hidden = false; cb.disabled = false; cb.textContent = "やめる"; }
    /* canvas を全画面のプレビュー枠へ移す。戻す場所を覚えておく */
    const cv = document.getElementById("cv");
    const host = MC.ui.$("#asPreview");
    if (cv && host) { this._home = cv.parentElement; host.appendChild(cv); }
    el.hidden = false;
    document.body.classList.add("mz-auto-stage");
    /* role="dialog" aria-modal を名乗る以上、フォーカスも中へ移す。
       aria-modal は読み上げには効くが、Tab の順番は止めない ─
       移さないと背後のこだわり画面のボタンへ Tab で入れてしまう */
    this._prevFocus = document.activeElement;
    try { const c = MC.ui.$("#asCancel"); if (c) c.focus({ preventScroll: true }); } catch (e) {}
    /* ★ プレビューを実際に動かす(2026-08-01 レビューP0)。
       枠だけ移しても再生していなければ黒い箱で、
       「できていってる！」がいちばん伝わらない。
       音は鳴らす必要が無いので消す ─ 解析中に音だけ流れると驚く */
    try {
      MC.preview.play();
      /* ★ 消音は play() の**後**で当てる。play() の中の applyMute が
         「音声担当だけ鳴らす」で上書きするため、先に消しても戻る
         (実測: clip1 だけ muted=false に戻っていた)。
         解析中に音だけ流れると驚くので、この画面では全部消す */
      MC.S.clips.forEach(c => { if (c.video) c.video.muted = true; });
    } catch (e) { MC.log("autoStage: プレビュー再生に失敗 " + e.message); }
    this.render();
  },

  close() {
    const el = MC.ui.$("#autoStage");
    if (!el || el.hidden) return;
    try { MC.preview.pause(); MC.preview.applyMute(); } catch (e) {}   // 音の割り当てを元へ
    const cv = document.getElementById("cv");
    if (cv && this._home) this._home.appendChild(cv);   // 必ず戻す
    this._home = null;
    el.hidden = true;
    document.body.classList.remove("mz-auto-stage");
    el.classList.remove("as-failed");
    this._fail = null; this._failedStep = null;
    try { if (this._prevFocus && this._prevFocus.focus) this._prevFocus.focus({ preventScroll: true }); }
    catch (e) {}
    this._prevFocus = null;
  },

  /* いま動いている段を伝える。済んだ段は自動でチェックが点く */
  step(key, sub) {
    const i = this.STEPS.findIndex(s => s.key === key);
    if (i < 0) return;
    for (let k = 0; k < i; k++) {
      const kk = this.STEPS[k].key;
      if (!this._done.includes(kk)) this._done.push(kk);
    }
    this._now = key;
    /* ★ 未指定なら**消す**(2026-08-01 レビュー14件)。前は前の値が残る実装だったため、
       「傾きを直す」で入れた "3本" が、そのあとの段にずっと居座っていた */
    this._sub = (sub === undefined ? null : sub);
    this._inner = 0;
    this.render();
  },
  /* 済んだ段に「実際に何ができたか」を残す。チェックが点くだけでは
     何が起きたのか分からない ─ ここが「できていってる！」のいちばん安い実装 */
  mark(key, text) { this._doneSub[key] = text || ""; this.render(); },
  /* いま動いている段の中での進み具合(0..1) */
  progress(fr) {
    const v = Math.max(0, Math.min(1, fr || 0));
    if (Math.abs(v - (this._inner || 0)) < 0.01) return;
    this._inner = v; this.render();
  },
  /* 中止を押されてから、実際に止まるまでの間の顔 */
  cancelling() {
    const c = MC.ui.$("#asCancel");
    if (c) { c.disabled = true; c.textContent = "やめています…"; }
    const head = MC.ui.$("#asHead"); if (head) head.textContent = "やめています…";
    const eta = MC.ui.$("#asEta");
    if (eta) eta.textContent = "いま動いている処理が止まるまで少し待ちます";
  },
  /* 失敗の顔。畳まずに、この画面のまま理由と次の一手を出す。
     畳んで裏へ逃がすと、エラーの描画先がこの全画面の下なので何も見えない */
  fail(err) {
    const el = MC.ui.$("#autoStage");
    if (!el || el.hidden) return;
    this._fail = err || new Error("うまくいきませんでした");
    const cur = this.STEPS.find(s => s.key === this._now);
    /* ★ 進行中の見た目をここで全部やめる(2026-08-01 レビュー)。
       これが無かったため、失敗した画面が
       ・見出しが「カメラを切り替える…」のまま(render が失敗時は head に触らない)
       ・失敗した段の青い点が脈打ち続ける(_now を消していない)
       ・「もう少しかかっています・経過8分」を数え続ける
       という、どう見ても「まだ動いています」の顔になっていた。
       しかも下に積まれた失敗の説明は画面の外(実測 375×635 で 21px、
       横向きでは 181px はみ出す)。v1.66.0 で潰した「失敗が見えない」が
       別の経路で戻っていた */
    this._failedStep = this._now;
    this._now = null;                       // 脈と「…」を同時に止める
    el.classList.add("as-failed");          // 用済みのものを畳む(CSS)
    const head = MC.ui.$("#asHead"); if (head) head.textContent = "うまくいきませんでした";
    const eta = MC.ui.$("#asEta"); if (eta) eta.textContent = "";
    const wt = el.querySelector(".as-wait"); if (wt) wt.hidden = true;
    const wk = MC.ui.$("#asWake"); if (wk) wk.hidden = true;
    const msg = MC.ui.$("#asFailMsg");
    if (msg) {
      msg.textContent = (cur ? `「${cur.label}」のところで止まりました。` : "")
        + (this._fail.message || "");
    }
    /* ★ 手がかりは失敗ごとに変える(2026-08-01 レビュー)。
       固定文だと、いちばん起きている失敗に間違った答えを出す ─
       実機の Decoder failure は「3本が重すぎた」なのに
       「動画が1本だけだと…」と書いてあった。正解に近いのに理由が違うので、
       次に何をすればいいのかが学べない */
    const hint = MC.ui.$("#asFailHint");
    if (hint) hint.textContent = MC.ui.failHint(this._fail.message || "");
    const box = MC.ui.$("#asFail"); if (box) box.hidden = false;
    /* 押す前から読める形にしておく。コピーが断られる端末でも長押しで拾える。
       ★ 中身はコピーされるものと同じ関数から作る ─ 前は画面がログ40行、
         コピーが版・端末・素材つき60行と、同じ「記録」で別物だった */
    try {
      const pre = MC.ui.$("#asFailLog");
      if (pre) pre.textContent = MC.ui.buildReport();
    } catch (e) {}
    const c = MC.ui.$("#asCancel"); if (c) c.hidden = true;
    this.render();
    try { el.scrollTop = 0; } catch (e) {}   // 失敗の顔を必ず視野へ
  },
  finishAll() { this._done = this.STEPS.map(s => s.key); this._now = null; this._sub = null; this.render(); },

  /* 進み具合(0..1)。重み付きなので、重い段の途中でもバーが進んで見える */
  ratio() {
    const total = this.STEPS.reduce((a, s) => a + s.w, 0);
    let got = 0;
    for (const s of this.STEPS) {
      if (this._done.includes(s.key)) got += s.w;
      /* ★ 段の中の実測を混ぜる(2026-08-01 レビュー14件)。前は固定の0.35だったため、
         いちばん重い段(w:30)に入ると 51% で固定され、数分間バーも%も
         1 も動かなかった ─ 止まっている＝固まった、と読まれる */
      else if (s.key === this._now) got += s.w * Math.max(0.12, this._inner || 0);
    }
    return Math.max(0, Math.min(1, got / total));
  },

  render() {
    const el = MC.ui.$("#autoStage");
    if (!el || el.hidden) return;
    const r = this.ratio();
    const fill = MC.ui.$("#asBarFill"); if (fill) fill.style.width = (r * 100).toFixed(0) + "%";
    /* 読み上げに「いま何%か」を伝える(2026-08-01 レビューP1)。
       role が無いと、ただの装飾された div でしかなかった */
    const bar = el.querySelector(".as-bar");
    if (bar) {
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(Math.round(r * 100)));
      bar.setAttribute("aria-label", "できあがりの進み具合");
    }
    const pct = MC.ui.$("#asPct"); if (pct) pct.textContent = Math.round(r * 100) + "%";
    const eta = MC.ui.$("#asEta");
    /* ★ 失敗したら数えるのをやめる。隣で「もう少しかかっています」が
       動き続けると、失敗しているのかまだ動いているのか判らない */
    if (eta && !this._fail) eta.textContent = MC.ui.autoSub ? MC.ui.autoSub() : "";
    const cur = this.STEPS.find(s => s.key === this._now);
    const head = MC.ui.$("#asHead");
    if (head && !this._fail) head.textContent = this._now ? cur.label + "…" : "できました";
    /* 段が変わったときだけ1行読み上げる。リスト全体に aria-live を張ると、
       0.5秒ごとの再描画で6項目を延々と読み直す(沈黙より悪い) */
    const say = MC.ui.$("#asSay");
    if (say) {
      const line = this._fail ? "うまくいきませんでした"
        : this._now ? cur.label : "できました";
      if (say.textContent !== line) say.textContent = line;
    }
    /* ★ 画面が消えると自走ごと落ちる(2026-08-01 実機)。
       低電力モードだと iPhone は消灯の抑止を断るので、こちらでは止められない。
       できるのは「直し方を伝えること」だけ。開始直後は取得中のことがあるので、
       少し様子を見てから出す(出したり消えたりさせない) */
    const wk = MC.ui.$("#asWake");
    if (wk && !this._fail) {
      /* ★ 判定材料を「取れていない」から「断られた」へ替える(2026-08-01 レビュー)。
         !awake で見ていたため、次の3つが同じ文言になっていた。
           ① 低電力モードで断られた ← 本来の対象
           ② そもそも仕組みが無い端末 ← 低電力モードの話をされて困る
           ③ 別アプリから戻った直後 ← OSが一度解放し、取り直しは非同期。
              0.5秒の再描画が先に回ると警告が一瞬生えて消える
         一度立てたら下ろさないのも要 ─ 消えたり出たりするほうが不安になる */
      const S2 = window.MZ_SESSION;
      const el2 = (performance.now() - (MC.ui._autoT0 || performance.now())) / 1000;
      if (el2 > 6 && S2) {
        if (S2.wakeDenied) this._wakeWarn = 1;
        else if (!("wakeLock" in navigator)) this._wakeWarn = 2;
      }
      /* 設定アプリの手順は iPhone のものなので、iPhone にだけ出す */
      const t = this._wakeWarn === 1
        ? (MC.isIOS
            ? "この端末では画面の消灯を止められませんでした。ときどき画面を触ってください（設定 → 画面表示と明るさ → 自動ロック を長めにしておくと確実です）"
            : "この端末では画面の消灯を止められませんでした。ときどき画面を触ってください")
        : this._wakeWarn === 2
        ? "画面が消えると止まります。ときどき画面を触ってください"
        : "";
      if (wk.textContent !== t) { wk.textContent = t; wk.hidden = !t; }
      /* 待ち方の説明を2つ同時に出さない */
      const wt2 = el.querySelector(".as-wait"); if (wt2) wt2.hidden = !!t;
    }
    const host = MC.ui.$("#asSteps");
    if (!host) return;
    /* ★ 0.5秒ごとに innerHTML を全置換するのをやめる(2026-08-01 レビュー14件)。
       毎回すべての <li> と <i> が新しいノードに差し替わっていたため、
       ・済んだ✓の asPop(.35s) が 5〜9分ずっと跳ね続ける
       ・now の asPulse(1.3s) が周期の38%までしか進まずワープする
       ・読み上げが6項目を0.5秒ごとに全文読み直す
       という、いちばん見ている場所がいちばん落ち着かない状態になっていた。
       骨は1度だけ作り、以後は**変わった属性だけ**書き換える。
       class を毎回代入しないのが要 ─ 同じ値でも代入するとアニメが再生される */
    if (host.children.length !== this.STEPS.length) {
      host.innerHTML = this.STEPS.map(s =>
        `<li class="as-step" data-k="${s.key}"><i></i>`
        + `<span class="as-step-t"></span><span class="as-step-sub"></span></li>`).join("");
    }
    this.STEPS.forEach((s, i) => {
      const li = host.children[i]; if (!li) return;
      const done = this._done.includes(s.key), now = s.key === this._now;
      const cls = "as-step" + ((s.key === this._failedStep) ? " failed"
        : done ? " done" : now ? " now" : "");
      if (li.className !== cls) li.className = cls;
      const bad = (s.key === this._failedStep);
      const ic = bad ? "fa-solid fa-xmark"
        : done ? "fa-solid fa-check" : now ? "fa-solid fa-circle" : "";
      const iEl = li.querySelector("i");
      if (iEl && iEl.className !== ic) iEl.className = ic;
      /* 済んだ段は「何ができたか」で言う */
      const t = done ? (s.done || s.label) : s.label;
      const tEl = li.querySelector(".as-step-t");
      if (tEl && tEl.textContent !== t) tEl.textContent = t;
      /* 済んだ段は成果(mark)、いまの段は補足(_sub) */
      const st = (done ? this._doneSub[s.key] : (now ? this._sub : null)) || "";
      const sEl = li.querySelector(".as-step-sub");
      if (sEl && sEl.textContent !== st) sEl.textContent = st;
    });
  },
};

/* 自走の残り時間の一言。経過ぶんを引いて出す。
   1分未満は「まもなく」— 秒まで出すと正確に見えすぎる */
MC.ui.autoSub = () => {
  const total = MC.ui._autoEtaSec || 0;
  if (!(total > 30)) return "";
  const el = (performance.now() - (MC.ui._autoT0 || performance.now())) / 1000;
  const left = total - el;
  /* ★ 見積りを超えたら「まもなく」を言い続けない(2026-08-01 レビュー14件)。
     iPhone の実測がまだ無い以上、見積りが外れるのは前提。外れたときに
     嘘を言い続けるより、経過を正直に出すほうが不安が小さい */
  if (left <= 0) return `もう少しかかっています・経過 ${Math.max(1, Math.round(el / 60))}分`;
  if (left <= 45) return "まもなく完成します";
  /* 「このままお待ちください」は画面下の固定文へ移した。ここに足すと
     320px 幅で2行に折り返して、数字が読みにくくなる(実測 27px→46px) */
  return `あと およそ${Math.max(1, Math.round(left / 60))}分`;
};

/* 中止は「失敗」ではない。失敗の顔(理由と次の一手)を出すべきではないので、
   例外の型で分ける。message は使わないが name で判別する */
MC.ui.AutoCancelled = class extends Error {
  constructor() { super("やめました"); this.name = "AutoCancelled"; }
};

MC.ui.runAuto = async () => {
  if (MC.ui._busy || (MC.exporter && MC.exporter.running)) return;
  if (!MC.media.slotClips().length) return;
  let tick = null;
  try {
    /* ★ _autoRunning は try の**中**で立てる(2026-08-01 レビュー14件)。外で立てると、
       ここから autoStage.open() までのどれかが投げたとき finally に入らず、
       鍵が永久に返らない。setBusy(false) は _autoRunning が立っている間ずっと
       握り潰される(setBusy の先頭)ので、画面のボタンが二度と有効にならず、
       リロード以外に復帰手段が無くなる */
    MC.ui._autoCancel = false;
    MC.ui._autoRunning = true;      // 段の切れ目で鍵が外れないようにする
    MC.ui._autoT0 = performance.now();
    MC.ui._autoEtaSec = MC.ui.autoEtaSec();   // 総所要は入口で1回だけ見積もる
    MC.ui.applyAutoChoices();
    MC.ui.setBusy(true);
    MC.ui.autoStage.open();          // ここから先はおまかせ専用の1画面だけ
    tick = setInterval(() => MC.ui.autoStage.render(), 500);   // 残り時間を減らす
    /* ① 傾き(自動) → ② 同期 → ③ 音声(おすすめ) → ④ 音楽の解析 */
    await MC.ui.runEasy({ auto: true });
    /* ★ `!MC.S.showIn == null` は `(boolean) == null` で**常に false**、
       しかも本体が空だった。この製品で一度事故った型そのもの(消した工程名が
       条件に残り `数値 < undefined` が常に false になった件)なので撤去する */
    if (MC.ui._autoCancel) throw new MC.ui.AutoCancelled();
    MC.ui.autoStage.mark("scan",
      (MC.S.showIn != null && MC.S.showOut != null)
        ? `演奏している ${Math.max(1, Math.round((MC.S.showOut - MC.S.showIn) / 60))}分を見つけました` : "");
    /* runEasy が音声で止まる分岐は auto では通らない(先に決めてあるため)。
       ここまで来て showIn が無い= 解析に失敗している。
       ★ 黙って return してはいけない(2026-08-01 レビュー14件)。finally が全画面を畳むので、
         7分待った人の画面が理由も出ないまま消えるだけになる */
    if (MC.S.showIn == null || MC.S.showOut == null)
      throw new Error("演奏している場所を見つけられませんでした");
    /* 映像解析は <video> をシークで専有する(visual/color も同じ)。
       ここから先はプレビューを止める ─ 取り合うと絵も解析も乱れる */
    MC.preview.pause();
    MC.ui.autoStage.step("finish");
    /* ⑤ 長さと開始位置を決め打ちで確定 → ⑥ 映像解析とカット割 → ⑦ 書き出し
       ★ ここで当て直すのが要。applyLengthChoice は
         `cands.find(key===startKey) || cands[0]` で決めたうえ、
         **選んだ結果を MC.S.startKey へ書き戻す**。解析が終わる前に一度でも
         走ると、そのとき候補は「スタート」しか無いので startKey が
         "start" に固定され、あとから盛り上がりが見つかっても戻らない
         (実測: 候補に climax があるのに start が選ばれていた) */
    MC.ui.applyAutoChoices();
    MC.ui.applyLengthChoice();
    MC.S.lengthDecided = true;
    MC.saveState();
    MC.ui.refreshJourney();
    await MC.ui.runEasyFinish();
    if (MC.ui._autoCancel) throw new MC.ui.AutoCancelled();
    if (!MC.S.easyDone) throw new Error("カメラの切り替えを決められませんでした");
    MC.ui.autoStage.mark("finish",
      `カットを ${((MC.S.cutList || []).length) || 0} 個 作りました`);
    MC.ui.refreshJourney();
    /* ★ 6段目のチェックを点け、「できました」を一拍だけ見せてから畳む
       (2026-08-01 レビュー14件)。ここが無いと finishAll() が一度も呼ばれず、
       5〜9分かけた仕事の**完成の瞬間が画面に存在しない** */
    MC.ui.autoStage.step("export");
    MC.ui.autoStage.finishAll();
    await new Promise(r => setTimeout(r, 700));
    /* 書き出しは専用の全画面(#exportOverlay)が受け持つ。
       そちらが出るので、おまかせの画面はここで畳む ─ 2枚重ねない */
    MC.ui.autoStage.close();
    /* ★ 鍵を**先に**返す(2026-08-01 レビュー14件)。#exportBtn のハンドラは1行目で
       `if (MC.ui._busy) return;` を通る。setBusy(false) は _autoRunning が
       立っている間ずっと握り潰されるため、ここで返さないと click が即 return し、
       書き出しが1バイトも始まらないまま全画面が畳まれていた
       ─ 自走がいちばん最後に無言で死ぬ経路。本番 v1.64.0 にも入っている */
    MC.ui._autoRunning = false;
    MC.ui.setBusy(false);
    const btn = MC.ui.$("#exportBtn");
    if (!btn || btn.disabled) throw new Error("書き出しを始められませんでした");
    btn.click();
  } catch (e) {
    if (e && e.name === "AutoCancelled") {
      MC.ui.autoStage.close();
      MC.ui.toast("やめました。こだわりで続けられます");
      MC.ui.setSetupTab("pro");
      MC.ui._tabsForced = true;
      MC.ui.refreshSetupTabs();
    } else {
      console.error(e);
      MC.ui.showErrorLog(e);
      /* ★ 失敗しても全画面は畳まない(2026-08-01 レビュー14件)。
         #easyStatus も #errorLog も、この全画面(z-index 130)の**下**にある。
         畳んで裏へ逃がすと「画面がふっと消えた」だけになり、
         実機で何が起きたのかを本人が誰にも伝えられない */
      MC.ui.autoStage.fail(e);
      MC.ui.setSetupTab("pro");
      MC.ui._tabsForced = true;
      MC.ui.refreshSetupTabs();
    }
  } finally {
    if (tick) clearInterval(tick);
    /* 失敗の顔を出しているときだけは畳まない。それ以外は必ず畳む(canvasを戻す) */
    if (!MC.ui.autoStage._fail) MC.ui.autoStage.close();
    MC.ui._autoRunning = false;   // 成功経路では上で返済済み(二重でも無害)
    MC.ui.setBusy(false);
    MC.ui.renderAll();
    MC.ui.refreshJourney();
  }
};

MC.ui.runEasy = async (opt) => {
  const auto = !!(opt && opt.auto);
  const btn = MC.ui.$("#easyStartBtn");
  /* 自走のときはボタンの状態を見ない ─ 取り込み直後は disabled のことがある。
     ★ _busy も見ない。runAuto は段の切れ目で鍵が外れないよう**先に**
       setBusy(true) してから呼ぶので、ここで _busy を見ると自分が掛けた鍵で
       自分が弾かれる(実測: runEasy に入って即 return し、1段も走らなかった)。
       二重起動の防止は runAuto の入口が受け持つ */
  if (auto ? MC.ui._autoCancel : (btn.disabled || MC.ui._busy)) return;
  MC.ui._anaT0 = performance.now();   // 見積り学習は同期込みの全体で測る(2026-07-28)
  MC.ui.setBusy(true);
  MC.ui.clearErrorLog();   // やり直しでは前回の失敗ログを見せない
  MC.preview.pause();
  const vids = MC.S.clips.filter(c => !c.isImage);
  /* 「全何段の何段目か」を出す。5〜9分の待ちで文言だけが入れ替わると、
     あと何が残っているのか分からず体感が倍になる(2026-07-26)。
     分母は下の分岐と同じ条件で数えること ─ ずれると「4/3」になる */
  const syncSteps = vids.length >= 2 ? 1 : 0;
  /* おまかせは傾きを自動で当てる段が1つ増える(2026-08-01)。
     ★ 数え忘れると「3/2」になる。分母は下の分岐と必ず揃えること */
  const tiltSteps = auto ? 1 : 0;
  /* 音声選択で一度止まるか。おまかせは止まらない(先に自動で決める)ので、
     解析の段まで必ず走る ─ ここを auto で見ないと分母が足りなくなる */
  const goesOn = auto || !(vids.length >= 2 && !MC.S.audioDecided);
  /* この段で走るのは同期と**音楽の解析**まで(2026-07-31)。
     重い映像解析は「長さと開始位置」を決めたあと、選ばれた範囲だけを見る */
  const p = MZP.start({ mount: "#easyStatus",
                        chapter: auto ? "おまかせ" : "同期", delay: 0,
                        steps: tiltSteps + syncSteps + (goesOn ? MC.ui.scanSteps() : 0),
                        label: auto ? "傾きを直しています…" : "音を合わせています…" });
  /* おまかせは書き出しまで一度も止まらない。あと何分かを出さないと
     「進んでいるのか固まったのか」が分からない(2026-08-01)。

     ★ MZP の eta は `state === "run"`(確定進捗)のときしか描かれない
       (progress.js の _etaVisible)。自走は pulse なので eta では出せず、
       副文言(sub)に載せる。sub は状態を問わず描かれる */
  if (auto) MC.ui._autoT0 = performance.now();
  try {
    if (auto) {
      /* 傾きは同期より先に当てる。同期は音だけを見るので順序はどちらでもよいが、
         先に映像を触っておくと、あとの映像解析でデコーダが温まっている */
      p.step(1, "傾きを直しています…").pulse("傾きを直しています…", { sub: MC.ui.autoSub() });
      MC.ui.autoStage.step("tilt", `${vids.length}本`);
      await MZP.paint();
      const fixed = await MC.ui.autoHorizon(p);
      MC.log("auto: 傾きを直した本数=" + fixed);
      MC.ui.renderClips();
      MC.ui.autoStage.mark("tilt", fixed ? `${fixed}本の傾きを直しました` : "傾きは大丈夫でした");
      /* ★ ここでプレビューを実際に流す(2026-08-01 レビュー14件)。autoStage.open() の
         play() は、この直後に走る runEasy 先頭の pause() が**同期的に**
         打ち消していた(最初の await より前)ので、主役のプレビューは
         一度も動いていなかった。
         傾き検出(horizon.suggest)は <video> をシークで専有するため、
         流すのはそれが済んだこの位置から。同期・音の読み込み・音楽の解析は
         音しか見ないので取り合いにならない。いちばん長く無言になるのが
         この区間で、絵が止まっていると「固まった」としか見えない */
      MC.ui.autoPreviewPlay();
    }
    if (vids.length >= 2) {
      p.step(tiltSteps + 1, "音を合わせています…")
        .pulse("音を合わせています…", auto ? { sub: MC.ui.autoSub() } : undefined);
      if (auto) MC.ui.autoStage.step("sync");
      await MC.sync.run(p);
      {
        const off = Math.max(0, ...vids.map(c => Math.abs(c.offset || 0)));
        if (auto) MC.ui.autoStage.mark("sync", `ズレ ${off.toFixed(2)}秒 を合わせました`);
      }
      /* 同期に成功したら、失敗時に前倒しで開いたタブを本来の条件へ戻す
         (立てっぱなしだと以後ずっと序盤からタブが出る) */
      MC.ui._tabsForced = false;
    }
    if (auto) {
      /* おまかせは止まらない。音声はここで自動採用する ─
         同期のあとなら stats が揃っていて recommend が使える */
      MC.ui.autoStage.step("audio");
      const pick = MC.ui.autoPickAudio();
      MC.log("auto: 音声=" + (pick ? pick.name : "(なし)"));
      /* 音を整えたことは、新しい行を足さずに既にある成果の枠で言う。
         ★ 測れているときだけ言う ─ していないことを言わない */
      MC.ui.autoStage.mark("audio", pick
        ? (MZP.shortName(pick.name) + ((pick.stats && pick.stats.peak > 0) ? "・音も整えます" : ""))
        : "");
      MC.ui.autoStage.step("scan");
    }
    if (vids.length >= 2 && !MC.S.audioDecided) {
      /* ここで一度手を止める: 音声を選んでから仕上げへ */
      p.done("同期できました", { sub: "使う音声を選んで「この音で進める」を押してください" });
      MC.ui.renderAll();
      MC.ui.gentleScrollTo(document.querySelector("#audioSec"), "start");
      return;
    }
    await MC.ui.runEasyScan(p, tiltSteps + syncSteps);   // 続きの段番号から
  } catch (e) {
    console.error(e);
    p.fail("処理に失敗しました", { detail: e.message });
    MC.ui.showErrorLog(e);
    /* 同期に失敗したら「こだわり」を開放する。タブは通常 polish まで出ないが、
       手動同期(#syncBtn)が唯一の復旧手段なので、失敗時だけ前倒しで出す */
    MC.ui._tabsForced = true;
    MC.ui.refreshSetupTabs();
    if (MC.ui._autoRunning) throw e;   // ★ 自走中は上へ返す(理由を全画面に出すため)
  } finally {
    MC.ui.setBusy(false);
    MC.ui.renderAll();   // 途中で止まってもタイムライン等の表示を状態に合わせ直す
  }
};

/* おまかせ 第2段: 「この音で進める」後の仕上げ。
   トリム→(③自動スイッチングのみ)カット割→色そろえ。
   ①縦動画/②ワイプカメラはシーン分析を丸ごと飛ばす(2026-07-24 優さん指示) */
/* ---- おまかせ 第2段: 音楽の解析(2026-07-31 優さん指示) ----
   ここでやるのは音だけ ─ 演奏そのものの範囲を見つけ、拍とセクションを取る。
   映像は1コマも見ない(数秒で終わる)。終わったら「長さと開始位置」で止まる。

   この段を切り出した理由は速度でもある。8分の素材から1分を書き出すなら、
   映像解析も1分ぶんで足りる ─ 先に範囲を決めておけば、いちばん重い工程が
   そのぶん短くなる(director.run は MC.trimRange() の中だけを見る)。
   分母は常に2で固定(条件分岐で数えないので「4/3」がそもそも起きない) */
MC.ui.scanSteps = () => 2;

MC.ui.runEasyScan = async (pIn, base = 0) => {
  /* ★ 自走中は _busy を見ない(2026-08-01 レビュー14件)。runAuto は段の切れ目で鍵が
     外れないよう先に setBusy(true) してから呼ぶので、ここで _busy を見ると
     自分が掛けた鍵で自分が弾かれる。二重起動の防止は runAuto の入口が受け持つ
     (runEasy には既に同じ断りがある。こちらだけ抜けていた) */
  if (!pIn && MC.ui._busy && !MC.ui._autoRunning) return;
  if (!pIn) { MC.ui.setBusy(true); MC.ui.clearErrorLog(); MC.preview.pause(); }
  const p = pIn || MZP.start({ mount: "#easyStatus", chapter: "音楽の解析", delay: 0,
                               steps: MC.ui.scanSteps(), label: "音楽を解析しています…" });
  let n = base;
  try {
    // ① 演奏そのものの範囲を音で見つける(アナウンス・拍手・片付けを落とす)
    p.step(++n, "演奏の始まりと終わりを調べています…").pulse("演奏の始まりと終わりを調べています…");
    await MZP.paint();
    const dur = MC.timelineDuration();
    let s = null;
    /* 音声の読み込みは全尺ぶん。ここが長尺でいちばん長く無言になるので、
       %を画面へ流す(2026-08-01)。おまかせ専用画面にも同じ数字を出す */
    const onProg = fr => {
      const pctTxt = `音を読み込み中 ${Math.round(Math.max(0, Math.min(1, fr)) * 100)}%`;
      p.pulse("演奏の始まりと終わりを調べています…", { sub: pctTxt });
      /* 段の中の進み具合にも流す(2026-08-01 レビュー14件)。段単位でしか進まないと、
         いちばん長い段でバーも%も数分間 1 も動かず「固まった」と読まれる */
      if (MC.ui.autoStage) {
        MC.ui.autoStage._sub = pctTxt;
        MC.ui.autoStage._inner = Math.max(0, Math.min(0.8, (fr || 0) * 0.8));
        MC.ui.autoStage.render();
      }
    };
    try { s = await MC.salute.detect(onProg); }
    catch (e) { MC.log("scan: 演奏区間を検出できず →", e.message); }
    /* director のオープニング判定(サリュート)もここで確定させる。
       モジュール変数へ入れっぱなしにすると、音声や同期を選び直しても
       前回の値が残る(2026-07-31 に気づいた既存のキャッシュ漏れ) */
    MC.director._salute = s;
    const preEl = document.getElementById("preRoll");
    const pre = (preEl && parseFloat(preEl.value)) || 8;
    MC.S.showIn = s ? Math.max(0, s.musicStart - pre) : 0;
    MC.S.showOut = (s && s.musicEnd != null)
      ? Math.min(dur, s.musicEnd + MC.salute.OUT_AFTER) : dur;

    // ② 拍とセクション(見どころ候補の材料)
    p.step(++n, "音楽を解析しています…").pulse("音楽を解析しています…");
    await MZP.paint();
    const audioClip = MC.getClip(MC.S.audioClipId);
    if (audioClip) {
      await MC.audio.extract8k(audioClip);
      if (!audioClip.beatsData) audioClip.beatsData = MC.beats.analyze(audioClip.audio8k);
      await MC.sections.analyze(audioClip);
    }
    /* 音声で使わないクリップの 8kHz バッファを返す(2026-07-31 5巡目P1)。
       audio8k は 32KB/秒 ─ 入口を20分に開いたので、窓ラダーが「全体」まで
       落ちた最悪ケースでは3本で約115MBを**誰も解放せず**保持し続けていた。
       必要になれば extract8k が読み直す(キャッシュ判定が既にその設計) */
    MC.S.clips.forEach(c => {
      if (c.id !== MC.S.audioClipId && c.audio8k) {
        c.audio8k = null;
        c.audio8kReqStart = 0;
        c.audio8kReqSpan = 0;
      }
    });
    /* 長さは選び直してもらう。ここで applyLengthChoice を呼ぶのは、
       画面を出す前に trimIn/trimOut を既定値で埋めておくため
       (プレビューが「範囲なし」の状態で一瞬映るのを防ぐ) */
    MC.S.lengthDecided = false;
    MC.ui.applyLengthChoice();
    p.done("音楽の解析が終わりました",
           { sub: "長さと、どこから始めるかを選んでください" });
    MC.ui.renderAll();
    MC.preview.seek(MC.S.trimIn);
  } catch (e) {
    console.error(e);
    p.fail("処理に失敗しました", { detail: e.message });
    MC.ui.showErrorLog(e);
    /* ★ 自走中は握り潰さない(2026-08-01 レビュー14件)。ここで飲み込むと runAuto の catch へ
       永久に届かない。しかも p.fail の描画先(#easyStatus)も showErrorLog の
       描画先(#errorLog)も、おまかせ全画面(z-index 130)の**下**にあるので、
       利用者には何ひとつ見えないまま画面だけが消えていた */
    if (MC.ui._autoRunning) throw e;
  } finally {
    if (!pIn) { MC.ui.setBusy(false); MC.ui.renderAll(); }
  }
};

/* この実行で実際に通る段の数。進捗の分母に使うので、runEasyFinish 本体の
   分岐と同じ条件で数えること(ずれると「4/3」や「2/5で完了」になる)。
   「最初と最後を探す」は runEasyScan へ移した(2026-07-31)ので、ここには無い */
MC.ui.finishSteps = () => {
  /* 色そろえは2本以上でしか走らない(colormatch.js:117 が throw する)。
     colorOn だけで数えると、動画1本のとき分母が1多く、しかも必ず
     「色そろえだけできませんでした。」が出る ─ 成功しているのに失敗を見せる */
  const vclips = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  /* director.run(director.js:37) は動画2本未満で throw する。本数を見ずに3を
     返していたため、動画1本+自動スイッチングでは「全3段」と名乗った直後に
     1段も進まず必ず失敗を見せていた(色そろえ側は最初からこの条件つき) */
  return ((MC.S.mode === "switch" && vclips.length >= 2) ? 3 : 0)   // director の3段
    + ((MC.S.colorOn && vclips.length >= 2) ? 1 : 0);            // 色をそろえる
};

MC.ui.runEasyFinish = async (pIn, base = 0) => {
  /* ★ ここが、おまかせがいちばん手前で黙って死んでいた場所(2026-08-01 レビュー14件)。
     runAuto は `await MC.ui.runEasyFinish();` と**引数なし**で呼ぶので pIn は
     undefined。_busy は自走中ずっと true なので、この行で即 return していた。
     結果、カット割も色そろえも1行も走らず、easyDone が false のまま
     呼び出し元が黙って return して全画面が消える ─ 本番 v1.64.0 も同じ */
  if (!pIn && MC.ui._busy && !MC.ui._autoRunning) return;
  const t0 = performance.now();   // 次回の見積りを実測へ寄せるため
  if (!pIn) { MC.ui.setBusy(true); MC.ui.clearErrorLog(); MC.preview.pause(); }
  const p = pIn || MZP.start({ mount: "#easyStatus", chapter: "仕上げ", delay: 0,
                               steps: MC.ui.finishSteps(),
                               label: "仕上げています…" });
  let n = base;   // ここまでに済んだ段数
  /* 残り時間の粗い見積り(開始前の #totalEtaHint と同じ式)。段の境目で
     eta を更新する ─ 書き出し側は3秒後から残り時間が出るのに、
     分析側は最後まで一度も出ていなかった(2026-07-28 レビューP0-3) */
  const _vc = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  /* 見積りの分母は**書き出す範囲**にする(2026-07-31)。映像解析は
     MC.trimRange() の中しか見ないので、素材全体で見積もると
     1分を選んだ人に8分ぶんの待ち時間を予告してしまう */
  const [_ti, _to] = MC.trimRange();
  const _est = _vc.length * Math.max(0, _to - _ti) * MC.ui.analysisRate();
  const _steps = Math.max(1, p.steps || MC.ui.finishSteps());
  const _eta = () => _est > 30 ? { eta: Math.max(0, _est * (1 - n / _steps)) } : undefined;
  try {
    /* 開始/終了の自動区切りと音楽の解析は runEasyScan へ移した(2026-07-31)。
       ここへ来る時点で MC.trimRange() は「選ばれた長さと開始位置」を指しており、
       映像解析もカット割もその中だけを見る */
    // 条件は finishSteps() と必ず揃える(分母と実際に通る段がずれる)
    if (MC.S.mode === "switch" && _vc.length >= 2) {   // シーン分析は③自動スイッチングだけ
      await MC.director.run(p, n);   // 中で3段ぶん進む(音楽/映像/カット割)
      n += 3;
      MC.timeline.render();
    }
    let colorFailed = false;
    /* 条件は finishSteps() と必ず揃える(分母と実際に通る段がずれる) */
    if (MC.S.colorOn && MC.S.clips.filter(c => !c.isAudio && !c.isImage).length >= 2) {
      p.step(++n, "色を合わせています…").pulse(null, _eta());
      await MC.color.run(p).catch(() => { colorFailed = true; });
    }
    MC.ui.renderAll();
    const [ti, to] = MC.trimRange();
    MC.preview.seek(ti);
    const trimmed = MC.S.trimIn > 0 || MC.S.trimOut != null;
    /* ドックは「結果の詳細(範囲・色)」に徹する。「終わった」の気づきは下の
       バナー(notifyAnalysisDone)に一本化し、同じ文言を2箇所に出さない(G-4) */
    p.done("分析が終わりました", {
      sub: (colorFailed ? "色合わせだけできませんでした。" : "")
        + (trimmed ? `書き出し範囲 ${MC.ui.fmtTime(ti)}〜${MC.ui.fmtTime(to)} を自動設定。` : "")
        + "プレビューを見て、よければ書き出してください",
    });
    /* 傾きの自動検出は全廃(2026-07-28)。傾きは tilt フェーズで本人が確認済み。
       horizonOn は true 固定(rot=0 なら無効果。手動値の適用だけが残る) */
    /* 分析が終わったことを目立たせて知らせる(2026-07-23 優さん指示)。
       スマホは分析中に別アプリへ切り替えていることが多いので、
       戻ってきたとき/戻る前どちらでも気づけるように出す */
    MC.ui.notifyAnalysisDone({ silent: !!MC.ui._autoRunning });
    /* ここからの主役は書き出し。おまかせボタン自体を「動画を書き出す」に
       化けさせ、次にすることを迷わせない(2026-07-21 優さん指示) */
    MC.S.easyDone = true;
    /* 実際にかかった時間を覚えて、次からの見積りを自分の端末に合わせる
       (2段化後は仕上げ段の実測。同期段はsync側で速くなっている) */
    const [eIn, eOut] = MC.trimRange();
    /* 学習は「分析を開始」からの全体実測で。仕上げ段だけを測って全体の
       予告(素材の分析におよそ◯分)に使うと、使うほど乖離する(2026-07-28) */
    MC.ui.learnAnalysisRate(
      (performance.now() - (MC.ui._anaT0 || t0)) / 1000,
      MC.S.clips.filter(c => !c.isAudio && !c.isImage).length,
      Math.max(0, eOut - eIn));
    /* 長すぎて書き出せない場合は、ここで知らせる。
       書き出しボタンを押すまで黙っていると「15分待って書き出せません」に
       なる(2026-07-21 実機で発生) */
    MC.ui.checkExportable();
  } catch (e) {
    console.error(e);
    p.fail("処理に失敗しました", { detail: e.message });
    MC.ui.showErrorLog(e);
    /* ★ 自走中は握り潰さない(2026-08-01 レビュー14件)。ここで飲み込むと runAuto の catch へ
       永久に届かない。しかも p.fail の描画先(#easyStatus)も showErrorLog の
       描画先(#errorLog)も、おまかせ全画面(z-index 130)の**下**にあるので、
       利用者には何ひとつ見えないまま画面だけが消えていた */
    if (MC.ui._autoRunning) throw e;
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
    /* 分割から降りた回は、たとえ書き出しが成功していてもここに残す */
    ...(MC.exporter.lastPartsError
        ? [`分割書き出しを断念: ${MC.exporter.lastPartsError}`] : []),
    `エラー: ${(err && err.stack) || (err && err.message) || err}`,
  ].join("\n");
  const text = `${env}\n---- ログ ----\n${MC.debug.slice(-120).join("\n")}`;
  host.hidden = false;
  host.innerHTML = `
    <details open>
      <summary><i class="fa-solid fa-triangle-exclamation"></i> 詳しいログ（不具合の報告に使います。コピーしてお送りください）</summary>
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
/* 「ここを聴く」の再生/停止表示だけを合わせる。
   ★ ここで renderLengthSec() を呼んではいけない ─ スライダーのドラッグ中も
     updateTransport は走るので、枠ごと作り直すと指が離れる。
     アイコンとラベルだけ差し替える(2026-07-31 レビュー: 範囲の末尾まで
     再生し切ると⏸のまま固まる、を直すため) */
MC.ui.syncLenPlayBtns = () => {
  const host = document.getElementById("lenStarts");
  if (!host || !host.children.length) return;
  host.querySelectorAll(".len-start").forEach(row => {
    const btn = row.querySelector(".len-listen");
    if (!btn) return;
    const on = MC.S.playing && row.classList.contains("on");
    if (btn.classList.contains("playing") === on) return;
    btn.classList.toggle("playing", on);
    btn.title = on ? "止める" : "ここから試聴";
    btn.setAttribute("aria-label", on ? "止める" : "ここから試聴");
    btn.innerHTML = `<i class="fa-solid ${on ? "fa-pause" : "fa-play"}" aria-hidden="true"></i>`;
  });
};

MC.ui.updateTransport = () => {
  MC.ui.syncLenPlayBtns();
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
  /* 中の段も畳んでおく(2026-08-01)。親が hidden なので見えはしないが、
     開いたまま残すと次に showModeSelect で戻ったとき2段目から始まる ─
     「種類を選び直す」つもりで戻ったのに進め方の画面が出ることになる */
  MC.ui.showModeStep("kind");
  MC.ui.$("#workspace").hidden = false;
  /* 工程に入ったらサイト共通の外枠を下げる(1画面1操作。2026-07-28 優さん指示)。
     実測で最初の工程に押せるものが40個あり、24個がツールと無関係なサイトナビだった */
  document.body.classList.add("mz-focus");
  const lbl = MC.ui.$("#modeLabel");
  if (lbl) lbl.textContent = m.label;
  MC.preview.applyPreset();
  MC.ui.renderAll();
};

/* 選択画面の段の出し分け(2026-08-01)。
   1段目=何を作るか(種類) → 2段目=どう進めるか(おまかせ/こだわり)。
   何を作るかが決まらないと、おまかせが何をおまかせされるのかも決まらない */
MC.ui.showModeStep = step => {
  const kind = MC.ui.$("#modeStepKind"), flow = MC.ui.$("#modeStepFlow");
  if (!kind || !flow) return;
  kind.hidden = step !== "kind";
  flow.hidden = step !== "flow";
  if (step === "flow") {
    const lead = MC.ui.$("#flowLead");
    const m = MC.ui.MODES[MC.ui._pendingMode] || MC.ui.modeConf();
    if (lead) lead.textContent = `${m.label}を作ります`;
  }
};

MC.ui.showModeSelect = () => {
  MC.preview.pause();  // 選択画面の裏で音が鳴り続けないように
  MC.ui.$("#workspace").hidden = true;
  MC.ui.$("#modeSelect").hidden = false;
  MC.ui.showModeStep("kind");   // 戻ったら必ず1段目から
  document.body.classList.remove("mz-focus");   // 工程を抜けたらサイトの外枠を戻す
};

/* --- イベント配線 --- */
MC.ui.wire = () => {
  const $ = MC.ui.$;

  /* 種類カード。**ここでは作業画面へ進まない**(2026-08-01)。
     選んだ種類を覚えて、2段目の「どちらで作りますか」へ送る */
  document.querySelectorAll("#modeSelect .mode-card[data-mode]").forEach(card =>
    card.onclick = () => {
      MC.ui._pendingMode = card.dataset.mode;
      MC.ui.showModeStep("flow");
    });
  { const b = MC.ui.$("#flowBackBtn");
    if (b) b.onclick = () => MC.ui.showModeStep("kind"); }
  /* おまかせ全画面の中止。走っている処理にも止まれと伝える */
  { const c = MC.ui.$("#asCancel");
    if (c) c.onclick = () => {
      /* ★ 確認を挟む(2026-08-01 レビュー14件)。7分待った直後の1タップで全部消えるのは重すぎる */
      if (!window.confirm("やめますか？\nここまでの解析結果は残ります。")) return;
      MC.ui._autoCancel = true;
      if (MC.exporter) MC.exporter.cancelFlag = true;
      if (MC.sync && MC.sync.cancel) MC.sync.cancel();
      /* ★ 押しても即座には畳まない(2026-08-01 レビュー14件)。畳んでも解析は動き続けるうえ、
         _autoRunning が立っている間は setBusy(false) が握り潰されるので、
         裏の画面はボタンが全部無効のまま数分固まって見えていた
         (「やめたのに何も押せない・端末が熱い」がいちばん信用を失う)。
         実際に止まるまで、この画面で「やめています…」と言って待つ */
      MC.ui.autoStage.cancelling();
    }; }
  /* 失敗の顔の2つのボタン。もう一度おまかせ / 自分で仕上げる */
  { const r = MC.ui.$("#asRetry");
    if (r) r.onclick = () => { MC.ui.autoStage.close(); MC.ui.runAuto(); }; }
  { const cp = MC.ui.$("#asCopy");
    if (cp) cp.onclick = () => MC.ui.copyReport(); }
  { const m = MC.ui.$("#asManual");
    if (m) m.onclick = () => {
      MC.ui.autoStage.close();
      MC.ui.setSetupTab("pro");
      MC.ui._tabsForced = true;
      MC.ui.refreshSetupTabs();
    }; }
  document.querySelectorAll("#setupTabs .tab").forEach(b =>
    b.onclick = () => MC.ui.setSetupTab(b.dataset.tab));
  $("#easyStartBtn").onclick = () => {
    if (MC.S.easyDone) { $("#exportBtn").click(); return; }
    MC.ui.runEasy();
  };
  $("#modeBackBtn").onclick = () => MC.ui.showModeSelect();
  /* 最初の2択(2026-08-01)。おまかせは、動画を入れた時点で自走が始まる */
  document.querySelectorAll("#modeSelect .mode-card[data-flow]").forEach(card => {
    card.onclick = () => {
      const flow = card.dataset.flow;
      MC.ui._autoFlow = flow === "easy";
      /* 1段目で選んだ種類をここで確定する。種類が未選択のまま
         2段目へ来ることは無いが、保険で switch に落とす */
      MC.ui.chooseMode(MC.ui._pendingMode || MC.S.mode || "switch");
      MC.ui.setSetupTab(flow === "easy" ? "easy" : "pro");
      if (flow === "pro") MC.ui._tabsForced = true;   // こだわりを選んだ人にはタブを出す
      MC.ui.refreshSetupTabs();
      MC.ui.refreshJourney();
      /* すでに素材が入っている(前回の続き)なら、その場で走り出す */
      if (MC.ui._autoFlow && MC.media.slotClips().length) MC.ui.runAuto();
    };
  });

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
  {
    const ns = $("#noSkipToggle");
    if (ns) {
      ns.checked = !isFinite(MC.exporter.SKIP_MIN);
      ns.onchange = e => {
        MC.exporter.setNoSkip(e.target.checked);
        MC.ui.toast(e.target.checked
          ? "ゆっくり書き出します（時間はかかります）"
          : "通常の速さに戻しました");
      };
    }
  }
  /* 「最初からやり直す」は全工程に常駐する破壊操作。置き場所では守れないので
     確認で守る。既存の onclick より先に捕まえて止める
     (2026-07-28に入れたと報告したが未適用だった。2026-07-30 再適用) */
  {
    const pr = $("#projectResetBtn");
    if (pr) pr.addEventListener("click", ev => {
      if (pr.dataset.mzConfirmed === "1") { delete pr.dataset.mzConfirmed; return; }
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (!window.confirm("いま選んでいる動画を外して、保存した内容も消します。\n\n"
        + "（撮った動画そのものは消えません）\n\nよろしいですか？")) return;
      pr.dataset.mzConfirmed = "1";
      pr.click();
    }, true);
  }
  MC.ui.wireTiltSec();
  MC.ui.wireSectionBand();
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
    // 画面から無効にしてあっても、行動バーの act などが click() を代行しうる
    if ($("#audioDecideBtn").disabled) return;
    MC.preview.pause();
    MC.S.audioDecided = true;
    if (MC.ui._setupTab === "pro") {
      /* こだわりタブは自走させない(同期→カット割→色を自分の手順で進める人) */
      MC.ui.refreshJourney();
      MC.ui.toast("この音で進めます");
      return;
    }
    /* 音楽の解析まで走らせて「長さと開始位置」で止まる(2026-07-31)。
       以前はここから仕上げ(映像解析+カット割)まで一気に走っていた */
    if (!MC.S.easyDone) MC.ui.runEasyScan();
    else MC.ui.refreshJourney();   // 仕上げ済みで選び直しただけなら状態更新のみ
  };

  /* 「この長さで進める」= ここではじめて重い映像解析へ入る。
     押した時点の trimIn/trimOut(=選ばれた長さと開始位置)だけを見る */
  $("#lenDecideBtn").onclick = () => {
    if (MC.ui._busy) return;
    MC.preview.pause();
    MC.ui.applyLengthChoice();     // 画面の選択を範囲へ確定させてから走る
    MC.S.lengthDecided = true;
    MC.saveState();
    if (MC.ui._setupTab === "pro") {
      /* こだわりタブは自走させない(同期→カット割→色を自分の手順で進める人) */
      MC.ui.refreshJourney();
      MC.ui.toast("この長さで進めます");
      return;
    }
    MC.ui.runEasyFinish();
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
      MC.ui._tabsForced = false;   // 同期に成功したら失敗時の前倒し開放を解除(2026-07-31)
      // カラー自動マッチ(初期ON)。失敗しても同期は成功扱い
      const vclips = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
      if (MC.S.colorOn && vclips.length >= 2 && !vclips.some(c => c.colorT)) {
        p.step(3, "色を合わせています…");
        try { await MC.color.run(p); MC.ui.renderFinish(); }
        catch (e) { MC.log("自動カラーマッチ失敗:", e.message); }
      }
      // 最初と最後の自動カット(初期ON)。ユーザーがトリム済みなら触らない
      if (MC.S.autoTrim && MC.S.trimIn === 0 && MC.S.trimOut == null) {
        p.step(4, "演奏の始まりと終わりを調べています…");
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

  /* ★ 手でINを動かす経路も必ず invalidateCuts を通す(2026-07-31)。
     cutList は「決めたときの範囲」に対して作られているので、INを前へ動かすと
     MC.cutAt(layout.js:22)が先頭カットで頭打ちし、増えた区間が全部1カメラになる。
     黒コマにならないので見ても気づけない。lengthDecided が false なら即returnする */
  $("#trimInBtn").onclick = () => { MC.S.trimIn = MC.S.t; if (MC.S.trimOut != null && MC.S.trimOut <= MC.S.trimIn) MC.S.trimOut = null; MC.saveState(); MC.ui.invalidateCuts(); MC.ui.updateTransport(); };
  $("#trimOutBtn").onclick = () => { if (MC.S.t > MC.S.trimIn + 0.1) { MC.S.trimOut = MC.S.t; MC.saveState(); MC.ui.updateTransport(); } };
  $("#trimResetBtn").onclick = () => { MC.S.trimIn = 0; MC.S.trimOut = null; MC.saveState(); MC.ui.invalidateCuts(); MC.ui.updateTransport(); };

  $("#exportBtn").onclick = async () => {
    if (MC.exporter.running) return;
    /* pointer-events はキーボード操作を止めない。分析中に Tab→Enter が届くと
       書き出しが並走する(2026-07-26 レビュー指摘) */
    if (MC.ui._busy) return;
    MC.preview.pause();
    const prog = $("#exportProgress");   // 旧・パネル内進捗(全画面移行後は使わない)
    $("#doneCard").hidden = true;
    $("#exportBtn").disabled = true;
    $("#cancelBtn").style.display = "inline-block";
    const mode = MC.ui.exportMode();

    /* プラン上の書き出し上限(会員種別 × 端末。2026-07-31)。
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
      /* 書き出しは設計上10〜15分かかる。既定の8秒で「時間がかかっています」を
         出すと、正常な待ちの間ずっと異常を宣告し続ける(2026-07-26) */
      slowMs: 0,
      label: mode === "realtime" ? "再生しながら録画しています…" : "映像を作っています…",
      sub: mode === "realtime" ? "画面を閉じずにお待ちください"
         : "終わるまで、この画面を開いたままにしてください",
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
                          label: "色を調べています…" });
    try {
      await MC.color.run(p);
      p.done("色を合わせました", { sub: "音声に使うカメラに合わせています" });
      MC.ui.renderFinish(); MC.preview.draw();
    } catch (e) {
      console.error(e);
      p.fail("色を合わせられませんでした", { detail: e.message });
    } finally { $("#colorMatchBtn").disabled = false; }
  };
  $("#colorClearBtn").onclick = () => {
    MC.S.colorOn = false;
    MC.S.clips.forEach(c => { c.colorT = null; });
    MC.saveState(); MC.ui.renderFinish(); MC.preview.draw();
    $("#finishStatus").textContent = "";
  };
  /* 自動トリムのスイッチ・「演奏の範囲を探す」・前振り/INに反映/OUTに反映 の
     配線をまとめて削除(2026-07-31)。UIごと撤去したため($ が null を返す)。
     MC.S.autoTrim は既定ONのまま内部で生き、おまかせの中で1回だけ走る */
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
/* ============ 区間の色帯(2026-08-01 製品改革) ============
   音から分かる「いま何が鳴っているか」をシークバーに描く。
   sections.js の判別はこれまで自動カット割の内部にしか無く、
   ユーザーからは一度も見えていなかった ─ 他に無い強みなのに。

   帯があると、書き出しを一度もしないまま
   「反省会でバッテリーのここを見たい」が1タップで済む。 */
MC.ui.SEC_BIN = 1.0;   // 帯の刻み(秒)。細かすぎると模様になり、粗いと嘘になる

/* 帯に描く区間の配列を作る。[{t0,t1,label,color}] */
MC.ui.sectionBands = () => {
  const a = MC.getClip(MC.S.audioClipId);
  if (!a || !a.sections || !MC.sections.label) return [];
  const [tIn, tOut] = [0, MC.timelineDuration()];
  if (!(tOut > tIn)) return [];
  const bin = MC.ui.SEC_BIN;
  const out = [];
  for (let t = tIn; t < tOut; t += bin) {
    const t1 = Math.min(tOut, t + bin);
    const L = MC.sections.label(MC.sections.classify(a, t, t1));
    const key = L ? L.key : null;
    const last = out[out.length - 1];
    /* 同じ性格が続くなら1本にまとめる。細切れの縞にしない */
    if (last && last.key === key) last.t1 = t1;
    else out.push({ t0: t, t1, key, label: L ? L.label : null, color: L ? L.color : null });
  }
  return out;
};

/* 帯の上に「開始位置の候補」を印として重ねる(2026-08-01)。
   候補カード(スタート/大盛り上がり/バラード…)と帯は、同じ「どこから始めるか」を
   2つの見せ方で別々に語っていた。カードは名前を、帯は音の性格を出すのに、
   両者がどこにも繋がっていない ─ 「大盛り上がり」がどの色の上にあるのか
   分からなかった。印で結び、押せば選べるようにする。

   ★ 候補そのものは消さない(優さんの指示で作った機能)。重複を消すのであって、
     機能を消すのではない */
MC.ui._bandCands = () => {
  if (document.body.dataset.mzjPhase !== "length") return { list: [], cur: null };
  const a = MC.ui.applyLengthChoice && MC.ui.applyLengthChoice();
  if (!a || !a.canChoose) return { list: [], cur: null };
  return { list: a.cands || [], cur: a.cand ? a.cand.key : null };
};

MC.ui.renderSectionBand = () => {
  const cv = MC.ui.$("#secBand");
  const lg = MC.ui.$("#secLegend");
  if (!cv) return;
  const bands = MC.ui.sectionBands();
  const dur = MC.timelineDuration();
  const painted = bands.filter(b => b.key);
  /* 解析前・分類が1つも立たない素材では、帯を出さない(空の灰色帯は情報ゼロ) */
  if (!dur || !painted.length) {
    cv.hidden = true;
    if (lg) { lg.hidden = true; lg.innerHTML = ""; }
    return;
  }
  cv.hidden = false;
  const w = Math.max(1, Math.round(cv.clientWidth || cv.parentElement.clientWidth || 300));
  const h = 10, dpr = Math.min(3, window.devicePixelRatio || 1);
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(15,33,56,0.06)";   // 下地(分類が立たない区間)
  ctx.fillRect(0, 0, w, h);
  for (const b of bands) {
    if (!b.color) continue;
    const x0 = (b.t0 / dur) * w, x1 = (b.t1 / dur) * w;
    ctx.fillStyle = b.color;
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
  }
  /* 開始位置の候補を印で重ねる。選ばれているものは濃く・太く */
  {
    const { list, cur } = MC.ui._bandCands();
    for (const c of list) {
      const x = (c.t / dur) * w;
      const on = c.key === cur;
      ctx.fillStyle = on ? "#0c0f14" : "rgba(12,15,20,0.45)";
      ctx.fillRect(Math.max(0, Math.min(w - (on ? 3 : 2), x - (on ? 1.5 : 1))), 0, on ? 3 : 2, h);
    }
  }
  /* 凡例は「実際にこの曲に出てきた性格」だけ。出ていない色を並べない */
  if (lg) {
    const seen = [];
    for (const b of painted) if (!seen.some(x => x.key === b.key)) seen.push(b);
    lg.innerHTML = seen.map(b =>
      `<span><i style="background:${b.color}"></i>${MC.ui.esc(b.label)}</span>`).join("");
    lg.hidden = false;
  }
};

/* 帯をタップしたらそこへ飛ぶ。押せるのに何も起きない帯にしない */
MC.ui.wireSectionBand = () => {
  const cv = MC.ui.$("#secBand");
  if (!cv) return;
  const jump = e => {
    const dur = MC.timelineDuration();
    if (!dur) return;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX ?? (e.touches && e.touches[0] && e.touches[0].clientX) ?? 0) - r.left;
    const t = Math.max(0, Math.min(dur, (x / Math.max(1, r.width)) * dur));
    /* 候補の印の近く(帯の幅で4%以内)を押したら、その候補を選ぶ。
       ただ頭出しするだけでなく「そこから書き出す」まで一手で決まる */
    const { list } = MC.ui._bandCands();
    const near = list.find(c => Math.abs(c.t - t) <= dur * 0.04);
    if (near) {
      MC.S.startKey = near.key;
      if (near.key !== "manual") MC.S.startAt = null;
      MC.ui.renderLengthSec();
      MC.preview.seek(near.t);
      MC.ui.updateTransport();
      MC.ui.renderSectionBand();
      MC.ui.toast(`${near.label}（${MC.ui.fmtTime(near.t)}）から`);
      return;
    }
    MC.preview.seek(t);
    MC.ui.updateTransport();
    const b = MC.ui.sectionBands().find(z => t >= z.t0 && t < z.t1);
    if (b && b.label) MC.ui.toast(`${b.label}（${MC.ui.fmtTime(t)}）`);
  };
  cv.addEventListener("click", jump);
};

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
