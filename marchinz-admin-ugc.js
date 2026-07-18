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
    toolSummaryCache = rows;
    return rows;
  }

  /** @param {Record<string, unknown>[]} rows */
  function aggregateToolRows(rows) {
    const now = Date.now();
    const todayStr = new Date().toLocaleDateString("sv-SE"); // ローカルの YYYY-MM-DD
    /** @type {Record<string, { all: number; today: number; d7: number; d30: number; users: Set<string>; guest: number }>} */
    const per = {};
    TOOL_META.forEach(([id]) => {
      per[id] = { all: 0, today: 0, d7: 0, d30: 0, users: new Set(), guest: 0 };
    });
    rows.forEach((r) => {
      const id = String(r.tool_id || "").trim();
      const p = per[id];
      if (!p) return;
      p.all += 1;
      const t = Date.parse(String(r.created_at || "")) || 0;
      if (t) {
        if (new Date(t).toLocaleDateString("sv-SE") === todayStr) p.today += 1;
        if (now - t < 7 * 86400000) p.d7 += 1;
        if (now - t < 30 * 86400000) p.d30 += 1;
      }
      const uid = String(r.actor_uid || "").trim();
      if (uid === GUEST_ACTOR_UID) p.guest += 1;
      else if (uid) p.users.add(uid);
    });
    return per;
  }

  /** @param {Record<string, unknown>[]} rows */
  function renderToolSummary(rows) {
    const host = el("admin-ugc-tool-summary");
    if (!host) return;
    const per = aggregateToolRows(rows);
    const items = TOOL_META.map(([id, name, icon]) => ({
      id,
      name,
      icon,
      all: per[id].all,
      today: per[id].today,
      d7: per[id].d7,
      d30: per[id].d30,
      users: per[id].users.size,
      guest: per[id].guest,
    }));
    const totalAll = items.reduce((s, i) => s + i.all, 0);
    const maxAll = Math.max(1, ...items.map((i) => i.all));
    const sorted = items.slice().sort((a, b) => b.all - a.all);

    host.replaceChildren();

    const head = document.createElement("div");
    head.className = "admin-ugc-tsum-head";
    head.innerHTML = '<i class="fa-solid fa-chart-column" aria-hidden="true"></i>';
    const title = document.createElement("span");
    title.className = "admin-ugc-tsum-title";
    title.textContent = "ツール使用状況";
    head.appendChild(title);
    const total = document.createElement("span");
    total.className = "admin-ugc-tsum-total";
    total.textContent = `のべ ${totalAll} 回`;
    head.appendChild(total);
    host.appendChild(head);

    if (totalAll === 0) {
      const empty = document.createElement("p");
      empty.className = "admin-ugc-tsum-note";
      empty.textContent = "まだツールの利用記録がありません。";
      host.appendChild(empty);
      return;
    }

    sorted.forEach((it) => {
      const row = document.createElement("div");
      row.className = "admin-ugc-tsum-row";

      const name = document.createElement("div");
      name.className = "admin-ugc-tsum-name";
      name.innerHTML = `<i class="fa-solid ${it.icon}" aria-hidden="true"></i>`;
      const nm = document.createElement("span");
      nm.textContent = it.name;
      name.appendChild(nm);
      row.appendChild(name);

      const barWrap = document.createElement("div");
      barWrap.className = "admin-ugc-tsum-barwrap";
      const bar = document.createElement("div");
      bar.className = "admin-ugc-tsum-bar";
      bar.style.width = `${Math.round((it.all / maxAll) * 100)}%`;
      if (it.all === 0) bar.classList.add("admin-ugc-tsum-bar--zero");
      barWrap.appendChild(bar);
      row.appendChild(barWrap);

      const count = document.createElement("div");
      count.className = "admin-ugc-tsum-count";
      const big = document.createElement("span");
      big.className = "admin-ugc-tsum-big";
      big.textContent = String(it.all);
      count.appendChild(big);
      const sub = document.createElement("span");
      sub.className = "admin-ugc-tsum-sub";
      sub.textContent = `今日 ${it.today}・7日 ${it.d7}・30日 ${it.d30}${it.users ? `・登録者 ${it.users}人` : ""}`;
      count.appendChild(sub);
      row.appendChild(count);

      host.appendChild(row);
    });

    const note = document.createElement("p");
    note.className = "admin-ugc-tsum-note";
    note.textContent = "「回」はのべ利用回数（ゲスト含む・同じ人の複数回も加算）。直近2000件までを集計。";
    host.appendChild(note);
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
      const summaryHost = el("admin-ugc-tool-summary");
      if (summaryHost) {
        try {
          renderToolSummary(await loadToolUseSummaryRows(db));
        } catch (e) {
          console.warn("[MarchinZ] tool summary", e);
          summaryHost.replaceChildren();
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
  });

  document.addEventListener("mll-auth-changed", () => {
    void refreshBadges();
    void refreshNavSignupCount();
    void refreshToolsBadge();
  });

  document.addEventListener("marchinz-admin-ugc-recorded", (e) => {
    const kind = e instanceof CustomEvent ? String(e.detail?.kind || "") : "";
    if (kind === "tool_use") {
      toolSummaryCache = null;
      void refreshToolsBadge();
    }
    void refreshBadges();
  });
})();
