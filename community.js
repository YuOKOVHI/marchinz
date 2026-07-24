(() => {
  const LS_KEY = "marchinz_community_posts_v2";
  const LS_KEY_LEGACY = "marchinz_community_posts_v1";
  const LS_KEY_REPORTS = "marchinz_community_reports_v1";
  const SS_INTENT_COMMUNITY_COMPOSE = "mll_intent_community_compose";
  const SS_COMM_THREAD_FOCUS = "mz_comm_thread_focus";
  const SS_DRAFT_COMMUNITY_COMPOSE = "mz_draft_community_compose_v1";

  /** 話題カテゴリ（表示タブ／投稿フォーム共通） */
  const THEMES = [
    "告知（出演・開催等）",
    "メンバー募集",
    "クラウドファンディング",
    "質問",
    "運営より",
  ];
  const OLD_THEME_MAP = {
    クラファン募集: "クラウドファンディング",
    メンバー募集: "メンバー募集",
    演奏会告知: "告知（出演・開催等）",
    演奏会・出演告知: "告知（出演・開催等）",
    大会開催告知: "告知（出演・開催等）",
    見学募集: "質問",
    その他: "質問",
  };
  /** Firestore 等の内部キーは据え置き、画面表示だけ短くする */
  const THEME_DISPLAY_LABEL = {
    "告知（出演・開催等）": "出演/開催告知",
    "クラウドファンディング": "クラファン",
    "質問": "雑談・質問",
  };
  const FILTER_ALL = "ALL";
  /** ログインユーザーのみ閲覧可（Firestore ルールと一致） */
  const THEME_MEMBERS_ONLY = "質問";
  /** 運営（管理人）のみ投稿時に選択可 */
  const THEME_OPS_ONLY = "運営より";
  const BOARD_PUBLIC_THEMES = THEMES.filter((t) => t !== THEME_MEMBERS_ONLY);
  function themeDisplayLabel(themeKey) {
    const k = String(themeKey || "").trim();
    return THEME_DISPLAY_LABEL[k] || k;
  }

  function isMembersOnlyTheme(theme) {
    return normalizeTheme(theme) === THEME_MEMBERS_ONLY;
  }

  function boardPostVisibleToViewer(post) {
    if (currentUser()?.id) return true;
    return !isMembersOnlyTheme(post?.theme);
  }

  function parseCommunityBoardRoute() {
    const raw = location.hash.replace(/^#/, "").trim();
    const qi = raw.indexOf("?");
    const path = qi === -1 ? raw : raw.slice(0, qi);
    if (path !== "community/board" && path !== "community") {
      return { threadId: "" };
    }
    const query = qi === -1 ? "" : raw.slice(qi + 1);
    const params = new URLSearchParams(query);
    return { threadId: String(params.get("thread") || "").trim() };
  }

  function boardThreadShareHash(threadRootId) {
    const id = String(threadRootId || "").trim();
    if (!id) return "#community/board";
    return `#community/board?thread=${encodeURIComponent(id)}`;
  }

  function pendingCommunityThreadFocusId() {
    let id = parseCommunityBoardRoute().threadId;
    if (id) return id;
    try {
      id = String(sessionStorage.getItem(SS_COMM_THREAD_FOCUS) || "").trim();
    } catch {
      id = "";
    }
    return id;
  }
  const MAX_COMMUNITY_IMAGES = 4;
  const COMMUNITY_MESSAGE = {
    likeUpdateFailed: "いいねの更新に失敗しました。時間をおいて再度お試しください。",
    imageTooLarge: "ファイルサイズが大きすぎます。20MB以下の画像を選択してください。",
    imageUploadFailed: "画像のアップロードに失敗しました。時間をおいて再度お試しください。",
    postFailed: "投稿に失敗しました。時間をおいて再度お試しください。",
  };

  function communityFriendlyErrorMessage(err, fallback) {
    const code = String(err?.code || "").trim();
    if (code === "auth/network-request-failed") return "通信エラーが発生しました。通信環境をご確認ください。";
    if (code === "permission-denied") return "この操作を行う権限がありません。";
    if (code === "unavailable") return "ただいま混み合っています。少し時間をおいて再度お試しください。";
    return fallback;
  }

  function rawInputMaxBytes() {
    return window.MarchinZImage?.RAW_INPUT_MAX_BYTES || 20 * 1024 * 1024;
  }

  const WITHDRAWN_NAME = "退会ユーザー";
  const authorProfileCache = new Map();

  let activeDisplayTab = FILTER_ALL;
  let communitySearchQuery = "";

  const form = document.getElementById("community-form");
  const titleEl = document.getElementById("community-title");
  const contentEl = document.getElementById("community-content");
  const msgEl = document.getElementById("community-msg");
  const listEl = document.getElementById("community-list");
  const submitBtn = document.getElementById("community-submit");
  const composeOverlay = document.getElementById("community-compose-overlay");
  const openComposeBtn = document.getElementById("community-open-compose");
  const composeFormWrap = document.getElementById("community-compose-form-wrap");
  const composeHeadingEl = document.getElementById("community-compose-heading");
  const formThemeSelect = document.getElementById("community-form-theme-select");
  const COMPOSE_HEADING_DEFAULT = "新規話題を投稿";
  const feedMsgEl = document.getElementById("community-feed-msg");
  const moderationListEl = document.getElementById("moderation-list");
  const moderationNoteEl = document.getElementById("moderation-note");
  const moderationViewTabsRoot = document.getElementById("moderation-view-tabs");
  const moderationViewTabBtns = moderationViewTabsRoot
    ? [...moderationViewTabsRoot.querySelectorAll("button[data-moderation-view]")]
    : [];
  const topicImagesInput = document.getElementById("community-images");
  const topicImagesPreview = document.getElementById("community-images-preview");
  const topicImagesNote = document.getElementById("community-images-note");
  const errorThemeEl = document.getElementById("community-error-theme");
  const errorTitleEl = document.getElementById("community-error-title");
  const errorContentEl = document.getElementById("community-error-content");
  const themeMembersNoteEl = document.getElementById("community-theme-members-note");
  const boardGuestHintEl = document.getElementById("community-board-guest-hint");
  let cachedPosts = [];
  let cachedReports = [];
  let cachedMylistReports = [];
  let cachedNoteReports = [];
  let composeOverlayActive = false;
  /** 掲示板オーバーレイで編集中の投稿 id（新規投稿時は空） */
  let composeEditingPostId = "";
  let modalEscapeAttached = false;
  let feedMsgTimer = null;
  let communityDraftSaveTimer = null;

  if (
    !form ||
    !titleEl ||
    !contentEl ||
    !listEl ||
    !submitBtn ||
    !composeOverlay ||
    !openComposeBtn ||
    !feedMsgEl
  )
    return;

  const filterTabs = [...document.querySelectorAll("[data-community-filter]")];
  const formThemeTabs = [...document.querySelectorAll("[data-community-form-theme]")];

  function currentUser() {
    return window.MLL_AUTH?.getUser?.() || null;
  }

  function getDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function setFieldError(el, message) {
    if (!(el instanceof HTMLElement)) return;
    const msg = String(message || "").trim();
    el.textContent = msg;
    el.hidden = !msg;
  }

  function clearFormErrors() {
    setFieldError(errorThemeEl, "");
    setFieldError(errorTitleEl, "");
    setFieldError(errorContentEl, "");
  }

  function showBusyOverlay() {
    window.MarchinZProcessingOverlay?.show?.("処理中...");
  }

  function hideBusyOverlay() {
    window.MarchinZProcessingOverlay?.hide?.();
  }

  function authorWithdrawn(userId) {
    if (!userId) return false;
    return Boolean(authorProfileCache.get(String(userId))?.withdrawn);
  }

  function resolveAuthor(post) {
    const uid = String(post?.user_id || "").trim();
    if (!post) return { uid: "", name: "ユーザー", avatar: "", withdrawn: false };
    if (authorWithdrawn(uid)) {
      return { uid, name: WITHDRAWN_NAME, avatar: "", withdrawn: true };
    }
    const cached = uid ? authorProfileCache.get(uid) : null;
    const name = String(cached?.display_name || post.user_name || "ユーザー").trim() || "ユーザー";
    const avatar = String(cached?.avatar_url || post.user_avatar || "").trim();
    return { uid, name, avatar, withdrawn: false };
  }

  async function hydrateAuthorProfilesForPosts(posts) {
    authorProfileCache.clear();
    const db = getDb();
    const ids = new Set(posts.map((p) => p.user_id).filter(Boolean));
    const me = currentUser()?.id;
    if (me) ids.add(me);
    if (!db || !ids.size) return;
    await Promise.all(
      [...ids].map(async (uid) => {
        try {
          const snap = await db.collection("mll_profiles").doc(String(uid)).get();
          const d = snap.data() || {};
          authorProfileCache.set(String(uid), {
            withdrawn: Boolean(d.withdrawn),
            display_name: String(d.display_name || "").trim(),
            avatar_url: String(d.avatar_url || "").trim(),
            like_show_community: d.like_show_community !== false,
          });
        } catch {
          authorProfileCache.set(String(uid), {
            withdrawn: false,
            display_name: "",
            avatar_url: "",
            like_show_community: true,
          });
        }
      }),
    );
  }

  const WITHDRAWN_AVATAR_SVG = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#ffffff"/></svg>',
  )}`;

  /**
   * @param {{ uid?: string; name: string; avatar: string; withdrawn: boolean; uid?: string }} auth
   * @param {boolean} [isReply]
   * @returns {{ head: HTMLElement; textWrap: HTMLElement }}
   */
  function buildCommunityPostHead(auth, isReply = false) {
    const headEl = document.createElement("div");
    headEl.className = isReply ? "community-post-head community-post-head--reply" : "community-post-head";

    const profileUid = auth.withdrawn ? "" : String(auth.uid || "").trim();
    const avatar = document.createElement("img");
    avatar.className = "community-post-avatar" + (auth.withdrawn ? " community-post-avatar--withdrawn" : "");
    avatar.src = auth.withdrawn ? WITHDRAWN_AVATAR_SVG : auth.avatar || "logo/marchinz-logo.png";
    avatar.alt = auth.withdrawn ? "" : `${auth.name} のプロフィール画像`;
    if (profileUid) {
      const avatarLink = document.createElement("a");
      avatarLink.className = "community-post-avatar-link";
      avatarLink.href = `#profile?uid=${encodeURIComponent(profileUid)}`;
      avatarLink.setAttribute("aria-label", `${auth.name} のプロフィール`);
      avatarLink.appendChild(avatar);
      headEl.appendChild(avatarLink);
    } else {
      headEl.appendChild(avatar);
    }

    const textWrap = document.createElement("div");
    const name = document.createElement("p");
    name.className = "mll-log-title community-post-author-name";
    if (profileUid) {
      const nameLink = document.createElement("a");
      nameLink.className = "community-post-author-link";
      nameLink.href = `#profile?uid=${encodeURIComponent(profileUid)}`;
      nameLink.textContent = auth.name;
      nameLink.setAttribute("aria-label", `${auth.name} のプロフィール`);
      name.appendChild(nameLink);
    } else {
      name.textContent = auth.name;
    }
    textWrap.appendChild(name);

    headEl.appendChild(textWrap);
    return { head: headEl, textWrap };
  }

  function isAdmin() {
    return Boolean(window.MLL_AUTH?.isAdmin?.());
  }

  function canSelectOpsTheme() {
    return isAdmin();
  }

  function composeSelectableThemes() {
    return canSelectOpsTheme() ? THEMES.slice() : THEMES.filter((t) => t !== THEME_OPS_ONLY);
  }

  function defaultComposeTheme() {
    return composeSelectableThemes()[0] || THEMES[0];
  }

  function themeAllowedForCompose(theme) {
    const t = normalizeTheme(theme);
    if (t === THEME_OPS_ONLY) return canSelectOpsTheme();
    return THEMES.includes(t);
  }

  function syncComposeThemeOptionsVisibility() {
    const allowOps = canSelectOpsTheme();
    if (formThemeSelect instanceof HTMLSelectElement) {
      [...formThemeSelect.options].forEach((opt) => {
        if (String(opt.value || "") === THEME_OPS_ONLY) {
          opt.hidden = !allowOps;
          opt.disabled = !allowOps;
        }
      });
    }
    formThemeTabs.forEach((btn) => {
      if (String(btn.getAttribute("data-community-form-theme") || "") === THEME_OPS_ONLY) {
        btn.hidden = !allowOps;
      }
    });
    const cur = selectedFormTheme();
    if (!themeAllowedForCompose(cur)) {
      syncFormThemeUi(defaultComposeTheme());
    }
  }

  function rejectThemeForCompose(theme) {
    if (themeAllowedForCompose(theme)) return false;
    setFieldError(errorThemeEl, "選択できません");
    setMsg("このカテゴリを選択する権限がありません。", true);
    return true;
  }

  function profileFallback(user) {
    const nick = String(window.MLL_AUTH?.getDisplayName?.() || "").trim();
    return {
      display_name:
        nick || user?.user_metadata?.full_name || user?.user_metadata?.name || "ユーザー",
      avatar_url: user?.user_metadata?.avatar_url || "",
      withdrawn: false,
    };
  }

  function setMsg(text, isError = false) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.style.color = isError ? "#b71c1c" : "";
  }

  function setFeedMsg(text, isError = false) {
    if (!feedMsgEl) return;
    if (feedMsgTimer) {
      clearTimeout(feedMsgTimer);
      feedMsgTimer = null;
    }
    feedMsgEl.textContent = text || "";
    feedMsgEl.style.color = isError ? "#b71c1c" : "";
    if (text && !isError) {
      feedMsgTimer = window.setTimeout(() => {
        feedMsgEl.textContent = "";
        feedMsgEl.style.color = "";
        feedMsgTimer = null;
      }, 9000);
    }
  }

  function escapeCommunityModals(ev) {
    if (ev.key !== "Escape") return;
    if (!composeOverlayActive) return;
    ev.preventDefault();
    closeComposeOverlay();
  }

  function syncBodyModalLock() {
    const on = composeOverlayActive;
    document.documentElement.classList.toggle("community-compose-active", on);
    document.body.classList.toggle("community-compose-active", on);
  }

  function attachModalEscapeIfNeeded() {
    if (composeOverlayActive && !modalEscapeAttached) {
      document.addEventListener("keydown", escapeCommunityModals, true);
      modalEscapeAttached = true;
    } else if (!composeOverlayActive && modalEscapeAttached) {
      document.removeEventListener("keydown", escapeCommunityModals, true);
      modalEscapeAttached = false;
    }
  }

  function resetComposeOverlayPanels() {
    if (composeFormWrap) composeFormWrap.hidden = false;
    if (composeHeadingEl) composeHeadingEl.textContent = COMPOSE_HEADING_DEFAULT;
  }

  function restoreComposeFormLayoutDefaults() {
    const themeFs = document.querySelector("#community-form .community-form-theme-fieldset");
    const titleLab = titleEl?.closest?.("label.search-label-full");
    const imgField = document.getElementById("community-images-field");
    if (themeFs instanceof HTMLElement) themeFs.hidden = false;
    if (titleLab instanceof HTMLElement) titleLab.hidden = false;
    if (imgField instanceof HTMLElement) imgField.hidden = false;
    if (titleEl) titleEl.required = true;
    if (submitBtn) submitBtn.textContent = "この内容で投稿";
    if (composeHeadingEl) composeHeadingEl.textContent = COMPOSE_HEADING_DEFAULT;
  }

  function applyComposeEditLayout(post) {
    const themeFs = document.querySelector("#community-form .community-form-theme-fieldset");
    const titleLab = titleEl?.closest?.("label.search-label-full");
    const imgField = document.getElementById("community-images-field");
    const isRoot = isThreadRoot(post);
    if (themeFs instanceof HTMLElement) themeFs.hidden = !isRoot;
    if (titleLab instanceof HTMLElement) titleLab.hidden = !isRoot;
    if (imgField instanceof HTMLElement) imgField.hidden = false;
    if (titleEl) {
      titleEl.required = isRoot;
      if (!isRoot) titleEl.value = "";
    }
    if (submitBtn) submitBtn.textContent = isRoot ? "変更を保存" : "返信を保存";
    if (composeHeadingEl) composeHeadingEl.textContent = isRoot ? "話題を編集" : "返信を編集";
  }

  function scrollCommunityBoardTabStripsToStart() {
    const board = document.getElementById("community-hub-panel-board");
    if (!(board instanceof HTMLElement)) return;
    board.querySelectorAll(".mz-tab-strip-yamap").forEach((el) => {
      if (el instanceof HTMLElement) el.scrollLeft = 0;
    });
  }

  function collectCommunityComposeDraft() {
    return {
      theme: String(selectedFormTheme() || "").trim(),
      title: String(titleEl?.value || "").trim(),
      content: String(contentEl?.value || "").trim(),
      uiOpen: Boolean(composeOverlayActive && !composeEditingPostId),
    };
  }

  function hasCommunityComposeDraftContent(draft) {
    if (!draft || typeof draft !== "object") return false;
    return Boolean(String(draft.title || "").trim() || String(draft.content || "").trim());
  }

  function readCommunityComposeDraft() {
    try {
      const raw = sessionStorage.getItem(SS_DRAFT_COMMUNITY_COMPOSE);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function clearCommunityComposeDraft() {
    try {
      sessionStorage.removeItem(SS_DRAFT_COMMUNITY_COMPOSE);
    } catch {
      //
    }
  }

  function persistCommunityComposeDraft(uiOpen) {
    if (composeEditingPostId) return;
    const draft = collectCommunityComposeDraft();
    const open = uiOpen != null ? Boolean(uiOpen) : Boolean(draft.uiOpen);
    if (!hasCommunityComposeDraftContent(draft)) {
      clearCommunityComposeDraft();
      return;
    }
    try {
      sessionStorage.setItem(
        SS_DRAFT_COMMUNITY_COMPOSE,
        JSON.stringify({
          theme: normalizeTheme(draft.theme),
          title: draft.title,
          content: draft.content,
          uiOpen: open,
        }),
      );
    } catch {
      //
    }
  }

  function scheduleCommunityComposeDraftSave() {
    if (composeEditingPostId) return;
    clearTimeout(communityDraftSaveTimer);
    communityDraftSaveTimer = window.setTimeout(() => {
      communityDraftSaveTimer = null;
      persistCommunityComposeDraft(null);
    }, 350);
  }

  function applyCommunityComposeDraftFields(draft) {
    if (!draft || composeEditingPostId) return;
    const theme = normalizeTheme(String(draft.theme || "").trim());
    if (THEMES.includes(theme)) syncFormThemeUi(theme);
    if (titleEl) titleEl.value = String(draft.title || "");
    if (contentEl) contentEl.value = String(draft.content || "");
  }

  function resetCommunityComposeFormFields() {
    if (titleEl) titleEl.value = "";
    if (contentEl) contentEl.value = "";
    topicImageSlots?.reset?.();
    syncComposeThemeFromBoardFilter();
    clearFormErrors();
  }

  function hideComposeOverlayOnly() {
    if (!composeOverlayActive) return;
    composeOverlay.hidden = true;
    composeOverlay.setAttribute("aria-hidden", "true");
    composeOverlayActive = false;
    resetComposeOverlayPanels();
    attachModalEscapeIfNeeded();
    syncBodyModalLock();
  }

  function closeComposeOverlay(options = {}) {
    if (!composeOverlayActive && !options.forcePersist) return;
    if (!composeEditingPostId && !options.skipPersist) {
      persistCommunityComposeDraft(false);
    }
    hideComposeOverlayOnly();
    if (!options.keepEditing) {
      composeEditingPostId = "";
      restoreComposeFormLayoutDefaults();
    }
    try {
      openComposeBtn.focus();
    } catch {
      //
    }
  }

  function onCommunityComposeLeaveBoard() {
    if (composeEditingPostId) {
      hideComposeOverlayOnly();
      return;
    }
    const draft = collectCommunityComposeDraft();
    if (!hasCommunityComposeDraftContent(draft)) {
      clearCommunityComposeDraft();
      hideComposeOverlayOnly();
      resetCommunityComposeFormFields();
      activeDisplayTab = FILTER_ALL;
      setTabGroupSelected(filterTabs, FILTER_ALL, "data-community-filter");
      scrollCommunityBoardTabStripsToStart();
      renderPosts(cachedPosts);
      return;
    }
    persistCommunityComposeDraft(true);
    hideComposeOverlayOnly();
  }

  function onCommunityComposeEnterBoard() {
    if (composeEditingPostId) return;
    const draft = readCommunityComposeDraft();
    if (!draft || !hasCommunityComposeDraftContent(draft)) return;
    applyCommunityComposeDraftFields(draft);
    if (draft.uiOpen && currentUser()?.id && !composeOverlayActive) {
      openComposeOverlay({ preserveFields: true, fromEdit: false });
    }
  }

  function syncComposeThemeFromBoardFilter() {
    if (activeDisplayTab !== FILTER_ALL && THEMES.includes(activeDisplayTab)) {
      syncFormThemeUi(themeAllowedForCompose(activeDisplayTab) ? activeDisplayTab : defaultComposeTheme());
      setFieldError(errorThemeEl, "");
    }
  }

  function openComposeOverlay(options = {}) {
    if (!options.fromEdit) {
      composeEditingPostId = "";
      restoreComposeFormLayoutDefaults();
      if (!options.preserveFields) {
        const draft = readCommunityComposeDraft();
        if (draft && hasCommunityComposeDraftContent(draft)) {
          applyCommunityComposeDraftFields(draft);
        } else {
          syncComposeThemeFromBoardFilter();
        }
      }
    }
    setMsg("", false);
    if (composeFormWrap) composeFormWrap.hidden = false;
    if (composeHeadingEl && !String(composeEditingPostId || "").trim()) {
      composeHeadingEl.textContent = COMPOSE_HEADING_DEFAULT;
    }
    composeOverlay.hidden = false;
    composeOverlay.setAttribute("aria-hidden", "false");
    composeOverlayActive = true;
    attachModalEscapeIfNeeded();
    syncBodyModalLock();
    requestAnimationFrame(() => {
      const closeBtn = composeOverlay.querySelector(".community-compose-close-btn");
      const u = currentUser();
      if (u?.id) {
        const titleLab = titleEl?.closest?.("label.search-label-full");
        const titleHidden = Boolean(titleLab?.hidden);
        if (!titleHidden && titleEl && !titleEl.disabled) {
          titleEl.focus();
        } else if (contentEl && !contentEl.disabled) {
          contentEl.focus();
        } else if (closeBtn) {
          closeBtn.focus();
        }
      } else if (closeBtn) {
        closeBtn.focus();
      }
    });
  }

  function normalizeTheme(t) {
    const s = String(t || "").trim();
    if (THEMES.includes(s)) return s;
    if (OLD_THEME_MAP[s]) return normalizeTheme(OLD_THEME_MAP[s]);
    return "質問";
  }

  function normalizePostDoc(raw) {
    const copy = { ...raw };
    if (copy.theme) copy.theme = normalizeTheme(copy.theme);
    const id = String(copy.id || "").trim();
    let threadRoot = String(copy.thread_root_id || "").trim();
    if (!threadRoot) threadRoot = id;
    copy.thread_root_id = threadRoot;
    const isRootPost = Boolean(id && id === threadRoot);
    let pp = String(copy.parent_post_id ?? "").trim();
    if (isRootPost) {
      copy.parent_post_id = "";
    } else if (!pp) {
      copy.parent_post_id = threadRoot;
    } else {
      copy.parent_post_id = pp;
    }
    const imgs = Array.isArray(copy.image_urls) ? copy.image_urls : [];
    copy.image_urls = imgs
      .map((x) => String(x || "").trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, MAX_COMMUNITY_IMAGES);
    const lbSrc =
      copy.liked_by != null &&
      typeof copy.liked_by === "object" &&
      !Array.isArray(copy.liked_by)
        ? copy.liked_by
        : {};
    copy.liked_by = {};
    for (const k of Object.keys(lbSrc)) {
      const uid = String(k || "").trim();
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(uid) && lbSrc[k] === true) copy.liked_by[uid] = true;
    }
    return copy;
  }

  function mapPost(raw) {
    const n = normalizePostDoc(raw || {});
    const id = String(n.id || "");
    let thread_root_id = String(n.thread_root_id || "").trim() || id;
    const isRootPost = Boolean(id && id === thread_root_id);
    let parent_post_id = "";
    if (!isRootPost) {
      parent_post_id = String(n.parent_post_id || "").trim() || thread_root_id;
    }
    return {
      id,
      theme: normalizeTheme(n.theme),
      thread_root_id,
      parent_post_id,
      title: String(n.title || "").trim(),
      content: String(n.content || "").trim(),
      created_at: String(n.created_at || ""),
      updated_at: String(n.updated_at || ""),
      user_id: String(n.user_id || ""),
      user_name: String(n.user_name || "ユーザー"),
      user_avatar: String(n.user_avatar || ""),
      hidden: Boolean(n.hidden),
      hidden_at: String(n.hidden_at || ""),
      hidden_by: String(n.hidden_by || ""),
      hidden_reason: String(n.hidden_reason || ""),
      reported_count: Number(n.reported_count || 0),
      image_urls: Array.isArray(n.image_urls)
        ? n.image_urls
            .map((x) => String(x || "").trim())
            .filter((u) => /^https?:\/\//i.test(u))
            .slice(0, MAX_COMMUNITY_IMAGES)
        : [],
      liked_by: n.liked_by && typeof n.liked_by === "object" && !Array.isArray(n.liked_by) ? { ...n.liked_by } : {},
    };
  }

  function isThreadRoot(p) {
    return Boolean(p?.id && p.id === p.thread_root_id);
  }

  function setTabGroupSelected(buttons, selectedValue, attrName) {
    for (const b of buttons) {
      const sel = String(b.getAttribute(attrName) || "") === selectedValue;
      b.setAttribute("aria-selected", sel ? "true" : "false");
    }
  }

  function isMobileFormThemeSelect() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  function syncFormThemeUi(themeValue) {
    let v = THEMES.includes(themeValue) ? themeValue : defaultComposeTheme();
    if (!themeAllowedForCompose(v)) v = defaultComposeTheme();
    setTabGroupSelected(formThemeTabs, v, "data-community-form-theme");
    if (formThemeSelect instanceof HTMLSelectElement) formThemeSelect.value = v;
    if (themeMembersNoteEl instanceof HTMLElement) {
      themeMembersNoteEl.hidden = !isMembersOnlyTheme(v);
    }
  }

  function selectedFormTheme() {
    if (formThemeSelect instanceof HTMLSelectElement && isMobileFormThemeSelect()) {
      const v = String(formThemeSelect.value || "").trim();
      return themeAllowedForCompose(v) ? normalizeTheme(v) : defaultComposeTheme();
    }
    const hit = formThemeTabs.find((b) => b.getAttribute("aria-selected") === "true");
    const v = String(hit?.getAttribute("data-community-form-theme") || "").trim();
    return themeAllowedForCompose(v) ? normalizeTheme(v) : defaultComposeTheme();
  }

  function navigateToCommunityLogin(intentKey) {
    try {
      sessionStorage.setItem(SS_INTENT_COMMUNITY_COMPOSE, "1");
    } catch {
      //
    }
    if (typeof window.MarchinZNavigateAuthEntry === "function") {
      window.MarchinZNavigateAuthEntry("login", intentKey || "community_compose");
      return;
    }
    window.location.hash = "#login";
  }

  function navigateToCommunityLoginForMembersBoard() {
    if (typeof window.MarchinZNavigateAuthEntry === "function") {
      window.MarchinZNavigateAuthEntry("login", "community_board_members");
      return;
    }
    window.location.hash = "#login";
  }

  /** 旧 LS キーからの読み込み（初回のみ） */
  function loadLocalPosts() {
    const readKey = (key) => {
      try {
        const raw = localStorage.getItem(key);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.map((x) => mapPost(normalizePostDoc(x))) : [];
      } catch {
        return [];
      }
    };
    let merged = readKey(LS_KEY);
    if (!merged.length) {
      merged = readKey(LS_KEY_LEGACY).map(mapPost);
    }
    try {
      if (merged.length && !localStorage.getItem(LS_KEY) && localStorage.getItem(LS_KEY_LEGACY)) {
        localStorage.setItem(LS_KEY, JSON.stringify(merged.map(normalizePostDoc)));
      }
    } catch {
      // ignore
    }
    return merged;
  }

  function saveLocalPosts(posts) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(posts));
    } catch {
      // ignore
    }
  }

  function loadLocalReports() {
    try {
      const raw = localStorage.getItem(LS_KEY_REPORTS);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(mapReport) : [];
    } catch {
      return [];
    }
  }

  function saveLocalReports(reports) {
    try {
      localStorage.setItem(LS_KEY_REPORTS, JSON.stringify(reports));
    } catch {
      // ignore
    }
  }

  function mapReport(raw) {
    return {
      id: String(raw.id || ""),
      post_id: String(raw.post_id || ""),
      reporter_id: String(raw.reporter_id || ""),
      reporter_name: String(raw.reporter_name || "ユーザー"),
      reason: String(raw.reason || "").trim(),
      created_at: String(raw.created_at || ""),
    };
  }

  function mapMylistReport(raw) {
    const lt = String(raw.list_type || "").trim();
    return {
      id: String(raw.id || ""),
      reporter_id: String(raw.reporter_id || ""),
      target_uid: String(raw.target_uid || ""),
      list_id: String(raw.list_id || ""),
      list_type: lt === "yt" ? "yt" : "videos",
      reason: String(raw.reason || "").trim(),
      created_at: String(raw.created_at || ""),
    };
  }

  function mapNoteReport(raw) {
    return {
      id: String(raw.id || ""),
      reporter_id: String(raw.reporter_id || ""),
      target_uid: String(raw.target_uid || ""),
      event_id: String(raw.event_id || ""),
      note_title: String(raw.note_title || "").trim(),
      reason: String(raw.reason || "").trim(),
      created_at: String(raw.created_at || ""),
    };
  }

  function formatDate(isoLike) {
    const d = new Date(isoLike);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(
      2,
      "0",
    )} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function formatDateTimeJa(isoLike) {
    const d = new Date(isoLike);
    if (Number.isNaN(d.getTime())) return "";
    const wk = ["日", "月", "火", "水", "木", "金", "土"];
    const mo = d.getMonth() + 1;
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${d.getFullYear()}年${mo}月${day}日（${wk[d.getDay()]}）${hh}:${mi}:${ss}`;
  }

  function hasMeaningfulUpdatedAt(p) {
    const c = Date.parse(String(p?.created_at || ""));
    const u = Date.parse(String(p?.updated_at || ""));
    return Boolean(String(p?.updated_at || "").trim()) && Number.isFinite(u) && Number.isFinite(c) && u > c + 2000;
  }

  function appendDatetimeBlock(hostEl, p) {
    if (!hostEl || !p) return;
    const row = document.createElement("div");
    row.className = "community-datetime-row";
    const t1 = document.createElement("time");
    t1.className = "community-post-datetime";
    t1.dateTime = String(p.created_at || "");
    t1.textContent = `投稿：${formatDateTimeJa(p.created_at)}`;
    row.appendChild(t1);
    if (hasMeaningfulUpdatedAt(p)) {
      const t2 = document.createElement("time");
      t2.className = "community-post-datetime community-post-datetime--updated";
      t2.dateTime = String(p.updated_at || "");
      t2.textContent = `更新：${formatDateTimeJa(p.updated_at)}`;
      row.appendChild(t2);
    }
    hostEl.appendChild(row);
  }

  function appendImageGallery(wrapEl, urls, maskWithdrawn = false) {
    const list = (Array.isArray(urls) ? urls : [])
      .map((x) => String(x || "").trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, MAX_COMMUNITY_IMAGES);
    if (!list.length || !wrapEl) return;
    const fig = document.createElement("div");
    const count = Math.min(list.length, MAX_COMMUNITY_IMAGES);
    fig.className = `community-post-images community-post-images--count-${count}`;
    fig.setAttribute("role", "group");
    fig.setAttribute("aria-label", maskWithdrawn ? "投稿画像（退会ユーザーのため非表示）" : "投稿画像");
    if (maskWithdrawn) {
      for (let i = 0; i < list.length; i++) {
        const box = document.createElement("div");
        box.className = "community-post-image community-post-image--withdrawn";
        box.setAttribute("role", "img");
        box.setAttribute("aria-label", "退会ユーザーの投稿画像");
        fig.appendChild(box);
      }
    } else {
      const mi = window.MarchinZImage;
      list.forEach((u, i) => {
        const slot = document.createElement("div");
        slot.className = "community-post-image-slot";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "community-post-image-btn";
        btn.setAttribute("aria-label", `投稿画像 ${i + 1} を表示`);
        const img = document.createElement("img");
        img.className = "community-post-image";
        img.src = u;
        img.alt = `投稿画像 ${i + 1}`;
        img.loading = "lazy";
        img.decoding = "async";
        img.draggable = false;
        mi?.bindImgGuards?.(img);
        btn.appendChild(img);
        btn.addEventListener("click", () => {
          mi?.openPhotoLightbox?.(list, i);
        });
        slot.appendChild(btn);
        fig.appendChild(slot);
      });
    }
    wrapEl.appendChild(fig);
  }

  function toggleLikeLocal(postId, uid) {
    const posts = loadLocalPosts();
    const next = posts.map((post) => {
      if (post.id !== postId) return post;
      const lb = { ...(post.liked_by && typeof post.liked_by === "object" ? post.liked_by : {}) };
      if (lb[uid]) delete lb[uid];
      else lb[uid] = true;
      return mapPost(normalizePostDoc({ ...post, liked_by: lb }));
    });
    saveLocalPosts(next.map(normalizePostDoc));
  }

  async function toggleCommunityLike(postId) {
    const user = currentUser();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return false;
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("like")) {
      return false;
    }
    const db = getDb();
    if (!db) {
      toggleLikeLocal(postId, user.id);
      cachedPosts = cachedPosts.map((p) => {
        if (p.id !== postId) return p;
        const lb = { ...(p.liked_by && typeof p.liked_by === "object" ? p.liked_by : {}) };
        if (lb[user.id]) delete lb[user.id];
        else lb[user.id] = true;
        return mapPost(normalizePostDoc({ ...p, liked_by: lb }));
      });
      renderPosts(cachedPosts);
      return;
    }
    /** @type {{ author: string; title: string; threadRoot: string } | null} */
    let likeNotify = null;
    /** @type {Record<string, boolean>|null} */
    let nextLb = null;
    try {
      const ref = db.collection("mll_community_posts").doc(postId);
      await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) return;
        const data = snap.data() || {};
        const prev = data.liked_by && typeof data.liked_by === "object" ? data.liked_by : {};
        const patched = { ...prev };
        const wasOn = Boolean(patched[user.id]);
        if (wasOn) delete patched[user.id];
        else patched[user.id] = true;
        nextLb = patched;
        txn.update(ref, { liked_by: patched });
        if (!wasOn) {
          const author = String(data.user_id || "").trim();
          const title = String(data.title || "投稿").trim().slice(0, 200);
          const threadRoot = String(data.thread_root_id || postId || "").trim().slice(0, 128);
          if (author && author !== user.id) likeNotify = { author, title, threadRoot };
        }
      });
    } catch (e) {
      setMsg(communityFriendlyErrorMessage(e, COMMUNITY_MESSAGE.likeUpdateFailed), true);
      return false;
    }
    if (likeNotify) {
      const nm =
        String(window.MarchinZActorDisplayName?.(user) || profileFallback(user).display_name || "ユーザー")
          .trim()
          .slice(0, 120) || "ユーザー";
      window.MarchinZPushLikeNotification?.(db, likeNotify.author, {
        kind: "like_community_post",
        actor_uid: user.id,
        actor_name: nm,
        target_type: "community_post",
        target_id: String(postId),
        target_title: likeNotify.title,
          target_href: "#community/board",
        thread_root_id: likeNotify.threadRoot,
      });
    }
    if (nextLb) {
      cachedPosts = cachedPosts.map((p) =>
        p.id === postId ? mapPost(normalizePostDoc({ ...p, liked_by: nextLb })) : p,
      );
    }
  }

  function appendLikeRow(hostEl, p) {
    if (!hostEl || !p) return;
    const me = currentUser();
    const lb =
      p.liked_by && typeof p.liked_by === "object" && !Array.isArray(p.liked_by) ? p.liked_by : {};
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    window.MarchinZEngageUi?.buildLikeRow(hostEl, {
      liked,
      count: cnt,
      onClick: () => toggleCommunityLike(p.id),
      showLoginHint: !me?.id,
    });
  }

  function storageAvailable() {
    return Boolean(window.MLL_AUTH?.getStorage?.());
  }

  async function uploadCommunityJpegs(storage, uid, blobs) {
    const out = [];
    const rnd = () => Math.random().toString(36).slice(2, 10);
    for (let i = 0; i < blobs.length; i += 1) {
      const blob = blobs[i];
      const path = `mll_community/${uid}/${Date.now()}_${i}_${rnd()}.jpg`;
      const ref = storage.ref(path);
      await ref.put(blob, { contentType: "image/jpeg", cacheControl: "public,max-age=31536000" });
      out.push(await ref.getDownloadURL());
    }
    return out;
  }

  async function buildImageUrlsFromFiles(uid, files) {
    const storage = window.MLL_AUTH.getStorage();
    if (!storage) {
      throw new Error("Firebase Storage が利用できません（プロジェクトの Storage を有効化し storageBucket を設定してください）");
    }
    const mi = window.MarchinZImage;
    if (!mi?.compressForUpload) {
      throw new Error("画像圧縮モジュールが読み込まれていません。ページを再読み込みしてください。");
    }
    const blobs = [];
    for (const file of files) {
      blobs.push(
        await mi.compressForUpload(file, {
          maxWidthOrHeight: 1920,
          maxSizeMB: 0.65,
          initialQuality: 0.85,
        }),
      );
    }
    return uploadCommunityJpegs(storage, uid, blobs);
  }

  /**
   * ネイティブ file 入力の「ファイル未選択」表示を出さず、ラベルボタンで選択する。
   * @param {HTMLInputElement} inputEl
   * @returns {HTMLElement}
   */
  function wireCommunityFilePicker(inputEl) {
    if (!inputEl) return /** @type {HTMLElement} */ (inputEl);
    const existing = inputEl.closest(".community-file-picker");
    if (existing instanceof HTMLElement) return existing;

    const wrap = document.createElement("div");
    wrap.className = "community-file-picker";
    const label = document.createElement("label");
    label.className = "community-file-picker__label";
    const trigger = document.createElement("span");
    trigger.className = "community-file-picker__trigger";
    trigger.textContent = "画像を添付";

    inputEl.classList.add("community-file-picker__input");
    const parent = inputEl.parentNode;
    if (parent) {
      parent.insertBefore(wrap, inputEl);
    }
    label.appendChild(inputEl);
    label.appendChild(trigger);
    wrap.appendChild(label);
    return wrap;
  }

  /**
   * Storage セキュリティルールは `firebase/storage.rules` の例を Firebase Console に適用すること。
   * 管理人の書込許可には Firestore の `mll_privileged_uids/{uid}` 登録が必要。
   */
  function attachImageSlots(inputEl, previewEl) {
    const state = { files: [], existingUrls: [] };

    function totalCount() {
      return state.existingUrls.length + state.files.length;
    }

    function render() {
      if (!previewEl) return;
      previewEl.querySelectorAll("img[src^='blob:']").forEach((img) => {
        try {
          URL.revokeObjectURL(img.src);
        } catch {
          //
        }
      });
      previewEl.innerHTML = "";
      state.existingUrls.forEach((url, idx) => {
        const thumb = document.createElement("div");
        thumb.className = "community-image-thumb community-image-thumb--saved";
        const pic = document.createElement("img");
        pic.src = url;
        pic.alt = "投稿済み画像";
        pic.draggable = false;
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "community-image-thumb-remove";
        rm.textContent = "削除";
        rm.addEventListener("click", () => {
          state.existingUrls = state.existingUrls.filter((_, j) => j !== idx);
          render();
        });
        thumb.appendChild(pic);
        thumb.appendChild(rm);
        previewEl.appendChild(thumb);
      });
      state.files.forEach((file, idx) => {
        const thumb = document.createElement("div");
        thumb.className = "community-image-thumb";
        const url = URL.createObjectURL(file);
        const pic = document.createElement("img");
        pic.src = url;
        pic.alt = `${file.name} のプレビュー`;
        pic.draggable = false;
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "community-image-thumb-remove";
        rm.textContent = "削除";
        rm.addEventListener("click", () => {
          state.files = state.files.filter((_, j) => j !== idx);
          URL.revokeObjectURL(url);
          render();
        });
        thumb.appendChild(pic);
        thumb.appendChild(rm);
        previewEl.appendChild(thumb);
      });
    }

    function setFromIncomingMore(fileListLike) {
      const arr = Array.from(fileListLike || []).filter(Boolean);
      const next = state.files.slice();
      const rawMax = rawInputMaxBytes();
      let skippedBig = 0;
      for (const f of arr) {
        if (state.existingUrls.length + next.length >= MAX_COMMUNITY_IMAGES) break;
        if (!/^image\//i.test(String(f.type || ""))) continue;
        if (f.size > rawMax) {
          skippedBig += 1;
          continue;
        }
        next.push(f);
      }
      if (skippedBig > 0) {
        window.alert(COMMUNITY_MESSAGE.imageTooLarge);
      }
      state.files = next;
      render();
    }

    if (inputEl) {
      inputEl.addEventListener("change", () => {
        setFromIncomingMore(inputEl.files);
        inputEl.value = "";
      });
    }

    return {
      getFiles: () => state.files.slice(),
      getExistingUrls: () => state.existingUrls.slice(),
      setExistingUrls(urls) {
        state.existingUrls = (Array.isArray(urls) ? urls : [])
          .map((u) => String(u || "").trim())
          .filter((u) => /^https?:\/\//i.test(u))
          .slice(0, MAX_COMMUNITY_IMAGES);
        state.files = [];
        render();
      },
      reset: () => {
        state.files = [];
        state.existingUrls = [];
        if (previewEl) {
          previewEl.querySelectorAll("img[src^='blob:']").forEach((img) => {
            try {
              URL.revokeObjectURL(img.src);
            } catch {
              //
            }
          });
          previewEl.innerHTML = "";
        }
        if (inputEl) inputEl.value = "";
      },
      setEnabled(v) {
        if (inputEl) inputEl.disabled = !v;
      },
    };
  }

  if (topicImagesInput instanceof HTMLInputElement) {
    wireCommunityFilePicker(topicImagesInput);
  }
  const topicImageSlots = attachImageSlots(topicImagesInput, topicImagesPreview);

  function buildReportOverflowDetails(postId) {
    const Eu = window.MarchinZEngageUi;
    const det = Eu?.buildReportOverflow
      ? Eu.buildReportOverflow(() => void reportPost(postId))
      : (() => {
          const d = document.createElement("details");
          d.className = "community-post-overflow";
          const s = document.createElement("summary");
          s.className = "community-post-overflow-trigger";
          s.setAttribute("aria-label", "その他の操作");
          s.textContent = "⋯";
          const p = document.createElement("div");
          p.className = "community-post-overflow-panel";
          const b = document.createElement("button");
          b.type = "button";
          b.className = "community-post-overflow-item";
          b.textContent = "通報する";
          b.addEventListener("click", (e) => {
            e.preventDefault();
            d.open = false;
            void reportPost(postId);
          });
          p.appendChild(b);
          d.appendChild(s);
          d.appendChild(p);
          return d;
        })();
    det.addEventListener("toggle", () => {
      if (!det.open) return;
      try {
        det.closest(".community-post-engage")?.querySelectorAll("details.community-post-overflow").forEach((d) => {
          if (d !== det && d instanceof HTMLDetailsElement) d.open = false;
        });
      } catch {
        //
      }
    });
    return det;
  }

  function appendBoardShareButton(parentEl, rootPost) {
    if (!parentEl || !rootPost || !isThreadRoot(rootPost)) return;
    if (isMembersOnlyTheme(rootPost.theme)) return;
    const sm = window.MarchinZShareMenu;
    if (!sm?.buildAbsoluteUrlForHash || !sm.setupSearchLikeShareMenuForButton) return;
    const hash = boardThreadShareHash(rootPost.id);
    const url = sm.buildAbsoluteUrlForHash(hash);
    const title = String(rootPost.title || "MarchinZ Board 話題").trim() || "MarchinZ Board 話題";
    const shareText = sm.boardShareText ? sm.boardShareText(title, url) : `${title}\n${url}`;
    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.className = "btn-share-search btn-marchinz-spotlight";
    shareBtn.textContent = "シェアする";
    shareBtn.setAttribute("aria-label", "MarchinZ Board 話題をシェア");
    parentEl.appendChild(shareBtn);
    sm.setupSearchLikeShareMenuForButton(shareBtn, shareText, url, "search");
  }

  function appendEngagementRow(parent, p, opts) {
    const { includeReplyToggle = false, onReplyToggle, skipLike = false, includeShare = false } = opts || {};
    if (!parent || !p) return;
    const me = currentUser();
    const admin = isAdmin();
    const row = document.createElement("div");
    row.className = "community-post-engage";
    const primary = document.createElement("div");
    primary.className = "community-post-engage-primary";
    if (!skipLike) appendLikeRow(primary, p);
    if (includeShare) appendBoardShareButton(primary, p);
    if (includeReplyToggle && me?.id && !window.MLL_AUTH?.isWithdrawn?.()) {
      const replyBtn = document.createElement("button");
      replyBtn.type = "button";
      replyBtn.className = "community-reply-open-btn";
      replyBtn.textContent = "返信する";
      replyBtn.addEventListener("click", () => {
        if (typeof onReplyToggle === "function") onReplyToggle(replyBtn);
        else replyBtn.hidden = true;
      });
      primary.appendChild(replyBtn);
    }
    row.appendChild(primary);
    const aside = document.createElement("div");
    aside.className = "community-post-engage-aside";
    const posterWithdrawn = authorWithdrawn(p.user_id);
    let canManage = Boolean(me?.id && (me.id === p.user_id || admin));
    if (posterWithdrawn && me?.id === p.user_id && !admin) {
      canManage = false;
    }
    if (canManage) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-reset-search community-post-manage-btn";
      editBtn.textContent = "編集";
      editBtn.addEventListener("click", () => void editPost(p.id));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn-reset-search community-post-manage-btn";
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", () => void deletePost(p.id));
      aside.appendChild(editBtn);
      aside.appendChild(delBtn);
      if (admin) {
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className =
          "btn-reset-search community-post-manage-btn community-post-manage-btn--moderation";
        toggleBtn.textContent = p.hidden ? "復元" : "非表示";
        toggleBtn.setAttribute("aria-label", p.hidden ? "投稿を復元（運営のみ）" : "投稿を非表示（運営のみ）");
        toggleBtn.addEventListener("click", () => void toggleHidden(p.id, !p.hidden));
        aside.appendChild(toggleBtn);
      }
    } else if (me?.id && me.id !== p.user_id) {
      aside.appendChild(buildReportOverflowDetails(p.id));
    }
    row.appendChild(aside);
    parent.appendChild(row);
  }

  async function submitReply(threadRoot, parentPost, compose) {
    const user = currentUser();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    if (window.MLL_AUTH?.isWithdrawn?.()) {
      setMsg("退会済みのアカウントでは返信できません。", true);
      return;
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("post")) {
      setMsg("投稿の頻度が高すぎます。しばらく待ってから再度お試しください。", true);
      return;
    }
    const textarea = compose?.textarea;
    const imageSlots = compose?.imageSlots;
    const content = String(textarea?.value || "").trim();
    const files = (imageSlots?.getFiles?.() || []).slice(0, MAX_COMMUNITY_IMAGES);
    if (!content && !files.length) {
      setMsg("返信本文を入力するか、画像を1枚以上選んでください。", true);
      return;
    }
    if (files.length && !storageAvailable()) {
      setMsg("画像付き返信には Firebase Storage の利用が必要です。", true);
      return;
    }
    let image_urls = [];
    if (files.length) {
      try {
        image_urls = await buildImageUrlsFromFiles(user.id, files);
      } catch (e) {
        if (String(e?.message || "") === window.MarchinZImage?.ERR_TOO_LARGE) {
          setMsg("大きすぎる画像は投稿できません。", true);
          return;
        }
        setMsg(communityFriendlyErrorMessage(e, COMMUNITY_MESSAGE.imageUploadFailed), true);
        return;
      }
    }
    if (!content.trim() && !image_urls.length) {
      setMsg("返信本文を入力するか、画像を投稿してください。", true);
      return;
    }
    const profile = await fetchProfile(user);
    const now = new Date().toISOString();
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const post = {
      id,
      theme: normalizeTheme(threadRoot.theme),
      thread_root_id: threadRoot.thread_root_id,
      parent_post_id: parentPost.id,
      title: "",
      content: content.trim(),
      image_urls,
      liked_by: {},
      created_at: now,
      updated_at: now,
      user_id: user.id,
      user_name: profile.display_name || "ユーザー",
      user_avatar: profile.avatar_url || "",
    };
    /* writePost は失敗をローカルに逃がさず投げる(2026-07-25)。
       ここで受けないと、返信が届いていないのに画面が無反応になる */
    try {
      await writePost(post);
    } catch (e) {
      setMsg(communityFriendlyErrorMessage(e, "返信の投稿に失敗しました。時間をおいて再度お試しください。"), true);
      return;
    }
    window.MarchinZAdminUgcLog?.recordBoardReply?.({
      postId: post.id,
      threadRootId: threadRoot.id,
      threadTitle: String(threadRoot.title || "掲示板").trim(),
      actorUid: user.id,
      actorName: profile.display_name || "ユーザー",
    });
    window.MarchinZTrackEvent?.("community_reply_submit", {
      has_image: image_urls.length > 0 ? 1 : 0,
    });
    textarea.value = "";
    imageSlots?.reset?.();
    setMsg("返信を投稿しました。");
    await refreshAll();
  }

  function appendReplyComposer(wrapRoot, threadRoot, parentPost) {
    if (currentUser()?.id && window.MLL_AUTH?.isWithdrawn?.()) {
      const note = document.createElement("p");
      note.className = "mll-log-meta";
      note.textContent = "退会済みのアカウントでは返信できません。";
      wrapRoot.appendChild(note);
      return {
        box: note,
        ta: null,
        expand() {},
        imageSlots: null,
      };
    }
    const me = currentUser();
    if (!me?.id) {
      return { box: null, ta: null, expand() {}, imageSlots: null };
    }

    /** @type {HTMLDivElement | null} */
    let box = null;
    /** @type {HTMLTextAreaElement | null} */
    let ta = null;
    /** @type {ReturnType<typeof attachImageSlots> | null} */
    let replyImageSlots = null;

    const mount = () => {
      if (box) return;
      box = document.createElement("div");
      box.className = "community-reply-compose";
      ta = document.createElement("textarea");
      ta.className = "community-reply-textarea";
      ta.rows = 3;
      ta.maxLength = 1200;
      ta.placeholder =
        parentPost?.id === threadRoot.id
          ? "返信"
          : `${String(parentPost?.user_name || "投稿").slice(0, 40)} への返信…`;

      const imgRow = document.createElement("div");
      imgRow.className = "community-reply-images-row";
      const input = document.createElement("input");
      input.type = "file";
      input.className = "community-images-input community-images-input--reply";
      input.accept = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";
      input.multiple = true;
      input.disabled = true;
      const preview = document.createElement("div");
      preview.className = "community-images-preview community-images-preview--reply";
      const filePicker = wireCommunityFilePicker(input);
      replyImageSlots = attachImageSlots(input, preview);
      replyImageSlots.setEnabled(storageAvailable() && Boolean(currentUser()?.id));

      const row = document.createElement("div");
      row.className = "community-reply-actions";
      const send = document.createElement("button");
      send.type = "button";
      send.className = "btn-reset-search community-reply-send-btn";
      send.textContent = "返信を送る";
      send.addEventListener("click", () =>
        void submitReply(threadRoot, parentPost, { textarea: ta, imageSlots: replyImageSlots }),
      );
      row.appendChild(filePicker);
      row.appendChild(send);
      imgRow.appendChild(preview);
      box.appendChild(ta);
      box.appendChild(imgRow);
      box.appendChild(row);
      wrapRoot.appendChild(box);
      wrapRoot.classList.add("community-has-reply-compose");
    };

    const hideReplyOpenBtn = (replyBtn) => {
      wrapRoot.classList.add("community-has-reply-compose");
      const threadBody = wrapRoot.closest(".community-thread-body");
      threadBody?.classList.add("community-has-reply-compose");
      if (replyBtn instanceof HTMLButtonElement) {
        replyBtn.hidden = true;
        replyBtn.setAttribute("aria-hidden", "true");
      }
      const scope = threadBody || wrapRoot;
      scope.querySelectorAll(".community-reply-open-btn").forEach((btn) => {
        if (btn instanceof HTMLButtonElement) {
          btn.hidden = true;
          btn.setAttribute("aria-hidden", "true");
        }
      });
      const engage = wrapRoot.querySelector(":scope > .community-post-engage");
      engage?.classList.add("community-post-engage--reply-active");
    };

    const expand = (replyBtn) => {
      mount();
      hideReplyOpenBtn(replyBtn);
      replyImageSlots?.setEnabled(storageAvailable() && Boolean(currentUser()?.id));
      ta?.focus();
    };
    return { box: wrapRoot, ta: null, expand, imageSlots: null };
  }

  const MAX_REPLY_NEST_DEPTH = 12;

  function sortPostsChronoAsc(a, b) {
    return String(a.created_at).localeCompare(String(b.created_at));
  }

  function buildRepliesByParent(root, repliesInThread, globalById) {
    const map = new Map();
    const rootId = root.id;
    for (const r of repliesInThread) {
      let pid = String(r.parent_post_id || "").trim();
      const parentOk =
        pid &&
        globalById[pid] &&
        globalById[pid].thread_root_id === rootId;
      if (!parentOk) pid = rootId;
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid).push(r);
    }
    for (const [, arr] of map) arr.sort(sortPostsChronoAsc);
    return map;
  }

  function renderPosts(posts) {
    listEl.innerHTML = "";
    const admin = isAdmin();
    const me = currentUser();
    const visible = posts.filter((p) => (!p.hidden || admin) && boardPostVisibleToViewer(p));
    const byId = {};
    visible.forEach((p) => {
      byId[p.id] = p;
    });

    let roots = visible.filter(isThreadRoot);
    if (activeDisplayTab !== FILTER_ALL) {
      roots = roots.filter((r) => r.theme === activeDisplayTab);
    }
    if (communitySearchQuery) {
      const q = communitySearchQuery.toLowerCase();
      const allReplies = visible.filter((p) => !isThreadRoot(p));
      roots = roots.filter((r) => {
        if ((r.title || "").toLowerCase().includes(q)) return true;
        if ((r.content || "").toLowerCase().includes(q)) return true;
        if ((r.user_name || "").toLowerCase().includes(q)) return true;
        if ((r.theme || "").toLowerCase().includes(q)) return true;
        return allReplies.some((rep) => rep.thread_root_id === r.id && (rep.content || "").toLowerCase().includes(q));
      });
    }
    roots.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    if (!roots.length) {
      const li = document.createElement("li");
      li.className = "mll-log-item";
      li.textContent =
        activeDisplayTab === FILTER_ALL
          ? "まだ投稿はありません。最初の話題を作成してみましょう。"
          : "このカテゴリの話題はまだありません。";
      listEl.appendChild(li);
      return;
    }

    function renderReplyBranch(parentId, depth, threadRoot, repliesByParent) {
      if (depth > MAX_REPLY_NEST_DEPTH) return null;
      const children = repliesByParent.get(parentId) || [];
      if (!children.length) return null;
      const ul = document.createElement("ul");
      ul.className =
        depth <= 1 ? "community-reply-list" : "community-reply-list community-reply-list--nested";
      for (const r of children) {
        const rli = document.createElement("li");
        rli.className = "community-reply-item";
        if (r.hidden && admin) rli.classList.add("community-reply-item--admin-hidden");
        rli.style.setProperty("--reply-depth", String(Math.min(depth, 8)));

        const inner = document.createElement("div");
        inner.className = "community-reply-item-inner";

        const rauth = resolveAuthor(r);
        const { head: rh, textWrap: rtext } = buildCommunityPostHead(rauth, true);
        appendDatetimeBlock(rtext, r);

        inner.appendChild(rh);
        if (String(r.content || "").trim()) {
          const rc = document.createElement("p");
          rc.className = "mll-log-note";
          rc.textContent = r.content;
          inner.appendChild(rc);
        }
        appendImageGallery(inner, r.image_urls, rauth.withdrawn);
        if (r.hidden && admin) {
          const hn = document.createElement("p");
          hn.className = "community-hidden-note community-admin-only-note";
          hn.setAttribute("role", "status");
          hn.textContent = `非表示中（理由: ${r.hidden_reason || "管理者対応"}）`;
          inner.appendChild(hn);
        }
        let replyUi = null;
        appendEngagementRow(inner, r, {
          includeReplyToggle: Boolean(me?.id),
          onReplyToggle: (replyBtn) => {
            replyUi?.expand(replyBtn);
          },
        });

        const nestedUl = renderReplyBranch(r.id, depth + 1, threadRoot, repliesByParent);
        if (nestedUl) inner.appendChild(nestedUl);

        replyUi = appendReplyComposer(inner, threadRoot, r);

        rli.appendChild(inner);
        ul.appendChild(rli);
      }
      return ul;
    }

    for (const root of roots) {
      const li = document.createElement("li");
      li.className = "mll-log-item community-thread";
      if (root.hidden && admin) li.classList.add("community-thread--admin-hidden");
      li.dataset.mzThreadRoot = String(root.id || "");

      const theme = document.createElement("p");
      theme.className = "community-theme-tag";
      theme.textContent = `【${themeDisplayLabel(root.theme)}】`;

      const roAuth = resolveAuthor(root);
      const { head, textWrap: headText } = buildCommunityPostHead(roAuth, false);
      appendDatetimeBlock(headText, root);

      const titleRow = document.createElement("div");
      titleRow.className = "mz-title-like-row";
      const title = document.createElement("p");
      title.className = "mll-log-title";
      title.textContent = root.title;
      titleRow.appendChild(title);
      appendLikeRow(titleRow, root);

      const threadBody = document.createElement("div");
      threadBody.className = "community-thread-body";
      let rootReplyUi = null;

      threadBody.appendChild(theme);
      threadBody.appendChild(head);
      threadBody.appendChild(titleRow);
      if (String(root.content || "").trim()) {
        const content = document.createElement("p");
        content.className = "mll-log-note";
        content.textContent = root.content;
        threadBody.appendChild(content);
      }
      appendImageGallery(threadBody, root.image_urls, roAuth.withdrawn);
      if (root.hidden && admin) {
        const hiddenNote = document.createElement("p");
        hiddenNote.className = "community-hidden-note community-admin-only-note";
        hiddenNote.setAttribute("role", "status");
        hiddenNote.textContent = `非表示中（理由: ${root.hidden_reason || "管理者対応"}）`;
        threadBody.appendChild(hiddenNote);
      }
      appendEngagementRow(threadBody, root, {
        includeReplyToggle: Boolean(me?.id),
        skipLike: true,
        includeShare: !isMembersOnlyTheme(root.theme),
        onReplyToggle: (replyBtn) => {
          rootReplyUi?.expand(replyBtn);
        },
      });

      const repliesAll = visible.filter((p) => !isThreadRoot(p) && p.thread_root_id === root.id);
      const repliesByParent = buildRepliesByParent(root, repliesAll, byId);
      const topRepliesUl = renderReplyBranch(root.id, 1, root, repliesByParent);
      if (topRepliesUl) threadBody.appendChild(topRepliesUl);

      rootReplyUi = appendReplyComposer(threadBody, root, root);

      li.appendChild(threadBody);
      listEl.appendChild(li);
    }
  }

  async function fetchProfile(user) {
    const fallback = { ...profileFallback(user), withdrawn: false };
    const db = getDb();
    if (!db || !user?.id) return fallback;
    try {
      const snap = await db.collection("mll_profiles").doc(user.id).get();
      if (!snap.exists) return fallback;
      const d = snap.data() || {};
      if (d.withdrawn) {
        return { display_name: WITHDRAWN_NAME, avatar_url: "", withdrawn: true };
      }
      return {
        display_name: d.display_name || fallback.display_name,
        avatar_url: d.avatar_url || fallback.avatar_url,
        withdrawn: false,
      };
    } catch {
      return fallback;
    }
  }

  async function readPosts() {
    const db = getDb();
    if (!db) {
      let posts = loadLocalPosts();
      if (!currentUser()?.id) {
        posts = posts.filter(boardPostVisibleToViewer);
      }
      return posts.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
    try {
      const loggedIn = Boolean(currentUser()?.id);
      let snap;
      if (loggedIn) {
        snap = await db.collection("mll_community_posts").orderBy("created_at", "desc").limit(250).get();
      } else {
        snap = await db.collection("mll_community_posts").where("theme", "in", BOARD_PUBLIC_THEMES).limit(250).get();
      }
      const rows = snap.docs.map((d) => mapPost({ id: d.id, ...(d.data() || {}) }));
      if (!loggedIn) {
        return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      }
      return rows;
    } catch {
      let posts = loadLocalPosts();
      if (!currentUser()?.id) posts = posts.filter(boardPostVisibleToViewer);
      return posts.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
  }

  async function readReports() {
    const db = getDb();
    if (!db) {
      return loadLocalReports().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
    /* 失敗したらローカルの控えではなく空を返す(2026-07-25)。
       通報の read は isPrivileged() のみ許可(firestore.rules)なので、
       一般ユーザーではここが必ず permission-denied になる。これは正常系。
       以前はこのcatchが localStorage の通報控えを返していたため、
       権限の無い人のモデレーション画面に「偽の通報一覧」が出ていた。
       ここで例外を投げると refreshAll の Promise.all が落ちて掲示板ごと
       描画されなくなるので、投げずに空で返す */
    try {
      const snap = await db.collection("mll_community_reports").orderBy("created_at", "desc").limit(300).get();
      return snap.docs.map((d) => mapReport({ id: d.id, ...(d.data() || {}) }));
    } catch {
      return [];
    }
  }

  async function readMylistReports() {
    const db = getDb();
    if (!db) return [];
    try {
      const snap = await db.collection("mll_mylist_reports").orderBy("created_at", "desc").limit(300).get();
      return snap.docs.map((d) => mapMylistReport({ id: d.id, ...(d.data() || {}) }));
    } catch {
      return [];
    }
  }

  async function readNoteReports() {
    const db = getDb();
    if (!db) return [];
    try {
      const snap = await db.collection("mll_note_reports").orderBy("created_at", "desc").limit(300).get();
      return snap.docs.map((d) => mapNoteReport({ id: d.id, ...(d.data() || {}) }));
    } catch {
      return [];
    }
  }

  async function writePost(post) {
    const doc = normalizePostDoc(post);
    const db = getDb();
    if (!db) {
      const posts = loadLocalPosts();
      posts.unshift(mapPost(doc));
      saveLocalPosts(posts.slice(0, 200).map(normalizePostDoc));
      return;
    }
    /* Firestoreへの書き込みが失敗したらローカルに逃がさず、そのまま投げる
       (2026-07-25 セキュリティ/正しさレビュー)。
       以前はここで catch して localStorage に積んでいたため、凍結ユーザーや
       ルール検証に弾かれた投稿が「投稿しました」と表示され、本人の端末にだけ
       並んだ。誰にも届いていないのに成功に見えるのが最悪の失敗の仕方なので、
       呼び出し側でエラーを見せる。db自体が無い場合(上のif)だけは従来どおり
       ローカル保存する ─ これはFirebase未設定のローカル開発用の経路 */
    await db.collection("mll_community_posts").doc(doc.id).set(doc);
  }

  async function updatePost(updated) {
    const doc = normalizePostDoc(updated);
    const db = getDb();
    if (!db) {
      const posts = loadLocalPosts();
      const next = posts.map((p) => (p.id === updated.id ? mapPost(doc) : p));
      saveLocalPosts(next.map(normalizePostDoc));
      return;
    }
    try {
      await db.collection("mll_community_posts").doc(updated.id).set(doc, { merge: true });
    } catch {
      const posts = loadLocalPosts();
      const next = posts.map((p) => (p.id === updated.id ? mapPost(doc) : p));
      saveLocalPosts(next.map(normalizePostDoc));
    }
  }

  async function removeThreadAll(threadRootId) {
    const db = getDb();
    if (!db) {
      saveLocalPosts(loadLocalPosts().filter((p) => p.thread_root_id !== threadRootId));
      return;
    }
    try {
      const snap = await db.collection("mll_community_posts").where("thread_root_id", "==", threadRootId).get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    } catch {
      saveLocalPosts(loadLocalPosts().filter((p) => p.thread_root_id !== threadRootId));
    }
  }

  function buildChildrenMapThread(threadRootId) {
    const threadPosts = cachedPosts.filter((p) => p.thread_root_id === threadRootId);
    const byT = Object.fromEntries(threadPosts.map((p) => [p.id, p]));
    const map = new Map();
    for (const p of threadPosts) {
      if (p.id === threadRootId) continue;
      let pid = String(p.parent_post_id || "").trim();
      if (!byT[pid] || byT[pid].thread_root_id !== threadRootId) {
        pid = threadRootId;
      }
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid).push(p);
    }
    return map;
  }

  function collectSubtreeIds(startId, childrenMap) {
    const out = [];
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      out.push(id);
      for (const c of childrenMap.get(id) || []) {
        stack.push(c.id);
      }
    }
    return out;
  }

  async function removePostIds(ids) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return;
    const db = getDb();
    if (!db) {
      const drop = new Set(uniq);
      saveLocalPosts(loadLocalPosts().filter((p) => !drop.has(p.id)));
      return;
    }
    const CHUNK = 400;
    try {
      for (let i = 0; i < uniq.length; i += CHUNK) {
        const slice = uniq.slice(i, i + CHUNK);
        const batch = db.batch();
        for (const id of slice) {
          batch.delete(db.collection("mll_community_posts").doc(id));
        }
        await batch.commit();
      }
    } catch {
      const drop = new Set(uniq);
      saveLocalPosts(loadLocalPosts().filter((p) => !drop.has(p.id)));
    }
  }

  async function toggleHidden(postId, hide) {
    const me = currentUser();
    if (!isAdmin() || !me?.id) {
      setMsg("この操作は管理者のみ実行できます。", true);
      return;
    }
    const post = cachedPosts.find((x) => x.id === postId);
    if (!post) return;
    let reason = post.hidden_reason || "";
    if (hide) {
      const input = window.prompt("非表示理由を入力してください。", reason);
      if (input === null) return;
      reason = String(input).trim();
    }
    const updated = {
      ...post,
      hidden: hide,
      hidden_at: hide ? new Date().toISOString() : "",
      hidden_by: hide ? me.id : "",
      hidden_reason: hide ? reason : "",
      updated_at: new Date().toISOString(),
    };
    await updatePost(updated);
    setMsg(hide ? "投稿を非表示にしました。" : "投稿を復元しました。");
    await refreshAll();
  }

  async function writeReport(report) {
    const db = getDb();
    if (!db) {
      const reports = loadLocalReports();
      reports.unshift(report);
      saveLocalReports(reports.slice(0, 300));
      return;
    }
    try {
      await db.collection("mll_community_reports").doc(report.id).set(report);
      await db.collection("mll_community_posts").doc(report.post_id).set(
        {
          reported_at: report.created_at,
          reported_count: (window.firebase?.firestore?.FieldValue || {}).increment
            ? window.firebase.firestore.FieldValue.increment(1)
            : 1,
        },
        { merge: true },
      );
    } catch {
      const reports = loadLocalReports();
      reports.unshift(report);
      saveLocalReports(reports.slice(0, 300));
    }
  }

  function resolveModerationHeading(post) {
    const root =
      cachedPosts.find((x) => x.id === post.thread_root_id && isThreadRoot(x)) ||
      (isThreadRoot(post) ? post : null);
    if (!root) {
      const fallback = cachedPosts.find((x) => x.id === post.thread_root_id);
      const th = fallback ? fallback.theme : post.theme;
      const ti = fallback ? fallback.title : post.title;
      return { themeLabel: themeDisplayLabel(normalizeTheme(th)), titleLabel: ti || "（削除済みの話題）" };
    }
    return { themeLabel: themeDisplayLabel(normalizeTheme(root.theme)), titleLabel: root.title };
  }

  async function editPost(postId) {
    const me = currentUser();
    if (!me?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    const post = cachedPosts.find((x) => x.id === postId);
    if (!post) return;
    if (post.user_id !== me.id && !isAdmin()) return;
    if (post.user_id === me.id && authorWithdrawn(me.id) && !isAdmin()) {
      setMsg("退会済みのアカウントでは編集できません。", true);
      return;
    }
    clearFormErrors();
    topicImageSlots.reset();
    topicImageSlots.setExistingUrls(post.image_urls);
    const isRoot = isThreadRoot(post);
    if (isRoot) {
      titleEl.value = post.title;
      syncFormThemeUi(normalizeTheme(post.theme));
    }
    contentEl.value = post.content;
    composeEditingPostId = post.id;
    applyComposeEditLayout(post);
    openComposeOverlay({ fromEdit: true });
  }

  async function deletePost(postId) {
    const me = currentUser();
    if (!me?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    const post = cachedPosts.find((x) => x.id === postId);
    if (!post) return;
    if (post.user_id !== me.id && !isAdmin()) return;
    if (post.user_id === me.id && authorWithdrawn(me.id) && !isAdmin()) {
      setMsg("退会済みのアカウントでは削除できません。", true);
      return;
    }
    const isRootPost = isThreadRoot(post);
    const childMap = buildChildrenMapThread(post.thread_root_id);
    const subtreeIds = isRootPost ? [] : collectSubtreeIds(post.id, childMap);
    const n = subtreeIds.length;
    const msg = isRootPost
      ? "この話題とすべての返信を削除しますか？"
      : n > 1
        ? `この返信と、その下に続く返信を合わせて ${n} 件を削除しますか？`
        : "この返信を削除しますか？";
    const ok = window.confirm(msg);
    if (!ok) return;
    if (isRootPost) {
      await removeThreadAll(post.thread_root_id);
    } else {
      await removePostIds(subtreeIds);
    }
    setMsg(isRootPost ? "話題を削除しました。" : "返信を削除しました。");
    await refreshAll();
  }

  async function reportPost(postId) {
    const me = currentUser();
    if (!me?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    const post = cachedPosts.find((x) => x.id === postId);
    if (!post) return;
    if (post.user_id === me.id) {
      setMsg("自分の投稿は通報できません。", true);
      return;
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("report")) {
      setMsg("通報の頻度が高すぎます。しばらく待ってから再度お試しください。", true);
      return;
    }
    const reason = window.prompt("通報理由を入力してください（任意）。", "");
    if (reason === null) return;
    const report = {
      id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      post_id: post.id,
      reporter_id: me.id,
      reporter_name:
        window.MarchinZActorDisplayName?.(me) ||
        me.user_metadata?.full_name ||
        me.user_metadata?.name ||
        "ユーザー",
      reason: String(reason).trim().slice(0, 500),
      created_at: new Date().toISOString(),
    };
    await writeReport(report);
    window.MarchinZTrackEvent?.("report_submit", { target_type: "community" });
    setMsg("通報を受け付けました。運営側で確認します。");
  }

  let moderationSearchQuery = "";
  let moderationView = "community";

  function mylistReportTypeLabel(listType) {
    return listType === "yt" ? "YouTube マイリスト" : "大会動画マイリスト";
  }

  function renderModeration() {
    if (!moderationListEl || !moderationNoteEl) return;
    moderationListEl.innerHTML = "";
    const toolbar = document.getElementById("moderation-toolbar");
    if (!isAdmin()) {
      if (moderationViewTabsRoot) moderationViewTabsRoot.hidden = true;
      const li = document.createElement("li");
      li.className = "mll-log-item";
      li.textContent = "このページは管理者のみ閲覧できます。";
      moderationListEl.appendChild(li);
      moderationNoteEl.textContent = "管理者ログイン時に通報履歴が表示されます。";
      if (toolbar) toolbar.hidden = true;
      return;
    }
    if (moderationViewTabsRoot) moderationViewTabsRoot.hidden = false;
    setTabGroupSelected(moderationViewTabBtns, moderationView, "data-moderation-view");

    if (moderationView === "note") {
      if (toolbar) toolbar.hidden = false;
      const bulkHost = document.getElementById("moderation-bulk-actions");
      if (bulkHost) bulkHost.hidden = true;
      let items = [...cachedNoteReports].sort((a, b) =>
        String(b.created_at || "").localeCompare(String(a.created_at || "")),
      );
      if (moderationSearchQuery) {
        const q = moderationSearchQuery.toLowerCase();
        items = items.filter((r) => {
          const blob = [r.target_uid, r.event_id, r.reporter_id, r.reason, r.note_title]
            .join(" ")
            .toLowerCase();
          return blob.includes(q);
        });
      }
      moderationNoteEl.textContent =
        `MarchinZ Note 通報（表示中）: ${items.length}件 / 全件: ${cachedNoteReports.length}件 · コミュニティ ${cachedReports.length}件 / マイリスト ${cachedMylistReports.length}件`;
      if (!items.length) {
        const li = document.createElement("li");
        li.className = "mll-log-item";
        li.textContent = cachedNoteReports.length
          ? "検索条件に一致する MarchinZ Note 通報はありません。"
          : "MarchinZ Note の通報記録はまだありません。";
        moderationListEl.appendChild(li);
        return;
      }
      for (const r of items) {
        const li = document.createElement("li");
        li.className = "mll-log-item";
        const title = document.createElement("p");
        title.className = "mll-log-title";
        title.textContent = `MarchinZ Note — ${r.note_title || "（無題）"}`;
        const meta = document.createElement("p");
        meta.className = "mll-log-meta";
        meta.textContent = `通報日時: ${formatDateTimeJa(r.created_at)} / 通報者: ${r.reporter_id || "（不明）"} / 対象UID: ${
          r.target_uid || "（不明）"
        } / イベント: ${r.event_id || "（不明）"}`;
        const reasonEl = document.createElement("p");
        reasonEl.className = "moderation-report-note";
        reasonEl.textContent = r.reason ? `理由: ${r.reason}` : "理由: （未記入）";
        const linkRow = document.createElement("p");
        linkRow.className = "community-post-actions";
        const a = document.createElement("a");
        a.className = "btn-reset-search";
        const uid = encodeURIComponent(String(r.target_uid || "").trim());
        const ev = encodeURIComponent(String(r.event_id || "").trim());
        a.href = `#profile?uid=${uid}&tab=logdiary&event=${ev}`;
        a.textContent = "該当プロフィールの MarchinZ Note へ";
        linkRow.appendChild(a);
        li.appendChild(title);
        li.appendChild(meta);
        li.appendChild(reasonEl);
        li.appendChild(linkRow);
        moderationListEl.appendChild(li);
      }
      return;
    }

    if (moderationView === "mylist") {
      if (toolbar) toolbar.hidden = false;
      const bulkHost = document.getElementById("moderation-bulk-actions");
      if (bulkHost) bulkHost.hidden = true;
      let items = [...cachedMylistReports].sort((a, b) =>
        String(b.created_at || "").localeCompare(String(a.created_at || "")),
      );
      if (moderationSearchQuery) {
        const q = moderationSearchQuery.toLowerCase();
        items = items.filter((r) => {
          const blob = [
            r.target_uid,
            r.list_id,
            r.reporter_id,
            r.reason,
            mylistReportTypeLabel(r.list_type),
            r.list_type,
          ]
            .join(" ")
            .toLowerCase();
          return blob.includes(q);
        });
      }
      moderationNoteEl.textContent =
        `マイリスト通報（表示中）: ${items.length}件 / 全件: ${cachedMylistReports.length}件 · Note ${cachedNoteReports.length}件 / コミュニティ ${cachedReports.length}件`;
      if (!items.length) {
        const li = document.createElement("li");
        li.className = "mll-log-item";
        li.textContent = cachedMylistReports.length
          ? "検索条件に一致するマイリスト通報はありません。"
          : "マイリスト通報の記録はまだありません。";
        moderationListEl.appendChild(li);
        return;
      }
      for (const r of items) {
        const li = document.createElement("li");
        li.className = "mll-log-item";
        const title = document.createElement("p");
        title.className = "mll-log-title";
        title.textContent = `${mylistReportTypeLabel(r.list_type)} — 通報`;
        const meta = document.createElement("p");
        meta.className = "mll-log-meta";
        meta.textContent = `通報日時: ${formatDateTimeJa(r.created_at)} / 通報者: ${r.reporter_id || "（不明）"} / 対象UID: ${
          r.target_uid || "（不明）"
        } / リスト: ${r.list_id || "（不明）"}`;
        const reasonEl = document.createElement("p");
        reasonEl.className = "moderation-report-note";
        reasonEl.textContent = r.reason ? `理由: ${r.reason}` : "理由: （未記入）";
        const linkRow = document.createElement("p");
        linkRow.className = "community-post-actions";
        const a = document.createElement("a");
        a.className = "btn-reset-search";
        const tab = r.list_type === "yt" ? "yt" : "videos";
        const uid = encodeURIComponent(String(r.target_uid || "").trim());
        const lid = encodeURIComponent(String(r.list_id || "").trim());
        a.href = `#profile?uid=${uid}&tab=${tab}&mylist=${lid}`;
        a.textContent = "該当プロフィールのマイリストへ";
        linkRow.appendChild(a);
        li.appendChild(title);
        li.appendChild(meta);
        li.appendChild(reasonEl);
        li.appendChild(linkRow);
        moderationListEl.appendChild(li);
      }
      return;
    }

    if (toolbar) toolbar.hidden = false;
    const bulkHost = document.getElementById("moderation-bulk-actions");
    if (bulkHost) bulkHost.hidden = false;
    const reportByPost = new Map();
    for (const r of cachedReports) {
      if (!reportByPost.has(r.post_id)) reportByPost.set(r.post_id, []);
      reportByPost.get(r.post_id).push(r);
    }
    let rows = cachedPosts
      .map((p) => ({ post: p, reports: reportByPost.get(p.id) || [] }))
      .filter((x) => x.reports.length > 0)
      .sort((a, b) => String(b.reports[0]?.created_at || "").localeCompare(String(a.reports[0]?.created_at || "")));

    if (moderationSearchQuery) {
      const q = moderationSearchQuery.toLowerCase();
      rows = rows.filter((x) => {
        const p = x.post;
        const auth = resolveAuthor(p);
        return (auth.name || "").toLowerCase().includes(q) ||
          (p.content || "").toLowerCase().includes(q) ||
          (p.theme || "").toLowerCase().includes(q);
      });
    }

    moderationNoteEl.textContent = `通報対象投稿: ${rows.length}件 / コミュニティ通報履歴: ${cachedReports.length}件（マイリスト ${cachedMylistReports.length}件・Note ${cachedNoteReports.length}件は各タブ）`;
    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "mll-log-item";
      li.textContent = "現在、確認が必要な通報はありません。";
      moderationListEl.appendChild(li);
      return;
    }
    for (const row of rows) {
      const p = row.post;
      const { themeLabel, titleLabel } = resolveModerationHeading(p);
      const li = document.createElement("li");
      li.className = "mll-log-item";
      if (p.hidden) li.classList.add("community-thread--admin-hidden");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "moderation-item-checkbox";
      cb.dataset.postId = p.id;
      li.appendChild(cb);
      const title = document.createElement("p");
      title.className = "mll-log-title";
      let suffix = "";
      if (!isThreadRoot(p)) {
        suffix =
          p.parent_post_id && p.parent_post_id !== p.thread_root_id ? "（ネスト返信）" : "（返信）";
      }
      title.textContent = `【${themeLabel}】${titleLabel}${suffix}`;
      const meta = document.createElement("p");
      meta.className = "mll-log-meta";
      const modAuth = resolveAuthor(p);
      meta.textContent = `投稿者: ${modAuth.name} / 投稿: ${formatDateTimeJa(p.created_at)} / 状態: ${
        p.hidden ? "非表示" : "公開"
      }`;
      const body = document.createElement("p");
      body.className = "moderation-report-note";
      body.textContent = String(p.content || "").trim();
      const note = document.createElement("p");
      note.className = "moderation-report-note";
      note.textContent = row.reports
        .map((r) => `${formatDate(r.created_at)} ${r.reporter_name}: ${r.reason || "理由未記入"}`)
        .join("\n");
      const actions = document.createElement("div");
      actions.className = "community-post-actions";
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "btn-reset-search community-post-manage-btn community-post-manage-btn--moderation";
      toggleBtn.textContent = p.hidden ? "復元" : "非表示";
      toggleBtn.addEventListener("click", () => void toggleHidden(p.id, !p.hidden));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn-reset-search";
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", () => void deletePost(p.id));
      actions.appendChild(toggleBtn);
      actions.appendChild(delBtn);
      li.appendChild(title);
      li.appendChild(meta);
      li.appendChild(body);
      appendImageGallery(li, p.image_urls, modAuth.withdrawn);
      li.appendChild(note);
      li.appendChild(actions);
      moderationListEl.appendChild(li);
    }
  }

  const modSearchInput = document.getElementById("moderation-search");
  if (modSearchInput) {
    let mTimer = null;
    modSearchInput.addEventListener("input", () => {
      clearTimeout(mTimer);
      mTimer = setTimeout(() => {
        moderationSearchQuery = modSearchInput.value.trim();
        renderModeration();
      }, 250);
    });
  }

  if (moderationViewTabBtns.length) {
    moderationViewTabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = String(btn.getAttribute("data-moderation-view") || "").trim();
        if (v !== "community" && v !== "mylist" && v !== "note") return;
        moderationView = v;
        setTabGroupSelected(moderationViewTabBtns, moderationView, "data-moderation-view");
        if (modSearchInput) {
          modSearchInput.placeholder =
            v === "mylist"
              ? "対象UID・リストID・理由・種別で絞り込み…"
              : v === "note"
                ? "対象UID・イベントID・Noteタイトル・理由で絞り込み…"
                : "投稿者名・内容で絞り込み…";
        }
        renderModeration();
      });
    });
  }

  const modSelectAll = document.getElementById("moderation-select-all");
  if (modSelectAll) {
    modSelectAll.addEventListener("change", () => {
      moderationListEl.querySelectorAll(".moderation-item-checkbox").forEach((cb) => { cb.checked = modSelectAll.checked; });
    });
  }

  function getSelectedPostIds() {
    return [...moderationListEl.querySelectorAll(".moderation-item-checkbox:checked")].map((cb) => cb.dataset.postId).filter(Boolean);
  }

  const bulkHideBtn = document.getElementById("moderation-bulk-hide");
  if (bulkHideBtn) {
    bulkHideBtn.addEventListener("click", async () => {
      const ids = getSelectedPostIds();
      if (!ids.length || !confirm(`${ids.length}件を一括非表示にしますか？`)) return;
      bulkHideBtn.disabled = true;
      try {
        const me = currentUser();
        const db = getDb();
        for (const id of ids) {
          const post = cachedPosts.find((x) => x.id === id);
          if (!post || post.hidden) continue;
          const updated = { ...post, hidden: true, hidden_at: new Date().toISOString(), hidden_by: me?.id || "", hidden_reason: "一括非表示", updated_at: new Date().toISOString() };
          await updatePost(updated);
        }
        setMsg(`${ids.length}件を非表示にしました。`);
        await refreshAll();
      } finally {
        bulkHideBtn.disabled = false;
      }
    });
  }

  const bulkDeleteBtn = document.getElementById("moderation-bulk-delete");
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener("click", async () => {
      const ids = getSelectedPostIds();
      if (!ids.length || !confirm(`${ids.length}件を一括削除しますか？この操作は取り消せません。`)) return;
      bulkDeleteBtn.disabled = true;
      try {
        const db = getDb();
        if (db) {
          const CHUNK = 400;
          for (let i = 0; i < ids.length; i += CHUNK) {
            const batch = db.batch();
            ids.slice(i, i + CHUNK).forEach((id) => batch.delete(db.collection("mll_community_posts").doc(id)));
            await batch.commit();
          }
        } else {
          const drop = new Set(ids);
          saveLocalPosts(loadLocalPosts().filter((p) => !drop.has(p.id)));
        }
        setMsg(`${ids.length}件を削除しました。`);
        await refreshAll();
      } finally {
        bulkDeleteBtn.disabled = false;
      }
    });
  }

  function isAuthRedirectPending() {
    return Boolean(window.MLL_AUTH?.isRedirectPending?.());
  }

  function syncLoginUI(user, profile) {
    const loggedIn = Boolean(user?.id);
    const redirectPending = isAuthRedirectPending();
    const withdrawn = Boolean(window.MLL_AUTH?.isWithdrawn?.() || profile?.withdrawn);
    const canUseImages = loggedIn && storageAvailable() && !withdrawn;
    submitBtn.disabled = !loggedIn || withdrawn;
    titleEl.disabled = !loggedIn || withdrawn;
    contentEl.disabled = !loggedIn || withdrawn;
    if (openComposeBtn) openComposeBtn.disabled = !loggedIn || withdrawn;
    formThemeTabs.forEach((el) => {
      el.disabled = !loggedIn || withdrawn;
    });
    if (formThemeSelect instanceof HTMLSelectElement) {
      formThemeSelect.disabled = !loggedIn || withdrawn;
    }
    topicImageSlots?.setEnabled(canUseImages);
    if (topicImagesNote) {
      topicImagesNote.textContent = canUseImages
        ? `アップロード時に自動で圧縮。（元が${Math.floor(rawInputMaxBytes() / 1048576)}MB超は不可）`
        : "画像付き投稿を使う場合は Firebase で Storage を有効化し auth-config の storageBucket を設定してください（未設定時はテキストのみ）。";
    }

    if (redirectPending) {
      if (openComposeBtn) openComposeBtn.disabled = true;
      setFeedMsg("ログイン処理中です。認証完了までお待ちください。", false);
      return;
    }

    if (!loggedIn) {
      if (openComposeBtn) openComposeBtn.disabled = false;
      topicImageSlots?.reset?.();
      if (boardGuestHintEl instanceof HTMLElement) boardGuestHintEl.hidden = false;
      syncComposeThemeOptionsVisibility();
      return;
    }
    if (boardGuestHintEl instanceof HTMLElement) boardGuestHintEl.hidden = true;
    syncComposeThemeOptionsVisibility();
  }

  async function fetchThreadPostsByRootId(threadRootId) {
    const db = getDb();
    if (!db || !threadRootId) return [];
    try {
      const snap = await db.collection("mll_community_posts").where("thread_root_id", "==", threadRootId).get();
      return snap.docs.map((d) => mapPost({ id: d.id, ...(d.data() || {}) }));
    } catch {
      return [];
    }
  }

  async function mergeThreadIntoCache(threadRootId) {
    if (!threadRootId) return false;
    if (cachedPosts.some((p) => p.id === threadRootId)) return true;
    const db = getDb();
    if (!db) return false;
    try {
      const rootSnap = await db.collection("mll_community_posts").doc(threadRootId).get();
      if (!rootSnap.exists) return false;
      const root = mapPost({ id: rootSnap.id, ...(rootSnap.data() || {}) });
      if (root.hidden && !isAdmin()) return false;
      if (!boardPostVisibleToViewer(root)) {
        setFeedMsg("雑談・質問カテゴリーの話題は、ログインすると閲覧できます。", false);
        return false;
      }
      const threadPosts = await fetchThreadPostsByRootId(threadRootId);
      const ids = new Set(cachedPosts.map((p) => p.id));
      for (const p of threadPosts) {
        if (!ids.has(p.id) && (!p.hidden || isAdmin()) && boardPostVisibleToViewer(p)) {
          cachedPosts.push(p);
          ids.add(p.id);
        }
      }
      return cachedPosts.some((p) => p.id === threadRootId);
    } catch {
      if (!currentUser()?.id) {
        setFeedMsg("雑談・質問カテゴリーの話題は、ログインすると閲覧できます。", false);
      }
      return false;
    }
  }

  function tryFocusCommunityThread(focusId) {
    const id = String(focusId || pendingCommunityThreadFocusId() || "").trim();
    if (!id || !listEl) return;
    try {
      sessionStorage.removeItem(SS_COMM_THREAD_FOCUS);
    } catch {
      //
    }
    const esc =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    window.requestAnimationFrame(() => {
      const row = listEl.querySelector(`li[data-mz-thread-root="${esc}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "start" });
      row.classList.add("community-thread--highlight");
      window.setTimeout(() => row.classList.remove("community-thread--highlight"), 4200);
    });
  }

  async function refreshAll() {
    const [posts, reports, mylistReports, noteReports] = await Promise.all([
      readPosts(),
      readReports(),
      readMylistReports(),
      readNoteReports(),
    ]);
    cachedPosts = posts;
    cachedReports = reports;
    cachedMylistReports = mylistReports;
    cachedNoteReports = noteReports;
    await hydrateAuthorProfilesForPosts(cachedPosts);
    const focusId = pendingCommunityThreadFocusId();
    if (focusId) {
      await mergeThreadIntoCache(focusId);
      await hydrateAuthorProfilesForPosts(cachedPosts);
    }
    renderPosts(cachedPosts);
    renderModeration();
    tryFocusCommunityThread(focusId);
  }

  filterTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = String(btn.getAttribute("data-community-filter") || "").trim();
      if (v === THEME_MEMBERS_ONLY && !currentUser()?.id) {
        navigateToCommunityLoginForMembersBoard();
        return;
      }
      activeDisplayTab = (v === FILTER_ALL || THEMES.includes(v)) ? v : FILTER_ALL;
      setTabGroupSelected(filterTabs, activeDisplayTab, "data-community-filter");
      renderPosts(cachedPosts);
      if (composeOverlayActive) syncComposeThemeFromBoardFilter();
    });
  });

  const communitySearchInput = document.getElementById("community-board-search");
  if (communitySearchInput) {
    let sTimer = null;
    communitySearchInput.addEventListener("input", () => {
      clearTimeout(sTimer);
      sTimer = setTimeout(() => {
        communitySearchQuery = communitySearchInput.value.trim();
        window.MarchinZTrackEvent?.("community_search_run", {
          has_query: communitySearchQuery ? 1 : 0,
        });
        renderPosts(cachedPosts);
      }, 250);
    });
  }

  formThemeTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = String(btn.getAttribute("data-community-form-theme") || "").trim();
      if (!THEMES.includes(v) || !themeAllowedForCompose(v)) return;
      syncFormThemeUi(v);
      setFieldError(errorThemeEl, "");
    });
  });

  if (formThemeSelect instanceof HTMLSelectElement) {
    formThemeSelect.addEventListener("change", () => {
      const v = String(formThemeSelect.value || "").trim();
      if (!THEMES.includes(v) || !themeAllowedForCompose(v)) {
        syncFormThemeUi(defaultComposeTheme());
        return;
      }
      syncFormThemeUi(v);
      setFieldError(errorThemeEl, "");
    });
  }

  openComposeBtn.addEventListener("click", () => {
    if (isAuthRedirectPending()) return;
    setFeedMsg("", false);
    if (!currentUser()?.id) {
      navigateToCommunityLogin("community_compose");
      return;
    }
    openComposeOverlay();
  });

  composeOverlay.addEventListener(
    "click",
    (ev) => {
      if (!ev.target.closest("[data-community-compose-close]")) return;
      closeComposeOverlay();
    },
    true,
  );

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    clearFormErrors();
    const user = currentUser();
    if (!user?.id) {
      navigateToCommunityLogin("community_submit");
      return;
    }
    if (window.MLL_AUTH?.isWithdrawn?.()) {
      setMsg("退会済みのアカウントでは投稿できません。", true);
      return;
    }
    if (window.MLL_AUTH?.isLegalGateBlocking?.()) {
      setMsg("利用規約・プライバシーポリシーへの同意が完了するまで投稿できません。", true);
      return;
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("post")) {
      setMsg("投稿の頻度が高すぎます。しばらく待ってから再度お試しください。", true);
      return;
    }

    const editId = String(composeEditingPostId || "").trim();
    if (editId) {
      const post = cachedPosts.find((x) => x.id === editId);
      if (!post) {
        setMsg("対象の投稿が見つかりません。", true);
        return;
      }
      if (post.user_id !== user.id && !isAdmin()) {
        setMsg("この投稿を編集する権限がありません。", true);
        return;
      }
      if (post.user_id === user.id && authorWithdrawn(user.id) && !isAdmin()) {
        setMsg("退会済みのアカウントでは編集できません。", true);
        return;
      }
      const isRoot = isThreadRoot(post);
      const content = String(contentEl.value || "").trim();
      let nextTitle = String(post.title || "").trim();
      let normalizedTheme = normalizeTheme(post.theme);
      if (isRoot) {
        const theme = String(selectedFormTheme() || "").trim();
        normalizedTheme = normalizeTheme(theme);
        if (!THEMES.includes(normalizedTheme)) {
          setFieldError(errorThemeEl, "選択してください");
          setMsg("カテゴリを選択してください。", true);
          return;
        }
        if (rejectThemeForCompose(normalizedTheme)) return;
        nextTitle = String(titleEl.value || "").trim();
        if (!nextTitle) {
          setFieldError(errorTitleEl, "入力してください");
          setMsg("必須項目を入力してください。", true);
          return;
        }
      }
      const existingUrls = topicImageSlots.getExistingUrls();
      const newFiles = topicImageSlots.getFiles().slice(0, MAX_COMMUNITY_IMAGES);
      if (!content && !existingUrls.length && !newFiles.length) {
        setFieldError(errorContentEl, "入力してください");
        setMsg("本文または画像を入力してください。", true);
        return;
      }
      if (newFiles.length && !storageAvailable()) {
        setMsg("画像の追加には Firebase Storage が必要です。", true);
        return;
      }
      submitBtn.disabled = true;
      showBusyOverlay();
      try {
        let image_urls = existingUrls.slice();
        if (newFiles.length) {
          const uploaded = await buildImageUrlsFromFiles(user.id, newFiles);
          image_urls = image_urls.concat(uploaded).slice(0, MAX_COMMUNITY_IMAGES);
        }
        const updated = {
          ...post,
          title: isRoot ? nextTitle : "",
          content,
          theme: normalizedTheme,
          image_urls,
          updated_at: new Date().toISOString(),
        };
        await updatePost(updated);
        topicImageSlots.reset();
        setMsg("");
        closeComposeOverlay({ skipPersist: true });
        clearCommunityComposeDraft();
        setFeedMsg(isRoot ? "話題を更新しました。" : "返信を更新しました。");
        await refreshAll();
      } catch (e) {
        if (String(e?.message || "") === window.MarchinZImage?.ERR_TOO_LARGE) {
          setMsg("大きすぎる画像は投稿できません。", true);
        } else {
          setMsg(communityFriendlyErrorMessage(e, COMMUNITY_MESSAGE.postFailed), true);
          window.alert(
            `code: ${String(e?.code || "unknown")}\nmessage: ${String(e?.message || COMMUNITY_MESSAGE.postFailed)}`,
          );
        }
      } finally {
        const w = Boolean(window.MLL_AUTH?.isWithdrawn?.());
        submitBtn.disabled = !Boolean(currentUser()?.id) || w;
        hideBusyOverlay();
      }
      return;
    }

    const title = String(titleEl.value || "").trim();
    const content = String(contentEl.value || "").trim();
    const files = topicImageSlots.getFiles().slice(0, MAX_COMMUNITY_IMAGES);
    const theme = String(selectedFormTheme() || "").trim();
    const normalizedTheme = normalizeTheme(theme);
    if (!THEMES.includes(normalizedTheme)) {
      setFieldError(errorThemeEl, "選択してください");
      setMsg("カテゴリを選択してください。", true);
      return;
    }
    if (rejectThemeForCompose(normalizedTheme)) return;
    if (!title) {
      setFieldError(errorTitleEl, "入力してください");
      setMsg("必須項目を入力してください。", true);
      return;
    }
    if (!content) {
      setFieldError(errorContentEl, "入力してください");
      setMsg("必須項目を入力してください。", true);
      return;
    }
    if (files.length && !storageAvailable()) {
      setMsg("画像付き投稿には Firebase Storage が必要です。", true);
      return;
    }
    submitBtn.disabled = true;
    showBusyOverlay();
    let image_urls = [];
    try {
      if (files.length) image_urls = await buildImageUrlsFromFiles(user.id, files);
      if (!content.trim() && !image_urls.length) {
        setFieldError(errorContentEl, "入力してください");
        setMsg("本文または画像を投稿してください。", true);
        return;
      }
      const p = await fetchProfile(user);
      const now = new Date().toISOString();
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const post = {
        id,
        theme: normalizedTheme,
        thread_root_id: id,
        title,
        content: content.trim(),
        image_urls,
        liked_by: {},
        created_at: now,
        updated_at: now,
        user_id: user.id,
        user_name: p.display_name || "ユーザー",
        user_avatar: p.avatar_url || "",
      };
      await writePost(post);
      window.MarchinZAdminUgcLog?.recordBoardPost?.({
        postId: id,
        title,
        theme: normalizedTheme,
        actorUid: user.id,
        actorName: p.display_name || "ユーザー",
      });
      window.MarchinZTrackEvent?.("community_post_submit", {
        has_image: image_urls.length > 0 ? 1 : 0,
        theme: normalizedTheme,
      });
      form.reset();
      topicImageSlots.reset();
      clearCommunityComposeDraft();
      const firstFt = THEMES[0];
      syncFormThemeUi(firstFt);
      setMsg("");
      closeComposeOverlay();
      setFeedMsg("話題を投稿しました。");
      window.location.reload();
      return;
    } catch (e) {
      const errCode = String(e?.code || "");
      const errMsg = String(e?.message || "");
      if (String(e?.message || "") === window.MarchinZImage?.ERR_TOO_LARGE) {
        setMsg("大きすぎる画像は投稿できません。", true);
      } else if (errCode === "storage/unauthorized" || errMsg.includes("storage/unauthorized")) {
        setMsg(
          "画像のアップロードが拒否されました。Firebase Console の Storage ルール（firebase/storage.rules）を本番にデプロイしてください。",
          true,
        );
      } else {
        setMsg(communityFriendlyErrorMessage(e, COMMUNITY_MESSAGE.postFailed), true);
      }
      if (errCode !== "storage/unauthorized" && !errMsg.includes("storage/unauthorized")) {
        window.alert(`code: ${(e?.code || "unknown").toString()}\nmessage: ${(e?.message || COMMUNITY_MESSAGE.postFailed).toString()}`);
      }
    } finally {
      const w = Boolean(window.MLL_AUTH?.isWithdrawn?.());
      submitBtn.disabled = !Boolean(currentUser()?.id) || w;
      hideBusyOverlay();
    }
  });

  window.addEventListener("mll-auth-changed", async (ev) => {
    const user = ev.detail?.user || null;
    if (user?.id) {
      let wantCompose = false;
      try {
        wantCompose = sessionStorage.getItem(SS_INTENT_COMMUNITY_COMPOSE) === "1";
      } catch {
        wantCompose = false;
      }
      if (wantCompose) {
        try {
          sessionStorage.removeItem(SS_INTENT_COMMUNITY_COMPOSE);
        } catch {
          //
        }
        const raw = window.location.hash.replace(/^#/, "");
        if (raw === "community") {
          setFeedMsg("", false);
          openComposeOverlay();
        }
      }
    }
    const p = user ? await fetchProfile(user) : profileFallback(null);
    syncLoginUI(user, p);
    await refreshAll();
  });

  window.addEventListener("marchinz-like-show-changed", async () => {
    const user = currentUser();
    const p = user ? await fetchProfile(user) : profileFallback(null);
    syncLoginUI(user, p);
    await refreshAll();
  });

  setTabGroupSelected(filterTabs, FILTER_ALL, "data-community-filter");
  syncFormThemeUi(defaultComposeTheme());
  syncComposeThemeOptionsVisibility();

  function isCommunityHashRoute(raw) {
    const base = String(raw || "")
      .replace(/^#/, "")
      .trim()
      .split(/[?&#]/)[0] || "";
    return base === "community" || base.startsWith("community/");
  }

  window.addEventListener("hashchange", () => {
    const raw = window.location.hash.replace(/^#/, "").trim();
    if (isCommunityHashRoute(raw)) {
      tryFocusCommunityThread(parseCommunityBoardRoute().threadId);
      if (currentUser()?.id) {
        try {
          if (sessionStorage.getItem(SS_INTENT_COMMUNITY_COMPOSE) === "1") {
            sessionStorage.removeItem(SS_INTENT_COMMUNITY_COMPOSE);
            setFeedMsg("", false);
            openComposeOverlay();
          }
        } catch {
          //
        }
      }
      return;
    }
    if (!isCommunityHashRoute(raw)) {
      window.MarchinZCommunityComposeDraft?.onLeaveBoard?.();
    }
    if (!currentUser()?.id && page !== "signup" && page !== "login") {
      try {
        sessionStorage.removeItem(SS_INTENT_COMMUNITY_COMPOSE);
      } catch {
        //
      }
    }
  });

  window.addEventListener("marchinz-community-focus-thread", () => {
    void refreshAll();
  });

  window.MarchinZResetCommunityBoardFilter = function () {
    activeDisplayTab = FILTER_ALL;
    setTabGroupSelected(filterTabs, FILTER_ALL, "data-community-filter");
    scrollCommunityBoardTabStripsToStart();
    renderPosts(cachedPosts);
  };

  window.MarchinZCommunityComposeDraft = {
    onLeaveBoard: onCommunityComposeLeaveBoard,
    onEnterBoard: onCommunityComposeEnterBoard,
  };

  if (titleEl) titleEl.addEventListener("input", scheduleCommunityComposeDraftSave);
  if (contentEl) contentEl.addEventListener("input", scheduleCommunityComposeDraftSave);
  formThemeTabs.forEach((btn) => {
    btn.addEventListener("click", scheduleCommunityComposeDraftSave);
  });
  if (formThemeSelect) formThemeSelect.addEventListener("change", scheduleCommunityComposeDraftSave);

  (async () => {
    const redirectPending = isAuthRedirectPending();
    const user = currentUser();
    if (redirectPending && !user?.id) {
      syncLoginUI(null, null);
      return;
    }
    const p = user ? await fetchProfile(user) : profileFallback(null);
    syncLoginUI(user, p);
    await refreshAll();
  })();
})();
