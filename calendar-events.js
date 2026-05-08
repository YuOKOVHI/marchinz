(() => {
  window.MarchinZEventsRegisterExpanded = false;

  /** 一覧に含める kind（過去データ互換あり）／新規登録は統一種別のみ使う */
  const VALID_KINDS = new Set(["イベント", "演奏会", "大会", "マーチング関連"]);
  const CREATE_KIND_UNIFIED = "マーチング関連";
  const ATTENDANCE_OPTIONS = ["出演", "チームスタッフ", "観戦", "スタッフ/運営"];
  /** イベント登録フォームでの「参加形式」 */
  const PARTICIPATION_OPTIONS = ["出演", "チームスタッフ", "観戦", "運営", "未定"];
  /** 北海道〜沖縄、最後に海外 */
  const JP_PREFS = [
    "北海道",
    "青森県",
    "岩手県",
    "宮城県",
    "秋田県",
    "山形県",
    "福島県",
    "茨城県",
    "栃木県",
    "群馬県",
    "埼玉県",
    "千葉県",
    "東京都",
    "神奈川県",
    "新潟県",
    "富山県",
    "石川県",
    "福井県",
    "山梨県",
    "長野県",
    "岐阜県",
    "静岡県",
    "愛知県",
    "三重県",
    "滋賀県",
    "京都府",
    "大阪府",
    "兵庫県",
    "奈良県",
    "和歌山県",
    "鳥取県",
    "島根県",
    "岡山県",
    "広島県",
    "山口県",
    "徳島県",
    "香川県",
    "愛媛県",
    "高知県",
    "福岡県",
    "佐賀県",
    "長崎県",
    "熊本県",
    "大分県",
    "宮崎県",
    "鹿児島県",
    "沖縄県",
    "海外",
  ];

  const UNKNOWN = "ユーザー";
  const WITHDRAWN_NAME = "退会ユーザー";

  const openRegisterBtn = document.getElementById("calendar-ev-open-register");
  const form = document.getElementById("calendar-event-form");
  const formBody = document.getElementById("calendar-ev-form-body");
  const inputDate = document.getElementById("calendar-ev-date");
  const selectVenue = document.getElementById("calendar-ev-venue");
  const inputTitle = document.getElementById("calendar-ev-title");
  const inputUrl = document.getElementById("calendar-ev-url");
  const selectParticipation = document.getElementById("calendar-ev-participation");
  const formMsg = document.getElementById("calendar-ev-form-msg");
  const listEl = document.getElementById("calendar-event-list");
  const listHeading = document.getElementById("calendar-ev-list-heading");
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
  const editParticipation = document.getElementById("calendar-edit-participation");
  const editHint = document.getElementById("calendar-edit-hint");
  const editSaveBtn = document.getElementById("calendar-edit-save");
  const editDeleteBtn = document.getElementById("calendar-edit-delete");

  if (!form || !inputDate || !inputTitle || !listEl) return;

  function fillPrefectureSelect(sel) {
    if (!sel || sel.dataset.mzPrefFilled === "1") return;
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "都道府県を選択";
    sel.appendChild(ph);
    for (const p of JP_PREFS) {
      const o = document.createElement("option");
      o.value = p;
      o.textContent = p;
      sel.appendChild(o);
    }
    sel.dataset.mzPrefFilled = "1";
  }
  fillPrefectureSelect(selectVenue);
  fillPrefectureSelect(editVenue);

  let timeTab = "upcoming";
  let eventsCache = [];
  const attendeesByEvent = new Map();
  const profileCache = new Map();

  let pendingAttEventId = "";
  let pendingEditEventId = "";
  /** イベント登録フォームの開閉（ログイン済みのみ開く） */
  let registerFormExpanded = false;

  function getUser() {
    return window.MLL_AUTH?.getUser?.() || null;
  }

  function getDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function isSiteAdmin() {
    return Boolean(window.MLL_AUTH?.isAdmin?.());
  }

  function canManageEvent(ev) {
    const me = getUser();
    if (!me?.id || !ev) return false;
    if (ev.created_by && ev.created_by === me.id) return true;
    return isSiteAdmin();
  }

  function displayNameFromUser(user) {
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

  function todayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function setFormMsg(text, isErr) {
    if (!formMsg) return;
    formMsg.textContent = text || "";
    formMsg.style.color = isErr ? "#b71c1c" : "";
  }

  function syncRegisterFormVisibility() {
    const loggedIn = Boolean(getUser()?.id);
    const withdrawn = Boolean(window.MLL_AUTH?.isWithdrawn?.());
    const showReveal = registerFormExpanded;
    const showCalendarBody = Boolean(
      loggedIn && !withdrawn && registerFormExpanded && formBody,
    );
    const showLoggedMll = showReveal && loggedIn && !withdrawn;
    const showAuthGate = showReveal && !loggedIn;
    const showWithdrawnGate = showReveal && withdrawn;

    if (mllReveal) {
      mllReveal.hidden = !showReveal;
      mllReveal.setAttribute("aria-hidden", showReveal ? "false" : "true");
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

    if (formBody) {
      formBody.hidden = !showCalendarBody;
      formBody.setAttribute("aria-hidden", showCalendarBody ? "false" : "true");
    }
    if (openRegisterBtn) {
      openRegisterBtn.setAttribute("aria-expanded", String(Boolean(showReveal)));
      openRegisterBtn.textContent = showReveal ? "入力画面を閉じる" : "イベントを登録";
    }
    if (submitBtn) submitBtn.disabled = !showCalendarBody || withdrawn;

    /** カレンダー新規登録フォーム: ログイン済みかつ開いているときのみ入力可 */
    form.querySelectorAll("input:not([type='hidden']), select").forEach((inp) => {
      inp.disabled = !loggedIn || withdrawn || !registerFormExpanded || !showCalendarBody;
    });
    if (!loggedIn) {
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
        });
      } catch {
        profileCache.set(id, {
          display_name: id.slice(0, 8),
          avatar_url: "",
          withdrawn: false,
          profile_attributes: [],
          like_show_calendar: true,
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

  function openParticipantsDialog(eventId) {
    if (!participantsOverlay || !participantsTabsEl || !participantsBodyEl) return;
    const am = attendeesByEvent.get(eventId) || new Map();
    const OTHER = "その他";
    /** @type {Map<string, string[]>} */
    const byTab = new Map();
    for (const k of ATTENDANCE_OPTIONS) byTab.set(k, []);
    byTab.set(OTHER, []);

    for (const [uid, styleRaw] of am.entries()) {
      const st = String(styleRaw || "").trim();
      if (ATTENDANCE_OPTIONS.includes(st)) {
        byTab.get(st).push(uid);
      } else {
        byTab.get(OTHER).push(uid);
      }
    }
    for (const arr of byTab.values()) {
      arr.sort((a, b) => profileCard(a).name.localeCompare(profileCard(b).name, "ja"));
    }

    const tabKeys = [...ATTENDANCE_OPTIONS];
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
    const firstWith =
      tabKeys.find((k) => (byTab.get(k) || []).length > 0) || tabKeys[0];
    selectTab(firstWith);

    participantsOverlay.hidden = false;
    participantsOverlay.setAttribute("aria-hidden", "false");
  }

  /**
   * @param {string} eventId
   * @param {Map<string, string>} am uid -> style
   */
  function buildParticipantStackButton(eventId, am) {
    const uids = [...am.keys()].sort((a, b) =>
      profileMini(a).name.localeCompare(profileMini(b).name, "ja"),
    );
    const total = uids.length;
    const show = uids.slice(0, 5);
    const wrap = document.createElement("div");
    wrap.className = "calendar-ev-avatar-stack";
    show.forEach((uid, i) => {
      const p = profileMini(uid);
      const ring = document.createElement("span");
      ring.className = "calendar-ev-avatar-ring";
      ring.style.zIndex = String(10 - i);
      if (p.withdrawn) {
        const box = document.createElement("span");
        box.className = "calendar-ev-avatar-img calendar-ev-avatar-img--withdrawn";
        box.setAttribute("role", "presentation");
        ring.appendChild(box);
      } else {
        const img = document.createElement("img");
        img.className = "calendar-ev-avatar-img";
        img.alt = "";
        img.src = p.avatar || "logo/marchinz-logo.png";
        if (!p.avatar) img.style.opacity = "0.55";
        ring.appendChild(img);
      }
      wrap.appendChild(ring);
    });
    if (total > 5) {
      const more = document.createElement("span");
      more.className = "calendar-ev-participant-more";
      more.textContent = `+${total - 5}`;
      more.title = `ほか ${total - 5} 人`;
      wrap.appendChild(more);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "calendar-ev-avatar-stack-btn calendar-ev-participant-stack-btn";
    btn.setAttribute("aria-label", `参加者${total}人、一覧を開く`);
    btn.appendChild(wrap);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openParticipantsDialog(eventId);
    });
    return btn;
  }

  async function loadEventsAndAttendees() {
    const db = getDb();
    eventsCache = [];
    attendeesByEvent.clear();
    if (!db) {
      setFormMsg("Firestore が利用できない環境です。イベント共有にはブラウザからの接続を確認してください。", true);
      renderList();
      return;
    }
    profileCache.clear();

    try {
      const snap = await db.collection("mll_calendar_events").orderBy("date", "desc").limit(400).get();
      snap.forEach((doc) => {
        const x = doc.data() || {};
        eventsCache.push({
          id: doc.id,
          kind: String(x.kind || ""),
          date: String(x.date || ""),
          title: String(x.title || ""),
          venue_pref: String(x.venue_pref || "").trim(),
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
      renderList();
      return;
    }

    await Promise.all(
      eventsCache.map(async (ev) => {
        try {
          const sub = await db.collection("mll_calendar_events").doc(ev.id).collection("attendees").get();
          const m = new Map();
          sub.forEach((d) => {
            const st = String((d.data() || {}).style || "");
            if (ATTENDANCE_OPTIONS.includes(st)) m.set(d.id, st);
          });
          attendeesByEvent.set(ev.id, m);
        } catch {
          attendeesByEvent.set(ev.id, new Map());
        }
      }),
    );

    const allUids = new Set();
    for (const ev of eventsCache) {
      Object.keys(ev.liked_by || {}).forEach((u) => allUids.add(u));
      allUids.add(ev.created_by);
      const am = attendeesByEvent.get(ev.id);
      if (am) [...am.keys()].forEach((u) => allUids.add(u));
    }
    await hydrateProfiles([...allUids]);
    renderList();
  }

  function filteredSorted() {
    const t = todayStr();
    let rows = eventsCache.filter((ev) => VALID_KINDS.has(ev.kind));
    if (timeTab === "upcoming") {
      rows = rows.filter((ev) => ev.date >= t);
      rows.sort((a, b) => a.date.localeCompare(b.date));
    } else {
      rows = rows.filter((ev) => ev.date < t);
      rows.sort((a, b) => b.date.localeCompare(a.date));
    }
    return rows;
  }

  function updateListHeading() {
    if (!listHeading) return;
    listHeading.textContent = timeTab === "upcoming" ? "一覧（これから・開催日順）" : "一覧（過去・開催日の新しい順）";
  }

  async function toggleLike(eventId) {
    const me = getUser();
    if (!me?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    const db = getDb();
    if (!db) return;
    /** @type {{ createdBy: string; title: string; eid: string } | null} */
    let likeNotify = null;
    try {
      const ref = db.collection("mll_calendar_events").doc(String(eventId));
      await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) return;
        const data = snap.data() || {};
        const prev = normalizeLikedBy(data.liked_by);
        const next = { ...prev };
        const wasOn = Boolean(next[me.id]);
        if (wasOn) delete next[me.id];
        else next[me.id] = true;
        txn.update(ref, { liked_by: next });
        if (!wasOn) {
          const createdBy = String(data.created_by || "").trim();
          const title = String(data.title || "イベント").trim().slice(0, 200);
          const eid = String(eventId);
          if (createdBy && createdBy !== me.id) likeNotify = { createdBy, title, eid };
        }
      });
    } catch (e) {
      console.warn(e);
      setFormMsg(String(e?.message || "いいねの更新に失敗しました"), true);
      return;
    }
    if (likeNotify) {
      const nm = String(displayNameFromUser(me) || UNKNOWN).trim().slice(0, 120) || UNKNOWN;
      window.MarchinZPushLikeNotification?.(db, likeNotify.createdBy, {
        kind: "like_calendar_event",
        actor_uid: me.id,
        actor_name: nm,
        target_type: "calendar_event",
        target_id: likeNotify.eid,
        target_title: likeNotify.title,
        target_href: "#community/events",
        thread_root_id: "",
      });
    }
    await loadEventsAndAttendees();
  }

  function openAttendanceDialog(eventId) {
    pendingAttEventId = String(eventId);
    if (!attOverlay || !attOptions) return;
    attOptions.innerHTML = "";
    for (const label of ATTENDANCE_OPTIONS) {
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

  async function saveMyAttendance(style) {
    const me = getUser();
    const db = getDb();
    if (!me?.id || !db || !pendingAttEventId) return;
    try {
      await db
        .collection("mll_calendar_events")
        .doc(pendingAttEventId)
        .collection("attendees")
        .doc(me.id)
        .set({ style }, { merge: true });
    } catch (e) {
      console.warn(e);
      setFormMsg(String(e?.message || "参加スタイルの保存に失敗しました"), true);
      return;
    }
    closeAttendance();
    await loadEventsAndAttendees();
  }

  function normUrl(raw) {
    const s = String(raw || "").trim();
    return s;
  }

  function openEditDialog(ev) {
    if (!canManageEvent(ev) || !editOverlay || !editDate || !editTitle) return;
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
    pendingEditEventId = String(ev.id);
    editDate.value = ev.date || "";
    editTitle.value = ev.title || "";
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
    const p = ev.participation_format || "";
    if (editParticipation) {
      editParticipation.value = PARTICIPATION_OPTIONS.includes(p) ? p : "";
    }

    if (editHint) {
      editHint.textContent = isSiteAdmin() && getUser()?.id !== ev.created_by
        ? "管理人として編集・削除できます。"
        : "登録した内容を更新できます。削除するといいね・参加スタイルもまとめて消えます。";
    }
    editOverlay.hidden = false;
    editOverlay.setAttribute("aria-hidden", "false");
  }

  function closeEditDialog() {
    if (!editOverlay) return;
    editOverlay.hidden = true;
    editOverlay.setAttribute("aria-hidden", "true");
    pendingEditEventId = "";
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
    const participation_format =
      editParticipation && editParticipation.value && PARTICIPATION_OPTIONS.includes(editParticipation.value)
        ? editParticipation.value
        : "";
    if (!date || !title || !venue_pref || !participation_format) {
      setFormMsg("開催日・開催地・イベント名・参加形式はすべて必須です。", true);
      return;
    }
    /** 運用で URL 長過ぎを防ぐ */
    if (event_url.length > 2000) {
      setFormMsg("URL が長すぎます。", true);
      return;
    }
    const patch = {
      date,
      title,
      venue_pref,
      event_url,
      participation_format,
    };
    if (user.id === ev.created_by && !profileMini(ev.created_by).withdrawn) {
      patch.creator_display_name = displayNameFromUser(user);
      patch.creator_avatar_url = String(user.user_metadata?.avatar_url || "").trim();
    }

    try {
      if (editSaveBtn) editSaveBtn.disabled = true;
      await db.collection("mll_calendar_events").doc(pendingEditEventId).update(patch);
      setFormMsg("イベントを更新しました。");
      closeEditDialog();
      await loadEventsAndAttendees();
    } catch (e) {
      console.warn(e);
      setFormMsg(String(e?.message || "更新に失敗しました。"), true);
    } finally {
      if (editSaveBtn) editSaveBtn.disabled = false;
    }
  }

  async function deleteEditedEvent() {
    const db = getDb();
    const user = getUser();
    if (!db || !user?.id || !pendingEditEventId) return;
    const ev = eventsCache.find((x) => x.id === pendingEditEventId);
    if (!ev || !canManageEvent(ev)) return;
    if (
      !window.confirm(
        `「${(ev.title || "").slice(0, 80)}」を削除しますか？\nいいね・参加スタイルもすべて失われます。この操作は取り消せません。`,
      )
    ) {
      return;
    }
    const ref = db.collection("mll_calendar_events").doc(pendingEditEventId);
    try {
      if (editDeleteBtn) editDeleteBtn.disabled = true;
      const sub = await ref.collection("attendees").get();
      const attendeeDocs = sub.docs;
      const chunk = 500;
      for (let i = 0; i < attendeeDocs.length; i += chunk) {
        const batch = db.batch();
        attendeeDocs.slice(i, i + chunk).forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
      await ref.delete();
      setFormMsg("イベントを削除しました。");
      closeEditDialog();
      await loadEventsAndAttendees();
    } catch (e) {
      console.warn(e);
      setFormMsg(String(e?.message || "削除に失敗しました。"), true);
    } finally {
      if (editDeleteBtn) editDeleteBtn.disabled = false;
    }
  }

  async function clearMyAttendance() {
    const me = getUser();
    const db = getDb();
    if (!me?.id || !db || !pendingAttEventId) return;
    try {
      await db.collection("mll_calendar_events").doc(pendingAttEventId).collection("attendees").doc(me.id).delete();
    } catch (e) {
      console.warn(e);
      setFormMsg(String(e?.message || "解除に失敗しました"), true);
      return;
    }
    closeAttendance();
    await loadEventsAndAttendees();
  }

  function renderMetaLine(ev) {
    const venueTxt = ev.venue_pref?.trim()
      ? ev.venue_pref.trim()
      : "開催地未登録（旧データ）";
    const partTxt = PARTICIPATION_OPTIONS.includes(ev.participation_format)
      ? ev.participation_format
      : ev.participation_format || "—";
    const meta = document.createElement("p");
    meta.className = "mll-log-meta";
    meta.textContent = `${ev.date} · ${venueTxt} · 告知の参加形態: ${partTxt}`;
    return meta;
  }

  function appendUrlSection(li, rawUrl) {
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed || !/^https?:\/\/.+/i.test(trimmed)) return;
    const wrap = document.createElement("p");
    wrap.className = "calendar-ev-event-url-row mll-log-meta";
    const a = document.createElement("a");
    a.href = trimmed;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const host = trimmed.length > 96 ? trimmed.slice(0, 93) + "…" : trimmed;
    a.textContent = host;
    wrap.appendChild(a);
    li.appendChild(wrap);
  }

  function renderList() {
    updateListHeading();
    listEl.innerHTML = "";
    const rows = filteredSorted();
    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "mll-log-item";
      li.textContent = "該当するイベントはまだありません。";
      listEl.appendChild(li);
      return;
    }

    const me = getUser();

    for (const ev of rows) {
      const li = document.createElement("li");
      li.className = "mll-log-item calendar-ev-card";
      li.dataset.calEventId = String(ev.id || "");

      const meta = renderMetaLine(ev);

      const titleRow = document.createElement("div");
      titleRow.className = "calendar-ev-title-row";

      const titleEl = document.createElement("p");
      titleEl.className = "mll-log-title calendar-ev-title-text";
      titleEl.textContent = ev.title;

      const showCalLike = true;

      const likeCluster = document.createElement("div");
      likeCluster.className = "calendar-ev-like-cluster";

      const lb = ev.liked_by || {};
      const cnt = Object.keys(lb).filter((k) => lb[k]).length;

      if (showCalLike) {
        const likeBtn = document.createElement("button");
        likeBtn.type = "button";
        likeBtn.className = `community-like-btn${me?.id && lb[me.id] ? " community-like-btn--on" : ""}`;
        likeBtn.setAttribute("aria-pressed", me?.id && lb[me.id] ? "true" : "false");
        likeBtn.disabled = false;
        likeBtn.addEventListener("click", () => void toggleLike(ev.id));
        const heart = document.createElement("span");
        heart.className = "community-like-heart";
        heart.setAttribute("aria-hidden", "true");
        heart.textContent = "\u2665";
        const num = document.createElement("span");
        num.className = "community-like-count";
        num.textContent = String(cnt);
        likeBtn.appendChild(heart);
        likeBtn.appendChild(num);
        likeCluster.appendChild(likeBtn);

        if (!me?.id) {
          const hint = document.createElement("span");
          hint.className = "community-like-hint mll-log-meta";
          hint.textContent = "ログインでいいね・参加スタイル";
          likeCluster.appendChild(hint);
        }
      }

      titleRow.appendChild(titleEl);
      if (showCalLike) titleRow.appendChild(likeCluster);

      const creatorRow = document.createElement("p");
      creatorRow.className = "mll-log-meta";
      creatorRow.textContent = `登録: ${ev.creator_display_name || UNKNOWN}`;

      let ownerRow = null;
      if (canManageEvent(ev)) {
        ownerRow = document.createElement("div");
        ownerRow.className = "calendar-ev-owner-row";
        const editCardBtn = document.createElement("button");
        editCardBtn.type = "button";
        editCardBtn.className = "calendar-ev-edit-btn";
        editCardBtn.textContent = "編集";
        editCardBtn.addEventListener("click", () => openEditDialog(ev));
        ownerRow.appendChild(editCardBtn);
      }

      const attRow = document.createElement("div");
      attRow.className = "calendar-ev-att-row";
      const am = attendeesByEvent.get(ev.id) || new Map();
      const myStyle = me?.id ? am.get(me.id) || "" : "";
      const attLabel = document.createElement("span");
      attLabel.className = "calendar-ev-att-label";
      attLabel.textContent = me?.id ? `参加スタイル（あなた）: ${myStyle || "未記入"}` : "参加スタイル: ログインで入力できます";

      const attBtn = document.createElement("button");
      attBtn.type = "button";
      attBtn.className = "calendar-ev-att-open-btn";
      attBtn.textContent = "設定・変更";
      attBtn.disabled = false;
      attBtn.addEventListener("click", () => {
        if (!getUser()?.id) {
          window.MarchinZNavigateAuthEntry?.("login");
          return;
        }
        openAttendanceDialog(ev.id);
      });

      attRow.appendChild(attLabel);
      attRow.appendChild(attBtn);

      li.appendChild(meta);
      li.appendChild(titleRow);
      appendUrlSection(li, ev.event_url);
      li.appendChild(creatorRow);
      if (ownerRow) li.appendChild(ownerRow);
      li.appendChild(attRow);
      if (am.size > 0) {
        const partRow = document.createElement("div");
        partRow.className = "calendar-ev-participant-preview-row";
        const partLbl = document.createElement("span");
        partLbl.className = "calendar-ev-participant-preview-label";
        partLbl.textContent = "参加者";
        partRow.appendChild(partLbl);
        partRow.appendChild(buildParticipantStackButton(ev.id, am));
        li.appendChild(partRow);
      }
      listEl.appendChild(li);
    }

    let highlightId = "";
    try {
      highlightId = sessionStorage.getItem("mz_cal_ev_highlight") || "";
    } catch {
      highlightId = "";
    }
    if (highlightId) {
      try {
        sessionStorage.removeItem("mz_cal_ev_highlight");
      } catch {
        //
      }
      requestAnimationFrame(() => {
        let sel = "";
        try {
          sel = `li[data-cal-event-id="${CSS.escape(highlightId)}"]`;
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
  }

  if (openRegisterBtn) {
    openRegisterBtn.addEventListener("click", () => {
      registerFormExpanded = !registerFormExpanded;
      syncRegisterFormVisibility();
    });
  }

  function syncTimeTabs() {
    document.querySelectorAll("[data-cal-time]").forEach((btn) => {
      const v = btn.getAttribute("data-cal-time") || "";
      btn.setAttribute("aria-selected", String(v === timeTab));
    });
  }

  document.querySelectorAll("[data-cal-time]").forEach((btn) => {
    btn.addEventListener("click", () => {
      timeTab = btn.getAttribute("data-cal-time") || "upcoming";
      syncTimeTabs();
      renderList();
    });
  });

  syncTimeTabs();

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
    const date = inputDate.value;
    const title = inputTitle.value.trim();
    const venue_pref = selectVenue ? String(selectVenue.value || "").trim() : "";
    const event_url = normUrl(inputUrl?.value ?? "");
    const pf = selectParticipation ? String(selectParticipation.value || "").trim() : "";

    if (!date || !title || !venue_pref || !PARTICIPATION_OPTIONS.includes(pf)) {
      setFormMsg("開催日・開催地・イベント名・参加形式はすべて必須です。", true);
      return;
    }
    if (event_url.length > 2000) {
      setFormMsg("URL が長すぎます。", true);
      return;
    }

    const payload = {
      kind: CREATE_KIND_UNIFIED,
      date,
      title,
      venue_pref,
      event_url,
      participation_format: pf,
      created_by: user.id,
      liked_by: {},
      creator_display_name: displayNameFromUser(user),
      creator_avatar_url: String(user.user_metadata?.avatar_url || "").trim(),
      created_at: new Date().toISOString(),
    };
    try {
      if (submitBtn) submitBtn.disabled = true;
      await db.collection("mll_calendar_events").add(payload);
      inputTitle.value = "";
      if (inputUrl) inputUrl.value = "";
      setFormMsg("イベントを登録しました。");
      await loadEventsAndAttendees();
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
  if (editDeleteBtn) {
    editDeleteBtn.addEventListener("click", () => void deleteEditedEvent());
  }

  window.addEventListener("mll-auth-changed", async () => {
    if (!getUser()?.id) {
      registerFormExpanded = false;
    }
    syncRegisterFormVisibility();
    await loadEventsAndAttendees();
  });

  window.addEventListener("marchinz-like-show-changed", () => {
    void loadEventsAndAttendees();
  });

  syncRegisterFormVisibility();
  void loadEventsAndAttendees();
})();

