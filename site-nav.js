/**
 * MarchinZ — ページ切替（hash）・OG メタ・YouTube 一覧・静的ブロック
 */
(() => {
  const pageIds = [
    "mll",
    "community",
    "profile",
    "ugc",
    "ugc-tools",
    "admin",
    "videos",
    "youtube",
    "webmagazine",
    "creators",
    "ops",
    "terms",
    "privacy",
    "login",
    "signup",
  ];
  const titles = {
    mll: "TOP",
    events: "イベント",
    community: "コミュニティ",
    notes: "ノート",
    moments: "モーメント",
    profile: "プロフィール",
    ugc: "UGC",
    "ugc-tools": "UGC（ツール）",
    admin: "管理",
    videos: "大会動画",
    youtube: "YouTube",
    webmagazine: "メディア",
    creators: "クリエイター",
    ops: "運営",
    privacy: "プライバシーポリシー",
    terms: "利用規約",
    login: "ログイン",
    signup: "新規登録",
  };

  const publicBaseUrl = "https://marchinz.netlify.app/";

  /**
   * LINE / X / Instagram / Facebook 等のアプリ内 WebView（Google OAuth 403 対策）
   * @returns {boolean}
   */
  function detectInAppBrowser() {
    const ua = String(navigator.userAgent || "");
    if (!ua) return false;
    if (/MicroMessenger/i.test(ua)) return true;
    if (/\bLine\//i.test(ua)) return true;
    if (/Instagram/i.test(ua)) return true;
    if (/FBAN|FBAV|FB_IAB|FBIOS|FBSS|Facebook/i.test(ua)) return true;
    if (/Twitter/i.test(ua)) return true;
    if (/TikTok/i.test(ua)) return true;
    if (/LinkedInApp/i.test(ua)) return true;
    if (/Snapchat/i.test(ua)) return true;
    const isIos = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    if (isIos && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua)) return true;
    if (isAndroid && /; wv\)/i.test(ua)) return true;
    return false;
  }

  const IN_APP_BROWSER_BANNER_TITLE = "ブラウザでの閲覧をおすすめします💡";
  const IN_APP_BROWSER_BANNER_MESSAGE =
    "ログインや登録する場合、URLをコピーして、ブラウザ開いてください。";
  const IN_APP_BROWSER_BANNER_DISMISS_KEY = "mz_inapp_browser_banner_dismissed";

  function setInAppBrowserBannerVisible(visible) {
    document.documentElement.classList.toggle("mz-inapp-browser-banner-visible", Boolean(visible));
  }

  function dismissInAppBrowserBanner(banner) {
    if (banner) banner.hidden = true;
    setInAppBrowserBannerVisible(false);
    try {
      sessionStorage.setItem(IN_APP_BROWSER_BANNER_DISMISS_KEY, "1");
    } catch {
      //
    }
  }

  /**
   * LINE 等：MarchinZ のシェア URL に openExternalBrowser=1 を付与
   * @param {string} urlStr
   * @returns {string}
   */
  function withOpenExternalBrowserParam(urlStr) {
    const raw = String(urlStr || "").trim();
    if (!raw) return raw;
    const beforeHash = raw.split("#")[0];
    if (/(?:^|[?&])openExternalBrowser=1(?:&|$)/i.test(beforeHash)) return raw;
    try {
      const u = new URL(raw);
      u.searchParams.set("openExternalBrowser", "1");
      return u.toString();
    } catch {
      const hashIdx = raw.indexOf("#");
      const base = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
      const hash = hashIdx >= 0 ? raw.slice(hashIdx) : "";
      const sep = base.includes("?") ? "&" : "?";
      return `${base}${sep}openExternalBrowser=1${hash}`;
    }
  }

  function initInAppBrowserBanner() {
    if (!detectInAppBrowser()) {
      setInAppBrowserBannerVisible(false);
      return false;
    }
    try {
      if (sessionStorage.getItem(IN_APP_BROWSER_BANNER_DISMISS_KEY) === "1") {
        setInAppBrowserBannerVisible(false);
        return true;
      }
    } catch {
      //
    }

    const staleOverlay = document.getElementById("mz-inapp-browser-overlay");
    if (staleOverlay) staleOverlay.remove();
    document.documentElement.classList.remove("mz-inapp-browser-blocked");

    let banner = document.getElementById("mz-inapp-browser-banner");
    if (!banner) {
      banner = document.createElement("aside");
      banner.id = "mz-inapp-browser-banner";
      banner.className = "mz-inapp-browser-banner";
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");

      const inner = document.createElement("div");
      inner.className = "mz-inapp-browser-banner__inner";

      const textWrap = document.createElement("div");
      textWrap.className = "mz-inapp-browser-banner__text";

      const title = document.createElement("p");
      title.className = "mz-inapp-browser-banner__title";
      title.textContent = IN_APP_BROWSER_BANNER_TITLE;

      const desc = document.createElement("p");
      desc.className = "mz-inapp-browser-banner__desc";
      desc.textContent = IN_APP_BROWSER_BANNER_MESSAGE;

      textWrap.append(title, desc);

      const actions = document.createElement("div");
      actions.className = "mz-inapp-browser-banner__actions";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "mz-inapp-browser-banner__copy";
      copyBtn.textContent = "URLをコピー";
      copyBtn.addEventListener("click", () => {
        const url = withOpenExternalBrowserParam(String(location.href || publicBaseUrl).trim());
        const done = () =>
          window.alert("URLをコピーしました。Safari または Chrome のアドレス欄に貼り付けて開いてください。");
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(url).then(done).catch(() => window.prompt("URLをコピー", url));
        } else {
          window.prompt("次のURLをコピーして Safari / Chrome で開いてください", url);
        }
      });

      const dismissBtn = document.createElement("button");
      dismissBtn.type = "button";
      dismissBtn.className = "mz-inapp-browser-banner__dismiss";
      dismissBtn.textContent = "とじる";
      dismissBtn.setAttribute("aria-label", "案内をとじる");
      dismissBtn.addEventListener("click", () => {
        dismissInAppBrowserBanner(banner);
      });

      actions.append(copyBtn, dismissBtn);
      inner.append(textWrap, actions);
      banner.appendChild(inner);
      document.body.appendChild(banner);
    }
    banner.hidden = false;
    const titleEl = banner.querySelector(".mz-inapp-browser-banner__title");
    const descEl = banner.querySelector(".mz-inapp-browser-banner__desc");
    if (titleEl) titleEl.textContent = IN_APP_BROWSER_BANNER_TITLE;
    if (descEl) descEl.textContent = IN_APP_BROWSER_BANNER_MESSAGE;
    setInAppBrowserBannerVisible(true);
    return true;
  }

  const initInAppBrowserBlock = initInAppBrowserBanner;

  window.MarchinZInAppBrowser = {
    detect: detectInAppBrowser,
    isBlocked: () => detectInAppBrowser(),
    init: initInAppBrowserBanner,
    initInAppBrowserBanner,
  };

  window.MarchinZUrlShare = {
    withOpenExternalBrowserParam,
  };

  initInAppBrowserBanner();

  const mzAssetVersion =
    typeof document !== "undefined"
      ? String(document.documentElement.getAttribute("data-mz-version") || "").trim()
      : "";
  /** URL シェア用 OGP（全ページ共通・`ogp-card.png` 1200×630） */
  const siteOgImage = `${publicBaseUrl}ogp-card.png${
    mzAssetVersion ? `?v=${encodeURIComponent(mzAssetVersion)}` : ""
  }`;
  const defaultOgImage = siteOgImage;
  const mllOgImage = siteOgImage;

  /** TOP（#top）検索・ブラウザタブ用（OG の mll と揃える） */
  const HOME_SEO_TITLE =
    "MarchinZ（マーチンズ）｜マーチングの記録・動画・コミュニティ";
  const HOME_SEO_DESCRIPTION =
    "MarchinZ（マーチンズ）は、マーチングの大会・演奏会の記録、ショウ動画の検索、仲間との交流ができるマーチングコミュニティです。";

  const ogByPage = {
    videos: {
      title: "MarchinZ/マーチンズ — 大会動画",
      description:
        "マーチンズ/MarchinZ。マーチング団体等・スリークロスチームの動画一覧を検索してシェアできます。",
      image: defaultOgImage,
    },
    mll: {
      title: HOME_SEO_TITLE,
      description: HOME_SEO_DESCRIPTION,
      image: mllOgImage,
    },
    events: {
      title: "MarchinZ/マーチンズ — イベント",
      description:
        "マーチンズ/MarchinZ。イベント・演奏会・大会を登録し、開催日順で確認できます。いいねや参加スタイルを共有できます。",
      image: mllOgImage,
    },
    community: {
      title: "MarchinZ/マーチンズ — コミュニティ",
      description:
        "マーチンズ/MarchinZ。マーチングに関する募集・告知・質問などの話題を共有できる掲示板です。閲覧は可能で、投稿・返信には登録（ログイン）が必要です。",
      image: mllOgImage,
    },
    notes: {
      title: "MarchinZ/マーチンズ — ノート",
      description:
        "マーチンズ/MarchinZ。MarchinZ Note（イベントごとの公開ノート）。みんなの更新が新しい順に並びます。",
      image: mllOgImage,
    },
    moments: {
      title: "MarchinZ/マーチンズ — モーメント",
      description:
        "マーチンズ/MarchinZ。MarchinZ Moment（マーチングの「今」を気軽に共有）。みんなの更新が新しい順に並びます。",
      image: mllOgImage,
    },
    profile: {
      title: "MarchinZ/マーチンズ — プロフィール",
      description:
        "マーチンズ/MarchinZ。MarchinZ Log・大会動画マイリスト・YouTube マイリスト・MarchinZ Noteなど、登録ユーザーの公開プロフィールです。",
      image: mllOgImage,
    },
    admin: {
      title: "MarchinZ/マーチンズ — 管理（管理者）",
      description:
        "マーチンズ/MarchinZ。管理者向けの通報確認・モデレーションと、サイト全体お知らせの配信です。",
      image: mllOgImage,
    },
    youtube: {
      title: "MarchinZ/マーチンズ — YouTube",
      description:
        "マーチンズ/MarchinZ。マーチング関連の公式YouTubeチャンネルをカテゴリ別に整理。大会・一般・高校・海外を横断してチェックできます。",
      image: defaultOgImage,
    },
    webmagazine: {
      title: "MarchinZ/マーチンズ — メディア",
      description:
        "マーチンズ/MarchinZ。フリーマガジン・マンガ・雑誌・note・アニメなど、マーチング関連メディア情報をまとめて確認できます。",
      image: defaultOgImage,
    },
    creators: {
      title: "MarchinZ/マーチンズ — クリエイター",
      description:
        "マーチンズ/MarchinZ。マーチングに関する写真・映像・配信・デザイン領域のクリエイター向け情報とおすすめサービスを掲載。",
      image: defaultOgImage,
    },
    ops: {
      title: "MarchinZ/マーチンズ — 運営",
      description:
        "マーチンズ/MarchinZ。運営情報、お問い合わせ、発足の想いなどを掲載しています。利用規約・プライバシーポリシーは専用ページをご覧ください。",
      image: defaultOgImage,
    },
    privacy: {
      title: "MarchinZ/マーチンズ — プライバシーポリシー",
      description:
        "マーチンズ/MarchinZ。利用者情報の基本的な考え方（オンライン上のサイト提供を前提）。",
      image: defaultOgImage,
    },
    terms: {
      title: "MarchinZ/マーチンズ — 利用規約",
      description: "マーチンズ/MarchinZ。ウェブサイトの利用条件について。",
      image: defaultOgImage,
    },
    login: {
      title: "MarchinZ/マーチンズ — ログイン",
      description: "マーチンズ/MarchinZ。Google アカウントでログインします。",
      image: mllOgImage,
    },
    signup: {
      title: "MarchinZ/マーチンズ — 新規登録",
      description:
        "マーチンズ/MarchinZ。Google アカウントで新規登録（ログイン）します。MarchinZ Log・コミュニティ・イベント登録などに使う共通アカウントです。",
      image: mllOgImage,
    },
  };

  /** 削除したページのハッシュは動画へ寄せる */
  const REMOVED_HASH_TO_VIDEOS = new Set(["members", "shop", "crowdfunding"]);

  /** 旧 URL（削除済みセクション）を運営ページへ寄せる */
  const REMOVED_HASH_TO_OPS = new Set(["account", "account-data"]);

  const pages = {
    mll: document.getElementById("page-mll"),
    community: document.getElementById("page-community"),
    profile: document.getElementById("page-profile"),
    ugc: document.getElementById("page-ugc"),
    "ugc-tools": document.getElementById("page-ugc-tools"),
    admin: document.getElementById("page-admin"),
    videos: document.getElementById("page-videos"),
    youtube: document.getElementById("page-youtube"),
    webmagazine: document.getElementById("page-webmagazine"),
    creators: document.getElementById("page-creators"),
    ops: document.getElementById("page-ops"),
    terms: document.getElementById("page-terms"),
    privacy: document.getElementById("page-privacy"),
    login: document.getElementById("page-login"),
    signup: document.getElementById("page-signup"),
  };

  /** YAMAP 式: return_to で直前ページへ戻る（ログイン・新規登録の入口リンク用） */
  function buildAuthEntryUrl(mode, signupFromOpt) {
    const pathQs = stripReturnFromRawSearch(location.search);
    const h = location.hash && location.hash.length > 1 ? location.hash : "#top";
    const snapshot = `${location.pathname}${pathQs}${h}`;
    const p = new URLSearchParams(pathQs.startsWith("?") ? pathQs.slice(1) : "");
    p.set("return_to", snapshot);
    if (mode === "signup") {
      const fk =
        signupFromOpt == null || signupFromOpt === undefined ? "header" : String(signupFromOpt).trim();
      p.set("from", fk || "header");
    }
    const q = p.toString();
    return `${location.pathname}${q ? `?${q}` : ""}#${mode === "login" ? "login" : "signup"}`;
  }

  function stripReturnFromRawSearch(rawSearch) {
    const qs = rawSearch.startsWith("?") ? rawSearch.slice(1) : rawSearch;
    const p = new URLSearchParams(qs);
    p.delete("return_to");
    p.delete("from");
    const rest = p.toString();
    return rest ? `?${rest}` : "";
  }

  function updateSiteBrandAuthEntryLinks() {
    const loginEl = document.getElementById("site-brand-link-login");
    const signupEl = document.getElementById("site-brand-link-signup");
    if (loginEl) loginEl.href = buildAuthEntryUrl("login");
    if (signupEl) signupEl.href = buildAuthEntryUrl("signup");
    const mobileLogin = document.getElementById("site-mobile-link-login");
    const mobileSignup = document.getElementById("site-mobile-link-signup");
    if (mobileLogin) mobileLogin.href = buildAuthEntryUrl("login");
    if (mobileSignup) mobileSignup.href = buildAuthEntryUrl("signup");
  }

  function setupMobileDrawer() {
    const root = document.getElementById("site-mobile-drawer");
    const toggle = document.getElementById("site-mobile-nav-toggle");
    const panel = root?.querySelector(".site-mobile-drawer-panel");
    if (!root || !toggle || !panel) return;

    const DRAWER_MS = 380;
    let closeFallbackTimer = null;

    function clearCloseFallback() {
      if (closeFallbackTimer) {
        clearTimeout(closeFallbackTimer);
        closeFallbackTimer = null;
      }
    }

    function finalizeDrawerClose() {
      clearCloseFallback();
      panel.removeEventListener("transitionend", onPanelTransitionEnd);
      root.hidden = true;
      root.classList.remove("site-mobile-drawer--open");
      document.body.classList.remove("mz-mobile-drawer-open");
      toggle.setAttribute("aria-expanded", "false");
    }

    function onPanelTransitionEnd(ev) {
      if (ev.target !== panel || ev.propertyName !== "transform") return;
      finalizeDrawerClose();
    }

    function drawerIsOpen() {
      return !root.hidden && root.classList.contains("site-mobile-drawer--open");
    }

    function setOpen(open, opts = {}) {
      const immediate = Boolean(opts && opts.immediate);
      if (open) {
        clearCloseFallback();
        panel.removeEventListener("transitionend", onPanelTransitionEnd);
        if (drawerIsOpen()) return;
        root.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        document.body.classList.add("mz-mobile-drawer-open");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            root.classList.add("site-mobile-drawer--open");
          });
        });
        return;
      }

      if (root.hidden || !root.classList.contains("site-mobile-drawer--open")) {
        finalizeDrawerClose();
        return;
      }

      if (immediate) {
        finalizeDrawerClose();
        return;
      }

      toggle.setAttribute("aria-expanded", "false");
      root.classList.remove("site-mobile-drawer--open");
      panel.addEventListener("transitionend", onPanelTransitionEnd);
      clearCloseFallback();
      closeFallbackTimer = window.setTimeout(finalizeDrawerClose, DRAWER_MS + 70);
    }

    window.__marchinzCloseMobileDrawer = () => setOpen(false);

    toggle.addEventListener("click", () => {
      setOpen(!drawerIsOpen());
    });

    root.querySelectorAll("[data-site-mobile-drawer-close]").forEach((el) => {
      el.addEventListener("click", () => setOpen(false));
    });

    root.addEventListener("click", (ev) => {
      const t = ev.target.closest("a[href^='#']");
      if (t && root.contains(t)) setOpen(false, { immediate: true });
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && drawerIsOpen()) setOpen(false);
    });
  }

  setupMobileDrawer();

  const navLinks = document.querySelectorAll(
    /* フッターの実体は nav.mz-footer-grid（.footer-nav は index.html に存在せず、
       13本が未配線=押してもスクロールが最下部のままだった。2026-08-06修正） */
    ".site-nav a[data-page], .mz-footer-grid a[data-page], .site-mobile-drawer-nav a[data-page], .mz-tabbar a[data-page]",
  );

  /** ヘッダー／フッター／ドロワー：同一タブでハッシュ遷移（意図しない新規タブを防ぐ） */
  function setupInternalNavLinkClicks() {
    navLinks.forEach((a) => {
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.dataset.internalNavWired === "1") return;
      a.dataset.internalNavWired = "1";
      a.removeAttribute("target");
      a.addEventListener("click", (ev) => {
        const href = String(a.getAttribute("href") || "").trim();
        if (!href.startsWith("#")) return;
        ev.preventDefault();
        if (location.hash !== href) {
          location.hash = href;
        } else {
          syncFromHash();
        }
        window.scrollTo({ top: 0, behavior: "auto" });
      });
    });
  }
  const metaDescription = document.getElementById("meta-description");
  const metaOgTitle = document.getElementById("meta-og-title");
  const metaOgDescription = document.getElementById("meta-og-description");
  const metaOgUrl = document.getElementById("meta-og-url");
  const metaOgImage = document.getElementById("meta-og-image");
  const metaTwitterTitle = document.getElementById("meta-twitter-title");
  const metaTwitterDescription = document.getElementById("meta-twitter-description");
  const metaTwitterImage = document.getElementById("meta-twitter-image");

  function isAdminNow() {
    return Boolean(window.MLL_AUTH?.isAdmin?.());
  }

  function enforceAdminOnlyVisibility() {
    const canShow = isAdminNow();
    document.querySelectorAll("[data-admin-only]").forEach((el) => {
      el.hidden = !canShow;
      el.style.display = canShow ? "" : "none";
    });
  }

  /** `#profile?uid=…&tab=mll` のようにクエリ付きハッシュを扱う */
  function hashRouteBase() {
    const raw = location.hash.replace(/^#/, "").trim();
    const qi = raw.indexOf("?");
    return qi === -1 ? raw : raw.slice(0, qi);
  }

  /** @readonly */
  const COMMUNITY_HUB_PANEL_SUFFIXES = ["events", "moments", "board", "notes"];

  function normalizeCommunityTab(tab) {
    const x = String(tab ?? "events").trim().toLowerCase();
    return COMMUNITY_HUB_PANEL_SUFFIXES.includes(x) ? x : "events";
  }

  /** @type {{ pageId: string, communityTab: string|null }} */
  let mzLastRoute = { pageId: "", communityTab: null };

  function notifyRouteLeave(prev) {
    if (prev.pageId === "community" && prev.communityTab === "board") {
      window.MarchinZCommunityComposeDraft?.onLeaveBoard?.();
    }
    if (prev.pageId === "community" && prev.communityTab === "events") {
      window.MarchinZCalendarEventDraft?.onLeaveEvents?.();
    }
  }

  /** @param {string} tab */
  function activateCommunityHubTab(tab) {
    const t = normalizeCommunityTab(tab);
    document.querySelectorAll("[data-community-hub-tab]").forEach((btn) => {
      const on = btn.getAttribute("data-community-hub-tab") === t;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
    });
    COMMUNITY_HUB_PANEL_SUFFIXES.forEach((key) => {
      const panel = document.getElementById(`community-hub-panel-${key}`);
      if (panel) panel.hidden = key !== t;
    });
    if (t === "events") {
      window.MarchinZResetCalendarKindFilter?.();
    } else if (t === "board") {
      window.MarchinZResetCommunityBoardFilter?.();
    }
  }

  function setupCommunityHubTabButtons() {
    document.querySelectorAll("[data-community-hub-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-community-hub-tab");
        if (!tab || !COMMUNITY_HUB_PANEL_SUFFIXES.includes(tab)) return;
        const nextHash =
          tab === "events"
            ? "#community/events"
            : tab === "moments"
              ? "#community/moments"
              : tab === "board"
                ? "#community/board"
                : "#community/notes";
        if (location.hash !== nextHash) {
          location.hash = nextHash;
        } else {
          activateCommunityHubTab(tab);
          if (
            normalizeCommunityTab(tab) === "notes" &&
            typeof window.MarchinZMlnPublicFeed?.refresh === "function"
          ) {
            void window.MarchinZMlnPublicFeed.refresh();
          }
          if (
            normalizeCommunityTab(tab) === "moments" &&
            typeof window.MarchinZMomentFeed?.refresh === "function"
          ) {
            void window.MarchinZMomentFeed.refresh();
          }
        }
      });
    });
  }

  const UGC_KIND_SUFFIXES = [
    "signup",
    "event",
    "moment",
    "board",
    "board_reply",
    "note",
    "mll_log",
    "video_mylist",
    "yt_mylist",
    "video_search",
    "search_share",
  ];

  /** @returns {{ pageId: string, communityTab: string|null, adminTab?: string|null, ugcKind?: string|null }} */
  function routeFromHash() {
    let h = hashRouteBase();
    if (REMOVED_HASH_TO_VIDEOS.has(h)) {
      h = "videos";
      history.replaceState(null, "", `${location.pathname}${location.search}#videos`);
    }
    if (REMOVED_HASH_TO_OPS.has(h)) {
      h = "ops";
      history.replaceState(null, "", `${location.pathname}${location.search}#ops`);
    }
    if (h === "moderation") {
      if (!isAdminNow()) {
        history.replaceState(null, "", `${location.pathname}${location.search}#top`);
        return { pageId: "mll", communityTab: null, adminTab: null };
      }
      history.replaceState(null, "", `${location.pathname}${location.search}#admin/reports`);
      return { pageId: "admin", communityTab: null, adminTab: "reports" };
    }
    if (h === "ugc-tools" || h === "ugc/tool_use") {
      if (!isAdminNow()) {
        history.replaceState(null, "", `${location.pathname}${location.search}#top`);
        return { pageId: "mll", communityTab: null, adminTab: null, ugcKind: null };
      }
      if (h !== "ugc-tools") {
        history.replaceState(null, "", `${location.pathname}${location.search}#ugc-tools`);
      }
      return { pageId: "ugc-tools", communityTab: null, adminTab: null, ugcKind: null };
    }
    if (h === "ugc" || h.startsWith("ugc/")) {
      if (!isAdminNow()) {
        history.replaceState(null, "", `${location.pathname}${location.search}#top`);
        return { pageId: "mll", communityTab: null, adminTab: null, ugcKind: null };
      }
      if (h === "ugc") {
        history.replaceState(null, "", `${location.pathname}${location.search}#ugc/signup`);
        return { pageId: "ugc", communityTab: null, adminTab: null, ugcKind: "signup" };
      }
      const seg = h.slice("ugc/".length).trim().toLowerCase();
      const kind = UGC_KIND_SUFFIXES.includes(seg) ? seg : "signup";
      if (seg && !UGC_KIND_SUFFIXES.includes(seg)) {
        history.replaceState(null, "", `${location.pathname}${location.search}#ugc/signup`);
      }
      return { pageId: "ugc", communityTab: null, adminTab: null, ugcKind: kind };
    }
    if (h === "admin/ugc") {
      if (!isAdminNow()) {
        history.replaceState(null, "", `${location.pathname}${location.search}#top`);
        return { pageId: "mll", communityTab: null, adminTab: null, ugcKind: null };
      }
      history.replaceState(null, "", `${location.pathname}${location.search}#ugc/signup`);
      return { pageId: "ugc", communityTab: null, adminTab: null, ugcKind: "signup" };
    }
    if (h === "admin" || h.startsWith("admin/")) {
      if (!isAdminNow()) {
        history.replaceState(null, "", `${location.pathname}${location.search}#top`);
        return { pageId: "mll", communityTab: null, adminTab: null, ugcKind: null };
      }
      if (h === "admin") {
        history.replaceState(null, "", `${location.pathname}${location.search}#admin/reports`);
        return { pageId: "admin", communityTab: null, adminTab: "reports", ugcKind: null };
      }
      let adminTab = "reports";
      const seg = h.slice("admin/".length).trim().toLowerCase();
      if (seg === "announce") adminTab = "announce";
      else if (seg === "trash") adminTab = "trash";
      else if (seg === "banned") adminTab = "banned";
      else if (seg !== "reports" && seg !== "") {
        history.replaceState(null, "", `${location.pathname}${location.search}#admin/reports`);
        adminTab = "reports";
      }
      return { pageId: "admin", communityTab: null, adminTab, ugcKind: null };
    }
    if (h === "top") return { pageId: "mll", communityTab: null, adminTab: null };
    if (h === "events") return { pageId: "community", communityTab: "events", adminTab: null };
    if (h === "notes") return { pageId: "community", communityTab: "notes", adminTab: null };
    if (h === "moments") return { pageId: "community", communityTab: "moments", adminTab: null };
    if (h === "community" || h.startsWith("community/")) {
      let tab = "events";
      if (h.startsWith("community/")) {
        const seg = h.slice("community/".length).trim().toLowerCase();
        if (COMMUNITY_HUB_PANEL_SUFFIXES.includes(seg)) tab = seg;
      }
      return { pageId: "community", communityTab: tab, adminTab: null };
    }
    if (pageIds.includes(h)) return { pageId: h, communityTab: null, adminTab: null };
    return { pageId: "mll", communityTab: null, adminTab: null };
  }

  function pageFromHash() {
    return routeFromHash().pageId;
  }

  /**
   * @param {string} id
   * @param {{ communityTab?: string|null, adminTab?: string|null, ugcKind?: string|null }} [routeOpts]
   */
  function showPage(id, routeOpts = {}) {
    if ((id === "admin" || id === "ugc" || id === "ugc-tools") && !isAdminNow()) {
      id = "mll";
    }
    const commTab = id === "community" ? normalizeCommunityTab(routeOpts.communityTab ?? "events") : null;
    notifyRouteLeave(mzLastRoute);
    pageIds.forEach((key) => {
      const el = pages[key];
      if (el) el.hidden = key !== id;
    });
    if (id !== "videos") {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      if (typeof window.__marchinzCloseVideosBrowseOverlay === "function") {
        window.__marchinzCloseVideosBrowseOverlay();
      }
    }
    navLinks.forEach((a) => {
      const sub = String(a.dataset.communitySubtab || "")
        .trim()
        .toLowerCase();
      let active = false;
      if (id === "community" && sub) {
        active = commTab === sub;
      } else {
        active = a.dataset.page === id && !sub;
      }
      const inDrawer = a.classList.contains("site-mobile-drawer-nav-link");
      if (active) {
        a.setAttribute("aria-current", "page");
        if (inDrawer) a.classList.add("site-mobile-drawer-nav-link--active");
        else a.classList.add("site-nav-link-active");
      } else {
        a.removeAttribute("aria-current");
        a.classList.remove("site-nav-link-active");
        a.classList.remove("site-mobile-drawer-nav-link--active");
      }
    });
    if (id === "mll") {
      document.title = HOME_SEO_TITLE;
    } else if (id === "community") {
      const t = normalizeCommunityTab(routeOpts.communityTab ?? "events");
      const piece =
        t === "events"
          ? titles.events
          : t === "moments"
            ? titles.moments
            : t === "notes"
              ? titles.notes
              : titles.community;
      document.title = `MarchinZ/マーチンズ — ${piece}`;
      activateCommunityHubTab(t);
    } else if (id === "ugc") {
      document.title = `MarchinZ/マーチンズ — ${titles.ugc}`;
    } else if (id === "admin") {
      const rawAt = String(routeOpts.adminTab || "").trim().toLowerCase();
      const at =
        rawAt === "announce"
          ? "announce"
          : rawAt === "trash"
            ? "trash"
            : rawAt === "banned"
              ? "banned"
              : "reports";
      document.title =
        at === "announce"
          ? `MarchinZ/マーチンズ — ${titles.admin}（サイトお知らせ）`
          : at === "trash"
            ? `MarchinZ/マーチンズ — ${titles.admin}（ゴミ箱）`
            : at === "banned"
              ? `MarchinZ/マーチンズ — ${titles.admin}（凍結アカウント）`
              : `MarchinZ/マーチンズ — ${titles.admin}（通報）`;
    } else {
      document.title = `MarchinZ/マーチンズ — ${titles[id] || titles.mll}`;
    }
    updateMetaForPage(id, routeOpts);
    /* ページが変わったら先頭へ(2026-08-06、許可リスト→除外リストへ反転)。
       旧: 許可リストに creators/videos/youtube/webmagazine が無く、
       未配線リンク(フッター等)から移ると最下部に取り残された。
       除外は2つだけ:
       ・初回表示(prevPageId が空) ─ 再読込時のブラウザのスクロール復元を殺さない
       ・community 内のタブ移動 ─ タブ切替でスクロールを据え置く */
    const prevPageId = mzLastRoute.pageId;
    const isCommunityTabMove = id === "community" && prevPageId === "community";
    if (prevPageId !== "" && !isCommunityTabMove) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "auto" });
      });
    }
    updateSiteBrandAuthEntryLinks();
    if (id === "videos") {
      if (typeof window.__marchinzResetVideosSearchTab === "function") {
        window.__marchinzResetVideosSearchTab();
      } else {
        window.__marchinzPendingVideosReset = true;
      }
      if (typeof window.MarchinZVideoMylist?.renderList === "function") {
        window.MarchinZVideoMylist.renderList();
      }
    }
    mzLastRoute = { pageId: id, communityTab: commTab };
    if (id === "community" && commTab === "board") {
      window.MarchinZCommunityComposeDraft?.onEnterBoard?.();
    } else if (id === "community" && commTab === "events") {
      window.MarchinZCalendarEventDraft?.onEnterEvents?.();
    }
    if (id === "youtube") {
      if (typeof window.__marchinzResetYoutubeCategoryTabs === "function") {
        window.__marchinzResetYoutubeCategoryTabs();
      } else {
        window.__marchinzPendingYoutubeReset = true;
      }
      if (typeof window.MarchinZYoutubeChannelMylist?.renderMylist === "function") {
        window.MarchinZYoutubeChannelMylist.renderMylist();
      }
    }
    if (id === "webmagazine") {
      const firstJump = document.querySelector(".media-jump-tab");
      if (firstJump) setMediaJumpTabActive(firstJump);
    }
    if (id === "community" && normalizeCommunityTab(routeOpts.communityTab ?? "events") === "notes") {
      if (typeof window.MarchinZMlnPublicFeed?.ensureInitialLoad === "function") {
        void window.MarchinZMlnPublicFeed.ensureInitialLoad();
      } else if (typeof window.MarchinZMlnPublicFeed?.refresh === "function") {
        void window.MarchinZMlnPublicFeed.refresh();
      }
    }
    if (id === "community" && normalizeCommunityTab(routeOpts.communityTab ?? "events") === "moments") {
      if (typeof window.MarchinZMomentFeed?.ensureInitialLoad === "function") {
        void window.MarchinZMomentFeed.ensureInitialLoad();
      } else if (typeof window.MarchinZMomentFeed?.refresh === "function") {
        void window.MarchinZMomentFeed.refresh();
      }
    }
    if (id === "community") {
      const ct = normalizeCommunityTab(routeOpts.communityTab ?? "events");
      if (ct === "events" || ct === "board") {
        try {
          void window.MarchinZCommunityUpdates?.refresh?.(ct === "board" ? "board" : "event");
        } catch {
          //
        }
      }
    }
    if (id === "ugc") {
      const kind = UGC_KIND_SUFFIXES.includes(String(routeOpts.ugcKind || ""))
        ? String(routeOpts.ugcKind)
        : "signup";
      try {
        window.MarchinZAdminUgc?.setKind?.(kind);
        void window.MarchinZAdminUgc?.refreshBadges?.();
        void window.MarchinZAdminUgc?.refreshNavSignupCount?.();
        void window.MarchinZAdminUgc?.refresh?.();
      } catch {
        //
      }
    }
    if (id === "ugc-tools") {
      try {
        void window.MarchinZAdminUgcTools?.refresh?.();
        void window.MarchinZAdminUgcTools?.refreshBadge?.();
      } catch {
        //
      }
    }
    if (id === "admin") {
      try {
        void window.MarchinZAdminUgc?.refreshBadges?.();
        void window.MarchinZAdminUgc?.refreshNavSignupCount?.();
      } catch {
        //
      }
      const rawAt = String(routeOpts.adminTab || "").trim().toLowerCase();
      const at =
        rawAt === "announce"
          ? "announce"
          : rawAt === "trash"
            ? "trash"
            : rawAt === "banned"
              ? "banned"
              : "reports";
      try {
        window.MarchinZAdminShell?.setTab?.(at);
      } catch {
        //
      }
    }

    try {
      window.MarchinZCoreEngagement?.stop();
    } catch {
      //
    }
    try {
      window.MarchinZTrackRouteView?.(id, routeOpts);
    } catch {
      //
    }
    let coreSurface = "";
    if (id === "videos") {
      coreSurface = "videos_browse";
    } else if (id === "community") {
      coreSurface = "community_browse";
    } else if (id === "media") {
      coreSurface = "media_browse";
    } else if (id === "profile") {
      const full = location.hash.replace(/^#/, "");
      const qi = full.indexOf("?");
      if (qi !== -1) {
        const tab = new URLSearchParams(full.slice(qi + 1)).get("tab");
        if (String(tab || "").trim().toLowerCase() === "logdiary") {
          coreSurface = "log_diary";
        }
      }
    }
    if (coreSurface) {
      try {
        window.MarchinZCoreEngagement?.start(coreSurface);
      } catch {
        //
      }
    }
  }

  function setMetaContent(el, value) {
    if (!el || !value) return;
    el.setAttribute("content", value);
  }

  /**
   * @param {string} id
   * @param {{ communityTab?: string|null, adminTab?: string|null, ugcKind?: string|null }} [routeOpts]
   */
  function updateMetaForPage(id, routeOpts = {}) {
    let ogKey = id;
    if (id === "community") {
      const t = normalizeCommunityTab(routeOpts.communityTab ?? "events");
      if (t === "events") ogKey = "events";
      else if (t === "notes") ogKey = "notes";
      else if (t === "moments") ogKey = "moments";
      else ogKey = "community";
    }
    const og = ogByPage[ogKey] || ogByPage.videos;
    let url = `${publicBaseUrl}#${id}`;
    if (id === "mll") {
      url = `${publicBaseUrl}#top`;
    }
    if (id === "community") {
      const t = normalizeCommunityTab(routeOpts.communityTab ?? "events");
      url =
        t === "events"
          ? `${publicBaseUrl}#community/events`
          : t === "moments"
            ? `${publicBaseUrl}#community/moments`
            : t === "board"
              ? `${publicBaseUrl}#community/board`
              : `${publicBaseUrl}#community/notes`;
    }
    if (id === "ugc") {
      const kind = UGC_KIND_SUFFIXES.includes(String(routeOpts.ugcKind || ""))
        ? String(routeOpts.ugcKind)
        : "signup";
      url = `${publicBaseUrl}#ugc/${kind}`;
    }
    if (id === "admin") {
      const rawAt = String(routeOpts.adminTab || "").trim().toLowerCase();
      const at =
        rawAt === "announce"
          ? "announce"
          : rawAt === "trash"
            ? "trash"
            : rawAt === "banned"
              ? "banned"
              : "reports";
      url = `${publicBaseUrl}#admin/${at}`;
    }
    if (id === "profile") {
      const h = location.hash.replace(/^#/, "").trim();
      if (/^profile(?=\?|$)/i.test(h)) {
        url = `${publicBaseUrl}#${h}`;
      }
    }
    setMetaContent(metaDescription, og.description);
    setMetaContent(metaOgTitle, og.title);
    setMetaContent(metaOgDescription, og.description);
    setMetaContent(metaOgUrl, url);
    setMetaContent(metaOgImage, og.image || defaultOgImage);
    setMetaContent(metaTwitterTitle, og.title);
    setMetaContent(metaTwitterDescription, og.description);
    setMetaContent(metaTwitterImage, og.image || defaultOgImage);
  }

  /** プロフィールの `tab=` 変更など、ハッシュだけ変わったあとに OG / Twitter の URL を揃える */
  window.MarchinZRefreshSeoFromLocation = function marchinZRefreshSeoFromLocation() {
    const r = routeFromHash();
    updateMetaForPage(r.pageId, {
      communityTab: r.communityTab,
      adminTab: r.adminTab,
      ugcKind: r.ugcKind,
    });
  };

  function syncFromHash() {
    if (!location.hash) {
      history.replaceState(null, "", `${location.pathname}${location.search}#top`);
    }
    const r = routeFromHash();
    showPage(r.pageId, {
      communityTab: r.communityTab,
      adminTab: r.adminTab,
      ugcKind: r.ugcKind,
    });
    if (typeof window.MarchinZUserProfile?.onRouteShow === "function") {
      window.MarchinZUserProfile.onRouteShow(r.pageId);
    }
  }

  function setupMediaMoreButtons() {
    document.querySelectorAll(".media-more-btn[data-target]").forEach((btn) => {
      const id = btn.getAttribute("data-target");
      if (!id) return;
      const grid = document.getElementById(id);
      if (!grid) return;
      const extras = [...grid.querySelectorAll(".media-item-extra")];
      const extraCount = extras.length;
      if (extraCount <= 0) {
        btn.hidden = true;
        return;
      }
      const step = Number.parseInt(btn.dataset.step ?? "4", 10) || 4;
      btn.hidden = false;
      let revealed = 0;
      btn.addEventListener("click", () => {
        revealed = Math.min(extraCount, revealed + step);
        extras.forEach((el, idx) => {
          if (idx < revealed) el.classList.add("media-item-revealed");
        });
        if (revealed >= extraCount) btn.hidden = true;
      });
    });
  }

  function setMediaJumpTabActive(el) {
    document.querySelectorAll(".media-jump-tab").forEach((node) => {
      node.classList.toggle("media-jump-tab--active", node === el);
    });
  }

  function setupMediaJumpLinks() {
    document.querySelectorAll(".media-jump-links a[data-target-id]").forEach((a) => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const targetId = a.getAttribute("data-target-id");
        if (!targetId) return;
        setMediaJumpTabActive(a);
        if (location.hash !== "#webmagazine") {
          history.replaceState(null, "", `${location.pathname}${location.search}#webmagazine`);
          syncFromHash();
        }
        const target = document.getElementById(targetId);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  async function setupYoutubePage() {
    /** 掲載リスト表記用。データ更新のたびに yyyymmdd へ合わせて更新する。 */
    const YOUTUBE_LIST_DATE_YMD = "20260520";
    const list = document.getElementById("youtube-channel-list");
    const moreBtn = document.getElementById("youtube-more-btn");
    const visibleCountEl = document.getElementById("youtube-visible-count");
    const tabs = [...document.querySelectorAll(".youtube-tab-btn[data-yt-category]")];
    const sortBtns = [...document.querySelectorAll(".youtube-sort-btn[data-yt-sort]")];
    if (!list || !tabs.length) return;

    const youtubePanel = document.querySelector(".youtube-results-panel");
    const youtubeSkeleton = document.getElementById("youtube-results-skeleton");
    const youtubeMoreWrap = document.getElementById("youtube-result-more-wrap");

    function setYoutubeResultsLoading(loading) {
      if (youtubeSkeleton) {
        youtubeSkeleton.hidden = !loading;
        youtubeSkeleton.setAttribute("aria-busy", loading ? "true" : "false");
        youtubeSkeleton.setAttribute("aria-hidden", loading ? "false" : "true");
      }
      if (list) list.hidden = loading;
      if (youtubePanel) youtubePanel.setAttribute("aria-busy", loading ? "true" : "false");
      const dis = loading;
      sortBtns.forEach((b) => {
        b.disabled = dis;
      });
      tabs.forEach((b) => {
        b.disabled = dis;
      });
      if (moreBtn) moreBtn.disabled = dis;
    }

    const listDateEl = document.getElementById("youtube-list-updated");
    if (listDateEl) {
      listDateEl.textContent = `リスト更新${YOUTUBE_LIST_DATE_YMD}`;
      listDateEl.hidden = true;
    }
    let channels = [
      {
        name: "マーチング祭®︎ / MIX3｜Sport of Sound.®︎",
        url: "https://www.youtube.com/@marching-matsuri",
        category: "大会",
        logo: "https://yt3.googleusercontent.com/BRozR2V0kVmzW5k76OX3AIpgm6CctbmqQO0AvXZxcvvnx96vHolaj7ndH4vqbhow0gQTufAEsQ=s68-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/zPrYC0efNLk/hqdefault.jpg",
          "https://i.ytimg.com/vi/HGv6UUHRHtY/hqdefault.jpg",
          "https://i.ytimg.com/vi/_gZMLqdQjXw/hqdefault.jpg",
          "https://i.ytimg.com/vi/WW-NPKs4ySs/hqdefault.jpg",
        ],
      },
      {
        name: "DrumcorpsfunTV",
        url: "https://www.youtube.com/@DrumcorpsfunTV",
        category: "大会",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_ncCdkIg_Zv83pDzqyW8QpLp40LNW23KHyDdZVapdf82w=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/ktSQPm8RrJU/hqdefault.jpg",
          "https://i.ytimg.com/vi/jLnXRrpljIU/hqdefault.jpg",
          "https://i.ytimg.com/vi/L_pT4ES0JWU/hqdefault.jpg",
          "https://i.ytimg.com/vi/4xkLSJOZ87U/hqdefault.jpg",
        ],
      },
      {
        name: "マーチングバンド DER GLANZ",
        url: "https://www.youtube.com/@derglanz6310",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/4V8UeldQv3hm0yyc42K7jxfzsl9hYem9ySRuzaZePb0OA5sR6-LtGG_J2ohenGj4eXsEYN_i=s68-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/WToG-UGq5GY/hqdefault.jpg",
          "https://i.ytimg.com/vi/dJ7c6-Wzed4/hqdefault.jpg",
          "https://i.ytimg.com/vi/uJYRxkAByl0/hqdefault.jpg",
        ],
      },
      {
        name: "allure",
        url: "https://www.youtube.com/@allure_2022",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/3JLONW87rDfXXlT0x1GFTfyiAQ8EY0DZERXD3YJkr4UkhRHZhyIhxcDLCA8VT3LC1fIqI6jy=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/YQ_s52PCy-Q/hqdefault.jpg",
          "https://i.ytimg.com/vi/nRwVpFd6gZE/hqdefault.jpg",
          "https://i.ytimg.com/vi/6Q7xBO8Nnjg/hqdefault.jpg",
          "https://i.ytimg.com/vi/2ESFmUgxMnc/hqdefault.jpg",
        ],
      },
      {
        name: "THE YOKOHAMA SCOUTS",
        url: "https://www.youtube.com/@theyokohamascouts/videos",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/PSyAmFeaVyX9J8ccrfrwCIEgdOdTU2lGOB6MBJ2QPktloxXJAkcMTx8itOsUWGQYHrZQ4vpkFA=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/n17EPBV18-M/hqdefault.jpg",
          "https://i.ytimg.com/vi/2k_Kj2G7zN0/hqdefault.jpg",
          "https://i.ytimg.com/vi/AWMQboR5slc/hqdefault.jpg",
        ],
      },
      {
        name: "SRVanguardJP",
        url: "https://www.youtube.com/@SRVanguardJP",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_lU3z-MGYLZTfjBDFLjxS04ZqbTr37aqM8ctxN36zQSJ0I=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/Z6k5j1VP5_s/hqdefault.jpg",
          "https://i.ytimg.com/vi/aAFuaVPafUA/hqdefault.jpg",
          "https://i.ytimg.com/vi/d_nCThWwKj4/hqdefault.jpg",
        ],
      },
      {
        name: "Aimachi Marching Band Official【愛町マーチングバンド】",
        url: "https://www.youtube.com/@AimachiMarchingBandOfficial",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/PvhwzoI0XzR4RyuF0CATosNIlWhnzfc3k9RIhc8Fb4LyvZ7w5ygofIjzMRW2Cj-Ru7-337X9DQ4=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/hZNbTItbd4I/hqdefault.jpg",
          "https://i.ytimg.com/vi/6ovjQBRJ6t8/hqdefault.jpg",
          "https://i.ytimg.com/vi/hF2Dx4mRb3k/hqdefault.jpg",
          "https://i.ytimg.com/vi/KOzMrnKMT4Y/hqdefault.jpg",
        ],
      },
      {
        name: "Dream Scouts",
        url: "https://www.youtube.com/@dreamscouts5848",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_nlYEzD6_Hmq9h-KD7zHkbXmPXgjll3fR9WARLgY9fk5Q=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/jMikVRlXE0o/hqdefault.jpg",
          "https://i.ytimg.com/vi/Rg0X_kWoYcE/hqdefault.jpg",
          "https://i.ytimg.com/vi/12wga6kwkAE/hqdefault.jpg",
          "https://i.ytimg.com/vi/yk1dM0EVeIA/hqdefault.jpg",
        ],
      },
      {
        name: "【公式】奈良学園大学マーチングバンド部 / NARAGAKU Marching Band",
        url: "https://youtube.com/channel/UCBRNUdZOBQMPzotC_ROHCdg?si=kNyJolswxVBIj3to",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/tJAyY2RojXKHRujsQkv3v_IPRO0R5P2dgsmmFgbWhkqvFu5ULSnJVoWGlRyN4ySRYGCmggY=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/gXORjDZnq04/hqdefault.jpg",
          "https://i.ytimg.com/vi/alfvvj4PgOQ/hqdefault.jpg",
          "https://i.ytimg.com/vi/cyMvNGDcRLQ/hqdefault.jpg",
        ],
      },
      {
        name: "吉祥院ザウルス　公式アカウント",
        url: "https://www.youtube.com/@zaurus2019",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/yCBptP1efK8s4Q-nBhUTmdgek6nPngVCHt7ckvRmFhj5r1qlWVA49vYQkPbQJsbU582HfsaQ8A=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/peaKgHzPdqQ/hqdefault.jpg",
          "https://i.ytimg.com/vi/SynVyzbifb0/hqdefault.jpg",
          "https://i.ytimg.com/vi/qqf5VixBnlU/hqdefault.jpg",
          "https://i.ytimg.com/vi/IXA5utFNtaA/hqdefault.jpg",
        ],
      },
      {
        name: "WHITE GALAXY",
        url: "https://www.youtube.com/@whitegalaxy2897",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_lpdgGNSSX2PhwJBRWaBGoz2HmEFJ8jbByVIUa6wWOR9w=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/l8F9K17MAfA/hqdefault.jpg",
          "https://i.ytimg.com/vi/sEevfI4VrGk/hqdefault.jpg",
          "https://i.ytimg.com/vi/r0y7EHWqnSs/hqdefault.jpg",
          "https://i.ytimg.com/vi/6WXGK3eEpek/hqdefault.jpg",
        ],
      },
      {
        name: "MARCHINGBAND COURAGE",
        url: "https://www.youtube.com/@MarchingbandCourage",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/VQIujF9n2kyGtvSb5LTrXdab3rhKbbinx-Ko_Poj34Tl2yrybPX8oYDMe2vxdGRgNPnadb_U=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/lSm-i0pRZeA/hqdefault.jpg",
          "https://i.ytimg.com/vi/R1L1HN8jYUg/hqdefault.jpg",
          "https://i.ytimg.com/vi/nDIDSipebTY/hqdefault.jpg",
          "https://i.ytimg.com/vi/SSCL72YoCdE/hqdefault.jpg",
        ],
      },
      {
        name: "GENESIS(ジェネシス) 一般マーチング",
        url: "https://www.youtube.com/@MarchingBandGENESIS",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/U7d1FDKwulrkwri349o_xJqWzG6HmyEbSvex4TnDkq1op2AruZzKuiCHsY5ZxIZC_Rcq2Xlv=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/3DeziGx2qqo/hqdefault.jpg",
          "https://i.ytimg.com/vi/KIpQ26ABDSY/hqdefault.jpg",
          "https://i.ytimg.com/vi/pCevh31HDC8/hqdefault.jpg",
          "https://i.ytimg.com/vi/LonYKKy9nx8/hqdefault.jpg",
        ],
      },
      {
        name: "じぇねTUBE_マーチング情報",
        url: "https://www.youtube.com/@genetube2018",
        category: "マーチング配信",
        logo: "https://yt3.googleusercontent.com/2zp9ZnYupQwHw6I2jRVZxLzeZiphXWHiBfertnrW9zv6rINc_7HxcAZxNNshmsPPOhWFitX3=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/3rgxCdI8M4E/hqdefault.jpg",
          "https://i.ytimg.com/vi/4-oSeinpKjI/hqdefault.jpg",
          "https://i.ytimg.com/vi/OkrDoYl0t-w/hqdefault.jpg",
          "https://i.ytimg.com/vi/6d5jjGv_Iyo/hqdefault.jpg",
        ],
      },
      {
        name: "Yokohama INSPIRES Drum & Bugle Corps",
        url: "https://www.youtube.com/@yokohamainspiresdrumbuglec9551",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/F77tLZYrW7_OGicDhUfxBCAzEQktfSR9zpKhnfNDxePent7pIK7ZsXn681SkFUXqNCWnb0PP=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/La34YKX4kEY/hqdefault.jpg",
          "https://i.ytimg.com/vi/sEX_Uj6-szI/hqdefault.jpg",
          "https://i.ytimg.com/vi/gcdSqSGH3L8/hqdefault.jpg",
          "https://i.ytimg.com/vi/O2eOh7RUuZM/hqdefault.jpg",
        ],
      },
      {
        name: "SatsukiDreamersOrg",
        url: "https://www.youtube.com/@SatsukiDreamersOrg",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_n0Vohhs-4qynIgsb9EiLV8xJS8Vlr4Uv2ifOvt8L0N9Q=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/SrHSVARVWY8/hqdefault.jpg",
          "https://i.ytimg.com/vi/SOmsZEwktkY/hqdefault.jpg",
          "https://i.ytimg.com/vi/JTnt9ddx5Ys/hqdefault.jpg",
          "https://i.ytimg.com/vi/y95VFl6zZkU/hqdefault.jpg",
        ],
      },
      {
        name: "SENDAIVerdures",
        url: "https://www.youtube.com/@SENDAIVerdures",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_lmOUAjg39Ayr9FtfstuBsCAYQ9BKRWvP0Aaw09BhbYjQ=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/WFTu5moizog/hqdefault.jpg",
          "https://i.ytimg.com/vi/A9LC4uRTkck/hqdefault.jpg",
          "https://i.ytimg.com/vi/e18yN2ZaHq0/hqdefault.jpg",
          "https://i.ytimg.com/vi/9YEZC5wOQ0M/hqdefault.jpg",
        ],
      },
      {
        name: "IPUマーチングバンド 公式チャンネル",
        url: "https://www.youtube.com/@ipu8028",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_lFHG8yQfh2js-lqx9Dg4zEmo6BQPViHn9Fo0F7uz1C2A=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/KmKjzwZknjM/hqdefault.jpg",
          "https://i.ytimg.com/vi/4SbK2aCtAzA/hqdefault.jpg",
          "https://i.ytimg.com/vi/MX2ZM2HRmCc/hqdefault.jpg",
          "https://i.ytimg.com/vi/QBCPXv_zxdc/hqdefault.jpg",
        ],
      },
      {
        name: "TokyoPhoenix",
        url: "https://www.youtube.com/@tokyophoenixdrumbuglecorps773",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/6DZfKq28AAR4JnzlpoInXUJz2j5nsKeSvw-Oi1t_iF3_a17wcgk0d8DcO2q7Uu7nSJ-Mou8SRQ=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/bMYAfSOgvWs/hqdefault.jpg",
          "https://i.ytimg.com/vi/_Zz4CX5yh10/hqdefault.jpg",
          "https://i.ytimg.com/vi/YI3IkUwWuBE/hqdefault.jpg",
          "https://i.ytimg.com/vi/UsyzwgUQ3ts/hqdefault.jpg",
        ],
      },
      {
        name: "SONIC LANCERS",
        url: "https://www.youtube.com/@soniclancers7729",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_lUpwePhxQ7POHHdXqf6vjLtvE-dT52Avxns6WTGKTOWXM=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/FtobkfJbzWw/hqdefault.jpg",
          "https://i.ytimg.com/vi/S7CTHK_RPfE/hqdefault.jpg",
          "https://i.ytimg.com/vi/lhi6QGcwMGo/hqdefault.jpg",
          "https://i.ytimg.com/vi/Hp2GkWXT7qU/hqdefault.jpg",
        ],
      },
      {
        name: "【 Legend TV 】マーチングバンド・Legend of ANGELS",
        url: "https://www.youtube.com/@LegendofANGELSPR",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/MmAlbVP6izufEBP1CQquLGQ0sz93LuAbU9WnKqMjcQIsyTkZgbB9ewrjpGjNwVH3jzpX3UDQZV0=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/8R1H14J8JIs/hqdefault.jpg",
          "https://i.ytimg.com/vi/PW6SBgNSBk8/hqdefault.jpg",
          "https://i.ytimg.com/vi/d1XVDUKH7dQ/hqdefault.jpg",
          "https://i.ytimg.com/vi/yQiUBTi-2Es/hqdefault.jpg",
        ],
      },
      {
        name: "JOKERS Drum & Bugle Corps",
        url: "https://www.youtube.com/@jokers_dbc",
        category: "一般",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_nOgGiUB0uf_WVFHH7t2Jdywv9AMzrcemdGeJRspr2gkw=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/MQohaCSvaxg/hqdefault.jpg",
          "https://i.ytimg.com/vi/I_2yXCbOekU/hqdefault.jpg",
          "https://i.ytimg.com/vi/hBUWObLutRA/hqdefault.jpg",
          "https://i.ytimg.com/vi/oSP-SW-Up_M/hqdefault.jpg",
        ],
      },
      {
        name: "【公式】京都橘高校吹奏楽部",
        url: "https://www.youtube.com/@kyototachibana-SHSband",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_nzQydTjYWjf8zLG_iCuOymoj0tvYSkAno4Llex5GGX5Q=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/jdrSQdEK1pQ/hqdefault.jpg",
          "https://i.ytimg.com/vi/k-QcvPLxoGQ/hqdefault.jpg",
          "https://i.ytimg.com/vi/4MozbWYxjgo/hqdefault.jpg",
        ],
      },
      {
        name: "農大二高吹奏楽部エメラルドナイツ",
        url: "https://youtube.com/channel/UCBeLVZz52RfizavumDvRiFA?si=OufqB30QHV482KjW",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_kkqIMLjlGuvjDKpOv-6vHEIhEcYWbyKyGmtDmJcPCuiQ=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/FpnCNTURvqQ/hqdefault.jpg",
          "https://i.ytimg.com/vi/5XjWMRlbPKI/hqdefault.jpg",
          "https://i.ytimg.com/vi/GshxNMbDfGg/hqdefault.jpg",
        ],
      },
      {
        name: "県岐商吹奏楽部YouTubeチャンネル",
        url: "https://www.youtube.com/@Gifushoband",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/pOKCLGAYSw4gPBC52qQE2klAqvLaCuyPAT9DSSiYMWLkX_KTJYgEeqXtyN70aMU40Ahoeu_jQWc=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/v0i8LFKTzWM/hqdefault.jpg",
          "https://i.ytimg.com/vi/FA3b26ImHxY/hqdefault.jpg",
          "https://i.ytimg.com/vi/nGriCxIbOOI/hqdefault.jpg",
        ],
      },
      {
        name: "OBBCchannel",
        url: "https://www.youtube.com/@OBBCchannel",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_msmN_Lb4zLraezsZCmye6OOOsReAPqdwoPdr-oyQ5N1b0=s68-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/2YKde7XQhKI/hqdefault.jpg",
          "https://i.ytimg.com/vi/GI4Cg9kP-_E/hqdefault.jpg",
          "https://i.ytimg.com/vi/uWwCquBqEbo/hqdefault.jpg",
        ],
      },
      {
        name: "京都両洋高等学校吹奏楽部",
        url: "https://www.youtube.com/@RYOYO_wind-band",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/bMJLwyx_9dJcxkUMM4XnT3EJuYnnjLE-1Ct8usH0PneVH1zsDnKZvGAX7AQ39kSTFCpliqMuiQ=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/_Qa0jJQUe6Y/hqdefault.jpg",
          "https://i.ytimg.com/vi/bHsTHVkOAKQ/hqdefault.jpg",
          "https://i.ytimg.com/vi/1T-rKGBlZ78/hqdefault.jpg",
          "https://i.ytimg.com/vi/cM53weq-1w4/hqdefault.jpg",
        ],
      },
      {
        name: "【公式】大阪府立淀川工科高等学校吹奏楽部",
        url: "https://www.youtube.com/@Yodogawa.t.h.s_band/videos",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/jXZf_I4ZW1scAycsYV78lCILE7tAyGkAhYFnN4yibLJ-BriFOwijJVNrovSKL36ryhAoYFqv=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/qYIJXG_XDUg/hqdefault.jpg",
          "https://i.ytimg.com/vi/qrRESxrwHm8/hqdefault.jpg",
          "https://i.ytimg.com/vi/85z2E5MM6JA/hqdefault.jpg",
          "https://i.ytimg.com/vi/oKRQSZkCSh4/hqdefault.jpg",
        ],
      },
      {
        name: "活水中学校・高等学校吹奏楽部",
        url: "https://www.youtube.com/@kwassui-chuko-brass",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_lQmPoH_ao1GTqr4v9juqyEGg1SHZZGgiKwYOEfwFLA5RM=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/U5ds0IJZmLI/hqdefault.jpg",
          "https://i.ytimg.com/vi/y_8vhNwOCaw/hqdefault.jpg",
          "https://i.ytimg.com/vi/qOboab-c8ak/hqdefault.jpg",
        ],
      },
      {
        name: "【公式】四條畷学園高等学校マーチングバンド Burning Bravers",
        url: "https://www.youtube.com/@BurningBravers",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/uxOfLbCCtQ_5vIgaKccVUBk1TaZkpRjY1M79D-S0rLIealXvLcYX-k_lyGOy4Ec-o7HKlVlD=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/e4F5V2D4P8Y/hqdefault.jpg",
          "https://i.ytimg.com/vi/kn4ohkuEhZY/hqdefault.jpg",
          "https://i.ytimg.com/vi/VXZWoKcmMZ0/hqdefault.jpg",
          "https://i.ytimg.com/vi/K3JpAhELinM/hqdefault.jpg",
        ],
      },
      {
        name: "鵠沼高校マーチングバンド部 AlbireoNova",
        url: "https://www.youtube.com/@AlbireoNova",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/LlMQFOTaJmmT9wfQ09dKtHU0pIi7BSU9INSNOsxbKYLZNJiZtPpav7s9qfwcVyyECGcVA7Y7wg=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/tRbc6Szj9mc/hqdefault.jpg",
          "https://i.ytimg.com/vi/EW-cKOKVSuo/hqdefault.jpg",
          "https://i.ytimg.com/vi/0VWxLDWkbU0/hqdefault.jpg",
        ],
      },
      {
        name: "GracefulSpirit CHIBAKEIAI MarchingBand",
        url: "https://www.youtube.com/@ckgs_marchingband",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/3SLkgiq4bFC7mlreoyD_0FgMrh33uFlKDZ_R0nm70JMP9mVqY01aXHX058I5GtnUE54x7m0KhA=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/YP1oERLuqeY/hqdefault.jpg",
          "https://i.ytimg.com/vi/9h9Ys1ti8PI/hqdefault.jpg",
          "https://i.ytimg.com/vi/h-kMmQw5FQ0/hqdefault.jpg",
        ],
      },
      {
        name: "Shonandai HS Marching Band White Shooting Stars",
        url: "https://www.youtube.com/@ShonandaiWSS",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_ngpuK8bgY9hBURoYBzAYWRiETwUmhjC5xV1FZPlbX_iQ=s72-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/dA7FSojZnCo/hqdefault.jpg",
          "https://i.ytimg.com/vi/ru_KM9w1GIE/hqdefault.jpg",
          "https://i.ytimg.com/vi/bd5UYGBoEBs/hqdefault.jpg",
          "https://i.ytimg.com/vi/vGb5IsvrXbQ/hqdefault.jpg",
        ],
      },
      {
        name: "関東学院マーチングバンド",
        url: "https://www.youtube.com/@kgmb1952",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/6dv1dDywOMt4bPkleavrVySemLP4gc-z0Ym8xtPYpO2DBtoFEyRVSn2zMcJTKwVT4ZXgaUDbQw=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/S2xPhSiQ8Ls/hqdefault.jpg",
          "https://i.ytimg.com/vi/_fv8gqR6FMY/hqdefault.jpg",
          "https://i.ytimg.com/vi/ri1K7s4cq9o/hqdefault.jpg",
          "https://i.ytimg.com/vi/QUsjAXxonMs/hqdefault.jpg",
        ],
      },
      {
        name: "青鷹TV",
        url: "https://www.youtube.com/@aotaka-TV",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/N54Z2xUWK34EV2VFamAuNUjQ0q5m7VxfW0tS-Lb3bB39oSumhrlDwmWX3f194SvXHZ2m2mZRPw=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/JhgyKp9rhh4/hqdefault.jpg",
          "https://i.ytimg.com/vi/6YJ4WbFX-8E/hqdefault.jpg",
          "https://i.ytimg.com/vi/Mv2QKE87ek8/hqdefault.jpg",
          "https://i.ytimg.com/vi/DBST-MK3oLs/hqdefault.jpg",
        ],
      },
      {
        name: "滝川第二高等学校吹奏楽部[公式チャンネル]",
        url: "https://youtube.com/channel/UCNnXTXxa3qpNR6tWSfJ4WlA?si=vhwefLDpFrR2qnxe",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_k1ECB0Aby7Y_eSaaBl_z250k-ZIMOcuKd9R_ek4A3JBw=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/JshBoHdjAwk/hqdefault.jpg",
          "https://i.ytimg.com/vi/FYT5XXMbSnM/hqdefault.jpg",
          "https://i.ytimg.com/vi/dZigNOX9sds/hqdefault.jpg",
        ],
      },
      {
        name: "【公式】PHOENIX Alumni",
        url: "https://www.youtube.com/@P-Regiment.Alumni",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/_uOd05YxsfVyaWYFihgQPwSJTWz2h-3H54ZadiQIKqPP3ya3Dulo_edGoVmcrun92nFdnuN8Yg=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/TbKA95P1y70/hqdefault.jpg",
          "https://i.ytimg.com/vi/9JV3TWfU1sI/hqdefault.jpg",
          "https://i.ytimg.com/vi/dMh4dhgwEuM/hqdefault.jpg",
          "https://i.ytimg.com/vi/J0_Ugul83vQ/hqdefault.jpg",
        ],
      },
      {
        name: "加藤学園高校吹奏楽部 Blue Wings【公式】",
        url: "https://www.youtube.com/@Bluewings-6630",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/d-uDe0fHCrXtlxk8CgWg-C2RH7DyVhtcjMgFY01VyqcXucZd_7cSj9CFsmFm-7nhd6JlrgP1=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/21X2FtXmb-4/hqdefault.jpg",
          "https://i.ytimg.com/vi/AxuJJkymyg4/hqdefault.jpg",
          "https://i.ytimg.com/vi/bmWPsFSAAoY/hqdefault.jpg",
          "https://i.ytimg.com/vi/XkUu4stYOHE/hqdefault.jpg",
        ],
      },
      {
        name: "美濃加茂高等学校マーチングバンド部Brilliant Max",
        url: "https://www.youtube.com/@Brilliant_Max",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/T_oSap_a1Pqyorcpfm1FUs8v3KDKV0x6NncXcDH5dB6EZ2AWwPMt3kbIwSMLnDjeAn3a9EPzyA=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/FXChc9vsE_0/hqdefault.jpg",
          "https://i.ytimg.com/vi/TQVTZtMp940/hqdefault.jpg",
          "https://i.ytimg.com/vi/iBQiPb76wiI/hqdefault.jpg",
          "https://i.ytimg.com/vi/CYWUA7eevag/hqdefault.jpg",
        ],
      },
      {
        name: "精華女子高等学校吹奏楽部",
        url: "https://youtube.com/channel/UC7tSqrQO7t-RsZhEX0HOmtg",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_nik7ZBCk-VNAXQNu8wOQ8lNNsiuL-FNKlQego_HbfNMgI=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/CupgTB7-8qw/hqdefault.jpg",
          "https://i.ytimg.com/vi/j2cLD8ez_Xo/hqdefault.jpg",
          "https://i.ytimg.com/vi/tU2D8vi477M/hqdefault.jpg",
          "https://i.ytimg.com/vi/ucB74BwpRAk/hqdefault.jpg",
        ],
      },
      {
        name: "高松中央高校吹奏楽部",
        url: "https://www.youtube.com/@TCWO-TakamatsuChuoWO",
        category: "高校",
        logo: "https://yt3.googleusercontent.com/-qm1SESFaZc29p16UBCpNUCjtH8S6_c7HQhhPwhwqs8Uu7f9vPJGn_FTyCJe3kWNG-ubIiPYKg=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/jFrVF6Bnlkk/hqdefault.jpg",
          "https://i.ytimg.com/vi/n7QodVmBdvY/hqdefault.jpg",
          "https://i.ytimg.com/vi/RqVcX-SOWGc/hqdefault.jpg",
          "https://i.ytimg.com/vi/QzejJydjcvc/hqdefault.jpg",
        ],
      },
      {
        name: "つつじが丘ジュニアマーチングバンド",
        url: "https://www.youtube.com/@tsutsujigaoka",
        category: "中学生以下",
        logo: "https://yt3.googleusercontent.com/3hIWTfCNULGPTQkLy26GRYhF1T_G6n6GOv8ISOHRqFEsCz8gI6HRXehx5Uqo9_QrZTedRaIjwg=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/ggZ8mrtBdDE/hqdefault.jpg",
          "https://i.ytimg.com/vi/H3J8-Ncn404/hqdefault.jpg",
          "https://i.ytimg.com/vi/ULiHng4pD5E/hqdefault.jpg",
          "https://i.ytimg.com/vi/jpbjTUBqOd4/hqdefault.jpg",
        ],
      },
      {
        name: "うるま市立高江洲小学校マーチングバンド部",
        url: "https://youtube.com/channel/UC-gsSr7AOZoaLg51t8YD5fg",
        category: "中学生以下",
        logo: "https://yt3.googleusercontent.com/l5kTwXxpsYYCsPxoeGOpimouzSoMZS3IIpY_4G89GaX64cpr2-WKx5UE7ygIXANZ4UhduLYp-A=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/3Tw2k45uyzU/hqdefault.jpg",
          "https://i.ytimg.com/vi/cBiwl6p1_V0/hqdefault.jpg",
          "https://i.ytimg.com/vi/fFne0q--HY0/hqdefault.jpg",
          "https://i.ytimg.com/vi/T6mzL-BiwaI/hqdefault.jpg",
        ],
      },
      {
        name: "綾北\"Mercury winds\"",
        url: "https://www.youtube.com/@mercurywinds2651",
        category: "中学生以下",
        logo: "https://yt3.googleusercontent.com/eF20XLKRgBBGEL98bh-T3zlwwfo0A61ATYzVgn-uwDgT-1x9X6WJAJCWwr80F8hfLtdE8KNL2eE=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/vzYGnnISEKw/hqdefault.jpg",
          "https://i.ytimg.com/vi/OE85AHEFCYY/hqdefault.jpg",
          "https://i.ytimg.com/vi/IaBdAbAk3uc/hqdefault.jpg",
          "https://i.ytimg.com/vi/TzhNIBzjRJk/hqdefault.jpg",
        ],
      },
      {
        name: "FloMarching",
        url: "https://www.youtube.com/@FloMarching",
        category: "海外",
        logo: "https://yt3.googleusercontent.com/0j_pRqOEvBv3dYaW0r7_y15p0lBIXl5QlciaEm59SdytrDHN3buIEaZkyhhWI0BUN-i8yZF-=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/L_wn6u6SmvA/hqdefault.jpg",
          "https://i.ytimg.com/vi/j9B3QjQ3VSo/hqdefault.jpg",
          "https://i.ytimg.com/vi/4eyC0B7znaU/hqdefault.jpg",
          "https://i.ytimg.com/vi/Jwm29vnh_0w/hqdefault.jpg",
        ],
      },
      {
        name: "DCI",
        url: "https://www.youtube.com/@DCI",
        category: "海外",
        logo: "",
        thumbnails: [],
      },
      {
        name: "Blue Devils",
        url: "http://www.youtube.com/user/TheBlueDevils",
        category: "海外",
        logo: "",
        thumbnails: [],
      },
      {
        name: "Bluecoats",
        url: "http://www.youtube.com/user/CantonBluecoats",
        category: "海外",
        logo: "",
        thumbnails: [],
      },
      {
        name: "Carolina Crown",
        url: "http://www.youtube.com/user/carolinacrowntv",
        category: "海外",
        logo: "",
        thumbnails: [],
      },
      {
        name: "Boston Crusaders",
        url: "http://www.youtube.com/user/bostoncrusaders",
        category: "海外",
        logo: "",
        thumbnails: [],
      },
      {
        name: "Santa Clara Vanguard",
        url: "http://www.youtube.com/user/SantaClaraVanguard",
        category: "海外",
        logo: "",
        thumbnails: [],
      },
      {
        name: "The Cavaliers",
        url: "http://www.youtube.com/user/thecavaliers",
        category: "海外",
        logo: "",
        thumbnails: [],
      },
      {
        name: "Phantom Regiment",
        url: "http://www.youtube.com/user/PhantomRegiment1956",
        category: "海外",
        logo: "",
        thumbnails: [],
      },
      {
        name: "Mandarins",
        url: "http://www.youtube.com/channel/UCDSHOtNzup3rxeWUvs5pybQ",
        category: "海外",
        logo: "",
        thumbnails: [],
      },
      {
        name: "Blue Stars",
        url: "http://www.youtube.com/channel/UC1eKPEEPuPJkGdd8okEH4xQ",
        category: "海外",
        logo: "",
        thumbnails: [],
      },
      {
        name: "Troopers",
        url: "http://www.youtube.com/user/TroopersDrumCorps",
        category: "海外",
        logo: "",
        thumbnails: [],
      },
      {
        name: "Color Guard Team MINERVA",
        url: "https://www.youtube.com/@colorguardteamminerva5329",
        category: "カラーガード",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_k0huAzxKeMYklJ6CoT8x30GvT5aJ6joo54GczvC7eKxQ=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/w8nMzNLrk6Y/hqdefault.jpg",
          "https://i.ytimg.com/vi/eoFRft2pEaY/hqdefault.jpg",
          "https://i.ytimg.com/vi/YPVPPnewwEk/hqdefault.jpg",
          "https://i.ytimg.com/vi/k6M8zCK3ViA/hqdefault.jpg",
        ],
      },
      {
        name: "Revolt colorguard",
        url: "https://www.youtube.com/@Revoltcolorguard",
        category: "カラーガード",
        logo: "https://yt3.googleusercontent.com/6mD9iyuxs-y6bN41Tvxd-jceWEO1nqVkfMao_QonJI7PY_I5Ye2jjeuavRSz3e6opPFYtZO3aw=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/IQxpDRjE-NE/hqdefault.jpg",
          "https://i.ytimg.com/vi/W5OCs5rigJk/hqdefault.jpg",
          "https://i.ytimg.com/vi/vB4cRF2WftQ/hqdefault.jpg",
          "https://i.ytimg.com/vi/S1aPAia3jvY/hqdefault.jpg",
        ],
      },
      {
        name: "ICHIKASHI ALUMNI CGT",
        url: "https://www.youtube.com/@ikalumni_2022",
        category: "カラーガード",
        logo: "https://yt3.googleusercontent.com/ANzJOGnoYrbH3-WsYmxZMwWRO1iOUCyGqYJvmBXDfJ3lyEoNr5aLqNnNT0bPMayMWptBgIO8ZA=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/sXUDBOFOCVw/hqdefault.jpg",
          "https://i.ytimg.com/vi/_1qnl2TBs20/hqdefault.jpg",
          "https://i.ytimg.com/vi/k54QTSmJyis/hqdefault.jpg",
          "https://i.ytimg.com/vi/rZxr5D0wHaM/hqdefault.jpg",
        ],
      },
      {
        name: "Via Colorguard",
        url: "https://www.youtube.com/@viacolorguard7940",
        category: "カラーガード",
        logo: "https://yt3.googleusercontent.com/ytc/AIdro_lkHAipTi_bJ2RYN8BwCkvqEOui0jD7fMPyNBzTY285=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/vmeJ3fyySws/hqdefault.jpg",
          "https://i.ytimg.com/vi/etz7gj7qJVQ/hqdefault.jpg",
          "https://i.ytimg.com/vi/MfIeHdURVZI/hqdefault.jpg",
          "https://i.ytimg.com/vi/hqKYgm2YPhc/hqdefault.jpg",
        ],
      },
      {
        name: "Via Colorguard Jr.",
        url: "https://www.youtube.com/@viacolorguardjr",
        category: "カラーガード",
        logo: "https://yt3.googleusercontent.com/Zjmqw9o89tzsAnJQWeXJhsU1VwRq5EE2yTmYb2upJca8CBLpbS9L2QDbXlV1KWqaLOqlDJevndU=s900-c-k-c0x00ffffff-no-rj",
        thumbnails: [
          "https://i.ytimg.com/vi/7pYTWatr__s/hqdefault.jpg",
          "https://i.ytimg.com/vi/5zVLIM_PqcY/hqdefault.jpg",
          "https://i.ytimg.com/vi/l1zJ2XxWjqo/hqdefault.jpg",
          "https://i.ytimg.com/vi/fBBGst2WQ0w/hqdefault.jpg",
        ],
      },
    ];
    let videoMetaByUrl = {
      "https://www.youtube.com/@marching-matsuri": {
        latestVideo: "zPrYC0efNLk",
        popularVideo: "zPrYC0efNLk",
        popular2: "HGv6UUHRHtY",
        popular3: "_gZMLqdQjXw",
        latestLive: "rnfB71T_PmA",
        popularLive: "rnfB71T_PmA",
      },
      "https://www.youtube.com/@DrumcorpsfunTV": {
        latestVideo: "ktSQPm8RrJU",
        popularVideo: "ktSQPm8RrJU",
        popular2: "jLnXRrpljIU",
        popular3: "L_pT4ES0JWU",
        latestLive: "",
        popularLive: "",
        gridExtra4: "4xkLSJOZ87U",
      },
      "https://www.youtube.com/@allure_2022": {
        latestVideo: "YQ_s52PCy-Q",
        popularVideo: "YQ_s52PCy-Q",
        popular2: "nRwVpFd6gZE",
        popular3: "6Q7xBO8Nnjg",
        latestLive: "",
        popularLive: "",
        gridExtra4: "2ESFmUgxMnc",
      },
      "https://www.youtube.com/@derglanz6310": {
        latestVideo: "WToG-UGq5GY",
        popularVideo: "WToG-UGq5GY",
        popular2: "dJ7c6-Wzed4",
        popular3: "uJYRxkAByl0",
        latestLive: "kMyJF4dZ-g8",
        popularLive: "kMyJF4dZ-g8",
        gridExtra4: "KLE9tyA74fU",
      },
      "https://www.youtube.com/@theyokohamascouts/videos": {
        latestVideo: "n17EPBV18-M",
        popularVideo: "n17EPBV18-M",
        popular2: "2k_Kj2G7zN0",
        popular3: "AWMQboR5slc",
        latestLive: "",
        popularLive: "",
        gridExtra4: "yjZRBWu-wVI",
      },
      "https://www.youtube.com/@SRVanguardJP": {
        latestVideo: "Z6k5j1VP5_s",
        popularVideo: "Z6k5j1VP5_s",
        popular2: "aAFuaVPafUA",
        popular3: "d_nCThWwKj4",
        latestLive: "",
        popularLive: "",
        gridExtra4: "Q69OQls69w4",
      },
      "https://www.youtube.com/@AimachiMarchingBandOfficial": {
        latestVideo: "hZNbTItbd4I",
        popularVideo: "hZNbTItbd4I",
        popular2: "6ovjQBRJ6t8",
        popular3: "hF2Dx4mRb3k",
        latestLive: "",
        popularLive: "",
        gridExtra4: "KOzMrnKMT4Y",
      },
      "https://www.youtube.com/@dreamscouts5848": {
        latestVideo: "jMikVRlXE0o",
        popularVideo: "jMikVRlXE0o",
        popular2: "Rg0X_kWoYcE",
        popular3: "12wga6kwkAE",
        latestLive: "",
        popularLive: "",
        gridExtra4: "yk1dM0EVeIA",
      },
      "https://youtube.com/channel/UCBRNUdZOBQMPzotC_ROHCdg?si=kNyJolswxVBIj3to": {
        latestVideo: "gXORjDZnq04",
        popularVideo: "gXORjDZnq04",
        popular2: "alfvvj4PgOQ",
        popular3: "cyMvNGDcRLQ",
        latestLive: "EzTtv0EHCjY",
        popularLive: "EzTtv0EHCjY",
      },
      "https://www.youtube.com/@zaurus2019": {
        latestVideo: "peaKgHzPdqQ",
        popularVideo: "peaKgHzPdqQ",
        popular2: "SynVyzbifb0",
        popular3: "qqf5VixBnlU",
        latestLive: "_mXBbA7m1bw",
        popularLive: "_mXBbA7m1bw",
        gridExtra4: "IXA5utFNtaA",
      },
      "https://www.youtube.com/@whitegalaxy2897": {
        latestVideo: "l8F9K17MAfA",
        popularVideo: "l8F9K17MAfA",
        popular2: "sEevfI4VrGk",
        popular3: "r0y7EHWqnSs",
        latestLive: "",
        popularLive: "",
        gridExtra4: "6WXGK3eEpek",
      },
      "https://www.youtube.com/@MarchingbandCourage": {
        latestVideo: "lSm-i0pRZeA",
        popularVideo: "lSm-i0pRZeA",
        popular2: "R1L1HN8jYUg",
        popular3: "nDIDSipebTY",
        latestLive: "R1L1HN8jYUg",
        popularLive: "R1L1HN8jYUg",
        gridExtra4: "SSCL72YoCdE",
      },
      "https://www.youtube.com/@MarchingBandGENESIS": {
        latestVideo: "3DeziGx2qqo",
        popularVideo: "3DeziGx2qqo",
        popular2: "KIpQ26ABDSY",
        popular3: "pCevh31HDC8",
        latestLive: "340Y4KapiS4",
        popularLive: "340Y4KapiS4",
        gridExtra4: "LonYKKy9nx8",
      },
      "https://www.youtube.com/@genetube2018": {
        latestVideo: "3rgxCdI8M4E",
        popularVideo: "3rgxCdI8M4E",
        popular2: "4-oSeinpKjI",
        popular3: "OkrDoYl0t-w",
        latestLive: "Tuh22JQ-0E4",
        popularLive: "Tuh22JQ-0E4",
        gridExtra4: "6d5jjGv_Iyo",
      },
      "https://www.youtube.com/@yokohamainspiresdrumbuglec9551": {
        latestVideo: "La34YKX4kEY",
        popularVideo: "La34YKX4kEY",
        popular2: "sEX_Uj6-szI",
        popular3: "gcdSqSGH3L8",
        latestLive: "",
        popularLive: "",
        gridExtra4: "O2eOh7RUuZM",
      },
      "https://www.youtube.com/@SatsukiDreamersOrg": {
        latestVideo: "SrHSVARVWY8",
        popularVideo: "SrHSVARVWY8",
        popular2: "SOmsZEwktkY",
        popular3: "JTnt9ddx5Ys",
        latestLive: "SOmsZEwktkY",
        popularLive: "SOmsZEwktkY",
        gridExtra4: "y95VFl6zZkU",
      },
      "https://www.youtube.com/@SENDAIVerdures": {
        latestVideo: "WFTu5moizog",
        popularVideo: "WFTu5moizog",
        popular2: "A9LC4uRTkck",
        popular3: "e18yN2ZaHq0",
        latestLive: "",
        popularLive: "",
        gridExtra4: "9YEZC5wOQ0M",
      },
      "https://www.youtube.com/@ipu8028": {
        latestVideo: "KmKjzwZknjM",
        popularVideo: "KmKjzwZknjM",
        popular2: "4SbK2aCtAzA",
        popular3: "MX2ZM2HRmCc",
        latestLive: "D36shWWahmI",
        popularLive: "D36shWWahmI",
        gridExtra4: "QBCPXv_zxdc",
      },
      "https://www.youtube.com/@tokyophoenixdrumbuglecorps773": {
        latestVideo: "bMYAfSOgvWs",
        popularVideo: "bMYAfSOgvWs",
        popular2: "_Zz4CX5yh10",
        popular3: "YI3IkUwWuBE",
        latestLive: "",
        popularLive: "",
        gridExtra4: "UsyzwgUQ3ts",
      },
      "https://www.youtube.com/@soniclancers7729": {
        latestVideo: "FtobkfJbzWw",
        popularVideo: "FtobkfJbzWw",
        popular2: "S7CTHK_RPfE",
        popular3: "lhi6QGcwMGo",
        latestLive: "",
        popularLive: "",
        gridExtra4: "Hp2GkWXT7qU",
      },
      "https://www.youtube.com/@LegendofANGELSPR": {
        latestVideo: "8R1H14J8JIs",
        popularVideo: "8R1H14J8JIs",
        popular2: "PW6SBgNSBk8",
        popular3: "d1XVDUKH7dQ",
        latestLive: "",
        popularLive: "",
        gridExtra4: "yQiUBTi-2Es",
      },
      "https://www.youtube.com/@jokers_dbc": {
        latestVideo: "MQohaCSvaxg",
        popularVideo: "MQohaCSvaxg",
        popular2: "I_2yXCbOekU",
        popular3: "hBUWObLutRA",
        latestLive: "",
        popularLive: "",
        gridExtra4: "oSP-SW-Up_M",
      },
      "https://www.youtube.com/@kyototachibana-SHSband": {
        latestVideo: "jdrSQdEK1pQ",
        popularVideo: "jdrSQdEK1pQ",
        popular2: "k-QcvPLxoGQ",
        popular3: "4MozbWYxjgo",
        latestLive: "",
        popularLive: "",
        gridExtra4: "6rHvPKeDa6g",
      },
      "https://youtube.com/channel/UCBeLVZz52RfizavumDvRiFA?si=OufqB30QHV482KjW": {
        latestVideo: "FpnCNTURvqQ",
        popularVideo: "FpnCNTURvqQ",
        popular2: "5XjWMRlbPKI",
        popular3: "GshxNMbDfGg",
        latestLive: "",
        popularLive: "",
        gridExtra4: "Q9596NMszjU",
      },
      "https://www.youtube.com/@Gifushoband": {
        latestVideo: "v0i8LFKTzWM",
        popularVideo: "v0i8LFKTzWM",
        popular2: "FA3b26ImHxY",
        popular3: "nGriCxIbOOI",
        latestLive: "",
        popularLive: "",
        gridExtra4: "e8qKX0dX8BQ",
      },
      "https://www.youtube.com/@OBBCchannel": {
        latestVideo: "2YKde7XQhKI",
        popularVideo: "2YKde7XQhKI",
        popular2: "GI4Cg9kP-_E",
        popular3: "uWwCquBqEbo",
        latestLive: "yN3lIkgV9iY",
        popularLive: "yN3lIkgV9iY",
        gridExtra4: "wn0g6TjLDZI",
      },
      "https://www.youtube.com/@RYOYO_wind-band": {
        latestVideo: "_Qa0jJQUe6Y",
        popularVideo: "_Qa0jJQUe6Y",
        popular2: "bHsTHVkOAKQ",
        popular3: "1T-rKGBlZ78",
        latestLive: "",
        popularLive: "",
      },
      "https://www.youtube.com/@Yodogawa.t.h.s_band/videos": {
        latestVideo: "qYIJXG_XDUg",
        popularVideo: "qYIJXG_XDUg",
        popular2: "qrRESxrwHm8",
        popular3: "85z2E5MM6JA",
        latestLive: "",
        popularLive: "",
        gridExtra4: "oKRQSZkCSh4",
      },
      "https://www.youtube.com/@kwassui-chuko-brass": {
        latestVideo: "U5ds0IJZmLI",
        popularVideo: "U5ds0IJZmLI",
        popular2: "y_8vhNwOCaw",
        popular3: "qOboab-c8ak",
        latestLive: "",
        popularLive: "",
        gridExtra4: "QcBFtjqiYkU",
      },
      "https://www.youtube.com/@BurningBravers": {
        latestVideo: "e4F5V2D4P8Y",
        popularVideo: "e4F5V2D4P8Y",
        popular2: "kn4ohkuEhZY",
        popular3: "VXZWoKcmMZ0",
        latestLive: "",
        popularLive: "",
        gridExtra4: "K3JpAhELinM",
      },
      "https://www.youtube.com/@AlbireoNova": {
        latestVideo: "tRbc6Szj9mc",
        popularVideo: "tRbc6Szj9mc",
        popular2: "EW-cKOKVSuo",
        popular3: "0VWxLDWkbU0",
        latestLive: "",
        popularLive: "",
        gridExtra4: "faU99xUKxJQ",
      },
      "https://www.youtube.com/@ckgs_marchingband": {
        latestVideo: "YP1oERLuqeY",
        popularVideo: "YP1oERLuqeY",
        popular2: "9h9Ys1ti8PI",
        popular3: "h-kMmQw5FQ0",
        latestLive: "",
        popularLive: "",
        gridExtra4: "LmJn9Gmpq-g",
      },
      "https://www.youtube.com/@ShonandaiWSS": {
        latestVideo: "dA7FSojZnCo",
        popularVideo: "dA7FSojZnCo",
        popular2: "ru_KM9w1GIE",
        popular3: "bd5UYGBoEBs",
        latestLive: "",
        popularLive: "",
        gridExtra4: "vGb5IsvrXbQ",
      },
      "https://www.youtube.com/@kgmb1952": {
        latestVideo: "S2xPhSiQ8Ls",
        popularVideo: "S2xPhSiQ8Ls",
        popular2: "_fv8gqR6FMY",
        popular3: "ri1K7s4cq9o",
        latestLive: "",
        popularLive: "",
        gridExtra4: "QUsjAXxonMs",
      },
      "https://www.youtube.com/@aotaka-TV": {
        latestVideo: "JhgyKp9rhh4",
        popularVideo: "JhgyKp9rhh4",
        popular2: "6YJ4WbFX-8E",
        popular3: "Mv2QKE87ek8",
        latestLive: "tqQVPePX7WI",
        popularLive: "tqQVPePX7WI",
        gridExtra4: "DBST-MK3oLs",
      },
      "https://youtube.com/channel/UCNnXTXxa3qpNR6tWSfJ4WlA?si=vhwefLDpFrR2qnxe": {
        latestVideo: "JshBoHdjAwk",
        popularVideo: "JshBoHdjAwk",
        popular2: "FYT5XXMbSnM",
        popular3: "dZigNOX9sds",
        latestLive: "",
        popularLive: "",
      },
      "https://www.youtube.com/@P-Regiment.Alumni": {
        latestVideo: "TbKA95P1y70",
        popularVideo: "TbKA95P1y70",
        popular2: "9JV3TWfU1sI",
        popular3: "dMh4dhgwEuM",
        latestLive: "",
        popularLive: "",
        gridExtra4: "J0_Ugul83vQ",
      },
      "https://www.youtube.com/@mercurywinds2651": {
        latestVideo: "vzYGnnISEKw",
        popularVideo: "OE85AHEFCYY",
        popular2: "IaBdAbAk3uc",
        popular3: "TzhNIBzjRJk",
        latestLive: "",
        popularLive: "",
        gridExtra4: "_MBlvGdfAJ0",
      },
      "https://www.youtube.com/@colorguardteamminerva5329": {
        latestVideo: "w8nMzNLrk6Y",
        popularVideo: "eoFRft2pEaY",
        popular2: "YPVPPnewwEk",
        popular3: "k6M8zCK3ViA",
        latestLive: "",
        popularLive: "",
        gridExtra4: "k6M8zCK3ViA",
      },
      "https://www.youtube.com/@Revoltcolorguard": {
        latestVideo: "IQxpDRjE-NE",
        popularVideo: "IQxpDRjE-NE",
        popular2: "W5OCs5rigJk",
        popular3: "vB4cRF2WftQ",
        latestLive: "W5OCs5rigJk",
        popularLive: "W5OCs5rigJk",
        gridExtra4: "S1aPAia3jvY",
      },
      "https://www.youtube.com/@ikalumni_2022": {
        latestVideo: "sXUDBOFOCVw",
        popularVideo: "sXUDBOFOCVw",
        popular2: "_1qnl2TBs20",
        popular3: "k54QTSmJyis",
        latestLive: "",
        popularLive: "",
        gridExtra4: "rZxr5D0wHaM",
      },
      "https://www.youtube.com/@viacolorguard7940": {
        latestVideo: "etz7gj7qJVQ",
        popularVideo: "etz7gj7qJVQ",
        popular2: "etz7gj7qJVQ",
        popular3: "MfIeHdURVZI",
        latestLive: "vmeJ3fyySws",
        popularLive: "vmeJ3fyySws",
        gridExtra4: "hqKYgm2YPhc",
      },
      "https://www.youtube.com/@viacolorguardjr": {
        latestVideo: "7pYTWatr__s",
        popularVideo: "7pYTWatr__s",
        popular2: "5zVLIM_PqcY",
        popular3: "l1zJ2XxWjqo",
        latestLive: "5zVLIM_PqcY",
        popularLive: "5zVLIM_PqcY",
        gridExtra4: "fBBGst2WQ0w",
      },
    };
    let latestDateByUrl = {
      "https://www.youtube.com/@marching-matsuri": "2026/3/31",
      "https://www.youtube.com/@DrumcorpsfunTV": "2026/3/18",
      "https://www.youtube.com/@allure_2022": "2025/10/18",
      "https://www.youtube.com/@derglanz6310": "2026/3/9",
      "https://www.youtube.com/@theyokohamascouts/videos": "2024/2/19",
      "https://www.youtube.com/@SRVanguardJP": "2025/11/30",
      "https://www.youtube.com/@AimachiMarchingBandOfficial": "2025/12/14",
      "https://www.youtube.com/@dreamscouts5848": "2024/4/5",
      "https://youtube.com/channel/UCBRNUdZOBQMPzotC_ROHCdg?si=kNyJolswxVBIj3to": "2026/3/24",
      "https://www.youtube.com/@zaurus2019": "2026/4/8",
      "https://www.youtube.com/@whitegalaxy2897": "2020/12/24",
      "https://www.youtube.com/@MarchingbandCourage": "2026/4/14",
      "https://www.youtube.com/@MarchingBandGENESIS": "2023/12/18",
      "https://www.youtube.com/@genetube2018": "2026/3/8",
      "https://www.youtube.com/@yokohamainspiresdrumbuglec9551": "2025/9/23",
      "https://www.youtube.com/@SatsukiDreamersOrg": "2025/12/31",
      "https://www.youtube.com/@SENDAIVerdures": "2026/3/31",
      "https://www.youtube.com/@ipu8028": "2026/4/19",
      "https://www.youtube.com/@tokyophoenixdrumbuglecorps773": "2024/12/29",
      "https://www.youtube.com/@soniclancers7729": "2025/6/16",
      "https://www.youtube.com/@LegendofANGELSPR": "2026/2/3",
      "https://www.youtube.com/@jokers_dbc": "2026/3/22",
      "https://www.youtube.com/@kyototachibana-SHSband": "2025/6/7",
      "https://youtube.com/channel/UCBeLVZz52RfizavumDvRiFA?si=OufqB30QHV482KjW": "2026/4/3",
      "https://www.youtube.com/@Gifushoband": "2025/12/12",
      "https://www.youtube.com/@OBBCchannel": "2025/12/22",
      "https://www.youtube.com/@RYOYO_wind-band": "2026/3/24",
      "https://www.youtube.com/@Yodogawa.t.h.s_band/videos": "2024/4/3",
      "https://www.youtube.com/@kwassui-chuko-brass": "2026/3/29",
      "https://www.youtube.com/@BurningBravers": "2026/3/28",
      "https://www.youtube.com/@AlbireoNova": "2025/5/12",
      "https://www.youtube.com/@ckgs_marchingband": "2025/9/7",
      "https://www.youtube.com/@ShonandaiWSS": "2025/12/12",
      "https://www.youtube.com/@kgmb1952": "2026/4/23",
      "https://www.youtube.com/@aotaka-TV": "2026/3/5",
      "https://youtube.com/channel/UCNnXTXxa3qpNR6tWSfJ4WlA?si=vhwefLDpFrR2qnxe": "2025/7/2",
      "https://www.youtube.com/@P-Regiment.Alumni": "2025/11/28",
      "https://www.youtube.com/@mercurywinds2651": "2026/5/4",
      "https://www.youtube.com/@colorguardteamminerva5329": "2025/5/19",
      "https://www.youtube.com/@Revoltcolorguard": "2026/2/2",
      "https://www.youtube.com/@ikalumni_2022": "2026/3/22",
      "https://www.youtube.com/@viacolorguard7940": "2025/7/11",
      "https://www.youtube.com/@viacolorguardjr": "2026/4/12",
    };
    let videoDateById = {
      zPrYC0efNLk: "2026/3/31",
      rnfB71T_PmA: "2026/4/26",
      "WToG-UGq5GY": "2026/3/9",
      "kMyJF4dZ-g8": "2026/3/28",
      "n17EPBV18-M": "2024/2/19",
      Z6k5j1VP5_s: "2025/11/30",
      hZNbTItbd4I: "2025/12/14",
      KOzMrnKMT4Y: "2025/6/8",
      jMikVRlXE0o: "2024/4/5",
      nDxMVsTvdrw: "2024/4/27",
      gXORjDZnq04: "2026/3/24",
      EzTtv0EHCjY: "2023/2/25",
      jdrSQdEK1pQ: "2025/6/7",
      FpnCNTURvqQ: "2026/4/3",
      v0i8LFKTzWM: "2025/12/12",
      "2YKde7XQhKI": "2025/12/22",
      yN3lIkgV9iY: "2024/10/22",
      _Qa0jJQUe6Y: "2026/3/24",
      "cM53weq-1w4": "2025/7/13",
      qtwsPEUi_K8: "2024/9/24",
      qYIJXG_XDUg: "2024/4/3",
      qrRESxrwHm8: "2024/3/26",
      "85z2E5MM6JA": "2024/2/22",
      oKRQSZkCSh4: "2024/2/9",
      bMYAfSOgvWs: "2024/12/29",
      _Zz4CX5yh10: "2024/12/29",
      YI3IkUwWuBE: "2024/4/12",
      UsyzwgUQ3ts: "2024/4/9",
      FtobkfJbzWw: "2025/6/16",
      S7CTHK_RPfE: "2025/5/12",
      lhi6QGcwMGo: "2025/5/12",
      Hp2GkWXT7qU: "2025/2/2",
      "8R1H14J8JIs": "2026/2/3",
      PW6SBgNSBk8: "2025/12/21",
      d1XVDUKH7dQ: "2025/5/13",
      "yQiUBTi-2Es": "2024/3/5",
      MQohaCSvaxg: "2026/3/22",
      I_2yXCbOekU: "2026/3/15",
      hBUWObLutRA: "2026/3/8",
      "oSP-SW-Up_M": "2025/12/28",
      yZwRoCpiu8Y: "2026/3/31",
      KkD1tRcnRqM: "2025/4/2",
      kkioMNNhleU: "2025/4/2",
      "-8cFp3h6bEw": "2011/2/27",
      nDIB2rczuUI: "2026/1/24",
      "76PgVGLDRao": "2026/1/23",
      r0bSWXCLxfM: "2026/1/22",
      N0PzX226Qwg: "2026/1/21",
      U5ds0IJZmLI: "2026/3/29",
      e4F5V2D4P8Y: "2026/3/28",
      JFbOekcHNYE: "2025/12/13",
      tRbc6Szj9mc: "2025/5/12",
      YP1oERLuqeY: "2025/9/7",
      dA7FSojZnCo: "2025/12/12",
      "8NqRfDfMfIo": "2020/10/11",
      GshxNMbDfGg: "2025/12/28",
      HGv6UUHRHtY: "2026/3/29",
      _gZMLqdQjXw: "2026/3/29",
      Rg0X_kWoYcE: "2024/3/28",
      "12wga6kwkAE": "2024/3/13",
      yk1dM0EVeIA: "2024/3/11",
      "3rgxCdI8M4E": "2026/3/8",
      "4-oSeinpKjI": "2026/2/2",
      "OkrDoYl0t-w": "2025/7/25",
      "6d5jjGv_Iyo": "2025/2/28",
      La34YKX4kEY: "2025/9/23",
      "sEX_Uj6-szI": "2025/4/13",
      gcdSqSGH3L8: "2025/3/25",
      O2eOh7RUuZM: "2024/9/29",
      R1L1HN8jYUg: "2026/2/22",
      SrHSVARVWY8: "2025/12/31",
      SOmsZEwktkY: "2024/12/31",
      _mXBbA7m1bw: "2026/2/23",
      JshBoHdjAwk: "2025/7/2",
      FYT5XXMbSnM: "2025/5/29",
      dZigNOX9sds: "2020/8/19",
      TbKA95P1y70: "2025/11/28",
      "9JV3TWfU1sI": "2025/11/28",
      dMh4dhgwEuM: "2025/11/28",
      J0_Ugul83vQ: "2025/11/28",
      "8-VsguPEbuU": "2025/5/19",
      w8nMzNLrk6Y: "2025/4/15",
      eoFRft2pEaY: "2022/3/11",
      YPVPPnewwEk: "2020/4/6",
      k6M8zCK3ViA: "2021/4/24",
      "IQxpDRjE-NE": "2026/2/2",
      W5OCs5rigJk: "2026/1/31",
      vB4cRF2WftQ: "2026/1/3",
      S1aPAia3jvY: "2025/12/31",
      sXUDBOFOCVw: "2026/3/22",
      _1qnl2TBs20: "2026/3/15",
      k54QTSmJyis: "2025/5/17",
      "lSm-i0pRZeA": "2026/4/14",
      peaKgHzPdqQ: "2026/4/8",
      "340Y4KapiS4": "2021/5/20",
      "3DeziGx2qqo": "2023/12/18",
      "4SbK2aCtAzA": "2026/4/12",
      "4xkLSJOZ87U": "2026/3/12",
      "5zVLIM_PqcY": "2026/4/5",
      "6WXGK3eEpek": "2020/8/1",
      "6YJ4WbFX-8E": "2025/12/8",
      "7pYTWatr__s": "2026/4/12",
      "9YEZC5wOQ0M": "2025/12/3",
      A9LC4uRTkck: "2026/3/31",
      "DBST-MK3oLs": "2025/8/15",
      IaBdAbAk3uc: "2026/3/28",
      JhgyKp9rhh4: "2026/3/5",
      KIpQ26ABDSY: "2023/5/31",
      KmKjzwZknjM: "2026/4/19",
      L_pT4ES0JWU: "2026/3/13",
      LonYKKy9nx8: "2023/2/1",
      MX2ZM2HRmCc: "2026/4/5",
      MfIeHdURVZI: "2025/5/28",
      Mv2QKE87ek8: "2025/8/24",
      vzYGnnISEKw: "2026/5/4",
      OE85AHEFCYY: "2026/4/25",
      QBCPXv_zxdc: "2026/3/29",
      QUsjAXxonMs: "2025/12/23",
      S2xPhSiQ8Ls: "2026/4/23",
      TzhNIBzjRJk: "2025/12/10",
      WFTu5moizog: "2026/3/31",
      _MBlvGdfAJ0: "2025/12/9",
      _fv8gqR6FMY: "2026/3/18",
      e18yN2ZaHq0: "2025/12/20",
      etz7gj7qJVQ: "2025/7/11",
      fBBGst2WQ0w: "2026/2/24",
      hqKYgm2YPhc: "2024/7/4",
      jLnXRrpljIU: "2026/3/17",
      ktSQPm8RrJU: "2026/3/18",
      "YQ_s52PCy-Q": "2025/10/18",
      nRwVpFd6gZE: "2025/4/18",
      "6Q7xBO8Nnjg": "2025/1/26",
      "2ESFmUgxMnc": "2025/1/11",
      l1zJ2XxWjqo: "2026/3/31",
      l8F9K17MAfA: "2020/12/24",
      pCevh31HDC8: "2023/5/16",
      r0y7EHWqnSs: "2020/8/22",
      ri1K7s4cq9o: "2026/2/27",
      sEevfI4VrGk: "2020/11/9",
      vmeJ3fyySws: "2026/3/14",
    };
    let videoTitleById = {
      "-8cFp3h6bEw": "Indigoes2011 Recruit",
      "0VWxLDWkbU0": "第59回 関東大会「銀翼〜空への挑戦〜」鵠沼高校マーチングバンド部AN2024",
      "12wga6kwkAE": "FMドリスカ　リスナー感謝祭　公開収録直前SP#2",
      "1T-rKGBlZ78": "【関西大会金賞!!】宇宙の音楽／京都両洋高校吹奏楽部",
      "2YKde7XQhKI": "2019 大濠高校 マーチング 【 UNBA∠ANCE 】Timpani Cam",
      "2k_Kj2G7zN0": "2023 Show Program “The Strides to HAPPINESS”",
      "3DeziGx2qqo": "【第51回全国大会】2023 show theme「@All」｜GENESIS【マーチング】",
      "3rgxCdI8M4E": "【本番直前】GENESIS LIVE2026ホールリハ",
      "4-oSeinpKjI": "【驚愕NEWS】マーチングバンドGENESISに疑惑？？",
      "4MozbWYxjgo": "京都橘高校吹奏楽部 台湾公演(マーチングステージ)",
      "4SbK2aCtAzA": "創志学園高校さんの入学式に出演させていただきました！",
      "4xkLSJOZ87U": "2025 DCJ ALL JAPAN CHAMPIONSHIPS 横浜市立太尾小学校マーチングバンド",
      "5XjWMRlbPKI": "農大二高：「台湾遠征：嘉義市役所前フラッシュモブ」",
      "5zVLIM_PqcY": "【Performance shot】Season4 Program  “アイデンティティ”",
      "6WXGK3eEpek": "2016年5月　台湾遠征",
      "6YJ4WbFX-8E": "青鷹2025 ”全国直前リハーサル”",
      "6d5jjGv_Iyo": "【ジュニアマーチングバンド Be-Lights】ドッキリ成立なるか！？～変装して潜入！〜",
      "6ovjQBRJ6t8": "Boston Crusaders 優勝 ! 愛町メンバーにインタビュー（伊藤ここね、佐野美和）",
      "6rHvPKeDa6g": "京都橘高校吹奏楽部 台湾西門町パレードｰダイジェスト",
      "7pYTWatr__s": "自主公演特別演目「カリスマックス」",
      "85z2E5MM6JA": "【淀工吹奏楽部】1000人の合同演奏 アルメニアンダンス・パートⅠ（2009）",
      "8NqRfDfMfIo": "湘南台高校WSS Promotion Video",
      "8R1H14J8JIs": "【ライティング】フィールドアート2026【マーチング】",
      "9JV3TWfU1sI": "10月18日　2025 DCJプレリムオープン　東京実業高等学校Phoenix Regiment",
      "9YEZC5wOQ0M": "SENDAI Verdures DCJ All Japan Championships 2025",
      "9h9Ys1ti8PI": "【GracefulSpirit2023】Snare cam 最後の審判 〜The Last Judgment〜 Chiba Keiai High School Marchingband",
      A9LC4uRTkck: "SENDAI Verdures トランペット二重奏「Super Duets(P.Sparke)」より抜粋",
      AWMQboR5slc: "2022 The Yokohama Scouts \" The Courage to Dream \"",
      "DBST-MK3oLs": "青鷹2025 \"影法師\"",
      "EW-cKOKVSuo": "Albireo Nova 3rd Concert",
      EzTtv0EHCjY: "【生配信!!】MIX3 関西奈良オープン NARAGAKU Marching Band",
      FA3b26ImHxY: "創部100周年コール",
      FYT5XXMbSnM: "[期間限定公開]第52回神戸まつり",
      FpnCNTURvqQ: "農大二高：「インフェルノ・トゥ・ヘブン」（第68回定期演奏会）",
      FtobkfJbzWw: "SONIC LANCERS ソニック ランサーズ | GUEST【PRIDE OF ESTEAM】 | SONIC LANERS HEAVEN 2024' My JAM!",
      "GI4Cg9kP-_E": "2019 大濠高校 パーカッションコンテスト",
      GshxNMbDfGg: "農大二高：「千と千尋の神隠し」（第68回定期演奏会）2025年12月28日",
      HGv6UUHRHtY: "【東海オープン】2026 MIX3™️ / スリークロス 東海オープン｜2026/3/29",
      Hp2GkWXT7qU: "SONIC LANCERS ソニック ランサーズ | 2024 show | BRAVEHEART",
      "IQxpDRjE-NE": "【カラーガード全国大会金賞】Revolt colorguard 2025\"Not Machines\"",
      IXA5utFNtaA: "ZAURUS CONCERT Vol.4 Pit Show \"Zaurus Pit 2025~Side by side~\"",
      I_2yXCbOekU: "Silent Drill / JOKERS 【2025 HCD】",
      IaBdAbAk3uc: "2025年度定期演奏会ダイジェスト",
      J0_Ugul83vQ: "11月16日　TOKYO GUNDAM festivl 東京実業高等学校Phoenix Regiment",
      JFbOekcHNYE: "全国大会本番映像！【ZODIAC】四條畷学園高等学校 マーチングバンド部 Burning Bravers",
      JhgyKp9rhh4: "「影法師」　｜青鷹2025 season",
      JshBoHdjAwk: "滝川第二高等学校吹奏楽部［オープンスクール2025］",
      KIpQ26ABDSY: "【マーチング】GENESIS collection｜GENESIS LIVE 2023【ステージドリル】",
      KLE9tyA74fU: "【マーチング】「Flowers for Algernon」フルショー【DER GLANZ】",
      KOzMrnKMT4Y: "【INSIDE Aimachi】EP.19 -2024 Finals-",
      KkD1tRcnRqM: "Istanbul Odyssey／Tokushima Indigoes 2023",
      KmKjzwZknjM: "ブラスのMM練習の模様をお届けします！",
      L_pT4ES0JWU: "2025 DCJ ALL JAPAN CHAMPIONSHIPS 横浜市立平安小学校マーチングバンド",
      La34YKX4kEY: "2025 Yokohama INSPIRES presents \"Viva Las Vegas!\"",
      "LmJn9Gmpq-g": "【GracefulSpirit2023】Promotion Video 最後の審判 〜The Last Judgment〜Chiba Keiai High School Marchingband",
      LonYKKy9nx8: "【マーチング】Tank! ｜演奏してみた【カウボーイビバップ】GENESIS",
      MQohaCSvaxg: "A Fool in The mirror | Hands on the Land / JOKERS 【2025 HCD】",
      MX2ZM2HRmCc: "今年もたくさんの新入生を迎えました！",
      MfIeHdURVZI: "Via Colorguard Season11 Program \"STYLE WARS\"",
      Mv2QKE87ek8: "『大洗八朔祭』",
      O2eOh7RUuZM: "Superhero",
      vzYGnnISEKw: "第74回 ザ よこはまパレード出演 ダイジェスト",
      OE85AHEFCYY: "第97回かながわ県中央地域メーデー 出演",
      "OkrDoYl0t-w": "GENESISのリアル新歓2025｜越谷レイクタウン！BBQで仲間と大笑い",
      PW6SBgNSBk8: "Legend of ANGELS 2025『ゲキカラ！』【マーチング】",
      Q69OQls69w4: "創価ルネサンスバンガード 2024 THEME TITLE",
      Q9596NMszjU: "農大二高：「クレヨンしんちゃん」（第68回定期演奏会）2025年12月28日",
      QBCPXv_zxdc: "ブラスの楽器動作の練習模様を公開！",
      QUsjAXxonMs: "【Inside KGMB】 vol.41「2025マーチングバンド全国大会前日練習」｜関東学院マーチングバンド",
      QcBFtjqiYkU: "活水中学校・高等学校吹奏楽部 2025年11月演奏ダイアリー📔",
      R1L1HN8jYUg: "【茨城県】17年振り快挙のウラ側！「Look at Me」&シーズン深掘り解説！【COURAGE LIVE】",
      Rg0X_kWoYcE: "”BigThree” -snare ensemble-【FMドリスカ リスナー感謝祭】",
      S1aPAia3jvY: "【2025年ありがとうございました！】リボラジ実写版！年末スペシャル",
      S2xPhSiQ8Ls: "【Inside KGMB】 vol.43「第68回定期演奏会 -part1-」演奏会直前リハーサル！｜関東学院マーチングバンド",
      S7CTHK_RPfE: "SONIC LANCERS ソニック ランサーズ | Bohemian Rhapsody  | SONIC LANERS HEAVEN 2024' My JAM!",
      SOmsZEwktkY: "【マーチング】[MB] 20241215 [JMBA National] KANUMA SATSUKI DREAMERS \"Raga -Landscapes of India-\" [Full]",
      SSCL72YoCdE: "【COURAGE】2025.11.9 関東大会「Look at Me~To the Stage of Dreams~」",
      SrHSVARVWY8: "【マーチング】[MB] 20251207 [JMBA National] KANUMA SATSUKI DREAMERS \"雨過天晴～芭蕉、おくのほそ道を往く～\" [Full]",
      SynVyzbifb0: "ZAURUS CONCERT Vol.4 Battery Show Dramatic Drummer",
      TbKA95P1y70: "東京都大会　東京実業高等学校Phoenix Regiment",
      TzhNIBzjRJk: "【Mix】2025「The Last Night of Saigon」全国大会出場動画",
      U5ds0IJZmLI: "活水中学校・高等学校吹奏楽部 2026年3月演奏ダイアリー📔",
      UsyzwgUQ3ts: "2021 TP monochrome",
      VXZWoKcmMZ0: "『アニソン』Hit Parade 四條畷学園高等学校マーチングバンド部 Burning Bravers 第38回定期演奏会 WING CONCERT 2026",
      W5OCs5rigJk: "【代表同士のぶっちゃけトーク！】リボラジ！第25回　ゲストVia Colorguard代表 TUNA.",
      WFTu5moizog: "SENDAI Verdures 金管七重奏「マンモス･ケーブの軌跡」",
      "WToG-UGq5GY": "【ダイジェスト🎥】260222DER_GLANZコンサート",
      YI3IkUwWuBE: "2020 TP Emotions ablaze",
      YP1oERLuqeY: "S.P.Y ～Secret party of yokefellow～ Full Show multi cam 【Graceful Spirit 2024】",
      Z6k5j1VP5_s: "創価ルネサンスバンガード 2025 THEME TITLE",
      _1qnl2TBs20: "COLOR 予告動画",
      _MBlvGdfAJ0: "【Full shot】2025「The Last Night of Saigon」全国大会出場動画",
      _Qa0jJQUe6Y: "響け！ユーフォニアムの聖地で「プロヴァンスの風」を演奏してみた！",
      _Zz4CX5yh10: "2024 TP わらべうた",
      _fv8gqR6FMY: "【Inside KGMB】 vol.42「マーチングステージ全国大会&定期演奏会に向けて」｜関東学院マーチングバンド",
      _gZMLqdQjXw: "【Via Jr.  〜チームZoo〜】2026スリークロス Div.1 FINAL【Director's Cut】",
      aAFuaVPafUA: "創価ルネサンスバンガード 2023メインショー「粋・HOKUSAI〜一筆に込めた不屈の志(こころ)〜」",
      alfvvj4PgOQ: "【NGM-log】 NARAGAKU Live 2026 Behind vlog",
      bHsTHVkOAKQ: "【日本舞踊×マーチング】煌めく京の姫物語／京都両洋高校吹奏楽部",
      bMYAfSOgvWs: "2023 TP green leaves",
      bd5UYGBoEBs: "湘南台高校WSS 2023 \"Chameleon Patrol\" JMBA The 51st National Championship",
      "cM53weq-1w4": "ルイブルジョアの讃美歌による変奏曲／京都両洋高校吹奏楽部",
      cyMvNGDcRLQ: "【緊急告知!!】NARAGAKU Live 2026 開催！！",
      d1XVDUKH7dQ: "Legend of ANGELS 2024 『Electricity』【マーチング】",
      dA7FSojZnCo: "湘南台高校WSS 2025 \"CoMiX\" JMBA The 53rd National Championship",
      "dJ7c6-Wzed4": "2025_DER_GLANZコンサート ２部",
      dMh4dhgwEuM: "2025/11/09 関東大会　東京実業高等学校Phoenix Regiment",
      dZigNOX9sds: "YouTubeで見る",
      d_nCThWwKj4: "創価ルネサンスバンガード 2022 メインショー「UNLOCK〜新たな光に向かって〜」",
      e18yN2ZaHq0: "SENDAI Verdures 2025年度全国大会「”V”lizzard」",
      e4F5V2D4P8Y: "【Relic】四條畷学園高等学校マーチングバンド部 Burning Bravers　第38回定期演奏会 WING CONCERT 2026",
      e8qKX0dX8BQ: "エールズご支援に感謝【全員で御礼篇】",
      etz7gj7qJVQ: "\"STYLE WARS\" Outtake",
      fBBGst2WQ0w: "Via Colorguard Jr. のライブ配信",
      faU99xUKxJQ: "マーチング祭 湘南藤沢「銀翼〜空への挑戦〜」鵠沼高校マーチングバンド部AN2024",
      gXORjDZnq04: "NARAGAKU Marching Band 2025『EN GARDE〜覚悟を決めろ〜』【4K】",
      gcdSqSGH3L8: "INSPIRIT～Superhero～",
      "h-kMmQw5FQ0": "【GracefulSpirit2023】Fullshot＋Tenor Cam 最後の審判〜The Last Judgment〜Chiba Keiai High School Marchingband",
      hBUWObLutRA: "Carnival Night / JOKERS 【2025 HCD】",
      hF2Dx4mRb3k: "Aimachi Drumline 2024 Warmup",
      hZNbTItbd4I: "愛町マーチングバンド2025 『中心 〜JOURNEY TO THE CORE〜』",
      hqKYgm2YPhc: "Via Colorguard Season10 Program \"Press start\"",
      jLnXRrpljIU: "2025 DCJ ALL JAPAN CHAMPIONSHIPS 横浜市立西谷中学校マーチングバンド部 Splash Hearts",
      jMikVRlXE0o: "Color Guard【パート紹介】",
      jdrSQdEK1pQ: "京都橘高校吹奏楽部第61回定期演奏会 メイキング映像",
      "k-QcvPLxoGQ": "京都橘高校吹奏楽部第60回定期演奏会 メイキング映像",
      k54QTSmJyis: "HP　訂正",
      "kMyJF4dZ-g8": "【ライブ】2026 MIX3™️ / スリークロス山形OPEN｜2026/3/29【マーチング】",
      kkioMNNhleU: "Tango Nuevo Astor Piazzolla／Tokushima Indigoes 2024",
      kn4ohkuEhZY: "【Red Warriors】四條畷学園高等学校マーチングバンド部 Burning Bravers　第38回定期演奏会 WING CONCERT 2026",
      ktSQPm8RrJU: "2025 DCJ ALL JAPAN CHAMPIONSHIPS FUKUOKA DreamScouts performance corps",
      l1zJ2XxWjqo: "【Full shot】Season4 Program “アイデンティティ” 〜full shot〜",
      l8F9K17MAfA: "2020 WHITE GALAXY クリスマスメドレー【マーチングブラス＆パーカッション演奏】",
      "lSm-i0pRZeA": "MARCHING BAND COURAGE 2025 Sideshow【MOMENTUM】",
      lhi6QGcwMGo: "SONIC LANCERS ソニック ランサーズ | Malagueña | SONIC LANERS HEAVEN 2024' My JAM!",
      "n17EPBV18-M": "2024 Concert \" Bonne Bouche de HAPPINESS \"",
      nDIB2rczuUI: "Phoenix Regiment 2026/01/25Crowdfunding Start.#マーチングバンド #drumcorps #fyp",
      nDIDSipebTY: "【COURAGE】2025.12.7 マーチングバンド全国大会 ※再アップ",
      nDxMVsTvdrw: "FUKUOKA DreamScouts performance corp 2024season メンバー募集‼️",
      nGriCxIbOOI: "第25回サマーコンサート コバにゃん☆さんのキャッチ挨拶パロディ",
      oKRQSZkCSh4: "【淀工吹奏楽部】歌劇「アイーダ」第二幕より 凱旋行進曲とバレエ音楽（2022）",
      "oSP-SW-Up_M": "～IWATO～ / JOKERS 【2025 Main Show】 WMP",
      pCevh31HDC8: "【マーチング】12+（Twelve Plus）｜GENESIS LIVE 2023【ステージドリル】marching band GENESIS",
      peaKgHzPdqQ: "Zaurus Award 2025 授与式",
      "qOboab-c8ak": "活水中学校・高等学校吹奏楽部 2025年12月演奏ダイアリー📔",
      qYIJXG_XDUg: "【淀工OB吹奏楽団】アメリカングラフィティーXV（2017）",
      qqf5VixBnlU: "ZAURUS CONCERT Vol.4 Brass  Ensemble \"There A Great Day Coming\"",
      qrRESxrwHm8: "【淀工吹奏楽部】コンサートマーチ Number1（2017）",
      qtwsPEUi_K8: "【祝全国!!!!】Milky Way〜天の川の伝説／京都両洋高校吹奏楽部",
      r0y7EHWqnSs: "2018年7月 天津遠征",
      ri1K7s4cq9o: "【関東学院マーチングバンド】第68回定期演奏会 PV",
      rnfB71T_PmA: "【関西CS】2026 MIX3™️ / スリークロス 関西CS｜2026/4/26",
      ru_KM9w1GIE: "湘南台高校WSS 2024 \"WAVES\" JMBA The 52nd National Championship",
      "sEX_Uj6-szI": "INSPIRIT〜Superhero〜　Opener",
      sEevfI4VrGk: "香水",
      sXUDBOFOCVw: "COLOR / IK ALUMNI CGT 2026",
      tRbc6Szj9mc: "大和市民祭2025「QUGE ROCK」鵠沼高校マーチングバンド部AN",
      uJYRxkAByl0: "2025_DER_GLANZコンサート １部",
      uWwCquBqEbo: "2019 大濠高校 カラーガードコンテスト",
      v0i8LFKTzWM: "JUNGLIA  / GIFUSHO BAND MARCHING SHOW 2025",
      vB4cRF2WftQ: "【17年ぶりの全国出場・金賞！茨城県の古豪クレージュさんの2025年シーズンは！？】リボラジ第24回",
      vmeJ3fyySws: "Via Colorguard Via Colorguard Jr. 合同自主公演ライブ配信",
      w8nMzNLrk6Y: "【カラーガード】YOASOBI \"ラブレター / LOVE LETTER\"  | Color Guard Team MINERVA",
      eoFRft2pEaY: "【カラーガード】\"あいとわ - Pray for 3.11 Version\"  | Color Guard Team MINERVA",
      YPVPPnewwEk: "WGI Japan 2020 3rd place 「Worth Standing Up For」Color Guard Team MINERVA",
      k6M8zCK3ViA: "【カラーガード】MINERVA×VOXV \"CURTAIN CALL\"  | Color Guard Team MINERVA",
      wn0g6TjLDZI: "2025 大濠高校 パレードコンテスト 【 大濠電車でGO！ 】",
      yN3lIkgV9iY: "2024 大濠高校 マーチング  【パイレーツ・オブ・ホリビアン】",
      "yQiUBTi-2Es": "【パーカッション】Unbreakable Diamond【マーチング】",
      yZwRoCpiu8Y: "Fiesta!Fiesta!!Fiesta!!!／Tokushima Indigoes Drum&Bugle Corps 2025",
      y_8vhNwOCaw: "活水中学校・高等学校吹奏楽部 2026年2月演奏ダイアリー📔",
      "yjZRBWu-wVI": "2023 POWER & PASSION",
      yk1dM0EVeIA: "FMドリスカ　リスナー感謝祭　公開収録直前SP#1",
      zPrYC0efNLk: "【綾北“Mercury winds” 】2026スリークロス Div.1 FINAL【Director's Cut】",
      "YQ_s52PCy-Q": "【Marchig Matsuri Shonan Fujisawa Open 2025 Intermission】allure×Instant corps #marchingmatsuri #マーチング",
      nRwVpFd6gZE: 'allure2025 mix3 show program "Я I И N Ǝ" ~ 巡る輪廻と運命の導き~',
      "6Q7xBO8Nnjg": "allure 2024 Echo of the Soul ~共鳴の旋律~ Last Music Run-through #マーチング #allure2024",
      "2ESFmUgxMnc": "allure 2024 Echo of the Soul ~共鳴の旋律~ MarchingMatsuri Yokohama Final 12.28 MULTI-CAM｜FINAL ROUND",
      "6-JYneJC6fQ": "【カラーガード】振り付け集 Aimer - ONE | #shorts #カラーガード #マーチング #colorguard #marchingband",
      "73bjO5p08L8": "史上初！２本同時投げ",
      "8-VsguPEbuU": "【カラーガード】MINERVAフラッグトス集#2 | Flag Toss & Tricks #Shorts #カラーガード #マーチング",
      BQG9ufw7faQ: "二刀流 ③",
      amcpfT6L2Uo: "【カラーガード】振り付け集 official髭男dism-ミックスナッツ part 2 | #shorts #カラーガード #マーチング #colorguard #marchingband",
      hhTUgYQAGQ0: "boom rifle",
      m7yBzuQOA04: "MINERVAライフルトス集#17 セイバー×ライフルコンビネーション  | #shorts #カラーガード #マーチング #colorguard #marchingband",
      xQ6GHfHdMag: "二刀流 ②",
    };

    const normalizeYoutubeChannelUrl = (url) => {
      const raw = String(url || "").trim();
      if (!raw) return "";
      try {
        const u = new URL(raw);
        u.hash = "";
        u.search = "";
        let p = u.pathname.replace(/\/+$/, "");
        if (/\/videos$/i.test(p)) p = p.replace(/\/videos$/i, "");
        if (/\/streams$/i.test(p)) p = p.replace(/\/streams$/i, "");
        u.pathname = p || "/";
        return u.toString().replace(/\/$/, "");
      } catch {
        return raw.replace(/[?#].*$/, "").replace(/\/$/, "");
      }
    };

    /* ★ TOPの「YouTube 新着」(marchinz-top-highlights.js)が名簿のカテゴリで
       出し分ける(海外は最後に1枠だけ・2026-08-06 優さん指示)ための窓口。
       カテゴリの正本はこの channels 1つ ─ 表を外に複製しない。
       ここは最初の await より手前なので、後続の defer スクリプトが
       実行される時点で必ず窓口が立っている */
    const publishYtCategoryLookup = () => {
      const map = {};
      channels.forEach((c) => { map[normalizeYoutubeChannelUrl(c.url)] = c.category || "一般"; });
      window.__MZ_YT_CATEGORY_OF = (url) => map[normalizeYoutubeChannelUrl(url)] || "";
    };
    publishYtCategoryLookup();

    const extractVideoIdFromYoutubeUrl = (url) => {
      const raw = String(url || "").trim();
      if (!raw) return "";
      try {
        const u = new URL(raw);
        const host = u.hostname.replace(/^www\./i, "").toLowerCase();
        if (host === "youtu.be") {
          return u.pathname.replace(/^\//, "").slice(0, 11);
        }
        if (host.includes("youtube.com")) {
          const v = u.searchParams.get("v");
          if (v) return v.slice(0, 11);
          const parts = u.pathname.split("/").filter(Boolean);
          if (parts[0] === "live" && parts[1]) return parts[1].slice(0, 11);
          if ((parts[0] === "watch" || parts[0] === "shorts") && parts[1]) return parts[1].slice(0, 11);
        }
      } catch {}
      return "";
    };

    const parseCsvText = (text) => {
      const rows = [];
      let row = [];
      let cell = "";
      let q = false;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (q) {
          if (ch === '"') {
            if (text[i + 1] === '"') {
              cell += '"';
              i += 1;
            } else {
              q = false;
            }
          } else {
            cell += ch;
          }
          continue;
        }
        if (ch === '"') {
          q = true;
        } else if (ch === ',') {
          row.push(cell);
          cell = "";
        } else if (ch === "\n") {
          row.push(cell);
          if (row.some((x) => String(x || "").trim() !== "")) rows.push(row);
          row = [];
          cell = "";
        } else if (ch !== "\r") {
          cell += ch;
        }
      }
      if (cell.length || row.length) {
        row.push(cell);
        if (row.some((x) => String(x || "").trim() !== "")) rows.push(row);
      }
      if (!rows.length) return [];
      const head = rows[0].map((h) => String(h || "").trim());
      return rows.slice(1).map((r) => {
        const o = {};
        head.forEach((k, idx) => {
          o[k] = String(r[idx] || "").trim();
        });
        return o;
      });
    };

    const normalizeDateToSlash = (raw) => {
      const t = String(raw || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.replace(/-/g, "/");
      if (/^\d{4}\/\d{2}\/\d{2}$/.test(t)) return t;
      return "";
    };

    const applyYoutubeCsvRows = (rows) => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      const existingCategoryByUrl = new Map(
        channels.map((c) => [normalizeYoutubeChannelUrl(c.url), c.category || "一般"]),
      );

      const newChannels = [];
      const newVideoMetaByUrl = {};
      const newLatestDateByUrl = { ...latestDateByUrl };
      const newVideoDateById = { ...videoDateById };
      const newVideoTitleById = { ...videoTitleById };

      for (const r of rows) {
        const url = normalizeYoutubeChannelUrl(r["チャンネルURL"] || r["チャンネルUrl"] || r["チャンネルurl"]);
        if (!url) continue;
        const name = String(r["チャンネル名"] || "").trim() || url;
        const logo = String(r["ロゴ画像URL"] || "").trim();
        const latestVideoUrl = String(r["最新動画URL"] || "").trim();
        const latestVideoTitle = String(r["最新動画タイトル"] || "").trim();
        const latestVideoDate = normalizeDateToSlash(r["最新動画配信日"] || "");
        const v1Url = String(r["動画視聴回数1位URL"] || "").trim();
        const v1Title = String(r["動画視聴回数1位タイトル"] || "").trim();
        const v2Url = String(r["動画視聴回数2位URL"] || "").trim();
        const v2Title = String(r["動画視聴回数2位タイトル"] || "").trim();
        const v3Url = String(r["動画視聴回数3位URL"] || "").trim();
        const v3Title = String(r["動画視聴回数3位タイトル"] || "").trim();
        const v4Url = String(r["動画視聴回数4位URL"] || "").trim();
        const v4Title = String(r["動画視聴回数4位タイトル"] || "").trim();
        const latestLiveUrl = String(r["最新LIVE URL"] || "").trim();
        const latestLiveTitle = String(r["最新LIVEタイトル"] || "").trim();
        const latestLiveDate = normalizeDateToSlash(r["最新LIVE配信日"] || "");
        const l1Url = String(r["LIVE視聴回数1位URL"] || "").trim();
        const l1Title = String(r["LIVE視聴回数1位タイトル"] || "").trim();
        const l2Url = String(r["LIVE視聴回数2位URL"] || "").trim();
        const l2Title = String(r["LIVE視聴回数2位タイトル"] || "").trim();
        const l3Url = String(r["LIVE視聴回数3位URL"] || "").trim();
        const l3Title = String(r["LIVE視聴回数3位タイトル"] || "").trim();
        const l4Url = String(r["LIVE視聴回数4位URL"] || "").trim();
        const l4Title = String(r["LIVE視聴回数4位タイトル"] || "").trim();

        const latestVideo = extractVideoIdFromYoutubeUrl(latestVideoUrl);
        const popularVideo = extractVideoIdFromYoutubeUrl(v1Url);
        const popular2 = extractVideoIdFromYoutubeUrl(v2Url);
        const popular3 = extractVideoIdFromYoutubeUrl(v3Url);
        const latestLive = extractVideoIdFromYoutubeUrl(latestLiveUrl);
        const popularLive = extractVideoIdFromYoutubeUrl(l1Url);
        const gridExtra4 = extractVideoIdFromYoutubeUrl(v4Url);
        const live2 = extractVideoIdFromYoutubeUrl(l2Url);
        const live3 = extractVideoIdFromYoutubeUrl(l3Url);
        const live4 = extractVideoIdFromYoutubeUrl(l4Url);

        const thumbs = [latestVideo, popularVideo, popular2, popular3]
          .filter(Boolean)
          .map((id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);

        newChannels.push({
          name,
          url,
          category: existingCategoryByUrl.get(url) || "一般",
          logo,
          thumbnails: thumbs,
        });

        newVideoMetaByUrl[url] = {
          latestVideo,
          popularVideo,
          popular2,
          popular3,
          latestLive,
          popularLive,
          gridExtra4,
          live2,
          live3,
          live4,
        };

        if (!newLatestDateByUrl[url]) newLatestDateByUrl[url] = "----/--/--";
        const lvDateNum = dateToNumber(latestVideoDate);
        const llDateNum = dateToNumber(latestLiveDate);
        if (llDateNum > lvDateNum && latestLiveDate) newLatestDateByUrl[url] = latestLiveDate;
        else if (latestVideoDate) newLatestDateByUrl[url] = latestVideoDate;
        else if (latestLiveDate) newLatestDateByUrl[url] = latestLiveDate;

        const titlePairs = [
          [latestVideo, latestVideoTitle],
          [extractVideoIdFromYoutubeUrl(v1Url), v1Title],
          [extractVideoIdFromYoutubeUrl(v2Url), v2Title],
          [extractVideoIdFromYoutubeUrl(v3Url), v3Title],
          [extractVideoIdFromYoutubeUrl(v4Url), v4Title],
          [latestLive, latestLiveTitle],
          [extractVideoIdFromYoutubeUrl(l1Url), l1Title],
          [extractVideoIdFromYoutubeUrl(l2Url), l2Title],
          [extractVideoIdFromYoutubeUrl(l3Url), l3Title],
          [extractVideoIdFromYoutubeUrl(l4Url), l4Title],
        ];
        for (const [id, title] of titlePairs) {
          if (id && title) newVideoTitleById[id] = title;
        }
        if (latestVideo && latestVideoDate) newVideoDateById[latestVideo] = latestVideoDate;
        if (latestLive && latestLiveDate) newVideoDateById[latestLive] = latestLiveDate;
      }

      if (newChannels.length) {
        channels = newChannels;
        videoMetaByUrl = newVideoMetaByUrl;
        latestDateByUrl = newLatestDateByUrl;
        videoDateById = newVideoDateById;
        videoTitleById = newVideoTitleById;
        publishYtCategoryLookup();   // 名簿が入れ替わったら窓口も追随(mz:data-refreshed 経由)
      }
    };

    try {
      const inlineRows = window.__YOUTUBE_LIST_ROWS;
      if (Array.isArray(inlineRows) && inlineRows.length) {
        applyYoutubeCsvRows(inlineRows);
      } else {
        const csvCandidates = [
          "youtube-list/YouTubeリスト.csv",
          "youtube-list/" + encodeURIComponent("YouTubeリスト.csv"),
        ];
        let csvText = "";
        for (const u of csvCandidates) {
          try {
            const res = await fetch(u, { cache: "no-store" });
            if (!res.ok) continue;
            csvText = await res.text();
            if (csvText && csvText.trim()) break;
          } catch {
            // next candidate
          }
        }
        if (csvText) {
          const rows = parseCsvText(csvText);
          applyYoutubeCsvRows(rows);
        }
      }
    } catch {
      // fallback to embedded defaults
    }

    let channelsWithOrder = channels.map((item, idx) => ({ ...item, _order: idx }));

    /* データのみのpushはNetlifyがビルドしない(netlify.toml ignore)。
       marchinz-data-refresh.js が実行時に最新inlineを取得してグローバルを
       上書きするが、このページは初期化時に一度読むだけだったので、
       botの更新が次のコード修正のデプロイまで画面に出なかった
       (2026-07-22 IK ALUMNI CGT の空白カードで発覚)。
       更新イベントで名簿を読み直し、その場で描き直す */
    document.addEventListener("mz:data-refreshed", () => {
      const fresh = window.__YOUTUBE_LIST_ROWS;
      if (!Array.isArray(fresh) || !fresh.length) return;
      try {
        applyYoutubeCsvRows(fresh);
        channelsWithOrder = channels.map((item, idx) => ({ ...item, _order: idx }));
        renderYoutubeCards();
      } catch (e) {
        console.warn("[youtube-list] refresh再描画に失敗:", e);
      }
    });

    let currentCategory = "all";
    let currentSort = "new";
    let visibleCount = 5;
    let youtubeChannelSearch = "";
    let currentFiltered = [];
    const debugYoutube = new URLSearchParams(location.search).get("debugYoutube") === "1";
    const oembedTitleCache = {};
    const shortVideoIds = new Set([
      "1vzROqah3-0",
      "73bjO5p08L8",
      "76PgVGLDRao",
      "AfwcTSnSxuk",
      "BQG9ufw7faQ",
      "JuuXvTSwDpM",
      "K76XKdwEw1o",
      "N0PzX226Qwg",
      "OnqFsXU7yFk",
      "bBFZDmAlDwc",
      "bBdjgA0zuN0",
      "dBmuzpEzwVg",
      "hhTUgYQAGQ0",
      "jxSCJYn8eAc",
      "nDIB2rczuUI",
      "nDxMVsTvdrw",
      "q82mWmwNP5Q",
      "r0bSWXCLxfM",
      "xQ6GHfHdMag",
    ]);

    function buildYoutubeFourThumbIds(meta, fallbackIds, options = {}) {
      const allowShortFallback = options.allowShortFallback === true;
      const v = (x) => String(x || "").trim();
      const isAllowedId = (id) => {
        const vv = v(id);
        return vv && !shortVideoIds.has(vv);
      };
      const isAnyVideoId = (id) => Boolean(v(id));
      const f = (fallbackIds || []).map(v).filter(isAllowedId);
      const fAny = (fallbackIds || []).map(v).filter(isAnyVideoId);
      // 4枠の優先順位（重複除外・ショート除外）。
      // 1. 最新動画 2. 最新LIVE 3. 動画視聴回数1位 4. LIVE視聴回数1位
      // 5. 動画視聴回数2位 6. 動画視聴回数3位 7. 動画視聴回数4位
      // 8. LIVE視聴回数2位 9. LIVE視聴回数3位 10. LIVE視聴回数4位
      {
        const priorityThumbIds = [
          v(meta.latestVideo),
          v(meta.latestLive),
          v(meta.popularVideo),
          v(meta.popularLive),
          v(meta.popular2),
          v(meta.popular3),
          v(meta.gridExtra4),
          v(meta.live2),
          v(meta.live3),
          v(meta.live4),
        ];
        const outThumbIds = [];
        const usedThumb = new Set();
        const push = (id, allowShort) => {
          if (outThumbIds.length >= 4) return;
          const vv = v(id);
          if (!vv || usedThumb.has(vv)) return;
          if (!allowShort && shortVideoIds.has(vv)) return;
          usedThumb.add(vv);
          outThumbIds.push(vv);
        };
        for (const id of priorityThumbIds) push(id, false);
        for (const id of f) push(id, false);
        if (allowShortFallback && outThumbIds.length < 4) {
          for (const id of priorityThumbIds.concat(fAny)) push(id, true);
        }
        return outThumbIds.slice(0, 4);
      }
      const g4 = v(meta.gridExtra4);
      if (g4 && !f.includes(g4)) f.push(g4);
      /** 3–4 枠目: 人気系 → サムネ(f) → gridExtra4 相当 → 念のため latest/live。重複除き・上から順。 */
      const orderedUniquePool = (() => {
        const uq = [];
        const s = new Set();
        for (const id of [
          v(meta.popularVideo),
          v(meta.popular2),
          v(meta.popular3),
          v(meta.popularLive),
          ...f,
          g4,
          v(meta.latestVideo),
          v(meta.latestLive),
        ]) {
          if (!isAllowedId(id) || s.has(id)) continue;
          s.add(id);
          uq.push(id);
        }
        return uq;
      })();
      const s1 = v(meta.latestVideo) || f[0] || "";
      const used = new Set();
      if (s1) used.add(s1);
      const live = v(meta.latestLive);
      const popFiller = (exclude) => {
        for (const id of [v(meta.popularVideo), v(meta.popular2), v(meta.popular3), ...f]) {
          if (isAllowedId(id) && !exclude.has(id)) return id;
        }
        return "";
      };
      let s2 = "";
      if (live) {
        s2 = live && !used.has(live) ? live : popFiller(used);
        if (s2) used.add(s2);
      } else {
        s2 = popFiller(used);
        if (s2) used.add(s2);
      }
      const out = [];
      if (s1) out.push(s1);
      if (s2) out.push(s2);
      for (const id of orderedUniquePool) {
        if (out.length >= 4) break;
        if (!isAllowedId(id) || used.has(id)) continue;
        used.add(id);
        out.push(id);
      }
      if (out.length < 4) {
        const lastBag = [
          g4,
          v(meta.popular3),
          v(meta.popular2),
          v(meta.popularVideo),
          ...f,
        ];
        for (const id of lastBag) {
          if (out.length >= 4) break;
          if (!isAllowedId(id) || used.has(id)) continue;
          used.add(id);
          out.push(id);
        }
      }
      // すべてのカテゴリで Shorts は対象外。
      if (allowShortFallback && out.length < 4) {
        const fillBag = [
          v(meta.gridExtra4),
          v(meta.popular3),
          v(meta.popular2),
          v(meta.popularVideo),
          v(meta.popularLive),
          v(meta.latestVideo),
          v(meta.latestLive),
          ...fAny,
        ];
        for (const id of fillBag) {
          const vv = v(id);
          if (out.length >= 4) break;
          if (!vv || used.has(vv)) continue;
          used.add(vv);
          out.push(vv);
        }
      }
      return out.slice(0, 4);
    }

    function buildThumbBadgeMap(meta) {
      const v = (x) => String(x || "").trim();
      const order = [
        v(meta.latestVideo),
        v(meta.latestLive),
        v(meta.popularVideo),
        v(meta.popularLive),
        v(meta.popular2),
        v(meta.popular3),
        v(meta.gridExtra4),
        v(meta.live2),
        v(meta.live3),
        v(meta.live4),
      ];
      const labels = ["NEW", "TOP1", "TOP2", "TOP3"];
      const m = new Map();
      for (const id of order) {
        if (!id || m.has(id)) continue;
        if (m.size >= labels.length) break;
        const idx = m.size;
        m.set(id, { id, label: labels[idx], rank: idx });
      }
      return m;
    }

    function fetchOembedTitle(id) {
      const v = String(id || "").trim();
      if (!v) return Promise.resolve("YouTubeで見る");
      if (videoTitleById[v]) return Promise.resolve(videoTitleById[v]);
      return Promise.resolve("YouTubeで見る");
    }

    function backfillOembedThumbTitlesIn(container) {
      if (!container) return;
      container.querySelectorAll(".youtube-thumb-item[data-yt-vid]").forEach((wrap) => {
        const id = wrap.getAttribute("data-yt-vid");
        const tEl = wrap.querySelector(".youtube-thumb-title");
        if (!id || !tEl) return;
        if (videoTitleById[id]) {
          tEl.textContent = videoTitleById[id];
          return;
        }
        tEl.textContent = "YouTubeで見る";
      });
    }

    function toHighResLogo(url) {
      return String(url || "").replace(/=s\d+-/, "=s176-");
    }

    function dateToNumber(dateStr) {
      const m = String(dateStr || "").match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (!m) return 0;
      return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
    }

    function channelUpdateDateString(url, item) {
      const m = item ? resolvedMetaFor(item) : videoMetaByUrl[url] || {};
      const dV0 = dateToNumber(videoDateById[m.latestVideo] || "");
      const dL0 = dateToNumber(videoDateById[m.latestLive] || "");
      const strV0 = String(videoDateById[m.latestVideo] || "").trim();
      const strL0 = String(videoDateById[m.latestLive] || "").trim();
      if (dL0 > dV0 && strL0) return strL0;
      if (dV0 >= dL0 && strV0) return strV0;
      if (strL0) return strL0;
      if (strV0) return strV0;
      if (item) {
        const fallbackDate = fallbackThumbIdsFor(item)
          .map((id) => String(videoDateById[id] || "").trim())
          .find(Boolean);
        if (fallbackDate) return fallbackDate;
      }
      return latestDateByUrl[url] || "----/--/--";
    }

    function fallbackThumbIdsFor(item) {
      return (item?.thumbnails || [])
        .map((src) => {
          const m = String(src).match(/\/vi\/([A-Za-z0-9_-]{11})\//);
          return m ? m[1] : "";
        })
        .filter(Boolean);
    }

    function resolvedMetaFor(item) {
      const m = { ...(videoMetaByUrl[item.url] || {}) };
      if (!String(m.latestVideo || "").trim()) {
        const fallbackIds = fallbackThumbIdsFor(item);
        if (fallbackIds.length) {
          m.latestVideo = fallbackIds[0];
        }
      }
      return m;
    }

    function buildPublishedListSections(ch) {
      const order = ["大会", "マーチング配信", "一般", "高校", "中学生以下", "カラーガード", "海外"];
      const frag = document.createDocumentFragment();
      order.forEach((cat) => {
        const items = ch
          .filter((c) => c.category === cat)
          .sort((a, b) =>
            typeof MarchinZSort !== "undefined" && MarchinZSort && MarchinZSort.compare
              ? MarchinZSort.compare(a.name, b.name)
              : a.name.localeCompare(b.name, "ja")
          );
        if (!items.length) return;
        const h4 = document.createElement("h4");
        h4.className = "youtube-published-list-cat";
        h4.textContent = cat;
        frag.appendChild(h4);
        const ul = document.createElement("ul");
        ul.className = "youtube-published-list-ul";
        items.forEach((it) => {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = it.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = it.name;
          li.appendChild(a);
          ul.appendChild(li);
        });
        frag.appendChild(ul);
      });
      return frag;
    }

    /** styles.css の YouTube グリッド幅と大会動画一覧（app.js getVideoResultGridColumnCount）と一致 */
    function getYoutubeGridColumnCount() {
      try {
        if (window.matchMedia("(min-width: 1200px)").matches) return 3;
        if (window.matchMedia("(min-width: 900px)").matches) return 2;
      } catch {
        //
      }
      return 1;
    }

    /**
     * @param {{ rootTag?: "li" | "div" }} [options]
     */
    function buildYoutubeCard(item, options = {}) {
      const rootTag = options.rootTag === "div" ? "div" : "li";
      const root = document.createElement(rootTag);
      root.className = "youtube-card";
      const head = document.createElement("div");
      head.className = "youtube-card-head";
      const logoLink = document.createElement("a");
      logoLink.href = item.url;
      logoLink.target = "_blank";
      logoLink.rel = "noopener noreferrer";
      logoLink.className = "youtube-logo-link";
      const logo = document.createElement("img");
      logo.className = "youtube-card-logo";
      logo.src = toHighResLogo(item.logo);
      logo.alt = `${item.name} ロゴ`;
      logo.loading = "lazy";
      logo.onerror = () => {
        logo.style.visibility = "hidden";
      };
      const name = document.createElement("p");
      name.className = "youtube-card-name";
      name.textContent = item.name;
      const topBadges = document.createElement("div");
      topBadges.className = "youtube-card-top-badges";
      const catTop = document.createElement("span");
      catTop.className = "youtube-top-badge youtube-top-badge--category";
      const categoryClassMap = {
        大会: "youtube-top-badge--cat-taikai",
        マーチング配信: "youtube-top-badge--cat-default",
        一般: "youtube-top-badge--cat-ippan",
        中学生以下: "youtube-top-badge--cat-junior",
        高校: "youtube-top-badge--cat-koko",
        海外: "youtube-top-badge--cat-default",
        カラーガード: "youtube-top-badge--cat-colorguard",
      };
      catTop.classList.add(categoryClassMap[item.category] || "youtube-top-badge--cat-default");
      catTop.textContent = item.category;
      const badgeLatest = document.createElement("span");
      badgeLatest.className = "youtube-top-badge youtube-top-badge--date youtube-top-badge--video-date";
      const dLatestStr = channelUpdateDateString(item.url, item);
      badgeLatest.textContent = `最新：${dLatestStr}`;
      topBadges.appendChild(catTop);
      topBadges.appendChild(badgeLatest);
      const info = document.createElement("div");
      info.className = "youtube-card-info";
      info.appendChild(name);
      info.appendChild(topBadges);
      logoLink.appendChild(logo);
      head.appendChild(logoLink);
      head.appendChild(info);
      root.appendChild(head);

      const thumbs = document.createElement("div");
      thumbs.className = "youtube-thumb-list";
      const fallbackIds = fallbackThumbIdsFor(item);
      const meta = resolvedMetaFor(item);
      const badgeMap = buildThumbBadgeMap(meta);
      const thumbIds = buildYoutubeFourThumbIds(meta, fallbackIds, {
        allowShortFallback: false,
      });
      const [t1, t2, t3, t4] = thumbIds;
      thumbIds.forEach((vid) => {
        const src = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : "";
        if (!src) return;
        const thumb = document.createElement("img");
        thumb.className = "youtube-thumb";
        thumb.src = src;
        thumb.loading = "lazy";
        thumb.alt = item.name;
        const videoLink = document.createElement("a");
        videoLink.href = vid ? `https://www.youtube.com/watch?v=${vid}` : item.url;
        videoLink.target = "_blank";
        videoLink.rel = "noopener noreferrer";
        videoLink.className = "youtube-thumb-link";
        const wrap = document.createElement("div");
        wrap.className = "youtube-thumb-item";
        wrap.setAttribute("data-yt-vid", vid);
        const badgeMeta = badgeMap.get(vid);
        if (badgeMeta) {
          wrap.classList.add(`youtube-thumb-item--rank-${badgeMeta.rank}`);
          const b = document.createElement("span");
          b.className = `youtube-thumb-badge youtube-thumb-badge--corner-tr youtube-thumb-badge--rank-${badgeMeta.rank}`;
          b.textContent = badgeMeta.label;
          wrap.appendChild(b);
        }
        const thumbTitle = document.createElement("span");
        thumbTitle.className = "youtube-thumb-title";
        const hasStatic = videoTitleById[vid];
        thumbTitle.textContent = hasStatic || "YouTubeで見る";
        videoLink.appendChild(thumb);
        wrap.appendChild(videoLink);
        wrap.appendChild(thumbTitle);
        thumbs.appendChild(wrap);
      });
      root.appendChild(thumbs);
      backfillOembedThumbTitlesIn(thumbs);

      const mylistRow = document.createElement("div");
      mylistRow.className = "youtube-card-mylist-row";
      const mylistBtn = document.createElement("button");
      mylistBtn.type = "button";
      mylistBtn.className = "youtube-channel-mylist-add-btn btn-share-search btn-marchinz-spotlight";
      mylistBtn.textContent = "マイリストに追加";
      mylistBtn.setAttribute("aria-label", `${item.name} を YouTube マイリストに追加`);
      mylistBtn.addEventListener("click", async () => {
        const api = window.MarchinZYoutubeChannelMylist;
        const run = api?.addWithPicker || api?.add;
        if (!run) {
          window.alert("マイリスト機能が読み込まれていません。ページを再読み込みしてください。");
          return;
        }
        mylistBtn.disabled = true;
        try {
          const r = await run({
            name: item.name,
            url: item.url,
            logo: item.logo,
            category: item.category,
          });
          if (!r?.ok) {
            if (r?.message) window.alert(r.message);
            return;
          }
          if (String(r.message || "").includes("すでに")) {
            mylistBtn.textContent = "マイリスト済み";
          } else {
            mylistBtn.textContent = "追加済み";
          }
        } catch (e) {
          const code = String(e?.code || "");
          if (code === "permission-denied") {
            window.alert(
              "マイリストへの保存が拒否されました。\nFirebase の Firestore ルール（firebase/firestore.rules）を本番プロジェクトにデプロイしてから、ページを再読み込みしてください。",
            );
          } else {
            window.alert(String(e?.message || e || "エラーが発生しました。"));
          }
        } finally {
          if (mylistBtn.textContent === "マイリストに追加") {
            mylistBtn.disabled = false;
          }
        }
      });
      mylistRow.appendChild(mylistBtn);
      root.appendChild(mylistRow);

      if (debugYoutube) {
        const debug = document.createElement("p");
        debug.className = "youtube-debug-meta";
        debug.textContent = `DEBUG | 4枠(重複なし, ${thumbIds.length}本):${thumbIds.join(",")} | 解釈:最新動画 ${t1 || "-"} / 最新LIVE|人気 ${t2 || "-"} / 人気 ${t3 || "-"} / 人気 ${t4 || "-"}`;
        root.appendChild(debug);
      }
      return root;
    }

    function buildYoutubePeekSlot(peekItem, btn) {
      const peekLi = document.createElement("li");
      peekLi.className = "video-result-peek-slot";
      const stack = document.createElement("div");
      stack.className = "video-result-peek-stack";
      const card = buildYoutubeCard(peekItem, { rootTag: "div" });
      card.classList.add("video-result-peek-card");
      card.setAttribute("aria-hidden", "true");
      const veil = document.createElement("div");
      veil.className = "video-result-peek-veil";
      veil.setAttribute("aria-hidden", "true");
      stack.appendChild(card);
      stack.appendChild(veil);
      if (btn) {
        btn.classList.add("video-result-peek-more-btn");
        stack.appendChild(btn);
      }
      peekLi.appendChild(stack);
      return peekLi;
    }

    function renderYoutubeCards() {
      const base =
        currentCategory === "all"
          ? [...channelsWithOrder]
          : channelsWithOrder.filter((x) => x.category === currentCategory);
      const foldKana = (s) =>
        String(s || "")
          .normalize("NFKC")
          .toLowerCase()
          .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
      const needle = foldKana(youtubeChannelSearch.trim());
      const scoped = needle.length > 0 ? base.filter((x) => foldKana(x.name).includes(needle)) : base;
      const sorted = scoped.sort((a, b) => {
        if (currentSort === "name") {
          return typeof MarchinZSort !== "undefined" && MarchinZSort && MarchinZSort.compare
            ? MarchinZSort.compare(a.name, b.name)
            : a.name.localeCompare(b.name, "ja");
        }
        const ad = dateToNumber(channelUpdateDateString(a.url, a));
        const bd = dateToNumber(channelUpdateDateString(b.url, b));
        if (bd !== ad) return bd - ad;
        return a._order - b._order;
      });
      currentFiltered = sorted;
      const total = sorted.length;
      list.className = "youtube-channel-list";
      if (total === 1) list.classList.add("youtube-channel-list--total-1");
      else if (total === 2) list.classList.add("youtube-channel-list--total-2");

      let pageRows = sorted.slice(0, Math.min(visibleCount, total));
      let moreAvailable = total > 0 && pageRows.length < total;
      let peekRow = moreAvailable ? sorted[pageRows.length] : null;
      const gridCols = getYoutubeGridColumnCount();
      let rem = pageRows.length % gridCols;
      let emptySlots = rem === 0 ? 0 : gridCols - rem;
      if (moreAvailable && total - pageRows.length === 1) {
        pageRows = sorted.slice(0, total);
        moreAvailable = false;
        peekRow = null;
        rem = pageRows.length % gridCols;
        emptySlots = rem === 0 ? 0 : gridCols - rem;
      }
      const useInlinePeek = Boolean(moreAvailable && peekRow && emptySlots > 0 && moreBtn);

      if (moreBtn && youtubeMoreWrap && list.contains(moreBtn)) {
        youtubeMoreWrap.appendChild(moreBtn);
      }

      list.replaceChildren();
      for (const item of pageRows) {
        list.appendChild(buildYoutubeCard(item));
      }
      if (useInlinePeek && peekRow && moreBtn) {
        list.appendChild(buildYoutubePeekSlot(peekRow, moreBtn));
      }

      if (moreBtn) {
        if (!useInlinePeek && youtubeMoreWrap) {
          moreBtn.classList.remove("video-result-peek-more-btn");
          youtubeMoreWrap.appendChild(moreBtn);
        }
        moreBtn.textContent = "もっと見る";
        moreBtn.hidden = !moreAvailable;
        moreBtn.disabled = !moreAvailable;
        moreBtn.title = moreAvailable ? "さらにチャンネルを表示します" : "";
      }
      if (youtubeMoreWrap) {
        youtubeMoreWrap.hidden = Boolean(useInlinePeek) || !moreAvailable;
      }

      if (visibleCountEl) {
        visibleCountEl.textContent = `表示中: ${pageRows.length} / ${currentFiltered.length}チャンネル`;
      }
      const publishedScopeEl = document.getElementById("youtube-published-channel-count");
      if (publishedScopeEl) {
        publishedScopeEl.textContent = `表示中 ${currentFiltered.length}チャンネル`;
      }
      const publishedTitleCountEl = document.getElementById("youtube-published-list-title-count");
      if (publishedTitleCountEl) {
        publishedTitleCountEl.textContent = `${currentFiltered.length}チャンネル`;
      }
      const publishedScopeBtn = document.getElementById("youtube-published-list-open");
      if (publishedScopeBtn) {
        const publishedTotal = base.length;
        publishedScopeBtn.setAttribute(
          "aria-label",
          `掲載チャンネル名一覧を開く（${publishedTotal}チャンネル）`,
        );
      }
    }

    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        currentCategory = btn.getAttribute("data-yt-category") || "all";
        tabs.forEach((x) => x.setAttribute("aria-selected", String(x === btn)));
        currentSort = "new";
        visibleCount = 5;
        sortBtns.forEach((x) => x.setAttribute("aria-pressed", String((x.getAttribute("data-yt-sort") || "") === "new")));
        setYoutubeResultsLoading(true);
        requestAnimationFrame(() => {
          renderYoutubeCards();
          setYoutubeResultsLoading(false);
        });
      });
    });

    sortBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        currentSort = btn.getAttribute("data-yt-sort") || "new";
        visibleCount = 5;
        sortBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === btn)));
        setYoutubeResultsLoading(true);
        requestAnimationFrame(() => {
          renderYoutubeCards();
          setYoutubeResultsLoading(false);
        });
      });
    });

    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        const cap = currentFiltered.length;
        visibleCount = Math.min(visibleCount + 10, cap > 0 ? cap : visibleCount + 10);
        renderYoutubeCards();
      });
    }

    const ytSearchEl = document.getElementById("youtube-channel-search");
    if (ytSearchEl && !ytSearchEl.dataset.ytSearchWired) {
      ytSearchEl.dataset.ytSearchWired = "1";
      ytSearchEl.addEventListener("input", () => {
        youtubeChannelSearch = String(ytSearchEl.value || "");
        visibleCount = 5;
        setYoutubeResultsLoading(true);
        requestAnimationFrame(() => {
          renderYoutubeCards();
          setYoutubeResultsLoading(false);
        });
      });
    }

    let lastYoutubeGridCols = getYoutubeGridColumnCount();
    let youtubeGridResizeTimer = null;
    window.addEventListener("resize", () => {
      if (youtubeGridResizeTimer) window.clearTimeout(youtubeGridResizeTimer);
      youtubeGridResizeTimer = window.setTimeout(() => {
        youtubeGridResizeTimer = null;
        const c = getYoutubeGridColumnCount();
        if (c !== lastYoutubeGridCols) {
          lastYoutubeGridCols = c;
          renderYoutubeCards();
        }
      }, 200);
    });

    const publishedDialog = document.getElementById("youtube-published-list-dialog");
    const publishedOpen = document.getElementById("youtube-published-list-open");
    const publishedClose = document.getElementById("youtube-published-list-close");
    const publishedContent = document.getElementById("youtube-published-list-content");
    if (publishedContent) {
      publishedContent.replaceChildren();
      publishedContent.appendChild(buildPublishedListSections(channels));
    }
    if (publishedOpen && publishedDialog && typeof publishedDialog.showModal === "function") {
      publishedOpen.addEventListener("click", () => {
        publishedDialog.showModal();
        publishedOpen.setAttribute("aria-expanded", "true");
        publishedContent?.focus();
      });
    } else if (publishedOpen) {
      publishedOpen.hidden = true;
    }
    if (publishedClose && publishedDialog) {
      publishedClose.addEventListener("click", () => {
        publishedDialog.close();
      });
    }
    if (publishedDialog) {
      publishedDialog.addEventListener("close", () => {
        if (publishedOpen) publishedOpen.setAttribute("aria-expanded", "false");
      });
      publishedDialog.addEventListener("click", (e) => {
        if (e.target === publishedDialog) publishedDialog.close();
      });
    }

    function resetYoutubeTabToDefaultCategory() {
      currentCategory = "all";
      currentSort = "new";
      visibleCount = 5;
      youtubeChannelSearch = "";
      const ytSearchReset = document.getElementById("youtube-channel-search");
      if (ytSearchReset) ytSearchReset.value = "";
      tabs.forEach((btn) => {
        const cat = btn.getAttribute("data-yt-category") || "all";
        btn.setAttribute("aria-selected", cat === "all" ? "true" : "false");
      });
      sortBtns.forEach((x) => {
        x.setAttribute("aria-pressed", String((x.getAttribute("data-yt-sort") || "") === "new"));
      });
      setYoutubeResultsLoading(true);
      requestAnimationFrame(() => {
        renderYoutubeCards();
        setYoutubeResultsLoading(false);
      });
    }
    window.__marchinzResetYoutubeCategoryTabs = resetYoutubeTabToDefaultCategory;

    if (window.__marchinzPendingYoutubeReset) {
      window.__marchinzPendingYoutubeReset = false;
      resetYoutubeTabToDefaultCategory();
    } else {
      renderYoutubeCards();
      setYoutubeResultsLoading(false);
    }
  }

  const siteLogoLink = document.querySelector('a.site-logo-link[href="#top"]');
  if (siteLogoLink) {
    siteLogoLink.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (location.hash !== "#top") {
        location.hash = "#top";
        return;
      }
      showPage("mll");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  document.addEventListener(
    "click",
    (ev) => {
      const sw = ev.target.closest?.("[data-mll-auth-switch]");
      if (sw) {
        ev.preventDefault();
        const dest = sw.getAttribute("data-mll-auth-switch");
        if (dest !== "login" && dest !== "signup") return;
        const p = new URLSearchParams(location.search);
        if (dest === "signup") p.set("from", "auth_switch");
        else p.delete("from");
        const q = p.toString();
        location.assign(`${location.pathname}${q ? `?${q}` : ""}#${dest}`);
        return;
      }
      const a = ev.target.closest?.("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (href !== "#terms" && href !== "#privacy") return;
      if (location.hash === href) {
        ev.preventDefault();
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    },
    true,
  );

  window.addEventListener("hashchange", syncFromHash);
  window.addEventListener("mll-auth-changed", () => {
    enforceAdminOnlyVisibility();
    syncFromHash();
  });
  setupCommunityHubTabButtons();
  setupInternalNavLinkClicks();
  enforceAdminOnlyVisibility();
  updateSiteBrandAuthEntryLinks();
  /** `#profile?uid=…&tab=logdiary&event=…` のクエリ（user-profile-page / event-log-diary 用） */
  window.MarchinZProfileHashParams = function marchinZProfileHashParams() {
    const raw = location.hash.replace(/^#/, "").trim();
    const qi = raw.indexOf("?");
    if (qi === -1) return new URLSearchParams("");
    const base = raw.slice(0, qi).toLowerCase();
    if (base !== "profile") return new URLSearchParams("");
    return new URLSearchParams(raw.slice(qi + 1));
  };

  window.MarchinZProfileUidFromHash = function marchinZProfileUidFromHash() {
    return String(window.MarchinZProfileHashParams().get("uid") || "").trim();
  };

  window.MarchinZNavigateAuthEntry = function marchinZNavigateAuthEntry(mode, signupFromOpt) {
    window.location.assign(buildAuthEntryUrl(mode, signupFromOpt));
  };
  window.MarchinZOpenMllLoginOverlay = function marchinZOpenMllLoginOverlayFromContext(_hint) {
    window.MarchinZNavigateAuthEntry("signup", "context");
  };
  setupMediaMoreButtons();
  setupMediaJumpLinks();
  setupYoutubePage();
  setTimeout(() => {
    syncFromHash();
  }, 0);
})();
