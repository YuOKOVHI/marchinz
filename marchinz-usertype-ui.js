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
     ドロワーより先に、実際に親指が触るのはここ。TOPとマイページは
     位置の記憶が強いので固定し、真ん中の3枠だけタイプで入れ替える。
     クリエイターには「クリエイター」タブを出す(制作ツールへ1タップ) */
  const TAB_MIDDLE = {
    fan:     ["videos", "youtube", "community"],
    player:  ["community", "videos", "youtube"],
    creator: ["creators", "videos", "community"],
  };
  let tabStash = null;   // data-page → リンク要素(外している間も保持)

  function creatorsTabLink(sample) {
    const a = document.createElement("a");
    a.href = "#creators";
    a.setAttribute("data-page", "creators");
    a.className = sample ? sample.className : "mz-tabbar-link";
    a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2" />'
      + '<circle cx="12" cy="13" r="3" /></svg>'
      + '<span>クリエイター</span>';
    return a;
  }

  function applyTabbar() {
    if (!UT()) return;
    const bar = document.querySelector(".mz-tabbar");
    if (!bar) return;
    if (!tabStash) {
      tabStash = new Map();
      bar.querySelectorAll("a[data-page]").forEach(a => tabStash.set(a.getAttribute("data-page"), a));
      if (!tabStash.has("creators")) {
        tabStash.set("creators", creatorsTabLink(tabStash.get("videos")));
      }
    }
    const middle = TAB_MIDDLE[UT().get()] || TAB_MIDDLE.fan;
    const want = ["mll", ...middle, "profile"];
    /* 5枠を並べ直す。使わないリンクは stash に残るだけで消えない */
    if (want.some(p => !tabStash.has(p))) return;   // 想定外の構造では触らない
    want.forEach(p => bar.appendChild(tabStash.get(p)));
    [...bar.querySelectorAll("a[data-page]")].forEach(a => {
      if (!want.includes(a.getAttribute("data-page"))) a.remove();
    });
  }

  /* ---------- アカウントメニューの近道 ----------
     ドロワーとPCのアカウント欄に「MarchinZ Days(練習記録)」と
     「MarchinZ Switcher(映像制作)」が全員に出ていた。
     練習しない人(ファン/保護者)に練習記録を勧め続けるのは押し付けになる
     (2026-07-22 優さん指摘)。自分の立場のものだけ出す。

     消しても行き止まりにはしない: Days はマイページの中、Switcher は
     クリエイターのページから、どのタイプでもたどり着ける。
     ここは「近道」なので、近道が要る人にだけ見せる */
  const MENU_SHORTCUTS = {
    // ファン／保護者 … 見る・応援する人の入口
    "#menu-open-moments":         ["fan"],      // PCのアカウント欄
    "#menu-mobile-open-moments":  ["fan"],      // ハンバーガーメニュー
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
