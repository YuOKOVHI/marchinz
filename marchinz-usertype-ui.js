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
      const s = document.getElementById("menu-open-settings");
      if (s) s.click();
    };
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

  function sortByPage(container, sel) {
    if (!container) return;
    const items = [...container.querySelectorAll(sel)];
    if (!items.length) return;
    const order = NAV_ORDER[UT().get()] || NAV_ORDER.fan;
    const rank = el => {
      const p = el.getAttribute("data-page") || "";
      const i = order.indexOf(p);
      return i < 0 ? 999 : i;
    };
    /* 管理者用など data-page を持たない項目は動かさない(先頭固定) */
    const movable = items.filter(el => el.getAttribute("data-page") && !el.hasAttribute("data-admin-only"));
    if (movable.length < 2) return;
    const sorted = [...movable].sort((a, b) => rank(a) - rank(b));
    const anchor = movable[0];
    sorted.forEach(el => anchor.parentNode.insertBefore(el, null));
  }

  function applyNavOrder() {
    if (!UT()) return;
    // PCのグローバルナビ
    sortByPage(document.querySelector(".site-nav-inner"), ".site-nav-link");
    // モバイルのドロワー(ページ一覧)
    document.querySelectorAll(".site-mobile-drawer-nav").forEach(nav => {
      sortByPage(nav, ".site-mobile-drawer-nav-link:not(.site-mobile-drawer-nav-link--sub)");
    });
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

  function applyAll() {
    renderSettingsChoices();
    renderSignupChoices();
    renderDrawerBadge();
    applyNavOrder();
    applyTopOrder();
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
