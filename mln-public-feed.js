/**
 * コミュニティ「ノート」タブ ─ 公開 MarchinZ Note を更新日時順でカード一覧（YAMAP 風タイムライン）
 */
(() => {
  const LIMIT = 48;
  const FEED_SUMMARY_TEXT = `更新が新しい順 · 最大 ${LIMIT} 件を表示しています`;
  /** @param {unknown} raw @returns {string[]} */
  function userNotePhotoUrls(raw) {
    return window.MarchinZDefaultAssets?.normalizeNotePhotoUrls?.(raw, 4) || [];
  }
  const AVATAR_FALLBACK = "logo/marchinz-logo.png";
  /** @type {boolean} */
  let busy = false;
  /** @type {string} */
  let searchQuery = "";
  /** @type {{ uid: string; eventId: string; data: Record<string, unknown> }[]} */
  let cachedRows = [];

  function excerptBody(raw, maxLen) {
    const t = String(raw ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLen);
    return t.length >= maxLen ? `${t}…` : t || "（本文なし）";
  }

  function noteTitleOf(data) {
    const NA = window.MarchinZNoteActions;
    if (NA?.diaryDisplayNoteTitle) return NA.diaryDisplayNoteTitle(data);
    return String(data?.note_title || "").trim();
  }

  function eventNameOf(data) {
    const NA = window.MarchinZNoteActions;
    if (NA?.diaryDisplayEventName) return NA.diaryDisplayEventName(data, null);
    return String(data?.event_title || "").trim() || "イベント";
  }

  /** @returns {HTMLElement|null} */
  function container() {
    return document.getElementById("mln-feed-cards");
  }

  /** @returns {HTMLElement|null} */
  function msgEl() {
    return document.getElementById("mln-feed-msg");
  }

  /** @returns {HTMLInputElement|null} */
  function searchEl() {
    return /** @type {HTMLInputElement|null} */ (document.getElementById("mln-feed-search"));
  }

  /** @returns {FirebaseFirestore.Firestore|null} */
  function getDb() {
    try {
      return window.MLL_AUTH?.getDb?.() || null;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} uid
   * @param {string} eventId
   */
  function profileDiaryHref(uid, eventId) {
    const base = `${location.pathname}${location.search}`;
    return `${base}#profile?uid=${encodeURIComponent(uid)}&tab=logdiary&event=${encodeURIComponent(eventId)}`;
  }

  /**
   * @param {HTMLElement} host
   * @param {Record<string, unknown>} diary
   */
  function appendFeedCover(host, diary) {
    const DA = window.MarchinZDefaultAssets;
    const cover =
      DA?.noteCoverUrl?.(diary.photo_urls, diary.cover_photo_index) ||
      userNotePhotoUrls(diary.photo_urls)[0] ||
      DA?.noteThumbnailDefault?.() ||
      "img/defaults/marchinznote_d.jpg";
    const wrap = document.createElement("div");
    wrap.className = "mln-feed-card-cover";
    const mi = window.MarchinZImage;
    if (mi?.appendProtectedPhoto) {
      mi.appendProtectedPhoto(wrap, {
        src: cover,
        alt: "",
        classNameImg: "mln-feed-card-cover-img",
        loading: "lazy",
      });
    } else {
      const img = document.createElement("img");
      img.className = "mln-feed-card-cover-img";
      img.src = cover;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      wrap.appendChild(img);
    }
    host.appendChild(wrap);
  }

  /**
   * @param {{ uid: string; eventId: string; data: Record<string, unknown> }} row
   */
  function openFeedNoteViewer(row) {
    const open = window.MarchinZNoteActions?.openViewer;
    if (typeof open === "function") {
      void open({
        uid: row.uid,
        eventId: row.eventId,
        returnHash: "#community/notes",
      });
      return;
    }
    location.hash = `#profile?uid=${encodeURIComponent(row.uid)}&tab=logdiary&event=${encodeURIComponent(row.eventId)}`;
  }

  /** @param {Event} ev */
  function isMlnFeedCardInteractiveTarget(ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return false;
    return Boolean(t.closest("a, button, .community-like-btn, summary"));
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {string[]} uids
   */
  async function loadProfilesMinimal(db, uids) {
    /** @type {Map<string, { name: string; avatar: string; hide: boolean }>} */
    const out = new Map();
    await Promise.all(
      uids.map(async (uid) => {
        try {
          const snap = await db.collection("mll_profiles").doc(uid).get();
          if (!snap.exists) {
            out.set(uid, { name: "ユーザー", avatar: "", hide: false });
            return;
          }
          const d = snap.data() || {};
          const wd = Boolean(d.withdrawn);
          const bn = Boolean(d.banned);
          const name =
            wd || bn ? "退会ユーザー" : String(d.display_name ?? "").trim() || "ユーザー";
          out.set(uid, {
            name,
            avatar: String(d.avatar_url ?? "").trim(),
            hide: wd || bn,
          });
        } catch {
          out.set(uid, { name: "ユーザー", avatar: "", hide: false });
        }
      }),
    );
    return out;
  }

  function normDiaryLikedBy(raw) {
    const o = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
    for (const [k, v] of Object.entries(raw)) {
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(k) && v === true) o[k] = true;
    }
    return o;
  }

  function renderEmpty(root, textNodeText) {
    root.replaceChildren();
    const p = document.createElement("p");
    p.className = "mln-feed-empty";
    p.textContent = textNodeText;
    root.appendChild(p);
  }

  /**
   * @param {{ uid: string; eventId: string; data: Record<string, unknown> }} row
   */
  function rowMatchesSearch(row) {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return true;
    const d = row.data;
    const hay = [
      noteTitleOf(d),
      eventNameOf(d),
      d.body,
      d.event_date,
      d.participation_style,
    ]
      .map((x) => String(x || "").toLowerCase())
      .join(" ");
    return hay.includes(needle);
  }

  /**
   * @param {HTMLElement} engage
   * @param {{ uid: string; eventId: string; data: Record<string, unknown> }} row
   */
  /**
   * @param {HTMLElement} titleRow
   * @param {{ uid: string; eventId: string; data: Record<string, unknown> }} row
   */
  function appendFeedLike(titleRow, row) {
    const d = row.data;
    const me = window.MLL_AUTH?.getUser?.();
    const lb = normDiaryLikedBy(d.liked_by);
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    const likeWrap = document.createElement("div");
    likeWrap.className = "mz-inline-like-host";
    window.MarchinZEngageUi?.buildLikeRow(likeWrap, {
      liked,
      count: cnt,
      onClick: async () => {
        const db = getDb();
        if (!db || !window.MarchinZNoteActions?.toggleDiaryLike) return;
        const saved = await window.MarchinZNoteActions.toggleDiaryLike(db, row.uid, row.eventId);
        if (saved) {
          row.data = saved;
          paintCards();
        }
      },
      showLoginHint: !me?.id,
    });
    titleRow.appendChild(likeWrap);
  }

  function appendFeedEngage(engage, row) {
    const d = row.data;
    const me = window.MLL_AUTH?.getUser?.();
    if (me?.id && me.id !== row.uid) {
      const NA = window.MarchinZNoteActions;
      if (NA?.buildNoteReportMenu) {
        engage.appendChild(
          NA.buildNoteReportMenu(row.uid, row.eventId, noteTitleOf(d) || eventNameOf(d)),
        );
      }
    }
  }

  /** @param {string} raw */
  function participationStyleLabel(raw) {
    const R = window.MarchinZMllRole;
    if (R?.participationFormatLabel) return R.participationFormatLabel(raw);
    return String(raw || "").trim();
  }

  /** @param {HTMLElement} parent */
  function appendMllLogRowBadge(parent) {
    const label = window.MarchinZMllRole?.MLL_LOG_ROW_BADGE_LABEL || "MarchinZ Log";
    const lab = document.createElement("span");
    lab.className = "calendar-ev-mll-log-label mln-feed-mll-log-label";
    lab.textContent = label;
    parent.appendChild(lab);
  }

  function participationChipClassName(styleText) {
    const R = window.MarchinZMllRole;
    const unknown = R?.PARTICIPATION_UNKNOWN_LABEL || "（参加スタイル不明）";
    const sty = participationStyleLabel(styleText);
    if (!sty) return "";
    const base = "mln-feed-part-chip";
    if (sty === unknown) return `${base} mln-feed-part-chip--unknown`;
    if (R?.resolveParticipationStyle) {
      const res = R.resolveParticipationStyle(styleText);
      if (!res.known) return `${base} mln-feed-part-chip--unknown`;
    }
    return base;
  }

  /** @param {HTMLElement} parent @param {string} styleText */
  function appendParticipationChip(parent, styleText) {
    const sty = participationStyleLabel(styleText);
    const cls = participationChipClassName(styleText);
    if (!sty || !cls) return;
    const chip = document.createElement("span");
    chip.className = cls;
    chip.textContent = sty;
    parent.appendChild(chip);
  }

  /**
   * @param {HTMLElement} parent
   * @param {Record<string, unknown>} d
   * @param {string} noteTitle
   * @param {string} eventName
   */
  function appendFeedSubline(parent, d, noteTitle, eventName) {
    const evName = String(eventName || "").trim();
    const evd = String(d.event_date ?? "")
      .trim()
      .replace(/-/g, "/");
    const sty = participationStyleLabel(d.participation_style);
    const showEvent = evName && (!noteTitle || noteTitle !== evName);

    const sub = document.createElement("p");
    sub.className = "mln-feed-card-subline";
    appendMllLogRowBadge(sub);
    if (showEvent) {
      const evSpan = document.createElement("span");
      evSpan.className = "mln-feed-card-subline-event";
      evSpan.textContent = evName;
      sub.appendChild(evSpan);
    }
    if (evd) {
      const dateSpan = document.createElement("span");
      dateSpan.className = "mln-feed-card-subline-date";
      dateSpan.textContent = evd;
      sub.appendChild(dateSpan);
    }
    if (sty) {
      appendParticipationChip(sub, sty);
    }
    parent.appendChild(sub);
  }

  /**
   * @param {{ uid: string; eventId: string; data: Record<string, unknown> }} row
   * @param {{ name: string; avatar: string }} author
   */
  function buildCardEl(row, author) {
    const d = row.data;
    const href = profileDiaryHref(row.uid, row.eventId);
    const noteTitle = noteTitleOf(d);
    const eventName = eventNameOf(d);

    const art = document.createElement("article");
    art.className = "mln-feed-card mln-feed-card--media mln-feed-card--openable";
    art.tabIndex = 0;
    art.setAttribute("role", "button");
    art.setAttribute(
      "aria-label",
      `${noteTitle || eventName || "MarchinZ Note"} の詳細を開く`,
    );

    const body = document.createElement("div");
    body.className = "mln-feed-card-body";

    appendFeedCover(body, d);

    const head = document.createElement("div");
    head.className = "mln-feed-card-head";

    const av = document.createElement("img");
    av.className = "mln-feed-card-head-avatar";
    av.alt = "";
    av.width = 40;
    av.height = 40;
    av.decoding = "async";
    av.src =
      author.avatar && /^https?:\/\//i.test(author.avatar) ? author.avatar : AVATAR_FALLBACK;
    const headAside = document.createElement("div");
    headAside.className = "mln-feed-card-head-aside";
    headAside.appendChild(av);

    const nm = document.createElement("a");
    nm.className = "mln-feed-author-name mln-feed-author-name-link";
    nm.href = href;
    nm.textContent = author.name;
    headAside.appendChild(nm);

    head.appendChild(headAside);

    const headMain = document.createElement("div");
    headMain.className = "mln-feed-card-head-main";

    const titleRow = document.createElement("div");
    titleRow.className = "mln-feed-card-title-row mz-title-like-row";
    const h3 = document.createElement("h3");
    h3.className = "mln-feed-card-title";
    const titleLink = document.createElement("span");
    titleLink.className = "mln-feed-card-title-text";
    titleLink.textContent = noteTitle || eventName || "（無題）";
    h3.appendChild(titleLink);
    titleRow.appendChild(h3);
    appendFeedLike(titleRow, row);
    headMain.appendChild(titleRow);

    appendFeedSubline(headMain, d, noteTitle, eventName);

    head.appendChild(headMain);
    body.appendChild(head);

    const openCard = (ev) => {
      if (isMlnFeedCardInteractiveTarget(ev)) return;
      ev.preventDefault();
      openFeedNoteViewer(row);
    };
    art.addEventListener("click", openCard);
    art.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      if (isMlnFeedCardInteractiveTarget(ev)) return;
      ev.preventDefault();
      openFeedNoteViewer(row);
    });

    art.appendChild(body);
    return art;
  }

  function paintCards() {
    const root = container();
    if (!root) return;
    const filtered = cachedRows.filter((r) => rowMatchesSearch(r));
    if (!filtered.length) {
      renderEmpty(
        root,
        searchQuery.trim()
          ? "検索に一致する MarchinZ Note はありません。"
          : "まだ公開の MarchinZ Note が登録されていません。",
      );
      return;
    }
    const frag = document.createDocumentFragment();
    for (const row of filtered) {
      const p = row._author || { name: "ユーザー", avatar: "" };
      frag.appendChild(buildCardEl(row, p));
    }
    root.replaceChildren(frag);
  }

  async function refresh() {
    const root = container();
    const msg = msgEl();
    if (!root) return;
    if (busy) return;
    const redirectPending = Boolean(window.MLL_AUTH?.isRedirectPending?.());
    const db = getDb();
    if (!db || !window.firebase?.firestore) {
      if (redirectPending) {
        if (msg) {
          msg.textContent = "読み込み中…";
          msg.hidden = false;
        }
        return;
      }
      if (msg) {
        msg.textContent =
          "データに接続できません。Firebase 設定とネットワークを確認してください。";
        msg.hidden = false;
      }
      renderEmpty(
        root,
        "一覧を読み込めません。auth-config.js と Firebase を確認してください。",
      );
      return;
    }

    busy = true;
    if (msg) {
      msg.textContent = FEED_SUMMARY_TEXT;
      msg.hidden = false;
    }
    root.replaceChildren();

    try {
      const qs = db
        .collectionGroup("event_log_diaries")
        .where("visibility", "==", "public")
        .orderBy("updated_at", "desc")
        .limit(LIMIT);
      const snap = await qs.get();

      /** @type {{ uid: string; eventId: string; data: Record<string, unknown>; _author?: { name: string; avatar: string } }[]} */
      const rowsRaw = [];
      snap.forEach((doc) => {
        const pref = doc.ref.parent && doc.ref.parent.parent;
        const uid =
          pref &&
          pref.id &&
          typeof pref.path === "string" &&
          pref.path.startsWith("mll_profiles/")
            ? pref.id
            : null;
        if (!uid || !doc.id) return;
        rowsRaw.push({
          uid,
          eventId: doc.id,
          data: doc.data() || {},
        });
      });

      if (window.MarchinZMllRole?.reconcileDiariesParticipationFromLogs) {
        try {
          await window.MarchinZMllRole.reconcileDiariesParticipationFromLogs(db, rowsRaw);
        } catch (e) {
          console.warn("[MarchinZ] MLN reconcile participation_style from Log", e);
        }
      }

      const uids = [...new Set(rowsRaw.map((r) => r.uid))];
      const pmap = await loadProfilesMinimal(db, uids);
      cachedRows = rowsRaw
        .filter((r) => !pmap.get(r.uid)?.hide)
        .map((r) => ({
          ...r,
          _author: pmap.get(r.uid) || { name: "ユーザー", avatar: "" },
        }));

      paintCards();
      if (msg) msg.textContent = FEED_SUMMARY_TEXT;
    } catch (e) {
      const code = typeof e?.code === "string" ? e.code : "";
      console.warn("[MarchinZ] MLN feed", e);
      cachedRows = [];
      if (msg) {
        msg.textContent =
          code === "failed-precondition"
            ? "インデックスが必要です（collection group「event_log_diaries」の複合インデックス）。Firebase Console で作成してください。"
            : "一覧を読み込めませんでした。しばらくしてから試してください。";
      }
      const pe = document.createElement("p");
      pe.className = "mln-feed-empty mln-feed-empty--err";
      pe.textContent = code
        ? `エラーコード: ${code}`
        : "Firestore のクエリまたはルールを確認してください。";
      root.replaceChildren(pe);
    } finally {
      busy = false;
    }
  }

  let initialLoadDone = false;

  async function ensureInitialLoad() {
    if (initialLoadDone) return;
    initialLoadDone = true;
    const se = searchEl();
    if (se && !se.dataset.mlnSearchWired) {
      se.dataset.mlnSearchWired = "1";
      se.addEventListener("input", () => {
        searchQuery = String(se.value || "");
        paintCards();
      });
    }
    await refresh();
  }

  window.addEventListener("mll-auth-changed", () => {
    void refresh();
  });

  window.addEventListener("marchinz-profile-saved", () => {
    void refresh();
  });

  window.addEventListener("marchinz-mll-updated", () => {
    void refresh();
  });

  window.MarchinZMlnPublicFeed = { refresh, ensureInitialLoad };
})();
