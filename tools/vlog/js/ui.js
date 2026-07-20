"use strict";
/* ============ MarchinZ Vlog: 画面 ============
   375pxの縦持ち片手操作が第一の完成形(CLAUDE.md 必須ルール8)。
   ・情報は縦積み1カラム。枠そのものが大きなタップ標的
   ・主アクションは親指ゾーンのボトムバーへ。実ボタンの click() を叩く
     プロキシ方式にして、状態を二重管理しない(Switcherで確立)
   ・空き枠を上限数ぶん先に並べない。入った分だけ増やし、撮ってほしいものは
     セクションに1枚のチェックリストで見せる(同じ指示が何枚も並ぶのを防ぐ) */

MV.ui = {};

MV.ui.$ = sel => document.querySelector(sel);
MV.ui.esc = s => String(s == null ? "" : s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

MV.ui.toast = msg => {
  const el = MV.ui.$("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(MV.ui._toastT);
  MV.ui._toastT = setTimeout(() => el.classList.remove("on"), 3400);
};

MV.ui.fmtTime = sec => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}分${String(s).padStart(2, "0")}秒`;
};
MV.ui.fmtClock = sec => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
};

/* ---------- 雰囲気(モード) ----------
   単体の着地ページではなく、作業領域の最初のセクションとして常に選べる状態にする
   (2026-07-20)。切り替えても入れた素材は消えない。カードの並びは
   おすすめ→アクティブ→エモーショナルの順(優さん指定)。 */
MV.ui.initModes = () => {
  document.querySelectorAll(".mode-card").forEach(card => {
    card.onclick = () => MV.ui.chooseMode(card.getAttribute("data-mode"));
  });
};

MV.ui.renderModeCards = () => {
  document.querySelectorAll(".mode-card").forEach(card => {
    const on = card.getAttribute("data-mode") === MV.S.mode;
    card.classList.toggle("on", on);
    card.setAttribute("aria-checked", on ? "true" : "false");
  });
};

MV.ui.chooseMode = id => {
  const m = MV.DATA.MODES[id];
  if (!m || id === MV.S.mode) return;
  MV.S.mode = id;
  MV.S.plan = null;
  MV.saveState();
  MV.ui.renderModeCards();
  MV.ui.renderAll();   // チェックリスト・Artlistの推奨・見込み尺が雰囲気で変わる
};

/* ---------- ジャーニーバー(既存3ツールと同じ現在地表示) ---------- */
MV.ui.journeyState = () => {
  if (MV.exporter && MV.exporter.lastResult) return "save";
  if (MV.S.plan) return "check";
  if (MV.ui.ready()) return "build";
  return "mat";
};

MV.ui.PHASES = ["mat", "build", "check", "save"];

MV.ui.initJourney = () => {
  if (!window.MZJourney) return;
  MZJourney.init({
    container: MV.ui.$("#workspace"),
    phases: [
      { id: "mat",   label: "素材",   hint: "インタビュー・インサート映像を枠に入れてください" },
      { id: "build", label: "組み立て", hint: "「Vlog自動編集」で構成に沿って並びます" },
      { id: "check", label: "見て直す", hint: "できあがりを確認してください" },
      { id: "save",  label: "書き出す", hint: "MP4で保存します" },
    ],
    doneHint: "できあがりました。別の雰囲気でも試せます",
    /* 画面の状態から現在フェーズを導出する(遷移箇所ごとの呼び忘れが起きない)。
       返す形は {current, done[]}(文字列を返すと反映されない) */
    autoState: () => {
      const cur = MV.ui.journeyState();
      return { current: cur, done: MV.ui.PHASES.slice(0, MV.ui.PHASES.indexOf(cur)) };
    },
  });
};

/* autoState が定期的に見に来るので、明示的な同期は不要。
   呼び出し側の互換のために残してある */
MV.ui.syncJourney = () => {};

/* ---------- 撮ってほしいもののチェックリスト ----------
   枠ごとに同じガイドを並べると10枠で2周してしまうため、
   重複を除いた一覧をセクションに1枚だけ出す */
MV.ui.renderChecklist = () => {
  const host = MV.ui.$("#insCheck");
  const items = MV.DATA.insertChecklist(MV.S.mode);
  const n = MV.S.inserts.length;
  const rows = items.map((g, i) => {
    // 入った本数ぶんだけ、上から満たされたとみなす(判定はせず、責めない見せ方)
    const done = i < n;
    return `<li class="${done ? "on" : ""}">
      <span class="cl-icon" aria-hidden="true"><i class="fa-solid ${g.icon || "fa-video"}"></i></span>
      <span class="cl-body">
        <span class="cl-what">${MV.ui.esc(g.what)}
          <i class="fa-solid ${done ? "fa-circle-check" : "fa-circle"} cl-status" aria-hidden="true"></i></span>
        <span class="cl-how">${MV.ui.esc(g.how)}</span>
      </span>
    </li>`;
  }).join("");
  host.innerHTML = `<p class="cl-lead">この${items.length}つがあると、いい形に組み上がります</p>
    <ul class="cl-list">${rows}</ul>`;
};

/* ---------- スロット(入った素材だけ並べる) ---------- */
MV.ui.clipCard = (c, kind) => `
  <div class="slot filled" data-kind="${kind}" data-id="${c.id}">
    <button type="button" class="slot-del" data-mv-del="${c.id}" data-kind="${kind}"
      aria-label="${MV.ui.esc(c.name)} を外す"><i class="fa-solid fa-xmark"></i></button>
    ${c.thumb ? `<img class="slot-thumb" src="${c.thumb}" alt="">`
              : `<span class="slot-thumb"></span>`}
    <span class="slot-name">${MV.ui.esc(c.name)}</span>
    <span class="slot-meta">${MV.ui.fmtClock(c.duration)}</span>
    ${kind === "ins" ? `<label class="slot-showtoggle">
      <input type="checkbox" data-mv-show="${c.id}" ${c.isShow ? "checked" : ""}>
      本番の演技として使う
    </label>` : ""}
  </div>`;

MV.ui.renderInsSlots = () => {
  const L = window.MZ_LIMITS || {};
  const max = L.maxVlogInserts || 4;
  const items = MV.S.inserts;
  MV.ui.$("#insSlots").innerHTML = items.map(c => MV.ui.clipCard(c, "ins")).join("");
  const btn = MV.ui.$('[data-mv-add="ins"]');
  if (!isFinite(max)) {
    MV.ui.$("#insAddLabel").textContent = "インサート映像を追加";
    btn.disabled = false;
  } else {
    const rest = Math.max(0, max - items.length);
    MV.ui.$("#insAddLabel").textContent = rest ? `インサート映像を追加（あと${rest}本）` : "これ以上は追加できません";
    btn.disabled = rest === 0;
  }
};

MV.ui.renderItvSlots = () => {
  const L = window.MZ_LIMITS || {};
  const max = L.maxVlogInterviews || 1;
  const items = MV.S.interviews;
  MV.ui.$("#itvSlots").innerHTML = items.map(c => MV.ui.clipCard(c, "itv")).join("");
  const btn = MV.ui.$('[data-mv-add="itv"]');
  if (!isFinite(max)) {
    MV.ui.$("#itvAddLabel").textContent = items.length ? "もう1人追加" : "インタビューを追加";
    btn.disabled = false;
  } else {
    const rest = Math.max(0, max - items.length);
    MV.ui.$("#itvAddLabel").textContent = rest
      ? (items.length ? `もう1人追加（あと${rest}人）` : "インタビューを追加")
      : "これ以上は追加できません";
    btn.disabled = rest === 0;
  }
};

MV.ui.renderBgmSlots = () => {
  const max = (window.MZ_LIMITS || {}).maxVlogBgm || 3;
  const items = MV.S.bgms;
  const roles = ["導入", "中盤", "ハイライト"];
  MV.ui.$("#bgmSlots").innerHTML = items.map((b, i) => `
    <div class="slot filled">
      <button type="button" class="slot-del" data-mv-del="${b.id}" data-kind="bgm"
        aria-label="${MV.ui.esc(b.name)} を外す"><i class="fa-solid fa-xmark"></i></button>
      <span class="slot-idx">${roles[i] || ""}</span>
      <span class="slot-name"><i class="fa-solid fa-music"></i> ${MV.ui.esc(b.name)}</span>
      <span class="slot-meta">${MV.ui.fmtClock(b.duration)}</span>
    </div>`).join("");
  const rest = Math.max(0, max - items.length);
  MV.ui.$("#bgmAddLabel").textContent = items.length ? `曲を追加（あと${rest}曲）` : "曲を選ぶ";
  MV.ui.$('[data-mv-add="bgm"]').disabled = rest === 0;
};

MV.ui.renderLogoSlot = () => {
  const host = MV.ui.$("#logoSlot");
  const lg = MV.S.logo;
  const L = window.MZ_LIMITS || {};
  const canLogo = L.maxVlogLogos > 0;
  const note = MV.ui.$("#logoGuestNote");
  if (note) note.hidden = canLogo;
  MV.ui.$("#logoTune").hidden = !(lg && !lg.useOriginal);
  if (!lg) {
    host.innerHTML = canLogo
      ? `<button type="button" class="slot" data-mv-add="logo">
          <span class="slot-what"><i class="fa-solid fa-plus"></i> 団体のロゴ画像</span>
          <span class="slot-how">PNGが理想です。背景がついていても自動で抜きます</span>
        </button>`
      : `<button type="button" class="slot slot-locked" data-mv-add="logo">
          <span class="slot-what"><i class="fa-solid fa-lock"></i> 団体のロゴ画像</span>
          <span class="slot-how">無料登録が必要です</span>
        </button>`;
    return;
  }
  host.innerHTML = `<div class="slot filled logo-slot">
    <button type="button" class="slot-del" data-mv-del="logo" data-kind="logo"
      aria-label="ロゴを外す"><i class="fa-solid fa-xmark"></i></button>
    <img class="slot-thumb logo-thumb" src="${lg.preview || ""}" alt="">
    <span class="slot-name">${MV.ui.esc(lg.name)}</span>
    <span class="slot-meta">${lg.isPng ? "透過PNG" : "背景を自動で抜きました"}</span>
  </div>`;
};

/* ---------- 音の選択 ---------- */
MV.ui.renderAudioChoice = () => {
  document.querySelectorAll("[data-audio]").forEach(b => {
    const on = b.getAttribute("data-audio") === MV.S.audioMode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  MV.ui.$("#bgmBox").hidden = MV.S.audioMode === "ambient";
  if (MV.S.audioMode !== "ambient") MV.ui.renderArtlist();
};

MV.ui.renderAspect = () => {
  document.querySelectorAll("[data-aspect]").forEach(b => {
    const on = b.getAttribute("data-aspect") === MV.S.aspect;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
};

/* ---------- Artlistのおすすめ ---------- */
MV.ui.renderArtlist = () => {
  const host = MV.ui.$("#artlistBox");
  if (!host || host.dataset.mode === MV.S.mode) return;   // モードが変わった時だけ作り直す
  host.dataset.mode = MV.S.mode;
  const recipes = {
    recommend: { words: "uplifting, warm, corporate, light", bpm: "90〜110", text: "明るすぎず、前に進む感じの曲が合います。" },
    emotional: { words: "emotional, piano, cinematic, hopeful", bpm: "70〜90", text: "ピアノや弦の、ゆっくり積み上がる曲が合います。" },
    active:    { words: "energetic, driving, hip hop, sport", bpm: "110〜130", text: "テンポの速い、前のめりな曲が合います。" },
  };
  const r = recipes[MV.S.mode] || recipes.recommend;
  host.innerHTML = `
    <div class="artlist-card">
      <span class="al-slot"><i class="fa-solid fa-lightbulb"></i> 曲さがしのヒント</span>
      <p class="al-text">${MV.ui.esc(r.text)}目安のテンポは ${r.bpm} BPM。</p>
      <div class="al-terms" id="alTerms">${MV.ui.esc(r.words)}</div>
      <div class="artlist-actions">
        <button type="button" class="btn" id="alCopy"><i class="fa-solid fa-copy"></i> 検索ワードをコピー</button>
        <a class="btn" href="${MV.DATA.ARTLIST_REFERRAL}" target="_blank" rel="noopener">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> Artlistで探す</a>
      </div>
      <p class="hint">このリンクからの年間登録で、サブスクリプション期間に ＋2ヶ月分が無料で追加されます（12ヶ月分の料金で14ヶ月間利用可能）</p>
    </div>`;
  const btn = MV.ui.$("#alCopy");
  if (btn) btn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(r.words);
      MV.ui.toast("検索ワードをコピーしました。Artlistで貼り付けて探せます");
    } catch (_) { MV.ui.toast("コピーできませんでした。長押しで選択してください"); }
  };
};

/* ---------- 組み立ての可否と見込み ---------- */
MV.ui.ready = () => MV.S.inserts.length > 0;

/* インタビュー実尺から、いまの素材だとおよそ何分になるかを見積もる */
MV.ui.estimate = () => {
  const m = MV.DATA.MODES[MV.S.mode];
  if (!m) return 0;
  const [, hi] = MV.lenRange();
  const itvShare = m.blocks
    .filter(b => b.src === "interview")
    .reduce((s, b) => s + b.pct, 0) / 100;
  const itvTotal = MV.S.interviews.reduce((s, c) => s + Math.min(c.duration, 60), 0);
  // インタビューが無いときは素材の総量から見る
  const insTotal = MV.S.inserts.reduce((s, c) => s + c.duration, 0);
  const raw = itvTotal > 0 && itvShare > 0
    ? itvTotal / itvShare
    : Math.min(MV.TARGET_SEC, Math.max(45, insTotal * 1.6));
  return Math.max(30, Math.min(hi, Math.min(raw, MV.TARGET_SEC * 1.35)));
};

MV.ui.renderPlanSummary = () => {
  const host = MV.ui.$("#planSummary");
  const est = MV.ui.estimate();
  const nI = MV.S.interviews.length, nS = MV.S.inserts.length;
  const parts = [`映像 ${nS}本`];
  if (nI) parts.push(`インタビュー ${nI}人`);
  if (MV.S.audioMode !== "ambient" && MV.S.bgms.length) parts.push(`BGM ${MV.S.bgms.length}曲`);
  if (MV.S.logo) parts.push("ロゴあり");

  let html = `<div class="ps-mat">${parts.join(" ／ ")}</div>`;
  if (MV.ui.ready()) {
    html += `<div class="ps-len">いまの素材だと <b>約${MV.ui.fmtTime(est)}</b> になります</div>`;
    if (!MV.fitsMarchinZ(est)) {
      html += `<div class="ps-note"><i class="fa-solid fa-circle-info"></i>
        3分より短いので、MarchinZのYouTube一覧には載せられません（SNS向けにはこのままで大丈夫です）</div>`;
    }
    if (MV.S.audioMode !== "ambient" && !MV.S.bgms.length) {
      html += `<div class="ps-note"><i class="fa-solid fa-circle-info"></i>
        BGMが未選択です。このまま組み立てると現場の音だけになります</div>`;
    }
  } else {
    html += `<div class="ps-warn"><i class="fa-solid fa-circle-exclamation"></i>
      映像を1本以上入れてください</div>`;
  }
  host.innerHTML = html;
  MV.ui.$("#buildBtn").disabled = !MV.ui.ready();
};

/* ---------- まとめ描画 ---------- */
MV.ui.renderAll = () => {
  if (!MV.S.mode) return;
  MV.ui.renderModeCards();
  MV.ui.renderChecklist();
  MV.ui.renderInsSlots();
  MV.ui.renderItvSlots();
  MV.ui.renderBgmSlots();
  MV.ui.renderLogoSlot();
  MV.ui.renderAudioChoice();
  MV.ui.renderAspect();
  MV.ui.renderPlanSummary();
  MV.ui.updateActionBar();
  MV.ui.syncJourney();
};

/* サムネだけ差し替える(操作中のDOMを作り直さない) */
MV.ui.updateThumb = clip => {
  const el = document.querySelector(`.slot[data-id="${clip.id}"] .slot-thumb`);
  if (!el || !clip.thumb) return;
  if (el.tagName === "IMG") { el.src = clip.thumb; return; }
  const img = document.createElement("img");
  img.className = "slot-thumb";
  img.src = clip.thumb;
  el.replaceWith(img);
};

/* ---------- 「いちばん見てほしい人」(プルダウン・自由入力なし) ---------- */
MV.ui.initForWhom = () => {
  const sel = MV.ui.$("#forWhomSelect");
  if (!sel) return;

  // 保存済みの値が選択肢に無いとき(旧バージョンで自由入力した値など)は未選択に戻す
  const saved = MV.S.forWhom || "";
  if (saved) {
    if ([...sel.options].some(o => o.value === saved && o.value !== "")) {
      sel.value = saved;
    } else {
      sel.value = "";
      MV.S.forWhom = "";
      MV.saveState();
    }
  }

  sel.onchange = () => { MV.S.forWhom = sel.value; MV.saveState(); };
};

/* ---------- ボトムアクションバー(親指ゾーン) ---------- */
MV.ui.initActionBar = () => {
  const bar = document.createElement("div");
  bar.className = "mz-actionbar";
  bar.innerHTML = '<p class="ab-note" id="abNote"></p>'
    + '<button id="abPrimary" class="btn primary" type="button"></button>';
  MV.ui.$("#workspace").appendChild(bar);
  bar.querySelector("#abPrimary").onclick = () => { if (MV.ui._abAction) MV.ui._abAction(); };
  setInterval(MV.ui.updateActionBar, 500);   // MZP稼働状態の反映
};

/* セクションへ寄せてから開く。1タップ目は「ここです」、2タップ目で実行 */
MV.ui.focusSection = (sel, then) => {
  const el = MV.ui.$(sel);
  if (!el) { then(); return; }
  const r = el.getBoundingClientRect();
  const visible = r.top >= 0 && r.bottom <= window.innerHeight;
  if (visible) { then(); return; }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ab-target");
  setTimeout(() => el.classList.remove("ab-target"), 900);
};

MV.ui.updateActionBar = () => {
  const bar = document.querySelector(".mz-actionbar");
  if (!bar) return;
  const btn = bar.querySelector("#abPrimary");
  const note = bar.querySelector("#abNote");
  const ws = MV.ui.$("#workspace");
  // 書き出し中/進捗ドック表示中は場所を譲り、操作もさせない(二度押し防止)
  // 注: document.hidden での早期returnは入れないこと。ブラウザペインや
  // バックグラウンドタブでは常に hidden 扱いになり、バーが一度も出なくなる
  // (rAF単独依存で全機能が止まったv1.37.2と同じ型の罠)。
  // 書き出し中の抑止は exporter.running / MZP で足りている
  const busy = (MV.exporter && MV.exporter.running)
    || (window.MZP && MZP.current && !MZP.current.closed
        && ["run", "pulse", "frozen"].includes(MZP.current.state));

  let conf = null;
  if (ws && !ws.hidden && !busy) {
    if (!MV.S.inserts.length) {
      conf = { label: "まずインサート映像を選ぶ", icon: "fa-photo-film", note: "1本からはじめられます",
        act: () => MV.ui.focusSection("#insSec", () => MV.ui.$("#insInput").click()) };
    } else if (!MV.S.plan) {
      const est = MV.ui.estimate();
      conf = { label: `Vlog自動編集（約${MV.ui.fmtTime(est)}）`, icon: "fa-wand-magic-sparkles",
        note: MV.S.interviews.length ? "" : "インタビューを足すと、もっと見られる動画になります",
        act: () => MV.ui.$("#buildBtn").click() };
    } else if (MV.exporter.lastResult && MV.exporter.shareMode()) {
      conf = { label: "動画を保存", icon: "fa-arrow-up-from-bracket", note: "",
        act: () => MV.ui.saveResult() };
    } else {
      conf = { label: "MP4を書き出す", icon: "fa-file-export", note: "",
        act: () => MV.ui.$("#exportBtn").click() };
    }
  }
  if (!conf) { bar.classList.remove("on"); return; }
  bar.classList.add("on");
  const html = `<i class="fa-solid ${conf.icon}"></i> ${conf.label}`;
  if (btn.dataset.h !== html) { btn.innerHTML = html; btn.dataset.h = html; }
  if (note.textContent !== (conf.note || "")) note.textContent = conf.note || "";
  note.hidden = !conf.note;
  btn.disabled = !!conf.disabled;
  MV.ui._abAction = conf.act;
};

/* ---------- Vlog自動編集(組み立て) ----------
   planner が設計図(plan)を作り、プレビューを開く。書き出しはまだしない */
MV.ui.initBuild = () => {
  const btn = MV.ui.$("#buildBtn");
  if (!btn) return;
  btn.onclick = async () => {
    if (!MV.ui.ready() || MV.exporter.running) return;
    btn.disabled = true;
    MV.ui.$("#doneCard").hidden = true;
    const p = MZP.start({ mount: "#buildProgress", chapter: "組み立て", delay: 0 });
    p.pulse("構成に沿って並べています…");
    await MZP.paint();
    try {
      MV.S.plan = MV.planner.build();
      MV.preview.show();
      MV.ui.$("#exportBox").hidden = false;
      p.done(`約${MV.ui.fmtTime(MV.S.plan.totalSec)}のVlogに組み立てました`, {
        sub: MV.S.plan.shortNotice
          ? "3分より短いため、MarchinZのYouTube一覧には載せられません（SNS向けはこのままで大丈夫です）"
          : "下のプレビューで確認できます",
      });
      MV.ui.$("#stageSec").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      console.error(e);
      MV.log("build失敗: " + (e && e.message));
      p.fail("組み立てられませんでした", { detail: e && e.message });
      MV.S.plan = null;
    } finally {
      btn.disabled = !MV.ui.ready();
      MV.ui.updateActionBar();
    }
  };
};

/* ---------- 書き出し ---------- */
MV.ui.initExport = () => {
  const btn = MV.ui.$("#exportBtn");
  if (!btn) return;
  btn.onclick = async () => {
    if (!MV.S.plan || MV.exporter.running) return;
    const mode = MV.exporter.mode();
    if (mode === "none") { MV.ui.toast("この端末では書き出しできません"); return; }

    /* iOSは完成MP4がメモリに載るかを先に確かめる(超えると無警告でタブが落ちる) */
    const est = MV.exporter.estimateBytes();
    if (est > MV.exporter.MEM_HARD_LIMIT && !window.showSaveFilePicker) {
      MV.ui.toast(`この長さ(約${Math.round(est / 1e6)}MB)はこの端末では書き出せません。素材を減らして短くしてください`);
      return;
    }

    /* 書き出しはサイト全体(全タブ)で同時に1本だけ(Switcher v1.39.18と同じ) */
    let release = null;
    if (navigator.locks) {
      const got = await new Promise(resolve => {
        navigator.locks.request("mz-export", { ifAvailable: true }, lock => {
          if (!lock) { resolve(false); return; }
          resolve(true);
          return new Promise(r => { release = r; });
        }).catch(() => resolve(true));
      });
      if (!got) {
        MV.ui.toast("別のタブで書き出し中です。終わってからもう一度お試しください");
        return;
      }
    }

    btn.disabled = true;
    MV.preview.pause();
    MV.ui.$("#doneCard").hidden = true;
    const p = MZP.start({
      mount: "#exportProgress", chapter: "書き出し", delay: 0,
      label: mode === "realtime" ? "再生しながら録画しています…" : "映像を作っています…",
      sub: mode === "realtime" ? "画面を閉じずにお待ちください" : "",
      cancel: () => { MV.exporter.cancelFlag = true; },
    });
    try {
      const res = mode === "realtime"
        ? await MV.exporter.exportRealtime(p.legacy())
        : await MV.exporter.exportMP4(p.legacy());
      p.done("書き出しました", { chip: false });
      MV.ui.showDone(res);
    } catch (e) {
      console.error(e);
      MV.log("export失敗: " + (e && e.message));
      if (String(e && e.message).includes("キャンセル")) {
        p.close();
        MV.ui.toast("書き出しを中止しました");
      } else {
        p.fail("書き出せませんでした", { detail: e && e.message });
      }
    } finally {
      if (release) release();
      btn.disabled = false;
      MV.ui.updateActionBar();
    }
  };
  const sv = MV.ui.$("#saveBtn");
  if (sv) sv.onclick = () => MV.ui.saveResult();
  const dl = MV.ui.$("#downloadBtn");
  if (dl) dl.onclick = () => {
    const r = MV.exporter.lastResult;
    if (r) MV.exporter.triggerDownload(r.blob, r.name);
  };
};

/* 完了カード(Switcherと同じ保存フロー: iOSは共有シート、他は自動DL済み) */
MV.ui.showDone = res => {
  const share = MV.exporter.shareMode();
  MV.ui.$("#doneCard").hidden = false;
  const mb = (res.blob.size / 1e6).toFixed(1);
  if (share) {
    MV.ui.$("#saveBtn").style.display = "inline-flex";
    MV.ui.$("#doneText").innerHTML = `<span class="ok">✓ 準備できました（${mb}MB）</span>`;
    MV.ui.$("#doneNote").textContent = "「動画を保存」で写真（カメラロール）やファイルへ保存できます。";
    MV.ui.toast("✔ 準備できました。保存を押してください");
  } else {
    MV.ui.$("#saveBtn").style.display = "none";
    MV.ui.$("#doneText").innerHTML = `<span class="ok">✓ 「${MV.ui.esc(res.name)}」を保存しました（${mb}MB）</span>`;
    MV.ui.$("#doneNote").textContent = "ダウンロードに保存されています（もう一度保存するには「ダウンロード」）。";
    MV.ui.toast("✔ 書き出しが完了しました");
  }
};

MV.ui.saveResult = async () => {
  const r = MV.exporter.lastResult;
  if (!r) return;
  if (MV.exporter.shareMode()) {
    try {
      const file = new File([r.blob], r.name, { type: r.type || r.blob.type });
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e && e.name === "AbortError") return;
      MV.log("share失敗→ダウンロード: " + (e && e.message));
      MV.exporter.triggerDownload(r.blob, r.name);
    }
  } else {
    MV.exporter.triggerDownload(r.blob, r.name);
  }
};

/* ---------- 入力の結線 ---------- */
MV.ui.initInputs = () => {
  const pick = { itv: "#itvInput", ins: "#insInput", logo: "#logoInput", bgm: "#bgmInput" };

  // 追加・削除は委譲で1箇所に。共有部品(sitechromeのドロワー等)と衝突しないよう
  // 属性名を data-mv-* にし、作業領域の中だけを見る
  document.addEventListener("click", ev => {
    if (!ev.target.closest("#workspace")) return;
    const del = ev.target.closest("[data-mv-del]");
    if (del) {
      ev.preventDefault();
      MV.media.remove(del.getAttribute("data-kind"), del.getAttribute("data-mv-del"));
      return;
    }
    const add = ev.target.closest("[data-mv-add]");
    if (add) {
      ev.preventDefault();
      const sel = pick[add.getAttribute("data-mv-add")];
      if (sel) MV.ui.$(sel).click();
    }
  });

  document.addEventListener("change", ev => {
    const sw = ev.target.closest("[data-mv-show]");
    if (!sw) return;
    const c = MV.getClip(Number(sw.getAttribute("data-mv-show")));
    if (!c) return;
    c.isShow = sw.checked;
    MV.S.plan = null;
    MV.ui.renderPlanSummary();      // DOM全体は作り直さない(チェックが戻って見える)
    MV.ui.updateActionBar();
  });

  // 音の選び方
  document.querySelectorAll("[data-audio]").forEach(b => {
    b.onclick = () => {
      MV.S.audioMode = b.getAttribute("data-audio");
      MV.S.plan = null;
      MV.saveState();
      MV.ui.renderAudioChoice();
      MV.ui.renderPlanSummary();
    };
  });

  // 出し先(縦横)
  document.querySelectorAll("[data-aspect]").forEach(b => {
    b.onclick = () => {
      MV.S.aspect = b.getAttribute("data-aspect");
      MV.S.plan = null;
      MV.saveState();
      MV.ui.renderAspect();
      MV.ui.renderPlanSummary();
      const cv = MV.ui.$("#previewCanvas");
      if (cv) { cv.width = MV.W; cv.height = MV.H; }
    };
  });

  MV.ui.$("#itvInput").onchange = e => MV.media.add("itv", e.target.files).finally(() => { e.target.value = ""; });
  MV.ui.$("#insInput").onchange = e => MV.media.add("ins", e.target.files).finally(() => { e.target.value = ""; });
  MV.ui.$("#logoInput").onchange = e => MV.media.add("logo", e.target.files).finally(() => { e.target.value = ""; });
  MV.ui.$("#bgmInput").onchange = e => MV.media.add("bgm", e.target.files).finally(() => { e.target.value = ""; });

  const org = MV.ui.$("#orgNameInput");
  org.value = MV.S.orgName || "";
  org.oninput = () => { MV.S.orgName = org.value.trim(); MV.saveState(); };

  /* 「いちばん見てほしい人」は5択のプルダウン(2026-07-20: 自由入力を廃止) */
  MV.ui.initForWhom();

  const th = MV.ui.$("#logoThreshold");
  if (th) th.onchange = () => MV.logo.retry(Number(th.value));

  const rb = MV.ui.$("#rebuildBtn");
  if (rb) rb.onclick = () => {
    MV.S.plan = null;
    MV.ui.$("#exportBox").hidden = true;
    MV.ui.renderPlanSummary();
    MV.ui.$("#moodSec").scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // 画面のどこにドロップしても受ける
  ["dragover", "drop"].forEach(t => document.addEventListener(t, ev => ev.preventDefault()));
  document.addEventListener("drop", ev => {
    const files = [...(ev.dataTransfer?.files || [])];
    if (files.length) MV.media.addAuto(files);
  });
};

MV.ui.init = () => {
  if (!MV.DATA.MODES[MV.S.mode]) MV.S.mode = "recommend";   // 着地ページが無くなったため既定を持つ
  MV.ui.initModes();
  MV.ui.initInputs();
  MV.ui.initBuild();
  MV.ui.initExport();
  MV.preview.init();
  MV.ui.initActionBar();
  MV.ui.initJourney();
  MV.ui.renderAll();
};
