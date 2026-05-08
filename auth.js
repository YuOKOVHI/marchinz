(() => {
  const WITHDRAWN_NAME = "退会ユーザー";
  const AUTH_RETURN_STORAGE_KEY = "mll_auth_return_to";
  const AUTH_ENTRY_MODE_STORAGE_KEY = "mll_auth_entry_mode";
  const AUTH_REDIRECT_PENDING_KEY = "mll_auth_redirect_pending";
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
  const appCheckCfg = cfg.appCheck || {};
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
  const siteBrandActions = document.getElementById("site-brand-actions");
  const btnAuthLoginGoogle = document.getElementById("btn-auth-login-google");
  const btnAuthSignupGoogle = document.getElementById("btn-auth-signup-google");
  const authLoginRememberSession = document.getElementById("auth-login-remember-session");
  const authSignupAgreeTerms = document.getElementById("auth-signup-agree-terms");
  const authSignupAgreePrivacy = document.getElementById("auth-signup-agree-privacy");
  const authSignupConsentMsg = document.getElementById("auth-signup-consent-msg");
  const authLoginMsg = document.getElementById("auth-login-msg");
  const authSignupMsg = document.getElementById("auth-signup-msg");

  /** Firebase 初期化後に差し替え（未設定時は空振り） */
  let hydrateProfileForm = async () => {};

  /** メールは画面・getUser には出さず、管理者判定だけ raw の Auth から読む */
  let rawAuthUserForAdmin = null;
  let currentUser = null;

  let currentProfileWithdrawn = false;
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
    agreeRequired: "利用規約とプライバシーポリシーの両方に同意してください。",
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
      return "データの保存が許可されませんでした。Firebase の Firestore ルール、または App Check（本番）の設定を確認してください。";
    if (code === "storage/unauthorized" || code === "storage/canceled")
      return "画像ストレージへの保存が許可されませんでした。Storage のルールとログイン状態を確認してください。";
    if (code.startsWith("storage/"))
      return `画像の保存に失敗しました（${code}）。ファイル形式は JPEG（自動変換済み）か確認してください。`;
    if (code === "auth/popup-timeout")
      return "認証画面の応答が遅すぎるため、別のログイン方式に切り替えました。Google の画面が開くまでお待ちください。";
    return fallback;
  }

  /** Brave（デスクトップ含む）は redirect 復帰後に getRedirectResult / currentUser が空になりやすい。popup を先に試す。 */
  function isBraveBrowser() {
    return /\bBrave\b/i.test(String(navigator.userAgent || ""));
  }

  function isIOSSafari() {
    const ua = String(navigator.userAgent || "");
    const isiOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!isiOS) return false;
    return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Brave/i.test(ua);
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

  function closeProfileDialog(force = false) {
    if (profileSetupRequired && !force) return;
    if (profileDialog) profileDialog.hidden = true;
  }

  function openProfileDialog() {
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
    if (siteBrandActions) siteBrandActions.hidden = loggedIn;
    if (siteBrandUserArea) siteBrandUserArea.hidden = !loggedIn;
    if (siteMobileDrawerGuest) siteMobileDrawerGuest.hidden = loggedIn;
    if (siteMobileDrawerUser) siteMobileDrawerUser.hidden = !loggedIn;
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
    const okConsent = Boolean(authSignupAgreeTerms?.checked && authSignupAgreePrivacy?.checked);
    if (authEntryBusy) {
      btnAuthSignupGoogle.disabled = true;
      if (authSignupConsentMsg) authSignupConsentMsg.textContent = "認証を開始しています。しばらくお待ちください。";
      return;
    }
    const firebaseOk = Boolean(window.MLL_AUTH?.firebaseAuthAvailable);
    btnAuthSignupGoogle.disabled = !firebaseOk;
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
  }

  function showLoggedOut() {
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
      isAppCheckActive: () => false,
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
  const db = app.firestore();
  const storage = app.storage();

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

  /** App Check（reCAPTCHA v3）。本番では appCheck.recaptchaSiteKey を設定し、Console で Enforcement を入れる前に有効化すること。 */
  let appCheckActive = false;
  (function initFirebaseAppCheck() {
    const acFactory = window.firebase?.appCheck;
    if (typeof acFactory !== "function") return;
    const siteKey = String(appCheckCfg.recaptchaSiteKey || "").trim();
    const host = typeof location !== "undefined" ? String(location.hostname || "") : "";
    const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    const dbgTok = typeof appCheckCfg.debugToken === "string" ? appCheckCfg.debugToken.trim() : "";
    try {
      if (dbgTok) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = dbgTok;
      } else if (appCheckCfg.debug === true && isLoopback) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
    } catch {
      //
    }
    if (!siteKey) {
      if (isLoopback) {
        console.info(
          "[MarchinZ] App Check: recaptchaSiteKey 未設定のため未初期化（ローカル）。本番の auth-config.js にサイトキーを設定してください。",
        );
      } else {
        console.warn(
          "[MarchinZ] App Check: recaptchaSiteKey が空です。Firebase Console で Enforcement を有効にする前に設定してください。",
        );
      }
      return;
    }
    const Provider = acFactory.ReCaptchaV3Provider;
    if (typeof Provider !== "function") {
      console.warn("[MarchinZ] App Check: ReCaptchaV3Provider が読み込まれていません（firebase-app-check-compat.js を確認）。");
      return;
    }
    try {
      acFactory(app).activate(new Provider(siteKey), true);
      appCheckActive = true;
    } catch (e) {
      console.warn("[MarchinZ] App Check の有効化に失敗しました。", e);
    }
  })();

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
    } catch {
      // ignore
    }
    const popupFirst = isBraveBrowser() || isIOSSafari();
    try {
      if (popupFirst) {
        sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
      } else {
        sessionStorage.setItem(AUTH_REDIRECT_PENDING_KEY, "1");
      }
    } catch {
      // ignore
    }
    window.MarchinZTrackEvent?.("login_start", { entry });
    const unlockTimer = window.setTimeout(() => {
      if (authEntryBusy) setAuthEntryBusy(false);
    }, popupFirst ? 12000 : 8000);
    try {
      const provider = new window.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      if (popupFirst) {
        setAuthEntryMessage(entry, "Google認証を開始しています…", false);
        const popupPromise = auth.signInWithPopup(provider);
        try {
          await auth.setPersistence(persistence);
        } catch {
          // ignore
        }
        try {
          // iPhone Safari はユーザー操作待ちが必要なため、短い timeout で redirect へ落とすと失敗しやすい。
          // Safari だけは popup 完了まで待ち、明示的に block/cancel された時だけ redirect へフォールバックする。
          if (isIOSSafari()) {
            await popupPromise;
          } else {
            const popupTimeoutMs = 8000;
            const timeoutPromise = new Promise((_, reject) => {
              window.setTimeout(() => {
                const err = new Error("popup stall");
                err.code = "auth/popup-timeout";
                reject(err);
              }, popupTimeoutMs);
            });
            await Promise.race([popupPromise, timeoutPromise]);
          }
        } catch (popupErr) {
          const code = String(popupErr?.code || "");
          if (code === "auth/popup-closed-by-user") throw popupErr;
          if (code === "auth/popup-timeout" || code === "auth/popup-blocked" || code === "auth/cancelled-popup-request") {
            try {
              sessionStorage.setItem(AUTH_REDIRECT_PENDING_KEY, "1");
            } catch {
              // ignore
            }
            setAuthEntryMessage(entry, "別の方式でログインを続けます…", false);
            try {
              await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
            } catch {
              // ignore
            }
            await auth.signInWithRedirect(provider);
            return;
          }
          throw popupErr;
        }
        try {
          sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
        } catch {
          // ignore
        }
        return;
      }

      setAuthEntryMessage(entry, "Googleの認証ページへ移動します…", false);
      try {
        await auth.setPersistence(persistence);
      } catch {
        // ignore
      }
      await auth.signInWithRedirect(provider);
      return;
    } catch (err) {
      const fallback = "Googleログインを開始できませんでした。設定を確認してください。";
      const msg = authFriendlyErrorMessage(err, fallback);
      setAuthEntryMessage(entry, msg, true);
      alert(msg);
      throw err;
    } finally {
      window.clearTimeout(unlockTimer);
      setAuthEntryBusy(false);
    }
  }

  window.MLL_AUTH = {
    getDb: () => db,
    getStorage: () => storage,
    getUser: () => currentUser,
    isAdmin: () => isAdminUser(),
    firebaseAuthAvailable: true,
    isAppCheckActive: () => appCheckActive,
    signInWithGoogle,
    isWithdrawn: () => currentProfileWithdrawn,
  };

  async function fetchProfile(user) {
    const fallback = {
      display_name: user.user_metadata?.full_name || user.user_metadata?.name || "ユーザー",
      avatar_url: user.user_metadata?.avatar_url || "",
      cover_image_url: DEFAULT_COVER_IMAGE_URL,
      withdrawn: false,
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
        };
      }
      return {
        display_name: data.display_name || fallback.display_name,
        avatar_url: data.avatar_url || fallback.avatar_url,
        cover_image_url: resolveCoverImageUrlFromDocData(data),
        withdrawn: false,
      };
    } catch {
      return fallback;
    }
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
  }

  async function onSignedIn(user) {
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
          return;
        }
      }
    } catch {
      // Firestore 未設定・一時障害時はログイン継続。凍結の書き込みはルールで拒否される。
    }
    currentUser = user;
    await ensureProfile(user);
    await refreshProfileView(user);
    navigateAwayFromAuthEntryIfLoggedIn();
    window.MarchinZTrackEvent?.("login_success", { admin: isAdminUser(currentUser) ? 1 : 0 });
    window.dispatchEvent(
      new CustomEvent("mll-auth-changed", { detail: { user: currentUser, isAdmin: isAdminUser(currentUser) } })
    );
    if (consumeAuthEntryMode() === "signup") {
      profileSetupRequired = true;
      requestAnimationFrame(() => openProfileDialog());
    }
  }

  [authSignupAgreeTerms, authSignupAgreePrivacy].forEach((el) => {
    el?.addEventListener("change", () => syncSignupEntryConsentUi());
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
      if (!authSignupAgreeTerms?.checked || !authSignupAgreePrivacy?.checked) {
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

  if (btnAccountWithdraw) {
    btnAccountWithdraw.addEventListener("click", async () => {
      if (!currentUser?.id) return;
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
        await auth.currentUser.reauthenticateWithPopup(provider);
      } catch {
        alert(AUTH_MESSAGE.withdrawNeedReauth);
        return;
      }
      try {
        await deleteWithdrawalOwnedStorage(uid);
        const profRef = db.collection("mll_profiles").doc(uid);
        await deleteFirestoreByQueryBatches(profRef.collection("video_bookmarks"));
        await deleteFirestoreByQueryBatches(profRef.collection("channel_bookmarks"));
        await deleteFirestoreByQueryBatches(profRef.collection("video_lists"));
        await deleteFirestoreByQueryBatches(profRef.collection("channel_lists"));
        await deleteFirestoreByQueryBatches(profRef.collection("event_log_diaries"));
        await deleteFirestoreByQueryBatches(db.collection("mll_logs").where("user_id", "==", uid));
        const fv = window.firebase?.firestore?.FieldValue;
        const w = {
          id: uid,
          withdrawn: true,
          display_name: WITHDRAWN_NAME,
          avatar_url: "",
          cover_image_url: "",
          withdrawn_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (fv?.delete) {
          w.cover_image_urls = fv.delete();
          w.cover_slideshow_style = fv.delete();
          w.profile_bio = fv.delete();
          w.profile_attributes = fv.delete();
          w.prof_count_mll = fv.delete();
          w.prof_count_videos = fv.delete();
          w.prof_count_yt = fv.delete();
          w.prof_count_logdiary = fv.delete();
          w.section_vis_mll = fv.delete();
          w.section_vis_videos = fv.delete();
          w.section_vis_yt = fv.delete();
          w.section_vis_logdiary = fv.delete();
          for (const k of LIKE_SHOW_FIELD_NAMES) {
            w[k] = fv.delete();
          }
        }
        await db.collection("mll_profiles").doc(uid).set(w, { merge: true });
        await auth.currentUser.delete();
      } catch (e) {
        const code = String(e?.code || "");
        const msg = String(e?.message || e || "");
        if (code === "auth/requires-recent-login") {
          alert(AUTH_MESSAGE.withdrawRetryAfterRelogin);
        } else {
          alert(
            `${AUTH_MESSAGE.withdrawPartialFailure}${msg ? `（${msg}）` : ""}`,
          );
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
      }
      try {
        localStorage.removeItem("marchinz_mll_logs_v1");
        sessionStorage.removeItem("mll_intent_mylist_row_json");
        sessionStorage.removeItem("mll_intent_community_compose");
      } catch {
        //
      }
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
      if (currentProfileWithdrawn) return;
      const displayName = (inputDisplayName?.value || "").trim();
      if (!displayName) {
        alert("プロフィール名を入力してください。");
        inputDisplayName?.focus();
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
        updated_at: new Date().toISOString(),
      };
      const st = window.MLL_AUTH?.getStorage?.();
      const needAvatar = Boolean(inputAvatarFile?.files?.[0]);
      const needCover = Boolean(inputCoverFile?.files?.[0]);
      if ((needAvatar || needCover) && !st) {
        alert(AUTH_MESSAGE.storageUnavailable);
        return;
      }
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
        await db.collection("mll_profiles").doc(currentUser.id).set(payload, { merge: true });
      } catch (e) {
        if (String(e?.message || "") === window.MarchinZImage?.ERR_TOO_LARGE) {
          window.alert(AUTH_MESSAGE.fileTooLarge);
          return;
        }
        const extra = e?.code ? ` [${e.code}]` : "";
        alert((authFriendlyErrorMessage(e, AUTH_MESSAGE.saveFailed) + extra).trim());
        return;
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

  auth.onAuthStateChanged(async (rawUser) => {
    rawAuthUserForAdmin = rawUser;
    const user = mapFirebaseUser(rawUser);
    if (!user) {
      currentUser = null;
      rawAuthUserForAdmin = null;
      showLoggedOut();
      window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));
      return;
    }
    try {
      sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
    } catch {
      // ignore
    }
    await onSignedIn(user);
  });

  let redirectResolvedUser = null;
  auth
    .getRedirectResult()
    .then((res) => {
      redirectResolvedUser = res?.user || null;
      return res;
    })
    .catch((err) => {
      lastRedirectAuthErrorCode = String(err?.code || "").trim();
      const fallback = "Googleログインを完了できませんでした。時間をおいて再度お試しください。";
      alert(authFriendlyErrorMessage(err, fallback));
      return null;
    })
    .finally(() => {
      void (async () => {
        try {
          const remembered = localStorage.getItem(AUTH_REMEMBER_STORAGE_KEY);
          if (authLoginRememberSession) authLoginRememberSession.checked = remembered !== "0";
        } catch {
          if (authLoginRememberSession) authLoginRememberSession.checked = true;
        }

        const readMappedUser = () => mapFirebaseUser(auth.currentUser);

        try {
          if (typeof auth.authStateReady === "function") {
            await auth.authStateReady();
          }
        } catch {
          // ignore
        }

        let redirectPending = false;
        try {
          redirectPending = sessionStorage.getItem(AUTH_REDIRECT_PENDING_KEY) === "1";
        } catch {
          redirectPending = false;
        }

        let user = readMappedUser();
        // iOS / Android WebView 系で IndexedDB 復元や auth の確定が遅れ、直後だけ currentUser が空になる。
        if (!user && redirectPending) {
          const ua = String(navigator.userAgent || "");
          const ipadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
          const slowAuthEnv =
            /iPhone|iPod|Android|CriOS|FxiOS|EdgiOS/i.test(ua) ||
            ipadOs ||
            /\bBrave\b/i.test(ua);
          const delaysMs = slowAuthEnv ? [100, 350, 900, 2200, 4500, 8000] : [80, 220, 600];
          for (const ms of delaysMs) {
            await new Promise((r) => setTimeout(r, ms));
            user = readMappedUser();
            if (user) break;
          }
        }

        if (user) {
          try {
            sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
          } catch {
            // ignore
          }
          rawAuthUserForAdmin = auth.currentUser;
          void onSignedIn(user);
          return;
        }

        currentUser = null;
        rawAuthUserForAdmin = null;
        showLoggedOut();
        window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));

        try {
          redirectPending = sessionStorage.getItem(AUTH_REDIRECT_PENDING_KEY) === "1";
          const hp = location.hash.replace(/^#/, "");
          if (redirectPending && (hp === "login" || hp === "signup")) {
            const codeText = lastRedirectAuthErrorCode ? `\n\nエラーコード: ${lastRedirectAuthErrorCode}` : "";
            if (lastRedirectAuthErrorCode) {
              setFirebaseHintVisible(
                "Googleログインを完了できませんでした。表示されたエラーコード（auth/...）を共有してください。"
              );
              alert(
                `Googleログインを完了できませんでした。\n\n現在のドメイン: ${location.hostname}${codeText}\n\nFirebase設定またはブラウザ制限が原因です。`
              );
            } else if (!redirectResolvedUser) {
              setFirebaseHintVisible(
                "Googleログインの戻りを受け取れませんでした。Brave はアドレスバーのライオン→このサイトのシールドをオフにして再試行してください。改善しない場合は別ブラウザをお試しください。"
              );
              alert(
                `Googleログインの戻りを受け取れませんでした。\n\n現在のドメイン: ${location.hostname}\n\n（主な原因）プライバシー保護・サードパーティ設定で認証の保存がブロックされていること、または戻り専用の情報が欠けていることです。Brave ではサイトのシールドをオフにしてからもう一度お試しください。`
              );
            }
          }
          sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
        } catch {
          // ignore
        }
      })();
    });
})();
