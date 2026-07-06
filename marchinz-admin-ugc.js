/**
 * 運営 UGC フィード（#ugc/*）: 未読・既読は通知と同型
 */
(function () {
  "use strict";

  const UGC_TABS = /** @type {const} */ ([
    "signup",
    "event",
    "moment",
    "board",
    "board_reply",
    "note",
    "video_mylist",
    "yt_mylist",
    "video_search",
    "search_share",
    "mll_log",
  ]);

  const GUEST_ACTOR_UID = "mll_guest";

  const SHARE_CHANNEL_LABELS = /** @type {Record<string, string>} */ ({
    copy: "リンクをコピー",
    x: "X",
    line: "LINE",
    instagram: "Instagram",
    facebook: "Facebook",
  });

  let activeKind = "signup";
  let filterMode = "unread";
  /** @type {{ id: string; read: boolean }[]} */
  let feedState = [];

  function el(id) {
    const n = document.getElementById(id);
    return n instanceof HTMLElement ? n : null;
  }

  function getDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function getUser() {
    return window.MLL_AUTH?.getUser?.() || null;
  }

  function isAdminUi() {
    return Boolean(window.MLL_AUTH?.isAdmin?.());
  }

  function fmtYmd(isoOrYmd) {
    const s = String(isoOrYmd || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const p = s.slice(0, 10).split("-");
      return `${p[0]}/${p[1]}/${p[2]}`;
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s.slice(0, 10).replace(/-/g, "/");
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}/${m}/${day}`;
  }

  function setMsg(text, isErr) {
    const m = el("admin-ugc-msg");
    if (!m) return;
    m.textContent = text || "";
    m.hidden = !text;
    m.classList.toggle("ops-announcement-msg--err", Boolean(isErr));
  }

  function navigateHash(href) {
    const h = String(href || "").trim();
    if (!h) return;
    location.hash = h.startsWith("#") ? h.slice(1) : h;
  }

  /** @param {Record<string, unknown>} row */
  function targetPhrase(row) {
    const kind = String(row.kind || "");
    if (kind === "signup") return "ユーザー登録";
    if (kind === "event") {
      const ek = String(row.event_kind || "イベント").trim() || "イベント";
      const ed = fmtYmd(String(row.event_date || ""));
      const en = String(row.event_name || row.target_label || "イベント").trim() || "イベント";
      return `${ek} ${ed}の${en}`;
    }
    if (kind === "video_mylist") {
      const nm = String(row.target_label || "リスト").trim() || "リスト";
      return `大会動画マイリスト「${nm}」`;
    }
    if (kind === "yt_mylist") {
      const nm = String(row.target_label || "リスト").trim() || "リスト";
      return `YouTubeマイリスト「${nm}」`;
    }
    if (kind === "mll_log") {
      const ed = fmtYmd(String(row.event_date || ""));
      const en = String(row.event_name || row.target_label || "イベント").trim() || "イベント";
      return ed ? `${ed}の${en}` : en;
    }
    return String(row.target_label || "投稿").trim() || "投稿";
  }

  /** @param {Record<string, unknown>} row */
  function shareChannelLabel(row) {
    const fromTarget = String(row.target_label || "").trim();
    if (fromTarget) return fromTarget;
    const ch = String(row.share_channel || "").trim();
    return SHARE_CHANNEL_LABELS[ch] || ch || "シェア";
  }

  /** @param {Record<string, unknown>} row */
  function suffixVerb(row) {
    const kind = String(row.kind || "");
    const action = String(row.action || "create");
    if (kind === "signup") return "しました";
    if (kind === "event") return action === "delete" ? "を削除しました" : "を作成しました";
    if (kind === "moment") return "を投稿しました";
    if (kind === "board") return "を投稿しました";
    if (kind === "board_reply") return "に返信しました";
    if (kind === "note") return "を投稿しました";
    if (kind === "video_mylist") return "を作成しました";
    if (kind === "yt_mylist") return "を作成しました";
    if (kind === "mll_log") return "に MarchinZ Log を残しました";
    return "しました";
  }

  async function loadReadMap(db, adminUid, ids) {
    /** @type {Map<string, boolean>} */
    const map = new Map();
    if (!ids.length) return map;
    await Promise.all(
      ids.map(async (fid) => {
        try {
          const snap = await db
            .collection("mll_profiles")
            .doc(adminUid)
            .collection("admin_ugc_reads")
            .doc(fid)
            .get();
          map.set(fid, Boolean(snap.exists && snap.data()?.read === true));
        } catch {
          map.set(fid, false);
        }
      }),
    );
    return map;
  }

  async function markRead(feedId) {
    const db = getDb();
    const me = getUser();
    const fid = String(feedId || "").trim();
    if (!db || !me?.id || !fid) return;
    try {
      await db
        .collection("mll_profiles")
        .doc(me.id)
        .collection("admin_ugc_reads")
        .doc(fid)
        .set({ read: true, read_at: new Date().toISOString() }, { merge: true });
      const st = feedState.find((x) => x.id === fid);
      if (st) st.read = true;
      void refreshBadges();
    } catch (e) {
      console.warn("[MarchinZ] admin ugc markRead", e);
    }
  }

  /** @param {import("firebase").firestore.Firestore} db @param {string} kind */
  async function loadFeedRows(db, kind) {
    const snap = await db.collection("mll_admin_ugc_feed").where("kind", "==", kind).limit(120).get();
    /** @type {Record<string, unknown> & { id: string }[]} */
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...(d.data() || {}) }));
    rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return rows.slice(0, 80);
  }

  const BADGE_CACHE_KEY = "marchinz_admin_ugc_badge_v1";

  /** @returns {Record<string, number>|null} */
  function loadBadgeCache() {
    try {
      const raw = sessionStorage.getItem(BADGE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      /** @type {Record<string, number>} */
      const counts = {};
      for (const k of UGC_TABS) {
        const n = Number(parsed[k]);
        if (Number.isFinite(n) && n > 0) counts[k] = Math.floor(n);
      }
      return counts;
    } catch {
      return null;
    }
  }

  /** @param {Record<string, number>} counts */
  function saveBadgeCache(counts) {
    try {
      sessionStorage.setItem(BADGE_CACHE_KEY, JSON.stringify(counts));
    } catch {
      //
    }
  }

  /** @param {Record<string, number>} counts */
  function paintBadges(counts) {
    saveBadgeCache(counts);
    const total = UGC_TABS.reduce((s, k) => s + (counts[k] || 0), 0);
    document.querySelectorAll("[data-ugc-nav-badge]").forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (total > 0) {
        node.textContent = total > 99 ? "99+" : String(total);
        node.hidden = false;
      } else {
        node.hidden = true;
      }
    });
    document.querySelectorAll("[data-admin-ugc-badge]").forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const k = String(node.getAttribute("data-admin-ugc-badge") || "");
      const n = counts[k] || 0;
      if (n > 0) {
        node.textContent = n > 99 ? "99+" : String(n);
        node.hidden = false;
      } else {
        node.hidden = true;
      }
    });
  }

  /** @param {import("firebase").firestore.Firestore} db @param {string} adminUid @param {string} kind */
  async function countUnreadForKind(db, adminUid, kind) {
    const rows = await loadFeedRows(db, kind);
    if (!rows.length) return 0;
    const readMap = await loadReadMap(
      db,
      adminUid,
      rows.map((r) => String(r.id)),
    );
    return rows.filter((r) => readMap.get(String(r.id)) !== true).length;
  }

  /** @param {number|null|undefined} nextVal */
  function signupCountFromNext(nextVal) {
    const n = Number(nextVal);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.floor(n) - 101);
  }

  /** @param {number|null} count */
  function paintNavSignupCount(count) {
    const suffix = count == null ? "" : `【${count}】`;
    document.querySelectorAll("[data-ugc-nav-label]").forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.textContent = `UGC${suffix}`;
    });
  }

  async function refreshNavSignupCount() {
    if (!isAdminUi()) {
      paintNavSignupCount(null);
      return;
    }
    const db = getDb();
    const me = getUser();
    if (!db || !me?.id) {
      paintNavSignupCount(null);
      return;
    }
    try {
      const snap = await db.collection("mll_meta").doc("marchinz_public_id").get();
      const nextVal = snap.exists ? snap.data()?.next : null;
      paintNavSignupCount(signupCountFromNext(nextVal));
    } catch (e) {
      console.warn("[MarchinZ] admin ugc signup count", e);
      paintNavSignupCount(null);
    }
  }

  async function refreshBadges() {
    if (!isAdminUi()) {
      paintBadges({});
      return;
    }
    const cached = loadBadgeCache();
    if (cached) paintBadges(cached);
    const db = getDb();
    const me = getUser();
    if (!db || !me?.id) {
      if (!cached) paintBadges({});
      return;
    }
    /** @type {Record<string, number>} */
    const counts = {};
    await Promise.all(
      UGC_TABS.map(async (k) => {
        try {
          counts[k] = await countUnreadForKind(db, me.id, k);
        } catch {
          counts[k] = 0;
        }
      }),
    );
    paintBadges(counts);
  }

  function paintList(host, rows, readMap) {
    host.replaceChildren();
    feedState = rows.map((r) => ({
      id: String(r.id),
      read: readMap.get(String(r.id)) === true,
    }));

    const visible = rows.filter((r) => {
      const isRead = readMap.get(String(r.id)) === true;
      return filterMode === "read" ? isRead : !isRead;
    });

    const empty = el("admin-ugc-empty");
    if (empty) {
      empty.textContent =
        filterMode === "unread" ? "未読の UGC はありません" : "既読の UGC はありません";
      empty.hidden = visible.length > 0;
    }

    for (const row of visible) {
      const fid = String(row.id);
      const isRead = readMap.get(fid) === true;
      const article = document.createElement("article");
      article.className = "user-prof-notif admin-ugc-item" + (isRead ? "" : " user-prof-notif--unread");
      article.dataset.adminUgcId = fid;
      if (isRead) article.dataset.mzRead = "1";

      const body = document.createElement("div");
      body.className = "user-prof-notif-body admin-ugc-body";

      const line = document.createElement("p");
      line.className = "user-prof-notif-line1 admin-ugc-line";

      line.appendChild(document.createTextNode(`${fmtYmd(String(row.created_at || ""))}に `));

      const actorUid = String(row.actor_uid || "").trim();
      const isGuestActor =
        actorUid === GUEST_ACTOR_UID || String(row.actor_name || "").trim() === "ゲスト";
      const actorName = `${String(row.actor_name || "ユーザー").trim()}さん`;
      if (!isGuestActor && actorUid) {
        const actorLink = document.createElement("a");
        actorLink.className = "user-prof-notif-actor";
        actorLink.href = `#profile?uid=${encodeURIComponent(actorUid)}`;
        actorLink.textContent = actorName;
        actorLink.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void markRead(fid).then(() => navigateHash(actorLink.getAttribute("href") || ""));
        });
        line.appendChild(actorLink);
      } else {
        const actorSpan = document.createElement("span");
        actorSpan.className = "user-prof-notif-actor";
        actorSpan.textContent = actorName;
        line.appendChild(actorSpan);
      }

      const rowKind = String(row.kind || "");
      const searchHref = String(row.target_href || "#videos").trim() || "#videos";
      const searchHash = searchHref.startsWith("#") ? searchHref : `#${searchHref}`;
      const searchQuery = String(row.search_query || row.target_label || "").trim();

      if (rowKind === "signup") {
        const pid = String(row.public_id || "").trim();
        if (pid) {
          line.appendChild(document.createTextNode(`（ユーザー番号 ${pid}）`));
        }
      }

      if (rowKind === "video_search") {
        line.appendChild(document.createTextNode("が "));
        if (searchQuery) {
          const queryLink = document.createElement("a");
          queryLink.className = "admin-ugc-target-link";
          queryLink.href = searchHash;
          queryLink.textContent = searchQuery;
          queryLink.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void markRead(fid).then(() => navigateHash(queryLink.getAttribute("href") || ""));
          });
          line.appendChild(queryLink);
        }
        line.appendChild(document.createTextNode("で検索しました"));
      } else if (rowKind === "search_share") {
        line.appendChild(document.createTextNode("が "));
        if (searchQuery) {
          const queryLink = document.createElement("a");
          queryLink.className = "admin-ugc-target-link";
          queryLink.href = searchHash;
          queryLink.textContent = searchQuery;
          queryLink.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void markRead(fid).then(() => navigateHash(queryLink.getAttribute("href") || ""));
          });
          line.appendChild(queryLink);
        }
        line.appendChild(document.createTextNode("の結果を"));
        const channelLabel = shareChannelLabel(row);
        line.appendChild(document.createTextNode(channelLabel));
        line.appendChild(document.createTextNode("でシェアしました"));
      } else {
        line.appendChild(document.createTextNode("が "));

        const targetLink = document.createElement("a");
        targetLink.className = "admin-ugc-target-link";
        const href = String(row.target_href || "#").trim() || "#";
        targetLink.href = href.startsWith("#") ? href : `#${href}`;
        targetLink.textContent = targetPhrase(row);
        targetLink.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void markRead(fid).then(() => navigateHash(targetLink.getAttribute("href") || ""));
        });
        line.appendChild(targetLink);
        line.appendChild(document.createTextNode(suffixVerb(row)));
      }

      body.appendChild(line);
      article.appendChild(body);

      article.addEventListener("click", () => {
        void markRead(fid).then(() => {
          article.classList.remove("user-prof-notif--unread");
          article.dataset.mzRead = "1";
        });
      });

      host.appendChild(article);
    }
  }

  async function refresh() {
    const host = el("admin-ugc-list");
    if (!host) return;
    if (!isAdminUi()) {
      host.replaceChildren();
      setMsg("管理者のみ利用できます。", true);
      paintBadges({});
      return;
    }
    const db = getDb();
    const me = getUser();
    if (!db || !me?.id) {
      setMsg("ログインしてください。", true);
      return;
    }
    void refreshBadges();
    void refreshNavSignupCount();
    setMsg("読み込み中…");
    try {
      const rows = await loadFeedRows(db, activeKind);
      const ids = rows.map((r) => String(r.id));
      const readMap = await loadReadMap(db, me.id, ids);
      paintList(host, rows, readMap);
      setMsg("");
      void refreshBadges();
      void refreshNavSignupCount();
    } catch (e) {
      console.warn(e);
      const code = String(e?.code || "");
      setMsg(
        code === "permission-denied"
          ? "UGC フィードを読み取る権限がありません。"
          : "一覧を読み込めませんでした。",
        true,
      );
    }
  }

  function syncKindTabUi() {
    document.querySelectorAll("[data-admin-ugc-kind]").forEach((btn) => {
      const k = String(btn.getAttribute("data-admin-ugc-kind") || "");
      btn.setAttribute("aria-selected", k === activeKind ? "true" : "false");
    });
  }

  function wireSubTabs() {
    document.querySelectorAll("[data-admin-ugc-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = String(btn.getAttribute("data-admin-ugc-kind") || "");
        if (!UGC_TABS.includes(k)) return;
        activeKind = k;
        syncKindTabUi();
        const nextHash = `ugc/${k}`;
        if (location.hash.replace(/^#/, "") !== nextHash) {
          location.hash = nextHash;
        } else {
          void refresh();
        }
      });
    });
  }

  function wireFilters() {
    const host = el("admin-ugc-filters");
    if (!host || host.dataset.wired) return;
    host.dataset.wired = "1";
    host.addEventListener("click", (ev) => {
      const btn = ev.target instanceof HTMLElement ? ev.target.closest("[data-admin-ugc-filter]") : null;
      if (!btn) return;
      const mode = String(btn.getAttribute("data-admin-ugc-filter") || "");
      if (mode !== "unread" && mode !== "read") return;
      filterMode = mode;
      host.querySelectorAll("[data-admin-ugc-filter]").forEach((b) => {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      void refresh();
    });
  }

  window.MarchinZAdminUgc = {
    refresh,
    refreshBadges,
    refreshNavSignupCount,
    setKind(kind) {
      if (!UGC_TABS.includes(kind)) return;
      activeKind = kind;
      syncKindTabUi();
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    wireSubTabs();
    wireFilters();
  });

  document.addEventListener("mll-auth-changed", () => {
    void refreshBadges();
    void refreshNavSignupCount();
  });

  document.addEventListener("marchinz-admin-ugc-recorded", () => {
    void refreshBadges();
  });
})();
