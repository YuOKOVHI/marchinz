/**
 * YouTube チャンネルマイリスト — 複数リスト・並べ替え・追加時にリスト選択
 */
(() => {
  const DEFAULT_LIST_ID = "default";
  const LS_LAST_LIST = "mz_yt_mylist_last_list_id";

  function isLegacyDefaultPickerList(id, name) {
    return String(id) === DEFAULT_LIST_ID && String(name || "").trim() === "マイリスト";
  }

  const hostEl = () => document.getElementById("mll-yt-channel-mylist-host");
  const msgEl = () => document.getElementById("mll-yt-mylist-msg");
  const pickerDlg = () => document.getElementById("mz-yt-mylist-picker");

  /** @type {Map<string, Set<string>>} */
  const listUrlKeys = new Map();

  /** @type {{ id: string; name: string; visibility: string; list_order: number }[]} */
  let cachedLists = [];

  function getUser() {
    return window.MLL_AUTH?.getUser?.() || null;
  }

  function getDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function normalizeVisibility(raw) {
    return String(raw || "").trim() === "private" ? "private" : "public";
  }

  /** @param {HTMLElement} parent @param {string} oshiText */
  function appendMllOshiDisplayRow(parent, oshiText) {
    const trimmed = String(oshiText || "").trim();
    const row = document.createElement("p");
    row.className = `mll-mylist-oshi-display${trimmed ? "" : " is-placeholder"}`;
    const label = document.createElement("span");
    label.className = "mll-mylist-oshi-label";
    label.textContent = "推しポイント！";
    row.appendChild(label);
    const body = document.createElement("span");
    body.className = "mll-mylist-oshi-text";
    body.textContent = trimmed || "はまだ記入されていません";
    row.appendChild(body);
    parent.appendChild(row);
    return { row, body };
  }

  /** @param {{ row: HTMLElement; body: HTMLElement }} display @param {string} oshiText */
  function setMllOshiDisplayRow(display, oshiText) {
    const trimmed = String(oshiText || "").trim();
    display.row.className = `mll-mylist-oshi-display${trimmed ? "" : " is-placeholder"}`;
    display.body.textContent = trimmed || "はまだ記入されていません";
  }

  function showBusyOverlay() {
    window.MarchinZProcessingOverlay?.show?.("処理中...");
  }

  function hideBusyOverlay() {
    window.MarchinZProcessingOverlay?.hide?.();
  }

  function refreshAfterListLike() {
    if (/^#profile(?:[?#]|$)/i.test(String(location.hash || ""))) {
      window.MarchinZUserProfile?.refresh?.();
      return;
    }
    renderMylist();
  }

  function alertErr(err, fallback) {
    window.alert(`code: ${(err?.code || "unknown").toString()}\nmessage: ${(err?.message || fallback || "処理に失敗しました。").toString()}`);
  }

  function normLbBookmarks(raw) {
    const o = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
    for (const [k, v] of Object.entries(raw)) {
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(k) && v === true) o[k] = true;
    }
    return o;
  }

  const listLikeInflight = new Set();

  async function toggleChannelListLike(ownerUid, listId) {
    const inflightKey = `cl:${ownerUid}:${listId}`;
    if (listLikeInflight.has(inflightKey)) return false;
    const db = getDb();
    const user = getUser();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return false;
    }
    if (!db || !ownerUid || !listId) return false;
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("like")) return false;
    listLikeInflight.add(inflightKey);
    /** @type {{ title: string } | null} */
    let likeNotify = null;
    try {
      const ref = db.collection("mll_profiles").doc(ownerUid).collection("channel_lists").doc(listId);
      await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) return;
        const data = snap.data() || {};
        const prev = normLbBookmarks(data.liked_by);
        const next = { ...prev };
        const wasOn = Boolean(next[user.id]);
        if (wasOn) delete next[user.id];
        else next[user.id] = true;
        txn.update(ref, { liked_by: next });
        if (!wasOn && ownerUid !== user.id) {
          const title = String(data.name || "").trim().slice(0, 200) || "マイリスト";
          likeNotify = { title };
        }
      });
    } catch (e) {
      console.warn(e);
      setMsg(String(e?.message || "いいねの更新に失敗しました。"), true);
      listLikeInflight.delete(inflightKey);
      return false;
    }
    if (likeNotify) {
      const nm = String(window.MarchinZActorDisplayName?.(user) || "ユーザー").trim().slice(0, 120) || "ユーザー";
      window.MarchinZPushLikeNotification?.(db, ownerUid, {
        kind: "like_channel_list",
        actor_uid: user.id,
        actor_name: nm,
        target_type: "channel_list",
        target_id: String(listId),
        target_title: likeNotify.title,
        target_href: `#profile?uid=${encodeURIComponent(ownerUid)}&tab=yt&mylist=${encodeURIComponent(String(listId))}`,
        thread_root_id: String(listId).slice(0, 128),
      });
    }
    listLikeInflight.delete(inflightKey);
  }

  function appendChannelListLike(hostEl, ownerUid, listId, likedByMap) {
    if (!hostEl || !listId) return;
    const me = getUser();
    const lb = normLbBookmarks(likedByMap);
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    window.MarchinZEngageUi?.buildLikeRow(hostEl, {
      liked,
      count: cnt,
      onClick: () => toggleChannelListLike(ownerUid, listId),
      showLoginHint: !me?.id,
      stopPropagation: true,
    });
  }

  function normalizeChannelUrl(u) {
    const s = String(u ?? "").trim();
    if (!s) return "";
    try {
      const x = new URL(s);
      x.hash = "";
      const keys = [...x.searchParams.keys()].sort();
      const next = new URL(x.origin + x.pathname);
      for (const k of keys) {
        for (const v of x.searchParams.getAll(k)) {
          next.searchParams.append(k, v);
        }
      }
      return next.toString();
    } catch {
      return s;
    }
  }

  function urlKey(u) {
    return normalizeChannelUrl(u);
  }

  function bookmarkDocId(normUrl) {
    let h = 2166136261;
    const str = normUrl;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `c${(h >>> 0).toString(36)}`;
  }

  function sanitizeListId(id) {
    return String(id || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 64) || "list";
  }

  /**
   * @param {string} listId
   * @param {string} normUrl
   */
  function channelBookmarkDocumentId(listId, normUrl) {
    const base = bookmarkDocId(normUrl);
    if (listId === DEFAULT_LIST_ID) return base;
    return `${sanitizeListId(listId)}_${base}`;
  }

  /** @param {string} docId @param {Record<string, unknown>} data */
  function inferChannelListIdFromDoc(docId, data) {
    const fromData = String(data?.list_id || "").trim();
    if (fromData) return fromData;
    const id = String(docId);
    const idx = id.lastIndexOf("_c");
    if (idx > 0) {
      const rest = id.slice(idx + 1);
      if (/^c[a-z0-9]+$/.test(rest)) return id.slice(0, idx);
    }
    return DEFAULT_LIST_ID;
  }

  function setMsg(text, isErr) {
    const m = msgEl();
    if (!m) return;
    if (!text) {
      m.hidden = true;
      m.textContent = "";
      return;
    }
    m.hidden = false;
    m.textContent = text;
    m.style.color = isErr ? "#b71c1c" : "";
  }

  function lastUsedListId() {
    const fromLs = (() => {
      try {
        return String(localStorage.getItem(LS_LAST_LIST) || "").trim();
      } catch {
        return "";
      }
    })();
    if (fromLs && cachedLists.some((x) => x.id === fromLs)) return fromLs;
    return cachedLists[0]?.id || "";
  }

  function setLastUsedListId(id) {
    try {
      const v = String(id || "").trim();
      if (v) localStorage.setItem(LS_LAST_LIST, v);
    } catch {
      //
    }
  }

  async function getMaxChannelListOrder(user, db) {
    const snap = await db.collection("mll_profiles").doc(user.id).collection("channel_lists").limit(200).get();
    let m = 0;
    snap.forEach((doc) => {
      const v = Number(doc.data()?.list_order);
      if (Number.isFinite(v)) m = Math.max(m, v);
    });
    return m;
  }

  /**
   * 新規は自動で「default」リストを作らない。保存前にリスト実在のみ確認する。
   * @param {object} user
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} listId
   * @returns {Promise<boolean>}
   */
  async function assertChannelListExists(user, db, listId) {
    const lid = String(listId || "").trim();
    if (!lid) {
      setMsg("保存先のリストを選んでください。", true);
      return false;
    }
    const snap = await db.collection("mll_profiles").doc(user.id).collection("channel_lists").doc(lid).get();
    if (!snap.exists) {
      setMsg("保存先のリストが見つかりません。リストを選び直してください。", true);
      return false;
    }
    return true;
  }

  /** @returns {Promise<{ id: string; name: string; oshi_text: string; visibility: string; list_order: number }[]>} */
  async function loadChannelListMetas(user, db) {
    const snap = await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("channel_lists")
      .orderBy("created_at", "asc")
      .limit(80)
      .get();
    const out = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const lo = Number(d.list_order);
      out.push({
        id: doc.id,
        name: String(d.name || doc.id).trim() || doc.id,
        oshi_text: String(d.oshi_text || "").trim(),
        visibility: String(d.visibility || "public").trim() === "private" ? "private" : "public",
        list_order: Number.isFinite(lo) ? lo : doc.id === DEFAULT_LIST_ID ? 0 : 500000,
        liked_by: normLbBookmarks(d.liked_by),
      });
    });
    out.sort((a, b) => {
      if (a.list_order !== b.list_order) return a.list_order - b.list_order;
      return String(a.name).localeCompare(String(b.name), "ja");
    });
    return out.filter((l) => !isLegacyDefaultPickerList(l.id, l.name));
  }

  async function refreshCache() {
    listUrlKeys.clear();
    cachedLists = [];
    const db = getDb();
    const user = getUser();
    if (!db || !user?.id) {
      window.dispatchEvent(new CustomEvent("marchinz-channel-mylist-updated"));
      renderMylist();
      return;
    }
    try {
      cachedLists = await loadChannelListMetas(user, db);
      const snap = await db
        .collection("mll_profiles")
        .doc(user.id)
        .collection("channel_bookmarks")
        .orderBy("added_at", "desc")
        .limit(400)
        .get();
      snap.forEach((doc) => {
        const d = doc.data() || {};
        const u = String(d.channel_url || "").trim();
        const k = urlKey(u);
        const lid = inferChannelListIdFromDoc(doc.id, d);
        if (!listUrlKeys.has(lid)) listUrlKeys.set(lid, new Set());
        if (k) listUrlKeys.get(lid).add(k);
      });
    } catch (e) {
      console.warn("[youtube-channel-mylist]", e);
    }
    window.dispatchEvent(new CustomEvent("marchinz-channel-mylist-updated"));
    renderMylist();
  }

  function hasChannelInList(rawUrl, listId) {
    const k = urlKey(rawUrl);
    const lid = String(listId || DEFAULT_LIST_ID);
    return Boolean(k && listUrlKeys.get(lid)?.has(k));
  }

  function hasChannelAnywhere(rawUrl) {
    const k = urlKey(rawUrl);
    if (!k) return false;
    for (const s of listUrlKeys.values()) {
      if (s.has(k)) return true;
    }
    return false;
  }

  function trackMetric(name, payload = {}) {
    if (typeof window.MarchinZTrackEvent === "function") {
      window.MarchinZTrackEvent(name, payload);
    }
  }

  /**
   * @param {{ url?: string; name?: string; logo?: string; category?: string }} item
   * @param {string} listId
   */
  async function addChannelToList(item, listId) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) {
      setMsg("マイリストに追加するにはログインしてください。", true);
      return false;
    }
    if (window.MLL_AUTH?.isWithdrawn?.()) {
      setMsg("退会済みのアカウントでは保存できません。", true);
      return false;
    }
    const channel_url = normalizeChannelUrl(item?.url);
    if (!channel_url || !/^https?:\/\//i.test(channel_url)) {
      setMsg("チャンネル URL が無効です。", true);
      return false;
    }
    const lid = String(listId || "").trim();
    if (!(await assertChannelListExists(user, db, lid))) return false;
    if (hasChannelInList(channel_url, lid)) {
      setMsg("このリストにはすでに追加済みです。");
      window.setTimeout(() => setMsg(""), 2400);
      return true;
    }
    const channel_name = String(item?.name ?? "").trim().slice(0, 280) || "チャンネル";
    const channel_logo = String(item?.logo ?? "").trim().slice(0, 2048);
    const category = String(item?.category ?? "").trim().slice(0, 80) || "一般";
    const docId = channelBookmarkDocumentId(lid, channel_url);
    const payload = {
      list_id: lid,
      channel_url,
      channel_name,
      channel_logo,
      category,
      added_at: new Date().toISOString().slice(0, 40),
      sort_index: Math.min(2147483647, Math.floor(Date.now() / 1000)),
    };
    const ref = db.collection("mll_profiles").doc(user.id).collection("channel_bookmarks").doc(docId);
    try {
      const prev = await ref.get();
      if (prev.exists) {
        if (!listUrlKeys.has(lid)) listUrlKeys.set(lid, new Set());
        listUrlKeys.get(lid).add(urlKey(channel_url));
        setMsg("このリストにはすでに追加済みです。");
        window.setTimeout(() => setMsg(""), 2400);
        return true;
      }
      await ref.set(payload);
      if (!listUrlKeys.has(lid)) listUrlKeys.set(lid, new Set());
      listUrlKeys.get(lid).add(urlKey(channel_url));
      setLastUsedListId(lid);
      setMsg("マイリストに追加しました。");
      trackMetric("mylist_add", { target: "youtube_channel", list_id: lid });
      window.setTimeout(() => setMsg(""), 2400);
      renderMylist();
      window.dispatchEvent(new CustomEvent("marchinz-channel-mylist-updated"));
      return true;
    } catch (e) {
      console.warn(e);
      const code = String(e?.code || "");
      if (code === "permission-denied") {
        setMsg(
          "保存の権限がありません。Firebase の Firestore ルール（firebase/firestore.rules）を本番にデプロイし、再読み込みしてください。",
          true,
        );
      } else {
        setMsg(String(e?.message || "保存に失敗しました。"), true);
      }
      return false;
    }
  }

  async function createChannelList(name, visibility, oshiText = "") {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) return null;
    const id = `L_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const sid = sanitizeListId(id);
    const now = new Date().toISOString();
    const maxO = await getMaxChannelListOrder(user, db);
    showBusyOverlay();
    try {
      await db
        .collection("mll_profiles")
        .doc(user.id)
        .collection("channel_lists")
        .doc(sid)
        .set({
          name: String(name || "リスト").trim().slice(0, 120) || "リスト",
          oshi_text: String(oshiText || "").trim().slice(0, 240),
          visibility: normalizeVisibility(visibility),
          list_order: Number(maxO + 100),
          liked_by: {},
          created_at: now,
          updated_at: now,
        });
      const listName = String(name || "リスト").trim().slice(0, 120) || "リスト";
      window.MarchinZAdminUgcLog?.recordYtMylist?.({
        listId: sid,
        listName,
        actorUid: user.id,
        actorName: window.MarchinZActorDisplayName?.(user) || "ユーザー",
      });
      return sid;
    } catch (e) {
      alertErr(e, "リストの作成に失敗しました。");
      return null;
    } finally {
      hideBusyOverlay();
    }
  }

  async function renameChannelList(listId, rawName) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) return;
    const nm = String(rawName || "").trim().slice(0, 120);
    if (!nm) {
      setMsg("リスト名を入力してください。", true);
      return;
    }
    const now = new Date().toISOString();
    showBusyOverlay();
    try {
      await db.collection("mll_profiles").doc(user.id).collection("channel_lists").doc(listId).set(
        {
          name: nm,
          updated_at: now,
        },
        { merge: true },
      );
      await refreshCache();
    } catch (e) {
      alertErr(e, "リスト名の更新に失敗しました。");
      return;
    } finally {
      hideBusyOverlay();
    }
  }

  async function updateChannelListOshiText(listId, rawText) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !listId) return;
    const txt = String(rawText || "").trim().slice(0, 240);
    await db.collection("mll_profiles").doc(user.id).collection("channel_lists").doc(listId).set(
      {
        oshi_text: txt,
        updated_at: new Date().toISOString(),
      },
      { merge: true },
    );
    await refreshCache();
  }

  async function updateChannelListVisibility(listId, visibility) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) return;
    const now = new Date().toISOString();
    showBusyOverlay();
    try {
      await db
        .collection("mll_profiles")
        .doc(user.id)
        .collection("channel_lists")
        .doc(listId)
        .set({ visibility: normalizeVisibility(visibility), updated_at: now }, { merge: true });
      await refreshCache();
    } catch (e) {
      alertErr(e, "公開設定の更新に失敗しました。");
      return;
    } finally {
      hideBusyOverlay();
    }
  }

  /** ログイン中ユーザーの YouTube マイリスト（全リスト・全ブックマーク）を削除 */
  async function deleteAllChannelListsCascade() {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) throw new Error("ログインが必要です。");
    if (
      !window.confirm(
        "YouTube マイリストをすべて削除しますか？\n登録したリストとチャンネルがすべて消えます。取り消せません。",
      )
    ) {
      return;
    }
    showBusyOverlay();
    try {
      const profRef = db.collection("mll_profiles").doc(user.id);
      while (true) {
        const qs = await profRef.collection("channel_bookmarks").limit(400).get();
        if (qs.empty) break;
        const batch = db.batch();
        qs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      while (true) {
        const qs = await profRef.collection("channel_lists").limit(400).get();
        if (qs.empty) break;
        const batch = db.batch();
        qs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      await refreshCache();
      window.dispatchEvent(new CustomEvent("marchinz-channel-mylist-updated"));
    } catch (e) {
      alertErr(e, "YouTube マイリストの一括削除に失敗しました。");
      throw e;
    } finally {
      hideBusyOverlay();
    }
  }

  /**
   * 既定リスト以外を削除。当該リストのチャンネルブックマークはすべて削除します。
   * @param {string} listId
   */
  async function deleteChannelListCascade(listId) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) throw new Error("ログインが必要です。");
    const lid = String(listId || "").trim();
    if (!lid) throw new Error("リストを指定できません。");
    showBusyOverlay();
    try {
      while (true) {
        const qs = await db
          .collection("mll_profiles")
          .doc(user.id)
          .collection("channel_bookmarks")
          .where("list_id", "==", lid)
          .limit(400)
          .get();
        if (qs.empty) break;
        const batch = db.batch();
        qs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      const legacy = await db
        .collection("mll_profiles")
        .doc(user.id)
        .collection("channel_bookmarks")
        .limit(500)
        .get();
      const batch2 = db.batch();
      let n2 = 0;
      legacy.forEach((doc) => {
        const d = doc.data() || {};
        if (inferChannelListIdFromDoc(doc.id, d) === lid) {
          batch2.delete(doc.ref);
          n2 += 1;
        }
      });
      if (n2) await batch2.commit();
      await db.collection("mll_profiles").doc(user.id).collection("channel_lists").doc(lid).delete();
      await refreshCache();
      window.dispatchEvent(new CustomEvent("marchinz-channel-mylist-updated"));
    } catch (e) {
      alertErr(e, "リストの削除に失敗しました。");
      throw e;
    } finally {
      hideBusyOverlay();
    }
  }

  /**
   * @param {string} listId
   * @param {number} dir
   */
  async function moveChannelListOrder(listId, dir) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !listId) return;
    const lists = await loadChannelListMetas(user, db);
    const idx = lists.findIndex((x) => x.id === listId);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= lists.length) return;
    const a = lists[idx];
    const b = lists[j];
    const now = new Date().toISOString();
    const refA = db.collection("mll_profiles").doc(user.id).collection("channel_lists").doc(a.id);
    const refB = db.collection("mll_profiles").doc(user.id).collection("channel_lists").doc(b.id);
    const batch = db.batch();
    batch.set(refA, { list_order: Number(b.list_order), updated_at: now }, { merge: true });
    batch.set(refB, { list_order: Number(a.list_order), updated_at: now }, { merge: true });
    await batch.commit();
    await refreshCache();
  }

  /**
   * @param {string} docId
   * @param {string} listId
   * @param {number} dir
   */
  async function moveChannelBookmarkOrder(docId, listId, dir) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !docId) return;
    const snap = await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("channel_bookmarks")
      .orderBy("added_at", "desc")
      .limit(400)
      .get();
    /** @type {{ id: string; sort: number; added: string }[]} */
    const rows = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const lid = inferChannelListIdFromDoc(doc.id, d);
      if (lid !== listId) return;
      const si = Number(d.sort_index);
      rows.push({
        id: doc.id,
        sort: Number.isFinite(si) ? si : 0,
        added: String(d.added_at || ""),
      });
    });
    rows.sort((x, y) => (x.sort !== y.sort ? x.sort - y.sort : String(x.added).localeCompare(String(y.added))));
    const idx = rows.findIndex((r) => r.id === docId);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const A = rows[idx];
    const B = rows[j];
    const refA = db.collection("mll_profiles").doc(user.id).collection("channel_bookmarks").doc(A.id);
    const refB = db.collection("mll_profiles").doc(user.id).collection("channel_bookmarks").doc(B.id);
    const tmp = Math.floor(Date.now() / 1000) % 2000000000;
    await refA.update({ sort_index: tmp });
    await refB.update({ sort_index: A.sort });
    await refA.update({ sort_index: B.sort });
    await refreshCache();
  }

  async function removeByDocId(docId) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !docId) return;
    try {
      const ref = db.collection("mll_profiles").doc(user.id).collection("channel_bookmarks").doc(docId);
      const snap = await ref.get();
      const d = snap.data() || {};
      const u = String(d.channel_url || "").trim();
      const lid = inferChannelListIdFromDoc(docId, d);
      await ref.delete();
      trackMetric("mylist_remove", { target: "youtube_channel", list_id: lid || "" });
      const k = urlKey(u);
      if (k && listUrlKeys.has(lid)) listUrlKeys.get(lid).delete(k);
      renderMylist();
      window.dispatchEvent(new CustomEvent("marchinz-channel-mylist-updated"));
    } catch (e) {
      console.warn(e);
      setMsg(String(e?.message || "削除に失敗しました。"), true);
    }
  }

  /** @type {{ resolve: (v: string|null) => void } | null} */
  let pickerResolver = null;

  function wirePickerOnce() {
    const dlg = pickerDlg();
    if (!dlg || dlg.dataset.mzYtPickerWired === "1") return;
    dlg.dataset.mzYtPickerWired = "1";
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg) closePicker(null);
    });
    dlg.querySelector("[data-mz-yt-picker-cancel]")?.addEventListener("click", () => closePicker(null));
    dlg.querySelector("[data-mz-yt-picker-confirm]")?.addEventListener("click", () => void confirmPicker());
  }

  function closePicker(resultListId) {
    const dlg = pickerDlg();
    if (dlg instanceof HTMLDialogElement) {
      try {
        dlg.close();
      } catch {
        //
      }
    }
    if (pickerResolver) {
      pickerResolver(resultListId);
      pickerResolver = null;
    }
  }

  async function confirmPicker() {
    const dlg = pickerDlg();
    if (!dlg) return;
    const chosen = dlg.querySelector('input[name="mz-yt-picker-list"]:checked');
    const rid = chosen instanceof HTMLInputElement ? String(chosen.value || "").trim() : "";
    const newName = /** @type {HTMLInputElement|null} */ (dlg.querySelector("[data-mz-yt-new-list-name]"));
    const newOshi = /** @type {HTMLTextAreaElement|null} */ (dlg.querySelector("[data-mz-yt-new-list-oshi]"));
    if (rid === "__new__") {
      const nm = (newName?.value || "").trim() || "リスト";
      const oshi = (newOshi?.value || "").trim();
      const nid = await createChannelList(nm, "public", oshi);
      if (!nid) {
        setMsg("リストの作成に失敗しました。", true);
        return;
      }
      closePicker(nid);
      return;
    }
    if (!rid) return;
    closePicker(rid);
  }

  /**
   * @param {{ url?: string; name?: string; logo?: string; category?: string }} item
   * @returns {Promise<string|null>}
   */
  async function openPicker(item) {
    wirePickerOnce();
    const dlg = pickerDlg();
    if (!(dlg instanceof HTMLDialogElement)) return Promise.resolve(lastUsedListId());

    const titleEl = dlg.querySelector("[data-mz-yt-picker-title]");
    if (titleEl) {
      titleEl.textContent = "保存先のリスト";
    }

    const body = dlg.querySelector("[data-mz-yt-picker-lists]");
    const newBlock = dlg.querySelector("[data-mz-yt-picker-new]");
    if (body) {
      body.innerHTML = "";
      const lists = cachedLists.slice();
      const last = lastUsedListId();
      const hasLast = lists.some((x) => x.id === last);
      for (const L of lists) {
        const lab = document.createElement("label");
        lab.className = "mz-picker-list-option";
        const inp = document.createElement("input");
        inp.type = "radio";
        inp.name = "mz-yt-picker-list";
        inp.value = L.id;
        if (hasLast ? L.id === last : lists[0]?.id === L.id) {
          inp.checked = true;
        }
        const span = document.createElement("span");
        span.textContent = L.name;
        lab.appendChild(inp);
        lab.appendChild(span);
        body.appendChild(lab);
      }
      const newLab = document.createElement("label");
      newLab.className = "mz-picker-list-option";
      const newInp = document.createElement("input");
      newInp.type = "radio";
      newInp.name = "mz-yt-picker-list";
      newInp.value = "__new__";
      if (!lists.length) newInp.checked = true;
      newLab.appendChild(newInp);
      newLab.appendChild(document.createTextNode("新しいリストを作成…"));
      body.appendChild(newLab);
      newInp.addEventListener("change", () => {
        if (newBlock) newBlock.hidden = !newInp.checked;
      });
      body.querySelectorAll('input[name="mz-yt-picker-list"]').forEach((r) => {
        r.addEventListener("change", () => {
          if (r instanceof HTMLInputElement && r.value !== "__new__" && newBlock) newBlock.hidden = true;
        });
      });
    }
    if (newBlock) {
      const checked = dlg.querySelector('input[name="mz-yt-picker-list"]:checked');
      const isNew = checked instanceof HTMLInputElement && checked.value === "__new__";
      newBlock.hidden = !isNew;
      const ni = dlg.querySelector("[data-mz-yt-new-list-name]");
      if (ni instanceof HTMLInputElement) ni.value = "";
      const oi = dlg.querySelector("[data-mz-yt-new-list-oshi]");
      if (oi instanceof HTMLTextAreaElement) oi.value = "";
    }

    return new Promise((resolve) => {
      pickerResolver = resolve;
      try {
        dlg.showModal();
      } catch {
        resolve(lastUsedListId());
      }
    });
  }

  /**
   * @param {{ url?: string; name?: string; logo?: string; category?: string }} item
   * @returns {Promise<{ ok: boolean; message?: string }>}
   */
  async function addWithPicker(item) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) {
      window.MarchinZNavigateAuthEntry?.("signup", "youtube_channel_mylist");
      return { ok: false, message: "ログインが必要です。" };
    }
    if (window.MLL_AUTH?.isWithdrawn?.()) {
      return { ok: false, message: "退会済みのアカウントでは保存できません。" };
    }
    cachedLists = await loadChannelListMetas(user, db);
    const listId = await openPicker(item);
    if (!listId) return { ok: false, message: "" };
    const ok = await addChannelToList(item, listId);
    if (!ok) return { ok: false, message: "保存に失敗しました。" };
    return { ok: true, message: "マイリストに追加しました。" };
  }

  /**
   * @param {{ url?: string; name?: string; logo?: string; category?: string }} item
   * @returns {Promise<{ ok: boolean; message?: string }>}
   */
  async function add(item) {
    return addWithPicker(item);
  }

  function renderMylist() {
    const host = hostEl();
    if (!host) return;
    const db = getDb();
    const user = getUser();
    host.innerHTML = "";
    if (!user?.id || !db) {
      const p = document.createElement("p");
      p.className = "mll-mylist-empty";
      p.textContent = "ログイン後、保存したチャンネルがここに表示されます。";
      host.appendChild(p);
      return;
    }

    loadChannelListMetas(user, db)
      .then((lists) => {
        cachedLists = lists;
        return db
          .collection("mll_profiles")
          .doc(user.id)
          .collection("channel_bookmarks")
          .orderBy("added_at", "desc")
          .limit(400)
          .get();
      })
      .then(async (snap) => {
        if (!hostEl()) return;
        const grouped = new Map();
        for (const L of cachedLists) {
          grouped.set(L.id, { meta: { ...L, list_order: Number(L.list_order) || 0 }, items: [] });
        }
        snap.forEach((doc) => {
          const d = doc.data() || {};
          const lid = inferChannelListIdFromDoc(doc.id, d);
          if (!grouped.has(lid)) {
            grouped.set(lid, {
              meta: {
                id: lid,
                name: lid,
                oshi_text: "",
                visibility: "public",
                list_order: lid === DEFAULT_LIST_ID ? 0 : 500000,
                liked_by: {},
              },
              items: [],
            });
          }
          const url = String(d.channel_url || "").trim();
          const title = String(d.channel_name || "").trim() || url || "チャンネル";
          const si = Number(d.sort_index);
          grouped.get(lid).items.push({
            docId: doc.id,
            title,
            url,
            logo: String(d.channel_logo || "").trim(),
            category: String(d.category || "").trim(),
            sort: Number.isFinite(si) ? si : 0,
            added: String(d.added_at || ""),
          });
        });

        for (const g of grouped.values()) {
          g.items.sort((a, b) => (a.sort !== b.sort ? a.sort - b.sort : String(a.added).localeCompare(String(b.added))));
        }

        const frag = document.createDocumentFragment();
        const sortedLists = [...grouped.values()].sort((a, b) => {
          const ao = Number(a.meta.list_order);
          const bo = Number(b.meta.list_order);
          const ad = Number.isFinite(ao) ? ao : a.meta.id === DEFAULT_LIST_ID ? 0 : 999999;
          const bd = Number.isFinite(bo) ? bo : b.meta.id === DEFAULT_LIST_ID ? 0 : 999999;
          if (ad !== bd) return ad - bd;
          return String(a.meta.name).localeCompare(String(b.meta.name), "ja");
        });

        if (!snap.size) {
          const p = document.createElement("p");
          p.className = "mll-mylist-empty";
          p.textContent = "まだありません。上の一覧から「マイリストに追加」で追加できます。";
          host.appendChild(p);
          return;
        }

        for (const block of sortedLists) {
          if (!block.items.length) continue;
          const sec = document.createElement("section");
          sec.className = "mll-mylist-list-block";
          sec.dataset.listId = block.meta.id;

          const head = document.createElement("header");
          head.className = "mll-mylist-list-head";
          const h4 = document.createElement("h4");
          h4.className = "mll-mylist-list-name mll-mylist-list-name--editable";
          h4.textContent = block.meta.name;
          h4.title = "クリックしてリスト設定を編集";

          const editPanel = document.createElement("div");
          editPanel.className = "mll-mylist-edit-panel";
          editPanel.hidden = true;
          const editNameInput = document.createElement("input");
          editNameInput.type = "text";
          editNameInput.className = "mll-mylist-edit-name";
          editNameInput.value = block.meta.name;
          editNameInput.placeholder = "リスト名";
          const editVisRow = document.createElement("div");
          editVisRow.className = "mll-mylist-edit-vis-row";
          const pub = block.meta.visibility !== "private";
          const visTag = document.createElement("button");
          visTag.type = "button";
          visTag.className = `mll-mylist-vis-tag mll-mylist-vis-tag--clickable ${pub ? "mll-mylist-vis-tag--public" : "mll-mylist-vis-tag--private"}`;
          visTag.textContent = pub ? "公開中" : "非公開";
          visTag.title = "クリックで公開設定を切り替え";
          let pendingVis = block.meta.visibility !== "private" ? "public" : "private";
          visTag.addEventListener("click", () => {
            const next = pendingVis === "public" ? "private" : "public";
            const label = next === "public" ? "公開中" : "非公開";
            if (!confirm(`「${label}」に変更しますか？`)) return;
            pendingVis = next;
            visTag.textContent = next === "public" ? "公開中" : "非公開";
            visTag.className = `mll-mylist-vis-tag mll-mylist-vis-tag--clickable ${next === "public" ? "mll-mylist-vis-tag--public" : "mll-mylist-vis-tag--private"}`;
          });
          editVisRow.appendChild(visTag);
          const editSave = document.createElement("button");
          editSave.type = "button";
          editSave.className = "btn-marchinz btn-marchinz--sm mll-mylist-edit-save";
          editSave.textContent = "保存";
          const editCancel = document.createElement("button");
          editCancel.type = "button";
          editCancel.className = "btn-reset-search mll-mylist-edit-cancel";
          editCancel.textContent = "キャンセル";
          const editBtns = document.createElement("div");
          editBtns.className = "mll-mylist-edit-btns";
          editBtns.appendChild(editSave);
          editBtns.appendChild(editCancel);
          const editOshiInput = document.createElement("textarea");
          editOshiInput.className = "mll-mylist-oshi-input";
          editOshiInput.rows = 3;
          editOshiInput.maxLength = 240;
          editOshiInput.placeholder = "推しポイント！を入力";
          editPanel.appendChild(editNameInput);
          editPanel.appendChild(editOshiInput);
          editPanel.appendChild(editVisRow);
          editPanel.appendChild(editBtns);

          const openEditPanel = () => {
            editPanel.hidden = false;
            editNameInput.value = h4.textContent;
            editOshiInput.value = String(block.meta.oshi_text || "");
            editNameInput.focus();
          };
          const closeEditPanel = () => { editPanel.hidden = true; };
          h4.addEventListener("click", openEditPanel);
          editCancel.addEventListener("click", closeEditPanel);
          editSave.addEventListener("click", () => {
            void (async () => {
              const newName = editNameInput.value.trim();
              const newOshi = String(editOshiInput.value || "").trim().slice(0, 240);
              const origVis = block.meta.visibility !== "private" ? "public" : "private";
              const origOshi = String(block.meta.oshi_text || "").trim();
              try {
                if (newName && newName !== block.meta.name) await renameChannelList(block.meta.id, newName);
                if (newOshi !== origOshi) {
                  await updateChannelListOshiText(block.meta.id, newOshi);
                  block.meta.oshi_text = newOshi;
                  setMllOshiDisplayRow(oshiDisplay, newOshi);
                }
                if (pendingVis !== origVis) {
                  await updateChannelListVisibility(block.meta.id, pendingVis);
                  if (pendingVis === "public") {
                    setMsg("リストを公開にしました。", false);
                    window.setTimeout(() => setMsg(""), 6000);
                  }
                }
              } catch (e) {
                setMsg(String(e?.message || "更新に失敗しました。"), true);
              }
              closeEditPanel();
            })();
          });

          let oshiDisplay;
          const right = document.createElement("div");
          right.className = "mll-mylist-list-head-right";
          const listTools = document.createElement("div");
          listTools.className = "mll-mylist-list-tools";
          const dragHandle = document.createElement("span");
          dragHandle.className = "mll-mylist-drag-handle";
          dragHandle.textContent = "☰";
          dragHandle.title = "ドラッグして並び替え";
          dragHandle.setAttribute("aria-label", "ドラッグして並び替え");
          listTools.appendChild(dragHandle);
          const upList = document.createElement("button");
          upList.type = "button";
          upList.className = "btn-reset-search mll-mylist-list-tool-btn";
          upList.textContent = "↑";
          upList.title = "リストの表示順を上へ";
          upList.addEventListener("click", () => void moveChannelListOrder(block.meta.id, -1));
          const downList = document.createElement("button");
          downList.type = "button";
          downList.className = "btn-reset-search mll-mylist-list-tool-btn";
          downList.textContent = "↓";
          downList.title = "リストの表示順を下へ";
          downList.addEventListener("click", () => void moveChannelListOrder(block.meta.id, 1));
          listTools.appendChild(upList);
          listTools.appendChild(downList);
          right.appendChild(listTools);

          sec.setAttribute("draggable", "true");
          sec.addEventListener("dragstart", (e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", block.meta.id);
            sec.classList.add("mll-mylist-dragging");
          });
          sec.addEventListener("dragend", () => sec.classList.remove("mll-mylist-dragging"));
          sec.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; sec.classList.add("mll-mylist-dragover"); });
          sec.addEventListener("dragleave", () => sec.classList.remove("mll-mylist-dragover"));
          sec.addEventListener("drop", (e) => {
            e.preventDefault();
            sec.classList.remove("mll-mylist-dragover");
            const fromId = e.dataTransfer.getData("text/plain");
            if (!fromId || fromId === block.meta.id) return;
            const fromIdx = cachedLists.findIndex((x) => x.id === fromId);
            const toIdx = cachedLists.findIndex((x) => x.id === block.meta.id);
            if (fromIdx < 0 || toIdx < 0) return;
            const dir = toIdx > fromIdx ? 1 : -1;
            let steps = Math.abs(toIdx - fromIdx);
            (async () => {
              for (let s = 0; s < steps; s++) await moveChannelListOrder(fromId, dir);
            })();
          });

          {
            let touchTimer = null;
            let touchActive = false;
            let touchStartY = 0;
            let lastSwapY = 0;
            const HOLD_MS = 400;
            const SWAP_THRESHOLD = 50;
            dragHandle.addEventListener("touchstart", (e) => {
              if (e.touches.length !== 1) return;
              touchStartY = e.touches[0].clientY;
              lastSwapY = touchStartY;
              touchTimer = setTimeout(() => {
                touchActive = true;
                sec.classList.add("mll-mylist-dragging");
                if (navigator.vibrate) navigator.vibrate(30);
              }, HOLD_MS);
            }, { passive: true });
            dragHandle.addEventListener("touchmove", (e) => {
              if (!touchActive) { clearTimeout(touchTimer); return; }
              e.preventDefault();
              const y = e.touches[0].clientY;
              const delta = y - lastSwapY;
              if (Math.abs(delta) >= SWAP_THRESHOLD) {
                const dir = delta > 0 ? 1 : -1;
                lastSwapY = y;
                void moveChannelListOrder(block.meta.id, dir);
              }
            }, { passive: false });
            const endTouch = () => {
              clearTimeout(touchTimer);
              if (touchActive) sec.classList.remove("mll-mylist-dragging");
              touchActive = false;
            };
            dragHandle.addEventListener("touchend", endTouch);
            dragHandle.addEventListener("touchcancel", endTouch);
          }

          const shareBtn = document.createElement("button");
          shareBtn.type = "button";
          shareBtn.className = "btn-share-search btn-marchinz-spotlight";
          shareBtn.textContent = "シェアする";
          shareBtn.setAttribute("aria-label", `YouTubeマイリスト「${block.meta.name}」をシェア`);
          right.appendChild(shareBtn);
          const uid = String(user.id || "").trim();
          const sm = window.MarchinZShareMenu;
          if (uid && sm?.buildAbsoluteUrlForHash && sm.mylistShareText && sm.setupSearchLikeShareMenuForButton) {
            const profHash = `#profile?uid=${encodeURIComponent(uid)}&tab=yt&mylist=${encodeURIComponent(block.meta.id)}`;
            const shareUrl = sm.buildAbsoluteUrlForHash(profHash);
            const shareText = sm.mylistShareText(block.meta.name, shareUrl, "yt");
            sm.setupSearchLikeShareMenuForButton(shareBtn, shareText, shareUrl);
          }
          const likeHost = document.createElement("div");
          likeHost.className = "mll-mylist-list-like-host mz-inline-like-host";
          appendChannelListLike(likeHost, user.id, block.meta.id, block.meta.liked_by);

          const topRow = document.createElement("div");
          topRow.className = "mll-mylist-top-row";
          const titleBlock = document.createElement("div");
          titleBlock.className = "mll-mylist-title-block";
          titleBlock.appendChild(h4);
          window.MarchinZEngageUi?.appendInlineLike(titleBlock, likeHost);
          topRow.appendChild(titleBlock);
          topRow.appendChild(right);
          head.appendChild(topRow);
          head.appendChild(editPanel);
          oshiDisplay = appendMllOshiDisplayRow(head, block.meta.oshi_text);

          const ul = document.createElement("ul");
          ul.className = "mll-mylist-video-list mll-mylist-channel-grid";
          for (const it of block.items) {
            const li = document.createElement("li");
            li.className = "mll-mylist-channel-card";

            if (it.logo) {
              const logoWrap = document.createElement("a");
              logoWrap.href = it.url || "#";
              logoWrap.target = "_blank";
              logoWrap.rel = "noopener noreferrer";
              logoWrap.className = "mll-mylist-card-logo-wrap";
              const img = document.createElement("img");
              img.className = "mll-mylist-card-logo";
              img.src = it.logo;
              img.alt = it.title;
              img.loading = "lazy";
              img.onerror = function () { this.style.display = "none"; };
              logoWrap.appendChild(img);
              li.appendChild(logoWrap);
            }

            const body = document.createElement("div");
            body.className = "mll-mylist-card-body";
            const titleA = document.createElement("a");
            titleA.href = it.url || "#";
            titleA.target = "_blank";
            titleA.rel = "noopener noreferrer";
            titleA.className = "mll-mylist-card-title";
            titleA.textContent = it.title;
            body.appendChild(titleA);
            if (it.category) {
              const catBadge = document.createElement("span");
              catBadge.className = "mll-mylist-card-category";
              catBadge.textContent = it.category;
              body.appendChild(catBadge);
            }
            li.appendChild(body);

            const actions = document.createElement("div");
            actions.className = "mll-mylist-card-actions";
            const upIt = document.createElement("button");
            upIt.type = "button";
            upIt.className = "btn-reset-search mll-mylist-order-btn";
            upIt.textContent = "↑";
            upIt.addEventListener("click", (ev) => {
              ev.preventDefault();
              void moveChannelBookmarkOrder(it.docId, block.meta.id, -1);
            });
            const downIt = document.createElement("button");
            downIt.type = "button";
            downIt.className = "btn-reset-search mll-mylist-order-btn";
            downIt.textContent = "↓";
            downIt.addEventListener("click", (ev) => {
              ev.preventDefault();
              void moveChannelBookmarkOrder(it.docId, block.meta.id, 1);
            });
            const del = document.createElement("button");
            del.type = "button";
            del.className = "btn-reset-search mll-mylist-remove";
            del.textContent = "削除";
            del.addEventListener("click", () => void removeByDocId(it.docId));
            actions.appendChild(upIt);
            actions.appendChild(downIt);
            actions.appendChild(del);
            li.appendChild(actions);

            ul.appendChild(li);
          }
          sec.appendChild(head);
          sec.appendChild(ul);
          frag.appendChild(sec);
        }
        host.appendChild(frag);
      })
      .catch((e) => {
        console.warn(e);
        const p = document.createElement("p");
        p.className = "mll-mylist-empty";
        p.textContent = "一覧を読み込めませんでした。";
        host.appendChild(p);
      });
  }

  window.addEventListener("mll-auth-changed", () => void refreshCache());

  window.addEventListener("marchinz-like-show-changed", () => {
    window.MarchinZYoutubeChannelMylist?.renderMylist?.();
  });

  void refreshCache();

  window.MarchinZYoutubeChannelMylist = {
    add,
    addWithPicker,
    addChannelToList,
    renderMylist,
    refreshCache,
    normalizeChannelUrl,
    bookmarkDocId,
    hasChannel: hasChannelAnywhere,
    hasChannelInList,
    updateListOshiText: updateChannelListOshiText,
    renameList: renameChannelList,
    updateListVisibility: updateChannelListVisibility,
    deleteListCascade: deleteChannelListCascade,
    deleteAllListsCascade: deleteAllChannelListsCascade,
    appendListLikeRow: appendChannelListLike,
    DEFAULT_LIST_ID,
  };
})();
