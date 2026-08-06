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
  /* ★ ラベルはモードで変わる(2026-08-04)。自動スイッチング×スマホは30秒 */
  const label = lim.exportLimitLabelFor
    ? lim.exportLimitLabelFor(MC.S.mode) : lim.exportLimitLabel;
  const capped = lim.modeCapped ? lim.modeCapped(MC.S.mode) : false;
  $("#doneText").innerHTML =
    `<span class="warn">書き出せるのは${MC.ui.esc(label)}までです`
    + `（今の範囲は${MC.ui.fmtTime(wantSec)}）</span>`;
  const note = $("#doneNote");
  /* 上限は「会員種別 × 端末」で決まる(2026-07-31)。次の一手も相手で変える ─
     スマホの登録ユーザーに「無料登録すると」と言っても、登録済みなので伸びない */
  const back = "「長さと開始位置」に戻ると、収まる長さを選び直せます。";
  /* ★ モードの天井が効いているときは、登録の案内をしない(2026-08-04)。
     登録しても30秒は伸びない ─ ここで「無料登録すると2分」と言うのは嘘。
     伸ばす道はパソコンで開くことだけなので、それだけを言う */
  /* ★ 伸ばす道は MZ_LIMITS.exportUpgradeHint() に聞く(2026-08-05 レビュー反映)。
     以前はここで「パソコンで開くと10分」を直書きしており、**ゲストに対して
     主語が落ちていた** ─ ゲストはパソコンで開いても30秒のままで、10分に
     なるのは登録×パソコンだけ。道の有無と言い方は1箇所(limits.js)で決める */
  const upgrade = lim.exportUpgradeHint ? lim.exportUpgradeHint(MC.S.mode) : "";
  if (capped) {
    note.textContent = back
      + `自動スイッチングはスマホでは${lim.SWITCH_MOBILE_SEC || 30}秒までです（そのぶん高画質で書き出します）。`
      + upgrade;
  } else if (lim.unlimited || lim.member) {
    note.textContent = back + upgrade;
  } else {
    /* ★ スマホのゲストにだけ「この端末で登録したらどうなるか」を先に言う。
       パソコンのゲストは登録=10分で upgrade と同じ文になるため、繰り返さない */
    note.innerHTML = MC.ui.esc(back)
      + (lim.mobile ? `無料登録すると${MC.ui.esc(lim.memberExportLabel)}まで書き出せます。` : "")
      + MC.ui.esc(upgrade)
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
    /* 前回の「保存を待つ」レイアウトも落とす。次の完成で showDone が
       付け直すので、ここは掃除だけ(状態を2箇所で決めない) */
    el.classList.remove("eo-await-save");
    /* ★ 開始前の見積り(#exportEtaHint)の引き継ぎは廃止(2026-08-01 優さん指示
       「文字が多い」)。実機スクショで、上に「およそ2分」(開始前の静的見積り)、
       カード内に「残り約3分」(実測)と、**同じ待ちに2つの違う数字**が
       並んでいた。実測が出るまでの数十秒を埋めるために、その後ずっと
       食い違い続ける行を置くのは割に合わない ─ カード内の実測だけにする */
    /* 「前回のつづきから ─ ◯分ぶんは終わっています」の常設案内は廃止
       (2026-07-31 優さん指示「落ちたら結局戻れないからその案内けして」)。
       戻れると書いておいて戻れないのは、黙っているより悪い。
       中の仕組み(完了パートの再利用)は残す ─ 効いたときは黙って速くなる */
    MC.ui.showResumeNoteIfAny = () => {};
    /* ライブプレビュー(#eoLive)は前回の絵を引きずらない。最初のコピーが
       来るまで隠す(空の黒箱を見せない)。間引きの時計も巻き戻す */
    const lv = MC.ui.$("#eoLive");
    if (lv) lv.hidden = true;
    /* <video>版のライブプレビューも最初のコピーまで隠す(同じ理由) */
    { const lvv = MC.ui.$("#eoLiveVid"); if (lvv) lvv.hidden = true; }
    if (MC.exporter) MC.exporter._liveAt = 0;
    /* ★ 出口(シェア・最初から作り直す)は書き出し中は隠す(2026-08-02 push前レビュー)。
       「最初から作り直す」はページ再読込のリンクで、iPhoneのSafariは
       beforeunload の確認を出さないため、実行中に誤タップすると数分の
       書き出しがその場で消える。実行中の正しい出口は「中止」だけ。
       完成(done)と失敗(fail)で戻す ─ 「閉じる」もこの列にいる */
    { const ex = el.querySelector(".eo-exit"); if (ex) ex.hidden = true; }
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
    /* ★ 出す直前に測り直す(2026-08-06 レビューP1)。完成品をOPFSへ書いた**後**の
       数字でないと、サイト枠と取り込みコピーの切り分けができない。
       非同期だが診断は畳まれた中身なので、遅れて埋まって構わない */
    MC.ui.showExportStats();
    MC.exporter.refreshEstimate().then(() => MC.ui.showExportStats());
    MC.ui.$("#eoTitleText").textContent = "完成しました";
    MC.ui.$("#eoTitleIcon").className = "fa-solid fa-circle-check eo-check";
    MC.ui.$("#eoRun").hidden = true;
    MC.ui.$("#eoDone").hidden = false;
    MC.ui.$("#eoClose").hidden = false;
    { const ex = el.querySelector(".eo-exit"); if (ex) ex.hidden = false; }
    MC.ui.eoLive.stop();   // 書き出しが終われば「再生中」を装う理由は無い
  },
  /* ツール一覧へ移動する間の顔(2026-08-03 優さん指摘)。
     ★ ここで**畳まない**のが肝。location.href の遷移は即座ではないので、
       先に close() すると、その待ち時間だけ裏のこだわりの作業画面が露出し
       「一度こだわりのページが表示され、その後TOPに戻る」に見えていた。
       覆ったまま、押したことだけが伝わるように文言と操作列を切り替える */
  leaving() {
    const el = MC.ui.$("#exportOverlay");
    if (!el || el.hidden) return;
    MC.ui.$("#eoTitleText").textContent = "ツール一覧へ戻っています…";
    MC.ui.$("#eoTitleIcon").className = "fa-solid fa-arrow-left";
    MC.ui.$("#eoDone").hidden = true;         // 保存/共有はもう押させない
    MC.ui.$("#eoClose").hidden = true;        // 二度押しで別の遷移を始めない
    { const ex = el.querySelector(".eo-exit"); if (ex) ex.hidden = true; }
    MC.ui.eoLive.stop();
  },
  fail() {
    const el = MC.ui.$("#exportOverlay");
    if (!el || el.hidden) return;
    /* ★ ライブプレビューの最後のコマを片付ける(2026-08-02 push前レビュー)。
       fail() は #eoRun を隠さない(失敗の理由カード #eoProgress がその中に
       あるため)ので、放っておくと凍った合成コマが「書き出せませんでした」の
       上に残り、375px では理由カードを画面外へ押し下げる */
    { const lv = MC.ui.$("#eoLive"); if (lv) lv.hidden = true; }
    MC.ui.eoLive.stop();   // <video>版の凍ったコマも同じ理由で片付ける
    MC.ui.$("#eoTitleText").textContent = "書き出せませんでした";
    MC.ui.$("#eoTitleIcon").className = "fa-solid fa-triangle-exclamation eo-fail";
    MC.ui.$("#eoCancel").style.display = "none";   // 失敗後の中止は意味がない
    MC.ui.$("#eoClose").hidden = false;            // 詳細はMZPのfail表示が出ている
    { const ex = el.querySelector(".eo-exit"); if (ex) ex.hidden = false; }
    /* ★ ライブプレビューの最後のコマも落とす(2026-08-02 push前レビュー)。
       #eoRun は失敗理由(#eoProgress)ごと見せ続けるため隠せない。すると
       止まったコマが「書き出せませんでした」の上に34vhぶん残り、
       まだ動いているように見えるうえ、失敗理由と次の一手を画面の下へ
       押し出す(375×667 実測で「もう一度ためす」が下端ぎりぎりだった) */
    { const lv = MC.ui.$("#eoLive"); if (lv) lv.hidden = true; }
    /* 「この画面のままお待ちください」を消す(2026-07-25 実機レビュー)。
       失敗しているのに待機を促す文が残り、画面が矛盾していた。
       #eoRun ごと隠してはいけない ─ 失敗の理由を出す #eoProgress(MZPのfailカード)が
       その中にあるため、丸ごと隠すと対処法まで消える。案内文だけを落とす。
       アイコンも eo-fail で危険色にする(それまで通常時と同じブランド青で、
       色による危険の信号がゼロだった) */
    el.classList.add("eo-failed");
    /* ★ 失敗も端末から知らせる(2026-08-02 優さん指示「失敗時もお知らせして」)。
       低い音+振動+通知。おまかせ全画面の失敗(autoStage.fail)と同じ失敗が
       重なっても notifyFail 側の窓が1回にまとめる */
    MC.ui.notifyFail({
      title: "書き出せませんでした",
      body: "MarchinZ Switcher に戻って、理由と次の一手をご確認ください",
      tab: "⚠ 書き出せませんでした — MarchinZ",
    });
  },
  close() {
    const el = MC.ui.$("#exportOverlay");
    if (!el) return;
    el.hidden = true;
    document.body.classList.remove("mz-export-open");
    MC.ui.eoLive.stop();
  },
};

/* ============ 書き出し中のライブプレビューを「本物の再生」に(2026-08-02 優さん指示④
   「書き出し中に映像出るのはいい。でも暗くなる。動画を再生中のようにして」) ============
   WebKit の消灯抑止(shouldDisableSleep)は「映像+音声トラックを持つメディアが
   再生中」であることが条件(過去レビューで確認済み。session.js の _wakeVideo と同じ実読)。
   #eoLive(canvas)の絵を captureStream() で <video id="eoLiveVid"> へ流し、
   無音のオーディオトラック(AudioContext → MediaStreamDestination)を合流させる。
   実絵が動く=OSが「動画を再生中」と認めるので、2pxの代役動画より確実。

   ★ デコーダの口は使わない: captureStream は canvas に描かれた絵をそのまま
     流すだけでデコードが発生しない。書き出し中の VideoDecoder 群と競合しない。
   ★ muted / volume=0 にしない(どちらも WebKit は消灯を抑止しない。session.js の実読)。
     音声トラックの中身は完全な無音なので、何も鳴らない。
   ★ play() はユーザー操作の活性が要る。おまかせ開始・書き出しボタンの
     タップ文脈で prime() し、一度通れば以後は同じ要素で play() し直せる
     (WebKit は制限を要素ごとに解除する)。
   失敗したら従来の canvas 表示に静かに戻す(機能検出。exporter.livePreview が
   on を見て出し分ける) */
MC.ui.eoLive = {
  on: false, _stream: null, _ctx: null, _vTrack: null, _noApi: false,
  async prime() {
    if (this.on || this._noApi) return;
    const cv = document.getElementById("eoLive");
    const v = document.getElementById("eoLiveVid");
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!cv || !v || !cv.captureStream || !AC || !window.MediaStream) {
      this._noApi = true; return;
    }
    try {
      if (!this._stream) {
        /* fps は上限。コマは livePreview の drawImage(970msに1回)が進める */
        const vs = cv.captureStream(8);
        this._vTrack = vs.getVideoTracks()[0] || null;
        this._ctx = new AC();
        /* 無音の音声: 何も繋がない destination は実装によってフレームが
           流れないことがあるので、offset=0 の定数源を必ず繋ぐ(=完全な無音) */
        const dest = this._ctx.createMediaStreamDestination();
        if (this._ctx.createConstantSource) {
          const src = this._ctx.createConstantSource();
          src.offset.value = 0; src.connect(dest); src.start();
        }
        this._stream = new MediaStream(
          [...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
        v.srcObject = this._stream;
        v.playsInline = true; v.setAttribute("playsinline", "");
        v.muted = false; v.volume = 1;
        /* ★ OS側に止められたら「再生中」を名乗り続けない(push前レビュー)。
           iOSは割り込み(電話・Siri等)で黙って pause することがある。
           on を倒せば livePreview が次のコマから canvas 表示に戻す
           (止まった<video>の凍ったコマを見せ続けない)。stop() の pause でも
           発火するが、そこでは直後に on=false にしており二重でも無害 */
        v.addEventListener("pause", () => { this.on = false; });
      }
      /* resume は await しない ─ タップの活性が無いと**永遠に解決しない**promise を
         返す実装があり、await すると prime ごと固まる。活性があれば同期的に走る */
      try { if (this._ctx.state === "suspended") this._ctx.resume().catch(() => {}); } catch (_) {}
      await v.play();
      this.on = true;
    } catch (e) {
      /* 断られても壊さない。次のタップ(prime呼び出し)で再挑戦する */
      this.on = false;
      MC.log("書き出しプレビューの動画化は保留(canvas表示のまま): "
        + ((e && (e.message || e.name)) || e));
    }
  },
  /* 完成・失敗・閉じるで片付ける。ストリームは次の prime で使い回す */
  stop() {
    const v = document.getElementById("eoLiveVid");
    if (v) { v.hidden = true; try { v.pause(); } catch (_) {} }
    /* ★ AudioContext は眠らせる(push前レビュー)。書き出しの外でも無音を
       レンダリングし続け、電池と音声セッションを握ったままだった。
       close ではなく suspend ─ 次の prime() が resume で使い回す設計のため */
    try { if (this._ctx && this._ctx.state === "running") this._ctx.suspend().catch(() => {}); } catch (_) {}
    this.on = false;
  },
};

/* 「書き出しの記録」。成功したときは今までログがどこにも出ず、実機(iPhone)では
   何にどれだけ掛かったのか確かめようがなかった(失敗時の #errorLog だけが出口だった)。
   ここが速度改善の効果を実機で読むための唯一の窓口になる。
   ログ文字列を読み取るのではなく MC.exporter.lastStats(構造体)から組み立てる。 */
/* ★ ログ系UIは管理者だけに出す(2026-08-02 優さん指示⑫「ログ全般は管理者
   アカウントだけに」)。対象: 診断ログ(#eoStats)・失敗の記録(#asFailDetails)・
   詳しいログ(#errorLog)・音の警告の「記録をコピー」。
   一般ユーザーには文言と手がかり(asFailMsg/asFailHint 等)だけを見せる。
   記録そのもの(MC.debug / buildReport)は積み続ける ─ 見せる場所を絞るだけ */
MC.ui.isAdmin = () => Boolean(window.MZ_LIMITS && MZ_LIMITS.admin);

MC.ui.showExportStats = () => {
  const host = MC.ui.$("#eoStats");
  const s = MC.exporter.lastStats;
  if (!host) return;
  if (!s || !MC.ui.isAdmin()) { host.hidden = true; return; }
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
    /* 「画質」の表記は撤去(2026-08-03 12Mbps統一)。Mbpsが上の行に出ている */
    `カメラ${s.cams}台 / ${s.layoutId}`,
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
    /* Safari「書類とデータ」膨張の実機切り分け用(2026-08-06)。ここが小さいのに
       本体が膨らむなら、犯人はサイト外(取り込み時のWebKit内部コピー) */
    MC.exporter.estLine(),
    s.skips ? `カメラの飛ばし読み ${s.skips}回 (${sec(s.reseekMs)}秒)` : null,
  ].filter(v => v !== null);
  const text = lines.join("\n");
  /* 中高生が読むのはこの1行だけでよい。畳んだ中身は開発者向け */
  /* 「◯分で書き出しました」の1行は出さない(2026-08-05 優さん指示で削除)。
     所要時間・解像度は診断ログ(畳み)の中に残っている */
  const one = MC.ui.$("#eoOneLine");
  if (one) { one.textContent = ""; one.hidden = true; }
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
  /* ★ 書き出し中の凍結(2026-08-02 実機: 画面スリープ→復帰で
     "VideoDecoder is not configured")。デコーダは作り直して続行するが、
     エンコーダまで回収されたときはやり直ししかない。専用の手がかりを出す
     ─ 「形式が扱えない」という嘘の案内(旧)より、正直さ優先 */
  if (/画面が消えて書き出しが中断/.test(m)) {
    return "画面が消えて書き出しが中断されました。もう一度おまかせを押すと、解析を使い回して書き出しだけやり直します。書き出しの間は画面を点けたままにしてください。";
  }
  if (/読み込めませんでした|デコード/.test(m)) {
    /* ★「画質を軽いほうに」は削除(2026-08-01 1080p統一のUI/UXレビュー)。
       標準/高画質の差はビットレートだけになり、デコードの重さは変わらない ─
       効かない対処を勧めると、試して失敗した人が次の手を失う */
    return "カメラが3本あると、iPhoneでは重すぎて止まることがあります。1本減らすか、短い範囲でお試しください。";
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
  const st = (MC.exporter && MC.exporter._stage) ? `\n最後に通ったところ: ${MC.exporter._stage}` : "";
  return `MarchinZ Switcher ${ver}\n${navigator.userAgent}\n`
    + `比率: ${MC.S.preset || "?"} / レイアウト: ${MC.S.layoutId || "?"}\n`
    + `素材: ${mats}\n`
    + `エラー: ${f ? (f.message || String(f)) : "(なし)"}${raw}${st}\n`
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

/* ============ 「まず保存させる」状態(2026-08-02 優さん実機指摘) ============
   実機で「保存ボタンが真ん中に来るように。今だと、別のシーンのボタンを押してしまう。
   一旦保存させるように」。完成画面はスクロールする1枚で、主ボタン(動画を保存)の
   すぐ下に「別のシーンも作れます」の候補が並ぶ ─ 候補を押すと**保存しないまま**
   次の書き出しが始まり、いま作ったものは消える(lastResult が置き換わる)。
   取り返しのつかない誤タップなので、保存が済むまでは候補を畳んでおく。
   ★ 押せなくはしない(詰ませない)。畳んだうえで「それでも作る」を1つ残す。 */
MC.ui.setSaveState = saved => {
  MC.ui._saved = !!saved;
  const eo = MC.ui.$("#exportOverlay");
  /* 未保存のあいだだけ、主ボタンを画面の中央付近へ寄せる(CSS側の auto マージン)。
     保存が済んだら通常の詰め方に戻す ─ 用が済んだ主ボタンを中央に置き続けない */
  if (eo) eo.classList.toggle("eo-await-save", !saved);
  document.body.classList.toggle("mz-saved", !!saved);
};

MC.ui.showDone = res => {
  const share = MC.exporter.shareMode();
  const $ = MC.ui.$;
  MC.ui._audioWarnLine = null;   // 新しい完成では前回の音の警告を持ち越さない
  /* 新しい完成＝また未保存から。前回の「保存済み」を持ち越すと、
     2本目で候補が開いたままになり同じ事故に戻る */
  MC.ui._scenesRevealed = false;
  MC.ui.setSaveState(false);
  MC.ui.liftShareTool(false);   // 新しい完成では、シェアは出口の列に戻す
  /* ★ 「終わったとき」の呼び戻し(2026-08-02 優さん指示)。書き出しは数分かかり、
     おまかせなら合計3〜5分。ここが**本当に終わった**唯一の地点で、しかも
     このあと人が「動画を保存」を押さないと何も残らない ─ 呼び戻す価値が
     いちばん高い。showDone は成功時にしか呼ばれない(失敗は exportOverlay.fail) */
  MC.ui.notifyUserTurn({
    title: "動画ができました",
    body: "MarchinZ Switcher に戻って「動画を保存」を押してください",
    tab: "✅ 完成しました — 保存してください",
    pattern: [90, 60, 90, 60, 160],   // 完成は少し長く鳴らす(途中の合図と区別する)
  });
  /* ★ ファンファーレ(2026-08-02 優さん指示「完了時のUIを楽しく」)。
     紙吹雪+和音。裏タブなら何も出ない(上の通知が既に届いている) */
  MC.ui.celebrate("done");
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
    MC.ui.setSaveState(true);   // もう保存は済んでいる。候補を畳む理由がない
    mirror();
    MC.ui.renderSceneOffers();   // 別のシーンも作る(2026-08-01)
    MC.ui.liftShareTool(true);   // 保存済みならシェアを持ち上げる(⑥)
    return;   // ディスク直書きは blob を持たないため音の自己点検はできない
  }
  /* 前回の「✓保存しました」の顔が残っていたら平常へ戻す(2回目の書き出し) */
  MC.ui.resetSaveUi();
  if (share) {
    /* ★ スマホは「動画を保存」1つだけ(2026-08-01 優さん指示「スマホは
       『動画を保存』だけでいい」)。前はダウンロードも並べていたが、
       iOS Safari の <a download> は実質使えず(過去の経緯どおり保存先が謎になる)、
       選択肢が2つあること自体が迷いの種だった。共有シート(Web Share)が唯一の正道 */
    $("#saveBtn").style.display = "inline-flex";
    const dl = $("#downloadBtn"); if (dl) dl.style.display = "none";
    /* ★ 説明の行は両方削除(2026-08-01 優さん指示「文字が多い」)。
       「準備できました」は見出しの「完成しました」と同じことの言い直しで、
       「写真(カメラロール)やファイルへ…」はボタン名「動画を保存」が
       すべて言っている。サイズだけ1語で残す(送れる大きさかの判断材料)。
       ★ 「ビデオを保存」の案内(2026-08-06 保護者レビューP1: シートの上段は
         LINE等が並び、知らないとLINEを押して「保存したのに写真に無い」になる)は
         **完了トースト**で言う ─ doneNote に置く案は、この画面の中央寄せが
         上マージンvh固定のため1行増えるだけで出口が667pxの外へ落ち、
         「出口が同じ画面に収まる」契約(QA㉜)が破れた(実測+16px/2行版は+37px) */
    $("#doneText").innerHTML = `<span class="ok">${(res.blob.size / 1e6).toFixed(1)}MB</span>`;
    $("#doneNote").textContent = "";
    MC.ui.toast("✔ 完成しました。「動画を保存」を押して「ビデオを保存」を選ぶと写真に入ります");
  } else {
    // PC/Mac: 自動ダウンロード済み。再ダウンロードだけ出す
    $("#saveBtn").style.display = "none";
    const dl = $("#downloadBtn"); if (dl) dl.style.display = "";
    $("#doneText").innerHTML = `<span class="ok">✓ 「${MC.ui.esc(res.name)}」を保存しました(${(res.blob.size / 1e6).toFixed(1)}MB)</span>`;
    $("#doneNote").textContent = "";   // 「(もう一度…)」は削除。ボタン名が言っている
    MC.ui.toast("✔ 書き出しが完了しました");
    /* PC は書き出しと同時にダウンロード済み ─ 押させる保存が無いので畳まない
       (「先に保存してください」と言っても押すものが無い、が最悪の詰み方) */
    MC.ui.setSaveState(true);
  }
  mirror();
  MC.ui.renderSceneOffers();   // 別のシーンも作る(2026-08-01)
  if (MC.ui._saved) MC.ui.liftShareTool(true);   // PC(自動DL済み)もシェアを持ち上げる(⑥)
  MC.ui.verifyAudioAfterExport(res);   // 音の自己点検(裏で。結果が出たら追記)
};

/* ============ 完成直後の音の自己点検(2026-08-01) ============
   実機で「音が入ってない」が audio=true のまま2度起きた。もう
   「エンコードが完走したか」ではなく「実際に鳴るか」を、出来上がった
   ファイルそのもので確かめる。問題があれば完了画面に明示して、
   数値(RMS)を記録に残す ─ 次の報告から原因が数字で見える */
MC.ui.verifyAudioAfterExport = async res => {
  try {
    if (!res || !res.blob) return;
    const st = MC.exporter.lastStats;
    if (st && st.withAudio === false) return;   // 音なしの書き出しは点検しない
    const v = await MC.exporter.verifyAudio(res.blob);
    MC.log(`音の自己点検: ${v.ok ? "OK" : "NG"}`
      + ` rms=${v.rms == null ? "?" : v.rms.toFixed(4)}${v.why ? " / " + v.why : ""}`);
    if (v.ok) return;
    const line = "⚠ 出来上がった動画に<b>音が入っていない可能性</b>があります"
      + (v.rms != null ? `（実測 ${v.rms.toFixed(4)}）` : "")
      + `。${MC.ui.esc(v.why || "")} `
      /* 「記録をコピー」は管理者だけ(2026-08-02 ⑫)。警告そのものは全員に出す */
      + (MC.ui.isAdmin()
          ? '<button type="button" class="mzp-retry" id="audioWarnCopy">記録をコピー</button>' : "");
    MC.ui._audioWarnLine = line;
    MC.ui._appendAudioWarn();
    MC.ui.toast("⚠ 音の確認で問題が見つかりました", 6000);
  } catch (e) {
    MC.log("音の自己点検に失敗(完成の扱いは変えない): " + ((e && e.message) || e));
  }
};
/* 警告行を #doneNote / #eoDoneNote へ実らせる。notifySaved が innerHTML を
   書き換えた後にも呼び直す(書き換えで警告が消えるため) */
MC.ui._appendAudioWarn = () => {
  if (!MC.ui._audioWarnLine) return;
  for (const id of ["doneNote", "eoDoneNote"]) {
    const el = MC.ui.$("#" + id);
    if (!el || el.querySelector(".mz-audio-warn")) continue;
    const sp = document.createElement("span");
    sp.className = "mz-audio-warn";
    sp.setAttribute("role", "alert");
    sp.innerHTML = MC.ui._audioWarnLine;
    el.appendChild(document.createElement("br"));
    el.appendChild(sp);
    const b = sp.querySelector("#audioWarnCopy");
    if (b) { b.removeAttribute("id"); b.onclick = () => MC.ui.copyReport(); }
  }
};

/* 保存の顔を平常へ戻す(showDone の入口で呼ぶ) */
MC.ui.resetSaveUi = () => {
  ["#saveBtn", "#eoSaveBtn"].forEach(sel => {
    const b = MC.ui.$(sel);
    if (!b) return;
    b.classList.remove("saved");
    b.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i> 動画を保存';
  });
  ["#doneNote", "#eoDoneNote"].forEach(sel => {
    const n = MC.ui.$(sel); if (n) n.classList.remove("save-ok");
  });
};

/* 保存できたことを、完了画面とトーストの両方で言う(2026-08-01 優さん指摘
   「ダウンロード完了の通知がなくわからない」)。
   ・Web Share は resolve/AbortError で**成功と取り消しが区別できる**ので、
     成功のときだけ言う(取り消したのに「保存できました」は嘘になる)
   ・<a download> は完了イベントが取れないが、blob は手元にあり書き込みは
     即時なので「ダウンロードに保存しました」で実態と合う */
/* ★ 正確さの注記(2026-08-01 交差レビュー): Web Share の resolve は
   「共有シートの操作が完了した」ことまでしか保証しない。写真/ファイルへの
   実際の書き込み完了イベントは Web からは取れない。それでも
   ・AbortError(取り消し)は確実に区別できる
   ・主導線の文言が「写真(カメラロール)やファイルへ保存」で、
     圧倒的多数の共有先が写真アプリ
   なので「保存しました」と言う。共有先のアプリ側で失敗する稀な場合に
   限り、この言葉が実態より先に出る ─ Webの制約として受け入れる */
/* ★ 成功したら画面の主役が変わる(2026-08-01 優さん指示「保存完了ももっと
   わかりやすく」)。文字を足すのではなく、いちばん大きい物(主ボタン)が
   「✓ 保存しました」(緑)に変わり、下に緑の帯が1本入る。ファイル名は
   出さない(「文字が多い」。名前は保存先のアプリが見せる) */
MC.ui.notifySaved = (r, how) => {
  const size = r.blob ? `（${(r.blob.size / 1e6).toFixed(1)}MB）` : "";
  /* ★ 共有(share)では帯を出さない(2026-08-02 優さん指摘⑦「保存しましたが2つでる」)。
     主ボタン自身が「✓ 保存しました」に変わり、サイズも見出し(#eoDoneText)に
     既に出ている ─ 帯はボタンと同じ文をもう一度言うだけだった。
     ダウンロード(PC)ではボタンの顔が変わらないので、帯が完了を言う従来のまま */
  const line = how === "share" ? "" : `✓ ダウンロードに保存しました${size}`;
  ["#doneNote", "#eoDoneNote"].forEach(sel => {
    const n = MC.ui.$(sel);
    if (n) { n.textContent = line; n.classList.toggle("save-ok", !!line); }
  });
  if (how === "share") {
    ["#saveBtn", "#eoSaveBtn"].forEach(sel => {
      const b = MC.ui.$(sel);
      if (b) { b.classList.add("saved");
               b.innerHTML = '<i class="fa-solid fa-check"></i> 保存しました'; }
    });
  }
  MC.ui._appendAudioWarn();   // 保存の言葉で音の警告を消さない(2026-08-01)
  /* 保存が済んだ ─ ここで初めて「別のシーンも作れます」を通常の顔に戻す
     (2026-08-02)。書き直すので、警告行を実らせた後に呼ぶ */
  MC.ui.setSaveState(true);
  MC.ui.renderSceneOffers();
  /* 保存が済んだら、ツールのシェアを保存の直下へ持ち上げて目立たせる
     (2026-08-02 優さん指示⑥)。未保存の間は動かさない(先に保存させる導線) */
  MC.ui.liftShareTool(true);
  /* ★ 保存もお祝い(2026-08-02)。取り消し(AbortError)はここへ来ないので祝わない */
  MC.ui.celebrate("saved");
  MC.ui.toast(how === "share" ? "✔ 保存しました" : "✔ ダウンロードに保存しました");
};

/* 共有シートを開く。QAが成功/取り消しを差し替えられるように1枚だけ挟む
   (navigator.share はページによっては書き換えできない) */
MC.ui._share = files => navigator.share({ files });

/* 保存の実行。iOSはWeb Shareで写真/ファイルへ、それ以外はダウンロード。
   返り値で何が起きたかを言う("saved"/"cancelled"/"downloaded"/"none") */
MC.ui._shareBusy = false;
MC.ui.saveResult = async () => {
  const r = MC.exporter.lastResult;
  if (!r) return "none";
  if (MC.exporter.shareMode()) {
    /* ★ 共有シートが開くまでに間があると連打され、2回目の share が
       InvalidStateError で落ちて下のフォールバックへ流れていた(2026-08-05) */
    if (MC.ui._shareBusy) return "busy";
    MC.ui._shareBusy = true;
    try {
      /* すでに File(OPFSから取り出したもの)ならそのまま渡す。
         new File([blob]) は中身を丸ごとメモリへ複製するため、
         長尺だとここで OPFS 化の意味が消える(2026-07-23 Phase 1) */
      const file = (r.blob instanceof File && r.blob.name === r.name)
        ? r.blob
        : new File([r.blob], r.name, { type: r.type || r.blob.type });
      await MC.ui._share([file]);
      MC.ui._shareRetryN = 0;
      MC.ui.notifySaved(r, "share");                    // 成功したときだけ言う
      return "saved";
    } catch (e) {
      if (e && e.name === "AbortError") {
        /* ★ 取り消し=「どれを押せばいいか分からなかった」ことが多い(2026-08-06
           保護者レビュー: シート上段のLINEを押して「写真に無い」)。次の一手を言う */
        MC.ui.toast("開いた画面の下の方にある「ビデオを保存」を選ぶと、写真アプリに入ります");
        return "cancelled";
      }
      /* ★ iPhoneで <a download> へ落とすと「PCのダウンロードの挙動」になり、
         どこへ保存されたか分からなくなる(2026-08-05 優さん実機)。
         タップから時間が経った(NotAllowedError)・シートの競合
         (InvalidStateError)は、押し直せば share が通る ─ 落とさずに頼む */
      if (e && (e.name === "NotAllowedError" || e.name === "InvalidStateError")) {
        /* 押し直しで直らない環境(共有が常時拒否)への出口: 3回目はダウンロードへ
           (2026-08-05 レビューP2。出口が無いと保存手段が消える) */
        MC.ui._shareRetryN = (MC.ui._shareRetryN || 0) + 1;
        if (MC.ui._shareRetryN < 3) {
          MC.log("share再試行待ち:", e.name);
          MC.ui.toast("保存の画面を開けませんでした。もう一度「動画を保存」を押してください");
          return "retry";
        }
        MC.log("share3回失敗→ダウンロードへ:", e.name);
      }
      MC.log("share失敗→ダウンロード:", e && e.message);
      MC.exporter.triggerDownload(r.blob, r.name);        // 最後の手段
      MC.ui.notifySaved(r, "download");
      return "downloaded";
    } finally {
      MC.ui._shareBusy = false;
    }
  }
  MC.exporter.triggerDownload(r.blob, r.name);
  MC.ui.notifySaved(r, "download");
  return "downloaded";
  /* lastResult はここでは消さない。保存 → もう一度 と続けて押されると2回目が
     失敗する(レビュー指摘 2026-07-23)。片付けは「次の書き出し」「やり直し」「起動時」 */
};

/* 「ダウンロード」ボタン(PC)。実行したら必ず完了の言葉を出す */
MC.ui.downloadResult = () => {
  const r = MC.exporter.lastResult;
  if (!r) return;
  MC.exporter.triggerDownload(r.blob, r.name);
  MC.ui.notifySaved(r, "download");
};

/* ============ 別のシーンも作る(2026-08-01 優さん指示) ============
   完成のあとに「同じ素材から、別の場面も作れます」を出す。
   候補は highlight.candidates(開始位置の候補と同じもの)を土台に、
   **いま書き出した窓と半分以上重なるものを除く**(同じ60秒を2回出さない)。
   個数は素材(演奏区間)の長さから自然に決まる: 短ければスタートの1個だけ、
   長ければ最大5個(highlight.MAX)。名前も candidates の語彙をそのまま使う
   (「大盛り上がり」「バラード」「ドラムライン」「ソロ」「フィナーレ」)。 */
/* 候補が0個になった理由。★ユーザーに見せる1文と、ログに残す技術的な理由を分ける。
   0個のとき段ごと消していたため、実機で「別のシーンが見えない」となり、
   見えないのが「作れないから」なのか「壊れているから」なのか誰にも分からなかった
   (2026-08-04 優さん実機指摘)。空を返すときは必ずここに理由を置く */
MC.ui._sceneWhy = null;
/* ★ log は5つに分ける(切り分けの根拠)が、say は2つに畳む(2026-08-04 レビュー)。
   この段が出るのは**書き出しが終わった画面**。そこで
   「演奏の範囲が決まっていません」「長さが決まっていません」と言われると、
   いま動画ができた直後なので**故障の宣告**に読まれる。
   「動画が重なっている時間が短すぎます」は、いま成功した素材を否定するので
   矛盾に見える。ユーザーに見せて意味があるのは overlap と error だけ。 */
MC.ui.SCENE_WHY = {
  range:  { log: "演奏の範囲が未確定(showRange)", say: "別のシーンを探せませんでした" },
  preset: { log: "長さのプリセットが無い(currentPreset)", say: "別のシーンを探せませんでした" },
  cover:  { log: "全動画が重なる区間が1秒以下(coverRange)", say: "別のシーンを探せませんでした" },
  none:   { log: "候補が1本も立たない(highlight.candidates が空)",
            say: "演奏が短く、いま作ったところしかありません" },
  overlap:{ log: "候補が全部いまの動画と重なる(半分以上同じ絵)",
            say: "演奏が短く、いま作ったところしかありません" },
  error:  { log: "例外", say: "別のシーンを探せませんでした" },
};
MC.ui.sceneOffers = () => {
  const no = k => { MC.ui._sceneWhy = k; return []; };
  try {
    MC.ui._sceneWhy = null;
    const [s0, s1] = MC.ui.showRange();
    if (!(s1 > s0)) return no("range");
    const preset = MC.ui.currentPreset(s1 - s0);
    if (!preset) return no("preset");
    const lenSec = MC.highlight.presetSec(preset, s1 - s0);
    const audioClip = MC.getClip(MC.S.audioClipId);
    /* ★ 候補窓は「全動画が重なっている区間」に制限(2026-08-02 優さん指摘⑤
       「3つ目の動画がないところも選ばれている」)。音声は動画より長いことが
       あり、音だけで探すと動画の無い時間帯に窓を置いてしまう。
       共通部分が短ければ、作れる分だけ(candidates が自然に減らす) */
    const [c0, c1] = MC.ui.coverRange(s0, s1);
    /* ★ 交差が無くても即あきらめない(2026-08-06 優さん実機2回目)。
       前版はここで return no("cover") しており、保険が一度も走らなかった。
       機械候補(bs)だけ交差窓で探し、足りない分は保険が実長から埋める */
    const covered = c1 > c0 + 1;
    /* ★ 候補は「一番いいシーン」の順位から(2026-08-05 DCI協議)。
       性格代表(旧candidates)でなく採点順の2番手・3番手を出す。
       短い素材は bestScenes が「尻まで/頭から」の2択(または1本)を返す。
       重複は構わない(優さん指示) ─ 除くのはいま作った窓とほぼ同一(92%以上)だけ */
    const bs = covered ? MC.highlight.bestScenes(audioClip, lenSec, c0, c1) : [];
    const pIn = MC.S.trimIn != null ? MC.S.trimIn : s0;
    const pOut = MC.S.trimOut != null ? MC.S.trimOut : pIn + lenSec;
    const notSame = c => {
      const ov = Math.min(c.t + c.dur, pOut) - Math.max(c.t, pIn);
      return ov < c.dur * 0.92;
    };
    const out = bs.filter(notSame).slice(0, 3).map(o => ({ ...o }));
    /* ★ 保険: 候補が3つ未満なら**素材の全長**から前半/中盤/終盤で埋める
       (2026-08-05 優さん実機: 8分の素材で候補ゼロ=「演奏が短く」が出た。
       演奏区間の検出が狭かったり解析が消えていても、素材が実際に長ければ
       必ず他の場所を出す ─ 出さない言い訳に検出結果を使わない)。
       いまの窓や既存候補と近い(8秒未満)ものは足さない */
    let fbNote = "";
    if (out.length < 3) {
      try {
        const durAll = MC.timelineDuration ? MC.timelineDuration() : s1;
        /* ★ 土台は**素材の実長そのもの**(2026-08-06 優さん実機2回目)。
           前版は coverRange(全カメラの交差)を土台にしており、2本目の
           カメラが短い/ズレていると8分素材でも土台が十数秒に縮み、
           「終盤 9秒〜」の1枚だけ、が実機で起きた。交差の外はカメラが
           欠ける時間帯があり得るが、「その場面を選べない」方が損。
           始まりは演奏開始(s0)を尊重(セッティング風景は出さない)。
           2分未満の素材だけ保険なし(優さん指示「2分未満を除いて常に3つ」) */
        /* ★ 演奏検出(show)が素材の半分も掴めていないときは、頭からを土台に
           (2026-08-06 優さん実機ログで確定: salute検出が最後の礼だけを拾い
           show=486..643(末尾157秒)に狭窄。s0を信じると前半7分の演奏が
           永遠に出せない ─ 「検出結果を出さない言い訳に使わない」)。
           検出がまともなときは従来どおり演奏開始(s0)を尊重 */
        const wide = (s1 - s0) < durAll * 0.5;
        const f0 = wide ? 0 : s0, f1 = Math.max(durAll, s1);
        const fspan = (f1 - f0) - lenSec;
        fbNote = ` fb=${f0.toFixed(0)}..${f1.toFixed(0)} fspan=${fspan.toFixed(0)}`
          + (wide ? " wide" : "");
        if (durAll >= 120 && f1 - f0 >= 10) {
          /* ★ 位置は**素材の実長比**で置く(fspan比ではない)。上限なしの人は
             プリセットが「まるごと」= fspan が10秒ほどしか残らず、fspan比だと
             候補が冒頭数秒に密集して1枚しか生き残らない(2026-08-06 優さん実機:
             8分素材で「終盤9秒〜」の1枚だけ)。
             ★ 前回窓との92%重複除外(notSame)は保険には適用しない ─ まるごと
             書き出した直後は素材のどこもが「前回と重なる」ため、適用すると
             永遠に出せない。開始位置が8秒以上違えば別のシーンとして出し、
             尻が足りない分は dur を縮める(書き出し側も同じ縮め方をする) */
          const spots = [["前半", 0.15], ["中盤", 0.45], ["終盤", 0.78],
                         ["前半", 0.30], ["中盤", 0.62], ["終盤", 0.90]];
          for (const [nm, frac] of spots) {
            if (out.length >= 3) break;
            const t = f0 + (f1 - f0 - 10) * frac;   // 末尾は最低10秒残す
            const cand = { key: "fb-" + frac, label: nm, why: "素材の" + nm + "の位置",
                           icon: "fa-clapperboard", t, dur: Math.min(lenSec, f1 - t),
                           rank: out.length + 1, score: 0 };
            if (Math.abs(t - pIn) >= 8
                && !out.some(o => Math.abs(o.t - t) < 8)) out.push(cand);
          }
        }
      } catch (e) { MC.log("sceneOffers保険: " + e.message); }
    }
    /* 表示は時刻順。「シーンN」は出す順に振り直す(採点順の名残で
       「シーン2」から始まる歯抜けを防ぐ)。同じラベルが2つ並んだら後の方を
       シーンNへ落とす(「大盛り上がり」×2を出さない) */
    out.sort((a, b) => a.t - b.t);
    { const seen = new Set(); let sn = 0;
      for (const o of out) {
        if (/^scene/.test(o.key) || seen.has(o.label)) {
          sn += 1;
          o.key = "scene" + sn; o.label = "シーン" + sn;
          o.why = "音の流れが良い位置"; o.icon = "fa-clapperboard";
        }
        seen.add(o.label);
      } }
    if (out.length < 3) {
      const line = `sceneOffers内訳: show=${s0.toFixed(0)}..${s1.toFixed(0)}`
        + ` cover=${c0.toFixed(0)}..${c1.toFixed(0)} len=${lenSec} bs=${bs.length}`
        + ` 残=${out.length}` + fbNote;
      /* renderSceneOffers は描き直しのたびに走る ─ 同じ内訳を並べない
         (隣の _sceneWhyLogged と同じ理由のdedup) */
      if (line !== MC.ui._soLastLog) { MC.ui._soLastLog = line; MC.log(line); }
    }
    if (out.length) return out;
    /* ここまで来たら本当に「いま作ったところしかない」(2分未満の素材)。
       cover は切り分けキーとして残す(2026-08-06 レビューP0: 到達不能化していた) */
    return no(!covered ? "cover" : bs.length ? "overlap" : "none");
  } catch (e) { MC.log("sceneOffers: " + e.message); return no("error"); }
};

/* ============ 別のシーンの回数(2026-08-02 優さん決定⑭) ============
   ゲストは1本まで・登録は何本でも。回数の正本は limits.js の maxExtraScenes。
   数えるのは**このセッション内だけ**(リロードでリセットは許容 ─ 別シーンは
   メモリ上の解析が生きている間しか速く作れないため、永続化する意味が薄い) */
MC.ui._extraScenesMade = 0;
MC.ui.extraScenesLeft = () => {
  const lim = (window.MZ_LIMITS && MZ_LIMITS.maxExtraScenes);
  return (lim == null ? Infinity : lim) - (MC.ui._extraScenesMade || 0);
};

/* ============ 開始時点の「全景カメラ」とサムネイル(2026-08-04 優さん指示) ============
   シーン候補に、そのシーンが始まる瞬間の絵を小さく添える ─
   「大盛り上がり」「バラード」という名前だけでは、どの場面か思い出せない。
   ★ 引きのカメラを選ぶ理由: 寄りの絵はその瞬間たまたま抜いていた奏者しか
     写らず、場面の手がかりにならない。隊形が見える引きが「どこの場面か」を
     いちばんよく伝える。
   選び方は3段構え(人の指定 > 推定した性格 > 実際の引きスコア)。 */
MC.ui.wideCamAt = t => {
  const pool = MC.S.clips.filter(c => !c.isAudio && !c.isImage
    && c.video && t >= c.offset && t <= c.offset + c.duration);
  if (!pool.length) return null;
  // ① 人が「引き」と指定したカメラ(自動判定より人の指定が上)
  const tagged = pool.find(c => c.role === "wide");
  if (tagged) return tagged;
  // ② 解析で俯瞰・定点の引きと推定されたカメラ
  const over = pool.find(c => c.visual && c.visual.overheadFixed);
  if (over) return over;
  // ③ その瞬間の引きスコアがいちばん高いカメラ(解析済みのときだけ)
  let best = null, bs = -1;
  for (const c of pool) {
    let s = -1;
    try {
      const m = MC.visual.seg(c, t, t + 1);
      if (m) s = MC.visual.shotScores(m).wide;
    } catch (e) { s = -1; }
    if (s > bs) { bs = s; best = c; }
  }
  return best || pool[0];
};

/* シーン候補のサムネイル(JPEG data URL)。作れなければ null。
   ★ 再生中は作らない ─ seek で画面が乱れる(cutmode.makeThumb と同じ約束)。
   ★ 1度作ったら覚える(候補は描き直しのたびに再生成しない) */
MC.ui._sceneThumbs = new Map();
MC.ui.sceneThumbKey = t => `t${Math.round(t * 10)}`;
MC.ui.makeSceneThumb = async t => {
  const key = MC.ui.sceneThumbKey(t);
  if (MC.ui._sceneThumbs.has(key)) return MC.ui._sceneThumbs.get(key);
  if (MC.S.playing) return null;
  const clip = MC.ui.wideCamAt(t);
  if (!clip || !clip.video) return null;
  const v = clip.video;
  if (!v.videoWidth) return null;
  const local = Math.max(0, Math.min(clip.duration - 0.05, t - clip.offset));
  try {
    await new Promise(res => {
      const done = () => { clearTimeout(tm); v.removeEventListener("seeked", done); res(); };
      const tm = setTimeout(done, 1800);
      v.addEventListener("seeked", done, { once: true });
      v.currentTime = local;
    });
    const cv = document.createElement("canvas");
    cv.width = 96; cv.height = 54;
    const s = Math.max(cv.width / v.videoWidth, cv.height / v.videoHeight);
    cv.getContext("2d").drawImage(v,
      (cv.width - v.videoWidth * s) / 2, (cv.height - v.videoHeight * s) / 2,
      v.videoWidth * s, v.videoHeight * s);
    const url = cv.toDataURL("image/jpeg", 0.6);
    MC.ui._sceneThumbs.set(key, url);
    return url;
  } catch (e) { return null; }
};

/* 描いたあとで、候補のサムネイルを1つずつ埋める(描画は待たせない)。
   ★ 直列に回す ─ 同じ <video> を同時に seek すると取り違える */
MC.ui.fillSceneThumbs = async () => {
  /* ★ 二重起動を止めるだけでは足りない ─ 埋めている最中(候補5個で最長9秒)に
     「動画を保存」などで候補が描き直されると innerHTML ごと入れ替わる。
     いま回っているループは画面に無い要素を埋めて終わり、新しい行を埋め直す
     呼び出しはもう誰からも来ないため、灰色の箱が残ったままになる。
     → 断らずに「終わったらもう一周」を予約する */
  if (MC.ui._fillingThumbs) { MC.ui._fillAgain = true; return; }
  MC.ui._fillingThumbs = true;
  try {
    const slots = document.querySelectorAll(".mzso-thumb[data-t]:not([data-done])");
    for (const el of slots) {
      if (!el.isConnected) continue;   // 描き直しで捨てられた行に seek を使わない
      const t = parseFloat(el.dataset.t);
      if (!isFinite(t)) continue;
      const url = await MC.ui.makeSceneThumb(t);
      el.setAttribute("data-done", "1");
      if (url) { el.style.backgroundImage = `url(${url})`; el.classList.add("has-img"); }
    }
  } catch (e) { MC.log("sceneThumb: " + e.message); }
  finally { MC.ui._fillingThumbs = false; }
  if (MC.ui._fillAgain) { MC.ui._fillAgain = false; return MC.ui.fillSceneThumbs(); }
};

/* 完成カードへ「別のシーンも作る」を実らせる。
   見た目は最小限(並行のデザイン作業がこの画面を触っているため、
   構造だけ置いて整えは委ねる)。候補が無ければ何も出さない */
/* 枠を使い切った人に出す1行。★候補が0個のときも同じものを出すので、
   2か所で同じ文言を書かない(片方だけ直すと、もう片方が古い言葉のまま残る)。
   責めずに、登録で何ができるかだけを言う。
   ★ 枠は「切り替えの多い/少ない」でも使う(2026-08-03)ので、シーンだけの
     言い方にしない ─ 切り替え変更で使い切った人には、いま消えた2択の
     行き先もこの1行が説明する */
MC.ui.sceneSignupHtml = () =>
  '<p class="mzso-title"><i class="fa-solid fa-clapperboard" aria-hidden="true"></i> '
  + '別のシーンも、設定の変更も<span class="mzso-note">'
  + '登録すると、何本でも作り直せます</span></p>'
  + '<a class="mzso-signup" href="/#signup">無料登録する</a>';

MC.ui.renderSceneOffers = () => {
  const offers = MC.ui.sceneOffers();
  const hosts = [
    { after: MC.ui.$("#doneNote"), id: "doneScenes" },
    { after: MC.ui.$("#eoDoneNote"), id: "eoDoneScenes" },
  ];
  /* ★ 0個でも段を消さない(2026-08-04 優さん実機指摘 → レビューで穴を1つ塞いだ)。
     消すと「別のシーン」という見出しごと画面から無くなり、
     作れないのか壊れているのか区別が付かない。
     ★ 最初の直しは「未保存なら消す」を残していたが、それでは
       **段の有無そのものが候補の有無を漏らす**。
                 候補あり        候補0個
         未保存   段が見える     段が消える  ← 消したかった不安がここに残る
         保存後   候補が並ぶ     理由が出る
       見出しは常に出し、副文だけ状態で切り替える。これで段が消える経路がゼロになる。
     ★ 未保存のときの副文は hold と同じ「先に保存を」─ 押せない扉の説明を
       先に読ませない、という当初の条件はそのまま満たす */
  if (!offers.length) {
    const hold = !MC.ui._saved && !MC.ui._scenesRevealed;
    const why = MC.ui.SCENE_WHY[MC.ui._sceneWhy] || MC.ui.SCENE_WHY.overlap;
    /* ★ 理由が変わったときだけ出す(2026-08-04 レビュー)。
       renderSceneOffers は保存・描き直しのたびに走るので、
       毎回出すとログが同じ行で埋まって切り分けの役に立たない */
    if (MC.ui._sceneWhyLogged !== MC.ui._sceneWhy) {
      MC.ui._sceneWhyLogged = MC.ui._sceneWhy;
      MC.log("sceneOffers: 候補0個 ─ " + why.log);
    }
    /* ★ 枠を使い切っている人には、候補の有無より先に登録の誘いを出す
       (2026-08-04 レビュー)。この枝を先に置いたせいで、枠切れの案内と
       登録リンクが「探せませんでした」に食われていた */
    const capped = MC.ui.extraScenesLeft() <= 0;
    for (const h of hosts) {
      if (!h.after) continue;
      let el = document.getElementById(h.id);
      if (!el) {
        el = document.createElement("div");
        el.id = h.id;
        el.className = "mz-scene-offers";
        h.after.insertAdjacentElement("afterend", el);
      }
      el.classList.remove("mzso-hold");   // 押せる候補が無いので畳む意味が無い
      el.innerHTML = capped ? MC.ui.sceneSignupHtml()
        : ('<p class="mzso-title"><i class="fa-solid fa-clapperboard" aria-hidden="true"></i> '
          + '同じ動画から別のシーンを作成<span class="mzso-note">'
          + MC.ui.esc(hold ? "先に「動画を保存」を押してください" : why.say) + "</span></p>");
    }
    /* ★ ここで return しない ─ 「同じシーンを別設定で作成」は候補の有無と
       無関係に出す(別のシーンが作れなくても、設定は変えられる)。
       飛ばすと、いま動いている出口まで道連れに消える */
    MC.ui.renderRemakeOffer();
    return;
  }
  for (const h of hosts) {
    if (!h.after) continue;
    let el = document.getElementById(h.id);
    if (!el) {
      el = document.createElement("div");
      el.id = h.id;
      el.className = "mz-scene-offers";
      h.after.insertAdjacentElement("afterend", el);
    }
    /* ★ ゲストが1本を使い切ったら、候補の代わりに登録の誘いを1行だけ(⑭)。
       責めずに、登録で何ができるかだけを言う。
       ★ 枠は「切り替えの多い/少ない」でも使う(2026-08-03)ので、シーンだけの
       言い方にしない ─ 切り替え変更で使い切った人には、いま消えた2択の
       行き先もこの1行が説明する */
    if (MC.ui.extraScenesLeft() <= 0) {
      el.classList.remove("mzso-hold");
      el.innerHTML = MC.ui.sceneSignupHtml();
      continue;
    }
    /* ★ 保存が済むまでは畳んでおく(2026-08-02 優さん実機指摘)。
       候補を押すと次の書き出しが始まり、いま作った動画は消える ─
       保存していなければ、数分の待ちがまるごと無駄になる。
       ただし押せなくはしない: 理由を書いて1枚だけ扉を残す */
    const hold = !MC.ui._saved && !MC.ui._scenesRevealed;
    el.classList.toggle("mzso-hold", hold);
    el.innerHTML =
      '<p class="mzso-title"><i class="fa-solid fa-clapperboard" aria-hidden="true"></i> '
      + '同じ動画から別のシーンを作成<span class="mzso-note">'
      /* ★「前回の解析を使うため速い」は削除(2026-08-06 優さん「実際まつ」。
         解析が消えた復元セッションでは全部やり直しで速くない ─ 嘘になる) */
      + (hold ? "先に「動画を保存」を押してください" : "")
      + "</span></p>"
      + (hold
        ? '<button type="button" class="mzso-reveal">'
          + '<i class="fa-solid fa-lock-open" aria-hidden="true"></i> '
          /* 個数(「5個の候補」)は出さない(2026-08-02 レビュー)。ここは
             逃げ道であって売り文句ではない ─ 数を書くほど扉が魅力的になり、
             いま止めたい誤タップを自分で誘うことになる。数は開けば分かる */
          + "保存せずに別のシーンを作る</button>"
        : '<div class="mzso-list" role="group" aria-label="別のシーンの候補">'
          + offers.map((c, i) =>
              `<button type="button" class="mzso-btn" data-scene="${i}">`
              /* 開始時点の全景を小さく添える(2026-08-04 優さん指示)。
                 絵が入るまでは枠だけ ─ 入ってから .has-img が付く */
              + `<span class="mzso-thumb" data-t="${c.t}" aria-hidden="true"></span>`
              + `<i class="fa-solid ${MC.ui.esc(c.icon || "fa-flag")}" aria-hidden="true"></i> `
              + `${MC.ui.esc(c.label)}`
              /* ★ 時刻は**素材の頭からの絶対値**(2026-08-06 優さん実機
                 「どれも同じ秒数にみえる。全部同じ?」)。以前は t-s0(演奏開始
                 からの相対)で、検出が末尾に狭窄した素材(show=486..)では
                 wide保険候補の t(96/192/288 等)が全部 s0 より手前になり、
                 max(0,負)=0 で**3候補とも「0秒〜」**になっていた。
                 候補には bs(演奏窓内)と fb(素材実長)の2種類が混ざるので、
                 どちらでも嘘にならない基準は絶対時刻だけ。シークバーとも揃う */
              + `<span class="mzso-t">${MC.ui.fmtStartAt(c.t)}から</span>`
              + `</button>`).join("")
          + "</div>");
    el.querySelectorAll("[data-scene]").forEach(b => {
      b.onclick = () => MC.ui.makeAnotherScene(offers[parseInt(b.dataset.scene, 10)]);
    });
    const rev = el.querySelector(".mzso-reveal");
    if (rev) rev.onclick = () => { MC.ui._scenesRevealed = true; MC.ui.renderSceneOffers(); };
  }
  /* 「同じシーンを別設定で作成」(2026-08-04)。別のシーンの下に出すので、
     シーン候補の描画が終わったここで毎回並べ直す */
  MC.ui.renderRemakeOffer();
  /* 絵は後追いで埋める(描画をサムネイル生成で待たせない) */
  MC.ui.fillSceneThumbs();
};

/* ★ 保存が済んだら「このツールを友達にシェア」を保存バンドの直下へ持ち上げる
   (2026-08-02 優さん指示⑥「もっと目立つように」)。ghost のまま診断ログの下に
   沈んでいて、いちばん押してほしい瞬間(保存できて嬉しい直後)に見えなかった。
   ・lift=true : ボタンを完成カードの保存表示(#doneNote/#eoDoneNote)の直後へ移し、
     枠+薄い塗り(.share-lift)で強める。主役の保存より強くしない(主従: 保存>シェア)
   ・lift=false: 出口の列(.eo-exit)の先頭へ戻す。次の完成は未保存から始まるため */
MC.ui.liftShareTool = lift => {
  const spots = [
    { btn: "#eoShareTool", note: "#eoDoneNote", root: "#exportOverlay" },
    { btn: "#doneShareTool", note: "#doneNote", root: "#doneCard" },
  ];
  for (const s of spots) {
    const b = MC.ui.$(s.btn), note = MC.ui.$(s.note), root = MC.ui.$(s.root);
    if (!b || !note || !root) continue;
    const exit = root.querySelector(".eo-exit");
    if (lift) {
      note.insertAdjacentElement("afterend", b);
      b.classList.add("share-lift");
    } else {
      if (exit && b.parentElement !== exit) exit.insertBefore(b, exit.firstElementChild);
      b.classList.remove("share-lift");
    }
  }
};

/* ============ このツールを友達にシェア(2026-08-02 優さん指示) ============
   共有するのは**映像ツールのページ**であって、いま作った動画ではない。
   仕組みはサイト側の他のシェアボタン(app.js の shareInstagramLinkOnly)と同じ:
     navigator.share({url}) → 使えない/失敗したらリンクのコピーへ落ちる。
   ・取り消し(AbortError)は黙る ─ 取り消したのに「コピーしました」は嘘になる
   ・行き先は**このツール(Switcher)自身のURL**(2026-08-02 優さん指示)。
     受け取った友達が1タップで同じツールに立てる ─ 一覧を経由させない */
MC.ui.toolShareUrl = () => {
  /* ★ どの「ツール」を作っているかをURLに残す(2026-08-07 再編)。
     Reel を友達に送ったのに Switcher の入口が開く、を防ぐ。
     モード確定ならその toolKey、未確定ならURLのスコープ */
  const m = MC.ui.MODES[MC.S.mode];
  const sc = window.MZToolScope && MZToolScope.get();
  const key = (m && m.toolKey) || (sc && sc.key) || "";
  const PATH = "/tools/switcher/" + (key ? "?tool=" + key : "");
  try {
    /* file:// で開いているとき(手元の確認)は共有しても届かないので、
       本番のアドレスに寄せる。http(s) ならそのまま(localhost も含めて実測できる) */
    if (location.protocol !== "http:" && location.protocol !== "https:") {
      return "https://marchinz.netlify.app" + PATH;
    }
    return new URL(PATH, location.href).href;
  } catch (_) { return "https://marchinz.netlify.app" + PATH; }
};

/* クリックと同じ処理の流れで動く同期コピー(iOS Safari の Clipboard API は
   非同期の待ちを挟むと拒否されることがある)。app.js と同じ二段構え */
MC.ui._copyText = text => {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("aria-hidden", "true");
    ta.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;padding:0;border:0;";
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return Promise.resolve(true);
  } catch (_) {}
  if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
};

MC.ui.TOOL_SHARE_TEXT = "MarchinZの映像ツール、スマホだけで動画が作れます";
/* QAが差し替えられるように1枚挟む(saveResult の MC.ui._share と同じ手) */
MC.ui._shareUrl = data => navigator.share(data);

MC.ui.shareTool = async () => {
  const url = MC.ui.toolShareUrl();
  const data = { title: "MarchinZ 映像ツール", text: MC.ui.TOOL_SHARE_TEXT, url };
  if (typeof navigator.share === "function"
      && (typeof navigator.canShare !== "function" || navigator.canShare(data))) {
    try {
      await MC.ui._shareUrl(data);
      return "shared";
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";   // 取り消しは黙る
      MC.log("ツールのシェアに失敗→コピー: " + ((e && e.message) || e));
    }
  }
  const ok = await MC.ui._copyText(url);
  MC.ui.toast(ok ? "リンクをコピーしました。友達に貼って送れます"
                 : "コピーできませんでした。アドレスバーのURLをお使いください");
  return ok ? "copied" : "failed";
};

/* ============ 同じシーンを別設定で作成(2026-08-04 優さん指示) ============
   前身は「切り替えをもっと多く/少なく」の2択(2026-08-03)だったが、
   変えられるのが頻度だけで、配置・傾き・色は完成後に変えようがなかった。
   ★ 新しい設定画面は作らない ─ 「仕上げの好み」(#finishPick)を開き直す。
     あの画面は既に 配置 / 切り替えの回数 / 色 / 傾きの自動補正 の4つを
     持っている。同じことを2枚のUIで言うと、必ず片方が古くなる。
   ・シーンは変えない(startKey/startAt をそのまま渡す=解析使い回しの高速経路)
   ・★ 回数は「別のシーン」と**同じ勘定**(maxExtraScenes/_extraScenesMade)。
     ただし枠を減らすのは**実際に作り直したとき**だけ ─ 設定画面を開いて
     やめた人から枠を取らない(前身は押した瞬間に減らしていた) */
MC.ui.renderRemakeOffer = () => {
  const hosts = [
    { scenes: "doneScenes", note: MC.ui.$("#doneNote"), id: "doneRemake" },
    { scenes: "eoDoneScenes", note: MC.ui.$("#eoDoneNote"), id: "eoDoneRemake" },
  ];
  const show = MC.ui.extraScenesLeft() > 0
    && !(!MC.ui._saved && !MC.ui._scenesRevealed);   // 保存前は候補と同じく畳む(誤タップ防止)
  for (const h of hosts) {
    let el = document.getElementById(h.id);
    if (!show) { if (el) el.remove(); continue; }
    /* 置き場所は「別のシーン」の下。無ければ保存表示の下 */
    const anchor = document.getElementById(h.scenes) || h.note;
    if (!anchor) continue;
    if (!el) { el = document.createElement("div"); el.id = h.id; el.className = "mz-scene-offers"; }
    anchor.insertAdjacentElement("afterend", el);
    /* 何を変えられるかはモードで違う。嘘を書かないため、その場で数え上げる */
    const items = [];
    if (MC.ui.finishRoles().length && MC.ui.finishCards().length >= 2) items.push("配置");
    /* ★ 役割も数える(2026-08-04 レビュー)。renderFinishRoles は switch で
       必ず出るのに、ここが数え落としていて「その場で数え上げる」という
       宣言のほうが嘘になっていた。出す条件は向こうと同じ形で書く */
    if (MC.S.mode === "switch" && MC.ui.finishCards().length >= 2) items.push("カメラの役割");
    if (MC.S.mode === "switch") items.push("切り替えの回数");
    items.push("色", "傾き");
    el.innerHTML =
      '<p class="mzso-title"><i class="fa-solid fa-sliders" aria-hidden="true"></i> '
      + '同じシーンを別設定で作成<span class="mzso-note">'
      + MC.ui.esc(items.join("・")) + 'を選び直します</span></p>'
      + '<div class="mzso-list" role="group" aria-label="別設定で作り直す">'
      + '<button type="button" class="mzso-btn" data-remake="1">'
      + '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> 設定を選び直す</button>'
      + "</div>";
    el.querySelectorAll("[data-remake]").forEach(b => { b.onclick = () => MC.ui.openRemakeSettings(); });
  }
};

/* 「設定を選び直す」= 仕上げの好みを、いまの設定を入れた状態で開く。
   ここでは枠を消費しない(進むボタンを押して初めて1本ぶん減る) */
MC.ui.openRemakeSettings = () => {
  if (MC.ui._busy || (MC.exporter && MC.exporter.running)) return;
  if (MC.ui.extraScenesLeft() <= 0) { MC.ui.renderSceneOffers(); return; }
  MC.ui.openFinishPick({ remake: true });
};

/* 候補を押したら、解析は使い回して書き出しまで自走する */
MC.ui.makeAnotherScene = cand => {
  if (!cand || MC.ui._busy || (MC.exporter && MC.exporter.running)) return;
  /* ★ 回数の門(⑭)。UIを差し替えるだけでなく実行側も塞ぐ ─
     古い画面や直接呼び出しから回数を踏み越えさせない */
  if (MC.ui.extraScenesLeft() <= 0) { MC.ui.renderSceneOffers(); return; }
  MC.ui._extraScenesMade = (MC.ui._extraScenesMade || 0) + 1;
  MC.ui.exportOverlay.close();          // 完成の全画面から自走の全画面へ
  const dc = MC.ui.$("#doneCard"); if (dc) dc.hidden = true;
  MC.ui.runAuto({ scene: { key: cand.key, t: cand.t } });
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

/* ★ 保存済みの前回状態(同期・カット割・範囲・モード)を静かに捨てる(2026-08-02 ⑪)。
   「意図してツールを出た」導線から呼ぶ ─ 次に来たときは最初から始める。
   resetProject と違い、いま開いている画面には触らない(出ていく途中なので) */
MC.ui.resetSavedProject = () => {
  try { localStorage.removeItem("marchcut_project"); } catch (_) {}
  MC.restoreInfo = { sync: 0, cuts: false, trim: false };
  /* ★ 書き出し済みファイルのOPFS実体もここで消す(2026-08-06 Safari容量調査)。
     「保存して閉じる」等の退出導線が releaseOpfs を呼ばず、8分書き出しなら
     732MBが起動時sweep(6時間据え置き)まで残留していた */
  MC.exporter.releaseOpfs();
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
  /* まっさらに戻したのに「◯◯は取り込めませんでした」が再表示されないように
     (2026-08-06 レビューP1。クリアは addFiles 冒頭とここの2箇所) */
  if (MC.media) MC.media._importNote = null;
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
       roleMax … 会員種別と端末の上限(2026-08-05: ゲスト30秒 /
                 登録×スマホ60秒 / 登録×パソコン10分 / 管理者は無制限) */
  const hardMax = MC.exporter.maxExportableSec();
  const roleMax = (window.MZ_LIMITS && MZ_LIMITS.maxExportSecFor)
    ? MZ_LIMITS.maxExportSecFor(MC.S.mode)
    : ((window.MZ_LIMITS && MZ_LIMITS.maxExportSec) || Infinity);
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
    + `今の範囲(${MC.ui.fmtTime(sec)})は、この端末では書き出せません</p>`
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

/* ★ おまかせは動画2本から(2026-08-02 優さん指示)。縦型/自動SW/ワイプの
   3種類とも多カメラが前提 ─ 1本では比べる相手も切り替える先も無い。
   写真・音声ファイルは数えない。こだわりはこの門を通らない(従来どおり) */
MC.ui.needSecondVideo = () =>
  !!MC.ui._autoFlow && MC.S.clips.filter(c => !c.isImage && !c.isAudio).length < 2;

MC.ui.focusNextAction = () => {
  if (!MC.S.clips.length) return;
  /* ★ おまかせを選んでいるなら、ここから先は一度も止まらない(2026-08-01 優さん指示)。
     取り込みが終わった時点で自走を始める ─ これが「タップせずに最後まで」の入口。
     二重に走らないよう、実行中と書き出し済みは弾く */
  if (MC.ui._autoFlow && !MC.ui._busy && !(MC.exporter && MC.exporter.running)
      && !MC.S.easyDone) {
    /* ★ 選び直しの保留(2026-08-02 優さん指示)。「動画を選び直す」で戻った人は
       外す/追加の途中で、素材が1回変わるたびにここが自走を再開すると、
       間違った動画を外した瞬間(まだ入れ替えていない)に走り出してしまう。
       再開は行動バーの「これでOK、おまかせを再開」が受け持つ */
    if (MC.ui._repickHold) return;
    /* ★ 1本では自走を始めない(2026-08-02 優さん指示)。素材工程に留まり、
       案内は取り込み枠の下の常設1行(renderClips)が受け持つ。
       2本目が入れば media.js がここをまた呼ぶので、自然に走り出す */
    if (MC.ui.needSecondVideo()) return;
    /* ★ 自走の前に「仕上げの好み」を1画面だけ(2026-08-03 優さん承認案。
       旧: ワイプだけの割り当て画面を3モード共通に拡張)。おすすめが選択済みで
       出るので、従来どおりなら「このまま進む」の1タップ。
       選び終わると finishPickGo が runAuto を呼び、以後は止まらない */
    if (MC.ui.needsFinishPick()) { setTimeout(() => MC.ui.openFinishPick(), 260); return; }
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
  /* 「仕上げの好み」も選び直し(2026-08-03。旧 wipePicked と同じ理屈)。
     動画が増減したら配置(どれをどの帯に/メインに)の前提が変わる。
     復元(restored)でも選び直してもらう ─ 配置は id で持っていて、
     id は読込ごとに振り直されるため */
  MC.S.finishPicked = false;
  /* 「同じ演奏ではない」2択の判断も素材が変わればやり直し(2026-08-02) */
  MC.S.syncDoubtAccepted = false;
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
  const roleMax = (window.MZ_LIMITS && MZ_LIMITS.maxExportSecFor)
    ? MZ_LIMITS.maxExportSecFor(MC.S.mode)
    : ((window.MZ_LIMITS && MZ_LIMITS.maxExportSec) || Infinity);
  const mmss = sec => {
    if (!isFinite(sec)) return "";
    const m = Math.floor(sec / 60), ss = Math.round(sec % 60);
    return ss ? `${m}分${String(ss).padStart(2, "0")}秒` : `${m}分`;
  };
  const icon = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i> ';
  /* ★ この文はいちばん最初の「動画を選ぶ」画面に出る(index.html:101)。
     だから言うべきは**取り込める長さ**であって、書き出しの上限ではない。
     ここを maxExportSec で書いていたため、ゲストのスマホでは
     読み込み画面に「3本まで・59秒まで」と出ていた ─ 取り込みは別枠なのに。
     地区大会レベルの顧問レビューで「意味が通らない」と指摘された(2026-07-31) */
  const srcMax = (window.MZ_LIMITS && MZ_LIMITS.maxSourceSec) || Infinity;
  if (isFinite(srcMax)) {
    /* 数字は limits.js の正式なラベルを使う(maxSourceSec は 1200.5 のように
       許容誤差ぶんの端数を持ち、そのまま出すと「20分01秒」になる)。
       ★ 言うのは「長くても入る」こと。使う範囲はあとで選べるので、
         ここで身構えさせない(2026-07-31 4団体レビュー) */
    const L2 = window.MZ_LIMITS;
    /* ★「長い録画でも構いません」は取り込みが20分あった頃の文(2026-08-05 改)。
       いまはスマホ5分・パソコン15分なので、8分半のランスルーはスマホに入らない。
       入らない人に「長くても構わない」と言うのは嘘なので、
       **その端末で本当のこと**だけを言い、伸ばす道があるならそれを添える */
    /* ★ 伸ばす道は MZ_LIMITS.sourceUpgradeHint() に聞く(2026-08-05 レビュー反映)。
       以前は `L2.mobile` だけを見ていたため、**ゲスト×パソコン**が
       「長い録画でも構いません」の枝に落ちていた ─ 実際は5分なので嘘。
       もう最大の人(登録×パソコン・管理者)にだけ「長くても構いません」と言う */
    const upgrade = L2.sourceUpgradeHint ? L2.sourceUpgradeHint() : "";
    el.innerHTML = icon
      + `<b>3本まで・1本${MC.ui.esc(L2.sourceLimitLabel)}まで</b>取り込めます。`
      + (upgrade ? MC.ui.esc(upgrade) : "長い録画でも構いません。")
      + "<b>どこを何分使うか</b>は、この後で選びます。"
      /* 端末のメモリで書き出しが頭打ちになる環境だけ、その理由も添える。
         ★ モードの天井が理由のときは、短さだけを告げない(2026-08-04 レビュー反映)。
           ここが上限との初対面なので、失う話(30秒)と得る話(高画質)を一緒に置く */
      + (isFinite(hardMax) && hardMax <= roleMax
          ? `（この端末で書き出せるのは${mmss(hardMax)}までです）`
          : (L2.modeCapped && L2.modeCapped(MC.S.mode))
            ? `（自動スイッチングはスマホでは${MC.ui.esc(L2.exportLimitLabelFor(MC.S.mode))}まで。`
              + "そのぶん高画質で書き出します）"
          : isFinite(roleMax)
            ? `（書き出せるのは${MC.ui.esc(L2.exportLimitLabelFor
                ? L2.exportLimitLabelFor(MC.S.mode) : L2.exportLimitLabel)}までです）` : "")
      /* ★ 登録で何が変わるかを、上限と同じ場所で言う(2026-08-06 高校生レビューP0:
         data-mz-plan撤去後、「登録すると60秒/別のシーン何本でも」が画面の
         どこにも出ていなかった ─ 制限だけ見せられて動機が無い)。
         自動SW×スマホ(登録しても30秒)とメモリ頭打ちの端末では言わない(嘘になる) */
      + (!L2.member && L2.memberExportLabel
          && !(L2.modeCapped && L2.modeCapped(MC.S.mode))
          && !(isFinite(hardMax) && hardMax <= roleMax)
          ? `<span class="hint">無料登録すると${MC.ui.esc(L2.memberExportLabel)}まで書き出せて、`
            + "完成後の「別のシーン」も何本でも作れます。</span>"
          : "");
    return;
  }
  /* 上限が外れている端末(手元の環境・管理者)。上限の話はこの1文に集約し、
     バッジの方を畳む(2026-07-28)。
     ★ 本数は上限なしでも3本まで(media.jsの門は会員種別で変わらない設計・
       2026-08-05 優さん指示)。前の文言「本数・長さの上限なし」は
       4本目で「素材は3つまでです」と食い違う嘘だった(2026-08-06 レビュー) */
  el.innerHTML = icon + "<b>3本まで・長さは上限なし</b>で取り込めます。";
  const badge = document.getElementById("adminLimitBadge");
  if (badge) badge.hidden = true;
};

/* renderFaceNote(顔の注意 + Privacy案内)は**丸ごと撤去**(2026-08-01 優さん指示
   「プライバシーのソフトの話は消せ」+「文字が多い」)。
   前回「管理者にだけ残す」と判断したが、優さん自身が管理者なので
   消えていなかった ─ 誰にも出さないのが指示の意味だった。
   同意の注意文も同時に削除(必要になったら優さんの判断で戻す)。
   関数ごと消す ─ 空関数で残すと、いつか誰かが中身を書き戻す */

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

/* ★ 全動画が重なっている区間(グローバル秒。2026-08-02 優さん指摘⑤)。
   各動画は offset〜offset+duration しか映せない。共通部分の外に窓を置くと、
   短い動画のカメラが「無い時間帯」なのにカット割に選ばれ、黒や凍った絵になる。
   引数の [s0,s1](演奏範囲)との交差を返す。動画が無ければ演奏範囲そのまま */
MC.ui.coverRange = (s0, s1) => {
  const vids = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  if (!vids.length) return [s0, s1];
  let lo = -Infinity, hi = Infinity;
  for (const c of vids) {
    const off = c.offset || 0;
    lo = Math.max(lo, off);
    hi = Math.min(hi, off + (c.duration || 0));
  }
  return [Math.max(s0, lo), Math.min(s1, hi)];
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
     45秒なら上限(60秒)に収まるので、本当は使える。 */
MC.ui.usablePresets = showLen => {
  /* ★ モード込みで聞く(2026-08-04)。自動スイッチング×スマホは30秒 */
  const all = (window.MZ_LIMITS && MZ_LIMITS.exportPresetsFor)
    ? MZ_LIMITS.exportPresetsFor(MC.S.mode)
    : ((window.MZ_LIMITS && MZ_LIMITS.exportPresets) ? MZ_LIMITS.exportPresets() : []);
  if (!all.length) return [];
  const hard = (MC.exporter && MC.exporter.maxExportableSec)
    ? MC.exporter.maxExportableSec() : Infinity;
  const roleCap = MZ_LIMITS.maxExportSecFor
    ? MZ_LIMITS.maxExportSecFor(MC.S.mode)
    : (MZ_LIMITS.maxExportSec == null ? Infinity : MZ_LIMITS.maxExportSec);
  const cap = Math.min(roleCap, hard);
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
  if (pick) return pick;
  /* ★ 管理者(上限なし)×スマホの既定は一般の登録者と同じ60秒(2026-08-06 優さん
     「秒数はユーザーなら選べるよね？管理者アカウントも同様にして」)。
     全札が開くため既定が「まるごと」になり、8分まるごと書き出し→自由度が
     10秒しか残らず別シーン候補が1枚だけ、という一般では起きない画面を
     管理者だけが見ていた。まるごとは選べば従来どおり使える(札は開いたまま) */
  const L = window.MZ_LIMITS || {};
  if (L.unlimited && L.mobile) {
    const same = open.filter(p => !p.whole && p.sec <= 60);
    if (same.length) return same[same.length - 1];
  }
  return open[open.length - 1] || list[0];
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
  /* ★ 開始位置の候補も「全動画が重なっている区間」から選ぶ(2026-08-02 ⑤)。
     ただし共通部分が選んだ長さを収められないときは従来の演奏範囲に戻す ─
     極端に短い動画1本のせいで、書き出し全体をその数秒へ押し込めない */
  const [c0raw, c1raw] = MC.ui.coverRange(s0, s1);
  const covered = (c1raw - c0raw) >= lenSec + 1;
  let [t0, t1] = covered ? [c0raw, c1raw] : [s0, s1];
  let roomSpan = s1 - s0;
  /* ★ 保険候補(sceneOffers の fb-)の t は**素材の実長**が土台で、検出された
     演奏範囲(s1)の外を指し得る。ここで従来の範囲へクランプすると、押した
     サムネと別の場面(検出狭窄時は前回と同じ場所)が書き出される
     (2026-08-06 レビューP0)。t が範囲の外を指すときだけ、保険の生成側と
     同じ土台(素材実長までの cover)へ範囲を広げて、約束した場面を守る */
  if (MC.S.startKey === "manual" && MC.S.startAt != null
      && (MC.S.startAt > t1 - lenSec || MC.S.startAt < t0)) {
    try {
      /* 広げ先は保険の生成側と同じ**素材の実長**(2026-08-06 交差説の撤回と同時に
         coverRange経由をやめた ─ 土台が2実装に割れると必ず片方が嘘になる)。
         ★ 前方向にも広げる(同日ログで確定した show狭窄=486..643 のケースでは、
           保険の「前半」候補 t は s0 より**手前**を指す。後ろだけ広げると
           snapToBeat の下限クランプが t を s0 へ引き戻し、押した場面と別の
           動画ができる ─ P0の三度目を作らない)。wide の判定式は生成側と同一 */
      const durAll = MC.timelineDuration ? MC.timelineDuration() : s1;
      const wide = (s1 - s0) < durAll * 0.5;
      const f0 = wide ? 0 : s0, f1 = Math.max(durAll, s1);
      if (f1 > t1 + 0.5 || f0 < t0 - 0.5) {
        t0 = Math.min(t0, f0); t1 = Math.max(t1, f1); roomSpan = t1 - t0;
      }
    } catch (e) { MC.log("applyLengthChoice広域: " + e.message); }
  }
  const cands = MC.highlight.candidates(audioClip, lenSec, t0, t1);
  /* 選ぶ余地があるか。候補の数ではなく**実際の自由度**で見る ─
     候補が1つしか作れない曲でも、余地があるなら自分で決められるべき */
  const room = roomSpan - lenSec;
  const canChoose = room > 1;
  let cand;
  /* 実長へ広げたか(保険候補のタップ)。広げていない通常フローと挙動を分ける */
  const widened = (t1 > s1 + 0.5) || (t0 < s0 - 0.5);
  if (MC.S.startKey === "manual" && canChoose) {
    const base = MC.S.startAt == null ? cands[0].t : MC.S.startAt;
    if (widened) {
      /* ★ 保険候補は**押した場面を守る**(2026-08-06)。t1-lenSec で頭打ちすると
         t が引き戻され、押したサムネと別の動画ができる。尻が足りない分は
         dur を縮める ─ 保険候補の dur と同じ縮め方 */
      const t = MC.highlight.snapToBeat(base, audioClip, t0, Math.max(t0, t1 - 10));
      MC.S.startAt = t;
      const mdur = Math.max(10, Math.min(lenSec, t1 - t));
      cand = { ...MC.highlight.MANUAL, t, dur: mdur, z: 0 };
    } else {
      /* ★ 通常フロー(広げていない)は**札の長さを守る**(2026-08-06 レビューP0:
         1分×手動440秒→ミドル2分に変えると、旧実装どおり開始を引き戻して
         きっかり2分を作る。「2分の札で70秒の動画」を作らない) */
      const t = MC.highlight.snapToBeat(base, audioClip, t0, Math.max(t0, t1 - lenSec));
      MC.S.startAt = t;
      cand = { ...MC.highlight.MANUAL, t, dur: lenSec, z: 0 };
    }
  } else if (MC.S.startKey === "best") {
    /* ★ おまかせの既定 = 「一番いいシーン」(2026-08-05 DCI協議)。
       採点(フィナーレ別格+payoff+arc)の1位を使う。
       ★ "climax" をここへ寄せてはいけない ─ ユーザーが開始位置の候補で
         「大盛り上がり」を明示的に選んだ場合も同じキーで、乗っ取りになる
         (QAが実際に捕まえた)。best はおまかせ専用キー */
    const bs = MC.highlight.bestScenes(audioClip, lenSec, t0, t1, 1);
    cand = bs[0] || cands[0];
  } else {
    cand = cands.find(c => c.key === MC.S.startKey) || cands[0];
  }
  MC.S.exportPreset = preset.id;
  MC.S.startKey = cand.key;
  MC.S.trimIn = cand.t;
  /* 尻は広げた範囲(t1)まで許す ─ s1 で切ると保険候補の終盤が短切れになる */
  MC.S.trimOut = Math.min(Math.max(s1, t1), cand.t + (cand.dur || lenSec));
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
  const nowLabel = (L.exportLimitLabelFor
    ? L.exportLimitLabelFor(MC.S.mode) : L.exportLimitLabel) || "";
  const title = `<p class="lun-title"><i class="fa-solid fa-lock" aria-hidden="true"></i> `
    + `「${MC.ui.esc(p.label)}」は、いまはまだ使えません</p>`;

  /* ★ モードの天井が理由のとき(2026-08-04 レビュー反映)。
     登録しても伸びないので登録は勧めない ─ ただし何も出さないと、
     押しても次の一手が無い行き止まりになる(他の理由のときは必ず
     「無料登録する」がある)。ここでは必ず3つを出す:
       ① なぜ短いのか(カメラを何台も同時に処理するから)
       ② そのぶん何が良いのか(高画質) ─ 損だけを突きつけない
       ③ 伸ばす道(パソコンで開く) ＋ そこへ行く手段(リンクをコピー)
     ★ 文言はカード側(limits.js)と重ねない。同じ一文を画面に3回出さない */
  if (L.modeCapped && L.modeCapped(MC.S.mode)) {
    el.innerHTML = title
      + `<p class="lun-body">カメラを何台も同時に処理するため、`
      + `スマホでは<b>${MC.ui.esc(nowLabel)}</b>までです。そのぶん高画質で書き出します。<br>`
      /* ★ 伸ばす道は limits.js に聞く(2026-08-05 レビュー反映)。
         「パソコンで開くと、もっと長く作れます」はゲストには嘘だった ─
         ゲストはパソコンでも30秒で、伸びるのは**登録 × パソコン**のときだけ */
      + `${MC.ui.esc(L.exportUpgradeHint ? L.exportUpgradeHint(MC.S.mode) : "")}</p>`
      + `<button type="button" class="lun-btn" id="lunCopyPc">`
      + `<i class="fa-solid fa-link" aria-hidden="true"></i>パソコン用にリンクをコピー</button>`;
    const cp = el.querySelector("#lunCopyPc");
    if (cp) cp.onclick = () => {
      /* iOS Safari はクリックと同じ流れで呼ばないと拒否する ─ await を挟まない */
      Promise.resolve(MC.ui._copyText(MC.ui.toolShareUrl())).then(ok => {
        MC.ui.toast(ok ? "リンクをコピーしました。パソコンで開けます"
                       : "コピーできませんでした。アドレスバーのURLをお使いください");
      });
    };
    return;
  }

  const needsPc = /パソコン/.test(p.unlock || "");
  el.innerHTML = title
    + `<p class="lun-body">${MC.ui.esc(p.unlock)}。`
    /* メモリの説明は OPFS の無い端末だけ(2026-07-31 5巡目P1)。
       採用基準の iOS16+ はOPFS対応=ストリーム書き出しでメモリ上限は外れており、
       登録×スマホが3分止まりの本当の理由はプランの壁。嘘をつかない */
    + (needsPc && !(MC.exporter && MC.exporter.opfsSupported && MC.exporter.opfsSupported())
        ? "この端末は動画を丸ごとメモリに載せるため、長い書き出しが途中で止まってしまいます。" : "")
    + `いまは<b>${MC.ui.esc(nowLabel)}</b>まで作れます。</p>`
    /* モードの天井が理由のときは上で返しているので、ここは「登録すれば伸びる」
       場合だけ。条件のコピーを増やさない(片方を直したときもう片方が嘘になる) */
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
  /* 720pの2割引き(×0.8)は廃止(2026-08-01 1080p統一)。解像度が同じになったので
     画質の差はビットレートだけ=書き出し時間はほぼ変わらない */
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

/* 別のシーンの開始位置(2026-08-06 優さん指示「00:56から / 2:35から など」)。
   fmtClock と分けたのは**分も2桁で揃える**ため ─ 候補が縦に3つ並ぶので、
   0:56 と 2:35 が混ざると数字の桁が揃わず、目で比べにくい。
   1時間を超える素材は h:mm:ss にする(60分超が 75:20 になると読めない) */
MC.ui.fmtStartAt = sec => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
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
MC.ui.JOURNEY_SECTIONS = { mat: "#dropSec", tilt: "#tiltSec", sync: "#syncSec",
  audio: "#audioSec", length: "#lengthSec", export: "#exportSec" };

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
      /* 音は単独の工程に戻した(2026-08-06 優さん指示)。同期の中の一手だと
         「試聴して選ぶ」という**耳を使う作業**が分析の続きに埋もれ、
         おまかせのまま素通りしていた。動画が1本なら選ぶ余地が無いので飛ばす */
      { id: "audio",  label: "使う音を選ぶ", shortLabel: "音", hint: "どの動画の音を使うかを試聴して選びます" },
      { id: "length", label: "長さと開始位置", shortLabel: "長さ", hint: "長さと開始位置を選びます" },
      /* 「画質を選んで」は削除(2026-08-03 12Mbps統一で選択肢ごと無くなった) */
      { id: "export", label: "書き出し",     shortLabel: "書出", hint: "動画を書き出します。色は気になるときだけ" },
    ],
    doneHint: "書き出し完了。調整して書き出し直すこともできます",
    /* 1画面1操作(デッキ式)になってから、画面に出ているパネルは常に1枚だけ。
       「見えているか」で判定すると現在地しか押せず、**戻る導線が全滅**する
       (2026-07-28 実測: 6枠中5枠が disabled)。到達済みかどうかで判定し、
       タップしたらその工程の画面へ切り替える(scrollIntoView は効かない) */
    canSelect: id => {
      const R = MC.ui.STEP_RANK;
      const reached = MC.ui._derivedPhase || "mat";
      /* 動画1本で音を飛ばした回は、その工程へ入れない(2026-08-06 レビューP2)。
         決めるものが無い画面へ行けてしまうと「何をすれば?」で止まる */
      if (id === "audio" && MC.ui._audioSkipped) return false;
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
      if (MC.ui._repickHold && MC.ui._autoFlow && MC.media.slotClips().length) {
        /* 選び直しから戻った人の再開ボタン(2026-08-02)。保留を解いて
           focusNextAction へ渡す ─ ワイプの割り当てが要る場合も正しい分岐を通る */
        conf = { label: "これでOK、おまかせを再開", icon: "fa-wand-magic-sparkles",
          act: () => { MC.ui._repickHold = false; MC.ui._viewPhase = null;
                       MC.ui.refreshJourney(); MC.ui.focusNextAction(); } };
      } else if (MC.ui._viewPhase === "mat" && R[reached] > R.mat) {
        conf = { label: "これでOK、続ける", icon: "fa-arrow-right",
          act: () => { MC.ui._viewPhase = null; MC.ui.refreshJourney(); } };
      } else {
        conf = { label: MC.ui.photosInvited() ? "動画・写真を選ぶ" : "動画を選ぶ",
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
    } else if (cur === "audio") {
      /* 使う音を選ぶ(2026-08-06 優さん指示で単独工程に戻す)。
         流儀は長さと同じ ─ 本体の決定ボタンが見えているときは重ねない */
      const db = MC.ui.$("#audioDecideBtn");
      if (!db) { bar.classList.remove("on"); document.body.classList.remove("mz-actionbar-on"); return; }
      const r = db.getBoundingClientRect();
      if (r.height > 0 && r.top < window.innerHeight - 70 && r.bottom > 0) {
        bar.classList.remove("on");
        document.body.classList.remove("mz-actionbar-on");
        return;
      }
      conf = { label: "この音で進める", icon: "fa-check",
        disabled: db.disabled, act: () => db.click() };
    } else if (cur === "sync") {
      const near = el => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.top < window.innerHeight - 70 && r.bottom > 0;
      };
      if (MC.ui._setupTab !== "pro" && !MC.S.easyDone) {
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
        conf = { label: "カメラの切り替え", icon: "fa-clapperboard",
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
  /* ★ 同期の完了から「音声を決めた」を外した(2026-08-06 優さん指示で単独工程に戻す)。
     同期は同期だけで完了し、音は音の工程で完了する */
  if (slot.length && synced) done.push("sync");
  /* ★ 通っていない工程に✓を付けない(2026-08-06 レビューP2)。動画1本のときは
     選ぶ余地が無いので工程ごと飛ばすが、飛ばした回を「決めた」とは記録しない ─
     すぐ上の傾き工程と同じ方針(嘘の✓を付けない)。入っても
     「おまかせ / 動画1」の2枚が同じことを2通りに言うだけなので、
     バーからも入れないようにする(canSelect が _audioSkipped を見る) */
  MC.ui._audioSkipped = !audioNeeded;
  if (slot.length && synced && MC.S.audioDecided) done.push("audio");
  if (slot.length && synced && audioDone && lengthDone) done.push("length");
  if (exported) done.push("export");
  /* ★ おまかせでは手動の傾き工程を見せない(2026-08-02 縦型2本の実機報告)。
     取り込み直後〜自走開始の間も current が "tilt" になり、renderTiltSec が
     プレビューを**1本目のソロ表示に固定**(soloId+ピン)+35%地点へシークしていた。
     ソロの解除は「次の工程へ移るとき」なので、おまかせの長い同期・解析の間
     ずっと1本目だけの静止画が主役に居座る ─ 「全部同じカメラで静止画のまま」の絵。
     おまかせの傾きは autoHorizon が自動で当てる(tiltSkipped)ので、この工程は不要。
     こだわり(proタブ)へ移った人には従来どおり出す */
  const tiltHands = !(MC.ui._autoFlow && MC.ui._setupTab !== "pro");
  let current = !slot.length ? "mat"
    : (!tiltDone && !MC.S.easyDone && tiltHands) ? "tilt"
    /* ★ 同期と音を分けた(2026-08-06 優さん指示)。同期が済んでいなければ sync、
       済んでいて音が未決なら audio で止める */
    : (vids.length >= 2 && !synced) ? "sync"
    : !audioDone ? "audio"
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
MC.ui.STEP_RANK = { mat: 0, tilt: 1, sync: 2, audio: 3, length: 4, export: 5 };
MC.ui.STEP_GROUPS = [
  { id: "mat",    panels: ["#dropSec"] },
  /* 傾きは単独の工程(2026-07-31 優さん指示)。1画面に1本ぶんだけを出し、
     動画1 → 動画2 → 動画3 と送る */
  { id: "tilt",   panels: ["#tiltSec"] },
  /* #easyPane を sync に載せる(2026-07-28)。おまかせの実際の操作＝「分析を開始」は
     この枠にあるのに、工程表に載っていなかったため applySteps が一切触れられず、
     分析が済んだあとも全工程に出続けていた。
     ★ #audioSec はここから出した(2026-08-06 優さん指示)。単独工程に戻す */
  { id: "sync",   panels: ["#syncSec", "#easyPane"] },
  /* 使う音を選ぶ(2026-08-06 優さん指示で単独工程に戻す)。試聴して耳で決める */
  { id: "audio",  panels: ["#audioSec"] },
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
  /* ★ 「入ったところか」は applySteps より**前**に取る(2026-08-06)。
     applySteps が _stepPhase を id に更新するので、後ろで見ると必ず一致し、
     入った時だけの処理が一度も走らない */
  const entering = MC.ui._stepPhase !== id;
  document.body.dataset.mzjPhase = id;
  document.querySelectorAll(".side .panel").forEach(p => p.classList.remove("phase-current"));
  const target = document.querySelector(MC.ui.JOURNEY_SECTIONS[id]);
  if (target) target.classList.add("phase-current");
  MC.ui.applySteps(id);
  /* 「長さと開始位置」は開いた時点で候補を作り直す。長さ・演奏範囲・上限の
     どれが変わっていても、画面に出ているものが必ず今の状態を指すようにする */
  if (id === "length") MC.ui.renderLengthSec();
  /* 音の工程に**入ったとき**だけ選択肢を描き直す(2026-08-06)。分析の結果
     (おすすめ・音量)はこの画面へ入る直前に確定するので、入った時点の状態を映す。
     ★ 毎回描き直すと renderAll → showPhase で二重に作り直し、
       キーボード操作中のフォーカスが飛ぶ(レビューP2)。工程が変わった時だけにする */
  if (id === "audio" && entering) MC.ui.renderAudio();
  /* 工程から出るときは試聴を止める。別の画面で音だけ鳴り続けるのを防ぐ */
  if (id !== "audio" && MC.ui._audioPhaseWasOn) MC.preview.pause();
  MC.ui._audioPhaseWasOn = (id === "audio");
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

/* ★ 写真を「誘っていいか」(2026-08-02 UI/UXレビュー)。おまかせは写真を
   取り込まない(media.addFiles の門番・setSetupTab の accept と同じ条件)のに、
   見出しとボタンが「動画・写真を選ぶ」のままだと、誘っておいて断る画面になる。
   文言もこの1つの判定に揃える */
MC.ui.photosInvited = () =>
  MC.S.mode === "vertical" && !(MC.ui._autoFlow && MC.ui._setupTab !== "pro");

/* 端末に残っている書き出しデータの控え(app.js が起動時に測って入れる)。
   2026-08-06 優さん実機、容量対策3度目 ─ 「消えるはず」を3度外したので、
   今度は**残量を画面に出して本人が消せる**ようにする */
MC.ui._storageAudit = null;
MC.ui.PURGE_MIN_BYTES = 300e6;   // これ未満は黙る(案内文を増やさない)

MC.ui.refreshStorageNote = async () => {
  MC.ui._storageAudit = await MC.exporter.opfsAudit();
  MC.ui.renderStorageNote();
};

MC.ui.renderStorageNote = () => {
  const box = MC.ui.$("#storageNote");
  if (!box) return;
  const a = MC.ui._storageAudit;
  if (!a || a.bytes < MC.ui.PURGE_MIN_BYTES) { box.hidden = true; box.innerHTML = ""; return; }
  const gb = a.bytes >= 1e9 ? (a.bytes / 1e9).toFixed(1) + "GB" : Math.round(a.bytes / 1e6) + "MB";
  box.hidden = false;
  box.innerHTML = `
    <div class="storage-note-body">
      <b class="storage-note-head">この端末に、作った動画のデータが ${gb} 残っています</b>
      <span class="storage-note-sub">保存ずみなら消して大丈夫です。iPhoneの空き容量が戻ります。</span>
    </div>
    <button type="button" class="btn small" id="storagePurge">消す</button>`;
  box.querySelector("#storagePurge").onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "消しています…";
    const r = await MC.exporter.purgeAll();
    if (r && r.busy) { MC.ui.toast("いま書き出し中です。終わってからもう一度お試しください"); }
    else if (r && r.ok) {
      const mb = r.freed >= 1e9 ? (r.freed / 1e9).toFixed(1) + "GB" : Math.round(r.freed / 1e6) + "MB";
      MC.ui.toast(`${mb} を消しました`);
    } else { MC.ui.toast("消せませんでした。Safariを一度終了してからお試しください"); }
    await MC.ui.refreshStorageNote();
  };
};

MC.ui.renderClips = () => {
  MC.ui.renderResumeNote();
  MC.ui.renderStorageNote();
  const box = MC.ui.$("#clipSlots");
  box.innerHTML = "";
  const vertical = MC.S.mode === "vertical";
  const withPhotos = MC.ui.photosInvited();
  /* 縦型は写真も入れられる。見出しの名詞をモードに合わせる(2026-07-23 B-4)。
     h2にはステップのチップが付くので、専用spanだけを書き換える */
  {
    const t = document.querySelector("#dropSec .drop-title");
    if (t) t.textContent = withPhotos ? "動画・写真を選ぶ" : "動画を選ぶ";
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
    /* こだわりは2本目から先が任意(1本でも成立する)。3本目だけに但し書きを
       付けると、2本目は必須のように読める(2026-08-01)。
       ★ おまかせは動画2本必須(needSecondVideoの門・2026-08-02)なのに
         「任意」のままだった ─ スマホ1台の人が「1本でいいのに動かない」と
         詰まる(2026-08-06 保護者レビューP1)。門と同じ判断で出し分ける */
    const secondNeeded = slotIdx === 1 && !!MC.ui._autoFlow;
    lb.innerHTML = `<i class="fa-solid fa-video"></i> ${noun}${slotIdx + 1}`
      + (secondNeeded ? ` <span class="hint">必要</span>`
         : slotIdx >= 1 ? ` <span class="hint">任意</span>` : "");
    slot.appendChild(lb);
    if (!c) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "clip-slot-add";
      btn.innerHTML = withPhotos
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
        <button type="button" class="btn small ghost clip-repick">
          <i class="fa-solid fa-rotate" aria-hidden="true"></i> この${c.isImage ? "写真" : "動画"}を選び直す</button>
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
        <div class="pan-row">被写体 <select class="target-sel select-mini" title="このカメラは何を撮ったか。選ぶと役割・出番へ展開します">
          ${MC.TARGETS.map(k => `<option value="${k.v}" ${MC.ui.axisInitial(c, "target") === k.v ? "selected" : ""}>${k.label}</option>`).join("")}
        </select></div>
        <div class="pan-row">固定or手持ち <select class="motion-sel select-mini" title="三脚/ジンバル/カメラマンのどれで撮ったか">
          ${MC.MOTIONS.map(k => `<option value="${k.v}" ${MC.ui.axisInitial(c, "motion") === k.v ? "selected" : ""}>${k.label}</option>`).join("")}
        </select></div>
        <details class="clip-fine">
          <summary>じぶんで微調整する</summary>
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
          </select>${MC.ui.rigBadge(c)}</div>
        </details>` : ""}
      </div>
      <button class="clip-remove" title="削除">✕</button>`;
    card.querySelectorAll(".nudge button").forEach(b =>
      b.onclick = () => MC.sync.nudge(c.id, parseFloat(b.dataset.n)));
    const listen = card.querySelector(".listen");
    if (listen) listen.onclick = () => MC.sync.listenCheck(c.id);
    const panEl = card.querySelector(".pan");   // おまかせでは出さないので必ず確かめる
    if (panEl) panEl.oninput = e => { c.pan = parseFloat(e.target.value); MC.saveState(); };
    /* 2軸(撮影対象・撮り方)。選んだら役割/出番/撮り方へ展開して描き直す。
       微調整セレクトを直接触っても2軸は戻さない ─ 展開は選んだ瞬間の1回だけで、
       実体は3セレクト(微調整)が勝つ */
    const onAxis = (field, value) => {
      c[field] = value;
      /* ★ 本人が触った印を必ず立てる(2026-08-06 レビューP1-1)。これが無いと、
         直後の renderClips が axisInitial 経由で**解析値へ表示を巻き戻し**、
         仕上げ画面を通ると finishPickGo が実データまで解析値で上書きする ─
         「手で選んだのに解析に上書きされる」穴が素材カード側に残っていた。
         「指定なし/自動判定」へ戻したときは印も下ろす(解析の提案が再び出る) */
      c[field + "ByUser"] = value !== "auto";
      MC.applyAxes(c, field);   // 変えた軸だけ展開(微調整の手動値を巻き込まない)
      MC.saveState();
      MC.ui.renderClips();
      if (field === "target" && (value === "front" || value === "altwide") && c.height > c.width) {
        MC.ui.toast("縦向きの動画です。全体に使うと左右が切れるため、隊形が読みづらいかもしれません");
      } else if (MC.S.cutList.length) {
        MC.ui.toast("カメラの属性を変えました。「自動カット割」で割り直せます");
      }
    };
    const targetSel = card.querySelector(".target-sel");
    if (targetSel) targetSel.onchange = e => onAxis("target", e.target.value);
    const motionSel = card.querySelector(".motion-sel");
    if (motionSel) motionSel.onchange = e => onAxis("motion", e.target.value);
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
    /* 間違った動画の入れ替え(2026-08-02 優さん指示)。右上の✕は小さくて
       気づかれなかった ─ 「外して選ぶ」の2手を、名前のついた1手にする。
       おまかせでは外した瞬間に focusNextAction が自走を再開してしまうので、
       先に保留を立てる(再開は行動バーの「これでOK、おまかせを再開」) */
    { const rp = card.querySelector(".clip-repick");
      if (rp) rp.onclick = () => {
        if (MC.ui._autoFlow && MC.ui._setupTab !== "pro") MC.ui._repickHold = true;
        MC.media.removeClip(c.id);
        MC.ui.$(vertical ? "#fileInputV" : "#fileInput").click();
      }; }
    /* 傾きバッジ → その動画から確認/再調整(2026-07-31 カード内タスク化) */
    const tb = card.querySelector("[data-tilt]");
    if (tb) tb.onclick = () => {
      const i = MC.ui.tiltCams().findIndex(x => x.id === c.id);
      MC.ui.openTilt(i >= 0 ? i : null);
    };
    slot.appendChild(card);
    box.appendChild(slot);
  }
  /* ★ 1本のときの常設の案内(2026-08-02 優さん指示)。トーストは流れて消えるので
     取り込み枠のすぐ下に置きっぱなしにする。2本目が入れば renderClips が
     呼び直されて自然に消える。責めない言い方・「2つ目」表記(漢字方針) */
  if (MC.ui.needSecondVideo() && slotClips.length >= 1) {
    const note = document.createElement("div");
    note.id = "needSecondNote";
    note.className = "need-second-note";
    note.innerHTML = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i> '
      + '2つ目の動画を選んでください（1本だけでは作れないため、そろったら自動で始まります）';
    /* ★ 置き場所は「動画1のカードの直下=動画2の空き枠の直上」(2026-08-02
       push前レビュー)。末尾に足すと空き枠2つ(動画2・動画3)より下に落ち、
       375px では折り目の下 ─ 次にすべき行動(動画2を選ぶ)の手前で読ませる */
    const emptySlot = firstEmptyIdx != null ? box.children[firstEmptyIdx] : null;
    if (emptySlot) box.insertBefore(note, emptySlot); else box.appendChild(note);
  }
  /* ★ 取り込めなかった理由の常設表示(2026-08-06 保護者レビューP0)。
     トーストは3.5秒で消え、まとめて選んだ人は読み切れない。
     文面は media.js(_importNote)が作る ─ 弾いた場所が理由を一番知っている。
     ★ 置き場所は needSecondNote と同じ理由で**最初の空き枠の直前**(2026-08-06
       レビューP1: 末尾だと0本取り込み時に空き枠3つの下=375pxの折り目の下)。
       両方出るときは原因(こちら)→次の行動(2つ目を選ぶ)の順 */
  if (MC.media && MC.media._importNote) {
    const note = document.createElement("div");
    note.id = "importNote";
    note.className = "need-second-note";
    note.innerHTML = MC.media._importNote;
    const anchor = box.querySelector("#needSecondNote")
      || box.querySelector(".clip-slot.empty");
    if (anchor) box.insertBefore(note, anchor); else box.appendChild(note);
  }
  /* 仕上げの好み画面が開いている間は、あとから完成するサムネイルを反映する
     (makeThumb → renderClips 経由でここへ来る。2026-08-02) */
  { const fp = MC.ui.$("#finishPick");
    if (fp && !fp.hidden) MC.ui.renderFinishPick(); }
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
  /* ★ 「おまかせ」を明示の選択肢にする(2026-08-06 優さん指示)。
     以前も audioPickedByUser=false なら自動でおすすめに追従していたが、
     画面のどこにも「おまかせ中」と出ていなかったため、
     選ばないまま進んだ人には**自分が何を選んだのか分からない**状態だった。
     選ぶと以後もおすすめに追従する(分析が変われば選ばれる音も変わる) */
  {
    const auto = document.createElement("label");
    const on = !MC.S.audioPickedByUser;
    auto.className = "audio-choice audio-choice-auto" + (on ? " selected" : "");
    /* 呼び名は下の動画カードと同じ規則にする(2026-08-06 レビューP2)。
       取り込んだ音声ファイルはカード側が「音声ファイル」に丸めるのに、
       ここだけ生のファイル名を出すと、同じものを2つの名前で呼ぶことになる */
    const recoName = !reco ? null
      : reco.isAudio ? "音声ファイル"
      : MC.S.slots.indexOf(reco.id) >= 0 ? `動画${MC.S.slots.indexOf(reco.id) + 1}`
      : MC.ui.shortName(reco.name);
    auto.innerHTML = `
      <input type="radio" name="audioClip" ${on ? "checked" : ""}>
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      <span>おまかせ</span>
      <span class="audio-stat">${reco ? `いま最も良い音: ${MC.ui.esc(recoName)}`
                                      : "分析するとここに選ばれた音が出ます"}</span>`;
    auto.querySelector("input").onchange = () => {
      MC.S.audioPickedByUser = false;      // 以後もおすすめに追従する
      const r = MC.audio.recommend();
      if (r) MC.S.audioClipId = r.id;
      MC.preview.applyMute();
      MC.ui.renderAudio();
    };
    box.appendChild(auto);
  }
  for (const c of cands) {
    const label = document.createElement("label");
    label.className = "audio-choice"
      + (MC.S.audioPickedByUser && MC.S.audioClipId === c.id ? " selected" : "");
    /* dB表記はやめた(2026-07-28 文言見直し)。「音量-14dB」は中高生に通じない。
       rms を3段の言葉に割る(-20dB相当=0.1 / -34dB相当=0.02 が境目) */
    const loud = r => r >= 0.1 ? "音が大きい" : r >= 0.02 ? "音は標準" : "音が小さめ";
    const stat = c.stats
      ? loud(c.stats.rms || 0)
      : (c.hasAudio === false ? "音声なし" : "分析するとここに音量が出ます");
    /* ★理由バッジ(2026-08-02 合意④): カード1枚に一言だけ。点数は出さない。
       おすすめ(選ばれたもの) > 音割れあり > 風の音あり の順で1つ。
       「音がわれています⚠」の文言はバッジへ一本化した(同じことを2回言わない) */
    const fl = MC.audio.flags(c.stats);
    const badge = reco && reco.id === c.id ? `<span class="reco-badge">おすすめ</span>`
      : fl.broken ? `<span class="reco-badge warn">音割れあり</span>`
      : fl.wind ? `<span class="reco-badge warn">風の音あり</span>` : "";
    /* 呼び名は「動画N」に統一(2026-08-01)。素材カードも傾きの画面も「動画N」なのに、
       ここだけ「カメラN」で、同じものを2つの名前で呼んでいた。
       プレビュー左下のバッジも同じ日に「動画N」へ揃えた */
    const slotIdx = MC.S.slots.indexOf(c.id);
    const dispName = c.isAudio ? "音声ファイル"
      : slotIdx >= 0 ? `動画${slotIdx + 1}` : MC.ui.shortName(c.name);
    label.innerHTML = `
      <input type="radio" name="audioClip" ${MC.S.audioPickedByUser && MC.S.audioClipId === c.id ? "checked" : ""} ${c.hasAudio === false ? "disabled" : ""}>
      ${c.isAudio ? '<i class="fa-solid fa-file-audio" title="取り込んだ音声ファイル"></i> ' : ""}<span>${MC.ui.esc(dispName)}${!c.isAudio && slotIdx >= 0 ? ` <span class="hint">${MC.ui.esc(MC.ui.shortName(c.name, 12))}</span>` : ""}</span>
      ${badge}
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

/* ---------- 書き出し画質の選択: 廃止(2026-08-03 優さん指示「12だけに統一」) ----------
   ビットレートは videoBitrate() が一律12Mbps(旧端末のメモリ例外3.8Mbpsのみ)。
   選択肢を出しても結果が変わらないので、迷いの種ごと画面から下ろす。
   枠(#qualityPicker)はHTMLに残して空+hidden にする ─ セレクタ依存(CSS/QA)を壊さない */
MC.ui.renderQualityPicker = () => {
  const host = MC.ui.$("#qualityPicker");
  if (host) { host.hidden = true; host.innerHTML = ""; }
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
    /* ★ 縦型・ワイプにカット割は無い(2026-08-05)。残っているものだけを言う */
    lead.innerHTML = '<span class="err"><b>'
      + (MC.S.mode === "switch" ? "同期・カット割・書き出し範囲" : "同期と書き出し範囲")
      + 'は残っています。</b>'
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
  /* 判定の正本は limits.js の proAllowed 1箇所(2026-08-02)。
     ここに条件をべた書きすると、2段目の選択カード側と規則が2実装に割れる */
  const guest = !L.proAllowed;
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
      /* ★ 足りないものを言い分ける(2026-08-02 ⑩ push前レビュー)。proAllowed が
         登録×PC になった結果、登録済み×スマホもここへ来る ─ その人に
         「無料登録で」と言うと、登録しても開かない嘘の約束になる */
      const L2 = window.MZ_LIMITS || {};
      MC.ui.toast((L2.member || L2.unlimited)
        ? "この設定はパソコンで使えます" : "この設定は無料登録で使えます");
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
    /* ★ 登録済み×スマホには登録リンクを出さない(2026-08-02 ⑩ push前レビュー)。
       この人に足りないのはパソコンで、登録ではない ─ showFlowLockNote と同じ出し分け */
    note.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i> '
      + ((L.member || L.unlimited)
        ? 'こだわり設定はパソコンで使えます。この端末では「使う音声」の選択だけ変更できます。'
        : 'こだわり設定は MarchinZ への登録とパソコンで使えます。'
          + 'ゲストは「使う音声」の選択だけ変更できます。 '
          + '<a href="/#signup">無料登録</a>');
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
  /* ★ おまかせでは写真は選べない(2026-08-02 優さん指示)。縦型のファイル選択の
     窓(#fileInputV)から image/* を外す。こだわりへ移ると戻す。ドラッグ&
     ドロップは accept を通らないので media.addFiles 側の番人と二段構え */
  { const fiv = MC.ui.$("#fileInputV");
    if (fiv) fiv.accept = (MC.ui._autoFlow && easy)
      ? "video/mp4,video/quicktime,.mp4,.mov,.m4v"
      : "video/mp4,video/quicktime,.mp4,.mov,.m4v,image/*"; }
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
  /* ★ おまかせから逃げてきた人は降格させない(2026-08-03 2巡目レビュー)。
     中止・失敗・「自分で仕上げる」でこだわりへ落ちた人は _autoFlow が立ったまま
     _setupTab="pro" になる。そこで動画を1本外すと
       resetEasyDone が _tabsForced を倒す → タブが隠れる → ここで pro→easy へ降格
     となり、needsFinishPick の「こだわりには挟まない」門が黙って開いて、
     おまかせ専用の全画面がかぶさっていた(実測: removeClip の600ms後に開く)。
     降格の役目は「タブが無い段で pro に閉じ込めない」ことなので、
     自分でこだわりを選んだ人(_autoFlow=false)にだけ効かせれば足りる。
     逃げてきた人はタブを出したままにして、閉じ込めも起こさない */
  if (tabs.hidden && MC.ui._setupTab === "pro") {
    if (!MC.ui._autoFlow) { MC.ui.setSetupTab("easy"); return; }
    tabs.hidden = false;   // pro のままにする以上、戻る道は見せ続ける
  }
  const lead = MC.ui.$("#setupTabsLead");
  if (lead) {
    /* ★ カット割を回すのは自動スイッチングだけ(2026-08-05)。
       縦型・ワイプで「カット割も自動で」と言うと、やらない仕事を約束することになる */
    lead.textContent = MC.ui._setupTab === "pro"
      ? "同期・レイアウト・仕上げを自分で決めます"
      : (MC.S.mode === "switch"
          ? "おまかせ＝同期もカット割も自動で仕上げます"
          : "おまかせ＝同期も色そろえも自動で仕上げます");
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
  /* 720pの2割引き(×0.8)は廃止(2026-08-01 1080p統一)。解像度が同じになったので
     画質の差はビットレートだけ=書き出し時間はほぼ変わらない */
  const expSec = showSec * expFactor;

  /* 1分未満は「1分ほど」に丸める。秒まで出すと正確に見えすぎる */
  const mins = (s) => Math.max(1, Math.round(s / 60));
  const anaMin = mins(anaSec), expMin = mins(expSec);
  const end = new Date(Date.now() + (anaSec + expSec) * 1000);
  const endTxt = `${end.getHours()}:${String(end.getMinutes()).padStart(2, "0")}頃`;

  el.hidden = false;
  el.innerHTML = `<i class="fa-solid fa-hourglass-half" aria-hidden="true"></i> `
    + `素材の分析におよそ<b>${anaMin}分</b>、書き出しにおよそ<b>${expMin}分</b>かかりそうです。`
    + `<span class="total-eta-sub">今始めると${endTxt}に終わる見込みです</span>`;   // 本数・尺は非表示(2026-07-24 優さん指示)
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
  /* 画質の表記は撤去(2026-08-03「12だけに統一」— 全員同じなので言う意味が無い) */
  el.innerHTML = '<i class="fa-solid fa-clapperboard" aria-hidden="true"></i> '
    + '<span><b>この見た目で書き出します</b>'
    + `範囲 ${MC.ui.fmtTime(range[0])}〜${MC.ui.fmtTime(range[1])}</span>`;
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

/* ============ 端末側から呼び戻す(2026-08-02 優さん指示) ============
   「ユーザにも終了時や選択が必要なときに、通知とバイブを」。
   おまかせは3〜5分かかる ─ その間、人は別のアプリを見ている。
   画面の中だけで完了を伝えても、画面を見ていない人には届かない。

   手段を3つ重ねる。どれか1つでも届けばいい、という構え:
     ①バイブ  ②通知(Notification)  ③タブのタイトル
   ★ iOS Safari は navigator.vibrate 非対応で、通知もホーム画面に追加した
     PWA でないと出ない。iPhoneが主戦場なのだから**どれにも頼らない** ─
     3つとも「使えたら使う」で、使えなければ黙って諦める(エラーは見せない)。
     画面内の表示(バナー・進捗ドック・完成画面)がいつでも正本。 */

/* バイブ。iOS Safari では何も起きないが、害も無いので呼ぶ */
MC.ui.buzz = pattern => {
  try { if (navigator.vibrate) navigator.vibrate(pattern || [80, 40, 80]); } catch (_) {}
};

/* タブのタイトル。裏で待っている人に、タブ一覧の文字だけで知らせる。
   ★ 元の題は1箇所に覚える。呼び出しごとに document.title を控えると、
     2回続けて鳴ったとき2度目が「✅…」を"元の題"として覚えてしまい、
     戻したつもりで通知文が残る */
MC.ui.flashTabTitle = text => {
  try {
    /* ★ 画面を見ている人のタブ題は書き換えない(2026-08-02 レビュー)。
       この合図は「裏で待っている人」だけのもので、見ている人には
       画面の中の表示(完成画面・完了バナー)が既に同じことを言っている。
       見ている人の題まで15秒書き換えるのは、伝わらないうえに紛らわしい */
    if (document.visibilityState === "visible") return;
    if (MC.ui._titleOrig == null) MC.ui._titleOrig = document.title;
    document.title = text;
    const restore = () => {
      if (MC.ui._titleOrig != null) document.title = MC.ui._titleOrig;
      MC.ui._titleOrig = null;
      document.removeEventListener("visibilitychange", onVis);
      clearTimeout(MC.ui._titleTm);
    };
    const onVis = () => { if (document.visibilityState === "visible") restore(); };
    document.addEventListener("visibilitychange", onVis);
    clearTimeout(MC.ui._titleTm);
    MC.ui._titleTm = setTimeout(restore, 15000);
  } catch (_) {}
};

/* OSの通知。**許可があるときだけ**出す。ここでは決して許可を求めない
   (求めるのは askNotifyPermissionOnce だけ)。iOS Safari には
   window.Notification 自体が無いので、機能検出で静かに諦める */
MC.ui.pushNotify = (title, body) => {
  try {
    const N = window.Notification;
    if (!N || N.permission !== "granted") return false;
    /* ★ 画面を見ている人にはOSの通知を出さない(2026-08-02 レビュー)。
       見ている人には完成画面がもう出ている ─ 同じことを窓の外からもう一度
       言うだけで、うるさいだけになる。呼び戻す相手は「離れている人」 */
    if (document.visibilityState === "visible") return false;
    const n = new N(title, { body: body || "", tag: "marchinz-switcher", icon: "/favicon.png" });
    n.onclick = () => { try { window.focus(); n.close(); } catch (_) {} };
    return true;
  } catch (_) { return false; }   // 通知APIが無い/使えない環境で例外を漏らさない
};

/* 許可を尋ねるのは「一度おまかせ(または分析)を始めた人」にだけ、一度きり。
   ★ 初回訪問でいきなり許可を求めるのは禁止(2026-08-02 優さん指示)。
     長い待ちに入ることが確定した瞬間＝この人にとって通知が役に立つと
     分かった瞬間にだけ尋ねる。断られたら二度と尋ねない */
MC.ui.NOTIFY_ASK_KEY = "mz_switcher_notify_asked_v1";
MC.ui.askNotifyPermissionOnce = () => {
  try {
    const N = window.Notification;
    if (!N || N.permission !== "default") return;    // 既に許可/拒否済みなら触らない
    if (localStorage.getItem(MC.ui.NOTIFY_ASK_KEY)) return;
    localStorage.setItem(MC.ui.NOTIFY_ASK_KEY, String(Date.now()));
    const r = N.requestPermission();
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (_) {}
};

/* 「あなたの番です」を端末から知らせる。長い処理が終わって**人を待つ**
   ところ、および全部が終わったところだけで呼ぶ。
   ★ おまかせの途中では絶対に呼ばない(silent)。以前「✅分析完了＝書き出せます」を
     自走の最中に出し、まだ5分残っているのに人を呼び戻した事故がある */
MC.ui.notifyUserTurn = (o) => {
  const opt = o || {};
  if (opt.silent) return false;
  MC.ui.buzz(opt.pattern);
  MC.ui.flashTabTitle(opt.tab || opt.title || "MarchinZ");
  MC.ui.pushNotify(opt.title || "MarchinZ", opt.body || "");
  return true;
};

/* ============ 失敗のお知らせ(2026-08-02 優さん指示「失敗時もお知らせして」) ============
   失敗も「終わり」の一種 ─ 人が戻ってこないと何も進まない。
   ★ おまかせの途中で黙る鉄則(silent)は**進行の通知**の話。失敗は進行ではなく
     終端なので、自走中でも知らせる(でなければ、失敗の大半が自走中に起きる以上
     「失敗時もお知らせ」が空文になる)。
   ★ 同じ失敗が2つの顔(おまかせ全画面と書き出し全画面)から届いても、
     2.5秒の窓で1回にまとめる ─ 失敗の連打ほど神経に障るものはない */
MC.ui.notifyFail = (o) => {
  const opt = o || {};
  const now = Date.now();
  if (now - (MC.ui._lastFailNotify || 0) < 2500) return false;
  MC.ui._lastFailNotify = now;
  return MC.ui.notifyUserTurn({
    kind: "fail",
    pattern: [180, 90, 180],   // 完了(短×2+長)と区別できる強めの2打
    title: opt.title || "うまくいきませんでした",
    body: opt.body || "MarchinZ Switcher に戻って、理由と次の一手をご確認ください",
    tab: opt.tab || "⚠ 失敗しました — MarchinZ",
  });
};

/* ============ ファンファーレ(2026-08-02 優さん指示「完了・保存のUIを楽しく」) ============
   数分待って出来上がった瞬間が、いままで文字が入れ替わるだけだった。
   紙吹雪(canvas)+短い和音+振動で「できた!」を体に返す。
   守るもの:
   ・prefers-reduced-motion では紙吹雪を出さない(既存方針)
   ・裏タブでは絵も音も出さない(見ていない画面で騒がない。通知が既に届いている)
   ・連打で重ねない(_fanfareOn)。2.2秒で必ず消える
   ・外部ライブラリなし。この節が実装のすべて */
MC.ui.fxVisible = () => !document.hidden;   // 試験が差し替える継ぎ目(document.hiddenは偽装できない)
MC.ui.motionOk = () => {
  try { return !window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch (_) { return true; }
};
MC.ui._fanfareStop = () => {
  const c = document.querySelector(".mz-fanfare-canvas");
  if (c) c.remove();
  MC.ui._fanfareOn = false;
};
MC.ui.fanfare = kind => {
  if (!MC.ui.fxVisible() || !MC.ui.motionOk() || MC.ui._fanfareOn) return false;
  const W = window.innerWidth, H = window.innerHeight;
  const cv = document.createElement("canvas");
  cv.className = "mz-fanfare-canvas";
  /* 全画面(z-120)の上・トースト級。pointer-events:none なので保存ボタンは普通に押せる */
  cv.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:998";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr);
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  /* MarchinZの色: ロゴの黄・ブランド青・OK緑+明るい差し色 */
  const COLORS = ["#f7c948", "#1e4fd6", "#2fa36b", "#5ab0ff", "#ff8a5c", "#ffffff"];
  const saved = kind === "saved";
  const n = saved ? 46 : 84;
  const parts = Array.from({ length: n }, (_, i) => {
    const a = (-90 + (Math.random() * 130 - 65)) * Math.PI / 180;   // 上向きの扇 ±65°
    const v = (saved ? 380 : 540) * (0.45 + Math.random() * 0.75);
    return {
      x: W / 2 + (Math.random() * 140 - 70),
      y: H * (saved ? 0.55 : 0.45),   // 保存は主ボタンのあたり、完了は画面中央から
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      w: 5 + Math.random() * 5, h: 8 + Math.random() * 7,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 12,
      c: COLORS[i % COLORS.length],
    };
  });
  const DUR = saved ? 1500 : 2200, G = 900;   // 重力は「ひらひら」より少し軽快に
  MC.ui._fanfareOn = true;
  let t0 = null;
  const step = ts => {
    if (!cv.isConnected) { MC.ui._fanfareOn = false; return; }   // 途中で片付けられたら黙って終える
    if (t0 == null) t0 = ts;
    const t = (ts - t0) / 1000, k = (ts - t0) / DUR;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;   // 終わりはふっと消える
    for (const p of parts) {
      const x = p.x + p.vx * t, y = p.y + p.vy * t + G * t * t / 2;
      if (y > H + 20) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot + p.vr * t);
      ctx.fillStyle = p.c;
      /* 高さを揺らすと紙が翻って見える(回転だけだと硬い) */
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.35 + 0.65 * Math.abs(Math.cos(t * 6 + p.rot))));
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(step);
    else MC.ui._fanfareStop();
  };
  requestAnimationFrame(step);
  return true;
};

/* ---- 効果音。外部ファイル無し、WebAudioのオシレータで合成 ----
   iOS Safari は AudioContext を**タップ起点でしか**作れない。wire() が
   最初のタップで unlock() を呼び、完了時(数分後)はその文脈で鳴らす。
   タブが裏なら鳴らさない(ready)。端末がサイレントなら鳴らないのは iOS の仕様として受け入れる */
/* 祝いの一式(絵と振動)。完了音は廃止(2026-08-05 優さん指示「音はもうなしでいい」) */
MC.ui.celebrate = kind => {
  MC.ui.fanfare(kind);
  /* 完了(done)の振動は showDone の notifyUserTurn が打つ。保存はここで短く */
  if (kind === "saved") MC.ui.buzz([40, 30, 90]);
};

/* ============ 分析完了の目立つ通知(2026-07-23 優さん指示) ============
   ①バイブ ②通知 ③タブのタイトル(ここまで notifyUserTurn)
   ④画面内の大きな完了バナー(タップで消える)。四重にして見逃しを防ぐ */
MC.ui.notifyAnalysisDone = (opt) => {
  /* ★ おまかせの最中は黙る(2026-08-01 レビュー14件)。ここは分析が済んだだけで、このあと
     書き出しが数分続く。完了バナー自体は全画面(z-index 130)の下に隠れるが、
     **バイブとタブのタイトルは端末に届いてしまう**ので、別アプリへ行っていた
     人を「もう終わった・書き出せます」と勘違いさせて呼び戻していた。
     しかも押すべきボタンはおまかせが自分で押す。
     おまかせ本来の完了は、書き出しが終わった時に1回だけ出る */
  /* バイブ・通知・タブ題は共通の1本(notifyUserTurn)へ寄せた(2026-08-02)。
     silent の判断もそちらが持つ ─ 同じ規則を2実装に割らない */
  if (opt && opt.silent) return;
  MC.ui.notifyUserTurn({
    title: "分析が終わりました",
    body: "MarchinZ Switcher に戻って、動画を書き出してください",
    tab: "✅ 分析完了 — 書き出せます",
  });

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
  startKey: "best",       // 一番いいシーン(2026-08-05 DCI協議の採点1位)
  filterId: "marchinz",   // MarchinZカラー(=「仕上げの好み」のおすすめ)
  cutLevel: 2,            // 切り替えは「おすすめ」(同上)
};

/* おまかせで決め打ちにする設定を当てる。呼ぶのは自走の入口だけ */
MC.ui.applyAutoChoices = () => {
  MC.S.exportPreset = MC.ui.AUTO.preset;
  MC.S.startKey = MC.ui.AUTO.startKey;
  MC.S.startAt = null;
  MC.S.horizonOn = true;
  /* ★ 色と切替頻度は「仕上げの好み」(2026-08-03 優さん承認案)が受け持つ。
     あの画面は毎回の新規おまかせで**おすすめから**選び直させて明示的に
     入れ直すので、finishPicked が立っている間はここで上書きしない
     (ナチュラルを選んだ直後に marchinz へ戻す事故の防止)。
     立っていない経路(画面を通らず runAuto へ来た保険)では従来どおり
     決め打ちへ戻す ─ 完成画面の「別設定で作成」(openRemakeSettings)で選んだ
     頻度が localStorage に残り、リセットや再訪のあとの新規おまかせまで
     「多め/少なめ」を黙って引き継ぐ穴(2026-08-03 push前レビュー)はこれで
     塞いだまま。作り直し(scene 付き)はこの関数を通らないので±1は生きる */
  if (!MC.S.finishPicked) {
    MC.S.filterId = MC.ui.AUTO.filterId;
    MC.S.colorOn = true;
    MC.S.cutLevel = MC.ui.AUTO.cutLevel;
    MC.S.autoTilt = true;   // 画面を通らなかった保険の経路では既定ONへ戻す
  }
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

/* 「そのまま」を選んだときに、前の回 autoHorizon が入れた角度を戻す。
   ★ 検出をやめるだけでは足りない ─ clip.rot は保存され、horizonOn は常にONなので、
     放っておくと「そのまま」を選んだ人の映像が前回のとおり回り続ける。
   ★ 戻すのは**本人が見ていない自動値だけ**。tiltOk はこだわりで本人が確認した印で、
     autoHorizon は立てないので、手で直した値はここでは消えない。
   戻した本数を返す。 */
MC.ui.dropAutoTilt = () => {
  let n = 0;
  for (const c of MC.ui.tiltCams()) {
    if (!c.tiltOk && c.rot) { c.rot = 0; n++; }
  }
  return n;
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
  /* ★ 4K素材の縮小(変換)の見込みを足す(2026-08-07 レビューP0)。
     入れないと4Kで「あとおよそ1分」のまま数分待たせる。係数は
     フル再エンコードの粗い実測見込み(iOSは実時間の0.7倍/本、PCは0.25) */
  let proxySec = 0;
  if (MC.ui.willBuildProxy && MC.ui.willBuildProxy()) {
    for (const c of clips) {
      if (MC.proxy.usable(c)) continue;
      const sp = MC.proxy.specFor(c);
      if (sp) proxySec += (sp.t1 - sp.t0) * (MC.isIOS ? 0.7 : 0.25);
    }
  }
  return ana + proxySec + lenSec * exp;
};

/* ============ おまかせ専用の1画面(2026-08-01 優さん指示) ============
   「完全にUIを分けて。1つの画面だけに。何をしてるかがわかる。
     プレビューがわかるように。できていってる！がわかる楽しいUI」

   ★ プレビューは**同じ canvas を移す**(複製しない)。preview.js は
     this.canvas の参照で描き続けるので、DOM上の親が変わっても絵は流れる。
     複製すると2枚を毎フレーム描くことになり、iPhoneでは倍の負荷になる。
     終わったら必ず元の場所へ戻す ─ 戻し忘れるとプレビューが消える */
/* おまかせ全画面の「何を預けたか」。固定文だと、仕上げの好みで選んだ内容と
   食い違う(ナチュラルを選んでも「MarchinZカラー」と出ていた) */
MC.ui.autoWhatText = () => {
  /* ★ 長さは固定文にしない(2026-08-05 レビュー反映)。ゲストは30秒・
     自動スイッチング×スマホも30秒なのに「60秒のハイライト」と出続けていた。
     数分待たせる全画面の一等地なので、その人・その端末・そのモードの値で言う
     (#flowEasyDesc は同じ理由で直したが、ここが取り残されていた) */
  const L = window.MZ_LIMITS;
  /* 実際に切り出す長さが決まっていればそれを言う。まだなら、その人・その端末・
     そのモードの上限で言う(どちらも無ければ長さには触れない) */
  const span = MC.trimRange ? (() => { const [a, b] = MC.trimRange(); return b - a; })() : 0;
  const lenLabel = (span > 0 && MC.ui.fmtLen)
    ? `${MC.ui.fmtLen(span)}のハイライト`
    : (L && L.exportLimitLabelFor)
      ? `${L.exportLimitLabelFor(MC.S.mode)}のハイライト` : "見どころ";
  const parts = [lenLabel, "盛り上がるところから"];
  parts.push(MC.S.filterId === "none" ? "撮ったままの色" : "MarchinZカラー");
  if (MC.S.autoTilt === false) parts.push("傾きはそのまま");
  return parts.join("・");
};

MC.ui.autoStage = {
  /* 段の重み。実測の所要に近い比率にしておくと、バーが等速に見える */
  /* 段の名前は2つ持つ。いま動いている間は「何をしているか」、
     済んだら「何ができたか」。できた実感は動詞ではなく成果から出る */
  /* 出しうる段の全部。実際に出す分は open() が STEPS へ組み直す
     (傾きを直さない設定なら「傾きを直す」を出さない ─ やらない仕事の
      チェックが点くのは嘘になる) */
  ALL_STEPS: [
    { key: "tilt",   label: "傾きを直す",         done: "傾きを直しました",     w: 12 },
    { key: "sync",   label: "音を合わせる",       done: "音がそろいました",     w: 10 },
    { key: "audio",  label: "良い音を選ぶ",       done: "良い音を選びました",     w: 2 },
    { key: "scan",   label: "見どころを探す",      done: "見どころが決まりました", w: 16 },
    /* ★ 4K素材の縮小(2026-08-07 レビューP0)。段が無いと、変換の数分間
       「色をそろえる」等に丸が付いたまま止まって見える(優さん実機で実証)。
       走らないときは open() が段ごと落とす(嘘のチェックを点けない) */
    { key: "proxy",  label: "映像を軽くする",      done: "映像を軽くしました",    w: 10 },
    /* ★ finish 段の名前と重みはモードで変わる(2026-08-05 優さん決定)。
       中身は runEasyFinish で、カット割(director)を回すのは
       **自動スイッチングのときだけ**(ui.js の `mode === "switch"` の枝)。
       縦型・ワイプは色そろえしか走らないのに「カメラを切り替える」と名乗り、
       しかも全6段でいちばん重い w:30 を占めていた ─ 名前も進み方も嘘だった。
       ワイプも director を通らない(layout.js「カット割・シーン分析なし」)。
       ★ 0段のとき(色オフ・動画1本)は open() が段ごと落とす。
         やらない仕事のチェックが点くのは嘘、という上の方針をここでも守る */
    { key: "finish", label: "カメラを切り替える",   done: "カメラ割りができました", w: 30 },
    { key: "export", label: "動画を書き出す",      done: "書き出しました",       w: 30 },
  ],
  STEPS: [],   // open() で ALL_STEPS から組む
  _done: [], _now: null, _home: null,
  /* _sub=いま動いている段の補足 / _doneSub=済んだ段の成果 / _inner=段の中の進み具合
     _fail=失敗の顔を出しているか / _prevFocus=開く前にフォーカスがあった要素 */
  /* _innerRaw=段の中の**素の**割合(0..1)。_inner は全体バーの見え方を整えるため
     0.8 で頭打ちにしてあるので、%として出すと嘘になる。プレビューの円の進捗
     (preview.js の busyLabel)はこちらを見る(2026-08-01 優さん指示の12時の輪) */
  _sub: null, _doneSub: {}, _inner: 0, _innerRaw: 0, _fail: null, _prevFocus: null,
  /* _failedStep=どの段で止まったか / _wakeWarn=消灯の警告(0=無 1=断られた 2=非対応) */
  _failedStep: null, _wakeWarn: 0,

  open() {
    const el = MC.ui.$("#autoStage");
    if (!el || !el.hidden) return;
    /* ★ _sub / _doneSub / _inner / _fail も戻す(2026-08-01 レビュー14件)。
       _sub を戻していなかったため、前の段の文字が次の段に居座っていた
       (「カメラを切り替える  音を読み込み中 100%」のような表示) */
    /* 段は開くたびに組み直す。傾きを直さない設定ならその段は出さない */
    this.STEPS = this.ALL_STEPS
      .filter(s => s.key !== "tilt" || MC.S.autoTilt !== false)
      /* finish は「実際に走る仕事」で名前・重みを決め、0段なら出さない */
      .filter(s => s.key !== "finish" || MC.ui.finishSteps() > 0)
      .filter(s => s.key !== "proxy" || (MC.ui.willBuildProxy && MC.ui.willBuildProxy()))
      /* ★ 本人がもう音を選んでいるなら「良い音を選ぶ」は出さない(2026-08-07 優さん指示)。
         選び済みのときこの段がするのは「本人の選択をそのまま採用する」だけで、
         選んでいないときの採点(autoPickAudio)は走らない ─ 決めることが何も
         残っていないのに工程だけ並ぶのは、この画面の「やらない仕事のチェックが
         点くのは嘘」という方針に反する。
         ★ 選んだ動画が無音だった場合は runEasy が自動選択へ落とすが、そのときは
           トーストで事実を伝えるので、段が無くても黙って変わることにはならない */
      .filter(s => s.key !== "audio"
        || !(MC.S.audioPickedByUser && MC.getClip(MC.S.audioClipId)))
      .map(s => (s.key === "finish" && MC.S.mode !== "switch")
        ? { ...s, label: "色をそろえる", done: "色がそろいました", w: 10 }
        : s);
    this._done = []; this._now = null;
    this._sub = null; this._doneSub = {}; this._inner = 0; this._innerRaw = 0; this._fail = null;
    this._failedStep = null; this._wakeWarn = 0; this._ask = false;
    el.classList.remove("as-failed", "as-complete", "as-asking");
    { const ask = MC.ui.$("#asAsk"); if (ask) ask.hidden = true; }
    const wt0 = el.querySelector(".as-wait"); if (wt0) wt0.hidden = false;
    const fb = MC.ui.$("#asFail"); if (fb) fb.hidden = true;
    const cb = MC.ui.$("#asCancel");
    if (cb) { cb.hidden = false; cb.disabled = false; cb.textContent = "やめる"; }
    /* 「動画を選び直す」も同じ寿命で出し入れする(2026-08-02 優さん指示) */
    { const rp = MC.ui.$("#asRepickRun"); if (rp) { rp.hidden = false; rp.disabled = false; } }
    /* canvas を全画面のプレビュー枠へ移す。戻す場所を覚えておく */
    const cv = document.getElementById("cv");
    const host = MC.ui.$("#asPreview");
    if (cv && host) { this._home = cv.parentElement; host.appendChild(cv); }
    { const w = MC.ui.$("#asWhat");
      if (w) w.textContent = MC.ui.autoWhatText(); }
    el.hidden = false;
    document.body.classList.add("mz-auto-stage");
    /* 解析中の全ミュートの正本(preview.applyMute が見る)。class ではなく
       ここを見る ─ 順序で意味が反転しないように(2026-08-06 レビューP1) */
    this._analyzing = true;
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
    /* ★ 解析の印を**先に**下ろす(2026-08-06 レビューP2×2)。下ろす前に
       applyMute を呼ぶと「音の割り当てを元へ」どころか全ミュートを塗り直す */
    this._analyzing = false;
    try { MC.preview.pause(); MC.preview.applyMute(); } catch (e) {}   // 音の割り当てを元へ
    const cv = document.getElementById("cv");
    if (cv && this._home) this._home.appendChild(cv);   // 必ず戻す
    this._home = null;
    el.hidden = true;
    document.body.classList.remove("mz-auto-stage");
    el.classList.remove("as-failed", "as-complete", "as-asking");
    this._fail = null; this._failedStep = null; this._ask = false;
    const ask = MC.ui.$("#asAsk"); if (ask) ask.hidden = true;
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
    this._innerRaw = 0;   // 段が変われば「段の中の%」も 0 から数え直す
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
    /* 中止は1回でいい。もう片方の止めるボタンも同時に眠らせる(2026-08-02) */
    { const rp = MC.ui.$("#asRepickRun"); if (rp) rp.disabled = true; }
    const head = MC.ui.$("#asHead"); if (head) head.textContent = "やめています…";
    const eta = MC.ui.$("#asEta");
    if (eta) eta.textContent = "今動いている処理が止まるまで少し待ちます";
  },
  /* ============ 「同じ演奏ではないようです」の2択(2026-08-02 優さん指示) ============
     失敗の顔と同じ場所(全画面のまま)で止まり、
     ①同期なしでそのまま並べて作る ②動画を選び直す ─ を本人に返す。
     doubt = sync.run が返した [{name, conf}]。
     判断待ちなので notifyUserTurn(silent なし)に乗せる ─ 同期は数分かかることが
     あり、別アプリへ行った人はここで止まっていることに気づけない */
  askSync(doubt) {
    const el = MC.ui.$("#autoStage");
    if (!el || el.hidden) return;
    this._ask = true;
    this._failedStep = this._now;
    this._now = null;                       // 進行中の脈と「…」を止める(fail と同じ理由)
    el.classList.add("as-asking");
    const head = MC.ui.$("#asHead"); if (head) head.textContent = "確認してください";
    const eta = MC.ui.$("#asEta"); if (eta) eta.textContent = "";
    const wt = el.querySelector(".as-wait"); if (wt) wt.hidden = true;
    const wk = MC.ui.$("#asWake"); if (wk) wk.hidden = true;
    const c = MC.ui.$("#asCancel"); if (c) c.hidden = true;
    /* 2択の箱の中に自前の「動画を選び直す」があるので、下の常設は引っ込める */
    { const rp = MC.ui.$("#asRepickRun"); if (rp) rp.hidden = true; }
    const names = (doubt || []).map(d => MC.ui.shortName(d.name)).join(" / ");
    const msg = MC.ui.$("#asAskMsg");
    if (msg) msg.textContent = (names ? `「${names}」は、` : "")
      + "同じ演奏を撮った動画ではないようです（音が一致しません）。";
    const box = MC.ui.$("#asAsk"); if (box) box.hidden = false;
    MC.ui.notifyUserTurn({
      title: "同じ演奏の動画か確認してください",
      body: "音が一致しませんでした。MarchinZ Switcher に戻って、進め方を選んでください",
      tab: "🔔 確認してください — MarchinZ",
    });
    this.render();
    try { el.scrollTop = 0; } catch (e) {}
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
    /* ★ 失敗も端末から知らせる(2026-08-02)。自走中でも鳴らす ─ 失敗は進行ではなく
       **終端**で、人が戻らないと何も進まない。「途中では鳴らさない」鉄則は
       進行の通知(notifyUserTurn の silent)の話であって、止まったことは別 */
    MC.ui.notifyFail({
      title: "うまくいきませんでした",
      body: "MarchinZ Switcher に戻って、もう一度やるか自分で仕上げるかを選べます",
      tab: "⚠ うまくいきませんでした — MarchinZ",
    });
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
    /* ★ 「この失敗の記録」ごと管理者だけに(2026-08-02 ⑫)。一般ユーザーには
       上の asFailMsg(理由)と asFailHint(次の一手)だけを見せる */
    { const det = MC.ui.$("#asFailDetails"); if (det) det.hidden = !MC.ui.isAdmin(); }
    const c = MC.ui.$("#asCancel"); if (c) c.hidden = true;
    /* 失敗の顔の選択肢は「もう一度/自分で仕上げる」の2つに絞ってある。
       常設の「動画を選び直す」も同じ理由で引っ込める(2026-08-02) */
    { const rp = MC.ui.$("#asRepickRun"); if (rp) rp.hidden = true; }
    this.render();
    try { el.scrollTop = 0; } catch (e) {}   // 失敗の顔を必ず視野へ
  },
  /* 全部済んだ瞬間。ここが 5〜9分かけた仕事の**完成の顔**で、
     このあと 700ms だけ見せてから畳まれる。バーを緑へ変え、%を100で止める ─
     青いまま消えると「途中で畳まれた」ようにしか見えない(2026-08-01) */
  finishAll() {
    this._done = this.STEPS.map(s => s.key);
    this._now = null; this._sub = null; this._inner = 0; this._innerRaw = 0;
    const el = MC.ui.$("#autoStage"); if (el) el.classList.add("as-complete");
    this.render();
  },

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
    if (eta && !this._fail && !this._ask) eta.textContent = MC.ui.autoSub ? MC.ui.autoSub() : "";
    const cur = this.STEPS.find(s => s.key === this._now);
    const head = MC.ui.$("#asHead");
    /* ★ 2択(_ask)の間も head を上書きしない(2026-08-02)。askSync が
       「確認してください」を書いた直後に render が _now=null を見て
       「完成しました」へ戻し、判断待ちの画面が完成の顔をしていた */
    if (head && !this._fail && !this._ask) head.textContent = this._now ? cur.label + "…" : "完成しました";
    /* 段が変わったときだけ1行読み上げる。リスト全体に aria-live を張ると、
       0.5秒ごとの再描画で6項目を延々と読み直す(沈黙より悪い) */
    const say = MC.ui.$("#asSay");
    if (say) {
      const line = this._fail ? "うまくいきませんでした"
        : this._ask ? "確認してください"
        : this._now ? cur.label : "完成しました";
      if (say.textContent !== line) say.textContent = line;
    }
    /* ★ 画面が消えると自走ごと落ちる(2026-08-01 実機)。
       低電力モードだと iPhone は消灯の抑止を断るので、こちらでは止められない。
       できるのは「直し方を伝えること」だけ。開始直後は取得中のことがあるので、
       少し様子を見てから出す(出したり消えたりさせない) */
    const wk = MC.ui.$("#asWake");
    if (wk && !this._fail && !this._ask) {
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
        /* ★ awake も見る(2026-08-02 レビュー実測)。v1.75.0 で「仕組みが無い端末」
           にも代役の無音動画が立つようになったのに、ここが API の有無だけで
           判定していたため、代役で実際に画面が点いたままの端末(iOS 16.0〜16.3等)
           にまで「画面が消えると止まります」が出ていた。警告は
           「本命も代役も両方だめ」のときだけ ─ session.js 側の設計と揃える */
        else if (!("wakeLock" in navigator) && !S2.awake) this._wakeWarn = 2;
      }
      /* 設定アプリの手順は iPhone のものなので、iPhone にだけ出す */
      /* ★ 文言は「責めない予告形」へ(2026-08-02 優さん指示③)。
         「この端末では〜止められませんでした」は失敗の宣告で、まだ何も
         起きていない人を不安にさせるだけだった。起きたときの直し方だけを言う */
      const t = this._wakeWarn === 1
        ? (MC.isIOS
            ? "途中で画面が暗くなる場合は、設定 → 画面表示と明るさ → 自動ロック を長めにしてください"
            : "途中で画面が暗くなる場合は、ときどき画面を触ってください")
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

/* 「同じ演奏を撮った動画ではないようです」(2026-08-02)。失敗ではなく判断待ちの印。
   doubt = sync.run の返した [{name, conf}] */
MC.ui.SyncDoubt = class extends Error {
  constructor(doubt) {
    super("同じ演奏を撮った動画ではないようです");
    this.name = "SyncDoubt";
    this.doubt = doubt || [];
  }
};

/* ============ 仕上げの好み(2026-08-03 優さん承認案) ============
   おまかせで動画を選んだあと、自走の前に**1画面だけ**挟む選択。
   旧 #wipePick(ワイプだけのメイン/右下の割り当て)はここへ統合した ─
   二重の選択画面は作らない。
   ・共通: 色 = シネマティック(MarchinZカラー・既定✓) / ナチュラル(色補正なし・
     カメラ間の色合わせのみ)。既存の filterId/colorOn に接続し、新しい色処理は作らない
   ・縦型: カメラの配置(どの動画をどの帯に)
   ・自動スイッチング: 切り替えの多さ3段階(既存 cutLevel 1〜3)
   ・ワイプ: メイン/右下/左下の割り当て(旧 wipePick と同じタップ順)
   おすすめが選択済みで出て、「このまま進む」1タップで従来と同じ結果のまま
   自走が始まる(タップ0回の哲学)。状態は既存フラグ(slots・wipe系・cutLevel・
   filterId)に載せ、増やすのは「選び終わったか」(S.finishPicked・非永続)の1つだけ */
/* ★ こだわり(pro)には挟まない(2026-08-03 レビュー)。v1.85.0 の needsWipePick は
   先頭が `mode === "wipeCam"` だったので、こだわりへ落ちた人には事実上かからなかった。
   3モード共通にした v1.86.0 で門が `_autoFlow` だけになり、対象が3倍に増えている。
   ところが _autoFlow は「こだわりへ逃がす」3経路(中止・失敗・自分で仕上げる)の
   どれでも倒れないので、こだわりで作業中に動画を1本外しただけで
   resetEasyDone → focusNextAction → おまかせ専用の全画面がかぶさり、
   見ていたプレビューまで止まっていた(実測)。
   判定は refreshJourney の傾き工程(_setupTab を見る)と同じ作法に揃える */
MC.ui.needsFinishPick = () =>
  !!MC.ui._autoFlow && MC.ui._setupTab !== "pro" && !MC.S.finishPicked
  && MC.S.clips.filter(c => !c.isImage && !c.isAudio).length >= 2;

/* 配置カードの候補。縦型は帯に写真も置けるのでスロット素材ぜんぶ、
   ワイプは動画だけ(画像・音声のみは小窓にできない)。スロットは3つまで */
MC.ui.finishCards = () => {
  const s = MC.media.slotClips();
  return (MC.S.mode === "vertical" ? s : s.filter(c => !c.isImage)).slice(0, 3);
};

/* 帯/役の名前(タップした順にこの役へ入る)。切り替え(switch)は配置なし。
   ★ 2本と3本で語を揃える(2026-08-03 レビュー)。まん中を指す語が 中/中央 で
     揺れていた。2本目は上と下の**両方**に入るので「上か下のどちらか」に
     読まれないよう「上と下」と書く */
MC.ui.finishRoles = () => {
  const n = MC.ui.finishCards().length;
  if (MC.S.mode === "wipeCam") return n >= 3 ? ["メイン", "右下", "左下"] : ["メイン", "右下"];
  if (MC.S.mode === "vertical") return n >= 3 ? ["上", "中", "下"] : ["中", "上と下"];
  return [];
};

/* おすすめの割り当て=今日までの自動の既定と同じ並び(既定1タップ=従来と同じ結果)。
   ワイプ=メイン既定(wipeMain)→小窓1→小窓2 / 縦型3本=スロット順 /
   縦型2本=[中(slots[1]=1本目), 上と下] (media.afterChange の既定と同じ形) */
MC.ui.finishDefaultOrder = () => {
  const ids = MC.ui.finishCards().map(c => c.id);
  let pref = [];
  if (MC.S.mode === "wipeCam") {
    const main = MC.wipeMain();
    pref = [main, MC.wipePip1(main), MC.S.wipeClipId2];
  } else if (MC.S.mode === "vertical") {
    pref = ids.length >= 3 ? [MC.S.slots[0], MC.S.slots[1], MC.S.slots[2]]
                           : [MC.S.slots[1], MC.S.slots[0]];
  }
  const order = [];
  for (const id of pref) if (id != null && ids.includes(id) && !order.includes(id)) order.push(id);
  for (const id of ids) if (!order.includes(id)) order.push(id);
  return order;
};

/* ダイアログの外を触れなくする(2026-08-03 レビュー)。role="dialog" aria-modal="true"
   を名乗りながら、実測でダイアログ外に14個のタブ可能要素が残り、Tab で背後の画面を
   操作できていた。inert は iOS Safari 16.4+ で効き、未対応環境では単に無視されるので
   壊れ方が安全。
   ★ このアプリで inert を使うのはここが初めて(#exportOverlay は使っていない)。
     body 直下の兄弟に付けるので、開いている最中に body へ足された要素は掴めない ─
     根治は <dialog>.showModal()。いまは踏める経路が無いことを2巡目レビューで確認済み */
MC.ui.setFinishPickInert = on => {
  const el = MC.ui.$("#finishPick");
  for (const n of document.body.children) {
    if (n === el) continue;
    if (on) n.setAttribute("inert", "");
    else n.removeAttribute("inert");
  }
};

/* 「仕上げの好み」の持ち物。おすすめの状態を毎回ここから作り直す。
   ★ pending(割り当ての途中)は廃止した(2026-08-04 優さん「順番の入れ替えが
     わかりにくい」)。いまはどの札もいつでも直接タップできて、常に全員に役がある */
/* fromState=true(完成後の「別設定で作成」)のときだけ、いま使った設定を入れて開く。
   ★ 通常のおまかせでは決して S を読まない ─ 前回の色や頻度が新しいおまかせへ
     黙って漏れ戻るのを防ぐため(2026-08-03 push前レビュー)。
     作り直しは「いまの設定を変える」操作なので、そこだけ例外にする */
MC.ui.newFinishPrefs = fromState => ({
  color: fromState && MC.S.filterId === "none" ? "natural" : "cinema",
  level: fromState ? (MC.S.cutLevel || MC.ui.AUTO.cutLevel) : MC.ui.AUTO.cutLevel,
  tilt: fromState ? MC.S.autoTilt !== false : true,   // 傾きの自動補正(既定ON)
  order: MC.ui.finishDefaultOrder(),
  focus: null,                       // 描き直したあとに焦点を戻す先
  /* ★ カメラの役割(2026-08-04)。ここで預かって finishPickGo で clip へ書く。
     直に c.role を書かないのは、「やめる」で戻れなくなるため
     ─ 開いてやめた人の設定は変えない、という他の項目と同じ約束 */
  axes: MC.ui.finishAxesMap(),
  /* 使う音(2026-08-06 優さん実機指示)。"auto"=おまかせ(既定)、それ以外は clip.id。
     開き直し(remake)のときだけ、本人が前回選んだ音を入れて開く */
  audio: fromState && MC.S.audioPickedByUser ? MC.S.audioClipId : "auto",
  changed: false,
});

/* 2軸セレクトに出す初期値。本人が選んだ軸はその値、触っていない軸は解析の判定
   (2026-08-06 優さん実機「この画面で被写体と固定が選択されていない」)。
   **素材の確認画面と仕上げの好み画面で同じ規則**を使う ─ 前回は仕上げ側だけ直し、
   優さんが見ていた素材側は c.target を直接読んだままで、何も変わっていなかった */
MC.ui.axisInitial = (clip, axis) => {
  const byUser = axis === "target" ? clip.targetByUser : clip.motionByUser;
  const cur = clip[axis];
  if (byUser) return cur || "auto";
  const g = MC.ui.guessAxes(clip);
  return g[axis] || cur || "auto";
};

/* いまの clip の2軸(撮影対象×固定/動きあり)を id→{target,motion} で預かる。
   旧保存(kind/roleのみ)は migrateAxes が2軸へ写してから読む(2026-08-05) */
MC.ui.finishAxesMap = () => {
  const m = {};
  for (const c of MC.ui.finishCards()) {
    const clip = MC.getClip(c.id) || c;
    MC.migrateAxes(clip);
    /* ★ 本人が選んでいなければ**映像解析の判定**を初期値にする
       (2026-08-06 優さん実機「被写体や固定などが初期で分析後が選ばれない。
       前みたいにそれを初期値にしてほしい」)。
       解析が済んでいない1回目は g が空なので、従来どおり「指定なし/自動判定」。
       本人が選んだ値は必ず優先する ─ 解析で上書きしない */
    /* ★ 判断は値ではなく「本人が触ったか」で(2026-08-06 レビューP0)。
       一度この画面を通すと finishPickGo が全クリップへ target/motion を書き、
       未指定でも "auto" が入る。"auto" は truthy なので `clip.target || g.target`
       では**永久に解析値へ届かない** ─ 実機で「初期値にならない」と見えていた本体。
       本人が選んだ軸だけ clip の値を尊重し、触っていない軸は解析の判定を出す */
    m[c.id] = {
      target: MC.ui.axisInitial(clip, "target"),
      motion: MC.ui.axisInitial(clip, "motion"),
    };
  }
  return m;
};

/* 映像解析(visual.js)の性格判定を、画面の2軸の言葉へ写す。
   解析が済んでいない/サンプル不足のクリップは {} を返す(何も推さない)。
   ★ 推測を clip へ書き戻さない ─ ここは「初期値の提案」であって確定ではない。
     確定するのは finishPickGo(本人が画面を通したとき)だけ */
MC.ui.guessAxes = clip => {
  /* 本解析が済んでいればそれを、まだなら取り込み時の軽い判定を使う
     (2026-08-06 優さん実機)。素材の確認画面は解析より前に出るので、
     quickVisual が無いと、この画面では永久に何も推せない */
  const v = (clip && clip.visual) || (clip && clip.quickVisual);
  if (!v) return {};
  /* ★ 測れていないクリップからは何も推さない(2026-08-06 レビューP1)。
     visual.js は shakeMed を**サンプル数に関わらず**代入し、med() は空配列で 0 を
     返す。enough を見ずに shakeMed だけで判断すると、1点も測れなかったクリップが
     必ず「三脚」と断定され、本人が疑わず進むと rig=fixed が確定してしまう
     (visual.js が overheadFixed/staticScene に enough ガードを入れた理由と同型)。
     旧い解析結果には enough が無いので、その場合は nSample で判断する */
  const enough = v.enough != null ? v.enough
    : (v.nSample != null ? v.nSample >= 3 : false);
  if (!enough) return {};
  const out = {};
  /* 固定or手持ち: 解析が持つのは「操作されているか」と「ブレの中央値」。
     操作あり=手持ち(いちばん多い撮り方)、ブレが三脚相当=三脚。
     その中間(操作なしだがブレはある)は決めつけない */
  if (v.operated) out.motion = "handheld";
  else if (v.shakeMed != null && v.shakeMed <= MC.visual.TH_FIXED_SHAKE) out.motion = "tripod";
  /* 被写体: 解析が言い切れるのは2つだけ。
     ・overheadFixed = 動かないカメラで画面の広い範囲が動き続ける = 全体が見えている
     ・staticScene   = 人がほぼ動かない定点 = メジャー・ピットの類
     「正面かどうか」は映像からは分からないので front は推さない
     (間違えると背骨のカメラを取り違えるため、他の場所からの全体に倒す) */
  if (v.overheadFixed) out.target = "altwide";
  else if (v.staticScene) out.target = "spice";
  return out;
};
/* 選べる値は MC.TARGETS / MC.MOTIONS が正本(2026-08-05 優さん指示で2軸化)。
   長い説明文は出さない(2026-08-05 優さん実機「説明テキストは削除」) */

MC.ui.openFinishPick = opts => {
  const el = MC.ui.$("#finishPick");
  if (!el || !el.hidden) return;
  /* 完成後の「別設定で作成」から来たか(2026-08-04)。
     見出し・ボタンの文言と、進んだあとの行き先が変わる */
  const remake = !!(opts && opts.remake);
  MC.ui._fpRemake = remake;
  /* おすすめは毎回ここで選び直す(色・頻度は S の残り値を見ない)。
     前回の色が、新しいおまかせへ黙って漏れ戻らないため
     (2026-08-03 push前レビューの承継。applyAutoChoices 参照)。
     作り直しのときだけ、いまの設定を入れて開く */
  MC.ui._fp = MC.ui.newFinishPrefs(remake);
  MC.preview.pause();   // 選択画面の裏で音が鳴り続けないように(モード選択と同じ)
  el.hidden = false;
  /* ★ 開くたび先頭へ戻す(2026-08-04)。前に送った位置が残っていると、
     「仕上げの好み」の見出しを飛ばして途中から出る。中身が伸びるほど効く */
  el.scrollTop = 0;
  document.body.classList.add("mz-finish-pick");
  MC.ui.setFinishPickInert(true);
  /* 見送られた軽い判定を、この画面のために拾い直す(2026-08-07 優さん実機4回目)。
     取り込み中(_busy)に見送られた素材は、引き金がなければ二度と測られない。
     この画面こそ判定の答えを見せる場所なので、開いた瞬間が最良の引き金 ─
     届いた判定は queueQuick → renderClips → renderFinishPick 経由で、
     開いたままの画面にも反映される(renderFinishRoles の引き直し) */
  try { if (MC.media && MC.media.retryQuick) MC.media.retryQuick(); } catch (e) {}
  MC.ui.renderFinishPick();
  /* 焦点は「このまま進む」へ ─ いちばん多い操作(0決定)を最短にする */
  try { const b = MC.ui.$("#fpGo"); if (b) b.focus({ preventScroll: true }); } catch (e) {}
};

MC.ui.closeFinishPick = () => {
  const el = MC.ui.$("#finishPick");
  if (!el || el.hidden) return;
  /* 試聴を鳴らしたまま閉じない(2026-08-06)。「やめる」で戻った人の裏で
     音だけ鳴り続けるのを防ぐ。音の割り当ても正本へ戻す */
  if (MC.ui.fpAuditionStop) MC.ui.fpAuditionStop();
  el.hidden = true;
  document.body.classList.remove("mz-finish-pick");
  MC.ui.setFinishPickInert(false);
};

MC.ui.renderFinishPick = () => {
  const el = MC.ui.$("#finishPick");
  if (!el) return;
  const fp = MC.ui._fp || (MC.ui._fp = MC.ui.newFinishPrefs());
  const kind = MC.ui.$("#fpKind");
  if (kind) kind.textContent = MC.ui.modeConf().label;
  /* --- 配置(縦型/ワイプだけ) --- */
  const cards = MC.ui.finishCards();
  const roles = MC.ui.finishRoles();
  const showPlace = roles.length > 0 && cards.length >= 2;
  const placeSec = MC.ui.$("#fpPlaceSec");
  if (placeSec) placeSec.hidden = !showPlace;
  if (showPlace) {
    /* 開いている間に素材が増減したら、割り当てを既定から作り直す */
    const ids = cards.map(c => c.id);
    if (fp.order.length !== ids.length || fp.order.some(id => !ids.includes(id))) {
      fp.order = MC.ui.finishDefaultOrder(); fp.focus = null;
    }
    /* 見出しは役の性質で変える。★2本の縦型は役が「中 / 上と下」で順序ではないので
       「並び順」と呼ぶと嘘になる(3本のときだけ 上→中→下 の順序) */
    { const t = MC.ui.$("#fpPlaceTitle");
      if (t) t.textContent = (MC.S.mode === "vertical" && cards.length >= 3)
        ? "動画の並び順" : (MC.S.mode === "vertical" ? "動画の配置" : "カメラの配置"); }
    const hint = MC.ui.$("#fpHint");
    if (hint) hint.textContent = "位置をタップすると入れ替わります";
    const box = MC.ui.$("#fpCards");
    if (!box) return;   // HTMLとJSの版がずれても renderClips ごと落とさない
    box.innerHTML = "";
    /* ★ カードは素材の順で固定する(2026-08-04 優さん判断)。
       役の順に並べ替えると、押した札が画面内を大きく動き(実測287px)、
       「効いたか確かめよう」と同じ場所をもう一度押すと取り消しになる。
       動くのは札の点灯だけ ─ 押した指の下は何も動かない */
    cards.forEach(c => {
      const id = c.id;
      const at = fp.order.indexOf(c.id);
      const card = document.createElement("div");
      /* ★ 青リングはワイプの「メイン」のときだけ(2026-08-03 レビュー)。
         縦型の「上」はメインではないので、付けると階層の嘘になる */
      card.className = "wp-card"
        + (MC.S.mode === "wipeCam" && at === 0 ? " wp-card--main" : "");
      card.innerHTML = `
        <span class="wp-thumb-wrap">${c.thumb
          ? `<img class="wp-thumb" src="${c.thumb}" alt="">`
          : '<span class="wp-thumb wp-thumb--empty"></span>'}</span>
        <span class="wp-main"><span class="wp-name">${MC.ui.esc(c.name)}</span>
          <span class="wp-meta">${c.isImage ? "写真" : MC.ui.fmtTime(c.duration)}</span></span>`;
      /* 役そのものを押せるようにする。押した役へこの動画が移り、
         そこに居た動画が入れ替わりでこちらへ来る(必ず全員に役がある) */
      const seg = document.createElement("span");
      seg.className = "fp-roles";
      seg.setAttribute("role", "radiogroup");
      seg.setAttribute("aria-label", `${c.name} の位置`);
      roles.forEach((label, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "fp-role" + (i === at ? " on" : "");
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", i === at ? "true" : "false");
        b.setAttribute("aria-label", `${c.name} を「${label}」にする`);
        b.dataset.id = String(id);
        b.dataset.at = String(i);
        b.textContent = label;
        b.onclick = () => MC.ui.finishSetRole(id, i);
        seg.appendChild(b);
      });
      card.appendChild(seg);
      box.appendChild(card);
    });
  }
  /* --- それぞれのカメラの役割(自動スイッチングだけ) --- */
  MC.ui.renderFinishPickAudio();
  MC.ui.renderFinishRoles(fp, cards);
  /* --- 切り替えの多さ(自動スイッチングだけ) --- */
  const lvSec = MC.ui.$("#fpLevelSec");
  if (lvSec) lvSec.hidden = MC.S.mode !== "switch";
  if (MC.S.mode === "switch") {
    const box = MC.ui.$("#fpLevels");
    box.innerHTML = "";
    /* ★ 真ん中は「ふつう」(2026-08-07 UI/UXレビュー🟡)。「少なめ→おすすめ→多め」は
       尺度として成立していない ─ 多い・少ないの軸に、多寡でない語が真ん中に入って
       いた。同じ画面で「おすすめ」は推奨バッジとしても使われており、1語が2役。
       「おすすめ」はバッジ専用語にして、軸は多寡だけで並べる */
    for (const [lv, label] of [[1, "少なめ"], [2, "ふつう"], [3, "多め"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fp-seg-btn" + (fp.level === lv ? " on" : "");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", fp.level === lv ? "true" : "false");
      b.textContent = label;
      b.onclick = () => { if (fp.level === lv) return;
        fp.level = lv; fp.changed = true; fp.focus = null;
        MC.ui.buzz([10]); MC.ui.renderFinishPick(); };
      box.appendChild(b);
    }
  }
  /* --- 傾きの自動補正(全モード共通・2026-08-04 優さん指示) --- */
  { const box = MC.ui.$("#fpTilt");
    if (box) {
      box.innerHTML = "";
      for (const [on, label, reco] of [[true, "直す", true], [false, "そのまま", false]]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "fp-seg-btn" + (fp.tilt === on ? " on" : "");
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", fp.tilt === on ? "true" : "false");
        b.innerHTML = MC.ui.esc(label)
          + (reco ? '<span class="fp-reco">おすすめ</span>' : "");
        b.onclick = () => { if (fp.tilt === on) return;
          fp.tilt = on; fp.changed = true; fp.focus = null;
          MC.ui.buzz([10]); MC.ui.renderFinishPick(); };
        box.appendChild(b);
      }
    } }
  /* --- 色(全モード共通) --- */
  const cbox = MC.ui.$("#fpColors");
  if (cbox) {
    cbox.innerHTML = "";
    for (const [key, name, desc, reco] of [
      ["cinema", "シネマティック", "MarchinZオリジナルのカラー", true],
      ["natural", "ナチュラル", "自然な色に合わせます", false],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fp-color" + (fp.color === key ? " on" : "");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", fp.color === key ? "true" : "false");
      b.innerHTML = `<span class="fp-color-name">${name}${reco
          ? '<span class="fp-reco">おすすめ</span>' : ""}</span>
        <span class="fp-color-desc">${desc}</span>
        <i class="fa-solid fa-circle-check fp-check" aria-hidden="true"></i>`;
      b.onclick = () => { if (fp.color === key) return;
        fp.color = key; fp.changed = true; fp.focus = null;
        MC.ui.buzz([10]); MC.ui.renderFinishPick(); };
      cbox.appendChild(b);
    }
  }
  /* --- 進むボタン。どの瞬間も割り当ては完成しているので常に押せる --- */
  /* ★ 文言は必ずここで決める(2026-08-04)。openFinishPick で1度書いても、
     この関数が描き直すたびに上書きしてしまう ─ #fpGo の所有者はここ。
     作り直し(完成後の「別設定で作成」)では、行き先が違うので言葉も変える */
  const remake = !!MC.ui._fpRemake;
  /* ★ リード文は出さない(2026-08-06 優さん実機「テキストの『おすすめを
     選んでます——』のところ全カット」)。おすすめが選択済みなのは見れば分かる */
  const lead = el.querySelector(".mode-lead");
  if (lead) { lead.textContent = ""; lead.hidden = true; }
  const back = MC.ui.$("#fpBack");
  if (back) back.textContent = remake ? "← やめる" : "← 動画を選び直す";
  const go = MC.ui.$("#fpGo");
  if (go) {
    go.disabled = false;
    go.textContent = remake
      ? (fp.changed ? "この設定で作り直す" : "同じ設定で作り直す")
      : (fp.changed ? "これで進む" : "このまま進む");
  }
  MC.ui.keepFinishPickFocus();
};

/* 焦点をダイアログの中に留める(2026-08-03 2巡目レビュー実測)。
   ★ 描き直した**あと**に一度だけ見る。renderFinishPick は #fpCards を
     innerHTML="" で作り直すので、焦点を持っていたカードごと消えて <body> へ落ちる。
     前の版は「無効化の直前・焦点が #fpGo のときだけ」逃がしていたため、
       ・1タップ目 → 効く
       ・2タップ目(割り当て完了) → BODY へ落ちる ← 防ぎたかったもの
       ・VoiceOver のダブルタップ(対象に焦点が立つ) → 最初から効かない
     と、救いたい相手にほぼ効いていなかった。
   行き先は「次に押すカード → 進む → 戻る」。次のカードは fp.order で引く ─
   文字「？」で探すと `これ？の動画.mp4` のようなファイル名に釣られて、
   割り当て済みのカードへ焦点が飛ぶ(実測) */
MC.ui.keepFinishPickFocus = () => {
  const el = MC.ui.$("#finishPick");
  if (!el || el.hidden) return;
  const a = document.activeElement;
  if (a && a !== document.body && el.contains(a)) return;   // まだ中に居る
  const fp = MC.ui._fp;
  let next = null;
  /* 押した役の札そのものへ戻す。札は描き直しで作り直されるので、
     要素ではなく (どの動画・どの役) で引き当てる */
  if (fp && fp.focus) {
    /* ★ 探す先は配置と役割の両方(2026-08-04 レビュー)。
       #fpCards だけを見ていたため、あとから足した役割の段(#fpRoleCards)は
       この対策の外に出ていて、札を押すたび焦点が <body> へ落ちていた */
    /* 2軸プルダウン(axis)は select を探す。旧「役割の札」(role)分岐は
       2軸化で死にコードになっていた(2026-08-05 レビューP1: 毎回 #fpGo へ焦点が飛ぶ) */
    next = fp.focus.kind === "axis"
      ? el.querySelector(`#fpRoleCards .fp-axis-sel[data-id="${fp.focus.id}"][data-axis="${fp.focus.axis}"]`)
      : [...el.querySelectorAll("#fpCards .fp-role")].find(
          b => b.dataset.id === String(fp.focus.id) && b.dataset.at === String(fp.focus.at)) || null;
  }
  const go = MC.ui.$("#fpGo");
  const to = next || (go && !go.disabled ? go : MC.ui.$("#fpBack"));
  /* ★ タッチ端末では select へ焦点を戻さない(2026-08-06 優さん実機:
     被写体/固定を選ぶたびピッカーがもう一度開く)。プログラムからの
     focus() を iOS Safari は「開く操作」として扱う。焦点復元は
     キーボード操作のための配慮なので、タッチでは何もしないのが正しい */
  if (MC.isTouch && to && to.tagName === "SELECT") return;
  try { if (to) to.focus({ preventScroll: true }); } catch (e) {}
};

/* 役の札のタップ(2026-08-04 優さん「順番の入れ替えがわかりにくい」)。

   旧: 1枚タップ→全員の役が消えて「？」になり、最後まで順に選ばされる。
       途中でやめられず、1か所だけ直すこともできなかった。
   新: 押した役へこの動画が移り、そこに居た動画と**入れ替わる**だけ。
       どの瞬間も全員に役があり、1タップが必ず完結する。 */
MC.ui.finishSetRole = (id, at) => {
  const fp = MC.ui._fp;
  if (!fp) return;
  const cur = fp.order.indexOf(id);
  if (cur < 0 || at < 0 || at >= fp.order.length) return;
  fp.focus = { id, at };            // 描き直したあと、押した札へ焦点を戻す
  if (cur === at) { MC.ui.keepFinishPickFocus(); return; }   // すでにその役
  fp.order[cur] = fp.order[at];
  fp.order[at] = id;
  fp.changed = true;
  MC.ui.buzz([10]);
  MC.ui.renderFinishPick();
};

/* 「このまま進む/これで進む」。選んだ好みを既存フラグへ書き、自走を再開する */
/* それぞれのカメラの役割。★配置(#fpPlaceSec)とは別もの ─
   配置は「1台につき1つの席を入れ替える」順列だが、役割は独立して選ぶ
   (2台とも「引き」でよいし、全部「おまかせ」でもよい)。
   そのため同じ器を使い回さず、別の段として描く。
   自動スイッチングのときだけ出す ─ 縦型・ワイプはカット割りをしないので
   役割を聞いても使い道が無い(聞くだけ聞いて捨てるのは不誠実) */
MC.ui.renderFinishRoles = (fp, cards) => {
  const sec = MC.ui.$("#fpRoleSec");
  if (!sec) return;                       // HTMLとJSの版がずれても落とさない
  const show = MC.S.mode === "switch" && cards.length >= 2;
  sec.hidden = !show;
  if (!show) return;
  const box = MC.ui.$("#fpRoleCards");
  if (!box) return;
  if (!fp.axes) fp.axes = MC.ui.finishAxesMap();
  /* 開いている間に素材が増減したら、いまの素材ぶんだけに作り直す。
     ★ 減った側を消すだけでは足りない(2026-08-04 レビュー) ─ 増えた素材が
       fp.axes に無いと、画面は「指定なし」なのに finishPickGo が素通りさせ、
       clip の設定は前のまま残る。足りない側も必ず埋める */
  for (const id of Object.keys(fp.axes)) {
    if (!cards.some(c => String(c.id) === String(id))) delete fp.axes[id];
  }
  for (const c of cards) if (!(c.id in fp.axes)) {
    const clip = MC.getClip(c.id) || c;
    MC.migrateAxes(clip);
    fp.axes[c.id] = { target: MC.ui.axisInitial(clip, "target"),
                      motion: MC.ui.axisInitial(clip, "motion") };
  }
  /* ★ 触っていない軸は、描くたびに最新の提案へ引き直す(2026-08-07 優さん実機・
     同じ指摘の4回目)。軽い判定(quickProbe)は1本1〜2秒×本数かかるうえ、
     取り込み中は見送られることもある ─ この画面が開いた時点ではまだ答えが
     無いのが普通。ところが fp.axes は最初の描画で一度作ったきり凍結される
     ため、あとから判定が届いて renderClips → ここが描き直されても
     「指定なし/自動判定」を出し続けていた ─ **答えが来ても画面が受け取らない**。
     これまでの3回の修正はどれも初期値の計算式(axisInitial)を直していて、
     この受け取り直しの経路が無かった。
     本人が触った軸(axesByUser)には絶対に触らない ─ 凍結の元の目的
     (選択中の値を巻き戻さない)はこの印が守る */
  for (const c of cards) {
    const clip = MC.getClip(c.id);
    if (!clip) continue;
    for (const axis of ["target", "motion"]) {
      if (fp.axesByUser && fp.axesByUser[`${c.id}/${axis}`]) continue;
      fp.axes[c.id][axis] = MC.ui.axisInitial(clip, axis);
    }
  }
  box.innerHTML = "";
  /* 2軸プルダウン(2026-08-05 優さん指示)。①撮影対象 ②固定/動きあり */
  const mkSel = (list, cur, aria, onPick) => {
    const sel = document.createElement("select");
    sel.className = "fp-axis-sel select-mini";
    sel.setAttribute("aria-label", aria);
    list.forEach(o => {
      const op = document.createElement("option");
      op.value = o.v; op.textContent = o.label;
      if (o.v === cur) op.selected = true;
      sel.appendChild(op);
    });
    sel.onchange = e => onPick(e.target.value);
    return sel;
  };
  cards.forEach(c => {
    const cur = fp.axes[c.id];
    const card = document.createElement("div");
    card.className = "wp-card";
    card.innerHTML = `
      <span class="wp-thumb-wrap">${c.thumb
        ? `<img class="wp-thumb" src="${c.thumb}" alt="">`
        : '<span class="wp-thumb wp-thumb--empty"></span>'}</span>
      <span class="wp-main"><span class="wp-name">${MC.ui.esc(c.name)}</span>
        <span class="wp-meta">${c.isImage ? "写真" : MC.ui.fmtTime(c.duration)}</span></span>`;
    const seg = document.createElement("span");
    seg.className = "fp-axes";
    const pick = axis => v => {
      cur[axis] = v;
      fp.changed = true;
      /* この軸は本人が選んだ、と覚える(2026-08-06 レビューP0)。
         finishPickGo が clip へ写し、次に開いたとき解析値で上書きしない */
      (fp.axesByUser || (fp.axesByUser = {}))[`${c.id}/${axis}`] = true;
      /* 縦向き動画を全体系にすると左右が切れて隊形が読めない(2026-08-04 DCI)。
         選択は妨げない ─ 事実だけ言う */
      const clip = MC.getClip(c.id);
      if (axis === "target" && (v === "front" || v === "altwide")
          && clip && clip.height > clip.width) {
        MC.ui.toast("縦向きの動画です。全体に使うと左右が切れるため、隊形が読みづらいかもしれません");
      }
      MC.ui.buzz([10]);
      /* #fpGo の文言(このまま進む/同じ設定で作り直す)は renderFinishPick が持つ。
         select は自分の状態を保つが、描き直しで要素は作り直されるため
         焦点の戻し先を預ける(預けないと毎回 #fpGo へ飛ぶ) */
      fp.focus = { kind: "axis", id: c.id, axis };
      MC.ui.renderFinishPick();
    };
    /* ラベルを添える(2026-08-05 優さん実機「被写体 / 固定or手持ち のラベルを」)。
       ★説明文は出さない(2026-08-05 優さん実機「この被写体や固定の説明文はいらない」。
         一度hintの動的表示を足したが即日巻き戻した ─ 選択肢名だけで通す) */
    const labeled = (text, sel) => {
      const box = document.createElement("span");
      box.className = "fp-axis";
      const lab = document.createElement("span");
      lab.className = "fp-axis-label";
      lab.textContent = text;
      box.appendChild(lab);
      box.appendChild(sel);
      return box;
    };
    const selT = mkSel(MC.TARGETS, cur.target, `${c.name} の被写体`, pick("target"));
    selT.dataset.id = String(c.id); selT.dataset.axis = "target";
    const selM = mkSel(MC.MOTIONS, cur.motion, `${c.name} の固定or手持ち`, pick("motion"));
    selM.dataset.id = String(c.id); selM.dataset.axis = "motion";
    seg.appendChild(labeled("被写体", selT));
    seg.appendChild(labeled("固定or手持ち", selM));
    card.appendChild(seg);
    box.appendChild(card);
  });
};

/* ---- 使う音(2026-08-06 優さん実機指示) ----
   スマホのおまかせは「使う音を選ぶ」工程を通らない(autoPickAudio が自動で
   決めて素通りする)ため、この画面が唯一の選び場になる。
   既定は「おまかせ」。それ以外は名前を並べて、行ごとに試聴ボタンを付ける。 */
MC.ui._fpAudId = null;          // いま試聴しているクリップ(null=止まっている)

/** 試聴の停止。触った <video> は必ず元の割り当てへ戻す */
MC.ui.FP_AUDITION_SEC = 20;     // 聴き比べに十分で、鳴りっぱなしにはならない長さ
MC.ui._fpAudTimer = null;
MC.ui._fpAudEnded = null;       // 終端の見張り(解除できるよう覚えておく)

MC.ui.fpAuditionStop = () => {
  MC.ui._fpAudId = null;
  if (MC.ui._fpAudTimer) { clearTimeout(MC.ui._fpAudTimer); MC.ui._fpAudTimer = null; }
  if (MC.ui._fpAudEnded) {
    const { el, fn } = MC.ui._fpAudEnded;
    try { el.removeEventListener("ended", fn); } catch (_) {}
    MC.ui._fpAudEnded = null;
  }
  try {
    MC.S.clips.forEach(c => { if (c.video) { try { c.video.pause(); } catch (_) {} } });
    MC.preview.applyMute();     // 音の割り当ての正本へ戻す
  } catch (_) {}
};

/** 1本だけ鳴らす。もう一度押したら止める */
MC.ui.fpAudition = id => {
  const clip = MC.getClip(id);
  if (!clip || !clip.video) return;
  if (MC.ui._fpAudId === id) { MC.ui.fpAuditionStop(); MC.ui.renderFinishPick(); return; }
  MC.ui.fpAuditionStop();
  MC.ui._fpAudId = id;
  MC.S.clips.forEach(c => { if (c.video) c.video.muted = c.id !== id; });
  try {
    /* 頭のセッティングではなく、音のあるところから鳴らす。
       ★ showRange は**グローバル秒**、video.currentTime は**クリップローカル秒**で、
         local = global - clip.offset(preview.js と同じ式)。この換算を忘れると、
         遅れて回し始めたカメラ(offset が大きい)だけ別の瞬間が鳴り、
         「同じ場面で聴き比べる」という試聴の目的が成立しない(2026-08-06 レビューP1)。
       ★ 演奏範囲がまだ分からない初回は、全体の3割の位置から
         (showRange は範囲未確定でも [0, dur] を返すので、null で判断する) */
    const dur = Number(clip.duration) || 0;
    const known = MC.S.showIn != null && MC.S.showOut != null;
    let local;
    if (known) {
      const [a, b] = MC.ui.showRange();
      const global = a + Math.min(5, Math.max(0, (b - a) * 0.1));
      local = global - (clip.offset || 0);
    } else {
      local = dur * 0.3;
    }
    clip.video.currentTime = Math.max(0, Math.min(local, Math.max(0, dur - 1)));
  } catch (_) {}
  /* ★ 止まる条件を必ず持たせる(2026-08-06 レビューP1×2)。
     ① 終端まで鳴ったら表示を戻す ─ 見張りが無いと「停止」のまま固まり、
        次のタップが停止扱いになって**2回押さないと聴き直せない**
     ② 一定時間で自動的に止める ─ 止め方が「もう一度押す」しか無く、
        下の段を触っている間ずっと演奏が鳴り続けていた(教室・電車で実害) */
  {
    const el = clip.video;
    const onEnded = () => { MC.ui.fpAuditionStop(); MC.ui.renderFinishPick(); };
    try { el.addEventListener("ended", onEnded); MC.ui._fpAudEnded = { el, fn: onEnded }; } catch (_) {}
    MC.ui._fpAudTimer = setTimeout(() => {
      MC.ui.fpAuditionStop(); MC.ui.renderFinishPick();
    }, MC.ui.FP_AUDITION_SEC * 1000);
  }
  const pr = clip.video.play();
  if (pr && pr.catch) pr.catch(() => {
    /* 黙って戻さない(2026-08-06 レビューP2)。iOSが自動再生を弾くと
       ボタンが一瞬「停止」になって戻るだけで、壊れたようにしか見えない */
    MC.ui.fpAuditionStop(); MC.ui.renderFinishPick();
    MC.ui.toast("音を鳴らせませんでした。もう一度タップしてください");
  });
  MC.ui.renderFinishPick();
};

MC.ui.renderFinishPickAudio = () => {
  const fp = MC.ui._fp;
  const sec = MC.ui.$("#fpAudioSec");
  if (!sec || !fp) return;
  /* 音のある動画が2本以上あるときだけ。1本なら選ぶ余地が無い
     (「使う音を選ぶ」工程のスキップ条件と同じ物差し) */
  const cands = MC.S.clips.filter(c => !c.isImage && c.hasAudio !== false);
  const show = cands.length >= 2;
  sec.hidden = !show;
  if (!show) return;
  const box = MC.ui.$("#fpAudio");
  if (!box) return;
  /* 開いている間に素材が入れ替わって選択中の音が消えたら、おまかせへ戻す
     (2026-08-06 レビューP2)。正規化しないと**どの行にも印が付かない**画面になる。
     役割の段(fp.axes)が同じ場面で整合を取っているのと作法を揃える */
  if (fp.audio !== "auto" && !cands.some(c => c.id === fp.audio)) fp.audio = "auto";
  box.innerHTML = "";
  const rows = [{ id: "auto", name: "おまかせ", sub: "いちばん良い音を自動で選びます" }]
    .concat(cands.map(c => {
      const i = MC.S.slots.indexOf(c.id);
      return { id: c.id, clip: c,
               name: c.isAudio ? "音声ファイル" : (i >= 0 ? `動画${i + 1}` : MC.ui.shortName(c.name)),
               sub: c.isAudio ? "" : MC.ui.shortName(c.name, 14) };
    }));
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "fp-audio-row" + (fp.audio === r.id ? " on" : "");
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "fp-audio-pick";
    pick.setAttribute("role", "radio");
    pick.setAttribute("aria-checked", fp.audio === r.id ? "true" : "false");
    pick.innerHTML = `<span class="fp-audio-name">${MC.ui.esc(r.name)}</span>`
      + (r.sub ? `<span class="fp-audio-sub">${MC.ui.esc(r.sub)}</span>` : "")
      + '<i class="fa-solid fa-circle-check fp-check" aria-hidden="true"></i>';
    pick.onclick = () => {
      if (fp.audio === r.id) return;
      fp.audio = r.id; fp.changed = true; fp.focus = null;
      MC.ui.buzz([10]); MC.ui.renderFinishPick();
    };
    row.appendChild(pick);
    /* 試聴は動画の行だけ(おまかせは「どれが選ばれるか」が未確定なので付けない) */
    if (r.clip) {
      const on = MC.ui._fpAudId === r.id;
      const play = document.createElement("button");
      play.type = "button";
      play.className = "fp-audio-play" + (on ? " on" : "");
      play.setAttribute("aria-label", on ? `${r.name} の試聴を止める` : `${r.name} を試聴`);
      play.innerHTML = on
        ? '<i class="fa-solid fa-pause" aria-hidden="true"></i> 停止'
        : '<i class="fa-solid fa-headphones" aria-hidden="true"></i> 試聴';
      play.onclick = () => MC.ui.fpAudition(r.id);
      row.appendChild(play);
    }
    box.appendChild(row);
  }
};

MC.ui.finishPickGo = () => {
  const fp = MC.ui._fp;
  if (!fp) return;
  MC.ui.fpAuditionStop();               // 試聴を鳴らしたまま次へ行かせない
  /* 使う音(2026-08-06)。おまかせなら従来どおり autoPickAudio に任せる */
  if (fp.audio && fp.audio !== "auto" && MC.getClip(fp.audio)) {
    MC.S.audioClipId = fp.audio;
    MC.S.audioPickedByUser = true;
    MC.S.audioDecided = true;
  } else {
    /* おまかせへ戻したら「決定済み」も下ろす(2026-08-06 レビューP2)。
       残すと refreshJourney が「音は決めた」と表示し、実際には
       autoPickAudio がこれから選ぶ、という食い違いになる */
    MC.S.audioPickedByUser = false;
    MC.S.audioDecided = false;
  }
  /* ★ カメラの2軸(撮影対象×固定/動きあり)を clip へ書き戻す(2026-08-05)。
     ここで初めて書く ─「やめる」で戻ってきた人の設定は変えない。
     applyAxes が役割/出番/撮り方へ展開する。
     これで hasPitCam が立ち、director.js の +1.2 が初めて効く */
  if (MC.S.mode === "switch" && fp.axes) {
    for (const c of MC.S.clips) {
      const a = fp.axes[c.id];
      if (a) {
        c.target = a.target; c.motion = a.motion;
        /* 触った軸だけ印を立てる(既に立っている印は消さない) */
        const by = fp.axesByUser || {};
        if (by[`${c.id}/target`]) c.targetByUser = true;
        if (by[`${c.id}/motion`]) c.motionByUser = true;
        MC.applyAxes(c);
      }
    }
  }
  MC.S.autoTilt = fp.tilt !== false;   // 傾きの自動補正(2026-08-04 優さん指示)
  /* 色: 既存の filterId/colorOn に接続(新しい色処理は作らない)。
     ナチュラル=フィルターなし。カメラ間の色合わせ(colorOn)はどちらでも残す */
  MC.S.filterId = fp.color === "natural" ? "none" : MC.ui.AUTO.filterId;
  MC.S.colorOn = true;
  if (MC.S.mode === "switch") MC.S.cutLevel = fp.level;
  const o = fp.order;
  if (MC.S.mode === "vertical" && o.length >= 2) {
    /* 2本は3段の中央+上下(media.afterChange の既定と同じ形)。3本は上から順 */
    MC.S.slots = o.length >= 3 ? [o[0], o[1], o[2]] : [o[1], o[0], o[1]];
  }
  if (MC.S.mode === "wipeCam" && o.length >= 2) {
    MC.S.wipeMainId = o[0];
    MC.S.wipeClipId = o[1];
    MC.S.wipePos = "br";   // おまかせの小窓1は右下(2026-08-02 優さんの指示の言葉どおり)
    if (o[2] != null) { MC.S.wipeClipId2 = o[2]; MC.S.wipePos2 = "bl"; }
  }
  MC.S.finishPicked = true;
  MC.saveState();
  MC.ui.closeFinishPick();
  /* ★ 完成後の「別設定で作成」から来たときは、同じシーンのまま作り直す
     (2026-08-04)。枠を減らすのはここ ─ 開いてやめた人からは取らない */
  if (MC.ui._fpRemake) {
    MC.ui._fpRemake = false;
    if (MC.ui.extraScenesLeft() <= 0) { MC.ui.renderSceneOffers(); return; }
    MC.ui._extraScenesMade = (MC.ui._extraScenesMade || 0) + 1;
    MC.ui.exportOverlay.close();
    const dc = MC.ui.$("#doneCard"); if (dc) dc.hidden = true;
    /* ★ 「同じシーン」は現在の窓の t を直渡しで再現する(2026-08-05 レビューP0)。
       旧: startKey/startAt を渡していたが、おまかせ(best)は startAt が null で、
       manual 化の過程で cands[0](=冒頭)へ化けた ─ キーではなく
       いまの trimIn こそが「同じシーン」の正体 */
    MC.ui.runAuto({ scene: { key: "manual", t: MC.S.trimIn } });
    return;
  }
  MC.ui.runAuto();   // ここから先は今までどおり書き出しまで自走
};

/* 好み画面の「← 動画を選び直す」と Escape の共通の出口。
   閉じるだけでは、押した人が現在地「同期と分析」(5工程)に置き去りになる
   (2026-08-03 push前レビューの実測)。全画面の選び直しと同じ着地へ渡す ─
   finishPicked は倒れたままなので、再開すればこの画面がまた開く */
MC.ui.finishPickBack = () => {
  /* ★ 作り直しの途中でやめたら、完成画面へそのまま戻す(2026-08-04)。
     素材の工程へ着地させると、出来上がった動画を残したまま最初の画面に
     立たされて「保存したのに消えた?」になる */
  if (MC.ui._fpRemake) {
    MC.ui._fpRemake = false;
    MC.ui.closeFinishPick();
    return;
  }
  MC.ui.closeFinishPick();
  MC.ui.repickLand("動画を入れ替えたら「これでOK、おまかせを再開」を押してください");
};

/* 「動画を選び直す」で止まったあとの着地(2026-08-02 優さん指示)。
   素材の工程に立たせ、取り込み済みの動画は**残す**(数GBの再取り込みは重い)。
   タブはおまかせのまま ─ こだわりへ飛ばすと、入れ替えたいだけの人が
   5工程の画面に置き去りになる。再開は行動バーの「これでOK、おまかせを再開」。
   QA もこの関数で着地の実体を測る(runAuto の catch と同じ経路) */
MC.ui.repickLand = (msg) => {
  MC.ui._repickAfterCancel = false;
  MC.ui._repickHold = true;   // 外す/追加が済むまで focusNextAction は自走を再開しない
  /* ★ 先に一度追従させてから素材工程を立てる(2026-08-03 push前レビュー)。
     refreshJourney は到達点が動いた回に寄り道(_viewPhase)を**消す**ので、
     立ててから呼ぶと着地がその場で流れる ─ runAuto の1本ガードが同じ二段構えを
     踏んでいるのと同じ理由。中止からの着地では到達点がすでに落ち着いていて
     たまたま生きていたが、好み画面の「動画を選び直す」(取り込み直後=到達点が
     動く回)から呼ぶと素通りして、押した人が5工程の画面に置き去りになった */
  MC.ui.refreshJourney();
  MC.ui._viewPhase = "mat";
  MC.ui.refreshJourney();
  /* 言うことは呼び元で変える(2026-08-03 レビュー)。同じ着地でも、
     中止から来た人には「やめました」、好み画面の「動画を選び直す」から
     来た人には**やめていない**ので選び直しの手順を言う */
  MC.ui.toast(msg || "やめました。動画は残っています ─ ✕で外して入れ替えられます");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

MC.ui.runAuto = async (opt) => {
  if (MC.ui._busy || (MC.exporter && MC.exporter.running)) return;
  if (!MC.media.slotClips().length) return;
  /* ★ 動画1本では作れない(2026-08-02 優さん指示)。focusNextAction の門とは
     別に、実行の入口にも置く ─ ワイプ選択後・再試行ボタン・別のシーンなど
     runAuto へ直接来る道があるため。素材工程に立たせ、案内は常設1行が言う */
  if (MC.S.clips.filter(c => !c.isImage && !c.isAudio).length < 2) {
    /* refreshJourney は到達点が動いた回に寄り道(_viewPhase)を消す。
       先に一度追従させてから素材工程を見せる(消される順序を踏まない) */
    MC.ui.refreshJourney();
    MC.ui._viewPhase = "mat";
    MC.ui.refreshJourney();
    MC.ui.renderClips();
    return;
  }
  /* 通知の許可は「これから数分待つ」ことが確定した人にだけ、静かに一度だけ
     尋ねる(2026-08-02 優さん指示)。初回訪問でいきなり求めない */
  MC.ui.askNotifyPermissionOnce();
  /* 書き出し中プレビューの<video>再生を、このタップの活性で解錠しておく
     (おまかせの書き出しはプログラムからの click で、タップの活性が無い) */
  MC.ui.eoLive.prime();
  /* 実時間録画の音は、このタップの活性があるうちに起こしておく
     (2026-08-06 レビューP1。録画の入口では活性が切れており iOS で無音になる) */
  MC.exporter.primeAudio();
  /* ============ 別のシーンも作る(2026-08-01 優さん指示) ============
     完成後に scene:{key,t} 付きで呼ばれたら「2回目」。
     傾き・同期・音声選択・音楽解析は前回のものが生きているので飛ばし、
     新しい範囲の映像解析+カット割+書き出しだけをやる。
     ★ 前回の解析(clip.sections / stats / showIn)は**メモリにしか無く、
       再読込で消える**。消えていたら黙って通常の自走に落ちる ─
       これは速いだけの近道であって、通行判定には使わない(過去の教訓:
       「UIの通行判定に消える値を使わない」) */
  const scene = opt && opt.scene;
  const sceneCached = !!(scene && MC.S.showIn != null && MC.S.showOut != null
    && (() => { const a = MC.getClip(MC.S.audioClipId); return !!(a && a.sections); })());
  /* シーン選び直しでは AUTO の決め打ちを当て直さない ─ こだわりで作った人の
     長さ・色の設定を潰さないため。変えるのは開始位置(startKey/startAt)だけ */
  const applyChoices = () => {
    if (!scene) MC.ui.applyAutoChoices();
    else {
      /* ★ シーンの候補は常に manual として t を直渡しする(2026-08-05 レビューP0)。
         known リストで分けていた前版は逆向きの一般化だった ─ bestScenes の
         ラベルは旧語彙キー(finale/solo等)を再利用するため、キーで引き直すと
         旧 candidates の代表位置(=押したサムネ・時刻と違う場面)へ流れる。
         候補は正確な t を持っている。キーに関わらず直渡しが唯一安全 */
      MC.S.startKey = "manual";
      MC.S.startAt = scene.t;
    }
  };
  let tick = null;
  try {
    /* ★ _autoRunning は try の**中**で立てる(2026-08-01 レビュー14件)。外で立てると、
       ここから autoStage.open() までのどれかが投げたとき finally に入らず、
       鍵が永久に返らない。setBusy(false) は _autoRunning が立っている間ずっと
       握り潰される(setBusy の先頭)ので、画面のボタンが二度と有効にならず、
       リロード以外に復帰手段が無くなる */
    MC.ui._autoCancel = false;
    /* 選び直しの印も必ず倒してから走る(2026-08-02)。前回の「選び直す」が
       残っていると、今回の普通の「やめる」まで素材へ飛ばされる */
    MC.ui._repickAfterCancel = false;
    MC.ui._repickHold = false;       // 実際に走り出したら保留は用済み
    MC.ui._autoRunning = true;      // 段の切れ目で鍵が外れないようにする
    MC.ui._autoT0 = performance.now();
    /* 2回目は同期までを飛ばすので、見積りもそのぶん縮める。
       学習済みの analysisRate は「同期込みの全体」で測っているため、
       仕上げ(映像解析)だけならおよそ半分になる(実測: 同期と音の読み込みが
       全体の5〜6割を占める) */
    MC.ui._autoEtaSec = MC.ui.autoEtaSec() * (sceneCached ? 0.5 : 1);
    applyChoices();
    MC.ui.setBusy(true);
    MC.ui.autoStage.open();          // ここから先はおまかせ専用の1画面だけ
    tick = setInterval(() => MC.ui.autoStage.render(), 500);   // 残り時間を減らす
    if (sceneCached) {
      /* 前回の解析を使い回す。飛ばした段は「前回のまま」と正直に言う */
      MC.ui.autoStage.step("scan");
      ["tilt", "sync", "audio"].forEach(k => MC.ui.autoStage.mark(k, "前回のまま"));
      /* 見積り学習の起点をここへ引き直す。runEasy を飛ばすと _anaT0 が
         前回のままで、完成画面で放置していた時間まで「解析にかかった時間」として
         学習に混ざる(learnAnalysisRate は runEasyFinish が呼ぶ) */
      MC.ui._anaT0 = performance.now();
      MC.ui.autoPreviewPlay();
    } else {
      /* ① 傾き(自動) → ② 同期 → ③ 音声(おすすめ) → ④ 音楽の解析 */
      await MC.ui.runEasy({ auto: true });
    }
    /* ★ `!MC.S.showIn == null` は `(boolean) == null` で**常に false**、
       しかも本体が空だった。この製品で一度事故った型そのもの(消した工程名が
       条件に残り `数値 < undefined` が常に false になった件)なので撤去する */
    if (MC.ui._autoCancel) throw new MC.ui.AutoCancelled();
    MC.ui.autoStage.mark("scan",
      (MC.S.showIn != null && MC.S.showOut != null)
        ? `演奏 ${Math.max(1, Math.round((MC.S.showOut - MC.S.showIn) / 60))}分` : "");
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
    applyChoices();
    /* 2回目は範囲が変わる。前の範囲に対するカット割と色統計を必ず捨てる ─
       捨てないと「新しい区間ぜんぶが1カメラ」「暗所基準の色補正」が
       黙って混ざる(invalidateCuts の注記) */
    if (scene) MC.ui.invalidateCuts();
    MC.ui.applyLengthChoice();
    MC.S.lengthDecided = true;
    MC.saveState();
    MC.ui.refreshJourney();
    await MC.ui.runEasyFinish();
    if (MC.ui._autoCancel) throw new MC.ui.AutoCancelled();
    /* ★ 失敗の言い方もモードで変える(2026-08-05)。縦型・ワイプは
       カット割を回していないので、「カメラの切り替え」と言われても
       何が起きたのか本人には結びつかない */
    if (!MC.S.easyDone) {
      throw new Error(MC.S.mode === "switch"
        ? "カメラの切り替えを決められませんでした"
        : "仕上げを終えられませんでした");
    }
    /* ★ 成果もモードで変える(2026-08-05)。カット数が意味を持つのは
       自動スイッチングだけで、縦型・ワイプでは必ず「0カット」と出ていた */
    MC.ui.autoStage.mark("finish", MC.S.mode === "switch"
      ? `${((MC.S.cutList || []).length) || 0}カット`
      : `${MC.S.clips.filter(c => !c.isAudio && !c.isImage).length}本ぶん`);
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
    if (e && e.name === "SyncDoubt") {
      /* 同じ演奏ではないかもしれない(2026-08-02)。失敗の顔ではなく、
         おまかせ全画面の上で2択を出して待つ。通知は「判断待ち」の既定に乗せる */
      MC.ui.autoStage.askSync(e.doubt);
    } else if (e && (e.name === "AutoCancelled"
        /* director/colormatch の中断点は素の Error("やめました") を投げる。
           名前だけで見分けると、本人がやめたのに失敗の顔が出る(2026-08-02)。
           _autoCancel が立っている=止めたのは本人、として同じ扱いにする */
        || (MC.ui._autoCancel && /やめました/.test(e.message || "")))) {
      MC.ui.autoStage.close();
      if (MC.ui._repickAfterCancel) MC.ui.repickLand();
      else {
        /* ★ やめたら**そのツールの最初の画面**へ(2026-08-07 優さん指示・再編)。
           以前は /#creators(映像ツール一覧)へ飛ばしていたが、再編で
           Reel/Switcher/Wipe が「別ツール」になった以上、やめた人が着くべきは
           いま使っていたツールの入口。リロードで戻る(動画は消える=優さん決定)。
           動画を残したい人の道は「動画を選び直す」(上の分岐)に元からある。
           location.pathname に寄せるのは ?test 等の一時パラメータを持ち越さないため */
        try { MC.ui.resetSavedProject(); } catch (e) {}
        { const m = MC.ui.MODES[MC.S.mode];
          const key = (m && m.toolKey)
            || ((window.MZToolScope && MZToolScope.get()) || {}).key || "";
          location.href = location.pathname + (key ? "?tool=" + key : ""); }
      }
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
    /* 失敗の顔と「同じ演奏か」の2択を出しているときだけは畳まない。
       それ以外は必ず畳む(canvasを戻す) */
    if (!MC.ui.autoStage._fail && !MC.ui.autoStage._ask) MC.ui.autoStage.close();
    MC.ui._autoRunning = false;   // 成功経路では上で返済済み(二重でも無害)
    MC.ui.setBusy(false);
    MC.ui.renderAll();
    MC.ui.refreshJourney();
    /* おまかせ中に見送られた軽い判定を拾い直す(2026-08-07 未解決P2)。
       setBusy(false) の**あと**に置くこと ─ 前に置くと _busy で弾かれて
       何も拾えない(この配線がまさに死んでいた形) */
    try { if (MC.media && MC.media.retryQuick) MC.media.retryQuick(); } catch (e) {}
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
  /* こだわりの「分析を開始」も数分かかる長い待ち。ここで待つと決めた人にだけ、
     一度だけ通知の許可を尋ねる(runAuto と同じ規則・同じ印) */
  if (!auto) MC.ui.askNotifyPermissionOnce();
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
  const tiltSteps = (auto && MC.S.autoTilt !== false) ? 1 : 0;
  /* 音声選択で一度止まるか。おまかせは止まらない(先に自動で決める)ので、
     解析の段まで必ず走る ─ ここを auto で見ないと分母が足りなくなる */
  const goesOn = auto || !(vids.length >= 2 && !MC.S.audioDecided);
  /* この段で走るのは同期と**音楽の解析**まで(2026-07-31)。
     重い映像解析は「長さと開始位置」を決めたあと、選ばれた範囲だけを見る */
  const p = MZP.start({ mount: "#easyStatus",
                        chapter: auto ? "おまかせ" : "同期", delay: 0,
                        steps: tiltSteps + syncSteps + (goesOn ? MC.ui.scanSteps() : 0),
                        label: (auto && MC.S.autoTilt !== false)
                          ? "傾きを直しています…" : "音を合わせています…" });
  /* おまかせは書き出しまで一度も止まらない。あと何分かを出さないと
     「進んでいるのか固まったのか」が分からない(2026-08-01)。

     ★ MZP の eta は `state === "run"`(確定進捗)のときしか描かれない
       (progress.js の _etaVisible)。自走は pulse なので eta では出せず、
       副文言(sub)に載せる。sub は状態を問わず描かれる */
  if (auto) MC.ui._autoT0 = performance.now();
  try {
    if (auto) {
      /* 傾きは同期より先に当てる。同期は音だけを見るので順序はどちらでもよいが、
         先に映像を触っておくと、あとの映像解析でデコーダが温まっている。
         ★「そのまま」を選んだ回は丸ごと飛ばす(2026-08-04 優さん指示) */
      if (MC.S.autoTilt !== false) {
        p.step(1, "傾きを直しています…").pulse("傾きを直しています…", { sub: MC.ui.autoSub() });
        MC.ui.autoStage.step("tilt", `${vids.length}本`);
        await MZP.paint();
        const fixed = await MC.ui.autoHorizon(p);
        MC.log("auto: 傾きを直した本数=" + fixed);
        MC.ui.renderClips();
        MC.ui.autoStage.mark("tilt", fixed ? `${fixed}本` : "そのままでOK");
      } else {
        /* ★ 検出をやめるだけでは足りない(2026-08-04 レビュー)。前の回に
           autoHorizon が入れた角度は clip.rot に残り、しかも保存される。
           horizonOn は常にONなので、そのままだと「そのまま」を選んだ人の映像が
           前回のとおり回り続ける。**本人が見ていない自動値だけ**戻す ─
           tiltOk はこだわりで本人が確認した印で、autoHorizon は立てないので、
           手で直した値は残る */
        const cleared = MC.ui.dropAutoTilt();
        if (cleared) MC.ui.renderClips();
        /* 直さないだけで「傾きの工程は済み」の扱いにする ─ こだわりへ
           切り替えたときに未確認のゲートで止めない(autoHorizon と同じ印) */
        MC.S.tiltSkipped = true;
        MC.saveState();
        MC.log("auto: 傾きは直さない設定(自動で入れた角度を戻した本数=" + cleared + ")");
      }
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
      const sres = await MC.sync.run(p);
      /* ★ 同じ演奏ではないかもしれない(2026-08-02 優さん指示)。
         おまかせは黙ってズレたまま進まず、ここで自走を止めて2択を返す
         (①同期なしでそのまま並べて作る ②動画を選び直す)。
         こだわりは sync.run 自身のトーストが知らせる(止めない) */
      if (auto && sres && sres.doubt && sres.doubt.length) throw new MC.ui.SyncDoubt(sres.doubt);
      {
        const off = Math.max(0, ...vids.map(c => Math.abs(c.offset || 0)));
        if (auto) MC.ui.autoStage.mark("sync",
          MC.S.syncDoubtAccepted ? "同期なし" : `ズレ ${off.toFixed(2)}秒`);
      }
      /* 同期に成功したら、失敗時に前倒しで開いたタブを本来の条件へ戻す
         (立てっぱなしだと以後ずっと序盤からタブが出る) */
      MC.ui._tabsForced = false;
    }
    if (auto) {
      /* おまかせは止まらない。音声はここで自動採用する ─
         同期のあとなら stats が揃っていて recommend が使える */
      MC.ui.autoStage.step("audio");
      /* ★ 本人が「仕上げの好み」で選んだ音は上書きしない(2026-08-06 レビューP0)。
         autoPickAudio は audioClipId を採点の勝者へ差し替え、さらに
         audioPickedByUser を false へ戻すため、選んだ音が**一度も効かない**
         うえに「別設定で作成」で開き直すと選択も忘れられていた。
         色・切替頻度が finishPicked で守られているのと同じ形にする */
      /* ★ ただし選んだ音が実は無音だったら見捨てない(2026-08-06 レビューP1)。
         この画面は解析の**前**に開くので hasAudio はまだ未確定で、音声トラックの
         無いクリップも選べてしまう。解析が済んだこの時点で分かるので、
         黙って無音の動画を作らず、自動選択へ落として事実を伝える */
      let picked = MC.S.audioPickedByUser && MC.getClip(MC.S.audioClipId);
      if (picked && picked.hasAudio === false) {
        MC.log("auto: 選ばれた音は無音だったため自動選択へ切り替え");
        MC.ui.toast("選んだ動画に音が入っていなかったので、別の音を使います");
        MC.S.audioPickedByUser = false;
        picked = null;
      }
      const pick = picked || MC.ui.autoPickAudio();
      MC.log("auto: 音声=" + (pick ? pick.name : "(なし)")
        + (picked ? "(本人の選択)" : ""));
      /* 音を整えたことは、新しい行を足さずに既にある成果の枠で言う。
         ★ 測れているときだけ言う ─ していないことを言わない */
      /* 右は値だけ。「音も整えます」は動詞で、左の段名と役割がぶつかる */
      MC.ui.autoStage.mark("audio", pick ? MZP.shortName(pick.name) : "");
      MC.ui.autoStage.step("scan");
    }
    if (vids.length >= 2 && !MC.S.audioDecided) {
      /* ここで一度手を止める: 音声を選んでから仕上げへ */
      p.done("同期できました", { sub: "使う音を選んで「この音で進める」を押してください" });
      /* ★ 人を待つ瞬間(2026-08-02 優さん指示)。同期は数分かかることがあり、
         その間に別アプリへ行った人は、ここで止まっていることに気づけない。
         auto は通らない分岐だが、規則を1つにするため silent も渡す */
      MC.ui.notifyUserTurn({
        silent: !!MC.ui._autoRunning,
        title: "使う音を選んでください",
        body: "同期できました。MarchinZ Switcher に戻って音を選ぶと先へ進めます",
        tab: "🔔 音を選んでください — MarchinZ",
      });
      MC.ui.renderAll();
      /* ★ 運ぶのは finally が _busy を下ろした**後**(2026-08-06 レビューP1)。
         ここはまだ _busy=true で、refreshJourney が工程を sync に固定するため
         #audioSec は step-off(display:none)。gentleScrollTo は
         offsetParent===null で即 return する ─ この行は死んでいた。
         音の工程はプレビューも出すようになり、375px では選択肢が
         折り目の下へ回るので、運ばないと「何も起きていない」ように見える */
      setTimeout(() => MC.ui.gentleScrollTo(document.querySelector("#audioSec"), "start"), 0);
      return;
    }
    await MC.ui.runEasyScan(p, tiltSteps + syncSteps);   // 続きの段番号から
  } catch (e) {
    /* 「同じ演奏ではないようです」は失敗ではなく判断待ち(2026-08-02)。
       失敗の顔・エラーログを通さず、そのまま runAuto の2択へ渡す */
    if (e && e.name === "SyncDoubt") {
      p.done("同期を確認します", { sub: "同じ演奏の動画かどうかを確認してください" });
      throw e;
    }
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
        /* 素の割合も残す。プレビューに重ねる円の進捗はこちらを使う ─
           0.8 で頭打ちにした値を%として出すと、100%読み終わっても
           「80%」と表示されてしまう(2026-08-01) */
        MC.ui.autoStage._innerRaw = Math.max(0, Math.min(1, fr || 0));
        MC.ui.autoStage.render();
      }
    };
    try { s = await MC.salute.detect(onProg); }
    catch (e) { MC.log("scan: 演奏区間を検出できず →", e.message); }
    /* 読み終わったら「段の中の%」を必ず戻す。残したままだと、このあとの
       解析の間ずっとプレビューの円が100%で止まって見える ─
       進んでいないのではなく、終わった数字が居座っているだけなのに */
    if (MC.ui.autoStage) MC.ui.autoStage._innerRaw = 0;
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
    /* ★ 人を待つ瞬間(2026-08-02)。音の読み込みは長尺でいちばん長く無言になる段で、
       終わったあとは「長さと開始位置」を人が決めるまで一歩も進まない。
       おまかせは止まらない(自分で決める)ので鳴らさない */
    MC.ui.notifyUserTurn({
      silent: !!MC.ui._autoRunning,
      title: "長さと開始位置を選んでください",
      body: "音楽の解析が終わりました。MarchinZ Switcher に戻ると続けられます",
      tab: "🔔 長さを選んでください — MarchinZ",
    });
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
    + ((MC.S.colorOn && vclips.length >= 2) ? 1 : 0)             // 色をそろえる
    + (MC.ui.willBuildProxy() ? 1 : 0);                          // 映像を軽くする
};

/* 縮小版を実際に作る段があるか(2026-08-06)。分母と実際に通る段は必ず揃える ─
   ずれると「4/3」のような表示になる。判断は MC.proxy.specFor 1本に任せ、
   ここでは条件を持たない(2箇所に規則が割れるのを避ける) */
MC.ui.willBuildProxy = () => {
  if (!window.MC || !MC.proxy || MC.proxy.off()) return false;
  if (!MC.exporter.opfsSupported || !MC.exporter.opfsSupported()) return false;
  return MC.S.clips.some(c => !MC.proxy.usable(c) && !!MC.proxy.specFor(c));
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
  let _est = _vc.length * Math.max(0, _to - _ti) * MC.ui.analysisRate();
  /* 4K縮小の見込みも分母へ(autoEtaSec と同じ式。2026-08-07 レビューP0) */
  if (MC.ui.willBuildProxy && MC.ui.willBuildProxy()) {
    for (const c of _vc) {
      if (MC.proxy.usable(c)) continue;
      const sp = MC.proxy.specFor(c);
      if (sp) _est += (sp.t1 - sp.t0) * (MC.isIOS ? 0.7 : 0.25);
    }
  }
  const _steps = Math.max(1, p.steps || MC.ui.finishSteps());
  const _eta = () => _est > 30 ? { eta: Math.max(0, _est * (1 - n / _steps)) } : undefined;
  try {
    /* ★ いちばん先に、素材を「実際に必要な大きさ」まで縮めておく(2026-08-06)。
       ここが唯一の差し込み点 ─ この時点で 種類・レイアウト・スロット・
       書き出す範囲・同期のずれ が全部確定していて、かつ重い工程
       (映像解析・色そろえ・書き出し)がまだ1つも走っていない。
       取り込み直後では範囲が決まっておらず、書き出し直前では解析に間に合わない。
       失敗しても素通しなので、ここで throw させない */
    {
      const st = MC.ui.autoStage;
      if (MC.ui.willBuildProxy()) {
        if (st) st.step("proxy");
        await MC.proxy.ensureAll(p, ++n).catch(e => {
          /* キャンセルは握らない(2026-08-07 レビューP2) ─ 握ると
             「やめています…」の最中に次の段が一瞬立ち上がる */
          if (MC.ui._autoCancel) throw e;
          MC.log("proxy: " + ((e && e.message) || e));
        });
        if (st) { st.mark("proxy", ""); st.step("finish"); }
      } else if (st && st.STEPS.some(s => s.key === "proxy")) {
        /* 開いた時点では作る予定だったが、直前に不要になった(レイアウト変更等)。
           未完了の丸を残さず「そのままでOK」で正直に埋める */
        st.step("proxy"); st.mark("proxy", "そのままでOK"); st.step("finish");
      }
    }
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
    /* 容量で落ちた回にこそ正確な数字が要る。測り直して描き直す(2026-08-06 レビューP1) */
    MC.exporter.refreshEstimate().then(() => { try { MC.ui._showErrorLog(err); } catch (_) {} });
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
  /* 一般ユーザーには出さない(2026-08-02 ⑫)。失敗の文言と次の一手は
     p.fail / 失敗の顔(asFailMsg・asFailHint)が言う。記録は積んだまま */
  if (!MC.ui.isAdmin()) { host.hidden = true; return; }
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
    ...(MC.exporter.estLine() ? [MC.exporter.estLine("サイト保存量:")] : []),
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
  /* ★ 凍結専用の手がかりを最優先で(2026-08-02)。下の /decoder/i に先に
     食われると「この形式は扱えない」という**間違った案内**になる ─
     v1.76.0 実機でまさにそう出た */
  if (/画面が消えて書き出しが中断/.test(m)) {
    hint = "もう一度おまかせを押すと、解析を使い回して書き出しだけやり直します。書き出しの間は画面を点けたままにしてください。";
  } else if (/メモリ|memory|allocat|OOM/i.test(m)) {
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
  /* 音の工程はプレビューも出るようになった(2026-08-06)ので、再生の入口が
     「試聴する」と再生ボタンの2つある。どちらで動かしても両方の表示を合わせる ─
     以前は試聴ボタンが自分の click でしか文言を変えず、再生ボタンで止めると
     「停止」と書かれたまま止まっていた */
  {
    const lb = MC.ui.$("#audioListenBtn");
    /* 再生中は rAF ごとに来るので、変わった時だけ書く(syncLenPlayBtns と同じ流儀)。
       音の工程はプレビューが回る画面なので、無ガードだと毎フレーム DOM を作り直す */
    const want = MC.S.playing ? "pause" : "play";
    if (lb && lb.dataset.mzState !== want) {
      lb.dataset.mzState = want;
      lb.innerHTML = MC.S.playing
        ? '<i class="fa-solid fa-pause"></i> 停止'
        : '<i class="fa-solid fa-headphones"></i> 試聴する';
    }
  }
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
      /* 720pの2割引きは廃止(2026-08-01 1080p統一) */
      const estMin = Math.max(1, Math.round(sec * factor / 60));
      const end = new Date(Date.now() + sec * factor * 1000);
      const endTxt = `${end.getHours()}:${String(end.getMinutes()).padStart(2, "0")}頃`;
      etaHint.textContent = `${mm}分${ss ? String(ss).padStart(2, "0") + "秒" : ""}の動画で、`
        + `書き出しにはおよそ${estMin}分（今始めると${endTxt}に終わります）`;
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

/* --- 最初のモード選択(①縦型 → ②自動スイッチング → ③ワイプ) ---
   presets/layouts = そのモードで選べるものだけ。ここに無い選択肢はUIに出さない。
   並びも表示順(2026-08-02 優さん指示)に合わせてある ─ カードの実体は
   index.html #modeStepKind 側で、ここは読み手のための整列 */
/* ★ toolKey/toolName/toolShort = 映像ツール再編(2026-08-07 優さん指示)。
   3モードを ①MarchinZ Reel ②MarchinZ Switcher ③MarchinZ Wipe という
   「3つのツール」として見せる(実体はこの1アプリ)。対応の正本は
   tools/shared/toolscope.js の TOOLS と揃えること。
   ★ label は**1文字も変えない** ─ noteToolUse が localStorage 経由で
     Firestore の target_label へ流しており、変えると過去の集計と混ざる */
MC.ui.MODES = {
  vertical: {
    preset: "9x16", layoutId: "v3", label: "縦型動画",   // 3分割縦積みが初期
    presets: ["9x16"],                                   // 縦型で固定(比率は選ばせない)
    layouts: ["v3", "v2", "big2", "single"],             // 横並べは廃止
    toolKey: "reel", toolName: "MarchinZ Reel", toolShort: "Reel",
  },
  switch: {
    preset: "16x9", layoutId: "switch", label: "自動スイッチング動画",
    presets: ["16x9"],                                    // 横型のみ(2026-07-19 優さん指定)
    layouts: ["switch"],                                  // ワイプは専用モードへ分離(2026-07-24)
    toolKey: "switcher", toolName: "MarchinZ Switcher", toolShort: "Switcher",
  },
  wipeCam: {
    preset: "16x9", layoutId: "wipe", label: "ワイプカメラ動画",   // メイン固定+小窓2まで(2026-07-24)
    presets: ["16x9"],
    layouts: ["wipe"],
    toolKey: "wipe", toolName: "MarchinZ Wipe", toolShort: "Wipe",
  },
};

/* いま作っている「ツール」の名前(2026-08-07 映像ツール再編)。
   通知・案内文の呼び名はこれを使う ─ 「MarchinZ Switcher」決め打ちだと、
   Reel で作っている人への通知が別ツールの名で届く。
   モード未確定(入口)では URL のスコープ → それも無ければ総称 */
MC.ui.toolName = () => {
  const m = MC.ui.MODES[MC.S.mode];
  if (m && m.toolName) return m.toolName;
  const sc = window.MZToolScope && MZToolScope.get();
  return (sc && sc.name) || "MarchinZ 映像ツール";
};

/* いま選ばれているモードの設定 */
MC.ui.modeConf = () => MC.ui.MODES[MC.S.mode] || MC.ui.MODES.vertical;

/* ============ 「どの動画を作ったか」をトップページへ渡す(2026-08-04 優さん指示) ============
   UGC(ツール)の一覧は「MarchinZ Switcher を使いました」までしか言えなかった。
   縦型/自動スイッチング/ワイプのどれかまで見たい、という要望。

   ★ このツールは firebase も認証も読み込まない(完全に端末内で処理する作りで、
     それが売り文句でもある)。だから**ここでは記録しない**。localStorage に
     置き手紙をして、記録はトップページ(marchinz-admin-ugc-log.js)に任せる。
     ツールはトップページのカードから同じタブで開き、完成後の「閉じる」も
     トップページへ戻すので、置き手紙はふつうに拾われる。
   ★ 種類を選ぶ前(=起動しただけ)も1通置く。選ばずに離れた人が
     「開いた」として残るようにするため。選べば上書きして種類つきになる。
   ★ 新しいFirestoreフィールドは足さない ─ rules の許可リスト(hasOnly)に
     無いキーは書き込みごと拒否される。種類は target_label の中に入れる */
MC.ui.TOOL_USE_KEY = "marchinz_tool_use_pending_v1";

MC.ui.noteToolUse = () => {
  try {
    /* ★ Reel/Switcher/Wipe を別カウント(2026-08-07 優さん決定)。
       toolId はモード確定ならその toolKey、未確定(起動しただけ)なら
       URLのスコープ、それも無ければ従来どおり switcher。
       過去データは switcher 勘定のまま(連続性は断つ、と合意済み)。
       firestore.rules の tool_id 許可リストに reel/wipe を足してある ─
       rules デプロイ前にこの版が本番へ出ると reel/wipe の記録だけ
       無音で拒否される(集計が3日欠ける程度の実害。機能は壊れない) */
    const m = MC.ui.MODES[MC.S.mode];
    const sc = window.MZToolScope && MZToolScope.get();
    localStorage.setItem(MC.ui.TOOL_USE_KEY, JSON.stringify({
      toolId: (m && m.toolKey) || (sc && sc.key) || "switcher",
      toolName: MC.ui.toolName(),
      modeLabel: m ? m.label : "",   // 「縦型動画」等(過去データと同じ語彙)
      at: new Date().toISOString(),
    }));
  } catch (e) { /* プライベートモード等で書けなくても本体は続行 */ }
};

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
  /* 工程中の現在地は短くツール名(2026-08-07 再編)。日本語の長い説明は
     入口(flowLead)で言い終えている */
  if (lbl) lbl.textContent = m.toolName || m.label;
  MC.preview.applyPreset();
  MC.ui.renderAll();
};

/* 選択画面の段の出し分け(2026-08-01)。
   1段目=何を作るか(種類) → 2段目=どう進めるか(おまかせ/こだわり)。
   何を作るかが決まらないと、おまかせが何をおまかせされるのかも決まらない */
MC.ui.showModeStep = step => {
  const kind = MC.ui.$("#modeStepKind"), flow = MC.ui.$("#modeStepFlow");
  if (!kind || !flow) return;
  /* ★ ツールスコープ(?tool=reel 等)があるときは、1段目「作る動画を選ぶ」を
     出さない(2026-08-07 映像ツール再編)。Reel の入口から来た人にとって
     種類は**もう選び終わった問い** ─ 出すと「押したのに同じことをまた
     聞かれた」になる。種類はスコープが決め、2段目(おまかせ/こだわり)から。
     スコープ無し(素の /tools/switcher/)は従来どおり1段目から */
  const sc = window.MZToolScope && MZToolScope.get();
  if (sc && step === "kind") {
    MC.ui._pendingMode = sc.mode;
    step = "flow";
  }
  kind.hidden = step !== "kind";
  flow.hidden = step !== "flow";
  /* スコープ中は「2 / 2」と「← 種類を選び直す」を出さない ─ 1段目が無いのに
     2/2 と言うと1段目を見逃した気になるし、種類の変更は別ツールへの移動 */
  { const back = MC.ui.$("#flowBackBtn");
    if (back) back.hidden = !!sc;
    const no = flow.querySelector(".mode-step-no");
    if (no) no.hidden = !!sc; }
  /* ★「フルショウはパソコンから」の案内はスマホのときだけ(2026-08-05 優さん指示)。
     パソコンで見ている人に「パソコンから作れます」と言っても意味が無い。
     上限なし(管理者・手元)にも出さない ─ その人には当てはまらない */
  /* ★ 登録済みの人に「無料登録」と言わない(2026-08-05 レビュー反映)。
     以前は member を見ずに出していたため、ログイン済みのスマホの人にも
     「無料登録＋パソコンから作れます」と勧め続けていた */
  { const tip = MC.ui.$("#mzModeTip"), L = window.MZ_LIMITS;
    if (tip) {
      const show = !!(L && L.mobile && !L.unlimited);
      tip.hidden = !show;
      const head = show ? MC.ui.$("#mzModeTipHead") : null;
      const body = show ? MC.ui.$("#mzModeTipBody") : null;
      if (head) {
        head.textContent = L.member
          ? "フルショウのランスルーは、パソコンから作れます。"
          : "フルショウのランスルーは、無料登録＋パソコンから作れます。";
      }
      /* ★ 2文目も member で出し分ける(2026-08-06 レビューP2-4: 「パソコンなら
         1本15分」が固定文で、ゲストが単独で読むと「PCで開くだけで15分」と
         誤読し得た ─ 実際はゲスト×PCは5分のまま。member=登録者だけがPCで
         15分になる、という条件を1文目と同じ主語でつなぐ */
      if (body) {
        body.textContent = "スマホで取り込めるのは1本5分まで。"
          + (L.member
            ? "パソコンなら1本15分まで取り込めて、10分までの動画を作成できます。"
            : "登録してパソコンで開くと1本15分まで取り込めて、10分までの動画を作成できます。");
      }
    } }
  /* おまかせの説明にある長さも、その人・その端末の値にする(2026-08-05)。
     静的に「60秒」と書いてあったが、ゲストは30秒なので嘘だった */
  { const d = MC.ui.$("#flowEasyDesc"), L = window.MZ_LIMITS;
    if (d && L && L.exportLimitLabelFor) {
      const lab = L.exportLimitLabelFor(MC.ui._pendingMode || MC.S.mode);
      /* ★「2本以上」を選ぶ前に言う(2026-08-06 保護者レビュー: 「任意」表記と
         needSecondVideoの門が矛盾し、スマホ1台の人が選んだ後で詰まっていた)。
         ★ 上限は「誰だから・いくつまで」を**理由つき+強調色**で(2026-08-06
           優さん「xxだから、aaまでを強調色で表示」。裸の「上限なし」は
           管理者自身が製品の姿と誤読した実績がある) */
      /* ★ 自動SW×スマホの30秒は技術的な天井 ─ 会員種別を主語にすると
         「登録すれば伸びる」と読める嘘になる(2026-08-06 レビューP1)。
         天井のときは端末を主語に */
      const capped2 = L.modeCapped && L.modeCapped(MC.ui._pendingMode || MC.S.mode);
      const who = capped2 ? "スマホ"
        : L.unlimited ? "管理者" : L.member ? "登録済み" : "未登録";
      const lim = lab === "上限なし"
        ? `<b class="mode-desc-limit">${who}だから上限なし</b>。`
        : `<b class="mode-desc-limit">${who}だから${MC.ui.esc(lab)}まで</b>の`;
      d.innerHTML = `動画を2本以上選ぶだけ。${lim}見どころを、傾きも色も整えて自動で書き出します`;
    } }
  if (step === "flow") {
    const lead = MC.ui.$("#flowLead");
    const m = MC.ui.MODES[MC.ui._pendingMode] || MC.ui.modeConf();
    /* ツール名が主・日本語は説明(2026-08-07 再編)。日本語を括弧で残すのは
       説明のためだけでなく、QAの「ワイプ」表記の見張りを生かすため */
    if (lead) lead.textContent = `${m.toolName}（${m.label}）を作ります`;
    MC.ui.renderFlowLock();
  }
};

/* 「こだわり」は登録した人だけ(2026-08-02 優さん指示)。
   ★ 判定は MZ_LIMITS.proAllowed だけを見る。おまかせは誰でも使える。
   カードは消さず、鍵つきで見せる ─ 消すと存在に気づけない */
MC.ui.proAllowed = () => Boolean((window.MZ_LIMITS || {}).proAllowed);

MC.ui.renderFlowLock = () => {
  const ok = MC.ui.proAllowed();
  const card = document.querySelector('#modeSelect .mode-card[data-flow="pro"]');
  const lock = MC.ui.$("#flowProLock");
  if (lock) {
    lock.hidden = ok;
    /* 鍵の札は「何が足りないか」を言う(2026-08-02 優さん指示⑩「こだわりはPCだけ」)。
       登録済みの人に「登録した方が」と言うと、登録誘導と混同する */
    if (!ok) {
      const L = window.MZ_LIMITS || {};
      lock.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i> '
        + ((L.member || L.unlimited) ? "パソコンで使えます" : "登録＋パソコンで使えます");
    }
  }
  if (card) {
    card.classList.toggle("mode-card--locked", !ok);
    /* aria-disabled にする(disabled にはしない)。押せなくすると理由を出せず、
       「反応しない画面」になる ─ 押させて、理由と次の一手を返す */
    card.setAttribute("aria-disabled", ok ? "false" : "true");
  }
  if (ok) { const n = MC.ui.$("#flowProNote"); if (n) n.hidden = true; }
};

/* 鍵つきの「こだわり」を押したときの案内。理由と、次の一手(登録/ログイン)を出す */
MC.ui.showFlowLockNote = () => {
  const n = MC.ui.$("#flowProNote");
  /* ★ 何が足りないかで案内を分ける(2026-08-02 優さん指示⑩)。
     ・登録済み×スマホ: 「パソコンでご利用いただけます」だけ。登録誘導と混同させない
     ・未登録        : 従来の登録・ログイン案内(パソコンの条件も1語で言う) */
  const L = window.MZ_LIMITS || {};
  const memberOk = !!(L.member || L.unlimited);
  MC.ui.buzz([30]);   // 進まなかったことを触覚でも返す(無反応に見せない)
  if (!n) { MC.ui.toast(memberOk ? "「こだわり」はパソコンで使えます"
                                 : "「こだわり」は登録すると使えます"); return; }
  n.hidden = false;
  n.innerHTML = memberOk
    ? '<p class="mfn-title"><i class="fa-solid fa-desktop" aria-hidden="true"></i> '
      + '「こだわり」はパソコンでご利用いただけます</p>'
      + '<p class="mfn-body">細かい調整の画面はパソコン向けです。'
      + '<b>この端末では「おまかせ」が使えます。</b></p>'
    : '<p class="mfn-title"><i class="fa-solid fa-lock" aria-hidden="true"></i> '
      + '「こだわり」は登録した方がパソコンで使えます</p>'
      /* できることの説明は書かない(2026-08-02 レビュー)。すぐ上のカードに
         同じ文が出ており、二度書くと文字が増えるだけになる。
         ここで言うべきことは2つ ─ 登録は無料 / いま使える道がある */
      + '<p class="mfn-body">登録は無料です。'
      + '<b>「おまかせ」は登録なしで今すぐ使えます。</b></p>'
      + '<div class="mfn-btns"><a class="btn primary mfn-go" href="/#signup">無料登録する</a>'
      + '<a class="btn ghost mfn-go" href="/#login">ログイン</a></div>';
  n.scrollIntoView({ behavior: "smooth", block: "nearest" });
};

MC.ui.showModeSelect = () => {
  MC.preview.pause();  // 選択画面の裏で音が鳴り続けないように
  MC.ui.$("#workspace").hidden = true;
  MC.ui.$("#modeSelect").hidden = false;
  /* 戻ったら必ず最初の段から。スコープ(?tool=)があれば showModeStep が
     自動で2段目(おまかせ/こだわり)を出す = そのツールの最初の画面(2026-08-07) */
  MC.ui.showModeStep("kind");
  document.body.classList.remove("mz-focus");   // 工程を抜けたらサイトの外枠を戻す
  /* 作業画面の「← 種類を変える」は、スコープ中は種類が固定なので
     「← 進め方を選び直す」と名乗る(showModeSelect の着地が実際にそこ) */
  { const sc = window.MZToolScope && MZToolScope.get();
    const b = MC.ui.$("#modeBackBtn");
    if (b) b.textContent = sc ? "← 進め方を選び直す" : "← 種類を変える"; }
};

/* --- イベント配線 --- */
MC.ui.wire = () => {
  const $ = MC.ui.$;

  /* ★ ヘッダーの「← 戻る」を文脈で分ける(2026-08-05 優さん実機
     「戻るで、スイッチャーの各ツールのページに戻らない」)。
     作業中(縦型・自動SW・ワイプの工程内)に押すとサイトへ飛んでいた ─
     期待は「作る動画を選ぶ」(種類選択)へ戻ること。
     種類選択の画面にいるときだけ、従来どおりサイトのクリエイターページへ。
     素材は showModeSelect が保つ(消すのは「最初からやり直す」だけ) */
  { const backLink = document.querySelector(".topbar .back-link");
    if (backLink) backLink.addEventListener("click", e => {
      /* ★ 解析・書き出し中は遷移しない(2026-08-05 レビューP1)。
         こだわりの進捗はインライン表示なので topbar が押せてしまい、
         director.run が走ったまま種類選択→mode書き換えまで到達できた */
      if (MC.ui._busy || (MC.exporter && MC.exporter.running)) {
        e.preventDefault();
        MC.ui.toast("処理中です。終わるまでお待ちください(中止するには画面内の「中止」を)");
        return;
      }
      /* ★ 「← 戻る」の設計(2026-08-05 優さん)。
         ・作業中: 横取りしてツール内の種類選択へ ─ ページ遷移すると
           取り込んだ動画(メモリ上)が消えるため
         ・最上位(種類選択): ふつうのリンクとして映像ツール一覧
           (/#creators)へ遷移する。ここは意図した退出なので
           保存状態も捨てる(goToolList と同じ扱い)。
         ※ TOPはハッシュ=ルートのSPA。#creators は site-nav.js の pageIds に
           登録された正規ルートで、#creators-heading(見出しのid)へ変えると
           逆にルーター不発でTOP先頭へ落ちる(2026-08-06 レビューで実測) */
      const modeSel = $("#modeSelect");
      if (modeSel && modeSel.hidden) {
        e.preventDefault();
        MC.ui.showModeSelect();
        MC.ui.toast("取り込んだ動画はそのまま残っています");
        return;
      }
      MC.ui.resetSavedProject();   // 素通し=退出。次に来たら最初から
    }); }

  /* 種類カード。**ここでは作業画面へ進まない**(2026-08-01)。
     選んだ種類を覚えて、2段目の「どちらで作りますか」へ送る */
  document.querySelectorAll("#modeSelect .mode-card[data-mode]").forEach(card =>
    card.onclick = () => {
      MC.ui._pendingMode = card.dataset.mode;
      MC.ui.showModeStep("flow");
    });
  { const b = MC.ui.$("#flowBackBtn");
    if (b) b.onclick = () => MC.ui.showModeStep("kind"); }
  /* 「このツールを友達にシェア」(2026-08-02)。完成画面と完了カードの両方に置く。
     動画そのものの共有(#eoSaveBtn/#saveBtn)とは別の処理 */
  ["#eoShareTool", "#doneShareTool"].forEach(sel => {
    const b = MC.ui.$(sel);
    if (b) b.onclick = () => MC.ui.shareTool();
  });
  /* 仕上げの好み(2026-08-03)。進む=好みを既存フラグへ書いて自走を再開。
     ★ 戻る=素材の工程へ着地させる(2026-08-03 push前レビュー)。閉じるだけでは、
       おまかせの人が現在地「同期と分析」の5工程の画面に置き去りになり、
       再開の道がどこにも無かった(実測: 見えるのは試聴/この音で進めるだけ)。
       全画面の「動画を選び直す」(#asRepick)と同じ着地(repickLand)を使い、
       行動バーの「これでOK、おまかせを再開」で戻れるようにする ─
       finishPicked は倒れたままなので、再開すればこの画面がまた開く */
  { const b = MC.ui.$("#fpBack");
    if (b) b.onclick = () => MC.ui.finishPickBack(); }
  /* ★ Escape でも同じ着地(2026-08-03 レビュー)。aria-modal を名乗る以上、
     閉じる手が要る ─ 書き出しの全画面(#exportOverlay)と作法を揃える */
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const el = MC.ui.$("#finishPick");
    if (!el || el.hidden) return;
    e.preventDefault();
    MC.ui.finishPickBack();
  });
  { const g = MC.ui.$("#fpGo");
    if (g) g.onclick = () => MC.ui.finishPickGo(); }
  /* おまかせ全画面の中止。走っている処理にも止まれと伝える */
  { const c = MC.ui.$("#asCancel");
    if (c) c.onclick = () => {
      /* ★ 確認を挟む(2026-08-01 レビュー14件)。7分待った直後の1タップで全部消えるのは重すぎる */
      if (!window.confirm(`やめて、${MC.ui.toolName()}の最初の画面に戻りますか？\n(取り込んだ動画は消えます。動画を残すなら「動画を選び直す」)`)) return;
      MC.ui._autoCancel = true;
      if (MC.exporter) MC.exporter.cancelFlag = true;
      /* ★ 押しても即座には畳まない(2026-08-01 レビュー14件)。畳んでも解析は動き続けるうえ、
         _autoRunning が立っている間は setBusy(false) が握り潰されるので、
         裏の画面はボタンが全部無効のまま数分固まって見えていた
         (「やめたのに何も押せない・端末が熱い」がいちばん信用を失う)。
         実際に止まるまで、この画面で「やめています…」と言って待つ */
      MC.ui.autoStage.cancelling();
    }; }
  /* おまかせ全画面の「動画を選び直す」(2026-08-02 優さん指示)。
     中止の仕組みは「やめる」と**同じ鍵**(_autoCancel / cancelFlag / sync.cancel)を
     流用し、新しい鍵は作らない。増やすのは「止まったあとの行き先」の印だけ。
     確認も「やめる」と同じ作法で1回だけ挟む */
  { const b = MC.ui.$("#asRepickRun");
    if (b) b.onclick = () => {
      if (!window.confirm("動画を選び直しますか？\n取り込んだ動画と、ここまでの解析結果は残ります。")) return;
      MC.ui._repickAfterCancel = true;   // 着地の印(中止の鍵ではない)
      MC.ui._autoCancel = true;
      if (MC.exporter) MC.exporter.cancelFlag = true;
      /* 押しても即座には畳まない ─ 実際に止まるまでの顔は「やめる」と共通 */
      MC.ui.autoStage.cancelling();
    }; }
  /* 「同じ演奏ではないようです」の2択(2026-08-02 優さん指示)。
     ①同期なし: 印を立てて自走を再開(sync.run が疑いの本を0秒へ置く)
     ②選び直す: 全画面を畳んで素材の工程へ戻す(動画は消さない。
       入れ替えたら focusNextAction がまた自走を始める) */
  { const b = MC.ui.$("#asNoSync");
    if (b) b.onclick = () => {
      MC.S.syncDoubtAccepted = true;
      MC.ui.autoStage.close();
      MC.ui.runAuto();
    }; }
  { const b = MC.ui.$("#asRepick");
    if (b) b.onclick = () => {
      MC.ui.autoStage.close();
      /* ★ 着地は repickLand に一本化(2026-08-03 レビュー)。保留を立てて素材工程へ
         という同じ手順が2箇所に複製されていて、しかもここは refreshJourney が
         1回だけだった ─ 到達点が動いた回に _viewPhase が消される罠(ui.js:1876)は
         この経路にも当てはまる。いまは runAuto の finally が先に到達点を
         落ち着かせているので偶然助かっているだけで、そこを触ると再発する。
         (保留が無いと、間違った動画を✕で外した瞬間に自走が再開してしまう 2026-08-02) */
      MC.ui.repickLand("動画を入れ替えてください（同じ演奏を撮ったものどうしだと同期できます）");
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
      /* ★ こだわりは登録した人だけ(2026-08-02 優さん指示)。
         黙って無反応にはしない ─ 理由と次の一手(登録/ログイン)を出して止まる。
         おまかせは今までどおり誰でも押せる */
      if (flow === "pro" && !MC.ui.proAllowed()) { MC.ui.showFlowLockNote(); return; }
      MC.ui._autoFlow = flow === "easy";
      /* 進め方を選び直したら、選び直しの保留は用済み(2026-08-02)。
         残っていると、おまかせを選んだのに永久に走り出さない */
      MC.ui._repickHold = false;
      /* ★ 入口を通り直したら「仕上げの好み」も選び直し(2026-08-03 push前レビュー)。
         finishPicked は完走後も立ったままなので、ここで倒さないと、種類を替えた
         新規おまかせが画面を挟まず走る ─ ワイプならメイン/右下を誰も選ばないまま
         (2026-08-02 優さん指示への退行。v1.85.0 の needsWipePick はモード別に
         見ていたので必ず挟まっていた)、前回の色/±1も applyAutoChoices のガードで
         生き残る。倒せば毎回おすすめ選択済みの1画面から始まる。
         「別のシーン」「もう一度」等の作り直しはこの入口を通らないので、
         走行中の選択はそのまま生きる */
      MC.S.finishPicked = false;
      /* 1段目で選んだ種類をここで確定する。種類が未選択のまま
         2段目へ来ることは無いが、保険で switch に落とす */
      MC.ui.chooseMode(MC.ui._pendingMode || MC.S.mode || "switch");
      MC.ui.noteToolUse();   // どの種類を使ったかをトップページへ渡す(下の説明を参照)
      MC.ui.setSetupTab(flow === "easy" ? "easy" : "pro");
      if (flow === "pro") MC.ui._tabsForced = true;   // こだわりを選んだ人にはタブを出す
      MC.ui.refreshSetupTabs();
      MC.ui.refreshJourney();
      /* すでに素材が入っている(前回の続き)なら、その場で走り出す。
         自走の前の「仕上げの好み」1画面はここでも挟む(2026-08-03) */
      if (MC.ui._autoFlow && MC.media.slotClips().length) {
        if (MC.ui.needsFinishPick()) MC.ui.openFinishPick();
        else MC.ui.runAuto();
      }
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
    /* 再生状態はplay()のPromise後に確定するので少し待ってから表示を合わせる。
       文言の正本は updateTransport(再生ボタンと共通) */
    setTimeout(() => MC.ui.updateTransport(), 250);
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
    else {
      /* ★ 仕上げ済みで選び直しただけの場合(2026-08-06 レビューP1)。
         工程バーから戻ってきた人は _viewPhase="audio" で居座っているため、
         refreshJourney だけでは到達点が動かず**画面が1pxも動かない**。
         押しても何も起きない=壊れたと見える。寄り道を解いて到達点へ返す */
      MC.ui._viewPhase = null;
      MC.ui.refreshJourney();
      MC.ui.toast("この音で進めます");
    }
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
    /* ★ こだわりの手動ボタン3つ(同期・カット割・色合わせ)は自分しか
       止めていなかった(2026-08-01 交差レビュー)。同期の最中に書き出しを
       押せる ─ ズレたままの3本が黙って1本の動画になる経路。
       setBusy で作業領域を丸ごと止め、必ず finally で返す */
    if (MC.ui._busy) return;
    /* ★ 手動の3ボタン(同期・カット割・色合わせ)も数分の長い待ち(2026-08-02 レビュー)。
       終わったら notifyUserTurn で呼び戻すのに、許可を尋ねる場所が
       runAuto/runEasy だけだと、手動で進めた人には通知だけが永遠に届かない。
       印(localStorage)は共通なので、尋ねるのは一度きりのまま */
    MC.ui.askNotifyPermissionOnce();
    MC.ui.setBusy(true);
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
      /* ★ 人を待つ瞬間(2026-08-02)。同期は数分かかり、終わったら次に何をするかは
         本人が決める。別アプリへ行っていた人を呼び戻す */
      MC.ui.notifyUserTurn({
        silent: !!MC.ui._autoRunning,
        title: "ズレを合わせました",
        body: "MarchinZ Switcher に戻ると、次の工程へ進めます",
        tab: "🔔 同期できました — MarchinZ",
      });
      // 次のフェーズ(整える)へそっと誘導
      setTimeout(() => { MC.ui.gentleScrollTo($("#layoutSec"), "start"); }, 900);
    } catch (e) {
      MC.ui.toast("⚠ 同期に失敗: " + e.message); console.error(e);
      p.fail("ズレを合わせられませんでした", { detail: e.message,
        retry: () => $("#syncBtn").click() });
    } finally {
      MC.ui.setBusy(false);
      $("#syncBtn").disabled = MC.S.clips.filter(c => !c.isImage).length < 2;
    }
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
    /* こだわりからの実タップならここが活性。おまかせの合成clickなら
       runAuto 側の prime が済んでいる(どちらでも二重には作らない) */
    MC.ui.eoLive.prime();
    /* 実時間録画の音は、このタップの活性があるうちに起こしておく
       (2026-08-06 レビューP1。録画の入口では活性が切れており iOS で無音になる) */
    MC.exporter.primeAudio();
    /* ★ 前回の書き出しファイルを OPFS から手放してから始める(2026-08-06 実機11.26GB)。
       「別のシーン」「別設定で作り直す」は書き出しを繰り返すのに、片付けは
       退出導線にしか無く、8分なら732MBが1本ごとに積み上がっていた */
    MC.exporter.releasePrevExport();
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
      const planMax = lim && lim.maxExportSecFor
        ? lim.maxExportSecFor(MC.S.mode) : (lim && lim.maxExportSec);
      if (lim && wantSec > planMax) {
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
        : await MC.exporter.runWatched(() => MC.exporter.exportMP4(p.legacy(), saveHandle));
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
  /* ダウンロードは downloadResult に一本化(2026-08-01)。素で triggerDownload を
     呼ぶと「実行したのに何も言わない」ボタンに戻る(優さん指摘の当のバグ) */
  $("#downloadBtn").onclick = () => MC.ui.downloadResult();
  // 書き出し全画面(案B)のボタン。中身はパネル側と同じ動きに寄せる
  $("#eoCancel").onclick = () => { MC.exporter.cancelFlag = true; };
  $("#eoSaveBtn").onclick = () => MC.ui.saveResult();
  $("#eoDownloadBtn").onclick = () => MC.ui.downloadResult();
  /* ★ 失敗の顔からの「閉じる」はツールのトップへ(2026-08-02 優さん指示
     「止まった後に戻ると、おまかせのところに行く。戻る時はツールのトップに」)。
     失敗して閉じた人が、失敗したときのおまかせの工程画面に立たされていた ─
     やり直すのか・別の動画にするのかを選び直す場所は、最初の
     「作る動画の種類」(1段目)のほう。行き先は既存の showModeSelect に乗せる
     (showModeSelect が必ず1段目=modeStepKind から出す)。
     ★ 成功後の「閉じる」は**ツール一覧**へ(2026-08-02 優さん指示⑧
     「さっきので閉じると、こだわりのuiに戻る。ここは、ツール一覧に戻ってほしい」)。
     作り終えた人の用事はこのツールでは済んでいて、こだわりの工程画面に
     立たせても次にやることが無い。行き先はトップページのクリエイター節。
     未保存のまま閉じようとしたら1回だけ確認する ─ ページを離れると
     いま作った動画(メモリ上のblob)は消えるため、黙って失わせない */
  MC.ui.goToolList = () => {
    MC.ui.resetSavedProject();   // 意図した退出=次は最初から(⑪)
    location.href = "/#creators";
  };
  const eoCloseByUser = () => {
    const failed = $("#exportOverlay").classList.contains("eo-failed");
    if (failed) {
      MC.ui.exportOverlay.close();
      MC.ui.showModeSelect();
      return;
    }
    if (!MC.ui._saved && MC.exporter.lastResult && MC.exporter.lastResult.blob) {
      if (!confirm("まだ保存していません。閉じると、いま作った動画は消えます。\n閉じますか？")) return;
    }
    /* ★ 全画面は畳まずに移動する(2026-08-03 優さん指摘「一度こだわりのページが
       表示され、その後TOPページに戻る」)。location.href の遷移は即座ではないので、
       先に close() すると、その待ち時間だけ裏のこだわりの作業画面が露出していた ─
       作り終えた人にはもう用の無い画面が一瞬だけ現れる。
       覆ったまま移動すれば、見えるのは完成の画面 → ツール一覧 の1回だけ。
       ★ 遷移が始まらなかったときのために、文言だけ「戻っています」に替える
         (押したのに何も起きていないように見せない) */
    MC.ui.exportOverlay.leaving();
    MC.ui.goToolList();
  };
  $("#eoClose").onclick = eoCloseByUser;
  document.addEventListener("keydown", ev => {
    // Escは「閉じる」が出ているときだけ(書き出し中の誤爆で消さない)
    if (ev.key === "Escape" && !$("#exportOverlay").hidden && !$("#eoClose").hidden) {
      eoCloseByUser();
    }
  });

  // --- Phase 2: 自動カット割+ワイプ+タイムライン ---
  $("#bpbSelect").onchange = e => { MC.S.beatsPerBar = parseInt(e.target.value); MC.saveState(); };
  MC.ui.renderLevel();
  $("#autocutBtn").onclick = async () => {
    if (MC.ui._busy) return;          // ★ 他の作業中は始めない(2026-08-01 交差レビュー)
    MC.ui.askNotifyPermissionOnce();  //    長い待ちに入る入口(2026-08-02 レビュー)
    MC.ui.setBusy(true);              //    解析中に書き出しを押される経路を塞ぐ
    MC.preview.pause();   // 解析中はvideo要素をシークで専有する
    const p = MZP.start({ mount: "#autocutStatus", chapter: "レイアウト",
                          delay: 0, steps: 3 });
    p.pulse("音楽を解析しています…");
    await MZP.paint();
    try {
      const r = await MC.director.run(p);
      /* ★ 出なかったカメラは理由ごと言う(2026-08-04 DCI規則5)。
         出番の義務で悪い画を混ぜる代わりに、なぜ出なかったかをここで説明する */
      const unused = (MC.S.unusedCams || [])
        .map(u => `${MC.shortName ? MC.shortName(u.name) : u.name}は${u.why}未使用`)
        .join("。");
      p.done(`${r.bpm.toFixed(0)} BPM・${r.segments}カットを作りました`,
             { sub: `ディゾルブ${r.dissolves}回・帯をタップするとそこへ移動します`
                    + (unused ? `\n${unused}` : "") });
      /* ★ 人を待つ瞬間(2026-08-02)。映像解析はいちばん重く、終わったあとは
         カット割を本人が見て直す ─ 戻ってこないと先へ進まない */
      MC.ui.notifyUserTurn({
        silent: !!MC.ui._autoRunning,
        title: "カット割ができました",
        body: `${r.segments}カット。MarchinZ Switcher に戻って確認してください`,
        tab: "🔔 カット割ができました — MarchinZ",
      });
      MC.timeline.render();
      MC.preview.seek(MC.trimRange()[0]);
    } catch (e) {
      console.error(e);
      p.fail("カット割を作れませんでした", { detail: e.message });
      MC.ui.showErrorLog(e);
    } finally { MC.ui.setBusy(false); $("#autocutBtn").disabled = false; }
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
    if (MC.ui._busy) return;          // ★ 他の作業中は始めない(2026-08-01 交差レビュー)
    MC.ui.askNotifyPermissionOnce();  //    長い待ちに入る入口(2026-08-02 レビュー)
    MC.ui.setBusy(true);              //    色解析は<video>のシークを専有する
    const p = MZP.start({ mount: "#finishStatus", chapter: "仕上げ",
                          label: "色を調べています…" });
    try {
      await MC.color.run(p);
      p.done("色を合わせました", { sub: "音声に使うカメラに合わせています" });
      /* ★ 人を待つ瞬間(2026-08-02)。色解析は<video>のシークを専有するので
         待ち時間が読めない。終わったら本人の目で見てもらう */
      MC.ui.notifyUserTurn({
        silent: !!MC.ui._autoRunning,
        title: "色を合わせました",
        body: "MarchinZ Switcher に戻ってプレビューを確認してください",
        tab: "🔔 色を合わせました — MarchinZ",
      });
      MC.ui.renderFinish(); MC.preview.draw();
    } catch (e) {
      console.error(e);
      p.fail("色を合わせられませんでした", { detail: e.message });
    } finally { MC.ui.setBusy(false); $("#colorMatchBtn").disabled = false; }
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
