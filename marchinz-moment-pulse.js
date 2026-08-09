/**
 * MarchinZ Pulse — TOPの最新Moment 2件と、サイト内の新着通知。
 * 端末Pushではない。PWA/ブラウザを閉じた後の通知は、別途Web Push配信基盤が必要。
 */
(() => {
  "use strict";

  const TOP_LIMIT = 2;
  const QUERY_LIMIT = 8;
  const PREF_FIELD = "notify_new_moment_inapp";
  const SEEN_PREFIX = "mz_moment_seen_v1:";
  const FALLBACK_AVATAR = "logo/marchinz-logo.png";

  let latestRows = [];
  let unreadRows = [];
  let unsubscribe = null;
  let enabled = true;
  let initialSnapshotHandled = false;

  function getDb() {
    try {
      return window.MLL_AUTH?.getDb?.() || null;
    } catch {
      return null;
    }
  }

  function getUser() {
    try {
      return window.MLL_AUTH?.getUser?.() || null;
    } catch {
      return null;
    }
  }

  function parseTime(raw) {
    const n = Date.parse(String(raw || ""));
    return Number.isFinite(n) ? n : 0;
  }

  function relativeTime(raw) {
    const t = parseTime(raw);
    if (!t) return "";
    const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
    if (mins < 1) return "たった今";
    if (mins < 60) return `${mins}分前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}時間前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}日前`;
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function excerpt(raw, max = 80) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function photoUrl(data) {
    const urls = window.MarchinZDefaultAssets?.normalizeNotePhotoUrls?.(data?.photo_urls, 4) || [];
    const index = Math.max(0, Math.min(urls.length - 1, Number(data?.cover_photo_index) || 0));
    return urls[index] || "";
  }

  function likeCount(data) {
    const liked = data?.liked_by;
    if (!liked || typeof liked !== "object" || Array.isArray(liked)) return 0;
    return Object.values(liked).filter((v) => v === true).length;
  }

  function newestCreatedAt(rows = latestRows) {
    return rows.reduce((best, row) => {
      const t = String(row?.data?.created_at || "");
      return parseTime(t) > parseTime(best) ? t : best;
    }, "");
  }

  function seenKey(uid) {
    return `${SEEN_PREFIX}${uid}`;
  }

  function readSeen(uid) {
    try {
      return localStorage.getItem(seenKey(uid)) || "";
    } catch {
      return "";
    }
  }

  function writeSeen(uid, value) {
    if (!uid || !value) return;
    try {
      localStorage.setItem(seenKey(uid), value);
    } catch {
      // Storage拒否時は、そのセッション内の表示だけ維持する。
    }
  }

  function setUnread(on, count = 0) {
    const unreadCount = on ? Math.max(1, Number(count) || 1) : 0;
    const badge = document.getElementById("mz-moment-new-badge");
    if (badge) {
      badge.hidden = !on;
      badge.textContent = unreadCount > 1 ? `新着${unreadCount}` : "新着";
    }
    const top = document.getElementById("mz-pulse-top");
    if (top) top.classList.toggle("mz-pulse-top--unread", Boolean(on));
    window.dispatchEvent(
      new CustomEvent("marchinz-moment-unread-changed", {
        detail: { count: unreadCount },
      }),
    );
  }

  function markSeen() {
    const user = getUser();
    const newest = newestCreatedAt();
    if (user?.id && newest) writeSeen(user.id, newest);
    unreadRows = [];
    setUnread(false);
  }

  function momentHref(row) {
    return `#community/moments?uid=${encodeURIComponent(row.uid)}&moment=${encodeURIComponent(row.momentId)}`;
  }

  function buildTopCard(row) {
    const a = document.createElement("a");
    a.className = "mz-pulse-card";
    a.href = momentHref(row);
    a.setAttribute("aria-label", `${excerpt(row.data?.body, 60)} のモーメントを開く`);

    const photo = photoUrl(row.data);
    if (photo) {
      const img = document.createElement("img");
      img.className = "mz-pulse-card-photo";
      img.src = photo;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      a.appendChild(img);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "mz-pulse-card-photo mz-pulse-card-photo--empty";
      fallback.innerHTML = '<i class="fa-solid fa-bolt" aria-hidden="true"></i>';
      a.appendChild(fallback);
    }

    const body = document.createElement("span");
    body.className = "mz-pulse-card-body";
    const meta = document.createElement("span");
    meta.className = "mz-pulse-card-meta";
    const avatar = document.createElement("img");
    avatar.src = row._author?.avatar || FALLBACK_AVATAR;
    avatar.alt = "";
    avatar.loading = "lazy";
    const name = document.createElement("b");
    name.textContent = row._author?.name || "ユーザー";
    const time = document.createElement("span");
    time.textContent = relativeTime(row.data?.created_at || row.data?.updated_at);
    meta.append(avatar, name, time);
    const text = document.createElement("span");
    text.className = "mz-pulse-card-text";
    text.textContent = excerpt(row.data?.body, 90) || "モーメント";
    const likes = document.createElement("span");
    likes.className = "mz-pulse-card-likes";
    likes.innerHTML = '<i class="fa-regular fa-heart" aria-hidden="true"></i> ';
    likes.appendChild(document.createTextNode(String(likeCount(row.data))));
    body.append(meta, text, likes);
    a.appendChild(body);
    a.addEventListener("click", markSeen);
    return a;
  }

  function renderTop(rows) {
    latestRows = Array.isArray(rows) ? rows.slice() : [];
    const section = document.getElementById("mz-pulse-top");
    const list = document.getElementById("mz-pulse-top-list");
    if (!section || !list) return;
    list.replaceChildren();
    const shown = latestRows.slice(0, TOP_LIMIT);
    if (!shown.length) {
      if (!getUser()?.id) {
        section.hidden = true;
        return;
      }
      const empty = document.createElement("p");
      empty.className = "mz-pulse-top-empty";
      empty.textContent = "まだモーメントはありません。最初の瞬間を残してみませんか？";
      list.appendChild(empty);
      section.hidden = false;
      const composer = document.getElementById("mz-pulse-top-compose");
      if (composer) composer.hidden = false;
      return;
    }
    shown.forEach((row) => list.appendChild(buildTopCard(row)));
    section.hidden = false;
    document.getElementById("mz-hero-dash")?.removeAttribute("hidden");
    const composer = document.getElementById("mz-pulse-top-compose");
    if (composer) composer.hidden = !getUser()?.id;
  }

  async function refreshTop() {
    try {
      const load = window.MarchinZMomentFeed?.loadLatestPublic;
      if (typeof load !== "function") return;
      renderTop(await load(QUERY_LIMIT));
      evaluateUnread(latestRows, false);
    } catch (error) {
      console.warn("[MarchinZ] Pulse TOP", error);
    }
  }

  function evaluateUnread(rows, announce) {
    const user = getUser();
    if (!user?.id || !enabled) {
      unreadRows = [];
      setUnread(false);
      return;
    }
    const others = rows.filter((row) => row.uid !== user.id);
    const newest = newestCreatedAt(others);
    if (!newest) return;
    const seen = readSeen(user.id);
    if (!seen) {
      writeSeen(user.id, newest);
      unreadRows = [];
      return;
    }
    const unread = others.filter((row) => parseTime(row.data?.created_at) > parseTime(seen));
    unreadRows = unread;
    setUnread(unread.length > 0, unread.length);
    if (announce && unread.length) {
      window.MarchinZEphemeralMessage?.(
        unread.length === 1 ? "新しいモーメントが届きました" : `新しいモーメントが${unread.length}件届きました`,
      );
    }
  }

  async function readPreference() {
    const db = getDb();
    const user = getUser();
    if (!db || !user?.id) {
      enabled = true;
      return;
    }
    try {
      const snap = await db.collection("mll_profiles").doc(user.id).get();
      enabled = (snap.data() || {})[PREF_FIELD] !== false;
    } catch {
      enabled = true;
    }
  }

  function stopWatch() {
    if (typeof unsubscribe === "function") unsubscribe();
    unsubscribe = null;
    initialSnapshotHandled = false;
  }

  async function startWatch() {
    stopWatch();
    await readPreference();
    const db = getDb();
    if (!db || !getUser()?.id || !enabled) {
      setUnread(false);
      return;
    }
    // 一覧と同じ公開条件をクエリに載せる。Rules は非公開文書を後から除外してはくれない。
    const query = db
      .collectionGroup("moments")
      .where("visibility", "==", "public")
      .orderBy("updated_at", "desc")
      .limit(QUERY_LIMIT);
    unsubscribe = query.onSnapshot(
      () => {
        void (async () => {
          try {
            const rows = await window.MarchinZMomentFeed?.loadLatestPublic?.(QUERY_LIMIT);
            if (!Array.isArray(rows)) return;
            renderTop(rows);
            evaluateUnread(rows, initialSnapshotHandled);
            initialSnapshotHandled = true;
          } catch (error) {
            console.warn("[MarchinZ] Pulse watch", error);
          }
        })();
      },
      (error) => console.warn("[MarchinZ] Pulse snapshot", error),
    );
  }

  function wire() {
    document.getElementById("mz-pulse-top-compose")?.addEventListener("click", () => {
      window.MarchinZMomentFeed?.openCompose?.(null);
    });
    document.querySelectorAll('a[href^="#community/moments"], [data-community-hub-tab="moments"]').forEach((node) => {
      node.addEventListener("click", markSeen);
    });
    window.addEventListener("hashchange", () => {
      if (location.hash.startsWith("#community/moments")) markSeen();
    });
    window.addEventListener("mll-auth-changed", () => {
      void refreshTop();
      void startWatch();
    });
    window.addEventListener("marchinz-mll-updated", () => void refreshTop());
    window.addEventListener("marchinz-notification-pref-changed", (event) => {
      if (event.detail?.field !== PREF_FIELD) return;
      enabled = event.detail.checked !== false;
      if (enabled) void startWatch();
      else {
        stopWatch();
        setUnread(false);
      }
    });
  }

  function init() {
    wire();
    void refreshTop();
    void startWatch();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();

  window.MarchinZMomentPulse = {
    refresh: refreshTop,
    markSeen,
    getUnreadRows: () => unreadRows.slice(),
  };
})();
