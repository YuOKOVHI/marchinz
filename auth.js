(() => {
  const WITHDRAWN_NAME = "退会ユーザー";
  const AUTH_RETURN_STORAGE_KEY = "mll_auth_return_to";
  const AUTH_ENTRY_MODE_STORAGE_KEY = "mll_auth_entry_mode";
  const AUTH_REDIRECT_PENDING_KEY = "mll_auth_redirect_pending";
  const DEV_LOCAL_LOGIN_STORAGE_KEY = "mz_dev_local_login_user";
  const RETURN_PAGE_IDS = new Set([
    "mll",
    "events",
    "community",
    "moderation",
    "videos",
    "youtube",
    "webmagazine",
    "creators",
    "ops",
    "terms",
    "privacy",
  ]);

  const cfg = window.MLL_AUTH_CONFIG || {};
  const firebaseCfg = cfg.firebase || {};
  const publicRedirectUrl = String(cfg.publicRedirectUrl || "https://marchinz.netlify.app/#top").trim();
  const adminEmails = new Set(
    (Array.isArray(cfg.adminEmails) ? cfg.adminEmails : [])
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean)
  );

  const firebaseHintEl = document.getElementById("site-brand-firebase-hint");
  const headerProfileAvatar = document.getElementById("header-profile-avatar");
  const headerProfileName = document.getElementById("header-profile-name");
  const siteBrandUserArea = document.getElementById("site-brand-user-area");
  const siteMobileDrawerGuest = document.getElementById("site-mobile-drawer-guest");
  const siteMobileDrawerUser = document.getElementById("site-mobile-drawer-user");
  const mobileDrawerAvatar = document.getElementById("mobile-drawer-profile-avatar");
  const mobileDrawerName = document.getElementById("mobile-drawer-profile-name");
  const menuMobileProfileEdit = document.getElementById("menu-mobile-open-profile-edit");
  const menuMobileSettings = document.getElementById("menu-mobile-open-settings");
  const btnMobileLogout = document.getElementById("btn-mobile-logout");
  const btnAccountMenuToggle = document.getElementById("btn-user-account-toggle");
  const userAccountDropdown = document.getElementById("user-account-dropdown");
  const menuOpenProfileEdit = document.getElementById("menu-open-profile-edit");
  const menuOpenSettings = document.getElementById("menu-open-settings");
  const profileDialog = document.getElementById("mz-profile-dialog");
  const settingsDialog = document.getElementById("mz-settings-dialog");
  const withdrawDoneDialog = document.getElementById("mz-withdraw-done-dialog");

  const btnLogout = document.getElementById("btn-logout");
  const profileForm = document.getElementById("profile-form");
  const inputDisplayName = document.getElementById("profile-display-name");
  const inputAvatarFile = document.getElementById("profile-avatar-file");
  const inputCoverFile = document.getElementById("profile-cover-file");
  const btnProfileCancel = document.getElementById("btn-profile-cancel");
  const btnAccountWithdraw = document.getElementById("btn-account-withdraw");
  const btnAccountWithdrawToggle = document.getElementById("btn-account-withdraw-toggle");
  const withdrawDetail = document.getElementById("mz-withdraw-detail");
  const profilePrefecture = document.getElementById("profile-prefecture");
  const profileAddressPrefecturePublic = document.getElementById("profile-address-prefecture-public");
  const profileGender = document.getElementById("profile-gender");
  const profileBirthdate = document.getElementById("profile-birthdate");
  const profileBio = document.getElementById("profile-bio");
  const siteBrandActions = document.getElementById("site-brand-actions");
  const btnAuthLoginGoogle = document.getElementById("btn-auth-login-google");
  const btnAuthSignupGoogle = document.getElementById("btn-auth-signup-google");
  const authLoginRememberSession = document.getElementById("auth-login-remember-session");
  const authSignupAgreeTerms = document.getElementById("auth-signup-agree-terms");
  const authSignupAgreePrivacy = document.getElementById("auth-signup-agree-privacy");
  const authSignupAge13 = document.getElementById("auth-signup-age-13");
  const authSignupAgreeStatsSharing = document.getElementById("auth-signup-agree-stats-sharing");
  const legalPolicyDialog = document.getElementById("mz-legal-policy-dialog");
  const legalGateAgreeCheckbox = document.getElementById("mz-legal-gate-agree-checkbox");
  const btnLegalGateAccept = document.getElementById("btn-legal-gate-accept");
  const btnLegalGateSignout = document.getElementById("btn-legal-gate-signout");
  const legalGateError = document.getElementById("mz-legal-gate-error");
  const authSignupConsentMsg = document.getElementById("auth-signup-consent-msg");
  const authLoginMsg = document.getElementById("auth-login-msg");
  const authSignupMsg = document.getElementById("auth-signup-msg");
  const authLoadingOverlay = document.getElementById("auth-loading-overlay");
  const authLoadingText = authLoadingOverlay?.querySelector(".auth-loading-text");
  const DEFAULT_AUTH_LOADING_TEXT = "ログイン中...";

  /** Firebase 初期化後に差し替え（未設定時は空振り） */
  let hydrateProfileForm = async () => {};

  /** メールは画面・getUser には出さず、管理者判定だけ raw の Auth から読む */
  let rawAuthUserForAdmin = null;
  let currentUser = null;

  let currentProfileWithdrawn = false;
  /** 利用規約・ポリシー同意モーダル表示中は主要操作をブロックする */
  let legalGateBlocking = false;
  /** @type {(() => void) | null} */
  let legalGatePromiseResolve = null;
  let accountDropdownOpen = false;
  let profileSetupRequired = false;
  let authEntryBusy = false;
  let signupConsentTried = false;
  let lastRedirectAuthErrorCode = "";
  const AUTH_REMEMBER_STORAGE_KEY = "mll_auth_remember_session";
  const AUTH_BUSY_TEXT = "処理中...";
  const authButtonLabelStore = new WeakMap();
  const DEFAULT_COVER_IMAGE_URL = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f2138"/><stop offset="100%" stop-color="#20456f"/></linearGradient></defs><rect width="1200" height="360" fill="url(#g)"/><circle cx="1040" cy="86" r="128" fill="rgba(255,255,255,0.08)"/><circle cx="980" cy="304" r="170" fill="rgba(255,255,255,0.07)"/><text x="68" y="210" fill="#ffffff" font-size="74" font-family="Arial, sans-serif" font-weight="700" letter-spacing="2">MarchinZ</text></svg>',
  )}`;

  /**
   * 住所の都道府県の選択 UI（イベント開催地のプルダウンと見た目を揃えるのみ）。
   * Firestore は profile_address_prefecture（イベントの都道府県フィールドとは別管理）。
   */
  const PROFILE_JP_PREF_GROUPS = [
    {
      label: "地域：関東",
      prefs: ["東京都", "神奈川県", "埼玉県", "千葉県", "茨城県", "栃木県", "群馬県"],
    },
    {
      label: "地域：関西",
      prefs: ["大阪府", "兵庫県", "京都府", "和歌山県", "滋賀県", "奈良県"],
    },
    { label: "地域：北海道", prefs: ["北海道"] },
    {
      label: "地域：東北",
      prefs: ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"],
    },
    {
      label: "地域：中部",
      prefs: ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県"],
    },
    {
      label: "地域：中国",
      prefs: ["鳥取県", "島根県", "岡山県", "広島県", "山口県"],
    },
    {
      label: "地域：四国",
      prefs: ["徳島県", "香川県", "愛媛県", "高知県"],
    },
    {
      label: "地域：九州",
      prefs: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県"],
    },
    { label: "地域：沖縄", prefs: ["沖縄県"] },
    { label: "地域：その他", prefs: ["海外"] },
  ];
  const PROFILE_JP_PREFS = PROFILE_JP_PREF_GROUPS.flatMap((g) => g.prefs);
  const PROFILE_JP_PREFS_SET = new Set(PROFILE_JP_PREFS);
  const PROFILE_GENDER_VALUES = ["男性", "女性", "その他", "無回答"];
  const PROFILE_SENSITIVE_PRIVATE_COLLECTION = "profile_private";
  const PROFILE_SENSITIVE_PRIVATE_DOC_ID = "default";
  /** Firestore の legal_policy_accepted_version と一致させる。改定時は値を上げて再同意フローを発火する。 */
  const LEGAL_POLICY_VERSION = "2026-05-09-v2";

  /**
   * @param {HTMLSelectElement | null} sel
   */
  function fillProfilePrefectureSelect(sel) {
    if (!sel || sel.dataset.mzPrefFilled === "1") return;
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "選択してください";
    sel.appendChild(ph);
    for (const group of PROFILE_JP_PREF_GROUPS) {
      const heading = document.createElement("option");
      heading.value = "";
      heading.disabled = true;
      heading.textContent = `【${group.label}】`;
      sel.appendChild(heading);
      for (const p of group.prefs) {
        const o = document.createElement("option");
        o.value = p;
        o.textContent = p;
        sel.appendChild(o);
      }
    }
    sel.dataset.mzPrefFilled = "1";
  }

  let hydrateLikeShowForm = async () => {};
  let persistLikeShowField = async (_field, _checked) => {};

  const LIKE_SHOW_FIELD_NAMES = [
    "like_show_mll",
    "like_show_community",
    "like_show_calendar",
    "like_show_video_bookmark",
    "like_show_channel_bookmark",
    "like_show_log_diary",
  ];
  const LIKE_SHOW_FIELD_SET = new Set(LIKE_SHOW_FIELD_NAMES);

  function setFirebaseHintVisible(message) {
    if (!firebaseHintEl) return;
    if (message) {
      firebaseHintEl.textContent = message;
      firebaseHintEl.hidden = false;
    } else {
      firebaseHintEl.textContent = "";
      firebaseHintEl.hidden = true;
    }
  }

  const AUTH_MESSAGE = {
    agreeRequired:
      "利用規約・プライバシーポリシー、13歳以上の確認、統計データの第三者提供について、すべてにチェックを入れてください。",
    firebaseMissingSimple: "Firebase が未設定です。auth-config.js を確認してください。",
    storageUnavailable: "Firebase Storage が利用できないため画像を保存できません。",
    fileTooLarge: "ファイルサイズが大きすぎます。20MB以下の画像を選択してください",
    saveFailed: "保存に失敗しました。時間をおいて再度お試しください。",
    accountBanned:
      "このアカウントは現在ご利用いただけません。お問い合わせは「運営」のフォームからご連絡ください。",
    withdrawNeedReauth:
      "退会を完了するには、Googleアカウントの再認証が必要です。キャンセルした場合、退会は実行されません。",
    withdrawRetryAfterRelogin:
      "Google連携の解除に失敗しました。いったんログアウトし、再ログイン後にもう一度「退会」をお試しください。",
    withdrawPartialFailure:
      "退会処理の途中でエラーが発生しました。一部のみ処理されている可能性があります。時間をおいて再実行してください。",
    withdrawNeedsFirebaseAuth:
      "退会は Firebase に Google でログインしているときのみ実行できます。\nlocalhost の開発者用ログインだけの状態では、認証ユーザーが存在しないため完了できません。",
  };

  function authFriendlyErrorMessage(err, fallback) {
    const code = String(err?.code || "").trim();
    if (code === "auth/popup-closed-by-user") return "ログインがキャンセルされました。";
    if (code === "auth/popup-blocked") return "ポップアップがブロックされました。ブラウザ設定を確認して再度お試しください。";
    if (code === "auth/cancelled-popup-request") return "認証画面が中断されました。もう一度お試しください。";
    if (code === "auth/unauthorized-domain")
      return "このURLはFirebaseの承認済みドメインに未登録です。Authorized domainsを確認してください。";
    if (code === "auth/network-request-failed") return "通信エラーが発生しました。通信環境をご確認ください。";
    if (code === "auth/too-many-requests") return "試行回数が多すぎます。少し時間をおいてからお試しください。";
    if (code === "auth/user-disabled") return "このアカウントは現在ご利用いただけません。";
    if (code === "permission-denied")
      return "データの保存が許可されませんでした。Firebase の Firestore ルールを確認してください。";
    if (code === "storage/unauthorized" || code === "storage/canceled")
      return "画像ストレージへの保存が許可されませんでした。Storage のルールとログイン状態を確認してください。";
    if (code.startsWith("storage/"))
      return `画像の保存に失敗しました（${code}）。ファイル形式は JPEG（自動変換済み）か確認してください。`;
    return fallback;
  }

  function isUsableImageUrl(raw) {
    const s = String(raw || "").trim();
    return /^https?:\/\//i.test(s) || /^data:image\//i.test(s);
  }

  function firstDisplayChar(name) {
    const t = String(name || "").trim();
    return t ? Array.from(t)[0].toUpperCase() : "M";
  }

  function createInitialAvatarDataUrl(name) {
    const ch = firstDisplayChar(name);
    return `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" rx="96" fill="#1e3a5f"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="86" font-family="Arial, sans-serif" font-weight="700">${ch}</text></svg>`,
    )}`;
  }

  function getProfileAvatarSrc(displayName, avatarUrl, withdrawn) {
    if (withdrawn) {
      return `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#ffffff"/></svg>',
      )}`;
    }
    return isUsableImageUrl(avatarUrl) ? String(avatarUrl).trim() : createInitialAvatarDataUrl(displayName);
  }

  function consumeAuthEntryMode() {
    try {
      const raw = sessionStorage.getItem(AUTH_ENTRY_MODE_STORAGE_KEY);
      sessionStorage.removeItem(AUTH_ENTRY_MODE_STORAGE_KEY);
      const mode = String(raw || "").trim();
      return mode === "signup" || mode === "login" ? mode : "";
    } catch {
      return "";
    }
  }

  function setAuthRedirectPending(pending) {
    try {
      if (pending) sessionStorage.setItem(AUTH_REDIRECT_PENDING_KEY, "1");
      else sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
    } catch {
      // ignore
    }
  }

  function isAuthRedirectPending() {
    try {
      return sessionStorage.getItem(AUTH_REDIRECT_PENDING_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setAuthLoadingOverlayVisible(visible) {
    if (!authLoadingOverlay) return;
    authLoadingOverlay.style.display = visible ? "flex" : "none";
    authLoadingOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function setAuthLoadingOverlayText(text) {
    if (!(authLoadingText instanceof HTMLElement)) return;
    authLoadingText.textContent = String(text || "").trim() || DEFAULT_AUTH_LOADING_TEXT;
  }

  function showProcessingOverlay(text) {
    setAuthLoadingOverlayText(text || "処理中...");
    setAuthLoadingOverlayVisible(true);
  }

  function hideProcessingOverlay() {
    setAuthLoadingOverlayVisible(false);
    setAuthLoadingOverlayText(DEFAULT_AUTH_LOADING_TEXT);
  }

  window.MarchinZProcessingOverlay = {
    show: showProcessingOverlay,
    hide: hideProcessingOverlay,
  };

  function isLocalDevHost() {
    const host = String(location.hostname || "").trim().toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }

  function readLocalDevLoginUser() {
    if (!isLocalDevHost()) return null;
    try {
      const raw = localStorage.getItem(DEV_LOCAL_LOGIN_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const id = String(parsed?.id || "").trim();
      if (!id) return null;
      return {
        id,
        user_metadata: {
          full_name: String(parsed?.name || "ローカルテストユーザー").trim() || "ローカルテストユーザー",
          name: String(parsed?.name || "ローカルテストユーザー").trim() || "ローカルテストユーザー",
          avatar_url: String(parsed?.avatar || "").trim(),
        },
      };
    } catch {
      return null;
    }
  }

  function writeLocalDevLoginUser(id, name, avatar) {
    if (!isLocalDevHost()) return;
    try {
      localStorage.setItem(
        DEV_LOCAL_LOGIN_STORAGE_KEY,
        JSON.stringify({
          id: String(id || "local-dev-user").trim() || "local-dev-user",
          name: String(name || "ローカルテストユーザー").trim() || "ローカルテストユーザー",
          avatar: String(avatar || "").trim(),
        }),
      );
    } catch {
      // ignore
    }
  }

  function clearLocalDevLoginUser() {
    try {
      localStorage.removeItem(DEV_LOCAL_LOGIN_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function normalizeDevUserText(raw, fallback, maxLen) {
    const s = String(raw || "").trim();
    if (!s) return fallback;
    return s.slice(0, maxLen);
  }

  function applyLocalDevLoginFromQuery() {
    if (!isLocalDevHost()) return;
    let url;
    try {
      url = new URL(location.href);
    } catch {
      return;
    }
    const p = url.searchParams;
    const wantsLogin = p.get("dev_login") === "1";
    const wantsLogout = p.get("dev_logout") === "1";
    if (!wantsLogin && !wantsLogout) return;

    if (wantsLogout) {
      clearLocalDevLoginUser();
    } else if (wantsLogin) {
      const uid = normalizeDevUserText(p.get("dev_uid"), "local-dev-user", 120);
      const name = normalizeDevUserText(p.get("dev_name"), "ローカルテストユーザー", 120);
      const avatar = normalizeDevUserText(p.get("dev_avatar"), "", 2048);
      writeLocalDevLoginUser(uid, name, avatar);
    }

    ["dev_login", "dev_logout", "dev_uid", "dev_name", "dev_avatar"].forEach((k) => p.delete(k));
    const next = `${url.pathname}${p.toString() ? `?${p.toString()}` : ""}${url.hash || ""}`;
    history.replaceState(null, "", next);
  }

  function closeAccountDropdown() {
    accountDropdownOpen = false;
    if (userAccountDropdown) {
      userAccountDropdown.hidden = true;
    }
    if (btnAccountMenuToggle) {
      btnAccountMenuToggle.setAttribute("aria-expanded", "false");
    }
  }

  function closeMobileSiteDrawer() {
    if (typeof window.__marchinzCloseMobileDrawer === "function") {
      window.__marchinzCloseMobileDrawer();
      return;
    }
    const drawer = document.getElementById("site-mobile-drawer");
    const toggle = document.getElementById("site-mobile-nav-toggle");
    if (drawer) {
      drawer.hidden = true;
      drawer.classList.remove("site-mobile-drawer--open");
    }
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("mz-mobile-drawer-open");
  }

  function openAccountDropdown() {
    accountDropdownOpen = true;
    if (userAccountDropdown) {
      userAccountDropdown.hidden = false;
    }
    if (btnAccountMenuToggle) {
      btnAccountMenuToggle.setAttribute("aria-expanded", "true");
    }
  }

  function toggleAccountDropdown() {
    if (accountDropdownOpen) closeAccountDropdown();
    else openAccountDropdown();
  }

  function closeLegalPolicyGate() {
    legalGateBlocking = false;
    if (legalPolicyDialog) legalPolicyDialog.hidden = true;
    if (legalGateError instanceof HTMLElement) {
      legalGateError.textContent = "";
      legalGateError.hidden = true;
    }
    const resolve = legalGatePromiseResolve;
    legalGatePromiseResolve = null;
    if (typeof resolve === "function") resolve();
  }

  function openLegalPolicyGateModal() {
    if (!legalPolicyDialog) return;
    legalGateBlocking = true;
    legalPolicyDialog.hidden = false;
    if (legalGateAgreeCheckbox instanceof HTMLInputElement) {
      legalGateAgreeCheckbox.checked = false;
    }
    if (btnLegalGateAccept instanceof HTMLButtonElement) {
      btnLegalGateAccept.disabled = true;
    }
    closeAccountDropdown();
    closeMobileSiteDrawer();
  }

  function closeProfileDialog(force = false) {
    if (profileSetupRequired && !force) return;
    if (profileDialog) profileDialog.hidden = true;
  }

  function openProfileDialog() {
    if (legalGateBlocking) return;
    if (profileDialog) profileDialog.hidden = false;
    closeAccountDropdown();
    closeMobileSiteDrawer();
    void hydrateProfileForm().catch(() => {});
    requestAnimationFrame(() => inputDisplayName?.focus());
  }

  function closeSettingsDialog() {
    if (settingsDialog) settingsDialog.hidden = true;
  }

  function closeWithdrawDoneDialog() {
    if (withdrawDoneDialog) withdrawDoneDialog.hidden = true;
  }

  function openWithdrawDoneDialog() {
    if (!withdrawDoneDialog) return;
    withdrawDoneDialog.hidden = false;
    requestAnimationFrame(() => {
      document.getElementById("btn-withdraw-done-ok")?.focus();
    });
  }

  function openSettingsDialog() {
    if (legalGateBlocking) return;
    if (settingsDialog) settingsDialog.hidden = false;
    closeAccountDropdown();
    closeMobileSiteDrawer();
    void hydrateLikeShowForm().catch(() => {});
  }

  if (btnAccountMenuToggle && userAccountDropdown) {
    btnAccountMenuToggle.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleAccountDropdown();
    });
  }

  document.addEventListener("click", () => {
    closeAccountDropdown();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (legalGateBlocking) {
        ev.preventDefault();
        return;
      }
      closeAccountDropdown();
      closeProfileDialog();
      closeSettingsDialog();
      closeWithdrawDoneDialog();
    }
  });

  if (userAccountDropdown) {
    userAccountDropdown.addEventListener("click", (ev) => ev.stopPropagation());
  }

  [profileDialog, settingsDialog, withdrawDoneDialog].forEach((overlay) => {
    if (!overlay) return;
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        if (overlay === profileDialog) closeProfileDialog();
        if (overlay === settingsDialog) closeSettingsDialog();
        if (overlay === withdrawDoneDialog) closeWithdrawDoneDialog();
      }
    });
  });

  if (legalPolicyDialog) {
    legalPolicyDialog.addEventListener("click", (ev) => {
      if (ev.target === legalPolicyDialog) ev.stopPropagation();
    });
  }

  document.querySelectorAll("[data-mz-close-dialog]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-mz-close-dialog");
      if (kind === "profile") closeProfileDialog();
      if (kind === "settings") closeSettingsDialog();
      if (kind === "withdraw-done") closeWithdrawDoneDialog();
    });
  });

  const btnWithdrawDoneOk = document.getElementById("btn-withdraw-done-ok");
  if (btnWithdrawDoneOk) {
    btnWithdrawDoneOk.addEventListener("click", () => {
      closeWithdrawDoneDialog();
      const base = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`${base}#top`);
    });
  }

  if (menuOpenProfileEdit) {
    menuOpenProfileEdit.addEventListener("click", () => {
      if (menuOpenProfileEdit.hidden) return;
      openProfileDialog();
    });
  }

  if (menuOpenSettings) {
    menuOpenSettings.addEventListener("click", () => {
      if (menuOpenSettings.hidden) return;
      openSettingsDialog();
    });
  }

  if (menuMobileProfileEdit) {
    menuMobileProfileEdit.addEventListener("click", () => {
      if (menuMobileProfileEdit.hidden) return;
      openProfileDialog();
    });
  }

  if (menuMobileSettings) {
    menuMobileSettings.addEventListener("click", () => {
      if (menuMobileSettings.hidden) return;
      openSettingsDialog();
    });
  }

  function parseReturnTarget(raw) {
    if (raw == null || raw === "") return "#top";
    let decoded;
    try {
      decoded = decodeURIComponent(String(raw));
    } catch {
      decoded = String(raw);
    }
    const idx = decoded.indexOf("#");
    const hashPart = idx >= 0 ? decoded.slice(idx).trim() : "#top";
    const m = /^#([\w-]+)$/.exec(hashPart);
    if (!m) return "#top";
    const pageId = m[1];
    if (pageId === "login" || pageId === "signup") return "#top";
    if (pageId === "top" || pageId === "mll") return "#top";
    if (!RETURN_PAGE_IDS.has(pageId)) return "#top";
    return `#${pageId}`;
  }

  function stripReturnQueryFromSearch(search) {
    const q = search.startsWith("?") ? search.slice(1) : search;
    const p = new URLSearchParams(q);
    p.delete("return_to");
    p.delete("from");
    const rest = p.toString();
    return rest ? `?${rest}` : "";
  }

  function persistAuthReturnFromUrl() {
    const hp = location.hash.replace(/^#/, "");
    if (hp !== "login" && hp !== "signup") return;
    const q = new URLSearchParams(location.search).get("return_to");
    if (q) sessionStorage.setItem(AUTH_RETURN_STORAGE_KEY, q);
    else sessionStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
  }

  window.addEventListener("hashchange", () => {
    persistAuthReturnFromUrl();
  });
  persistAuthReturnFromUrl();

  function syncSiteBrandAuthVisibility() {
    const loggedIn = Boolean(currentUser);
    const redirectPending = isAuthRedirectPending();
    const hideGuestChrome = loggedIn || redirectPending;
    if (siteBrandActions) siteBrandActions.hidden = hideGuestChrome;
    if (siteBrandUserArea) siteBrandUserArea.hidden = !loggedIn || redirectPending;
    if (siteMobileDrawerGuest) siteMobileDrawerGuest.hidden = loggedIn;
    if (siteMobileDrawerUser) siteMobileDrawerUser.hidden = !loggedIn;
    document.querySelectorAll("[data-mll-top-guest-only]").forEach((el) => {
      if (el instanceof HTMLElement) el.hidden = hideGuestChrome;
    });
    const showTopUserCta = loggedIn && !redirectPending;
    document.querySelectorAll("[data-mll-top-user-only]").forEach((el) => {
      if (el instanceof HTMLElement) el.hidden = !showTopUserCta;
    });
  }

  function navigateAwayFromAuthEntryIfLoggedIn() {
    if (!currentUser) return;
    const hp = location.hash.replace(/^#/, "");
    if (hp !== "login" && hp !== "signup") return;
    let raw = sessionStorage.getItem(AUTH_RETURN_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
    if (!raw) raw = new URLSearchParams(location.search).get("return_to");
    const dest = parseReturnTarget(raw);
    const nextSearch = stripReturnQueryFromSearch(location.search);
    const url = `${location.pathname}${nextSearch}${dest}`;
    history.replaceState(null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  function applyAdminOnlyVisibility(isAdmin) {
    document.querySelectorAll("[data-admin-only]").forEach((el) => {
      el.hidden = !isAdmin;
      el.style.display = isAdmin ? "" : "none";
    });
    if (!isAdmin && window.location.hash === "#moderation") {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}#top`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }

  function syncSignupEntryConsentUi() {
    if (!btnAuthSignupGoogle) return;
    const okConsent = Boolean(
      authSignupAgreeTerms?.checked &&
        authSignupAgreePrivacy?.checked &&
        authSignupAge13?.checked &&
        authSignupAgreeStatsSharing?.checked,
    );
    if (authEntryBusy) {
      btnAuthSignupGoogle.disabled = true;
      if (authSignupConsentMsg) authSignupConsentMsg.textContent = "認証を開始しています。しばらくお待ちください。";
      return;
    }
    const firebaseOk = Boolean(window.MLL_AUTH?.firebaseAuthAvailable);
    btnAuthSignupGoogle.disabled = !firebaseOk || !okConsent;
    if (authSignupConsentMsg) {
      authSignupConsentMsg.textContent = !signupConsentTried || okConsent ? "" : AUTH_MESSAGE.agreeRequired;
    }
  }

  function setAuthEntryMessage(entry, text, isError = false) {
    const node = entry === "signup" ? authSignupMsg : authLoginMsg;
    if (!node) return;
    node.textContent = String(text || "").trim();
    node.style.color = isError ? "#b71c1c" : "";
  }

  function setAuthEntryBusy(busy) {
    authEntryBusy = Boolean(busy);
    [btnAuthLoginGoogle, btnAuthSignupGoogle].forEach((btn) => {
      if (!btn) return;
      if (!authButtonLabelStore.has(btn)) authButtonLabelStore.set(btn, btn.textContent || "");
      btn.disabled = authEntryBusy;
      btn.textContent = authEntryBusy ? AUTH_BUSY_TEXT : authButtonLabelStore.get(btn) || btn.textContent;
      btn.setAttribute("aria-busy", authEntryBusy ? "true" : "false");
    });
    if (!authEntryBusy) syncSignupEntryConsentUi();
    if (!authEntryBusy && !isAuthRedirectPending()) setAuthLoadingOverlayVisible(false);
  }

  function showLoggedOut() {
    closeLegalPolicyGate();
    currentProfileWithdrawn = false;
    profileSetupRequired = false;
    signupConsentTried = false;
    setAuthEntryBusy(false);
    closeAccountDropdown();
    closeProfileDialog();
    closeSettingsDialog();
    setFirebaseHintVisible("");
    if (menuOpenProfileEdit) menuOpenProfileEdit.hidden = false;
    if (menuOpenSettings) menuOpenSettings.hidden = false;
    setAuthEntryMessage("login", "");
    setAuthEntryMessage("signup", "");
    if (authSignupAgreeTerms) authSignupAgreeTerms.checked = false;
    if (authSignupAgreePrivacy) authSignupAgreePrivacy.checked = false;
    if (authSignupAge13) authSignupAge13.checked = false;
    if (authSignupAgreeStatsSharing) authSignupAgreeStatsSharing.checked = false;
    try {
      sessionStorage.removeItem(AUTH_ENTRY_MODE_STORAGE_KEY);
    } catch {
      // ignore
    }
    applyAdminOnlyVisibility(false);
    syncSignupEntryConsentUi();
    if (btnAuthLoginGoogle) btnAuthLoginGoogle.disabled = !window.MLL_AUTH?.firebaseAuthAvailable;
    syncSiteBrandAuthVisibility();
  }

  function isAdminUser() {
    const email = String(rawAuthUserForAdmin?.email || "").trim().toLowerCase();
    return Boolean(email && adminEmails.has(email));
  }

  function showLoggedInView(displayName, avatarUrl) {
    const admin = isAdminUser();
    closeAccountDropdown();
    setFirebaseHintVisible("");
    const label = admin ? "管理者" : displayName || "ユーザー";
    if (headerProfileName) {
      headerProfileName.textContent = label;
    }
    if (headerProfileAvatar) {
      headerProfileAvatar.src = getProfileAvatarSrc(displayName, avatarUrl, currentProfileWithdrawn);
      headerProfileAvatar.alt = currentProfileWithdrawn ? "" : `${displayName || "ユーザー"} のプロフィール画像`;
    }
    if (mobileDrawerAvatar) {
      mobileDrawerAvatar.src = getProfileAvatarSrc(displayName, avatarUrl, currentProfileWithdrawn);
      mobileDrawerAvatar.alt = currentProfileWithdrawn ? "" : `${displayName || "ユーザー"} のプロフィール画像`;
    }
    if (mobileDrawerName) {
      mobileDrawerName.textContent = label;
    }
    applyAdminOnlyVisibility(admin);
    syncSiteBrandAuthVisibility();
  }

  const hasFirebaseConfig = Boolean(
    firebaseCfg.apiKey && firebaseCfg.authDomain && firebaseCfg.projectId && firebaseCfg.appId
  );
  if (!hasFirebaseConfig || !window.firebase?.initializeApp) {
    applyAdminOnlyVisibility(false);
    window.MLL_AUTH = {
      getDb: () => null,
      getStorage: () => null,
      getUser: () => null,
      isAdmin: () => false,
      firebaseAuthAvailable: false,
      isRedirectPending: () => false,
      isWithdrawn: () => false,
      signInWithGoogle: async () => {
        alert(AUTH_MESSAGE.firebaseMissingSimple);
      },
    };
    const noFirebaseMsg =
      "Firebase が未設定か、SDK が読み込めていません。\n\n" +
      "010_MarchinZ/auth-config.js の firebase（apiKey / authDomain / projectId / appId / storageBucket 等）を、Firebase Console の「プロジェクトの設定」からコピーして埋めてください。\n" +
      "ローカルで index.html を file:// で開いている場合は、http://localhost で配信するか、Netlify 上で試してください。";
    if (btnAuthLoginGoogle) {
      btnAuthLoginGoogle.disabled = false;
      btnAuthLoginGoogle.addEventListener("click", () => {
        alert(noFirebaseMsg);
      });
    }
    if (btnAuthSignupGoogle) {
      btnAuthSignupGoogle.disabled = false;
      btnAuthSignupGoogle.addEventListener("click", () => {
        if (!authSignupAgreeTerms?.checked || !authSignupAgreePrivacy?.checked) {
          alert(AUTH_MESSAGE.agreeRequired);
          return;
        }
        alert(noFirebaseMsg);
      });
    }
    if (siteBrandActions) siteBrandActions.hidden = false;
    if (siteBrandUserArea) siteBrandUserArea.hidden = true;
    syncSiteBrandAuthVisibility();
    setAuthLoadingOverlayVisible(false);
    closeAccountDropdown();
    setFirebaseHintVisible("Firebase 未設定（auth-config.js を設定）");
    syncSignupEntryConsentUi();
    window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));
    return;
  }

  let app;
  if (window.firebase.apps?.length) {
    app = window.firebase.app();
  } else {
    app = window.firebase.initializeApp(firebaseCfg);
  }
  const auth = app.auth();
  const popupRedirectResolver = window.firebase?.auth?.browserPopupRedirectResolver;
  if (popupRedirectResolver) {
    try {
      auth._popupRedirectResolver = popupRedirectResolver;
    } catch {
      // ignore
    }
  }
  // Firestore: enableIndexedDbPersistence は未使用のため、オフライン永続化（IndexedDB）は有効化していない（公式の既定どおり）。
  // Safari プライベートの IndexedDB 制限が「Firestore 永続キャッシュ」経由で悪さする経路はこの構成では通常ない。
  const db = window.firebase.firestore();
  const storage = app.storage();

  fillProfilePrefectureSelect(profilePrefecture instanceof HTMLSelectElement ? profilePrefecture : null);

  hydrateLikeShowForm = async () => {
    if (!currentUser?.id || currentProfileWithdrawn) return;
    const status = document.getElementById("mz-like-show-status");
    try {
      const snap = await db.collection("mll_profiles").doc(currentUser.id).get();
      const data = snap.data() || {};
      document.querySelectorAll("#mz-like-show-list input[data-mz-like-field]").forEach((node) => {
        if (!(node instanceof HTMLInputElement)) return;
        const field = node.getAttribute("data-mz-like-field");
        if (!field || !LIKE_SHOW_FIELD_SET.has(field)) return;
        node.checked = data[field] !== false;
      });
      if (status) {
        status.hidden = true;
        status.textContent = "";
        status.classList.remove("mz-settings-like-status--err");
      }
    } catch {
      if (status) {
        status.hidden = false;
        status.textContent = "いいね通知の設定を読み込めませんでした。";
        status.classList.add("mz-settings-like-status--err");
      }
    }
  };

  persistLikeShowField = async (field, checked) => {
    if (!LIKE_SHOW_FIELD_SET.has(field) || !currentUser?.id || currentProfileWithdrawn) return;
    const status = document.getElementById("mz-like-show-status");
    const inp = document.querySelector(`#mz-like-show-list input[data-mz-like-field="${field}"]`);
    try {
      if (status) {
        status.hidden = false;
        status.textContent = "保存中…";
        status.classList.remove("mz-settings-like-status--err");
      }
      await db
        .collection("mll_profiles")
        .doc(currentUser.id)
        .set({ [field]: Boolean(checked), updated_at: new Date().toISOString() }, { merge: true });
      if (status) {
        status.textContent = "保存しました";
        window.setTimeout(() => {
          if (status.textContent === "保存しました") {
            status.hidden = true;
            status.textContent = "";
          }
        }, 2000);
      }
      window.dispatchEvent(new CustomEvent("marchinz-like-show-changed", { detail: { uid: currentUser.id } }));
      window.dispatchEvent(new CustomEvent("marchinz-profile-saved", { detail: { id: currentUser.id } }));
    } catch (e) {
      if (inp instanceof HTMLInputElement) inp.checked = !checked;
      if (status) {
        status.hidden = false;
        status.textContent = String(e?.message || e || "保存に失敗しました。");
        status.classList.add("mz-settings-like-status--err");
      }
    }
  };

  document.querySelectorAll("#mz-like-show-list input[data-mz-like-field]").forEach((node) => {
    node.addEventListener("change", () => {
      if (!(node instanceof HTMLInputElement)) return;
      const field = node.getAttribute("data-mz-like-field");
      if (!field) return;
      void persistLikeShowField(field, node.checked);
    });
  });

  /**
   * @param {File} file
   * @returns {Promise<Blob>}
   */
  async function compressProfileImageForUpload(file) {
    const mi = window.MarchinZImage;
    if (!mi?.compressForUpload) {
      throw new Error("画像圧縮モジュールが読み込まれていません。ページを再読み込みしてください。");
    }
    return mi.compressForUpload(file);
  }

  async function uploadProfileJpeg(storageRefRoot, uid, fileName, blob) {
    const path = `mll_profile_media/${uid}/${fileName}`;
    const ref = storageRefRoot.ref(path);
    await ref.put(blob, { contentType: "image/jpeg", cacheControl: "public,max-age=604800" });
    return ref.getDownloadURL();
  }

  function resolveCoverImageUrlFromDocData(data) {
    if (!data || typeof data !== "object") return "";
    const u = String(data.cover_image_url || "").trim();
    if (isUsableImageUrl(u)) return u;
    const arr = Array.isArray(data.cover_image_urls) ? data.cover_image_urls : [];
    for (const x of arr) {
      const s = String(x || "").trim();
      if (isUsableImageUrl(s)) return s;
    }
    return "";
  }

  hydrateProfileForm = async () => {
    if (!currentUser) return;
    const p = await fetchProfile(currentUser);
    if (inputAvatarFile) inputAvatarFile.value = "";
    if (inputCoverFile) inputCoverFile.value = "";
    if (inputDisplayName) inputDisplayName.value = p.withdrawn ? "" : p.display_name || "";
    if (profilePrefecture instanceof HTMLSelectElement) {
      profilePrefecture.querySelectorAll('option[data-profile-pref-legacy="1"]').forEach((n) => n.remove());
      const pref = p.withdrawn ? "" : String(p.profile_address_prefecture || "").trim();
      if (pref && !PROFILE_JP_PREFS_SET.has(pref)) {
        const o = document.createElement("option");
        o.value = pref;
        o.textContent = `(以前の登録: ${pref})`;
        o.setAttribute("data-profile-pref-legacy", "1");
        profilePrefecture.appendChild(o);
      }
      profilePrefecture.value = pref;
    }
    if (profileAddressPrefecturePublic instanceof HTMLInputElement) {
      profileAddressPrefecturePublic.checked = p.withdrawn ? true : p.profile_address_prefecture_public !== false;
    }
    if (profileGender instanceof HTMLSelectElement) {
      const g = p.withdrawn ? "" : String(p.profile_gender || "").trim();
      profileGender.value = PROFILE_GENDER_VALUES.includes(g) ? g : "";
    }
    if (profileBirthdate instanceof HTMLInputElement) {
      profileBirthdate.max = new Date().toISOString().slice(0, 10);
      profileBirthdate.min = "1900-01-01";
      const b = p.withdrawn ? "" : String(p.profile_birthdate || "").trim();
      profileBirthdate.value = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b) ? b : "";
    }
    if (profileBio instanceof HTMLTextAreaElement) {
      profileBio.value = p.withdrawn ? "" : String(p.profile_bio || "").trim();
    }
    const av = document.getElementById("profile-avatar-preview");
    if (av instanceof HTMLImageElement) {
      if (av.src.startsWith("blob:")) URL.revokeObjectURL(av.src);
      const au = p.withdrawn ? "" : String(p.avatar_url || "").trim();
      av.src = getProfileAvatarSrc(p.display_name, au, Boolean(p.withdrawn));
      av.hidden = false;
    }
    const cv = document.getElementById("profile-cover-preview");
    if (cv instanceof HTMLImageElement) {
      if (cv.src.startsWith("blob:")) URL.revokeObjectURL(cv.src);
      const cu = p.withdrawn ? "" : String(p.cover_image_url || "").trim();
      if (isUsableImageUrl(cu)) {
        cv.src = cu;
        cv.hidden = false;
      } else {
        cv.src = DEFAULT_COVER_IMAGE_URL;
        cv.hidden = false;
      }
    }
  };

  function mapFirebaseUser(user) {
    if (!user) return null;
    return {
      id: user.uid,
      user_metadata: {
        full_name: user.displayName || "",
        name: user.displayName || "",
        avatar_url: user.photoURL || "",
      },
    };
  }

  async function signInWithGoogle(entry = "unknown") {
    if (authEntryBusy) return;
    setAuthEntryBusy(true);
    const remember = Boolean(authLoginRememberSession?.checked);
    const persistence = window.firebase.auth.Auth.Persistence.LOCAL;
    try {
      localStorage.setItem(AUTH_REMEMBER_STORAGE_KEY, remember ? "1" : "0");
    } catch {
      // ignore
    }
    try {
      sessionStorage.setItem(AUTH_ENTRY_MODE_STORAGE_KEY, entry === "signup" ? "signup" : "login");
      sessionStorage.setItem(AUTH_REDIRECT_PENDING_KEY, "1");
    } catch {
      // ignore
    }
    window.MarchinZTrackEvent?.("login_start", { entry });
    setAuthEntryMessage(entry, "Googleの認証ページへ移動します…", false);
    setAuthLoadingOverlayVisible(true);
    try {
      const provider = new window.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        await auth.setPersistence(persistence);
      } catch {
        // ignore
      }
      await auth.signInWithRedirect(provider);
      return;
    } catch (err) {
      setAuthRedirectPending(false);
      const fallback = "Googleログインを開始できませんでした。設定を確認してください。";
      const msg = authFriendlyErrorMessage(err, fallback);
      setAuthEntryMessage(entry, msg, true);
      alert(msg);
      throw err;
    } finally {
      setAuthEntryBusy(false);
    }
  }

  window.MLL_AUTH = {
    getDb: () => db,
    getStorage: () => storage,
    getUser: () => currentUser,
    isAdmin: () => isAdminUser(),
    firebaseAuthAvailable: true,
    isRedirectPending: () => isAuthRedirectPending(),
    signInWithGoogle,
    isWithdrawn: () => currentProfileWithdrawn,
    getLegalPolicyVersion: () => LEGAL_POLICY_VERSION,
    isLegalGateBlocking: () => legalGateBlocking,
    simulateLocalLogin: (name = "ローカルテストユーザー", uid = "local-dev-user", avatar = "") => {
      if (!isLocalDevHost()) return false;
      writeLocalDevLoginUser(uid, name, avatar);
      const devUser = readLocalDevLoginUser();
      if (!devUser) return false;
      setAuthRedirectPending(false);
      setAuthLoadingOverlayVisible(false);
      onSignedIn(devUser);
      return true;
    },
    clearSimulatedLocalLogin: () => {
      clearLocalDevLoginUser();
      currentUser = null;
      rawAuthUserForAdmin = null;
      showLoggedOut();
      window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));
      return true;
    },
  };

  applyLocalDevLoginFromQuery();

  /**
   * ルート mll_profiles に残っている性別・誕生日を本人専用サブドキュメントへ移し、ルートから削除する（第三者読み取り対策）。
   * Firestore ルールでルート allowlist から外したキーが残っていると本人更新が通らないため、ensureProfile より先に実行する。
   */
  async function migrateSensitiveProfileOffRoot(uid) {
    if (!db || !uid) return;
    try {
      const fv = window.firebase?.firestore?.FieldValue;
      if (!fv?.delete) return;
      const rootRef = db.collection("mll_profiles").doc(uid);
      const privRef = rootRef.collection(PROFILE_SENSITIVE_PRIVATE_COLLECTION).doc(PROFILE_SENSITIVE_PRIVATE_DOC_ID);
      const [rootSnap, privSnap] = await Promise.all([rootRef.get(), privRef.get()]);
      if (!rootSnap.exists) return;
      const root = rootSnap.data() || {};
      if (Boolean(root.withdrawn)) return;
      const legacyG = String(root.profile_gender ?? "").trim();
      const legacyB = String(root.profile_birthdate ?? "").trim();
      if (!legacyG && !legacyB) return;
      const priv = privSnap.exists ? privSnap.data() || {} : {};
      let g = String(priv.profile_gender ?? "").trim() || legacyG;
      let b = String(priv.profile_birthdate ?? "").trim() || legacyB;
      if (!PROFILE_GENDER_VALUES.includes(g)) g = "無回答";
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b)) b = "";
      await privRef.set(
        {
          profile_gender: g,
          profile_birthdate: b,
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );
      await rootRef.set(
        {
          profile_gender: fv.delete(),
          profile_birthdate: fv.delete(),
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );
    } catch (e) {
      console.warn("[MarchinZ] migrateSensitiveProfileOffRoot", e);
    }
  }

  async function fetchProfile(user) {
    const fallback = {
      display_name: user.user_metadata?.full_name || user.user_metadata?.name || "ユーザー",
      avatar_url: user.user_metadata?.avatar_url || "",
      cover_image_url: DEFAULT_COVER_IMAGE_URL,
      withdrawn: false,
      profile_address_prefecture: "",
      profile_address_prefecture_public: true,
      profile_gender: "",
      profile_birthdate: "",
      profile_bio: "",
      legal_policy_accepted_version: "",
    };

    try {
      const snap = await db.collection("mll_profiles").doc(user.id).get();
      if (!snap.exists) return fallback;
      const data = snap.data() || {};
      const withdrawn = Boolean(data.withdrawn);
      if (withdrawn) {
        return {
          display_name: WITHDRAWN_NAME,
          avatar_url: "",
          cover_image_url: "",
          withdrawn: true,
          profile_address_prefecture: "",
          profile_address_prefecture_public: true,
          profile_gender: "",
          profile_birthdate: "",
          profile_bio: "",
          legal_policy_accepted_version: "",
        };
      }
      const addrPref = String(data.profile_address_prefecture ?? "").trim();
      const legacyPref = String(data.profile_prefecture ?? "").trim();
      let profile_gender = "";
      let profile_birthdate = "";
      try {
        const sensSnap = await db
          .collection("mll_profiles")
          .doc(user.id)
          .collection(PROFILE_SENSITIVE_PRIVATE_COLLECTION)
          .doc(PROFILE_SENSITIVE_PRIVATE_DOC_ID)
          .get();
        if (sensSnap.exists) {
          const sd = sensSnap.data() || {};
          profile_gender = String(sd.profile_gender ?? "").trim();
          profile_birthdate = String(sd.profile_birthdate ?? "").trim();
        }
      } catch {
        //
      }
      const legacyRootG = String(data.profile_gender ?? "").trim();
      const legacyRootB = String(data.profile_birthdate ?? "").trim();
      if (!profile_gender && legacyRootG) profile_gender = legacyRootG;
      if (!profile_birthdate && legacyRootB) profile_birthdate = legacyRootB;
      return {
        display_name: data.display_name || fallback.display_name,
        avatar_url: data.avatar_url || fallback.avatar_url,
        cover_image_url: resolveCoverImageUrlFromDocData(data),
        withdrawn: false,
        profile_address_prefecture: addrPref || legacyPref,
        profile_address_prefecture_public: data.profile_address_prefecture_public !== false,
        profile_gender,
        profile_birthdate,
        profile_bio: String(data.profile_bio ?? "").trim(),
        legal_policy_accepted_version: String(data.legal_policy_accepted_version ?? "").trim(),
      };
    } catch {
      return fallback;
    }
  }

  /**
   * 規約・ポリシーの最新版への同意が Firestore に無い場合、モーダルでブロックする。
   * @param {{ id: string }} user
   * @param {{ withdrawn?: boolean; legal_policy_accepted_version?: string }} prof
   */
  async function maybePromptLegalPolicyAcceptance(user, prof) {
    if (!legalPolicyDialog || !db || !user?.id || !prof || prof.withdrawn) return;
    if (String(prof.legal_policy_accepted_version || "").trim() === LEGAL_POLICY_VERSION) return;
    await new Promise((resolve) => {
      legalGatePromiseResolve = resolve;
      openLegalPolicyGateModal();
    });
  }

  async function allocateMarchinzPublicIdTransaction() {
    const ref = db.collection("mll_meta").doc("marchinz_public_id");
    return db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) {
        throw new Error("MISSING_PUBLIC_ID_COUNTER");
      }
      const data = snap.data() || {};
      const cur = Number(data.next);
      const n = Number.isFinite(cur) && cur >= 101 ? Math.floor(cur) : 101;
      t.update(ref, {
        next: n + 1,
        updated_at: new Date().toISOString(),
      });
      return String(n);
    });
  }

  async function ensureProfile(user) {
    try {
      const ref = db.collection("mll_profiles").doc(user.id);
      const snap = await ref.get();
      const existing = snap.data() || {};
      if (existing.withdrawn) return;
      if (Boolean(existing.banned)) return;
      const hadDigits = String(existing.marchinz_public_id ?? "")
        .replace(/\D/g, "")
        .trim();
      let marchinz_public_id = hadDigits ? String(existing.marchinz_public_id).trim() : "";
      if (!hadDigits) {
        try {
          marchinz_public_id = await allocateMarchinzPublicIdTransaction();
        } catch (e) {
          const code = String(e && e.code ? e.code : "");
          console.warn(
            "[MarchinZ] marchinz_public_id を採番できません。Firestore にコレクション mll_meta、ドキュメント marchinz_public_id（フィールド next: 101）を作成してください。",
            code || e,
          );
        }
      }
      const payload = {
        id: user.id,
        display_name: user.user_metadata?.full_name || user.user_metadata?.name || "ユーザー",
        updated_at: new Date().toISOString(),
        created_at: existing.created_at || new Date().toISOString(),
      };
      if (!String(existing.avatar_url || "").trim()) {
        payload.avatar_url = user.user_metadata?.avatar_url || "";
      }
      if (!resolveCoverImageUrlFromDocData(existing)) {
        payload.cover_image_url = DEFAULT_COVER_IMAGE_URL;
      }
      if (marchinz_public_id) {
        payload.marchinz_public_id = marchinz_public_id;
      }
      await ref.set(payload, { merge: true });
    } catch {
      // Firestore未設定時でもログインは継続
    }
  }

  function applyWithdrawnUi(withdrawn) {
    currentProfileWithdrawn = withdrawn;
    if (menuOpenProfileEdit) menuOpenProfileEdit.hidden = withdrawn;
    if (menuOpenSettings) menuOpenSettings.hidden = withdrawn;
    if (menuMobileProfileEdit) menuMobileProfileEdit.hidden = withdrawn;
    if (menuMobileSettings) menuMobileSettings.hidden = withdrawn;
    if (withdrawn && profileForm && profileDialog) profileDialog.hidden = true;
  }

  async function refreshProfileView(user) {
    const p = await fetchProfile(user);
    applyWithdrawnUi(Boolean(p.withdrawn));
    await hydrateProfileForm().catch(() => {});
    showLoggedInView(p.display_name, p.avatar_url);
    return p;
  }

  let profileSyncRunId = 0;

  /** mll.js のイベント入力フォーム：認証確定・プロフィール同期の直後に UI を再同期（リダイレクト復帰時の disabled 取り残し対策） */
  function scheduleMllEventFormResync() {
    queueMicrotask(() => window.MarchinZResyncMllEventFormUi?.());
  }

  function onSignedIn(user) {
    currentUser = user;
    rawAuthUserForAdmin = auth.currentUser;

    // 体感速度優先: Firestore 同期を待たずに即ログインUIへ切り替える。
    applyWithdrawnUi(false);
    const instantName = user.user_metadata?.full_name || user.user_metadata?.name || "ユーザー";
    const instantAvatar = user.user_metadata?.avatar_url || "";
    showLoggedInView(instantName, instantAvatar);
    navigateAwayFromAuthEntryIfLoggedIn();
    window.MarchinZTrackEvent?.("login_success", { admin: isAdminUser(currentUser) ? 1 : 0 });
    window.dispatchEvent(
      new CustomEvent("mll-auth-changed", { detail: { user: currentUser, isAdmin: isAdminUser(currentUser) } })
    );
    scheduleMllEventFormResync();
    const authEntryMode = consumeAuthEntryMode();
    if (authEntryMode === "signup") {
      profileSetupRequired = true;
    }

    const runId = ++profileSyncRunId;
    void (async () => {
    try {
      const banSnap = await db.collection("mll_profiles").doc(user.id).get();
      if (banSnap.exists) {
        const bd = banSnap.data() || {};
        if (Boolean(bd.banned)) {
          await auth.signOut();
          currentUser = null;
          rawAuthUserForAdmin = null;
          showLoggedOut();
          alert(AUTH_MESSAGE.accountBanned);
          window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));
          scheduleMllEventFormResync();
          return;
        }
      }
    } catch {
      // Firestore 未設定・一時障害時はログイン継続。凍結の書き込みはルールで拒否される。
    }
      await migrateSensitiveProfileOffRoot(user.id);
      await ensureProfile(user);
      const prof = await refreshProfileView(user);
      await maybePromptLegalPolicyAcceptance(user, prof);
      // より新しい認証イベントが先行した場合は古い同期結果を破棄
      if (runId !== profileSyncRunId) return;
      window.dispatchEvent(
        new CustomEvent("mll-auth-changed", { detail: { user: currentUser, isAdmin: isAdminUser(currentUser) } })
      );
      scheduleMllEventFormResync();
      if (profileSetupRequired && currentUser) {
        requestAnimationFrame(() => openProfileDialog());
      }
    })();
  }

  [authSignupAgreeTerms, authSignupAgreePrivacy, authSignupAge13, authSignupAgreeStatsSharing].forEach((el) => {
    el?.addEventListener("change", () => syncSignupEntryConsentUi());
  });

  legalGateAgreeCheckbox?.addEventListener("change", () => {
    if (btnLegalGateAccept instanceof HTMLButtonElement) {
      btnLegalGateAccept.disabled = !(legalGateAgreeCheckbox instanceof HTMLInputElement && legalGateAgreeCheckbox.checked);
    }
  });

  btnLegalGateAccept?.addEventListener("click", async () => {
    if (!legalGateBlocking || !currentUser?.id) return;
    if (!(legalGateAgreeCheckbox instanceof HTMLInputElement) || !legalGateAgreeCheckbox.checked) {
      if (legalGateError instanceof HTMLElement) {
        legalGateError.textContent = "チェックを入れてからお進みください。";
        legalGateError.hidden = false;
      }
      return;
    }
    const fv = window.firebase?.firestore?.FieldValue;
    if (!fv?.serverTimestamp) {
      if (legalGateError instanceof HTMLElement) {
        legalGateError.textContent = "Firestore が利用できません。ページを再読み込みしてください。";
        legalGateError.hidden = false;
      }
      return;
    }
    if (legalGateError instanceof HTMLElement) legalGateError.hidden = true;
    if (btnLegalGateAccept instanceof HTMLButtonElement) btnLegalGateAccept.disabled = true;
    showProcessingOverlay("保存中...");
    try {
      await db.collection("mll_profiles").doc(currentUser.id).set(
        {
          legal_policy_accepted_version: LEGAL_POLICY_VERSION,
          legal_policy_accepted_at: fv.serverTimestamp(),
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );
      closeLegalPolicyGate();
      window.dispatchEvent(
        new CustomEvent("marchinz-legal-policy-accepted", { detail: { version: LEGAL_POLICY_VERSION } }),
      );
    } catch (e) {
      window.alert(authFriendlyErrorMessage(e, AUTH_MESSAGE.saveFailed));
      if (btnLegalGateAccept instanceof HTMLButtonElement) btnLegalGateAccept.disabled = false;
    } finally {
      hideProcessingOverlay();
    }
  });

  btnLegalGateSignout?.addEventListener("click", async () => {
    if (!legalGateBlocking) return;
    await signOutAndClearUi();
  });

  if (btnAuthLoginGoogle) {
    btnAuthLoginGoogle.addEventListener("click", () => {
      setAuthEntryMessage("login", "");
      void signInWithGoogle("login").catch((err) => {
        const fallback = "ログインに失敗しました。時間をおいて再度お試しください。";
        setAuthEntryMessage("login", authFriendlyErrorMessage(err, fallback), true);
        console.error("[MarchinZ] Google sign-in", err);
      });
    });
  }

  if (btnAuthSignupGoogle) {
    btnAuthSignupGoogle.addEventListener("click", () => {
      signupConsentTried = true;
      if (
        !authSignupAgreeTerms?.checked ||
        !authSignupAgreePrivacy?.checked ||
        !authSignupAge13?.checked ||
        !authSignupAgreeStatsSharing?.checked
      ) {
        syncSignupEntryConsentUi();
        return;
      }
      setAuthEntryMessage("signup", "");
      syncSignupEntryConsentUi();
      void signInWithGoogle("signup").catch((err) => {
        const fallback = "新規登録に失敗しました。時間をおいて再度お試しください。";
        setAuthEntryMessage("signup", authFriendlyErrorMessage(err, fallback), true);
        console.error("[MarchinZ] Google sign-in", err);
      });
    });
  }

  async function signOutAndClearUi() {
    closeAccountDropdown();
    closeMobileSiteDrawer();
    await auth.signOut();
    currentUser = null;
    rawAuthUserForAdmin = null;
    showLoggedOut();
    window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      void signOutAndClearUi();
    });
  }

  if (btnMobileLogout) {
    btnMobileLogout.addEventListener("click", () => {
      void signOutAndClearUi();
    });
  }

  if (btnProfileCancel) {
    btnProfileCancel.addEventListener("click", () => {
      if (profileSetupRequired) {
        alert("プロフィール設定を完了してください。");
        return;
      }
      closeProfileDialog();
    });
  }

  if (btnAccountWithdrawToggle && withdrawDetail) {
    btnAccountWithdrawToggle.addEventListener("click", () => {
      withdrawDetail.hidden = !withdrawDetail.hidden;
    });
  }

  async function deleteStorageSubtreeRoot(storageRootRef) {
    try {
      const page = await storageRootRef.listAll();
      await Promise.all(page.items.map((itemRef) => itemRef.delete().catch(() => {})));
      await Promise.all(page.prefixes.map((pref) => deleteStorageSubtreeRoot(pref)));
    } catch {
      //
    }
  }

  /**
   * 退会時に Storage から消す実体（画面「削除済み」の「アップロード画像」に対応）。
   * Firestore のイベント（mll_calendar_events）・掲示板（mll_community_posts）は削除しない。
   */
  async function deleteWithdrawalOwnedStorage(uid) {
    if (!storage || !uid) return;
    const r = (path) => storage.ref(path);
    await deleteStorageSubtreeRoot(r(`mll_event_diary_media/${uid}`));
    await deleteStorageSubtreeRoot(r(`mll_community/${uid}`));
    await Promise.all(
      ["avatar.jpg", "cover.jpg"].map((fn) => r(`mll_profile_media/${uid}/${fn}`).delete().catch(() => {})),
    );
  }

  async function deleteFirestoreByQueryBatches(query) {
    const CHUNK = 450;
    let snap = await query.limit(CHUNK).get();
    while (!snap.empty) {
      const b = db.batch();
      snap.docs.forEach((doc) => b.delete(doc.ref));
      await b.commit();
      snap = await query.limit(CHUNK).get();
    }
  }

  /** 退会後もルートに残すフィールド（Firestore ルール allowlist かつ運用上保持するもの） */
  const WITHDRAW_PROFILE_RETAIN_KEYS = new Set([
    "id",
    "display_name",
    "avatar_url",
    "cover_image_url",
    "withdrawn",
    "withdrawn_at",
    "updated_at",
    "created_at",
    "marchinz_public_id",
    "banned",
    "banned_at",
    "banned_reason",
  ]);

  if (btnAccountWithdraw) {
    btnAccountWithdraw.addEventListener("click", async () => {
      if (!currentUser?.id) return;
      const firebaseUser = auth.currentUser;
      if (!firebaseUser || firebaseUser.uid !== currentUser.id) {
        alert(AUTH_MESSAGE.withdrawNeedsFirebaseAuth);
        return;
      }
      if (
        !window.confirm(
          [
            "退会すると次を行います。よろしいですか？",
            "",
            "・残す場合があるもの: 作成したイベント情報、掲示板の投稿",
            "・削除: プロフィールおよびアップロード画像、MarchinZ Note、MarchinZ Log、マイリスト",
            "・Google アカウントとの連携も解除されます",
            "",
            "続行する場合は、この後に表示される Google の再認証に応じてください。",
          ].join("\n"),
        )
      ) {
        return;
      }
      const uid = currentUser.id;
      try {
        const provider = new window.firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await firebaseUser.reauthenticateWithPopup(provider);
      } catch {
        alert(AUTH_MESSAGE.withdrawNeedReauth);
        return;
      }
      showProcessingOverlay("退会処理中…");
      if (btnAccountWithdraw instanceof HTMLButtonElement) btnAccountWithdraw.disabled = true;
      try {
        await deleteWithdrawalOwnedStorage(uid);
        const profRef = db.collection("mll_profiles").doc(uid);
        await deleteFirestoreByQueryBatches(profRef.collection("video_bookmarks"));
        await deleteFirestoreByQueryBatches(profRef.collection("channel_bookmarks"));
        await deleteFirestoreByQueryBatches(profRef.collection("video_lists"));
        await deleteFirestoreByQueryBatches(profRef.collection("channel_lists"));
        await deleteFirestoreByQueryBatches(profRef.collection("event_log_diaries"));
        await deleteFirestoreByQueryBatches(profRef.collection("notifications"));
        await profRef.collection(PROFILE_SENSITIVE_PRIVATE_COLLECTION).doc(PROFILE_SENSITIVE_PRIVATE_DOC_ID).delete().catch(() => {});
        await deleteFirestoreByQueryBatches(db.collection("mll_logs").where("user_id", "==", uid));
        const fv = window.firebase?.firestore?.FieldValue;
        const profSnap = await profRef.get();
        const existing = profSnap.exists ? profSnap.data() || {} : {};
        if (!fv?.delete) {
          throw new Error("Firestore の FieldValue が利用できません。ページを再読み込みしてください。");
        }
        const w = {
          id: uid,
          withdrawn: true,
          display_name: WITHDRAWN_NAME,
          avatar_url: "",
          cover_image_url: "",
          withdrawn_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        for (const k of Object.keys(existing)) {
          if (!WITHDRAW_PROFILE_RETAIN_KEYS.has(k)) {
            w[k] = fv.delete();
          }
        }
        await profRef.set(w, { merge: true });
        try {
          await firebaseUser.delete();
        } catch (delErr) {
          if (String(delErr?.code || "") !== "auth/user-not-found") throw delErr;
        }
      } catch (e) {
        const code = String(e?.code || "");
        const msg = String(e?.message || e || "");
        if (code === "auth/requires-recent-login") {
          alert(AUTH_MESSAGE.withdrawRetryAfterRelogin);
        } else {
          alert(`${AUTH_MESSAGE.withdrawPartialFailure}${msg ? `（${msg}）` : ""}`);
        }
        try {
          await auth.signOut();
        } catch {
          //
        }
        currentUser = null;
        rawAuthUserForAdmin = null;
        showLoggedOut();
        window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));
        return;
      } finally {
        hideProcessingOverlay();
        if (btnAccountWithdraw instanceof HTMLButtonElement) btnAccountWithdraw.disabled = false;
      }
      try {
        localStorage.removeItem("marchinz_mll_logs_v1");
        sessionStorage.removeItem("mll_intent_mylist_row_json");
        sessionStorage.removeItem("mll_intent_community_compose");
      } catch {
        //
      }
      clearLocalDevLoginUser();
      closeSettingsDialog();
      currentUser = null;
      rawAuthUserForAdmin = null;
      currentProfileWithdrawn = false;
      showLoggedOut();
      window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));
      openWithdrawDoneDialog();
    });
  }

  if (btnAuthLoginGoogle && window.MLL_AUTH?.firebaseAuthAvailable) btnAuthLoginGoogle.disabled = false;
  syncSignupEntryConsentUi();

  if (profileForm) {
    profileForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!currentUser) return;
      if (legalGateBlocking) return;
      if (currentProfileWithdrawn) return;
      const profileSaveBtn = profileForm.querySelector('button[type="submit"]');
      const profileNameError = document.getElementById("profile-error-display-name");
      const setProfileError = (el, message) => {
        if (!(el instanceof HTMLElement)) return;
        el.textContent = String(message || "");
        el.hidden = !message;
      };
      const profileErrorPrefecture = document.getElementById("profile-error-prefecture");
      const profileErrorGender = document.getElementById("profile-error-gender");
      const profileErrorBirthdate = document.getElementById("profile-error-birthdate");
      setProfileError(profileNameError, "");
      setProfileError(profileErrorPrefecture, "");
      setProfileError(profileErrorGender, "");
      setProfileError(profileErrorBirthdate, "");
      const displayName = (inputDisplayName?.value || "").trim();
      if (!displayName) {
        setProfileError(profileNameError, "入力してください");
        inputDisplayName?.focus();
        return;
      }
      const prefecture = String(profilePrefecture?.value || "").trim();
      if (!prefecture || !PROFILE_JP_PREFS_SET.has(prefecture)) {
        setProfileError(profileErrorPrefecture, "都道府県を選択してください");
        profilePrefecture?.focus();
        return;
      }
      const gender = String(profileGender?.value || "").trim();
      if (!PROFILE_GENDER_VALUES.includes(gender)) {
        setProfileError(profileErrorGender, "性別を選択してください");
        profileGender?.focus();
        return;
      }
      const birthRaw = String(profileBirthdate?.value || "").trim();
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birthRaw)) {
        setProfileError(profileErrorBirthdate, "誕生日を選択してください");
        profileBirthdate?.focus();
        return;
      }
      const bio = String(profileBio?.value || "").trim();
      if (bio.length > 4000) {
        alert("プロフィール（自由入力）は 4000 文字以内にしてください。");
        profileBio?.focus();
        return;
      }
      try {
        const dupSnap = await db.collection("mll_profiles").where("display_name", "==", displayName).limit(10).get();
        const dup = dupSnap.docs.find((d) => d.id !== currentUser.id && !Boolean((d.data() || {}).withdrawn));
        if (dup) {
          alert("そのプロフィール名は既に使われています。別の名前を入力してください。");
          inputDisplayName?.focus();
          return;
        }
      } catch {
        // Query failure should not block user forever; continue to save attempt.
      }
      const fv = window.firebase?.firestore?.FieldValue;
      const payload = {
        id: currentUser.id,
        display_name: displayName,
        profile_address_prefecture: prefecture,
        profile_address_prefecture_public: Boolean(
          profileAddressPrefecturePublic instanceof HTMLInputElement && profileAddressPrefecturePublic.checked,
        ),
        profile_bio: bio,
        updated_at: new Date().toISOString(),
      };
      if (fv?.delete) {
        payload.profile_prefecture = fv.delete();
        payload.profile_gender = fv.delete();
        payload.profile_birthdate = fv.delete();
      }
      const st = window.MLL_AUTH?.getStorage?.();
      const needAvatar = Boolean(inputAvatarFile?.files?.[0]);
      const needCover = Boolean(inputCoverFile?.files?.[0]);
      if ((needAvatar || needCover) && !st) {
        alert(AUTH_MESSAGE.storageUnavailable);
        return;
      }
      if (profileSaveBtn instanceof HTMLButtonElement) profileSaveBtn.disabled = true;
      showProcessingOverlay("処理中...");
      try {
        if (st && needAvatar) {
          const blob = await compressProfileImageForUpload(inputAvatarFile.files[0]);
          payload.avatar_url = await uploadProfileJpeg(st, currentUser.id, "avatar.jpg", blob);
        }
        if (st && needCover) {
          const blob = await compressProfileImageForUpload(inputCoverFile.files[0]);
          payload.cover_image_url = await uploadProfileJpeg(st, currentUser.id, "cover.jpg", blob);
          if (fv?.delete) {
            payload.cover_image_urls = fv.delete();
            payload.cover_slideshow_style = fv.delete();
          }
        }
        const profRoot = db.collection("mll_profiles").doc(currentUser.id);
        await profRoot.collection(PROFILE_SENSITIVE_PRIVATE_COLLECTION).doc(PROFILE_SENSITIVE_PRIVATE_DOC_ID).set(
          {
            profile_gender: gender,
            profile_birthdate: birthRaw,
            updated_at: new Date().toISOString(),
          },
          { merge: true },
        );
        await profRoot.set(payload, { merge: true });
      } catch (e) {
        if (String(e?.message || "") === window.MarchinZImage?.ERR_TOO_LARGE) {
          window.alert(`code: ${(e?.code || "image/too-large").toString()}\nmessage: ${AUTH_MESSAGE.fileTooLarge}`);
          return;
        }
        window.alert(`code: ${(e?.code || "unknown").toString()}\nmessage: ${(e?.message || authFriendlyErrorMessage(e, AUTH_MESSAGE.saveFailed)).toString()}`);
        return;
      } finally {
        if (profileSaveBtn instanceof HTMLButtonElement) profileSaveBtn.disabled = false;
        hideProcessingOverlay();
      }
      const p = await fetchProfile(currentUser);
      showLoggedInView(p.display_name, p.avatar_url);
      profileSetupRequired = false;
      closeProfileDialog();
      window.dispatchEvent(new CustomEvent("marchinz-profile-saved", { detail: { id: currentUser.id } }));
    });
  }

  function profileRawMaxBytes() {
    return window.MarchinZImage?.RAW_INPUT_MAX_BYTES || 20 * 1024 * 1024;
  }

  inputAvatarFile?.addEventListener("change", () => {
    const f = inputAvatarFile.files?.[0];
    const img = document.getElementById("profile-avatar-preview");
    if (!(img instanceof HTMLImageElement)) return;
    if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    if (!f) {
      void hydrateProfileForm().catch(() => {});
      return;
    }
    if (f.size > profileRawMaxBytes()) {
      window.alert(AUTH_MESSAGE.fileTooLarge);
      inputAvatarFile.value = "";
      void hydrateProfileForm().catch(() => {});
      return;
    }
    img.src = URL.createObjectURL(f);
    img.hidden = false;
  });
  inputCoverFile?.addEventListener("change", () => {
    const f = inputCoverFile.files?.[0];
    const img = document.getElementById("profile-cover-preview");
    if (!(img instanceof HTMLImageElement)) return;
    if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    if (!f) {
      void hydrateProfileForm().catch(() => {});
      return;
    }
    if (f.size > profileRawMaxBytes()) {
      window.alert(AUTH_MESSAGE.fileTooLarge);
      inputCoverFile.value = "";
      void hydrateProfileForm().catch(() => {});
      return;
    }
    img.src = URL.createObjectURL(f);
    img.hidden = false;
  });

  auth.onAuthStateChanged((rawUser) => {
    rawAuthUserForAdmin = rawUser;
    const user = mapFirebaseUser(rawUser);
    if (!user) {
      const localDevUser = readLocalDevLoginUser();
      if (localDevUser) {
        onSignedIn(localDevUser);
        return;
      }
      currentUser = null;
      rawAuthUserForAdmin = null;
      showLoggedOut();
      if (!isAuthRedirectPending()) setAuthLoadingOverlayVisible(false);
      window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));
      scheduleMllEventFormResync();
      return;
    }
    setAuthRedirectPending(false);
    setAuthLoadingOverlayVisible(false);
    onSignedIn(user);
  });

  try {
    const remembered = localStorage.getItem(AUTH_REMEMBER_STORAGE_KEY);
    if (authLoginRememberSession) authLoginRememberSession.checked = remembered !== "0";
  } catch {
    if (authLoginRememberSession) authLoginRememberSession.checked = true;
  }
  setAuthLoadingOverlayVisible(isAuthRedirectPending());

  // リダイレクト結果はバックグラウンドで回収するだけにし、UI更新は onAuthStateChanged に一元化する。
  auth.getRedirectResult().catch((err) => {
    lastRedirectAuthErrorCode = String(err?.code || "").trim();
    // 初回ロードでも発火し得るため、UX悪化を避けてUIへは出さない。
    console.warn("[MarchinZ] getRedirectResult (suppressed)", lastRedirectAuthErrorCode || err);
    return null;
  });
})();
