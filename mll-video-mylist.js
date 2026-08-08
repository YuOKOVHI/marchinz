/**
 * 大会動画マイリスト — 複数リスト・リスト単位の公開／非公開・追加時にリスト選択
 */
(() => {
  const SS_INTENT_MYLIST_ROW = "mll_intent_mylist_row_json";
  const DEFAULT_LIST_ID = "default";

  function isLegacyDefaultPickerList(id, name) {
    return String(id) === DEFAULT_LIST_ID && String(name || "").trim() === "マイリスト";
  }
  const LS_LAST_LIST = "mz_video_mylist_last_list_id";

  const hostEl = () => document.getElementById("mll-mylist-video-host");
  const msgEl = () => document.getElementById("mll-mylist-msg");
  const pickerDlg = () => document.getElementById("mz-video-mylist-picker");

  /** @type {Map<string, Set<string>>} listId -> normalized url keys */
  const listUrlKeys = new Map();

  /** @type {{ id: string; name: string; visibility: string; list_order: number }[]} */
  let cachedLists = [];

  let pendingRowPlain = null;

  const ROW_KEYS_FOR_PENDING = [
    "種別",
    "分類",
    "動画での表示名",
    "チーム名",
    "団体/チーム名",
    "団体名",
    "配信日",
    "大会名",
    "URL",
    "動画配信元",
    "動画配信元URL",
  ];

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

  function cloneRowForPending(row) {
    const o = {};
    for (const k of ROW_KEYS_FOR_PENDING) {
      const v = row[k];
      o[k] = v == null ? "" : String(v).trim();
    }
    return o;
  }

  function getUser() {
    return window.MLL_AUTH?.getUser?.() || null;
  }

  function getDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function normalizeVisibility(raw) {
    return String(raw || "").trim() === "private" ? "private" : "public";
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
    renderList();
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

  async function toggleVideoListLike(ownerUid, listId) {
    const inflightKey = `vl:${ownerUid}:${listId}`;
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
      const ref = db.collection("mll_profiles").doc(ownerUid).collection("video_lists").doc(listId);
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
        kind: "like_video_list",
        actor_uid: user.id,
        actor_name: nm,
        target_type: "video_list",
        target_id: String(listId),
        target_title: likeNotify.title,
        target_href: `#profile?uid=${encodeURIComponent(ownerUid)}&tab=videos&mylist=${encodeURIComponent(String(listId))}`,
        thread_root_id: String(listId).slice(0, 128),
      });
    }
    listLikeInflight.delete(inflightKey);
  }

  function appendListLike(hostEl, ownerUid, listId, likedByMap) {
    if (!hostEl || !listId) return;
    const me = getUser();
    const lb = normLbBookmarks(likedByMap);
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    window.MarchinZEngageUi?.buildLikeRow(hostEl, {
      liked,
      count: cnt,
      onClick: () => toggleVideoListLike(ownerUid, listId),
      showLoginHint: !me?.id,
      stopPropagation: true,
    });
  }

  function normalizeBookmarkUrl(u) {
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
    return normalizeBookmarkUrl(u);
  }

  function youtubeVideoIdFromUrl(urlStr) {
    const s = String(urlStr ?? "").trim();
    if (!s) return "";
    try {
      const u = new URL(s);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      if (host === "youtu.be") {
        const id = u.pathname.split("/").filter(Boolean)[0];
        return id && /^[\w-]{11}$/.test(id) ? id : "";
      }
      if (host.includes("youtube.com")) {
        if (u.pathname.startsWith("/embed/")) {
          const id = u.pathname.split("/")[2];
          return id && /^[\w-]{11}$/.test(id) ? id : "";
        }
        if (u.pathname.startsWith("/shorts/")) {
          const id = u.pathname.split("/")[2];
          return id && /^[\w-]{11}$/.test(id) ? id : "";
        }
        const v = u.searchParams.get("v");
        return v && /^[\w-]{11}$/.test(v) ? v : "";
      }
    } catch {
      return "";
    }
    return "";
  }

  function bookmarkDocId(normUrl) {
    let h = 2166136261;
    const str = normUrl;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `b${(h >>> 0).toString(36)}`;
  }

  function sanitizeListId(id) {
    return String(id || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 64) || "list";
  }

  /**
   * 既定リストは従来どおり URL ハッシュのみの doc ID。それ以外は listId + '_' + hash
   * @param {string} listId
   * @param {string} normUrl
   */
  function bookmarkDocumentId(listId, normUrl) {
    const base = bookmarkDocId(normUrl);
    if (listId === DEFAULT_LIST_ID) return base;
    return `${sanitizeListId(listId)}_${base}`;
  }

  /** @param {string} docId @param {Record<string, unknown>} data */
  function inferListIdFromDoc(docId, data) {
    const fromData = String(data?.list_id || "").trim();
    if (fromData) return fromData;
    const id = String(docId);
    const idx = id.lastIndexOf("_b");
    if (idx > 0) {
      const rest = id.slice(idx + 1);
      if (/^b[a-z0-9]+$/.test(rest)) return id.slice(0, idx);
    }
    return DEFAULT_LIST_ID;
  }

  function rowCategory(row) {
    if (row["分類"]) return String(row["分類"] || "").trim();
    const title = row["大会名"] || "";
    const cf = String(title).toLowerCase();
    if (cf.includes("mix3") || String(title).includes("スリークロス")) {
      return "スリークロスチーム";
    }
    return "マーチング団体等";
  }

  function rowOrgTeam(row) {
    return String(row["団体/チーム名"] ?? row["団体名"] ?? "").trim();
  }

  function rowDisplayName(row) {
    return String(row["動画での表示名"] ?? row["チーム名"] ?? row["団体"] ?? "").trim();
  }

  function rowChannelName(row) {
    const n = String(row["動画配信元"] ?? "").trim();
    return n || "マーチング祭";
  }

  function rowChannelUrl(row) {
    const u = String(row["動画配信元URL"] ?? "").trim();
    return u || "https://www.youtube.com/@marching-matsuri";
  }

  function rowToPayload(row, listId) {
    const url = String(row["URL"] ?? "").trim();
    const key = urlKey(url);
    return {
      list_id: listId,
      url: key || url,
      video_id: youtubeVideoIdFromUrl(url),
      org_team: rowOrgTeam(row),
      display_name: rowDisplayName(row),
      event_title: String(row["大会名"] ?? "").trim(),
      channel_name: rowChannelName(row),
      channel_url: rowChannelUrl(row),
      category: rowCategory(row),
      added_at: new Date().toISOString().slice(0, 40),
      sort_index: Math.min(2147483647, Math.floor(Date.now() / 1000)),
    };
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

  async function getMaxVideoListOrder(user, db) {
    const snap = await db.collection("mll_profiles").doc(user.id).collection("video_lists").limit(200).get();
    let m = 0;
    snap.forEach((doc) => {
      const v = Number(doc.data()?.list_order);
      if (Number.isFinite(v)) m = Math.max(m, v);
    });
    return m;
  }

  /** @returns {Promise<{ id: string; name: string; oshi_text: string; visibility: string; list_order: number }[]>} */
  async function loadListMetas(user, db) {
    const snap = await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("video_lists")
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
      window.dispatchEvent(new CustomEvent("marchinz-mylist-updated"));
      renderList();
      return;
    }
    try {
      cachedLists = await loadListMetas(user, db);
      const snap = await db
        .collection("mll_profiles")
        .doc(user.id)
        .collection("video_bookmarks")
        .orderBy("added_at", "desc")
        .limit(400)
        .get();
      snap.forEach((doc) => {
        const d = doc.data() || {};
        const u = String(d.url || "").trim();
        const k = urlKey(u);
        const lid = inferListIdFromDoc(doc.id, d);
        if (!listUrlKeys.has(lid)) listUrlKeys.set(lid, new Set());
        if (k) listUrlKeys.get(lid).add(k);
      });
    } catch (e) {
      console.warn("[mll-video-mylist]", e);
    }
    window.dispatchEvent(new CustomEvent("marchinz-mylist-updated"));
    renderList();
  }

  function hasUrlInList(rawUrl, listId) {
    const k = urlKey(rawUrl);
    const lid = String(listId || DEFAULT_LIST_ID);
    return Boolean(k && listUrlKeys.get(lid)?.has(k));
  }

  function trackMetric(name, payload = {}) {
    if (typeof window.MarchinZTrackEvent === "function") {
      window.MarchinZTrackEvent(name, payload);
    }
  }

  /** いずれかのリストに同一 URL があるか */
  function hasUrlAnywhere(rawUrl) {
    const k = urlKey(rawUrl);
    if (!k) return false;
    for (const s of listUrlKeys.values()) {
      if (s.has(k)) return true;
    }
    return false;
  }

  /**
   * @returns {Promise<boolean>}
   */
  async function addRowToList(row, listId) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) {
      setMsg("マイリストに追加するにはログインしてください。", true);
      return false;
    }
    const lid = String(listId || "").trim();
    if (!lid) {
      setMsg("保存先のリストを選んでください。", true);
      return false;
    }
    const payload = rowToPayload(row, lid);
    if (!payload.url) {
      setMsg("動画URLがありません。", true);
      return false;
    }
    if (hasUrlInList(payload.url, lid)) {
      setMsg("このリストにはすでに追加済みです。");
      window.setTimeout(() => setMsg(""), 2400);
      return true;
    }
    const docId = bookmarkDocumentId(lid, payload.url);
    const ref = db.collection("mll_profiles").doc(user.id).collection("video_bookmarks").doc(docId);
    try {
      const prev = await ref.get();
      if (prev.exists) {
        if (!listUrlKeys.has(lid)) listUrlKeys.set(lid, new Set());
        listUrlKeys.get(lid).add(urlKey(payload.url));
        setMsg("このリストにはすでに追加済みです。");
        window.setTimeout(() => setMsg(""), 2400);
        return true;
      }
      await ref.set(payload);
      if (!listUrlKeys.has(lid)) listUrlKeys.set(lid, new Set());
      listUrlKeys.get(lid).add(payload.url);
      setLastUsedListId(lid);
      setMsg("マイリストに追加しました。");
      trackMetric("mylist_add", { target: "video", list_id: lid });
      window.setTimeout(() => setMsg(""), 2400);
      renderList();
      window.dispatchEvent(new CustomEvent("marchinz-mylist-updated"));
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

  async function createList(name, visibility, oshiText = "") {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) return null;
    const id = `L_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const sid = sanitizeListId(id);
    const now = new Date().toISOString();
    const maxO = await getMaxVideoListOrder(user, db);
    showBusyOverlay();
    try {
      await db
        .collection("mll_profiles")
        .doc(user.id)
        .collection("video_lists")
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
      window.MarchinZAdminUgcLog?.recordVideoMylist?.({
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

  async function renameVideoList(listId, rawName) {
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
      await db.collection("mll_profiles").doc(user.id).collection("video_lists").doc(listId).set(
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

  async function updateVideoListOshiText(listId, rawText) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !listId) return;
    const txt = String(rawText || "").trim().slice(0, 240);
    await db.collection("mll_profiles").doc(user.id).collection("video_lists").doc(listId).set(
      {
        oshi_text: txt,
        updated_at: new Date().toISOString(),
      },
      { merge: true },
    );
    await refreshCache();
  }

  /**
   * @param {string} listId
   * @param {number} dir -1 = 上へ, +1 = 下へ
   */
  async function moveVideoListOrder(listId, dir) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !listId) return;
    const lists = await loadListMetas(user, db);
    const idx = lists.findIndex((x) => x.id === listId);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= lists.length) return;
    const a = lists[idx];
    const b = lists[j];
    const now = new Date().toISOString();
    const refA = db.collection("mll_profiles").doc(user.id).collection("video_lists").doc(a.id);
    const refB = db.collection("mll_profiles").doc(user.id).collection("video_lists").doc(b.id);
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
  async function moveVideoBookmarkOrder(docId, listId, dir) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !docId) return;
    const snap = await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("video_bookmarks")
      .orderBy("added_at", "desc")
      .limit(400)
      .get();
    /** @type {{ id: string; sort: number; added: string }[]} */
    const rows = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const lid = inferListIdFromDoc(doc.id, d);
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
    const refA = db.collection("mll_profiles").doc(user.id).collection("video_bookmarks").doc(A.id);
    const refB = db.collection("mll_profiles").doc(user.id).collection("video_bookmarks").doc(B.id);
    const tmp = Math.floor(Date.now() / 1000) % 2000000000;
    await refA.update({ sort_index: tmp });
    await refB.update({ sort_index: A.sort });
    await refA.update({ sort_index: B.sort });
    await refreshCache();
  }

  async function updateListVisibility(listId, visibility) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) return;
    const now = new Date().toISOString();
    showBusyOverlay();
    try {
      await db
        .collection("mll_profiles")
        .doc(user.id)
        .collection("video_lists")
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

  /**
   * 既定リスト以外を削除。当該リストのブックマークはすべて削除（空のリストのみ削除したい場合は事前に移動してください）。
   * @param {string} listId
   */
  async function deleteVideoListCascade(listId) {
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
          .collection("video_bookmarks")
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
        .collection("video_bookmarks")
        .limit(500)
        .get();
      const batch2 = db.batch();
      let n2 = 0;
      legacy.forEach((doc) => {
        const d = doc.data() || {};
        if (inferListIdFromDoc(doc.id, d) === lid) {
          batch2.delete(doc.ref);
          n2 += 1;
        }
      });
      if (n2) await batch2.commit();
      await db.collection("mll_profiles").doc(user.id).collection("video_lists").doc(lid).delete();
      await refreshCache();
      window.dispatchEvent(new CustomEvent("marchinz-mylist-updated"));
    } catch (e) {
      alertErr(e, "リストの削除に失敗しました。");
      throw e;
    } finally {
      hideBusyOverlay();
    }
  }

  function requestLoginThenAdd(row) {
    pendingRowPlain = cloneRowForPending(row);
    try {
      sessionStorage.setItem(SS_INTENT_MYLIST_ROW, JSON.stringify(pendingRowPlain));
    } catch {
      //
    }
    window.MarchinZNavigateAuthEntry?.("signup", "videos_mylist");
  }

  /** @type {{ resolve: (v: string|null) => void } | null} */
  let pickerResolver = null;

  function wirePickerOnce() {
    const dlg = pickerDlg();
    if (!dlg || dlg.dataset.mzPickerWired === "1") return;
    dlg.dataset.mzPickerWired = "1";
    dlg.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t === dlg) closePicker(null);
    });
    dlg.addEventListener("cancel", (ev) => {
      ev.preventDefault();
      closePicker(null);
    });
    dlg.querySelector("[data-mz-picker-cancel]")?.addEventListener("click", () => closePicker(null));
    dlg.querySelector("[data-mz-picker-confirm]")?.addEventListener("click", () => void confirmPicker());
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
    const chosen = dlg.querySelector('input[name="mz-picker-list"]:checked');
    const rid = chosen instanceof HTMLInputElement ? String(chosen.value || "").trim() : "";
    const newName = /** @type {HTMLInputElement|null} */ (dlg.querySelector("[data-mz-new-list-name]"));
    const newOshi = /** @type {HTMLTextAreaElement|null} */ (dlg.querySelector("[data-mz-new-list-oshi]"));
    if (rid === "__new__") {
      const nm = (newName?.value || "").trim();
      if (!nm) {
        setMsg("新しいリストの名前を入力してください。", true);
        return;
      }
      const oshi = (newOshi?.value || "").trim();
      const user = getUser();
      const db = getDb();
      const nid = await createList(nm, "public", oshi);
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
   * @param {Record<string, string>} row
   * @returns {Promise<string|null>} list id or null
   */
  async function openPicker(row) {
    wirePickerOnce();
    const dlg = pickerDlg();
    if (!(dlg instanceof HTMLDialogElement)) return Promise.resolve(lastUsedListId());

    const user = getUser();
    const db = getDb();
    const titleEl = dlg.querySelector("[data-mz-picker-title]");
    if (titleEl) {
      titleEl.textContent = "保存先のリスト";
    }

    const body = dlg.querySelector("[data-mz-picker-lists]");
    const newBlock = dlg.querySelector("[data-mz-picker-new]");
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
        inp.name = "mz-picker-list";
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
      newInp.name = "mz-picker-list";
      newInp.value = "__new__";
      if (!lists.length) newInp.checked = true;
      newLab.appendChild(newInp);
      newLab.appendChild(document.createTextNode("新しいリストを作成…"));
      body.appendChild(newLab);
      newInp.addEventListener("change", () => {
        if (newBlock) newBlock.hidden = !newInp.checked;
      });
      body.querySelectorAll('input[name="mz-picker-list"]').forEach((r) => {
        r.addEventListener("change", () => {
          if (r instanceof HTMLInputElement && r.value !== "__new__" && newBlock) newBlock.hidden = true;
        });
      });
    }
    if (newBlock) {
      const checked = dlg.querySelector('input[name="mz-picker-list"]:checked');
      const isNew = checked instanceof HTMLInputElement && checked.value === "__new__";
      newBlock.hidden = !isNew;
      const ni = dlg.querySelector("[data-mz-new-list-name]");
      if (ni instanceof HTMLInputElement) ni.value = "";
      const oi = dlg.querySelector("[data-mz-new-list-oshi]");
      if (oi instanceof HTMLTextAreaElement) oi.value = "";
    }

    return new Promise((resolve) => {
      pickerResolver = resolve;
      try {
        dlg.showModal();
      } catch {
        pickerResolver = null;
        resolve(lastUsedListId());
      }
    });
  }

  /**
   * @param {Record<string, string>} row
   */
  async function openAddDialog(row) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) {
      requestLoginThenAdd(row);
      return;
    }
    cachedLists = await loadListMetas(user, db);
    const listId = await openPicker(row);
    if (!listId) return;
    await addRowToList(row, listId);
  }

  async function removeByDocId(docId) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !docId) return;
    try {
      const ref = db.collection("mll_profiles").doc(user.id).collection("video_bookmarks").doc(docId);
      const snap = await ref.get();
      const d = snap.data() || {};
      const u = String(d.url || "").trim();
      const lid = inferListIdFromDoc(docId, d);
      await ref.delete();
      trackMetric("mylist_remove", { target: "video", list_id: lid || "" });
      const k = urlKey(u);
      if (k && listUrlKeys.has(lid)) listUrlKeys.get(lid).delete(k);
      renderList();
      window.dispatchEvent(new CustomEvent("marchinz-mylist-updated"));
    } catch (e) {
      console.warn(e);
      setMsg(String(e?.message || "削除に失敗しました。"), true);
    }
  }

  function renderList() {
    const host = hostEl();
    if (!host) return;
    const db = getDb();
    const user = getUser();
    host.innerHTML = "";
    if (!user?.id || !db) {
      const p = document.createElement("p");
      p.className = "mll-mylist-empty";
      p.textContent = "ログイン後、保存した動画がここに表示されます。";
      host.appendChild(p);
      return;
    }

    loadListMetas(user, db)
      .then((lists) => {
        cachedLists = lists;
        return db
          .collection("mll_profiles")
          .doc(user.id)
          .collection("video_bookmarks")
          .orderBy("added_at", "desc")
          .limit(400)
          .get();
      })
      .then(async (snap) => {
        if (!hostEl()) return;
        /** @type {Map<string, { meta: { id: string; name: string; visibility: string; list_order: number }; items: { docId: string; title: string; url: string; org: string; sort: number; added: string; liked_by?: Record<string, boolean> }[] }>} */
        const grouped = new Map();
        for (const L of cachedLists) {
          grouped.set(L.id, { meta: { ...L, list_order: Number(L.list_order) || 0 }, items: [] });
        }
        snap.forEach((doc) => {
          const d = doc.data() || {};
          const lid = inferListIdFromDoc(doc.id, d);
          if (!grouped.has(lid)) {
            grouped.set(lid, {
              meta: {
                id: lid,
                name: lid,
                  oshi_text: "",
                visibility: "public",
                list_order: lid === DEFAULT_LIST_ID ? 0 : 500000,
              },
              items: [],
            });
          }
          const url = String(d.url || "").trim();
          const title = String(d.event_title || "").trim() || url || "動画";
          const org = String(d.org_team || "").trim();
          const si = Number(d.sort_index);
          grouped.get(lid).items.push({
            docId: doc.id,
            title,
            url,
            org,
            video_id: String(d.video_id || "").trim(),
            channel_name: String(d.channel_name || "").trim(),
            display_name: String(d.display_name || "").trim(),
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
          p.textContent = "まだありません。検索結果のカードから「マイリストに追加」で追加できます。";
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
                if (newName && newName !== block.meta.name) await renameVideoList(block.meta.id, newName);
                if (newOshi !== origOshi) {
                  await updateVideoListOshiText(block.meta.id, newOshi);
                  block.meta.oshi_text = newOshi;
                  setMllOshiDisplayRow(oshiDisplay, newOshi);
                }
                if (pendingVis !== origVis) {
                  await updateListVisibility(block.meta.id, pendingVis);
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
          upList.addEventListener("click", () => void moveVideoListOrder(block.meta.id, -1));
          const downList = document.createElement("button");
          downList.type = "button";
          downList.className = "btn-reset-search mll-mylist-list-tool-btn";
          downList.textContent = "↓";
          downList.title = "リストの表示順を下へ";
          downList.addEventListener("click", () => void moveVideoListOrder(block.meta.id, 1));
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
              for (let s = 0; s < steps; s++) await moveVideoListOrder(fromId, dir);
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
                void moveVideoListOrder(block.meta.id, dir);
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
          shareBtn.setAttribute("aria-label", `大会動画マイリスト「${block.meta.name}」をシェア`);
          right.appendChild(shareBtn);
          const uid = String(user.id || "").trim();
          const sm = window.MarchinZShareMenu;
          if (uid && sm?.buildAbsoluteUrlForHash && sm.mylistShareText && sm.setupSearchLikeShareMenuForButton) {
            const profHash = `#profile?uid=${encodeURIComponent(uid)}&tab=videos&mylist=${encodeURIComponent(block.meta.id)}`;
            const shareUrl = sm.buildAbsoluteUrlForHash(profHash);
            const shareText = sm.mylistShareText(block.meta.name, shareUrl, "videos");
            sm.setupSearchLikeShareMenuForButton(shareBtn, shareText, shareUrl);
          }
          const likeHost = document.createElement("div");
          likeHost.className = "mll-mylist-list-like-host mz-inline-like-host";
          appendListLike(likeHost, user.id, block.meta.id, block.meta.liked_by);

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
          ul.className = "mll-mylist-video-list mll-mylist-video-grid";
          for (const it of block.items) {
            const li = document.createElement("li");
            li.className = "mll-mylist-video-card";

            const thumbUrl = it.video_id
              ? `https://i.ytimg.com/vi/${it.video_id}/mqdefault.jpg`
              : "";
            if (thumbUrl) {
              const thumbWrap = document.createElement("a");
              thumbWrap.href = it.url || "#";
              thumbWrap.target = "_blank";
              thumbWrap.rel = "noopener noreferrer";
              thumbWrap.className = "mll-mylist-card-thumb-wrap";
              const img = document.createElement("img");
              img.className = "mll-mylist-card-thumb";
              img.src = thumbUrl;
              img.alt = it.title;
              img.loading = "lazy";
              img.onerror = function () { this.style.display = "none"; };
              thumbWrap.appendChild(img);
              li.appendChild(thumbWrap);
            }

            const body = document.createElement("div");
            body.className = "mll-mylist-card-body";
            if (it.org) {
              const orgP = document.createElement("p");
              orgP.className = "mll-mylist-card-org";
              orgP.textContent = it.org;
              body.appendChild(orgP);
            }
            const titleA = document.createElement("a");
            titleA.href = it.url || "#";
            titleA.target = "_blank";
            titleA.rel = "noopener noreferrer";
            titleA.className = "mll-mylist-card-title";
            titleA.textContent = it.title;
            body.appendChild(titleA);
            if (it.channel_name || it.display_name) {
              const chP = document.createElement("p");
              chP.className = "mll-mylist-card-channel";
              chP.textContent = String(it.channel_name || it.display_name || "").trim();
              body.appendChild(chP);
            }
            li.appendChild(body);

            const actions = document.createElement("div");
            actions.className = "mll-mylist-card-actions";
            const upIt = document.createElement("button");
            upIt.type = "button";
            upIt.className = "btn-reset-search mll-mylist-order-btn";
            upIt.textContent = "↑";
            upIt.title = "このリスト内で上へ";
            upIt.addEventListener("click", (ev) => {
              ev.preventDefault();
              void moveVideoBookmarkOrder(it.docId, block.meta.id, -1);
            });
            const downIt = document.createElement("button");
            downIt.type = "button";
            downIt.className = "btn-reset-search mll-mylist-order-btn";
            downIt.textContent = "↓";
            downIt.title = "このリスト内で下へ";
            downIt.addEventListener("click", (ev) => {
              ev.preventDefault();
              void moveVideoBookmarkOrder(it.docId, block.meta.id, 1);
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

  window.MarchinZVideoMylist = {
    normalizeUrl: normalizeBookmarkUrl,
    urlKey,
    hasUrl: hasUrlAnywhere,
    hasUrlInList,
    refreshCache,
    addRow: openAddDialog,
    addRowToList,
    openAddDialog,
    renderList,
    requestLoginThenAdd,
    createList,
    renameList: renameVideoList,
    updateListVisibility,
    updateListOshiText: updateVideoListOshiText,
    deleteListCascade: deleteVideoListCascade,
    moveListOrder: moveVideoListOrder,
    moveBookmarkOrder: moveVideoBookmarkOrder,
    appendListLikeRow: appendListLike,
    DEFAULT_LIST_ID,
  };

  window.addEventListener("mll-auth-changed", async (ev) => {
    const user = ev.detail?.user || null;
    let row = null;
    if (user?.id) {
      if (pendingRowPlain) {
        row = pendingRowPlain;
        pendingRowPlain = null;
        try {
          sessionStorage.removeItem(SS_INTENT_MYLIST_ROW);
        } catch {
          //
        }
      } else {
        try {
          const raw = sessionStorage.getItem(SS_INTENT_MYLIST_ROW);
          if (raw) {
            sessionStorage.removeItem(SS_INTENT_MYLIST_ROW);
            row = JSON.parse(raw);
          }
        } catch {
          row = null;
        }
      }
    }
    if (user?.id && row) {
      cachedLists = await loadListMetas(user, getDb());
      const listId = await openPicker(row);
      if (listId) {
        const ok = await addRowToList(row, listId);
        if (!ok) {
          setMsg("マイリストへの保存に失敗しました。ネットワークや Firebase の設定を確認し、もう一度お試しください。", true);
        }
      }
    }
    await refreshCache();
  });

  window.addEventListener("hashchange", () => {
    if (getUser()?.id) return;
    const h = location.hash.replace(/^#/, "");
    if (h === "signup" || h === "login") return;
    pendingRowPlain = null;
    try {
      sessionStorage.removeItem(SS_INTENT_MYLIST_ROW);
    } catch {
      //
    }
  });

  window.addEventListener("marchinz-like-show-changed", () => {
    window.MarchinZVideoMylist?.renderList?.();
  });

  void refreshCache();
})();
