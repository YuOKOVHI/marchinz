(() => {
  window.MarchinZEventsRegisterExpanded = false;

  /** 一覧に含める kind（Firestore・フォームと一致） */
  const VALID_KINDS = new Set(["演奏会", "大会", "イベント", "一般", "高校", "中学生以下", "カラーガード", "海外"]);
  /** フォームで選べる種別（Firestore の kind にそのまま保存） */
  const CALENDAR_KIND_CREATE_OPTIONS = ["演奏会", "大会", "イベント"];
  function attendanceStyleOptions() {
    const R = mllRoleApi();
    if (R?.ATTENDANCE_STYLE_OPTIONS_JA?.length) return R.ATTENDANCE_STYLE_OPTIONS_JA;
    return ["観戦", "出演", "チームスタッフ", "スタッフ・運営"];
  }

  /** イベントカード上の Log 表記（短縮） */
  const CALENDAR_LOG_BTN_LABEL = "Log";

  function mllRoleApi() {
    return window.MarchinZMllRole || null;
  }

  function isParticipationFormat(v) {
    const R = mllRoleApi();
    if (R?.isParticipationFormat) return R.isParticipationFormat(v);
    return ["観戦", "出演", "チームスタッフ", "運営", "未定"].includes(String(v || "").trim());
  }

  /** 未選択時は Firestore ルール上「未定」 */
  function resolveParticipationForFirestore(selected) {
    const v = String(selected || "").trim();
    if (v && isParticipationFormat(v)) return v;
    return "未定";
  }

  /** Firestore attendees.style の allowlist（参加者ダイアログ・一覧用） */
  const ATTENDANCE_STYLE_FIRESTORE = ["観戦", "出演", "チームスタッフ", "スタッフ/運営"];
  /** 参加者ダイアログの MarchinZ Note タブ（アイコンのみ） */
  const PARTICIPANT_TAB_NOTE = "__note__";

  function isAttendanceStyleFirestore(st) {
    return ATTENDANCE_STYLE_FIRESTORE.includes(String(st || "").trim());
  }

  /** @param {HTMLSelectElement|null} sel @param {string} [currentValue] */
  function fillMllParticipationSelect(sel, currentValue = "") {
    if (!sel) return;
    const R = mllRoleApi();
    const items = R?.MLL_PARTICIPATION_4 ? [...R.MLL_PARTICIPATION_4] : [];
    const cur = String(currentValue || "").trim();
    if (cur === "未定" && !items.some((x) => x.value === "未定")) {
      items.push({ value: "未定", label: "未定" });
    }
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "選択しない（任意）";
    sel.appendChild(ph);
    for (const item of items) {
      const o = document.createElement("option");
      o.value = item.value;
      o.textContent = item.label;
      sel.appendChild(o);
    }
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
    sel.dataset.mzMllPartFilled = "1";
  }
  /** 並び順: 関東→関西→その後は北から */
  const JP_PREF_GROUPS = [
    {
      label: "地域：関東",
      prefs: ["東京都", "神奈川県", "埼玉県", "千葉県", "茨城県", "栃木県", "群馬県"],
    },
    {
      label: "地域：関西",
      prefs: ["大阪府", "兵庫県", "京都府", "和歌山県", "滋賀県", "奈良県"],
    },
    {
      label: "地域：北海道",
      prefs: ["北海道"],
    },
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
    {
      label: "地域：沖縄",
      prefs: ["沖縄県"],
    },
    {
      label: "地域：その他",
      prefs: ["海外"],
    },
  ];
  const JP_PREFS = JP_PREF_GROUPS.flatMap((g) => g.prefs);

  const UNKNOWN = "ユーザー";
  const WITHDRAWN_NAME = "退会ユーザー";

  const openRegisterBtn = document.getElementById("calendar-ev-open-register");
  const openRegisterFooterBtn = document.getElementById("calendar-ev-open-register-footer");
  const registerFooterEl = document.getElementById("calendar-ev-register-footer");
  const venueFilterBtn = document.getElementById("calendar-ev-venue-filter-btn");
  const venueFilterMenu = document.getElementById("calendar-ev-venue-filter-menu");
  const yearFilterBtn = document.getElementById("calendar-ev-year-filter-btn");
  const yearFilterMenu = document.getElementById("calendar-ev-year-filter-menu");
  const mllFormCloseBtn = document.getElementById("mll-events-form-close");
  const form = document.getElementById("calendar-event-form");
  const formBody = document.getElementById("calendar-ev-form-body");
  const inputDate = document.getElementById("calendar-ev-date");
  const selectVenue = document.getElementById("calendar-ev-venue");
  const inputTitle = document.getElementById("calendar-ev-title");
  const inputUrl = document.getElementById("calendar-ev-url");
  const selectParticipation = document.getElementById("calendar-ev-participation");
  const selectKind = document.getElementById("calendar-ev-kind");
  const inputDateEnd = document.getElementById("calendar-ev-date-end");
  const inputVenueName = document.getElementById("calendar-ev-venue-name");
  const inputTime = document.getElementById("calendar-ev-time");
  const dateCandidatesBox = document.getElementById("calendar-ev-date-candidates");
  const formMsg = document.getElementById("calendar-ev-form-msg");
  const registerSuccessEl = document.getElementById("calendar-ev-register-success");
  const listEl = document.getElementById("calendar-event-list");
  const submitBtn = document.getElementById("calendar-ev-submit");

  const mllReveal = document.getElementById("mll-events-register-reveal");
  const mllAuthGate = document.getElementById("mll-events-auth-gate");
  const mllWithdrawnGate = document.getElementById("mll-events-withdrawn-gate");
  const mllLoggedBlock = document.getElementById("mll-events-mll-logged-block");

  const participantsOverlay = document.getElementById("calendar-participants-overlay");
  const participantsTabsEl = document.getElementById("calendar-participants-tabs");
  const participantsBodyEl = document.getElementById("calendar-participants-body");
  const attOverlay = document.getElementById("calendar-attendance-overlay");
  const attOptions = document.getElementById("calendar-att-options");
  const attClearBtn = document.getElementById("calendar-att-clear");

  const editOverlay = document.getElementById("calendar-edit-overlay");
  const editDate = document.getElementById("calendar-edit-date");
  const editVenue = document.getElementById("calendar-edit-venue");
  const editTitle = document.getElementById("calendar-edit-title");
  const editUrl = document.getElementById("calendar-edit-url");
  const editDateEnd = document.getElementById("calendar-edit-date-end");
  const editVenueName = document.getElementById("calendar-edit-venue-name");
  const editTime = document.getElementById("calendar-edit-time");
  const editParticipation = document.getElementById("calendar-edit-participation");
  const editHint = document.getElementById("calendar-edit-hint");
  const editSaveBtn = document.getElementById("calendar-edit-save");
  const editCancelBtn = document.getElementById("calendar-edit-cancel");
  const editDeleteBtn = document.getElementById("calendar-edit-delete");
  const registerOverlay = document.getElementById("calendar-ev-compose-overlay");
  let registerModalEscapeAttached = false;
  /** @type {{ parent: HTMLElement; formNext: ChildNode|null; msgNext: ChildNode|null }|null} */
  let registerFormAnchor = null;

  if (!form || !inputDate || !inputTitle || !listEl) return;

  function getRegisterFormMount() {
    return mllReveal || registerOverlay?.querySelector(".mll-events-register-reveal");
  }

  function mountCalendarRegisterFormInModal() {
    const mount = getRegisterFormMount();
    if (!mount || !form) return;
    if (!registerFormAnchor && form.parentElement) {
      registerFormAnchor = {
        parent: form.parentElement,
        formNext: form.nextSibling,
        msgNext: formMsg?.nextSibling ?? null,
      };
    }
    if (form.parentElement !== mount) {
      const before = mllLoggedBlock?.parentElement === mount ? mllLoggedBlock : null;
      if (before) mount.insertBefore(form, before);
      else mount.appendChild(form);
    }
    if (formMsg && formMsg.parentElement !== mount) {
      mount.insertBefore(formMsg, form.nextSibling);
    }
  }

  function restoreCalendarRegisterFormHome() {
    if (!registerFormAnchor?.parent || !form) return;
    if (form.parentElement !== registerFormAnchor.parent) {
      registerFormAnchor.parent.insertBefore(form, registerFormAnchor.formNext);
    }
    if (formMsg && formMsg.parentElement !== registerFormAnchor.parent) {
      registerFormAnchor.parent.insertBefore(formMsg, registerFormAnchor.msgNext);
    }
  }

  fillMllParticipationSelect(selectParticipation);
  fillMllParticipationSelect(editParticipation);

  function fillPrefectureSelect(sel) {
    if (!sel || sel.dataset.mzPrefFilled === "1") return;
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "都道府県を選択";
    sel.appendChild(ph);
    for (const group of JP_PREF_GROUPS) {
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
  fillPrefectureSelect(selectVenue);
  fillPrefectureSelect(editVenue);

  /** true のとき開催日が今日以降のイベントのみ（旧「これから」相当） */
  let upcomingOnly = false;
  /** 一覧の種別フィルタ: all または CALENDAR_KIND_CREATE_OPTIONS のいずれか */
  let kindTab = "all";
  /** @type {"list"|"card"|"calendar"} */
  let viewMode = (() => {
    try { const v = localStorage.getItem("mz_cal_view"); if (v === "list" || v === "card" || v === "calendar") return v; } catch {}
    return "card";
  })();
  /** カレンダービューの表示月 */
  let calViewYear = new Date().getFullYear();
  let calViewMonth = new Date().getMonth();
  /** @type {"year"} */
  let sortKey = "year";
  /** true=新しい年・新しい日付から / false=古い年・古い日付から */
  let sortDesc = true;
  /** 開催地（都道府県）絞り込み。空文字はすべて */
  let venueFilterPref = "";
  let venueFilterMenuOpen = false;
  /** 開催年絞り込み。空文字はすべて */
  let yearFilterYear = "";
  let yearFilterMenuOpen = false;
  let eventsCache = [];
  const attendeesByEvent = new Map();
  const profileCache = new Map();
  /** `開催日|タイトル|開催地` → MarchinZ Log を公開で紐づく user_id */
  let mllPublicUidsByMatchKey = new Map();
  /** @type {Map<string, Set<string>>} */
  let mllPublicUidsByEventId = new Map();
  /** ログイン中ユーザーが MarchinZ Log を残した calendar_event_id */
  let myLogEventIds = new Set();
  /** ログイン中ユーザーの event_log_diaries ドキュメント id（= eventId） */
  let myDiaryEventIds = new Set();

  let pendingAttEventId = "";
  let pendingEditEventId = "";
  /** 編集ダイアログの読み込み世代（連続編集時の非同期競合を防ぐ） */
  let editDialogLoadGen = 0;
  let mergeSourceEventId = "";
  /** イベント登録フォームの開閉（ログイン済みのみ開く） */
  let registerFormExpanded = false;
  const SS_DRAFT_CALENDAR_EVENT = "mz_draft_calendar_event_v1";
  let calendarDraftSaveTimer = null;

  function scrollCalendarEventTabStripsToStart() {
    const panel = document.getElementById("community-hub-panel-events");
    if (!(panel instanceof HTMLElement)) return;
    panel.querySelectorAll(".mz-tab-strip-yamap").forEach((el) => {
      if (el instanceof HTMLElement) el.scrollLeft = 0;
    });
  }

  function collectCalendarEventDraft() {
    return {
      date: String(inputDate?.value || "").trim(),
      venue: String(selectVenue?.value || "").trim(),
      title: String(inputTitle?.value || "").trim(),
      url: String(inputUrl?.value || "").trim(),
      participation: String(selectParticipation?.value || "").trim(),
      kind: String(selectKind?.value || "").trim(),
      uiOpen: Boolean(registerFormExpanded),
    };
  }

  function hasCalendarEventDraftContent(draft) {
    if (!draft || typeof draft !== "object") return false;
    return Boolean(
      String(draft.date || "").trim() ||
        String(draft.venue || "").trim() ||
        String(draft.title || "").trim() ||
        String(draft.url || "").trim() ||
        String(draft.participation || "").trim() ||
        String(draft.kind || "").trim(),
    );
  }

  function readCalendarEventDraft() {
    try {
      const raw = sessionStorage.getItem(SS_DRAFT_CALENDAR_EVENT);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function clearCalendarEventDraft() {
    try {
      sessionStorage.removeItem(SS_DRAFT_CALENDAR_EVENT);
    } catch {
      //
    }
  }

  function persistCalendarEventDraft(uiOpen) {
    const draft = collectCalendarEventDraft();
    const open = uiOpen != null ? Boolean(uiOpen) : Boolean(draft.uiOpen);
    if (!hasCalendarEventDraftContent(draft)) {
      clearCalendarEventDraft();
      return;
    }
    try {
      sessionStorage.setItem(
        SS_DRAFT_CALENDAR_EVENT,
        JSON.stringify({
          date: draft.date,
          venue: draft.venue,
          title: draft.title,
          url: draft.url,
          participation: draft.participation,
          kind: draft.kind,
          uiOpen: open,
        }),
      );
    } catch {
      //
    }
  }

  function scheduleCalendarEventDraftSave() {
    clearTimeout(calendarDraftSaveTimer);
    calendarDraftSaveTimer = window.setTimeout(() => {
      calendarDraftSaveTimer = null;
      persistCalendarEventDraft(null);
    }, 350);
  }

  function applyCalendarEventDraftFields(draft) {
    if (!draft) return;
    if (inputDate) inputDate.value = String(draft.date || "");
    if (selectVenue) selectVenue.value = String(draft.venue || "");
    if (inputTitle) inputTitle.value = String(draft.title || "");
    if (inputUrl) inputUrl.value = String(draft.url || "");
    if (selectParticipation && draft.participation) {
      selectParticipation.value = String(draft.participation);
    }
    if (selectKind && draft.kind) selectKind.value = String(draft.kind);
  }

  function resetCalendarEventFormFields() {
    if (inputDate) inputDate.value = "";
    if (selectVenue) selectVenue.value = "";
    if (inputTitle) inputTitle.value = "";
    if (inputUrl) inputUrl.value = "";
    if (selectParticipation) selectParticipation.selectedIndex = 0;
    if (selectKind) selectKind.selectedIndex = 0;
    setFormMsg("");
  }

  function hideRegisterFormOnly() {
    if (!registerFormExpanded) return;
    registerFormExpanded = false;
    syncRegisterFormVisibility();
  }

  function onCalendarEventLeaveEvents() {
    const draft = collectCalendarEventDraft();
    if (!hasCalendarEventDraftContent(draft)) {
      clearCalendarEventDraft();
      hideRegisterFormOnly();
      resetCalendarEventFormFields();
      kindTab = "all";
      syncKindTabs();
      syncSortBar();
      renderCurrentView();
      scrollCalendarEventTabStripsToStart();
      return;
    }
    persistCalendarEventDraft(true);
    hideRegisterFormOnly();
  }

  function onCalendarEventEnterEvents() {
    const draft = readCalendarEventDraft();
    if (draft && hasCalendarEventDraftContent(draft)) {
      applyCalendarEventDraftFields(draft);
      if (
        draft.uiOpen &&
        getUser()?.id &&
        !window.MLL_AUTH?.isWithdrawn?.() &&
        !registerFormExpanded
      ) {
        registerFormExpanded = true;
        syncRegisterFormVisibility();
      }
    }
    focusCalendarEventFromHash();
  }

  /** `#community/events?event=…` の個別イベントを、絞り込みを外して表示する。 */
  function focusCalendarEventFromHash() {
    const raw = String(window.location.hash || "").replace(/^#/, "").trim();
    const qi = raw.indexOf("?");
    if (qi === -1 || raw.slice(0, qi).trim().toLowerCase() !== "community/events") return;
    const eventId = String(new URLSearchParams(raw.slice(qi + 1)).get("event") || "").trim();
    if (!eventId) return;

    // 共有リンクは受け手が設定していた絞り込みにも負けず、対象イベントを見せる。
    kindTab = "all";
    upcomingOnly = false;
    venueFilterPref = "";
    yearFilterYear = "";
    eventSearchQuery = "";
    if (calEvSearchInput) calEvSearchInput.value = "";
    setViewMode("list");
    syncViewButtons();
    syncSortBar();
    renderCurrentView();
    // 初回ロードのFirestore取得を待てるよう、通常の登録後より長く保持する。
    focusCalendarEventOrList(eventId, 15000);
  }

  function getUser() {
    return window.MLL_AUTH?.getUser?.() || null;
  }

  function getDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function isSiteAdmin() {
    return Boolean(window.MLL_AUTH?.isAdmin?.());
  }

  function isAuthRedirectPending() {
    return Boolean(window.MLL_AUTH?.isRedirectPending?.());
  }

  function canManageEvent(ev) {
    const me = getUser();
    if (!me?.id || !ev) return false;
    if (ev.created_by && ev.created_by === me.id) return true;
    return isSiteAdmin();
  }

  function displayNameFromUser(user) {
    const nick = String(window.MLL_AUTH?.getDisplayName?.() || "").trim();
    if (nick) return nick;
    return user?.user_metadata?.full_name || user?.user_metadata?.name || UNKNOWN;
  }

  function normalizeLikedBy(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw)) {
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(k) && v === true) out[k] = true;
    }
    return out;
  }

  /**
   * @param {HTMLElement|null} hostEl
   * @param {{ id: string; liked_by?: Record<string, boolean> }|null|undefined} ev
   */
  function appendCalendarEventLikeRow(hostEl, ev) {
    if (!hostEl || !ev?.id) return;
    hostEl.dataset.calLikeEventId = String(ev.id);
    const me = getUser();
    const lb = normalizeLikedBy(ev.liked_by);
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    window.MarchinZEngageUi?.buildLikeRow(hostEl, {
      liked,
      count: cnt,
      onClick: () => toggleCalendarEventLike(ev.id),
      showLoginHint: !me?.id,
    });
  }

  function syncCalendarEventLikeButtons(eventId, likedBy) {
    const me = getUser();
    const count = Object.keys(likedBy || {}).filter((uid) => likedBy[uid]).length;
    const liked = Boolean(me?.id && likedBy?.[me.id]);
    const Eu = window.MarchinZEngageUi;
    document.querySelectorAll("[data-cal-like-event-id]").forEach((host) => {
      if (host.dataset.calLikeEventId !== String(eventId)) return;
      const btn = host.querySelector(".community-like-btn");
      if (!btn) return;
      Eu?.syncLikeButtonUi?.(btn, liked, { animate: false });
      Eu?.setLikeButtonCount?.(btn, count);
    });
  }

  async function toggleCalendarEventLike(eventId) {
    const user = getUser();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return false;
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("like")) return false;
    const db = getDb();
    if (!db) return false;
    /** @type {{ owner: string; title: string } | null} */
    let likeNotify = null;
    /** @type {Record<string, boolean>|null} */
    let nextLb = null;
    try {
      const ref = db.collection("mll_calendar_events").doc(String(eventId));
      await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) return;
        const data = snap.data() || {};
        const prev = normalizeLikedBy(data.liked_by);
        const patched = { ...prev };
        const wasOn = Boolean(patched[user.id]);
        if (wasOn) delete patched[user.id];
        else patched[user.id] = true;
        nextLb = patched;
        txn.update(ref, { liked_by: patched });
        if (!wasOn) {
          const owner = String(data.created_by || "").trim();
          const title = String(data.title || "").trim().slice(0, 200);
          if (owner && owner !== user.id) likeNotify = { owner, title };
        }
      });
    } catch (e) {
      console.warn(e);
      setFormMsg(String(e?.message || "いいねの更新に失敗しました。"), true);
      return false;
    }
    if (likeNotify) {
      const nm = window.MarchinZActorDisplayName?.(user) || displayNameFromUser(user) || UNKNOWN;
      window.MarchinZPushLikeNotification?.(db, likeNotify.owner, {
        kind: "like_calendar_event",
        actor_uid: user.id,
        actor_name: String(nm).trim().slice(0, 120) || UNKNOWN,
        target_type: "calendar_event",
        target_id: String(eventId),
        target_title: likeNotify.title || "イベント",
        target_href: "#community/events",
        thread_root_id: String(eventId).slice(0, 128),
      });
    }
    if (nextLb) {
      eventsCache = eventsCache.map((ev) =>
        String(ev.id) === String(eventId) ? { ...ev, liked_by: nextLb } : ev,
      );
      // カード全再描画は、押したボタンのフォーカスを失わせる。
      // 一覧とオーバーレイに同じイベントがあれば、そのいいねだけを同期する。
      syncCalendarEventLikeButtons(eventId, nextLb);
    }
    return true;
  }

  function todayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  /** @type {ReturnType<typeof setTimeout>|null} */
  let registerSuccessTimer = null;
  /** @type {Promise<void>|null} */
  let loadEventsInflight = null;

  /* 編集ダイアログのメッセージ。★登録フォームの #calendar-ev-form-msg とは別物
     (2026-08-04 レビュー)。編集中は登録フォームが隠れているため、
     そちらへ書くと「保存を押しても何も起きない」ように見える。
     編集の検証エラーと保存失敗は必ずこちらへ出す */
  const editMsgEl = document.getElementById("calendar-edit-msg");
  function setEditMsg(text, isErr) {
    if (!editMsgEl) { setFormMsg(text, isErr); return; }   // HTMLが古くても黙らせない
    editMsgEl.textContent = text || "";
    editMsgEl.hidden = !text;
    editMsgEl.style.color = isErr ? "#b71c1c" : "";
  }

  function setFormMsg(text, isErr) {
    if (!formMsg) return;
    formMsg.textContent = text || "";
    formMsg.style.color = isErr ? "#b71c1c" : "";
  }

  function hideRegisterSuccessToast() {
    if (registerSuccessTimer) {
      clearTimeout(registerSuccessTimer);
      registerSuccessTimer = null;
    }
    if (!registerSuccessEl) return;
    registerSuccessEl.hidden = true;
    registerSuccessEl.textContent = "";
  }

  /** @param {string} text */
  function showRegisterSuccessToast(text) {
    if (!registerSuccessEl) {
      setFormMsg(text, false);
      return;
    }
    hideRegisterSuccessToast();
    registerSuccessEl.textContent = text;
    registerSuccessEl.hidden = false;
    registerSuccessEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    registerSuccessTimer = window.setTimeout(() => {
      registerSuccessTimer = null;
      hideRegisterSuccessToast();
    }, 4500);
  }

  function syncEventKindFromListTab() {
    const sel = document.getElementById("mll-event-kind");
    const wrap = sel?.closest?.("label.search-label-full");
    if (!(sel instanceof HTMLSelectElement) || !(wrap instanceof HTMLElement)) return;
    let hint = document.getElementById("mll-event-kind-tab-hint");
    const fromTab = CALENDAR_KIND_CREATE_OPTIONS.includes(kindTab);
    if (fromTab) {
      sel.value = kindTab;
      sel.hidden = true;
      wrap.classList.add("mll-event-kind-label--from-tab");
      if (!hint) {
        hint = document.createElement("p");
        hint.id = "mll-event-kind-tab-hint";
        hint.className = "mll-log-meta mll-event-kind-tab-hint";
        wrap.appendChild(hint);
      }
      hint.textContent = `種別: ${kindTab}（上の種別タブで変更できます）`;
      hint.hidden = false;
      const err = document.getElementById("mll-error-event-kind");
      if (err instanceof HTMLElement) {
        err.textContent = "";
        err.hidden = true;
      }
    } else {
      sel.hidden = false;
      wrap.classList.remove("mll-event-kind-label--from-tab");
      if (hint) hint.hidden = true;
    }
  }

  function syncRegisterBodyModalLock() {
    const editOpen = !!(editOverlay && !editOverlay.hidden);
    const on = registerFormExpanded || editOpen;
    document.documentElement.classList.toggle("calendar-ev-compose-active", on);
    document.body.classList.toggle("calendar-ev-compose-active", on);
  }

  function attachRegisterModalEscapeIfNeeded() {
    if (registerFormExpanded && !registerModalEscapeAttached) {
      document.addEventListener("keydown", escapeRegisterModal, true);
      registerModalEscapeAttached = true;
    } else if (!registerFormExpanded && registerModalEscapeAttached) {
      document.removeEventListener("keydown", escapeRegisterModal, true);
      registerModalEscapeAttached = false;
    }
  }

  function escapeRegisterModal(ev) {
    if (ev.key !== "Escape") return;
    if (!registerFormExpanded) return;
    ev.preventDefault();
    closeRegisterForm();
  }

  function focusRegisterFormField() {
    requestAnimationFrame(() => {
      const u = getUser();
      const titleEl = document.getElementById("calendar-ev-title");
      if (u?.id && titleEl instanceof HTMLInputElement && !titleEl.disabled) {
        titleEl.focus();
        return;
      }
      const closeBtn = registerOverlay?.querySelector?.(".community-compose-close-btn");
      if (closeBtn instanceof HTMLElement) closeBtn.focus();
    });
  }

  function syncRegisterFormVisibility() {
    const loggedIn = Boolean(getUser()?.id);
    const withdrawn = Boolean(window.MLL_AUTH?.isWithdrawn?.());
    const redirectPending = isAuthRedirectPending();
    const showReveal = registerFormExpanded;
    if (registerOverlay) {
      registerOverlay.hidden = !showReveal;
      registerOverlay.setAttribute("aria-hidden", showReveal ? "false" : "true");
    }
    syncRegisterBodyModalLock();
    attachRegisterModalEscapeIfNeeded();
    if (showReveal) {
      syncEventKindFromListTab();
      focusRegisterFormField();
    }
    const showCalendarBody = Boolean(
      loggedIn && !withdrawn && registerFormExpanded && formBody,
    );
    /** 旧 mll-log-form は非表示。calendar-event-form をモーダル内に載せる */
    const showLoggedMll = false;
    const showAuthGate = showReveal && !loggedIn && !redirectPending;
    const showWithdrawnGate = showReveal && withdrawn;

    if (showReveal && loggedIn && !withdrawn) {
      mountCalendarRegisterFormInModal();
    } else if (!showReveal) {
      restoreCalendarRegisterFormHome();
    }

    if (mllAuthGate) {
      mllAuthGate.hidden = !showAuthGate;
    }
    if (mllWithdrawnGate) {
      mllWithdrawnGate.hidden = !showWithdrawnGate;
    }
    if (mllLoggedBlock) {
      mllLoggedBlock.hidden = !showLoggedMll;
    }

    window.MarchinZEventsRegisterExpanded = registerFormExpanded;

    if (form) {
      form.hidden = !showCalendarBody;
      form.setAttribute("aria-hidden", showCalendarBody ? "false" : "true");
    }
    if (formBody) {
      formBody.hidden = !showCalendarBody;
      formBody.setAttribute("aria-hidden", showCalendarBody ? "false" : "true");
    }
    if (formMsg) {
      formMsg.hidden = !showReveal || !loggedIn;
    }
    if (openRegisterBtn) {
      openRegisterBtn.setAttribute("aria-expanded", String(Boolean(showReveal)));
    }
    if (openRegisterFooterBtn) {
      openRegisterFooterBtn.setAttribute("aria-expanded", String(Boolean(showReveal)));
    }
    if (submitBtn) submitBtn.disabled = !showCalendarBody || withdrawn;

    /** カレンダー新規登録フォーム: ログイン済みかつ開いているときのみ入力可 */
    form.querySelectorAll("input:not([type='hidden']), select").forEach((inp) => {
      inp.disabled = !loggedIn || withdrawn || !registerFormExpanded || !showCalendarBody;
    });
    if (redirectPending) {
      setFormMsg("ログイン処理中です。認証完了までお待ちください。", false);
    } else if (!loggedIn) {
      setFormMsg("", false);
    } else if (loggedIn && !withdrawn && !registerFormExpanded) {
      setFormMsg("", false);
    }

    window.dispatchEvent(new CustomEvent("marchinz-events-register-changed"));
  }

  async function hydrateProfiles(uids) {
    const db = getDb();
    const ids = [...new Set(uids.filter(Boolean))];
    for (const id of ids) {
      if (profileCache.has(id)) continue;
      if (!db) {
        profileCache.set(id, {
          display_name: UNKNOWN,
          avatar_url: "",
          withdrawn: false,
          profile_attributes: [],
          like_show_calendar: true,
          like_show_mll: true,
          section_vis_mll: "public",
        });
        continue;
      }
      try {
        const snap = await db.collection("mll_profiles").doc(id).get();
        const p = snap.data() || {};
        const attrs = Array.isArray(p.profile_attributes)
          ? p.profile_attributes.map((x) => String(x || "").trim()).filter(Boolean)
          : [];
        profileCache.set(id, {
          display_name: String(p.display_name || "").trim() || id.slice(0, 8),
          avatar_url: String(p.avatar_url || "").trim(),
          withdrawn: Boolean(p.withdrawn),
          profile_attributes: attrs,
          like_show_calendar: p.like_show_calendar !== false,
          like_show_mll: p.like_show_mll !== false,
          section_vis_mll:
            String(p.section_vis_mll || "").trim() === "private" ? "private" : "public",
        });
      } catch {
        profileCache.set(id, {
          display_name: id.slice(0, 8),
          avatar_url: "",
          withdrawn: false,
          profile_attributes: [],
          like_show_calendar: true,
          like_show_mll: true,
          section_vis_mll: "public",
        });
      }
    }
  }

  function profileMini(uid) {
    const p = profileCache.get(uid) || {
      display_name: UNKNOWN,
      avatar_url: "",
      withdrawn: false,
      profile_attributes: [],
      like_show_mll: true,
      section_vis_mll: "public",
    };
    if (p.withdrawn) {
      return { uid, name: WITHDRAWN_NAME, avatar: "", withdrawn: true };
    }
    return { uid, name: p.display_name, avatar: p.avatar_url, withdrawn: false };
  }

  /** @param {string} uid */
  function profileCard(uid) {
    const p = profileCache.get(uid);
    if (!p) {
      return { uid, name: UNKNOWN, avatar: "", withdrawn: false, attrs: [] };
    }
    if (p.withdrawn) {
      return { uid, name: WITHDRAWN_NAME, avatar: "", withdrawn: true, attrs: [] };
    }
    return {
      uid,
      name: p.display_name || UNKNOWN,
      avatar: p.avatar_url || "",
      withdrawn: false,
      attrs: Array.isArray(p.profile_attributes) ? p.profile_attributes : [],
    };
  }

  /** @param {string} uid */
  function buildParticipantDetailCard(uid) {
    const pc = profileCard(uid);
    const card = document.createElement("article");
    card.className = "mz-participant-detail-card";
    const profHref = `#profile?uid=${encodeURIComponent(uid)}`;

    const avatarLink = document.createElement("a");
    avatarLink.className = "mz-participant-detail-avatar-wrap";
    avatarLink.href = profHref;
    avatarLink.addEventListener("click", () => closeParticipantsDialog());
    if (pc.withdrawn) {
      const ph = document.createElement("span");
      ph.className = "mz-participant-detail-avatar mz-participant-detail-avatar--withdrawn";
      ph.setAttribute("role", "presentation");
      avatarLink.appendChild(ph);
    } else {
      const img = document.createElement("img");
      img.className = "mz-participant-detail-avatar";
      img.alt = "";
      img.src = pc.avatar || "logo/marchinz-logo.png";
      avatarLink.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "mz-participant-detail-body";
    const nameLink = document.createElement("a");
    nameLink.className = "mz-participant-detail-name";
    nameLink.href = profHref;
    nameLink.textContent = pc.name;
    nameLink.addEventListener("click", () => closeParticipantsDialog());
    body.appendChild(nameLink);

    if (pc.attrs.length) {
      const pills = document.createElement("div");
      pills.className = "mz-participant-detail-attrs";
      for (const a of pc.attrs.slice(0, 16)) {
        const span = document.createElement("span");
        span.className = "mz-participant-attr-pill";
        span.textContent = a;
        pills.appendChild(span);
      }
      body.appendChild(pills);
    }

    card.appendChild(avatarLink);
    card.appendChild(body);
    return card;
  }

  function closeParticipantsDialog() {
    if (!participantsOverlay) return;
    participantsOverlay.hidden = true;
    participantsOverlay.setAttribute("aria-hidden", "true");
  }

  let participantsNotePanelToken = 0;

  /** @param {string} eventId */
  async function loadEventNoteRows(eventId) {
    const db = getDb();
    const eid = String(eventId || "").trim();
    if (!db || !eid || !window.firebase?.firestore) return [];
    try {
      const snap = await db
        .collectionGroup("event_log_diaries")
        .where(window.firebase.firestore.FieldPath.documentId(), "==", eid)
        .get();
      /** @type {{ uid: string; eventId: string; data: Record<string, unknown>; updatedAt: string }[]} */
      const raw = [];
      snap.forEach((doc) => {
        const pref = doc.ref.parent && doc.ref.parent.parent;
        const uid = pref?.id;
        if (!uid || typeof pref.path !== "string" || !pref.path.startsWith("mll_profiles/")) return;
        const data = doc.data() || {};
        raw.push({
          uid,
          eventId: doc.id,
          data,
          updatedAt: String(data.updated_at || data.created_at || "").trim(),
        });
      });
      if (!raw.length) return [];
      await hydrateProfiles(raw.map((r) => r.uid));
      const filtered = raw.filter((r) => !profileCache.get(r.uid)?.withdrawn);
      filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return filtered;
    } catch (e) {
      console.warn("[calendar-events] event notes", e);
      return null;
    }
  }

  /**
   * @param {{ uid: string; eventId: string; data: Record<string, unknown> }} row
   */
  function buildEventNoteListCard(row) {
    const NA = window.MarchinZNoteActions;
    const pc = profileCard(row.uid);
    const noteTitle =
      NA?.diaryDisplayNoteTitle?.(row.data) ||
      NA?.diaryDisplayEventName?.(row.data) ||
      "MarchinZ Note";

    const card = document.createElement("article");
    card.className = "calendar-participants-note-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${pc.name} の ${noteTitle} を開く`);

    const avatarWrap = document.createElement("span");
    avatarWrap.className = "calendar-participants-note-avatar-wrap";
    if (pc.withdrawn) {
      const ph = document.createElement("span");
      ph.className =
        "calendar-participants-note-avatar calendar-participants-note-avatar--withdrawn";
      ph.setAttribute("role", "presentation");
      avatarWrap.appendChild(ph);
    } else {
      const img = document.createElement("img");
      img.className = "calendar-participants-note-avatar";
      img.alt = "";
      img.src = pc.avatar || "logo/marchinz-logo.png";
      avatarWrap.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "calendar-participants-note-body";
    const nameEl = document.createElement("span");
    nameEl.className = "calendar-participants-note-author";
    nameEl.textContent = pc.name;
    const titleEl = document.createElement("span");
    titleEl.className = "calendar-participants-note-title";
    titleEl.textContent = noteTitle;
    body.appendChild(nameEl);
    body.appendChild(titleEl);

    card.appendChild(avatarWrap);
    card.appendChild(body);

    const openNote = () => {
      void NA?.openViewer?.({
        uid: row.uid,
        eventId: row.eventId,
        returnHash: location.hash,
      });
    };
    card.addEventListener("click", openNote);
    card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        openNote();
      }
    });
    return card;
  }

  /** @param {string} eventId */
  function handleCreateNoteFromParticipantsDialog(eventId) {
    closeParticipantsDialog();
    const eid = String(eventId || "").trim();
    const ev = eventsCache.find((x) => String(x.id || "").trim() === eid);
    if (!ev) return;
    const me = getUser();
    const state = resolveMarchinZLogBtnState(me, ev);
    if (state.action === "auth") {
      window.MarchinZNavigateAuthEntry?.("signup", "events_mll_log");
      return;
    }
    if (state.action === "attendance") {
      openAttendanceDialog(ev.id);
      return;
    }
    navigateToMyNote(ev, me);
  }

  /**
   * @param {string} eventId
   * @param {HTMLElement} host
   * @param {number} token
   */
  async function paintParticipantsNotePanel(eventId, host, token) {
    host.innerHTML = "";
    const loading = document.createElement("p");
    loading.className = "mll-log-meta";
    loading.textContent = "読み込み中…";
    host.appendChild(loading);

    const rows = await loadEventNoteRows(eventId);
    if (token !== participantsNotePanelToken) return;

    host.innerHTML = "";
    if (rows === null) {
      const err = document.createElement("p");
      err.className = "mll-log-meta";
      err.textContent = "Note を読み込めませんでした。";
      host.appendChild(err);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "calendar-participants-panel calendar-participants-panel--notes";

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "calendar-participants-notes-empty";
      const msg = document.createElement("p");
      msg.className = "calendar-participants-notes-empty-msg";
      msg.textContent = "このイベントのMarchinZ Noteはまだありません。";
      const lead = document.createElement("p");
      lead.className = "calendar-participants-notes-empty-lead";
      lead.textContent = "このイベントを記録しよう";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "calendar-participants-notes-create-btn";
      btn.textContent = "Noteを作成する";
      btn.addEventListener("click", () => handleCreateNoteFromParticipantsDialog(eventId));
      empty.appendChild(msg);
      empty.appendChild(lead);
      empty.appendChild(btn);
      wrap.appendChild(empty);
      host.appendChild(wrap);
      window.MarchinZIcons?.prependIcon?.(btn, ["fa-solid", "fa-book-open"]);
      return;
    }

    for (const row of rows) {
      wrap.appendChild(buildEventNoteListCard(row));
    }
    host.appendChild(wrap);
  }

  function openParticipantsDialog(eventId) {
    if (!participantsOverlay || !participantsTabsEl || !participantsBodyEl) return;
    const am = attendeesByEvent.get(eventId) || new Map();
    const ev = eventsCache.find((item) => String(item.id) === String(eventId));
    const ALL = "すべて";
    const OTHER = "その他";
    /** @type {Map<string, string[]>} */
    const byTab = new Map();
    for (const k of ATTENDANCE_STYLE_FIRESTORE) byTab.set(k, []);
    byTab.set(OTHER, []);

    for (const [uid, styleRaw] of am.entries()) {
      const st = String(styleRaw || "").trim();
      if (isAttendanceStyleFirestore(st)) {
        byTab.get(st).push(uid);
      } else {
        byTab.get(OTHER).push(uid);
      }
    }
    for (const arr of byTab.values()) {
      arr.sort((a, b) => profileCard(a).name.localeCompare(profileCard(b).name, "ja"));
    }
    const allPublicUids = ev ? getMllPublicFaceUids(ev) : [...am.keys()];
    byTab.set(ALL, allPublicUids);

    const tabKeys = [ALL, ...ATTENDANCE_STYLE_FIRESTORE];
    if ((byTab.get(OTHER) || []).length) tabKeys.push(OTHER);

    function renderPanel(key) {
      const list = byTab.get(key) || [];
      const wrap = document.createElement("div");
      wrap.className = "calendar-participants-panel";
      if (!list.length) {
        const p = document.createElement("p");
        p.className = "mll-log-meta";
        p.textContent = "該当する参加者はいません。";
        wrap.appendChild(p);
        return wrap;
      }
      for (const uid of list) {
        wrap.appendChild(buildParticipantDetailCard(uid));
      }
      return wrap;
    }

    function selectTab(key) {
      participantsTabsEl.querySelectorAll("[data-participant-tab]").forEach((btn) => {
        const on = btn.getAttribute("data-participant-tab") === key;
        btn.classList.toggle("calendar-participants-tab--active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
      participantsBodyEl.innerHTML = "";
      if (key === PARTICIPANT_TAB_NOTE) {
        const token = ++participantsNotePanelToken;
        void paintParticipantsNotePanel(eventId, participantsBodyEl, token);
        return;
      }
      participantsBodyEl.appendChild(renderPanel(key));
    }

    participantsTabsEl.innerHTML = "";
    participantsBodyEl.innerHTML = "";
    for (const key of tabKeys) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-participant-tab", key);
      btn.className = "calendar-participants-tab";
      btn.setAttribute("role", "tab");
      const n = (byTab.get(key) || []).length;
      btn.textContent = `${key}（${n}）`;
      btn.addEventListener("click", () => selectTab(key));
      participantsTabsEl.appendChild(btn);
    }
    const noteTabBtn = document.createElement("button");
    noteTabBtn.type = "button";
    noteTabBtn.setAttribute("data-participant-tab", PARTICIPANT_TAB_NOTE);
    noteTabBtn.className = "calendar-participants-tab calendar-participants-tab--note";
    noteTabBtn.setAttribute("role", "tab");
    noteTabBtn.setAttribute("aria-label", "MarchinZ Note");
    noteTabBtn.title = "MarchinZ Note";
    window.MarchinZIcons?.prependIcon?.(noteTabBtn, ["fa-solid", "fa-book-open"]);
    noteTabBtn.addEventListener("click", () => selectTab(PARTICIPANT_TAB_NOTE));
    participantsTabsEl.appendChild(noteTabBtn);

    const firstWith =
      tabKeys.find((k) => (byTab.get(k) || []).length > 0) || tabKeys[0];
    selectTab(firstWith);

    participantsOverlay.hidden = false;
    participantsOverlay.setAttribute("aria-hidden", "false");
  }

  function normTitleKey(s) {
    return String(s || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  /** mll_logs と突き合わせるキー（カレンダー行と同一正規化） */
  function eventMatchKey(ev) {
    return `${String(ev.date || "").trim()}|${normTitleKey(ev.title)}|${String(ev.venue_pref || "").trim()}`;
  }

  /**
   * 公開の MarchinZ Log（mll_logs）で、このイベントに紐づく user_id を収集。
   */
  /**
   * ログインユーザーの Log / Note 有無（イベントカードの CTA ラベル用）
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} uid
   */
  async function loadMyUserEventMarkers(db, uid) {
    myLogEventIds = new Set();
    myDiaryEventIds = new Set();
    const id = String(uid || "").trim();
    if (!id || !db) return;
    const R = mllRoleApi();
    try {
      const snap = R?.queryMllLogsForUser
        ? await R.queryMllLogsForUser(db, id)
        : await db.collection("mll_logs").where("user_id", "==", id).limit(800).get();
      snap.forEach((doc) => {
        const x = doc.data() || {};
        const calId = String(x.calendar_event_id || "").trim();
        if (calId) myLogEventIds.add(calId);
      });
    } catch (e) {
      console.warn("[calendar-events] my mll_logs", e);
    }
    try {
      const dsnap = await db.collection("mll_profiles").doc(id).collection("event_log_diaries").get();
      dsnap.forEach((doc) => {
        const eid = String(doc.id || "").trim();
        if (eid) myDiaryEventIds.add(eid);
      });
    } catch (e) {
      console.warn("[calendar-events] my event_log_diaries", e);
    }
  }

  /** @param {{ id?: string }} ev @param {string} uid */
  function userHasMarchinZLogForEvent(ev, uid) {
    const u = String(uid || "").trim();
    const eid = String(ev?.id || "").trim();
    if (!u || !eid) return false;
    if (myLogEventIds.has(eid)) return true;
    return attendeesByEvent.get(eid)?.has(u) ?? false;
  }

  /**
   * @param {{ id?: string }} | null} me
   * @param {{ id?: string }} ev
   * @returns {{ label: string; action: "auth" | "attendance" | "write-note" | "view-log"; variant: "log" | "note" | "view-log" }}
   */
  function resolveMarchinZLogBtnState(me, ev) {
    const saveLabel = `${CALENDAR_LOG_BTN_LABEL}を残す`;
    if (!me?.id) return { label: saveLabel, action: "auth", variant: "log" };
    if (!userHasMarchinZLogForEvent(ev, me.id)) {
      return { label: saveLabel, action: "attendance", variant: "log" };
    }
    if (myDiaryEventIds.has(String(ev?.id || "").trim())) {
      return { label: "Noteを見る", action: "view-log", variant: "view-log" };
    }
    return { label: "Noteを書く", action: "write-note", variant: "note" };
  }

  /** @param {{ id?: string }} ev @param {{ id?: string }} me */
  function navigateToMyNote(ev, me) {
    const uid = String(me?.id || "").trim();
    const eid = String(ev?.id || "").trim();
    if (!uid || !eid) return;
    window.location.hash = `#profile?uid=${encodeURIComponent(uid)}&tab=logdiary&event=${encodeURIComponent(eid)}`;
  }

  async function loadMllLogPublicFaceMap(db, events) {
    mllPublicUidsByMatchKey = new Map();
    mllPublicUidsByEventId = new Map();
    if (!db || !events.length) return;
    const keysNeeded = new Set(events.map(eventMatchKey));
    const eventIdsNeeded = new Set(events.map((e) => String(e.id || "").trim()).filter(Boolean));
    let rows = [];
    try {
      const R = mllRoleApi();
      rows = R?.queryMllLogsForFeed ? await R.queryMllLogsForFeed(db, getUser()?.id || null) : [];
    } catch (e) {
      console.warn("[calendar-events] mll_logs fetch", e);
      return;
    }
    for (const x of rows) {
      if (String(x.visibility || "").trim() === "private") continue;
      const uid = String(x.user_id || "").trim();
      if (!uid) continue;
      const calId = String(x.calendar_event_id || "").trim();
      if (calId && eventIdsNeeded.has(calId)) {
        if (!mllPublicUidsByEventId.has(calId)) mllPublicUidsByEventId.set(calId, new Set());
        mllPublicUidsByEventId.get(calId).add(uid);
      }
      const key = `${String(x.event_date || "").trim()}|${normTitleKey(x.event_name || "")}|${String(x.venue || "").trim()}`;
      if (!keysNeeded.has(key)) continue;
      if (!mllPublicUidsByMatchKey.has(key)) mllPublicUidsByMatchKey.set(key, new Set());
      mllPublicUidsByMatchKey.get(key).add(uid);
    }
  }

  async function loadEventsAndAttendees() {
    if (loadEventsInflight) return loadEventsInflight;
    loadEventsInflight = (async () => {
    const db = getDb();
    eventsCache = [];
    attendeesByEvent.clear();
    mllPublicUidsByMatchKey = new Map();
    mllPublicUidsByEventId = new Map();
    if (!db) {
      setFormMsg("Firestore が利用できない環境です。イベント共有にはブラウザからの接続を確認してください。", true);
      renderCurrentView();
      return;
    }
    profileCache.clear();

    try {
      const snap = await db.collection("mll_calendar_events").orderBy("date", "desc").limit(400).get();
      snap.forEach((doc) => {
        const x = doc.data() || {};
        if (String(x.status || "").trim() === "trashed") return;
        eventsCache.push({
          id: doc.id,
          kind: String(x.kind || ""),
          date: String(x.date || ""),
          title: String(x.title || ""),
          venue_pref: String(x.venue_pref || "").trim(),
          venue_name: String(x.venue_name || "").trim(),
          end_date: String(x.end_date || "").trim(),
          start_time: String(x.start_time || "").trim(),
          event_url: String(x.event_url || "").trim(),
          participation_format: String(x.participation_format || "").trim(),
          liked_by: normalizeLikedBy(x.liked_by),
          created_by: String(x.created_by || ""),
          creator_display_name: String(x.creator_display_name || UNKNOWN),
          creator_avatar_url: String(x.creator_avatar_url || ""),
          created_at: String(x.created_at || ""),
        });
      });
    } catch (e) {
      console.warn("[calendar-events]", e);
      setFormMsg("イベント一覧の取得に失敗しました。ルール未デプロイやオフラインの可能性があります。", true);
      renderCurrentView();
      return;
    }

    const me = getUser();
    await Promise.all([
      ...eventsCache.map(async (ev) => {
        try {
          const sub = await db.collection("mll_calendar_events").doc(ev.id).collection("attendees").get();
          const m = new Map();
          sub.forEach((d) => {
            const st = String((d.data() || {}).style || "");
            if (isAttendanceStyleFirestore(st)) m.set(d.id, st);
          });
          attendeesByEvent.set(ev.id, m);
        } catch {
          attendeesByEvent.set(ev.id, new Map());
        }
      }),
      loadMllLogPublicFaceMap(db, eventsCache),
      loadMyUserEventMarkers(db, me?.id),
    ]);

    const allUids = new Set();
    for (const ev of eventsCache) {
      allUids.add(ev.created_by);
      const am = attendeesByEvent.get(ev.id);
      if (am) [...am.keys()].forEach((u) => allUids.add(u));
    }
    for (const s of mllPublicUidsByMatchKey.values()) {
      [...s].forEach((u) => allUids.add(u));
    }
    for (const s of mllPublicUidsByEventId.values()) {
      [...s].forEach((u) => allUids.add(u));
    }
    await hydrateProfiles([...allUids]);
    renderCurrentView();
    })().finally(() => {
      loadEventsInflight = null;
    });
    return loadEventsInflight;
  }

  function sortCalendarRows(rows) {
    const sign = sortDesc ? -1 : 1;
    rows.sort((a, b) => sign * String(a.date || "").localeCompare(String(b.date || "")));
  }

  /** 登録済みイベントに存在する都道府県（JP 並び） */
  function collectRegisteredVenuePrefs() {
    const set = new Set();
    for (const ev of eventsCache) {
      if (!VALID_KINDS.has(ev.kind)) continue;
      const p = String(ev.venue_pref || "").trim();
      if (p) set.add(p);
    }
    const ordered = [];
    for (const group of JP_PREF_GROUPS) {
      for (const pref of group.prefs) {
        if (set.has(pref)) ordered.push(pref);
      }
    }
    for (const p of set) {
      if (!ordered.includes(p)) ordered.push(p);
    }
    return ordered;
  }

  /** 登録済みイベントに存在する開催年（新しい年から） */
  function collectRegisteredYears() {
    const set = new Set();
    for (const ev of eventsCache) {
      if (!VALID_KINDS.has(ev.kind)) continue;
      const y = eventYearKey(ev);
      if (y) set.add(y);
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }

  function closeYearFilterMenu() {
    yearFilterMenuOpen = false;
    if (yearFilterMenu) {
      yearFilterMenu.hidden = true;
    }
    syncYearFilterButton();
  }

  function closeVenueFilterMenu() {
    venueFilterMenuOpen = false;
    if (venueFilterMenu) {
      venueFilterMenu.hidden = true;
    }
    syncVenueFilterButton();
  }

  function closeAllCalendarEvFilterMenus() {
    closeVenueFilterMenu();
    closeYearFilterMenu();
  }

  function setYearFilterButtonLabel(text) {
    if (!yearFilterBtn) return;
    let label = yearFilterBtn.querySelector(".calendar-ev-year-filter-label");
    if (!label) {
      label = document.createElement("span");
      label.className = "calendar-ev-year-filter-label";
      yearFilterBtn.appendChild(label);
    }
    label.textContent = text;
  }

  function syncYearFilterButton() {
    if (!yearFilterBtn) return;
    const active = Boolean(yearFilterYear);
    setYearFilterButtonLabel(active ? `${yearFilterYear}年` : "開催年");
    yearFilterBtn.classList.toggle("calendar-ev-year-filter-btn--active", active);
    yearFilterBtn.setAttribute("aria-expanded", yearFilterMenuOpen ? "true" : "false");
  }

  function renderYearFilterMenu() {
    if (!yearFilterMenu) return;
    yearFilterMenu.innerHTML = "";
    const mk = (label, value) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "calendar-ev-year-filter-item";
      b.textContent = label;
      b.setAttribute("role", "option");
      const on = value ? yearFilterYear === value : !yearFilterYear;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        yearFilterYear = value;
        closeAllCalendarEvFilterMenus();
        renderCurrentView();
      });
      yearFilterMenu.appendChild(b);
    };
    mk("すべて", "");
    for (const y of collectRegisteredYears()) {
      mk(`${y}年`, y);
    }
  }

  function toggleYearFilterMenu() {
    if (!yearFilterMenu || !yearFilterBtn) return;
    if (yearFilterMenuOpen) {
      closeYearFilterMenu();
      return;
    }
    closeVenueFilterMenu();
    renderYearFilterMenu();
    yearFilterMenuOpen = true;
    yearFilterMenu.hidden = false;
    syncYearFilterButton();
  }

  function setVenueFilterButtonLabel(text) {
    if (!venueFilterBtn) return;
    let label = venueFilterBtn.querySelector(".calendar-ev-venue-filter-label");
    if (!label) {
      label = document.createElement("span");
      label.className = "calendar-ev-venue-filter-label";
      venueFilterBtn.appendChild(label);
    }
    label.textContent = text;
  }

  function syncVenueFilterButton() {
    if (!venueFilterBtn) return;
    const active = Boolean(venueFilterPref);
    setVenueFilterButtonLabel(active ? venueFilterPref : "都道府県");
    venueFilterBtn.classList.toggle("calendar-ev-venue-filter-btn--active", active);
    venueFilterBtn.setAttribute("aria-expanded", venueFilterMenuOpen ? "true" : "false");
  }

  function renderVenueFilterMenu() {
    if (!venueFilterMenu) return;
    venueFilterMenu.innerHTML = "";
    const mk = (label, value) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "calendar-ev-venue-filter-item";
      b.textContent = label;
      b.setAttribute("role", "option");
      const on = value ? venueFilterPref === value : !venueFilterPref;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        venueFilterPref = value;
        closeAllCalendarEvFilterMenus();
        renderCurrentView();
      });
      venueFilterMenu.appendChild(b);
    };
    mk("すべて", "");
    for (const pref of collectRegisteredVenuePrefs()) {
      mk(pref, pref);
    }
  }

  function toggleVenueFilterMenu() {
    if (!venueFilterMenu || !venueFilterBtn) return;
    if (venueFilterMenuOpen) {
      closeVenueFilterMenu();
      return;
    }
    closeYearFilterMenu();
    renderVenueFilterMenu();
    venueFilterMenuOpen = true;
    venueFilterMenu.hidden = false;
    syncVenueFilterButton();
  }

  let eventSearchQuery = "";

  function filteredSorted() {
    const t = todayStr();
    let rows = eventsCache.filter((ev) => VALID_KINDS.has(ev.kind));
    if (kindTab !== "all" && CALENDAR_KIND_CREATE_OPTIONS.includes(kindTab)) {
      rows = rows.filter((ev) => ev.kind === kindTab);
    }
    if (upcomingOnly) {
      rows = rows.filter((ev) => ev.date >= t);
    }
    if (venueFilterPref) {
      rows = rows.filter((ev) => String(ev.venue_pref || "").trim() === venueFilterPref);
    }
    if (yearFilterYear) {
      rows = rows.filter((ev) => eventYearKey(ev) === yearFilterYear);
    }
    if (eventSearchQuery) {
      const q = eventSearchQuery.toLowerCase();
      rows = rows.filter((ev) =>
        (ev.title || "").toLowerCase().includes(q) ||
        (ev.venue_pref || "").toLowerCase().includes(q) ||
        (ev.kind || "").toLowerCase().includes(q) ||
        (ev.creator_display_name || "").toLowerCase().includes(q)
      );
    }
    sortCalendarRows(rows);
    return rows;
  }

  /**
   * 同一開催日・タイトル・開催地・作成者の重複行は、created_at が新しい方だけ残す（過去の二重登録対策）。
   */
  function dedupeCalendarRows(rows) {
    const map = new Map();
    for (const ev of rows) {
      const titleKey = normTitleKey(ev.title);
      const key = `${ev.date}|${titleKey}|${String(ev.venue_pref || "").trim()}|${ev.created_by || ""}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, ev);
        continue;
      }
      const pa = String(prev.created_at || "");
      const pb = String(ev.created_at || "");
      if (pb >= pa) map.set(key, ev);
    }
    return [...map.values()];
  }

  /** チップ用の種別ラベル */
  function kindChipLabel(kind) {
    if (CALENDAR_KIND_CREATE_OPTIONS.includes(kind)) return kind;
    return VALID_KINDS.has(kind) ? kind : "—";
  }

  /** CSS サフィックス用（日本語 class 名を避ける） */
  function kindSlugForCss(kind) {
    if (kind === "演奏会") return "ensoukai";
    if (kind === "大会") return "taikai";
    if (kind === "イベント") return "event";
    if (kind === "一般") return "ippan";
    if (kind === "高校") return "koukou";
    if (kind === "中学生以下") return "chuugaku";
    if (kind === "カラーガード") return "colourguard";
    if (kind === "海外") return "kaigai";
    return "other";
  }

  function syncSortBar() {
    const bar = document.getElementById("calendar-ev-sort-bar");
    if (!bar) return;
    bar.querySelectorAll("[data-cal-sort]").forEach((btn) => {
      const k = btn.getAttribute("data-cal-sort") || "";
      if (k !== "year") return;
      btn.setAttribute("aria-pressed", "true");
      btn.classList.add("calendar-ev-sort-btn--active");
      btn.classList.remove("sorted-asc", "sorted-desc");
      btn.classList.add(sortDesc ? "sorted-desc" : "sorted-asc");
      const dirJp = sortDesc ? "新しい年から" : "古い年から";
      btn.setAttribute("aria-label", `開催年で並び替え（${dirJp}）、クリックで順序切替`);
    });
    syncVenueFilterButton();
    syncYearFilterButton();
  }

  function displayDate(d) {
    return String(d || "—").replace(/-/g, "/");
  }

  /** リスト表示用（年は見出しに出すため mm/dd のみ） */
  function displayCompactListDate(d) {
    const raw = String(d || "").trim();
    if (!raw || raw === "—") return "—";
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[2]}/${iso[3]}`;
    const slash = raw.replace(/-/g, "/");
    const parts = slash.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (parts) {
      const mm = String(parts[2]).padStart(2, "0");
      const dd = String(parts[3]).padStart(2, "0");
      return `${mm}/${dd}`;
    }
    return slash;
  }

  /** @type {IntersectionObserver|null} */
  let calendarYearReelObserver = null;

  function eventYearKey(ev) {
    const d = String(ev?.date || "").trim();
    const m = /^(\d{4})/.exec(d);
    return m ? m[1] : "";
  }

  /** @param {object[]} rows */
  function collectEventYears(rows) {
    const set = new Set();
    for (const ev of rows) {
      const y = eventYearKey(ev);
      if (y) set.add(y);
    }
    return [...set].sort((a, b) => (sortDesc ? b.localeCompare(a) : a.localeCompare(b)));
  }

  /** @param {object[]} rows @param {string} y */
  function rowsForEventYear(rows, y) {
    return rows.filter((ev) => eventYearKey(ev) === y);
  }

  /** @param {object[]} yearRows */
  function yearEventMetaLine(yearRows) {
    const n = yearRows.length;
    if (!n) return "";
    const parts = [];
    for (const k of ["演奏会", "大会", "イベント"]) {
      const c = yearRows.filter((ev) => ev.kind === k).length;
      if (c) parts.push(`${k}${c}件`);
    }
    return parts.length ? parts.join(" · ") : `${n}件`;
  }

  function teardownCalendarYearReelObserver() {
    if (calendarYearReelObserver) {
      calendarYearReelObserver.disconnect();
      calendarYearReelObserver = null;
    }
  }

  function setCalendarYearReelActive(btn) {
    const reel = document.getElementById("calendar-ev-year-reel");
    if (!reel || !btn) return;
    reel.querySelectorAll("button[data-cal-year-jump]").forEach((b) => {
      const on = b === btn;
      b.classList.toggle("media-jump-tab--active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function scrollToCalendarYear(y) {
    const sec = document.getElementById(`calendar-ev-year-${y}`);
    if (!sec) return;
    sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** @param {string[]} years */
  function setupCalendarYearReelScrollSpy(years) {
    teardownCalendarYearReelObserver();
    const reel = document.getElementById("calendar-ev-year-reel");
    if (!reel || years.length < 2) return;
    const sections = years
      .map((y) => document.getElementById(`calendar-ev-year-${y}`))
      .filter(Boolean);
    if (sections.length < 2) return;
    calendarYearReelObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (!visible.length) return;
        const id = visible[0].target.id || "";
        const y = id.replace(/^calendar-ev-year-/, "");
        const btn = reel.querySelector(`button[data-cal-year-jump="${CSS.escape(y)}"]`);
        if (btn instanceof HTMLButtonElement) setCalendarYearReelActive(btn);
      },
      { root: null, rootMargin: "-12% 0px -55% 0px", threshold: [0, 0.15, 0.4, 0.75] },
    );
    for (const sec of sections) calendarYearReelObserver.observe(sec);
  }

  /** @param {string[]} years */
  function renderCalendarYearReel(years) {
    const reel = document.getElementById("calendar-ev-year-reel");
    if (!reel) return;
    teardownCalendarYearReelObserver();
    reel.replaceChildren();
    if (viewMode === "calendar" || years.length < 2) {
      reel.hidden = true;
      reel.className = "calendar-ev-year-reel";
      return;
    }
    reel.hidden = false;
    reel.className =
      "calendar-ev-year-reel media-jump-links youtube-tabs mz-tab-strip-yamap";
    for (const y of years) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "media-jump-tab youtube-tab-btn";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", "false");
      btn.dataset.calYearJump = y;
      btn.textContent = `${y}年`;
      btn.addEventListener("click", () => {
        scrollToCalendarYear(y);
        setCalendarYearReelActive(btn);
      });
      reel.appendChild(btn);
    }
    const first = reel.querySelector("button[data-cal-year-jump]");
    if (first instanceof HTMLButtonElement) setCalendarYearReelActive(first);
    setupCalendarYearReelScrollSpy(years);
  }

  /**
   * @param {string} y
   * @param {object[]} yearRows
   * @returns {HTMLElement}
   */
  function createCalendarYearSection(y, yearRows) {
    const sec = document.createElement("section");
    sec.className = "calendar-ev-year user-profile-mll-year";
    sec.id = `calendar-ev-year-${y}`;
    sec.dataset.calYear = y;
    const hdr = document.createElement("header");
    hdr.className = "user-profile-mll-year-hdr calendar-ev-year-hdr";
    const h3 = document.createElement("h3");
    h3.className = "user-profile-mll-year-title";
    h3.textContent = `${y}年`;
    hdr.appendChild(h3);
    const metaTxt = yearEventMetaLine(yearRows);
    if (metaTxt) {
      const sm = document.createElement("p");
      sm.className = "user-profile-mll-year-meta";
      sm.textContent = metaTxt;
      hdr.appendChild(sm);
    }
    sec.appendChild(hdr);
    return sec;
  }

  function applyCalendarEventHighlight() {
    let highlightId = "";
    try {
      highlightId = sessionStorage.getItem("mz_cal_ev_highlight") || "";
    } catch {
      highlightId = "";
    }
    if (!highlightId) return;
    try {
      sessionStorage.removeItem("mz_cal_ev_highlight");
    } catch {
      //
    }
    requestAnimationFrame(() => {
      let sel = "";
      try {
        sel = `[data-cal-event-id="${CSS.escape(highlightId)}"]`;
      } catch {
        sel = "";
      }
      const row = sel ? listEl.querySelector(sel) : null;
      if (!row) return;
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      row.classList.add("calendar-ev-card--highlight");
      window.setTimeout(() => row.classList.remove("calendar-ev-card--highlight"), 4200);
    });
  }

  /** @param {object} ev @param {object|null} me */
  /**
   * Googleカレンダー「終日イベント」登録URL。dates は開始日/翌日(排他的終了)の YYYYMMDD 形式。
   * @param {object} ev
   * @returns {string|null} 日付が不正なら null(ボタンを出さない)
   */
  function buildGoogleCalendarUrl(ev) {
    const d = String(ev.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const ymd = (s) => s.replace(/-/g, "");
    const tm = String(ev.start_time || "").trim();
    const end = String(ev.end_date || "").slice(0, 10);
    let dates;
    if (/^\d{4}-\d{2}-\d{2}$/.test(end) && end > d) {
      // 複数日: 終日イベント(終了日は排他的なので+1日)
      const dt = new Date(`${end}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return null;
      dt.setDate(dt.getDate() + 1);
      dates = `${ymd(d)}/${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
    } else if (/^\d{2}:\d{2}$/.test(tm)) {
      // 開演時間つき: 2時間枠で入れる(終わりは分からないため)
      const st = new Date(`${d}T${tm}:00`);
      if (Number.isNaN(st.getTime())) return null;
      const en = new Date(st.getTime() + 2 * 3600 * 1000);
      const fmt = (x) =>
        x.getFullYear() + String(x.getMonth() + 1).padStart(2, "0") + String(x.getDate()).padStart(2, "0")
        + "T" + String(x.getHours()).padStart(2, "0") + String(x.getMinutes()).padStart(2, "0") + "00";
      dates = `${fmt(st)}/${fmt(en)}`;
    } else {
      const dt = new Date(`${d}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return null;
      dt.setDate(dt.getDate() + 1);
      dates = `${ymd(d)}/${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
    }
    const detailsParts = [];
    const evUrl = String(ev.event_url || "").trim();
    if (/^https?:\/\/.+/i.test(evUrl)) detailsParts.push(evUrl);
    if (/^\d{2}:\d{2}$/.test(tm)) {
      detailsParts.push(`開演 ${tm}`);
      // 終わりの時刻は分からないので仮に2時間で入れている。断定しない
      detailsParts.push("※終了時刻は未確定のため、仮に2時間で登録しています");
    }
    detailsParts.push("MarchinZ イベント一覧: https://marchinz.netlify.app/#community/events");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: String(ev.title || "").trim() || "マーチングイベント",
      dates,
      details: detailsParts.join("\n"),
      /* 日時は日本時間として渡す。指定しないと閲覧者の端末のタイムゾーンで
         解釈され、海外から見た人の予定がずれる(2026-07-22 レビュー) */
      ctz: "Asia/Tokyo",
    });
    const vn = String(ev.venue_name || "").trim();
    const pref = String(ev.venue_pref || "").trim();
    const loc = vn && pref ? `${vn}（${pref}）` : vn || pref;
    if (loc) params.set("location", loc);
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function buildCalendarCardLi(ev, me) {
    const li = document.createElement("li");
    const kSlug = kindSlugForCss(ev.kind);
    li.className = `mll-log-item calendar-ev-card calendar-ev-card--ticket calendar-ev-card--kind-${kSlug}`;
    li.dataset.calEventId = String(ev.id || "");

    const header = document.createElement("header");
    header.className = "calendar-ev-ticket-head";
    header.appendChild(renderMetaChips(ev));
    if (isSiteAdmin() && mergeSourceEventId === ev.id) {
      const mergeBadge = document.createElement("span");
      mergeBadge.className = "calendar-ev-merge-badge";
      mergeBadge.textContent = "統合元";
      header.appendChild(mergeBadge);
    }
    if (canManageEvent(ev)) header.appendChild(buildCalendarEventOverflow(ev));

    const titleRow = document.createElement("div");
    titleRow.className = "calendar-ev-title-row calendar-ev-title-row--prominent calendar-ev-ticket-title-row";

    const titleCol = document.createElement("div");
    titleCol.className = "calendar-ev-title-col";

    const titleEl = document.createElement("h3");
    titleEl.className = "mll-log-title calendar-ev-title-text";
    const trimmedUrl = String(ev.event_url || "").trim();
    if (trimmedUrl && /^https?:\/\/.+/i.test(trimmedUrl)) {
      const a = document.createElement("a");
      a.className = "calendar-ev-title-link";
      a.href = trimmedUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", `${String(ev.title || "イベント")}（公式サイトを新しいタブで開く）`);
      const txt = document.createElement("span");
      txt.textContent = ev.title;
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-arrow-up-right-from-square calendar-ev-title-link-icon";
      icon.setAttribute("aria-hidden", "true");
      a.appendChild(txt);
      a.appendChild(icon);
      titleEl.appendChild(a);
    } else {
      titleEl.textContent = ev.title;
    }
    titleCol.appendChild(titleEl);
    titleRow.appendChild(titleCol);

    li.appendChild(header);
    li.appendChild(titleRow);
    const placeLine = renderCalendarPlaceLine(ev);
    if (placeLine) li.appendChild(placeLine);
    li.appendChild(renderTopMetaWithCreator(ev));
    li.appendChild(buildMarchinZLogRow(ev, me));
    return li;
  }

  /** @param {object} ev */
  function buildCalendarCompactRowLi(ev) {
    const li = document.createElement("li");
    li.className = "calendar-ev-compact-row";
    li.dataset.calEventId = String(ev.id || "");
    const kSlug = kindSlugForCss(ev.kind);
    const dot = document.createElement("span");
    dot.className = `calendar-ev-compact-dot calendar-ev-compact-dot--${kSlug}`;
    const dateSpan = document.createElement("span");
    dateSpan.className = "calendar-ev-compact-date";
    dateSpan.textContent = displayCompactListDate(ev.date);
    const kindSpan = document.createElement("span");
    kindSpan.className = `calendar-ev-compact-kind calendar-ev-compact-kind--${kSlug}`;
    kindSpan.textContent = kindChipLabel(ev.kind);
    const titleSpan = document.createElement("span");
    titleSpan.className = "calendar-ev-compact-title";
    titleSpan.textContent = ev.title || "";
    const venueSpan = document.createElement("span");
    venueSpan.className = "calendar-ev-compact-venue";
    venueSpan.textContent = String(ev.venue_pref || "").trim();
    const likeWrap = document.createElement("div");
    likeWrap.className = "calendar-ev-compact-like-wrap";
    likeWrap.addEventListener("click", (e) => e.stopPropagation());
    appendCalendarEventLikeRow(likeWrap, ev);
    li.appendChild(dot);
    li.appendChild(dateSpan);
    li.appendChild(kindSpan);
    li.appendChild(titleSpan);
    li.appendChild(likeWrap);
    li.appendChild(venueSpan);
    li.addEventListener("click", () => {
      openEventCardOverlay(ev);
    });
    return li;
  }

  function renderMetaChips(ev) {
    const kindLbl = kindChipLabel(ev.kind);
    const wrap = document.createElement("div");
    wrap.className = "calendar-ev-meta-chips";
    const mk = (text, extraClass) => {
      const s = document.createElement("span");
      s.className = `calendar-ev-meta-chip${extraClass ? ` ${extraClass}` : ""}`;
      s.textContent = text;
      return s;
    };
    const slug = kindSlugForCss(ev.kind);
    const end = String(ev.end_date || "").trim();
    const dateTxt = end ? `${displayDate(ev.date)}〜${displayDate(end)}` : displayDate(ev.date);
    wrap.appendChild(mk(dateTxt, "calendar-ev-meta-chip--date"));
    wrap.appendChild(
      mk(
        kindLbl,
        `calendar-ev-meta-chip--kind calendar-ev-meta-chip--kind-${slug}`,
      ),
    );
    return wrap;
  }

  function renderCalendarPlaceLine(ev) {
    const pref = String(ev.venue_pref || "").trim();
    const venue = String(ev.venue_name || "").trim();
    const time = String(ev.start_time || "").trim();
    const place = pref && venue ? `${pref}・${venue}` : pref || venue;
    if (!place && !time) return null;
    const row = document.createElement("p");
    row.className = "calendar-ev-ticket-place";
    const icon = document.createElement("i");
    icon.className = place ? "fa-solid fa-location-dot" : "fa-regular fa-clock";
    icon.setAttribute("aria-hidden", "true");
    row.appendChild(icon);
    const txt = document.createElement("span");
    txt.textContent = [place, time ? `${time}開演` : ""].filter(Boolean).join(" ・ ");
    row.appendChild(txt);
    return row;
  }

  function getMllPublicFaceUids(ev) {
    const key = eventMatchKey(ev);
    const uidSet = new Set();
    const rawMk = mllPublicUidsByMatchKey.get(key);
    if (rawMk) for (const uid of rawMk) uidSet.add(uid);
    const rawId = mllPublicUidsByEventId.get(String(ev.id || "").trim());
    if (rawId) for (const uid of rawId) uidSet.add(uid);
    const am = attendeesByEvent.get(ev.id);
    if (am) for (const uid of am.keys()) uidSet.add(uid);
    const out = [];
    for (const uid of uidSet) {
      const pr = profileCache.get(uid);
      if (pr?.withdrawn) continue;
      if (pr?.section_vis_mll === "private") continue;
      if (pr?.like_show_mll === false) continue;
      out.push(uid);
    }
    out.sort((a, b) => profileMini(a).name.localeCompare(profileMini(b).name, "ja"));
    return out;
  }

  function renderTopMetaWithCreator(ev) {
    const row = document.createElement("div");
    row.className = "calendar-ev-ticket-credit";
    const creatorUid = String(ev.created_by || "").trim();
    const pm = profileMini(ev.created_by);
    const creatorLabel = pm.name || UNKNOWN;
    const canOpenProfile = Boolean(creatorUid && !pm.withdrawn);
    const cr = document.createElement(canOpenProfile ? "a" : "span");
    cr.className = "calendar-ev-topline-creator";
    row.setAttribute("aria-label", `記入者：${creatorLabel}`);
    if (canOpenProfile) {
      cr.href = `#profile?uid=${encodeURIComponent(creatorUid)}`;
      cr.setAttribute("aria-label", `記入者：${creatorLabel}のマイページ`);
    }
    const creatorAvatar = document.createElement("img");
    creatorAvatar.className = "calendar-ev-topline-creator-avatar";
    creatorAvatar.alt = "";
    creatorAvatar.src = pm.avatar || "logo/marchinz-logo.png";
    if (!pm.avatar) creatorAvatar.style.opacity = "0.55";
    cr.appendChild(creatorAvatar);
    const creatorName = document.createElement("span");
    creatorName.className = "calendar-ev-topline-creator-name";
    creatorName.textContent = creatorLabel;
    cr.appendChild(creatorName);
    row.appendChild(cr);
    return row;
  }

  function buildMllFacesWrap(ev) {
    const uids = getMllPublicFaceUids(ev);
    const wrap = document.createElement("div");
    wrap.className = "calendar-ev-mll-faces";
    wrap.setAttribute("aria-hidden", "true");
    for (const uid of uids.slice(0, 3)) {
      const p = profileMini(uid);
      const face = document.createElement("span");
      face.className = "calendar-ev-mll-face";
      if (p.withdrawn) {
        const ph = document.createElement("span");
        ph.className = "calendar-ev-mll-face-img calendar-ev-mll-face-img--withdrawn";
        ph.setAttribute("role", "presentation");
        face.appendChild(ph);
      } else {
        const img = document.createElement("img");
        img.className = "calendar-ev-mll-face-img";
        img.alt = "";
        img.loading = "lazy";
        img.src = p.avatar || "logo/marchinz-logo.png";
        if (!p.avatar) img.style.opacity = "0.55";
        face.appendChild(img);
      }
      wrap.appendChild(face);
    }
    return wrap;
  }

  /** 3段目: MarchinZ Log 参加者 + 右端 CTA */
  function buildMarchinZLogRow(ev, me) {
    const faceCount = getMllPublicFaceUids(ev).length;
    const row = document.createElement("div");
    row.className = "calendar-ev-mll-log-row";
    const left = document.createElement(faceCount > 0 ? "button" : "span");
    left.className = "calendar-ev-mll-log-left";
    if (faceCount > 0) {
      left.type = "button";
      left.setAttribute("aria-label", `${CALENDAR_LOG_BTN_LABEL}を残した${faceCount}人を見る`);
      left.addEventListener("click", (e) => {
        e.stopPropagation();
        openParticipantsDialog(ev.id);
      });
      left.appendChild(buildMllFacesWrap(ev));
      const count = document.createElement("span");
      count.className = "calendar-ev-mll-log-count";
      count.textContent = String(faceCount);
      left.appendChild(count);
    }
    if (faceCount > 0) row.appendChild(left);

    const utilities = document.createElement("div");
    utilities.className = "calendar-ev-ticket-utilities";
    const likeHost = document.createElement("div");
    likeHost.className = "calendar-ev-like-host mz-inline-like-host";
    appendCalendarEventLikeRow(likeHost, ev);
    utilities.appendChild(likeHost);
    const gcalUrl = buildGoogleCalendarUrl(ev);
    if (gcalUrl) {
      const gcalBtn = document.createElement("a");
      gcalBtn.className = "calendar-ev-gcal-btn calendar-ev-ticket-icon-btn";
      gcalBtn.href = gcalUrl;
      gcalBtn.target = "_blank";
      gcalBtn.rel = "noopener noreferrer";
      gcalBtn.setAttribute("aria-label", "Googleカレンダーに登録");
      gcalBtn.title = "Googleカレンダーに登録";
      gcalBtn.innerHTML = '<i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>';
      utilities.appendChild(gcalBtn);
    }
    row.appendChild(utilities);

    const actions = document.createElement("div");
    actions.className = "calendar-ev-mll-log-actions";
    const btnState = resolveMarchinZLogBtnState(me, ev);
    const ctaBtn = document.createElement("button");
    ctaBtn.type = "button";
    ctaBtn.className = `calendar-ev-mll-log-save-btn calendar-ev-mll-log-save-btn--${btnState.variant}`;
    const ctaIcon = document.createElement("i");
    const ctaIconClass = btnState.variant === "view-log"
      ? "fa-solid fa-book-open"
      : btnState.variant === "note"
        ? "fa-solid fa-pen-to-square"
        : "fa-solid fa-calendar-check";
    ctaIcon.className = `mz-ui-icon ${ctaIconClass}`;
    ctaIcon.setAttribute("aria-hidden", "true");
    ctaBtn.appendChild(ctaIcon);
    ctaBtn.appendChild(document.createTextNode(btnState.label));
    ctaBtn.setAttribute("aria-label", btnState.label);
    ctaBtn.addEventListener("click", () => {
      const user = getUser();
      const state = resolveMarchinZLogBtnState(user, ev);
      if (state.action === "auth") {
        window.MarchinZNavigateAuthEntry?.("signup", "events_mll_log");
        return;
      }
      if (!user?.id) return;
      if (state.action === "attendance") {
        openAttendanceDialog(ev.id);
        return;
      }
      navigateToMyNote(ev, user);
    });
    actions.appendChild(ctaBtn);
    row.appendChild(actions);
    return row;
  }

  function openAttendanceDialog(eventId) {
    pendingAttEventId = String(eventId);
    if (!attOverlay || !attOptions) return;
    attOptions.innerHTML = "";
    for (const label of attendanceStyleOptions()) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "calendar-att-opt-btn";
      b.textContent = label;
      b.addEventListener("click", () => void saveMyAttendance(label));
      attOptions.appendChild(b);
    }
    attOverlay.hidden = false;
    attOverlay.setAttribute("aria-hidden", "false");
  }

  function closeAttendance() {
    if (!attOverlay) return;
    attOverlay.hidden = true;
    attOverlay.setAttribute("aria-hidden", "true");
    pendingAttEventId = "";
  }

  function attendanceStyleToRole(style) {
    const R = mllRoleApi();
    if (R) return R.attendanceJaToRole(style);
    const s = String(style || "").trim();
    if (s === "出演") return "perform";
    if (s === "チームスタッフ") return "team_staff";
    if (s === "運営" || s === "スタッフ/運営" || s === "スタッフ・運営") return "ops";
    return "watch";
  }

  async function saveMyAttendance(style) {
    const me = getUser();
    const db = getDb();
    if (!me?.id || !db || !pendingAttEventId) return;
    const ev = eventsCache.find((e) => String(e.id) === pendingAttEventId);
    if (!ev) return;
    const R = mllRoleApi();
    const fsStyle = R?.attendanceLabelToFirestoreStyle
      ? R.attendanceLabelToFirestoreStyle(style)
      : String(style || "").trim();
    const pv = R?.firestoreStyleToParticipationValue
      ? R.firestoreStyleToParticipationValue(fsStyle)
      : "";
    if (!pv || !R?.syncUserInvolvementForCalendar) {
      setFormMsg("あなたの関わり方を記録できませんでした。", true);
      return;
    }
    try {
      await R.syncUserInvolvementForCalendar(db, me, pendingAttEventId, ev, pv);
    } catch (e) {
      console.warn("[saveMyAttendance]", e);
      const code = String(e?.code || "");
      const indexHint =
        code === "failed-precondition"
          ? " Firestore の複合インデックスが未反映の可能性があります。`firebase deploy --only firestore:indexes` 後、数分お待ちください。"
          : "";
      setFormMsg(
        `MarchinZ Log への反映に失敗しました。${indexHint}（${String(e?.message || e)}）`,
        true,
      );
      return;
    }
    closeAttendance();
    await loadEventsAndAttendees();
    window.dispatchEvent(new CustomEvent("marchinz-mll-updated", { detail: { userId: me.id } }));
  }

  function normUrl(raw) {
    const s = String(raw || "").trim();
    return s;
  }

  function isEditDialogLoadStale(loadGen, evId) {
    return loadGen !== editDialogLoadGen || pendingEditEventId !== evId;
  }

  function setEditDialogBusy(busy) {
    if (editSaveBtn) editSaveBtn.disabled = busy;
    if (editDeleteBtn) editDeleteBtn.disabled = busy;
  }

  function closeCalendarEventOverflowMenus() {
    document.querySelectorAll(".community-post-overflow[open]").forEach((el) => {
      el.removeAttribute("open");
    });
    document.querySelectorAll("details.community-post-overflow").forEach((el) => {
      if (el instanceof HTMLDetailsElement) el.open = false;
    });
  }

  async function openEditDialog(ev) {
    if (!canManageEvent(ev) || !editOverlay || !editDate || !editTitle) return;
    closeCalendarEventOverflowMenus();
    hideRegisterSuccessToast();
    setEditMsg("");   // 前回の編集で出したエラーを持ち越さない
    const me = getUser();
    if (
      ev.created_by &&
      profileMini(ev.created_by).withdrawn &&
      me?.id === ev.created_by &&
      !isSiteAdmin()
    ) {
      setFormMsg("退会済みのアカウントでは編集できません。", true);
      return;
    }
    const loadGen = ++editDialogLoadGen;
    const evId = String(ev.id);
    pendingEditEventId = evId;
    setEditDialogBusy(true);

    editDate.value = ev.date || "";
    editTitle.value = ev.title || "";
    if (editDateEnd) editDateEnd.value = ev.end_date || "";
    if (editVenueName) editVenueName.value = ev.venue_name || "";
    if (editTime) editTime.value = ev.start_time || "";
    const v = ev.venue_pref || "";
    if (editVenue) {
      while (editVenue.querySelector("[data-legacy-fallback=\"1\"]")) {
        editVenue.querySelector("[data-legacy-fallback=\"1\"]")?.remove();
      }
      if (JP_PREFS.includes(v)) {
        editVenue.value = v;
      } else if (v) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = `(以前の登録: ${v})`;
        opt.setAttribute("data-legacy-fallback", "1");
        editVenue.appendChild(opt);
        editVenue.value = v;
      } else {
        editVenue.value = "";
      }
    }
    if (editUrl) editUrl.value = ev.event_url || "";

    const editKind = document.getElementById("calendar-edit-kind");
    if (editKind) {
      const k = String(ev.kind || "").trim();
      editKind.value = CALENDAR_KIND_CREATE_OPTIONS.includes(k) ? k : "イベント";
    }

    if (editHint) {
      const adminOther =
        isSiteAdmin() && getUser()?.id !== ev.created_by
          ? "管理人として編集・削除できます。"
          : "";
      editHint.textContent = adminOther;
      editHint.hidden = !adminOther;
    }

    let involvementValue = "";
    try {
      const db = getDb();
      const R = mllRoleApi();
      if (me?.id && db && R?.resolveUserInvolvementForEvent) {
        const am = attendeesByEvent.get(ev.id);
        const resolved = await R.resolveUserInvolvementForEvent(db, me.id, ev, am?.get(me.id));
        if (isEditDialogLoadStale(loadGen, evId)) return;
        involvementValue = resolved?.participationValue || "";
      } else {
        const p = ev.participation_format || "";
        involvementValue = p && p !== "未定" ? p : "";
      }
      if (isEditDialogLoadStale(loadGen, evId)) return;
      if (editParticipation) {
        fillMllParticipationSelect(editParticipation, involvementValue);
      }
      if (isEditDialogLoadStale(loadGen, evId)) return;
      editOverlay.hidden = false;
      editOverlay.setAttribute("aria-hidden", "false");
      syncRegisterBodyModalLock();
    } finally {
      if (!isEditDialogLoadStale(loadGen, evId)) {
        setEditDialogBusy(false);
      }
    }
  }

  function closeEditDialog() {
    if (!editOverlay) return;
    editDialogLoadGen += 1;
    editOverlay.hidden = true;
    editOverlay.setAttribute("aria-hidden", "true");
    syncRegisterBodyModalLock();
    pendingEditEventId = "";
    setEditDialogBusy(false);
    if (editVenue) {
      [...editVenue.querySelectorAll("option[data-legacy-fallback=\"1\"]")].forEach((x) => x.remove());
    }
  }

  async function saveEditedEvent() {
    const db = getDb();
    const user = getUser();
    if (!db || !user?.id || !pendingEditEventId || !editDate || !editTitle) return;
    const ev = eventsCache.find((x) => x.id === pendingEditEventId);
    if (!ev || !canManageEvent(ev)) return;
    const date = editDate.value;
    const title = editTitle.value.trim();
    const venue_pref = editVenue ? String(editVenue.value || "").trim() : "";
    const event_url = normUrl(editUrl?.value ?? "");
    const participation_format = resolveParticipationForFirestore(editParticipation?.value);
    const editKindEl = document.getElementById("calendar-edit-kind");
    const nextKind = editKindEl ? String(editKindEl.value || "").trim() : "";
    /* ★ 複数日の登録はやめた(2026-08-04 優さん指示)ので、入力欄は無い。
       ただし**すでに複数日で登録されているイベント**は残っている ─
       欄が無いからと "" を書くと、編集しただけで終了日が黙って消える。
       欄があればそれを、無ければ**いまの値をそのまま**引き継ぐ */
    let end_date = editDateEnd
      ? String(editDateEnd.value || "").trim()
      : String(ev.end_date || "").trim();
    /* ★ 引き継いだ終了日が開催日に追い越されたら、黙って1日だけにする
       (2026-08-04 レビュー)。欄を消した以上、下の検証に落とすと詰む ─
         ・「終了日は開催日より後に」と言われるが、その欄は画面に無い
         ・「1日だけなら空欄でOK」と言われるが、空欄にする操作が無い
         ・しかもこの文の出し先は登録フォーム側で、編集中は隠れている
           ＝ 押しても何も起きない
       複数日は「残っているものは守るが、積極的には維持しない」が筋。
       ★ 消すのは引き継いだ値だけ。欄がある間(将来また出す場合)は
         人が入れた値なので、従来どおり検証で止める */
    if (!editDateEnd && end_date && end_date <= date) end_date = "";
    const venue_name = String(editVenueName?.value || "").trim().slice(0, 120);
    const start_time = String(editTime?.value || "").trim();
    if (!date || !title || !venue_pref || !CALENDAR_KIND_CREATE_OPTIONS.includes(nextKind)) {
      setEditMsg("開催日・種別・開催地・イベント名はすべて必須です。", true);
      return;
    }
    /* 開催日だけ後ろへずらすと終了日を追い越して「8/20〜8/10」になる。
       登録時と同じ検証を編集にも置く(2026-07-22 レビュー) */
    if (end_date && end_date <= date) {
      setEditMsg("終了日は開催日より後の日付にしてください（1日だけなら空欄でOKです）。", true);
      return;
    }
    if (start_time && !/^\d{2}:\d{2}$/.test(start_time)) {
      setEditMsg("開演時間の形式が正しくありません。", true);
      return;
    }
    /** 運用で URL 長過ぎを防ぐ */
    if (event_url.length > 2000) {
      setEditMsg("URL が長すぎます。", true);
      return;
    }
    const patch = {
      date,
      title,
      venue_pref,
      event_url,
      participation_format,
      kind: nextKind,
      end_date,
      venue_name,
      start_time,
    };
    if (user.id === ev.created_by && !profileMini(ev.created_by).withdrawn) {
      patch.creator_display_name = displayNameFromUser(user);
      patch.creator_avatar_url = String(user.user_metadata?.avatar_url || "").trim();
    }

    try {
      if (editSaveBtn) editSaveBtn.disabled = true;
      await db.collection("mll_calendar_events").doc(pendingEditEventId).update(patch);
      const mergedEv = { ...ev, ...patch, id: pendingEditEventId };
      const pfRaw = String(editParticipation?.value || "").trim();
      if (pfRaw && mllRoleApi()?.syncUserInvolvementForCalendar) {
        await mllRoleApi().syncUserInvolvementForCalendar(db, user, pendingEditEventId, mergedEv, pfRaw);
      }
      closeEditDialog();
      await loadEventsAndAttendees();
      showRegisterSuccessToast("保存しました。");
      if (pfRaw) {
        window.dispatchEvent(new CustomEvent("marchinz-mll-updated", { detail: { userId: user.id } }));
      }
    } catch (e) {
      console.warn(e);
      setEditMsg(String(e?.message || "更新に失敗しました。"), true);
    } finally {
      if (editSaveBtn) editSaveBtn.disabled = false;
    }
  }

  /**
   * @param {import('./calendar-events.js').CalendarEventRow | Record<string, unknown>} ev
   * @param {{ closeEditAfter?: boolean }} [opts]
   */
  async function deleteCalendarEventRecord(ev, opts = {}) {
    const db = getDb();
    const user = getUser();
    const evId = String(ev?.id || "").trim();
    if (!db || !user?.id || !evId) return false;
    if (!canManageEvent(ev)) return false;
    if (
      !window.confirm(
        `「${String(ev.title || "").slice(0, 80)}」を削除しますか？\n\n掲示はゴミ箱へ移動します（運営が復元できる場合があります）。\nあなたの MarchinZ Log は削除されます。他人の Log は残ります。\n\nこの操作は取り消せません。`,
      )
    ) {
      return false;
    }
    const ref = db.collection("mll_calendar_events").doc(evId);
    try {
      if (editDeleteBtn) editDeleteBtn.disabled = true;
      let logsDeleted = 0;
      const R = mllRoleApi();
      if (R?.deleteUserLogsForCalendar) {
        logsDeleted = await R.deleteUserLogsForCalendar(db, user.id, evId, {
          date: ev.date,
          title: ev.title,
          venue_pref: ev.venue_pref,
        });
      }
      await ref.update({
        status: "trashed",
        trashed_at: new Date().toISOString(),
        trashed_by: user.id,
      });
      const eventKind = String(ev.kind || "イベント").trim() || "イベント";
      window.MarchinZAdminUgcLog?.recordEvent?.({
        action: "delete",
        eventKind,
        eventDate: String(ev.date || "").trim(),
        eventName: String(ev.title || "").trim() || "イベント",
        eventId: evId,
        actorUid: user.id,
        actorName: displayNameFromUser(user),
      });
      if (logsDeleted > 0) {
        setFormMsg(
          `イベントをゴミ箱へ移動しました。あなたの MarchinZ Log を ${logsDeleted} 件削除しました。`,
        );
        window.dispatchEvent(new CustomEvent("marchinz-mll-updated", { detail: { userId: user.id } }));
      } else {
        setFormMsg(
          "イベントをゴミ箱へ移動しました。紐づく MarchinZ Log は見つかりませんでした。プロフィールの Log 一覧から手動で削除できます。",
        );
      }
      if (opts.closeEditAfter) closeEditDialog();
      await loadEventsAndAttendees();
      return true;
    } catch (e) {
      console.warn(e);
      setFormMsg(String(e?.message || "削除に失敗しました。"), true);
      return false;
    } finally {
      if (editDeleteBtn) editDeleteBtn.disabled = false;
    }
  }

  async function deleteEditedEvent() {
    if (!pendingEditEventId) return;
    const ev = eventsCache.find((x) => x.id === pendingEditEventId);
    if (!ev) return;
    await deleteCalendarEventRecord(ev, { closeEditAfter: true });
  }

  /** @param {Record<string, unknown>} ev */
  function buildCalendarEventOverflow(ev) {
    const items = [
      {
        label: "編集する",
        variant: "default",
        onClick: () => void openEditDialog(ev),
      },
      /* ★ 複数日の登録をやめたぶんの受け皿(2026-08-04 優さん指示)。
         2日目・3日目は「1日目をコピーして日付だけ変える」で作る。
         並びは 編集する → コピーして作成 → 削除する ─ 危ないものを端に置く */
      {
        label: "コピーして作成",
        variant: "default",
        onClick: () => void openRegisterFormWithCopy(ev),
      },
    ];
    if (isSiteAdmin()) {
      if (mergeSourceEventId === ev.id) {
        items.push({
          label: "統合元の選択を解除",
          variant: "default",
          onClick: () => clearMergeSource(),
        });
      } else {
        items.push({
          label: "統合元に指定",
          variant: "default",
          onClick: () => setMergeSource(ev),
        });
        if (mergeSourceEventId) {
          items.push({
            label: "ここへ統合",
            variant: "default",
            onClick: () => void mergeEventIntoTarget(ev),
          });
        }
      }
    }
    items.push({
      label: "削除する",
      variant: "danger",
      onClick: () => void deleteCalendarEventRecord(ev),
    });
    const Eu = window.MarchinZEngageUi;
    if (Eu?.buildActionOverflow) {
      return Eu.buildActionOverflow(items, {
        extraClass: "calendar-ev-overflow",
        panelBelow: true,
      });
    }
    const det = document.createElement("details");
    det.className =
      "community-post-overflow calendar-ev-overflow community-post-overflow--panel-below";
    const sum = document.createElement("summary");
    sum.className = "community-post-overflow-trigger";
    sum.setAttribute("aria-label", "その他の操作");
    sum.textContent = "⋯";
    const panel = document.createElement("div");
    panel.className = "community-post-overflow-panel";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "community-post-overflow-item" +
        (item.variant === "danger"
          ? " community-post-overflow-item--danger"
          : " community-post-overflow-item--neutral");
      btn.textContent = item.label;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        det.open = false;
        void item.onClick();
      });
      panel.appendChild(btn);
    }
    det.appendChild(sum);
    det.appendChild(panel);
    return det;
  }

  function prefillCreateFormFromEvent(ev) {
    if (!ev) return;
    registerFormExpanded = true;
    syncRegisterFormVisibility();
    if (inputDate) inputDate.value = String(ev.date || "").trim();
    if (inputTitle) inputTitle.value = String(ev.title || "").trim();
    if (selectVenue) {
      const v = String(ev.venue_pref || "").trim();
      if (JP_PREFS.includes(v)) selectVenue.value = v;
      else selectVenue.value = "";
    }
    if (inputUrl) inputUrl.value = String(ev.event_url || "").trim();
    /* ★ 会場名と開演時間も写す(2026-08-04 レビュー)。この関数は元々
       統合(merge)用に書かれていて、この2つが抜けていた。
       いまの用途は「同じ会場・同じ時間の2日目を作る」なので、
       いちばん写したい2項目が落ちていては、複数日欄を消したぶんの
       手間がそのまま戻ってくる */
    if (inputVenueName) inputVenueName.value = String(ev.venue_name || "").trim();
    if (inputTime) inputTime.value = String(ev.start_time || "").trim();
    const pf = String(ev.participation_format || "").trim();
    if (selectParticipation) fillMllParticipationSelect(selectParticipation, pf);
    if (selectKind) {
      const k = String(ev.kind || "").trim();
      selectKind.value = CALENDAR_KIND_CREATE_OPTIONS.includes(k) ? k : "";
    }
    /* 文言は呼び元(openRegisterFormWithCopy)が出す ─
       ここで書いても必ず上書きされる死んだ行だった */
  }

  /* YYYY-MM-DD の翌日。★UTCで数える ─ ローカル時刻の Date に
     "2026-08-04" を渡すと環境によっては前日の15:00として解釈され、
     +1日しても同じ日付が返る(月末・年末で特に出る)。
     形が違えば "" を返し、呼び元が元の日付を使う */
  function nextYmd(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
    if (!m) return "";
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (Number.isNaN(d.getTime())) return "";
    d.setUTCDate(d.getUTCDate() + 1);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }

  /* 3点リーダーの「コピーして作成」(2026-08-04 優さん指示)。
     複数日の登録をやめたぶん、2日目・3日目はここから作る。
     ★ 日付は翌日へ送る(2026-08-04 優さん指示)。この機能が置き換えたのは
       「複数日開催」なので、次に作るのは**翌日**であることがほとんど。
       違う日にしたい人はその場で直せる ─ 直す手間より、
       毎回同じ1日を送る手間のほうが多い。
     ★ 中身を入れる処理は prefillCreateFormFromEvent が既にあった(未使用)。
       新しく書かずにそれを使う ─ 同じことを2か所に書かない */
  function openRegisterFormWithCopy(ev) {
    if (!ev) return;
    prefillCreateFormFromEvent(ev);
    const next = nextYmd(ev.date);
    if (inputDate && next) inputDate.value = next;
    setFormMsg(
      next
        ? "コピーしました。日付は翌日にしています（変えられます）。"
        : "コピーしました。日付を確かめて保存してください。",
      false,
    );
    requestAnimationFrame(() => {
      try {
        form.scrollIntoView({ block: "start", behavior: "smooth" });
        if (inputDate) inputDate.focus({ preventScroll: true });
      } catch { /* 画面外でも落とさない */ }
    });
  }

  function setMergeSource(ev) {
    if (!ev?.id) return;
    mergeSourceEventId = String(ev.id);
    setFormMsg(`統合元を選択: 「${String(ev.title || "イベント").slice(0, 60)}」`, false);
    renderCurrentView();
  }

  function clearMergeSource() {
    mergeSourceEventId = "";
    setFormMsg("統合元の選択を解除しました。", false);
    renderCurrentView();
  }

  /**
   * 統合元カレンダー行と同一キー（開催日・イベント名・開催地）の MarchinZ Log を統合先の情報へ書き換え。
   * @returns {Promise<number>} 更新したログ件数
   */
  async function rewriteMllLogsForMergedCalendar(db, sourceEventId, sourceFields, targetEventId, targetFields) {
    const tgtDate = String(targetFields?.date || "").trim();
    const tgtTitle = String(targetFields?.title || "").trim().slice(0, 120);
    const tgtVenue = String(targetFields?.venue_pref || "").trim().slice(0, 48);
    const targetId = String(targetEventId || "").trim();
    if (!tgtDate || !tgtTitle || !tgtVenue || !targetId) return 0;

    const R = mllRoleApi();
    const docs = R?.collectLogsForCalendarSource
      ? await R.collectLogsForCalendarSource(db, sourceEventId, sourceFields)
      : [];

    const buildRl = window.MarchinZMllBuildRoleLabel;
    const updates = docs.map((doc) => {
      const x = doc.data || {};
      const role = R ? R.inferRoleFromLog(x) : attendanceStyleToRole(x.role);
      const roleLabel = R
        ? R.buildRoleLabel(role, tgtDate)
        : typeof buildRl === "function"
          ? buildRl(x.role, tgtDate)
          : String(x.role_label || "").trim() || "—";
      return {
        ref: doc.ref,
        payload: {
          event_date: tgtDate,
          event_name: tgtTitle,
          venue: tgtVenue,
          role,
          role_label: String(roleLabel).slice(0, 120),
          calendar_event_id: targetId,
        },
      };
    });

    const chunk = 400;
    for (let i = 0; i < updates.length; i += chunk) {
      const batch = db.batch();
      updates.slice(i, i + chunk).forEach(({ ref, payload }) => batch.update(ref, payload));
      await batch.commit();
    }
    return updates.length;
  }

  async function mergeEventIntoTarget(targetEv) {
    if (!isSiteAdmin()) return;
    const db = getDb();
    const sourceId = String(mergeSourceEventId || "").trim();
    const targetId = String(targetEv?.id || "").trim();
    if (!db || !sourceId || !targetId || sourceId === targetId) return;
    const sourceEv = eventsCache.find((x) => String(x.id) === sourceId);
    const targetTitle = String(targetEv?.title || "").trim() || "イベント";
    const sourceTitle = String(sourceEv?.title || "").trim() || "イベント";
    const R = mllRoleApi();
    let preview = { rewriteCount: 0, dupUsers: 0, dupDeletes: 0, attendeeMove: 0, noteMove: 0, noteCount: 0 };
    if (R?.countCalendarMergePreviewOps) {
      try {
        preview = await R.countCalendarMergePreviewOps(
          db,
          sourceId,
          { date: sourceEv?.date, title: sourceEv?.title, venue_pref: sourceEv?.venue_pref },
          targetId,
          { date: targetEv?.date, title: targetEv?.title, venue_pref: targetEv?.venue_pref },
        );
      } catch (e) {
        console.warn("[calendar-events] merge preview", e);
      }
    } else if (R?.countCalendarMergeLogOps) {
      try {
        preview = await R.countCalendarMergeLogOps(
          db,
          sourceId,
          { date: sourceEv?.date, title: sourceEv?.title, venue_pref: sourceEv?.venue_pref },
          targetId,
          { date: targetEv?.date, title: targetEv?.title, venue_pref: targetEv?.venue_pref },
        );
      } catch (e) {
        console.warn("[calendar-events] merge preview", e);
      }
    }
    const previewLines = [
      preview.rewriteCount > 0 ? `・MarchinZ Log を ${preview.rewriteCount} 件、統合先の開催情報へ更新` : "",
      preview.dupDeletes > 0
        ? `・統合先で同一ユーザーの重複 Log を ${preview.dupDeletes} 件削除（${preview.dupUsers} ユーザー）`
        : "",
      preview.attendeeMove > 0 ? `・参加登録（attendees）を ${preview.attendeeMove} 件、統合先へコピー` : "",
      preview.noteMove > 0 ? `・MarchinZ Note を ${preview.noteMove} 件、統合先へ移動` : "",
      preview.noteCount > 0 && preview.noteMove === 0 && preview.noteDiscardSource > 0
        ? `・MarchinZ Note ${preview.noteCount} 件は統合先の方が新しいため統合元のみ削除`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const hasAnyOps =
      preview.rewriteCount > 0 ||
      preview.dupDeletes > 0 ||
      preview.attendeeMove > 0 ||
      preview.noteMove > 0 ||
      (preview.noteCount > 0 && preview.noteDiscardSource > 0);
    if (
      !window.confirm(
        `「${sourceTitle}」を「${targetTitle}」へ統合しますか？\n\n統合元のカードは削除されます。${previewLines ? `\n${previewLines}` : hasAnyOps ? "" : "\n（Log / Note / 参加登録の移行対象は見つかりませんでした）"}`,
      )
    ) {
      return;
    }
    try {
      const sourceRef = db.collection("mll_calendar_events").doc(sourceId);
      const targetRef = db.collection("mll_calendar_events").doc(targetId);
      const [sourceSnap, targetSnap, sourceAttSnap, targetAttSnap] = await Promise.all([
        sourceRef.get(),
        targetRef.get(),
        sourceRef.collection("attendees").get(),
        targetRef.collection("attendees").get(),
      ]);
      if (!sourceSnap.exists || !targetSnap.exists) {
        setFormMsg("統合対象のイベントが見つかりません。再読み込み後にやり直してください。", true);
        return;
      }
      const srcData = sourceSnap.data() || {};
      const tgtData = targetSnap.data() || {};

      const targetAttMap = new Map();
      targetAttSnap.forEach((d) => targetAttMap.set(d.id, d.data() || {}));
      let attendeesCopied = 0;
      try {
        for (const d of sourceAttSnap.docs) {
          if (!targetAttMap.has(d.id)) {
            await targetRef.collection("attendees").doc(d.id).set(d.data() || {}, { merge: true });
            attendeesCopied += 1;
          }
        }
      } catch (attErr) {
        console.warn(attErr);
        setFormMsg(
          String(
            attErr?.message ||
              "参加登録（attendees）のコピーに失敗したため、統合を中止しました。Firestore ルールのデプロイを確認してください。",
          ),
          true,
        );
        return;
      }

      let logRewritten = 0;
      let logRowMerge = { deleted: 0, merged: 0 };
      let noteMerge = { moved: 0, deleted: 0, keptTarget: 0 };
      try {
        logRewritten = await rewriteMllLogsForMergedCalendar(db, sourceId, srcData, targetId, tgtData);
        if (R?.mergeDuplicateUserLogsOnCalendar) {
          logRowMerge = await R.mergeDuplicateUserLogsOnCalendar(db, targetId, tgtData);
        }
        if (R?.mergeEventLogDiariesForCalendarMerge) {
          noteMerge = await R.mergeEventLogDiariesForCalendarMerge(db, sourceId, targetId, tgtData);
        }
      } catch (logErr) {
        console.warn(logErr);
        setFormMsg(
          String(
            logErr?.message ||
              "MarchinZ Log / Note の更新に失敗したため、統合を中止しました。Firestore ルールのデプロイと、mll_privileged_uids に運営 UID が登録されているか確認してください。",
          ),
          true,
        );
        return;
      }

      const srcLiked = normalizeLikedBy(srcData.liked_by);
      const tgtLiked = normalizeLikedBy(tgtData.liked_by);
      const mergedLiked = { ...tgtLiked, ...srcLiked };
      await targetRef.set({ liked_by: mergedLiked }, { merge: true });

      for (const d of sourceAttSnap.docs) {
        await sourceRef.collection("attendees").doc(d.id).delete();
      }

      await sourceRef.delete();
      mergeSourceEventId = "";
      const parts = [];
      if (logRewritten > 0) parts.push(`Log ${logRewritten} 件を統合先の開催情報へ更新`);
      if (logRowMerge.deleted > 0) {
        parts.push(`重複 Log ${logRowMerge.deleted} 件を削除（${logRowMerge.merged} ユーザー）`);
      }
      if (attendeesCopied > 0) parts.push(`参加登録 ${attendeesCopied} 件を統合先へコピー`);
      if (noteMerge.moved > 0) parts.push(`Note ${noteMerge.moved} 件を統合先へ移動`);
      if (noteMerge.keptTarget > 0) {
        parts.push(`Note ${noteMerge.keptTarget} 件は統合先を維持（統合元のみ削除）`);
      }
      if (parts.length) {
        setFormMsg(`イベントを統合しました。${parts.join("。")}。`, false);
      } else {
        setFormMsg("イベントを統合しました。", false);
      }
      await loadEventsAndAttendees();
      window.dispatchEvent(new CustomEvent("marchinz-mll-updated"));
    } catch (e) {
      console.warn(e);
      setFormMsg(String(e?.message || "イベント統合に失敗しました。"), true);
    }
  }

  async function clearMyAttendance() {
    const me = getUser();
    const db = getDb();
    if (!me?.id || !db || !pendingAttEventId) return;
    const ev = eventsCache.find((x) => x.id === pendingAttEventId);
    const evLabel = String(ev?.title || "このイベント").trim().slice(0, 80) || "このイベント";
    const ok = window.confirm(
      `「${evLabel}」の MarchinZ Log を取り消します。\n\n` +
        "MarchinZ Note は残ります。Note も消す場合はマイページの MarchinZ Note から削除してください。\n\n" +
        "よろしいですか？",
    );
    if (!ok) return;
    const R = mllRoleApi();
    if (!R?.clearCommunityAttendanceForEvent) {
      setFormMsg("参加解除の準備ができていません。ページを再読み込みしてください。", true);
      return;
    }
    try {
      await R.clearCommunityAttendanceForEvent(db, me.id, {
        eventId: pendingAttEventId,
        eventDate: ev?.date,
        eventName: ev?.title,
        venue_pref: ev?.venue_pref,
      });
      window.dispatchEvent(new CustomEvent("marchinz-mll-updated", { detail: { userId: me.id } }));
    } catch (e) {
      console.warn(e);
      setFormMsg(String(e?.message || "解除に失敗しました"), true);
      return;
    }
    closeAttendance();
    await loadEventsAndAttendees();
  }

  function renderList() {
    syncSortBar();
    syncKindTabs();
    listEl.innerHTML = "";
    listEl.className = "mll-log-list calendar-ev-list calendar-ev-list-root";
    const rows = dedupeCalendarRows(filteredSorted());
    if (!rows.length) {
      renderCalendarYearReel([]);
      const empty = document.createElement("p");
      empty.className = "calendar-ev-empty-msg";
      empty.textContent = "該当するイベントはまだありません。";
      listEl.appendChild(empty);
      return;
    }

    const years = collectEventYears(rows);
    renderCalendarYearReel(years);
    const me = getUser();

    for (const y of years) {
      const yearRows = rowsForEventYear(rows, y);
      const sec = createCalendarYearSection(y, yearRows);
      const ul = document.createElement("ul");
      ul.className = "mll-log-list calendar-ev-year-cards";
      for (const ev of yearRows) {
        ul.appendChild(buildCalendarCardLi(ev, me));
      }
      sec.appendChild(ul);
      listEl.appendChild(sec);
    }

    const undated = rows.filter((ev) => !eventYearKey(ev));
    if (undated.length) {
      const sec = document.createElement("section");
      sec.className = "calendar-ev-year user-profile-mll-year";
      sec.id = "calendar-ev-year-unknown";
      const hdr = document.createElement("header");
      hdr.className = "user-profile-mll-year-hdr calendar-ev-year-hdr";
      const h3 = document.createElement("h3");
      h3.className = "user-profile-mll-year-title";
      h3.textContent = "日付未設定";
      hdr.appendChild(h3);
      sec.appendChild(hdr);
      const ul = document.createElement("ul");
      ul.className = "mll-log-list calendar-ev-year-cards";
      for (const ev of undated) {
        ul.appendChild(buildCalendarCardLi(ev, me));
      }
      sec.appendChild(ul);
      listEl.appendChild(sec);
    }

    applyCalendarEventHighlight();
    applyPendingFocus();   // 登録直後の注目を、描き直しのたびに付け直す
  }


  function closeRegisterForm(options = {}) {
    if (!registerFormExpanded && !options.forcePersist) return;
    if (!options.skipPersist) persistCalendarEventDraft(false);
    registerFormExpanded = false;
    syncRegisterFormVisibility();
    try {
      openRegisterBtn?.focus();
    } catch {
      //
    }
  }

  if (openRegisterBtn) {
    openRegisterBtn.addEventListener("click", () => toggleRegisterFormExpanded());
  }
  if (openRegisterFooterBtn) {
    openRegisterFooterBtn.addEventListener("click", () => toggleRegisterFormExpanded());
  }

  if (mllFormCloseBtn) {
    mllFormCloseBtn.addEventListener("click", () => {
      closeRegisterForm();
    });
  }

  document.querySelectorAll("[data-calendar-ev-compose-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeRegisterForm());
  });

  window.MarchinZSetEventsRegisterExpanded = (nextOpen) => {
    registerFormExpanded = Boolean(nextOpen);
    syncRegisterFormVisibility();
  };

  function syncKindTabs() {
    document.querySelectorAll("[data-cal-kind]").forEach((btn) => {
      const v = btn.getAttribute("data-cal-kind") || "";
      btn.setAttribute("aria-selected", String(v === kindTab));
    });
  }

  document.querySelectorAll("[data-cal-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      kindTab = btn.getAttribute("data-cal-kind") || "all";
      syncKindTabs();
      syncSortBar();
      renderCurrentView();
      if (registerFormExpanded) syncEventKindFromListTab();
    });
  });

  document.querySelectorAll("[data-cal-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-cal-sort") || "";
      if (k !== "year") return;
      sortDesc = !sortDesc;
      syncSortBar();
      renderCurrentView();
    });
  });

  if (venueFilterBtn) {
    venueFilterBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleVenueFilterMenu();
    });
  }
  if (yearFilterBtn) {
    yearFilterBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleYearFilterMenu();
    });
  }
  document.addEventListener("click", (e) => {
    if (!venueFilterMenuOpen && !yearFilterMenuOpen) return;
    const t = e.target;
    if (
      venueFilterBtn?.contains(t) ||
      venueFilterMenu?.contains(t) ||
      yearFilterBtn?.contains(t) ||
      yearFilterMenu?.contains(t)
    ) {
      return;
    }
    closeAllCalendarEvFilterMenus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (venueFilterMenuOpen || yearFilterMenuOpen)) {
      closeAllCalendarEvFilterMenus();
    }
  });

  const calendarViewEl = document.getElementById("calendar-event-calendar-view");
  const listWrapEl = document.querySelector(".calendar-ev-list-wrap");

  function setViewMode(mode) {
    viewMode = mode;
    try { localStorage.setItem("mz_cal_view", mode); } catch {}
  }

  function syncViewButtons() {
    document.querySelectorAll("[data-cal-view]").forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.getAttribute("data-cal-view") === viewMode));
    });
  }

  function syncRegisterFooterVisibility() {
    if (!registerFooterEl) return;
    const show = viewMode === "card";
    registerFooterEl.hidden = !show;
    registerFooterEl.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function toggleRegisterFormExpanded() {
    if (isAuthRedirectPending()) return;
    if (!registerFormExpanded) hideRegisterSuccessToast();
    registerFormExpanded = !registerFormExpanded;
    syncRegisterFormVisibility();
  }

  function renderCurrentView() {
    window.MarchinZEventMap?.refresh(
      eventsCache.map((ev) => {
        // 吹き出しの参加予定者アイコン用: 公開 Log 参加者のアバターURL(カードの顔アイコンと同じ集合)
        const faceUids = getMllPublicFaceUids(ev);
        return {
          id: ev.id,
          kind: ev.kind,
          date: ev.date,
          title: ev.title,
          venue_pref: ev.venue_pref,
          faces: faceUids.slice(0, 8).map((uid) => profileMini(uid).avatar || ""),
          faces_total: faceUids.length,
        };
      }),
    );
    const controlsRow = document.querySelector(".calendar-ev-controls-row");
    const yearReel = document.getElementById("calendar-ev-year-reel");
    listWrapEl?.classList.toggle("calendar-ev-list-wrap--calendar-mode", viewMode === "calendar");
    if (viewMode === "calendar") {
      listEl.innerHTML = "";
      listEl.hidden = true;
      listEl.setAttribute("aria-hidden", "true");
      if (yearReel) {
        yearReel.hidden = true;
        yearReel.replaceChildren();
      }
      teardownCalendarYearReelObserver();
      if (calendarViewEl) {
        calendarViewEl.hidden = false;
        calendarViewEl.removeAttribute("aria-hidden");
      }
      if (controlsRow) controlsRow.hidden = true;
      renderCalendarView();
    } else {
      if (calendarViewEl) {
        calendarViewEl.hidden = true;
        calendarViewEl.setAttribute("aria-hidden", "true");
        calendarViewEl.innerHTML = "";
      }
      listEl.hidden = false;
      listEl.removeAttribute("aria-hidden");
      if (viewMode === "list") {
        if (controlsRow) controlsRow.hidden = true;
        renderCompactListView();
      } else {
        if (controlsRow) controlsRow.hidden = false;
        renderList();
      }
    }
    syncRegisterFooterVisibility();
  }

  function renderCompactListView() {
    syncSortBar();
    syncKindTabs();
    listEl.innerHTML = "";
    listEl.className = "calendar-ev-list calendar-ev-list-root";
    const rows = dedupeCalendarRows(filteredSorted());
    if (!rows.length) {
      renderCalendarYearReel([]);
      const empty = document.createElement("p");
      empty.className = "calendar-ev-empty-msg";
      empty.textContent = "該当するイベントはまだありません。";
      listEl.appendChild(empty);
      return;
    }

    const years = collectEventYears(rows);
    renderCalendarYearReel(years);

    for (const y of years) {
      const yearRows = rowsForEventYear(rows, y);
      const sec = createCalendarYearSection(y, yearRows);
      const ul = document.createElement("ul");
      ul.className = "calendar-ev-list calendar-ev-list--compact calendar-ev-year-items";
      for (const ev of yearRows) {
        ul.appendChild(buildCalendarCompactRowLi(ev));
      }
      sec.appendChild(ul);
      listEl.appendChild(sec);
    }

    const undated = rows.filter((ev) => !eventYearKey(ev));
    if (undated.length) {
      const sec = document.createElement("section");
      sec.className = "calendar-ev-year user-profile-mll-year";
      sec.id = "calendar-ev-year-unknown";
      const hdr = document.createElement("header");
      hdr.className = "user-profile-mll-year-hdr calendar-ev-year-hdr";
      const h3 = document.createElement("h3");
      h3.className = "user-profile-mll-year-title";
      h3.textContent = "日付未設定";
      hdr.appendChild(h3);
      sec.appendChild(hdr);
      const ul = document.createElement("ul");
      ul.className = "calendar-ev-list calendar-ev-list--compact calendar-ev-year-items";
      for (const ev of undated) {
        ul.appendChild(buildCalendarCompactRowLi(ev));
      }
      sec.appendChild(ul);
      listEl.appendChild(sec);
    }
  }

  function openEventCardOverlay(ev) {
    const existing = document.getElementById("mz-event-card-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "mz-event-card-overlay";
    overlay.className = "mz-event-card-overlay";
    const closeOverlay = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeOverlay();
    });

    const inner = document.createElement("div");
    inner.className = "mz-event-card-overlay-inner";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "mz-event-card-overlay-close";
    closeBtn.textContent = "✕ 閉じる";
    closeBtn.addEventListener("click", closeOverlay);

    const onKey = (e) => {
      if (e.key === "Escape") closeOverlay();
    };
    document.addEventListener("keydown", onKey);

    const me = getUser();
    const card = buildCalendarCardLi(ev, me);
    const listWrap = document.createElement("ul");
    listWrap.className = "mll-log-list calendar-ev-year-cards calendar-ev-overlay-card-list";
    listWrap.appendChild(card);

    inner.appendChild(closeBtn);
    inner.appendChild(listWrap);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
  }

  function renderCalendarView() {
    if (!calendarViewEl) return;
    syncKindTabs();
    calendarViewEl.innerHTML = "";
    const nav = document.createElement("div");
    nav.className = "calendar-ev-cal-nav";
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "calendar-ev-cal-nav-btn";
    prevBtn.textContent = "◀";
    prevBtn.addEventListener("click", () => { calViewMonth--; if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; } renderCalendarView(); });
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "calendar-ev-cal-nav-btn";
    nextBtn.textContent = "▶";
    nextBtn.addEventListener("click", () => { calViewMonth++; if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; } renderCalendarView(); });
    const todayBtn = document.createElement("button");
    todayBtn.type = "button";
    todayBtn.className = "calendar-ev-cal-nav-btn calendar-ev-cal-nav-btn--today";
    todayBtn.textContent = "今日";
    todayBtn.addEventListener("click", () => { const n = new Date(); calViewYear = n.getFullYear(); calViewMonth = n.getMonth(); renderCalendarView(); });
    const monthLabel = document.createElement("span");
    monthLabel.className = "calendar-ev-cal-month-label";
    monthLabel.textContent = `${calViewYear}年 ${calViewMonth + 1}月`;
    nav.appendChild(prevBtn);
    nav.appendChild(monthLabel);
    nav.appendChild(todayBtn);
    nav.appendChild(nextBtn);
    calendarViewEl.appendChild(nav);

    const grid = document.createElement("div");
    grid.className = "calendar-ev-cal-grid";
    const DOW = ["月", "火", "水", "木", "金", "土", "日"];
    for (const d of DOW) {
      const h = document.createElement("div");
      h.className = "calendar-ev-cal-dow";
      h.textContent = d;
      grid.appendChild(h);
    }

    const firstDay = new Date(calViewYear, calViewMonth, 1);
    const startDow = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
    const todayStr2 = new Date().toISOString().slice(0, 10);

    const rows = dedupeCalendarRows(filteredSorted());
    const byDate = new Map();
    for (const ev of rows) {
      const d = String(ev.date || "").slice(0, 10);
      const m = d.slice(0, 7);
      const target = `${calViewYear}-${String(calViewMonth + 1).padStart(2, "0")}`;
      if (m === target) {
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d).push(ev);
      }
    }

    const weekMaxEv = [];
    let calSlot = 0;

    for (let i = 0; i < startDow; i++) {
      const empty = document.createElement("div");
      empty.className = "calendar-ev-cal-cell calendar-ev-cal-cell--empty";
      empty.dataset.calSlot = String(calSlot);
      calSlot += 1;
      grid.appendChild(empty);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("div");
      const dateStr = `${calViewYear}-${String(calViewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cell.className = "calendar-ev-cal-cell";
      cell.dataset.calSlot = String(calSlot);
      if (dateStr === todayStr2) cell.classList.add("calendar-ev-cal-cell--today");
      const num = document.createElement("span");
      num.className = "calendar-ev-cal-day-num";
      num.textContent = String(day);
      cell.appendChild(num);
      const evs = byDate.get(dateStr) || [];
      for (const ev of evs.slice(0, 3)) {
        const chip = document.createElement("div");
        chip.className = `calendar-ev-cal-chip calendar-ev-cal-chip--${kindSlugForCss(ev.kind)}`;
        const pref = String(ev.venue_pref || "").trim();
        const title = String(ev.title || "").trim();
        const label = title
          ? `${title}${pref ? ` / ${pref}` : ""}`
          : pref || "—";
        chip.textContent = label;
        chip.title = label;
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          openEventCardOverlay(ev);
        });
        cell.appendChild(chip);
      }
      if (evs.length > 3) {
        const more = document.createElement("span");
        more.className = "calendar-ev-cal-more";
        more.textContent = `+${evs.length - 3}`;
        cell.appendChild(more);
      }
      const rowCount = Math.min(evs.length, 3) + (evs.length > 3 ? 1 : 0);
      const weekIdx = Math.floor(calSlot / 7);
      weekMaxEv[weekIdx] = Math.max(weekMaxEv[weekIdx] || 0, rowCount);
      calSlot += 1;
      grid.appendChild(cell);
    }
    grid.querySelectorAll(".calendar-ev-cal-cell").forEach((cellEl) => {
      const slot = Number(cellEl.dataset.calSlot || 0);
      const weekIdx = Math.floor(slot / 7);
      const maxEv = weekMaxEv[weekIdx] || 0;
      if (maxEv > 0) cellEl.dataset.calWeekMax = String(maxEv);
    });
    calendarViewEl.appendChild(grid);
  }

  document.querySelectorAll("[data-cal-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setViewMode(btn.getAttribute("data-cal-view") || "list");
      syncViewButtons();
      renderCurrentView();
    });
  });

  const calEvSearchInput = document.getElementById("cal-ev-search");
  if (calEvSearchInput) {
    let searchTimer = null;
    calEvSearchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        eventSearchQuery = calEvSearchInput.value.trim();
        renderCurrentView();
      }, 250);
    });
  }

  syncKindTabs();
  syncViewButtons();
  const upcomingOnlyInput = document.getElementById("calendar-ev-upcoming-only");
  if (upcomingOnlyInput) {
    upcomingOnlyInput.checked = false;
    upcomingOnly = false;
    upcomingOnlyInput.addEventListener("change", () => {
      upcomingOnly = Boolean(upcomingOnlyInput.checked);
      syncSortBar();
      renderCurrentView();
    });
  }
  sortDesc = true;
  syncSortBar();

  /** 登録成功後: モーダルを閉じて一覧を更新し、ページ上に完了メッセージを表示 */
  /* 登録したイベントの場所まで一覧を送る(2026-08-04 優さん指示B)。
     ★ 見つからないときは一覧の先頭へ落とす ─ 種別タブや絞り込みの状態に
       よっては、いま登録したイベントがそもそも一覧に出ていない。
       そこで黙って何もしないと「登録できたのか分からない」に戻る。
     既存の applyCalendarEventHighlight とは別に持つ ─ あちらは
     sessionStorage 経由で他ページから来た人のためのもので、
     見つからないときは何もしないのが正しい(戻し先が無いため) */
  /* ★ 1回だけ付けると、自分の再描画で消える(2026-08-04 レビュー)。
     「関わり方」を選んで登録すると marchinz-mll-updated が飛び、
     受け手がもう一度 loadEventsAndAttendees() を走らせて
     listEl.innerHTML = "" で作り直す ─ ハイライトを付けた行ごと捨てられる。
     結果「関わり方を選んだ人だけ一瞬で消える」という分かりにくい差になる。
     → 期限つきの予約にして、描き直しのたびに付け直す。
       スクロールは1回だけ(何度も動かすと酔う) */
  let pendingFocus = null;   // {id, until, scrolled}
  function focusCalendarEventOrList(eventId, timeoutMs = 2500) {
    pendingFocus = { id: String(eventId || ""), until: Date.now() + timeoutMs, scrolled: false };
    applyPendingFocus();
  }
  function applyPendingFocus() {
    const pf = pendingFocus;
    if (!pf) return;
    if (Date.now() > pf.until) { pendingFocus = null; return; }
    requestAnimationFrame(() => {
      if (pendingFocus !== pf) return;   // 新しい予約に置き換わっていたら何もしない
      let row = null;
      try {
        row = pf.id ? listEl.querySelector(`[data-cal-event-id="${CSS.escape(pf.id)}"]`) : null;
      } catch { row = null; }
      if (row) {
        if (!pf.scrolled) { pf.scrolled = true; row.scrollIntoView({ block: "center", behavior: "smooth" }); }
        /* ★ 地図から着地したときの --highlight は #c62828(削除ボタンと同系の赤)。
           登録の成功にその赤を使うと「何か失敗した」に読める(2026-08-04 レビュー)。
           登録直後は専用のクラスにする */
        row.classList.add("calendar-ev-card--just-added");
        window.setTimeout(() => row.classList.remove("calendar-ev-card--just-added"), 4200);
        return;
      }
      /* 一覧に出ていない(絞り込み・開催年・検索語で外れている等) → 一覧の頭へ。
         ★ カレンダー表示では listEl が hidden で scrollIntoView が無音の空振りに
           なるので、包みの方へ送る */
      if (pf.scrolled) return;
      pf.scrolled = true;
      const to = (listEl && !listEl.hidden) ? listEl : (listWrapEl || listEl);
      try { to?.scrollIntoView({ block: "start", behavior: "smooth" }); } catch { /* 無視 */ }
    });
  }

  async function completeEventRegistrationAfterSave(user, pfRaw, eventId) {
    inputTitle.value = "";
    if (inputUrl) inputUrl.value = "";
    if (selectParticipation) selectParticipation.value = "";
    if (inputDateEnd) inputDateEnd.value = "";
    if (inputVenueName) inputVenueName.value = "";
    if (inputTime) inputTime.value = "";
    lastScrape = null;
    clearAutoMarks();
    clearCalendarEventDraft();
    closeRegisterForm({ skipPersist: true });
    await loadEventsAndAttendees();
    /* ★ お礼を言う(2026-08-04 優さん指示)。「登録しました。」は
       起きた事実を報告しているだけで、手間をかけた相手への言葉が無い。
       イベントは他の人のために登録してもらっているので、そこに触れる */
    /* ★ 固定表示の器へ載せる(2026-08-04 レビュー)。
       これまでの #calendar-ev-register-success はページ内の <p> で、
       直後に走る一覧へのスクロールに追い越されて画面の上へ消えていた
       ─ つまり感謝の言葉は、ほとんどの人に一度も読まれていなかった。
       ★ 文言は「みんなの役に立ちます」と言い切らない ─ まだ誰の役にも
         立っていない時点での断言は、運営の都合に聞こえる。
         登録された情報がこれから何をするかだけを言う */
    const cheer = window.MarchinZBase?.showCheer;
    if (typeof cheer === "function") {
      cheer("登録していただいたイベントは、これを探している人に届きます。", [], "ありがとうございます");
    } else {
      showRegisterSuccessToast("イベント登録ありがとうございます。");
    }
    focusCalendarEventOrList(eventId);
    if (pfRaw) {
      window.dispatchEvent(new CustomEvent("marchinz-mll-updated", { detail: { userId: user.id } }));
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = getUser();
    const db = getDb();
    if (!registerFormExpanded) return;
    if (!user?.id || !db) {
      window.MarchinZNavigateAuthEntry?.("signup", "events_submit");
      return;
    }
    if (window.MLL_AUTH?.isWithdrawn?.()) {
      setFormMsg("退会済みのアカウントではイベントを登録できません。", true);
      return;
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("event_create")) {
      setFormMsg("イベント登録の頻度が高すぎます。しばらく待ってから再度お試しください。", true);
      return;
    }
    const pfRaw = String(selectParticipation?.value || "").trim();
    const pf = resolveParticipationForFirestore(pfRaw);
    const date = inputDate.value;
    const title = inputTitle.value.trim();
    const venue_pref = selectVenue ? String(selectVenue.value || "").trim() : "";
    const event_url = normUrl(inputUrl?.value ?? "");
    const calendarKind = selectKind ? String(selectKind.value || "").trim() : "";
    const end_date = String(inputDateEnd?.value || "").trim();
    const venue_name = String(inputVenueName?.value || "").trim().slice(0, 120);
    const start_time = String(inputTime?.value || "").trim();

    if (!date || !title || !venue_pref || !CALENDAR_KIND_CREATE_OPTIONS.includes(calendarKind)) {
      setFormMsg("開催日・種別・開催地・イベント名はすべて必須です。", true);
      return;
    }
    if (event_url.length > 2000) {
      setFormMsg("URL が長すぎます。", true);
      return;
    }
    if (end_date && end_date <= date) {
      setFormMsg("終了日は開催日より後の日付にしてください（1日だけなら空欄でOKです）。", true);
      return;
    }
    if (start_time && !/^\d{2}:\d{2}$/.test(start_time)) {
      setFormMsg("開演時間の形式が正しくありません。", true);
      return;
    }

    const payload = {
      kind: calendarKind,
      date,
      title,
      venue_pref,
      event_url,
      end_date,
      venue_name,
      start_time,
      participation_format: pf,
      created_by: user.id,
      liked_by: {},
      creator_display_name: displayNameFromUser(user),
      creator_avatar_url: String(user.user_metadata?.avatar_url || "").trim(),
      created_at: new Date().toISOString(),
    };
    try {
      if (submitBtn) submitBtn.disabled = true;
      const docRef = await db.collection("mll_calendar_events").add(payload);
      window.MarchinZAdminUgcLog?.recordEvent?.({
        action: "create",
        eventKind: calendarKind,
        eventDate: date,
        eventName: title,
        eventId: docRef.id,
        actorUid: user.id,
        actorName: displayNameFromUser(user),
      });
      if (pfRaw && mllRoleApi()?.syncUserInvolvementForCalendar) {
        /* ★ 紙吹雪は出さない(2026-08-04 優さん指示)。この関数は一覧からの
           参加表明でも通るので、関数ごと消さずに**この経路だけ**黙らせる ─
           参加表明の紙吹雪は残す */
        await mllRoleApi().syncUserInvolvementForCalendar(
          db, user, docRef.id, { id: docRef.id, ...payload }, pfRaw, { confetti: false });
      }
      await completeEventRegistrationAfterSave(user, pfRaw, docRef.id);
      return;
    } catch (err) {
      console.warn(err);
      setFormMsg(String(err?.message || "登録に失敗しました。Firestore ルールを確認してください。"), true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  document.querySelectorAll("[data-calendar-participants-close]").forEach((el) => {
    el.addEventListener("click", closeParticipantsDialog);
  });

  document.querySelectorAll("[data-calendar-att-close]").forEach((el) => {
    el.addEventListener("click", closeAttendance);
  });

  if (attClearBtn) {
    attClearBtn.addEventListener("click", () => void clearMyAttendance());
  }

  document.querySelectorAll("[data-calendar-edit-close]").forEach((el) => {
    el.addEventListener("click", closeEditDialog);
  });

  if (editSaveBtn) {
    editSaveBtn.addEventListener("click", () => void saveEditedEvent());
  }
  if (editCancelBtn) {
    editCancelBtn.addEventListener("click", closeEditDialog);
  }
  if (editDeleteBtn) {
    editDeleteBtn.addEventListener("click", () => void deleteEditedEvent());
  }

  window.addEventListener("mll-auth-changed", async () => {
    if (!getUser()?.id) {
      registerFormExpanded = false;
      clearCalendarEventDraft();
    }
    syncRegisterFormVisibility();
    await loadEventsAndAttendees();
  });

  window.addEventListener("marchinz-like-show-changed", () => {
    void loadEventsAndAttendees();
  });

  let profileSavedReloadTimer = null;
  window.addEventListener("marchinz-profile-saved", () => {
    if (profileSavedReloadTimer) clearTimeout(profileSavedReloadTimer);
    profileSavedReloadTimer = setTimeout(() => {
      profileSavedReloadTimer = null;
      void loadEventsAndAttendees();
    }, 400);
  });

  window.MarchinZResetCalendarKindFilter = function () {
    kindTab = "all";
    syncKindTabs();
    syncSortBar();
    scrollCalendarEventTabStripsToStart();
    renderCurrentView();
    if (registerFormExpanded) syncEventKindFromListTab();
  };

  window.MarchinZCalendarEventDraft = {
    onLeaveEvents: onCalendarEventLeaveEvents,
    onEnterEvents: onCalendarEventEnterEvents,
  };

  /* ============ URLから自動入力(v2 2026-07-22) ============
     v1.36の「仮入力」を大改修。読み取りエンジン(event-scrape v2)が
     期間・開演時間・会場名・日付候補まで返すようになったのに合わせる。
     - 自動で入れた欄には「自動」バッジ(利用者が触ると消える=手で確定した印)
     - 日付が複数見つかったら候補チップを出して人に選ばせる(勝手に決めない)
     - 2回目は「空欄にだけ」入れたうえで、全部入れ替えたい人向けの
       上書きリンクを出す */
  const autofillBtn = document.getElementById("calendar-ev-autofill");
  let lastScrape = null;

  /* 確信度で見せ方を変える。ページの構造化データから確実に取れたものと、
     本文からの当てずっぽうを同じ顔で出すと、推測が断定に見える
     (2026-07-22 レビュー)。読み上げ用に aria-label も添える */
  const AUTO_CONF = {
    high:  { text: "自動", cls: "mz-auto-chip--high",  note: "ページの情報から自動入力しました" },
    low:   { text: "自動・要確認", cls: "mz-auto-chip--low", note: "本文からの推測です。確認してください" },
    guess: { text: "推測", cls: "mz-auto-chip--guess", note: "手がかりが無いため仮に入れています。確認してください" },
  };
  function markAuto(el, conf) {
    if (!el) return;
    const c = AUTO_CONF[conf] || AUTO_CONF.low;
    el.classList.add("mz-auto-filled");
    el.classList.toggle("mz-auto-filled--weak", conf !== "high");
    const lab = el.closest("label");
    if (!lab) return;
    let chip = lab.querySelector(".mz-auto-chip");
    if (!chip) {
      chip = document.createElement("span");
      lab.insertBefore(chip, el);
    }
    chip.className = `mz-auto-chip ${c.cls}`;
    chip.textContent = c.text;
    chip.title = c.note;
    el.setAttribute("aria-describedby", el.id + "-autonote");
    let note = lab.querySelector(".mz-auto-note");
    if (!note) {
      note = document.createElement("span");
      note.className = "mz-auto-note mz-visually-hidden";
      lab.insertBefore(note, el);
    }
    note.id = el.id + "-autonote";
    note.textContent = c.note;
  }
  function unmarkAuto(el) {
    if (!el) return;
    el.classList.remove("mz-auto-filled", "mz-auto-filled--weak");
    el.removeAttribute("aria-describedby");
    const lab = el.closest("label");
    if (!lab) return;
    lab.querySelector(".mz-auto-chip")?.remove();
    lab.querySelector(".mz-auto-note")?.remove();
  }
  // 触ったら「自動」バッジを外す(そこから先は本人の入力として扱う)
  [inputTitle, inputDate, inputDateEnd, selectVenue, selectKind, inputVenueName, inputTime].forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => unmarkAuto(el));
  });

  function clearAutoMarks() {
    [inputTitle, inputDate, inputDateEnd, selectVenue, selectKind, inputVenueName, inputTime].forEach(unmarkAuto);
    if (dateCandidatesBox) { dateCandidatesBox.hidden = true; dateCandidatesBox.innerHTML = ""; }
  }

  function renderDateCandidates(dates, picked) {
    if (!dateCandidatesBox) return;
    if (!Array.isArray(dates) || dates.length < 2) {
      dateCandidatesBox.hidden = true;
      dateCandidatesBox.innerHTML = "";
      return;
    }
    dateCandidatesBox.hidden = false;
    dateCandidatesBox.setAttribute("role", "group");
    dateCandidatesBox.innerHTML = "";
    const lead = document.createElement("span");
    lead.className = "calendar-ev-date-candidates-lead";
    lead.textContent = "日付が複数見つかりました:";
    dateCandidatesBox.appendChild(lead);
    dates.forEach((d) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "calendar-ev-date-chip" + (d === picked ? " on" : "");
      b.setAttribute("aria-pressed", d === picked ? "true" : "false");   // 色だけで状態を伝えない
      b.textContent = d.replace(/-/g, "/");
      b.addEventListener("click", () => {
        if (inputDate) {
          inputDate.value = d;
          inputDate.dispatchEvent(new Event("change", { bubbles: true }));
          markAuto(inputDate);
        }
        // 選び直したら期間は一旦白紙(候補は別公演かもしれない)
        if (inputDateEnd && inputDateEnd.classList.contains("mz-auto-filled")) {
          inputDateEnd.value = "";
          unmarkAuto(inputDateEnd);
        }
        renderDateCandidates(dates, d);
      });
      dateCandidatesBox.appendChild(b);
    });
  }

  function applyScrape(data, { overwrite = false } = {}) {
    const filled = [];
    const conf = (data && data.confidence) || {};
    const fill = (el, value, label, key) => {
      if (!el || !value) return;
      if (!overwrite && String(el.value || "").trim()) return;
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true })); // 下書き保存と連動
      markAuto(el, conf[key || ""] || "low");
      filled.push(label);
    };
    fill(inputTitle, data.title, "イベント名", "title");
    fill(inputDate, data.date, "開催日", "date");
    // 終了日は「いま入っている開催日より後」のときだけ。候補で別公演を
    // 選んだ後に、前の公演の終了日が紛れ込むのを防ぐ
    const curDate = String(inputDate?.value || "").trim();
    if (data.end_date && (!curDate || data.end_date > curDate)) {
      fill(inputDateEnd, data.end_date, "終了日", "end_date");
    }
    if (data.pref && JP_PREFS.includes(data.pref)) fill(selectVenue, data.pref, "開催地", "pref");
    fill(inputVenueName, data.venue_name, "会場名", "venue_name");
    fill(inputTime, data.time, "開演時間", "time");
    fill(selectKind, data.kind, "種別", "kind");
    renderDateCandidates(data.dates, inputDate ? inputDate.value : "");
    return filled;
  }

  function showAutofillResult(filled, data) {
    if (filled.length) {
      const extra = Array.isArray(data.dates) && data.dates.length > 1
        ? " 日付は候補から選べます。"
        : "";
      const conf = data.confidence || {};
      const weak = Object.values(conf).some((v) => v === "low" || v === "guess");
      const caution = weak ? "「要確認」「推測」の印が付いた項目は、特にご確認ください。" : "";
      setFormMsg(`自動で入力しました（${filled.join("・")}）。内容を確認してから登録してください。${extra}${caution}`);
      return;
    }
    // 全部入力済みで何も入れなかった → 入れ替えの選択肢を出す
    setFormMsg("読み取れましたが、すでに入力済みのため変更していません。");
    if (!formMsg || formMsg.querySelector(".calendar-ev-overwrite-link")) return;
    const link = document.createElement("button");
    link.type = "button";
    link.className = "calendar-ev-overwrite-link";
    link.textContent = "読み取った内容で上書きする";
    link.addEventListener("click", () => {
      if (!lastScrape) return;
      clearAutoMarks();
      const f2 = applyScrape(lastScrape, { overwrite: true });
      setFormMsg(f2.length ? `上書きしました（${f2.join("・")}）。内容を確認してから登録してください。` : "上書きできる項目がありませんでした。");
    });
    formMsg.appendChild(link);
  }

  if (autofillBtn) {
    autofillBtn.addEventListener("click", async () => {
      const rawUrl = String(inputUrl?.value || "").trim();
      if (!rawUrl) {
        setFormMsg("先にURL欄へイベントページのURLを入れてください。", true);
        inputUrl?.focus();
        return;
      }
      autofillBtn.disabled = true;
      setFormMsg("ページを読み取っています…");
      try {
        const res = await fetch(`/.netlify/functions/event-scrape?url=${encodeURIComponent(rawUrl)}`);
        const data = await res.json().catch(() => null);
        if (!data || !data.ok) {
          setFormMsg((data && data.error) || "このページからは読み取れませんでした。お手数ですが手入力をお願いします。", true);
          return;
        }
        lastScrape = data;
        const filled = applyScrape(data);
        showAutofillResult(filled, data);
      } catch {
        setFormMsg("読み取りに失敗しました。通信環境を確認してもう一度お試しください。", true);
      } finally {
        autofillBtn.disabled = false;
      }
    });
  }

  const calendarDraftInputs = [inputDate, inputDateEnd, selectVenue, inputVenueName, inputTitle, inputUrl, inputTime, selectParticipation, selectKind];
  calendarDraftInputs.forEach((el) => {
    if (!el) return;
    el.addEventListener("input", scheduleCalendarEventDraftSave);
    el.addEventListener("change", scheduleCalendarEventDraftSave);
  });

  syncRegisterFormVisibility();
  syncRegisterFooterVisibility();
  window.addEventListener("marchinz-mll-updated", () => {
    void loadEventsAndAttendees();
  });

  function renderQaCalendarCardFixture() {
    const local = location.hostname === "127.0.0.1" || location.hostname === "localhost";
    if (!local || new URLSearchParams(location.search).get("mzQaCalendarCard") !== "1") return false;
    const me = { id: "qa-admin" };
    window.MLL_AUTH = {
      ...(window.MLL_AUTH || {}),
      getUser: () => me,
      getDb: () => null,
      isAdmin: () => true,
      getDisplayName: () => "QA管理者",
    };
    const qaEvent = {
      id: "qa-event-ticket",
      kind: "大会",
      date: "2027-01-11",
      title: "【中学/高校】マーチング祭AJCS 横浜FINAL 2026 中学/高校の部",
      venue_pref: "神奈川県",
      venue_name: "横浜BUNTAI",
      start_time: "14:00",
      event_url: "https://example.com/events/ajcs-final",
      created_by: me.id,
      liked_by: { "qa-face-1": true, "qa-face-2": true },
    };
    eventsCache = [qaEvent];
    profileCache.clear();
    [
      [me.id, "おこち"],
      ["qa-face-1", "参加者1"],
      ["qa-face-2", "参加者2"],
      ["qa-face-3", "参加者3"],
      ["qa-face-4", "参加者4"],
    ].forEach(([uid, name]) => {
      profileCache.set(uid, {
        display_name: name,
        avatar_url: "logo/marchinz-logo.png",
        withdrawn: false,
        profile_attributes: [],
        like_show_calendar: true,
        like_show_mll: true,
        section_vis_mll: "public",
      });
    });
    const publicUids = new Set(["qa-face-1", "qa-face-2", "qa-face-3", "qa-face-4"]);
    mllPublicUidsByEventId = new Map([[qaEvent.id, publicUids]]);
    attendeesByEvent.clear();
    attendeesByEvent.set(
      qaEvent.id,
      new Map([...publicUids].map((uid, i) => [uid, i % 2 ? "出演" : "観戦"])),
    );
    listEl.innerHTML = "";
    listEl.appendChild(buildCalendarCardLi(qaEvent, me));
    window.__MZQA_CALENDAR_CARD_READY = true;
    return true;
  }

  if (!renderQaCalendarCardFixture()) void loadEventsAndAttendees();
})();
