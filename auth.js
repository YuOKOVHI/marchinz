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
    "admin",
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

  let ephemeralToastTimer = 0;

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
  const cropDialog = document.getElementById("mz-crop-dialog");
  /** ファイル選択〜クロップ確定まで背面モーダル閉じ・保存をブロック */
  let profileCropGateActive = false;
  /** プロフィール保存の二重送信防止 */
  let profileSaveInFlight = false;
  let profileSaveBtnDefaultLabel = "";
  /** iOS ファイルピッカー直後の幽霊クリック対策（ms） */
  const PROFILE_CROP_PICKER_GHOST_MS = 450;
  let profileCropPickSession = 0;

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
  if (profileBio) {
    profileBio.addEventListener("input", () => {
      const warn = document.getElementById("profile-bio-warn");
      if (!warn) return;
      const len = (profileBio.value || "").length;
      if (len > 300) {
        warn.textContent = `300文字を超えています（現在 ${len} 文字）`;
        warn.className = "mll-field-error";
        warn.hidden = false;
      } else if (len > 250) {
        warn.textContent = `あと ${300 - len} 文字`;
        warn.className = "mll-field-warn";
        warn.hidden = false;
      } else {
        warn.hidden = true;
      }
    });
  }
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
  /** ヘッダー・UGC 等で使う mll_profiles の表示名（ニックネーム）。Google 表示名は使わない */
  let currentProfileDisplayName = "";
  /** 利用規約・ポリシー同意モーダル表示中は主要操作をブロックする */
  let legalGateBlocking = false;

  function isConsentGateBlocking() {
    return legalGateBlocking || Boolean(window.MarchinZBTest?.isBetaGateBlocking?.());
  }
  /** @type {(() => void) | null} */
  let legalGatePromiseResolve = null;
  let accountDropdownOpen = false;
  let profileSetupRequired = false;
  let authEntryBusy = false;
  let signupConsentTried = false;
  let lastRedirectAuthErrorCode = "";
  /** `getRedirectResult` でユーザー操作キャンセル等として静かに扱うエラーコード（alert しない） */
  const AUTH_REDIRECT_RESULT_QUIET_CODES = new Set([
    "auth/user-cancelled",
    "auth/popup-closed-by-user",
    "auth/cancelled-popup-request",
  ]);
  const AUTH_REMEMBER_STORAGE_KEY = "mll_auth_remember_session";
  const AUTH_BUSY_TEXT = "処理中...";
  const authButtonLabelStore = new WeakMap();
  function defaultProfileCoverDisplayUrl() {
    return (
      window.MarchinZDefaultAssets?.profileCoverDefault?.() || "img/defaults/cover_d.png"
    );
  }

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
  const PROFILE_GENDER_VALUES = ["男性", "女性", "無回答"];

  /** プロフィール属性（複数選択）。Firestore `profile_attributes` と対応（ルール: 最大20件・文字列リスト）。 */
  const PROFILE_ATTRIBUTE_OPTIONS = Object.freeze([
    "プレイヤー",
    "指導者",
    "チームスタッフ",
    "クリエイター",
    "運営/スタッフ",
    "元プレイヤー",
    "保護者",
    "ファン",
    "ショップ",
  ]);
  const PROFILE_ATTRIBUTE_OPTION_SET = new Set(PROFILE_ATTRIBUTE_OPTIONS);
  const PENDING_SIGNUP_PROFILE_ATTRS_KEY = "marchinz_pending_signup_profile_attributes";

  function sanitizeProfileAttributesList(raw) {
    const out = [];
    const seen = new Set();
    const arr = Array.isArray(raw) ? raw : [];
    for (const x of arr) {
      const s = String(x || "").trim();
      if (!PROFILE_ATTRIBUTE_OPTION_SET.has(s) || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= 20) break;
    }
    return out;
  }

  function collectSignupProfileAttributeSelections() {
    const boxes = document.querySelectorAll('input[type="checkbox"][data-signup-profile-attr]:checked');
    return sanitizeProfileAttributesList([...boxes].map((el) => el.getAttribute("data-signup-profile-attr")));
  }

  function collectProfileFormAttributeSelections() {
    const boxes = document.querySelectorAll('input[type="checkbox"][data-profile-form-attr]:checked');
    return sanitizeProfileAttributesList([...boxes].map((el) => el.getAttribute("data-profile-form-attr")));
  }

  function syncSignupProfileAttrCheckboxesFromList(arr) {
    const allowed = new Set(sanitizeProfileAttributesList(arr));
    document.querySelectorAll('input[type="checkbox"][data-signup-profile-attr]').forEach((el) => {
      const v = el.getAttribute("data-signup-profile-attr") || "";
      el.checked = allowed.has(v);
    });
  }

  function syncProfileFormAttrCheckboxesFromList(arr) {
    const allowed = new Set(sanitizeProfileAttributesList(arr));
    document.querySelectorAll('input[type="checkbox"][data-profile-form-attr]').forEach((el) => {
      const v = el.getAttribute("data-profile-form-attr") || "";
      el.checked = allowed.has(v);
    });
  }

  /** 既知オプションはフォームの選択どおり。一覧にしか無かった未知の文字列は末尾に温存（最大20件）。 */
  function mergeProfileAttributesForSave(selectedKnown, existingRaw) {
    const sel = sanitizeProfileAttributesList(selectedKnown);
    const seen = new Set(sel);
    const out = [...sel];
    const existing = Array.isArray(existingRaw) ? existingRaw : [];
    for (const x of existing) {
      const s = String(x || "").trim();
      if (!s || seen.has(s)) continue;
      if (PROFILE_ATTRIBUTE_OPTION_SET.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= 20) break;
    }
    return out;
  }

  async function applyPendingSignupProfileAttributes(user) {
    if (!db || !user?.id) return;
    let raw = "";
    try {
      raw = sessionStorage.getItem(PENDING_SIGNUP_PROFILE_ATTRS_KEY) || "";
    } catch {
      return;
    }
    if (!raw) return;
    let parsed = [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      try {
        sessionStorage.removeItem(PENDING_SIGNUP_PROFILE_ATTRS_KEY);
      } catch {
        //
      }
      return;
    }
    const cleaned = sanitizeProfileAttributesList(parsed);
    if (!cleaned.length) {
      try {
        sessionStorage.removeItem(PENDING_SIGNUP_PROFILE_ATTRS_KEY);
      } catch {
        //
      }
      return;
    }
    try {
      const ref = db.collection("mll_profiles").doc(user.id);
      const snap = await ref.get();
      const ex = snap.data() || {};
      const existing = Array.isArray(ex.profile_attributes) ? ex.profile_attributes : [];
      if (existing.length > 0) {
        try {
          sessionStorage.removeItem(PENDING_SIGNUP_PROFILE_ATTRS_KEY);
        } catch {
          //
        }
        return;
      }
      await ref.set({ profile_attributes: cleaned, updated_at: new Date().toISOString() }, { merge: true });
      try {
        sessionStorage.removeItem(PENDING_SIGNUP_PROFILE_ATTRS_KEY);
      } catch {
        //
      }
    } catch (e) {
      console.warn("[MarchinZ] applyPendingSignupProfileAttributes", e);
    }
  }
  const PROFILE_SENSITIVE_PRIVATE_COLLECTION = "profile_private";
  const PROFILE_SENSITIVE_PRIVATE_DOC_ID = "default";
  /** Firestore の legal_policy_accepted_version と一致させる。改定時は値を上げて再同意フローを発火する。 */
  const LEGAL_POLICY_VERSION = "2026-05-20-v1";

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

  /**
   * Google OAuth はアプリ内ブラウザ（LINE / Instagram / X 等）で 403 disallowed_useragent になる。
   * @returns {boolean}
   */
  function isInAppBrowserBlockingGoogleOAuth() {
    if (typeof window.MarchinZInAppBrowser?.detect === "function") {
      return window.MarchinZInAppBrowser.detect();
    }
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

  const IN_APP_BROWSER_AUTH_MESSAGE =
    "このブラウザ（アプリ内ブラウザ）では Google ログインが使えません。\n\n" +
    "Safari または Chrome で https://marchinz.netlify.app を開き直してから、もう一度お試しください。\n\n" +
    "LINE・Instagram・X などのアプリ内でリンクを開いた場合は、メニューから「ブラウザで開く」「Safariで開く」を選んでください。";

  function syncInAppBrowserAuthGate() {
    const blocked = isInAppBrowserBlockingGoogleOAuth();
    const loginBtn = document.getElementById("btn-auth-login-google");
    const signupBtn = document.getElementById("btn-auth-signup-google");
    for (const pageId of ["page-login", "page-signup"]) {
      const page = document.getElementById(pageId);
      if (!page) continue;
      let notice = page.querySelector(".auth-inapp-browser-notice");
      if (blocked) {
        if (!notice) {
          notice = document.createElement("div");
          notice.className = "auth-inapp-browser-notice";
          notice.setAttribute("role", "alert");
          const p = document.createElement("p");
          p.className = "auth-inapp-browser-notice__text";
          p.textContent =
            "このアプリ内ブラウザでは Google ログインが使えません。ログインするときは Safari または Chrome で開き直してください。";
          const copyBtn = document.createElement("button");
          copyBtn.type = "button";
          copyBtn.className = "btn-reset-search auth-inapp-browser-notice__copy";
          copyBtn.textContent = "URLをコピー";
          copyBtn.addEventListener("click", () => {
            const rawUrl = String(location.href || publicRedirectUrl).trim();
            const withParam = window.MarchinZUrlShare?.withOpenExternalBrowserParam;
            const url = typeof withParam === "function" ? withParam(rawUrl) : rawUrl;
            const done = () => window.alert("URLをコピーしました。Safari または Chrome のアドレス欄に貼り付けて開いてください。");
            if (navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(url).then(done).catch(() => window.alert(url));
            } else {
              window.prompt("次のURLをコピーして Safari / Chrome で開いてください", url);
            }
          });
          notice.append(p, copyBtn);
          const actions = page.querySelector(".auth-entry-actions");
          if (actions) page.querySelector(".auth-entry-panel")?.insertBefore(notice, actions);
          else page.querySelector(".auth-entry-panel")?.prepend(notice);
        }
        notice.hidden = false;
      } else if (notice) {
        notice.hidden = true;
      }
    }
    if (loginBtn instanceof HTMLButtonElement) {
      loginBtn.disabled = blocked;
      loginBtn.setAttribute("aria-disabled", blocked ? "true" : "false");
    }
    if (signupBtn instanceof HTMLButtonElement && blocked) {
      signupBtn.disabled = true;
      signupBtn.setAttribute("aria-disabled", "true");
    }
    if (blocked && typeof window.MarchinZInAppBrowser?.init === "function") {
      window.MarchinZInAppBrowser.init();
    }
  }

  function authFriendlyErrorMessage(err, fallback) {
    const code = String(err?.code || "").trim();
    const msg = String(err?.message || "");
    if (/disallowed_useragent/i.test(code) || /disallowed_useragent/i.test(msg)) {
      return IN_APP_BROWSER_AUTH_MESSAGE;
    }
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
    if (profileCropGateActive) return;
    if (profileDialog) profileDialog.hidden = true;
    document.documentElement.classList.remove("mz-profile-dialog-open");
    document.body.classList.remove("mz-profile-dialog-open");
    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.width = "";
    document.body.style.top = "";
  }

  /** 保存成功など短いメッセージ（ダイアログを閉じた後も視認できるよう body 直下に表示） */
  function showEphemeralGlobalMessage(text) {
    const id = "mz-ephemeral-toast";
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.className = "mz-ephemeral-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = String(text || "");
    el.hidden = false;
    el.classList.add("mz-ephemeral-toast--visible");
    clearTimeout(ephemeralToastTimer);
    ephemeralToastTimer = window.setTimeout(() => {
      el.classList.remove("mz-ephemeral-toast--visible");
      el.hidden = true;
    }, 2800);
  }

  window.MarchinZEphemeralMessage = showEphemeralGlobalMessage;

  const profileDialogTitle = document.getElementById("mz-profile-dialog-title");
  const btnProfileSave = document.getElementById("btn-profile-save");

  function getProfileSaveButton() {
    if (btnProfileSave instanceof HTMLButtonElement) return btnProfileSave;
    return profileForm?.querySelector('button[type="submit"]') ?? null;
  }

  function beginProfileSaveBusy() {
    profileSaveInFlight = true;
    const btn = getProfileSaveButton();
    if (btn instanceof HTMLButtonElement) {
      if (!profileSaveBtnDefaultLabel) {
        profileSaveBtnDefaultLabel = btn.textContent || "保存";
      }
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.textContent = "保存中…";
    }
    if (profileForm instanceof HTMLFormElement) {
      profileForm.setAttribute("aria-busy", "true");
    }
    showProcessingOverlay("保存中…");
  }

  function endProfileSaveBusy() {
    profileSaveInFlight = false;
    const btn = getProfileSaveButton();
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.textContent =
        profileSaveBtnDefaultLabel || (profileSetupRequired ? "保存してはじめる" : "保存");
    }
    if (profileForm instanceof HTMLFormElement) {
      profileForm.removeAttribute("aria-busy");
    }
    hideProcessingOverlay();
  }

  /** @param {HTMLElement|null} errorEl @param {string} message @param {string} [fieldKey] */
  function setProfileFieldError(errorEl, message, fieldKey = "") {
    const msg = String(message || "").trim();
    if (errorEl instanceof HTMLElement) {
      errorEl.textContent = msg;
      errorEl.hidden = !msg;
    }
    if (fieldKey) {
      const wrap = profileForm?.querySelector(`[data-profile-field="${fieldKey}"]`);
      if (wrap instanceof HTMLElement) {
        wrap.classList.toggle("profile-form-field--has-error", Boolean(msg));
      }
    }
  }

  function clearProfileFormFieldErrors() {
    const keys = ["display_name", "prefecture", "gender", "birthdate", "attributes"];
    const errIds = {
      display_name: "profile-error-display-name",
      prefecture: "profile-error-prefecture",
      gender: "profile-error-gender",
      birthdate: "profile-error-birthdate",
      attributes: "profile-error-attributes",
    };
    for (const key of keys) {
      setProfileFieldError(document.getElementById(errIds[key]), "", key);
    }
  }

  /**
   * @returns {{ ok: boolean; firstFocus?: HTMLElement|null }}
   */
  function validateProfileFormFields() {
    clearProfileFormFieldErrors();
    /** @type {HTMLElement|null} */
    let firstFocus = null;
    const mark = (el) => {
      if (!firstFocus && el instanceof HTMLElement) firstFocus = el;
    };

    const displayName = (inputDisplayName?.value || "").trim();
    if (!displayName) {
      setProfileFieldError(
        document.getElementById("profile-error-display-name"),
        "表示名（ニックネーム）を記入してください",
        "display_name",
      );
      mark(inputDisplayName);
    }

    const prefecture = String(profilePrefecture?.value || "").trim();
    if (profileSetupRequired) {
      if (!prefecture || !PROFILE_JP_PREFS_SET.has(prefecture)) {
        setProfileFieldError(
          document.getElementById("profile-error-prefecture"),
          "居住地（都道府県）を選択してください",
          "prefecture",
        );
        mark(profilePrefecture);
      }
    } else if (prefecture && !PROFILE_JP_PREFS_SET.has(prefecture)) {
      setProfileFieldError(
        document.getElementById("profile-error-prefecture"),
        "居住地（都道府県）を選択してください",
        "prefecture",
      );
      mark(profilePrefecture);
    }

    const gender = String(profileGender?.value || "").trim();
    if (profileSetupRequired) {
      if (!gender || !PROFILE_GENDER_VALUES.includes(gender)) {
        setProfileFieldError(
          document.getElementById("profile-error-gender"),
          "性別を選択してください",
          "gender",
        );
        mark(profileGender);
      }
    } else if (gender && !PROFILE_GENDER_VALUES.includes(gender)) {
      setProfileFieldError(
        document.getElementById("profile-error-gender"),
        "性別を選択してください",
        "gender",
      );
      mark(profileGender);
    }

    const birthRaw = String(profileBirthdate?.value || "").trim();
    if (profileSetupRequired) {
      if (!birthRaw || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birthRaw)) {
        setProfileFieldError(
          document.getElementById("profile-error-birthdate"),
          "誕生日を記入してください",
          "birthdate",
        );
        mark(profileBirthdate);
      }
    } else if (birthRaw && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birthRaw)) {
      setProfileFieldError(
        document.getElementById("profile-error-birthdate"),
        "誕生日を記入してください",
        "birthdate",
      );
      mark(profileBirthdate);
    }

    const attrs = collectProfileFormAttributeSelections();
    if (attrs.length < 1) {
      setProfileFieldError(
        document.getElementById("profile-error-attributes"),
        "カテゴリーを1つ以上選択してください",
        "attributes",
      );
      const attrsBlock = document.getElementById("profile-form-attrs-heading");
      mark(attrsBlock);
    }

    return { ok: !firstFocus, firstFocus };
  }

  function wireProfileFormValidationClear() {
    if (!profileForm || profileForm.dataset.mzProfileValidationWired === "1") return;
    profileForm.dataset.mzProfileValidationWired = "1";
    const onEdit = (fieldKey) => {
      const errIds = {
        display_name: "profile-error-display-name",
        prefecture: "profile-error-prefecture",
        gender: "profile-error-gender",
        birthdate: "profile-error-birthdate",
        attributes: "profile-error-attributes",
      };
      setProfileFieldError(document.getElementById(errIds[fieldKey]), "", fieldKey);
    };
    inputDisplayName?.addEventListener("input", () => onEdit("display_name"));
    profilePrefecture?.addEventListener("change", () => onEdit("prefecture"));
    profileGender?.addEventListener("change", () => onEdit("gender"));
    profileBirthdate?.addEventListener("change", () => onEdit("birthdate"));
    profileForm.querySelectorAll("[data-profile-form-attr]").forEach((el) => {
      el.addEventListener("change", () => onEdit("attributes"));
    });
  }

  function syncProfileDialogSignupMode() {
    if (profileDialogTitle instanceof HTMLElement) {
      profileDialogTitle.textContent = profileSetupRequired ? "プロフィール記入" : "プロフィール編集";
    }
    if (btnProfileSave instanceof HTMLButtonElement) {
      profileSaveBtnDefaultLabel = profileSetupRequired ? "保存してはじめる" : "保存";
      btnProfileSave.textContent = profileSaveBtnDefaultLabel;
    }
    if (btnProfileCancel instanceof HTMLButtonElement) {
      btnProfileCancel.hidden = profileSetupRequired;
    }
    const signupOnlyRequired = new Set(["prefecture", "gender", "birthdate"]);
    profileForm?.querySelectorAll("[data-profile-field]").forEach((wrap) => {
      const key = wrap.getAttribute("data-profile-field") || "";
      const reqTag = wrap.querySelector(".mz-field-tag--required");
      if (reqTag instanceof HTMLElement && signupOnlyRequired.has(key)) {
        reqTag.hidden = !profileSetupRequired;
      }
    });
  }

  function openProfileDialog() {
    if (isConsentGateBlocking()) return;
    syncProfileDialogSignupMode();
    wireProfileFormValidationClear();
    if (profileDialog) profileDialog.hidden = false;
    document.documentElement.classList.add("mz-profile-dialog-open");
    document.body.classList.add("mz-profile-dialog-open");
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.width = "100%";
    document.body.style.top = "0";
    closeAccountDropdown();
    closeMobileSiteDrawer();
    void hydrateProfileForm().catch(() => {});
    requestAnimationFrame(() => inputDisplayName?.focus());
  }

  function closeSettingsDialog() {
    if (settingsDialog) settingsDialog.hidden = true;
    document.documentElement.classList.remove("mz-settings-dialog-open");
    document.body.classList.remove("mz-settings-dialog-open");
    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.width = "";
    document.body.style.top = "";
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

  const bannedDialog = document.getElementById("mz-banned-dialog");
  const btnBannedOk = document.getElementById("btn-banned-ok");

  const intentMismatchDialog = document.getElementById("mz-intent-mismatch-dialog");
  const btnIntentMismatchSignup = document.getElementById("btn-intent-mismatch-signup");
  const btnIntentMismatchClose = document.getElementById("btn-intent-mismatch-close");

  function openBannedDialog() {
    if (!bannedDialog) return;
    window.MarchinZTrackEvent?.("account_banned_view", { surface: "login" });
    bannedDialog.hidden = false;
    requestAnimationFrame(() => btnBannedOk?.focus());
  }

  function closeBannedDialog() {
    if (bannedDialog) bannedDialog.hidden = true;
  }

  if (btnBannedOk) {
    btnBannedOk.addEventListener("click", closeBannedDialog);
  }
  if (bannedDialog) {
    bannedDialog.addEventListener("click", (e) => {
      if (e.target === bannedDialog) closeBannedDialog();
    });
  }

  function openIntentMismatchDialog() {
    if (!intentMismatchDialog) return;
    intentMismatchDialog.hidden = false;
    requestAnimationFrame(() => btnIntentMismatchClose?.focus());
  }
  function closeIntentMismatchDialog() {
    if (intentMismatchDialog) intentMismatchDialog.hidden = true;
  }
  btnIntentMismatchClose?.addEventListener("click", closeIntentMismatchDialog);
  btnIntentMismatchSignup?.addEventListener("click", closeIntentMismatchDialog);
  if (intentMismatchDialog) {
    intentMismatchDialog.addEventListener("click", (e) => {
      if (e.target === intentMismatchDialog) closeIntentMismatchDialog();
    });
  }

  function openSettingsDialog() {
    if (isConsentGateBlocking()) return;
    if (settingsDialog) settingsDialog.hidden = false;
    document.documentElement.classList.add("mz-settings-dialog-open");
    document.body.classList.add("mz-settings-dialog-open");
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.width = "100%";
    document.body.style.top = "0";
    closeAccountDropdown();
    closeMobileSiteDrawer();
    void hydrateLikeShowForm().catch(() => {});
  }

  const likeNotifToggle = document.getElementById("mz-like-notif-toggle");
  const likeNotifBody = document.getElementById("mz-like-notif-body");
  if (likeNotifToggle && likeNotifBody) {
    likeNotifToggle.addEventListener("click", () => {
      const open = likeNotifToggle.getAttribute("aria-expanded") === "true";
      likeNotifToggle.setAttribute("aria-expanded", String(!open));
      likeNotifBody.hidden = open;
    });
  }

  const settingsProfileEditLink = document.getElementById("mz-settings-link-profile-edit");
  if (settingsProfileEditLink) {
    settingsProfileEditLink.addEventListener("click", (e) => {
      e.preventDefault();
      closeSettingsDialog();
      openProfileDialog();
    });
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
      if (isConsentGateBlocking()) {
        ev.preventDefault();
        return;
      }
      if (profileCropGateActive || (cropDialog && !cropDialog.hidden)) {
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
      if (profileCropGateActive || (cropDialog && !cropDialog.hidden)) {
        if (ev.target === overlay) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        return;
      }
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
    const m = /^#([\w-]+)(\/[\w-]+)?/.exec(hashPart);
    if (!m) return "#top";
    const pageId = m[1];
    const subPath = m[2] || "";
    if (pageId === "login" || pageId === "signup") return "#top";
    if (pageId === "top" || pageId === "mll") return "#top";
    if (!RETURN_PAGE_IDS.has(pageId)) return "#top";
    return `#${pageId}${subPath}`;
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
    if (!isAdmin) {
      const raw = String(window.location.hash.replace(/^#/, "").trim());
      const base = raw.split("?")[0].split("/")[0].toLowerCase();
      if (base === "admin" || base === "moderation" || base === "ugc") {
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}#top`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
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
      if (signupConsentTried && !okConsent) {
        authSignupConsentMsg.textContent = AUTH_MESSAGE.agreeRequired;
      } else {
        authSignupConsentMsg.textContent = "";
      }
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
    window.MarchinZBTest?.closeBetaGate?.();
    currentProfileWithdrawn = false;
    currentProfileDisplayName = "";
    profileHeaderLabelPending = false;
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
    syncSignupProfileAttrCheckboxesFromList([]);
    try {
      sessionStorage.removeItem(PENDING_SIGNUP_PROFILE_ATTRS_KEY);
    } catch {
      //
    }
    try {
      sessionStorage.removeItem(AUTH_ENTRY_MODE_STORAGE_KEY);
    } catch {
      // ignore
    }
    applyAdminOnlyVisibility(false);
    syncSignupEntryConsentUi();
    if (btnAuthLoginGoogle) btnAuthLoginGoogle.disabled = !window.MLL_AUTH?.firebaseAuthAvailable;
    syncSiteBrandAuthVisibility();
    syncInAppBrowserAuthGate();
  }

  function isAdminUser() {
    const email = String(rawAuthUserForAdmin?.email || "").trim().toLowerCase();
    return Boolean(email && adminEmails.has(email));
  }

  function showLoggedInView(displayName, avatarUrl) {
    currentProfileDisplayName = String(displayName || "").trim();
    const admin = isAdminUser();
    closeAccountDropdown();
    setFirebaseHintVisible("");
    const showPublicLabel = admin || !profileHeaderLabelPending;
    const label = admin ? "管理者" : showPublicLabel ? displayName || "ユーザー" : "";
    if (headerProfileName) {
      headerProfileName.textContent = label;
      headerProfileName.hidden = !showPublicLabel;
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
      mobileDrawerName.hidden = !showPublicLabel;
    }
    applyAdminOnlyVisibility(admin);
    syncSiteBrandAuthVisibility();
    syncInAppBrowserAuthGate();
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
      getDisplayName: () => "",
      isAdmin: () => false,
      firebaseAuthAvailable: false,
      isAppCheckActive: () => false,
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

  let appCheckActive = false;
  (function initFirebaseAppCheck() {
    const acFactory = window.firebase?.appCheck;
    if (typeof acFactory !== "function") return;
    const rawSiteKey = appCheckCfg?.recaptchaSiteKey;
    if (rawSiteKey == null || String(rawSiteKey).trim() === "") {
      return;
    }
    const siteKey = String(rawSiteKey).trim();
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
      // ignore
    }
    try {
      const Provider = window.firebase?.appCheck?.ReCaptchaV3Provider;
      if (typeof Provider !== "function") {
        console.warn("[MarchinZ] App Check: ReCaptchaV3Provider が利用できません（SDK 未読込？）。");
        return;
      }
      acFactory().activate(new Provider(siteKey), true);
      appCheckActive = true;
    } catch (err) {
      console.warn("[MarchinZ] App Check 初期化に失敗しました。", err);
    }
  })();

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
  async function compressProfileImageForUpload(fileOrBlob) {
    const mi = window.MarchinZImage;
    if (!mi?.compressForUpload) {
      throw new Error("画像圧縮モジュールが読み込まれていません。ページを再読み込みしてください。");
    }
    const input =
      fileOrBlob instanceof File
        ? fileOrBlob
        : new File([fileOrBlob], "photo.jpg", { type: "image/jpeg", lastModified: Date.now() });
    const mobile = prefersCropImageDataUrl();
    return mi.compressForUpload(input, {
      useWebWorker: !mobile,
      maxWidthOrHeight: mobile ? 1600 : 1024,
    });
  }

  /** クロップ確定済み JPEG（512² / 1200×510 @0.9）は保存時の再圧縮を省略（異常に大きいときだけ圧縮） */
  const PROFILE_CROP_UPLOAD_MAX_BYTES = 900 * 1024;

  /**
   * @param {Blob} blob
   * @param {{ alreadyCropped?: boolean }} [opts]
   * @returns {Promise<Blob>}
   */
  async function blobForProfileImageUpload(blob, opts = {}) {
    if (!blob?.size) throw new Error("画像が空です");
    if (blob.size > profileRawMaxBytes()) {
      window.alert(`code: image/too-large\nmessage: ${AUTH_MESSAGE.fileTooLarge}`);
      throw new Error(window.MarchinZImage?.ERR_TOO_LARGE || "FILE_TOO_LARGE");
    }
    if (opts.alreadyCropped && blob.size <= PROFILE_CROP_UPLOAD_MAX_BYTES) {
      return blob;
    }
    return compressProfileImageForUpload(blob);
  }

  function profileSaveFriendlyError(err) {
    const code = String(err?.code || "").trim();
    const stage = String(err?.mzStage || "").trim();
    if (stage === "storage-avatar" || stage === "storage-cover" || code.startsWith("storage/")) {
      return (
        "プロフィール画像のアップロードが拒否されました。\n" +
        "Firebase Storage ルール（mll_profile_media）の反映を確認してください。"
      );
    }
    if (stage === "firestore-profile-cleanup") {
      return (
        "プロフィールの古いデータの整理が拒否されました（permission-denied）。\n" +
        "しばらくしてからもう一度お試しください。"
      );
    }
    if (stage === "firestore-private") {
      return (
        "性別・誕生日などの非公開情報の保存が拒否されました（permission-denied）。\n" +
        "しばらくしてからもう一度お試しください。"
      );
    }
    if (stage === "firestore-profile" || code === "permission-denied" || code === "storage/unauthorized") {
      return (
        "プロフィールの保存がサーバー側で拒否されました（permission-denied）。\n" +
        "この端末だけ画像が変わって見えることがありますが、他の端末には反映されていません。もう一度保存をお試しください。"
      );
    }
    return authFriendlyErrorMessage(err, AUTH_MESSAGE.saveFailed);
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
    const bdayNote = document.getElementById("profile-bday-change-note");
    if (bdayNote && currentUser?.id) {
      try {
        const sensSnap = await db.collection("mll_profiles").doc(currentUser.id).collection(PROFILE_SENSITIVE_PRIVATE_COLLECTION).doc(PROFILE_SENSITIVE_PRIVATE_DOC_ID).get();
        const sd = sensSnap.data() || {};
        const changed = Number(sd.birthdate_change_count || 0);
        bdayNote.hidden = changed < 1;
        if (changed >= 1 && !Boolean(sd.birthdate_change_allowed)) {
          if (profileBirthdate instanceof HTMLInputElement) profileBirthdate.disabled = true;
        }
      } catch { bdayNote.hidden = true; }
    }
    if (profileBio instanceof HTMLTextAreaElement) {
      profileBio.value = p.withdrawn ? "" : String(p.profile_bio || "").trim();
    }
    syncProfileFormAttrCheckboxesFromList(p.withdrawn ? [] : p.profile_attributes || []);
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
      cv.src = p.withdrawn
        ? ""
        : window.MarchinZDefaultAssets?.resolveProfileCoverDisplayUrl?.(cu) ||
          defaultProfileCoverDisplayUrl();
      cv.hidden = !p.withdrawn;
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
    if (isInAppBrowserBlockingGoogleOAuth()) {
      syncInAppBrowserAuthGate();
      setAuthEntryMessage(entry, IN_APP_BROWSER_AUTH_MESSAGE.replace(/\n\n/g, " "), true);
      window.alert(IN_APP_BROWSER_AUTH_MESSAGE);
      return;
    }
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
    getDisplayName: () => currentProfileDisplayName,
    isAdmin: () => isAdminUser(),
    firebaseAuthAvailable: true,
    isAppCheckActive: () => appCheckActive,
    isRedirectPending: () => isAuthRedirectPending(),
    isInAppBrowserBlockingGoogleOAuth,
    syncInAppBrowserAuthGate,
    signInWithGoogle,
    isWithdrawn: () => currentProfileWithdrawn,
    getLegalPolicyVersion: () => LEGAL_POLICY_VERSION,
    isLegalGateBlocking: () => legalGateBlocking,
    isBetaGateBlocking: () => Boolean(window.MarchinZBTest?.isBetaGateBlocking?.()),
    isConsentGateBlocking,
      simulateLocalLogin: (name = "ローカルテストユーザー", uid = "local-dev-user", avatar = "") => {
      if (!isLocalDevHost()) return false;
      writeLocalDevLoginUser(uid, name, avatar);
      const devUser = readLocalDevLoginUser();
      if (!devUser) return false;
      setAuthRedirectPending(false);
      setAuthLoadingOverlayVisible(false);
      onSignedIn(devUser, { forceLoginMetrics: true });
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
  syncInAppBrowserAuthGate();

  /** Firestore ルール `mllProfileKeysAllowlisted` と同期 */
  const MLL_PROFILE_ROOT_ALLOWED_KEYS = new Set([
    "id",
    "display_name",
    "avatar_url",
    "cover_image_url",
    "created_at",
    "updated_at",
    "marchinz_public_id",
    "withdrawn",
    "withdrawn_at",
    "cover_image_urls",
    "cover_slideshow_style",
    "prof_count_mll",
    "prof_count_videos",
    "prof_count_yt",
    "prof_count_logdiary",
    "section_vis_mll",
    "section_vis_videos",
    "section_vis_yt",
    "section_vis_logdiary",
    "profile_bio",
    "profile_address_prefecture",
    "profile_address_prefecture_public",
    "profile_prefecture",
    "profile_attributes",
    "like_show_mll",
    "like_show_community",
    "like_show_calendar",
    "like_show_video_bookmark",
    "like_show_channel_bookmark",
    "like_show_log_diary",
    "legal_policy_accepted_version",
    "legal_policy_accepted_at",
    "banned",
    "banned_at",
    "banned_reason",
    "last_read_announcement_at",
    "b_test_opt_in",
    "b_test_opt_in_at",
    "b_test_consent_version",
    "b_test_prompt_dismissed_at",
  ]);

  /**
   * 保存 payload に、ルート上の allowlist 外キー削除を同梱（レガシー掃除＋更新を1回で）
   * @param {string} uid
   * @param {Record<string, unknown>} payload
   */
  const PROFILE_ROOT_LEGACY_DELETE_KEYS = [
    "pref_count_mll",
    "pref_count_videos",
    "pref_count_yt",
    "pref_count_logdiary",
    "section_vis",
  ];

  /**
   * @param {string} uid
   * @param {Record<string, unknown>} payload
   * @param {{ legacyOnly?: boolean }} [opts]
   */
  async function buildProfileRootSavePatch(uid, payload, opts = {}) {
    const legacyOnly = Boolean(opts.legacyOnly);
    const fv = window.firebase?.firestore?.FieldValue;
    const ref = db.collection("mll_profiles").doc(uid);
    const patch = legacyOnly ? { updated_at: new Date().toISOString() } : { ...payload };
    if (!fv?.delete) return patch;
    let snap;
    try {
      snap = await ref.get({ source: "server" });
    } catch {
      snap = await ref.get();
    }
    if (!snap.exists) return patch;
    const data = snap.data() || {};
    for (const key of Object.keys(data)) {
      if (!MLL_PROFILE_ROOT_ALLOWED_KEYS.has(key)) patch[key] = fv.delete();
    }
    for (const key of PROFILE_ROOT_LEGACY_DELETE_KEYS) {
      if (data[key] !== undefined) patch[key] = fv.delete();
    }
    patch.profile_gender = fv.delete();
    patch.profile_birthdate = fv.delete();
    if (data.cover_image_urls !== undefined && !Array.isArray(data.cover_image_urls)) {
      patch.cover_image_urls = fv.delete();
    }
    if (!legacyOnly && data.cover_slideshow_style !== undefined) {
      patch.cover_slideshow_style = fv.delete();
    }
    for (const k of ["prof_count_mll", "prof_count_videos", "prof_count_yt", "prof_count_logdiary"]) {
      const v = data[k];
      if (v !== undefined && typeof v !== "number") patch[k] = fv.delete();
    }
    for (const k of [
      "section_vis_mll",
      "section_vis_videos",
      "section_vis_yt",
      "section_vis_logdiary",
    ]) {
      const v = data[k];
      if (v !== undefined && v !== "public" && v !== "private") patch[k] = fv.delete();
    }
    return patch;
  }

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
      cover_image_url: "",
      withdrawn: false,
      profile_address_prefecture: "",
      profile_address_prefecture_public: true,
      profile_gender: "",
      profile_birthdate: "",
      profile_bio: "",
      profile_attributes: [],
      legal_policy_accepted_version: "",
    };

    try {
      const profRef = db.collection("mll_profiles").doc(user.id);
      let snap;
      try {
        snap = await profRef.get({ source: "server" });
      } catch {
        snap = await profRef.get();
      }
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
          profile_attributes: [],
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
      const rawAttrs = Array.isArray(data.profile_attributes) ? data.profile_attributes : [];
      const profile_attributes = [];
      const attrSeen = new Set();
      for (const x of rawAttrs) {
        const s = String(x ?? "").trim();
        if (!s || attrSeen.has(s)) continue;
        attrSeen.add(s);
        profile_attributes.push(s);
        if (profile_attributes.length >= 20) break;
      }
      return {
        display_name: String(data.display_name ?? "").trim() || fallback.display_name,
        avatar_url: data.avatar_url || fallback.avatar_url,
        cover_image_url: resolveCoverImageUrlFromDocData(data),
        withdrawn: false,
        profile_address_prefecture: addrPref || legacyPref,
        profile_address_prefecture_public: data.profile_address_prefecture_public !== false,
        profile_gender,
        profile_birthdate,
        profile_bio: String(data.profile_bio ?? "").trim(),
        profile_attributes,
        legal_policy_accepted_version: String(data.legal_policy_accepted_version ?? "").trim(),
        b_test_consent_version: String(data.b_test_consent_version ?? "").trim(),
        b_test_opt_in: data.b_test_opt_in === true,
        updated_at: String(data.updated_at ?? "").trim(),
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

  async function cleanupLeftoverSubcollections(uid) {
    if (!db || !uid) return;
    const profRef = db.collection("mll_profiles").doc(uid);
    const debugDelete = async (label, q) => {
      try {
        const snap = await q.limit(5).get();
        await deleteFirestoreByQueryBatches(q);
      } catch (e) {
        console.warn(`[MarchinZ cleanup] ${label}`, e?.code || e?.message || e);
      }
    };
    await debugDelete("video_bookmarks", profRef.collection("video_bookmarks"));
    await debugDelete("channel_bookmarks", profRef.collection("channel_bookmarks"));
    await debugDelete("video_lists", profRef.collection("video_lists"));
    await debugDelete("channel_lists", profRef.collection("channel_lists"));
    await debugDelete("event_log_diaries", profRef.collection("event_log_diaries"));
    await debugDelete("moments", profRef.collection("moments"));
    await debugDelete("notifications", profRef.collection("notifications"));
    await profRef.collection(PROFILE_SENSITIVE_PRIVATE_COLLECTION).doc(PROFILE_SENSITIVE_PRIVATE_DOC_ID).delete().catch(() => {});
    await debugDelete("mll_logs", db.collection("mll_logs").where("user_id", "==", uid));
  }

  /**
   * @param {object} user
   * @param {{ recordSignupLegalConsent?: boolean }} [opts]
   */
  async function ensureProfile(user, opts = {}) {
    const recordSignupLegalConsent = Boolean(opts.recordSignupLegalConsent);
    const fv = window.firebase?.firestore?.FieldValue;
    try {
      const ref = db.collection("mll_profiles").doc(user.id);
      let snap;
      try {
        snap = await ref.get({ source: "server" });
      } catch {
        snap = await ref.get();
      }
      const existing = snap.data() || {};

      if (Boolean(existing.banned)) return;

      if (existing.withdrawn) {
        const existingIdDigits = String(existing.marchinz_public_id ?? "").replace(/\D/g, "").trim();
        let marchinz_public_id = existingIdDigits ? String(existing.marchinz_public_id).trim() : "";
        if (!existingIdDigits) {
          try {
            marchinz_public_id = await allocateMarchinzPublicIdTransaction();
          } catch (e) {
            console.warn("[MarchinZ] marchinz_public_id 再採番失敗", e);
          }
        }
        const fresh = {
          id: user.id,
          display_name: user.user_metadata?.full_name || user.user_metadata?.name || "ユーザー",
          avatar_url: user.user_metadata?.avatar_url || "",
          cover_image_url: "",
          withdrawn: false,
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          profile_attributes: [],
          profile_address_prefecture: "",
          profile_address_prefecture_public: true,
          profile_bio: "",
        };
        if (marchinz_public_id) fresh.marchinz_public_id = marchinz_public_id;
        if (recordSignupLegalConsent && fv?.serverTimestamp) {
          fresh.legal_policy_accepted_version = LEGAL_POLICY_VERSION;
          fresh.legal_policy_accepted_at = fv.serverTimestamp();
          window.MarchinZTrackEvent?.("legal_policy_accept", {
            flow: "signup",
            version: LEGAL_POLICY_VERSION,
          });
        }
        if (recordSignupLegalConsent) {
          if (window.MarchinZBTest?.consumeSignupConsent?.() === true) {
            window.MarchinZBTest?.applyConsentToPayload?.(fresh);
          }
        }
        try {
          await ref.set(fresh);
          await cleanupLeftoverSubcollections(user.id);
          if (recordSignupLegalConsent) {
            window.MarchinZAdminUgcLog?.recordSignup?.({
              uid: user.id,
              displayName: fresh.display_name,
              publicId: marchinz_public_id,
            });
          }
        } catch (reRegErr) {
          console.error("[MarchinZ] 退会アカウントの再登録に失敗しました", reRegErr);
          alert(
            "退会済みアカウントの再登録処理に失敗しました。\n" +
            "しばらく時間をおいて再度お試しいただくか、運営までお問い合わせください。",
          );
          await auth.signOut().catch(() => {});
          throw reRegErr;
        }
        return;
      }
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
        updated_at: new Date().toISOString(),
        created_at: existing.created_at || new Date().toISOString(),
      };
      const existingDisplayName = String(existing.display_name ?? "").trim();
      if (!existingDisplayName) {
        // 新規のみ Google 表示名で初期化。既存のニックネームはログインのたびに上書きしない（プロフィール編集で変更した表示名を保持）。
        payload.display_name = user.user_metadata?.full_name || user.user_metadata?.name || "ユーザー";
      }
      if (!String(existing.avatar_url || "").trim()) {
        payload.avatar_url = user.user_metadata?.avatar_url || "";
      }
      // カバー未設定時は Firestore にデフォルト URL を書かず、表示側で cover_d.png を使う
      if (marchinz_public_id) {
        payload.marchinz_public_id = marchinz_public_id;
      }
      if (recordSignupLegalConsent && fv?.serverTimestamp) {
        payload.legal_policy_accepted_version = LEGAL_POLICY_VERSION;
        payload.legal_policy_accepted_at = fv.serverTimestamp();
        window.MarchinZTrackEvent?.("legal_policy_accept", {
          flow: "signup",
          version: LEGAL_POLICY_VERSION,
        });
      }
      if (recordSignupLegalConsent) {
        if (window.MarchinZBTest?.consumeSignupConsent?.() === true) {
          window.MarchinZBTest?.applyConsentToPayload?.(payload);
        }
      }
      await ref.set(payload, { merge: true });
      if (recordSignupLegalConsent) {
        window.MarchinZAdminUgcLog?.recordSignup?.({
          uid: user.id,
          displayName: payload.display_name || existing.display_name || user.user_metadata?.full_name || "ユーザー",
          publicId: marchinz_public_id,
        });
      }
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
    profileHeaderLabelPending = false;
    showLoggedInView(p.display_name, p.avatar_url);
    return p;
  }

  let profileSyncRunId = 0;
  /** Firestore プロフィール同期完了までヘッダー表示名を出さない（Google 表示名のチラつき防止） */
  let profileHeaderLabelPending = false;

  /** mll.js のイベント入力フォーム：認証確定・プロフィール同期の直後に UI を再同期（リダイレクト復帰時の disabled 取り残し対策） */
  function scheduleMllEventFormResync() {
    queueMicrotask(() => window.MarchinZResyncMllEventFormUi?.());
  }

  /**
   * @param {object} user mapped user
   * @param {{ completedAuthRedirect?: boolean; forceLoginMetrics?: boolean }} [opts]
   */
  function onSignedIn(user, opts = {}) {
    currentUser = user;
    rawAuthUserForAdmin = auth.currentUser;

    const authEntryMode = consumeAuthEntryMode();
    const isSignupEntry = authEntryMode === "signup";
    if (isSignupEntry) {
      profileSetupRequired = true;
    }

    if (typeof window.gtag === "function") {
      window.gtag("set", { user_id: user.id });
    }

    const emitLoginMetrics = Boolean(opts.completedAuthRedirect || opts.forceLoginMetrics);
    if (emitLoginMetrics) {
      const admin = isAdminUser(currentUser) ? 1 : 0;
      const authFlow = authEntryMode === "signup" ? "signup" : "login";
      window.MarchinZTrackEvent?.("login_success", { admin });
      window.MarchinZTrackEvent?.("login_action", { method: "google", admin, auth_flow: authFlow });
      if (typeof window.gtag === "function") {
        window.gtag("event", "login", { method: "google" });
      }
    }

    // ログイン UI は即切り替え。表示名は Firestore 同期後のみ（Google 登録名の一瞬表示を出さない）。
    applyWithdrawnUi(false);
    profileHeaderLabelPending = true;
    showLoggedInView("", "");
    navigateAwayFromAuthEntryIfLoggedIn();

    const runId = ++profileSyncRunId;
    void (async () => {
      try {
        try {
          const banSnap = await db.collection("mll_profiles").doc(user.id).get();
          if (banSnap.exists) {
            const bd = banSnap.data() || {};
            if (Boolean(bd.banned)) {
              await auth.signOut();
              currentUser = null;
              rawAuthUserForAdmin = null;
              showLoggedOut();
              openBannedDialog();
              window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));
              scheduleMllEventFormResync();
              return;
            }
          }

          if (authEntryMode === "login") {
            const isUnregistered = !banSnap.exists || Boolean(banSnap.data()?.withdrawn);
            if (isUnregistered) {
              await auth.signOut();
              currentUser = null;
              rawAuthUserForAdmin = null;
              showLoggedOut();
              openIntentMismatchDialog();
              window.dispatchEvent(new CustomEvent("mll-auth-changed", { detail: { user: null, isAdmin: false } }));
              scheduleMllEventFormResync();
              return;
            }
          }
        } catch {
          // Firestore 未設定・一時障害時はログイン継続。凍結の書き込みはルールで拒否される。
        }
        await migrateSensitiveProfileOffRoot(user.id);
        await ensureProfile(user, { recordSignupLegalConsent: isSignupEntry });
        if (runId !== profileSyncRunId) return;
        await applyPendingSignupProfileAttributes(user);
        const prof = await refreshProfileView(user);
        // 新規登録は #signup のチェックで同意済み。ログインのみ規約改定時の再同意モーダルを出す。
        if (!isSignupEntry) {
          await maybePromptLegalPolicyAcceptance(user, prof);
        }
        if (runId !== profileSyncRunId) return;
        if (window.MarchinZBTest?.needsBetaConsent?.(prof)) {
          await window.MarchinZBTest?.maybeRequireExistingUserBetaConsent?.(prof);
        }
        if (runId !== profileSyncRunId) return;
        window.MarchinZBTest?.syncSettingsStatus?.(prof);
        window.dispatchEvent(
          new CustomEvent("mll-auth-changed", { detail: { user: currentUser, isAdmin: isAdminUser(currentUser) } })
        );
        scheduleMllEventFormResync();
        if (profileSetupRequired && currentUser) {
          requestAnimationFrame(() => openProfileDialog());
        }
      } catch (e) {
        console.warn("[MarchinZ] profile sync after sign-in", e);
        profileHeaderLabelPending = false;
        if (isAdminUser()) showLoggedInView("管理者", "");
      } finally {
        if (runId === profileSyncRunId) {
          setAuthLoadingOverlayVisible(false);
          setAuthLoadingOverlayText(DEFAULT_AUTH_LOADING_TEXT);
        }
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
      window.MarchinZTrackEvent?.("legal_policy_accept", {
        flow: "gate",
        version: LEGAL_POLICY_VERSION,
      });
      window.dispatchEvent(
        new CustomEvent("marchinz-legal-policy-accepted", { detail: { version: LEGAL_POLICY_VERSION } }),
      );
    } catch (e) {
      console.error("[MarchinZ] 利用規約の同意保存に失敗", e);
      const code = String(e?.code || "").trim();
      if (code === "permission-denied") {
        if (legalGateError instanceof HTMLElement) {
          legalGateError.textContent =
            "同意の保存に失敗しました。アカウントの状態を確認中です。ページを再読み込みして再度お試しください。";
          legalGateError.hidden = false;
        }
      } else {
        if (legalGateError instanceof HTMLElement) {
          legalGateError.textContent =
            "保存に失敗しました。通信環境を確認のうえ、再度お試しください。";
          legalGateError.hidden = false;
        }
      }
      if (btnLegalGateAccept instanceof HTMLButtonElement) btnLegalGateAccept.disabled = false;
    } finally {
      hideProcessingOverlay();
    }
  });

  btnLegalGateSignout?.addEventListener("click", async () => {
    if (!legalGateBlocking) return;
    await signOutAndClearUi();
  });

  document.getElementById("btn-b-test-signout")?.addEventListener("click", async () => {
    if (!window.MarchinZBTest?.isBetaGateBlocking?.()) return;
    window.MarchinZTrackEvent?.("b_test_gate_signout", { flow: "modal" });
    window.MarchinZBTest?.closeBetaGate?.();
    await signOutAndClearUi();
  });

  if (btnAuthLoginGoogle) {
    btnAuthLoginGoogle.addEventListener("click", () => {
      setAuthEntryMessage("login", "");
      void signInWithGoogle("login").catch((err) => {
        const fallback = "ログインに失敗しました。時間をおいて再度お試しください。";
        setAuthEntryMessage("login", authFriendlyErrorMessage(err, fallback), true);
        console.error("[MarchinZ] Google sign-in", err);
        if (window.MarchinZTrackEvent) window.MarchinZTrackEvent("login_error", { method: "google", intent: "login", error_code: String(err?.code || "unknown") });
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
        if (window.MarchinZTrackEvent) window.MarchinZTrackEvent("signup_consent_blocked", { reason: "checkbox_unchecked" });
        return;
      }
      try {
        sessionStorage.removeItem(PENDING_SIGNUP_PROFILE_ATTRS_KEY);
      } catch {
        //
      }
      const signupBTestEl = document.getElementById("auth-signup-b-test-agree");
      window.MarchinZBTest?.stashSignupConsent?.(
        signupBTestEl instanceof HTMLInputElement && signupBTestEl.checked,
      );
      setAuthEntryMessage("signup", "");
      syncSignupEntryConsentUi();
      void signInWithGoogle("signup").catch((err) => {
        const fallback = "新規登録に失敗しました。時間をおいて再度お試しください。";
        setAuthEntryMessage("signup", authFriendlyErrorMessage(err, fallback), true);
        console.error("[MarchinZ] Google sign-in", err);
        if (window.MarchinZTrackEvent) window.MarchinZTrackEvent("login_error", { method: "google", intent: "signup", error_code: String(err?.code || "unknown") });
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
      const open = withdrawDetail.hidden;
      withdrawDetail.hidden = !open;
      btnAccountWithdrawToggle.setAttribute("aria-expanded", String(open));
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
    const MAX_ROUNDS = 50;
    let round = 0;
    let snap = await query.limit(CHUNK).get();
    while (!snap.empty && round < MAX_ROUNDS) {
      round++;
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
    "legal_policy_accepted_version",
    "legal_policy_accepted_at",
    "banned",
    "banned_at",
    "banned_reason",
  ]);

  /**
   * @param {unknown} raw
   * @returns {string}
   */
  function normalizeMarchinzPublicIdForWithdraw(raw) {
    const digits = String(raw ?? "").replace(/\D/g, "").trim();
    return digits ? digits.slice(0, 20) : "";
  }

  /**
   * 退会時のプロフィールルート更新（allowlist 内のフィールドのみ set で全置換）。
   * Firestore ルールの mllProfileSelfWithdrawOk と整合させる。
   * @param {FirebaseFirestore.DocumentReference} profRef
   * @param {Record<string, unknown>} existing
   */
  async function applyWithdrawnProfileRoot(profRef, existing) {
    const uid = String(profRef.id || existing.id || "").trim();
    const now = new Date().toISOString();
    const createdAtRaw = existing.created_at;
    const created_at =
      typeof createdAtRaw === "string" && createdAtRaw.length >= 10 && createdAtRaw.length <= 48
        ? createdAtRaw
        : now;
    /** @type {Record<string, unknown>} */
    const doc = {
      id: uid,
      display_name: WITHDRAWN_NAME,
      avatar_url: "",
      cover_image_url: "",
      created_at,
      updated_at: now,
      withdrawn: true,
      withdrawn_at: now,
    };
    const publicId = normalizeMarchinzPublicIdForWithdraw(existing.marchinz_public_id);
    if (publicId) doc.marchinz_public_id = publicId;
    const legalVer = String(existing.legal_policy_accepted_version ?? "").trim();
    if (legalVer.length > 0 && legalVer.length <= 48) {
      doc.legal_policy_accepted_version = legalVer;
    }
    const legalAt = existing.legal_policy_accepted_at;
    if (legalAt && typeof legalAt === "object" && typeof legalAt.toDate === "function") {
      doc.legal_policy_accepted_at = legalAt;
    } else if (
      typeof legalAt === "string" &&
      legalAt.length >= 10 &&
      legalAt.length <= 48
    ) {
      doc.legal_policy_accepted_at = legalAt;
    }
    if (existing.banned === true) {
      doc.banned = true;
      const bannedAt = String(existing.banned_at ?? "").trim();
      if (bannedAt.length > 0 && bannedAt.length <= 48) doc.banned_at = bannedAt;
      const bannedReason = String(existing.banned_reason ?? "").trim();
      if (bannedReason.length > 0 && bannedReason.length <= 500) doc.banned_reason = bannedReason;
    }
    await profRef.set(doc);
  }

  /**
   * @param {Record<string, unknown>} existing
   */
  function profileNeedsWithdrawRepair(existing) {
    return (
      !Boolean(existing.withdrawn) ||
      existing.display_name !== WITHDRAWN_NAME
    );
  }

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
      const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
      /** @param {string} step @param {() => Promise<unknown>} fn */
      const runStep = async (step, fn) => {
        try {
          await fn();
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          err.message = `[${step}] ${err.message}`;
          throw err;
        }
      };
      try {
        const profRef = db.collection("mll_profiles").doc(uid);
        let profSnap;
        try {
          profSnap = await profRef.get({ source: "server" });
        } catch {
          profSnap = await profRef.get();
        }
        if (!profSnap.exists) {
          throw new Error("プロフィールが見つかりません。一度ログアウトして再ログイン後、もう一度お試しください。");
        }
        const existing = profSnap.data() || {};
        if (profileNeedsWithdrawRepair(existing)) {
          await runStep("mll_profiles", () => applyWithdrawnProfileRoot(profRef, existing));
        } else {
          await runStep("mll_profiles_cleanup", () => cleanupLeftoverSubcollections(uid));
        }
        const safeDelete = (label, q) =>
          runStep(label, () => withTimeout(deleteFirestoreByQueryBatches(q), 15000));
        await runStep("Storage", () =>
          withTimeout(deleteWithdrawalOwnedStorage(uid), 10000).catch((e) => {
            console.warn("[MarchinZ] storage cleanup error", e);
          }),
        );
        await safeDelete("video_bookmarks", profRef.collection("video_bookmarks"));
        await safeDelete("channel_bookmarks", profRef.collection("channel_bookmarks"));
        await safeDelete("video_lists", profRef.collection("video_lists"));
        await safeDelete("channel_lists", profRef.collection("channel_lists"));
        await safeDelete("event_log_diaries", profRef.collection("event_log_diaries"));
        await safeDelete("moments", profRef.collection("moments"));
        await safeDelete("notifications", profRef.collection("notifications"));
        await runStep("profile_private", () =>
          profRef
            .collection(PROFILE_SENSITIVE_PRIVATE_COLLECTION)
            .doc(PROFILE_SENSITIVE_PRIVATE_DOC_ID)
            .delete(),
        );
        await safeDelete("mll_logs", db.collection("mll_logs").where("user_id", "==", uid));
        let verifySnap;
        try { verifySnap = await profRef.get({ source: "server" }); } catch { verifySnap = await profRef.get(); }
        const verifyData = verifySnap.data() || {};
        console.log("[MarchinZ withdraw] verify after write:", { withdrawn: verifyData.withdrawn, display_name: verifyData.display_name });
        if (!verifyData.withdrawn) {
          console.error("[MarchinZ withdraw] CRITICAL: withdrawn flag NOT persisted on server!");
          throw new Error("退会フラグの保存に失敗しました。もう一度お試しください。");
        }
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
      window.MarchinZTrackEvent?.("account_withdraw_complete", {});
      openWithdrawDoneDialog();
    });
  }

  if (btnAuthLoginGoogle && window.MLL_AUTH?.firebaseAuthAvailable) btnAuthLoginGoogle.disabled = false;
  syncSignupEntryConsentUi();

  if (profileForm) {
    profileForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (profileSaveInFlight) return;
      if (profileCropGateActive) {
        window.alert("画像の切り抜きを完了するか、キャンセルしてから保存してください。");
        return;
      }
      if (!currentUser) return;
      if (isConsentGateBlocking()) return;
      if (currentProfileWithdrawn) return;

      const validation = validateProfileFormFields();
      if (!validation.ok) {
        validation.firstFocus?.focus();
        validation.firstFocus?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
        return;
      }

      const displayName = (inputDisplayName?.value || "").trim();
      const prefecture = String(profilePrefecture?.value || "").trim();
      const gender = String(profileGender?.value || "").trim();
      const birthRaw = String(profileBirthdate?.value || "").trim();
      const bio = String(profileBio?.value || "").trim();
      if (bio.length > 300) {
        const bioWarn = document.getElementById("profile-bio-warn");
        if (bioWarn) {
          bioWarn.textContent = `プロフィールは300文字以内にしてください（現在 ${bio.length} 文字）`;
          bioWarn.hidden = false;
        }
        profileBio?.focus();
        profileBio?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
        return;
      }

      beginProfileSaveBusy();
      let saveSucceeded = false;
      try {
        let mergedProfileAttrs = [];
        try {
          const existingProf = await fetchProfile(currentUser);
          mergedProfileAttrs = mergeProfileAttributesForSave(
            collectProfileFormAttributeSelections(),
            existingProf.profile_attributes,
          );
        } catch {
          mergedProfileAttrs = mergeProfileAttributesForSave(collectProfileFormAttributeSelections(), []);
        }
        try {
          const dupSnap = await db
            .collection("mll_profiles")
            .where("display_name", "==", displayName)
            .limit(10)
            .get();
          const dup = dupSnap.docs.find((d) => d.id !== currentUser.id && !Boolean((d.data() || {}).withdrawn));
          if (dup) {
            setProfileFieldError(
              document.getElementById("profile-error-display-name"),
              "表示名（ニックネーム）は既に使われています。別の名前を記入してください",
              "display_name",
            );
            inputDisplayName?.focus();
            inputDisplayName?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
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
          profile_attributes: mergedProfileAttrs,
          updated_at: new Date().toISOString(),
        };
        if (fv?.delete) {
          payload.profile_prefecture = fv.delete();
          payload.profile_gender = fv.delete();
          payload.profile_birthdate = fv.delete();
        }
        const st = window.MLL_AUTH?.getStorage?.();
        const needAvatar = Boolean(croppedAvatarBlob);
        const needCover = Boolean(croppedCoverBlob);
        if ((needAvatar || needCover) && !st) {
          alert(AUTH_MESSAGE.storageUnavailable);
          return;
        }

        await migrateSensitiveProfileOffRoot(currentUser.id);
        if (st && (needAvatar || needCover)) {
          const avatarBlob = needAvatar ? croppedAvatarBlob : null;
          const coverBlob = needCover ? croppedCoverBlob : null;
          /** @type {Promise<{ kind: "avatar" | "cover"; url: string }>[]} */
          const uploadTasks = [];
          if (avatarBlob) {
            uploadTasks.push(
              (async () => {
                try {
                  const blob = await blobForProfileImageUpload(avatarBlob, { alreadyCropped: true });
                  const url = await uploadProfileJpeg(st, currentUser.id, "avatar.jpg", blob);
                  return { kind: "avatar", url };
                } catch (e) {
                  const err = e;
                  err.mzStage = "storage-avatar";
                  throw err;
                }
              })(),
            );
          }
          if (coverBlob) {
            uploadTasks.push(
              (async () => {
                try {
                  const blob = await blobForProfileImageUpload(coverBlob, { alreadyCropped: true });
                  const url = await uploadProfileJpeg(st, currentUser.id, "cover.jpg", blob);
                  return { kind: "cover", url };
                } catch (e) {
                  const err = e;
                  err.mzStage = "storage-cover";
                  throw err;
                }
              })(),
            );
          }
          const uploaded = await Promise.all(uploadTasks);
          for (const item of uploaded) {
            if (item.kind === "avatar") payload.avatar_url = item.url;
            if (item.kind === "cover") payload.cover_image_url = item.url;
          }
          croppedAvatarBlob = null;
          croppedCoverBlob = null;
        }
        const profRoot = db.collection("mll_profiles").doc(currentUser.id);
        const sensRef = profRoot.collection(PROFILE_SENSITIVE_PRIVATE_COLLECTION).doc(PROFILE_SENSITIVE_PRIVATE_DOC_ID);
        const sensPayload = { updated_at: new Date().toISOString() };
        if (gender) sensPayload.profile_gender = gender;
        if (birthRaw) {
          try {
            const existingSens = await sensRef.get();
            const ed = existingSens.data() || {};
            const existingBirth = String(ed.profile_birthdate ?? "").trim();
            const bdayChanged = Number(ed.birthdate_change_count || 0);
            const bdayAllowed = Boolean(ed.birthdate_change_allowed);
            if (existingBirth && existingBirth !== birthRaw && bdayChanged >= 1 && !bdayAllowed) {
              setProfileFieldError(
                document.getElementById("profile-error-birthdate"),
                "誕生日の変更は1回までです。変更が必要な場合はお問い合わせください。",
                "birthdate",
              );
              profileBirthdate?.focus();
              profileBirthdate?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
              return;
            }
            if (existingBirth && existingBirth !== birthRaw) {
              sensPayload.birthdate_change_count = (bdayChanged || 0) + 1;
            }
          } catch {
            /* first time save – no existing doc */
          }
          sensPayload.profile_birthdate = birthRaw;
        }
        const legacyCleanup = await buildProfileRootSavePatch(currentUser.id, payload, { legacyOnly: true });
        const hasLegacyDeletes = Object.keys(legacyCleanup).some((k) => k !== "updated_at");
        if (hasLegacyDeletes) {
          try {
            await profRoot.set(legacyCleanup, { merge: true });
          } catch (e) {
            const err = e;
            err.mzStage = "firestore-profile-cleanup";
            throw err;
          }
        }
        const rootPatch = await buildProfileRootSavePatch(currentUser.id, payload);
        try {
          await profRoot.set(rootPatch, { merge: true });
        } catch (e) {
          const err = e;
          err.mzStage = "firestore-profile";
          throw err;
        }
        try {
          await sensRef.set(sensPayload, { merge: true });
        } catch (e) {
          const err = e;
          err.mzStage = "firestore-private";
          throw err;
        }

        croppedAvatarBlob = null;
        croppedCoverBlob = null;
        const p = await fetchProfile(currentUser);
        showLoggedInView(p.display_name, p.avatar_url);
        const wasSignupSetup = profileSetupRequired;
        profileSetupRequired = false;
        if (wasSignupSetup) {
          const attrs = sanitizeProfileAttributesList(p.profile_attributes || []);
          window.MarchinZTrackEvent?.("signup_complete", { has_attributes: attrs.length > 0 ? 1 : 0 });
        }
        closeProfileDialog();
        showEphemeralGlobalMessage(wasSignupSetup ? "プロフィールを保存しました" : "変更を保存しました");
        window.dispatchEvent(new CustomEvent("marchinz-profile-saved", { detail: { id: currentUser.id } }));
        saveSucceeded = true;
      } catch (e) {
        if (String(e?.message || "") === window.MarchinZImage?.ERR_TOO_LARGE) {
          window.alert(`code: ${(e?.code || "image/too-large").toString()}\nmessage: ${AUTH_MESSAGE.fileTooLarge}`);
        } else {
          try {
            await hydrateProfileForm();
          } catch {
            /* ignore */
          }
          window.alert(
            `code: ${(e?.code || "unknown").toString()}\nmessage: ${profileSaveFriendlyError(e)}`,
          );
        }
      } finally {
        endProfileSaveBusy();
      }
      if (!saveSucceeded) return;
    });

    const profileSaveClickBtn = getProfileSaveButton();
    if (profileSaveClickBtn instanceof HTMLButtonElement) {
      profileSaveClickBtn.addEventListener("click", (ev) => {
        if (!profileSaveInFlight) return;
        ev.preventDefault();
        ev.stopPropagation();
      });
    }
  }

  function profileRawMaxBytes() {
    return window.MarchinZImage?.RAW_INPUT_MAX_BYTES || 20 * 1024 * 1024;
  }

  const cropImage = document.getElementById("mz-crop-image");
  const btnCropConfirm = document.getElementById("btn-crop-confirm");
  const btnCropCancel = document.getElementById("btn-crop-cancel");
  const btnCropCancel2 = document.getElementById("btn-crop-cancel2");
  let activeCropper = null;
  let cropResolve = null;
  let cropMode = "avatar";
  let croppedAvatarBlob = null;
  let croppedCoverBlob = null;
  let cropImageReadyHandled = false;
  let cropImageObjectUrl = null;

  function isWebKitSafariBrowser() {
    const ua = String(navigator.userAgent || "");
    return (
      /AppleWebKit/i.test(ua) &&
      /Safari/i.test(ua) &&
      !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Edg\//i.test(ua)
    );
  }

  /** Safari（Mac 含む）は blob URL + viewMode 2 だと Cropper の枠がずれやすい */
  function prefersCropImageDataUrl() {
    const ua = String(navigator.userAgent || "");
    return (
      window.matchMedia("(max-width: 767px)").matches ||
      /iPhone|iPad|iPod|Android/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
      isWebKitSafariBrowser()
    );
  }

  /** @param {File|Blob} file */
  function readProfileImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
      reader.readAsDataURL(file);
    });
  }

  function revokeCropImageObjectUrl() {
    if (cropImageObjectUrl) {
      URL.revokeObjectURL(cropImageObjectUrl);
      cropImageObjectUrl = null;
    }
  }

  /** @param {File} file @returns {Promise<string>} */
  async function resolveCropImageElementSrc(file) {
    if (prefersCropImageDataUrl()) {
      try {
        const dataUrl = await readProfileImageAsDataUrl(file);
        if (dataUrl.startsWith("data:image/")) return dataUrl;
      } catch (e) {
        console.warn("[MarchinZ] crop readAsDataURL failed, fallback to blob", e);
      }
    }
    revokeCropImageObjectUrl();
    cropImageObjectUrl = URL.createObjectURL(file);
    return cropImageObjectUrl;
  }

  function setProfileModalInertWhileCrop(inertOn) {
    if (!profileDialog) return;
    if (inertOn) profileDialog.setAttribute("inert", "");
    else profileDialog.removeAttribute("inert");
  }

  /** @param {File} file */
  function isHeicLikeFile(file) {
    const type = String(file.type || "").toLowerCase();
    if (type === "image/heic" || type === "image/heif" || type === "image/heic-sequence") return true;
    const name = String(file.name || "").toLowerCase();
    if (/\.hei[cf]$/.test(name)) return true;
    if ((type === "" || type === "application/octet-stream") && /\.hei[cf]$/.test(name)) return true;
    return false;
  }

  async function ensureHeic2anyReady() {
    if (typeof window.heic2any === "function") return true;
    window.alert("HEIC変換モジュールの読み込みに失敗しました。ページを再読み込みしてください。");
    return false;
  }

  /**
   * HEIC/HEIF は JPEG に変換してから Cropper へ渡す。
   * @param {File} file
   * @returns {Promise<File|null>}
   */
  async function normalizeProfileImageFileForCrop(file) {
    if (!file) return null;
    if (!isHeicLikeFile(file)) return file;
    if (!(await ensureHeic2anyReady())) return null;
    try {
      const converted = await window.heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.9,
      });
      const outBlob = Array.isArray(converted) ? converted[0] : converted;
      if (!(outBlob instanceof Blob)) return null;
      const stem = String(file.name || "photo").replace(/\.[^.]+$/i, "") || "photo";
      return new File([outBlob], `${stem}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    } catch (e) {
      console.warn(e);
      window.alert(
        "HEIC形式の写真をJPEGへ変換できませんでした。カメラの「互換性優先」設定にするか、別の写真をお試しください。",
      );
      return null;
    }
  }

  /**
   * スマホ向け: 巨大画像は Cropper 前に縮小（メモリ・初期化失敗対策）
   * @param {File} file
   * @param {number} maxEdge
   */
  async function downscaleFileForCropIfNeeded(file, maxEdge = 2048) {
    if (!file || !prefersCropImageDataUrl()) return file;
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("image decode failed"));
        el.src = objectUrl;
      });
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (!w || !h || (w <= maxEdge && h <= maxEdge)) return file;
      const scale = maxEdge / Math.max(w, h);
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(img, 0, 0, cw, ch);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.9);
      });
      const stem = String(file.name || "photo").replace(/\.[^.]+$/i, "") || "photo";
      return new File([blob], `${stem}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    } catch (e) {
      console.warn("[MarchinZ] downscaleFileForCropIfNeeded", e);
      return file;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  /** @param {File|null|undefined} rawFile */
  async function pickProfileImageForCrop(rawFile) {
    if (!rawFile) return null;
    if (rawFile.size > profileRawMaxBytes()) {
      window.alert(AUTH_MESSAGE.fileTooLarge);
      return null;
    }
    const normalized = await normalizeProfileImageFileForCrop(rawFile);
    if (!normalized) return null;
    return downscaleFileForCropIfNeeded(normalized);
  }

  /** プロフィール表示スロット（シネスコ 2.35:1）と同じ横長比 */
  const COVER_CROP_ASPECT = 2.35;
  const COVER_EXPORT_WIDTH = 1200;
  const COVER_EXPORT_HEIGHT = 510;

  function destroyActiveCropper() {
    if (activeCropper) {
      activeCropper.destroy();
      activeCropper = null;
    }
  }

  let cropResizeHandler = null;
  let cropOrientationHandler = null;
  let cropVisualViewportHandler = null;

  function detachCropperResizeListeners() {
    if (cropResizeHandler) {
      window.removeEventListener("resize", cropResizeHandler);
      cropResizeHandler = null;
    }
    if (cropOrientationHandler) {
      window.removeEventListener("orientationchange", cropOrientationHandler);
      cropOrientationHandler = null;
    }
    if (cropVisualViewportHandler && window.visualViewport) {
      window.visualViewport.removeEventListener("resize", cropVisualViewportHandler);
      cropVisualViewportHandler = null;
    }
  }

  function scheduleCropperReflow() {
    if (!activeCropper) return;
    activeCropper.resize();
    if (cropMode === "cover") fitCoverCropBox();
  }

  function attachCropperResizeListeners() {
    detachCropperResizeListeners();
    cropResizeHandler = () => scheduleCropperReflow();
    cropOrientationHandler = () => window.setTimeout(scheduleCropperReflow, 180);
    window.addEventListener("resize", cropResizeHandler, { passive: true });
    window.addEventListener("orientationchange", cropOrientationHandler);
    if (window.visualViewport) {
      cropVisualViewportHandler = () => window.setTimeout(scheduleCropperReflow, 120);
      window.visualViewport.addEventListener("resize", cropVisualViewportHandler);
    }
  }

  /** モーダル表示・レイアウト確定後に Cropper を起動（Safari の寸法ずれ対策） */
  function waitForCropDialogLayout() {
    const delayMs = prefersCropImageDataUrl() ? 160 : 80;
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.setTimeout(resolve, delayMs);
        });
      });
    });
  }

  /** 表示中の画像（canvas）の内側に、2.35:1 の枠を最大フィットさせる */
  function fitCoverCropBox() {
    if (!activeCropper || cropMode !== "cover") return;
    const image = activeCropper.getImageData();
    if (!image?.width || !image?.height) return;
    let cropW = image.width;
    let cropH = cropW / COVER_CROP_ASPECT;
    if (cropH > image.height) {
      cropH = image.height;
      cropW = cropH * COVER_CROP_ASPECT;
    }
    activeCropper.setCropBoxData({
      left: image.left + (image.width - cropW) / 2,
      top: image.top + (image.height - cropH) / 2,
      width: cropW,
      height: cropH,
    });
  }

  function finalizeCoverCropLayout() {
    const place = () => {
      try {
        activeCropper?.resize();
        fitCoverCropBox();
      } catch (e) {
        console.warn("[MarchinZ] finalizeCoverCropLayout", e);
      }
    };
    place();
    requestAnimationFrame(() => {
      place();
      requestAnimationFrame(place);
    });
  }

  /** @param {"avatar"|"cover"} mode */
  async function initCropperAfterDialogReady(mode) {
    await waitForCropDialogLayout();
    if (!window.Cropper) {
      window.alert("画像編集モジュールの読み込みに失敗しました。ページを再読み込みしてください。");
      closeCropDialog(null);
      return;
    }
    destroyActiveCropper();
    if (mode === "avatar") {
      activeCropper = new window.Cropper(cropImage, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: "move",
        zoomOnTouch: false,
        autoCropArea: 0.9,
        responsive: true,
        cropBoxResizable: true,
        background: false,
        ready() {
          activeCropper?.resize();
        },
      });
      attachCropperResizeListeners();
      return;
    }
    const coverViewMode = prefersCropImageDataUrl() ? 1 : 2;
    activeCropper = new window.Cropper(cropImage, {
      aspectRatio: COVER_CROP_ASPECT,
      viewMode: coverViewMode,
      dragMode: "move",
      zoomOnTouch: false,
      autoCropArea: 1,
      responsive: true,
      restore: false,
      zoomOnWheel: !prefersCropImageDataUrl(),
      wheelZoomRatio: 0.08,
      cropBoxResizable: false,
      cropBoxMovable: false,
      toggleDragModeOnDblclick: false,
      background: false,
      ready() {
        finalizeCoverCropLayout();
      },
    });
    attachCropperResizeListeners();
  }

  function openCropDialog(file, mode) {
    if (!cropDialog || !cropImage) return Promise.resolve(null);
    if (cropDialog && !cropDialog.hidden) closeCropDialog(null);
    const session = ++profileCropPickSession;
    profileCropGateActive = true;
    cropMode = mode;
    cropImageReadyHandled = false;
    setProfileModalInertWhileCrop(true);
    const container = cropImage.closest(".mz-crop-container");
    if (container) {
      container.classList.toggle("mz-crop-avatar", mode === "avatar");
      container.classList.toggle("mz-crop-cover", mode === "cover");
    }
    destroyActiveCropper();
    cropImage.removeAttribute("style");
    cropImage.onload = null;
    cropImage.onerror = null;
    cropImage.removeAttribute("src");
    return new Promise((resolve) => {
      const abortStale = () => session !== profileCropPickSession;
      cropResolve = (result) => {
        if (abortStale()) return;
        resolve(result);
      };
      const onReady = () => {
        if (abortStale() || cropImageReadyHandled) return;
        cropImageReadyHandled = true;
        cropImage.onload = null;
        cropImage.onerror = null;
        void initCropperAfterDialogReady(mode).catch((err) => {
          console.warn("[MarchinZ] initCropperAfterDialogReady", err);
          window.alert("画像の切り抜き画面を開けませんでした。別の画像をお試しください。");
          closeCropDialog(null);
        });
      };
      window.setTimeout(() => {
        if (abortStale()) {
          revokeCropImageObjectUrl();
          profileCropGateActive = false;
          setProfileModalInertWhileCrop(false);
          return;
        }
        void (async () => {
          let activeSrc = "";
          try {
            activeSrc = await resolveCropImageElementSrc(file);
            if (abortStale()) {
              revokeCropImageObjectUrl();
              return;
            }
            cropDialog.hidden = false;
            document.documentElement.classList.add("mz-crop-dialog-open");
            void cropDialog.offsetHeight;
            cropImage.onerror = () => {
              if (abortStale() || cropImage.src !== activeSrc) return;
              window.alert("画像の読み込みに失敗しました。JPEG/PNG/WebP の写真をお試しください。");
              closeCropDialog(null);
            };
            cropImage.onload = onReady;
            cropImage.src = activeSrc;
            if (cropImage.complete && cropImage.naturalWidth > 0) onReady();
          } catch (e) {
            console.warn("[MarchinZ] resolveCropImageElementSrc", e);
            if (!abortStale()) {
              window.alert("画像の読み込みに失敗しました。別の写真をお試しください。");
              closeCropDialog(null);
            }
          }
        })();
      }, PROFILE_CROP_PICKER_GHOST_MS);
    });
  }

  function closeCropDialog(result) {
    setProfileModalInertWhileCrop(false);
    detachCropperResizeListeners();
    destroyActiveCropper();
    cropImage.onload = null;
    cropImage.onerror = null;
    revokeCropImageObjectUrl();
    if (cropImage) cropImage.removeAttribute("src");
    if (cropDialog) {
      cropDialog.hidden = true;
    }
    document.documentElement.classList.remove("mz-crop-dialog-open");
    profileCropGateActive = false;
    if (cropResolve) {
      cropResolve(result);
      cropResolve = null;
    }
  }

  const btnCropZoomIn = document.getElementById("btn-crop-zoom-in");
  const btnCropZoomOut = document.getElementById("btn-crop-zoom-out");
  btnCropZoomIn?.addEventListener("click", () => { if (activeCropper) activeCropper.zoom(0.1); });
  btnCropZoomOut?.addEventListener("click", () => { if (activeCropper) activeCropper.zoom(-0.1); });

  btnCropConfirm?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeCropper) return closeCropDialog(null);
    const dim =
      cropMode === "avatar"
        ? { width: 512, height: 512, imageSmoothingEnabled: true, imageSmoothingQuality: "high" }
        : {
            width: COVER_EXPORT_WIDTH,
            height: COVER_EXPORT_HEIGHT,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: "high",
          };
    const canvas = activeCropper.getCroppedCanvas(dim);
    if (!canvas) {
      window.alert("画像の切り抜きに失敗しました。拡大・縮小してから、もう一度「決定」を押してください。");
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        window.alert("画像の保存準備に失敗しました。別の画像をお試しください。");
        return;
      }
      closeCropDialog(blob);
    }, "image/jpeg", 0.9);
  });
  btnCropCancel?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeCropDialog(null);
  });
  btnCropCancel2?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeCropDialog(null);
  });
  /* 背面タップでは閉じない（Safari ファントム click/pointerdown 対策）。決定・キャンセルのみ。 */

  inputAvatarFile?.addEventListener("change", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    profileCropGateActive = true;
    const f = inputAvatarFile.files?.[0];
    const img = document.getElementById("profile-avatar-preview");
    if (!(img instanceof HTMLImageElement)) {
      profileCropGateActive = false;
      return;
    }
    if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    if (!f) {
      croppedAvatarBlob = null;
      profileCropGateActive = false;
      void hydrateProfileForm().catch(() => {});
      return;
    }
    const prepared = await pickProfileImageForCrop(f);
    if (!prepared) {
      inputAvatarFile.value = "";
      croppedAvatarBlob = null;
      profileCropGateActive = false;
      return;
    }
    const blob = await openCropDialog(prepared, "avatar");
    if (!blob) {
      inputAvatarFile.value = "";
      croppedAvatarBlob = null;
      return;
    }
    croppedAvatarBlob = blob;
    img.src = URL.createObjectURL(blob);
    img.hidden = false;
  });

  inputCoverFile?.addEventListener("change", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    profileCropGateActive = true;
    const f = inputCoverFile.files?.[0];
    const img = document.getElementById("profile-cover-preview");
    if (!(img instanceof HTMLImageElement)) {
      profileCropGateActive = false;
      return;
    }
    if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    if (!f) {
      croppedCoverBlob = null;
      profileCropGateActive = false;
      void hydrateProfileForm().catch(() => {});
      return;
    }
    const prepared = await pickProfileImageForCrop(f);
    if (!prepared) {
      inputCoverFile.value = "";
      croppedCoverBlob = null;
      profileCropGateActive = false;
      return;
    }
    const blob = await openCropDialog(prepared, "cover");
    if (!blob) {
      inputCoverFile.value = "";
      croppedCoverBlob = null;
      return;
    }
    croppedCoverBlob = blob;
    img.src = URL.createObjectURL(blob);
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
    const completedAuthRedirect = isAuthRedirectPending();
    setAuthRedirectPending(false);
    if (!completedAuthRedirect) setAuthLoadingOverlayVisible(false);
    onSignedIn(user, { completedAuthRedirect });
  });

  try {
    const remembered = localStorage.getItem(AUTH_REMEMBER_STORAGE_KEY);
    if (authLoginRememberSession) authLoginRememberSession.checked = remembered !== "0";
  } catch {
    if (authLoginRememberSession) authLoginRememberSession.checked = true;
  }
  setAuthLoadingOverlayVisible(isAuthRedirectPending());

  // リダイレクト戻り: pending は必ず解除。未ログインならローディングを閉じる（キャンセル等は alert なし）。
  auth
    .getRedirectResult()
    .then((cred) => {
      const u = cred && cred.user;
      if (!u) {
        setAuthLoadingOverlayVisible(false);
        setAuthLoadingOverlayText(DEFAULT_AUTH_LOADING_TEXT);
      }
    })
    .catch((err) => {
      lastRedirectAuthErrorCode = String(err?.code || "").trim();
      // キャンセル系は AUTH_REDIRECT_RESULT_QUIET_CODES。いずれも alert せずコンソールのみ。
      console.warn("[MarchinZ] getRedirectResult (suppressed)", lastRedirectAuthErrorCode || err);
      setAuthLoadingOverlayVisible(false);
      setAuthLoadingOverlayText(DEFAULT_AUTH_LOADING_TEXT);
    })
    .finally(() => {
      setAuthRedirectPending(false);
      syncSiteBrandAuthVisibility();
    });
})();
