/**
 * 運営サイト全体お知らせ（Phase 1: ログイン済みのみ・バナー + マイページ「運営より」タブ）
 * Firestore: mll_site_announcements/current
 * 既読: mll_profiles/{uid}.last_read_announcement_at（お知らせの updated_at と比較）
 */
(function () {
  "use strict";

  const DOC_ID = "current";
  const NOTIF_ID = "__site_announcement__";

  /** @type {firebase.firestore.Firestore | null} */
  let db = null;
  /** @type {string | null} */
  let uid = null;
  /** @type {(() => void) | null} */
  let unsubAnn = null;
  /** @type {(() => void) | null} */
  let unsubProf = null;
  /** @type {{ title?: string; body?: string; link_href?: string; link_label?: string; active?: boolean; updated_at?: string; published_at?: string } | null} */
  let announcement = null;
  /** @type {string} */
  let lastReadAt = "";

  const readListeners = new Set();

  function getDb() {
    if (db) return db;
    const inst = window.MLL_AUTH?.getDb?.();
    if (inst) db = inst;
    return db;
  }

  function annFingerprint(ann) {
    return String(ann?.updated_at || ann?.published_at || "").trim();
  }

  function isActiveAnnouncement(ann) {
    return Boolean(ann && ann.active === true && String(ann.title || "").trim());
  }

  function isUnread(ann, readAt) {
    if (!isActiveAnnouncement(ann)) return false;
    const fp = annFingerprint(ann);
    if (!fp) return false;
    const read = String(readAt || "").trim();
    return !read || read < fp;
  }

  /**
   * @param {string} href
   * @returns {string}
   */
  function resolveInAppHash(href) {
    const raw = String(href || "").trim();
    if (!raw) return "";
    if (raw.startsWith("#")) return raw;
    try {
      if (/^https?:\/\//i.test(raw)) {
        const u = new URL(raw);
        if (u.hash) return u.hash;
        const here = new URL(location.href);
        if (u.origin === here.origin) {
          const path = `${u.pathname || ""}${u.search || ""}`.replace(/^\//, "");
          return path ? `#${path}` : "#top";
        }
        return "";
      }
    } catch {
      //
    }
    if (raw.startsWith("/")) return `#${raw.replace(/^\//, "")}`;
    return `#${raw}`;
  }

  function navigateInAppHash(hash) {
    const dest = resolveInAppHash(hash);
    if (!dest) return;
    window.location.hash = dest;
  }

  /**
   * @param {string} href
   * @param {string} text
   * @param {string} className
   * @returns {HTMLElement | null}
   */
  function buildExternalOrHashNavControl(href, text, className) {
    const h = String(href || "").trim();
    const t = String(text || "").trim();
    if (!h || !t) return null;
    const inApp = resolveInAppHash(h);
    if (inApp) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `${className} mz-site-ann-hashlink`.trim();
      btn.textContent = t;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigateInAppHash(h);
      });
      return btn;
    }
    if (/^https?:\/\//i.test(h)) {
      const a = document.createElement("a");
      a.href = h;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = className;
      a.textContent = t;
      return a;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${className} mz-site-ann-hashlink`.trim();
    btn.textContent = t;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateInAppHash(h);
    });
    return btn;
  }

  function notifyListeners() {
    for (const fn of readListeners) {
      try {
        fn();
      } catch {
        //
      }
    }
  }

  function renderBanner() {
    const root = document.getElementById("mz-site-announcement-banner");
    if (!(root instanceof HTMLElement)) return;
    if (document.documentElement.getAttribute("data-mz-prof-guest-preview") === "1") {
      root.hidden = true;
      root.replaceChildren();
      return;
    }
    const show = Boolean(uid && isUnread(announcement, lastReadAt));
    root.hidden = !show;
    if (!show) {
      root.replaceChildren();
      return;
    }
    const ann = announcement;
    if (!ann) return;
    root.replaceChildren();
    const inner = document.createElement("div");
    inner.className = "mz-site-announcement-banner-inner";
    const label = document.createElement("p");
    label.className = "mz-site-announcement-banner-label";
    label.textContent = "運営からのお知らせ";
    const title = document.createElement("p");
    title.className = "mz-site-announcement-banner-title";
    title.textContent = String(ann.title || "").trim();
    const body = document.createElement("p");
    body.className = "mz-site-announcement-banner-body";
    body.textContent = String(ann.body || "").trim();
    const actions = document.createElement("div");
    actions.className = "mz-site-announcement-banner-actions";
    const href = String(ann.link_href || "").trim();
    if (href) {
      const linkText = String(ann.link_label || "").trim() || "詳しく見る";
      const ctl = buildExternalOrHashNavControl(href, linkText, "mz-site-announcement-banner-link");
      if (ctl) actions.appendChild(ctl);
    }
    const toNotifs = document.createElement("button");
    toNotifs.type = "button";
    toNotifs.className = "mz-site-announcement-banner-open-notifs";
    toNotifs.textContent = "運営よりで見る";
    toNotifs.addEventListener("click", () => {
      window.location.hash = "#profile?tab=ops";
    });
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "mz-site-announcement-banner-dismiss";
    dismiss.setAttribute("aria-label", "閉じて既読にする");
    dismiss.textContent = "×";
    dismiss.addEventListener("click", () => {
      void markAsRead().catch(() => {});
    });
    actions.appendChild(toNotifs);
    actions.appendChild(dismiss);
    inner.appendChild(label);
    inner.appendChild(title);
    if (body.textContent) inner.appendChild(body);
    inner.appendChild(actions);
    root.appendChild(inner);
  }

  async function markAsRead() {
    const d = getDb();
    const u = uid;
    const ann = announcement;
    if (!d || !u || !isActiveAnnouncement(ann)) return;
    const fp = annFingerprint(ann);
    if (!fp) return;
    lastReadAt = fp;
    renderBanner();
    notifyListeners();
    const now = new Date().toISOString();
    await d.collection("mll_profiles").doc(u).update({
      last_read_announcement_at: fp,
      updated_at: now,
    });
  }

  function teardownListeners() {
    if (unsubAnn) {
      unsubAnn();
      unsubAnn = null;
    }
    if (unsubProf) {
      unsubProf();
      unsubProf = null;
    }
  }

  function bindForUser(user) {
    teardownListeners();
    const d = getDb();
    uid = user?.id ? String(user.id) : null;
    if (!d || !uid) {
      announcement = null;
      lastReadAt = "";
      renderBanner();
      notifyListeners();
      return;
    }
    unsubAnn = d
      .collection("mll_site_announcements")
      .doc(DOC_ID)
      .onSnapshot(
        (snap) => {
          announcement = snap.exists ? snap.data() || {} : null;
          renderBanner();
          notifyListeners();
        },
        () => {
          announcement = null;
          renderBanner();
          notifyListeners();
        },
      );
    unsubProf = d
      .collection("mll_profiles")
      .doc(uid)
      .onSnapshot(
        (snap) => {
          const pd = snap.exists ? snap.data() || {} : {};
          lastReadAt = String(pd.last_read_announcement_at || "").trim();
          renderBanner();
          notifyListeners();
        },
        () => {
          lastReadAt = "";
          renderBanner();
          notifyListeners();
        },
      );
  }

  /**
   * @param {HTMLElement} feed
   * @returns {HTMLElement | null}
   */
  function renderNotifCard(feed) {
    if (!(feed instanceof HTMLElement)) return null;
    const ann = announcement;
    if (!isActiveAnnouncement(ann)) return null;
    const unread = isUnread(ann, lastReadAt);
    const article = document.createElement("article");
    article.className =
      "user-prof-notif user-prof-notif--site" + (unread ? " user-prof-notif--unread" : "");
    article.dataset.mzNotifId = NOTIF_ID;
    article.dataset.mzAnnSite = "1";
    if (!unread) article.dataset.mzRead = "1";

    const avWrap = document.createElement("div");
    avWrap.className = "user-prof-notif-avatar-wrap user-prof-notif-avatar-wrap--site";
    const av = document.createElement("img");
    av.className = "user-prof-notif-avatar";
    av.src = "logo/marchinz-logo.png";
    av.alt = "MarchinZ 運営";
    avWrap.appendChild(av);

    const body = document.createElement("div");
    body.className = "user-prof-notif-body";

    const line1 = document.createElement("p");
    line1.className = "user-prof-notif-line1";
    line1.textContent = "運営より";

    const line2 = document.createElement("p");
    line2.className = "user-prof-notif-line2 user-prof-notif-line2--site";
    const href = String(ann.link_href || "").trim();
    const titleText = String(ann.title || "").trim();
    if (href) {
      const titCtl = buildExternalOrHashNavControl(href, titleText, "user-prof-notif-site-title");
      if (titCtl) line2.appendChild(titCtl);
      else {
        const tit = document.createElement("strong");
        tit.className = "user-prof-notif-site-title";
        tit.textContent = titleText;
        line2.appendChild(tit);
      }
    } else {
      const tit = document.createElement("strong");
      tit.className = "user-prof-notif-site-title";
      tit.textContent = titleText;
      line2.appendChild(tit);
    }
    const bodyTxt = String(ann.body || "").trim();
    if (bodyTxt) {
      line2.appendChild(document.createElement("br"));
      line2.appendChild(document.createTextNode(bodyTxt));
    }
    body.appendChild(line1);
    body.appendChild(line2);
    const linkLabelOnly = String(ann.link_label || "").trim();
    if (href && linkLabelOnly) {
      const linkRow = document.createElement("p");
      linkRow.className = "user-prof-notif-site-link-row";
      const linkCtl = buildExternalOrHashNavControl(href, linkLabelOnly, "user-prof-notif-site-link");
      if (linkCtl) linkRow.appendChild(linkCtl);
      body.appendChild(linkRow);
    }

    const time = document.createElement("time");
    time.className = "user-prof-notif-time";
    const when = String(ann.published_at || ann.updated_at || "");
    time.dateTime = when;
    if (when) {
      try {
        const dt = new Date(when);
        time.textContent = Number.isNaN(dt.getTime())
          ? when
          : dt.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
      } catch {
        time.textContent = when;
      }
    }
    body.appendChild(time);
    if (unread) {
      const markBtn = document.createElement("button");
      markBtn.type = "button";
      markBtn.className = "user-prof-notif-mark-read";
      markBtn.setAttribute("data-mz-notif-mark-read", "1");
      markBtn.textContent = "既読にする";
      body.appendChild(markBtn);
    }

    article.appendChild(avWrap);
    article.appendChild(body);
    feed.insertBefore(article, feed.firstChild);
    return article;
  }

  function getUnreadCount() {
    return isUnread(announcement, lastReadAt) ? 1 : 0;
  }

  function onReadStateChange(fn) {
    if (typeof fn !== "function") return () => {};
    readListeners.add(fn);
    return () => readListeners.delete(fn);
  }

  window.MarchinZSiteAnnouncement = {
    NOTIF_ID,
    getAnnouncement: () => (announcement ? { ...announcement } : null),
    isUnread: () => isUnread(announcement, lastReadAt),
    getUnreadCount,
    markAsRead,
    renderNotifCard,
    onReadStateChange,
    /** プロフィールの「他ユーザー視点」切替などのあとにバナー表示を再評価 */
    refreshBanner: () => {
      renderBanner();
      notifyListeners();
    },
  };

  function onAuthChanged(ev) {
    const user = ev?.detail?.user || window.MLL_AUTH?.getUser?.() || null;
    bindForUser(user);
  }

  window.addEventListener("mll-auth-changed", onAuthChanged);
  document.addEventListener("DOMContentLoaded", () => {
    onAuthChanged({ detail: { user: window.MLL_AUTH?.getUser?.() || null } });
  });
})();
