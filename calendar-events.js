(() => {
  window.MarchinZEventsRegisterExpanded = false;

  /** 一覧に含める kind（Firestore・フォームと一致） */
  const VALID_KINDS = new Set(["イベント", "演奏会", "大会"]);
  /** フォームで選べる種別（Firestore の kind にそのまま保存） */
  const CALENDAR_KIND_CREATE_OPTIONS = ["演奏会", "大会", "イベント"];
  const ATTENDANCE_OPTIONS = ["出演", "チームスタッフ", "観戦", "スタッフ/運営"];
  /** イベント登録フォームでの「参加形式」 */
  const PARTICIPATION_OPTIONS = ["出演", "チームスタッフ", "観戦", "運営", "未定"];
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
  const form = document.getElementById("calendar-event-form");
  const formBody = document.getElementById("calendar-ev-form-body");
  const inputDate = document.getElementById("calendar-ev-date");
  const selectVenue = document.getElementById("calendar-ev-venue");
  const inputTitle = document.getElementById("calendar-ev-title");
  const inputUrl = document.getElementById("calendar-ev-url");
  const selectParticipation = document.getElementById("calendar-ev-participation");
  const selectKind = document.getElementById("calendar-ev-kind");
  const formMsg = document.getElementById("calendar-ev-form-msg");
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
  /** @type {"date"|"kind"|"venue"} */
  let sortKey = "date";
  /** true のとき主キー比較を反転（開催日・開催地・種別）。開催日は「今後のみ」のとき昇順（近い日が先）、すべて表示のとき初期は降順 */
  let sortDesc = true;
  let eventsCache = [];
  const attendeesByEvent = new Map();
  const profileCache = new Map();
  /** `開催日|タイトル|開催地` → MarchinZ Log を公開で紐づく user_id */
  let mllPublicUidsByMatchKey = new Map();

  let pendingAttEventId = "";
  let pendingEditEventId = "";
  let mergeSourceEventId = "";
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
    const redirectPending = isAuthRedirectPending();
    const showReveal = registerFormExpanded;
    const showCalendarBody = Boolean(
      loggedIn && !withdrawn && registerFormExpanded && formBody,
    );
    const showLoggedMll = showReveal && loggedIn && !withdrawn;
    const showAuthGate = showReveal && !loggedIn && !redirectPending;
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
  async function loadMllLogPublicFaceMap(db, events) {
    mllPublicUidsByMatchKey = new Map();
    if (!db || !events.length) return;
    const keysNeeded = new Set(events.map(eventMatchKey));
    let snap;
    try {
      snap = await db.collection("mll_logs").orderBy("created_at", "desc").limit(800).get();
    } catch (e) {
      console.warn("[calendar-events] mll_logs fetch", e);
      return;
    }
    snap.forEach((doc) => {
      const x = doc.data() || {};
      if (String(x.visibility || "").trim() === "private") return;
      const uid = String(x.user_id || "").trim();
      if (!uid) return;
      const key = `${String(x.event_date || "").trim()}|${normTitleKey(x.event_name || "")}|${String(x.venue || "").trim()}`;
      if (!keysNeeded.has(key)) return;
      if (!mllPublicUidsByMatchKey.has(key)) mllPublicUidsByMatchKey.set(key, new Set());
      mllPublicUidsByMatchKey.get(key).add(uid);
    });
  }

  async function loadEventsAndAttendees() {
    const db = getDb();
    eventsCache = [];
    attendeesByEvent.clear();
    mllPublicUidsByMatchKey = new Map();
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

    await Promise.all([
      ...eventsCache.map(async (ev) => {
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
      loadMllLogPublicFaceMap(db, eventsCache),
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
    await hydrateProfiles([...allUids]);
    renderList();
  }

  function sortCalendarRows(rows) {
    const sign = sortDesc ? -1 : 1;
    const kindOrder = { 演奏会: 1, 大会: 2, イベント: 3 };
    rows.sort((a, b) => {
      let c = 0;
      if (sortKey === "date") {
        c = a.date.localeCompare(b.date);
      } else if (sortKey === "kind") {
        c = (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9);
        if (c === 0) c = a.date.localeCompare(b.date);
      } else {
        c = String(a.venue_pref || "").localeCompare(String(b.venue_pref || ""), "ja");
        if (c === 0) c = a.date.localeCompare(b.date);
      }
      return sign * c;
    });
  }

  function filteredSorted() {
    const t = todayStr();
    let rows = eventsCache.filter((ev) => VALID_KINDS.has(ev.kind));
    if (kindTab !== "all" && CALENDAR_KIND_CREATE_OPTIONS.includes(kindTab)) {
      rows = rows.filter((ev) => ev.kind === kindTab);
    }
    if (upcomingOnly) {
      rows = rows.filter((ev) => ev.date >= t);
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
    if (kind === "演奏会") return "concert";
    if (kind === "大会") return "taikai";
    if (kind === "イベント") return "event";
    return "other";
  }

  function syncSortBar() {
    const bar = document.getElementById("calendar-ev-sort-bar");
    if (!bar) return;
    if (kindTab !== "all" && sortKey === "kind") {
      sortKey = "date";
      sortDesc = !upcomingOnly;
    }
    bar.querySelectorAll("[data-cal-sort]").forEach((btn) => {
      const k = btn.getAttribute("data-cal-sort") || "";
      const showKindBtn = kindTab === "all";
      if (k === "kind") {
        btn.hidden = !showKindBtn;
      }
      const active = k === sortKey && !(k === "kind" && !showKindBtn);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.classList.toggle("calendar-ev-sort-btn--active", active);
      btn.classList.remove("sorted-asc", "sorted-desc");
      if (active) {
        btn.classList.add(sortDesc ? "sorted-desc" : "sorted-asc");
      }
      const dirJp = sortDesc ? "降順" : "昇順";
      const base = k === "date" ? "開催日" : k === "kind" ? "種別" : "開催地";
      btn.setAttribute(
        "aria-label",
        active ? `${base}で並び替え（${dirJp}）、クリックで順序切替` : `${base}で並び替え`,
      );
    });
  }

  function renderMetaChips(ev) {
    const venueTxt = ev.venue_pref?.trim()
      ? ev.venue_pref.trim()
      : "開催地未登録";
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
    wrap.appendChild(mk(ev.date || "—", "calendar-ev-meta-chip--date"));
    wrap.appendChild(mk(venueTxt, "calendar-ev-meta-chip--venue"));
    wrap.appendChild(
      mk(
        kindLbl,
        `calendar-ev-meta-chip--kind calendar-ev-meta-chip--kind-${slug}`,
      ),
    );
    return wrap;
  }

  function getMllPublicFaceUids(ev) {
    const key = eventMatchKey(ev);
    const raw = mllPublicUidsByMatchKey.get(key);
    if (!raw || raw.size === 0) return [];
    const out = [];
    for (const uid of raw) {
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
    row.className = "calendar-ev-topline";
    row.appendChild(renderMetaChips(ev));
    const right = document.createElement("div");
    right.className = "calendar-ev-topline-right";
    const kiju = document.createElement("span");
    kiju.className = "calendar-ev-topline-kinyuu";
    kiju.textContent = "記入者";
    const cr = document.createElement("span");
    cr.className = "calendar-ev-topline-creator";
    const storedAv = String(ev.creator_avatar_url || "").trim();
    const creatorUid = String(ev.created_by || "").trim();
    const pm = profileMini(ev.created_by);
    const creatorAvatar = document.createElement("img");
    creatorAvatar.className = "calendar-ev-topline-creator-avatar";
    creatorAvatar.alt = "";
    creatorAvatar.src = storedAv || pm.avatar || "logo/marchinz-logo.png";
    if (!storedAv && !pm.avatar) creatorAvatar.style.opacity = "0.55";
    if (creatorUid && !pm.withdrawn) {
      const avLink = document.createElement("a");
      avLink.className = "calendar-ev-topline-creator-avatar-link";
      avLink.href = `#profile?uid=${encodeURIComponent(creatorUid)}`;
      avLink.setAttribute("aria-label", `${ev.creator_display_name || pm.name || UNKNOWN}のマイページ`);
      avLink.appendChild(creatorAvatar);
      cr.appendChild(avLink);
    } else {
      cr.appendChild(creatorAvatar);
    }
    const creatorName = document.createElement("span");
    creatorName.className = "calendar-ev-topline-creator-name";
    creatorName.textContent = ev.creator_display_name || pm.name || UNKNOWN;
    cr.appendChild(creatorName);
    right.appendChild(kiju);
    right.appendChild(cr);
    row.appendChild(right);
    return row;
  }

  function buildMllFacesWrap(ev) {
    const uids = getMllPublicFaceUids(ev);
    const wrap = document.createElement("div");
    wrap.className = "calendar-ev-mll-faces";
    for (const uid of uids) {
      const p = profileMini(uid);
      const a = document.createElement("a");
      a.className = "calendar-ev-mll-face";
      a.href = `#profile?uid=${encodeURIComponent(uid)}`;
      a.title = p.name;
      if (p.withdrawn) {
        const ph = document.createElement("span");
        ph.className = "calendar-ev-mll-face-img calendar-ev-mll-face-img--withdrawn";
        ph.setAttribute("role", "presentation");
        a.appendChild(ph);
      } else {
        const img = document.createElement("img");
        img.className = "calendar-ev-mll-face-img";
        img.alt = "";
        img.loading = "lazy";
        img.src = p.avatar || "logo/marchinz-logo.png";
        if (!p.avatar) img.style.opacity = "0.55";
        a.appendChild(img);
      }
      wrap.appendChild(a);
    }
    return wrap;
  }

  /** 3段目: MarchinZ Log 公開者アイコン + 右端で参加スタイル（旧 設定・変更） */
  function buildMarchinZLogRow(ev, me) {
    const am = attendeesByEvent.get(ev.id) || new Map();
    const row = document.createElement("div");
    row.className = "calendar-ev-mll-log-row";
    const left = document.createElement("div");
    left.className = "calendar-ev-mll-log-left";
    const lab = document.createElement("span");
    lab.className = "calendar-ev-mll-log-label";
    lab.textContent = "MarchinZ Log";
    left.appendChild(lab);
    left.appendChild(buildMllFacesWrap(ev));
    if (am.size > 0) {
      const partBtn = document.createElement("button");
      partBtn.type = "button";
      partBtn.className = "calendar-ev-mll-log-part-btn";
      partBtn.textContent = `参加者（${am.size}）`;
      partBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openParticipantsDialog(ev.id);
      });
      left.appendChild(partBtn);
    }
    const actions = document.createElement("div");
    actions.className = "calendar-ev-mll-log-actions";
    const mllBtn = document.createElement("button");
    mllBtn.type = "button";
    mllBtn.className = "calendar-ev-mll-log-save-btn";
    mllBtn.textContent = "MarchinZ Logを残す";
    mllBtn.addEventListener("click", () => {
      if (!getUser()?.id) {
        window.MarchinZNavigateAuthEntry?.("login");
        return;
      }
      openAttendanceDialog(ev.id);
    });
    actions.appendChild(mllBtn);
    if (me?.id) {
      const cloneBtn = document.createElement("button");
      cloneBtn.type = "button";
      cloneBtn.className = "calendar-ev-mll-log-clone-btn";
      cloneBtn.textContent = "この内容で作成";
      cloneBtn.addEventListener("click", () => prefillCreateFormFromEvent(ev));
      actions.appendChild(cloneBtn);
    }
    row.appendChild(left);
    row.appendChild(actions);
    return row;
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
      setFormMsg(String(e?.message || "MarchinZ Log（参加のしかた）の保存に失敗しました"), true);
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

    const editKind = document.getElementById("calendar-edit-kind");
    if (editKind) {
      const k = String(ev.kind || "").trim();
      editKind.value = CALENDAR_KIND_CREATE_OPTIONS.includes(k) ? k : "イベント";
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
    const editKindEl = document.getElementById("calendar-edit-kind");
    const nextKind = editKindEl ? String(editKindEl.value || "").trim() : "";
    if (!date || !title || !venue_pref || !participation_format || !CALENDAR_KIND_CREATE_OPTIONS.includes(nextKind)) {
      setFormMsg("開催日・種別・開催地・イベント名・参加形式はすべて必須です。", true);
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
      kind: nextKind,
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
    const pf = String(ev.participation_format || "").trim();
    if (selectParticipation) {
      selectParticipation.value = PARTICIPATION_OPTIONS.includes(pf) ? pf : "";
    }
    if (selectKind) {
      const k = String(ev.kind || "").trim();
      selectKind.value = CALENDAR_KIND_CREATE_OPTIONS.includes(k) ? k : "";
    }
    setFormMsg("イベント情報を複製しました。内容を確認して保存してください。", false);
  }

  function setMergeSource(ev) {
    if (!ev?.id) return;
    mergeSourceEventId = String(ev.id);
    setFormMsg(`統合元を選択: 「${String(ev.title || "イベント").slice(0, 60)}」`, false);
    renderList();
  }

  /**
   * 統合元カレンダー行と同一キー（開催日・イベント名・開催地）の MarchinZ Log を統合先の情報へ書き換え。
   * @returns {Promise<number>} 更新したログ件数
   */
  async function rewriteMllLogsForMergedCalendar(db, sourceFields, targetFields) {
    const srcDate = String(sourceFields?.date || "").trim();
    const srcTitle = normTitleKey(sourceFields?.title || "");
    const srcVenue = String(sourceFields?.venue_pref || "").trim();
    const tgtDate = String(targetFields?.date || "").trim();
    const tgtTitle = String(targetFields?.title || "").trim().slice(0, 120);
    const tgtVenue = String(targetFields?.venue_pref || "").trim().slice(0, 48);
    if (!srcDate || !tgtDate || !tgtTitle || !tgtVenue) return 0;

    const buildRl = window.MarchinZMllBuildRoleLabel;
    let snap;
    try {
      snap = await db.collection("mll_logs").where("event_date", "==", srcDate).limit(500).get();
    } catch (e) {
      console.warn("[calendar-events] mll_logs query for merge", e);
      throw e;
    }

    const updates = [];
    snap.forEach((doc) => {
      const x = doc.data() || {};
      if (normTitleKey(x.event_name || "") !== srcTitle) return;
      if (String(x.venue || "").trim() !== srcVenue) return;
      const roleLabel =
        typeof buildRl === "function" ? buildRl(x.role, tgtDate) : String(x.role_label || "").trim() || "—";
      updates.push({
        ref: doc.ref,
        payload: {
          event_date: tgtDate,
          event_name: tgtTitle,
          venue: tgtVenue,
          role_label: String(roleLabel).slice(0, 120),
        },
      });
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
    if (
      !window.confirm(
        `「${sourceTitle}」を「${targetTitle}」へ統合しますか？\n\n統合元のカードは削除されます。統合元と同じ開催日・イベント名・開催地の MarchinZ Log は、統合先の開催情報に合わせて更新されます。`,
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

      let logRewritten = 0;
      try {
        logRewritten = await rewriteMllLogsForMergedCalendar(db, srcData, tgtData);
      } catch (logErr) {
        console.warn(logErr);
        setFormMsg(
          String(
            logErr?.message ||
              "MarchinZ Log の更新に失敗したため、統合を中止しました。Firestore ルールのデプロイと、mll_privileged_uids に運営 UID が登録されているか確認してください。",
          ),
          true,
        );
        return;
      }

      const srcLiked = normalizeLikedBy(srcData.liked_by);
      const tgtLiked = normalizeLikedBy(tgtData.liked_by);
      const mergedLiked = { ...tgtLiked, ...srcLiked };
      await targetRef.set({ liked_by: mergedLiked }, { merge: true });

      const targetAttMap = new Map();
      targetAttSnap.forEach((d) => targetAttMap.set(d.id, d.data() || {}));
      for (const d of sourceAttSnap.docs) {
        if (!targetAttMap.has(d.id)) {
          await targetRef.collection("attendees").doc(d.id).set(d.data() || {}, { merge: true });
        }
      }
      for (const d of sourceAttSnap.docs) {
        await sourceRef.collection("attendees").doc(d.id).delete();
      }

      await sourceRef.delete();
      mergeSourceEventId = "";
      if (logRewritten > 0) {
        setFormMsg(`イベントを統合しました。MarchinZ Log を ${logRewritten} 件、統合先の開催情報に合わせて更新しました。`, false);
      } else {
        setFormMsg(
          "イベントを統合しました。（同一キーの MarchinZ Log が見つからなかったため、ログの更新はありませんでした）",
          false,
        );
      }
      await loadEventsAndAttendees();
    } catch (e) {
      console.warn(e);
      setFormMsg(String(e?.message || "イベント統合に失敗しました。"), true);
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

  function renderList() {
    syncSortBar();
    syncKindTabs();
    listEl.innerHTML = "";
    const rows = dedupeCalendarRows(filteredSorted());
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
      const kSlug = kindSlugForCss(ev.kind);
      li.className = `mll-log-item calendar-ev-card calendar-ev-card--kind-${kSlug}`;
      li.dataset.calEventId = String(ev.id || "");

      const topMeta = renderTopMetaWithCreator(ev);

      const titleRow = document.createElement("div");
      titleRow.className = "calendar-ev-title-row calendar-ev-title-row--prominent";

      const titleCol = document.createElement("div");
      titleCol.className = "calendar-ev-title-col";

      const titleEl = document.createElement("p");
      titleEl.className = "mll-log-title calendar-ev-title-text";
      titleEl.textContent = ev.title;
      titleCol.appendChild(titleEl);

      const trimmedUrl = String(ev.event_url || "").trim();
      if (trimmedUrl && /^https?:\/\/.+/i.test(trimmedUrl)) {
        const urlRow = document.createElement("p");
        urlRow.className = "calendar-ev-title-url mll-log-meta";
        const a = document.createElement("a");
        a.href = trimmedUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        const host = trimmedUrl.length > 96 ? trimmedUrl.slice(0, 93) + "…" : trimmedUrl;
        a.textContent = host;
        urlRow.appendChild(a);
        titleCol.appendChild(urlRow);
      }

      titleRow.appendChild(titleCol);

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
        const dupBtn = document.createElement("button");
        dupBtn.type = "button";
        dupBtn.className = "calendar-ev-edit-btn";
        dupBtn.textContent = "複製";
        dupBtn.addEventListener("click", () => prefillCreateFormFromEvent(ev));
        ownerRow.appendChild(dupBtn);
        if (isSiteAdmin()) {
          const pickBtn = document.createElement("button");
          pickBtn.type = "button";
          pickBtn.className = "calendar-ev-edit-btn";
          pickBtn.textContent = mergeSourceEventId === ev.id ? "統合元選択中" : "統合元に指定";
          pickBtn.disabled = mergeSourceEventId === ev.id;
          pickBtn.addEventListener("click", () => setMergeSource(ev));
          ownerRow.appendChild(pickBtn);
          if (mergeSourceEventId && mergeSourceEventId !== ev.id) {
            const mergeBtn = document.createElement("button");
            mergeBtn.type = "button";
            mergeBtn.className = "calendar-ev-edit-btn";
            mergeBtn.textContent = "ここへ統合";
            mergeBtn.addEventListener("click", () => void mergeEventIntoTarget(ev));
            ownerRow.appendChild(mergeBtn);
          }
        }
      }

      li.appendChild(topMeta);
      li.appendChild(titleRow);
      li.appendChild(buildMarchinZLogRow(ev, me));
      if (ownerRow) li.appendChild(ownerRow);
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
      if (isAuthRedirectPending()) return;
      registerFormExpanded = !registerFormExpanded;
      syncRegisterFormVisibility();
    });
  }

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
      renderList();
    });
  });

  document.querySelectorAll("[data-cal-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-cal-sort") || "";
      if (k !== "date" && k !== "kind" && k !== "venue") return;
      if (sortKey === k) {
        sortDesc = !sortDesc;
      } else {
        sortKey = k;
        sortDesc = k === "date" ? !upcomingOnly : false;
      }
      syncSortBar();
      renderList();
    });
  });

  syncKindTabs();
  const upcomingOnlyInput = document.getElementById("calendar-ev-upcoming-only");
  if (upcomingOnlyInput) {
    upcomingOnlyInput.checked = false;
    upcomingOnly = false;
    upcomingOnlyInput.addEventListener("change", () => {
      upcomingOnly = Boolean(upcomingOnlyInput.checked);
      if (sortKey === "date") {
        sortDesc = !upcomingOnly;
      }
      syncSortBar();
      renderList();
    });
  }
  sortDesc = !upcomingOnly;
  syncSortBar();

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
    const calendarKind = selectKind ? String(selectKind.value || "").trim() : "";

    if (!date || !title || !venue_pref || !PARTICIPATION_OPTIONS.includes(pf) || !CALENDAR_KIND_CREATE_OPTIONS.includes(calendarKind)) {
      setFormMsg("開催日・種別・開催地・イベント名・参加形式はすべて必須です。", true);
      return;
    }
    if (event_url.length > 2000) {
      setFormMsg("URL が長すぎます。", true);
      return;
    }

    const payload = {
      kind: calendarKind,
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
      setFormMsg("登録しました。");
      registerFormExpanded = false;
      syncRegisterFormVisibility();
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

