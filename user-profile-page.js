/**
 * 公開ユーザープロフィール（#page-profile / #profile?…）
 *
 * タブ（data-prof-tab / ?tab=）とデータの対応（件数はタブラベル横 #prof-count-*）:
 * | tab       | 画面                         | 本文 DOM            | Firestore 主ソース | プロフィール公開 |
 * |-----------|------------------------------|---------------------|---------------------|-------------------|
 * | notifs    | 通知（本人のみ）             | #prof-notifs-list   | mll_profiles/…/notifications | （本人のみ） |
 * | mll       | MarchinZ Log            | #prof-mll-main      | mll_logs           | section_vis_mll   |
 * | videos    | マイリスト大会動画           | #prof-mylist-videos | video_lists + video_bookmarks | section_vis_videos|
 * | yt        | マイリストYouTube            | #prof-mylist-yt     | channel_lists + channel_bookmarks | section_vis_yt    |
 * | logdiary  | MarchinZ Note            | #prof-log-diary-root| event_log_diaries  | section_vis_logdiary |
 *
 * ヘッダー共通: mll_profiles 本人行（カバー1枚・表示名・公開ID・属性・自己紹介）
 * カバー: cover_image_url（レガシー cover_image_urls の先頭にフォールバック）。編集は auth.js から Storage へ JPEG 保存。
 * 未ログイン閲覧: 本文は読まず、タブ件数は prof_count_*（本人が一度プロフィールを開いたときに同期）
 * 深いリンク: #profile?uid=&tab=logdiary&event=（イベント日記） — `site-nav.js` の `MarchinZProfileHashParams` / `MarchinZProfileUidFromHash`
 *
 * 関連ページ: #mll（mll.js から #profile?uid=）、#videos / #youtube（各マイリスト編集）、#community/events（カレンダー）
 */
(() => {
  const STORAGE_CAL_HIGHLIGHT = "mz_cal_ev_highlight";
  /** @type {{ stop: () => void } | null} */
  let coverRunner = null;

  /** @typedef {{ id: string; date: string; title: string }} CalEvBrief */

  const root =
    typeof document !== "undefined" ? document.getElementById("page-profile") : null;

  /** 管理者の凍結操作の対象（クリック委譲で参照） */
  let adminBanCtx = { db: /** @type {any} */ (null), targetUid: "" };

  /** `data-prof-tab` / `#prof-pane-*` / `?tab=` / section_vis_* と一致（index.html と揃える） */
  const PROFILE_TAB_KEYS = /** @type {readonly ["notifs", "mll", "videos", "yt", "logdiary"]} */ ([
    "notifs",
    "mll",
    "videos",
    "yt",
    "logdiary",
  ]);

  const DEFAULT_VIDEO_LIST_ID = "default";
  const DEFAULT_CHANNEL_LIST_ID = "default";

  /** Firestore mll_profiles の section_vis_* をタブキーへ */
  const EMPTY_QUERY_SNAP = { forEach() {}, empty: true, size: 0 };

  /** @param {string} docId @param {Record<string, unknown>} data */
  function inferVideoBookmarkListId(docId, data) {
    const fromData = String(data?.list_id || "").trim();
    if (fromData) return fromData;
    const id = String(docId);
    const idx = id.lastIndexOf("_b");
    if (idx > 0) {
      const rest = id.slice(idx + 1);
      if (/^b[a-z0-9]+$/.test(rest)) return id.slice(0, idx);
    }
    return DEFAULT_VIDEO_LIST_ID;
  }

  /** @param {string} docId @param {Record<string, unknown>} data */
  function inferChannelBookmarkListId(docId, data) {
    const fromData = String(data?.list_id || "").trim();
    if (fromData) return fromData;
    const id = String(docId);
    const idx = id.lastIndexOf("_c");
    if (idx > 0) {
      const rest = id.slice(idx + 1);
      if (/^c[a-z0-9]+$/.test(rest)) return id.slice(0, idx);
    }
    return DEFAULT_CHANNEL_LIST_ID;
  }

  /** @param {Record<string, unknown>} pdata */
  function parseSectionVisibility(pdata) {
    const n = (k) => (String(pdata[k] || "").trim() === "private" ? "private" : "public");
    return {
      mll: n("section_vis_mll"),
      videos: n("section_vis_videos"),
      yt: n("section_vis_yt"),
      logdiary: n("section_vis_logdiary"),
    };
  }

  /** @param {Record<string, unknown>|null|undefined} pdata */
  function parseLikeShowPrefs(pdata) {
    return typeof window.MarchinZParseLikeShowPrefs === "function"
      ? window.MarchinZParseLikeShowPrefs(pdata)
      : {
          mll: true,
          community: true,
          calendar: true,
          videoBookmark: true,
          channelBookmark: true,
          logDiary: true,
        };
  }

  const PROF_AUTH_GATE_NOTE =
    "公開されている場合でも、閲覧にはマーチンズの登録が必要です。";

  /** @param {HTMLElement | null} host */
  function renderGuestAuthGate(host) {
    if (!host) return;
    host.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "user-profile-auth-gate";
    const p = document.createElement("p");
    p.className = "user-profile-auth-gate-note";
    p.textContent = PROF_AUTH_GATE_NOTE;
    wrap.appendChild(p);
    const row = document.createElement("div");
    row.className = "user-profile-auth-gate-actions";
    const aSignup = document.createElement("a");
    aSignup.href = "#signup";
    aSignup.className = "site-brand-action-btn site-brand-action-btn--accent";
    aSignup.textContent = "登録する";
    aSignup.addEventListener("click", (ev) => {
      if (typeof window.MarchinZNavigateAuthEntry !== "function") return;
      ev.preventDefault();
      window.MarchinZNavigateAuthEntry("signup", "profile_gate");
    });
    const aLogin = document.createElement("a");
    aLogin.href = "#login";
    aLogin.className = "site-brand-action-btn site-brand-action-btn--secondary";
    aLogin.textContent = "ログインする";
    aLogin.addEventListener("click", (ev) => {
      if (typeof window.MarchinZNavigateAuthEntry !== "function") return;
      ev.preventDefault();
      window.MarchinZNavigateAuthEntry("login");
    });
    row.appendChild(aSignup);
    row.appendChild(aLogin);
    wrap.appendChild(row);
    host.appendChild(wrap);
  }

  /** @param {Record<string, unknown>} pdata */
  function readPublicProfCounts(pdata) {
    return {
      mll: Math.min(50000, Math.max(0, Number(pdata.prof_count_mll) || 0)),
      videos: Math.min(50000, Math.max(0, Number(pdata.prof_count_videos) || 0)),
      yt: Math.min(50000, Math.max(0, Number(pdata.prof_count_yt) || 0)),
      logdiary: Math.min(50000, Math.max(0, Number(pdata.prof_count_logdiary) || 0)),
    };
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {string} targetUid
   * @param {boolean} isOwner
   * @param {Record<string, unknown>} pdata
   * @param {{ mll: number; videos: number; yt: number; logdiary: number }} counts
   */
  async function maybeSyncProfTabCountsToProfile(db, targetUid, isOwner, pdata, counts) {
    if (!isOwner || !db || !targetUid) return;
    const before = readPublicProfCounts(pdata);
    if (
      counts.mll === before.mll &&
      counts.videos === before.videos &&
      counts.yt === before.yt &&
      counts.logdiary === before.logdiary
    ) {
      return;
    }
    try {
      await db
        .collection("mll_profiles")
        .doc(targetUid)
        .set(
          {
            prof_count_mll: counts.mll,
            prof_count_videos: counts.videos,
            prof_count_yt: counts.yt,
            prof_count_logdiary: counts.logdiary,
            updated_at: new Date().toISOString(),
          },
          { merge: true },
        );
    } catch {
      /* 未接続・権限時は無視 */
    }
  }

  /** index.html の #prof-log-diary-root 初期構造（非公開表示や再マウント前に DOM を正す） */
  const PROF_LOG_DIARY_SHELL_HTML =
    '<p class="user-profile-load-msg" data-eld-msg hidden></p><div data-eld-list></div><dialog class="eld-dialog" data-eld-dialog><div class="eld-dialog-surface" role="document"><button type="button" class="eld-dialog-x" data-eld-dialog-close aria-label="閉じる">×</button><div data-eld-dialog-body></div></div></dialog>';

  /** @param {HTMLElement | null} logRoot */
  function resetProfLogDiaryHost(logRoot) {
    if (!(logRoot instanceof HTMLElement)) return;
    delete logRoot.dataset.eldDlgWired;
    logRoot.innerHTML = PROF_LOG_DIARY_SHELL_HTML;
  }

  /** @param {string} tab */
  function isValidProfileTab(tab) {
    return PROFILE_TAB_KEYS.includes(tab);
  }

  const SS_COMM_THREAD_FOCUS = "mz_comm_thread_focus";

  /** @param {unknown} iso */
  function formatNotifTime(iso) {
    const t = new Date(String(iso || "")).getTime();
    if (Number.isNaN(t)) return "";
    const diff = Date.now() - t;
    if (diff < 60000) return "たった今";
    if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}分`;
    if (diff < 86400000) return `${Math.max(1, Math.floor(diff / 3600000))}時間`;
    if (diff < 604800000) return `${Math.max(1, Math.floor(diff / 86400000))}日`;
    try {
      return new Date(t).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {string} targetUid
   * @param {import("firebase").firestore.QuerySnapshot} snap
   */
  async function renderNotificationsPane(db, targetUid, snap) {
    const host = el("#prof-notifs-list");
    if (!host) return;
    host.replaceChildren();
    if (!snap || snap.empty) {
      const p = document.createElement("p");
      p.className = "user-profile-empty";
      p.textContent = "通知はまだありません。";
      host.appendChild(p);
      return;
    }
    /** @type {{ id: string; kind?: string; actor_uid?: string; actor_name?: string; target_title?: string; target_id?: string; target_href?: string; thread_root_id?: string; read?: boolean; created_at?: string }[]} */
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...(d.data() || {}) }));
    const uids = [...new Set(rows.map((x) => String(x.actor_uid || "").trim()).filter(Boolean))].slice(0, 48);
    const profMap = new Map();
    await Promise.all(
      uids.map(async (uid) => {
        try {
          const ps = await db.collection("mll_profiles").doc(uid).get();
          const pd = ps.exists ? ps.data() || {} : {};
          const nameFromRow = rows.find((r) => String(r.actor_uid) === uid)?.actor_name;
          profMap.set(uid, {
            avatar: String(pd.avatar_url || "").trim(),
            name: String(pd.display_name || "").trim() || String(nameFromRow || "ユーザー").trim(),
            withdrawn: Boolean(pd.withdrawn),
          });
        } catch {
          profMap.set(uid, { avatar: "", name: "ユーザー", withdrawn: false });
        }
      }),
    );
    for (const n of rows) {
      const article = document.createElement("article");
      article.className = "user-prof-notif" + (n.read ? "" : " user-prof-notif--unread");
      article.dataset.mzNotifId = n.id;
      if (n.read) article.dataset.mzRead = "1";

      const avWrap = document.createElement("div");
      avWrap.className = "user-prof-notif-avatar-wrap";
      const av = document.createElement("img");
      av.className = "user-prof-notif-avatar";
      const auid = String(n.actor_uid || "").trim();
      const pinfo = profMap.get(auid);
      const withdrawn = pinfo?.withdrawn;
      const labelName = String(pinfo?.name || n.actor_name || "ユーザー").trim();
      if (withdrawn) {
        av.src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#e8e8e8"/></svg>')}`;
        av.alt = "";
      } else {
        av.src = pinfo?.avatar || "logo/marchinz-logo.png";
        av.alt = `${labelName} のプロフィール画像`;
      }
      avWrap.appendChild(av);

      const body = document.createElement("div");
      body.className = "user-prof-notif-body";

      const line1 = document.createElement("p");
      line1.className = "user-prof-notif-line1";
      const aProf = document.createElement("a");
      aProf.className = "user-prof-notif-actor";
      aProf.href = `#profile?uid=${encodeURIComponent(auid)}`;
      aProf.textContent = withdrawn ? "退会ユーザー" : labelName;
      line1.appendChild(aProf);
      line1.appendChild(document.createTextNode("さんが"));

      const line2 = document.createElement("p");
      line2.className = "user-prof-notif-line2";
      const kindStr = String(n.kind || "");
      let prefix = "あなたの投稿「";
      let suffix = "」にいいねしました。";
      if (kindStr === "like_mll_log") {
        prefix = "あなたの MarchinZ Log「";
        suffix = "」にいいねしました。";
      } else if (kindStr === "like_calendar_event") {
        prefix = "あなたのイベント「";
        suffix = "」にいいねしました。";
      } else if (kindStr === "like_video_bookmark") {
        prefix = "あなたの大会動画マイリスト「";
        suffix = "」にいいねしました。";
      } else if (kindStr === "like_channel_bookmark") {
        prefix = "あなたの YouTube マイリスト「";
        suffix = "」にいいねしました。";
      } else if (kindStr === "like_log_diary") {
        prefix = "あなたの MarchinZ Note（";
        suffix = "）にいいねしました。";
      }
      line2.appendChild(document.createTextNode(prefix));
      const tit = String(n.target_title || "").trim() || "（無題）";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "user-prof-notif-target";
      if (kindStr === "like_community_post") {
        btn.setAttribute("data-mz-notif-go", "community");
        btn.setAttribute("data-mz-notif-target-id", String(n.target_id || ""));
        btn.setAttribute("data-mz-notif-thread", String(n.thread_root_id || n.target_id || ""));
      } else if (kindStr === "like_calendar_event") {
        btn.setAttribute("data-mz-notif-go", "calendar");
        btn.setAttribute("data-mz-notif-target-id", String(n.target_id || ""));
      } else if (kindStr === "like_video_bookmark") {
        btn.setAttribute("data-mz-notif-go", "video_bm");
        btn.setAttribute("data-mz-notif-target-id", String(n.thread_root_id || n.target_id || ""));
        btn.setAttribute("data-mz-notif-owner", String(targetUid));
      } else if (kindStr === "like_channel_bookmark") {
        btn.setAttribute("data-mz-notif-go", "ch_bm");
        btn.setAttribute("data-mz-notif-target-id", String(n.thread_root_id || n.target_id || ""));
        btn.setAttribute("data-mz-notif-owner", String(targetUid));
      } else if (kindStr === "like_log_diary") {
        btn.setAttribute("data-mz-notif-go", "log_diary");
        btn.setAttribute("data-mz-notif-target-id", String(n.target_id || ""));
        btn.setAttribute("data-mz-notif-owner", String(targetUid));
      } else {
        btn.setAttribute("data-mz-notif-go", "mll");
        const href = String(n.target_href || `#profile?uid=${encodeURIComponent(targetUid)}&tab=mll`).trim();
        btn.setAttribute("data-mz-notif-href", href);
      }
      btn.textContent = tit;
      line2.appendChild(btn);
      line2.appendChild(document.createTextNode(suffix));

      const time = document.createElement("time");
      time.className = "user-prof-notif-time";
      time.dateTime = String(n.created_at || "");
      time.textContent = formatNotifTime(n.created_at);

      body.appendChild(line1);
      body.appendChild(line2);
      body.appendChild(time);

      article.appendChild(avWrap);
      article.appendChild(body);
      host.appendChild(article);
    }
  }

  function wireNotificationPaneClicks() {
    if (!root || root.dataset.mzProfNotifWire === "1") return;
    root.dataset.mzProfNotifWire = "1";
    root.addEventListener("click", (ev) => {
      const go = ev.target?.closest?.("[data-mz-notif-go]");
      if (go instanceof HTMLElement) {
        ev.preventDefault();
        const artGo = go.closest("article[data-mz-notif-id]");
        if (artGo instanceof HTMLElement && artGo.dataset.mzRead !== "1") {
          const nid0 = artGo.getAttribute("data-mz-notif-id") || "";
          const cur0 = uidFromRoute();
          const d0 = getDb();
          if (nid0 && cur0 && d0) {
            artGo.dataset.mzRead = "1";
            artGo.classList.remove("user-prof-notif--unread");
            void d0
              .collection("mll_profiles")
              .doc(cur0)
              .collection("notifications")
              .doc(nid0)
              .update({ read: true })
              .catch(() => {});
          }
        }
        const k = go.getAttribute("data-mz-notif-go") || "";
        const tid = go.getAttribute("data-mz-notif-target-id") || "";
        const tr = go.getAttribute("data-mz-notif-thread") || "";
        if (k === "calendar") {
          try {
            sessionStorage.setItem("mz_cal_ev_highlight", tid);
          } catch {
            //
          }
          window.location.hash = "#community/events";
          return;
        }
        if (k === "community") {
          try {
            sessionStorage.setItem(SS_COMM_THREAD_FOCUS, tr || tid);
          } catch {
            //
          }
          window.location.hash = "#community/board";
          return;
        }
        if (k === "mll") {
          const href = String(go.getAttribute("data-mz-notif-href") || "#profile").trim();
          window.location.hash = href.startsWith("#") ? href : `#${href}`;
          return;
        }
        if (k === "video_bm") {
          const ou = String(go.getAttribute("data-mz-notif-owner") || "").trim();
          try {
            sessionStorage.setItem("mz_prof_video_bm", tid);
          } catch {
            //
          }
          window.location.hash = `#profile?uid=${encodeURIComponent(ou)}&tab=videos`;
          return;
        }
        if (k === "ch_bm") {
          const ou = String(go.getAttribute("data-mz-notif-owner") || "").trim();
          try {
            sessionStorage.setItem("mz_prof_channel_bm", tid);
          } catch {
            //
          }
          window.location.hash = `#profile?uid=${encodeURIComponent(ou)}&tab=yt`;
          return;
        }
        if (k === "log_diary") {
          const ou = String(go.getAttribute("data-mz-notif-owner") || "").trim();
          window.location.hash = `#profile?uid=${encodeURIComponent(ou)}&tab=logdiary&event=${encodeURIComponent(tid)}`;
          return;
        }
        return;
      }
      const art = ev.target?.closest?.("article[data-mz-notif-id]");
      if (!(art instanceof HTMLElement)) return;
      if (ev.target?.closest?.("a, [data-mz-notif-go]")) return;
      const nid = art.getAttribute("data-mz-notif-id") || "";
      if (!nid || art.dataset.mzRead === "1") return;
      const d = getDb();
      const cur = uidFromRoute();
      if (!d || !cur) return;
      art.dataset.mzRead = "1";
      art.classList.remove("user-prof-notif--unread");
      void d
        .collection("mll_profiles")
        .doc(cur)
        .collection("notifications")
        .doc(nid)
        .update({ read: true })
        .catch(() => {});
    });
  }

  function normLikedByProf(raw) {
    const o = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
    for (const [k, v] of Object.entries(raw)) {
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(k) && v === true) o[k] = true;
    }
    return o;
  }

  function appendProfileMllLikeRow(hostEl, log) {
    if (!hostEl || !log?.id) return;
    const me = window.MLL_AUTH?.getUser?.();
    const lb = normLikedByProf(log.liked_by);
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    const row = document.createElement("div");
    row.className = "community-like-row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "community-like-btn" + (liked ? " community-like-btn--on" : "");
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    btn.setAttribute("aria-label", liked ? "いいねを解除" : "いいねする");
    btn.disabled = false;
    btn.addEventListener("click", () => void window.MarchinZToggleMllLogLike?.(log.id));
    const heart = document.createElement("span");
    heart.className = "community-like-heart";
    heart.setAttribute("aria-hidden", "true");
    heart.textContent = "\u2665";
    const num = document.createElement("span");
    num.className = "community-like-count";
    num.textContent = String(cnt);
    btn.appendChild(heart);
    btn.appendChild(num);
    row.appendChild(btn);
    if (!me?.id) {
      const hint = document.createElement("span");
      hint.className = "community-like-hint mll-log-meta";
      hint.textContent = "ログインでいいねできます";
      row.appendChild(hint);
    }
    hostEl.appendChild(row);
  }

  /**
   * @param {HTMLElement|null} hostEl
   * @param {Record<string, unknown>} likedBy
   * @param {string} ownerUid
   * @param {string} docId
   * @param {"video_bookmarks"|"channel_bookmarks"} coll
   */
  function appendProfBookmarkLikeRow(hostEl, likedBy, ownerUid, docId, coll) {
    if (!hostEl || !ownerUid || !docId) return;
    const me = window.MLL_AUTH?.getUser?.();
    const lb = normLikedByProf(likedBy);
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    const row = document.createElement("div");
    row.className = "community-like-row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "community-like-btn" + (liked ? " community-like-btn--on" : "");
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    btn.setAttribute("aria-label", liked ? "いいねを解除" : "いいねする");
    btn.disabled = false;
    btn.addEventListener("click", () =>
      void (coll === "video_bookmarks"
        ? toggleProfileVideoBookmarkLike(ownerUid, docId)
        : toggleProfileChannelBookmarkLike(ownerUid, docId)),
    );
    const heart = document.createElement("span");
    heart.className = "community-like-heart";
    heart.setAttribute("aria-hidden", "true");
    heart.textContent = "\u2665";
    const num = document.createElement("span");
    num.className = "community-like-count";
    num.textContent = String(cnt);
    btn.appendChild(heart);
    btn.appendChild(num);
    row.appendChild(btn);
    if (!me?.id) {
      const hint = document.createElement("span");
      hint.className = "community-like-hint mll-log-meta";
      hint.textContent = "ログインでいいねできます";
      row.appendChild(hint);
    }
    hostEl.appendChild(row);
  }

  async function toggleProfileVideoBookmarkLike(ownerUid, docId) {
    const db = getDb();
    const user = window.MLL_AUTH?.getUser?.();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    if (!db) return;
    let meta = null;
    try {
      const ref = db.collection("mll_profiles").doc(ownerUid).collection("video_bookmarks").doc(docId);
      await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) return;
        const data = snap.data() || {};
        const prev = normLikedByProf(data.liked_by);
        const next = { ...prev };
        const wasOn = Boolean(next[user.id]);
        if (wasOn) delete next[user.id];
        else next[user.id] = true;
        txn.update(ref, { liked_by: next });
        if (!wasOn && ownerUid !== user.id) {
          meta = { title: String(data.event_title || data.display_name || "").trim().slice(0, 200) || "動画" };
        }
      });
    } catch (e) {
      console.warn(e);
      return;
    }
    if (meta) {
      const nm = window.MarchinZActorDisplayName?.(user) || "ユーザー";
      window.MarchinZPushLikeNotification?.(db, ownerUid, {
        kind: "like_video_bookmark",
        actor_uid: user.id,
        actor_name: nm,
        target_type: "video_bookmark",
        target_id: String(docId),
        target_title: meta.title,
        target_href: `#profile?uid=${encodeURIComponent(ownerUid)}&tab=videos`,
        thread_root_id: String(docId).slice(0, 128),
      });
    }
    void loadAndRender().catch(() => {});
  }

  async function toggleProfileChannelBookmarkLike(ownerUid, docId) {
    const db = getDb();
    const user = window.MLL_AUTH?.getUser?.();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    if (!db) return;
    let meta = null;
    try {
      const ref = db.collection("mll_profiles").doc(ownerUid).collection("channel_bookmarks").doc(docId);
      await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) return;
        const data = snap.data() || {};
        const prev = normLikedByProf(data.liked_by);
        const next = { ...prev };
        const wasOn = Boolean(next[user.id]);
        if (wasOn) delete next[user.id];
        else next[user.id] = true;
        txn.update(ref, { liked_by: next });
        if (!wasOn && ownerUid !== user.id) {
          meta = { title: String(data.channel_name || "").trim().slice(0, 200) || "チャンネル" };
        }
      });
    } catch (e) {
      console.warn(e);
      return;
    }
    if (meta) {
      const nm = window.MarchinZActorDisplayName?.(user) || "ユーザー";
      window.MarchinZPushLikeNotification?.(db, ownerUid, {
        kind: "like_channel_bookmark",
        actor_uid: user.id,
        actor_name: nm,
        target_type: "channel_bookmark",
        target_id: String(docId),
        target_title: meta.title,
        target_href: `#profile?uid=${encodeURIComponent(ownerUid)}&tab=yt`,
        thread_root_id: String(docId).slice(0, 128),
      });
    }
    void loadAndRender().catch(() => {});
  }

  /** @returns {FirebaseFirestore.Firestore|null} */
  function getDb() {
    const d = window.MLL_AUTH?.getDb?.();
    return d && typeof d.collection === "function" ? d : null;
  }

  function uidFromRoute() {
    const fromHash = String(window.MarchinZProfileUidFromHash?.() || "").trim();
    if (fromHash) return fromHash;
    return String(window.MLL_AUTH?.getUser?.()?.id || "").trim();
  }

  function logVisibility(x) {
    return x && x.visibility === "private" ? "private" : "public";
  }

  /** @param {any} log @param {string|null} viewerUserId */
  function canViewerSeeLog(log, viewerUserId) {
    if (logVisibility(log) === "public") return true;
    return Boolean(viewerUserId && String(log.user_id) === String(viewerUserId));
  }

  /** KPI・年別集計・シェア文の並び（観戦→出演→チームスタッフ→運営） */
  const PROFILE_ROLE_ORDER = /** @type {const} */ (["watch", "perform", "team_staff", "ops"]);

  /** @returns {Partial<Record<(typeof PROFILE_ROLE_ORDER)[number], number>>} */
  function emptyRoleTotals() {
    return { watch: 0, perform: 0, team_staff: 0, ops: 0 };
  }

  /** @param {string} role @returns {"perform"|"watch"|"ops"|"team_staff"} */
  function mapLogRole(role) {
    const r = String(role || "").trim();
    if (r === "perform" || r === "出演") return "perform";
    if (r === "watch" || r === "観戦") return "watch";
    if (r === "ops" || r === "manage" || r === "運営") return "ops";
    if (r === "team_staff" || r === "staff" || r === "チームスタッフ") return "team_staff";
    return "watch";
  }

  const ROLE_LABEL_JA = {
    watch: "観戦",
    perform: "出演",
    team_staff: "チームスタッフ",
    ops: "運営側",
  };

  const MLL_MEDAL_EMOJI = /** @type {Record<(typeof PROFILE_ROLE_ORDER)[number], string>} */ ({
    watch: "👀",
    perform: "🎺",
    team_staff: "💜",
    ops: "⭐",
  });

  /** @param {(typeof PROFILE_ROLE_ORDER)[number]} k @param {number} c */
  function formatYearRoleCountJa(k, c) {
    if (!c) return "";
    if (k === "watch") return `${c}回観戦`;
    if (k === "perform") return `${c}回出演`;
    if (k === "team_staff") return `${c}回チームスタッフ`;
    if (k === "ops") return `運営側で${c}回`;
    return "";
  }

  function normTitle(s) {
    return String(s ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @returns {Promise<Map<string, string>>}
   */
  async function loadCalendarLookup(db) {
    const map = new Map();
    try {
      const snap = await db.collection("mll_calendar_events").orderBy("date", "desc").limit(500).get();
      snap.forEach((doc) => {
        const d = doc.data() || {};
        const date = String(d.date || "").trim();
        const title = String(d.title || "").trim();
        if (!date || !title) return;
        map.set(`${date}__${normTitle(title)}`, doc.id);
      });
    } catch {
      //
    }
    return map;
  }

  /** @param {any} log @param {Map<string, string>} calMap */
  function resolveEventId(log, calMap) {
    const date = String(log.event_date || "").trim();
    const title = String(log.event_name || "").trim();
    if (!date || !title) return "";
    return calMap.get(`${date}__${normTitle(title)}`) || "";
  }

  function openMatchedEvent(calMap, log) {
    const evId = resolveEventId(log, calMap);
    try {
      if (evId) sessionStorage.setItem(STORAGE_CAL_HIGHLIGHT, evId);
      else sessionStorage.removeItem(STORAGE_CAL_HIGHLIGHT);
    } catch {
      //
    }
    const base = `${location.pathname}${location.search}#community/events`;
    window.open(base, "_blank", "noopener,noreferrer");
  }

  /** @returns {HTMLElement|null} */
  function el(sel) {
    return root ? root.querySelector(sel) : null;
  }

  function stopCover() {
    if (coverRunner) {
      coverRunner.stop();
      coverRunner = null;
    }
  }

  /** @param {Record<string, unknown>} pdata */
  function resolveCoverUrlFromPdata(pdata) {
    const u = String(pdata.cover_image_url || "").trim();
    if (/^https?:\/\//i.test(u)) return u;
    const arr = Array.isArray(pdata.cover_image_urls) ? pdata.cover_image_urls : [];
    for (const x of arr) {
      const s = String(x || "").trim();
      if (/^https?:\/\//i.test(s)) return s;
    }
    return "";
  }

  /** カバーは 1 枚のみ（静止表示）。cover_image_url を優先し、レガシーの cover_image_urls[0] にフォールバック。 */
  function mountCoverSingle(urlRaw) {
    stopCover();
    const wrap = el("#prof-cover-mount");
    if (!wrap) return;
    wrap.innerHTML = "";
    wrap.classList.remove("user-profile-cover--cross", "user-profile-cover--zoom", "user-profile-cover--slide");
    wrap.classList.add("user-profile-cover--single");
    wrap.removeAttribute("aria-label");
    delete wrap.dataset.mzCoverUrlsJson;
    delete wrap.dataset.mzCoverMode;
    wrap.removeAttribute("tabindex");
    wrap.removeAttribute("role");

    const clean = String(urlRaw || "").trim();
    if (!/^https?:\/\//i.test(clean)) {
      wrap.classList.add("user-profile-cover--empty");
      wrap.appendChild(document.createElement("div")).className = "user-profile-cover-placeholder";
      return;
    }
    wrap.classList.remove("user-profile-cover--empty");
    const img = document.createElement("img");
    img.src = clean;
    img.alt = "";
    img.className = "user-profile-cover-img";
    img.loading = "eager";
    img.decoding = "async";
    wrap.appendChild(img);
    window.MarchinZImage?.ensureProtectedImgWrap?.(img);
  }

  /** 公開ID表示（101→0000101）。8桁超のレガシーはそのまま。 */
  function formatMarchinzPublicIdForDisplay(raw) {
    const digits = String(raw || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.length > 7) return digits;
    const n = Number(digits);
    if (!Number.isFinite(n) || n < 0) return digits;
    return String(Math.trunc(n)).padStart(7, "0");
  }

  /** @param {string} text */
  function setText(id, text) {
    const n = el(id);
    if (!n) return;
    const t = String(text ?? "");
    n.textContent = t;
    if (id === "#prof-load-msg") n.hidden = !t.trim();
  }

  /** @param {any} profile @param {string} targetUid */
  function renderHeader(profile, targetUid) {
    setText("#prof-display-name", String(profile.display_name || "ユーザー"));
    const pid = formatMarchinzPublicIdForDisplay(profile.marchinz_public_id);
    setText("#prof-public-id", pid ? `ユーザーID: ${pid}` : "");
    const av = el("#prof-avatar");
    if (av && av instanceof HTMLImageElement) {
      av.src = profile.avatar_url || "logo/marchinz-logo.png";
      av.alt = `${profile.display_name || "ユーザー"} のプロフィール画像`;
      window.MarchinZImage?.ensureProtectedImgWrap?.(av);
    }
    const bio = el("#prof-bio");
    if (bio) {
      const t = String(profile.profile_bio || "").trim();
      bio.textContent = t || "（自己紹介は未設定です）";
    }
    const attrsHost = el("#prof-attrs");
    if (attrsHost) {
      attrsHost.innerHTML = "";
      const arr = Array.isArray(profile.profile_attributes) ? profile.profile_attributes : [];
      arr.slice(0, 2).forEach((x) => {
        const s = String(x || "").trim();
        if (!s) return;
        const sp = document.createElement("span");
        sp.className = "user-profile-attr-pill";
        sp.textContent = s;
        attrsHost.appendChild(sp);
      });
    }
  }

  /**
   * @param {any[]} logs
   * @param {Map<string,string>} calMap
   * @param {{
   *   isOwner?: boolean;
   *   sectionVis?: { mll?: string };
   *   displayName?: string;
   *   targetUid?: string;
   *   viewerId?: string | null;
   *   likeShow?: { mll?: boolean };
   * } | null} [shareCtx]
   */
  function renderMLL(logs, calMap, shareCtx) {
    const host = el("#prof-mll-main");
    if (!host) return;
    host.innerHTML = "";

    const totals = emptyRoleTotals();
    /** @type {Record<string, ReturnType<typeof emptyRoleTotals>>} */
    const byYear = {};
    for (const log of logs) {
      const y = String(log.event_date || "").slice(0, 4);
      if (!y || y === "????") continue;
      if (!byYear[y]) Object.assign(byYear, { [y]: emptyRoleTotals() });
      const k = mapLogRole(log.role);
      totals[k] += 1;
      byYear[y][k] += 1;
    }

    /** @param {(typeof PROFILE_ROLE_ORDER)[number]} labelKey @param {number} cnt @returns {HTMLElement} */
    function statMedal(labelKey, cnt) {
      const d = document.createElement("div");
      d.className = `user-profile-mll-medal user-profile-mll-medal--${labelKey}`;
      const ribbon = document.createElement("span");
      ribbon.className = "user-profile-mll-medal-ribbon";
      ribbon.setAttribute("aria-hidden", "true");
      ribbon.textContent = MLL_MEDAL_EMOJI[labelKey] || "✨";
      const num = document.createElement("span");
      num.className = "user-profile-mll-medal-num";
      num.textContent = String(cnt ?? 0);
      const lab = document.createElement("span");
      lab.className = "user-profile-mll-medal-label";
      lab.textContent = ROLE_LABEL_JA[labelKey];
      d.appendChild(ribbon);
      d.appendChild(num);
      d.appendChild(lab);
      return d;
    }

    const kpiOuter = document.createElement("section");
    kpiOuter.className = "user-profile-mll-kpi-bar";
    kpiOuter.setAttribute("aria-label", "MarchinZ Log 集計");
    const kpiInner = document.createElement("div");
    kpiInner.className = "user-profile-mll-kpi-inner";
    PROFILE_ROLE_ORDER.forEach((k) => {
      kpiInner.appendChild(statMedal(k, totals[k]));
    });
    const kpiCap = document.createElement("p");
    kpiCap.className = "user-profile-mll-kpi-caption";
    kpiCap.textContent = "MarchinZ Log";
    kpiOuter.appendChild(kpiCap);
    kpiOuter.appendChild(kpiInner);
    host.appendChild(kpiOuter);

    const totalMll = totals.watch + totals.perform + totals.team_staff + totals.ops;
    if (totalMll > 0 && shareCtx?.targetUid) {
      const shareRow = document.createElement("div");
      shareRow.className = "user-profile-mll-share-row";
      const hint = document.createElement("p");
      hint.className = "user-profile-mll-share-hint";
      hint.hidden = true;
      const shareBtn = document.createElement("button");
      shareBtn.type = "button";
      shareBtn.className = "btn-share-search btn-marchinz-spotlight user-profile-mll-share-btn";
      shareBtn.textContent = "MarchinZ Log をシェアする";
      const sm = window.MarchinZShareMenu;
      const uid = String(shareCtx.targetUid).trim();
      const profHash = `#profile?uid=${encodeURIComponent(uid)}&tab=mll`;
      const shareUrl = sm?.buildAbsoluteUrlForHash
        ? sm.buildAbsoluteUrlForHash(profHash)
        : `${window.location.origin}${window.location.pathname}${profHash}`;
      const dn = String(shareCtx.displayName || "ユーザー").trim() || "ユーザー";
      const shareText = sm?.mllProfileShareText ? sm.mllProfileShareText(dn, totals, shareUrl) : "";
      if (shareCtx.isOwner && shareCtx.sectionVis && shareCtx.sectionVis.mll === "private") {
        shareBtn.addEventListener("click", () => {
          hint.textContent =
            "プロフィールの公開範囲で「MarchinZ Log」を公開にすると、シェアしたリンクを他の方が開いたときに内容を見られます。";
          hint.hidden = false;
          window.setTimeout(() => {
            hint.hidden = true;
          }, 10000);
        });
      } else if (shareText && sm?.setupSearchLikeShareMenuForButton) {
        sm.setupSearchLikeShareMenuForButton(shareBtn, shareText, shareUrl, "mll");
      }
      shareRow.appendChild(hint);
      shareRow.appendChild(shareBtn);
      host.appendChild(shareRow);
    }

    const sorted = [...logs].sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)));

    /** @returns {HTMLElement} */
    function yearChip(y, yt) {
      const sec = document.createElement("section");
      sec.className = "user-profile-mll-year";
      const hdr = document.createElement("header");
      hdr.className = "user-profile-mll-year-hdr";
      const h3 = document.createElement("h3");
      h3.className = "user-profile-mll-year-title";
      h3.textContent = `${y}年`;
      hdr.appendChild(h3);

      const parts = [];
      PROFILE_ROLE_ORDER.forEach((k) => {
        const c = yt[k] || 0;
        const piece = formatYearRoleCountJa(k, c);
        if (piece) parts.push(piece);
      });
      if (parts.length) {
        const sm = document.createElement("p");
        sm.className = "user-profile-mll-year-meta";
        sm.textContent = parts.join(" · ");
        hdr.appendChild(sm);
      }
      sec.appendChild(hdr);

      const ol = document.createElement("ol");
      ol.className = "user-profile-mll-timeline";

      const thisYearRows = sorted.filter((L) => String(L.event_date || "").startsWith(y));
      for (const log of thisYearRows) {
        const li = document.createElement("li");
        li.className = "user-profile-mll-row";
        const dateStr = String(log.event_date || "").trim();
        const [yy, mm, dd] = dateStr.split("-");
        const left = document.createElement("div");
        left.className = "user-profile-mll-date";
        left.textContent = yy && mm && dd ? `${yy}年 ${Number(mm)}月 ${Number(dd)}日` : dateStr;

        const spine = document.createElement("div");
        spine.className = "user-profile-mll-spine";
        spine.setAttribute("aria-hidden", "true");

        const right = document.createElement("div");
        right.className = "user-profile-mll-event";
        const a = document.createElement("a");
        a.className = "user-profile-mll-event-link";
        a.href = "#community/events";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = String(log.event_name || "（無題）");
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          openMatchedEvent(calMap, log);
        });
        const roleHint = document.createElement("span");
        roleHint.className = "user-profile-mll-role-hint";
        const rk = mapLogRole(log.role);
        roleHint.textContent = ROLE_LABEL_JA[rk] || "";
        right.appendChild(a);
        if (roleHint.textContent) right.appendChild(roleHint);
        if (shareCtx?.likeShow?.mll !== false && log?.id) {
          const likeHost = document.createElement("div");
          likeHost.className = "mll-log-like-host";
          appendProfileMllLikeRow(likeHost, log);
          right.appendChild(likeHost);
        }

        li.appendChild(left);
        li.appendChild(spine);
        li.appendChild(right);
        ol.appendChild(li);
      }
      sec.appendChild(ol);
      return sec;
    }

    const years = [...new Set(sorted.map((L) => String(L.event_date || "").slice(0, 4)).filter(Boolean))].sort(
      (a, b) => b.localeCompare(a),
    );
    if (!years.length) {
      const p = document.createElement("p");
      p.className = "user-profile-empty";
      p.textContent = "公開されているライフログはまだありません。";
      host.appendChild(p);
      return;
    }
    for (const y of years) {
      host.appendChild(yearChip(y, byYear[y] || emptyRoleTotals()));
    }
  }

  /**
   * @param {any} listsSnap
   * @param {any} marksSnap
   * @param {{ targetUid?: string; likeShow?: { videoBookmark?: boolean } } | null} [opts]
   */
  function renderVideoBookmarksGrouped(listsSnap, marksSnap, opts = null) {
    const host = el("#prof-mylist-videos");
    if (!host) return;
    host.replaceChildren();
    const profUid = String(opts?.targetUid || "").trim();
    const showLike = opts?.likeShow?.videoBookmark !== false && Boolean(profUid);

    const listMeta = new Map();
    listsSnap.forEach((doc) => {
      const d = doc.data() || {};
      const lo = Number(d.list_order);
      listMeta.set(doc.id, {
        name: String(d.name || doc.id).trim() || doc.id,
        visibility: String(d.visibility || "public").trim() === "private" ? "private" : "public",
        list_order: Number.isFinite(lo) ? lo : doc.id === DEFAULT_VIDEO_LIST_ID ? 0 : 500000,
      });
    });
    if (!listMeta.has(DEFAULT_VIDEO_LIST_ID)) {
      listMeta.set(DEFAULT_VIDEO_LIST_ID, { name: "マイリスト", visibility: "public", list_order: 0 });
    }

    /** @type {Map<string, any[]>} */
    const byList = new Map();
    marksSnap.forEach((doc) => {
      const row = doc.data() || {};
      const lid = inferVideoBookmarkListId(doc.id, row);
      if (!byList.has(lid)) byList.set(lid, []);
      byList.get(lid).push({ ...row, __docId: doc.id });
    });

    const ids = [...byList.keys()].sort((a, b) => {
      const ao = Number(listMeta.get(a)?.list_order);
      const bo = Number(listMeta.get(b)?.list_order);
      const ad = Number.isFinite(ao) ? ao : a === DEFAULT_VIDEO_LIST_ID ? 0 : 999999;
      const bd = Number.isFinite(bo) ? bo : b === DEFAULT_VIDEO_LIST_ID ? 0 : 999999;
      if (ad !== bd) return ad - bd;
      const na = listMeta.get(a)?.name || a;
      const nb = listMeta.get(b)?.name || b;
      return String(na).localeCompare(String(nb), "ja");
    });

    let totalCards = 0;
    for (const lid of ids) {
      const rawItems = byList.get(lid) || [];
      if (!rawItems.length) continue;
      const items = rawItems.slice().sort((x, y) => {
        const sx = Number(x.sort_index);
        const sy = Number(y.sort_index);
        const ax = Number.isFinite(sx) ? sx : 0;
        const ay = Number.isFinite(sy) ? sy : 0;
        if (ax !== ay) return ax - ay;
        return String(x.added_at || "").localeCompare(String(y.added_at || ""));
      });
      totalCards += items.length;
      const meta = listMeta.get(lid) || {
        name: lid === DEFAULT_VIDEO_LIST_ID ? "マイリスト" : lid,
        visibility: "public",
        list_order: lid === DEFAULT_VIDEO_LIST_ID ? 0 : 500000,
      };

      const sec = document.createElement("section");
      sec.className = "user-profile-mylist-list-section";
      sec.setAttribute("data-prof-mylist-list-id", lid);

      const head = document.createElement("div");
      head.className = "user-profile-mylist-list-head";
      const h3 = document.createElement("h3");
      h3.className = "user-profile-mylist-list-title";
      h3.textContent = meta.name;
      const right = document.createElement("div");
      right.className = "user-profile-mylist-list-head-right";
      const tag = document.createElement("span");
      const pub = meta.visibility !== "private";
      tag.className = `user-profile-vis-tag ${pub ? "user-profile-vis-tag--public" : "user-profile-vis-tag--private"}`;
      tag.textContent = pub ? "公開" : "非公開";
      tag.title = pub ? "プロフィールのこのタブに表示されます" : "プロフィールでは非表示です";
      right.appendChild(tag);
      head.appendChild(h3);
      head.appendChild(right);

      const grid = document.createElement("ul");
      grid.className = "user-profile-mylist-grid";
      for (const d of items) {
        const url = String(d.url || "").trim();
        const title = String(d.event_title || "").trim() || url || "動画";
        const org = String(d.org_team || "").trim();
        const li = document.createElement("li");
        li.className = "user-profile-mylist-card";
        if (d.__docId) li.dataset.mzProfVideoBm = String(d.__docId);
        const a = document.createElement("a");
        a.href = url || "#";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "user-profile-mylist-card-title";
        a.textContent = title;
        li.appendChild(a);
        if (org) {
          const p = document.createElement("p");
          p.className = "user-profile-mylist-card-meta";
          p.textContent = org;
          li.appendChild(p);
        }
        if (showLike && d.__docId) {
          const likeHost = document.createElement("div");
          likeHost.className = "user-profile-mylist-like-host";
          appendProfBookmarkLikeRow(likeHost, d.liked_by || {}, profUid, String(d.__docId), "video_bookmarks");
          li.appendChild(likeHost);
        }
        grid.appendChild(li);
      }

      sec.appendChild(head);
      sec.appendChild(grid);
      host.appendChild(sec);
    }

    if (!totalCards) {
      const p = document.createElement("p");
      p.className = "user-profile-empty";
      p.textContent = "まだありません。";
      host.appendChild(p);
    }
  }

  /**
   * @param {any} listsSnap
   * @param {any} marksSnap
   * @param {{ targetUid?: string; likeShow?: { channelBookmark?: boolean } } | null} [opts]
   */
  function renderChannelBookmarksGrouped(listsSnap, marksSnap, opts = null) {
    const host = el("#prof-mylist-yt");
    if (!host) return;
    host.replaceChildren();
    const profUid = String(opts?.targetUid || "").trim();
    const showLike = opts?.likeShow?.channelBookmark !== false && Boolean(profUid);

    const listMeta = new Map();
    listsSnap.forEach((doc) => {
      const d = doc.data() || {};
      const lo = Number(d.list_order);
      listMeta.set(doc.id, {
        name: String(d.name || doc.id).trim() || doc.id,
        visibility: String(d.visibility || "public").trim() === "private" ? "private" : "public",
        list_order: Number.isFinite(lo) ? lo : doc.id === DEFAULT_CHANNEL_LIST_ID ? 0 : 500000,
      });
    });
    if (!listMeta.has(DEFAULT_CHANNEL_LIST_ID)) {
      listMeta.set(DEFAULT_CHANNEL_LIST_ID, { name: "マイリスト", visibility: "public", list_order: 0 });
    }

    /** @type {Map<string, any[]>} */
    const byList = new Map();
    marksSnap.forEach((doc) => {
      const row = doc.data() || {};
      const lid = inferChannelBookmarkListId(doc.id, row);
      if (!byList.has(lid)) byList.set(lid, []);
      byList.get(lid).push({ ...row, __docId: doc.id });
    });

    const ids = [...byList.keys()].sort((a, b) => {
      const ao = Number(listMeta.get(a)?.list_order);
      const bo = Number(listMeta.get(b)?.list_order);
      const ad = Number.isFinite(ao) ? ao : a === DEFAULT_CHANNEL_LIST_ID ? 0 : 999999;
      const bd = Number.isFinite(bo) ? bo : b === DEFAULT_CHANNEL_LIST_ID ? 0 : 999999;
      if (ad !== bd) return ad - bd;
      const na = listMeta.get(a)?.name || a;
      const nb = listMeta.get(b)?.name || b;
      return String(na).localeCompare(String(nb), "ja");
    });

    let totalCards = 0;
    for (const lid of ids) {
      const rawItems = byList.get(lid) || [];
      if (!rawItems.length) continue;
      const items = rawItems.slice().sort((x, y) => {
        const sx = Number(x.sort_index);
        const sy = Number(y.sort_index);
        const ax = Number.isFinite(sx) ? sx : 0;
        const ay = Number.isFinite(sy) ? sy : 0;
        if (ax !== ay) return ax - ay;
        return String(x.added_at || "").localeCompare(String(y.added_at || ""));
      });
      totalCards += items.length;
      const meta = listMeta.get(lid) || {
        name: lid === DEFAULT_CHANNEL_LIST_ID ? "マイリスト" : lid,
        visibility: "public",
        list_order: lid === DEFAULT_CHANNEL_LIST_ID ? 0 : 500000,
      };

      const sec = document.createElement("section");
      sec.className = "user-profile-mylist-list-section";
      sec.setAttribute("data-prof-mylist-list-id", lid);

      const head = document.createElement("div");
      head.className = "user-profile-mylist-list-head";
      const h3 = document.createElement("h3");
      h3.className = "user-profile-mylist-list-title";
      h3.textContent = meta.name;
      const right = document.createElement("div");
      right.className = "user-profile-mylist-list-head-right";
      const tag = document.createElement("span");
      const pub = meta.visibility !== "private";
      tag.className = `user-profile-vis-tag ${pub ? "user-profile-vis-tag--public" : "user-profile-vis-tag--private"}`;
      tag.textContent = pub ? "公開" : "非公開";
      tag.title = pub ? "プロフィールのこのタブに表示されます" : "プロフィールでは非表示です";
      right.appendChild(tag);
      head.appendChild(h3);
      head.appendChild(right);

      const grid = document.createElement("ul");
      grid.className = "user-profile-mylist-grid";
      for (const d of items) {
        const url = String(d.channel_url || "").trim();
        const title = String(d.channel_name || "").trim() || "チャンネル";
        const li = document.createElement("li");
        li.className = "user-profile-mylist-card";
        if (d.__docId) li.dataset.mzProfChannelBm = String(d.__docId);
        const a = document.createElement("a");
        a.href = url || "#";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "user-profile-mylist-card-title";
        a.textContent = title;
        li.appendChild(a);
        if (showLike && d.__docId) {
          const likeHost = document.createElement("div");
          likeHost.className = "user-profile-mylist-like-host";
          appendProfBookmarkLikeRow(likeHost, d.liked_by || {}, profUid, String(d.__docId), "channel_bookmarks");
          li.appendChild(likeHost);
        }
        grid.appendChild(li);
      }

      sec.appendChild(head);
      sec.appendChild(grid);
      host.appendChild(sec);
    }

    if (!totalCards) {
      const p = document.createElement("p");
      p.className = "user-profile-empty";
      p.textContent = "まだありません。";
      host.appendChild(p);
    }
  }

  /** @param {number} n @param {string} id */
  function setCount(id, n) {
    const elc = el(id);
    if (elc) elc.textContent = String(n);
  }

  let activeTab = "mll";

  function setProfileTab(t) {
    const tab = isValidProfileTab(t) ? t : "mll";
    activeTab = tab;
    root?.querySelectorAll("[data-prof-tab]").forEach((b) => {
      const on = b.getAttribute("data-prof-tab") === tab;
      b.setAttribute("aria-selected", String(on));
      if (b instanceof HTMLElement) {
        b.setAttribute("tabindex", on ? "0" : "-1");
      }
    });
    for (const p of PROFILE_TAB_KEYS) {
      const pane = el(`#prof-pane-${p}`);
      if (pane) pane.hidden = p !== tab;
    }
  }

  function syncProfileUrlToTab(tab) {
    const uid = uidFromRoute();
    if (!uid || !isValidProfileTab(tab)) return;
    try {
      const base = `${location.pathname}${location.search}`;
      const nh = `#profile?uid=${encodeURIComponent(uid)}&tab=${encodeURIComponent(tab)}`;
      if (location.hash !== nh) {
        history.replaceState(null, "", `${base}${nh}`);
      }
      window.MarchinZRefreshSeoFromLocation?.();
    } catch {
      //
    }
  }

  function profileVisibleTabButtons() {
    return PROFILE_TAB_KEYS.map((k) => root?.querySelector(`[data-prof-tab="${k}"]`)).filter(
      (btn) => btn instanceof HTMLElement && !btn.hidden,
    );
  }

  function wireTabs() {
    const tablist = root?.querySelector('[role="tablist"]');
    root?.querySelectorAll("[data-prof-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!(btn instanceof HTMLElement) || btn.hidden) return;
        const t = btn.getAttribute("data-prof-tab") || "mll";
        setProfileTab(t);
        syncProfileUrlToTab(t);
        btn.focus();
      });
    });
    if (tablist) {
      tablist.addEventListener("keydown", (ev) => {
        if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft" && ev.key !== "ArrowDown" && ev.key !== "ArrowUp") {
          return;
        }
        const cur = ev.target?.closest?.("[data-prof-tab]");
        if (!(cur instanceof HTMLElement) || cur.hidden) return;
        const vis = profileVisibleTabButtons();
        const ix = vis.indexOf(cur);
        if (ix < 0) return;
        let nextIx = ix;
        if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
          nextIx = (ix + 1) % vis.length;
        } else {
          nextIx = (ix - 1 + vis.length) % vis.length;
        }
        ev.preventDefault();
        const next = vis[nextIx];
        const t = next.getAttribute("data-prof-tab") || "mll";
        setProfileTab(t);
        syncProfileUrlToTab(t);
        next.focus();
      });
    }
  }

  let wired = false;

  function clearProfModerationUi() {
    const bn = el("#prof-banned-note");
    if (bn) {
      bn.textContent = "";
      bn.hidden = true;
    }
    const bp = el("#prof-admin-ban-panel");
    if (bp) bp.hidden = true;
    adminBanCtx = { db: null, targetUid: "" };
  }

  /** 凍結の表示・管理者パネル（`#prof-banned-note` / `#prof-admin-ban-panel`） */
  function syncProfBannedAndAdmin(pdata, ctx) {
    const { viewerId, guest, isOwner, db, targetUid, withdrawn } = ctx;
    const bannedNote = el("#prof-banned-note");
    if (bannedNote) {
      if (!withdrawn && Boolean(pdata.banned)) {
        bannedNote.textContent = "利用規約に基づき、このアカウントは凍結されています。";
        bannedNote.hidden = false;
      } else {
        bannedNote.textContent = "";
        bannedNote.hidden = true;
      }
    }
    const banPanel = el("#prof-admin-ban-panel");
    const canModerate =
      Boolean(window.MLL_AUTH?.isAdmin?.()) &&
      Boolean(viewerId) &&
      !guest &&
      !isOwner &&
      !withdrawn &&
      Boolean(db) &&
      Boolean(targetUid);
    if (banPanel) banPanel.hidden = !canModerate;
    const statusEl = el("#prof-admin-ban-status");
    if (statusEl) {
      if (canModerate) {
        statusEl.textContent = pdata.banned
          ? `現在: 凍結中（${String(pdata.banned_at || "日時未記録")}）`
          : "現在: 未凍結";
      } else {
        statusEl.textContent = "";
      }
    }
    if (canModerate) {
      adminBanCtx = { db, targetUid };
    } else {
      adminBanCtx = { db: null, targetUid: "" };
    }
  }

  /** プロフィール主体（カバー・本人情報・タブ）を出すか。未指定時は案内だけにする */
  function setProfileChromeVisible(show) {
    const layout = root?.querySelector(".user-profile-layout");
    if (layout) layout.classList.toggle("user-profile-layout--no-target", !show);
  }

  function resetProfileChrome() {
    clearProfModerationUi();
    setProfileChromeVisible(false);
    stopCover();
    const cm = el("#prof-cover-mount");
    if (cm) {
      cm.innerHTML = "";
      cm.classList.remove(
        "user-profile-cover--cross",
        "user-profile-cover--zoom",
        "user-profile-cover--slide",
        "user-profile-cover--single",
        "user-profile-cover--empty",
      );
      delete cm.dataset.mzCoverUrlsJson;
      delete cm.dataset.mzCoverMode;
    }
    setText("#prof-display-name", "");
    setText("#prof-public-id", "");
    el("#prof-attrs")?.replaceChildren("");
    setText("#prof-bio", "");
    const img = el("#prof-avatar");
    if (img instanceof HTMLImageElement) {
      img.src = "";
      img.removeAttribute("src");
      img.alt = "";
    }
    setCount("#prof-count-mll", 0);
    setCount("#prof-count-videos", 0);
    setCount("#prof-count-yt", 0);
    setCount("#prof-count-logdiary", 0);
    const mmain = el("#prof-mll-main");
    if (mmain) mmain.replaceChildren("");
    const nhost = el("#prof-notifs-list");
    if (nhost) nhost.replaceChildren("");
    const ldr = el("#prof-log-diary-root");
    if (ldr) resetProfLogDiaryHost(ldr);
    renderVideoBookmarksGrouped(EMPTY_QUERY_SNAP, EMPTY_QUERY_SNAP);
    renderChannelBookmarksGrouped(EMPTY_QUERY_SNAP, EMPTY_QUERY_SNAP);
    for (const p of PROFILE_TAB_KEYS) {
      const pane = el(`#prof-pane-${p}`);
      if (pane) pane.hidden = p !== "mll";
    }
    root?.querySelectorAll("[data-prof-tab]").forEach((b) => {
      const on = b.getAttribute("data-prof-tab") === "mll";
      b.setAttribute("aria-selected", String(on));
      if (b instanceof HTMLElement) {
        b.hidden = false;
        b.setAttribute("tabindex", on ? "0" : "-1");
      }
    });
    const note = el("#prof-sections-private-note");
    if (note) {
      note.textContent = "";
      note.hidden = true;
    }
  }

  async function submitProfBanChange(banned) {
    const { db, targetUid } = adminBanCtx;
    if (!db || !targetUid) return;
    if (banned && !window.confirm("このアカウントを凍結しますか？ログインと書き込みができなくなります。")) return;
    if (!banned && !window.confirm("凍結を解除しますか？")) return;
    const ta = el("#prof-admin-ban-reason");
    const reason =
      banned && ta instanceof HTMLTextAreaElement ? String(ta.value || "").trim().slice(0, 500) : "";
    const now = new Date().toISOString();
    try {
      await db
        .collection("mll_profiles")
        .doc(targetUid)
        .update({
          banned,
          banned_at: banned ? now : "",
          banned_reason: banned ? reason : "",
          updated_at: now,
        });
      alert(banned ? "凍結しました。" : "凍結を解除しました。");
      void loadAndRender().catch(() => {});
    } catch (e) {
      alert(String(e?.message || e || "更新に失敗しました。"));
    }
  }

  async function loadAndRender() {
    const targetUid = uidFromRoute();
    const db = getDb();
    const viewer = window.MLL_AUTH?.getUser?.() || null;
    const viewerId = viewer?.id || null;

    setText("#prof-load-msg", !targetUid ? "表示するユーザーを指定できません（ログインするか、共有されたプロフィールリンクを開いてください）。" : "");

    if (!targetUid) {
      stopCover();
      resetProfileChrome();
      return;
    }

    setProfileChromeVisible(true);

    if (!wired) {
      wireTabs();
      wireNotificationPaneClicks();
      wired = true;
    }

    if (!db) {
      clearProfModerationUi();
      setText("#prof-load-msg", "データに接続できません。");
      return;
    }

    setText("#prof-load-msg", "読み込み中…");

    const profSnap = await db.collection("mll_profiles").doc(targetUid).get();
    const pdata = profSnap.exists ? profSnap.data() || {} : {};
    if (pdata.withdrawn) {
      const isOwnerW = Boolean(viewerId && String(viewerId) === String(targetUid));
      const guestW = !viewerId;
      syncProfBannedAndAdmin(pdata, {
        viewerId,
        guest: guestW,
        isOwner: isOwnerW,
        db,
        targetUid,
        withdrawn: true,
      });
      renderHeader(
        {
          display_name: "退会ユーザー",
          avatar_url: "",
          profile_bio: "",
          profile_attributes: [],
          marchinz_public_id: "",
        },
        targetUid,
      );
      setText("#prof-load-msg", "");
      stopCover();
      el("#prof-mll-main") && (el("#prof-mll-main").textContent = "");
      el("#prof-notifs-list")?.replaceChildren();
      renderVideoBookmarksGrouped(EMPTY_QUERY_SNAP, EMPTY_QUERY_SNAP);
      renderChannelBookmarksGrouped(EMPTY_QUERY_SNAP, EMPTY_QUERY_SNAP);
      setCount("#prof-count-mll", 0);
      setCount("#prof-count-videos", 0);
      setCount("#prof-count-yt", 0);
      setCount("#prof-count-logdiary", 0);
      return;
    }

    const sectionVis = parseSectionVisibility(pdata);
    const likeShow = parseLikeShowPrefs(pdata);
    const isOwner = Boolean(viewerId && String(viewerId) === String(targetUid));
    const guest = !viewerId;
    const loadMll = !guest && (isOwner || sectionVis.mll === "public");
    const loadVid = !guest && (isOwner || sectionVis.videos === "public");
    const loadYt = !guest && (isOwner || sectionVis.yt === "public");
    const loadDiary = !guest && (isOwner || sectionVis.logdiary === "public");

    const [logsSnap, videoListsSnap, vidSnap, chListsSnap, chSnap, calMap, notifsSnap] = await Promise.all([
      loadMll
        ? db.collection("mll_logs").orderBy("created_at", "desc").limit(800).get()
        : Promise.resolve(EMPTY_QUERY_SNAP),
      loadVid
        ? db.collection("mll_profiles").doc(targetUid).collection("video_lists").orderBy("created_at", "asc").limit(80).get()
        : Promise.resolve(EMPTY_QUERY_SNAP),
      loadVid
        ? db.collection("mll_profiles").doc(targetUid).collection("video_bookmarks").orderBy("added_at", "desc").limit(200).get()
        : Promise.resolve(EMPTY_QUERY_SNAP),
      loadYt
        ? db.collection("mll_profiles").doc(targetUid).collection("channel_lists").orderBy("created_at", "asc").limit(80).get()
        : Promise.resolve(EMPTY_QUERY_SNAP),
      loadYt
        ? db.collection("mll_profiles").doc(targetUid).collection("channel_bookmarks").orderBy("added_at", "desc").limit(200).get()
        : Promise.resolve(EMPTY_QUERY_SNAP),
      loadCalendarLookup(db),
      isOwner
        ? db
            .collection("mll_profiles")
            .doc(targetUid)
            .collection("notifications")
            .orderBy("created_at", "desc")
            .limit(80)
            .get()
        : Promise.resolve(EMPTY_QUERY_SNAP),
    ]);

    const profile = {
      display_name: pdata.display_name || "ユーザー",
      avatar_url: pdata.avatar_url || "",
      profile_bio: pdata.profile_bio || "",
      profile_attributes: Array.isArray(pdata.profile_attributes) ? pdata.profile_attributes : [],
      marchinz_public_id: String(pdata.marchinz_public_id || "").replace(/\D/g, ""),
    };

    renderHeader(profile, targetUid);

    mountCoverSingle(resolveCoverUrlFromPdata(pdata));

    if (!isOwner) {
      root?.querySelectorAll("[data-prof-tab]").forEach((btn) => {
        if (!(btn instanceof HTMLElement)) return;
        const k = btn.getAttribute("data-prof-tab") || "";
        if (!isValidProfileTab(k)) return;
        if (k === "notifs") {
          btn.hidden = true;
          return;
        }
        btn.hidden = sectionVis[k] === "private";
      });
    } else {
      root?.querySelectorAll("[data-prof-tab]").forEach((btn) => {
        if (btn instanceof HTMLElement) btn.hidden = false;
      });
    }

    const anyTabPublic =
      isOwner || PROFILE_TAB_KEYS.some((k) => sectionVis[k] === "public");
    const noteEl = el("#prof-sections-private-note");
    if (noteEl) {
      if (!anyTabPublic && !isOwner) {
        noteEl.textContent =
          "このユーザーは、プロフィール上の一覧（MarchinZ Log・動画マイリスト・YouTube・MarchinZ Note）をすべて非公開にしています。";
        noteEl.hidden = false;
      } else {
        noteEl.textContent = "";
        noteEl.hidden = true;
      }
    }

    /** @type {any[]} */
    const myLogs = [];
    logsSnap.forEach((doc) => {
      const x = doc.data() || {};
      const row = normalizeLog(doc.id, x);
      if (String(row.user_id) !== String(targetUid)) return;
      if (!canViewerSeeLog(row, viewerId)) return;
      myLogs.push(row);
    });

    if (guest && sectionVis.mll === "public") {
      renderGuestAuthGate(el("#prof-mll-main"));
    } else if (!loadMll && !isOwner) {
      const host = el("#prof-mll-main");
      if (host) {
        host.replaceChildren();
        const p = document.createElement("p");
        p.className = "user-profile-empty";
        p.textContent = "MarchinZ Log は非公開に設定されています。";
        host.appendChild(p);
      }
    } else {
      renderMLL(myLogs, calMap, {
        isOwner,
        sectionVis,
        displayName: profile.display_name,
        targetUid,
        viewerId,
        likeShow,
      });
    }

    if (guest && sectionVis.videos === "public") {
      renderGuestAuthGate(el("#prof-mylist-videos"));
    } else if (!loadVid && !isOwner) {
      const host = el("#prof-mylist-videos");
      if (host) {
        host.replaceChildren();
        const p = document.createElement("p");
        p.className = "user-profile-empty";
        p.textContent = "マイリスト大会動画は非公開に設定されています。";
        host.appendChild(p);
      }
    } else {
      renderVideoBookmarksGrouped(videoListsSnap, vidSnap, { targetUid, likeShow });
    }

    if (guest && sectionVis.yt === "public") {
      const yhost = el("#prof-mylist-yt");
      if (yhost) {
        yhost.replaceChildren();
        const wrap = document.createElement("div");
        wrap.className = "user-profile-auth-gate-li";
        renderGuestAuthGate(wrap);
        yhost.appendChild(wrap);
      }
    } else if (!loadYt && !isOwner) {
      const yhost = el("#prof-mylist-yt");
      if (yhost) {
        yhost.replaceChildren();
        const p = document.createElement("p");
        p.className = "user-profile-empty";
        p.textContent = "マイリストYouTubeは非公開に設定されています。";
        yhost.appendChild(p);
      }
    } else {
      renderChannelBookmarksGrouped(chListsSnap, chSnap, { targetUid, likeShow });
    }

    const storedCounts = readPublicProfCounts(pdata);
    let countMll;
    let countVideos;
    let countYt;
    let diaryCount = 0;

    if (guest) {
      countMll = sectionVis.mll === "public" ? storedCounts.mll : 0;
      countVideos = sectionVis.videos === "public" ? storedCounts.videos : 0;
      countYt = sectionVis.yt === "public" ? storedCounts.yt : 0;
      diaryCount = sectionVis.logdiary === "public" ? storedCounts.logdiary : 0;
    } else {
      countMll = !loadMll && !isOwner ? 0 : myLogs.length;
      countVideos = !loadVid && !isOwner ? 0 : vidSnap.size;
      countYt = !loadYt && !isOwner ? 0 : chSnap.size;
    }

    setCount("#prof-count-mll", countMll);
    setCount("#prof-count-videos", countVideos);
    setCount("#prof-count-yt", countYt);

    const logRoot = el("#prof-log-diary-root");
    if (guest && sectionVis.logdiary === "public" && logRoot) {
      resetProfLogDiaryHost(logRoot);
      const msgEl = logRoot.querySelector("[data-eld-msg]");
      const listEl = logRoot.querySelector("[data-eld-list]");
      if (msgEl) {
        msgEl.textContent = "";
        msgEl.hidden = true;
      }
      if (listEl) {
        listEl.replaceChildren();
        renderGuestAuthGate(listEl);
      }
    } else if (logRoot && !loadDiary && !isOwner) {
      resetProfLogDiaryHost(logRoot);
      const msgEl = logRoot.querySelector("[data-eld-msg]");
      if (msgEl) {
        msgEl.textContent = "MarchinZ Note は非公開に設定されています。";
        msgEl.hidden = false;
      }
    } else if (logRoot && typeof window.MarchinZEventLogDiary?.mount === "function") {
      resetProfLogDiaryHost(logRoot);
      try {
        const r = await window.MarchinZEventLogDiary.mount(logRoot, {
          targetUid,
          viewerId,
          db,
          likeShowLog: likeShow.logDiary,
        });
        diaryCount = Number(r?.diaryCount) || 0;
      } catch {
        diaryCount = 0;
      }
    }
    if (!guest) {
      diaryCount = !loadDiary && !isOwner ? 0 : diaryCount;
    }
    setCount("#prof-count-logdiary", diaryCount);

    if (isOwner) {
      await renderNotificationsPane(db, targetUid, notifsSnap);
    } else {
      const nh = el("#prof-notifs-list");
      if (nh) nh.replaceChildren();
    }

    if (!guest && isOwner) {
      await maybeSyncProfTabCountsToProfile(db, targetUid, isOwner, pdata, {
        mll: myLogs.length,
        videos: vidSnap.size,
        yt: chSnap.size,
        logdiary: diaryCount,
      });
    }

    const hp = typeof window.MarchinZProfileHashParams === "function" ? window.MarchinZProfileHashParams() : new URLSearchParams("");
    const wantTab = String(hp.get("tab") || "").trim();
    let pickTab = isValidProfileTab(wantTab) ? wantTab : "mll";
    if (!isOwner && pickTab === "notifs") pickTab = "mll";
    if (!isOwner && isValidProfileTab(pickTab) && pickTab !== "notifs" && sectionVis[pickTab] === "private") {
      pickTab = PROFILE_TAB_KEYS.find((k) => k !== "notifs" && sectionVis[k] === "public") ?? "mll";
    }
    setProfileTab(pickTab);

    const mylistFocusId = String(hp.get("mylist") || "").trim();
    if (mylistFocusId && root) {
      window.requestAnimationFrame(() => {
        const esc =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(mylistFocusId)
            : mylistFocusId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const sec = root.querySelector(`[data-prof-mylist-list-id="${esc}"]`);
        if (sec instanceof HTMLElement) sec.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    let vidBmFocus = "";
    let chBmFocus = "";
    try {
      vidBmFocus = String(sessionStorage.getItem("mz_prof_video_bm") || "").trim();
    } catch {
      vidBmFocus = "";
    }
    try {
      chBmFocus = String(sessionStorage.getItem("mz_prof_channel_bm") || "").trim();
    } catch {
      chBmFocus = "";
    }
    if ((vidBmFocus || chBmFocus) && root) {
      window.requestAnimationFrame(() => {
        try {
          if (vidBmFocus) sessionStorage.removeItem("mz_prof_video_bm");
        } catch {
          //
        }
        try {
          if (chBmFocus) sessionStorage.removeItem("mz_prof_channel_bm");
        } catch {
          //
        }
        const escV =
          vidBmFocus && typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(vidBmFocus)
            : vidBmFocus.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const escC =
          chBmFocus && typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(chBmFocus)
            : chBmFocus.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const card =
          (vidBmFocus && root.querySelector(`[data-mz-prof-video-bm="${escV}"]`)) ||
          (chBmFocus && root.querySelector(`[data-mz-prof-channel-bm="${escC}"]`));
        if (card instanceof HTMLElement) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.classList.add("user-profile-mylist-card--highlight");
          window.setTimeout(() => card.classList.remove("user-profile-mylist-card--highlight"), 4200);
        }
      });
    }

    syncProfBannedAndAdmin(pdata, {
      viewerId,
      guest,
      isOwner,
      db,
      targetUid,
      withdrawn: false,
    });

    setText("#prof-load-msg", "");
  }

  /** @param {string} id @param {any} x */
  function normalizeLog(id, x) {
    const visibility = x.visibility === "private" ? "private" : "public";
    let r = String(x.role || "").trim();
    if (r === "staff" || r === "チームスタッフ") r = "team_staff";
    else if (r === "manage" || r === "運営") r = "ops";
    else if (r === "出演") r = "perform";
    else if (r === "観戦") r = "watch";
    const role = ["watch", "perform", "team_staff", "ops"].includes(r) ? r : "watch";
    return { ...x, id, visibility, role };
  }

  /** @type {Promise<void>|null} */
  let pending = null;

  window.MarchinZUserProfile = {
    onRouteShow(pageId) {
      if (pageId !== "profile") {
        stopCover();
        return;
      }
      pending = loadAndRender().catch(() => setText("#prof-load-msg", "読み込みに失敗しました。"));
      void pending;
    },
  };

  if (root && !root.dataset.mzAdminBanBound) {
    root.dataset.mzAdminBanBound = "1";
    root.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.closest("#prof-admin-ban-freeze")) {
        ev.preventDefault();
        void submitProfBanChange(true);
        return;
      }
      if (t.closest("#prof-admin-ban-unfreeze")) {
        ev.preventDefault();
        void submitProfBanChange(false);
      }
    });
  }

  window.addEventListener("marchinz-profile-saved", () => {
    const hp = decodeURIComponent(location.hash.slice(1) || "").trim();
    if (!/^profile(?:\?|$)/i.test(hp)) return;
    const fromHash = String(window.MarchinZProfileUidFromHash?.() || "").trim();
    const me = String(window.MLL_AUTH?.getUser?.()?.id || "").trim();
    if (fromHash && me && fromHash !== me) return;
    void loadAndRender().catch(() => {});
  });
})();
