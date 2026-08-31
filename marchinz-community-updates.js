/**
 * コミュニティ「更新情報」— 演奏会等（event）・掲示板（board）タブ
 */
(function () {
  "use strict";

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const BOARD_GUEST_HIDDEN_THEMES = new Set(["質問", "見学募集", "その他"]);

  /** @param {string} kind */
  function sectionEl(kind) {
    const n = document.getElementById(`community-updates-${kind}`);
    return n instanceof HTMLElement ? n : null;
  }

  /** @param {string} kind */
  function listEl(kind) {
    const n = document.getElementById(`community-updates-${kind}-list`);
    return n instanceof HTMLElement ? n : null;
  }

  function getDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function isSignedIn() {
    return Boolean(window.MLL_AUTH?.getUser?.()?.id);
  }

  function fmtMd(isoOrYmd) {
    const s = String(isoOrYmd || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const p = s.slice(0, 10).split("-");
      return `${p[1]}/${p[2]}`;
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s.slice(5, 10).replace("-", "/");
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${m}/${day}`;
  }

  function fmtYmdSlash(isoOrYmd) {
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

  /** @param {Record<string, unknown>} row */
  function boardRowAllowedForViewer(row) {
    if (isSignedIn()) return true;
    const theme = String(row.post_theme || "").trim();
    return !BOARD_GUEST_HIDDEN_THEMES.has(theme);
  }

  /** @param {Record<string, unknown> & { id: string }[]} rows */
  function filterVisibleRows(rows) {
    const sorted = [...rows].sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || "")),
    );
    const now = Date.now();
    return sorted.filter((row, index) => {
      if (index < 3) return true;
      const t = Date.parse(String(row.created_at || ""));
      return Number.isFinite(t) && now - t <= SEVEN_DAYS_MS;
    });
  }

  /** @param {Record<string, unknown>} row @param {string} feedKind */
  function targetPhrase(row, feedKind) {
    if (feedKind === "event") {
      const ed = fmtYmdSlash(String(row.event_date || ""));
      const en = String(row.event_name || "イベント").trim() || "イベント";
      return `${ed}の【${en}】`;
    }
    const title = String(row.post_title || row.target_label || "投稿").trim() || "投稿";
    return `【${title}】`;
  }

  /** 既存の更新情報も event_id があれば個別イベントへ案内する。 */
  function eventTargetHref(row) {
    const eventId = String(row.event_id || "").trim();
    if (eventId) return `#community/events?event=${encodeURIComponent(eventId)}`;
    const fallback = String(row.target_href || "#").trim() || "#";
    return fallback.startsWith("#") ? fallback : `#${fallback}`;
  }

  /** @param {import("firebase").firestore.Firestore} db @param {string} kind */
  async function loadRows(db, kind) {
    const snap = await db.collection("mll_community_updates").where("kind", "==", kind).limit(120).get();
    /** @type {(Record<string, unknown> & { id: string })[]} */
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...(d.data() || {}) }));
    return rows.filter((row) => String(row.action || "create") === "create");
  }

  /** @param {string} kind @param {(Record<string, unknown> & { id: string })[]} rows */
  function paint(kind, rows) {
    const section = sectionEl(kind);
    const list = listEl(kind);
    if (!section || !list) return;

    const filtered = rows.filter((row) => (kind === "board" ? boardRowAllowedForViewer(row) : true));
    const visible = filterVisibleRows(filtered);
    list.replaceChildren();

    if (!visible.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    for (const row of visible) {
      const li = document.createElement("li");
      li.className = "community-updates-item";

      const line = document.createElement("p");
      line.className = "community-updates-line";

      const actorUid = String(row.actor_uid || "").trim();
      const actorName = `${String(row.actor_name || "ユーザー").trim()}さん`;
      const emoji = String(row.emoji || "").trim();
      const href = kind === "event"
        ? eventTargetHref(row)
        : String(row.target_href || "#").trim() || "#";

      line.appendChild(document.createTextNode(`${fmtMd(String(row.created_at || ""))}に `));

      if (actorUid) {
        const actorLink = document.createElement("a");
        actorLink.className = "community-updates-actor";
        actorLink.href = `#profile?uid=${encodeURIComponent(actorUid)}`;
        actorLink.textContent = actorName;
        line.appendChild(actorLink);
      } else {
        line.appendChild(document.createTextNode(actorName));
      }

      line.appendChild(document.createTextNode("が、"));
      const targetLink = document.createElement("a");
      targetLink.className = "community-updates-target";
      targetLink.href = href.startsWith("#") ? href : `#${href}`;
      targetLink.textContent = targetPhrase(row, kind);
      line.appendChild(targetLink);
      line.appendChild(document.createTextNode(`を作成しました${emoji}`));

      li.appendChild(line);
      list.appendChild(li);
    }
  }

  /** @param {"event"|"board"} kind */
  async function refresh(kind) {
    const k = kind === "board" ? "board" : "event";
    const section = sectionEl(k);
    if (!section) return;
    const db = getDb();
    if (!db) {
      section.hidden = true;
      return;
    }
    try {
      const rows = await loadRows(db, k);
      paint(k, rows);
    } catch (e) {
      console.warn("[MarchinZ] community updates", e);
      section.hidden = true;
    }
  }

  async function refreshAllVisible() {
    await Promise.all([refresh("event"), refresh("board")]);
  }

  window.MarchinZCommunityUpdates = {
    refresh,
    refreshAllVisible,
  };

  document.addEventListener("mll-auth-changed", () => {
    void refreshAllVisible();
  });
})();
