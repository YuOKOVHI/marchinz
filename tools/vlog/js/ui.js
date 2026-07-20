"use strict";
/* ============ MarchinZ Vlog: 画面 ============
   375pxの縦持ち片手操作が第一の完成形(CLAUDE.md 必須ルール8)。
   ・情報は縦積み1カラム。枠そのものが大きなタップ&ドロップ標的
   ・主アクションは親指ゾーンのボトムバーへ。実ボタンの click() を叩く
     プロキシ方式にして、状態を二重管理しない(Switcherで確立) */

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
  MV.ui._toastT = setTimeout(() => el.classList.remove("on"), 3200);
};

MV.ui.fmtTime = sec => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/* ---------- モード選択 ---------- */
MV.ui.initModes = () => {
  document.querySelectorAll(".mode-card").forEach(card => {
    card.onclick = () => MV.ui.chooseMode(card.getAttribute("data-mode"));
  });
  MV.ui.$("#modeBackBtn").onclick = () => {
    MV.ui.$("#workspace").hidden = true;
    MV.ui.$("#modeSelect").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
};

MV.ui.chooseMode = id => {
  const m = MV.DATA.MODES[id];
  if (!m) return;
  MV.S.mode = id;
  MV.saveState();
  MV.ui.$("#modeSelect").hidden = true;
  MV.ui.$("#workspace").hidden = false;
  MV.ui.$("#modeLabel").textContent = `${m.name} — ${m.lead}`;
  MV.ui.renderAll();
  window.scrollTo({ top: 0 });
};

/* ---------- スロットの描画 ----------
   空きスロットには「そのブロックで何をどう撮るか」を出す。モードを変えると
   ガイドも変わる(テンプレのguideから自動生成しているため二重管理にならない) */

/* そのモードで interview 枠 i 番目 / insert 全体 に対応するガイドを取り出す */
MV.ui.itvGuide = i => {
  const blocks = MV.DATA.MODES[MV.S.mode].blocks.filter(b => b.src === "interview");
  return blocks[i] ? blocks[i].guide : null;
};
MV.ui.insGuides = () =>
  MV.DATA.MODES[MV.S.mode].blocks.filter(b => b.src === "insert").map(b => b.guide);

MV.ui.renderItvSlots = () => {
  const host = MV.ui.$("#itvSlots");
  const max = (window.MZ_LIMITS || {}).maxVlogInterviews || 1;
  const items = MV.S.interviews;
  let html = "";
  for (let i = 0; i < max; i++) {
    const c = items[i];
    if (c) {
      html += `<div class="slot filled" data-kind="itv" data-id="${c.id}">
        <button type="button" class="slot-del" data-del="${c.id}" data-kind="itv"
          aria-label="${MV.ui.esc(c.name)} を外す"><i class="fa-solid fa-xmark"></i></button>
        ${c.thumb ? `<img class="slot-thumb" src="${c.thumb}" alt="">`
                  : `<span class="slot-thumb"></span>`}
        <span class="slot-name">${MV.ui.esc(c.name)}</span>
        <span class="slot-meta">${MV.ui.fmtTime(c.duration)}</span>
      </div>`;
    } else {
      const g = MV.ui.itvGuide(i) || { what: "インタビュー", how: "" };
      html += `<button type="button" class="slot" data-add="itv">
        <span class="slot-idx">インタビュー ${i + 1}</span>
        <span class="slot-what"><i class="fa-solid fa-plus"></i> ${MV.ui.esc(g.what)}</span>
        <span class="slot-how">${MV.ui.esc(g.how)}</span>
      </button>`;
    }
  }
  host.innerHTML = html;
};

MV.ui.renderInsSlots = () => {
  const host = MV.ui.$("#insSlots");
  const max = (window.MZ_LIMITS || {}).maxVlogInserts || 5;
  const items = MV.S.inserts;
  const guides = MV.ui.insGuides();
  let html = "";
  for (let i = 0; i < max; i++) {
    const c = items[i];
    if (c) {
      html += `<div class="slot filled" data-kind="ins" data-id="${c.id}">
        <button type="button" class="slot-del" data-del="${c.id}" data-kind="ins"
          aria-label="${MV.ui.esc(c.name)} を外す"><i class="fa-solid fa-xmark"></i></button>
        ${c.thumb ? `<img class="slot-thumb" src="${c.thumb}" alt="">`
                  : `<span class="slot-thumb"></span>`}
        <span class="slot-name">${MV.ui.esc(c.name)}</span>
        <span class="slot-meta">${MV.ui.fmtTime(c.duration)}</span>
        ${c.isShow ? '<span class="slot-badge"><i class="fa-solid fa-star"></i> ショウ動画</span>' : ""}
        <label class="slot-showtoggle">
          <input type="checkbox" data-show="${c.id}" ${c.isShow ? "checked" : ""}>
          本番の演技
        </label>
      </div>`;
    } else {
      // 空き枠には、まだ埋まっていないブロックのガイドを順に割り当てて出す
      const g = guides[i % Math.max(1, guides.length)] || { what: "映像", how: "" };
      html += `<button type="button" class="slot" data-add="ins">
        <span class="slot-idx">映像 ${i + 1}</span>
        <span class="slot-what"><i class="fa-solid fa-plus"></i> ${MV.ui.esc(g.what)}</span>
        <span class="slot-how">${MV.ui.esc(g.how)}</span>
      </button>`;
    }
  }
  host.innerHTML = html;
};

MV.ui.renderLogoSlot = () => {
  const host = MV.ui.$("#logoSlot");
  const lg = MV.S.logo;
  if (lg) {
    host.innerHTML = `<div class="slot filled">
      <button type="button" class="slot-del" data-del="logo" data-kind="logo"
        aria-label="ロゴを外す"><i class="fa-solid fa-xmark"></i></button>
      <img class="slot-thumb" src="${lg.preview || ""}" alt="" style="object-fit:contain;background:#f0f2f6">
      <span class="slot-name">${MV.ui.esc(lg.name)}</span>
      <span class="slot-meta">${lg.isPng ? "透過PNG" : "背景を自動透過しました"}</span>
    </div>`;
  } else {
    host.innerHTML = `<button type="button" class="slot" data-add="logo">
      <span class="slot-idx">ロゴ</span>
      <span class="slot-what"><i class="fa-solid fa-plus"></i> 団体のロゴ画像</span>
      <span class="slot-how">PNGが理想です。背景がついていても自動で抜きます</span>
    </button>`;
  }
};

MV.ui.renderBgmSlots = () => {
  const host = MV.ui.$("#bgmSlots");
  const max = (window.MZ_LIMITS || {}).maxVlogBgm || 3;
  const items = MV.S.bgms;
  const roles = ["導入", "中盤", "ハイライト"];
  let html = "";
  for (let i = 0; i < max; i++) {
    const b = items[i];
    if (b) {
      html += `<div class="slot filled">
        <button type="button" class="slot-del" data-del="${b.id}" data-kind="bgm"
          aria-label="${MV.ui.esc(b.name)} を外す"><i class="fa-solid fa-xmark"></i></button>
        <span class="slot-idx">${roles[i] || ""}</span>
        <span class="slot-name"><i class="fa-solid fa-music"></i> ${MV.ui.esc(b.name)}</span>
        <span class="slot-meta">${MV.ui.fmtTime(b.duration)}</span>
      </div>`;
    } else {
      html += `<button type="button" class="slot" data-add="bgm">
        <span class="slot-idx">BGM ${i + 1}（${roles[i] || ""}）</span>
        <span class="slot-what"><i class="fa-solid fa-plus"></i> 曲を選ぶ</span>
        <span class="slot-how">${i === 0 ? "1曲だけでも通しで使えます" : "章が変わるところで切り替えます"}</span>
      </button>`;
    }
  }
  host.innerHTML = html;
};

/* ---------- まとめ描画 ---------- */
MV.ui.renderAll = () => {
  if (!MV.S.mode) return;
  MV.ui.renderItvSlots();
  MV.ui.renderInsSlots();
  MV.ui.renderLogoSlot();
  MV.ui.renderBgmSlots();
  MV.ui.renderPlanSummary();
  MV.ui.updateActionBar();
};

/* 素材の充足状況と、いま組み立てたら何分になるかの見込み */
MV.ui.renderPlanSummary = () => {
  const host = MV.ui.$("#planSummary");
  const [lo, hi] = MV.lenRange();
  const nI = MV.S.interviews.length, nS = MV.S.inserts.length;
  const need = [];
  if (!nS) need.push("映像（インサート）が1本以上");
  if (!MV.S.bgms.length) need.push("BGMが1曲");
  const ready = !need.length;
  host.innerHTML = `
    <div>インタビュー ${nI}人 ／ 映像 ${nS}本 ／ BGM ${MV.S.bgms.length}曲${MV.S.logo ? " ／ ロゴあり" : ""}</div>
    <div class="ps-len">完成 ${MV.ui.fmtTime(lo)} 〜 ${MV.ui.fmtTime(hi)}</div>
    ${ready ? "" : `<div class="ps-warn"><i class="fa-solid fa-circle-exclamation"></i> ${need.join("・")}あると組み立てられます</div>`}`;
  MV.ui.$("#buildBtn").disabled = !ready;
};

/* ---------- ボトムアクションバー(親指ゾーン) ---------- */
MV.ui.initActionBar = () => {
  const bar = document.createElement("div");
  bar.className = "mz-actionbar";
  bar.innerHTML = '<button id="abPrimary" class="btn primary" type="button"></button>';
  MV.ui.$("#workspace").appendChild(bar);
  bar.querySelector("#abPrimary").onclick = () => { if (MV.ui._abAction) MV.ui._abAction(); };
  // MZPの稼働状態を映すためのポーリング(ジャーニーバーと同じ流儀)
  setInterval(MV.ui.updateActionBar, 500);
};

MV.ui.updateActionBar = () => {
  const bar = document.querySelector(".mz-actionbar");
  if (!bar) return;
  const btn = bar.querySelector("#abPrimary");
  const ws = MV.ui.$("#workspace");
  // 進捗ドック表示中はドックに場所を譲る(操作もさせない)
  const busy = window.MZP && MZP.current && !MZP.current.closed
    && ["run", "pulse", "frozen"].includes(MZP.current.state);

  let conf = null;
  if (ws && !ws.hidden && !busy) {
    if (!MV.S.inserts.length) {
      conf = { label: "映像を選ぶ", icon: "fa-photo-film",
        act: () => MV.ui.$("#insInput").click() };
    } else if (!MV.S.interviews.length) {
      conf = { label: "インタビューを選ぶ", icon: "fa-comment-dots",
        act: () => MV.ui.$("#itvInput").click() };
    } else if (!MV.S.bgms.length) {
      conf = { label: "BGMを選ぶ", icon: "fa-music",
        act: () => MV.ui.$("#bgmInput").click() };
    } else if (!MV.S.plan) {
      conf = { label: "組み立てる", icon: "fa-wand-magic-sparkles",
        disabled: MV.ui.$("#buildBtn").disabled, act: () => MV.ui.$("#buildBtn").click() };
    } else {
      conf = { label: "MP4を書き出す", icon: "fa-file-export",
        act: () => MV.ui.$("#exportBtn").click() };
    }
  }
  if (!conf) { bar.classList.remove("on"); return; }
  bar.classList.add("on");
  const html = `<i class="fa-solid ${conf.icon}"></i> ${conf.label}`;
  if (btn.dataset.h !== html) { btn.innerHTML = html; btn.dataset.h = html; }
  btn.disabled = !!conf.disabled;
  MV.ui._abAction = conf.act;
};

/* ---------- 入力の結線 ---------- */
MV.ui.initInputs = () => {
  const pick = {
    itv: "#itvInput", ins: "#insInput", logo: "#logoInput", bgm: "#bgmInput",
  };

  // 枠のタップ(追加)・削除・ショウ動画チェックを1箇所で受ける(委譲)
  document.addEventListener("click", ev => {
    const del = ev.target.closest("[data-del]");
    if (del) {
      ev.preventDefault();
      MV.media.remove(del.getAttribute("data-kind"), del.getAttribute("data-del"));
      return;
    }
    const add = ev.target.closest("[data-add]");
    if (add) {
      ev.preventDefault();
      const sel = pick[add.getAttribute("data-add")];
      if (sel) MV.ui.$(sel).click();
    }
  });

  document.addEventListener("change", ev => {
    const sw = ev.target.closest("[data-show]");
    if (sw) {
      const c = MV.getClip(Number(sw.getAttribute("data-show")));
      if (c) { c.isShow = sw.checked; MV.S.plan = null; MV.ui.renderAll(); }
    }
  });

  MV.ui.$("#itvInput").onchange = e => MV.media.add("itv", e.target.files).finally(() => { e.target.value = ""; });
  MV.ui.$("#insInput").onchange = e => MV.media.add("ins", e.target.files).finally(() => { e.target.value = ""; });
  MV.ui.$("#logoInput").onchange = e => MV.media.add("logo", e.target.files).finally(() => { e.target.value = ""; });
  MV.ui.$("#bgmInput").onchange = e => MV.media.add("bgm", e.target.files).finally(() => { e.target.value = ""; });

  const org = MV.ui.$("#orgNameInput");
  org.value = MV.S.orgName || "";
  org.oninput = () => { MV.S.orgName = org.value.trim(); MV.saveState(); };

  // 画面全体でのドロップを受ける(枠の上に落とせなくても取り込めるように)
  ["dragover", "drop"].forEach(t => document.addEventListener(t, ev => ev.preventDefault()));
  document.addEventListener("drop", ev => {
    const files = [...(ev.dataTransfer?.files || [])];
    if (files.length) MV.media.addAuto(files);
  });
};

MV.ui.init = () => {
  MV.ui.initModes();
  MV.ui.initInputs();
  MV.ui.initActionBar();
};
