/**
 * 運営 UGC フィード（#ugc/* と #ugc-tools）: 未読・既読は通知と同型。
 * tool_use は独立ページ「UGC（ツール）」(#ugc-tools) で扱う(v1.36.7)。
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

  // ツール使用状況サマリー用: tool_id → 表示名・FAアイコン(モノクロ)。順序は表示順
  const TOOL_META = /** @type {const} */ ([
    ["metronome", "メトロノーム", "fa-stopwatch"],
    ["tuner", "チューナー", "fa-wave-square"],
    ["privacy", "Privacy", "fa-user-shield"],
    ["switcher", "Switcher", "fa-clapperboard"],
    ["reangle", "ReAngle", "fa-crop-simple"],
  ]);
  /** tool_use サマリーの全期間集計を1セッション内でキャッシュ(タブ往復での再取得を防ぐ) */
  let toolSummaryCache = null;

  // UGCダッシュボード用: kind → 表示名・FAアイコン(モノクロ)。表示順=この順
  const UGC_KIND_META = /** @type {const} */ ([
    ["signup", "ユーザー登録", "fa-user-plus"],
    ["event", "イベント", "fa-calendar-days"],
    ["moment", "モーメント", "fa-image"],
    ["board", "掲示板", "fa-comments"],
    ["board_reply", "掲示板返信", "fa-reply"],
    ["note", "ノート", "fa-note-sticky"],
    ["mll_log", "MarchinZ Log", "fa-book"],
    ["video_mylist", "大会動画マイリスト", "fa-list"],
    ["yt_mylist", "YouTubeマイリスト", "fa-list-ul"],
    ["video_search", "大会動画検索", "fa-magnifying-glass"],
    ["search_share", "検索結果シェア", "fa-share-nodes"],
  ]);
  /** 全kindフィード(直近2000件)の1セッションキャッシュ(UGCダッシュボード用) */
  let allFeedCache = null;

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

  /* 「いつ」を分まで出す(2026-08-04 優さん指示「時間も時間と分まで表示」)。
     ★ fmtYmd は流用しない ─ あちらはイベント日付(日付だけの値)にも使われていて、
       時刻を足すと「2026/08/04 00:00のイベント」のような嘘になる。
       こちらは created_at(ISO日時)専用。時刻が読めない値なら日付だけに落とす */
  function fmtYmdHm(iso) {
    const s = String(iso || "").trim();
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return fmtYmd(s);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} `
      + `${p(d.getHours())}:${p(d.getMinutes())}`;
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
    if (kind === "tool_use") {
      return String(row.target_label || "ツール").trim() || "ツール";
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
    if (kind === "tool_use") return "を使いました";
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

  /* ★ 管理者自身の操作は伏せる(2026-08-04 優さん指示「ugcは管理者権限のは
     表示しないように」)。UGCは「実際の利用者が何をしたか」を見る場所で、
     運営が動作確認で触ったぶんが混ざると一覧もダッシュボードの数も濁る。
     判定は actor_uid が「いま見ている管理者自身」かどうかだけ。
     ★ 記録側に actor_admin のような印を足す案は採らない ─ firestore.rules の
       adminUgcFeedAllowedKeys() が hasOnly なので、許可リストに無いキーを足すと
       **書き込みごと無音で拒否される**(mll_profiles で踏んだ罠と同型)。
       管理者は auth-config.js の adminEmails=1人なので、uid 判定で足りる。
     消さずに伏せるだけ。読み込みの3経路すべてをここに通す */
  function dropAdminRows(rows) {
    const meUid = String(getUser()?.id || "").trim();
    if (!meUid) return rows;
    return rows.filter((r) => String(r.actor_uid || "").trim() !== meUid);
  }

  /** @param {import("firebase").firestore.Firestore} db @param {string} kind */
  async function loadFeedRows(db, kind) {
    const snap = await db.collection("mll_admin_ugc_feed").where("kind", "==", kind).limit(120).get();
    /** @type {Record<string, unknown> & { id: string }[]} */
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...(d.data() || {}) }));
    rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return dropAdminRows(rows).slice(0, 80);
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

      line.appendChild(document.createTextNode(`${fmtYmdHm(String(row.created_at || ""))}に `));

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
        // tool_use のツールページは "/tools/…"(ハッシュ外の別ページ)なのでそのまま遷移する
        const isPagePath = href.startsWith("/");
        targetLink.href = isPagePath || href.startsWith("#") ? href : `#${href}`;
        targetLink.textContent = targetPhrase(row);
        targetLink.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void markRead(fid).then(() => {
            const h = targetLink.getAttribute("href") || "";
            if (h.startsWith("/")) {
              window.location.href = h;
            } else {
              navigateHash(h);
            }
          });
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

  /**
   * ツール使用サマリー用に tool_use を多めに取得(集計は全期間・既読未読を問わない)。
   * 1セッションはキャッシュし、tool_use の新規記録でのみ破棄する。
   * @param {import("firebase").firestore.Firestore} db
   */
  async function loadToolUseSummaryRows(db) {
    if (toolSummaryCache) return toolSummaryCache;
    const snap = await db
      .collection("mll_admin_ugc_feed")
      .where("kind", "==", "tool_use")
      .limit(2000)
      .get();
    /** @type {Record<string, unknown>[]} */
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...(d.data() || {}) }));
    toolSummaryCache = dropAdminRows(rows);   // 管理者ぶんを除く(上の dropAdminRows 参照)
    return toolSummaryCache;
  }

  /**
   * 全kindのフィードを created_at 降順で直近2000件取得(UGCダッシュボード用)。
   * 1セッションはキャッシュし、新規記録イベントで破棄する。
   * @param {import("firebase").firestore.Firestore} db
   */
  async function loadAllFeedRows(db) {
    if (allFeedCache) return allFeedCache;
    const snap = await db
      .collection("mll_admin_ugc_feed")
      .orderBy("created_at", "desc")
      .limit(2000)
      .get();
    /** @type {Record<string, unknown>[]} */
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...(d.data() || {}) }));
    allFeedCache = dropAdminRows(rows);       // 管理者ぶんを除く(同上)
    return allFeedCache;
  }

  /** UGCページのダッシュボード(投稿系のみ=tool_use除外) */
  async function renderUgcDash(db) {
    const host = el("admin-ugc-dash");
    if (!host || !window.MarchinZAdminDash) return;
    try {
      const rows = (await loadAllFeedRows(db)).filter((r) => String(r.kind || "") !== "tool_use");
      window.MarchinZAdminDash.render(host, rows, {
        key: "ugc",
        categories: UGC_KIND_META,
        catOf: (r) => String(r.kind || ""),
      });
    } catch (e) {
      console.warn("[MarchinZ] ugc dash", e);
      host.replaceChildren();
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
    void renderUgcDash(db);
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

  // ───────────────────────────────────────────────
  // 独立ページ「UGC（ツール）」(#ugc-tools): tool_use 専用の一覧+サマリー+一括既読
  // ───────────────────────────────────────────────

  /** @type {"unread"|"read"} */
  let toolsFilterMode = "unread";

  function setToolsMsg(text, isErr) {
    const m = el("admin-ugc-tools-msg");
    if (!m) return;
    m.textContent = text || "";
    m.hidden = !text;
    m.classList.toggle("ops-announcement-msg--err", Boolean(isErr));
  }

  /** ナビの「UGC（ツール）」バッジ(tool_use 未読数)を更新 */
  async function refreshToolsBadge() {
    const paint = (n) => {
      document.querySelectorAll("[data-ugc-tools-nav-badge]").forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (n > 0) {
          node.textContent = n > 99 ? "99+" : String(n);
          node.hidden = false;
        } else {
          node.hidden = true;
        }
      });
    };
    if (!isAdminUi()) {
      paint(0);
      return;
    }
    const db = getDb();
    const me = getUser();
    if (!db || !me?.id) {
      paint(0);
      return;
    }
    try {
      paint(await countUnreadForKind(db, me.id, "tool_use"));
    } catch {
      paint(0);
    }
  }

  /** tool_use 専用の一覧描画(未読/既読フィルタは toolsFilterMode) */
  function paintToolsList(host, rows, readMap) {
    host.replaceChildren();
    feedState = rows.map((r) => ({
      id: String(r.id),
      read: readMap.get(String(r.id)) === true,
    }));

    const visible = rows.filter((r) => {
      const isRead = readMap.get(String(r.id)) === true;
      return toolsFilterMode === "read" ? isRead : !isRead;
    });

    const empty = el("admin-ugc-tools-empty");
    if (empty) {
      empty.textContent =
        toolsFilterMode === "unread" ? "未読のツール利用はありません" : "既読のツール利用はありません";
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
      line.appendChild(document.createTextNode(`${fmtYmdHm(String(row.created_at || ""))}に `));

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
          void markRead(fid).then(() => {
            void refreshToolsBadge();
            navigateHash(actorLink.getAttribute("href") || "");
          });
        });
        line.appendChild(actorLink);
      } else {
        const actorSpan = document.createElement("span");
        actorSpan.className = "user-prof-notif-actor";
        actorSpan.textContent = actorName;
        line.appendChild(actorSpan);
      }

      line.appendChild(document.createTextNode("が "));
      const targetLink = document.createElement("a");
      targetLink.className = "admin-ugc-target-link";
      const href = String(row.target_href || "#").trim() || "#";
      const isPagePath = href.startsWith("/");
      targetLink.href = isPagePath || href.startsWith("#") ? href : `#${href}`;
      targetLink.textContent = targetPhrase(row);
      targetLink.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void markRead(fid).then(() => {
          void refreshToolsBadge();
          const h = targetLink.getAttribute("href") || "";
          if (h.startsWith("/")) {
            window.location.href = h;
          } else {
            navigateHash(h);
          }
        });
      });
      line.appendChild(targetLink);
      line.appendChild(document.createTextNode("を使いました"));

      body.appendChild(line);
      article.appendChild(body);
      article.addEventListener("click", () => {
        void markRead(fid).then(() => {
          article.classList.remove("user-prof-notif--unread");
          article.dataset.mzRead = "1";
          void refreshToolsBadge();
        });
      });
      host.appendChild(article);
    }
  }

  async function toolsRefresh() {
    const host = el("admin-ugc-tools-list");
    if (!host) return;
    if (!isAdminUi()) {
      host.replaceChildren();
      setToolsMsg("管理者のみ利用できます。", true);
      return;
    }
    const db = getDb();
    const me = getUser();
    if (!db || !me?.id) {
      setToolsMsg("ログインしてください。", true);
      return;
    }
    setToolsMsg("読み込み中…");
    try {
      const dashHost = el("admin-ugc-tools-dash");
      if (dashHost && window.MarchinZAdminDash) {
        try {
          window.MarchinZAdminDash.render(dashHost, await loadToolUseSummaryRows(db), {
            key: "tools",
            categories: TOOL_META,
            catOf: (r) => String(r.tool_id || ""),
          });
        } catch (e) {
          console.warn("[MarchinZ] tools dash", e);
          dashHost.replaceChildren();
        }
      }
      const rows = await loadFeedRows(db, "tool_use");
      const readMap = await loadReadMap(db, me.id, rows.map((r) => String(r.id)));
      paintToolsList(host, rows, readMap);
      setToolsMsg("");
      void refreshToolsBadge();
    } catch (e) {
      console.warn(e);
      const code = String(e?.code || "");
      setToolsMsg(
        code === "permission-denied"
          ? "UGC フィードを読み取る権限がありません。"
          : "一覧を読み込めませんでした。",
        true,
      );
    }
  }

  /** tool_use を全期間(直近2000件)まとめて既読化。ルール上 {read, read_at} のみ書ける */
  async function markAllToolsRead() {
    const db = getDb();
    const me = getUser();
    if (!db || !me?.id || !isAdminUi()) return;
    if (!window.confirm("ツール利用の記録をすべて既読にしますか？")) return;
    const btn = el("admin-ugc-tools-allread");
    if (btn instanceof HTMLButtonElement) btn.disabled = true;
    setToolsMsg("既読にしています…");
    try {
      const rows = await loadToolUseSummaryRows(db);
      const now = new Date().toISOString();
      const col = db.collection("mll_profiles").doc(me.id).collection("admin_ugc_reads");
      for (let i = 0; i < rows.length; i += 400) {
        const batch = db.batch();
        rows.slice(i, i + 400).forEach((r) => {
          batch.set(col.doc(String(r.id)), { read: true, read_at: now }, { merge: true });
        });
        await batch.commit();
      }
      setToolsMsg(`${rows.length} 件を既読にしました。`);
      void refreshToolsBadge();
      void toolsRefresh();
    } catch (e) {
      console.warn("[MarchinZ] tools mark all read", e);
      setToolsMsg("既読にできませんでした。", true);
    } finally {
      if (btn instanceof HTMLButtonElement) btn.disabled = false;
    }
  }

  function wireTools() {
    const filters = el("admin-ugc-tools-filters");
    if (filters && !filters.dataset.wired) {
      filters.dataset.wired = "1";
      filters.addEventListener("click", (ev) => {
        const btn =
          ev.target instanceof HTMLElement ? ev.target.closest("[data-admin-ugc-tools-filter]") : null;
        if (!btn) return;
        const mode = String(btn.getAttribute("data-admin-ugc-tools-filter") || "");
        if (mode !== "unread" && mode !== "read") return;
        toolsFilterMode = mode;
        filters.querySelectorAll("[data-admin-ugc-tools-filter]").forEach((b) => {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        void toolsRefresh();
      });
    }
    const allread = el("admin-ugc-tools-allread");
    if (allread && !allread.dataset.wired) {
      allread.dataset.wired = "1";
      allread.addEventListener("click", () => void markAllToolsRead());
    }
  }

  // ───────────────────────────────────────────────
  // Google アナリティクス(イベント数)(2026-08-06 優さん指示)
  // GA4 Data API を管理者の Google アカウントの読み取り権限で叩く。
  // ナビの「UGC（ツール）【N】」は UGC【登録者数】と同型で、全期間の合計イベント数。
  // トークンは1時間で切れるため、最後に取れた合計を localStorage に控えて
  // ラベルは常にそこから描く(接続していないセッションでも直近値が出る)。
  // ───────────────────────────────────────────────

  const GA_MEASUREMENT_ID = "G-7D0TGBLTP7";
  const GA_LS = {
    client: "mz_ga_oauth_client_id",
    prop: "mz_ga_property_id",
    cache: "mz_ga_event_cache_v1",
  };
  const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
  /** @type {{token:string, at:number}|null} */
  let gaToken = null;
  let gaRange = "all";

  function gaLsGet(key) {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  }
  function gaLsSet(key, val) {
    try { val ? localStorage.setItem(key, val) : localStorage.removeItem(key); } catch { /* 満杯でも死なない */ }
  }
  function gaReadCache() {
    try { return JSON.parse(gaLsGet(GA_LS.cache) || "null"); } catch { return null; }
  }

  /** ナビの「UGC（ツール）」に全期間の合計イベント数を差す(UGC【N】と同型) */
  function paintToolsNavEventCount(count) {
    const suffix = count == null ? "" : `【${Number(count).toLocaleString("ja-JP")}】`;
    document.querySelectorAll("[data-ugc-tools-nav-label]").forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.textContent = `UGC（ツール）${suffix}`;
    });
  }
  function paintToolsNavEventCountFromCache() {
    if (!isAdminUi()) { paintToolsNavEventCount(null); return; }
    const c = gaReadCache();
    paintToolsNavEventCount(c && Number.isFinite(Number(c.allTotal)) ? Number(c.allTotal) : null);
  }

  function setGaMsg(text, isErr) {
    const m = el("admin-ugc-ga-msg");
    if (!m) return;
    m.textContent = text || "";
    m.hidden = !text;
    m.classList.toggle("ops-announcement-msg--err", Boolean(isErr));
  }

  /** Google Identity Services を必要になった時だけ読み込む */
  function gaEnsureGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Google の認証スクリプトを読み込めませんでした"));
      document.head.appendChild(s);
    });
  }

  /** アクセストークンを取る(50分は使い回す)。初回はGoogleの同意画面が開く */
  async function gaGetToken() {
    if (gaToken && Date.now() - gaToken.at < 50 * 60 * 1000) return gaToken.token;
    const clientId = gaLsGet(GA_LS.client);
    if (!clientId) throw new Error("NO_CLIENT");
    await gaEnsureGis();
    return await new Promise((resolve, reject) => {
      try {
        const tc = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: GA_SCOPE,
          callback: (resp) => {
            if (resp && resp.access_token) {
              gaToken = { token: resp.access_token, at: Date.now() };
              resolve(resp.access_token);
            } else {
              reject(new Error(String(resp?.error || "トークンを取得できませんでした")));
            }
          },
          error_callback: (err) => reject(new Error(String(err?.type || "認証がキャンセルされました"))),
        });
        tc.requestAccessToken({ prompt: "" });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  async function gaApi(url, token, body) {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GA API ${res.status}: ${detail.slice(0, 200)}`);
    }
    return res.json();
  }

  /** 測定ID G-… からプロパティ(数値ID)を探す。見つけたら控えて以後は使い回す */
  async function gaDiscoverProperty(token) {
    const cached = gaLsGet(GA_LS.prop);
    if (cached) return cached;
    const sums = await gaApi(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
      token,
    );
    const props = [];
    for (const a of sums.accountSummaries || []) {
      for (const p of a.propertySummaries || []) props.push(String(p.property || ""));
    }
    for (const prop of props) {
      if (!prop) continue;
      try {
        const streams = await gaApi(
          `https://analyticsadmin.googleapis.com/v1beta/${prop}/dataStreams?pageSize=50`,
          token,
        );
        const hit = (streams.dataStreams || []).some(
          (s) => String(s?.webStreamData?.measurementId || "") === GA_MEASUREMENT_ID,
        );
        if (hit) {
          const id = prop.replace(/^properties\//, "");
          gaLsSet(GA_LS.prop, id);
          return id;
        }
      } catch { /* 権限の無いプロパティは飛ばす */ }
    }
    throw new Error(`このアカウントから測定ID ${GA_MEASUREMENT_ID} のプロパティが見つかりません`);
  }

  function gaStartDate(range) {
    if (range === "7d") return "7daysAgo";
    if (range === "28d") return "28daysAgo";
    return "2020-01-01";   // 全期間(サイト開設より十分前)
  }

  async function gaRunReport(token, propId, range) {
    const body = {
      dateRanges: [{ startDate: gaStartDate(range), endDate: "today" }],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      orderBys: [{ desc: true, metric: { metricName: "eventCount" } }],
      limit: 250,
      metricAggregations: ["TOTAL"],
    };
    const data = await gaApi(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runReport`,
      token, body,
    );
    const rows = (data.rows || []).map((r) => ({
      name: String(r.dimensionValues?.[0]?.value || ""),
      count: Number(r.metricValues?.[0]?.value || 0),
    }));
    const total = Number(data.totals?.[0]?.metricValues?.[0]?.value || 0)
      || rows.reduce((s, r) => s + r.count, 0);
    return { rows, total };
  }

  /* イベント名 → 人が読める機能名。GA の生の名前(signup_complete 等)は
     運営が毎回頭の中で翻訳していたので、辞書で置き換える。
     ★ 表に無い名前は生のまま出す(黙って捨てない) */
  const GA_EVENT_LABELS = {
    mz_route_view: "ページを見た",
    page_view: "ページを見た(GA標準)",
    mz_core_engagement_start: "じっくり読み始めた",
    mz_core_engagement_pulse: "読み続けている",
    signup_complete: "新規登録の完了",
    signup_consent_blocked: "登録の同意で止まった",
    login_success: "ログイン成功",
    login_start: "ログイン開始",
    login_error: "ログイン失敗",
    login_action: "ログイン操作",
    legal_policy_accept: "規約に同意",
    b_test_consent_accept: "βテストに同意",
    b_test_gate_signout: "βの入口からログアウト",
    profile_tab_view: "マイページのタブを見た",
    community_post_submit: "掲示板に投稿",
    community_reply_submit: "掲示板に返信",
    community_search_run: "コミュニティ内を検索",
    moment_save_success: "モーメントを投稿",
    note_save_success: "MarchinZ Note を保存",
    search_result_view: "検索結果を見た",
    search_result_empty: "検索が0件だった",
    report_submit: "通報",
    rate_limit_hit: "投稿の速度制限に当たった",
    account_withdraw_complete: "退会",
    account_banned_view: "凍結の案内を見た",
  };
  /* 「機能」として数えないもの(ページ表示・滞在は機能の人気ではない)。
     TOP3 はここを除いた実際の操作だけで決める */
  const GA_NOT_FEATURE = new Set([
    "mz_route_view", "page_view", "mz_core_engagement_start",
    "mz_core_engagement_pulse", "user_engagement", "session_start",
    "first_visit", "scroll", "form_start", "form_submit",
  ]);
  const gaLabel = name => GA_EVENT_LABELS[name] || name;

  /** 人気の機能TOP3。ページ表示・滞在は除いた「操作」だけで順位を作る */
  function paintGaTop(rows, range) {
    const host = el("admin-ugc-ga-top");
    if (!host) return;
    host.replaceChildren();
    const feats = rows.filter(r => !GA_NOT_FEATURE.has(r.name) && r.count > 0);
    if (!feats.length) {
      const p = document.createElement("p");
      p.className = "user-profile-empty";
      p.textContent = "この期間に使われた機能はまだありません";
      host.appendChild(p);
      return;
    }
    const top = feats.slice(0, 3);          // rows は件数の降順で来る
    const max = top[0].count || 1;
    const label = range === "7d" ? "7日" : range === "28d" ? "28日" : "全期間";
    const cap = document.createElement("p");
    cap.className = "admin-ugc-ga-cap";
    cap.textContent = `${label}でよく使われた機能`;
    host.appendChild(cap);
    const medals = ["fa-trophy", "fa-medal", "fa-award"];
    top.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = `mz-ga-top mz-ga-top--${i + 1}`;
      const rank = document.createElement("span");
      rank.className = "mz-ga-top-rank";
      rank.innerHTML = `<i class="fa-solid ${medals[i]}" aria-hidden="true"></i>`
        + `<b>${i + 1}</b>`;
      const body = document.createElement("span");
      body.className = "mz-ga-top-body";
      const nm = document.createElement("span");
      nm.className = "mz-ga-top-name";
      nm.textContent = gaLabel(r.name);
      const bar = document.createElement("span");
      bar.className = "mz-ga-top-bar";
      const fill = document.createElement("span");
      fill.className = "mz-ga-top-fill";
      /* 1位を100%とした相対の長さ。数字だけより「どれだけ差があるか」が一目で分かる */
      fill.style.width = `${Math.max(6, Math.round((r.count / max) * 100))}%`;
      bar.appendChild(fill);
      body.append(nm, bar);
      const n = document.createElement("span");
      n.className = "mz-ga-top-count";
      n.textContent = r.count.toLocaleString("ja-JP");
      row.append(rank, body, n);
      host.appendChild(row);
    });
    /* 全体に占める割合を1行だけ。ここが低いなら「一部の機能に偏っていない」 */
    const sum = feats.reduce((s, r) => s + r.count, 0);
    const share = sum > 0 ? Math.round((top.reduce((s, r) => s + r.count, 0) / sum) * 100) : 0;
    const foot = document.createElement("p");
    foot.className = "mz-ga-top-foot";
    foot.textContent = `TOP3で機能の使用の ${share}%（機能の種類は ${feats.length} 個）`;
    host.appendChild(foot);
  }

  function paintGaTable(rows, total, range, fetchedAt) {
    const host = el("admin-ugc-ga-table");
    if (!host) return;
    host.replaceChildren();
    if (!rows.length) {
      const p = document.createElement("p");
      p.className = "user-profile-empty";
      p.textContent = "この期間のイベントはありません";
      host.appendChild(p);
      return;
    }
    const label = range === "7d" ? "7日" : range === "28d" ? "28日" : "全期間";
    const cap = document.createElement("p");
    cap.className = "admin-ugc-ga-cap";
    cap.textContent = `${label}の合計 ${total.toLocaleString("ja-JP")} 件` +
      (fetchedAt ? `（${new Date(fetchedAt).toLocaleString("ja-JP")} 取得）` : "");
    host.appendChild(cap);
    const table = document.createElement("table");
    for (const r of rows) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      td1.textContent = gaLabel(r.name);
      const td2 = document.createElement("td");
      td2.textContent = r.count.toLocaleString("ja-JP");
      tr.append(td1, td2);
      table.appendChild(tr);
    }
    host.appendChild(table);
  }

  function gaSyncSetupUi() {
    const setup = el("admin-ugc-ga-setup");
    if (setup) setup.hidden = Boolean(gaLsGet(GA_LS.client));
  }

  async function gaFetchAndRender() {
    const btn = el("admin-ugc-ga-connect");
    try {
      if (!gaLsGet(GA_LS.client)) {
        gaSyncSetupUi();
        setGaMsg("先に上のクライアントIDを保存してください", true);
        return;
      }
      if (btn) btn.disabled = true;
      setGaMsg("Google アナリティクスから取得しています…");
      const token = await gaGetToken();
      const propId = await gaDiscoverProperty(token);
      const view = await gaRunReport(token, propId, gaRange);
      /* ナビ用の全期間合計。表示中の期間が全期間ならそれを使い、
         別の期間を見ている回だけ追加で1本取る */
      const allTotal = gaRange === "all"
        ? view.total
        : (await gaRunReport(token, propId, "all")).total;
      const at = Date.now();
      gaLsSet(GA_LS.cache, JSON.stringify({ allTotal, at }));
      paintGaTop(view.rows, gaRange);
      paintGaTable(view.rows, view.total, gaRange, at);
      paintToolsNavEventCount(allTotal);
      setGaMsg("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "NO_CLIENT") {
        gaSyncSetupUi();
        setGaMsg("先に上のクライアントIDを保存してください", true);
      } else {
        console.warn("[MarchinZ] admin ugc GA", e);
        setGaMsg(`取得できませんでした: ${msg}`, true);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireGa() {
    gaSyncSetupUi();
    const save = el("admin-ugc-ga-save-client");
    if (save && !save.dataset.wired) {
      save.dataset.wired = "1";
      save.addEventListener("click", () => {
        const input = el("admin-ugc-ga-client-id");
        const v = input instanceof HTMLInputElement ? input.value.trim() : "";
        if (!/\.apps\.googleusercontent\.com$/.test(v)) {
          setGaMsg("クライアントIDの形式が違います(….apps.googleusercontent.com)", true);
          return;
        }
        gaLsSet(GA_LS.client, v);
        gaSyncSetupUi();
        setGaMsg("保存しました。「GAから取得」を押してください");
      });
    }
    const connect = el("admin-ugc-ga-connect");
    if (connect && !connect.dataset.wired) {
      connect.dataset.wired = "1";
      connect.addEventListener("click", () => void gaFetchAndRender());
    }
    const ranges = el("admin-ugc-ga-ranges");
    if (ranges && !ranges.dataset.wired) {
      ranges.dataset.wired = "1";
      ranges.addEventListener("click", (ev) => {
        const btn = ev.target instanceof HTMLElement ? ev.target.closest("[data-admin-ugc-ga-range]") : null;
        if (!btn) return;
        const r = String(btn.getAttribute("data-admin-ugc-ga-range") || "all");
        gaRange = r === "7d" || r === "28d" ? r : "all";
        ranges.querySelectorAll("[data-admin-ugc-ga-range]").forEach((b) => {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        /* 期間の切替は、接続済み(トークンあり)なら即取り直す。未接続なら押した時 */
        if (gaToken) void gaFetchAndRender();
      });
    }
    const reset = el("admin-ugc-ga-reset");
    if (reset && !reset.dataset.wired) {
      reset.dataset.wired = "1";
      reset.addEventListener("click", () => {
        gaLsSet(GA_LS.client, "");
        gaLsSet(GA_LS.prop, "");
        gaToken = null;
        gaSyncSetupUi();
        setGaMsg("接続設定を消しました。クライアントIDから設定し直してください");
      });
    }
  }

  window.MarchinZAdminUgcTools = {
    refresh: toolsRefresh,
    refreshBadge: refreshToolsBadge,
  };

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
    wireTools();
    wireGa();
    paintToolsNavEventCountFromCache();
  });

  document.addEventListener("mll-auth-changed", () => {
    void refreshBadges();
    void refreshNavSignupCount();
    void refreshToolsBadge();
    paintToolsNavEventCountFromCache();
  });

  document.addEventListener("marchinz-admin-ugc-recorded", (e) => {
    const kind = e instanceof CustomEvent ? String(e.detail?.kind || "") : "";
    allFeedCache = null;
    if (kind === "tool_use") {
      toolSummaryCache = null;
      void refreshToolsBadge();
    }
    void refreshBadges();
  });
})();
