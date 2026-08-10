/**
 * Font Awesome：グローバルナビ・主要タブ・検索・CTA へアイコンを付与（P0+P1）
 */
(() => {
  const SOLID = "fa-solid";

  /**
   * @param {string|string[]} classes
   * @returns {HTMLElement}
   */
  function iconEl(classes) {
    const i = document.createElement("i");
    i.className = Array.isArray(classes) ? classes.join(" ") : classes;
    i.setAttribute("aria-hidden", "true");
    return i;
  }

  /**
   * @param {HTMLElement} el
   * @param {string|string[]} iconClasses
   */
  function prependIcon(el, iconClasses) {
    if (!el || el.querySelector(":scope > .mz-ui-icon")) return;
    const ic = iconEl(["mz-ui-icon", ...(Array.isArray(iconClasses) ? iconClasses : [iconClasses])]);
    el.insertBefore(ic, el.firstChild);
  }

  /** @param {string} selector @param {string|string[]} iconClasses */
  function decorateLinks(selector, iconClasses) {
    document.querySelectorAll(selector).forEach((el) => {
      if (el instanceof HTMLElement) prependIcon(el, iconClasses);
    });
  }

  /** @param {string} id */
  function wrapSearchInput(id) {
    const inp = document.getElementById(id);
    if (!(inp instanceof HTMLInputElement) || inp.closest(".mz-search-input-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "mz-search-input-wrap";
    const ic = iconEl([SOLID, "fa-magnifying-glass", "mz-search-input-icon"]);
    inp.parentNode?.insertBefore(wrap, inp);
    wrap.appendChild(ic);
    wrap.appendChild(inp);
  }

  function decorateSiteNav() {
    decorateLinks('a.site-nav-link[data-page="mll"]', [SOLID, "fa-house"]);
    decorateLinks('a.site-nav-link[data-page="community"]', [SOLID, "fa-people-group"]);
    decorateLinks('a.site-nav-link[data-page="videos"]', [SOLID, "fa-trophy"]);
    decorateLinks('a.site-nav-link[data-page="youtube"]', ["fa-brands", "fa-youtube"]);
    decorateLinks('a.site-nav-link[data-page="webmagazine"]', [SOLID, "fa-newspaper"]);
    decorateLinks('a.site-nav-link[data-page="creators"]', [SOLID, "fa-camera"]);
    decorateLinks('a.site-nav-link[data-page="ops"]', [SOLID, "fa-bullhorn"]);
    decorateLinks("a.site-nav-link--admin", [SOLID, "fa-shield-halved"]);

    decorateLinks('a.site-mobile-drawer-nav-link[data-page="mll"]', [SOLID, "fa-house"]);
    decorateLinks('a.site-mobile-drawer-nav-link[data-community-subtab="events"]', [SOLID, "fa-calendar-days"]);
    decorateLinks('a.site-mobile-drawer-nav-link[data-community-subtab="moments"]', [SOLID, "fa-bolt"]);
    decorateLinks('a.site-mobile-drawer-nav-link[data-community-subtab="notes"]', [SOLID, "fa-book-open"]);
    decorateLinks('a.site-mobile-drawer-nav-link[data-community-subtab="board"]', [SOLID, "fa-comments"]);
    decorateLinks('a.site-mobile-drawer-nav-link[data-page="videos"]', [SOLID, "fa-trophy"]);
    decorateLinks('a.site-mobile-drawer-nav-link[data-page="youtube"]', ["fa-brands", "fa-youtube"]);
    decorateLinks('a.site-mobile-drawer-nav-link[data-page="webmagazine"]', [SOLID, "fa-newspaper"]);
    decorateLinks('a.site-mobile-drawer-nav-link[data-page="creators"]', [SOLID, "fa-camera"]);
    decorateLinks('a.site-mobile-drawer-nav-link[data-page="ops"]', [SOLID, "fa-bullhorn"]);

    prependIcon(document.getElementById("menu-mobile-open-user-profile-page"), [SOLID, "fa-user"]);
    prependIcon(document.getElementById("menu-mobile-open-profile-edit"), [SOLID, "fa-user-pen"]);
    prependIcon(document.getElementById("menu-mobile-open-settings"), [SOLID, "fa-gear"]);
    prependIcon(document.getElementById("btn-mobile-logout"), [SOLID, "fa-right-from-bracket"]);

    prependIcon(document.getElementById("menu-open-user-profile-page"), [SOLID, "fa-user"]);
    prependIcon(document.getElementById("menu-open-profile-edit"), [SOLID, "fa-user-pen"]);
    prependIcon(document.getElementById("menu-open-settings"), [SOLID, "fa-gear"]);
    prependIcon(document.getElementById("btn-logout"), [SOLID, "fa-right-from-bracket"]);
  }

  function decorateCommunityHub() {
    prependIcon(document.getElementById("community-hub-tab-events"), [SOLID, "fa-calendar-days"]);
    prependIcon(document.getElementById("community-hub-tab-moments"), [SOLID, "fa-bolt"]);
    prependIcon(document.getElementById("community-hub-tab-notes"), [SOLID, "fa-book-open"]);
    prependIcon(document.getElementById("community-hub-tab-board"), [SOLID, "fa-comments"]);
  }

  function decorateCalendarEvents() {
    document.querySelectorAll("[data-cal-kind]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const k = btn.getAttribute("data-cal-kind") || "";
      const map = {
        all: [SOLID, "fa-border-all"],
        演奏会: [SOLID, "fa-music"],
        大会: [SOLID, "fa-trophy"],
        イベント: [SOLID, "fa-star"],
      };
      if (map[k]) prependIcon(btn, map[k]);
    });
    document.querySelectorAll("[data-cal-view]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const v = btn.getAttribute("data-cal-view") || "";
      const map = {
        card: [SOLID, "fa-grip"],
        list: [SOLID, "fa-list"],
        calendar: [SOLID, "fa-calendar"],
      };
      if (map[v]) prependIcon(btn, map[v]);
    });
    prependIcon(document.getElementById("calendar-ev-open-register"), [SOLID, "fa-calendar-plus"]);
    prependIcon(document.getElementById("calendar-ev-open-register-footer"), [SOLID, "fa-calendar-plus"]);
    document.querySelectorAll(".calendar-ev-sort-btn").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const k = btn.getAttribute("data-cal-sort") || "";
      const map = {
        year: [SOLID, "fa-calendar"],
      };
      if (map[k]) prependIcon(btn, map[k]);
    });
    prependIcon(document.getElementById("calendar-ev-venue-filter-btn"), [SOLID, "fa-map-location-dot"]);
    prependIcon(document.getElementById("calendar-ev-year-filter-btn"), [SOLID, "fa-calendar"]);
  }

  function decorateCommunityUpdates() {
    prependIcon(document.getElementById("community-updates-event-heading"), [SOLID, "fa-clock-rotate-left"]);
    prependIcon(document.getElementById("community-updates-board-heading"), [SOLID, "fa-clock-rotate-left"]);
  }

  function decorateBoard() {
    document.querySelectorAll("[data-community-filter]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const f = btn.getAttribute("data-community-filter") || "";
      const map = {
        ALL: [SOLID, "fa-border-all"],
        "告知（出演・開催等）": [SOLID, "fa-bullhorn"],
        メンバー募集: [SOLID, "fa-user-plus"],
        クラウドファンディング: [SOLID, "fa-hand-holding-dollar"],
        質問: [SOLID, "fa-circle-question"],
        運営より: [SOLID, "fa-building-columns"],
      };
      if (map[f]) prependIcon(btn, map[f]);
    });
    prependIcon(document.getElementById("community-open-compose"), [SOLID, "fa-pen-to-square"]);
  }

  /* ★ decorateProfileTabs は2026-08-06 削除(優さん実機指摘「通知と運営より
     でアイコンが2つ続いてる」)。真因: prof-tab-mll/logdiary/videos/yt/notifs/ops
     の6つはいずれも index.html 側に既にアイコンが書かれており(例: notifsは
     fa-bell、opsはfa-bullhorn)、prependIcon のガード(:scope > .mz-ui-icon)は
     マークアップ側の無印<i>を検知できないため、ここで**2個目**を差し込んで
     いた。notif/opsは横並びで並んで見えるため気づかれたが、mll(カレンダー+
     チェックリスト)・videos(トロフィー+カメラ)・yt(YouTube+テレビ)も同様に
     縦積みで二重表示されていた。6つとも静的アイコンがあるので関数ごと不要 */

  function decorateVideosPage() {
    prependIcon(document.getElementById("tab-marching"), [SOLID, "fa-drum"]);
    prependIcon(document.getElementById("tab-threecross"), [SOLID, "fa-layer-group"]);
    prependIcon(document.getElementById("tab-overseas"), [SOLID, "fa-earth-americas"]);
    prependIcon(document.getElementById("tab-pov"), [SOLID, "fa-eye"]);
    prependIcon(document.getElementById("browse-by-org"), [SOLID, "fa-table-list"]);
    prependIcon(document.getElementById("btn-reset-search"), [SOLID, "fa-rotate-left"]);
    document.querySelectorAll("[data-marchinz-search-share]").forEach((btn) => {
      if (btn instanceof HTMLElement) prependIcon(btn, [SOLID, "fa-share-nodes"]);
    });
    const searchIcon = [SOLID, "fa-magnifying-glass"];
    const teamLab = document.querySelector('label.search-label[for="q-team"]');
    const freeLab = document.querySelector('label.search-label[for="q-free"]');
    if (teamLab instanceof HTMLElement) prependIcon(teamLab, searchIcon);
    if (freeLab instanceof HTMLElement) prependIcon(freeLab, searchIcon);
  }

  /** 大会動画・YouTube の並び替えボタン（イベント一覧と同系のアイコン） */
  function decorateResultSortButtons() {
    const filterIntro = document.getElementById("video-filter-intro");
    if (filterIntro instanceof HTMLElement) prependIcon(filterIntro, [SOLID, "fa-filter"]);
    const sourceFilterBtn = document.getElementById("video-source-filter-btn");
    if (sourceFilterBtn instanceof HTMLElement) {
      prependIcon(sourceFilterBtn, [SOLID, "fa-tower-broadcast"]);
    }
    document.querySelectorAll(".sort-btn[data-sort]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const k = btn.getAttribute("data-sort") || "";
      const map = {
        配信日: [SOLID, "fa-calendar-day"],
        "団体/チーム": [SOLID, "fa-users"],
      };
      if (map[k]) prependIcon(btn, map[k]);
    });
    document.querySelectorAll(".youtube-sort-btn[data-yt-sort]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const k = btn.getAttribute("data-yt-sort") || "";
      const map = {
        new: [SOLID, "fa-clock"],
        name: [SOLID, "fa-arrow-down-a-z"],
      };
      if (map[k]) prependIcon(btn, map[k]);
    });
  }

  function decorateIconOnlyNavBtn(id, iconClasses, ariaLabel) {
    const btn = document.getElementById(id);
    if (!(btn instanceof HTMLButtonElement)) return;
    if (btn.querySelector(":scope > .mz-ui-icon")) return;
    btn.textContent = "";
    btn.setAttribute("aria-label", ariaLabel);
    btn.classList.add("page-btn--icon-only");
    btn.appendChild(iconEl(iconClasses));
  }

  function decorateVideosPagination() {
    decorateIconOnlyNavBtn("page-prev", [SOLID, "fa-chevron-left"], "前へ");
    decorateIconOnlyNavBtn("page-next", [SOLID, "fa-chevron-right"], "次へ");
  }

  /** メディア区分：タブ・見出し共通（note はアイコンなし） */
  /** @type {Record<string, string[] | null>} */
  const MEDIA_SECTION_ICONS = {
    "media-free-magazine": [SOLID, "fa-music"],
    "media-marching-live": [SOLID, "fa-tower-broadcast"],
    "media-manga": [SOLID, "fa-book-open-reader"],
    "media-books": [SOLID, "fa-newspaper"],
    "media-note": null,
    "media-anime": [SOLID, "fa-film"],
  };

  function decorateMediaJumpTabsAndHeadings() {
    document.querySelectorAll("#page-webmagazine .media-jump-tab[data-target-id]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const icons = MEDIA_SECTION_ICONS[el.getAttribute("data-target-id") || ""];
      if (icons) prependIcon(el, icons);
    });
    document.querySelectorAll("#page-webmagazine h3.media-section-heading[id]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const icons = MEDIA_SECTION_ICONS[el.id || ""];
      if (icons) prependIcon(el, icons);
    });
  }

  function decorateWebmagazinePage() {
    decorateMediaJumpTabsAndHeadings();
    document.querySelectorAll("#page-webmagazine .media-more-btn").forEach((btn) => {
      if (btn instanceof HTMLElement && btn.textContent.trim() === "もっと見る") {
        prependIcon(btn, [SOLID, "fa-angles-down"]);
      }
    });
    decorateLinks(
      "#page-webmagazine a.static-panel-link, #page-webmagazine .section-top-link a",
      [SOLID, "fa-arrow-up-right-from-square"],
    );
  }

  function decorateOpsPage() {
    document.querySelectorAll("#page-ops .media-section-heading").forEach((h3) => {
      if (!(h3 instanceof HTMLElement) || h3.querySelector(":scope > .mz-ui-icon")) return;
      const t = h3.textContent.trim();
      if (t.includes("公式X")) prependIcon(h3, ["fa-brands", "fa-x-twitter"]);
      else if (t.includes("お問い合わせ")) prependIcon(h3, [SOLID, "fa-envelope"]);
    });
    decorateLinks("#page-ops a.ops-google-form-btn", [SOLID, "fa-arrow-up-right-from-square"]);
  }

  function decorateCreatorsPage() {
    decorateLinks(
      "#page-creators a.static-panel-link, #page-creators a.artlist-link-neutral",
      [SOLID, "fa-arrow-up-right-from-square"],
    );
  }

  /** 動的生成ボタン（大会動画カード・YouTube 等） */
  function decorateDynamicActionButtons(root = document) {
    const scope =
      root instanceof Document
        ? root
        : root instanceof HTMLElement
          ? root
          : document;
    scope.querySelectorAll("button").forEach((btn) => {
      if (!(btn instanceof HTMLButtonElement)) return;
      if (btn.querySelector(":scope > .mz-ui-icon")) return;
      const label = btn.textContent.trim();
      if (
        btn.classList.contains("recommend-item-team-search-btn") ||
        label === "この団体を検索" ||
        label === "このチームを検索"
      ) {
        prependIcon(btn, [SOLID, "fa-magnifying-glass"]);
        return;
      }
      if (
        (btn.classList.contains("btn-mll-mylist-add") ||
          btn.classList.contains("youtube-channel-mylist-add-btn")) &&
        label === "マイリストに追加"
      ) {
        prependIcon(btn, [SOLID, "fa-bookmark"]);
        return;
      }
      if (
        (btn.classList.contains("share-toggle") ||
          (btn.classList.contains("btn-marchinz-spotlight") && label === "シェアする")) &&
        label === "シェアする"
      ) {
        prependIcon(btn, [SOLID, "fa-share-nodes"]);
        return;
      }
      if (
        label === "もっと見る" &&
        (btn.classList.contains("recommend-more") ||
          btn.classList.contains("video-result-more") ||
          btn.id === "video-list-more" ||
          btn.id === "recommend-more" ||
          btn.id === "youtube-more-btn" ||
          btn.classList.contains("media-more-btn"))
      ) {
        prependIcon(btn, [SOLID, "fa-angles-down"]);
        return;
      }
      if (btn.classList.contains("calendar-ev-mll-log-save-btn--log")) {
        prependIcon(btn, [SOLID, "fa-calendar-check"]);
        return;
      }
      if (btn.classList.contains("calendar-ev-mll-log-save-btn--note")) {
        prependIcon(btn, [SOLID, "fa-book-open"]);
        return;
      }
      if (btn.classList.contains("calendar-ev-mll-log-save-btn--view-log")) {
        prependIcon(btn, [SOLID, "fa-eye"]);
        return;
      }
      if (btn.classList.contains("community-post-manage-btn--moderation")) {
        prependIcon(btn, [SOLID, "fa-eye-slash"]);
        return;
      }
      if (btn.classList.contains("user-profile-mll-share-btn")) {
        prependIcon(btn, [SOLID, "fa-share-nodes"]);
        return;
      }
      if (btn.classList.contains("eld-open-btn--write")) {
        prependIcon(btn, [SOLID, "fa-book-open"]);
      }
    });
  }

  let dynamicDecorateTimer = null;
  function scheduleDynamicActionButtons() {
    clearTimeout(dynamicDecorateTimer);
    dynamicDecorateTimer = setTimeout(() => {
      decorateDynamicActionButtons();
      decorateVideosPagination();
      decorateEldNoteFilterTabs();
    }, 40);
  }

  function setupDynamicActionButtonObserver() {
    const targets = [
      "page-videos",
      "page-youtube",
      "page-webmagazine",
      "recommend-section",
      "prof-log-diary-root",
      "calendar-event-list",
      "page-community",
      "prof-mll-purge-mount",
    ].map((id) => document.getElementById(id));
    const mo = new MutationObserver(() => scheduleDynamicActionButtons());
    for (const el of targets) {
      if (el) mo.observe(el, { childList: true, subtree: true });
    }
    scheduleDynamicActionButtons();
  }

  function decorateYoutubePage() {
    prependIcon(document.getElementById("youtube-published-list-open"), [SOLID, "fa-list-ul"]);
    document.querySelectorAll("#youtube-more-btn, #page-youtube .recommend-more").forEach((btn) => {
      if (btn instanceof HTMLElement && btn.textContent.trim() === "もっと見る") {
        prependIcon(btn, [SOLID, "fa-angles-down"]);
      }
    });
    document.querySelectorAll("[data-yt-category]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const c = btn.getAttribute("data-yt-category") || "";
      const map = {
        all: [SOLID, "fa-border-all"],
        大会: [SOLID, "fa-trophy"],
        マーチング配信: [SOLID, "fa-tower-broadcast"],
        一般: [SOLID, "fa-music"],
        高校: [SOLID, "fa-school"],
        中学生以下: [SOLID, "fa-user-group"],
        カラーガード: [SOLID, "fa-wand-magic-sparkles"],
        海外: [SOLID, "fa-earth-americas"],
      };
      if (map[c]) prependIcon(btn, map[c]);
    });
  }

  /** ヘッダー・ドロワー・ゲスト CTA・認証ページ切替など、ログイン／新規登録の導線 */
  function decorateAuthEntryButtons() {
    document.querySelectorAll('[data-mll-auth-entry="signup"]').forEach((el) => {
      if (el instanceof HTMLElement) prependIcon(el, [SOLID, "fa-user-plus"]);
    });
    document.querySelectorAll('[data-mll-auth-entry="login"]').forEach((el) => {
      if (el instanceof HTMLElement) prependIcon(el, [SOLID, "fa-right-to-bracket"]);
    });
    document.querySelectorAll('[data-mll-auth-switch="signup"]').forEach((el) => {
      if (el instanceof HTMLElement) prependIcon(el, [SOLID, "fa-user-plus"]);
    });
    document.querySelectorAll('[data-mll-auth-switch="login"]').forEach((el) => {
      if (el instanceof HTMLElement) prependIcon(el, [SOLID, "fa-right-to-bracket"]);
    });
  }

  function decorateAuthAndDialogs() {
    prependIcon(document.getElementById("btn-auth-login-google"), ["fa-brands", "fa-google"]);
    prependIcon(document.getElementById("btn-auth-signup-google"), ["fa-brands", "fa-google"]);
    decorateAuthEntryButtons();
    document.querySelectorAll(".mz-dialog-close-btn").forEach((btn) => {
      if (btn instanceof HTMLElement && !btn.querySelector(".mz-ui-icon")) {
        btn.textContent = "";
        btn.appendChild(iconEl([SOLID, "fa-xmark"]));
      }
    });
    /* モバイルメニューは .site-brand-hamburger（CSS 3 本線）を使用。FA を重ねると二重表示になる */
  }

  /** TOP（ランディング）の青リンク・CTA */
  function decorateTopLanding() {
    const link = (selector, icons) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (el instanceof HTMLElement) prependIcon(el, icons);
      });
    };

    link('a.mll-lp-inline-link[href="#community/events"]', [SOLID, "fa-calendar-days"]);
    link('a.mll-lp-inline-link[href="#videos"]', [SOLID, "fa-trophy"]);
    link('a.mll-lp-inline-link[href="#youtube"]', ["fa-brands", "fa-youtube"]);

    link('a.mll-lp-pill-sub-link[href="#community/events"]', [SOLID, "fa-list-check"]);
    link('a.mll-lp-pill-sub-link[href="#community/notes"]', [SOLID, "fa-book-open"]);
    link('a.mll-lp-pill-sub-link[href="#videos"]', [SOLID, "fa-trophy"]);
    link('a.mll-lp-pill-sub-link[href="#youtube"]', ["fa-brands", "fa-youtube"]);
    link('a.mll-lp-pill-sub-link[href="#community/board"]', [SOLID, "fa-comments"]);

    document.querySelectorAll('.mll-lp a.mll-lp-btn--primary[href="#profile"]').forEach((el) => {
      if (el instanceof HTMLElement) prependIcon(el, [SOLID, "fa-circle-user"]);
    });
  }

  function decorateSearchBars() {
    wrapSearchInput("cal-ev-search");
    wrapSearchInput("mln-feed-search");
    wrapSearchInput("mlm-feed-search");
    wrapSearchInput("community-board-search");
    wrapSearchInput("youtube-channel-search");
    wrapSearchInput("moderation-search");
    const eldSearch = document.querySelector(".prof-log-diary-root [data-eld-search]");
    if (eldSearch instanceof HTMLInputElement && !eldSearch.id) {
      eldSearch.id = "prof-eld-search";
      wrapSearchInput("prof-eld-search");
    }
  }

  function decorateEldNoteFilterTabs() {
    const map = {
      written: [SOLID, "fa-book-open"],
      unwritten: [SOLID, "fa-pen-to-square"],
      all: [SOLID, "fa-calendar-check"],
    };
    document.querySelectorAll(".eld-note-filter-btn[data-eld-filter]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const key = btn.getAttribute("data-eld-filter") || "";
      if (map[key]) prependIcon(btn, map[key]);
    });
  }

  function run() {
    decorateSiteNav();
    decorateCommunityHub();
    decorateCalendarEvents();
    decorateBoard();
    decorateCommunityUpdates();
    decorateVideosPage();
    decorateYoutubePage();
    decorateResultSortButtons();
    decorateWebmagazinePage();
    decorateOpsPage();
    decorateCreatorsPage();
    decorateVideosPagination();
    decorateAuthAndDialogs();
    decorateTopLanding();
    decorateSearchBars();
    decorateEldNoteFilterTabs();
    setupDynamicActionButtonObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

  window.MarchinZIcons = {
    run,
    prependIcon,
    decorateEldNoteFilterTabs,
    wrapSearchInput,
    decorateAuthEntryButtons,
    decorateDynamicActionButtons,
    scheduleDynamicActionButtons,
  };
})();
