/**
 * βテスト規約への同意（必須ゲート・新規登録時の任意記録）
 */
(() => {
  const B_TEST_CONSENT_VERSION = "2026-05-20-v3";
  const SIGNUP_CONSENT_KEY = "marchinz_signup_b_test_consent";

  const dialog = document.getElementById("mz-b-test-dialog");
  const gateAgreeCheckbox = document.getElementById("mz-b-test-gate-agree-checkbox");
  const gateError = document.getElementById("mz-b-test-gate-error");
  const acceptBtn = document.getElementById("btn-b-test-accept");
  const settingsStatus = document.getElementById("mz-settings-b-test-status");

  let betaGateBlocking = false;
  let gatePromiseResolve = null;
  /** @type {Promise<void> | null} */
  let betaGateInFlight = null;

  function db() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function uid() {
    return window.MLL_AUTH?.getUser?.()?.id || "";
  }

  function isBetaGateBlocking() {
    return betaGateBlocking;
  }

  /**
   * @param {{ b_test_consent_version?: string; withdrawn?: boolean }} prof
   */
  function needsBetaConsent(prof) {
    if (!prof || prof.withdrawn) return false;
    if (String(prof.b_test_consent_version || "").trim() === B_TEST_CONSENT_VERSION) return false;
    try {
      if (sessionStorage.getItem("marchinz_b_test_consent_ok") === B_TEST_CONSENT_VERSION) return false;
    } catch {
      //
    }
    return true;
  }

  function syncGateAcceptButton() {
    const checked = gateAgreeCheckbox instanceof HTMLInputElement && gateAgreeCheckbox.checked;
    if (acceptBtn instanceof HTMLButtonElement) acceptBtn.disabled = !checked;
  }

  function closeBetaGate() {
    betaGateBlocking = false;
    if (dialog) dialog.hidden = true;
    document.body.classList.remove("mz-b-test-dialog-open");
    if (gateAgreeCheckbox instanceof HTMLInputElement) gateAgreeCheckbox.checked = false;
    if (gateError instanceof HTMLElement) {
      gateError.textContent = "";
      gateError.hidden = true;
    }
    syncGateAcceptButton();
    const resolve = gatePromiseResolve;
    gatePromiseResolve = null;
    betaGateInFlight = null;
    if (typeof resolve === "function") resolve();
  }

  function openBetaGate() {
    if (!dialog) return;
    if (betaGateBlocking) return;
    betaGateBlocking = true;
    dialog.hidden = false;
    document.body.classList.add("mz-b-test-dialog-open");
    if (gateAgreeCheckbox instanceof HTMLInputElement) gateAgreeCheckbox.checked = false;
    syncGateAcceptButton();
  }

  /** @param {boolean} agreed */
  function stashSignupConsent(agreed) {
    try {
      sessionStorage.setItem(SIGNUP_CONSENT_KEY, agreed ? "1" : "0");
    } catch {
      //
    }
  }

  /** @returns {boolean | null} */
  function consumeSignupConsent() {
    try {
      const raw = sessionStorage.getItem(SIGNUP_CONSENT_KEY);
      sessionStorage.removeItem(SIGNUP_CONSENT_KEY);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      //
    }
    return null;
  }

  /**
   * @param {Record<string, unknown>} payload
   */
  function applyConsentToPayload(payload) {
    const now = new Date().toISOString();
    payload.b_test_opt_in = true;
    payload.b_test_opt_in_at = now;
    payload.b_test_consent_version = B_TEST_CONSENT_VERSION;
    payload.b_test_prompt_dismissed_at = "";
    window.MarchinZTrackEvent?.("b_test_consent_accept", {
      flow: "signup",
      version: B_TEST_CONSENT_VERSION,
    });
  }

  async function persistBetaConsent() {
    const database = db();
    const id = uid();
    if (!database || !id) return;
    const now = new Date().toISOString();
    const profRef = database.collection("mll_profiles").doc(id);
    await profRef.set(
      {
        b_test_opt_in: true,
        b_test_opt_in_at: now,
        b_test_consent_version: B_TEST_CONSENT_VERSION,
        b_test_prompt_dismissed_at: "",
        updated_at: now,
      },
      { merge: true },
    );
    let verify = "";
    try {
      const snap = await profRef.get({ source: "server" });
      verify = String(snap.data()?.b_test_consent_version || "").trim();
    } catch {
      const snap = await profRef.get();
      verify = String(snap.data()?.b_test_consent_version || "").trim();
    }
    if (verify !== B_TEST_CONSENT_VERSION) {
      throw new Error("b_test_consent_version の保存を確認できませんでした。");
    }
    try {
      sessionStorage.setItem("marchinz_b_test_consent_ok", B_TEST_CONSENT_VERSION);
    } catch {
      //
    }
    syncSettingsStatus({ b_test_consent_version: B_TEST_CONSENT_VERSION });
    window.dispatchEvent(new CustomEvent("marchinz-b-test-consented", { detail: { version: B_TEST_CONSENT_VERSION } }));
  }

  /**
   * @param {{ b_test_consent_version?: string }} prof
   */
  function syncSettingsStatus(prof) {
    if (!settingsStatus) return;
    if (!uid() || betaGateBlocking || window.MLL_AUTH?.isLegalGateBlocking?.()) {
      settingsStatus.textContent = "";
      return;
    }
    const ok = String(prof?.b_test_consent_version || "").trim() === B_TEST_CONSENT_VERSION;
    settingsStatus.textContent = ok ? "βテスト規約：同意済み" : "βテスト規約：未同意（次回ログイン時に同意をお願いします）";
  }

  /**
   * @param {{ b_test_consent_version?: string; withdrawn?: boolean }} prof
   */
  async function maybeRequireExistingUserBetaConsent(prof) {
    if (!dialog || !prof || prof.withdrawn || !needsBetaConsent(prof)) return;
    if (window.MLL_AUTH?.isLegalGateBlocking?.()) return;
    if (betaGateInFlight) {
      await betaGateInFlight;
      return;
    }
    betaGateInFlight = new Promise((resolve) => {
      gatePromiseResolve = resolve;
      openBetaGate();
    });
    try {
      await betaGateInFlight;
    } catch (e) {
      betaGateInFlight = null;
      throw e;
    }
  }

  function showGateError(text) {
    if (!(gateError instanceof HTMLElement)) return;
    gateError.textContent = text;
    gateError.hidden = false;
  }

  gateAgreeCheckbox?.addEventListener("change", () => syncGateAcceptButton());

  acceptBtn?.addEventListener("click", async () => {
    if (!betaGateBlocking) return;
    if (!(gateAgreeCheckbox instanceof HTMLInputElement) || !gateAgreeCheckbox.checked) {
      showGateError("チェックを入れてからお進みください。");
      return;
    }
    if (gateError instanceof HTMLElement) gateError.hidden = true;
    if (acceptBtn instanceof HTMLButtonElement) acceptBtn.disabled = true;
    try {
      await persistBetaConsent();
      window.MarchinZTrackEvent?.("b_test_consent_accept", {
        flow: "modal",
        version: B_TEST_CONSENT_VERSION,
      });
      closeBetaGate();
    } catch (e) {
      console.warn("[MarchinZ B-test] consent save failed", e);
      showGateError("保存に失敗しました。通信環境を確認のうえ、再度お試しください。");
      syncGateAcceptButton();
    }
  });

  window.addEventListener("mll-auth-changed", (ev) => {
    const user = ev.detail?.user;
    if (!user?.id) {
      closeBetaGate();
      syncSettingsStatus({});
      return;
    }
    db()
      ?.collection("mll_profiles")
      .doc(user.id)
      .get()
      .then((snap) => syncSettingsStatus(snap.data() || {}))
      .catch(() => {});
  });

  const signupCheckbox = document.getElementById("auth-signup-b-test-agree");
  signupCheckbox?.addEventListener("change", () => {
    if (signupCheckbox instanceof HTMLInputElement) {
      stashSignupConsent(signupCheckbox.checked);
    }
  });

  window.MarchinZBTest = {
    getConsentVersion: () => B_TEST_CONSENT_VERSION,
    stashSignupConsent,
    consumeSignupConsent,
    applyConsentToPayload,
    needsBetaConsent,
    maybeRequireExistingUserBetaConsent,
    syncSettingsStatus,
    isBetaGateBlocking,
    closeBetaGate,
    hasBetaConsent: (prof) => String(prof?.b_test_consent_version || "").trim() === B_TEST_CONSENT_VERSION,
  };
})();
