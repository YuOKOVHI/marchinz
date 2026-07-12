/**
 * 公開ユーザープロフィール（#page-profile / #profile?…）
 *
 * タブ（data-prof-tab / ?tab=）とデータの対応（件数はタブラベル横 #prof-count-*）:
 * | tab       | 画面                         | 本文 DOM            | Firestore 主ソース | プロフィール公開 |
 * |-----------|------------------------------|---------------------|---------------------|-------------------|
 * | notifs    | 通知（本人のみ）             | #prof-notifs-list   | mll_profiles/…/notifications | （本人のみ） |
 * | ops       | 運営より（本人のみ）         | #prof-ops-list      | mll_site_announcements/current | （本人のみ） |
 * | mll       | MarchinZ Log            | #prof-mll-main      | mll_logs           | section_vis_mll（一括） |
 * | videos    | マイリスト大会動画           | #prof-mylist-videos | video_lists + video_bookmarks | 各リスト visibility |
 * | yt        | マイリストYouTube            | #prof-mylist-yt     | channel_lists + channel_bookmarks | 各リスト visibility |
 * | logdiary  | MarchinZ Note            | #prof-log-diary-root| event_log_diaries  | 各 Note visibility |
 *
 * ヘッダー共通: mll_profiles 本人行（カバー1枚・表示名・公開ID・属性・自己紹介）
 * カバー: cover_image_url（レガシー cover_image_urls の先頭にフォールバック）。編集は auth.js から Storage へ JPEG 保存。
 * 未ログイン閲覧: 公開設定（`section_vis_*`・各 `visibility`）に応じて Log / Note / マイリストを表示（非公開タブはぼかし）。
 * 本人プロフィールの表示プレビュー: `previewMode` が `other_user` のときはログイン済みの他会員視点で再描画（Auth の currentUser は変更しない）
 * 深いリンク: #profile?uid=&tab=logdiary&event=（イベント日記） — `site-nav.js` の `MarchinZProfileHashParams` / `MarchinZProfileUidFromHash`
 * マイリスト高密度表示: 他会員視点で Log/Note が非公開かつ動画 or YouTube マイリストが公開のとき、各リスト先頭 18 件を小グリッドで開示（`compactMylistPeek`）。
 *
 * 関連ページ: #mll（mll.js から #profile?uid=）、#videos / #youtube（各マイリスト編集）、#community/events（カレンダー）
 */
(() => {
  const STORAGE_CAL_HIGHLIGHT = "mz_cal_ev_highlight";
  /** @type {{ stop: () => void } | null} */
  let coverRunner = null;

  /** Firebase Storage URL のブラウザキャッシュ差（通常タブ vs シークレット）を抑える */
  function withProfileImageCacheBust(url, cacheKey) {
    const u = String(url || "").trim();
    if (!/^https?:\/\//i.test(u)) return u;
    const key = String(cacheKey || "").trim();
    if (!key) return u;
    try {
      const parsed = new URL(u, window.location.href);
      parsed.searchParams.set("mzcb", key.slice(0, 40));
      return parsed.href;
    } catch {
      const sep = u.includes("?") ? "&" : "?";
      return `${u}${sep}mzcb=${encodeURIComponent(key.slice(0, 40))}`;
    }
  }

  /** @typedef {{ id: string; date: string; title: string }} CalEvBrief */

  const root =
    typeof document !== "undefined" ? document.getElementById("page-profile") : null;

  /** 管理者の凍結操作の対象（クリック委譲で参照） */
  let adminBanCtx = { db: /** @type {any} */ (null), targetUid: "" };

  /** `data-prof-tab` / `#prof-pane-*` / `?tab=` / section_vis_* と一致（index.html と揃える） */
  const PROFILE_TAB_KEYS = /** @type {readonly ["notifs", "ops", "mll", "logdiary", "videos", "yt", "base"]} */ ([
    "notifs",
    "ops",
    "mll",
    "logdiary",
    "videos",
    "yt",
    "base",
  ]);

  const DEFAULT_VIDEO_LIST_ID = "default";
  const DEFAULT_CHANNEL_LIST_ID = "default";
  /** 来訪者が Log/Note 非公開でマイリスト系だけ公開のとき、プロフ上で先頭だけ小さく見せる上限 */
  const MYLIST_PEEK_MAX = 18;

  /** 通知一覧のローカル状態（既読・削除を即時 UI 反映） */
  /** @type {{ id: string; read: boolean }[]} */
  let profNotifState = [];
  /** @type {"unread"|"read"} */
  let profNotifFilterMode = "unread";

  /**
   * 本人が「ログインした別会員の視点」でプレビューするとき、`canViewerSeeLog` 等で「プロフィール本人ではない」扱いにするための擬似 UID。
   * Firebase Auth の currentUser とは無関係（あくまで画面ロジック用）。
   */
  const PROF_PRIVACY_PREVIEW_UID = "__prof_privacy_preview__";

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

  /**
   * プロフィール本文と同じ基準: ブックマークが1件以上あるリスト ID の数（空の video_lists ドキュメントは数えない）。
   * @param {any} marksSnap
   * @param {(docId: string, data: Record<string, unknown>) => string} inferListId
   */
  /** @param {string} lid */
  function looksLikeOpaqueListId(lid) {
    return /^L_[a-z0-9][a-z0-9_-]{4,}$/i.test(String(lid || "").trim());
  }

  /**
   * @param {any} listsSnap
   * @param {string} defaultListId
   */
  function buildListMetaFromSnap(listsSnap, defaultListId) {
    /** @type {Map<string, { name: string; oshi_text: string; visibility: string; list_order: number; liked_by: object }>} */
    const listMeta = new Map();
    listsSnap.forEach((doc) => {
      const d = doc.data() || {};
      const lo = Number(d.list_order);
      listMeta.set(doc.id, {
        name: String(d.name || doc.id).trim() || doc.id,
        oshi_text: String(d.oshi_text || "").trim(),
        visibility: String(d.visibility || "public").trim() === "private" ? "private" : "public",
        list_order: Number.isFinite(lo) ? lo : doc.id === defaultListId ? 0 : 500000,
        liked_by: d.liked_by && typeof d.liked_by === "object" ? d.liked_by : {},
      });
    });
    return listMeta;
  }

  /**
   * 他会員閲覧時: コレクションクエリで取れなかった公開リスト名を doc 単位で補完
   * @param {FirebaseFirestore.Firestore} db
   * @param {string} profUid
   * @param {"video_lists"|"channel_lists"} coll
   * @param {Map<string, { name: string; oshi_text: string; visibility: string; list_order: number; liked_by: object }>} listMeta
   * @param {string[]} listIds
   */
  async function enrichMylistMetaForVisitor(db, profUid, coll, listMeta, listIds) {
    const missing = listIds.filter((lid) => {
      const m = listMeta.get(lid);
      return !m?.name || m.name === lid || looksLikeOpaqueListId(m.name);
    });
    await Promise.all(
      missing.map(async (lid) => {
        try {
          const snap = await db.collection("mll_profiles").doc(profUid).collection(coll).doc(lid).get();
          if (!snap.exists) return;
          const d = snap.data() || {};
          if (String(d.visibility || "public").trim() === "private") return;
          const lo = Number(d.list_order);
          listMeta.set(lid, {
            name: String(d.name || "").trim() || "マイリスト",
            oshi_text: String(d.oshi_text || "").trim(),
            visibility: "public",
            list_order: Number.isFinite(lo) ? lo : 500000,
            liked_by: d.liked_by && typeof d.liked_by === "object" ? d.liked_by : {},
          });
        } catch (e) {
          console.warn("[profile] enrichMylistMetaForVisitor", coll, lid, e);
        }
      }),
    );
  }

  /**
   * @param {string} lid
   * @param {Map<string, { name: string; oshi_text: string; visibility: string; list_order: number; liked_by: object }>} listMeta
   */
  function resolveMylistMeta(lid, listMeta) {
    const m = listMeta.get(lid);
    if (m) {
      const n = String(m.name || "").trim();
      if (n && n !== lid && !looksLikeOpaqueListId(n)) return m;
    }
    return {
      name: "マイリスト",
      oshi_text: m?.oshi_text || "",
      visibility: m?.visibility === "private" ? "private" : "public",
      list_order: m?.list_order ?? 500000,
      liked_by: m?.liked_by && typeof m.liked_by === "object" ? m.liked_by : {},
    };
  }

  function countMylistTabListsWithBookmarks(marksSnap, inferListId) {
    const ids = new Set();
    marksSnap.forEach((doc) => {
      const row = doc.data() || {};
      ids.add(inferListId(doc.id, row));
    });
    return ids.size;
  }

  /** @param {Record<string, unknown>|null|undefined} pdata */
  function isProfileBanned(pdata) {
    return Boolean(pdata && pdata.banned);
  }

  /** 凍結時にプロフィールへ書き込む非公開フラグ（管理人の update 用） */
  function buildBanPrivacyProfilePatch() {
    return {
      section_vis_mll: "private",
      section_vis_videos: "private",
      section_vis_yt: "private",
      section_vis_logdiary: "private",
      prof_count_mll: 0,
      prof_count_videos: 0,
      prof_count_yt: 0,
      prof_count_logdiary: 0,
    };
  }

  /**
   * 他ユーザーが凍結プロフィールを見るとき（ニックネーム・画像・カバーのみ）
   * @param {Record<string, unknown>} pdata
   * @param {string} targetUid
   * @param {{ viewerId: string|null; guest: boolean; isOwner: boolean; db: import('firebase').firestore.Firestore; targetUid: string }} ctx
   */
  function renderBannedVisitorLimitedProfile(pdata, targetUid, ctx) {
    const layout = root?.querySelector(".user-profile-layout");
    if (layout) layout.classList.add("user-profile-layout--banned-limited");

    syncProfBannedAndAdmin(pdata, { ...ctx, withdrawn: false });

    renderHeader(
      {
        display_name: pdata.display_name || "ユーザー",
        avatar_url: pdata.avatar_url || "",
        profile_bio: "",
        profile_attributes: [],
        profile_address_prefecture: "",
        profile_address_prefecture_public: false,
        marchinz_public_id: "",
        updated_at: String(pdata.updated_at || "").trim(),
      },
      targetUid,
    );
    const pidEl = el("#prof-public-id");
    if (pidEl) {
      pidEl.textContent = "";
      pidEl.hidden = true;
    }
    const bioEl = el("#prof-bio");
    if (bioEl) {
      bioEl.textContent = "";
      bioEl.hidden = true;
    }
    const prefEl = el("#prof-address-prefecture");
    if (prefEl) {
      prefEl.textContent = "";
      prefEl.hidden = true;
    }
    const attrsHost = el("#prof-attrs");
    if (attrsHost) attrsHost.replaceChildren();

    mountCoverSingle(resolveCoverUrlFromPdata(pdata), String(pdata.updated_at || "").trim());

    root?.querySelectorAll("[data-prof-tab]").forEach((btn) => {
      if (btn instanceof HTMLElement) btn.hidden = true;
    });
    for (const p of PROFILE_TAB_KEYS) {
      const pane = el(`#prof-pane-${p}`);
      if (pane) {
        pane.hidden = true;
        pane.setAttribute("aria-hidden", "true");
      }
    }
    const tabNav = root?.querySelector(".user-profile-tabs");
    if (tabNav instanceof HTMLElement) tabNav.hidden = true;

    renderMllSectionVisControls("private", false);
    el("#prof-mll-main")?.replaceChildren();
    el("#prof-notifs-list")?.replaceChildren();
    renderVideoBookmarksGrouped(EMPTY_QUERY_SNAP, EMPTY_QUERY_SNAP);
    renderChannelBookmarksGrouped(EMPTY_QUERY_SNAP, EMPTY_QUERY_SNAP);
    const logRoot = el("#prof-log-diary-root");
    if (logRoot) resetProfLogDiaryHost(logRoot);
    setCount("#prof-count-mll", 0);
    setCount("#prof-count-videos", 0);
    setCount("#prof-count-yt", 0);
    setCount("#prof-count-logdiary", 0);

    const noteEl = el("#prof-sections-private-note");
    if (noteEl) {
      noteEl.textContent =
        "このアカウントは凍結されています。ニックネーム・プロフィール画像・カバー写真以外は表示されません。";
      noteEl.hidden = false;
    }
    const notifRow = root?.querySelector(".user-profile-notif-row");
    if (notifRow) notifRow.hidden = true;
  }

  /** @param {Record<string, unknown>} pdata */
  function parseMllSectionVisibility(pdata) {
    if (isProfileBanned(pdata)) return "private";
    return String(pdata.section_vis_mll || "").trim() === "private" ? "private" : "public";
  }

  function parseLogDiarySectionVisibility(pdata) {
    if (isProfileBanned(pdata)) return "private";
    return String(pdata.section_vis_logdiary || "").trim() === "private" ? "private" : "public";
  }

  /** @param {Record<string, unknown>} pdata */
  function parseVideosSectionVisibility(pdata) {
    if (isProfileBanned(pdata)) return "private";
    return String(pdata.section_vis_videos || "").trim() === "private" ? "private" : "public";
  }

  /** @param {Record<string, unknown>} pdata */
  function parseYtSectionVisibility(pdata) {
    if (isProfileBanned(pdata)) return "private";
    return String(pdata.section_vis_yt || "").trim() === "private" ? "private" : "public";
  }

  /** @param {"public"|"private"} vis */
  function mllSectionVisLabel(vis) {
    return vis === "private" ? "MarchinZ Log：非公開" : "MarchinZ Log：公開";
  }

  /**
   * @param {"public"|"private"} vis
   * @param {boolean} showOwner
   */
  function renderMllSectionVisControls(vis, showOwner) {
    const label = mllSectionVisLabel(vis);
    for (const sel of ["#prof-mll-vis-pane"]) {
      const btn = el(sel);
      if (!btn) continue;
      btn.hidden = !showOwner;
      btn.textContent = label;
      btn.classList.toggle("user-profile-mll-vis-toggle--private", vis === "private");
    }
  }

  /** @param {"public"|"private"} currentVis */
  async function toggleMllSectionVisibility(currentVis) {
    const next = currentVis === "public" ? "private" : "public";
    const nextLabel = mllSectionVisLabel(next);
    if (!window.confirm(`「${nextLabel}」に変更しますか？`)) return;
    const uid = uidFromRoute();
    const db = getDb();
    if (!uid || !db) return;
    try {
      await db.collection("mll_profiles").doc(uid).update({
        section_vis_mll: next,
        updated_at: new Date().toISOString(),
      });
      renderMllSectionVisControls(next, true);
      void loadAndRender().catch(() => {});
    } catch (e) {
      alert("更新に失敗しました: " + (e?.message || ""));
    }
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

  const PROF_EMPTY = {
    mll: "まだMarchinZ Logはありません",
    videos: "まだ大会動画マイリストはありません",
    yt: "まだYouTubeマイリストはありません",
    note: "まだMarchinZ Noteはありません",
  };

  /** @param {HTMLElement | null} host @param {string} text */
  function renderProfEmpty(host, text) {
    if (!host) return;
    host.replaceChildren();
    const box = document.createElement("div");
    box.className = "empty-state user-profile-empty";
    box.textContent = text;
    host.appendChild(box);
  }

  /** @param {HTMLElement | null} host */
  function renderProfPrivateBlur(host) {
    if (!host) return;
    host.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "user-profile-private-blur";
    const faux = document.createElement("div");
    faux.className = "user-profile-private-blur__faux";
    faux.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 5; i++) {
      const bar = document.createElement("span");
      bar.className = "user-profile-private-blur__bar";
      faux.appendChild(bar);
    }
    const label = document.createElement("p");
    label.className = "user-profile-private-blur__label";
    label.textContent = "非公開です";
    wrap.appendChild(faux);
    wrap.appendChild(label);
    host.appendChild(wrap);
  }

  /**
   * @param {HTMLElement} headEl
   * @param {"videos"|"yt"} kind
   */
  function appendMylistPrivateLock(headEl, kind) {
    const lock = document.createElement("div");
    lock.className = "user-profile-mylist-private-lock";
    const strip = document.createElement("ul");
    strip.className = "user-profile-mylist-thumb-strip user-profile-mylist-thumb-strip--faux";
    const n = kind === "yt" ? 8 : 6;
    for (let i = 0; i < n; i++) {
      const li = document.createElement("li");
      li.className = "user-profile-mylist-thumb-slot";
      strip.appendChild(li);
    }
    const label = document.createElement("p");
    label.className = "user-profile-private-blur__label";
    label.textContent = "非公開です";
    lock.appendChild(strip);
    lock.appendChild(label);
    headEl.appendChild(lock);
    headEl.classList.remove("user-profile-mylist-list-head--toggle");
    headEl.removeAttribute("role");
    headEl.removeAttribute("tabindex");
    headEl.style.cursor = "default";
  }

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
    aSignup.setAttribute("data-mll-auth-entry", "signup");
    aSignup.textContent = "新規登録する";
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
    window.MarchinZIcons?.decorateAuthEntryButtons?.();
  }

  /** @param {Record<string, unknown>} pdata */
  function readPublicProfCounts(pdata) {
    const n = (profKey, prefKey) =>
      Math.min(50000, Math.max(0, Number(pdata[profKey] ?? pdata[prefKey]) || 0));
    return {
      mll: n("prof_count_mll", "pref_count_mll"),
      videos: n("prof_count_videos", "pref_count_videos"),
      yt: n("prof_count_yt", "pref_count_yt"),
      logdiary: n("prof_count_logdiary", "pref_count_logdiary"),
    };
  }

  /**
   * タブラベル用件数。本人は実データ、未登録・他ユーザーは prof_count_*（公開設定に関わらず）。
   * @param {boolean} isOwner
   * @param {{ mll: number; videos: number; yt: number; logdiary: number }} stored
   * @param {{ mll: number; videos: number; yt: number; logdiary: number }} computed
   */
  function resolveProfTabDisplayCounts(isOwner, stored, computed) {
    if (isOwner) return { ...computed };
    return { ...stored };
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
  const PROF_LOG_DIARY_SHELL_SEARCH =
    '<input type="search" class="mz-search-input eld-search-input" data-eld-search placeholder="タイトル・本文・イベント名で検索…" autocomplete="off" />';
  const PROF_LOG_DIARY_SHELL_FILTER =
    '<nav class="eld-note-filter-tabs" role="tablist" aria-label="MarchinZ Note の表示" data-eld-filter-nav hidden>' +
    '<button type="button" class="eld-note-filter-btn" role="tab" data-eld-filter="written" aria-selected="true">作成済</button>' +
    '<button type="button" class="eld-note-filter-btn" role="tab" data-eld-filter="unwritten" aria-selected="false">未記入</button>' +
    '<button type="button" class="eld-note-filter-btn" role="tab" data-eld-filter="all" aria-selected="false">すべて</button>' +
    "</nav>";
  const PROF_LOG_DIARY_SHELL_TAIL =
    '<div data-eld-list></div><dialog class="eld-dialog" data-eld-dialog><div class="eld-dialog-surface" role="document"><button type="button" class="eld-dialog-x" data-eld-dialog-close aria-label="閉じる">×</button><div data-eld-dialog-body></div></div></dialog>';

  /**
   * @param {HTMLElement | null} logRoot
   * @param {{ includeSearch?: boolean }} [opts]
   */
  function resetProfLogDiaryHost(logRoot, opts = null) {
    if (!(logRoot instanceof HTMLElement)) return;
    delete logRoot.dataset.eldDlgWired;
    const includeSearch = opts?.includeSearch !== false;
    logRoot.innerHTML =
      '<p class="user-profile-load-msg" data-eld-msg hidden></p>' +
      (includeSearch ? PROF_LOG_DIARY_SHELL_SEARCH : "") +
      (includeSearch ? PROF_LOG_DIARY_SHELL_FILTER : "") +
      PROF_LOG_DIARY_SHELL_TAIL;
  }

  /** @param {string} tab */
  function isValidProfileTab(tab) {
    return PROFILE_TAB_KEYS.includes(tab);
  }

  const SS_COMM_THREAD_FOCUS = "mz_comm_thread_focus";
  const SS_LEGACY_DEFAULT_MYLIST_CLEANED = "mz_legacy_default_mylist_cleaned_v1";

  /**
   * 通知タイトル（いいね対象）クリック時の画面遷移。
   * @param {HTMLElement} goEl
   * @param {HTMLElement} [articleEl]
   */
  function navigateFromNotifGo(goEl, articleEl) {
    if (!(goEl instanceof HTMLElement)) return;
    const artGo = articleEl instanceof HTMLElement ? articleEl : goEl.closest("article[data-mz-notif-id]");
    if (artGo instanceof HTMLElement && artGo.dataset.mzRead !== "1") {
      void markNotificationArticleRead(artGo);
    }
    const k = goEl.getAttribute("data-mz-notif-go") || "";
    const tid = String(goEl.getAttribute("data-mz-notif-target-id") || "").trim();
    const tr = String(goEl.getAttribute("data-mz-notif-thread") || "").trim();
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
      const focusId = String(tr || tid).trim();
      if (!focusId) return;
      try {
        sessionStorage.setItem(SS_COMM_THREAD_FOCUS, focusId);
      } catch {
        //
      }
      const dest = "#community/board";
      if (location.hash === dest) {
        window.dispatchEvent(new CustomEvent("marchinz-community-focus-thread"));
      } else {
        window.location.hash = dest;
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("marchinz-community-focus-thread"));
        }, 80);
      }
      return;
    }
    if (k === "mll") {
      const href = String(goEl.getAttribute("data-mz-notif-href") || "#profile").trim();
      window.location.hash = href.startsWith("#") ? href : `#${href}`;
      return;
    }
    if (k === "video_bm") {
      const ou = String(goEl.getAttribute("data-mz-notif-owner") || "").trim();
      try {
        sessionStorage.setItem("mz_prof_video_bm", tid);
      } catch {
        //
      }
      window.location.hash = `#profile?uid=${encodeURIComponent(ou)}&tab=videos`;
      return;
    }
    if (k === "video_list") {
      const ou = String(goEl.getAttribute("data-mz-notif-owner") || "").trim();
      const lid = String(goEl.getAttribute("data-mz-notif-list-id") || "").trim();
      window.location.hash = `#profile?uid=${encodeURIComponent(ou)}&tab=videos&mylist=${encodeURIComponent(lid)}`;
      return;
    }
    if (k === "ch_bm") {
      const ou = String(goEl.getAttribute("data-mz-notif-owner") || "").trim();
      try {
        sessionStorage.setItem("mz_prof_channel_bm", tid);
      } catch {
        //
      }
      window.location.hash = `#profile?uid=${encodeURIComponent(ou)}&tab=yt`;
      return;
    }
    if (k === "channel_list") {
      const ou = String(goEl.getAttribute("data-mz-notif-owner") || "").trim();
      const lid = String(goEl.getAttribute("data-mz-notif-list-id") || "").trim();
      window.location.hash = `#profile?uid=${encodeURIComponent(ou)}&tab=yt&mylist=${encodeURIComponent(lid)}`;
      return;
    }
    if (k === "log_diary") {
      const ou = String(goEl.getAttribute("data-mz-notif-owner") || "").trim();
      window.location.hash = `#profile?uid=${encodeURIComponent(ou)}&tab=logdiary&event=${encodeURIComponent(tid)}`;
    }
  }

  /** 旧「マイリスト」（list id: default）を本人プロフィール表示時に一度だけ削除 */
  async function cleanupLegacyDefaultMylistLists(db, ownerUid) {
    const uid = String(ownerUid || "").trim();
    if (!db || !uid) return;
    try {
      if (sessionStorage.getItem(SS_LEGACY_DEFAULT_MYLIST_CLEANED) === "1") return;
    } catch {
      //
    }
    let changed = false;
    for (const kind of ["videos", "yt"]) {
      const coll = kind === "yt" ? "channel_lists" : "video_lists";
      const delFn =
        kind === "yt"
          ? window.MarchinZYoutubeChannelMylist?.deleteListCascade
          : window.MarchinZVideoMylist?.deleteListCascade;
      if (typeof delFn !== "function") continue;
      try {
        const snap = await db.collection("mll_profiles").doc(uid).collection(coll).doc("default").get();
        if (!snap.exists) continue;
        const name = String(snap.data()?.name || "").trim();
        if (name === "マイリスト" || snap.id === "default") {
          await delFn("default");
          changed = true;
        }
      } catch (e) {
        console.warn("[MarchinZ] cleanupLegacyDefaultMylistLists", kind, e);
      }
    }
    if (changed) {
      try {
        sessionStorage.setItem(SS_LEGACY_DEFAULT_MYLIST_CLEANED, "1");
      } catch {
        //
      }
      window.dispatchEvent(new CustomEvent("marchinz-mylist-updated"));
      window.dispatchEvent(new CustomEvent("marchinz-channel-mylist-updated"));
    }
  }

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
  function navigateToProfileUid(actorUid) {
    const uid = String(actorUid || "").trim();
    if (!uid) return;
    const next = `#profile?uid=${encodeURIComponent(uid)}`;
    if (location.hash === next) {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    location.hash = next;
  }

  function notifOwnerUidFromHost() {
    const host = el("#prof-notifs-list");
    const fromHost = String(host?.dataset.mzNotifOwnerUid || "").trim();
    if (fromHost) return fromHost;
    return uidFromRoute();
  }

  /** 通知の read 更新は必ずログイン UID（受信箱の owner）で行う */
  function notifOwnerUidForWrite() {
    const me = String(window.MLL_AUTH?.getUser?.()?.id || "").trim();
    if (me) return me;
    return notifOwnerUidFromHost();
  }

  function isNotifDocRead(readVal) {
    if (readVal === true || readVal === 1) return true;
    const s = String(readVal ?? "")
      .trim()
      .toLowerCase();
    return s === "true" || s === "1";
  }

  /** @param {HTMLElement} article @param {boolean} show */
  function setProfNotifArticleVisible(article, show) {
    article.hidden = !show;
    article.style.display = show ? "" : "none";
  }

  /** @param {string} id @param {boolean} read */
  function setProfNotifRowReadById(id, read) {
    const row = profNotifState.find((r) => r.id === id);
    if (row) row.read = read;
  }

  /** @param {string} id */
  function removeProfNotifRowById(id) {
    profNotifState = profNotifState.filter((r) => r.id !== id);
  }

  /** ローカル状態と DOM を同期して未読/既読タブ表示を更新 */
  function refreshProfNotifListUi() {
    const host = el("#prof-notifs-list");
    if (!(host instanceof HTMLElement)) return;
    const mode = profNotifFilterMode === "read" ? "read" : "unread";
    host.dataset.mzNotifFilter = mode;
    host.querySelectorAll("[data-mz-notif-filter]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const on = btn.getAttribute("data-mz-notif-filter") === mode;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    let shown = 0;
    host.querySelectorAll("article[data-mz-notif-id]").forEach((article) => {
      if (!(article instanceof HTMLElement)) return;
      const nid = String(article.dataset.mzNotifId || "").trim();
      const row = profNotifState.find((r) => r.id === nid);
      const isRead = row ? row.read : article.dataset.mzRead === "1";
      if (isRead) {
        article.dataset.mzRead = "1";
        article.classList.remove("user-prof-notif--unread");
        const markBtn = article.querySelector("[data-mz-notif-mark-read]");
        if (markBtn instanceof HTMLElement) markBtn.hidden = true;
      } else {
        delete article.dataset.mzRead;
        article.classList.add("user-prof-notif--unread");
        const markBtn = article.querySelector("[data-mz-notif-mark-read]");
        if (markBtn instanceof HTMLElement) markBtn.hidden = false;
      }
      const show = mode === "read" ? isRead : !isRead;
      setProfNotifArticleVisible(article, show);
      if (show) shown += 1;
    });
    const empty = host.querySelector(".user-profile-empty");
    if (empty instanceof HTMLElement) {
      empty.hidden = shown > 0;
      if (!empty.hidden) {
        empty.textContent = mode === "unread" ? "新規の通知はありません" : "既読の通知はありません";
      }
    }
    refreshProfNotifUnreadBadge();
  }

  async function reloadProfNotificationsPane() {
    const d = getDb();
    const ownerUid = notifOwnerUidFromHost() || String(window.MLL_AUTH?.getUser?.()?.id || "").trim();
    if (!d || !ownerUid) return;
    try {
      const snap = await d
        .collection("mll_profiles")
        .doc(ownerUid)
        .collection("notifications")
        .orderBy("created_at", "desc")
        .limit(80)
        .get();
      await renderNotificationsPane(d, ownerUid, snap);
    } catch (e) {
      console.warn("[MarchinZ] reloadProfNotificationsPane failed", e);
    }
  }

  function renderOpsPane() {
    const host = el("#prof-ops-list");
    if (!host) return;
    host.replaceChildren();
    const feed = document.createElement("div");
    feed.className = "user-prof-ops-items";
    host.appendChild(feed);
    const empty = document.createElement("p");
    empty.className = "user-profile-empty";
    empty.textContent = "運営からのお知らせはありません";
    empty.hidden = true;
    host.appendChild(empty);
    const siteAnnArt =
      typeof window.MarchinZSiteAnnouncement?.renderNotifCard === "function"
        ? window.MarchinZSiteAnnouncement.renderNotifCard(feed)
        : null;
    if (siteAnnArt) {
      empty.hidden = true;
      feed.hidden = false;
    } else {
      empty.hidden = false;
      feed.hidden = true;
    }
    refreshOpsUnreadBadge();
  }

  async function renderNotificationsPane(db, targetUid, snap) {
    const host = el("#prof-notifs-list");
    if (!host) return;
    host.dataset.mzNotifOwnerUid = String(targetUid || "").trim();
    host.replaceChildren();
    const tool = document.createElement("div");
    tool.className = "user-prof-notif-filters";
    tool.innerHTML =
      '<button type="button" class="user-prof-notif-filter-btn" data-mz-notif-filter="unread" aria-pressed="true">未読</button>' +
      '<button type="button" class="user-prof-notif-filter-btn" data-mz-notif-filter="read" aria-pressed="false">既読</button>';
    host.appendChild(tool);
    const feed = document.createElement("div");
    feed.className = "user-prof-notifs-items";
    host.appendChild(feed);
    const empty = document.createElement("p");
    empty.className = "user-profile-empty";
    empty.hidden = true;
    host.appendChild(empty);
    const hasLikeNotifs = Boolean(snap && !snap.empty);
    if (!hasLikeNotifs) {
      profNotifState = [];
      profNotifFilterMode = "unread";
      empty.textContent = "新規の通知はありません";
      empty.hidden = false;
      tool.hidden = true;
      return;
    }
    /** @type {{ id: string; kind?: string; actor_uid?: string; actor_name?: string; target_title?: string; target_id?: string; target_href?: string; thread_root_id?: string; read?: boolean; created_at?: string }[]} */
    const rows = [];
    if (hasLikeNotifs) snap.forEach((d) => rows.push({ id: d.id, ...(d.data() || {}) }));
    profNotifState = rows.map((n) => ({
      id: String(n.id || ""),
      read: isNotifDocRead(n.read),
    }));
    profNotifFilterMode = "unread";
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
    if (!hasLikeNotifs) tool.hidden = false;
    for (const n of rows) {
      const article = document.createElement("article");
      const isRead = isNotifDocRead(n.read);
      article.className = "user-prof-notif" + (isRead ? "" : " user-prof-notif--unread");
      article.dataset.mzNotifId = n.id;
      if (isRead) article.dataset.mzRead = "1";

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
      if (!withdrawn && auid) {
        avWrap.classList.add("user-prof-notif-avatar-wrap--link");
        avWrap.setAttribute("role", "link");
        avWrap.tabIndex = 0;
        const goActor = (e) => {
          e.preventDefault();
          e.stopPropagation();
          navigateToProfileUid(auid);
        };
        avWrap.addEventListener("click", goActor);
        avWrap.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigateToProfileUid(auid);
          }
        });
      }

      const body = document.createElement("div");
      body.className = "user-prof-notif-body";

      const line1 = document.createElement("p");
      line1.className = "user-prof-notif-line1";
      const aProf = document.createElement("a");
      aProf.className = "user-prof-notif-actor";
      aProf.href = `#profile?uid=${encodeURIComponent(auid)}`;
      aProf.textContent = withdrawn ? "退会ユーザー" : labelName;
      if (!withdrawn && auid) {
        aProf.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          navigateToProfileUid(auid);
        });
      } else {
        aProf.removeAttribute("href");
        aProf.classList.add("user-prof-notif-actor--static");
      }
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
        suffix = "」（動画）にいいねしました。";
      } else if (kindStr === "like_video_list") {
        prefix = "あなたの大会動画マイリスト「";
        suffix = "」（リスト全体）にいいねしました。";
      } else if (kindStr === "like_channel_bookmark") {
        prefix = "あなたの YouTube マイリスト「";
        suffix = "」（チャンネル）にいいねしました。";
      } else if (kindStr === "like_channel_list") {
        prefix = "あなたの YouTube マイリスト「";
        suffix = "」（リスト全体）にいいねしました。";
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
      } else if (kindStr === "like_video_list") {
        btn.setAttribute("data-mz-notif-go", "video_list");
        btn.setAttribute("data-mz-notif-list-id", String(n.target_id || ""));
        btn.setAttribute("data-mz-notif-owner", String(targetUid));
      } else if (kindStr === "like_channel_bookmark") {
        btn.setAttribute("data-mz-notif-go", "ch_bm");
        btn.setAttribute("data-mz-notif-target-id", String(n.thread_root_id || n.target_id || ""));
        btn.setAttribute("data-mz-notif-owner", String(targetUid));
      } else if (kindStr === "like_channel_list") {
        btn.setAttribute("data-mz-notif-go", "channel_list");
        btn.setAttribute("data-mz-notif-list-id", String(n.target_id || ""));
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
      if (btn.hasAttribute("data-mz-notif-go")) {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          navigateFromNotifGo(btn, article);
        });
      }
      line2.appendChild(btn);
      line2.appendChild(document.createTextNode(suffix));

      const time = document.createElement("time");
      time.className = "user-prof-notif-time";
      time.dateTime = String(n.created_at || "");
      time.textContent = formatNotifTime(n.created_at);

      body.appendChild(line1);
      body.appendChild(line2);
      body.appendChild(time);
      if (!isRead) {
        const markBtn = document.createElement("button");
        markBtn.type = "button";
        markBtn.className = "user-prof-notif-mark-read";
        markBtn.setAttribute("data-mz-notif-mark-read", "1");
        markBtn.textContent = "既読にする";
        markBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void markNotificationArticleRead(article);
        });
        body.appendChild(markBtn);
      }
      if (article.dataset.mzAnnSite !== "1") {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "user-prof-notif-delete";
        delBtn.setAttribute("data-mz-notif-delete", "1");
        delBtn.textContent = "削除する";
        delBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void deleteNotificationArticle(article);
        });
        body.appendChild(delBtn);
      }

      article.appendChild(avWrap);
      article.appendChild(body);
      feed.appendChild(article);
    }
    refreshProfNotifListUi();
  }

  function wireNotificationPaneClicks() {
    const hostWire = el("#prof-notifs-list");
    if (!hostWire || hostWire.dataset.mzProfNotifWire === "1") return;
    hostWire.dataset.mzProfNotifWire = "1";
    hostWire.addEventListener("click", (ev) => {
      const filterBtn = ev.target?.closest?.("[data-mz-notif-filter]");
      if (filterBtn instanceof HTMLElement) {
        ev.preventDefault();
        const host = el("#prof-notifs-list");
        if (!host) return;
        profNotifFilterMode = String(filterBtn.getAttribute("data-mz-notif-filter") || "unread") === "read" ? "read" : "unread";
        refreshProfNotifListUi();
        return;
      }
      const markRead = ev.target?.closest?.("[data-mz-notif-mark-read]");
      if (markRead instanceof HTMLElement) {
        ev.preventDefault();
        ev.stopPropagation();
        const art = markRead.closest("article[data-mz-notif-id]");
        if (art instanceof HTMLElement) void markNotificationArticleRead(art);
        return;
      }
      const delBtn = ev.target?.closest?.("[data-mz-notif-delete]");
      if (delBtn instanceof HTMLElement) {
        ev.preventDefault();
        ev.stopPropagation();
        const artDel = delBtn.closest("article[data-mz-notif-id]");
        if (artDel instanceof HTMLElement) void deleteNotificationArticle(artDel);
        return;
      }
      const go = ev.target?.closest?.("[data-mz-notif-go]");
      if (go instanceof HTMLElement) {
        ev.preventDefault();
        ev.stopPropagation();
        navigateFromNotifGo(go);
        return;
      }
      const art = ev.target?.closest?.("article[data-mz-notif-id]");
      if (!(art instanceof HTMLElement)) return;
      if (ev.target?.closest?.("a, button, [data-mz-notif-go], [data-mz-notif-mark-read], [data-mz-notif-delete]"))
        return;
      void markNotificationArticleRead(art);
    });
  }

  function syncSiteAnnouncementNotifBadge() {
    syncSiteAnnouncementOpsCard();
    refreshProfNotifUnreadBadge();
  }

  function syncSiteAnnouncementOpsCard() {
    const host = el("#prof-ops-list");
    if (!host) return;
    const feed = host.querySelector(".user-prof-ops-items");
    if (!(feed instanceof HTMLElement)) {
      renderOpsPane();
      return;
    }
    const art = feed.querySelector('article[data-mz-ann-site="1"]');
    const annActive = Boolean(window.MarchinZSiteAnnouncement?.getAnnouncement?.()?.active);
    if (!annActive && !art) {
      renderOpsPane();
      return;
    }
    if (!annActive && art) {
      renderOpsPane();
      return;
    }
    if (!art) {
      renderOpsPane();
      return;
    }
    const unread = Boolean(window.MarchinZSiteAnnouncement?.isUnread?.());
    if (unread) {
      delete art.dataset.mzRead;
      art.classList.add("user-prof-notif--unread");
    } else {
      art.dataset.mzRead = "1";
      art.classList.remove("user-prof-notif--unread");
    }
    refreshOpsUnreadBadge();
  }

  function wireOpsPaneClicks() {
    const hostWire = el("#prof-ops-list");
    if (!hostWire || hostWire.dataset.mzProfOpsWire === "1") return;
    hostWire.dataset.mzProfOpsWire = "1";
    hostWire.addEventListener("click", (ev) => {
      const markRead = ev.target?.closest?.("[data-mz-notif-mark-read]");
      if (markRead instanceof HTMLElement) {
        ev.preventDefault();
        ev.stopPropagation();
        const art = markRead.closest("article[data-mz-notif-id]");
        if (art instanceof HTMLElement) void markNotificationArticleRead(art);
        return;
      }
      const art = ev.target?.closest?.("article[data-mz-notif-id]");
      if (!(art instanceof HTMLElement)) return;
      if (ev.target?.closest?.("a, button, [data-mz-notif-mark-read]")) return;
      void markNotificationArticleRead(art);
    });
  }

  function syncSiteAnnouncementNotifCard() {
    syncSiteAnnouncementOpsCard();
  }

  function wireSiteAnnouncementNotifSync() {
    if (root?.dataset.mzProfAnnSync === "1") return;
    root.dataset.mzProfAnnSync = "1";
    window.MarchinZSiteAnnouncement?.onReadStateChange?.(() => {
      syncSiteAnnouncementNotifCard();
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
    window.MarchinZEngageUi?.buildLikeRow(hostEl, {
      liked,
      count: cnt,
      onClick: () => window.MarchinZToggleMllLogLike?.(log.id),
      showLoginHint: !me?.id,
    });
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
    window.MarchinZEngageUi?.buildLikeRow(hostEl, {
      liked,
      count: cnt,
      onClick: () =>
        coll === "video_bookmarks"
          ? toggleProfileVideoBookmarkLike(ownerUid, docId)
          : toggleProfileChannelBookmarkLike(ownerUid, docId),
      showLoginHint: !me?.id,
      stopPropagation: true,
    });
  }

  const profBookmarkLikeInflight = new Set();

  async function toggleProfileVideoBookmarkLike(ownerUid, docId) {
    const inflightKey = `vb:${ownerUid}:${docId}`;
    if (profBookmarkLikeInflight.has(inflightKey)) return false;
    const db = getDb();
    const user = window.MLL_AUTH?.getUser?.();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return false;
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("like")) return false;
    if (!db) return false;
    profBookmarkLikeInflight.add(inflightKey);
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
      profBookmarkLikeInflight.delete(inflightKey);
      return false;
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
    profBookmarkLikeInflight.delete(inflightKey);
  }

  async function toggleProfileChannelBookmarkLike(ownerUid, docId) {
    const inflightKey = `cb:${ownerUid}:${docId}`;
    if (profBookmarkLikeInflight.has(inflightKey)) return false;
    const db = getDb();
    const user = window.MLL_AUTH?.getUser?.();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return false;
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("like")) return false;
    if (!db) return false;
    profBookmarkLikeInflight.add(inflightKey);
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
      profBookmarkLikeInflight.delete(inflightKey);
      return false;
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
    profBookmarkLikeInflight.delete(inflightKey);
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
  const PROFILE_ROLE_ORDER = /** @type {const} */ (
    window.MarchinZMllRole?.PROFILE_ROLE_ORDER || ["watch", "perform", "team_staff", "ops"]
  );

  /** @returns {Partial<Record<(typeof PROFILE_ROLE_ORDER)[number], number>>} */
  function emptyRoleTotals() {
    return { watch: 0, perform: 0, team_staff: 0, ops: 0 };
  }

  /** @param {string} role @param {string} [roleLabel] @returns {"perform"|"watch"|"ops"|"team_staff"|null} */
  function mapLogRole(role, roleLabel) {
    const R = window.MarchinZMllRole;
    if (R?.inferRoleFromLogOrNull) return R.inferRoleFromLogOrNull({ role, role_label: roleLabel });
    if (R) return R.inferRoleFromLog({ role, role_label: roleLabel });
    return null;
  }

  /** @param {"perform"|"watch"|"ops"|"team_staff"|null} rk */
  function profileLogRoleUiLabel(rk) {
    const R = window.MarchinZMllRole;
    if (!rk) return R?.PARTICIPATION_UNKNOWN_LABEL || "（参加スタイル不明）";
    if (rk === "ops") return "スタッフ・運営";
    return ROLE_LABEL_JA[rk] || R?.PARTICIPATION_UNKNOWN_LABEL || "（参加スタイル不明）";
  }

  const ROLE_LABEL_JA = window.MarchinZMllRole?.ROLE_LABEL_JA || {
    watch: "観戦",
    perform: "出演",
    team_staff: "チームスタッフ",
    ops: "運営",
  };

  /** @param {(typeof PROFILE_ROLE_ORDER)[number]} k @param {number} c */
  function formatYearRoleCountJa(k, c) {
    const R = window.MarchinZMllRole;
    if (R) return R.formatYearRoleCountJa(k, c);
    return "";
  }

  /** @param {ReturnType<typeof emptyRoleTotals>} totals */
  function formatRoleTotalsSummaryJa(totals) {
    const R = window.MarchinZMllRole;
    if (R?.formatRoleTotalsSummaryJa) return R.formatRoleTotalsSummaryJa(totals);
    const parts = [];
    PROFILE_ROLE_ORDER.forEach((k) => {
      const piece = formatYearRoleCountJa(k, totals[k] || 0);
      if (piece) parts.push(piece);
    });
    return parts.join("、");
  }

  function normTitle(s) {
    return String(s ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @returns {Promise<{ matchMap: Map<string, string>; byId: Map<string, { created_by: string; status: string }> }>}
   */
  async function loadCalendarLookup(db) {
    /** @type {Map<string, string>} */
    const matchMap = new Map();
    /** @type {Map<string, { created_by: string; status: string }>} */
    const byId = new Map();
    try {
      const snap = await db.collection("mll_calendar_events").orderBy("date", "desc").limit(500).get();
      snap.forEach((doc) => {
        const d = doc.data() || {};
        const date = String(d.date || "").trim();
        const title = String(d.title || "").trim();
        byId.set(doc.id, {
          created_by: String(d.created_by || "").trim(),
          status: String(d.status || "").trim(),
        });
        if (!date || !title) return;
        matchMap.set(`${date}__${normTitle(title)}`, doc.id);
      });
    } catch {
      //
    }
    return { matchMap, byId };
  }

  /** @param {any} log @param {Map<string, string>} matchMap */
  function resolveEventId(log, matchMap) {
    const date = String(log.event_date || "").trim();
    const title = String(log.event_name || "").trim();
    if (!date || !title) return "";
    return matchMap.get(`${date}__${normTitle(title)}`) || "";
  }

  /**
   * @param {any} log
   * @param {string} ownerUid
   * @param {{ matchMap: Map<string, string>; byId: Map<string, { created_by: string; status: string }> }} calLookup
   */
  function logLinksToOwnerCalendarEvent(log, ownerUid, calLookup) {
    const uid = String(ownerUid || "").trim();
    if (!uid || !calLookup?.byId) return false;
    let evId = String(log?.calendar_event_id || "").trim();
    if (!evId && calLookup.matchMap) evId = resolveEventId(log, calLookup.matchMap);
    if (!evId) return false;
    const ev = calLookup.byId.get(evId);
    return Boolean(ev && String(ev.created_by || "").trim() === uid);
  }

  /**
   * @param {any} log
   * @param {string} ownerUid
   * @param {FirebaseFirestore.Firestore} db
   */
  async function deleteProfileMllLog(log, ownerUid, db, calLookupHint) {
    const uid = String(ownerUid || "").trim();
    const logId = String(log?.id || "").trim();
    if (!uid || !logId || String(log.user_id || "").trim() !== uid) return;
    const name = String(log.event_name || "（無題）").slice(0, 120);
    const calLookup =
      calLookupHint?.byId instanceof Map
        ? calLookupHint
        : db
          ? await loadCalendarLookup(db)
          : { matchMap: new Map(), byId: new Map() };
    const ownsEvent = logLinksToOwnerCalendarEvent(log, uid, calLookup);
    const lines = [
      `「${name}」の MarchinZ Log を削除しますか？`,
      "",
      "削除するとプロフィールの一覧から消え、取り消せません。",
    ];
    if (ownsEvent) {
      lines.push("", "※イベント掲示自体は削除されません。");
    }
    if (!window.confirm(lines.join("\n"))) return;
    if (!db) {
      window.alert("データに接続できません。");
      return;
    }
    const R = window.MarchinZMllRole;
    let evId = String(log.calendar_event_id || "").trim();
    if (!evId && calLookup.matchMap) evId = resolveEventId(log, calLookup.matchMap);
    const involvementOpts = {
      eventId: evId,
      eventDate: String(log.event_date || "").trim(),
      eventName: String(log.event_name || "").trim(),
      venue_pref: String(log.venue || "").trim(),
    };
    try {
      await db.collection("mll_logs").doc(logId).delete();
      if (R?.pruneLocalMllLogsCacheForEvent) {
        R.pruneLocalMllLogsCacheForEvent(uid, involvementOpts);
      }
      if (R?.cleanupCalendarAttendanceAfterLogDelete) {
        await R.cleanupCalendarAttendanceAfterLogDelete(db, uid, involvementOpts);
      }
    } catch (e) {
      window.alert(`MarchinZ Log の削除に失敗しました。${String(e?.message || e)}`);
      return;
    }
    window.dispatchEvent(new CustomEvent("marchinz-mll-updated", { detail: { userId: uid } }));
  }

  /**
   * 本人プロフィール: MarchinZ Log をすべて削除（Note は残す）。
   * @param {string} ownerUid
   * @param {FirebaseFirestore.Firestore} db
   * @param {number} logCount
   */
  async function deleteAllProfileMllLogs(ownerUid, db, logCount) {
    const uid = String(ownerUid || "").trim();
    if (!uid || !db) return;
    const me = window.MLL_AUTH?.getUser?.();
    if (!me?.id || String(me.id) !== uid) return;
    const n = Math.max(0, Number(logCount) || 0);
    const lines = [
      "MarchinZ Log の記録と、イベントページの参加者表示をすべて削除しますか？",
      "",
      "・プロフィールの Log 一覧（現在 " + (n > 0 ? `${n} 件` : "0 件") + "）",
      "・コミュニティイベントの「MarchinZ Log ○人」表示（Log が無くて attendees だけ残っている場合も含む）",
      "・取り消せません",
      "・MarchinZ Note は削除されません",
      "・イベント掲示自体は削除されません",
    ];
    if (!window.confirm(lines.join("\n"))) return;
    const R = window.MarchinZMllRole;
    if (!R?.deleteAllMllLogsForUser) {
      window.alert("一括削除機能を読み込めませんでした。ページを再読み込みしてください。");
      return;
    }
    try {
      const result = await R.deleteAllMllLogsForUser(db, uid);
      const parts = [`Log ${result.logsDeleted} 件`];
      if (result.attendanceRemoved > 0) parts.push(`参加者表示 ${result.attendanceRemoved} 件`);
      window.alert(`${parts.join("、")}を削除しました。`);
      window.dispatchEvent(new CustomEvent("marchinz-mll-updated", { detail: { userId: uid } }));
    } catch (e) {
      window.alert(`MarchinZ Log の一括削除に失敗しました。${String(e?.message || e)}`);
    }
  }

  /**
   * プロフィール MarchinZ Log タブの「MarchinZ Log をシェアする」— 本人のみ
   * @param {{ isOwner?: boolean; targetUid?: string; viewerId?: string | null; db?: import('firebase').firestore.Firestore | null } | null | undefined} shareCtx
   */
  function canShareProfileMarchinZLog(shareCtx) {
    if (!shareCtx?.isOwner || !shareCtx?.targetUid || !shareCtx?.db) return false;
    const viewer = String(shareCtx.viewerId || "").trim();
    const owner = String(shareCtx.targetUid).trim();
    return Boolean(viewer && viewer === owner);
  }

  /**
   * マイページ MarchinZ Log: シェア＋⋯（一括削除）のアクションバー
   * @param {{
   *   showShare?: boolean;
   *   shareBtn?: HTMLButtonElement | null;
   *   db: import('firebase').firestore.Firestore | null;
   *   targetUid: string;
   *   logCount: number;
   * }} opts
   * @returns {HTMLElement}
   */
  function buildMllOwnerActionsBar(opts) {
    const row = document.createElement("div");
    row.className = "user-profile-mll-share-row user-profile-mll-owner-actions";
    const inner = document.createElement("div");
    inner.className = "user-profile-mll-owner-actions-inner";
    if (opts.showShare && opts.shareBtn) {
      inner.appendChild(opts.shareBtn);
    }
    const overflowItems = [
      {
        label: "MarchinZ Log をすべて削除",
        variant: "danger",
        onClick: () => void deleteAllProfileMllLogs(String(opts.targetUid), opts.db, opts.logCount),
      },
    ];
    const Eu = window.MarchinZEngageUi;
    /** @type {HTMLElement} */
    let overflowEl;
    if (Eu?.buildActionOverflow) {
      overflowEl = Eu.buildActionOverflow(overflowItems, {
        extraClass: "user-profile-mll-overflow user-profile-mll-share-row-overflow",
        panelBelow: true,
      });
    } else {
      overflowEl = document.createElement("details");
      overflowEl.className =
        "community-post-overflow user-profile-mll-overflow user-profile-mll-share-row-overflow community-post-overflow--panel-below";
      const sum = document.createElement("summary");
      sum.className = "community-post-overflow-trigger";
      sum.setAttribute("aria-label", "その他の操作");
      const sumIcon = document.createElement("i");
      sumIcon.className = "fa-solid fa-ellipsis community-post-overflow-icon";
      sumIcon.setAttribute("aria-hidden", "true");
      sum.appendChild(sumIcon);
      const panel = document.createElement("div");
      panel.className = "community-post-overflow-panel";
      for (const item of overflowItems) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "community-post-overflow-item community-post-overflow-item--danger";
        btn.textContent = item.label;
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          if (overflowEl instanceof HTMLDetailsElement) overflowEl.open = false;
          void item.onClick();
        });
        panel.appendChild(btn);
      }
      overflowEl.append(sum, panel);
    }
    inner.appendChild(overflowEl);
    row.appendChild(inner);
    return row;
  }

  /**
   * Log 0 件時など、一覧内にアクション行が無いときだけ ⋯ をマウント（本人のみ）
   * @param {boolean} visible
   * @param {import('firebase').firestore.Firestore | null} db
   * @param {string} targetUid
   * @param {number} logCount
   */
  function syncMllOwnerPurgeMount(visible, db, targetUid, logCount) {
    const mount = el("#prof-mll-purge-mount");
    if (!mount) return;
    if (!visible || !db || !String(targetUid || "").trim()) {
      mount.hidden = true;
      mount.replaceChildren();
      return;
    }
    mount.hidden = false;
    mount.replaceChildren();
    mount.appendChild(
      buildMllOwnerActionsBar({
        showShare: false,
        shareBtn: null,
        db,
        targetUid: String(targetUid),
        logCount,
      }),
    );
  }

  /**
   * プロフィール MarchinZ Log：参加スタイルの編集ダイアログ
   * @param {any} log
   * @param {{ targetUid?: string; db?: import('firebase').firestore.Firestore | null }} shareCtx
   * @param {{ matchMap: Map<string, string>; byId: Map<string, { created_by: string; status: string }> }} calLookup
   */
  function openProfileMllLogParticipationEdit(log, shareCtx, calLookup) {
    const db = shareCtx?.db;
    const uid = String(shareCtx?.targetUid || "").trim();
    const logId = String(log?.id || "").trim();
    if (!db || !uid || !logId || String(log.user_id || "").trim() !== uid) return;
    const me = window.MLL_AUTH?.getUser?.();
    if (!me?.id || String(me.id) !== uid) return;

    const R = window.MarchinZMllRole;
    const options = R?.ATTENDANCE_STYLE_OPTIONS_JA || [
      "観戦",
      "出演",
      "チームスタッフ",
      "スタッフ・運営",
    ];
    const curRole = mapLogRole(log.role, log.role_label);
    const currentLabel = R?.profileRoleKeyToUiLabel
      ? R.profileRoleKeyToUiLabel(curRole) || profileLogRoleUiLabel(curRole)
      : profileLogRoleUiLabel(curRole);

    const dlg = document.createElement("dialog");
    dlg.className = "user-profile-mll-participation-dialog";
    const panel = document.createElement("div");
    panel.className = "user-profile-mll-participation-panel";
    const title = document.createElement("h3");
    title.className = "user-profile-mll-participation-title";
    title.textContent = "MarchinZ Logを編集";
    const opts = document.createElement("div");
    opts.className = "calendar-att-options user-profile-mll-participation-options";
    const close = () => {
      try {
        dlg.close();
        dlg.remove();
      } catch {
        //
      }
    };
    dlg.addEventListener("cancel", (ev) => {
      ev.preventDefault();
      close();
    });
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg) close();
    });

    const saveLabel = async (label) => {
      if (!R?.updateProfileLogParticipation) {
        window.alert("参加スタイルの更新機能を読み込めませんでした。");
        return;
      }
      try {
        await R.updateProfileLogParticipation(db, me, { ...log, id: logId }, label, calLookup);
        close();
        window.dispatchEvent(new CustomEvent("marchinz-mll-updated", { detail: { userId: uid } }));
      } catch (e) {
        console.warn("[profile-mll-participation]", e);
        window.alert(`参加スタイルの更新に失敗しました。${String(e?.message || e)}`);
      }
    };

    for (const label of options) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "calendar-att-opt-btn";
      if (label === currentLabel) b.classList.add("calendar-att-opt-btn--current");
      b.textContent = label;
      b.addEventListener("click", () => void saveLabel(label));
      opts.appendChild(b);
    }
    const actions = document.createElement("div");
    actions.className = "user-profile-mll-participation-actions";
    const btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.className = "btn-reset-search";
    btnClose.textContent = "キャンセル";
    btnClose.addEventListener("click", close);
    actions.appendChild(btnClose);
    panel.appendChild(title);
    panel.appendChild(opts);
    panel.appendChild(actions);
    dlg.appendChild(panel);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  /**
   * プロフィール MarchinZ Log 行：編集・削除のケバブメニュー
   * @param {any} log
   * @param {{ targetUid?: string; db?: import('firebase').firestore.Firestore | null }} shareCtx
   * @param {{ matchMap: Map<string, string>; byId: Map<string, { created_by: string; status: string }> }} calLookup
   */
  function buildProfileMllLogOverflow(log, shareCtx, calLookup) {
    const uid = String(shareCtx?.targetUid || "").trim();
    const items = [
      {
        label: "編集する",
        variant: "default",
        onClick: () => openProfileMllLogParticipationEdit(log, shareCtx, calLookup),
      },
      {
        label: "削除する",
        variant: "danger",
        onClick: () => void deleteProfileMllLog(log, uid, shareCtx?.db, calLookup),
      },
    ];
    const Eu = window.MarchinZEngageUi;
    if (Eu?.buildActionOverflow) {
      return Eu.buildActionOverflow(items, {
        extraClass: "user-profile-mll-overflow",
        panelBelow: true,
      });
    }
    const det = document.createElement("details");
    det.className = "community-post-overflow user-profile-mll-overflow community-post-overflow--panel-below";
    const sum = document.createElement("summary");
    sum.className = "community-post-overflow-trigger";
    sum.setAttribute("aria-label", "その他の操作");
    sum.textContent = "⋯";
    const panel = document.createElement("div");
    panel.className = "community-post-overflow-panel";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "community-post-overflow-item" +
        (item.variant === "danger"
          ? " community-post-overflow-item--danger"
          : " community-post-overflow-item--neutral");
      btn.textContent = item.label;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        det.open = false;
        void item.onClick();
      });
      panel.appendChild(btn);
    }
    det.appendChild(sum);
    det.appendChild(panel);
    return det;
  }

  function openMatchedEvent(calLookup, log) {
    const matchMap = calLookup?.matchMap ?? calLookup;
    const evId = resolveEventId(log, matchMap instanceof Map ? matchMap : new Map());
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

  function setProfNotifBadgeCount(n) {
    const count = Math.max(0, Number(n) || 0);
    const profBadge = el("#prof-notif-badge");
    if (profBadge) {
      profBadge.textContent = count > 99 ? "99+" : String(count);
      profBadge.hidden = count === 0;
    }
    refreshHeaderNotifBadgeCombined();
  }

  function setOpsBadgeCount(n) {
    const count = Math.max(0, Number(n) || 0);
    const opsBadge = el("#prof-ops-badge");
    if (opsBadge) {
      opsBadge.textContent = count > 99 ? "99+" : String(count);
      opsBadge.hidden = count === 0;
    }
    refreshHeaderNotifBadgeCombined();
  }

  function refreshHeaderNotifBadgeCombined() {
    const profBadge = el("#prof-notif-badge");
    const opsBadge = el("#prof-ops-badge");
    let total = 0;
    if (profBadge && !profBadge.hidden) total += Math.max(0, Number(profBadge.textContent) || 0);
    if (opsBadge && !opsBadge.hidden) total += Math.max(0, Number(opsBadge.textContent) || 0);
    const headerBadge = document.getElementById("header-notif-badge");
    if (headerBadge) {
      headerBadge.textContent = total > 99 ? "99+" : String(total);
      headerBadge.hidden = total === 0;
    }
  }

  /** @deprecated use setProfNotifBadgeCount */
  function setNotifBadgeCount(n) {
    setProfNotifBadgeCount(n);
  }

  function refreshProfNotifUnreadBadge() {
    const host = el("#prof-notifs-list");
    if (!host) {
      void refreshHeaderNotifUnreadFromRemote();
      return;
    }
    const n = host.querySelectorAll("article.user-prof-notif--unread").length;
    setProfNotifBadgeCount(n);
  }

  function refreshOpsUnreadBadge() {
    const n = window.MarchinZSiteAnnouncement?.isUnread?.() ? 1 : 0;
    setOpsBadgeCount(n);
  }

  async function refreshHeaderNotifUnreadFromRemote() {
    const me = String(window.MLL_AUTH?.getUser?.()?.id || "").trim();
    const db = getDb();
    if (!me || !db) {
      setProfNotifBadgeCount(0);
      setOpsBadgeCount(0);
      return;
    }
    let n = 0;
    if (window.MarchinZSiteAnnouncement?.isUnread?.()) n += 1;
    try {
      const snap = await db
        .collection("mll_profiles")
        .doc(me)
        .collection("notifications")
        .orderBy("created_at", "desc")
        .limit(120)
        .get();
      snap.forEach((doc) => {
        if (!isNotifDocRead(doc.data()?.read)) n += 1;
      });
    } catch {
      //
    }
    const userN = n - (window.MarchinZSiteAnnouncement?.isUnread?.() ? 1 : 0);
    setProfNotifBadgeCount(Math.max(0, userN));
    refreshOpsUnreadBadge();
  }

  function syncNotifEmptyForCurrentFilter() {
    refreshProfNotifListUi();
  }

  function applyNotifArticleReadUi(art) {
    if (!(art instanceof HTMLElement)) return;
    const nid = String(art.dataset.mzNotifId || "").trim();
    if (nid) setProfNotifRowReadById(nid, true);
    art.dataset.mzRead = "1";
    art.classList.remove("user-prof-notif--unread");
    const markBtn = art.querySelector("[data-mz-notif-mark-read]");
    if (markBtn instanceof HTMLElement) markBtn.hidden = true;
    if (art.dataset.mzAnnSite === "1") {
      refreshOpsUnreadBadge();
      return;
    }
    refreshProfNotifListUi();
  }

  function revertNotifArticleReadUi(art) {
    if (!(art instanceof HTMLElement)) return;
    const nid = String(art.dataset.mzNotifId || "").trim();
    if (nid) setProfNotifRowReadById(nid, false);
    delete art.dataset.mzRead;
    art.classList.add("user-prof-notif--unread");
    const markBtn = art.querySelector("[data-mz-notif-mark-read]");
    if (markBtn instanceof HTMLElement) markBtn.hidden = false;
    if (art.dataset.mzAnnSite === "1") {
      refreshOpsUnreadBadge();
      return;
    }
    refreshProfNotifListUi();
  }

  /** @param {HTMLElement} art */
  async function markNotificationArticleRead(art) {
    if (!(art instanceof HTMLElement) || art.dataset.mzRead === "1") return;
    const d = getDb();
    if (art.dataset.mzAnnSite === "1") {
      applyNotifArticleReadUi(art);
      try {
        await window.MarchinZSiteAnnouncement?.markAsRead?.();
      } catch (e) {
        console.warn("[MarchinZ] site announcement mark read failed", e);
        revertNotifArticleReadUi(art);
      }
      return;
    }
    const nid = String(art.dataset.mzNotifId || art.getAttribute("data-mz-notif-id") || "").trim();
    const ownerUid = notifOwnerUidForWrite();
    if (!nid || !ownerUid || !d) {
      console.warn("[MarchinZ] markNotificationArticleRead: missing", {
        nid,
        ownerUid,
        db: Boolean(d),
      });
      return;
    }
    applyNotifArticleReadUi(art);
    const ref = d.collection("mll_profiles").doc(ownerUid).collection("notifications").doc(nid);
    try {
      await ref.update({ read: true });
    } catch (firstErr) {
      try {
        await ref.set({ read: true }, { merge: true });
      } catch (secondErr) {
        console.warn("[MarchinZ] markNotificationArticleRead failed", firstErr, secondErr);
        try {
          const snap = await ref.get();
          if (snap.exists && isNotifDocRead(snap.data()?.read)) return;
        } catch {
          //
        }
        revertNotifArticleReadUi(art);
      }
    }
  }

  /** @param {HTMLElement} art */
  async function deleteNotificationArticle(art) {
    if (!(art instanceof HTMLElement)) return;
    if (art.dataset.mzAnnSite === "1") return;
    const nid = String(art.dataset.mzNotifId || art.getAttribute("data-mz-notif-id") || "").trim();
    const ownerUid = notifOwnerUidForWrite();
    const d = getDb();
    if (!nid) {
      window.alert("通知 ID を取得できませんでした。ページを再読み込みしてください。");
      return;
    }
    if (!ownerUid) {
      window.alert("ログイン状態を確認できません。再ログインしてからお試しください。");
      return;
    }
    if (!d) {
      window.alert("データベースに接続できません。");
      return;
    }
    if (!window.confirm("この通知を削除しますか？")) return;
    const host = el("#prof-notifs-list");
    removeProfNotifRowById(nid);
    art.remove();
    refreshProfNotifListUi();
    const ref = d.collection("mll_profiles").doc(ownerUid).collection("notifications").doc(nid);
    try {
      await ref.delete();
    } catch (e) {
      console.warn("[MarchinZ] deleteNotificationArticle failed", e);
      const code = String(e?.code || "");
      window.alert(
        code === "permission-denied"
          ? "通知の削除権限がありません。Firestore ルール（notifications の delete）を本番に反映してください。"
          : `通知の削除に失敗しました。${String(e?.message || e)}`,
      );
      await reloadProfNotificationsPane();
      return;
    }
    if (host instanceof HTMLElement) {
      const remaining = host.querySelectorAll("article[data-mz-notif-id]").length;
      if (!remaining) {
        profNotifState = [];
      }
    }
    refreshProfNotifListUi();
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
  function mountCoverSingle(urlRaw, cacheKey = "") {
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

    const displayUrl = withProfileImageCacheBust(
      window.MarchinZDefaultAssets?.resolveProfileCoverDisplayUrl?.(urlRaw) ||
        "img/defaults/cover_d.png",
      cacheKey,
    );
    const fallbackUrl = window.MarchinZDefaultAssets?.profileCoverDefault?.() || displayUrl;

    wrap.classList.remove("user-profile-cover--empty");
    const img = document.createElement("img");
    img.src = displayUrl;
    img.alt = "";
    img.className = "user-profile-cover-img";
    img.loading = "eager";
    img.decoding = "async";
    img.onerror = () => {
      if (img.src !== fallbackUrl) {
        img.onerror = null;
        img.src = fallbackUrl;
        return;
      }
      img.onerror = null;
      wrap.innerHTML = "";
      wrap.classList.add("user-profile-cover--empty");
      wrap.appendChild(document.createElement("div")).className = "user-profile-cover-placeholder";
    };
    wrap.appendChild(img);
    window.MarchinZImage?.ensureProtectedImgWrap?.(img);
  }

  /** @param {Record<string, unknown>} pdata */
  function resolveProfileAddressPrefecture(pdata) {
    const a = String(pdata.profile_address_prefecture ?? "").trim();
    if (a) return a;
    return String(pdata.profile_prefecture ?? "").trim();
  }

  /** @param {Record<string, unknown>} pdata */
  function isProfileAddressPrefecturePublic(pdata) {
    return pdata.profile_address_prefecture_public !== false;
  }

  /** 公開ID表示（常に 8 桁。例: 1 → 00000001、103 → 00000103） */
  function formatMarchinzPublicIdForDisplay(raw) {
    const digits = String(raw || "").replace(/\D/g, "");
    if (!digits) return "";
    const n = Number(digits);
    if (!Number.isFinite(n) || n < 0) return digits.slice(-8).padStart(8, "0");
    return String(Math.trunc(n)).padStart(8, "0");
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
    setText("#prof-public-id", pid ? `ユーザー番号: ${pid}` : "ユーザー番号: 未取得");
    const av = el("#prof-avatar");
    if (av && av instanceof HTMLImageElement) {
      av.src = withProfileImageCacheBust(
        profile.avatar_url || "logo/marchinz-logo.png",
        profile.updated_at,
      );
      av.alt = `${profile.display_name || "ユーザー"} のプロフィール画像`;
      av.onerror = () => {
        av.onerror = null;
        av.src = "logo/marchinz-logo.png";
      };
      window.MarchinZImage?.ensureProtectedImgWrap?.(av);
    }
    const bio = el("#prof-bio");
    if (bio) {
      const t = String(profile.profile_bio || "").trim();
      bio.textContent = t || "（自己紹介は未設定です）";
    }
    const prefEl = el("#prof-address-prefecture");
    if (prefEl) {
      const pub = profile.profile_address_prefecture_public !== false;
      const prefText = String(profile.profile_address_prefecture || "").trim();
      if (pub && prefText) {
        prefEl.textContent = prefText;
        prefEl.hidden = false;
      } else {
        prefEl.textContent = "";
        prefEl.hidden = true;
      }
    }
    const attrsHost = el("#prof-attrs");
    if (attrsHost) {
      attrsHost.innerHTML = "";
      const arr = Array.isArray(profile.profile_attributes) ? profile.profile_attributes : [];
      const seen = new Set();
      for (const x of arr) {
        const s = String(x || "").trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        const sp = document.createElement("span");
        sp.className = "user-profile-attr-pill";
        sp.textContent = s;
        attrsHost.appendChild(sp);
      }
    }
  }


  /**
   * @param {any[]} logs
   * @param {{ matchMap: Map<string, string>; byId: Map<string, { created_by: string; status: string }> }} calLookup
   * @param {{
   *   isOwner?: boolean;
   *   sectionVis?: { mll?: string };
   *   displayName?: string;
   *   targetUid?: string;
   *   viewerId?: string | null;
   *   likeShow?: { mll?: boolean };
   *   db?: import('firebase').firestore.Firestore | null;
   *   diaryEventIds?: Set<string>;
   * } | null} [shareCtx]
   */
  /**
   * @param {any} log
   * @param {{ matchMap: Map<string, string> }} calLookup
   */
  function resolveLogCalendarEventId(log, calLookup) {
    let evId = String(log?.calendar_event_id || "").trim();
    if (!evId && calLookup?.matchMap) evId = resolveEventId(log, calLookup.matchMap);
    return evId;
  }

  /**
   * @param {HTMLElement} actionsRow
   * @param {any} log
   * @param {{ isOwner?: boolean; targetUid?: string }} shareCtx
   * @param {{ matchMap: Map<string, string> }} calLookup
   * @param {Set<string>} diaryEventIds
   */
  function appendProfileMllNoteBtn(actionsRow, log, shareCtx, calLookup, diaryEventIds) {
    if (!shareCtx?.isOwner) return;
    const uid = String(shareCtx.targetUid || "").trim();
    const eventId = resolveLogCalendarEventId(log, calLookup);
    if (!uid || !eventId) return;

    const hasNote = diaryEventIds.has(eventId);
    const variant = hasNote ? "view-log" : "note";
    const label = hasNote ? "Noteを見る" : "Noteを書く";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `calendar-ev-mll-log-save-btn calendar-ev-mll-log-save-btn--${variant} user-profile-mll-note-btn`;
    btn.textContent = label;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", () => {
      window.location.hash = `#profile?uid=${encodeURIComponent(uid)}&tab=logdiary&event=${encodeURIComponent(eventId)}`;
    });
    if (variant === "note") {
      window.MarchinZIcons?.prependIcon?.(btn, ["fa-solid", "fa-book-open"]);
    } else {
      window.MarchinZIcons?.prependIcon?.(btn, ["fa-solid", "fa-eye"]);
    }
    actionsRow.appendChild(btn);
  }

  /** @param {any} log */
  function logYearKey(log) {
    const raw = String(log?.event_date || "")
      .trim()
      .replace(/\//g, "-");
    const ym = raw.match(/^(\d{4})/);
    if (ym) return ym[1];
    const cm = String(log?.created_at || "").match(/^(\d{4})/);
    return cm ? cm[1] : "";
  }

  /** @param {string} displayName @param {boolean} isOwner */
  function mllKpiLifeSubtitle(displayName, isOwner) {
    const raw = String(displayName || "ユーザー").trim() || "ユーザー";
    const base = raw.replace(/さん$/, "");
    if (isOwner) return `${base}のこれまでのマーチングライフ`;
    return `${base}さんのこれまでのマーチングライフ`;
  }

  function renderMLL(logs, calLookup, shareCtx) {
    const host = el("#prof-mll-main");
    if (!host) return;

    if (!logs.length) {
      host.innerHTML = "";
      renderProfEmpty(host, PROF_EMPTY.mll);
      return;
    }
    host.innerHTML = "";

    const totals = emptyRoleTotals();
    /** @type {Record<string, ReturnType<typeof emptyRoleTotals>>} */
    const byYear = {};
    for (const log of logs) {
      const y = logYearKey(log);
      if (!y || y === "????") continue;
      if (!byYear[y]) Object.assign(byYear, { [y]: emptyRoleTotals() });
      const k = mapLogRole(log.role, log.role_label);
      if (!k) continue;
      totals[k] += 1;
      byYear[y][k] += 1;
    }

    /** @param {(typeof PROFILE_ROLE_ORDER)[number]} labelKey @param {number} cnt @returns {HTMLElement} */
    function statMedal(labelKey, cnt) {
      const d = document.createElement("div");
      d.className = `user-profile-mll-medal user-profile-mll-medal--${labelKey}`;
      const badge = document.createElement("div");
      badge.className = "user-profile-mll-medal-badge mil-role-badge";
      badge.setAttribute("aria-hidden", "true");
      const num = document.createElement("span");
      num.className = "user-profile-mll-medal-num";
      num.textContent = String(cnt ?? 0);
      badge.appendChild(num);
      const lab = document.createElement("span");
      lab.className = "user-profile-mll-medal-label";
      lab.textContent = ROLE_LABEL_JA[labelKey];
      d.appendChild(badge);
      d.appendChild(lab);
      return d;
    }

    const kpiOuter = document.createElement("section");
    kpiOuter.className = "user-profile-mll-kpi-bar mll-lp-finale mll-lp-finale--pattern-a";
    kpiOuter.setAttribute("aria-label", "MarchinZ Log 集計");
    const kpiInnerWrap = document.createElement("div");
    kpiInnerWrap.className = "user-profile-mll-kpi-bar__inner";
    const kpiCap = document.createElement("p");
    kpiCap.className = "user-profile-mll-kpi-caption";
    const kpiCapLabel = document.createElement("span");
    kpiCapLabel.className = "user-profile-mll-kpi-caption-label";
    kpiCapLabel.textContent = "MarchinZ Log";
    const kpiCapSub = document.createElement("span");
    kpiCapSub.className = "user-profile-mll-kpi-caption-sub";
    kpiCapSub.textContent = mllKpiLifeSubtitle(shareCtx?.displayName, Boolean(shareCtx?.isOwner));
    kpiCap.append(kpiCapLabel, kpiCapSub);
    kpiInnerWrap.appendChild(kpiCap);
    const totalMll = totals.watch + totals.perform + totals.team_staff + totals.ops;
    if (totalMll > 0) {
      const kpiInner = document.createElement("div");
      kpiInner.className = "user-profile-mll-kpi-inner";
      const kpiMedalKeys = PROFILE_ROLE_ORDER.filter((k) => (totals[k] || 0) > 0);
      const kpiMedalCount = kpiMedalKeys.length;
      if (kpiMedalCount >= 1 && kpiMedalCount <= 4) {
        kpiInner.classList.add(`user-profile-mll-kpi-inner--n${kpiMedalCount}`);
      }
      kpiMedalKeys.forEach((k) => {
        kpiInner.appendChild(statMedal(k, totals[k]));
      });
      kpiInnerWrap.appendChild(kpiInner);
      const overallSummary = formatRoleTotalsSummaryJa(totals);
      if (overallSummary) {
        const summaryEl = document.createElement("p");
        summaryEl.className = "user-profile-mll-summary";
        summaryEl.textContent = overallSummary;
        kpiInnerWrap.appendChild(summaryEl);
      }
    }
    kpiOuter.appendChild(kpiInnerWrap);
    host.appendChild(kpiOuter);

    if (canShareProfileMarchinZLog(shareCtx)) {
      const hint = document.createElement("p");
      hint.className = "user-profile-mll-share-hint";
      hint.hidden = true;
      /** @type {HTMLButtonElement | null} */
      let shareBtn = null;
      /** @type {{ shareText: string; shareUrl: string } | null} */
      let shareMenuOpts = null;
      if (totalMll > 0) {
        shareBtn = document.createElement("button");
        shareBtn.type = "button";
        shareBtn.className = "btn-share-search btn-marchinz-spotlight user-profile-mll-share-btn";
        shareBtn.textContent = "MarchinZ Log をシェアする";
        window.MarchinZIcons?.prependIcon?.(shareBtn, ["fa-solid", "fa-share-nodes"]);
        const sm = window.MarchinZShareMenu;
        const uid = String(shareCtx.targetUid).trim();
        const profHash = `#profile?uid=${encodeURIComponent(uid)}&tab=mll`;
        const shareUrl = sm?.buildAbsoluteUrlForHash
          ? sm.buildAbsoluteUrlForHash(profHash)
          : `${window.location.origin}${window.location.pathname}${profHash}`;
        const dn = String(shareCtx.displayName || "ユーザー").trim() || "ユーザー";
        const shareText = sm?.mllProfileShareText ? sm.mllProfileShareText(dn, totals, shareUrl) : "";
        if (shareCtx.sectionVis && shareCtx.sectionVis.mll === "private") {
          shareBtn.addEventListener("click", () => {
            hint.textContent =
              "プロフィールの公開範囲で「MarchinZ Log」を公開にすると、シェアしたリンクを他の方が開いたときに内容を見られます。";
            hint.hidden = false;
            window.setTimeout(() => {
              hint.hidden = true;
            }, 10000);
          });
        } else if (shareText && sm?.setupSearchLikeShareMenuForButton) {
          shareMenuOpts = { shareText, shareUrl };
        }
      }
      const actionsBar = buildMllOwnerActionsBar({
        showShare: totalMll > 0,
        shareBtn,
        db: shareCtx.db,
        targetUid: String(shareCtx.targetUid),
        logCount: logs.length,
      });
      if (shareBtn && shareMenuOpts && window.MarchinZShareMenu?.setupSearchLikeShareMenuForButton) {
        window.MarchinZShareMenu.setupSearchLikeShareMenuForButton(
          shareBtn,
          shareMenuOpts.shareText,
          shareMenuOpts.shareUrl,
          "mll",
        );
      }
      actionsBar.insertBefore(hint, actionsBar.firstChild);
      host.appendChild(actionsBar);
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

      const yearSummary = formatRoleTotalsSummaryJa(yt);
      if (yearSummary) {
        const sm = document.createElement("p");
        sm.className = "user-profile-mll-year-meta";
        sm.textContent = yearSummary;
        hdr.appendChild(sm);
      }
      sec.appendChild(hdr);

      const ol = document.createElement("ol");
      ol.className = "user-profile-mll-timeline";

      const thisYearRows = sorted.filter((L) => logYearKey(L) === y);
      for (const log of thisYearRows) {
        const li = document.createElement("li");
        li.className = "user-profile-mll-row";
        const dateStr = String(log.event_date || "").trim();
        const [yy, mm, dd] = dateStr.split("-");
        const left = document.createElement("div");
        left.className = "user-profile-mll-date";
        left.textContent = yy && mm && dd ? `${yy}年 ${Number(mm)}月 ${Number(dd)}日` : String(dateStr || "").replace(/-/g, "/");

        const spine = document.createElement("div");
        spine.className = "user-profile-mll-spine";
        spine.setAttribute("aria-hidden", "true");

        const right = document.createElement("div");
        right.className = "user-profile-mll-event";
        const titleRow = document.createElement("div");
        titleRow.className = "user-profile-mll-event-title-row";
        const a = document.createElement("a");
        a.className = "user-profile-mll-event-link";
        a.href = "#community/events";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = String(log.event_name || "（無題）");
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          openMatchedEvent(calLookup, log);
        });
        titleRow.appendChild(a);

        const actionsRow = document.createElement("div");
        actionsRow.className = "user-profile-mll-event-actions-row";
        const roleHint = document.createElement("span");
        roleHint.className = "user-profile-mll-role-hint";
        const rk = mapLogRole(log.role, log.role_label);
        const roleUi = profileLogRoleUiLabel(rk);
        roleHint.textContent = roleUi;
        if (!rk) roleHint.classList.add("user-profile-mll-role-hint--unknown");
        if (roleHint.textContent) actionsRow.appendChild(roleHint);
        const diaryIds = shareCtx?.diaryEventIds instanceof Set ? shareCtx.diaryEventIds : new Set();
        appendProfileMllNoteBtn(actionsRow, log, shareCtx, calLookup, diaryIds);
        if (shareCtx?.likeShow?.mll !== false && log?.id) {
          const likeHost = document.createElement("div");
          likeHost.className = "mll-log-like-host mz-inline-like-host";
          appendProfileMllLikeRow(likeHost, log);
          window.MarchinZEngageUi?.appendInlineLike(actionsRow, likeHost);
        }
        if (shareCtx?.isOwner && shareCtx?.db && log?.id) {
          actionsRow.appendChild(buildProfileMllLogOverflow(log, shareCtx, calLookup));
        }
        right.appendChild(titleRow);
        right.appendChild(actionsRow);

        li.appendChild(left);
        li.appendChild(spine);
        li.appendChild(right);
        ol.appendChild(li);
      }
      sec.appendChild(ol);
      return sec;
    }

    const years = [...new Set(sorted.map((L) => logYearKey(L)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    if (!years.length) {
      const box = document.createElement("div");
      box.className = "empty-state user-profile-empty";
      box.textContent =
        "開催日が判別できない Log があります。個別に削除するか、⋯ メニューの「すべて削除」で整理できます。";
      host.appendChild(box);
      return;
    }
    for (const y of years) {
      host.appendChild(yearChip(y, byYear[y] || emptyRoleTotals()));
    }
  }

  /**
   * プロフィール上のマイリスト見出し用：リスト名・公開／非公開・削除（本人のみ）
   * @param {{ kind: "videos"|"yt"; listId: string; meta: { name: string; visibility: string }; db: any; allListIds?: string[]; allListsPublic?: boolean }} ctx
   */
  function openProfileMylistListEditDialog(ctx) {
    const { kind, listId, meta, db } = ctx;
    if (!db || !listId) return;
    const dlg = document.createElement("dialog");
    dlg.className = "user-profile-mylist-edit-dialog";
    const panel = document.createElement("div");
    panel.className = "user-profile-mylist-edit-panel";
    const title = document.createElement("h3");
    title.className = "user-profile-mylist-edit-title";
    title.textContent = kind === "yt" ? "YouTube マイリストを編集" : "大会動画マイリストを編集";
    const nameLab = document.createElement("label");
    nameLab.className = "user-profile-mylist-edit-field";
    nameLab.textContent = "リスト名";
    const nameInp = document.createElement("input");
    nameInp.type = "text";
    nameInp.className = "user-profile-mylist-edit-input";
    nameInp.maxLength = 120;
    nameInp.value = String(meta?.name || "").trim();
    nameLab.appendChild(nameInp);
    const oshiLab = document.createElement("label");
    oshiLab.className = "user-profile-mylist-edit-field";
    oshiLab.textContent = "推しポイント！";
    const oshiInp = document.createElement("textarea");
    oshiInp.className = "user-profile-mylist-edit-input user-profile-mylist-edit-oshi";
    oshiInp.rows = 3;
    oshiInp.maxLength = 240;
    oshiInp.placeholder = "推しポイント！を入力";
    oshiInp.value = String(meta?.oshi_text || "").trim();
    oshiLab.appendChild(oshiInp);
    const visField = document.createElement("fieldset");
    visField.className = "user-profile-mylist-edit-field";
    const leg = document.createElement("legend");
    leg.textContent = "公開設定";
    visField.appendChild(leg);
    const pub = meta?.visibility !== "private";
    const r1 = document.createElement("label");
    r1.className = "user-profile-mylist-edit-radio";
    const i1 = document.createElement("input");
    i1.type = "radio";
    i1.name = "mz-prof-ml-vis";
    i1.value = "public";
    i1.checked = pub;
    r1.appendChild(i1);
    r1.appendChild(document.createTextNode(" 公開"));
    const r2 = document.createElement("label");
    r2.className = "user-profile-mylist-edit-radio";
    const i2 = document.createElement("input");
    i2.type = "radio";
    i2.name = "mz-prof-ml-vis";
    i2.value = "private";
    i2.checked = !pub;
    r2.appendChild(i2);
    r2.appendChild(document.createTextNode(" 非公開"));
    visField.appendChild(r1);
    visField.appendChild(r2);
    const actions = document.createElement("div");
    actions.className = "user-profile-mylist-edit-actions";
    const btnSave = document.createElement("button");
    btnSave.type = "button";
    btnSave.className = "btn-share-search btn-marchinz-spotlight";
    btnSave.textContent = "保存";
    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "btn-reset-search";
    btnDel.textContent = "リストを削除";
    const btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.className = "btn-reset-search";
    btnClose.textContent = "閉じる";
    actions.appendChild(btnSave);
    actions.appendChild(btnDel);
    actions.appendChild(btnClose);
    panel.appendChild(title);
    panel.appendChild(nameLab);
    panel.appendChild(oshiLab);
    panel.appendChild(visField);
    panel.appendChild(actions);
    dlg.appendChild(panel);
    document.body.appendChild(dlg);
    const close = () => {
      try {
        dlg.remove();
      } catch {
        //
      }
    };
    btnClose.addEventListener("click", close);
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg) close();
    });
    btnDel.addEventListener("click", () => {
      const nm = String(meta?.name || listId);
      if (
        !window.confirm(
          `マイリスト「${nm}」を削除しますか？\nリスト内のブックマークもすべて削除されます。`,
        )
      ) {
        return;
      }
      void (async () => {
        try {
          if (kind === "yt") {
            await window.MarchinZYoutubeChannelMylist?.deleteListCascade?.(listId);
          } else {
            await window.MarchinZVideoMylist?.deleteListCascade?.(listId);
          }
          close();
        } catch (e) {
          window.alert(String(e?.message || e || "削除に失敗しました。"));
        }
      })();
    });
    btnSave.addEventListener("click", () => {
      void (async () => {
        const nm = String(nameInp.value || "").trim().slice(0, 120);
        if (!nm) {
          window.alert("リスト名を入力してください。");
          return;
        }
        const vis = i2.checked ? "private" : "public";
        const oshi = String(oshiInp.value || "").trim().slice(0, 240);
        const prevVis = meta?.visibility === "private" ? "private" : "public";
        try {
          if (kind === "yt") {
            if (nm !== String(meta?.name || "").trim()) {
              await window.MarchinZYoutubeChannelMylist?.renameList?.(listId, nm);
            }
            if (oshi !== String(meta?.oshi_text || "").trim()) {
              await window.MarchinZYoutubeChannelMylist?.updateListOshiText?.(listId, oshi);
            }
            if (vis !== prevVis) {
              await window.MarchinZYoutubeChannelMylist?.updateListVisibility?.(listId, vis);
            }
          } else {
            if (nm !== String(meta?.name || "").trim()) {
              await window.MarchinZVideoMylist?.renameList?.(listId, nm);
            }
            if (oshi !== String(meta?.oshi_text || "").trim()) {
              await window.MarchinZVideoMylist?.updateListOshiText?.(listId, oshi);
            }
            if (vis !== prevVis) {
              await window.MarchinZVideoMylist?.updateListVisibility?.(listId, vis);
            }
          }
          close();
          window.dispatchEvent(
            new CustomEvent(kind === "yt" ? "marchinz-channel-mylist-updated" : "marchinz-mylist-updated"),
          );
        } catch (e) {
          window.alert(String(e?.message || e || "保存に失敗しました。"));
        }
      })();
    });
    try {
      dlg.showModal();
    } catch {
      close();
    }
  }

  async function submitMylistReport(db, viewerId, targetUid, listId, listType) {
    if (!db || !viewerId || !targetUid || !listId) return;
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("report")) {
      window.alert("通報の頻度が高すぎます。しばらく待ってから再度お試しください。");
      return;
    }
    const text = window.prompt("通報理由（任意）");
    if (text == null) return;
    const reason = String(text || "").trim().slice(0, 500);
    const rid = `mylist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await db.collection("mll_mylist_reports").doc(rid).set({
      reporter_id: String(viewerId),
      target_uid: String(targetUid),
      list_id: String(listId),
      list_type: listType === "yt" ? "yt" : "videos",
      reason,
      created_at: new Date().toISOString(),
    });
    window.MarchinZTrackEvent?.("report_submit", {
      target_type: listType === "yt" ? "mylist_yt" : "mylist_videos",
    });
    window.alert("通報を受け付けました。ご協力ありがとうございます。");
  }

  /**
   * マイリスト見出しの展開はタイトル行（＋サムネ帯）のみ。いいね・編集・シェアとは分離する。
   * @param {HTMLElement} sec
   * @param {HTMLElement|null} expandEl
   * @param {HTMLElement|null} thumbStrip
   * @param {(expanded: boolean) => void} onExpandedChange
   */
  function bindMylistExpandControl(sec, expandEl, thumbStrip, onExpandedChange) {
    if (!(expandEl instanceof HTMLElement)) return;
    let expanded = false;
    const apply = () => {
      sec.classList.toggle("user-profile-mylist-list-section--expanded", expanded);
      expandEl.setAttribute("aria-expanded", String(expanded));
      onExpandedChange(expanded);
    };
    const toggle = () => {
      expanded = !expanded;
      apply();
    };
    expandEl.setAttribute("role", "button");
    expandEl.setAttribute("tabindex", "0");
    expandEl.setAttribute("aria-expanded", "false");
    expandEl.addEventListener("click", (e) => {
      e.preventDefault();
      toggle();
    });
    expandEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    if (thumbStrip instanceof HTMLElement) {
      thumbStrip.addEventListener("click", (e) => {
        if (e.target instanceof Element && e.target.closest("a")) return;
        toggle();
      });
    }
  }

  /** @param {HTMLElement} host */
  function stopMylistHeadInteractiveBubble(host) {
    if (!(host instanceof HTMLElement)) return;
    host.addEventListener("click", (e) => e.stopPropagation());
  }

  /** @param {() => void|Promise<void>} onReport */
  function buildMylistReportOverflow(onReport) {
    const Eu = window.MarchinZEngageUi;
    if (Eu?.buildReportOverflow) {
      return Eu.buildReportOverflow(onReport, { extraClass: "user-profile-mylist-overflow" });
    }
    const det = document.createElement("details");
    det.className = "community-post-overflow user-profile-mylist-overflow";
    const sum = document.createElement("summary");
    sum.className = "community-post-overflow-trigger";
    sum.setAttribute("aria-label", "その他の操作");
    sum.textContent = "⋯";
    sum.addEventListener("click", (e) => e.stopPropagation());
    det.addEventListener("click", (e) => e.stopPropagation());
    const panel = document.createElement("div");
    panel.className = "community-post-overflow-panel";
    const reportBtn = document.createElement("button");
    reportBtn.type = "button";
    reportBtn.className = "community-post-overflow-item";
    reportBtn.textContent = "通報する";
    reportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      det.open = false;
      void onReport();
    });
    panel.appendChild(reportBtn);
    det.appendChild(sum);
    det.appendChild(panel);
    det.addEventListener("click", (e) => e.stopPropagation());
    return det;
  }

  /**
   * @param {"videos"|"yt"} kind
   * @returns {HTMLElement}
   */
  function buildPrivateMylistListHead(kind) {
    const head = document.createElement("div");
    head.className = "user-profile-mylist-list-head user-profile-mylist-list-head--private-locked";
    appendMylistPrivateLock(head, kind);
    return head;
  }

  /** @param {{ loadLogDiary?: boolean }} [opts] */
  function syncLogDiaryTabUI(opts = {}) {
    const logTab = el("#prof-tab-logdiary");
    const logRoot = el("#prof-log-diary-root");

    if (logTab instanceof HTMLElement) {
      logTab.hidden = false;
      logTab.classList.remove("user-profile-tab--disabled");
      logTab.setAttribute("aria-disabled", "false");
    }

    if (!logRoot) return;

    const searchEl = logRoot.querySelector("[data-eld-search]");
    if (searchEl instanceof HTMLElement) {
      searchEl.hidden = opts.loadLogDiary === false;
    }
  }

  /**
   * @param {HTMLElement} head
   * @param {{
   *   meta: { name: string; oshi_text?: string; visibility?: string; liked_by?: object };
   *   itemCount: number;
   *   viewerId: string;
   *   profUid: string;
   *   showOwnerActions: boolean;
   *   listLocked: boolean;
   *   showLike: boolean;
   *   db: FirebaseFirestore.Firestore | null;
   *   listKind: "videos" | "yt";
   *   listId: string;
   *   previewAsOtherMember?: boolean;
   *   expandable?: boolean;
   *   onEdit: () => void;
   * }} opts
   */
  function buildProfileMylistListHeadChrome(head, opts) {
    const {
      meta,
      itemCount,
      viewerId,
      profUid,
      showOwnerActions,
      listLocked,
      showLike,
      db,
      listKind,
      listId,
      previewAsOtherMember,
      expandable = false,
      onEdit,
    } = opts;

    const topRow = document.createElement("div");
    topRow.className = "user-profile-mylist-top-row";

    const titleBlock = document.createElement("div");
    titleBlock.className = "user-profile-mylist-title-block";

    /** @type {HTMLElement|null} */
    let expandHit = null;
    if (expandable) {
      expandHit = document.createElement("div");
      expandHit.className = "user-profile-mylist-expand-hit";
      const chev = document.createElement("span");
      chev.className = "user-profile-mylist-toggle-chevron";
      chev.setAttribute("aria-hidden", "true");
      chev.textContent = "▸";
      expandHit.appendChild(chev);
    }

    const h3 = document.createElement("h3");
    h3.className = "user-profile-mylist-list-title";
    h3.textContent = meta.name;
    const countSpan = document.createElement("span");
    countSpan.className = "user-profile-mylist-count";
    countSpan.textContent = String(itemCount);
    h3.appendChild(document.createTextNode(" "));
    h3.appendChild(countSpan);
    if (expandHit) expandHit.appendChild(h3);
    else titleBlock.appendChild(h3);
    if (expandHit) titleBlock.appendChild(expandHit);

    if (showLike && profUid && !listLocked) {
      const likeHost = document.createElement("div");
      likeHost.className = "mll-mylist-list-like-host user-profile-mylist-inline-like";
      if (listKind === "videos") {
        window.MarchinZVideoMylist?.appendListLikeRow?.(likeHost, profUid, listId, meta.liked_by);
      } else {
        window.MarchinZYoutubeChannelMylist?.appendListLikeRow?.(likeHost, profUid, listId, meta.liked_by);
      }
      if (likeHost.childElementCount) {
        stopMylistHeadInteractiveBubble(likeHost);
        titleBlock.appendChild(likeHost);
      }
    }

    const actions = document.createElement("div");
    actions.className = "user-profile-mylist-list-head-right";

    if (showOwnerActions && db) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-reset-search user-profile-mylist-edit-btn";
      editBtn.setAttribute("data-mz-prof-owner-action", "1");
      editBtn.textContent = "編集する";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        onEdit();
      });
      actions.appendChild(editBtn);
    }

    if (viewerId && viewerId !== profUid && !previewAsOtherMember) {
      actions.appendChild(
        buildMylistReportOverflow(() =>
          submitMylistReport(db, viewerId, profUid, listId, listKind === "videos" ? "videos" : "yt").catch(
            (er) => {
              window.alert(String(er?.message || "通報に失敗しました。"));
            },
          ),
        ),
      );
    }

    const pub = meta.visibility !== "private";
    if (pub && profUid && showOwnerActions) {
      const sm = window.MarchinZShareMenu;
      if (sm?.buildAbsoluteUrlForHash && sm.mylistShareText && sm.setupSearchLikeShareMenuForButton) {
        const tab = listKind === "videos" ? "videos" : "yt";
        const shareBtn = document.createElement("button");
        shareBtn.type = "button";
        shareBtn.className = "btn-share-search btn-marchinz-spotlight";
        shareBtn.textContent = "シェアする";
        shareBtn.setAttribute(
          "aria-label",
          listKind === "videos"
            ? `大会動画マイリスト「${meta.name}」をシェア`
            : `YouTubeマイリスト「${meta.name}」をシェア`,
        );
        shareBtn.addEventListener("click", (e) => e.stopPropagation());
        const profHash = `#profile?uid=${encodeURIComponent(profUid)}&tab=${tab}&mylist=${encodeURIComponent(listId)}`;
        const shareUrl = sm.buildAbsoluteUrlForHash(profHash);
        const shareText = sm.mylistShareText(meta.name, shareUrl, listKind === "videos" ? "videos" : "yt");
        actions.appendChild(shareBtn);
        sm.setupSearchLikeShareMenuForButton(shareBtn, shareText, shareUrl, "mylist");
      }
    }

    stopMylistHeadInteractiveBubble(actions);
    topRow.appendChild(titleBlock);
    topRow.appendChild(actions);
    head.appendChild(topRow);

    const oshiWrap = document.createElement("div");
    oshiWrap.className = "user-profile-mylist-oshi-block";
    const oshiTextVal = String(meta.oshi_text || "").trim();
    const oshiP = document.createElement("p");
    oshiP.className = `user-profile-oshi-display${oshiTextVal ? "" : " is-placeholder"}`;
    const oshiLabel = document.createElement("span");
    oshiLabel.className = "user-profile-oshi-badge-label";
    oshiLabel.textContent = "推しポイント！";
    oshiP.appendChild(oshiLabel);
    const oshiTextEl = document.createElement("span");
    oshiTextEl.className = "user-profile-oshi-badge-text";
    oshiTextEl.textContent = oshiTextVal || "はまだ記入されていません";
    oshiP.appendChild(oshiTextEl);
    oshiWrap.appendChild(oshiP);
    head.appendChild(oshiWrap);

    return { oshiWrap, oshiP, oshiTextEl, expandHit };
  }

  /**
   * @param {any} listsSnap
   * @param {any} marksSnap
   * @param {{ targetUid?: string; likeShow?: { videoBookmark?: boolean }; viewerId?: string; db?: any; compactMylistPeek?: boolean; previewAsOtherMember?: boolean; listMeta?: Map<string, { name: string; oshi_text: string; visibility: string; list_order: number; liked_by: object }> } | null} [opts]
   */
  function renderVideoBookmarksGrouped(listsSnap, marksSnap, opts = null) {
    const host = el("#prof-mylist-videos");
    if (!host) return;
    host.replaceChildren();
    const profUid = String(opts?.targetUid || "").trim();
    const viewerId = String(opts?.viewerId || "").trim();
    const db = opts?.db || null;
    const showLike = opts?.likeShow?.videoBookmark !== false && Boolean(profUid);

    const listMeta =
      opts?.listMeta instanceof Map ? opts.listMeta : buildListMetaFromSnap(listsSnap, DEFAULT_VIDEO_LIST_ID);
    /** @type {Map<string, any[]>} */
    const byList = new Map();
    marksSnap.forEach((doc) => {
      const row = doc.data() || {};
      const lid = inferVideoBookmarkListId(doc.id, row);
      if (!byList.has(lid)) byList.set(lid, []);
      byList.get(lid).push({ ...row, __docId: doc.id });
    });

    const ids = [...byList.keys()]
      .filter((lid) => {
        const nm = listMeta.get(lid)?.name || lid;
        return !(lid === DEFAULT_VIDEO_LIST_ID && String(nm).trim() === "マイリスト");
      })
      .sort((a, b) => {
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
      const meta = resolveMylistMeta(lid, listMeta);

      const isOwnerList = Boolean(viewerId && profUid && viewerId === profUid);
      const showOwnerActions = isOwnerList && !opts?.previewAsOtherMember;
      const listLocked = meta.visibility === "private" && !showOwnerActions;

      const peekExtra = Boolean(opts?.compactMylistPeek);
      const sec = document.createElement("section");
      sec.className =
        "user-profile-mylist-list-section user-profile-mylist-list-section--cards-compact" +
        (peekExtra ? " user-profile-mylist-list-section--peek" : "") +
        (listLocked ? " user-profile-mylist-list-section--private-locked" : "");
      sec.setAttribute("data-prof-mylist-list-id", lid);

      if (listLocked) {
        const head = buildPrivateMylistListHead("videos");
        sec.appendChild(head);
        host.appendChild(sec);
        continue;
      }

      const head = document.createElement("div");
      head.className = "user-profile-mylist-list-head user-profile-mylist-list-head--toggle";
      const { expandHit } = buildProfileMylistListHeadChrome(head, {
        meta,
        itemCount: items.length,
        viewerId,
        profUid,
        showOwnerActions,
        listLocked,
        showLike,
        db,
        listKind: "videos",
        listId: lid,
        previewAsOtherMember: opts?.previewAsOtherMember,
        expandable: true,
        onEdit: () => openProfileMylistListEditDialog({ kind: "videos", listId: lid, meta, db }),
      });

      const thumbStrip = document.createElement("ul");
      thumbStrip.className = "user-profile-mylist-thumb-strip";
      head.appendChild(thumbStrip);

      const grid = document.createElement("ul");
      grid.className = "user-profile-mylist-grid mll-mylist-video-grid";
      grid.hidden = true;

      const fillThumbs = () => {
        thumbStrip.replaceChildren();
        const displayItems = items.slice(0, MYLIST_PEEK_MAX);
        for (const d of displayItems) {
          const vid = String(d.video_id || "").trim();
          if (!vid) continue;
          const title = String(d.event_title || "").trim() || "動画";
          const url = String(d.url || "").trim();
          const slot = document.createElement("li");
          slot.className = "user-profile-mylist-thumb-slot";
          const link = document.createElement("a");
          link.href = url || "#";
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.className = "user-profile-mylist-thumb-link";
          link.addEventListener("click", (e) => e.stopPropagation());
          const img = document.createElement("img");
          img.className = "user-profile-mylist-thumb-img";
          img.src = `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
          img.alt = title;
          img.loading = "lazy";
          img.onerror = function () { this.style.display = "none"; };
          link.appendChild(img);
          slot.appendChild(link);
          thumbStrip.appendChild(slot);
        }
        if (items.length > displayItems.length) {
          const more = document.createElement("li");
          more.className = "user-profile-mylist-thumb-more";
          more.textContent = `+${items.length - displayItems.length}`;
          thumbStrip.appendChild(more);
        }
      };

      const fillGrid = () => {
        grid.replaceChildren();
        for (const d of items) {
        const url = String(d.url || "").trim();
        const title = String(d.event_title || "").trim() || url || "動画";
        const org = String(d.org_team || "").trim();
        const vid = String(d.video_id || "").trim();
        const broadcaster = String(d.channel_name || "").trim();
        const chUrl = String(d.channel_url || "").trim();
        const li = document.createElement("li");
        li.className = "recommend-item prof-mylist-recommend-item";
        if (d.__docId) li.dataset.mzProfVideoBm = String(d.__docId);

        if (vid) {
          const thumbWrap = document.createElement("a");
          thumbWrap.href = url || "#";
          thumbWrap.target = "_blank";
          thumbWrap.rel = "noopener noreferrer";
          thumbWrap.className = "recommend-item-thumb-wrap";
          const img = document.createElement("img");
          img.className = "recommend-item-thumb";
          img.src = `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
          img.alt = title;
          img.loading = "lazy";
          img.onerror = function () { this.style.display = "none"; };
          thumbWrap.appendChild(img);
          li.appendChild(thumbWrap);
        }

        const infoRow = document.createElement("div");
        infoRow.className = "recommend-item-yt-info-row";
        const textStack = document.createElement("div");
        textStack.className = "recommend-item-yt-text-stack";
        if (org) {
          const headRow = document.createElement("div");
          headRow.className = "recommend-item-head-row";
          const orgSpan = document.createElement("span");
          orgSpan.className = "recommend-item-org";
          orgSpan.textContent = org;
          headRow.appendChild(orgSpan);
          textStack.appendChild(headRow);
        }
        const eventP = document.createElement("p");
        eventP.className = "recommend-item-event";
        const eventA = document.createElement("a");
        eventA.href = url || "#";
        eventA.target = "_blank";
        eventA.rel = "noopener noreferrer";
        eventA.className = "recommend-item-event-link";
        eventA.textContent = title;
        eventP.appendChild(eventA);
        textStack.appendChild(eventP);
        if (broadcaster) {
          const metaP = document.createElement("p");
          metaP.className = "recommend-item-yt-meta-line";
          const prefix = document.createElement("span");
          prefix.className = "recommend-item-yt-meta-prefix";
          prefix.textContent = "配信元　";
          metaP.appendChild(prefix);
          if (chUrl && /^https?:\/\//i.test(chUrl)) {
            const chLink = document.createElement("a");
            chLink.href = chUrl;
            chLink.target = "_blank";
            chLink.rel = "noopener noreferrer";
            chLink.className = "recommend-item-yt-meta-channel";
            chLink.textContent = broadcaster;
            metaP.appendChild(chLink);
          } else {
            const chSpan = document.createElement("span");
            chSpan.className = "recommend-item-yt-meta-channel";
            chSpan.textContent = broadcaster;
            metaP.appendChild(chSpan);
          }
          textStack.appendChild(metaP);
        }
        infoRow.appendChild(textStack);
        li.appendChild(infoRow);
        if (showLike && d.__docId) {
          const likeHost = document.createElement("div");
          likeHost.className = "user-profile-mylist-like-host mz-inline-like-host";
          appendProfBookmarkLikeRow(likeHost, d.liked_by || {}, profUid, String(d.__docId), "video_bookmarks");
          if (likeHost.childElementCount) li.appendChild(likeHost);
        }

        grid.appendChild(li);
        }
      };

      const syncExpand = (isExpanded) => {
        thumbStrip.hidden = isExpanded;
        grid.hidden = !isExpanded;
        if (isExpanded) fillGrid();
        else fillThumbs();
      };

      fillThumbs();
      bindMylistExpandControl(sec, expandHit, thumbStrip, syncExpand);

      sec.appendChild(head);
      sec.appendChild(grid);
      host.appendChild(sec);
    }

    if (!totalCards) {
      renderProfEmpty(host, PROF_EMPTY.videos);
    }
  }

  /**
   * @param {any} listsSnap
   * @param {any} marksSnap
   * @param {{ targetUid?: string; likeShow?: { channelBookmark?: boolean }; viewerId?: string; db?: any; compactMylistPeek?: boolean; previewAsOtherMember?: boolean; listMeta?: Map<string, { name: string; oshi_text: string; visibility: string; list_order: number; liked_by: object }> } | null} [opts]
   */
  function renderChannelBookmarksGrouped(listsSnap, marksSnap, opts = null) {
    const host = el("#prof-mylist-yt");
    if (!host) return;
    host.replaceChildren();
    const profUid = String(opts?.targetUid || "").trim();
    const viewerId = String(opts?.viewerId || "").trim();
    const db = opts?.db || null;
    const showLike = opts?.likeShow?.channelBookmark !== false && Boolean(profUid);

    const listMeta =
      opts?.listMeta instanceof Map ? opts.listMeta : buildListMetaFromSnap(listsSnap, DEFAULT_CHANNEL_LIST_ID);
    /** @type {Map<string, any[]>} */
    const byList = new Map();
    marksSnap.forEach((doc) => {
      const row = doc.data() || {};
      const lid = inferChannelBookmarkListId(doc.id, row);
      if (!byList.has(lid)) byList.set(lid, []);
      byList.get(lid).push({ ...row, __docId: doc.id });
    });

    const ids = [...byList.keys()]
      .filter((lid) => {
        const nm = listMeta.get(lid)?.name || lid;
        return !(lid === DEFAULT_CHANNEL_LIST_ID && String(nm).trim() === "マイリスト");
      })
      .sort((a, b) => {
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
      const meta = resolveMylistMeta(lid, listMeta);

      const isOwnerList = Boolean(viewerId && profUid && viewerId === profUid);
      const showOwnerActions = isOwnerList && !opts?.previewAsOtherMember;
      const listLocked = meta.visibility === "private" && !showOwnerActions;

      const peekExtra = Boolean(opts?.compactMylistPeek);
      const sec = document.createElement("section");
      sec.className =
        "user-profile-mylist-list-section user-profile-mylist-list-section--cards-compact" +
        (peekExtra ? " user-profile-mylist-list-section--peek" : "") +
        (listLocked ? " user-profile-mylist-list-section--private-locked" : "");
      sec.setAttribute("data-prof-mylist-list-id", lid);

      if (listLocked) {
        const head = buildPrivateMylistListHead("yt");
        sec.appendChild(head);
        host.appendChild(sec);
        continue;
      }

      const head = document.createElement("div");
      head.className = "user-profile-mylist-list-head user-profile-mylist-list-head--toggle";
      const { oshiWrap, expandHit } = buildProfileMylistListHeadChrome(head, {
        meta,
        itemCount: items.length,
        viewerId,
        profUid,
        showOwnerActions,
        listLocked,
        showLike,
        db,
        listKind: "yt",
        listId: lid,
        previewAsOtherMember: opts?.previewAsOtherMember,
        expandable: true,
        onEdit: () => openProfileMylistListEditDialog({ kind: "yt", listId: lid, meta, db }),
      });

      const thumbStrip = document.createElement("ul");
      thumbStrip.className = "user-profile-mylist-thumb-strip";
      head.appendChild(thumbStrip);

      const grid = document.createElement("ul");
      grid.className = "user-profile-mylist-grid mll-mylist-channel-grid";
      grid.hidden = true;

      const fillThumbs = () => {
        thumbStrip.replaceChildren();
        const displayItems = items.slice(0, MYLIST_PEEK_MAX);
        for (const d of displayItems) {
          const logo = String(d.channel_logo || "").trim();
          const title = String(d.channel_name || "").trim() || "チャンネル";
          const url = String(d.channel_url || "").trim();
          const slot = document.createElement("li");
          slot.className = "user-profile-mylist-thumb-slot user-profile-mylist-thumb-slot--round";
          if (logo) {
            const link = document.createElement("a");
            link.href = url || "#";
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className = "user-profile-mylist-thumb-link user-profile-mylist-thumb-link--round";
            link.addEventListener("click", (e) => e.stopPropagation());
            const img = document.createElement("img");
            img.className = "user-profile-mylist-thumb-img user-profile-mylist-thumb-img--round";
            img.src = logo;
            img.alt = title;
            img.loading = "lazy";
            img.onerror = function () { this.style.display = "none"; };
            link.appendChild(img);
            slot.appendChild(link);
          }
          thumbStrip.appendChild(slot);
        }
        if (items.length > displayItems.length) {
          const more = document.createElement("li");
          more.className = "user-profile-mylist-thumb-more";
          more.textContent = `+${items.length - displayItems.length}`;
          thumbStrip.appendChild(more);
        }
      };

      const fillGrid = () => {
        grid.replaceChildren();
        for (const d of items) {
        const url = String(d.channel_url || "").trim();
        const title = String(d.channel_name || "").trim() || "チャンネル";
        const logo = String(d.channel_logo || "").trim();
        const category = String(d.category || "").trim();
        const li = document.createElement("li");
        li.className = "youtube-card prof-mylist-youtube-card";
        if (d.__docId) li.dataset.mzProfChannelBm = String(d.__docId);

        const cardHead = document.createElement("div");
        cardHead.className = "youtube-card-head";
        if (logo) {
          const logoLink = document.createElement("a");
          logoLink.href = url || "#";
          logoLink.target = "_blank";
          logoLink.rel = "noopener noreferrer";
          logoLink.className = "youtube-logo-link";
          const img = document.createElement("img");
          img.className = "youtube-card-logo";
          img.src = logo;
          img.alt = title;
          img.loading = "lazy";
          img.onerror = function () { this.style.display = "none"; };
          logoLink.appendChild(img);
          cardHead.appendChild(logoLink);
        }
        const cardInfo = document.createElement("div");
        cardInfo.className = "youtube-card-info";
        const nameP = document.createElement("p");
        nameP.className = "youtube-card-name prof-mylist-youtube-card-name";
        nameP.textContent = title;
        cardInfo.appendChild(nameP);
        if (category) {
          const badges = document.createElement("div");
          badges.className = "youtube-card-top-badges";
          const catBadge = document.createElement("span");
          const catSlugMap = { "大会": "taikai", "一般": "ippan", "高校": "koko", "中学生以下": "junior", "カラーガード": "colorguard", "海外": "kaigai" };
          const catSlug = catSlugMap[category] || "default";
          catBadge.className = `youtube-top-badge youtube-top-badge--category youtube-top-badge--cat-${catSlug}`;
          catBadge.textContent = category;
          badges.appendChild(catBadge);
          cardInfo.appendChild(badges);
        }
        cardHead.appendChild(cardInfo);
        li.appendChild(cardHead);
        if (showLike && d.__docId) {
          const likeHost = document.createElement("div");
          likeHost.className = "user-profile-mylist-like-host mz-inline-like-host";
          appendProfBookmarkLikeRow(likeHost, d.liked_by || {}, profUid, String(d.__docId), "channel_bookmarks");
          if (likeHost.childElementCount) li.appendChild(likeHost);
        }

        grid.appendChild(li);
        }
      };

      const syncExpand = (isExpanded) => {
        thumbStrip.hidden = isExpanded;
        grid.hidden = !isExpanded;
        oshiWrap.hidden = isExpanded;
        if (isExpanded) fillGrid();
        else fillThumbs();
      };

      fillThumbs();
      bindMylistExpandControl(sec, expandHit, thumbStrip, syncExpand);

      sec.appendChild(head);
      sec.appendChild(grid);
      host.appendChild(sec);
    }

    if (!totalCards) {
      renderProfEmpty(host, PROF_EMPTY.yt);
    }
  }

  /** @param {number} n @param {string} id */
  function setCount(id, n) {
    const elc = el(id);
    if (elc) elc.textContent = String(n);
  }

  let activeTab = "mll";
  /** 本人のマイページ（通知・視点切替を出してよい） */
  let profilePageOwnerView = false;

  function profileNotifsAllowed() {
    return profilePageOwnerView;
  }

  function profileOwnerInboxTab(tab) {
    return tab === "notifs" || tab === "ops" || tab === "base";
  }

  function setProfileTab(t) {
    let tab = isValidProfileTab(t) ? t : "mll";
    if (!profileNotifsAllowed() && profileOwnerInboxTab(tab)) tab = "mll";
    if (tab !== activeTab) {
      const routeUid = uidFromRoute();
      const meId = String(window.MLL_AUTH?.getUser?.()?.id || "").trim();
      window.MarchinZTrackEvent?.("profile_tab_view", {
        tab,
        is_own: routeUid && meId && routeUid === meId ? 1 : 0,
      });
    }
    activeTab = tab;
    root?.querySelectorAll("[data-prof-tab]").forEach((b) => {
      const k = b.getAttribute("data-prof-tab") || "";
      if (profileOwnerInboxTab(k) && !profileNotifsAllowed()) {
        if (b instanceof HTMLElement) {
          b.hidden = true;
          b.setAttribute("aria-selected", "false");
          b.setAttribute("tabindex", "-1");
        }
        return;
      }
      const on = k === tab;
      b.setAttribute("aria-selected", String(on));
      if (b instanceof HTMLElement) {
        b.setAttribute("tabindex", on ? "0" : "-1");
      }
    });
    for (const p of PROFILE_TAB_KEYS) {
      const pane = el(`#prof-pane-${p}`);
      if (!pane) continue;
      if (profileOwnerInboxTab(p) && !profileNotifsAllowed()) {
        pane.hidden = true;
        pane.setAttribute("aria-hidden", "true");
        continue;
      }
      pane.hidden = p !== tab;
      if (p === "notifs" || p === "ops" || p === "base") pane.removeAttribute("aria-hidden");
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

  /** 切替直後に前ユーザーの DOM が残らないよう、レイアウトは表示したまま中身だけ空にする */
  function clearProfileContentShell() {
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
    el("#prof-attrs")?.replaceChildren();
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
    if (mmain) mmain.replaceChildren();
    syncMllOwnerPurgeMount(false, null, "", 0);
    const nhost = el("#prof-notifs-list");
    if (nhost) nhost.replaceChildren();
    const ldr = el("#prof-log-diary-root");
    if (ldr) resetProfLogDiaryHost(ldr);
    renderVideoBookmarksGrouped(EMPTY_QUERY_SNAP, EMPTY_QUERY_SNAP);
    renderChannelBookmarksGrouped(EMPTY_QUERY_SNAP, EMPTY_QUERY_SNAP);
    const note = el("#prof-sections-private-note");
    if (note) {
      note.textContent = "";
      note.hidden = true;
    }
  }

  function resetProfileChrome() {
    clearProfModerationUi();
    setProfileChromeVisible(false);
    clearProfileContentShell();
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
    renderMllSectionVisControls("public", false);
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
      await db.collection("mll_profiles").doc(targetUid).update({
        banned,
        banned_at: banned ? now : "",
        banned_reason: banned ? reason : "",
        updated_at: now,
      });
      if (banned) {
        await db.collection("mll_profiles").doc(targetUid).update({
          ...buildBanPrivacyProfilePatch(),
          updated_at: now,
        });
      }
      alert(banned ? "凍結しました。Log・Note・マイリストは非公開になりました。" : "凍結を解除しました。");
      void loadAndRender().catch(() => {});
    } catch (e) {
      alert(String(e?.message || e || "更新に失敗しました。"));
    }
  }

  /** @type {"owner" | "other_user"} 本人プロフィール上の表示プレビュー（他人のプロフィールを見ているときは常に owner 扱い） */
  let previewMode = "owner";
  let profileLoadSeq = 0;

  /** @param {number} gen @param {string} targetUid */
  function isProfileLoadStale(gen, targetUid) {
    return gen !== profileLoadSeq || String(uidFromRoute() || "") !== String(targetUid || "");
  }

  /** @param {number} gen @param {string} targetUid */
  function finishProfileLoadUi(gen, targetUid) {
    if (isProfileLoadStale(gen, targetUid)) return;
    root?.querySelector(".user-profile-layout")?.classList.remove("user-profile-layout--loading");
  }

  /**
   * loadAndRenderCore の全終了経路(途中 return・例外・stale)で「読み込み中の半透明
   * (--loading)」を確実に解除するラッパー(v1.34: マイページが半透明のまま残るバグ修正)。
   * 自分より新しいロードが始まっているときは、解除もそのロードに任せる。
   */
  async function loadAndRender() {
    const gen = ++profileLoadSeq;
    const targetUid = uidFromRoute();
    try {
      await loadAndRenderCore(gen, targetUid);
    } catch (e) {
      console.warn("[profile] load", e);
      // 古いロードの例外が新しい画面にエラーメッセージを出さないよう、最新ロードのときだけ表示
      if (gen === profileLoadSeq) {
        setText("#prof-load-msg", "読み込みに失敗しました。時間をおいて再度お試しください。");
      }
    } finally {
      if (gen === profileLoadSeq) {
        root?.querySelector(".user-profile-layout")?.classList.remove("user-profile-layout--loading");
      }
    }
  }

  /** @param {number} gen @param {string} targetUid */
  async function loadAndRenderCore(gen, targetUid) {
    const db = getDb();
    const viewer = window.MLL_AUTH?.getUser?.() || null;
    const realViewerId = viewer?.id || null;
    const guest = !realViewerId;
    const realIsOwner = Boolean(realViewerId && String(realViewerId) === String(targetUid));
    if (!realIsOwner) previewMode = "owner";
    const previewAsOtherUser = realIsOwner && previewMode === "other_user";
    const privacyViewerId = previewAsOtherUser ? PROF_PRIVACY_PREVIEW_UID : realViewerId;
    const viewerId = realViewerId;

    const showOwnerChrome = realIsOwner && !previewAsOtherUser;
    const viewAsVisitor = !realIsOwner || previewAsOtherUser;
    profilePageOwnerView = showOwnerChrome;

    document.documentElement.setAttribute("data-mz-prof-guest-preview", previewAsOtherUser ? "1" : "");
    document.documentElement.setAttribute("data-mz-prof-visitor", realIsOwner ? "" : "1");
    try {
      window.MarchinZSiteAnnouncement?.refreshBanner?.();
    } catch {
      //
    }

    const viewToggle = el("#prof-view-toggle");
    const guestNotice = el("#prof-guest-preview-notice");
    if (viewToggle) viewToggle.hidden = !realIsOwner || viewAsVisitor;
    if (guestNotice) guestNotice.hidden = !previewAsOtherUser;
    const ownerBtn = el("#prof-view-owner");
    const guestBtn = el("#prof-view-guest");
    if (ownerBtn) ownerBtn.setAttribute("aria-selected", String(previewMode === "owner"));
    if (guestBtn) guestBtn.setAttribute("aria-selected", String(previewMode === "other_user"));

    const labelEn = el("#prof-page-label-en");
    const headingJa = el("#prof-page-heading");
    if (labelEn) labelEn.textContent = realIsOwner ? "My Page" : "Profile";
    if (headingJa) headingJa.textContent = realIsOwner ? "マイページ" : "プロフィール";

    setText("#prof-load-msg", !targetUid ? "表示するユーザーを指定できません（ログインするか、共有されたプロフィールリンクを開いてください）。" : "");

    if (!targetUid) {
      stopCover();
      resetProfileChrome();
      return;
    }

    setProfileChromeVisible(true);
    clearProfileContentShell();
    root?.querySelector(".user-profile-layout")?.classList.add("user-profile-layout--loading");
    setText("#prof-load-msg", "読み込み中…");

    if (!wired) {
      wireTabs();
      wireNotificationPaneClicks();
      wireOpsPaneClicks();
      wireSiteAnnouncementNotifSync();
      wired = true;
    }

    if (!db) {
      clearProfModerationUi();
      setText("#prof-load-msg", "データに接続できません。");
      finishProfileLoadUi(gen, targetUid);
      return;
    }

    setText("#prof-load-msg", "");

    const profSnap = await db.collection("mll_profiles").doc(targetUid).get();
    if (isProfileLoadStale(gen, targetUid)) return;
    const pdata = profSnap.exists ? profSnap.data() || {} : {};
    if (pdata.withdrawn) {
      const isOwnerW = Boolean(realViewerId && String(realViewerId) === String(targetUid));
      const guestW = !realViewerId;
      syncProfBannedAndAdmin(pdata, {
        viewerId: realViewerId,
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
      el("#prof-ops-list")?.replaceChildren();
      renderVideoBookmarksGrouped(EMPTY_QUERY_SNAP, EMPTY_QUERY_SNAP);
      renderChannelBookmarksGrouped(EMPTY_QUERY_SNAP, EMPTY_QUERY_SNAP);
      setCount("#prof-count-mll", 0);
      setCount("#prof-count-videos", 0);
      setCount("#prof-count-yt", 0);
      setCount("#prof-count-logdiary", 0);
      finishProfileLoadUi(gen, targetUid);
      return;
    }

    const layoutRoot = root?.querySelector(".user-profile-layout");
    if (layoutRoot) layoutRoot.classList.remove("user-profile-layout--banned-limited");
    const pidRestore = el("#prof-public-id");
    if (pidRestore) pidRestore.hidden = false;
    const bioRestore = el("#prof-bio");
    if (bioRestore) bioRestore.hidden = false;

    if (viewAsVisitor && isProfileBanned(pdata)) {
      renderBannedVisitorLimitedProfile(pdata, targetUid, {
        viewerId: realViewerId,
        guest,
        isOwner: realIsOwner,
        db,
        targetUid,
      });
      setText("#prof-load-msg", "");
      finishProfileLoadUi(gen, targetUid);
      return;
    }

    const mllSectionVis = parseMllSectionVisibility(pdata);
    const logDiarySectionVis = parseLogDiarySectionVisibility(pdata);
    const videosSectionVis = parseVideosSectionVisibility(pdata);
    const ytSectionVis = parseYtSectionVisibility(pdata);
    const likeShow = parseLikeShowPrefs(pdata);
    const loadMll = !isProfileBanned(pdata) && (realIsOwner || mllSectionVis === "public");
    const loadVid = !isProfileBanned(pdata) && (realIsOwner || videosSectionVis === "public");
    const loadYt = !isProfileBanned(pdata) && (realIsOwner || ytSectionVis === "public");
    const loadLogDiary = !isProfileBanned(pdata) && (realIsOwner || logDiarySectionVis === "public");

    if (realIsOwner && db) {
      await cleanupLegacyDefaultMylistLists(db, targetUid);
    }
    if (isProfileLoadStale(gen, targetUid)) return;

    const safeQuery = async (task, fallback, warnTag) => {
      try {
        return await task();
      } catch (e) {
        console.warn(`[profile] ${warnTag} failed`, e);
        return fallback;
      }
    };
    const [logsSnap, videoListsSnap, vidSnap, chListsSnap, chSnap, calLookup, notifsSnap, diariesSnap] =
      await Promise.all([
      loadMll
        ? safeQuery(
            () =>
              window.MarchinZMllRole?.queryMllLogsForUser?.(db, targetUid, {
                visitorPublicOnly: viewAsVisitor && !realIsOwner,
              }) ?? db.collection("mll_logs").where("user_id", "==", targetUid).limit(800).get(),
            EMPTY_QUERY_SNAP,
            "mll_logs",
          )
        : Promise.resolve(EMPTY_QUERY_SNAP),
      loadVid
        ? safeQuery(
            () => db.collection("mll_profiles").doc(targetUid).collection("video_lists").orderBy("created_at", "asc").limit(80).get(),
            EMPTY_QUERY_SNAP,
            "video_lists",
          )
        : Promise.resolve(EMPTY_QUERY_SNAP),
      loadVid
        ? safeQuery(
            () => db.collection("mll_profiles").doc(targetUid).collection("video_bookmarks").orderBy("added_at", "desc").limit(200).get(),
            EMPTY_QUERY_SNAP,
            "video_bookmarks",
          )
        : Promise.resolve(EMPTY_QUERY_SNAP),
      loadYt
        ? safeQuery(
            () => db.collection("mll_profiles").doc(targetUid).collection("channel_lists").orderBy("created_at", "asc").limit(80).get(),
            EMPTY_QUERY_SNAP,
            "channel_lists",
          )
        : Promise.resolve(EMPTY_QUERY_SNAP),
      loadYt
        ? safeQuery(
            () => db.collection("mll_profiles").doc(targetUid).collection("channel_bookmarks").orderBy("added_at", "desc").limit(200).get(),
            EMPTY_QUERY_SNAP,
            "channel_bookmarks",
          )
        : Promise.resolve(EMPTY_QUERY_SNAP),
      safeQuery(
        () => loadCalendarLookup(db),
        { matchMap: new Map(), byId: new Map() },
        "calendar_lookup",
      ),
      showOwnerChrome
        ? safeQuery(
            () =>
              db
                .collection("mll_profiles")
                .doc(targetUid)
                .collection("notifications")
                .orderBy("created_at", "desc")
                .limit(80)
                .get(),
            EMPTY_QUERY_SNAP,
            "notifications",
          )
        : Promise.resolve(EMPTY_QUERY_SNAP),
      loadMll && showOwnerChrome
        ? safeQuery(
            () => db.collection("mll_profiles").doc(targetUid).collection("event_log_diaries").get(),
            EMPTY_QUERY_SNAP,
            "event_log_diaries",
          )
        : Promise.resolve(EMPTY_QUERY_SNAP),
    ]);
    if (isProfileLoadStale(gen, targetUid)) return;

    const profile = {
      display_name: pdata.display_name || "ユーザー",
      avatar_url: pdata.avatar_url || "",
      profile_bio: pdata.profile_bio || "",
      profile_address_prefecture: resolveProfileAddressPrefecture(pdata),
      profile_address_prefecture_public: isProfileAddressPrefecturePublic(pdata),
      profile_attributes: Array.isArray(pdata.profile_attributes) ? pdata.profile_attributes : [],
      marchinz_public_id: String(pdata.marchinz_public_id || "").replace(/\D/g, ""),
      updated_at: String(pdata.updated_at || "").trim(),
    };

    renderHeader(profile, targetUid);

    mountCoverSingle(resolveCoverUrlFromPdata(pdata), profile.updated_at);

    if (viewAsVisitor) {
      root?.querySelectorAll("[data-prof-tab]").forEach((btn) => {
        if (!(btn instanceof HTMLElement)) return;
        const k = btn.getAttribute("data-prof-tab") || "";
        if (!isValidProfileTab(k)) return;
        if (k === "notifs" || k === "ops" || k === "base") {
          btn.hidden = true;
          return;
        }
        btn.hidden =
          (k === "mll" && mllSectionVis === "private") ||
          (k === "videos" && videosSectionVis === "private") ||
          (k === "yt" && ytSectionVis === "private") ||
          (k === "logdiary" && logDiarySectionVis === "private");
      });
    } else {
      root?.querySelectorAll("[data-prof-tab]").forEach((btn) => {
        if (btn instanceof HTMLElement) btn.hidden = false;
      });
    }
    renderMllSectionVisControls(mllSectionVis, showOwnerChrome);

    const storedCountsEarly = isProfileBanned(pdata)
      ? { mll: 0, videos: 0, yt: 0, logdiary: 0 }
      : readPublicProfCounts(pdata);
    const anyTabPublic =
      showOwnerChrome ||
      mllSectionVis === "public" ||
      videosSectionVis === "public" ||
      ytSectionVis === "public" ||
      logDiarySectionVis === "public";
    const noteEl = el("#prof-sections-private-note");
    if (noteEl) {
      if (!anyTabPublic && viewAsVisitor) {
        noteEl.textContent =
          "このユーザーは、プロフィール上の一覧（MarchinZ Log・動画マイリスト・YouTube・MarchinZ Note）をすべて非公開にしています。";
        noteEl.hidden = false;
      } else {
        noteEl.textContent = "";
        noteEl.hidden = true;
      }
    }

    /** Log / Note が非公開でマイリスト系だけ公開のとき、プロフ上のカードを高密度プレビューにする */
    const compactMylistPeek =
      viewAsVisitor &&
      mllSectionVis === "private" &&
      storedCountsEarly.logdiary === 0 &&
      (storedCountsEarly.videos > 0 || storedCountsEarly.yt > 0);

    const videoListMeta = buildListMetaFromSnap(videoListsSnap, DEFAULT_VIDEO_LIST_ID);
    const channelListMeta = buildListMetaFromSnap(chListsSnap, DEFAULT_CHANNEL_LIST_ID);
    if (viewAsVisitor && !realIsOwner && db) {
      const videoLids = new Set();
      vidSnap.forEach((doc) => {
        videoLids.add(inferVideoBookmarkListId(doc.id, doc.data() || {}));
      });
      const channelLids = new Set();
      chSnap.forEach((doc) => {
        channelLids.add(inferChannelBookmarkListId(doc.id, doc.data() || {}));
      });
      await enrichMylistMetaForVisitor(db, targetUid, "video_lists", videoListMeta, [...videoLids]);
      await enrichMylistMetaForVisitor(db, targetUid, "channel_lists", channelListMeta, [...channelLids]);
    }
    if (isProfileLoadStale(gen, targetUid)) return;

    /** @type {Set<string>} */
    const diaryEventIds = new Set();
    if (showOwnerChrome && diariesSnap && typeof diariesSnap.forEach === "function") {
      diariesSnap.forEach((doc) => {
        if (doc.id) diaryEventIds.add(doc.id);
      });
    }

    /** @type {any[]} */
    const myLogs = [];
    logsSnap.forEach((doc) => {
      const x = doc.data() || {};
      const row = normalizeLog(doc.id, x);
      if (String(row.user_id) !== String(targetUid)) return;
      if (!canViewerSeeLog(row, privacyViewerId)) return;
      myLogs.push(row);
    });

    if (!loadMll && viewAsVisitor) {
      renderProfPrivateBlur(el("#prof-mll-main"));
      syncMllOwnerPurgeMount(false, null, "", 0);
    } else {
      renderMLL(myLogs, calLookup, {
        isOwner: showOwnerChrome,
        sectionVis: { mll: mllSectionVis },
        displayName: profile.display_name,
        targetUid,
        viewerId,
        likeShow,
        db,
        diaryEventIds,
      });
      window.MarchinZIcons?.scheduleDynamicActionButtons?.();
      syncMllOwnerPurgeMount(realIsOwner && !myLogs.length, db, targetUid, myLogs.length);
    }

    if (!loadVid && viewAsVisitor) {
      renderProfPrivateBlur(el("#prof-mylist-videos"));
    } else {
      renderVideoBookmarksGrouped(videoListsSnap, vidSnap, {
        targetUid,
        likeShow,
        viewerId,
        db,
        compactMylistPeek,
        previewAsOtherMember: previewAsOtherUser,
        listMeta: videoListMeta,
      });
    }

    if (!loadYt && viewAsVisitor) {
      renderProfPrivateBlur(el("#prof-mylist-yt"));
    } else {
      renderChannelBookmarksGrouped(chListsSnap, chSnap, {
        targetUid,
        likeShow,
        viewerId,
        db,
        compactMylistPeek,
        previewAsOtherMember: previewAsOtherUser,
        listMeta: channelListMeta,
      });
    }

    const storedCounts = readPublicProfCounts(pdata);
    const tabCounts = resolveProfTabDisplayCounts(showOwnerChrome, storedCounts, {
      mll: myLogs.length,
      videos: countMylistTabListsWithBookmarks(vidSnap, inferVideoBookmarkListId),
      yt: countMylistTabListsWithBookmarks(chSnap, inferChannelBookmarkListId),
      logdiary: storedCounts.logdiary,
    });
    let diaryCount = tabCounts.logdiary;

    setCount("#prof-count-mll", tabCounts.mll);
    setCount("#prof-count-videos", tabCounts.videos);
    setCount("#prof-count-yt", tabCounts.yt);

    const hpPreMount =
      typeof window.MarchinZProfileHashParams === "function"
        ? window.MarchinZProfileHashParams()
        : new URLSearchParams("");
    const preTab = String(hpPreMount.get("tab") || "").trim();
    const shareEventId = String(hpPreMount.get("event") || "").trim();
    if (preTab === "logdiary" || shareEventId) {
      setProfileTab("logdiary");
    }

    const logRoot = el("#prof-log-diary-root");
    if (logRoot) {
      if (!loadLogDiary && viewAsVisitor) {
        resetProfLogDiaryHost(logRoot, { includeSearch: false });
        const listEl = logRoot.querySelector("[data-eld-list]");
        if (shareEventId && !isProfileBanned(pdata)) {
          if (listEl) {
            listEl.replaceChildren();
            const loading = document.createElement("p");
            loading.className = "user-profile-load-msg";
            loading.textContent = "MarchinZ Note を読み込んでいます…";
            listEl.appendChild(loading);
          }
          const loadGen = gen;
          const loadUid = targetUid;
          const loadEv = shareEventId;
          requestAnimationFrame(() => {
            if (isProfileLoadStale(loadGen, loadUid)) return;
            void window.MarchinZNoteActions?.openViewer?.({
              uid: loadUid,
              eventId: loadEv,
              returnHash: location.hash,
            });
          });
        } else if (listEl) {
          renderProfPrivateBlur(listEl);
        }
      } else if (typeof window.MarchinZEventLogDiary?.mount === "function") {
        resetProfLogDiaryHost(logRoot);
        try {
          const r = await window.MarchinZEventLogDiary.mount(logRoot, {
            targetUid,
            viewerId,
            db,
            likeShowLog: likeShow.logDiary,
            previewAsOtherMember: previewAsOtherUser,
            authorDisplay: {
              name: profile.display_name || "ユーザー",
              avatar: profile.avatar_url || "",
            },
          });
          if (showOwnerChrome) {
            diaryCount = Number(r?.diaryCount) || 0;
          }
        } catch {
          if (showOwnerChrome) diaryCount = 0;
        }
      }
    }
    if (isProfileLoadStale(gen, targetUid)) return;
    setCount("#prof-count-logdiary", diaryCount);

    const notifRow = root?.querySelector(".user-profile-notif-row");
    if (notifRow) notifRow.hidden = !showOwnerChrome;
    const tabNotifs = el("#prof-tab-notifs");
    if (tabNotifs) tabNotifs.hidden = !showOwnerChrome;
    const tabOps = el("#prof-tab-ops");
    if (tabOps) tabOps.hidden = !showOwnerChrome;
    const notifPane = el("#prof-pane-notifs");
    if (notifPane) {
      if (!showOwnerChrome) {
        notifPane.hidden = true;
        notifPane.setAttribute("aria-hidden", "true");
      } else {
        notifPane.removeAttribute("aria-hidden");
      }
    }
    const opsPane = el("#prof-pane-ops");
    if (opsPane) {
      if (!showOwnerChrome) {
        opsPane.hidden = true;
        opsPane.setAttribute("aria-hidden", "true");
      } else {
        opsPane.removeAttribute("aria-hidden");
      }
    }
    const tabBase = el("#prof-tab-base");
    if (tabBase) tabBase.hidden = !showOwnerChrome;
    const basePane = el("#prof-pane-base");
    if (basePane) {
      if (!showOwnerChrome) {
        basePane.hidden = true;
        basePane.setAttribute("aria-hidden", "true");
      } else {
        basePane.removeAttribute("aria-hidden");
      }
    }
    if (showOwnerChrome) {
      await renderNotificationsPane(db, targetUid, notifsSnap);
      if (isProfileLoadStale(gen, targetUid)) return;
      renderOpsPane();
      window.MarchinZBase?.mount(targetUid);
    } else {
      const nh = el("#prof-notifs-list");
      if (nh) nh.replaceChildren();
      const oh = el("#prof-ops-list");
      if (oh) oh.replaceChildren();
    }

    if (!guest && showOwnerChrome) {
      await maybeSyncProfTabCountsToProfile(db, targetUid, showOwnerChrome, pdata, {
        mll: myLogs.length,
        videos: countMylistTabListsWithBookmarks(vidSnap, inferVideoBookmarkListId),
        yt: countMylistTabListsWithBookmarks(chSnap, inferChannelBookmarkListId),
        logdiary: diaryCount,
      });
    }
    if (isProfileLoadStale(gen, targetUid)) return;

    const hp = typeof window.MarchinZProfileHashParams === "function" ? window.MarchinZProfileHashParams() : new URLSearchParams("");
    const wantTab = String(hp.get("tab") || "").trim();
    let pickTab = isValidProfileTab(wantTab) ? wantTab : "mll";
    if (viewAsVisitor && (pickTab === "notifs" || pickTab === "ops")) pickTab = "mll";
    if (viewAsVisitor && pickTab === "mll" && mllSectionVis === "private") {
      if (videosSectionVis === "public") pickTab = "videos";
      else if (ytSectionVis === "public") pickTab = "yt";
      else if (logDiarySectionVis === "public") pickTab = "logdiary";
      else pickTab = "videos";
    }
    if (viewAsVisitor && pickTab === "videos" && videosSectionVis === "private") {
      pickTab = mllSectionVis === "public" ? "mll" : logDiarySectionVis === "public" ? "logdiary" : "mll";
    }
    if (viewAsVisitor && pickTab === "yt" && ytSectionVis === "private") {
      pickTab = mllSectionVis === "public" ? "mll" : logDiarySectionVis === "public" ? "logdiary" : "mll";
    }
    if (viewAsVisitor && pickTab === "logdiary" && logDiarySectionVis === "private") {
      pickTab = mllSectionVis === "public" ? "mll" : videosSectionVis === "public" ? "videos" : "mll";
    }
    setProfileTab(pickTab);

    syncLogDiaryTabUI({ loadLogDiary });

    const mylistFocusId = String(hp.get("mylist") || "").trim();
    if (mylistFocusId && root) {
      const loadGen = gen;
      const loadUid = targetUid;
      const loadMylist = mylistFocusId;
      window.requestAnimationFrame(() => {
        if (isProfileLoadStale(loadGen, loadUid)) return;
        const esc =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(loadMylist)
            : loadMylist.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
      const loadGen = gen;
      const loadUid = targetUid;
      const loadVidBm = vidBmFocus;
      const loadChBm = chBmFocus;
      window.requestAnimationFrame(() => {
        if (isProfileLoadStale(loadGen, loadUid)) return;
        try {
          if (loadVidBm) sessionStorage.removeItem("mz_prof_video_bm");
        } catch {
          //
        }
        try {
          if (loadChBm) sessionStorage.removeItem("mz_prof_channel_bm");
        } catch {
          //
        }
        const escV =
          loadVidBm && typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(loadVidBm)
            : loadVidBm.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const escC =
          loadChBm && typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(loadChBm)
            : loadChBm.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const card =
          (loadVidBm && root.querySelector(`[data-mz-prof-video-bm="${escV}"]`)) ||
          (loadChBm && root.querySelector(`[data-mz-prof-channel-bm="${escC}"]`));
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
      isOwner: realIsOwner,
      db,
      targetUid,
      withdrawn: false,
    });

    setText("#prof-load-msg", "");
    finishProfileLoadUi(gen, targetUid);
  }

  /** @param {string} id @param {any} x */
  function normalizeLog(id, x) {
    const visibility = x.visibility === "private" ? "private" : "public";
    const role = mapLogRole(x.role, x.role_label);
    return { ...x, id, visibility, role };
  }

  /** @type {Promise<void>|null} */
  let pending = null;

  window.MarchinZProfileNotifs = {
    refreshHeaderBadge: () => {
      refreshProfNotifUnreadBadge();
    },
    refreshHeaderFromRemote: () => refreshHeaderNotifUnreadFromRemote(),
  };

  window.addEventListener("mll-auth-changed", () => {
    void refreshHeaderNotifUnreadFromRemote();
  });

  window.MarchinZUserProfile = {
    refresh() {
      void loadAndRender().catch(() => setText("#prof-load-msg", "読み込みに失敗しました。"));
    },
    onRouteShow(pageId) {
      if (pageId !== "profile") {
        document.documentElement.removeAttribute("data-mz-prof-guest-preview");
        try {
          window.MarchinZSiteAnnouncement?.refreshBanner?.();
        } catch {
          //
        }
        stopCover();
        return;
      }
      previewMode = "owner";
      pending = loadAndRender().catch(() => setText("#prof-load-msg", "読み込みに失敗しました。"));
      void pending;
    },
  };

  if (root && !root.dataset.mzMllVisBound) {
    root.dataset.mzMllVisBound = "1";
    const onMllVisClick = () => {
      const btn = el("#prof-mll-vis-pane");
      const cur = btn?.classList.contains("user-profile-mll-vis-toggle--private") ? "private" : "public";
      void toggleMllSectionVisibility(cur);
    };
    el("#prof-mll-vis-pane")?.addEventListener("click", onMllVisClick);
  }

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
    previewMode = "owner";
    void loadAndRender().catch(() => {});
  });

  window.addEventListener("mll-auth-changed", () => {
    const hash = String(location.hash || "");
    if (!/^#profile(?:\?|$)/i.test(hash)) return;
    const fromHash = String(window.MarchinZProfileUidFromHash?.() || "").trim();
    if (fromHash) return;
    previewMode = "owner";
    void loadAndRender().catch(() => {});
  });

  document.querySelectorAll("[data-prof-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.getAttribute("data-prof-view");
      previewMode = v === "other_user" || v === "guest" ? "other_user" : "owner";
      if (previewMode === "other_user" && (activeTab === "notifs" || activeTab === "ops")) {
        setProfileTab("mll");
        syncProfileUrlToTab("mll");
      }
      void loadAndRender().catch(() => {});
    });
  });

  ["marchinz-mylist-updated", "marchinz-channel-mylist-updated", "marchinz-mll-updated"].forEach((evName) => {
    window.addEventListener(evName, () => {
      const hash = String(location.hash || "");
      if (!/^#profile(?:\?|$)/i.test(hash)) return;
      const fromHash = String(window.MarchinZProfileUidFromHash?.() || "").trim();
      const me = String(window.MLL_AUTH?.getUser?.()?.id || "").trim();
      if (fromHash && me && fromHash !== me) return;
      void loadAndRender().catch(() => {});
    });
  });
})();
