/**
 * 運営 UGC フィード（mll_admin_ugc_feed）への記録。いいねは対象外。
 */
(function () {
  "use strict";

  function getDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function isoNow() {
    return new Date().toISOString();
  }

  const COMMUNITY_UPDATE_EMOJI = [
    "🎺",
    "🎷",
    "🥁",
    "🎸",
    "🎻",
    "🎹",
    "🎼",
    "🪗",
    "🎌",
    "🏁",
    "🚩",
    "🏳️",
    "🏴",
    "🎏",
  ];

  function pickCommunityUpdateEmoji() {
    return COMMUNITY_UPDATE_EMOJI[Math.floor(Math.random() * COMMUNITY_UPDATE_EMOJI.length)] || "🎺";
  }

  /** @param {Record<string, unknown>} raw */
  async function recordCommunityUpdate(raw) {
    const db = getDb();
    if (!db) return;
    const kind = String(raw.kind || "").trim();
    const action = String(raw.action || "create").trim();
    if (action !== "create" || (kind !== "event" && kind !== "board")) return;
    /** @type {Record<string, string>} */
    const doc = {
      kind,
      action: "create",
      actor_uid: String(raw.actor_uid || "").trim(),
      actor_name: String(raw.actor_name || "ユーザー").trim() || "ユーザー",
      created_at: String(raw.created_at || isoNow()),
      target_href: String(raw.target_href || "").trim().slice(0, 512),
      emoji: pickCommunityUpdateEmoji(),
    };
    if (kind === "event") {
      doc.event_id = String(raw.event_id || "").trim().slice(0, 128);
      doc.event_date = String(raw.event_date || "").trim().slice(0, 32);
      doc.event_name = String(raw.event_name || "イベント").trim().slice(0, 200);
    } else {
      doc.post_id = String(raw.post_id || "").trim().slice(0, 128);
      doc.post_title = String(raw.target_label || raw.post_title || "掲示板投稿").trim().slice(0, 200);
      doc.post_theme = String(raw.post_theme || "").trim().slice(0, 80);
    }
    try {
      await db.collection("mll_community_updates").add(doc);
    } catch (e) {
      console.warn("[MarchinZ] community update log", e);
    }
  }

  const GUEST_ACTOR_UID = "mll_guest";

  const SHARE_CHANNEL_LABELS = /** @type {Record<string, string>} */ ({
    copy: "リンクをコピー",
    x: "X",
    line: "LINE",
    instagram: "Instagram",
    facebook: "Facebook",
  });

  /** @param {string} uid */
  async function fetchProfileDisplayName(uid) {
    const id = String(uid || "").trim();
    if (!id || id === GUEST_ACTOR_UID) return "";
    const db = getDb();
    if (!db) return "";
    try {
      const snap = await db.collection("mll_profiles").doc(id).get();
      const dn = String(snap.data()?.display_name || "").trim();
      if (!dn || dn === "退会ユーザー") return "";
      return dn.slice(0, 120);
    } catch {
      return "";
    }
  }

  /**
   * UGC 用の表示名（mll_profiles.display_name ＝ ニックネーム）。本人操作は Google 名を使わない。
   * @param {Record<string, unknown>} raw
   * @param {string} uid
   * @param {boolean} isGuest
   */
  async function actorDisplayNameForRecord(raw, uid, isGuest) {
    if (isGuest) return "ゲスト";
    const me = window.MLL_AUTH?.getUser?.();
    const isSelf = Boolean(me?.id && me.id === uid);
    if (isSelf) {
      const nick = String(window.MLL_AUTH?.getDisplayName?.() || "").trim();
      if (nick) return nick.slice(0, 120);
      const fromDb = await fetchProfileDisplayName(uid);
      if (fromDb) return fromDb;
    }
    const fromRaw = String(raw.actor_name || "").trim();
    if (fromRaw) return fromRaw.slice(0, 120);
    const fromDb = await fetchProfileDisplayName(uid);
    if (fromDb) return fromDb;
    return "ユーザー";
  }

  /** @param {Record<string, unknown>} raw */
  function resolveActor(raw) {
    const me = window.MLL_AUTH?.getUser?.();
    if (me?.id) {
      return {
        uid: String(raw.actor_uid || me.id).trim(),
        isGuest: false,
      };
    }
    return { uid: GUEST_ACTOR_UID, isGuest: true };
  }

  let lastVideoSearchQuery = "";
  let lastVideoSearchAt = 0;
  const VIDEO_SEARCH_MIN_GAP_MS = 3000;

  const TOOL_USE_IDS = ["metronome", "tuner", "privacy", "switcher", "reangle"];
  /** ページ滞在中に記録済みのツール(同一ツールの連打・再スタートを重複記録しない) */
  const recordedToolUses = new Set();

  /** @param {Record<string, unknown>} raw @returns {Promise<boolean>} */
  async function record(raw) {
    const db = getDb();
    if (!db) return false;
    const kind = String(raw.kind || "").trim();
    if (!kind) return false;
    // ゲスト(未ログイン)でも記録できる種別: 検索系+ツール利用(ログイン不要ツールのため)
    const searchFeedKind = kind === "video_search" || kind === "search_share" || kind === "tool_use";
    const actor = resolveActor(raw);
    if (!searchFeedKind && (actor.isGuest || !actor.uid)) return false;
    const actorName = await actorDisplayNameForRecord(raw, actor.uid, actor.isGuest);
    /** @type {Record<string, string>} */
    const doc = {
      kind,
      action: String(raw.action || "create").trim() || "create",
      actor_uid: actor.uid,
      actor_name: actorName,
      created_at: String(raw.created_at || isoNow()),
      target_label: String(raw.target_label || "").trim().slice(0, 200),
      target_href: String(raw.target_href || "").trim().slice(0, 512),
    };
    /* ★ ここに actor_admin のような新フィールドを足してはいけない(2026-08-04)。
       firestore.rules の adminUgcFeedAllowedKeys() が hasOnly で許可リストを持つので、
       リストに無いキーを1つ足すだけで **書き込みが無音で拒否される**
       (mll_profiles で同じ罠を踏んだ実績: marchinz-profile-field-allowlist)。
       「管理者ぶんを隠す」は表示側(marchinz-admin-ugc.js の dropAdminRows)が
       actor_uid で判定する ─ 管理者は auth-config.js の adminEmails=1人なので足りる。
       印を付ける方式にするなら rules の許可リスト追加 + firestore:rules のデプロイが要る */
    const optKeys = [
      "public_id",
      "event_kind",
      "event_date",
      "event_name",
      "event_id",
      "post_id",
      "thread_root_id",
      "moment_id",
      "note_event_id",
      "list_id",
      "search_query",
      "share_channel",
      "log_id",
      "tool_id",
    ];
    for (const k of optKeys) {
      const v = String(raw[k] ?? "").trim();
      if (v) doc[k] = v.slice(0, k === "public_id" ? 32 : 200);
    }
    try {
      await db.collection("mll_admin_ugc_feed").add(doc);
      if (!searchFeedKind) void recordCommunityUpdate({ ...raw, ...doc });
      window.dispatchEvent(
        new CustomEvent("marchinz-admin-ugc-recorded", { detail: { kind } }),
      );
      return true;
    } catch (e) {
      console.warn("[MarchinZ] admin ugc log", e);
      return false;
    }
  }

  window.MarchinZAdminUgcLog = {
    /** @param {{ uid: string; displayName?: string; publicId?: string }} p */
    recordSignup(p) {
      const uid = String(p.uid || "").trim();
      if (!uid) return;
      void record({
        kind: "signup",
        action: "create",
        actor_uid: uid,
        actor_name: String(p.displayName || "ユーザー").trim() || "ユーザー",
        public_id: String(p.publicId || "").trim(),
        target_label: "ユーザー登録",
        target_href: `#profile?uid=${encodeURIComponent(uid)}`,
      });
    },
    /** @param {{ action?: string; eventKind: string; eventDate: string; eventName: string; eventId: string; actorUid?: string; actorName?: string }} p */
    recordEvent(p) {
      const eventId = String(p.eventId || "").trim();
      if (!eventId) return;
      const kind = String(p.eventKind || "イベント").trim() || "イベント";
      const date = String(p.eventDate || "").trim();
      const title = String(p.eventName || "イベント").trim() || "イベント";
      const action = String(p.action || "create").trim() === "delete" ? "delete" : "create";
      void record({
        kind: "event",
        action,
        actor_uid: String(p.actorUid || "").trim(),
        actor_name: String(p.actorName || "ユーザー").trim() || "ユーザー",
        event_kind: kind,
        event_date: date,
        event_name: title,
        event_id: eventId,
        target_label: `${kind} ${date}の${title}`,
        target_href: "#community/events",
      });
    },
    /** @param {{ momentId: string; excerpt?: string; actorUid?: string; actorName?: string }} p */
    recordMoment(p) {
      const momentId = String(p.momentId || "").trim();
      const uid = String(p.actorUid || "").trim();
      if (!momentId || !uid) return;
      const excerpt = String(p.excerpt || "Moment").trim().slice(0, 80) || "Moment";
      void record({
        kind: "moment",
        action: "create",
        actor_uid: uid,
        actor_name: String(p.actorName || "ユーザー").trim() || "ユーザー",
        moment_id: momentId,
        target_label: excerpt,
        target_href: `#community/moments?uid=${encodeURIComponent(uid)}&moment=${encodeURIComponent(momentId)}`,
      });
    },
    /** @param {{ postId: string; title: string; theme?: string; actorUid?: string; actorName?: string }} p */
    recordBoardPost(p) {
      const postId = String(p.postId || "").trim();
      if (!postId) return;
      const title = String(p.title || "掲示板投稿").trim().slice(0, 80) || "掲示板投稿";
      void record({
        kind: "board",
        action: "create",
        actor_uid: String(p.actorUid || "").trim(),
        actor_name: String(p.actorName || "ユーザー").trim() || "ユーザー",
        post_id: postId,
        thread_root_id: postId,
        post_theme: String(p.theme || "").trim(),
        target_label: title,
        target_href: `#community/board?thread=${encodeURIComponent(postId)}`,
      });
    },
    /** @param {{ postId: string; threadRootId: string; threadTitle: string; actorUid?: string; actorName?: string }} p */
    recordBoardReply(p) {
      const postId = String(p.postId || "").trim();
      const threadRootId = String(p.threadRootId || "").trim();
      if (!postId || !threadRootId) return;
      const title = String(p.threadTitle || "掲示板").trim().slice(0, 80) || "掲示板";
      void record({
        kind: "board_reply",
        action: "create",
        actor_uid: String(p.actorUid || "").trim(),
        actor_name: String(p.actorName || "ユーザー").trim() || "ユーザー",
        post_id: postId,
        thread_root_id: threadRootId,
        target_label: title,
        target_href: `#community/board?thread=${encodeURIComponent(threadRootId)}`,
      });
    },
    /** @param {{ eventId: string; noteTitle?: string; actorUid?: string; actorName?: string }} p */
    recordNote(p) {
      const eventId = String(p.eventId || "").trim();
      const uid = String(p.actorUid || "").trim();
      if (!eventId || !uid) return;
      const title = String(p.noteTitle || "MarchinZ Note").trim().slice(0, 80) || "MarchinZ Note";
      void record({
        kind: "note",
        action: "create",
        actor_uid: uid,
        actor_name: String(p.actorName || "ユーザー").trim() || "ユーザー",
        note_event_id: eventId,
        target_label: title,
        target_href: `#profile?uid=${encodeURIComponent(uid)}&tab=logdiary&event=${encodeURIComponent(eventId)}`,
      });
    },
    /** @param {{ listId: string; listName?: string; actorUid?: string; actorName?: string }} p */
    recordVideoMylist(p) {
      const listId = String(p.listId || "").trim();
      const uid = String(p.actorUid || "").trim();
      if (!listId || !uid) return;
      const name = String(p.listName || "リスト").trim().slice(0, 80) || "リスト";
      void record({
        kind: "video_mylist",
        action: "create",
        actor_uid: uid,
        actor_name: String(p.actorName || "ユーザー").trim() || "ユーザー",
        list_id: listId,
        target_label: name,
        target_href: `#profile?uid=${encodeURIComponent(uid)}&tab=videos&mylist=${encodeURIComponent(listId)}`,
      });
    },
    /** @param {{ listId: string; listName?: string; actorUid?: string; actorName?: string }} p */
    recordYtMylist(p) {
      const listId = String(p.listId || "").trim();
      const uid = String(p.actorUid || "").trim();
      if (!listId || !uid) return;
      const name = String(p.listName || "リスト").trim().slice(0, 80) || "リスト";
      void record({
        kind: "yt_mylist",
        action: "create",
        actor_uid: uid,
        actor_name: String(p.actorName || "ユーザー").trim() || "ユーザー",
        list_id: listId,
        target_label: name,
        target_href: `#profile?uid=${encodeURIComponent(uid)}&tab=yt&mylist=${encodeURIComponent(listId)}`,
      });
    },
    /** @param {{ logId: string; eventId?: string; eventName?: string; eventDate?: string; actorUid?: string; actorName?: string }} p */
    recordMllLog(p) {
      const logId = String(p.logId || "").trim();
      const eventId = String(p.eventId || "").trim();
      const eventDate = String(p.eventDate || "").trim().slice(0, 32);
      const title = String(p.eventName || "イベント").trim().slice(0, 200) || "イベント";
      const uid = String(p.actorUid || "").trim();
      if (!logId || !uid) return;
      const label = eventDate ? `${eventDate}の${title}` : title;
      void record({
        kind: "mll_log",
        action: "create",
        actor_uid: uid,
        actor_name: String(p.actorName || "").trim() || undefined,
        log_id: logId,
        event_id: eventId,
        event_date: eventDate,
        event_name: title,
        target_label: label.slice(0, 200),
        target_href: `#profile?uid=${encodeURIComponent(uid)}&tab=mll`,
      });
    },
    /** @param {{ query: string; targetHref?: string; force?: boolean }} p */
    recordVideoSearch(p) {
      const query = String(p.query || "").trim().slice(0, 200);
      if (!query || query === "現在の検索条件") return;
      const now = Date.now();
      if (lastVideoSearchAt > 0 && now - lastVideoSearchAt < VIDEO_SEARCH_MIN_GAP_MS) return;
      if (!p.force && query === lastVideoSearchQuery) return;
      lastVideoSearchQuery = query;
      const href = String(p.targetHref || "#videos").trim().slice(0, 512) || "#videos";
      void record({
        kind: "video_search",
        action: "create",
        search_query: query,
        target_label: query,
        target_href: href.startsWith("#") ? href : `#${href}`,
      }).then((ok) => {
        if (ok) lastVideoSearchAt = Date.now();
      });
    },
    /**
     * ツール利用の記録(メトロノーム/チューナー=開始時、Privacy/Switcher=カードから開いた時)。
     * ログイン不要ツールのためゲストも記録可。同一ツールはページ滞在中1回だけ(連打スパム防止)。
     * @param {{ toolId: "metronome"|"tuner"|"privacy"|"switcher"|"reangle"; toolName: string; targetHref?: string }} p
     * @returns {Promise<boolean>}
     */
    recordToolUse(p) {
      const toolId = String(p.toolId || "").trim();
      const toolName = String(p.toolName || "").trim().slice(0, 80);
      if (!TOOL_USE_IDS.includes(toolId) || !toolName) return Promise.resolve(false);
      if (recordedToolUses.has(toolId)) return Promise.resolve(false);
      recordedToolUses.add(toolId);
      const href = String(p.targetHref || "#top").trim().slice(0, 512) || "#top";
      return record({
        kind: "tool_use",
        action: "create",
        tool_id: toolId,
        target_label: toolName,
        target_href: href,
      });
    },
    /** @param {{ query: string; channel: string; channelLabel?: string; targetHref?: string }} p */
    recordSearchShare(p) {
      const query = String(p.query || "").trim().slice(0, 200);
      const channel = String(p.channel || "").trim();
      if (!query || query === "現在の検索条件" || !channel) return;
      const channelLabel =
        String(p.channelLabel || SHARE_CHANNEL_LABELS[channel] || channel).trim().slice(0, 80) ||
        channel;
      const href = String(p.targetHref || "#videos").trim().slice(0, 512) || "#videos";
      void record({
        kind: "search_share",
        action: "create",
        search_query: query,
        share_channel: channel.slice(0, 32),
        target_label: channelLabel,
        target_href: href.startsWith("#") ? href : `#${href}`,
      });
    },
  };

  /* ============ Switcher の置き手紙を拾う(2026-08-04 優さん指示) ============
     Switcher は firebase も認証も読み込まない(端末内だけで処理する作り)ので、
     ツールの中からは記録できない。代わりに localStorage へ
     { toolId, toolName, modeLabel, at } を置いてもらい、トップページへ戻った
     この瞬間に1件だけ記録する。
     ・modeLabel があれば「MarchinZ Switcher（縦型動画）」まで書く
     ・無ければ「MarchinZ Switcher」= 種類を選ばずに離れた人
     ・新しいFirestoreフィールドは足さない。rules の許可リスト(hasOnly)に無いキーは
       書き込みごと拒否されるため、種類は target_label の中に入れる
     ・古い置き手紙(24時間より前)は捨てる。拾ったら必ず消す(二重記録の防止) */
  const TOOL_USE_PENDING_KEY = "marchinz_tool_use_pending_v1";
  const TOOL_USE_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function flushPendingToolUse() {
    let raw = null;
    try { raw = localStorage.getItem(TOOL_USE_PENDING_KEY); } catch { return; }
    if (!raw) return;
    try { localStorage.removeItem(TOOL_USE_PENDING_KEY); } catch { /* ignore */ }
    let p = null;
    try { p = JSON.parse(raw); } catch { return; }
    if (!p || String(p.toolId || "") !== "switcher") return;
    const at = Date.parse(String(p.at || ""));
    if (Number.isFinite(at) && Date.now() - at > TOOL_USE_PENDING_MAX_AGE_MS) return;
    const mode = String(p.modeLabel || "").trim();
    const toolName = String(p.toolName || "MarchinZ Switcher").trim() || "MarchinZ Switcher";
    void window.MarchinZAdminUgcLog?.recordToolUse?.({
      toolId: "switcher",
      toolName: mode ? `${toolName}（${mode}）` : toolName,
      targetHref: "/tools/switcher/",
    });
  }

  /* 置き手紙は「戻ってきた時」に拾う。ログイン状態が定まってから記録したいので
     認証の確定(mll-auth-changed)も待つ ─ ゲストでも記録できる種別なので、
     どちらか早い方で1回だけ動けばよい(拾った時点でキーは消える) */
  flushPendingToolUse();
  window.addEventListener("mll-auth-changed", () => { flushPendingToolUse(); });

  // Privacy/ReAngle: TOP・クリエイターページのカード(a.mz-ctool-card)と
  // TOPの3入口ブロックのツールリンク(a[data-mz-tool-link])から開いた時に記録。
  // ツールページは別ページ(SPA外)のため、通常クリックは書き込み完了(最大500ms)を待ってから遷移する。
  // cmd/ctrl+クリック等の新規タブ系は元ページが残る=書き込みが完走するので素通し。
  document.addEventListener("click", (ev) => {
    const a = ev.target instanceof Element
      ? ev.target.closest("a.mz-ctool-card, a[data-mz-tool-link]")
      : null;
    if (!(a instanceof HTMLAnchorElement)) return;
    const href = a.getAttribute("href") || "";
    const toolId = href.includes("/tools/privacy/")
      ? "privacy"
      : href.includes("/tools/switcher/")
        ? "switcher"
        : href.includes("/tools/reangle/")
          ? "reangle"
          : "";
    if (!toolId) return;
    /* ★ Switcher はここで記録しない(2026-08-04 優さん指示「どの動画かまで分かるように」)。
       カードを押した時点では縦型/自動SW/ワイプのどれかがまだ決まっていない。
       Switcher 側が localStorage に置き手紙をして、戻ってきた時に
       flushPendingToolUse() が種類つきで1件だけ記録する ─ 2行に割れないよう
       入口をこちらに一本化する(選ばずに離れた人は「開いた」として残る) */
    if (toolId === "switcher") return;
    const toolName =
      toolId === "privacy" ? "MarchinZ Privacy"
        : toolId === "switcher" ? "MarchinZ Switcher"
          : "MarchinZ ReAngle";
    const isPlainLeftClick =
      ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey;
    if (!isPlainLeftClick || recordedToolUses.has(toolId)) {
      void window.MarchinZAdminUgcLog.recordToolUse({ toolId, toolName, targetHref: href });
      return;
    }
    ev.preventDefault();
    const go = () => { window.location.href = href; };
    Promise.race([
      window.MarchinZAdminUgcLog.recordToolUse({ toolId, toolName, targetHref: href }),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]).then(go, go);
  });
})();
