(() => {
  const WITHDRAWN_NAME = "退会ユーザー";
  const AUTH_RETURN_STORAGE_KEY = "mll_auth_return_to";
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
  const publicRedirectUrl = String(cfg.publicRedirectUrl || "https://marchinz.netlify.app/#mll").trim();
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
  const siteBrandActions = document.getElementById("site-brand-actions");
  const btnAuthLoginGoogle = document.getElementById("btn-auth-login-google");
  const btnAuthSignupGoogle = document.getElementById("btn-auth-signup-google");
  const authSignupAgreeTerms = document.getElementById("auth-signup-agree-terms");
  const authSignupAgreePrivacy = document.getElementById("auth-signup-agree-privacy");

  /** Firebase 初期化後に差し替え（未設定時は空振り） */
  let hydrateProfileForm = async () => {};

  /** メールは画面・getUser には出さず、管理者判定だけ raw の Auth から読む */
  let rawAuthUserForAdmin = null;
  let currentUser = null;

  let currentProfileWithdrawn = false;
  let accountDropdownOpen = false;

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

  function closeProfileDialog() {
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
      window.location.assign(`${base}#mll`);
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
    if (raw == null || raw === "") return "#mll";
    let decoded;
    try {
      decoded = decodeURIComponent(String(raw));
    } catch {
      decoded = String(raw);
    }
    const idx = decoded.indexOf("#");
    const hashPart = idx >= 0 ? decoded.slice(idx).trim() : "#mll";
    const m = /^#([\w-]+)$/.exec(hashPart);
    if (!m) return "#mll";
    const pageId = m[1];
    if (pageId === "login" || pageId === "signup") return "#mll";
    if (!RETURN_PAGE_IDS.has(pageId)) return "#mll";
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
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}#mll`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }

  function syncSignupEntryConsentUi() {
    if (!btnAuthSignupGoogle) return;
    const okConsent = Boolean(authSignupAgreeTerms?.checked && authSignupAgreePrivacy?.checked);
    const firebaseOk = Boolean(window.MLL_AUTH?.firebaseAuthAvailable);
    btnAuthSignupGoogle.disabled = !(firebaseOk && okConsent);
  }

  function showLoggedOut() {
    currentProfileWithdrawn = false;
    closeAccountDropdown();
    closeProfileDialog();
    closeSettingsDialog();
    setFirebaseHintVisible("");
    if (menuOpenProfileEdit) menuOpenProfileEdit.hidden = false;
    if (menuOpenSettings) menuOpenSettings.hidden = false;
    if (authSignupAgreeTerms) authSignupAgreeTerms.checked = false;
    if (authSignupAgreePrivacy) authSignupAgreePrivacy.checked = false;
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
      if (currentProfileWithdrawn) {
        headerProfileAvatar.src = `data:image/svg+xml,${encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#ffffff"/></svg>',
        )}`;
        headerProfileAvatar.alt = "";
      } else {
        headerProfileAvatar.src = avatarUrl || "logo/marchinz-logo.png";
        headerProfileAvatar.alt = `${displayName || "ユーザー"} のプロフィール画像`;
      }
    }
    if (mobileDrawerAvatar) {
      if (currentProfileWithdrawn) {
        mobileDrawerAvatar.src = `data:image/svg+xml,${encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#ffffff"/></svg>',
        )}`;
        mobileDrawerAvatar.alt = "";
      } else {
        mobileDrawerAvatar.src = avatarUrl || "logo/marchinz-logo.png";
        mobileDrawerAvatar.alt = `${displayName || "ユーザー"} のプロフィール画像`;
      }
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
        alert("Firebase が未設定です。auth-config.js を確認してください。");
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
          alert("利用規約とプライバシーポリシーの両方に同意してください。");
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
        status.textContent = "いいね表示の設定を読み込めませんでした。";
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
    if (/^https?:\/\//i.test(u)) return u;
    const arr = Array.isArray(data.cover_image_urls) ? data.cover_image_urls : [];
    for (const x of arr) {
      const s = String(x || "").trim();
      if (/^https?:\/\//i.test(s)) return s;
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
      av.src = au && /^https?:\/\//i.test(au) ? au : "logo/marchinz-logo.png";
      av.hidden = false;
    }
    const cv = document.getElementById("profile-cover-preview");
    if (cv instanceof HTMLImageElement) {
      if (cv.src.startsWith("blob:")) URL.revokeObjectURL(cv.src);
      const cu = p.withdrawn ? "" : String(p.cover_image_url || "").trim();
      if (cu && /^https?:\/\//i.test(cu)) {
        cv.src = cu;
        cv.hidden = false;
      } else {
        cv.removeAttribute("src");
        cv.hidden = true;
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

  async function signInWithGoogle() {
    try {
      const provider = new window.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const useRedirect = window.location.protocol === "file:";
      if (useRedirect) {
        await auth.signInWithRedirect(provider);
        location.href = publicRedirectUrl;
        return;
      }
      try {
        await auth.signInWithPopup(provider);
      } catch (popupErr) {
        await auth.signInWithRedirect(provider);
      }
    } catch (err) {
      const code = String(err?.code || "");
      const msg = code ? `（${code}）` : "";
      alert(`Googleログインを開始できませんでした${msg}。設定を確認してください。`);
      throw err;
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
      cover_image_url: "",
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
          alert(
            "利用規約により、このアカウントは凍結されています。お問い合わせは #ops（お問い合わせフォーム）から運営へご連絡ください。",
          );
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
    window.dispatchEvent(
      new CustomEvent("mll-auth-changed", { detail: { user: currentUser, isAdmin: isAdminUser(currentUser) } })
    );
  }

  [authSignupAgreeTerms, authSignupAgreePrivacy].forEach((el) => {
    el?.addEventListener("change", () => syncSignupEntryConsentUi());
  });

  if (btnAuthLoginGoogle) {
    btnAuthLoginGoogle.addEventListener("click", () => {
      void signInWithGoogle().catch((err) => {
        console.error("[MarchinZ] Google sign-in", err);
      });
    });
  }

  if (btnAuthSignupGoogle) {
    btnAuthSignupGoogle.addEventListener("click", () => {
      if (!authSignupAgreeTerms?.checked || !authSignupAgreePrivacy?.checked) {
        alert("利用規約とプライバシーポリシーの両方に同意してください。");
        return;
      }
      void signInWithGoogle().catch((err) => {
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
      closeProfileDialog();
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
        alert("退会を完了するには、Googleアカウントの再認証が必要です。キャンセルした場合は退会は行われていません。");
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
          alert(
            "Google 連携の解除（Auth アカウント削除）に失敗しました。一度ログアウトし、Googleで再ログインしたうえで、もう一度「退会」からお試しください。\n直前までにデータ削除や退会フラグの更新が進んでいる場合があります。",
          );
        } else {
          alert(
            `退会処理の途中でエラーが発生しました。${msg ? `（${msg}）` : ""}\n一部だけ削除されている場合があります。しばらくしてから再度お試しください。`,
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
      const displayName = (inputDisplayName?.value || "").trim() || "ユーザー";
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
        alert("Firebase Storage が利用できないため画像を保存できません。");
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
          return;
        }
        alert(String(e?.message || e || "保存に失敗しました。"));
        return;
      }
      const p = await fetchProfile(currentUser);
      showLoggedInView(p.display_name, p.avatar_url);
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
      window.alert("ファイルサイズが大きすぎます。20MB以下の画像を選択してください");
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
      window.alert("ファイルサイズが大きすぎます。20MB以下の画像を選択してください");
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
    await onSignedIn(user);
  });

  auth
    .getRedirectResult()
    .catch(() => null)
    .finally(() => {
      rawAuthUserForAdmin = auth.currentUser;
      const user = mapFirebaseUser(auth.currentUser);
      if (!user) {
        currentUser = null;
        rawAuthUserForAdmin = null;
        showLoggedOut();
        window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));
      } else {
        void onSignedIn(user);
      }
    });
})();
