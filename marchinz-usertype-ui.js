"use strict";
/* ============ ユーザータイプの画面反映 ============
   ・設定ダイアログの3択(選ぶと即保存・即反映)
   ・メニュー(ドロワー)の上部に「◯◯向けメニューを表示中」
   ・メニュー項目とTOPセクションの並び替え

   並び替えは「消す」のではなく「順番を変える」だけにする。
   タイプを選んだせいで機能が見つからなくなるのがいちばん困るため
   (2026-07-21 優さん指示の意図)。 */

(() => {
  const UT = () => window.MZUserType;

  /* ---------- 設定ダイアログの3択 ---------- */
  function renderSettingsChoices() {
    const host = document.getElementById("mz-usertype-choices");
    if (!host || !UT()) return;
    const cur = UT().get();
    host.innerHTML = Object.values(UT().TYPES).map(t => `
      <button type="button" class="mz-usertype-card${t.id === cur ? " on" : ""}"
        role="radio" aria-checked="${t.id === cur ? "true" : "false"}" data-mz-usertype="${t.id}">
        <span class="mz-usertype-icon" aria-hidden="true"><i class="fa-solid ${t.icon}"></i></span>
        <span class="mz-usertype-body">
          <span class="mz-usertype-label">${t.label}</span>
          <span class="mz-usertype-desc">${t.desc}</span>
        </span>
        <i class="fa-solid fa-circle-check mz-usertype-check" aria-hidden="true"></i>
      </button>`).join("");
    host.querySelectorAll("[data-mz-usertype]").forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-mz-usertype");
        UT().set(id);
        renderSettingsChoices();
        if (window.MZToast) MZToast.ok(`${UT().info(id).label}向けの表示にしました`);
      };
    });
  }

  /* ---------- 登録画面の3択 ----------
     まだログインしていないので保存先は sessionStorage。
     ログインが完了した時点で auth.js が拾って確定させる。
     選ばなければ「ファン」(既定)のまま */
  function renderSignupChoices() {
    const host = document.getElementById("mz-usertype-signup-choices");
    if (!host || !UT()) return;
    const cur = host.getAttribute("data-picked") || "";
    host.innerHTML = Object.values(UT().TYPES).map(t => `
      <button type="button" class="mz-usertype-card${t.id === cur ? " on" : ""}"
        role="radio" aria-checked="${t.id === cur ? "true" : "false"}" data-mz-usertype-signup="${t.id}">
        <span class="mz-usertype-icon" aria-hidden="true"><i class="fa-solid ${t.icon}"></i></span>
        <span class="mz-usertype-body">
          <span class="mz-usertype-label">${t.label}</span>
          <span class="mz-usertype-desc">${t.desc}</span>
        </span>
        <i class="fa-solid fa-circle-check mz-usertype-check" aria-hidden="true"></i>
      </button>`).join("");
    host.querySelectorAll("[data-mz-usertype-signup]").forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-mz-usertype-signup");
        host.setAttribute("data-picked", id);
        UT().setPending(id);
        renderSignupChoices();
      };
    });
  }

  /* ---------- メニュー上部の「◯◯向けメニューを表示中」 ---------- */
  function renderDrawerBadge() {
    const panel = document.querySelector(".site-mobile-drawer-panel");
    if (!panel || !UT()) return;
    const info = UT().info(UT().get());
    let el = document.getElementById("mz-drawer-usertype");
    if (!el) {
      el = document.createElement("p");
      el.id = "mz-drawer-usertype";
      el.className = "mz-drawer-usertype";
      const head = panel.querySelector(".site-mobile-drawer-head");
      if (head && head.nextSibling) panel.insertBefore(el, head.nextSibling);
      else panel.insertBefore(el, panel.firstChild);
    }
    /* 「変えられる」ことが伝わらないと、意図しないタイプのまま使い続けてしまう */
    el.innerHTML = `<i class="fa-solid ${info.icon}" aria-hidden="true"></i> `
      + `${info.short}向けメニューを表示中`
      + ` <button type="button" class="mz-drawer-usertype-btn" id="mzDrawerUserTypeBtn">切り替え</button>`;
    const btn = el.querySelector("#mzDrawerUserTypeBtn");
    if (btn) btn.onclick = () => {
      /* 設定ダイアログが使えるならそちらへ。ゲストは設定ボタン自体が
         隠れているので、その場で選べるようにドロワー内に3択を開く
         (タイプ自体はゲストでも効くのに、入口だけ無い状態を作らない) */
      const s = document.getElementById("menu-open-settings");
      if (s && s.offsetParent !== null) { s.click(); return; }
      toggleDrawerPicker(el);
    };
  }

  /* ドロワー内のその場切り替え(ゲスト向け) */
  function toggleDrawerPicker(host) {
    let box = document.getElementById("mz-drawer-usertype-pick");
    if (box) { box.remove(); return; }
    box = document.createElement("div");
    box.id = "mz-drawer-usertype-pick";
    box.className = "mz-drawer-usertype-pick";
    box.setAttribute("role", "radiogroup");
    box.setAttribute("aria-label", "だれ向けの表示にするか");
    const cur = UT().get();
    box.innerHTML = Object.values(UT().TYPES).map(t => `
      <button type="button" class="mz-drawer-usertype-opt${t.id === cur ? " on" : ""}"
        role="radio" aria-checked="${t.id === cur ? "true" : "false"}" data-mz-usertype="${t.id}">
        <i class="fa-solid ${t.icon}" aria-hidden="true"></i> ${t.label}
      </button>`).join("");
    host.insertAdjacentElement("afterend", box);
    box.querySelectorAll("[data-mz-usertype]").forEach(b => {
      b.onclick = () => {
        UT().set(b.getAttribute("data-mz-usertype"));
        const gone = document.getElementById("mz-drawer-usertype-pick");
        if (gone) gone.remove();   // 選んだら閉じる(applyAllで並びは描き直される)
      };
    });
  }

  /* ---------- 並び替え ----------
     各タイプで「先に見せたいもの」をページIDで指定する。
     ここに無いものは元の順番のまま後ろへ続く(消さない) */
  /* ナビ(ページ)の並び。data-page の値で指定する */
  /* TOP(mll)は必ず先頭。並びに入れ忘れると最後尾へ飛ぶ(検証で発覚) */
  const NAV_ORDER = {
    fan:     ["mll", "videos", "youtube", "webmagazine", "community", "creators", "ops"],
    player:  ["mll", "community", "videos", "youtube", "webmagazine", "creators", "ops"],
    creator: ["mll", "creators", "community", "videos", "youtube", "webmagazine", "ops"],
  };

  /* TOPのセクションの並び。data-mz-top-section の値で指定する。
     ナビとは値の集合が違うので分けておく(兼用すると取りこぼす) */
  const TOP_ORDER = {
    fan:     ["videos", "youtube", "digest", "webmagazine", "community"],
    player:  ["community", "digest", "videos", "youtube", "webmagazine"],
    creator: ["community", "videos", "digest", "youtube", "webmagazine"],
  };

  /* ナビの並び替え。
     リンクだけを見て入れ替えると、「コミュニティ」のように子リンクを束ねた
     グループ(div)が動かないまま先頭へ取り残される(実機で発覚)。
     そこで **コンテナの直下の子要素** を単位に、その子が持つ data-page で
     順位を決める。グループはその中の最初のリンクの data-page を代表とする。
     並べ替えるのは「動かしてよい子」だけで、位置は元々あった枠に収める
     (管理者用の項目などが混ざっていても居場所が変わらない) */
  function pageOf(el) {
    if (el.getAttribute && el.getAttribute("data-page")) return el.getAttribute("data-page");
    const inner = el.querySelector && el.querySelector("[data-page]");
    return inner ? inner.getAttribute("data-page") : "";
  }

  function sortByPage(container, movableSel) {
    if (!container || !UT()) return;
    const kids = [...container.children];
    if (kids.length < 2) return;
    const order = NAV_ORDER[UT().get()] || NAV_ORDER.fan;

    /* 動かしてよい子: data-page を持ち(または内側に持ち)、管理者専用でないもの */
    const movable = kids.filter(el => {
      if (!pageOf(el)) return false;
      if (el.hasAttribute("data-admin-only")) return false;
      if (el.querySelector && el.querySelector("[data-admin-only]")) return false;
      return !movableSel || el.matches(movableSel) || el.querySelector(movableSel);
    });
    if (movable.length < 2) return;

    const rank = el => {
      const i = order.indexOf(pageOf(el));
      return i < 0 ? 999 : i;
    };
    /* 元の並びを安定させたいので、同順位は元の順番を保つ */
    const idx = new Map(movable.map((el, i) => [el, i]));
    const sorted = [...movable].sort((a, b) => (rank(a) - rank(b)) || (idx.get(a) - idx.get(b)));

    /* 「動かしてよい子」が元々いた枠(スロット)へ、並べ替えた順に流し込む。
       枠の外(管理者項目など)には触らない */
    const slots = movable.map(el => {
      const mark = document.createComment("mz-slot");
      container.insertBefore(mark, el);
      return mark;
    });
    sorted.forEach((el, i) => container.insertBefore(el, slots[i]));
    slots.forEach(m => m.remove());
  }

  function applyNavOrder() {
    if (!UT()) return;
    // PCのグローバルナビ
    sortByPage(document.querySelector(".site-nav-inner"), ".site-nav-link");
    // モバイルのドロワー(ページ一覧)。サブ束(div)も1つの塊として一緒に動かす
    document.querySelectorAll(".site-mobile-drawer-nav").forEach(nav => sortByPage(nav, null));
  }

  /* ---------- TOPのセクション並び替え ----------
     対象は data-mz-top-section を持つ連続した塊だけ。
     その前後(ヒーロー・入口カード・フィナーレ)は動かさない。
     appendChild で末尾へ送ると塊の外へ出てしまうので、
     「元々あった位置」に順番だけ入れ替えて戻す */
  function applyTopOrder() {
    if (!UT()) return;
    const secs = [...document.querySelectorAll("[data-mz-top-section]")];
    if (secs.length < 2) return;
    const parent = secs[0].parentElement;
    if (!secs.every(el => el.parentElement === parent)) return;   // 想定外の構造では触らない

    const order = TOP_ORDER[UT().get()] || TOP_ORDER.fan;
    const rank = el => {
      const i = order.indexOf(el.getAttribute("data-mz-top-section"));
      return i < 0 ? 999 : i;
    };
    // 塊の直後にある要素(戻す位置の目印)。無ければ末尾
    const tail = secs[secs.length - 1].nextElementSibling;
    [...secs].sort((a, b) => rank(a) - rank(b))
      .forEach(el => parent.insertBefore(el, tail));
  }

  /* ---------- 下部タブバー(スマホの主導線) ----------
     6枠: top / モーメント / イベント / 掲示板 / 各属性 / マイページ。
     固定5枠はHTML側に静的に置き(site-navのnavLinksに拾わせる)、
     5番目(#mz-tabbar-attr)だけをここで属性に合わせて中身ごと差し替える。
     要素は作り直さず**同じ<a>を書き換える**。作り直すと static NodeList の
     navLinks から外れ、アクティブ表示とリンク委譲が効かなくなる(2026-07-24) */
  const SVG_PEOPLE = '<circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /><path d="M21 21v-2a4 4 0 0 0 -3 -3.85" />';
  const SVG_DRUM   = '<ellipse cx="12" cy="6.5" rx="8" ry="2.5" /><path d="M4 6.5v11c0 1.38 3.58 2.5 8 2.5s8 -1.12 8 -2.5v-11" /><path d="M4 12c0 1.38 3.58 2.5 8 2.5s8 -1.12 8 -2.5" /><path d="M16.5 4.5l3 -2.5" />';
  const SVG_CLAP   = '<rect x="3" y="8.5" width="18" height="11.5" rx="2" /><path d="M3 8.5l3 -4.5 3 1 -2.2 3.5M10 8.5l3 -4.5 3 1 -2.2 3.5" />';

  /* 各属性の代表機能。5番目タブと heroボタンで共有する(2026-07-24 優さん決定) */
  const ATTR_ENTRY = {
    fan:     { href: "#community/events", page: "community", subtab: "", label: "コミュニティ", svg: SVG_PEOPLE, fa: "fa-users" },
    player:  { href: "#profile?tab=base", page: "days",      subtab: "", label: "練習記録",     svg: SVG_DRUM,   fa: "fa-drum" },
    /* ★ 6ツール化(2026-08-07 再編): 代表機能は「映像ツール」の入口へ */
    creator: { href: "#creators",         page: "creators",  subtab: "", label: "映像ツール",   svg: SVG_CLAP,   fa: "fa-clapperboard" },
  };

  function applyTabbar() {
    if (!UT()) return;
    const a = document.getElementById("mz-tabbar-attr");
    if (!a) return;
    const e = ATTR_ENTRY[UT().get()] || ATTR_ENTRY.fan;
    a.setAttribute("href", e.href);
    a.setAttribute("data-page", e.page);
    if (e.subtab) a.setAttribute("data-community-subtab", e.subtab);
    else a.removeAttribute("data-community-subtab");
    a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + e.svg + '</svg><span>' + e.label + '</span>';
  }

  /* ---------- heroの属性ボタン(ログイン時) ----------
     「練習を記録」を属性に合わせて差し替える(2026-07-24 優さん指示)。
     5番目タブと同じ代表機能で揃える */
  function applyHeroCta() {
    if (!UT()) return;
    const a = document.getElementById("mz-hero-attr-cta");
    if (!a) return;
    const e = ATTR_ENTRY[UT().get()] || ATTR_ENTRY.fan;
    a.setAttribute("href", e.href);
    a.innerHTML = '<i class="fa-solid ' + e.fa + '" aria-hidden="true"></i> ' + e.label;
  }

  /* ---------- アカウントメニューの近道 ----------
     ドロワーとPCのアカウント欄に「MarchinZ Days(練習記録)」と
     「MarchinZ Switcher(映像制作)」が全員に出ていた。
     練習しない人(ファン/保護者)に練習記録を勧め続けるのは押し付けになる
     (2026-07-22 優さん指摘)。自分の立場のものだけ出す。

     消しても行き止まりにはしない: Days はマイページの中、Switcher は
     クリエイターのページから、どのタイプでもたどり着ける。
     ここは「近道」なので、近道が要る人にだけ見せる */
  const ALL_TYPES = ["fan", "player", "creator"];
  const MENU_SHORTCUTS = {
    // モーメントは全属性に出す。各属性の代表メニュー(練習記録など)の上に置く
    // (2026-07-24 優さん指示)。ドロワーではDOM上すでにDays/Switcherより上にある
    "#menu-open-moments":         ALL_TYPES,    // PCのアカウント欄
    "#menu-mobile-open-moments":  ALL_TYPES,    // ハンバーガーメニュー
    // プレイヤー／団体 … 練習を記録する人の入口
    "#menu-open-days":            ["player"],
    "#menu-mobile-open-days":     ["player"],
    // スタッフ／クリエイター … 映像をつくる人の入口
    "#menu-open-switcher":        ["creator"],
    "#menu-mobile-open-switcher": ["creator"],
  };

  function applyMenuShortcuts() {
    if (!UT()) return;
    const cur = UT().get();
    Object.entries(MENU_SHORTCUTS).forEach(([sel, types]) => {
      const el = document.querySelector(sel);
      if (el) el.hidden = !types.includes(cur);
    });
  }

  function applyAll() {
    renderSettingsChoices();
    renderSignupChoices();
    renderDrawerBadge();
    applyNavOrder();
    applyTopOrder();
    applyTabbar();
    applyHeroCta();
    applyMenuShortcuts();
  }

  window.addEventListener("mz:usertype", applyAll);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAll, { once: true });
  } else {
    applyAll();
  }
  /* SPAのページ切替やドロワーの開閉で作り直されることがあるので、
     開くたびに当て直す(取りこぼしを防ぐ) */
  document.addEventListener("click", ev => {
    if (ev.target.closest("#site-mobile-nav-toggle, #menu-open-settings")) {
      setTimeout(applyAll, 60);
    }
  });

  window.MZUserTypeUI = { applyAll };
})();
